package main

import (
	"encoding/binary"
	"fmt"
	"net"
	"time"
)

var defaultNtpServers = []string{
	"pool.ntp.org",
	"time.google.com",
	"time.cloudflare.com",
}

func RunNtpCheck(p NtpCheckParams) (*NtpCheckResult, error) {
	if len(p.Servers) == 0 {
		p.Servers = defaultNtpServers
	}
	if p.TimeoutMs == 0 {
		p.TimeoutMs = 3000
	}
	timeout := time.Duration(p.TimeoutMs) * time.Millisecond

	var results []NtpServerResult
	var maxAbsOffset float64

	for _, server := range p.Servers {
		sr := queryNtp(server, timeout)
		results = append(results, sr)
		if sr.Success {
			abs := sr.OffsetMs
			if abs < 0 {
				abs = -abs
			}
			if abs > maxAbsOffset {
				maxAbsOffset = abs
			}
		}
	}

	localTime := time.Now()
	status := "ok"
	if maxAbsOffset > 30000 {
		status = "critical"
	} else if maxAbsOffset > 1000 {
		status = "warning"
	}

	return &NtpCheckResult{
		Servers:     results,
		LocalTime:   localTime.Format(time.RFC3339Nano),
		UtcTime:     localTime.UTC().Format(time.RFC3339Nano),
		ClockStatus: status,
	}, nil
}

func queryNtp(server string, timeout time.Duration) NtpServerResult {
	host := server
	if _, _, err := net.SplitHostPort(server); err != nil {
		host = net.JoinHostPort(server, "123")
	}

	conn, err := net.DialTimeout("udp", host, timeout)
	if err != nil {
		errMsg := fmt.Sprintf("dial: %v", err)
		return NtpServerResult{Server: server, Error: &errMsg}
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(timeout))

	// NTP v4 client request (mode 3), 48 bytes
	req := make([]byte, 48)
	req[0] = 0x23 // LI=0, VN=4, Mode=3

	// Set transmit timestamp (T1)
	t1 := time.Now()
	setNtpTimestamp(req[40:48], t1)

	if _, err := conn.Write(req); err != nil {
		errMsg := fmt.Sprintf("write: %v", err)
		return NtpServerResult{Server: server, Error: &errMsg}
	}

	resp := make([]byte, 48)
	n, err := conn.Read(resp)
	t4 := time.Now() // receive time
	if err != nil || n < 48 {
		errMsg := "read failed or short response"
		if err != nil {
			errMsg = fmt.Sprintf("read: %v", err)
		}
		return NtpServerResult{Server: server, Error: &errMsg}
	}

	// Parse response
	stratum := resp[1]
	refID := fmt.Sprintf("%d.%d.%d.%d", resp[12], resp[13], resp[14], resp[15])

	t2 := getNtpTimestamp(resp[32:40]) // server receive
	t3 := getNtpTimestamp(resp[40:48]) // server transmit

	// RFC 4330: offset = ((T2-T1) + (T3-T4)) / 2
	offset := (t2.Sub(t1) + t3.Sub(t4)) / 2
	delay := (t4.Sub(t1)) - (t3.Sub(t2))

	return NtpServerResult{
		Server:      server,
		Stratum:     stratum,
		OffsetMs:    float64(offset.Microseconds()) / 1000.0,
		DelayMs:     float64(delay.Microseconds()) / 1000.0,
		ReferenceID: refID,
		Success:     true,
	}
}

// NTP epoch is Jan 1, 1900; Unix epoch is Jan 1, 1970
var ntpEpochOffset = time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC).Sub(
	time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC),
)

func setNtpTimestamp(b []byte, t time.Time) {
	secs := uint64(t.Unix()) + uint64(ntpEpochOffset.Seconds())
	frac := uint64(t.Nanosecond()) * (1 << 32) / 1e9
	binary.BigEndian.PutUint32(b[0:4], uint32(secs))
	binary.BigEndian.PutUint32(b[4:8], uint32(frac))
}

func getNtpTimestamp(b []byte) time.Time {
	secs := binary.BigEndian.Uint32(b[0:4])
	frac := binary.BigEndian.Uint32(b[4:8])
	nsec := int64(frac) * 1e9 / (1 << 32)
	unixSecs := int64(secs) - int64(ntpEpochOffset.Seconds())
	return time.Unix(unixSecs, nsec)
}

