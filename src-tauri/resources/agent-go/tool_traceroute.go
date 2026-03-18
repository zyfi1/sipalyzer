package main

import (
	"fmt"
	"net"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

const traceroutePort = 33434

func RunTraceroute(p TracerouteParams) (*TracerouteResult, error) {
	if p.Host == "" {
		return nil, fmt.Errorf("host is required")
	}
	if p.MaxHops == 0 {
		p.MaxHops = 30
	}
	if p.TimeoutMs == 0 {
		p.TimeoutMs = 5000
	}
	timeout := time.Duration(p.TimeoutMs) * time.Millisecond

	destIP, err := net.ResolveIPAddr("ip4", p.Host)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", p.Host, err)
	}
	dest := destIP.IP.To4()
	if dest == nil {
		return nil, fmt.Errorf("IPv6 traceroute not implemented")
	}
	resolvedIP := destIP.String()

	// Listen for ICMP time exceeded / port unreachable.
	// Raw ICMP requires root/CAP_NET_RAW; fall back to system traceroute if unavailable.
	conn, err := icmp.ListenPacket("ip4:icmp", "0.0.0.0")
	if err != nil {
		return runTracerouteSystem(p)
	}
	defer conn.Close()

	var hops []TracerouteHop
	reached := false

	for ttl := uint8(1); ttl <= p.MaxHops && !reached; ttl++ {
		hop := TracerouteHop{TTL: ttl}
		start := time.Now()

		// Create UDP socket and set TTL (new socket per TTL to avoid async TTL on macOS)
		fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_DGRAM, syscall.IPPROTO_UDP)
		if err != nil {
			hop.Addr = strPtr("")
			hop.RttMs = float64Ptr(0)
			hops = append(hops, hop)
			continue
		}

		err = syscall.SetsockoptInt(fd, syscall.IPPROTO_IP, syscall.IP_TTL, int(ttl))
		if err != nil {
			syscall.Close(fd)
			hop.Addr = strPtr("")
			hops = append(hops, hop)
			continue
		}

		destSock := syscall.SockaddrInet4{Port: traceroutePort, Addr: [4]byte{dest[0], dest[1], dest[2], dest[3]}}
		payload := []byte{0}
		_ = syscall.Sendto(fd, payload, 0, &destSock)
		syscall.Close(fd)

		// Wait for ICMP reply
		conn.SetReadDeadline(time.Now().Add(timeout))
		replyBuf := make([]byte, 1500)
		n, replyFrom, recvErr := conn.ReadFrom(replyBuf)
		rtt := float64(time.Since(start).Milliseconds())
		hop.RttMs = &rtt

		if recvErr != nil {
			hop.Addr = strPtr("*")
			hops = append(hops, hop)
			time.Sleep(10 * time.Millisecond)
			continue
		}

		msg, err := icmp.ParseMessage(1, replyBuf[:n])
		if err != nil {
			hop.Addr = strPtr("*")
			hops = append(hops, hop)
			continue
		}

		var fromIP string
		if a, ok := replyFrom.(*net.IPAddr); ok {
			fromIP = a.IP.String()
		} else {
			fromIP = replyFrom.String()
		}
		hop.Addr = &fromIP

		switch msg.Type {
		case ipv4.ICMPTypeTimeExceeded:
			// Router along the path
			hostname, _ := net.LookupAddr(fromIP)
			if len(hostname) > 0 {
				hop.Hostname = &hostname[0]
			}
			hops = append(hops, hop)
		case ipv4.ICMPTypeDestinationUnreachable:
			// Reached destination (port unreachable)
			hostname, _ := net.LookupAddr(fromIP)
			if len(hostname) > 0 {
				hop.Hostname = &hostname[0]
			}
			hops = append(hops, hop)
			reached = true
		default:
			hops = append(hops, hop)
		}
		time.Sleep(10 * time.Millisecond)
	}

	return &TracerouteResult{
		Host:       p.Host,
		ResolvedIP: resolvedIP,
		Hops:       hops,
	}, nil
}

// runTracerouteSystem uses the system traceroute/tracert command as a fallback
// when raw ICMP sockets are not available (no root/CAP_NET_RAW).
func runTracerouteSystem(p TracerouteParams) (*TracerouteResult, error) {
	resolvedIP := ""
	if destIP, err := net.ResolveIPAddr("ip4", p.Host); err == nil {
		resolvedIP = destIP.String()
	}

	maxHops := fmt.Sprintf("%d", p.MaxHops)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("tracert", "-d", "-h", maxHops, "-w", "2000", p.Host)
	default:
		cmd = exec.Command("traceroute", "-n", "-q", "1", "-m", maxHops, "-w", "2", p.Host)
	}

	output, err := cmd.CombinedOutput()
	if err != nil && len(output) == 0 {
		// On Linux, try tracepath as a last resort (doesn't need root)
		if runtime.GOOS == "linux" {
			cmd = exec.Command("tracepath", "-n", "-m", maxHops, p.Host)
			output, err = cmd.CombinedOutput()
		}
		if len(output) == 0 {
			return nil, fmt.Errorf("traceroute requires elevated privileges and no system traceroute is available: %w", err)
		}
	}

	hops := parseTracerouteOutput(string(output))
	return &TracerouteResult{
		Host:       p.Host,
		ResolvedIP: resolvedIP,
		Hops:       hops,
	}, nil
}

var tracerouteLineRe = regexp.MustCompile(`^\s*(\d+)\s+(.+)`)

func parseTracerouteOutput(output string) []TracerouteHop {
	var hops []TracerouteHop
	for _, line := range strings.Split(output, "\n") {
		m := tracerouteLineRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		ttl, err := strconv.ParseUint(m[1], 10, 8)
		if err != nil {
			continue
		}
		rest := strings.TrimSpace(m[2])
		hop := TracerouteHop{TTL: uint8(ttl)}

		if strings.HasPrefix(rest, "*") {
			star := "*"
			hop.Addr = &star
		} else {
			fields := strings.Fields(rest)
			if len(fields) >= 1 {
				addr := fields[0]
				hop.Addr = &addr
			}
			// Look for RTT value: a number followed by "ms"
			for i, f := range fields {
				if i+1 < len(fields) && fields[i+1] == "ms" {
					if rtt, err := strconv.ParseFloat(f, 64); err == nil {
						hop.RttMs = &rtt
						break
					}
				}
				if strings.HasSuffix(f, "ms") {
					if rtt, err := strconv.ParseFloat(strings.TrimSuffix(f, "ms"), 64); err == nil {
						hop.RttMs = &rtt
						break
					}
				}
			}
			// Reverse DNS
			if hop.Addr != nil && *hop.Addr != "*" {
				if names, err := net.LookupAddr(*hop.Addr); err == nil && len(names) > 0 {
					name := strings.TrimSuffix(names[0], ".")
					hop.Hostname = &name
				}
			}
		}
		hops = append(hops, hop)
	}
	return hops
}

func float64Ptr(f float64) *float64 { return &f }
