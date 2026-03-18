package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// remoteAgentUA returns a compact User-Agent string for SIP messages.
// Format: SIPalyzer-Agent/1.0 (macOS arm64; UDP) a3f8c291
func remoteAgentUA(transport string) string {
	osLabel := runtime.GOOS
	switch osLabel {
	case "darwin":
		osLabel = "macOS"
	case "windows":
		osLabel = "Windows"
	case "linux":
		osLabel = "Linux"
	}
	return fmt.Sprintf("SIPalyzer-Agent/1.0 (%s %s; %s) %s",
		osLabel, runtime.GOARCH, strings.ToUpper(transport), agentIDShort)
}

// ─── Active Registration Tracker ────────────────────────────────────────────
//
// When a SIP REGISTER succeeds (200 OK with Expires > 0), the registration is
// tracked. On agent shutdown or disconnect, unregisterAll() sends REGISTER
// with Expires: 0 for each active registration so the registrar releases them
// immediately instead of waiting for the natural expiry (typically 3600 s).

// activeReg holds the credentials and state needed to unregister later.
type activeReg struct {
	Registrar string
	Port      uint16
	Transport string
	Domain    string
	Username  string
	Password  string
	CallID    string // reuse the same Call-ID for the unregister
}

var (
	activeRegs   []activeReg
	activeRegsMu sync.Mutex
)

// trackRegistration records a successful registration for later cleanup.
func trackRegistration(p SipRegistrationTestParams, domain, callID string) {
	activeRegsMu.Lock()
	defer activeRegsMu.Unlock()
	// Avoid duplicates (same registrar + username)
	for i, r := range activeRegs {
		if r.Registrar == p.Registrar && r.Username == p.Username && r.Port == p.Port {
			activeRegs[i].Password = p.Password
			activeRegs[i].CallID = callID
			activeRegs[i].Domain = domain
			return
		}
	}
	activeRegs = append(activeRegs, activeReg{
		Registrar: p.Registrar,
		Port:      p.Port,
		Transport: p.Transport,
		Domain:    domain,
		Username:  p.Username,
		Password:  p.Password,
		CallID:    callID,
	})
}

// removeRegistration removes a tracked registration (e.g. after explicit unregister).
func removeRegistration(registrar, username string, port uint16) {
	activeRegsMu.Lock()
	defer activeRegsMu.Unlock()
	for i, r := range activeRegs {
		if r.Registrar == registrar && r.Username == username && r.Port == port {
			activeRegs = append(activeRegs[:i], activeRegs[i+1:]...)
			return
		}
	}
}

// unregisterAll sends REGISTER Expires: 0 for every tracked registration.
// Called on agent shutdown / disconnect. Best-effort — errors are logged but
// do not block shutdown.
func unregisterAll() {
	activeRegsMu.Lock()
	regs := make([]activeReg, len(activeRegs))
	copy(regs, activeRegs)
	activeRegs = nil
	activeRegsMu.Unlock()

	if len(regs) == 0 {
		return
	}
	log.Printf("[Agent] Unregistering %d active SIP registration(s)…", len(regs))

	var wg sync.WaitGroup
	for _, r := range regs {
		wg.Add(1)
		go func(r activeReg) {
			defer wg.Done()
			if err := sendUnregister(r); err != nil {
				log.Printf("[Agent] Unregister %s@%s:%d failed: %v", r.Username, r.Registrar, r.Port, err)
			} else {
				log.Printf("[Agent] Unregistered %s@%s:%d", r.Username, r.Registrar, r.Port)
			}
		}(r)
	}
	// Give a short deadline so we don't block shutdown forever
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		log.Println("[Agent] Unregister timeout — continuing shutdown")
	}
}

// sendUnregister sends a single REGISTER with Expires: 0 to the registrar.
func sendUnregister(r activeReg) error {
	addr := net.JoinHostPort(r.Registrar, fmt.Sprintf("%d", r.Port))
	raddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return fmt.Errorf("resolve: %w", err)
	}
	conn, err := net.DialUDP("udp", nil, raddr)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))

	localAddr := conn.LocalAddr().String()
	fromTag := fmt.Sprintf("%x", rand.Int31())
	branch1 := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
	transport := r.Transport
	if transport == "" {
		transport = "udp"
	}

	// Step 1: Send initial REGISTER Expires: 0 (no auth)
	reg1 := buildSIPMessage("REGISTER", fmt.Sprintf("sip:%s", r.Domain), map[string]string{
		"Via":           fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localAddr, branch1),
		"From":          fmt.Sprintf("<sip:%s@%s>;tag=%s", r.Username, r.Domain, fromTag),
		"To":            fmt.Sprintf("<sip:%s@%s>", r.Username, r.Domain),
		"Call-ID":       r.CallID,
		"CSeq":          "3 REGISTER",
		"Contact":       fmt.Sprintf("<sip:%s@%s>;expires=0", r.Username, localAddr),
		"Expires":       "0",
		"Max-Forwards":  "70",
		"User-Agent":    remoteAgentUA(transport),
		"Content-Length": "0",
	}, "")

	if _, err := conn.Write([]byte(reg1)); err != nil {
		return fmt.Errorf("write: %w", err)
	}

	resp1, err := readSIPResponse(conn)
	if err != nil {
		return fmt.Errorf("read: %w", err)
	}
	code, _ := parseSIPStatusLine(resp1)

	// If 200 — done (registrar didn't require auth for unregister)
	if code == "200" {
		return nil
	}

	// If 401/407 — authenticate
	if (code == "401" || code == "407") && r.Password != "" {
		headerName := "WWW-Authenticate"
		if code == "407" {
			headerName = "Proxy-Authenticate"
		}
		realm, nonce, algorithm, qop := parseDigestChallenge(resp1, headerName)
		if nonce == "" {
			return fmt.Errorf("no nonce in %s challenge", code)
		}

		uri := fmt.Sprintf("sip:%s", r.Domain)
		cnonce := fmt.Sprintf("%08x", rand.Int31())
		nc := "00000001"
		digest := computeDigestResponse(r.Username, realm, r.Password, "REGISTER", uri, nonce, algorithm, qop, cnonce, nc)

		authHeader := "Authorization"
		if code == "407" {
			authHeader = "Proxy-Authorization"
		}
		authValue := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s", algorithm=%s`,
			r.Username, realm, nonce, uri, digest, algorithm)
		if qop != "" {
			authValue += fmt.Sprintf(`, qop=%s, nc=%s, cnonce="%s"`, qop, nc, cnonce)
		}

		branch2 := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
		reg2 := buildSIPMessage("REGISTER", fmt.Sprintf("sip:%s", r.Domain), map[string]string{
			"Via":           fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localAddr, branch2),
			"From":          fmt.Sprintf("<sip:%s@%s>;tag=%s", r.Username, r.Domain, fromTag),
			"To":            fmt.Sprintf("<sip:%s@%s>", r.Username, r.Domain),
			"Call-ID":       r.CallID,
			"CSeq":          "4 REGISTER",
			"Contact":       fmt.Sprintf("<sip:%s@%s>;expires=0", r.Username, localAddr),
			"Expires":       "0",
			"Max-Forwards":  "70",
			"User-Agent":    remoteAgentUA(transport),
			authHeader:      authValue,
			"Content-Length": "0",
		}, "")

		if _, err := conn.Write([]byte(reg2)); err != nil {
			return fmt.Errorf("write auth: %w", err)
		}

		resp2, err := readSIPResponse(conn)
		if err != nil {
			return fmt.Errorf("read auth: %w", err)
		}
		code2, reason2 := parseSIPStatusLine(resp2)
		if code2 != "200" {
			return fmt.Errorf("unregister rejected: %s %s", code2, reason2)
		}
		return nil
	}

	return fmt.Errorf("unexpected response: %s", code)
}

// cancelAllActiveSessions cancels all running SIP calls, captures, and unregisters.
// Called on agent shutdown.
func cancelAllActiveSessions() {
	// Cancel active SIP calls and captures
	activeCallCancels.Range(func(key, value interface{}) bool {
		if cancel, ok := value.(context.CancelFunc); ok {
			cancel()
		}
		activeCallCancels.Delete(key)
		return true
	})

	// Unregister all SIP registrations
	unregisterAll()
}

// ─── SIP Registration Test ──────────────────────────────────────────────────

// RunSipRegistrationTest sends a SIP REGISTER via UDP with proper Digest auth.
// Flow: REGISTER → 401 → parse WWW-Authenticate → REGISTER with Authorization → 200.
func RunSipRegistrationTest(p SipRegistrationTestParams) (interface{}, error) {
	if p.Registrar == "" {
		return nil, fmt.Errorf("registrar is required")
	}
	if p.Port == 0 {
		p.Port = 5060
	}
	if p.Transport == "" {
		p.Transport = "udp"
	}
	if p.Transport != "udp" {
		return nil, fmt.Errorf("only UDP transport is supported")
	}

	domain := p.Registrar
	if p.Domain != nil && *p.Domain != "" {
		domain = *p.Domain
	}

	addr := net.JoinHostPort(p.Registrar, fmt.Sprintf("%d", p.Port))
	raddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", addr, err)
	}

	conn, err := net.DialUDP("udp", nil, raddr)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))

	localAddr := conn.LocalAddr().String()
	callID := fmt.Sprintf("%d@%s", time.Now().UnixNano(), domain)
	fromTag := fmt.Sprintf("%x", rand.Int31())
	start := time.Now()

	sipMessages := []map[string]interface{}{}
	addMsg := func(direction, method string, msg string) {
		sipMessages = append(sipMessages, map[string]interface{}{
			"direction":  direction,
			"method":     method,
			"elapsed_ms": time.Since(start).Milliseconds(),
			"message":    msg,
		})
	}

	expires := "3600"
	contactExpires := "expires=3600"
	action := "register"
	if p.Unregister {
		expires = "0"
		contactExpires = "expires=0"
		action = "unregister"
	}

	// Step 1: Send initial REGISTER (no auth)
	branch1 := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
	reg1 := buildSIPMessage("REGISTER", fmt.Sprintf("sip:%s", domain), map[string]string{
		"Via":            fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localAddr, branch1),
		"From":           fmt.Sprintf("<sip:%s@%s>;tag=%s", p.Username, domain, fromTag),
		"To":             fmt.Sprintf("<sip:%s@%s>", p.Username, domain),
		"Call-ID":        callID,
		"CSeq":           "1 REGISTER",
		"Contact":        fmt.Sprintf("<sip:%s@%s>;%s", p.Username, localAddr, contactExpires),
		"Expires":        expires,
		"Max-Forwards":   "70",
		"User-Agent":     remoteAgentUA(p.Transport),
		"Content-Length":  "0",
		"Allow":          "INVITE, ACK, CANCEL, BYE, NOTIFY, REFER, OPTIONS",
	}, "")

	_, err = conn.Write([]byte(reg1))
	if err != nil {
		return nil, fmt.Errorf("write REGISTER: %w", err)
	}
	addMsg("sent", "REGISTER", reg1)

	resp1, err := readSIPResponse(conn)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	statusCode, statusReason := parseSIPStatusLine(resp1)
	addMsg("recv", fmt.Sprintf("%s %s", statusCode, statusReason), resp1)

	// If we got 200 OK without auth, we're done
	if statusCode == "200" {
		if !p.Unregister {
			trackRegistration(p, domain, callID)
		} else {
			removeRegistration(p.Registrar, p.Username, p.Port)
		}
		return map[string]interface{}{
			"registrar":       p.Registrar,
			"port":            p.Port,
			"action":          action,
			"status":          statusCode,
			"reason":          statusReason,
			"authenticated":   false,
			"sip_messages":    sipMessages,
		}, nil
	}

	// Step 2: If 401/407, parse challenge and re-REGISTER with digest auth
	if (statusCode == "401" || statusCode == "407") && p.Password != "" {
		headerName := "WWW-Authenticate"
		if statusCode == "407" {
			headerName = "Proxy-Authenticate"
		}

		realm, nonce, algorithm, qop := parseDigestChallenge(resp1, headerName)
		if nonce == "" {
			return map[string]interface{}{
				"registrar":    p.Registrar,
				"port":         p.Port,
				"action":       action,
				"status":       statusCode,
				"reason":       statusReason + " (no nonce in challenge)",
				"sip_messages": sipMessages,
			}, nil
		}

		uri := fmt.Sprintf("sip:%s", domain)
		cnonce := fmt.Sprintf("%08x", rand.Int31())
		nc := "00000001"
		digestResponse := computeDigestResponse(p.Username, realm, p.Password, "REGISTER", uri, nonce, algorithm, qop, cnonce, nc)

		authHeader := "Authorization"
		if statusCode == "407" {
			authHeader = "Proxy-Authorization"
		}

		authValue := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s", algorithm=%s`,
			p.Username, realm, nonce, uri, digestResponse, algorithm)
		if qop != "" {
			authValue += fmt.Sprintf(`, qop=%s, nc=%s, cnonce="%s"`, qop, nc, cnonce)
		}

		branch2 := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
		reg2 := buildSIPMessage("REGISTER", fmt.Sprintf("sip:%s", domain), map[string]string{
			"Via":            fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localAddr, branch2),
			"From":           fmt.Sprintf("<sip:%s@%s>;tag=%s", p.Username, domain, fromTag),
			"To":             fmt.Sprintf("<sip:%s@%s>", p.Username, domain),
			"Call-ID":        callID,
			"CSeq":           "2 REGISTER",
			"Contact":        fmt.Sprintf("<sip:%s@%s>;%s", p.Username, localAddr, contactExpires),
			"Expires":        expires,
			"Max-Forwards":   "70",
			"User-Agent":     remoteAgentUA(p.Transport),
			authHeader:       authValue,
			"Content-Length":  "0",
			"Allow":          "INVITE, ACK, CANCEL, BYE, NOTIFY, REFER, OPTIONS",
		}, "")

		_, err = conn.Write([]byte(reg2))
		if err != nil {
			return nil, fmt.Errorf("write authenticated REGISTER: %w", err)
		}
		addMsg("sent", "REGISTER (auth)", reg2)

		resp2, err := readSIPResponse(conn)
		if err != nil {
			return nil, fmt.Errorf("read auth response: %w", err)
		}
		statusCode2, statusReason2 := parseSIPStatusLine(resp2)
		addMsg("recv", fmt.Sprintf("%s %s", statusCode2, statusReason2), resp2)

		if statusCode2 == "200" {
			if !p.Unregister {
				trackRegistration(p, domain, callID)
			} else {
				removeRegistration(p.Registrar, p.Username, p.Port)
			}
		}

		return map[string]interface{}{
			"registrar":       p.Registrar,
			"port":            p.Port,
			"action":          action,
			"status":          statusCode2,
			"reason":          statusReason2,
			"authenticated":   statusCode2 == "200",
			"challenge_realm": realm,
			"sip_messages":    sipMessages,
		}, nil
	}

	return map[string]interface{}{
		"registrar":    p.Registrar,
		"port":         p.Port,
		"action":       action,
		"status":       statusCode,
		"reason":       statusReason,
		"sip_messages": sipMessages,
	}, nil
}

// ─── SIP Probe ──────────────────────────────────────────────────────────────

func RunSipProbe(p SipProbeParams) (interface{}, error) {
	if p.Target == "" {
		return nil, fmt.Errorf("target is required")
	}
	if p.Port == 0 {
		p.Port = 5060
	}
	if p.Transport == "" {
		p.Transport = "udp"
	}
	if p.Method == "" {
		p.Method = "OPTIONS"
	}
	if p.Transport != "udp" {
		return nil, fmt.Errorf("only UDP transport is supported")
	}

	addr := net.JoinHostPort(p.Target, fmt.Sprintf("%d", p.Port))
	raddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", addr, err)
	}

	conn, err := net.DialUDP("udp", nil, raddr)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))

	localAddr := conn.LocalAddr().String()
	branch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
	fromTag := fmt.Sprintf("%x", rand.Int31())
	start := time.Now()

	sipMessages := []map[string]interface{}{}

	req := buildSIPMessage(p.Method, fmt.Sprintf("sip:%s", p.Target), map[string]string{
		"Via":            fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localAddr, branch),
		"From":           fmt.Sprintf("<sip:probe@%s>;tag=%s", p.Target, fromTag),
		"To":             fmt.Sprintf("<sip:probe@%s>", p.Target),
		"Call-ID":        fmt.Sprintf("%d@%s", time.Now().UnixNano(), p.Target),
		"CSeq":           fmt.Sprintf("1 %s", p.Method),
		"Max-Forwards":   "70",
		"User-Agent":     remoteAgentUA(p.Transport),
		"Content-Length":  "0",
	}, "")

	_, err = conn.Write([]byte(req))
	if err != nil {
		return nil, fmt.Errorf("write %s: %w", p.Method, err)
	}
	sipMessages = append(sipMessages, map[string]interface{}{
		"direction": "sent", "method": p.Method, "elapsed_ms": time.Since(start).Milliseconds(), "message": req,
	})

	resp, err := readSIPResponse(conn)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	code, reason := parseSIPStatusLine(resp)
	sipMessages = append(sipMessages, map[string]interface{}{
		"direction": "recv", "method": fmt.Sprintf("%s %s", code, reason), "elapsed_ms": time.Since(start).Milliseconds(), "message": resp,
	})

	return map[string]interface{}{
		"target":       p.Target,
		"port":         p.Port,
		"method":       p.Method,
		"status":       code,
		"reason":       reason,
		"sip_messages": sipMessages,
	}, nil
}

// ─── SIP Call (INVITE) ──────────────────────────────────────────────────────

// RunSipCall is the legacy synchronous entry point (used by dispatcher fallback).
func RunSipCall(p SipCallParams) (interface{}, error) {
	responses := RunSipCallWithContext(context.Background(), p, nil)
	for _, resp := range responses {
		if resp.Type == "Result" {
			if rd, ok := resp.Data.(ResultData); ok {
				return rd.Result, nil
			}
		}
		if resp.Type == "Error" {
			if ed, ok := resp.Data.(ErrorData); ok {
				return nil, fmt.Errorf("%s: %s", ed.Code, ed.Message)
			}
		}
	}
	return nil, fmt.Errorf("no result")
}

// ProgressSender is a callback for sending real-time progress to the controller.
type ProgressSender func(resp ToolResponse)

// RunSipCallWithContext is the full SIP call implementation with:
// - Context cancellation (for HangupCall)
// - Generated "this is a test call" audio instead of silence
// - PCAP recording of all SIP and RTP traffic
// - Real-time progress via onProgress callback
func RunSipCallWithContext(ctx context.Context, p SipCallParams, onProgress ProgressSender) []ToolResponse {
	start := time.Now()

	if p.Target == "" {
		return []ToolResponse{{Type: "Error", Data: ErrorData{Code: "SIP_CALL_ERROR", Message: "target is required"}}}
	}
	if p.ToUser == "" {
		return []ToolResponse{{Type: "Error", Data: ErrorData{Code: "SIP_CALL_ERROR", Message: "to_user (destination number/extension) is required"}}}
	}
	if p.Port == 0 {
		p.Port = 5060
	}
	if p.DurationSecs == 0 {
		p.DurationSecs = 10
	}
	if p.DurationSecs > 120 {
		p.DurationSecs = 120 // Safety cap
	}
	if p.CallerID == "" {
		p.CallerID = "testtool"
	}

	addr := net.JoinHostPort(p.Target, fmt.Sprintf("%d", p.Port))
	raddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return wrapCallError("SIP_CALL_ERROR", fmt.Sprintf("resolve %s: %v", addr, err), start)
	}

	// Open SIP signaling socket
	conn, err := net.DialUDP("udp", nil, raddr)
	if err != nil {
		return wrapCallError("SIP_CALL_ERROR", fmt.Sprintf("dial: %v", err), start)
	}
	defer conn.Close()

	localSIPAddr := conn.LocalAddr().String()
	localIP, _, _ := net.SplitHostPort(localSIPAddr)
	localIPParsed := net.ParseIP(localIP)
	remoteIPParsed := raddr.IP

	// Open RTP socket on a random port
	rtpListener, err := net.ListenPacket("udp4", localIP+":0")
	if err != nil {
		return wrapCallError("SIP_CALL_ERROR", fmt.Sprintf("rtp listen: %v", err), start)
	}
	defer rtpListener.Close()
	rtpLocalAddr := rtpListener.LocalAddr().(*net.UDPAddr)
	rtpPort := rtpLocalAddr.Port

	callID := fmt.Sprintf("%d@%s", time.Now().UnixNano(), localIP)
	fromTag := fmt.Sprintf("%x", rand.Int31())
	branch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())

	result := map[string]interface{}{
		"target":    p.Target,
		"port":      p.Port,
		"caller_id": p.CallerID,
		"to_user":   p.ToUser,
		"duration":  p.DurationSecs,
	}

	// PCAP builder — records all SIP and RTP packets for download
	pcap := NewPcapBuilder()

	// Collect all SIP messages for the trace
	sipMessages := []map[string]interface{}{}
	addMsg := func(direction, method string, msg string) {
		sipMessages = append(sipMessages, map[string]interface{}{
			"direction":  direction,
			"method":     method,
			"elapsed_ms": time.Since(start).Milliseconds(),
			"message":    msg,
		})
		// Record in PCAP
		now := time.Now()
		if direction == "sent" {
			pcap.AddUDPPacket(now, localIPParsed, uint16(conn.LocalAddr().(*net.UDPAddr).Port), remoteIPParsed, p.Port, []byte(msg))
		} else {
			pcap.AddUDPPacket(now, remoteIPParsed, p.Port, localIPParsed, uint16(conn.LocalAddr().(*net.UDPAddr).Port), []byte(msg))
		}
	}

	// Build SDP offer
	sdp := buildSDPOffer(localIP, rtpPort)

	// Build INVITE
	domain := p.Target
	if p.Domain != nil && *p.Domain != "" {
		domain = *p.Domain
	}
	toURI := fmt.Sprintf("sip:%s@%s", p.ToUser, domain)

	fromUser := p.CallerID
	if p.Username != "" {
		fromUser = p.Username
	}

	invite := buildSIPMessage("INVITE", toURI, map[string]string{
		"Via":            fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, branch),
		"From":           fmt.Sprintf("<sip:%s@%s>;tag=%s", fromUser, domain, fromTag),
		"To":             fmt.Sprintf("<%s>", toURI),
		"Call-ID":        callID,
		"CSeq":           "1 INVITE",
		"Contact":        fmt.Sprintf("<sip:%s@%s>", fromUser, localSIPAddr),
		"Max-Forwards":   "70",
		"User-Agent":     remoteAgentUA("udp"),
		"Content-Type":   "application/sdp",
		"Content-Length":  fmt.Sprintf("%d", len(sdp)),
		"Allow":          "INVITE, ACK, CANCEL, BYE, NOTIFY, REFER, OPTIONS",
	}, sdp)

	conn.SetDeadline(time.Now().Add(30 * time.Second))
	_, err = conn.Write([]byte(invite))
	if err != nil {
		return wrapCallError("SIP_CALL_ERROR", fmt.Sprintf("write INVITE: %v", err), start)
	}
	addMsg("sent", "INVITE", invite)

	result["invite_sent"] = true
	result["rtp_port"] = rtpPort

	// Send progress events in real-time via the callback
	emitProgress := func(state string, extra map[string]interface{}) {
		if onProgress == nil {
			return
		}
		partial := map[string]interface{}{"state": state, "elapsed_ms": time.Since(start).Milliseconds()}
		for k, v := range extra {
			partial[k] = v
		}
		onProgress(ToolResponse{
			Type: "Progress",
			Data: ProgressData{Message: state, Partial: partial},
		})
	}
	emitProgress("trying", nil)

	// Read responses until we get a final response
	var toTag string
	var remoteRTPAddr *net.UDPAddr
	var dialogRoutes []string // Route headers derived from Record-Route
	var remoteContactURI string
	gotAnswer := false
	events := []map[string]interface{}{}
	cseq := 1
	hungUp := false

	for {
		// Check context before blocking on read
		select {
		case <-ctx.Done():
			hungUp = true
			result["status"] = "487"
			result["reason"] = "Request Terminated (hangup)"
			goto finalize
		default:
		}

		// Refresh deadline before each read so the user has time to answer.
		// The original single SetDeadline was an absolute timeout that could
		// expire while waiting for 200 OK after receiving 100 Trying.
		conn.SetDeadline(time.Now().Add(30 * time.Second))
		resp, err := readSIPResponse(conn)
		if err != nil {
			result["error"] = fmt.Sprintf("read response: %v", err)
			break
		}
		code, reason := parseSIPStatusLine(resp)
		addMsg("recv", fmt.Sprintf("%s %s", code, reason), resp)

		event := map[string]interface{}{
			"status":     code,
			"reason":     reason,
			"elapsed_ms": time.Since(start).Milliseconds(),
		}

		if toTag == "" {
			toTag = extractHeaderParam(resp, "To", "tag")
		}

		switch {
		case code == "100":
			event["type"] = "trying"
			events = append(events, event)
			continue

		case code == "180" || code == "183":
			event["type"] = "ringing"
			events = append(events, event)
			result["ring_time_ms"] = time.Since(start).Milliseconds()
			emitProgress("ringing", nil)
			continue

		case code == "200":
			event["type"] = "answered"
			events = append(events, event)
			gotAnswer = true
			result["answer_time_ms"] = time.Since(start).Milliseconds()
			emitProgress("answered", map[string]interface{}{"answer_time_ms": time.Since(start).Milliseconds()})

			remoteRTPAddr = parseSDPForRTP(resp)

			// Extract dialog routing info from the 200 OK (RFC 3261 §12.1.2)
			dialogRoutes = extractRecordRoutes(resp)
			if contactURI := extractContactURI(resp); contactURI != "" {
				remoteContactURI = contactURI
			}

			// Determine the request URI for in-dialog requests
			ackURI := toURI
			if remoteContactURI != "" {
				ackURI = remoteContactURI
			}

			ackBranch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
			toHeader := fmt.Sprintf("<%s>", toURI)
			if toTag != "" {
				toHeader = fmt.Sprintf("<%s>;tag=%s", toURI, toTag)
			}
			ack := buildSIPMessageWithExtra("ACK", ackURI, map[string]string{
				"Via":            fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, ackBranch),
				"From":           fmt.Sprintf("<sip:%s@%s>;tag=%s", fromUser, domain, fromTag),
				"To":             toHeader,
				"Call-ID":        callID,
				"CSeq":           fmt.Sprintf("%d ACK", cseq),
				"Max-Forwards":   "70",
				"User-Agent":     remoteAgentUA("udp"),
				"Content-Length":  "0",
			}, dialogRoutes, "")
			conn.Write([]byte(ack))
			addMsg("sent", "ACK", ack)

		case code == "401" || code == "407":
			if p.Username != "" && p.Password != "" {
				headerName := "WWW-Authenticate"
				authHeaderName := "Authorization"
				if code == "407" {
					headerName = "Proxy-Authenticate"
					authHeaderName = "Proxy-Authorization"
				}

				realm, nonce, algorithm, qop := parseDigestChallenge(resp, headerName)
				if nonce != "" {
					uri := toURI
					cnonce := fmt.Sprintf("%08x", rand.Int31())
					nc := "00000001"
					digestResponse := computeDigestResponse(p.Username, realm, p.Password, "INVITE", uri, nonce, algorithm, qop, cnonce, nc)
					authValue := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s", algorithm=%s`,
						p.Username, realm, nonce, uri, digestResponse, algorithm)
					if qop != "" {
						authValue += fmt.Sprintf(`, qop=%s, nc=%s, cnonce="%s"`, qop, nc, cnonce)
					}

					ackBranch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
					ack := buildSIPMessage("ACK", toURI, map[string]string{
						"Via":            fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, ackBranch),
						"From":           fmt.Sprintf("<sip:%s@%s>;tag=%s", fromUser, domain, fromTag),
						"To":             fmt.Sprintf("<%s>", toURI),
						"Call-ID":        callID,
						"CSeq":           fmt.Sprintf("%d ACK", cseq),
						"Max-Forwards":   "70",
						"Content-Length":  "0",
					}, "")
					conn.Write([]byte(ack))
					addMsg("sent", "ACK (auth)", ack)

					cseq++
					branch2 := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
					reInvite := buildSIPMessage("INVITE", toURI, map[string]string{
						"Via":             fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, branch2),
						"From":            fmt.Sprintf("<sip:%s@%s>;tag=%s", fromUser, domain, fromTag),
						"To":              fmt.Sprintf("<%s>", toURI),
						"Call-ID":         callID,
						"CSeq":            fmt.Sprintf("%d INVITE", cseq),
						"Contact":         fmt.Sprintf("<sip:%s@%s>", fromUser, localSIPAddr),
						"Max-Forwards":    "70",
						"User-Agent":      remoteAgentUA("udp"),
						authHeaderName:    authValue,
						"Content-Type":    "application/sdp",
						"Content-Length":   fmt.Sprintf("%d", len(sdp)),
						"Allow":           "INVITE, ACK, CANCEL, BYE, NOTIFY, REFER, OPTIONS",
					}, sdp)
					conn.Write([]byte(reInvite))
					addMsg("sent", "INVITE (auth)", reInvite)

					event["type"] = "auth_challenge"
					events = append(events, event)
					continue
				}
			}
			event["type"] = "auth_failed"
			events = append(events, event)
			result["status"] = code
			result["reason"] = reason

		default:
			event["type"] = "final"
			events = append(events, event)
			result["status"] = code
			result["reason"] = reason
		}
		break
	}

finalize:
	result["events"] = events
	result["sip_messages"] = sipMessages

	// If hangup was requested before the call was answered, send CANCEL
	if hungUp && !gotAnswer {
		log.Printf("[SIP] Sending CANCEL (pre-answer hangup)")
		cancelBranch := branch // Use the same branch as the INVITE
		cancel := buildSIPMessage("CANCEL", toURI, map[string]string{
			"Via":            fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, cancelBranch),
			"From":           fmt.Sprintf("<sip:%s@%s>;tag=%s", fromUser, domain, fromTag),
			"To":             fmt.Sprintf("<%s>", toURI),
			"Call-ID":        callID,
			"CSeq":           fmt.Sprintf("%d CANCEL", cseq),
			"Max-Forwards":   "70",
			"User-Agent":     remoteAgentUA("udp"),
			"Content-Length":  "0",
		}, "")
		conn.SetDeadline(time.Now().Add(2 * time.Second))
		conn.Write([]byte(cancel))
		addMsg("sent", "CANCEL", cancel)
		// Read response (best-effort)
		conn.SetDeadline(time.Now().Add(2 * time.Second))
		if resp, err := readSIPResponse(conn); err == nil {
			code, _ := parseSIPStatusLine(resp)
			addMsg("recv", fmt.Sprintf("%s (CANCEL)", code), resp)
			result["cancel_status"] = code
		}
	}

	if gotAnswer {
		result["status"] = "200"
		result["reason"] = "OK"

		// Pre-generate TTS audio (cached after first call) and record the event
		GenerateTestCallAudio()
		ttsI := GetTTSInfo()
		ttsLabel := fmt.Sprintf("TTS via %s", ttsI.Engine)
		if ttsI.Source == "embedded" {
			ttsLabel = "TTS (embedded fallback)"
		}
		events = append(events, map[string]interface{}{
			"type":       "tts_ready",
			"status":     ttsLabel,
			"reason":     fmt.Sprintf("\"%s\" · %.1fs audio", ttsI.Text, ttsI.AudioSecs),
			"elapsed_ms": time.Since(start).Milliseconds(),
		})
		result["events"] = events

		// Send generated "this is a test call" audio (loops for duration)
		emitProgress("sending_audio", map[string]interface{}{"duration_secs": p.DurationSecs})
		rtpStats := sendRTPAudio(ctx, rtpListener, remoteRTPAddr, p.DurationSecs, pcap, localIPParsed, uint16(rtpPort), onProgress)
		result["rtp"] = rtpStats

		if rtpStats["hangup"] == true {
			hungUp = true
			log.Printf("[SIP] RTP stopped by hangup, proceeding to send BYE")
			events = append(events, map[string]interface{}{
				"type":       "hangup",
				"status":     "BYE",
				"reason":     "Remote hangup",
				"elapsed_ms": time.Since(start).Milliseconds(),
			})
			result["events"] = events
		}

		// Drain any stale SIP messages (e.g. retransmitted 200 OK) from the
		// read buffer before sending BYE. Without this, readSIPResponse after
		// BYE could return a queued 200 OK instead of the BYE response.
		conn.SetDeadline(time.Now().Add(100 * time.Millisecond))
		for {
			stale, err := readSIPResponse(conn)
			if err != nil {
				break
			}
			log.Printf("[SIP] Drained stale message while preparing BYE: %.40s…", stale)
		}

		// Send BYE with retransmission (RFC 3261 §17.1.1.2 non-INVITE client transaction)
		cseq++
		byeBranch := fmt.Sprintf("z9hG4bK-%d", time.Now().UnixNano())
		toHeader := fmt.Sprintf("<%s>", toURI)
		if toTag != "" {
			toHeader = fmt.Sprintf("<%s>;tag=%s", toURI, toTag)
		}
		// Use the remote Contact URI as the BYE request URI (RFC 3261 §12.2.1.1)
		byeURI := toURI
		if remoteContactURI != "" {
			byeURI = remoteContactURI
		}
		bye := buildSIPMessageWithExtra("BYE", byeURI, map[string]string{
			"Via":            fmt.Sprintf("SIP/2.0/UDP %s;branch=%s;rport", localSIPAddr, byeBranch),
			"From":           fmt.Sprintf("<sip:%s@%s>;tag=%s", fromUser, domain, fromTag),
			"To":             toHeader,
			"Call-ID":        callID,
			"CSeq":           fmt.Sprintf("%d BYE", cseq),
			"Max-Forwards":   "70",
			"User-Agent":     remoteAgentUA("udp"),
			"Content-Length":  "0",
		}, dialogRoutes, "")

		byeReceived := false
		byeRetries := 3
		for attempt := 0; attempt < byeRetries; attempt++ {
			conn.SetDeadline(time.Now().Add(2 * time.Second))
			if _, wErr := conn.Write([]byte(bye)); wErr != nil {
				log.Printf("[SIP] BYE write error (attempt %d): %v", attempt+1, wErr)
				break
			}
			if attempt == 0 {
				addMsg("sent", "BYE", bye)
			} else {
				log.Printf("[SIP] BYE retransmit attempt %d/%d", attempt+1, byeRetries)
			}

			// Read response — look for a response matching our BYE CSeq
			conn.SetDeadline(time.Now().Add(2 * time.Second))
			byeResp, rErr := readSIPResponse(conn)
			if rErr != nil {
				continue // timeout → retransmit
			}
			byeCode, _ := parseSIPStatusLine(byeResp)
			addMsg("recv", fmt.Sprintf("%s (BYE)", byeCode), byeResp)

			// Accept any final response (2xx, 4xx, etc.) as acknowledgement
			if code, _ := strconv.Atoi(byeCode); code >= 200 {
				result["bye_status"] = byeCode
				byeReceived = true
				break
			}
		}
		if !byeReceived {
			log.Printf("[SIP] BYE response not received after %d attempts", byeRetries)
			result["bye_status"] = "timeout"
		}

		result["call_duration_ms"] = time.Since(start).Milliseconds()
		result["sip_messages"] = sipMessages
	}

	result["elapsed_ms"] = time.Since(start).Milliseconds()
	result["hung_up"] = hungUp

	// Build PCAP and include as base64 in result
	if pcap.PacketCount() > 0 {
		pcapBytes := pcap.Build()
		result["pcap_base64"] = base64.StdEncoding.EncodeToString(pcapBytes)
		result["pcap_packets"] = pcap.PacketCount()
	}

	emitProgress("completed", map[string]interface{}{
		"duration_ms": time.Since(start).Milliseconds(),
		"hung_up":     hungUp,
	})

	return []ToolResponse{{
		Type: "Result",
		Data: ResultData{
			Success:   true,
			Result:    result,
			ElapsedMs: uint64(time.Since(start).Milliseconds()),
		},
	}}
}

func wrapCallError(code, msg string, start time.Time) []ToolResponse {
	return []ToolResponse{{
		Type: "Error",
		Data: ErrorData{Code: code, Message: msg},
	}}
}

// ─── RTP ────────────────────────────────────────────────────────────────────

// rtpMetrics tracks running RTP quality statistics for periodic reporting.
type rtpMetrics struct {
	mu sync.Mutex

	// Send stats
	packetsSent int
	bytesSent   int
	sendPeak    float64 // peak µ-law amplitude (0-1 normalized)

	// Receive stats
	packetsRecv    int
	bytesRecv      int
	recvPeak       float64
	packetsLost    int
	lastRecvSeq    int64 // -1 = none yet
	maxRecvSeq     uint16
	seqWrap        int

	// Jitter (RFC 3550 §6.4.1 interarrival jitter)
	lastRecvTS     uint32
	lastRecvTime   time.Time
	jitterEstimate float64

	// History for time-series
	jitterHistory []float64
	jitterTimes   []float64
	startTime     time.Time
}

func newRtpMetrics() *rtpMetrics {
	return &rtpMetrics{lastRecvSeq: -1, startTime: time.Now()}
}

func (m *rtpMetrics) recordSend(payload []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.packetsSent++
	m.bytesSent += len(payload) + 12

	peak := ulawPeak(payload)
	if peak > m.sendPeak {
		m.sendPeak = peak
	}
}

func (m *rtpMetrics) recordRecv(pkt []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(pkt) < 12 {
		return
	}
	m.packetsRecv++
	m.bytesRecv += len(pkt)

	// Extract payload for peak measurement
	payload := pkt[12:]
	peak := ulawPeak(payload)
	if peak > m.recvPeak {
		m.recvPeak = peak
	}

	// Sequence number for loss detection
	seq := uint16(pkt[2])<<8 | uint16(pkt[3])
	if m.lastRecvSeq < 0 {
		m.lastRecvSeq = int64(seq)
		m.maxRecvSeq = seq
	} else {
		// Handle wrap-around
		prev := m.maxRecvSeq
		diff := int32(seq) - int32(prev)
		if diff < -0x8000 {
			diff += 0x10000
			m.seqWrap++
		}
		if diff > 0 {
			gap := int(diff) - 1
			if gap > 0 {
				m.packetsLost += gap
			}
			m.maxRecvSeq = seq
		}
	}

	// Jitter calculation (RFC 3550)
	rtpTS := uint32(pkt[4])<<24 | uint32(pkt[5])<<16 | uint32(pkt[6])<<8 | uint32(pkt[7])
	now := time.Now()
	if !m.lastRecvTime.IsZero() {
		transitPrev := float64(m.lastRecvTime.UnixNano())/1e6 - float64(m.lastRecvTS)/8.0
		transitCurr := float64(now.UnixNano())/1e6 - float64(rtpTS)/8.0
		d := math.Abs(transitCurr - transitPrev)
		m.jitterEstimate += (d - m.jitterEstimate) / 16.0
	}
	m.lastRecvTS = rtpTS
	m.lastRecvTime = now

	// Record jitter sample
	m.jitterHistory = append(m.jitterHistory, m.jitterEstimate)
	m.jitterTimes = append(m.jitterTimes, now.Sub(m.startTime).Seconds())
}

// snapshot returns the current metrics as a map matching the frontend CallSavedMetrics shape.
func (m *rtpMetrics) snapshot() map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()

	totalExpected := m.packetsRecv + m.packetsLost
	var lossPct float64
	if totalExpected > 0 {
		lossPct = float64(m.packetsLost) / float64(totalExpected) * 100.0
	}

	// ITU-T E-model simplified MOS estimate (R-factor → MOS)
	jitterMs := m.jitterEstimate
	effectiveLatency := 20.0 + jitterMs*2 + 10.0 // assume ~10ms one-way + 20ms packetization
	var rFactor float64
	if effectiveLatency < 160 {
		rFactor = 93.2 - effectiveLatency/40.0
	} else {
		rFactor = 93.2 - (effectiveLatency-120.0)/10.0
	}
	rFactor -= lossPct * 2.5
	if rFactor < 0 {
		rFactor = 0
	}

	var mos float64
	if rFactor < 6.5 {
		mos = 1.0
	} else if rFactor > 100 {
		mos = 4.5
	} else {
		mos = 1.0 + 0.035*rFactor + rFactor*(rFactor-60.0)*(100.0-rFactor)*7e-6
	}

	return map[string]interface{}{
		"mos":          math.Round(mos*100) / 100,
		"jitter_ms":    math.Round(jitterMs*100) / 100,
		"send_peak":    math.Round(m.sendPeak*1000) / 1000,
		"recv_peak":    math.Round(m.recvPeak*1000) / 1000,
		"loss_percent": math.Round(lossPct*100) / 100,
		"lost_packets": m.packetsLost,
	}
}

// counts returns [packetsSent, bytesSent, packetsRecv] thread-safely.
func (m *rtpMetrics) counts() [3]int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return [3]int{m.packetsSent, m.bytesSent, m.packetsRecv}
}

// jitterSnap returns the jitter history for charting.
func (m *rtpMetrics) jitterSnap() ([]float64, []float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t := make([]float64, len(m.jitterTimes))
	j := make([]float64, len(m.jitterHistory))
	copy(t, m.jitterTimes)
	copy(j, m.jitterHistory)
	return t, j
}

// ulawPeak measures the peak amplitude of µ-law encoded audio (0.0–1.0).
func ulawPeak(payload []byte) float64 {
	var peak float64
	for _, b := range payload {
		// µ-law decode approximation: larger decoded values = louder
		linear := ulawDecode(b)
		amp := math.Abs(float64(linear)) / 32768.0
		if amp > peak {
			peak = amp
		}
	}
	return peak
}

// ulawDecode converts a µ-law byte to a 16-bit linear PCM sample.
func ulawDecode(u byte) int16 {
	u = ^u
	sign := int16(1)
	if u&0x80 != 0 {
		sign = -1
		u &= 0x7F
	}
	exponent := (u >> 4) & 0x07
	mantissa := u & 0x0F
	sample := int16((int16(mantissa)<<1 | 1) << (exponent + 2))
	return sign * sample
}

// sendRTPAudio sends generated "this is a test call" audio (looping) at 20ms intervals.
// It concurrently receives incoming RTP, measures jitter/loss/MOS, and emits periodic
// metrics progress events via onProgress. Returns aggregate stats.
func sendRTPAudio(ctx context.Context, pc net.PacketConn, remoteAddr *net.UDPAddr, durationSecs uint32, pcap *PcapBuilder, localIP net.IP, localRTPPort uint16, onProgress ProgressSender) map[string]interface{} {
	stats := map[string]interface{}{
		"codec":        "PCMU",
		"packets_sent": 0,
		"bytes_sent":   0,
	}

	if remoteAddr == nil {
		stats["error"] = "no remote RTP address"
		return stats
	}

	metrics := newRtpMetrics()

	// Generate the test call audio buffer (µ-law, 8kHz)
	audioBuffer := GenerateTestCallAudio()
	ttsInfo := GetTTSInfo()
	stats["tts_source"] = ttsInfo.Source
	stats["tts_engine"] = ttsInfo.Engine
	stats["tts_text"] = ttsInfo.Text
	stats["tts_gen_ms"] = ttsInfo.DurationMs
	stats["tts_audio_secs"] = fmt.Sprintf("%.2f", ttsInfo.AudioSecs)
	audioLen := len(audioBuffer)
	audioOffset := 0

	// RTP header: V=2, PT=0 (PCMU), 12 bytes
	rtpHeader := make([]byte, 12)
	rtpHeader[0] = 0x80 // Version 2
	rtpHeader[1] = 0    // PT=0 (PCMU)
	ssrc := rand.Uint32()
	rtpHeader[8] = byte(ssrc >> 24)
	rtpHeader[9] = byte(ssrc >> 16)
	rtpHeader[10] = byte(ssrc >> 8)
	rtpHeader[11] = byte(ssrc)

	packet := make([]byte, 12+160)
	copy(packet, rtpHeader)

	seq := uint16(0)
	timestamp := uint32(0)
	deadline := time.Now().Add(time.Duration(durationSecs) * time.Second)
	sendTicker := time.NewTicker(20 * time.Millisecond)
	defer sendTicker.Stop()

	// Periodic metrics reporting (every 2s)
	metricsTicker := time.NewTicker(2 * time.Second)
	defer metricsTicker.Stop()

	// Receive goroutine — stopped by closing the socket (pc.Close())
	recvDone := make(chan struct{})
	go func() {
		defer close(recvDone)
		buf := make([]byte, 2048)
		for {
			pc.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					continue
				}
				return // socket closed or fatal error
			}
			if n >= 12 {
				pktCopy := make([]byte, n)
				copy(pktCopy, buf[:n])
				metrics.recordRecv(pktCopy)
				srcIP := net.ParseIP("0.0.0.0")
				srcPort := uint16(0)
				if udpAddr, ok := addr.(*net.UDPAddr); ok {
					srcIP = udpAddr.IP
					srcPort = uint16(udpAddr.Port)
				}
				pcap.AddUDPPacket(time.Now(), srcIP, srcPort, localIP, localRTPPort, pktCopy)
			}
		}
	}()

	emitMetrics := func() {
		if onProgress == nil {
			return
		}
		snap := metrics.snapshot()
		jT, jJ := metrics.jitterSnap()
		snap["state"] = "metrics"
		snap["jitter_history_t"] = jT
		snap["jitter_history_j"] = jJ
		onProgress(ToolResponse{
			Type: "Progress",
			Data: ProgressData{Message: "metrics", Partial: snap},
		})
	}

	for {
		select {
		case <-ctx.Done():
			// Remote hangup via HangupCall command.
			// Close the RTP socket to unblock the receive goroutine, then wait for it.
			pc.Close()
			<-recvDone
			emitMetrics() // Final metrics snapshot
			snap := metrics.snapshot()
			sendRecv := metrics.counts()
			stats["packets_sent"] = sendRecv[0]
			stats["bytes_sent"] = sendRecv[1]
			stats["packets_recv"] = sendRecv[2]
			stats["hangup"] = true
			stats["final_metrics"] = snap
			return stats

		case <-metricsTicker.C:
			emitMetrics()

		case <-sendTicker.C:
			sendRecv := metrics.counts()
			if time.Now().After(deadline) {
				// Close the RTP socket to unblock the receive goroutine, then wait for it.
				pc.Close()
				<-recvDone
				emitMetrics() // Final metrics snapshot
				stats["packets_sent"] = sendRecv[0]
				stats["bytes_sent"] = sendRecv[1]
				stats["packets_recv"] = sendRecv[2]
				stats["final_metrics"] = metrics.snapshot()
				return stats
			}

			// Fill payload from audio buffer (loop when exhausted)
			for i := 0; i < 160; i++ {
				packet[12+i] = audioBuffer[audioOffset]
				audioOffset++
				if audioOffset >= audioLen {
					audioOffset = 0 // Loop the audio
				}
			}

			// Update sequence number and timestamp
			seq++
			timestamp += 160
			packet[2] = byte(seq >> 8)
			packet[3] = byte(seq)
			packet[4] = byte(timestamp >> 24)
			packet[5] = byte(timestamp >> 16)
			packet[6] = byte(timestamp >> 8)
			packet[7] = byte(timestamp)

			n, err := pc.WriteTo(packet, remoteAddr)
			if err != nil {
				pc.Close()
				<-recvDone
				sc := metrics.counts()
				stats["error"] = err.Error()
				stats["packets_sent"] = sc[0]
				stats["bytes_sent"] = sc[1]
				stats["packets_recv"] = sc[2]
				stats["final_metrics"] = metrics.snapshot()
				return stats
			}
			_ = n
			metrics.recordSend(packet[12:])

			// Record RTP packet in PCAP
			pktCopy := make([]byte, len(packet))
			copy(pktCopy, packet)
			pcap.AddUDPPacket(time.Now(), localIP, localRTPPort, remoteAddr.IP, uint16(remoteAddr.Port), pktCopy)
		}
	}
}

// ─── SDP ────────────────────────────────────────────────────────────────────

func buildSDPOffer(localIP string, rtpPort int) string {
	sessionID := fmt.Sprintf("%d", time.Now().Unix())
	return fmt.Sprintf(
		"v=0\r\n"+
			"o=SIPalyzer %s %s IN IP4 %s\r\n"+
			"s=SIPalyzer Call\r\n"+
			"c=IN IP4 %s\r\n"+
			"t=0 0\r\n"+
			"m=audio %d RTP/AVP 0 8 101\r\n"+
			"a=rtpmap:0 PCMU/8000\r\n"+
			"a=rtpmap:8 PCMA/8000\r\n"+
			"a=rtpmap:101 telephone-event/8000\r\n"+
			"a=fmtp:101 0-16\r\n"+
			"a=sendrecv\r\n"+
			"a=ptime:20\r\n",
		sessionID, sessionID, localIP, localIP, rtpPort,
	)
}

func parseSDPForRTP(sipResp string) *net.UDPAddr {
	// Find SDP body after double CRLF
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
		if strings.HasPrefix(line, "m=audio ") {
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

// ─── SIP Helpers ────────────────────────────────────────────────────────────

// buildSIPMessage constructs a SIP message with ordered headers.
func buildSIPMessage(method, requestURI string, headers map[string]string, body string) string {
	return buildSIPMessageWithExtra(method, requestURI, headers, nil, body)
}

func buildSIPMessageWithExtra(method, requestURI string, headers map[string]string, extraHeaders []string, body string) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("%s %s SIP/2.0\r\n", method, requestURI))

	order := []string{"Via", "Route", "From", "To", "Call-ID", "CSeq", "Contact",
		"Expires", "Max-Forwards", "User-Agent", "Authorization", "Proxy-Authorization",
		"Content-Type", "Content-Length", "Allow"}

	written := map[string]bool{}
	for _, key := range order {
		if val, ok := headers[key]; ok {
			b.WriteString(fmt.Sprintf("%s: %s\r\n", key, val))
			written[key] = true
		}
	}
	for key, val := range headers {
		if !written[key] {
			b.WriteString(fmt.Sprintf("%s: %s\r\n", key, val))
		}
	}
	for _, h := range extraHeaders {
		b.WriteString(h)
		b.WriteString("\r\n")
	}
	b.WriteString("\r\n")
	if body != "" {
		b.WriteString(body)
	}
	return b.String()
}

// extractRecordRoutes extracts all Record-Route headers from a SIP response
// and returns them as Route headers in reversed order (per RFC 3261 §12.1.2).
func extractRecordRoutes(sipMsg string) []string {
	var recordRoutes []string
	for _, line := range strings.Split(sipMsg, "\r\n") {
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "record-route:") {
			val := strings.TrimSpace(line[len("Record-Route:"):])
			recordRoutes = append(recordRoutes, val)
		}
	}
	// Reverse the order for Route headers in requests
	for i, j := 0, len(recordRoutes)-1; i < j; i, j = i+1, j-1 {
		recordRoutes[i], recordRoutes[j] = recordRoutes[j], recordRoutes[i]
	}
	var routes []string
	for _, rr := range recordRoutes {
		routes = append(routes, fmt.Sprintf("Route: %s", rr))
	}
	return routes
}

// extractContactURI extracts the Contact header URI from a SIP response,
// to use as the request-URI for in-dialog requests when routes exist.
func extractContactURI(sipMsg string) string {
	for _, line := range strings.Split(sipMsg, "\r\n") {
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "contact:") {
			val := strings.TrimSpace(line[len("Contact:"):])
			// Extract URI from <uri> or bare uri
			if start := strings.Index(val, "<"); start >= 0 {
				if end := strings.Index(val[start:], ">"); end >= 0 {
					return val[start+1 : start+end]
				}
			}
			return strings.TrimSpace(strings.SplitN(val, ";", 2)[0])
		}
	}
	return ""
}

func readSIPResponse(conn *net.UDPConn) (string, error) {
	buf := make([]byte, 8192)
	n, _, err := conn.ReadFromUDP(buf)
	if err != nil {
		return "", err
	}
	return string(buf[:n]), nil
}

func parseSIPStatusLine(resp string) (string, string) {
	lines := strings.SplitN(resp, "\r\n", 2)
	if len(lines) == 0 {
		return "0", ""
	}
	parts := strings.SplitN(lines[0], " ", 3)
	if len(parts) >= 3 {
		return parts[1], parts[2]
	}
	return "0", ""
}

func extractHeaderParam(sipMsg, header, param string) string {
	for _, line := range strings.Split(sipMsg, "\r\n") {
		if len(line) > len(header)+2 && strings.HasPrefix(strings.ToLower(line), strings.ToLower(header)+":") {
			val := strings.TrimSpace(line[len(header)+1:])
			for _, part := range strings.Split(val, ";") {
				part = strings.TrimSpace(part)
				if strings.HasPrefix(part, param+"=") {
					return strings.Trim(strings.TrimPrefix(part, param+"="), "\"")
				}
			}
		}
	}
	return ""
}

// ─── Digest Auth ────────────────────────────────────────────────────────────

func parseDigestChallenge(sipMsg, headerName string) (realm, nonce, algorithm, qop string) {
	algorithm = "MD5" // default
	for _, line := range strings.Split(sipMsg, "\r\n") {
		lower := strings.ToLower(line)
		if !strings.HasPrefix(lower, strings.ToLower(headerName)+":") {
			continue
		}
		val := strings.TrimSpace(line[len(headerName)+1:])
		val = strings.TrimPrefix(val, "Digest ")
		val = strings.TrimPrefix(val, "digest ")

		for _, part := range splitDigestParams(val) {
			part = strings.TrimSpace(part)
			kv := strings.SplitN(part, "=", 2)
			if len(kv) != 2 {
				continue
			}
			key := strings.ToLower(strings.TrimSpace(kv[0]))
			value := strings.Trim(strings.TrimSpace(kv[1]), "\"")
			switch key {
			case "realm":
				realm = value
			case "nonce":
				nonce = value
			case "algorithm":
				algorithm = value
			case "qop":
				qop = value
			}
		}
		break
	}
	return
}

// splitDigestParams splits comma-separated params, respecting quoted strings.
func splitDigestParams(s string) []string {
	var parts []string
	var current strings.Builder
	inQuote := false
	for _, c := range s {
		switch {
		case c == '"':
			inQuote = !inQuote
			current.WriteRune(c)
		case c == ',' && !inQuote:
			parts = append(parts, current.String())
			current.Reset()
		default:
			current.WriteRune(c)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}

func computeDigestResponse(username, realm, password, method, uri, nonce, algorithm, qop, cnonce, nc string) string {
	// HA1 = MD5(username:realm:password)
	ha1 := md5Hex(fmt.Sprintf("%s:%s:%s", username, realm, password))

	// HA2 = MD5(method:uri)
	ha2 := md5Hex(fmt.Sprintf("%s:%s", method, uri))

	if qop == "auth" || qop == "auth-int" {
		// response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
		return md5Hex(fmt.Sprintf("%s:%s:%s:%s:%s:%s", ha1, nonce, nc, cnonce, qop, ha2))
	}

	// response = MD5(HA1:nonce:HA2)
	return md5Hex(fmt.Sprintf("%s:%s:%s", ha1, nonce, ha2))
}
