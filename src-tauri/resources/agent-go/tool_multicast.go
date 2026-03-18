package main

import (
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"golang.org/x/net/ipv4"
)

func RunMulticastJoin(p MulticastJoinParams) (*MulticastJoinResult, error) {
	if p.Group == "" {
		return nil, fmt.Errorf("group is required")
	}
	if p.Port == 0 {
		return nil, fmt.Errorf("port is required")
	}

	groupAddr := net.ParseIP(p.Group)
	if groupAddr == nil {
		return nil, fmt.Errorf("invalid multicast group: %s", p.Group)
	}
	if !groupAddr.IsMulticast() {
		return nil, fmt.Errorf("address %s is not a multicast group", p.Group)
	}

	var iface *net.Interface
	if p.Interface != nil && *p.Interface != "" {
		var err error
		iface, err = net.InterfaceByName(*p.Interface)
		if err != nil {
			return nil, fmt.Errorf("interface %s: %w", *p.Interface, err)
		}
	}

	conn, err := net.ListenPacket("udp4", fmt.Sprintf("0.0.0.0:%d", p.Port))
	if err != nil {
		return nil, fmt.Errorf("listen udp4: %w", err)
	}
	defer conn.Close()

	pc := ipv4.NewPacketConn(conn)
	group := &net.UDPAddr{IP: groupAddr, Port: p.Port}

	if err := pc.JoinGroup(iface, group); err != nil {
		errMsg := err.Error()
		return &MulticastJoinResult{Success: false, Group: p.Group, Error: &errMsg}, nil
	}
	defer pc.LeaveGroup(iface, group)

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 1500)
	_, _, _ = conn.ReadFrom(buf)

	return &MulticastJoinResult{Success: true, Group: p.Group}, nil
}

func RunMulticastIgmpQuery(p MulticastIgmpQueryParams) (*MulticastIgmpQueryResult, error) {
	var iface *net.Interface
	if p.Interface != nil && *p.Interface != "" {
		var err error
		iface, err = net.InterfaceByName(*p.Interface)
		if err != nil {
			return nil, fmt.Errorf("interface %s: %w", *p.Interface, err)
		}
	}

	if iface == nil {
		ifaces, err := net.Interfaces()
		if err != nil {
			return nil, fmt.Errorf("list interfaces: %w", err)
		}
		for i := range ifaces {
			f := ifaces[i].Flags
			if f&net.FlagUp != 0 && f&net.FlagMulticast != 0 && f&net.FlagLoopback == 0 {
				iface = &ifaces[i]
				break
			}
		}
		if iface == nil {
			return nil, fmt.Errorf("no suitable multicast interface found")
		}
	}

	conn, err := net.ListenPacket("udp4", "0.0.0.0:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}
	defer conn.Close()

	pc := ipv4.NewPacketConn(conn)

	allHosts := &net.UDPAddr{IP: net.IPv4(224, 0, 0, 1)}
	if err := pc.JoinGroup(iface, allHosts); err != nil {
		return nil, fmt.Errorf("join all-hosts: %w", err)
	}
	defer pc.LeaveGroup(iface, allHosts)

	start := time.Now()

	query := make([]byte, 8)
	query[0] = 0x11 // Membership Query
	query[1] = 100  // Max Response Time (10s in 1/10s units)
	dst := &net.UDPAddr{IP: net.IPv4(224, 0, 0, 1)}
	if _, err := pc.WriteTo(query, nil, dst); err != nil {
		return nil, fmt.Errorf("send query: %w", err)
	}

	groups := make(map[string]IgmpGroupEntry)
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 1500)
	for {
		n, src, err := conn.ReadFrom(buf)
		if err != nil {
			break
		}
		if n < 8 {
			continue
		}
		msgType := buf[0]
		if msgType == 0x16 || msgType == 0x22 { // V2 Report or V3 Report
			if n >= 8 {
				groupIP := net.IPv4(buf[4], buf[5], buf[6], buf[7])
				g := groupIP.String()
				if _, exists := groups[g]; !exists {
					reporter := ""
					if src != nil {
						reporter = src.String()
					}
					version := 2
					if msgType == 0x22 {
						version = 3
					}
					groups[g] = IgmpGroupEntry{
						Group:             g,
						LastReporter:      reporter,
						IgmpVersion:       version,
						CompatibilityMode: "v2",
					}
				}
			}
		}
	}

	queryTimeMs := uint64(time.Since(start).Milliseconds())

	found := make([]IgmpGroupEntry, 0, len(groups))
	for _, g := range groups {
		found = append(found, g)
	}

	igmpVersion := 2
	if len(found) > 0 {
		for _, g := range found {
			if g.IgmpVersion > igmpVersion {
				igmpVersion = g.IgmpVersion
			}
		}
	}

	return &MulticastIgmpQueryResult{
		GroupsFound: found,
		IgmpVersion: igmpVersion,
		QueryTimeMs: queryTimeMs,
		Responders:  len(found),
	}, nil
}

func RunMulticastSnoopingVerify(p MulticastSnoopingVerifyParams) (*MulticastSnoopingVerifyResult, error) {
	if p.Group == "" {
		return nil, fmt.Errorf("group is required")
	}

	groupAddr := net.ParseIP(p.Group)
	if groupAddr == nil {
		return nil, fmt.Errorf("invalid multicast group: %s", p.Group)
	}
	if !groupAddr.IsMulticast() {
		return nil, fmt.Errorf("address %s is not a multicast group", p.Group)
	}

	var iface *net.Interface
	if p.Interface != nil && *p.Interface != "" {
		var err error
		iface, err = net.InterfaceByName(*p.Interface)
		if err != nil {
			return nil, fmt.Errorf("interface %s: %w", *p.Interface, err)
		}
	}

	details := []string{}

	conn, err := net.ListenPacket("udp4", "0.0.0.0:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}
	defer conn.Close()

	pc := ipv4.NewPacketConn(conn)
	group := &net.UDPAddr{IP: groupAddr}

	joinStart := time.Now()
	if err := pc.JoinGroup(iface, group); err != nil {
		return nil, fmt.Errorf("join group: %w", err)
	}
	joinLatency := float64(time.Since(joinStart).Microseconds()) / 1000.0
	details = append(details, fmt.Sprintf("join completed in %.2fms", joinLatency))

	ttlCheck := false
	if err := pc.SetMulticastTTL(1); err == nil {
		ttlCheck = true
		details = append(details, "TTL control available")
	} else {
		details = append(details, fmt.Sprintf("TTL control failed: %v", err))
	}

	if err := pc.LeaveGroup(iface, group); err != nil {
		details = append(details, fmt.Sprintf("leave failed: %v", err))
		return &MulticastSnoopingVerifyResult{
			Group:          p.Group,
			SnoopingActive: false,
			JoinLatencyMs:  joinLatency,
			LeaveVerified:  false,
			TTLCheck:       ttlCheck,
			Details:        details,
		}, nil
	}
	details = append(details, "leave completed successfully")

	snoopingActive := joinLatency < 500
	if snoopingActive {
		details = append(details, "snooping appears active (fast join/leave)")
	} else {
		details = append(details, "snooping may be inactive (slow join latency)")
	}

	return &MulticastSnoopingVerifyResult{
		Group:          p.Group,
		SnoopingActive: snoopingActive,
		JoinLatencyMs:  joinLatency,
		LeaveVerified:  true,
		TTLCheck:       ttlCheck,
		Details:        details,
	}, nil
}

func RunMulticastSendTest(p MulticastSendTestParams) (*MulticastSendTestResult, error) {
	if p.Group == "" {
		return nil, fmt.Errorf("group is required")
	}
	if p.Port == 0 {
		return nil, fmt.Errorf("port is required")
	}
	if p.Count == 0 {
		p.Count = 10
	}
	if p.IntervalMs == 0 {
		p.IntervalMs = 100
	}
	if p.TTL == 0 {
		p.TTL = 5
	}

	groupAddr := net.ParseIP(p.Group)
	if groupAddr == nil {
		return nil, fmt.Errorf("invalid multicast group: %s", p.Group)
	}
	if !groupAddr.IsMulticast() {
		return nil, fmt.Errorf("address %s is not a multicast group", p.Group)
	}

	conn, err := net.ListenPacket("udp4", "0.0.0.0:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}
	defer conn.Close()

	pc := ipv4.NewPacketConn(conn)
	if err := pc.SetMulticastTTL(p.TTL); err != nil {
		errMsg := fmt.Sprintf("set TTL: %v", err)
		return &MulticastSendTestResult{Success: false, Group: p.Group, Error: &errMsg}, nil
	}

	dst := &net.UDPAddr{IP: groupAddr, Port: p.Port}
	payload := []byte("SIPalyzer multicast test")
	sent := 0
	start := time.Now()

	for i := 0; i < p.Count; i++ {
		if _, err := pc.WriteTo(payload, nil, dst); err != nil {
			errMsg := fmt.Sprintf("send packet %d: %v", i+1, err)
			return &MulticastSendTestResult{
				Success:   false,
				Group:     p.Group,
				Sent:      sent,
				ElapsedMs: uint64(time.Since(start).Milliseconds()),
				Error:     &errMsg,
			}, nil
		}
		sent++
		if i < p.Count-1 {
			time.Sleep(time.Duration(p.IntervalMs) * time.Millisecond)
		}
	}

	return &MulticastSendTestResult{
		Success:   true,
		Group:     p.Group,
		Sent:      sent,
		ElapsedMs: uint64(time.Since(start).Milliseconds()),
	}, nil
}

// ── Schedule ────────────────────────────────────────────────────────────

var (
	currentSchedule   []ScheduleEntry
	currentScheduleMu sync.Mutex
)

func RunUpdateSchedule(p UpdateScheduleParams) (*UpdateScheduleResult, error) {
	entries := p.Entries
	if len(entries) == 0 && len(p.Schedule) > 0 {
		// Backward compatibility: convert legacy schedule windows into entries.
		entries = make([]ScheduleEntry, 0, len(p.Schedule))
		for _, window := range p.Schedule {
			paramBytes, _ := json.Marshal(map[string]interface{}{
				"days":       window.Days,
				"start_time": window.StartTime,
				"end_time":   window.EndTime,
			})
			entries = append(entries, ScheduleEntry{
				Command:    "Window",
				Params:     json.RawMessage(paramBytes),
				IntervalMs: 60000,
				Enabled:    true,
			})
		}
	}

	currentScheduleMu.Lock()
	defer currentScheduleMu.Unlock()

	currentSchedule = entries

	active := 0
	for _, e := range entries {
		if e.Enabled {
			active++
		}
	}

	return &UpdateScheduleResult{
		Accepted: len(entries),
		Active:   active,
	}, nil
}
