//go:build windows

package main

import (
	"encoding/binary"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	iphlpapi     = windows.NewLazySystemDLL("iphlpapi.dll")
	procSendARP  = iphlpapi.NewProc("SendARP")
)

var deviceScanProbePorts = []uint16{22, 80, 443, 5060}

func RunDeviceScan(p DeviceScanParams) (*DeviceScanResult, error) {
	network := "192.168.1.0/24"
	if p.Network != nil && *p.Network != "" {
		network = *p.Network
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
	if len(ips) > 254 {
		ips = ips[1 : len(ips)-1]
	}

	// SendARP for each IP
	seen := make(map[string]string)
	for _, tip := range ips {
		destIP := ipToUint32(tip.To4())
		if destIP == 0 {
			continue
		}
		var mac [8]byte
		macLen := uint32(len(mac))
		r1, _, _ := procSendARP.Call(uintptr(destIP), 0, uintptr(unsafe.Pointer(&mac[0])), uintptr(unsafe.Pointer(&macLen)))
		if r1 == 0 && macLen >= 6 {
			macStr := net.HardwareAddr(mac[:6]).String()
			seen[tip.String()] = macStr
		}
	}

	// Supplement with "arp -a" output (catches entries from recent traffic)
	arpMap := parseArpA()
	for ipStr, macStr := range arpMap {
		if _, ok := seen[ipStr]; !ok {
			seen[ipStr] = macStr
		}
	}

	devices := make([]DiscoveredDevice, 0, len(seen))
	for ipStr, macStr := range seen {
		openPorts := probeOpenPorts(ipStr, deviceScanProbePorts, 2*time.Second)
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

func ipToUint32(ip net.IP) uint32 {
	if ip == nil || len(ip) < 4 {
		return 0
	}
	return binary.BigEndian.Uint32(ip.To4())
}

func parseArpA() map[string]string {
	out := make(map[string]string)
	cmd := exec.Command("arp", "-a")
	data, err := cmd.Output()
	if err != nil {
		return out
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		ipStr := strings.Trim(fields[0], "()")
		if net.ParseIP(ipStr) == nil {
			continue
		}
		macStr := strings.ReplaceAll(fields[1], "-", ":")
		if len(macStr) >= 17 {
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

func grabBanner(host string, port uint16) *string {
	addr := net.JoinHostPort(host, strconv.Itoa(int(port)))
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
