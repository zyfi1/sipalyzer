package main

import (
	"encoding/binary"
	"fmt"
	"time"
)

// parsePacket extracts header info from a raw Ethernet frame or IP packet.
// ethernetFrame indicates whether the data starts with an Ethernet header.
func parsePacket(raw []byte, ethernetFrame bool) *PacketInfo {
	info := &PacketInfo{
		Timestamp: time.Now().Format("15:04:05.000000"),
		Length:    len(raw),
	}

	var ipPayload []byte
	if ethernetFrame {
		ipPayload = parseEthernetHeader(raw, info)
	} else {
		ipPayload = raw
	}

	if ipPayload == nil || len(ipPayload) == 0 {
		if info.Info == "" {
			info.Protocol = "RAW"
			info.Info = fmt.Sprintf("[%d bytes]", len(raw))
		}
		return info
	}

	// Parse IP header
	parseIPHeader(ipPayload, info)
	return info
}

func parseEthernetHeader(raw []byte, info *PacketInfo) []byte {
	if len(raw) < 14 {
		info.Protocol = "ETH"
		info.Info = fmt.Sprintf("[truncated frame, %d bytes]", len(raw))
		return nil
	}

	etherType := binary.BigEndian.Uint16(raw[12:14])
	payload := raw[14:]

	// Handle 802.1Q VLAN tag
	if etherType == 0x8100 && len(payload) >= 4 {
		etherType = binary.BigEndian.Uint16(payload[2:4])
		payload = payload[4:]
	}

	switch etherType {
	case 0x0800: // IPv4
		return payload
	case 0x86DD: // IPv6
		return payload
	case 0x0806: // ARP
		info.Protocol = "ARP"
		parseARP(payload, info)
		return nil
	default:
		info.Protocol = fmt.Sprintf("ETH:0x%04X", etherType)
		info.Info = fmt.Sprintf("[%d bytes]", len(raw))
		return nil
	}
}

func parseIPHeader(data []byte, info *PacketInfo) {
	if len(data) < 1 {
		return
	}

	version := data[0] >> 4
	switch version {
	case 4:
		parseIPv4(data, info)
	case 6:
		parseIPv6(data, info)
	default:
		info.Protocol = "IP?"
		info.Info = fmt.Sprintf("[unknown IP version %d, %d bytes]", version, len(data))
	}
}

func parseIPv4(data []byte, info *PacketInfo) {
	if len(data) < 20 {
		info.Protocol = "IPv4"
		info.Info = fmt.Sprintf("[truncated, %d bytes]", len(data))
		return
	}

	ihl := int(data[0]&0x0F) * 4
	if ihl < 20 || ihl > len(data) {
		info.Protocol = "IPv4"
		info.Info = fmt.Sprintf("[bad IHL=%d, %d bytes]", ihl, len(data))
		return
	}

	totalLen := int(binary.BigEndian.Uint16(data[2:4]))
	protocol := data[9]
	info.SrcIP = fmt.Sprintf("%d.%d.%d.%d", data[12], data[13], data[14], data[15])
	info.DstIP = fmt.Sprintf("%d.%d.%d.%d", data[16], data[17], data[18], data[19])
	info.Length = totalLen

	transportPayload := data[ihl:]
	parseTransport(protocol, transportPayload, info)
}

func parseIPv6(data []byte, info *PacketInfo) {
	if len(data) < 40 {
		info.Protocol = "IPv6"
		info.Info = fmt.Sprintf("[truncated, %d bytes]", len(data))
		return
	}

	nextHeader := data[6]
	payloadLen := int(binary.BigEndian.Uint16(data[4:6]))
	info.SrcIP = formatIPv6(data[8:24])
	info.DstIP = formatIPv6(data[24:40])
	info.Length = payloadLen + 40

	transportPayload := data[40:]
	parseTransport(nextHeader, transportPayload, info)
}

func parseTransport(protocol uint8, payload []byte, info *PacketInfo) {
	switch protocol {
	case 6: // TCP
		parseTCP(payload, info)
	case 17: // UDP
		parseUDP(payload, info)
	case 1: // ICMP
		parseICMP(payload, info)
	case 58: // ICMPv6
		parseICMPv6(payload, info)
	default:
		info.Protocol = fmt.Sprintf("IP/%d", protocol)
		info.Info = fmt.Sprintf("%s > %s [protocol %d, %d bytes]",
			info.SrcIP, info.DstIP, protocol, info.Length)
	}
}

func parseTCP(data []byte, info *PacketInfo) {
	info.Protocol = "TCP"
	if len(data) < 20 {
		info.Info = fmt.Sprintf("%s > %s TCP [truncated]", info.SrcIP, info.DstIP)
		return
	}

	srcPort := binary.BigEndian.Uint16(data[0:2])
	dstPort := binary.BigEndian.Uint16(data[2:4])
	info.SrcPort = &srcPort
	info.DstPort = &dstPort

	seq := binary.BigEndian.Uint32(data[4:8])
	flags := data[13]
	dataOffset := int(data[12]>>4) * 4
	payloadLen := len(data) - dataOffset
	if payloadLen < 0 {
		payloadLen = 0
	}

	flagStr := tcpFlagsString(flags)
	info.TCPFlags = &flagStr

	// Check for well-known ports to add service hints
	service := portService(srcPort, dstPort)

	info.Info = fmt.Sprintf("%s:%d > %s:%d [%s] Seq=%d Len=%d",
		info.SrcIP, srcPort, info.DstIP, dstPort, flagStr, seq, payloadLen)
	if service != "" {
		info.Info += " (" + service + ")"
	}
}

func parseUDP(data []byte, info *PacketInfo) {
	info.Protocol = "UDP"
	if len(data) < 8 {
		info.Info = fmt.Sprintf("%s > %s UDP [truncated]", info.SrcIP, info.DstIP)
		return
	}

	srcPort := binary.BigEndian.Uint16(data[0:2])
	dstPort := binary.BigEndian.Uint16(data[2:4])
	udpLen := binary.BigEndian.Uint16(data[4:6])
	info.SrcPort = &srcPort
	info.DstPort = &dstPort

	service := portService(srcPort, dstPort)

	// Check for SIP content
	if (srcPort == 5060 || dstPort == 5060 || srcPort == 5061 || dstPort == 5061) && len(data) > 8 {
		sipLine := extractFirstLine(data[8:])
		if sipLine != "" {
			info.Protocol = "SIP"
			info.Info = fmt.Sprintf("%s:%d > %s:%d %s",
				info.SrcIP, srcPort, info.DstIP, dstPort, sipLine)
			return
		}
	}

	// Check for DNS
	if srcPort == 53 || dstPort == 53 {
		info.Protocol = "DNS"
	}

	// Check for RTP (even port in range 10000-20000, starts with version 2)
	if len(data) > 8 && data[8]>>6 == 2 &&
		((srcPort >= 10000 && srcPort <= 20000) || (dstPort >= 10000 && dstPort <= 20000)) {
		info.Protocol = "RTP"
		pt := data[9] & 0x7F
		seqNum := binary.BigEndian.Uint16(data[10:12])
		info.Info = fmt.Sprintf("%s:%d > %s:%d RTP PT=%d Seq=%d Len=%d",
			info.SrcIP, srcPort, info.DstIP, dstPort, pt, seqNum, udpLen-8)
		return
	}

	info.Info = fmt.Sprintf("%s:%d > %s:%d UDP Len=%d",
		info.SrcIP, srcPort, info.DstIP, dstPort, udpLen-8)
	if service != "" {
		info.Info += " (" + service + ")"
	}
}

func parseICMP(data []byte, info *PacketInfo) {
	info.Protocol = "ICMP"
	if len(data) < 4 {
		info.Info = fmt.Sprintf("%s > %s ICMP [truncated]", info.SrcIP, info.DstIP)
		return
	}
	icmpType := data[0]
	icmpCode := data[1]

	typeName := icmpTypeName(icmpType, icmpCode)
	info.Info = fmt.Sprintf("%s > %s ICMP %s", info.SrcIP, info.DstIP, typeName)
}

func parseICMPv6(data []byte, info *PacketInfo) {
	info.Protocol = "ICMPv6"
	if len(data) < 4 {
		info.Info = fmt.Sprintf("%s > %s ICMPv6 [truncated]", info.SrcIP, info.DstIP)
		return
	}
	icmpType := data[0]
	info.Info = fmt.Sprintf("%s > %s ICMPv6 type=%d", info.SrcIP, info.DstIP, icmpType)
}

func parseARP(data []byte, info *PacketInfo) {
	if len(data) < 28 {
		info.Info = fmt.Sprintf("ARP [truncated, %d bytes]", len(data))
		return
	}
	op := binary.BigEndian.Uint16(data[6:8])
	senderIP := fmt.Sprintf("%d.%d.%d.%d", data[14], data[15], data[16], data[17])
	targetIP := fmt.Sprintf("%d.%d.%d.%d", data[24], data[25], data[26], data[27])
	senderMAC := fmt.Sprintf("%02x:%02x:%02x:%02x:%02x:%02x", data[8], data[9], data[10], data[11], data[12], data[13])

	info.SrcIP = senderIP
	info.DstIP = targetIP

	switch op {
	case 1:
		info.Info = fmt.Sprintf("Who has %s? Tell %s", targetIP, senderIP)
	case 2:
		info.Info = fmt.Sprintf("%s is at %s", senderIP, senderMAC)
	default:
		info.Info = fmt.Sprintf("ARP op=%d %s > %s", op, senderIP, targetIP)
	}
}

// ── Helpers ──

func tcpFlagsString(flags uint8) string {
	var f []byte
	if flags&0x02 != 0 {
		f = append(f, 'S')
	}
	if flags&0x10 != 0 {
		f = append(f, '.')
	}
	if flags&0x01 != 0 {
		f = append(f, 'F')
	}
	if flags&0x04 != 0 {
		f = append(f, 'R')
	}
	if flags&0x08 != 0 {
		f = append(f, 'P')
	}
	if flags&0x20 != 0 {
		f = append(f, 'U')
	}
	if len(f) == 0 {
		return "none"
	}
	return string(f)
}

func icmpTypeName(t, code uint8) string {
	switch t {
	case 0:
		return "Echo Reply"
	case 3:
		switch code {
		case 0:
			return "Destination Net Unreachable"
		case 1:
			return "Destination Host Unreachable"
		case 3:
			return "Destination Port Unreachable"
		default:
			return fmt.Sprintf("Destination Unreachable (code %d)", code)
		}
	case 8:
		return "Echo Request"
	case 11:
		return "Time Exceeded"
	default:
		return fmt.Sprintf("type=%d code=%d", t, code)
	}
}

func portService(src, dst uint16) string {
	for _, p := range []uint16{src, dst} {
		switch p {
		case 22:
			return "SSH"
		case 53:
			return "DNS"
		case 80:
			return "HTTP"
		case 443:
			return "HTTPS"
		case 5060:
			return "SIP"
		case 5061:
			return "SIP-TLS"
		case 3389:
			return "RDP"
		case 8080:
			return "HTTP-Alt"
		}
	}
	return ""
}

func extractFirstLine(data []byte) string {
	// Extract first line of text (for SIP message identification)
	end := len(data)
	if end > 80 {
		end = 80
	}
	for i := 0; i < end; i++ {
		if data[i] == '\r' || data[i] == '\n' {
			if i > 0 {
				return string(data[:i])
			}
			return ""
		}
		// Non-printable = not text
		if data[i] < 0x20 && data[i] != '\t' {
			return ""
		}
	}
	if end > 0 {
		return string(data[:end])
	}
	return ""
}

func formatIPv6(b []byte) string {
	if len(b) != 16 {
		return "?"
	}
	return fmt.Sprintf("%x:%x:%x:%x:%x:%x:%x:%x",
		binary.BigEndian.Uint16(b[0:2]),
		binary.BigEndian.Uint16(b[2:4]),
		binary.BigEndian.Uint16(b[4:6]),
		binary.BigEndian.Uint16(b[6:8]),
		binary.BigEndian.Uint16(b[8:10]),
		binary.BigEndian.Uint16(b[10:12]),
		binary.BigEndian.Uint16(b[12:14]),
		binary.BigEndian.Uint16(b[14:16]),
	)
}
