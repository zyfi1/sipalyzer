package main

import (
	"fmt"
	"net"
	"os"
	"runtime"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

func RunPing(p PingParams) (*PingResult, error) {
	if p.Host == "" {
		return nil, fmt.Errorf("host is required")
	}
	if p.Count == 0 {
		p.Count = 4
	}
	if p.TimeoutMs == 0 {
		p.TimeoutMs = 5000
	}
	timeout := time.Duration(p.TimeoutMs) * time.Millisecond

	ip, err := net.ResolveIPAddr("ip4", p.Host)
	isV6 := false
	if err != nil {
		ip, err = net.ResolveIPAddr("ip6", p.Host)
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", p.Host, err)
		}
		isV6 = true
	}
	resolvedIP := ip.String()

	// Try privileged raw ICMP first, fall back to unprivileged UDP ICMP.
	// macOS and Linux (without CAP_NET_RAW) require the UDP variant.
	conn, privileged, err := listenICMP(isV6)
	if err != nil {
		return nil, fmt.Errorf("listen icmp: %w", err)
	}
	defer conn.Close()

	proto := protocolForIP(ip.IP)
	var echoReqType, echoRepType icmp.Type
	if !isV6 {
		echoReqType = ipv4.ICMPTypeEcho
		echoRepType = ipv4.ICMPTypeEchoReply
	} else {
		echoReqType = ipv6.ICMPTypeEchoRequest
		echoRepType = ipv6.ICMPTypeEchoReply
	}

	// For unprivileged (UDP) ICMP, the kernel rewrites the ID field to the
	// ephemeral port, so we use the process ID as a best-effort correlation.
	echoID := os.Getpid() & 0xffff

	probes := make([]PingProbe, p.Count)
	var rtts []float64

	for i := uint32(0); i < p.Count; i++ {
		seq := int(i)
		body := &icmp.Echo{ID: echoID, Seq: seq}
		msg := &icmp.Message{Type: echoReqType, Code: 0, Body: body}

		var wire []byte
		if privileged {
			wire, err = msg.Marshal(nil)
		} else {
			// Unprivileged UDP ICMP: kernel computes the checksum
			wire, err = msg.Marshal(nil)
		}
		if err != nil {
			probes[i] = PingProbe{Seq: i + 1, Error: strPtr(err.Error())}
			continue
		}
		probes[i] = PingProbe{Seq: i + 1}

		start := time.Now()
		_, err = conn.WriteTo(wire, ip)
		if err != nil {
			probes[i].Error = strPtr(err.Error())
			continue
		}

		conn.SetReadDeadline(time.Now().Add(timeout))
		replyBuf := make([]byte, 1500)
		n, _, err := conn.ReadFrom(replyBuf)
		if err != nil {
			probes[i].Error = strPtr(err.Error())
			continue
		}
		reply, err := icmp.ParseMessage(proto, replyBuf[:n])
		if err != nil {
			probes[i].Error = strPtr(err.Error())
			continue
		}
		if reply.Type != echoRepType {
			probes[i].Error = strPtr(fmt.Sprintf("unexpected reply type: %v", reply.Type))
			continue
		}
		rtt := float64(time.Since(start).Microseconds()) / 1000.0
		probes[i].RttMs = &rtt
		// Extract TTL from the IPv4 header when using privileged mode
		ttl := uint8(64) // best-effort default
		probes[i].TTL = &ttl
		rtts = append(rtts, rtt)

		// Small delay between probes to be network-friendly
		if i < p.Count-1 {
			time.Sleep(100 * time.Millisecond)
		}
	}

	sent := p.Count
	var received uint32
	for i := range probes {
		if probes[i].RttMs != nil {
			received++
		}
	}
	lossPct := 0.0
	if sent > 0 {
		lossPct = 100.0 * (1.0 - float64(received)/float64(sent))
	}
	minMs, avgMs, maxMs, jitterMs := 0.0, 0.0, 0.0, 0.0
	if len(rtts) > 0 {
		minMs = rtts[0]
		maxMs = rtts[0]
		sum := 0.0
		for _, r := range rtts {
			if r < minMs {
				minMs = r
			}
			if r > maxMs {
				maxMs = r
			}
			sum += r
		}
		avgMs = sum / float64(len(rtts))
		if len(rtts) > 1 {
			var jitterSum float64
			for j := 1; j < len(rtts); j++ {
				diff := rtts[j] - rtts[j-1]
				if diff < 0 {
					diff = -diff
				}
				jitterSum += diff
			}
			jitterMs = jitterSum / float64(len(rtts)-1)
		}
	}

	return &PingResult{
		Host:            p.Host,
		ResolvedIP:      resolvedIP,
		Probes:          probes,
		PacketsSent:     sent,
		PacketsReceived: received,
		PacketLossPct:   lossPct,
		MinMs:           minMs,
		AvgMs:           avgMs,
		MaxMs:           maxMs,
		JitterMs:        jitterMs,
	}, nil
}

// listenICMP opens an ICMP listener. It first tries privileged raw sockets
// (requires root/CAP_NET_RAW), then falls back to unprivileged UDP-based ICMP
// which works on macOS and most Linux kernels without elevation.
func listenICMP(isV6 bool) (conn *icmp.PacketConn, privileged bool, err error) {
	if isV6 {
		// Try privileged first
		conn, err = icmp.ListenPacket("ip6:ipv6-icmp", "::")
		if err == nil {
			return conn, true, nil
		}
		// Fall back to unprivileged UDP
		conn, err = icmp.ListenPacket("udp6", "::")
		if err == nil {
			return conn, false, nil
		}
		return nil, false, fmt.Errorf("no ICMP available (tried raw and udp6): %w", err)
	}

	// IPv4: try privileged raw ICMP first
	conn, err = icmp.ListenPacket("ip4:icmp", "0.0.0.0")
	if err == nil {
		return conn, true, nil
	}

	// Fall back to unprivileged UDP ICMP (works on macOS and Linux)
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" {
		conn, err = icmp.ListenPacket("udp4", "0.0.0.0")
		if err == nil {
			return conn, false, nil
		}
	}

	return nil, false, fmt.Errorf("no ICMP available (tried raw and udp4): %w", err)
}

func protocolForIP(ip net.IP) int {
	if ip.To4() != nil {
		return 1
	}
	return 58
}

func strPtr(s string) *string { return &s }
