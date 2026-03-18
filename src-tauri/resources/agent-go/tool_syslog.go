package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"time"
)

// RunSyslogListen binds a UDP port and receives syslog messages, streaming them via ch.
func RunSyslogListen(ctx context.Context, p SyslogListenParams, ch chan<- ToolResponse) {
	defer close(ch)

	if p.Port == 0 {
		p.Port = 514
	}
	if p.MaxEntries == 0 {
		p.MaxEntries = 10000
	}

	addr := fmt.Sprintf(":%d", p.Port)
	pc, err := net.ListenPacket("udp4", addr)
	if err != nil {
		ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "SYSLOG_ERROR", Message: fmt.Sprintf("bind %s: %v", addr, err)}}
		return
	}
	defer pc.Close()

	log.Printf("[Syslog] Listening on UDP %s", addr)

	// Signal that we're listening
	ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{Message: fmt.Sprintf("Listening on UDP port %d", p.Port)},
	}

	// Duration timeout
	var deadline <-chan time.Time
	if p.DurationSecs > 0 {
		deadline = time.After(time.Duration(p.DurationSecs) * time.Second)
	}

	var totalMessages uint32
	severityCounts := make(map[string]uint32)
	uniqueSources := make(map[string]bool)
	var batch []SyslogEntry
	batchTimer := time.NewTicker(500 * time.Millisecond)
	defer batchTimer.Stop()

	buf := make([]byte, 65536)
	readDone := make(chan struct{})

	go func() {
		defer close(readDone)
		for {
			pc.SetReadDeadline(time.Now().Add(1 * time.Second))
			n, remoteAddr, err := pc.ReadFrom(buf)
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					continue
				}
				return
			}
			if n == 0 {
				continue
			}

			entry := parseSyslogMessage(string(buf[:n]), remoteAddr)

			// Apply severity filter
			if p.FilterSeverity != nil && *p.FilterSeverity != "" {
				if !strings.EqualFold(entry.Severity, *p.FilterSeverity) {
					continue
				}
			}

			totalMessages++
			severityCounts[entry.Severity]++
			uniqueSources[entry.Hostname] = true
			batch = append(batch, entry)

			if totalMessages >= p.MaxEntries {
				return
			}

			// Flush batch every 50 messages
			if len(batch) >= 50 {
				flushBatch(ch, &batch, totalMessages)
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			flushBatch(ch, &batch, totalMessages)
			sendSyslogSummary(ch, totalMessages, severityCounts, uniqueSources)
			return
		case <-readDone:
			flushBatch(ch, &batch, totalMessages)
			sendSyslogSummary(ch, totalMessages, severityCounts, uniqueSources)
			return
		case <-batchTimer.C:
			if len(batch) > 0 {
				flushBatch(ch, &batch, totalMessages)
			}
		case <-deadline:
			flushBatch(ch, &batch, totalMessages)
			sendSyslogSummary(ch, totalMessages, severityCounts, uniqueSources)
			return
		}
	}
}

func flushBatch(ch chan<- ToolResponse, batch *[]SyslogEntry, total uint32) {
	if len(*batch) == 0 {
		return
	}
	pct := float64(0)
	ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{
			Progress: &pct,
			Message:  fmt.Sprintf("%d messages received", total),
			Partial:  *batch,
		},
	}
	*batch = nil
}

func sendSyslogSummary(ch chan<- ToolResponse, total uint32, sevCounts map[string]uint32, sources map[string]bool) {
	var srcList []string
	for s := range sources {
		srcList = append(srcList, s)
	}
	ch <- ToolResponse{
		Type: "Result",
		Data: ResultData{
			Success: true,
			Result: SyslogSummary{
				TotalMessages:  total,
				SeverityCounts: sevCounts,
				UniqueSources:  srcList,
			},
		},
	}
}

// Syslog severity names (RFC 5424)
var syslogSeverities = [8]string{
	"emergency", "alert", "critical", "error",
	"warning", "notice", "info", "debug",
}

// Syslog facility names (RFC 5424)
var syslogFacilities = [24]string{
	"kern", "user", "mail", "daemon", "auth", "syslog", "lpr", "news",
	"uucp", "cron", "authpriv", "ftp", "ntp", "audit", "alert", "clock",
	"local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7",
}

func parseSyslogMessage(raw string, from net.Addr) SyslogEntry {
	entry := SyslogEntry{
		Timestamp: time.Now().Format(time.RFC3339),
		Message:   raw,
	}

	// Extract source IP
	if udpAddr, ok := from.(*net.UDPAddr); ok {
		entry.Hostname = udpAddr.IP.String()
	}

	// Parse PRI
	if len(raw) < 3 || raw[0] != '<' {
		return entry
	}

	priEnd := strings.IndexByte(raw, '>')
	if priEnd < 0 || priEnd > 5 {
		return entry
	}

	pri, err := strconv.Atoi(raw[1:priEnd])
	if err != nil || pri < 0 || pri > 191 {
		return entry
	}

	facility := pri / 8
	severity := pri % 8

	if severity < len(syslogSeverities) {
		entry.Severity = syslogSeverities[severity]
	}
	if facility < len(syslogFacilities) {
		entry.Facility = syslogFacilities[facility]
	}

	rest := raw[priEnd+1:]

	// Try RFC 5424 format: VERSION SP TIMESTAMP SP HOSTNAME SP APP-NAME SP PROCID SP MSGID SP ...
	if len(rest) > 2 && rest[0] >= '1' && rest[0] <= '9' && rest[1] == ' ' {
		parts := strings.SplitN(rest[2:], " ", 6)
		if len(parts) >= 5 {
			entry.Timestamp = parts[0]
			if parts[1] != "-" {
				entry.Hostname = parts[1]
			}
			entry.AppName = parts[2]
			entry.ProcessID = parts[3]
			if len(parts) >= 6 {
				entry.Message = parts[5]
			}
			return entry
		}
	}

	// RFC 3164 format: TIMESTAMP HOSTNAME MSG
	entry.Message = rest
	if len(rest) > 16 {
		// BSD timestamp is like "Jan  1 12:00:00"
		possibleTs := rest[:15]
		if len(possibleTs) >= 15 && (possibleTs[3] == ' ' || possibleTs[4] == ' ') {
			entry.Timestamp = strings.TrimSpace(possibleTs)
			remainder := strings.TrimSpace(rest[15:])
			spaceIdx := strings.IndexByte(remainder, ' ')
			if spaceIdx > 0 {
				entry.Hostname = remainder[:spaceIdx]
				entry.Message = remainder[spaceIdx+1:]
			}
		}
	}

	// Try to extract app name from message "app[pid]: msg"
	if colonIdx := strings.Index(entry.Message, ": "); colonIdx > 0 {
		prefix := entry.Message[:colonIdx]
		if bracketIdx := strings.Index(prefix, "["); bracketIdx > 0 {
			entry.AppName = prefix[:bracketIdx]
			entry.ProcessID = strings.TrimRight(prefix[bracketIdx+1:], "]")
		} else if !strings.Contains(prefix, " ") {
			entry.AppName = prefix
		}
	}

	return entry
}
