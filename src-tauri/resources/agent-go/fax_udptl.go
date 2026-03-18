package main

import (
	"encoding/binary"
	"fmt"
	"net"
	"time"
)

// UDPTL implements ITU-T T.38 Annex D UDPTL transport.
// Each UDPTL packet carries one primary IFP packet plus redundant copies of
// previous IFP packets for error recovery.

const (
	maxRedundancy = 3
	udptlMTU      = 512
)

// UDPTLConn wraps a UDP connection for UDPTL transport.
type UDPTLConn struct {
	conn       net.PacketConn
	remoteAddr *net.UDPAddr
	seqNo      uint16
	history    [][]byte // recent IFP packets for redundancy
}

// NewUDPTLConn creates a new UDPTL connection.
func NewUDPTLConn(conn net.PacketConn, remoteAddr *net.UDPAddr) *UDPTLConn {
	return &UDPTLConn{
		conn:       conn,
		remoteAddr: remoteAddr,
		history:    make([][]byte, 0, maxRedundancy+1),
	}
}

// SendIFP sends an IFP packet over UDPTL with redundancy.
func (u *UDPTLConn) SendIFP(ifpData []byte) error {
	if u.remoteAddr == nil {
		return fmt.Errorf("no remote address")
	}

	// Build UDPTL packet:
	// [2] Sequence number
	// [2] Primary IFP length
	// [...] Primary IFP data
	// [1] Error recovery: 0x00 = redundancy
	// [1] Number of redundant packets
	// For each redundant packet:
	//   [2] Length
	//   [...] Data

	buf := make([]byte, 0, udptlMTU)

	// Sequence number (big-endian)
	buf = append(buf, byte(u.seqNo>>8), byte(u.seqNo))

	// Primary IFP packet
	ifpLen := len(ifpData)
	buf = append(buf, byte(ifpLen>>8), byte(ifpLen))
	buf = append(buf, ifpData...)

	// Error recovery: redundancy mode (bit 7 = 0)
	numRedundant := len(u.history)
	if numRedundant > maxRedundancy {
		numRedundant = maxRedundancy
	}
	buf = append(buf, byte(numRedundant))

	// Redundant packets (most recent first)
	for i := 0; i < numRedundant; i++ {
		idx := len(u.history) - 1 - i
		if idx < 0 {
			break
		}
		redData := u.history[idx]
		buf = append(buf, byte(len(redData)>>8), byte(len(redData)))
		buf = append(buf, redData...)
	}

	// Send
	_, err := u.conn.WriteTo(buf, u.remoteAddr)
	if err != nil {
		return err
	}

	// Store for future redundancy
	stored := make([]byte, len(ifpData))
	copy(stored, ifpData)
	u.history = append(u.history, stored)
	if len(u.history) > maxRedundancy+1 {
		u.history = u.history[1:]
	}

	u.seqNo++
	return nil
}

// RecvIFP reads a UDPTL packet and returns the primary IFP data and sequence number.
func (u *UDPTLConn) RecvIFP(timeout time.Duration) ([]byte, uint16, error) {
	buf := make([]byte, 2048)
	u.conn.SetReadDeadline(time.Now().Add(timeout))
	n, _, err := u.conn.ReadFrom(buf)
	if err != nil {
		return nil, 0, err
	}
	if n < 4 {
		return nil, 0, fmt.Errorf("UDPTL packet too short (%d bytes)", n)
	}

	seqNo := binary.BigEndian.Uint16(buf[0:2])
	ifpLen := int(binary.BigEndian.Uint16(buf[2:4]))
	if 4+ifpLen > n {
		return nil, 0, fmt.Errorf("UDPTL IFP length %d exceeds packet size %d", ifpLen, n-4)
	}

	ifpData := make([]byte, ifpLen)
	copy(ifpData, buf[4:4+ifpLen])
	return ifpData, seqNo, nil
}
