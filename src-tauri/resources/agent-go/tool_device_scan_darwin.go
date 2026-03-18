//go:build darwin

package main

import (
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

var deviceScanProbePorts = []uint16{22, 80, 443, 5060, 8080, 8443}

func RunDeviceScan(p DeviceScanParams) (*DeviceScanResult, error) {
	network := ""
	if p.Network != nil && *p.Network != "" {
		network = *p.Network
	}
	if network == "" {
		network = detectLocalNetwork()
	}
	if network == "" {
		network = "192.168.1.0/24"
	}
	ip, ipNet, err := net.ParseCIDR(network)
	if err != nil {
		return nil, err
	}
	var ips []net.IP
	for ip := ip.Mask(ipNet.Mask); ipNet.Contains(ip); incIP(ip) {
		dup := make(net.IP, len(ip))
		copy(dup, ip)
		ips = append(ips, dup)
	}
	if len(ips) > 2 {
		ips = ips[1 : len(ips)-1] // skip network + broadcast
	}

	// Phase 1: Parallel ping sweep to populate ARP cache (no root needed)
	pingSweep(ips)

	// Phase 2: Read the ARP table via `arp -a` (no root needed)
	seen := parseArpTable()

	// Filter to only IPs in our target subnet
	filtered := make(map[string]string)
	for ipStr, macStr := range seen {
		pip := net.ParseIP(ipStr)
		if pip != nil && ipNet.Contains(pip) {
			filtered[ipStr] = macStr
		}
	}

	// Phase 3: TCP port probes + reverse DNS for each discovered device
	devices := make([]DiscoveredDevice, 0, len(filtered))
	for ipStr, macStr := range filtered {
		openPorts := probeOpenPorts(ipStr, deviceScanProbePorts, 1500*time.Millisecond)
		hostname := reverseLookup(ipStr)
		dev := DiscoveredDevice{
			IP:        ipStr,
			MAC:       &macStr,
			Hostname:  hostname,
			OpenPorts: openPorts,
		}
		if p.BannerGrab && len(openPorts) > 0 {
			dev.Banner = grabBanner(ipStr, openPorts[0])
		}
		devices = append(devices, dev)
	}
	return &DeviceScanResult{Network: network, Devices: devices}, nil
}

// pingSweep pings all IPs concurrently to populate the kernel ARP cache.
// Uses the `ping` command which works without root on macOS.
func pingSweep(ips []net.IP) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, 50) // limit concurrency

	for _, ip := range ips {
		wg.Add(1)
		sem <- struct{}{}
		go func(target string) {
			defer wg.Done()
			defer func() { <-sem }()
			// Single ping, 500ms timeout — we only care about populating ARP
			exec.Command("ping", "-c", "1", "-W", "500", "-t", "1", target).Run()
		}(ip.String())
	}
	wg.Wait()
}

// parseArpTable reads the macOS ARP cache via `arp -a`.
// Output format: "? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]"
func parseArpTable() map[string]string {
	out := make(map[string]string)
	data, err := exec.Command("arp", "-a").Output()
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Extract IP from parentheses
		lparen := strings.Index(line, "(")
		rparen := strings.Index(line, ")")
		if lparen < 0 || rparen < 0 || rparen <= lparen+1 {
			continue
		}
		ipStr := line[lparen+1 : rparen]
		if net.ParseIP(ipStr) == nil {
			continue
		}
		// Extract MAC after " at "
		atIdx := strings.Index(line, " at ")
		if atIdx < 0 {
			continue
		}
		rest := line[atIdx+4:]
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		macStr := fields[0]
		// Skip incomplete entries
		if macStr == "(incomplete)" || macStr == "ff:ff:ff:ff:ff:ff" {
			continue
		}
		// Normalize MAC (macOS uses : already, but ensure lowercase)
		macStr = strings.ToLower(macStr)
		if len(macStr) >= 11 { // at least aa:bb:cc:dd:ee:ff minus some
			out[ipStr] = macStr
		}
	}
	return out
}

func incIP(ip net.IP) {
	for j := len(ip) - 1; j >= 0; j-- {
		ip[j]++
		if ip[j] != 0 {
			break
		}
	}
}

func probeOpenPorts(host string, ports []uint16, timeout time.Duration) []uint16 {
	var open []uint16
	for _, port := range ports {
		addr := net.JoinHostPort(host, strconv.Itoa(int(port)))
		conn, err := net.DialTimeout("tcp", addr, timeout)
		if err != nil {
			continue
		}
		_ = conn.Close()
		open = append(open, port)
	}
	return open
}

func reverseLookup(ip string) *string {
	names, err := net.LookupAddr(ip)
	if err != nil || len(names) == 0 {
		return nil
	}
	s := strings.TrimSuffix(names[0], ".")
	return &s
}

// detectLocalNetwork finds the primary local network CIDR by inspecting interfaces.
func detectLocalNetwork() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok && ipnet.IP.To4() != nil && !ipnet.IP.IsLoopback() {
				// Compute the network address
				networkIP := ipnet.IP.Mask(ipnet.Mask)
				ones, bits := ipnet.Mask.Size()
				if ones == 0 || bits == 0 {
					continue
				}
				return fmt.Sprintf("%s/%d", networkIP.String(), ones)
			}
		}
	}
	return ""
}

func grabBanner(host string, port uint16) *string {
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return nil
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 256)
	n, _ := conn.Read(buf)
	if n > 0 {
		s := strings.TrimSpace(string(buf[:n]))
		if len(s) > 128 {
			s = s[:128]
		}
		return &s
	}
	return nil
}
