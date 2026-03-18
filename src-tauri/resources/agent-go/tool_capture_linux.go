//go:build linux

package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

func RunPacketCaptureStream(ctx context.Context, p PacketCaptureParams, out chan<- ToolResponse) {
	defer close(out)
	maxPackets := p.MaxPackets
	durationSecs := p.DurationSecs

	if p.Continuous {
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

	if streamRawCapture(ctx, p, maxPackets, durationSecs, out) {
		return
	}
	if streamDumpcapCaptureLinux(ctx, p, maxPackets, durationSecs, out) {
		return
	}
	if streamTcpdumpCaptureLinux(ctx, p, maxPackets, durationSecs, out) {
		return
	}
	out <- ToolResponse{
		Type: "Error",
		Data: ErrorData{
			Code:    "CAPTURE_PERMISSION",
			Message: buildCaptureDiagnosticLinux(),
		},
	}
}

// streamRawCapture attempts AF_PACKET raw capture, streaming packets via out.
// Returns true if raw socket was available, false to signal tcpdump fallback.
func streamRawCapture(ctx context.Context, p PacketCaptureParams, maxPackets, durationSecs uint32, out chan<- ToolResponse) bool {
	var deadline time.Time
	if durationSecs > 0 {
		deadline = time.Now().Add(time.Duration(durationSecs) * time.Second)
	}

	// ETH_P_ALL in network byte order
	proto := int(0x0300)
	fd, err := unix.Socket(unix.AF_PACKET, unix.SOCK_RAW, proto)
	if err != nil {
		return false // signal to try tcpdump fallback
	}
	defer unix.Close(fd)

	var ifindex int
	ifaceName := "any"
	if p.Interface != nil && *p.Interface != "" {
		iface, err := net.InterfaceByName(*p.Interface)
		if err != nil {
			out <- ToolResponse{
				Type: "Error",
				Data: ErrorData{Code: "CAPTURE_ERROR", Message: "interface: " + err.Error()},
			}
			return true
		}
		ifindex = iface.Index
		ifaceName = iface.Name
	}

	addr := &unix.SockaddrLinklayer{
		Protocol: uint16(0x0300),
		Ifindex:  ifindex,
	}
	if err := unix.Bind(fd, addr); err != nil {
		return false // try tcpdump
	}

	// Enable promiscuous mode on specific interface
	if ifindex != 0 {
		mreq := unix.PacketMreq{Ifindex: int32(ifindex), Type: unix.PACKET_MR_PROMISC}
		unix.SetsockoptPacketMreq(fd, unix.SOL_PACKET, unix.PACKET_ADD_MEMBERSHIP, &mreq)
	}

	if err := unix.SetNonblock(fd, true); err != nil {
		return false
	}

	filter := ""
	if p.Filter != nil {
		filter = *p.Filter
	}

	buf := make([]byte, 65536)
	seq := uint64(0)
	start := time.Now()

	for {
		select {
		case <-ctx.Done():
			goto rawDone
		default:
		}
		if !deadline.IsZero() && time.Now().After(deadline) {
			break
		}
		if maxPackets > 0 && seq >= uint64(maxPackets) {
			break
		}
		n, err := unix.Read(fd, buf)
		if err != nil {
			if err == unix.EAGAIN || err == unix.EWOULDBLOCK {
				time.Sleep(10 * time.Millisecond)
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

		chunk := make([]byte, n)
		copy(chunk, buf[:n])

		pktInfo := parsePacket(chunk, true) // AF_PACKET gives Ethernet frames

		// Software filter: basic port/host matching
		if filter != "" && !softwareFilter(pktInfo, filter) {
			continue
		}

		seq++
		out <- ToolResponse{
			Type: "StreamData",
			Data: StreamChunk{
				Seq:        seq,
				Data:       base64.StdEncoding.EncodeToString(chunk),
				FinalChunk: false,
				PacketInfo: pktInfo,
			},
		}
	}

rawDone:
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

// softwareFilter does basic filtering by checking parsed packet info against common filter patterns.
func softwareFilter(info *PacketInfo, filter string) bool {
	if info == nil {
		return true
	}
	filter = strings.ToLower(filter)

	// Port filter: "port 5060"
	if strings.Contains(filter, "port ") {
		portStr := ""
		for _, part := range strings.Fields(filter) {
			if portStr != "" {
				if info.SrcPort != nil && fmt.Sprintf("%d", *info.SrcPort) == part {
					return true
				}
				if info.DstPort != nil && fmt.Sprintf("%d", *info.DstPort) == part {
					return true
				}
				portStr = ""
				continue
			}
			if part == "port" {
				portStr = "next"
			}
		}
	}

	// Host filter: "host 10.0.0.1"
	if strings.Contains(filter, "host ") {
		for _, part := range strings.Fields(filter) {
			if net.ParseIP(part) != nil {
				if info.SrcIP == part || info.DstIP == part {
					return true
				}
			}
		}
	}

	// Protocol filter
	proto := strings.ToLower(info.Protocol)
	if strings.Contains(filter, "icmp") && proto == "icmp" {
		return true
	}
	if strings.Contains(filter, "tcp") && proto == "tcp" {
		return true
	}
	if strings.Contains(filter, "udp") && (proto == "udp" || proto == "sip" || proto == "rtp" || proto == "dns") {
		return true
	}

	// If filter is very simple and none matched, accept all (avoid blocking everything)
	if !strings.Contains(filter, "port") && !strings.Contains(filter, "host") &&
		!strings.Contains(filter, "tcp") && !strings.Contains(filter, "udp") && !strings.Contains(filter, "icmp") {
		return true
	}

	return false
}

// streamDumpcapCaptureLinux tries Wireshark's dumpcap (often has setcap cap_net_raw).
func streamDumpcapCaptureLinux(ctx context.Context, p PacketCaptureParams, maxPackets, durationSecs uint32, out chan<- ToolResponse) bool {
	dumpcapPath, err := exec.LookPath("dumpcap")
	if err != nil {
		return false
	}
	args := []string{"-P", "-q"}
	if p.Interface != nil && *p.Interface != "" {
		args = append(args, "-i", *p.Interface)
	} else {
		args = append(args, "-i", "any")
	}
	args = append(args, "-c", fmt.Sprintf("%d", maxPackets))
	args = append(args, "-a", fmt.Sprintf("duration:%d", durationSecs))
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
		case <-time.After(time.Duration(durationSecs) * time.Second):
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

	ifaceName := "any"
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

// streamTcpdumpCaptureLinux falls back to tcpdump. Returns true if it ran.
func streamTcpdumpCaptureLinux(ctx context.Context, p PacketCaptureParams, maxPackets, durationSecs uint32, out chan<- ToolResponse) bool {
	tcpdumpPath, err := exec.LookPath("tcpdump")
	if err != nil {
		return false
	}

	args := []string{"-nn", "-l", "--immediate-mode", "-tt"}
	if p.Interface != nil && *p.Interface != "" {
		args = append(args, "-i", *p.Interface)
	}
	args = append(args, "-c", fmt.Sprintf("%d", maxPackets))
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
		case <-time.After(time.Duration(durationSecs) * time.Second):
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

	ifaceName := "any"
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

// buildCaptureDiagnosticLinux checks what's available and returns specific fix instructions.
func buildCaptureDiagnosticLinux() string {
	var diag strings.Builder
	diag.WriteString("Packet capture failed — no capture method available.\n\n")

	// Check AF_PACKET
	fd, err := unix.Socket(unix.AF_PACKET, unix.SOCK_RAW, 0x0300)
	if err == nil {
		unix.Close(fd)
		diag.WriteString("• AF_PACKET: accessible but capture failed\n")
	} else {
		diag.WriteString("• AF_PACKET: permission denied (needs CAP_NET_RAW)\n")
	}

	if path, err := exec.LookPath("dumpcap"); err == nil {
		diag.WriteString(fmt.Sprintf("• dumpcap: found at %s but failed to start\n", path))
	} else {
		diag.WriteString("• dumpcap: not installed\n")
	}
	if path, err := exec.LookPath("tcpdump"); err == nil {
		diag.WriteString(fmt.Sprintf("• tcpdump: found at %s but failed to start\n", path))
	} else {
		diag.WriteString("• tcpdump: not found\n")
	}

	diag.WriteString("\nTo fix, choose one:\n")
	diag.WriteString("  1. sudo setcap cap_net_raw+eip /path/to/sipalyzer-agent\n")
	diag.WriteString("  2. Install Wireshark (dumpcap gets cap_net_raw automatically)\n")
	diag.WriteString("  3. Run the agent with sudo\n")
	return diag.String()
}
