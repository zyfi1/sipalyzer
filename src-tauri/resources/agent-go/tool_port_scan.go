package main

import (
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxConcurrent = 100

func commonServiceByPort(port uint16, proto string) string {
	tcp := map[uint16]string{
		20: "ftp-data", 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp",
		53: "dns", 80: "http", 110: "pop3", 143: "imap", 443: "https",
		465: "smtps", 587: "submission", 993: "imaps", 995: "pop3s",
		3306: "mysql", 3389: "rdp", 5432: "postgresql", 5060: "sip",
		5061: "sips", 5222: "xmpp", 5269: "xmpp-server", 6379: "redis",
		8080: "http-proxy", 8443: "https-alt", 27017: "mongodb",
	}
	udp := map[uint16]string{
		53: "dns", 67: "dhcp-server", 68: "dhcp-client", 69: "tftp",
		123: "ntp", 161: "snmp", 162: "snmp-trap", 500: "isakmp",
		514: "syslog", 520: "rip", 1194: "openvpn", 1900: "ssdp/upnp",
		4500: "ipsec-nat", 5060: "sip", 5353: "mdns", 5004: "rtp",
		5005: "rtcp", 10000: "ndmp",
	}
	if proto == "udp" {
		if s, ok := udp[port]; ok {
			return s
		}
	}
	if s, ok := tcp[port]; ok {
		return s
	}
	return ""
}

func parsePorts(s string) ([]uint16, error) {
	if s == "" {
		return nil, fmt.Errorf("ports string is empty")
	}
	var out []uint16
	seen := make(map[uint16]bool)
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "-") {
			ab := strings.SplitN(part, "-", 2)
			lo, err := strconv.ParseUint(strings.TrimSpace(ab[0]), 10, 16)
			if err != nil {
				return nil, fmt.Errorf("invalid port range %q: %w", part, err)
			}
			hi, err := strconv.ParseUint(strings.TrimSpace(ab[1]), 10, 16)
			if err != nil {
				return nil, fmt.Errorf("invalid port range %q: %w", part, err)
			}
			if lo > hi {
				lo, hi = hi, lo
			}
			if hi-lo > 10000 {
				return nil, fmt.Errorf("port range %q too large (max 10000 ports per range)", part)
			}
			for p := lo; p <= hi; p++ {
				port := uint16(p)
				if !seen[port] {
					seen[port] = true
					out = append(out, port)
				}
			}
		} else {
			p, err := strconv.ParseUint(part, 10, 16)
			if err != nil {
				return nil, fmt.Errorf("invalid port %q: %w", part, err)
			}
			port := uint16(p)
			if !seen[port] {
				seen[port] = true
				out = append(out, port)
			}
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no ports parsed from %q", s)
	}
	return out, nil
}

func RunPortScan(p PortScanParams) (*PortScanResult, error) {
	if p.Host == "" {
		return nil, fmt.Errorf("host is required")
	}
	if p.Ports == "" {
		return nil, fmt.Errorf("ports is required")
	}
	if p.TimeoutMs == 0 {
		p.TimeoutMs = 3000
	}
	transport := strings.ToLower(strings.TrimSpace(p.Transport))
	if transport == "" {
		transport = "tcp"
	}
	if transport != "tcp" && transport != "udp" && transport != "both" {
		return nil, fmt.Errorf("invalid transport %q; must be tcp, udp, or both", transport)
	}
	timeout := time.Duration(p.TimeoutMs) * time.Millisecond

	ports, err := parsePorts(p.Ports)
	if err != nil {
		return nil, err
	}

	start := time.Now()

	var (
		openPorts     []PortInfo
		openMu        sync.Mutex
		closedCount   uint32
		filteredCount uint32
		closedMu      sync.Mutex
		filteredMu    sync.Mutex
	)
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup

	protos := []string{}
	if transport == "tcp" || transport == "both" {
		protos = append(protos, "tcp")
	}
	if transport == "udp" || transport == "both" {
		protos = append(protos, "udp")
	}

	totalScanned := len(ports) * len(protos)

	for _, proto := range protos {
		for _, port := range ports {
			wg.Add(1)
			sem <- struct{}{}
			go func(port uint16, proto string) {
				defer wg.Done()
				defer func() { <-sem }()

				addr := net.JoinHostPort(p.Host, strconv.Itoa(int(port)))

				if proto == "tcp" {
					scanTCP(addr, port, timeout, &openPorts, &openMu, &closedCount, &closedMu, &filteredCount, &filteredMu)
				} else {
					scanUDP(addr, port, timeout, &openPorts, &openMu, &closedCount, &closedMu, &filteredCount, &filteredMu)
				}
			}(port, proto)
		}
	}
	wg.Wait()

	sort.Slice(openPorts, func(i, j int) bool {
		if openPorts[i].Port != openPorts[j].Port {
			return openPorts[i].Port < openPorts[j].Port
		}
		return openPorts[i].Transport < openPorts[j].Transport
	})

	elapsed := uint64(time.Since(start).Milliseconds())

	return &PortScanResult{
		Host:          p.Host,
		Transport:     transport,
		OpenPorts:     openPorts,
		ClosedCount:   closedCount,
		FilteredCount: filteredCount,
		TotalScanned:  totalScanned,
		ElapsedMs:     elapsed,
	}, nil
}

func scanTCP(addr string, port uint16, timeout time.Duration,
	openPorts *[]PortInfo, openMu *sync.Mutex,
	closedCount *uint32, closedMu *sync.Mutex,
	filteredCount *uint32, filteredMu *sync.Mutex) {

	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		if isTimeout(err) || isRefused(err) {
			closedMu.Lock()
			*closedCount++
			closedMu.Unlock()
		} else {
			filteredMu.Lock()
			*filteredCount++
			filteredMu.Unlock()
		}
		return
	}

	banner := portScanGrabBanner(conn, 512*time.Millisecond)
	_ = conn.Close()

	svc := commonServiceByPort(port, "tcp")
	var svcPtr *string
	if svc != "" {
		svcPtr = &svc
	}

	openMu.Lock()
	*openPorts = append(*openPorts, PortInfo{
		Port:      port,
		State:     "open",
		Transport: "tcp",
		Service:   svcPtr,
		Banner:    banner,
	})
	openMu.Unlock()
}

func scanUDP(addr string, port uint16, timeout time.Duration,
	openPorts *[]PortInfo, openMu *sync.Mutex,
	closedCount *uint32, closedMu *sync.Mutex,
	filteredCount *uint32, filteredMu *sync.Mutex) {

	conn, err := net.DialTimeout("udp", addr, timeout)
	if err != nil {
		filteredMu.Lock()
		*filteredCount++
		filteredMu.Unlock()
		return
	}
	defer conn.Close()

	probe := buildUDPProbe(port)
	_ = conn.SetDeadline(time.Now().Add(timeout))
	_, _ = conn.Write(probe)

	buf := make([]byte, 1024)
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	n, err := conn.Read(buf)

	if err != nil {
		if isTimeout(err) {
			// No response: could be open|filtered -- report as open|filtered
			svc := commonServiceByPort(port, "udp")
			var svcPtr *string
			if svc != "" {
				svcPtr = &svc
			}
			openMu.Lock()
			*openPorts = append(*openPorts, PortInfo{
				Port:      port,
				State:     "open|filtered",
				Transport: "udp",
				Service:   svcPtr,
			})
			openMu.Unlock()
		} else {
			// ICMP unreachable = closed
			closedMu.Lock()
			*closedCount++
			closedMu.Unlock()
		}
		return
	}

	// Got a response: definitely open
	svc := commonServiceByPort(port, "udp")
	var svcPtr *string
	if svc != "" {
		svcPtr = &svc
	}
	var bannerPtr *string
	if n > 0 {
		b := strings.TrimSpace(string(buf[:n]))
		if b != "" && len(b) <= 200 {
			bannerPtr = &b
		}
	}
	openMu.Lock()
	*openPorts = append(*openPorts, PortInfo{
		Port:      port,
		State:     "open",
		Transport: "udp",
		Service:   svcPtr,
		Banner:    bannerPtr,
	})
	openMu.Unlock()
}

func buildUDPProbe(port uint16) []byte {
	switch port {
	case 53:
		// Minimal DNS query for "." (root) type A
		return []byte{
			0x00, 0x01, // ID
			0x01, 0x00, // Standard query
			0x00, 0x01, // 1 question
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00,       // root
			0x00, 0x01, // type A
			0x00, 0x01, // class IN
		}
	case 123:
		// NTP version request (client mode 3, version 3)
		b := make([]byte, 48)
		b[0] = 0x1B
		return b
	case 161:
		// SNMP v1 GET community=public
		return []byte{
			0x30, 0x26, 0x02, 0x01, 0x00, 0x04, 0x06, 0x70,
			0x75, 0x62, 0x6c, 0x69, 0x63, 0xa0, 0x19, 0x02,
			0x04, 0x00, 0x00, 0x00, 0x01, 0x02, 0x01, 0x00,
			0x02, 0x01, 0x00, 0x30, 0x0b, 0x30, 0x09, 0x06,
			0x05, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x05, 0x00,
		}
	case 5060:
		// SIP OPTIONS probe
		return []byte("OPTIONS sip:probe@localhost SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:5060\r\nCall-ID: probe\r\nCSeq: 1 OPTIONS\r\nContent-Length: 0\r\n\r\n")
	default:
		return []byte("\r\n")
	}
}

func portScanGrabBanner(conn net.Conn, timeout time.Duration) *string {
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	buf := make([]byte, 512)
	n, err := conn.Read(buf)
	if err != nil || n == 0 {
		return nil
	}
	s := strings.TrimSpace(string(buf[:n]))
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	var clean strings.Builder
	for _, r := range s {
		if r >= 32 && r < 127 || r == '\n' || r == '\r' || r == '\t' {
			clean.WriteRune(r)
		}
	}
	result := strings.TrimSpace(clean.String())
	if result == "" {
		return nil
	}
	return &result
}

func isTimeout(err error) bool {
	if ne, ok := err.(net.Error); ok {
		return ne.Timeout()
	}
	return false
}

func isRefused(err error) bool {
	return strings.Contains(err.Error(), "refused") || strings.Contains(err.Error(), "connection refused")
}
