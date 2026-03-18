//go:build darwin

package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

// bpfIfreq for BIOCSETIF: interface name only (kernel uses first IFNAMSIZ bytes).
type bpfIfreq struct {
	Name [16]byte
	Pad  [16]byte
}

// RunPacketCaptureStream captures packets and streams each one in real-time
// via the provided channel. The channel is closed when capture is complete.
// The context can be cancelled to stop a continuous capture.
func RunPacketCaptureStream(ctx context.Context, p PacketCaptureParams, out chan<- ToolResponse) {
	defer close(out)
	maxPackets := p.MaxPackets
	durationSecs := p.DurationSecs

	if p.Continuous {
		// Continuous mode: no packet/time limits, only stopped by context cancellation
		maxPackets = 0
		durationSecs = 0
	} else {
		if maxPackets == 0 {
			maxPackets = 1000
		}
		if durationSecs == 0 {
			durationSecs = 30
		}
	}

	// Try multiple capture methods in order of preference:
	// 1. Native BPF (needs root or Wireshark's ChmodBPF)
	// 2. dumpcap (Wireshark's capture tool, often has setuid)
	// 3. tcpdump
	// 4. Diagnostic error with specific fix instructions
	if streamBPFCapture(ctx, p, maxPackets, durationSecs, out) {
		return
	}
	if streamDumpcapCapture(ctx, p, maxPackets, durationSecs, out) {
		return
	}
	if streamTcpdumpCapture(ctx, p, maxPackets, durationSecs, out) {
		return
	}

	// All methods failed — build a diagnostic message
	out <- ToolResponse{
		Type: "Error",
		Data: ErrorData{
			Code:    "CAPTURE_PERMISSION",
			Message: buildCaptureDiagnostic(),
		},
	}
}

// buildCaptureDiagnostic checks what's available and returns a specific fix suggestion.
func buildCaptureDiagnostic() string {
	var diag strings.Builder
	diag.WriteString("Packet capture failed — no capture method available.\n\n")

	// Check BPF access
	bpfOK := false
	for i := 0; i < 4; i++ {
		f, err := os.OpenFile(fmt.Sprintf("/dev/bpf%d", i), os.O_RDONLY, 0)
		if err == nil {
			f.Close()
			bpfOK = true
			break
		}
	}
	if bpfOK {
		diag.WriteString("• BPF: accessible but bind failed (interface issue?)\n")
	} else {
		diag.WriteString("• BPF: /dev/bpf* not accessible (permission denied)\n")
	}

	// Check dumpcap
	if path, err := exec.LookPath("dumpcap"); err == nil {
		diag.WriteString(fmt.Sprintf("• dumpcap: found at %s but failed to start\n", path))
	} else {
		diag.WriteString("• dumpcap: not installed\n")
	}

	// Check tcpdump
	if path, err := exec.LookPath("tcpdump"); err == nil {
		diag.WriteString(fmt.Sprintf("• tcpdump: found at %s but failed to start\n", path))
	} else {
		diag.WriteString("• tcpdump: not found\n")
	}

	diag.WriteString("\nTo fix, choose one:\n")
	diag.WriteString("  1. Install Wireshark — its ChmodBPF grants BPF access to your user\n")
	diag.WriteString("  2. Run: sudo chmod o+r /dev/bpf*  (temporary, resets on reboot)\n")
	diag.WriteString("  3. Run the agent with sudo\n")
	return diag.String()
}

// streamBPFCapture attempts native BPF capture, streaming packets via out.
// Returns true if BPF was available (even if capture had errors), false to signal tcpdump fallback.
func streamBPFCapture(ctx context.Context, p PacketCaptureParams, maxPackets, durationSecs uint32, out chan<- ToolResponse) bool {
	var deadline time.Time
	if durationSecs > 0 {
		deadline = time.Now().Add(time.Duration(durationSecs) * time.Second)
	}

	// Open first available BPF device
	var bpfFD *os.File
	for i := 0; i < 32; i++ {
		path := fmt.Sprintf("/dev/bpf%d", i)
		f, err := os.OpenFile(path, os.O_RDWR, 0)
		if err != nil {
			continue
		}
		bpfFD = f
		break
	}
	if bpfFD == nil {
		return false // signal to try tcpdump fallback
	}
	defer bpfFD.Close()
	fd := int(bpfFD.Fd())

	// Set buffer size before BIOCSETIF (required on Darwin)
	bufLen := 65536
	if err := unix.IoctlSetInt(fd, unix.BIOCSBLEN, bufLen); err != nil {
		return false
	}

	// Determine interface
	ifaceName := ""
	if p.Interface != nil && *p.Interface != "" {
		ifaceName = *p.Interface
	} else {
		ifaces, _ := net.Interfaces()
		for _, iface := range ifaces {
			if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
				continue
			}
			addrs, _ := iface.Addrs()
			for _, addr := range addrs {
				if ipnet, ok := addr.(*net.IPNet); ok && ipnet.IP.To4() != nil && !ipnet.IP.IsLoopback() {
					ifaceName = iface.Name
					break
				}
			}
			if ifaceName != "" {
				break
			}
		}
	}

	if ifaceName == "" {
		out <- ToolResponse{
			Type: "Error",
			Data: ErrorData{Code: "CAPTURE_ERROR", Message: "no suitable network interface found"},
		}
		return true
	}

	// Bind to interface
	var ifr bpfIfreq
	copy(ifr.Name[:], ifaceName)
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), uintptr(unix.BIOCSETIF), uintptr(unsafe.Pointer(&ifr)))
	if errno != 0 {
		return false // try tcpdump fallback
	}

	// Enable immediate mode so we don't wait for full buffers
	if err := unix.IoctlSetInt(fd, unix.BIOCIMMEDIATE, 1); err != nil {
		// Non-fatal
	}

	// Set a read timeout so we don't block forever
	tv := unix.Timeval{Sec: 1, Usec: 0}
	_, _, errno = unix.Syscall(unix.SYS_IOCTL, uintptr(fd), uintptr(unix.BIOCSETIF), uintptr(unsafe.Pointer(&tv)))

	// Apply BPF filter using tcpdump to compile it
	if p.Filter != nil && *p.Filter != "" {
		applyBPFFilter(fd, *p.Filter, ifaceName)
	}

	buf := make([]byte, bufLen)
	seq := uint64(0)
	start := time.Now()

	for {
		// Check for context cancellation (stop command)
		select {
		case <-ctx.Done():
			goto bpfDone
		default:
		}
		if !deadline.IsZero() && time.Now().After(deadline) {
			break
		}
		if maxPackets > 0 && seq >= uint64(maxPackets) {
			break
		}

		bpfFD.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		n, err := bpfFD.Read(buf)
		if err != nil {
			if isTimeoutError(err) || err == unix.EAGAIN || err == unix.EWOULDBLOCK {
				continue
			}
			out <- ToolResponse{
				Type: "Error",
				Data: ErrorData{Code: "CAPTURE_ERROR", Message: "read: " + err.Error()},
			}
			break
		}
		if n <= 0 {
			continue
		}

		// Parse BPF buffer: each record is BpfHdr + packet
		offset := 0
		for offset+int(unix.SizeofBpfHdr) <= n {
			hdr := buf[offset : offset+unix.SizeofBpfHdr]
			caplen := binary.LittleEndian.Uint32(hdr[8:12])
			hdrlen := binary.LittleEndian.Uint16(hdr[16:18])
			if hdrlen < unix.SizeofBpfHdr {
				break
			}
			payloadStart := offset + int(hdrlen)
			if payloadStart+int(caplen) > n {
				break
			}
			seq++
			chunk := make([]byte, caplen)
			copy(chunk, buf[payloadStart:payloadStart+int(caplen)])

			// Parse packet headers for tcpdump-style display
			pktInfo := parsePacket(chunk, true) // BPF gives us full Ethernet frames

			out <- ToolResponse{
				Type: "StreamData",
				Data: StreamChunk{
					Seq:        seq,
					Data:       base64.StdEncoding.EncodeToString(chunk),
					FinalChunk: false,
					PacketInfo: pktInfo,
				},
			}
			if maxPackets > 0 && seq >= uint64(maxPackets) {
				break
			}
			// Align to BPF word boundary (4 bytes)
			offset = payloadStart + int(caplen)
			if offset%4 != 0 {
				offset += 4 - offset%4
			}
		}
	}

bpfDone:
	out <- ToolResponse{
		Type: "Result",
		Data: ResultData{
			Success: true,
			Result: map[string]interface{}{
				"packets":      seq,
				"elapsed_secs": time.Since(start).Seconds(),
				"interface":    ifaceName,
			},
			ElapsedMs: uint64(time.Since(start).Milliseconds()),
		},
	}
	return true
}

// applyBPFFilter uses tcpdump to compile a BPF filter expression and applies it to the BPF device.
func applyBPFFilter(fd int, filter string, iface string) {
	// Use tcpdump -dd to compile the filter to BPF bytecode
	args := []string{"-dd", "-i", iface, filter}
	cmd := exec.Command("tcpdump", args...)
	output, err := cmd.Output()
	if err != nil {
		return // Silently fail — capture will just be unfiltered
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(lines) == 0 {
		return
	}

	// Parse the tcpdump -dd output into BPF instructions
	// Each line is: { 0xNN, N, N, 0xNNNNNNNN },
	type bpfInsn struct {
		Code uint16
		Jt   uint8
		Jf   uint8
		K    uint32
	}

	insns := make([]bpfInsn, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		line = strings.TrimSuffix(line, ",")
		line = strings.TrimPrefix(line, "{")
		line = strings.TrimSuffix(line, "}")
		line = strings.TrimSpace(line)

		parts := strings.Split(line, " ")
		if len(parts) < 4 {
			return // Bad format
		}

		var code uint32
		var jt, jf uint32
		var k uint32
		fmt.Sscanf(strings.TrimSuffix(parts[0], ","), "0x%x", &code)
		fmt.Sscanf(strings.TrimSuffix(parts[1], ","), "%d", &jt)
		fmt.Sscanf(strings.TrimSuffix(parts[2], ","), "%d", &jf)
		fmt.Sscanf(strings.TrimSuffix(parts[3], ","), "0x%x", &k)

		insns = append(insns, bpfInsn{
			Code: uint16(code),
			Jt:   uint8(jt),
			Jf:   uint8(jf),
			K:    k,
		})
	}

	if len(insns) == 0 {
		return
	}

	// Build the program struct and apply with BIOCSETF
	type bpfProgram struct {
		Len    uint32
		_      [4]byte // padding on 64-bit
		Insns  uintptr
	}

	prog := bpfProgram{
		Len:   uint32(len(insns)),
		Insns: uintptr(unsafe.Pointer(&insns[0])),
	}

	unix.Syscall(unix.SYS_IOCTL, uintptr(fd), uintptr(unix.BIOCSETF), uintptr(unsafe.Pointer(&prog)))
}

// streamDumpcapCapture tries Wireshark's dumpcap which often has setuid privileges.
// Returns true if dumpcap was available and ran, false to try next fallback.
func streamDumpcapCapture(ctx context.Context, p PacketCaptureParams, maxPackets, durationSecs uint32, out chan<- ToolResponse) bool {
	dumpcapPath, err := exec.LookPath("dumpcap")
	if err != nil {
		return false
	}

	args := []string{"-P", "-q"} // pcap format, quiet
	if p.Interface != nil && *p.Interface != "" {
		args = append(args, "-i", *p.Interface)
	} else {
		args = append(args, "-i", "1") // first non-loopback
	}
	if maxPackets > 0 {
		args = append(args, "-c", fmt.Sprintf("%d", maxPackets))
	}
	if durationSecs > 0 {
		args = append(args, "-a", fmt.Sprintf("duration:%d", durationSecs))
	}

	if p.Filter != nil && *p.Filter != "" {
		args = append(args, "-f", *p.Filter)
	}

	args = append(args, "-w", "-")

	cmd := exec.Command(dumpcapPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return false
	}
	if err := cmd.Start(); err != nil {
		return false
	}

	done := make(chan struct{})
	go func() {
		select {
		case <-done:
		case <-ctx.Done():
			cmd.Process.Signal(unix.SIGTERM)
		case <-func() <-chan time.Time {
			if durationSecs > 0 {
				return time.After(time.Duration(durationSecs) * time.Second)
			}
			return make(chan time.Time) // never fires
		}():
			cmd.Process.Signal(unix.SIGTERM)
		}
	}()

	seq := uint64(0)
	start := time.Now()
	buf := make([]byte, 65536)

	for {
		n, readErr := stdout.Read(buf)
		if n > 0 {
			seq++
			pktInfo := &PacketInfo{
				Timestamp: time.Now().Format("15:04:05.000000"),
				Protocol:  "RAW",
				Length:    n,
				Info:      fmt.Sprintf("dumpcap frame %d (%d bytes)", seq, n),
			}
			out <- ToolResponse{
				Type: "StreamData",
				Data: StreamChunk{
					Seq:        seq,
					Data:       base64.StdEncoding.EncodeToString(buf[:n]),
					FinalChunk: false,
					PacketInfo: pktInfo,
				},
			}
			if maxPackets > 0 && seq >= uint64(maxPackets) {
				break
			}
		}
		if readErr != nil {
			break
		}
	}

	close(done)
	cmd.Wait()

	ifaceName := "unknown"
	if p.Interface != nil && *p.Interface != "" {
		ifaceName = *p.Interface
	}
	out <- ToolResponse{
		Type: "Result",
		Data: ResultData{
			Success: true,
			Result: map[string]interface{}{
				"packets":      seq,
				"elapsed_secs": time.Since(start).Seconds(),
				"interface":    ifaceName,
				"method":       "dumpcap",
			},
			ElapsedMs: uint64(time.Since(start).Milliseconds()),
		},
	}
	return true
}

// streamTcpdumpCapture falls back to shelling out to tcpdump when BPF is not available.
// Returns true if tcpdump was available and ran, false to try next fallback.
func streamTcpdumpCapture(ctx context.Context, p PacketCaptureParams, maxPackets, durationSecs uint32, out chan<- ToolResponse) bool {
	tcpdumpPath, err := exec.LookPath("tcpdump")
	if err != nil {
		return false
	}

	args := []string{"-nn", "-l", "--immediate-mode", "-tt"}

	if p.Interface != nil && *p.Interface != "" {
		args = append(args, "-i", *p.Interface)
	}
	if maxPackets > 0 {
		args = append(args, "-c", fmt.Sprintf("%d", maxPackets))
	}

	if p.Filter != nil && *p.Filter != "" {
		args = append(args, *p.Filter)
	}

	cmd := exec.Command(tcpdumpPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return false
	}

	if err := cmd.Start(); err != nil {
		return false
	}

	done := make(chan struct{})
	go func() {
		select {
		case <-done:
		case <-ctx.Done():
			cmd.Process.Signal(unix.SIGTERM)
		case <-func() <-chan time.Time {
			if durationSecs > 0 {
				return time.After(time.Duration(durationSecs) * time.Second)
			}
			return make(chan time.Time)
		}():
			cmd.Process.Signal(unix.SIGTERM)
		}
	}()

	seq := uint64(0)
	start := time.Now()
	buf := make([]byte, 4096)

	for {
		n, err := stdout.Read(buf)
		if n > 0 {
			lines := strings.Split(string(buf[:n]), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				seq++
				pktInfo := &PacketInfo{
					Timestamp: time.Now().Format("15:04:05.000000"),
					Protocol:  "TCPDUMP",
					Length:    len(line),
					Info:      line,
				}
				parseTcpdumpLine(line, pktInfo)

				out <- ToolResponse{
					Type: "StreamData",
					Data: StreamChunk{
						Seq:        seq,
						Data:       base64.StdEncoding.EncodeToString([]byte(line)),
						FinalChunk: false,
						PacketInfo: pktInfo,
					},
				}
				if maxPackets > 0 && seq >= uint64(maxPackets) {
					break
				}
			}
		}
		if err != nil {
			break
		}
		if maxPackets > 0 && seq >= uint64(maxPackets) {
			break
		}
	}

	close(done)
	cmd.Wait()

	ifaceName := "unknown"
	if p.Interface != nil && *p.Interface != "" {
		ifaceName = *p.Interface
	}

	out <- ToolResponse{
		Type: "Result",
		Data: ResultData{
			Success: true,
			Result: map[string]interface{}{
				"packets":      seq,
				"elapsed_secs": time.Since(start).Seconds(),
				"interface":    ifaceName,
				"method":       "tcpdump",
			},
			ElapsedMs: uint64(time.Since(start).Milliseconds()),
		},
	}
	return true
}

// parseTcpdumpLine extracts IP and protocol from a tcpdump text line.
func parseTcpdumpLine(line string, info *PacketInfo) {
	// tcpdump lines look like: "1234567890.123456 IP 10.0.0.1.443 > 10.0.0.2.12345: ..."
	parts := strings.Fields(line)
	if len(parts) < 4 {
		return
	}

	// Check for protocol identifier (IP, IP6, ARP, etc.)
	for i, part := range parts {
		switch part {
		case "IP", "IP6":
			if i+3 < len(parts) {
				info.Protocol = "TCP" // default, will be overridden if we find more info
				src := strings.TrimSuffix(parts[i+1], ":")
				dst := strings.TrimSuffix(parts[i+3], ":")
				info.SrcIP = src
				info.DstIP = dst
				// Check for protocol hints after ">"
				if i+4 < len(parts) {
					rest := strings.Join(parts[i+4:], " ")
					if strings.HasPrefix(rest, "Flags") {
						info.Protocol = "TCP"
					} else if strings.Contains(rest, "UDP") {
						info.Protocol = "UDP"
					} else if strings.Contains(rest, "ICMP") {
						info.Protocol = "ICMP"
					}
				}
			}
			return
		case "ARP,":
			info.Protocol = "ARP"
			return
		}
	}
}

func isTimeoutError(err error) bool {
	if err == nil {
		return false
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return true
	}
	return strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline")
}
