package main

import (
	"fmt"
	"net"
	"strings"
	"time"
)

// RunSnmpPoll performs SNMPv2c GET requests for system and interface MIB objects.
// Uses raw UDP + BER encoding to avoid external dependencies.
func RunSnmpPoll(p SnmpPollParams) (*SnmpPollResult, error) {
	if p.Host == "" {
		return nil, fmt.Errorf("host is required")
	}
	if p.Community == "" {
		p.Community = "public"
	}

	start := time.Now()
	host := p.Host
	if !strings.Contains(host, ":") {
		host += ":161"
	}

	addr, err := net.ResolveUDPAddr("udp4", host)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", host, err)
	}

	conn, err := net.DialUDP("udp4", nil, addr)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))

	sysInfo := SnmpSystemInfo{}
	var interfaces []SnmpInterface

	// Query system MIB OIDs
	sysOIDs := map[string]*string{
		"1.3.6.1.2.1.1.5.0": &sysInfo.SysName,
		"1.3.6.1.2.1.1.1.0": &sysInfo.SysDescr,
		"1.3.6.1.2.1.1.3.0": &sysInfo.SysUpTime,
		"1.3.6.1.2.1.1.4.0": &sysInfo.SysContact,
		"1.3.6.1.2.1.1.6.0": &sysInfo.SysLocation,
	}

	for oid, target := range sysOIDs {
		val, err := snmpGet(conn, p.Community, oid)
		if err == nil {
			*target = val
		}
	}

	// Query interface count
	ifCountStr, err := snmpGet(conn, p.Community, "1.3.6.1.2.1.2.1.0")
	if err == nil {
		var ifCount int
		fmt.Sscanf(ifCountStr, "%d", &ifCount)
		if ifCount > 64 {
			ifCount = 64
		}

		for idx := 1; idx <= ifCount; idx++ {
			iface := SnmpInterface{Index: idx}
			if v, e := snmpGet(conn, p.Community, fmt.Sprintf("1.3.6.1.2.1.2.2.1.2.%d", idx)); e == nil {
				iface.Description = v
			}
			if v, e := snmpGet(conn, p.Community, fmt.Sprintf("1.3.6.1.2.1.2.2.1.5.%d", idx)); e == nil {
				fmt.Sscanf(v, "%d", &iface.Speed)
			}
			if v, e := snmpGet(conn, p.Community, fmt.Sprintf("1.3.6.1.2.1.2.2.1.8.%d", idx)); e == nil {
				switch v {
				case "1":
					iface.OperStatus = "up"
				case "2":
					iface.OperStatus = "down"
				default:
					iface.OperStatus = v
				}
			}
			if v, e := snmpGet(conn, p.Community, fmt.Sprintf("1.3.6.1.2.1.2.2.1.10.%d", idx)); e == nil {
				fmt.Sscanf(v, "%d", &iface.InOctets)
			}
			if v, e := snmpGet(conn, p.Community, fmt.Sprintf("1.3.6.1.2.1.2.2.1.16.%d", idx)); e == nil {
				fmt.Sscanf(v, "%d", &iface.OutOctets)
			}
			if v, e := snmpGet(conn, p.Community, fmt.Sprintf("1.3.6.1.2.1.2.2.1.14.%d", idx)); e == nil {
				fmt.Sscanf(v, "%d", &iface.InErrors)
			}
			if v, e := snmpGet(conn, p.Community, fmt.Sprintf("1.3.6.1.2.1.2.2.1.20.%d", idx)); e == nil {
				fmt.Sscanf(v, "%d", &iface.OutErrors)
			}
			interfaces = append(interfaces, iface)
		}
	}

	return &SnmpPollResult{
		SystemInfo: sysInfo,
		Interfaces: interfaces,
		ElapsedMs:  uint64(time.Since(start).Milliseconds()),
	}, nil
}

// snmpGet performs a single SNMPv2c GET request and returns the string value.
func snmpGet(conn *net.UDPConn, community, oid string) (string, error) {
	reqID := uint32(time.Now().UnixNano() & 0x7FFFFFFF)
	pkt := buildSnmpGetPacket(community, oid, reqID)

	conn.SetDeadline(time.Now().Add(3 * time.Second))
	_, err := conn.Write(pkt)
	if err != nil {
		return "", fmt.Errorf("write: %w", err)
	}

	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		return "", fmt.Errorf("read: %w", err)
	}

	return parseSnmpResponse(buf[:n])
}

// buildSnmpGetPacket constructs a minimal SNMPv2c GET-REQUEST packet.
func buildSnmpGetPacket(community, oid string, reqID uint32) []byte {
	oidBytes := encodeOID(oid)

	// VarBind: SEQUENCE { OID, NULL }
	varbind := berSequence(append(oidBytes, 0x05, 0x00))
	// VarBindList: SEQUENCE { varbind }
	varbindList := berSequence(varbind)

	// PDU: GetRequest (0xA0) { reqID, error-status(0), error-index(0), varbindList }
	pdu := berTagged(0xA0, concat(
		berInteger(reqID),
		berInteger(0), // error status
		berInteger(0), // error index
		varbindList,
	))

	// Message: SEQUENCE { version(1=v2c), community, pdu }
	msg := berSequence(concat(
		berInteger(1), // SNMPv2c
		berOctetString([]byte(community)),
		pdu,
	))

	return msg
}

func parseSnmpResponse(data []byte) (string, error) {
	if len(data) < 20 {
		return "", fmt.Errorf("response too short")
	}
	// Walk the BER structure to find the value in the first varbind
	// This is a simplified parser that handles common cases
	idx := 0
	// Skip outer SEQUENCE
	if idx >= len(data) || data[idx] != 0x30 {
		return "", fmt.Errorf("expected SEQUENCE")
	}
	idx++
	_, idx = berLength(data, idx)

	// Skip version INTEGER
	if idx >= len(data) || data[idx] != 0x02 {
		return "", fmt.Errorf("expected INTEGER for version")
	}
	idx++
	vLen, idx := berLength(data, idx)
	idx += vLen

	// Skip community OCTET STRING
	if idx >= len(data) || data[idx] != 0x04 {
		return "", fmt.Errorf("expected OCTET STRING for community")
	}
	idx++
	cLen, idx := berLength(data, idx)
	idx += cLen

	// PDU (Response = 0xA2)
	if idx >= len(data) || (data[idx] != 0xA2 && data[idx] != 0xA0) {
		return "", fmt.Errorf("expected Response PDU, got 0x%02X", data[idx])
	}
	idx++
	_, idx = berLength(data, idx)

	// Skip reqID, error-status, error-index (3 INTEGERs)
	for i := 0; i < 3; i++ {
		if idx >= len(data) || data[idx] != 0x02 {
			return "", fmt.Errorf("expected INTEGER")
		}
		idx++
		iLen, newIdx := berLength(data, idx)
		idx = newIdx + iLen
	}

	// VarBindList SEQUENCE
	if idx >= len(data) || data[idx] != 0x30 {
		return "", fmt.Errorf("expected varbindlist SEQUENCE")
	}
	idx++
	_, idx = berLength(data, idx)

	// First VarBind SEQUENCE
	if idx >= len(data) || data[idx] != 0x30 {
		return "", fmt.Errorf("expected varbind SEQUENCE")
	}
	idx++
	_, idx = berLength(data, idx)

	// Skip OID
	if idx >= len(data) || data[idx] != 0x06 {
		return "", fmt.Errorf("expected OID")
	}
	idx++
	oLen, idx := berLength(data, idx)
	idx += oLen

	// Read value
	if idx >= len(data) {
		return "", fmt.Errorf("no value")
	}
	tag := data[idx]
	idx++
	valLen, idx := berLength(data, idx)
	if idx+valLen > len(data) {
		valLen = len(data) - idx
	}
	valBytes := data[idx : idx+valLen]

	switch tag {
	case 0x04: // OCTET STRING
		return string(valBytes), nil
	case 0x02: // INTEGER
		var val int64
		for _, b := range valBytes {
			val = (val << 8) | int64(b)
		}
		return fmt.Sprintf("%d", val), nil
	case 0x41: // Counter32
		var val uint64
		for _, b := range valBytes {
			val = (val << 8) | uint64(b)
		}
		return fmt.Sprintf("%d", val), nil
	case 0x43: // TimeTicks
		var val uint64
		for _, b := range valBytes {
			val = (val << 8) | uint64(b)
		}
		secs := val / 100
		days := secs / 86400
		hours := (secs % 86400) / 3600
		mins := (secs % 3600) / 60
		return fmt.Sprintf("%dd %dh %dm", days, hours, mins), nil
	default:
		return fmt.Sprintf("(type=0x%02X) %x", tag, valBytes), nil
	}
}

// BER encoding helpers

func berLength(data []byte, idx int) (int, int) {
	if idx >= len(data) {
		return 0, idx
	}
	b := data[idx]
	idx++
	if b < 0x80 {
		return int(b), idx
	}
	nBytes := int(b & 0x7F)
	length := 0
	for i := 0; i < nBytes && idx < len(data); i++ {
		length = (length << 8) | int(data[idx])
		idx++
	}
	return length, idx
}

func berEncodedLength(length int) []byte {
	if length < 0x80 {
		return []byte{byte(length)}
	}
	if length <= 0xFF {
		return []byte{0x81, byte(length)}
	}
	return []byte{0x82, byte(length >> 8), byte(length)}
}

func berSequence(content []byte) []byte {
	return concat([]byte{0x30}, berEncodedLength(len(content)), content)
}

func berTagged(tag byte, content []byte) []byte {
	return concat([]byte{tag}, berEncodedLength(len(content)), content)
}

func berInteger(val uint32) []byte {
	if val == 0 {
		return []byte{0x02, 0x01, 0x00}
	}
	var bytes []byte
	v := val
	for v > 0 {
		bytes = append([]byte{byte(v & 0xFF)}, bytes...)
		v >>= 8
	}
	if bytes[0]&0x80 != 0 {
		bytes = append([]byte{0x00}, bytes...)
	}
	return concat([]byte{0x02}, berEncodedLength(len(bytes)), bytes)
}

func berOctetString(val []byte) []byte {
	return concat([]byte{0x04}, berEncodedLength(len(val)), val)
}

func encodeOID(oid string) []byte {
	parts := strings.Split(oid, ".")
	if len(parts) < 2 {
		return []byte{0x06, 0x01, 0x00}
	}
	var nums []int
	for _, p := range parts {
		var n int
		fmt.Sscanf(p, "%d", &n)
		nums = append(nums, n)
	}
	var encoded []byte
	if len(nums) >= 2 {
		encoded = append(encoded, byte(nums[0]*40+nums[1]))
		for i := 2; i < len(nums); i++ {
			encoded = append(encoded, encodeOIDComponent(nums[i])...)
		}
	}
	return concat([]byte{0x06}, berEncodedLength(len(encoded)), encoded)
}

func encodeOIDComponent(val int) []byte {
	if val < 128 {
		return []byte{byte(val)}
	}
	var result []byte
	result = append(result, byte(val&0x7F))
	val >>= 7
	for val > 0 {
		result = append([]byte{byte(val&0x7F) | 0x80}, result...)
		val >>= 7
	}
	return result
}

func concat(parts ...[]byte) []byte {
	var result []byte
	for _, p := range parts {
		result = append(result, p...)
	}
	return result
}
