package main

import (
	"encoding/binary"
	"net"
	"sync"
	"time"
)

// ─── PCAP File Builder ──────────────────────────────────────────────────────
//
// Builds a standard libpcap-format capture file from raw UDP payloads.
// Used to record SIP messages and RTP packets during a call, producing a
// .pcap file that can be opened in Wireshark.
//
// File format: https://wiki.wireshark.org/Development/LibpcapFileFormat

// PcapBuilder accumulates packets and produces a complete PCAP byte slice.
// Thread-safe: concurrent AddUDPPacket calls from send/receive goroutines are safe.
type PcapBuilder struct {
	mu      sync.Mutex
	packets []pcapPacket
}

type pcapPacket struct {
	ts      time.Time
	srcIP   net.IP
	dstIP   net.IP
	srcPort uint16
	dstPort uint16
	payload []byte
}

// NewPcapBuilder creates an empty PCAP builder.
func NewPcapBuilder() *PcapBuilder {
	return &PcapBuilder{}
}

// AddUDPPacket records a UDP packet with the given addressing and payload.
func (b *PcapBuilder) AddUDPPacket(ts time.Time, srcIP net.IP, srcPort uint16, dstIP net.IP, dstPort uint16, payload []byte) {
	pkt := pcapPacket{
		ts:      ts,
		srcIP:   srcIP.To4(),
		dstIP:   dstIP.To4(),
		srcPort: srcPort,
		dstPort: dstPort,
		payload: make([]byte, len(payload)),
	}
	copy(pkt.payload, payload)
	b.mu.Lock()
	b.packets = append(b.packets, pkt)
	b.mu.Unlock()
}

// PacketCount returns the number of recorded packets.
func (b *PcapBuilder) PacketCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.packets)
}

// Build produces the complete PCAP file as a byte slice.
func (b *PcapBuilder) Build() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	// Estimate size: global header + per-packet overhead
	estimatedSize := 24 // global header
	for _, pkt := range b.packets {
		// pcap packet header(16) + ethernet(14) + ip(20) + udp(8) + payload
		estimatedSize += 16 + 14 + 20 + 8 + len(pkt.payload)
	}
	buf := make([]byte, 0, estimatedSize)

	// ─── Global Header (24 bytes) ───
	buf = appendLE32(buf, 0xa1b2c3d4) // magic number
	buf = appendLE16(buf, 2)           // version major
	buf = appendLE16(buf, 4)           // version minor
	buf = appendLE32(buf, 0)           // thiszone (GMT)
	buf = appendLE32(buf, 0)           // sigfigs
	buf = appendLE32(buf, 65535)       // snaplen
	buf = appendLE32(buf, 1)           // network (LINKTYPE_ETHERNET)

	// ─── Packet Records ───
	for _, pkt := range b.packets {
		frame := buildEthernetUDPFrame(pkt)

		// Packet header (16 bytes)
		tsSec := uint32(pkt.ts.Unix())
		tsUsec := uint32(pkt.ts.Nanosecond() / 1000)
		capturedLen := uint32(len(frame))
		originalLen := capturedLen

		buf = appendLE32(buf, tsSec)
		buf = appendLE32(buf, tsUsec)
		buf = appendLE32(buf, capturedLen)
		buf = appendLE32(buf, originalLen)
		buf = append(buf, frame...)
	}

	return buf
}

// buildEthernetUDPFrame constructs: Ethernet + IPv4 + UDP + payload
func buildEthernetUDPFrame(pkt pcapPacket) []byte {
	payloadLen := len(pkt.payload)
	udpLen := 8 + payloadLen
	ipLen := 20 + udpLen
	totalLen := 14 + ipLen // Ethernet + IP + UDP + payload

	frame := make([]byte, totalLen)

	// ─── Ethernet Header (14 bytes) ───
	// dst MAC: 00:00:00:00:00:00 (placeholder)
	// src MAC: 00:00:00:00:00:00 (placeholder)
	// ethertype: 0x0800 (IPv4)
	frame[12] = 0x08
	frame[13] = 0x00

	// ─── IPv4 Header (20 bytes) ───
	ip := frame[14:]
	ip[0] = 0x45       // Version 4, IHL 5 (20 bytes)
	ip[1] = 0x00       // DSCP/ECN
	binary.BigEndian.PutUint16(ip[2:4], uint16(ipLen)) // Total length
	binary.BigEndian.PutUint16(ip[4:6], 0)             // Identification
	binary.BigEndian.PutUint16(ip[6:8], 0x4000)        // Flags: Don't Fragment
	ip[8] = 64                                         // TTL
	ip[9] = 17                                         // Protocol: UDP
	// ip[10:12] = checksum (computed below)
	copy(ip[12:16], pkt.srcIP)
	copy(ip[16:20], pkt.dstIP)

	// IP checksum
	binary.BigEndian.PutUint16(ip[10:12], ipChecksum(ip[:20]))

	// ─── UDP Header (8 bytes) ───
	udp := ip[20:]
	binary.BigEndian.PutUint16(udp[0:2], pkt.srcPort)
	binary.BigEndian.PutUint16(udp[2:4], pkt.dstPort)
	binary.BigEndian.PutUint16(udp[4:6], uint16(udpLen))
	// udp[6:8] = checksum (0 = optional for UDP/IPv4)

	// ─── Payload ───
	copy(udp[8:], pkt.payload)

	return frame
}

// ipChecksum computes the standard IPv4 header checksum.
func ipChecksum(header []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(header); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(header[i : i+2]))
	}
	// Fold 32-bit sum to 16 bits
	for sum > 0xFFFF {
		sum = (sum >> 16) + (sum & 0xFFFF)
	}
	return ^uint16(sum)
}

func appendLE16(buf []byte, v uint16) []byte {
	b := make([]byte, 2)
	binary.LittleEndian.PutUint16(b, v)
	return append(buf, b...)
}

func appendLE32(buf []byte, v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return append(buf, b...)
}
