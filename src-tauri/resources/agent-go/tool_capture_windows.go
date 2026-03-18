//go:build windows

package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"os/exec"
	"strings"
	"syscall"
	"time"
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

	if streamRawSocketCapture(ctx, p, maxPackets, durationSecs, out) {
		return
	}
	if streamDumpcapCaptureWin(ctx, p, maxPackets, durationSecs, out) {
		return
	}
	out <- ToolResponse{
		Type: "Error",
		Data: ErrorData{
			Code:    "CAPTURE_PERMISSION",
			Message: buildCaptureDiagnosticWindows(),
		},
	}
}

func streamRawSocketCapture(ctx context.Context, p PacketCaptureParams, maxPackets, durationSecs uint32, out chan<- ToolResponse) bool {
	var deadline time.Time
	if durationSecs > 0 {
		deadline = time.Now().Add(time.Duration(durationSecs) * time.Second)
	}

	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_RAW, syscall.IPPROTO_IP)
	if err != nil {
		return false
	}
	defer syscall.Closesocket(fd)

	localIP := getLocalIPForBind()
	sa := &syscall.SockaddrInet4{}
	copy(sa.Addr[:], net.ParseIP(localIP).To4())
	if err := syscall.Bind(fd, sa); err != nil {
		return false
	}

	// Enable SIO_RCVALL to receive all packets
	var inBuf [4]byte
	inBuf[0] = 1 // RCVALL_ON
	var outBuf [4]byte
	var bytesReturned uint32
	err = syscall.WSAIoctl(fd, 0x98000001, &inBuf[0], 4, &outBuf[0], 4, &bytesReturned, nil, 0)
	if err != nil {
		return false
	}

	buf := make([]byte, 65536)
	seq := uint64(0)
	start := time.Now()

	for {
		select {
		case <-ctx.Done():
			goto winDone
		default:
		}
		if !deadline.IsZero() && time.Now().After(deadline) {
			break
		}
		if maxPackets > 0 && seq >= uint64(maxPackets) {
			break
		}

		n, err := syscall.Read(fd, buf)
		if err != nil {
			break
		}
		if n <= 0 {
			continue
		}

		seq++
		chunk := make([]byte, n)
		copy(chunk, buf[:n])

		pktInfo := parsePacket(chunk, false) // Windows raw socket gives IP packets, no Ethernet

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

winDone:
	out <- ToolResponse{
		Type: "Result",
		Data: ResultData{
			Success: true,
			Result: map[string]interface{}{
				"packets":      seq,
				"elapsed_secs": time.Since(start).Seconds(),
				"method":       "raw_socket",
				"note":         "Windows: IP-level only, inbound traffic",
			},
			ElapsedMs: uint64(time.Since(start).Milliseconds()),
		},
	}
	return true
}

func streamDumpcapCaptureWin(ctx context.Context, p PacketCaptureParams, maxPackets, durationSecs uint32, out chan<- ToolResponse) bool {
	dumpcapPath, err := exec.LookPath("dumpcap")
	if err != nil {
		// Try common Wireshark install paths
		for _, path := range []string{
			`C:\Program Files\Wireshark\dumpcap.exe`,
			`C:\Program Files (x86)\Wireshark\dumpcap.exe`,
		} {
			if _, statErr := exec.LookPath(path); statErr == nil {
				dumpcapPath = path
				break
			}
		}
		if dumpcapPath == "" {
			return false
		}
	}

	args := []string{"-P", "-q"}
	if p.Interface != nil && *p.Interface != "" {
		args = append(args, "-i", *p.Interface)
	} else {
		args = append(args, "-i", "1")
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
			cmd.Process.Kill()
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

	out <- ToolResponse{
		Type: "Result",
		Data: ResultData{
			Success: true,
			Result: map[string]interface{}{
				"packets":      seq,
				"elapsed_secs": time.Since(start).Seconds(),
				"method":       "dumpcap",
			},
			ElapsedMs: uint64(time.Since(start).Milliseconds()),
		},
	}
	return true
}

func buildCaptureDiagnosticWindows() string {
	var diag strings.Builder
	diag.WriteString("Packet capture failed — no capture method available.\n\n")
	diag.WriteString("• Raw socket: requires Administrator privileges\n")

	if _, err := exec.LookPath("dumpcap"); err == nil {
		diag.WriteString("• dumpcap: found but failed to start\n")
	} else {
		diag.WriteString("• dumpcap: not found (install Wireshark with Npcap)\n")
	}

	diag.WriteString("\nTo fix, choose one:\n")
	diag.WriteString("  1. Install Wireshark + Npcap (recommended)\n")
	diag.WriteString("  2. Run the agent as Administrator\n")
	return diag.String()
}

func getLocalIPForBind() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "0.0.0.0"
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return ipnet.IP.String()
		}
	}
	return "0.0.0.0"
}

func portServiceWin(src, dst uint16) string {
	ports := map[uint16]string{22: "SSH", 53: "DNS", 80: "HTTP", 443: "HTTPS", 5060: "SIP"}
	if s, ok := ports[src]; ok {
		return s
	}
	if s, ok := ports[dst]; ok {
		return s
	}
	return fmt.Sprintf("%d→%d", src, dst)
}
