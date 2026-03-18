package main

import (
	"fmt"
	"math/rand"
	"net"
	"strings"
	"time"
)

// RunFaxSend places a SIP call with T.38 support and sends a test fax page.
func RunFaxSend(p FaxSendParams) (interface{}, error) {
	if p.Target == "" {
		return nil, fmt.Errorf("target is required")
	}
	if p.Port == 0 {
		p.Port = 5060
	}
	if p.StationID == "" {
		p.StationID = "SIPalyzer"
	}

	addr := net.JoinHostPort(p.Target, fmt.Sprintf("%d", p.Port))
	raddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", addr, err)
	}

	// SIP signaling socket
	conn, err := net.DialUDP("udp", nil, raddr)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	localSIPAddr := conn.LocalAddr().String()
	localIP, _, _ := net.SplitHostPort(localSIPAddr)

	// T.38 UDPTL socket
	udptlListener, err := net.ListenPacket("udp4", localIP+":0")
	if err != nil {
		return nil, fmt.Errorf("udptl listen: %w", err)
	}
	defer udptlListener.Close()
	udptlPort := udptlListener.LocalAddr().(*net.UDPAddr).Port

	callID := fmt.Sprintf("%d@%s", time.Now().UnixNano(), localIP)
	fromTag := fmt.Sprintf("%x", rand.Int31())

	domain := p.Target
	if p.Domain != nil && *p.Domain != "" {
		domain = *p.Domain
	}

	toURI := fmt.Sprintf("sip:%s@%s", p.FaxNumber, domain)
	if p.FaxNumber == "" {
		toURI = fmt.Sprintf("sip:%s", domain)
	}

	callerID := p.CallerID
	if callerID == "" {
		callerID = "fax"
	}

	start := time.Now()
	result := map[string]interface{}{
		"target":     p.Target,
		"fax_number": p.FaxNumber,
		"port":       p.Port,
		"station_id": p.StationID,
	}

	// Default baud rate
	baudRate := p.BaudRate
	if baudRate == 0 {
		baudRate = 9600
	}
	resolution := p.Resolution
	if resolution == "" {
		resolution = "standard"
	}

	result["baud_rate"] = baudRate
	result["ecm"] = p.ECM
	result["resolution"] = resolution
	if p.HeaderLine != "" {
		result["header_line"] = p.HeaderLine
	}

	// Generate test page preview
	faxSettings := FaxSettings{
		BaudRate:   baudRate,
		ECM:        p.ECM,
		Resolution: resolution,
		HeaderLine: p.HeaderLine,
		StationID:  p.StationID,
	}
	result["page_preview_base64"] = GenerateTestPagePreview(faxSettings)

	// Build SDP with T.38 offer
	sdp := buildT38SDP(localIP, udptlPort, baudRate)

	// Send INVITE
	branch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
	invite := buildSIPMessage("INVITE", toURI, map[string]string{
		"Via":           fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, branch),
		"From":          fmt.Sprintf("<sip:%s@%s>;tag=%s", callerID, localIP, fromTag),
		"To":            fmt.Sprintf("<%s>", toURI),
		"Call-ID":       callID,
		"CSeq":          "1 INVITE",
		"Contact":       fmt.Sprintf("<sip:%s@%s>", callerID, localSIPAddr),
		"Max-Forwards":  "70",
		"User-Agent":    remoteAgentUA("udp"),
		"Content-Type":  "application/sdp",
		"Content-Length": fmt.Sprintf("%d", len(sdp)),
	}, sdp)

	conn.SetDeadline(time.Now().Add(60 * time.Second))
	if _, err := conn.Write([]byte(invite)); err != nil {
		return nil, fmt.Errorf("write INVITE: %w", err)
	}

	var toTag string
	var remoteUDPTLAddr *net.UDPAddr
	var dialogRoutes []string // Record-Route headers (reversed) for in-dialog routing
	var contactURI string     // Contact URI from 200 OK for in-dialog Request-URI
	gotAnswer := false
	events := []map[string]string{}
	cseq := 1 // Track CSeq for re-INVITE after auth challenge

	// Handle SIP responses
	for {
		// Refresh deadline before each read (same fix as SIP call tool)
		conn.SetDeadline(time.Now().Add(60 * time.Second))
		resp, err := readSIPResponse(conn)
		if err != nil {
			result["error"] = "No response: " + err.Error()
			break
		}

		code, reason := parseSIPStatusLine(resp)
		events = append(events, map[string]string{
			"time":   time.Now().Format("15:04:05.000"),
			"status": code,
			"reason": reason,
		})

		if toTag == "" {
			toTag = extractHeaderParam(resp, "To", "tag")
		}

		switch {
		case code == "100":
			continue
		case code == "180" || code == "183":
			result["ring_time_ms"] = time.Since(start).Milliseconds()
			continue
		case code == "200":
			gotAnswer = true
			result["answer_time_ms"] = time.Since(start).Milliseconds()

			// Extract in-dialog routing info (same fix as SipCall)
			dialogRoutes = extractRecordRoutes(resp)
			if uri := extractContactURI(resp); uri != "" {
				contactURI = uri
			}

			// Parse T.38 SDP answer
			remoteUDPTLAddr = parseSDPForUDPTL(resp)

			// Determine ACK Request-URI: use Contact from 200 OK if available
			ackRequestURI := toURI
			if contactURI != "" {
				ackRequestURI = contactURI
			}

			// Send ACK with proper in-dialog routing
			ackBranch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
			toHeader := fmt.Sprintf("<%s>", toURI)
			if toTag != "" {
				toHeader = fmt.Sprintf("<%s>;tag=%s", toURI, toTag)
			}
			ack := buildSIPMessageWithExtra("ACK", ackRequestURI, map[string]string{
				"Via":           fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, ackBranch),
				"From":          fmt.Sprintf("<sip:%s@%s>;tag=%s", callerID, localIP, fromTag),
				"To":            toHeader,
				"Call-ID":       callID,
				"CSeq":          fmt.Sprintf("%d ACK", cseq),
				"Max-Forwards":  "70",
				"Content-Length": "0",
			}, dialogRoutes, "")
			conn.Write([]byte(ack))

		case code == "401" || code == "407":
			// Auth required for fax
			if p.Username != "" && p.Password != "" {
				headerName := "WWW-Authenticate"
				authHeaderName := "Authorization"
				if code == "407" {
					headerName = "Proxy-Authenticate"
					authHeaderName = "Proxy-Authorization"
				}
				realm, nonce, algorithm, qop := parseDigestChallenge(resp, headerName)
				if nonce != "" {
					cnonce := fmt.Sprintf("%08x", rand.Int31())
					nc := "00000001"
					digestResp := computeDigestResponse(p.Username, realm, p.Password, "INVITE", toURI, nonce, algorithm, qop, cnonce, nc)
					authVal := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s", algorithm=%s`,
						p.Username, realm, nonce, toURI, digestResp, algorithm)
					if qop != "" {
						authVal += fmt.Sprintf(`, qop=%s, nc=%s, cnonce="%s"`, qop, nc, cnonce)
					}

					// ACK the challenge
					ackBranch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
					ack := buildSIPMessage("ACK", toURI, map[string]string{
						"Via":           fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, ackBranch),
						"From":          fmt.Sprintf("<sip:%s@%s>;tag=%s", callerID, localIP, fromTag),
						"To":            fmt.Sprintf("<%s>", toURI),
						"Call-ID":       callID,
						"CSeq":          fmt.Sprintf("%d ACK", cseq),
						"Max-Forwards":  "70",
						"Content-Length": "0",
					}, "")
					conn.Write([]byte(ack))

					// Re-INVITE with auth (increment CSeq)
					cseq++
					branch2 := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
					reInvite := buildSIPMessage("INVITE", toURI, map[string]string{
						"Via":           fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, branch2),
						"From":          fmt.Sprintf("<sip:%s@%s>;tag=%s", callerID, localIP, fromTag),
						"To":            fmt.Sprintf("<%s>", toURI),
						"Call-ID":       callID,
						"CSeq":          fmt.Sprintf("%d INVITE", cseq),
						"Contact":       fmt.Sprintf("<sip:%s@%s>", callerID, localSIPAddr),
						"Max-Forwards":  "70",
						"User-Agent":    remoteAgentUA("udp"),
						authHeaderName:  authVal,
						"Content-Type":  "application/sdp",
						"Content-Length": fmt.Sprintf("%d", len(sdp)),
					}, sdp)
					conn.Write([]byte(reInvite))
					continue
				}
			}
			result["status"] = code
			result["reason"] = reason + " (auth failed)"
		default:
			result["status"] = code
			result["reason"] = reason
		}
		break
	}

	result["sip_events"] = events

	if !gotAnswer {
		if result["error"] == nil {
			result["error"] = "Call not answered"
		}
		result["success"] = false
		result["elapsed_ms"] = time.Since(start).Milliseconds()
		return result, nil
	}

	// Verify we have a valid remote UDPTL address from the SDP answer
	if remoteUDPTLAddr == nil {
		result["success"] = false
		result["error"] = "No T.38/UDPTL address in 200 OK SDP answer"
		result["elapsed_ms"] = time.Since(start).Milliseconds()
		// Still send BYE to clean up the dialog
		faxSendBYE(conn, toURI, contactURI, dialogRoutes, localSIPAddr, localIP, callerID, fromTag, toTag, callID, cseq+1)
		return result, nil
	}

	// Start T.30 fax session over T.38
	udptlConn := NewUDPTLConn(udptlListener, remoteUDPTLAddr)
	session := NewT30Session(udptlConn, FaxSettings{
		BaudRate:   baudRate,
		ECM:        p.ECM,
		Resolution: resolution,
		HeaderLine: p.HeaderLine,
		StationID:  p.StationID,
	})
	faxResult := session.SendTestFax()

	// Merge fax results
	for k, v := range faxResult {
		result[k] = v
	}

	// Send BYE with proper in-dialog routing (Contact URI + Route headers)
	faxSendBYE(conn, toURI, contactURI, dialogRoutes, localSIPAddr, localIP, callerID, fromTag, toTag, callID, cseq+1)

	result["elapsed_ms"] = time.Since(start).Milliseconds()
	return result, nil
}

// faxSendBYE sends a BYE with proper in-dialog routing (RFC 3261 §12.2.1.1).
func faxSendBYE(conn *net.UDPConn, toURI, contactURI string, routes []string, localSIPAddr, localIP, callerID, fromTag, toTag, callID string, cseq int) {
	byeRequestURI := toURI
	if contactURI != "" {
		byeRequestURI = contactURI
	}
	byeBranch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
	toHeader := fmt.Sprintf("<%s>", toURI)
	if toTag != "" {
		toHeader = fmt.Sprintf("<%s>;tag=%s", toURI, toTag)
	}
	bye := buildSIPMessageWithExtra("BYE", byeRequestURI, map[string]string{
		"Via":           fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, byeBranch),
		"From":          fmt.Sprintf("<sip:%s@%s>;tag=%s", callerID, localIP, fromTag),
		"To":            toHeader,
		"Call-ID":       callID,
		"CSeq":          fmt.Sprintf("%d BYE", cseq),
		"Max-Forwards":  "70",
		"User-Agent":    remoteAgentUA("udp"),
		"Content-Length": "0",
	}, routes, "")
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	conn.Write([]byte(bye))
}

// ─── T.38 SDP ───────────────────────────────────────────────────────────────

func buildT38SDP(localIP string, udptlPort int, maxBitRate uint32) string {
	sessionID := fmt.Sprintf("%d", time.Now().Unix())
	return fmt.Sprintf(
		"v=0\r\n"+
			"o=SIPalyzer %s %s IN IP4 %s\r\n"+
			"s=SIPalyzer Fax\r\n"+
			"c=IN IP4 %s\r\n"+
			"t=0 0\r\n"+
			"m=image %d udptl t38\r\n"+
			"a=T38FaxVersion:0\r\n"+
			"a=T38MaxBitRate:%d\r\n"+
			"a=T38FaxRateManagement:transferredTCF\r\n"+
			"a=T38FaxMaxBuffer:1800\r\n"+
			"a=T38FaxMaxDatagram:512\r\n"+
			"a=T38FaxUdpEC:t38UDPRedundancy\r\n",
		sessionID, sessionID, localIP, localIP, udptlPort, maxBitRate,
	)
}

func parseSDPForUDPTL(sipResp string) *net.UDPAddr {
	idx := strings.Index(sipResp, "\r\n\r\n")
	if idx < 0 {
		return nil
	}
	sdp := sipResp[idx+4:]

	var ip string
	var port int

	for _, line := range strings.Split(sdp, "\r\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "c=IN IP4 ") {
			ip = strings.TrimPrefix(line, "c=IN IP4 ")
		}
		if strings.HasPrefix(line, "m=image ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				fmt.Sscanf(parts[1], "%d", &port)
			}
		}
		// Also check for audio (G.711 fallback for passthrough fax)
		if port == 0 && strings.HasPrefix(line, "m=audio ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				fmt.Sscanf(parts[1], "%d", &port)
			}
		}
	}

	if ip != "" && port > 0 {
		return &net.UDPAddr{IP: net.ParseIP(ip), Port: port}
	}
	return nil
}
