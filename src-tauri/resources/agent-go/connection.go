package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	initialReconnectBackoff = time.Second
	maxReconnectBackoff     = 60 * time.Second
)

var lastHealthyControllerAddress sync.Map // map[string]string (agent_id -> controller address)

// activeCallCancels tracks cancel functions for running SipCall commands,
// keyed by command (message) ID. This allows HangupCall to terminate a
// call mid-execution by cancelling its context.
var activeCallCancels sync.Map // map[string]context.CancelFunc
var outboundChatQueue = make(chan ChatMessageData, 64)

func queueOutboundChat(text, sender string) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return
	}
	msg := ChatMessageData{
		Text:      trimmed,
		Sender:    sender,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	select {
	case outboundChatQueue <- msg:
	default:
		log.Printf("[Agent] Dropping outbound chat message (queue full)")
	}
}

// commandLabels maps command types to human-readable labels for the tray tooltip.
var commandLabels = map[string]string{
	// Network tools
	"Ping":       "Ping",
	"Traceroute": "Traceroute",
	"Mtr":        "MTR",
	"DnsLookup":  "DNS Lookup",
	"DnsSipResolve": "DNS SIP Resolve",
	"DnsReverse": "DNS Reverse",
	"DnsDig":     "DNS Dig",
	"DnsGeoIp":   "DNS GeoIP",
	"PortScan":   "Port Scan",
	"NtpCheck":   "NTP Check",
	"NatDetect":  "NAT Detect",
	"SnmpPoll":   "SNMP Poll",
	// SIP / VoIP tools
	"SipRegistrationTest": "SIP Register",
	"SipProbe":            "SIP Probe",
	"SipCall":             "SIP Call",
	"HangupCall":          "Hangup Call",
	"FaxSend":             "Fax Send",
	"StunTest":            "STUN Test",
	// Capture / discovery
	"PacketCapture": "Packet Capture",
	"DeviceScan":    "Device Scan",
	// Tools (agent-only)
	"SyslogListen": "Syslog Listen",
	"FetchLog":     "Fetch Log",
	"TailLog":      "Tail Log",
	"FileServe":         "File Server",
	"FirmwareDownload": "Firmware Download",
	"ListDir":      "List Directory",
	// System
	"SystemInfo": "System Info",
	// Shell
	"ShellSpawn": "Shell",
}

func commandLabel(cmd string) string {
	if l, ok := commandLabels[cmd]; ok {
		return l
	}
	return cmd
}

// SafeConn wraps a websocket.Conn with a write mutex.
// gorilla/websocket is NOT safe for concurrent writes.
type SafeConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (sc *SafeConn) WriteJSON(v interface{}) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	sc.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	err := sc.conn.WriteJSON(v)
	sc.conn.SetWriteDeadline(time.Time{})
	return err
}

func (sc *SafeConn) WritePing() error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	sc.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	err := sc.conn.WriteMessage(websocket.PingMessage, nil)
	sc.conn.SetWriteDeadline(time.Time{})
	return err
}

func (sc *SafeConn) ReadMessage() (int, []byte, error) {
	return sc.conn.ReadMessage()
}

func (sc *SafeConn) ReadJSON(v interface{}) error {
	return sc.conn.ReadJSON(v)
}

func (sc *SafeConn) SetReadDeadline(t time.Time) error {
	return sc.conn.SetReadDeadline(t)
}

func (sc *SafeConn) Close() error {
	return sc.conn.Close()
}

// sleepWithReconnect sleeps for the given duration but returns immediately
// if a manual reconnect is triggered via TriggerReconnect().
func sleepWithReconnect(d time.Duration) {
	setConnStatus(fmt.Sprintf("waiting:%s", d.Round(time.Second)))
	select {
	case <-time.After(d):
	case <-reconnectCh:
		log.Println("[Agent] Manual reconnect triggered — skipping backoff")
	}
}

// RunConnectionLoop connects to the controller, handles commands, and auto-reconnects.
func RunConnectionLoop(config *AgentConfig) {
	backoff := initialReconnectBackoff

	for {
		if shutdown.Load() {
			return
		}

		if config.IsExpired() {
			log.Println("[Agent] Expired. Self-destructing.")
			shutdown.Store(true)
			PerformSelfDestruct()
			os.Exit(0)
		}

		candidates := orderedControllerCandidates(config)
		if len(candidates) == 0 {
			log.Printf("[Agent] No controller candidates configured. Retrying in %v...", backoff)
			sleepWithReconnect(jitteredBackoff(backoff))
			backoff = min(backoff*2, maxReconnectBackoff)
			continue
		}

		var (
			action    connectionAction
			connected bool
			lastErr   error
		)
		for _, candidate := range candidates {
			wsURL := controllerWsURL(config, candidate)
			log.Printf("[Agent] Connecting to %s...", wsURL)
			setConnStatus("connecting")

			a, err := connectAndRun(config, wsURL)
			if err != nil {
				lastErr = err
				log.Printf("[Agent] Candidate %s failed: %v", candidate, err)
				continue
			}
			lastHealthyControllerAddress.Store(config.AgentID, candidate)
			action = a
			connected = true
			break
		}
		if !connected {
			log.Printf("[Agent] All controller candidates failed. Last error: %v. Retrying in %v...", lastErr, backoff)
			sleepWithReconnect(jitteredBackoff(backoff))
			backoff = min(backoff*2, maxReconnectBackoff)
			continue
		}

		switch action {
		case actionDisconnected:
			log.Println("[Agent] Disconnected by controller.")
			cancelAllActiveSessions()
			backoff = initialReconnectBackoff
			sleepWithReconnect(5 * time.Second)
		case actionKill:
			log.Println("[Agent] Kill command received. Cleaning up…")
			cancelAllActiveSessions()
			shutdown.Store(true)
			os.Exit(0)
		case actionSelfDestruct:
			log.Println("[Agent] Self-destruct command received. Cleaning up…")
			cancelAllActiveSessions()
			shutdown.Store(true)
			PerformSelfDestruct()
			os.Exit(0)
		case actionReconnect:
			log.Printf("[Agent] Connection lost. Cleaning up active sessions…")
			cancelAllActiveSessions()
			log.Printf("[Agent] Reconnecting in %v...", backoff)
			sleepWithReconnect(jitteredBackoff(backoff))
			backoff = min(backoff*2, maxReconnectBackoff)
		}
	}
}

func jitteredBackoff(base time.Duration) time.Duration {
	if base <= 0 {
		return initialReconnectBackoff
	}
	// Add 0-30% jitter so many agents do not reconnect in lockstep on VPN/relay blips.
	jitterNs := time.Now().UnixNano() % int64(base/3)
	return base + time.Duration(jitterNs)
}

func orderedControllerCandidates(config *AgentConfig) []string {
	candidates := config.ControllerCandidates()
	if len(candidates) <= 1 {
		return candidates
	}

	healthy, _ := lastHealthyControllerAddress.Load(config.AgentID)
	if healthyAddr, ok := healthy.(string); ok && healthyAddr != "" {
		out := make([]string, 0, len(candidates))
		for _, c := range candidates {
			if c == healthyAddr {
				out = append(out, c)
				break
			}
		}
		for _, c := range candidates {
			if c != healthyAddr {
				out = append(out, c)
			}
		}
		return out
	}

	// First connect: prefer relay path for cross-network reliability.
	out := make([]string, 0, len(candidates))
	for _, c := range candidates {
		if strings.Contains(c, "/session/") {
			out = append(out, c)
		}
	}
	for _, c := range candidates {
		if !strings.Contains(c, "/session/") {
			out = append(out, c)
		}
	}
	return out
}

func controllerWsURL(config *AgentConfig, controllerAddress string) string {
	isRelay := strings.Contains(controllerAddress, "/")
	scheme := "ws"
	if config.UseTLS || isRelay {
		scheme = "wss"
	}
	return fmt.Sprintf("%s://%s/agent", scheme, controllerAddress)
}

type connectionAction int

const (
	actionReconnect connectionAction = iota
	actionDisconnected
	actionKill
	actionSelfDestruct
)

func connectAndRun(config *AgentConfig, wsURL string) (connectionAction, error) {
	netDialer := &net.Dialer{
		Timeout:   12 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
		NetDialContext:   netDialer.DialContext,
	}
	isRelay := strings.Contains(config.ControllerAddress, "/")
	if config.UseTLS || isRelay {
		if isRelay {
			// Relay has a valid certificate — use default TLS with proper verification
			dialer.TLSClientConfig = &tls.Config{}
		} else {
			// Direct connections may use self-signed certs from the controller
			dialer.TLSClientConfig = &tls.Config{
				InsecureSkipVerify: true,
			}
		}
	}

	rawConn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		return actionReconnect, fmt.Errorf("WebSocket connect failed: %w", err)
	}
	conn := &SafeConn{conn: rawConn}
	defer conn.Close()
	rawConn.SetReadLimit(4 << 20)

	log.Println("[Agent] Connected to controller.")

	// --- Authentication handshake ---
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	var challenge AuthChallenge
	if err := conn.ReadJSON(&challenge); err != nil {
		return actionReconnect, fmt.Errorf("auth challenge read failed: %w", err)
	}

	hmacValue := ComputeHMAC(challenge.Nonce, config.AuthToken)
	authResp := AuthResponse{
		AgentID:         config.AgentID,
		HMAC:            hmacValue,
		ProtocolVersion: ProtocolVersion,
		Profile:         agentProfile(),
		Capabilities:    agentCapabilities(),
	}
	if err := conn.WriteJSON(authResp); err != nil {
		return actionReconnect, fmt.Errorf("auth response send failed: %w", err)
	}

	// Wait for auth confirmation
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		return actionReconnect, fmt.Errorf("auth confirm failed: %w", err)
	}
	_ = msg // Any non-close message = success

	log.Println("[Agent] Authenticated successfully.")
	// Immediately publish a heartbeat so the controller quickly has fresh
	// interface/IP metadata after reconnect (important on VPN topology changes).
	initialHb := buildHeartbeat(config.AgentID)
	if err := conn.WriteJSON(AgentReply{
		ID:   generateID(),
		Type: "Heartbeat",
		Data: initialHb,
	}); err != nil {
		return actionReconnect, fmt.Errorf("initial heartbeat send failed: %w", err)
	}

	// --- Set up WebSocket ping/pong keepalive ---
	// Pong handler resets the read deadline, giving us 60s from the last pong.
	rawConn.SetPongHandler(func(string) error {
		rawConn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	rawConn.SetReadDeadline(time.Now().Add(60 * time.Second))

	// Connection-scoped context: cancelled when connectAndRun exits.
	// All spawned goroutines (command handlers) should use this context.
	connCtx, connCancel := context.WithCancel(context.Background())
	defer connCancel()

	connectionUp.Store(true)
	lastConnectedAt.Store(time.Now())
	setConnStatus("connected")
	defer func() {
		connectionUp.Store(false)
		setConnStatus("connecting")
	}()

	// --- Main message loop ---
	heartbeatTicker := time.NewTicker(15 * time.Second)
	defer heartbeatTicker.Stop()

	pingTicker := time.NewTicker(30 * time.Second)
	defer pingTicker.Stop()

	msgChan := make(chan []byte, 16)
	errChan := make(chan error, 2)

	// Read messages in a goroutine — exits when context is cancelled or read fails
	go func() {
		defer close(msgChan)
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				select {
				case errChan <- err:
				default:
				}
				return
			}
			select {
			case msgChan <- message:
			case <-connCtx.Done():
				return
			}
		}
	}()

	for {
		select {
		case message, ok := <-msgChan:
			if !ok {
				log.Println("[Agent] Message channel closed")
				return actionReconnect, nil
			}
			action, done := handleMessage(connCtx, conn, config, message)
			if done {
				return action, nil
			}

		case err := <-errChan:
			log.Printf("[Agent] WebSocket error: %v", err)
			return actionReconnect, nil

		case <-heartbeatTicker.C:
			hb := buildHeartbeat(config.AgentID)
			reply := AgentReply{
				ID:   generateID(),
				Type: "Heartbeat",
				Data: hb,
			}
			if err := conn.WriteJSON(reply); err != nil {
				log.Printf("[Agent] Heartbeat send error: %v", err)
				return actionReconnect, nil
			}

		case <-pingTicker.C:
			if err := conn.WritePing(); err != nil {
				log.Printf("[Agent] WS ping failed: %v", err)
				return actionReconnect, nil
			}

		case outgoing := <-outboundChatQueue:
			reply := AgentReply{
				ID:   generateID(),
				Type: "ChatMessage",
				Data: outgoing,
			}
			if err := conn.WriteJSON(reply); err != nil {
				log.Printf("[Agent] Chat send error: %v", err)
				return actionReconnect, nil
			}

		case <-connCtx.Done():
			return actionReconnect, nil
		}
	}
}

func handleMessage(connCtx context.Context, conn *SafeConn, config *AgentConfig, message []byte) (connectionAction, bool) {
	var msg AgentMessage
	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("[Agent] Failed to parse command: %v", err)
		return 0, false
	}

	log.Printf("[Agent] Received command: %s (id=%s)", msg.Command, msg.ID)

	switch msg.Command {
	case "Disconnect":
		sendAck(conn, msg.ID, "Disconnect", "Disconnecting")
		return actionDisconnected, true

	case "Kill":
		sendAck(conn, msg.ID, "Kill", "Terminating agent process")
		return actionKill, true

	case "SelfDestruct":
		sendAck(conn, msg.ID, "SelfDestruct", "Self-destructing: deleting binary and config")
		return actionSelfDestruct, true

	case "Heartbeat":
		refreshCachedNetworkInfo()
		hb := buildHeartbeat(config.AgentID)
		reply := AgentReply{ID: msg.ID, Type: "Heartbeat", Data: hb}
		conn.WriteJSON(reply)

	case "SipCall":
		go func() {
			log.Printf("[Agent] Starting SIP call (id=%s)", msg.ID)
			setActiveTask("SIP Call")
			defer setActiveTask("")
			ctx, cancel := context.WithCancel(connCtx)
			activeCallCancels.Store(msg.ID, cancel)
			defer func() {
				cancel()
				activeCallCancels.Delete(msg.ID)
			}()

			var p SipCallParams
			p.Port = 5060
			p.DurationSecs = 10
			json.Unmarshal(msg.Params, &p)

			progressSender := func(resp ToolResponse) {
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] Send progress error for SipCall: %v", err)
				}
			}

			responses := RunSipCallWithContext(ctx, p, progressSender)
			for _, resp := range responses {
				if connCtx.Err() != nil {
					return
				}
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] Send error for SipCall: %v", err)
					return
				}
			}
			log.Printf("[Agent] SipCall completed (id=%s)", msg.ID)
		}()

	case "HangupCall":
		var p HangupCallParams
		json.Unmarshal(msg.Params, &p)
		if cancelFn, ok := activeCallCancels.LoadAndDelete(p.CommandID); ok {
			cancelFn.(context.CancelFunc)()
			log.Printf("[Agent] HangupCall: cancelled call id=%s", p.CommandID)
			sendAck(conn, msg.ID, "HangupCall", "Call hangup initiated")
		} else {
			log.Printf("[Agent] HangupCall: no active call with id=%s", p.CommandID)
			reply := AgentReply{ID: msg.ID, Type: "Error", Data: ErrorData{
				Code: "NO_ACTIVE_CALL", Message: "No active call found with that command ID",
			}}
			conn.WriteJSON(reply)
		}

	case "PacketCapture":
		go func() {
			log.Printf("[Agent] Starting streaming capture (id=%s)", msg.ID)
			setActiveTask("Packet Capture")
			defer setActiveTask("")
			t0 := time.Now()
			ctx, cancel := context.WithCancel(connCtx)
			activeCallCancels.Store(msg.ID, cancel)
			defer func() {
				cancel()
				activeCallCancels.Delete(msg.ID)
			}()
			var p PacketCaptureParams
			json.Unmarshal(msg.Params, &p)
			ch := make(chan ToolResponse, 32)
			go RunPacketCaptureStream(ctx, p, ch)
			count := 0
			hadError := false
			for resp := range ch {
				if connCtx.Err() != nil {
					return
				}
				if resp.Type == "Error" {
					hadError = true
				}
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] Stream send error for PacketCapture: %v", err)
					return
				}
				count++
			}
			addTaskHistory("Packet Capture", !hadError, time.Since(t0))
			log.Printf("[Agent] PacketCapture completed, streamed %d message(s)", count)
		}()

	case "StopCapture", "StopSyslog", "StopTailLog", "StopFileServe", "StopFirmwareDownload":
		var p HangupCallParams
		json.Unmarshal(msg.Params, &p)
		if cancelFn, ok := activeCallCancels.LoadAndDelete(p.CommandID); ok {
			cancelFn.(context.CancelFunc)()
			log.Printf("[Agent] %s: stopped id=%s", msg.Command, p.CommandID)
			sendAck(conn, msg.ID, msg.Command, "Stopped")
		} else {
			log.Printf("[Agent] %s: no active session with id=%s", msg.Command, p.CommandID)
			sendAck(conn, msg.ID, msg.Command, "No active session found")
		}

	case "Mtr":
		go func() {
			log.Printf("[Agent] Starting MTR (id=%s)", msg.ID)
			setActiveTask("MTR")
			defer setActiveTask("")
			t0 := time.Now()
			ctx, cancel := context.WithCancel(connCtx)
			activeCallCancels.Store(msg.ID, cancel)
			defer func() { cancel(); activeCallCancels.Delete(msg.ID) }()
			var p MtrParams
			p.MaxHops = 30
			p.Rounds = 20
			p.IntervalMs = 1000
			p.TimeoutMs = 2000
			json.Unmarshal(msg.Params, &p)
			ch := make(chan ToolResponse, 32)
			go RunMtrStream(ctx, p, ch)
			hadError := false
			for resp := range ch {
				if connCtx.Err() != nil { return }
				if resp.Type == "Error" { hadError = true }
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] MTR send error: %v", err)
					return
				}
			}
			addTaskHistory("MTR", !hadError, time.Since(t0))
			log.Printf("[Agent] MTR completed (id=%s)", msg.ID)
		}()

	case "SyslogListen":
		go func() {
			log.Printf("[Agent] Starting Syslog listener (id=%s)", msg.ID)
			setActiveTask("Syslog Listen")
			defer setActiveTask("")
			t0 := time.Now()
			ctx, cancel := context.WithCancel(connCtx)
			activeCallCancels.Store(msg.ID, cancel)
			defer func() { cancel(); activeCallCancels.Delete(msg.ID) }()
			var p SyslogListenParams
			p.Port = 514
			p.MaxEntries = 10000
			json.Unmarshal(msg.Params, &p)
			ch := make(chan ToolResponse, 64)
			go RunSyslogListen(ctx, p, ch)
			hadError := false
			for resp := range ch {
				if connCtx.Err() != nil { return }
				if resp.Type == "Error" { hadError = true }
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] Syslog send error: %v", err)
					return
				}
			}
			addTaskHistory("Syslog Listen", !hadError, time.Since(t0))
			log.Printf("[Agent] Syslog listener stopped (id=%s)", msg.ID)
		}()

	case "TailLog":
		go func() {
			log.Printf("[Agent] Starting log tail (id=%s)", msg.ID)
			setActiveTask("Tail Log")
			defer setActiveTask("")
			t0 := time.Now()
			ctx, cancel := context.WithCancel(connCtx)
			activeCallCancels.Store(msg.ID, cancel)
			defer func() { cancel(); activeCallCancels.Delete(msg.ID) }()
			var p TailLogParams
			json.Unmarshal(msg.Params, &p)
			ch := make(chan ToolResponse, 64)
			go RunTailLog(ctx, p, ch)
			hadError := false
			for resp := range ch {
				if connCtx.Err() != nil { return }
				if resp.Type == "Error" { hadError = true }
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] TailLog send error: %v", err)
					return
				}
			}
			addTaskHistory("Tail Log", !hadError, time.Since(t0))
			log.Printf("[Agent] TailLog stopped (id=%s)", msg.ID)
		}()

	case "FirmwareDownload":
		go func() {
			log.Printf("[Agent] Starting firmware download (id=%s)", msg.ID)
			setActiveTask("Firmware Download")
			defer setActiveTask("")
			t0 := time.Now()
			ctx, cancel := context.WithCancel(connCtx)
			activeCallCancels.Store(msg.ID, cancel)
			defer func() { cancel(); activeCallCancels.Delete(msg.ID) }()
			var p FirmwareDownloadParams
			json.Unmarshal(msg.Params, &p)
			ch := make(chan ToolResponse, 32)
			go RunFirmwareDownload(ctx, p, ch)
			hadError := false
			for resp := range ch {
				if connCtx.Err() != nil { return }
				if resp.Type == "Error" { hadError = true }
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] FirmwareDownload send error: %v", err)
					return
				}
			}
			addTaskHistory("Firmware Download", !hadError, time.Since(t0))
			log.Printf("[Agent] Firmware download completed (id=%s)", msg.ID)
		}()

	case "FileServe":
		go func() {
			log.Printf("[Agent] Starting file server (id=%s)", msg.ID)
			setActiveTask("File Server")
			defer setActiveTask("")
			t0 := time.Now()
			ctx, cancel := context.WithCancel(connCtx)
			activeCallCancels.Store(msg.ID, cancel)
			defer func() { cancel(); activeCallCancels.Delete(msg.ID) }()
			var p FileServeParams
			p.HTTPPort = 8080
			p.TFTPPort = 69
			p.Protocols = []string{"http"}
			json.Unmarshal(msg.Params, &p)
			ch := make(chan ToolResponse, 32)
			go RunFileServe(ctx, p, ch)
			hadError := false
			for resp := range ch {
				if connCtx.Err() != nil { return }
				if resp.Type == "Error" { hadError = true }
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] FileServe send error: %v", err)
					return
				}
			}
			addTaskHistory("File Server", !hadError, time.Since(t0))
			log.Printf("[Agent] File server stopped (id=%s)", msg.ID)
		}()

	case "ShellSpawn":
		go func() {
			log.Printf("[Agent] Starting shell session (id=%s)", msg.ID)
			setActiveTask("Shell")
			defer setActiveTask("")
			var p ShellSpawnParams
			p.Cols = 80
			p.Rows = 24
			json.Unmarshal(msg.Params, &p)
			sendFn := func(resp ToolResponse) {
				if connCtx.Err() != nil {
					return
				}
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] Shell send error: %v", err)
				}
			}
			RunShellSpawn(connCtx, msg.ID, p, sendFn)
			log.Printf("[Agent] Shell session ended (id=%s)", msg.ID)
		}()

	case "ShellInput":
		var p ShellInputParams
		json.Unmarshal(msg.Params, &p)
		if err := ShellWrite(p.SessionID, p.Data); err != nil {
			log.Printf("[Agent] ShellInput error: %v", err)
			reply := AgentReply{ID: msg.ID, Type: "Error", Data: ErrorData{
				Code: "SHELL_INPUT_ERROR", Message: err.Error(),
			}}
			conn.WriteJSON(reply)
		}

	case "ShellResize":
		var p ShellResizeParams
		json.Unmarshal(msg.Params, &p)
		if err := ShellResize(p.SessionID, p.Cols, p.Rows); err != nil {
			log.Printf("[Agent] ShellResize error: %v", err)
			reply := AgentReply{ID: msg.ID, Type: "Error", Data: ErrorData{
				Code: "SHELL_RESIZE_ERROR", Message: err.Error(),
			}}
			conn.WriteJSON(reply)
		}

	case "ShellClose":
		var p ShellCloseParams
		json.Unmarshal(msg.Params, &p)
		if err := ShellClose(p.SessionID); err != nil {
			log.Printf("[Agent] ShellClose error: %v", err)
		}
		sendAck(conn, msg.ID, "ShellClose", "Shell session closed")

	case "ProbeCapturePerm":
		go func() {
			if connCtx.Err() != nil {
				return
			}
			log.Println("[Agent] Probing capture permissions…")
			status := probeCapturePerm()
			reply := AgentReply{ID: msg.ID, Type: "Result", Data: ResultData{
				Success:   status.Available,
				Result:    status,
				ElapsedMs: 0,
			}}
			conn.WriteJSON(reply)
		}()

	case "RequestCapturePerm":
		go func() {
			if connCtx.Err() != nil {
				return
			}
			log.Println("[Agent] Requesting capture permissions from local user…")
			setActiveTask("Permission Request")
			defer setActiveTask("")
			status := requestCapturePerm()
			log.Printf("[Agent] Capture permission result: available=%v method=%s detail=%s",
				status.Available, status.Method, status.Detail)
			reply := AgentReply{ID: msg.ID, Type: "Result", Data: ResultData{
				Success:   status.Available,
				Result:    status,
				ElapsedMs: 0,
			}}
			conn.WriteJSON(reply)
		}()

	case "ChatMessage":
		var p ChatMessageParams
		json.Unmarshal(msg.Params, &p)
		if strings.TrimSpace(p.Text) == "" {
			reply := AgentReply{ID: msg.ID, Type: "Error", Data: ErrorData{
				Code: "CHAT_EMPTY", Message: "Chat message cannot be empty",
			}}
			conn.WriteJSON(reply)
			return 0, false
		}
		sender := "controller"
		if p.Sender != nil && strings.TrimSpace(*p.Sender) != "" {
			sender = *p.Sender
		}
		addTrayChatMessage(sender, p.Text, true)
		reply := AgentReply{ID: msg.ID, Type: "Result", Data: ResultData{
			Success:   true,
			Result:    map[string]any{"delivered": true},
			ElapsedMs: 0,
		}}
		conn.WriteJSON(reply)

	default:
		go func() {
			if connCtx.Err() != nil {
				return
			}
			label := commandLabel(msg.Command)
			log.Printf("[Agent] Executing tool: %s", msg.Command)
			setActiveTask(label)
			defer setActiveTask("")
			t0 := time.Now()
			responses := DispatchCommand(msg.Command, msg.Params)
			success := true
			for _, resp := range responses {
				if connCtx.Err() != nil {
					return
				}
				if resp.Type == "Error" {
					success = false
				}
				reply := AgentReply{ID: msg.ID, Type: resp.Type, Data: resp.Data}
				if err := conn.WriteJSON(reply); err != nil {
					log.Printf("[Agent] Send error for %s: %v", msg.Command, err)
					return
				}
			}
			addTaskHistory(label, success, time.Since(t0))
			log.Printf("[Agent] Tool %s completed, sent %d response(s)", msg.Command, len(responses))
		}()
	}

	return 0, false
}

func sendAck(conn *SafeConn, id, command, message string) {
	reply := AgentReply{
		ID:   id,
		Type: "Ack",
		Data: AckData{Command: command, Message: message},
	}
	conn.WriteJSON(reply)
}

var (
	cachedOnce     sync.Once
	cachedKernel   string
	cachedMemoryMB uint64
	cachedPublicIP string
	cachedGateway  string
)

func initCachedSysInfo() {
	cachedOnce.Do(func() {
		osName := runtime.GOOS
		cachedKernel = detectKernel(osName)
		if mem := readMemInfo(); mem > 0 {
			cachedMemoryMB = mem / (1024 * 1024)
		}
		if ip := detectPublicIP(); ip != nil {
			cachedPublicIP = *ip
		}
		if gw := detectDefaultGateway(osName); gw != nil {
			cachedGateway = *gw
		}
	})
}

// Refresh network-derived cached fields when the controller explicitly asks
// for a heartbeat (used by "Rediscover Network" in the UI).
func refreshCachedNetworkInfo() {
	if ip := detectPublicIP(); ip != nil {
		cachedPublicIP = *ip
	}
	if gw := detectDefaultGateway(runtime.GOOS); gw != nil {
		cachedGateway = *gw
	}
}

func buildHeartbeat(agentID string) HeartbeatData {
	initCachedSysInfo()

	hostname, _ := os.Hostname()
	osName := runtime.GOOS
	osVersion := getOSVersion()
	localIP := getLocalIP()
	interfaces := getNetworkInterfaces()

	return HeartbeatData{
		AgentID:      agentID,
		Hostname:     hostname,
		OS:           osName,
		OSVersion:    osVersion,
		Arch:         runtime.GOARCH,
		Kernel:       cachedKernel,
		CPUs:         runtime.NumCPU(),
		MemoryMB:     cachedMemoryMB,
		UptimeSecs:   uint64(time.Since(startTime).Seconds()),
		LocalIP:      localIP,
		PublicIP:     cachedPublicIP,
		Gateway:      cachedGateway,
		Interfaces:   interfaces,
		Profile:      agentProfile(),
		Capabilities: agentCapabilities(),
	}
}

func getLocalIP() string {
	// Best signal for "current" local IP: resolve the outbound route.
	if conn, err := net.DialTimeout("udp4", "1.1.1.1:53", 1200*time.Millisecond); err == nil {
		if ua, ok := conn.LocalAddr().(*net.UDPAddr); ok && isUsableIPv4(ua.IP) {
			_ = conn.Close()
			return ua.IP.String()
		}
		_ = conn.Close()
	}

	// Fallback: first non-loopback IPv4 on an UP physical-ish interface.
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if isLikelyVirtualInterface(iface.Name) {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok || !isUsableIPv4(ipnet.IP) {
				continue
			}
			return ipnet.IP.String()
		}
	}
	return ""
}

func isUsableIPv4(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	if ip4.IsLoopback() || ip4.IsLinkLocalUnicast() || ip4.IsUnspecified() {
		return false
	}
	return true
}

func isLikelyVirtualInterface(name string) bool {
	l := strings.ToLower(name)
	return strings.HasPrefix(l, "lo") ||
		strings.HasPrefix(l, "docker") ||
		strings.HasPrefix(l, "br-") ||
		strings.HasPrefix(l, "veth") ||
		strings.HasPrefix(l, "virbr") ||
		strings.HasPrefix(l, "vbox") ||
		strings.HasPrefix(l, "vmnet")
}

func getNetworkInterfaces() []NetworkInterface {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var result []NetworkInterface
	for _, iface := range ifaces {
		ni := NetworkInterface{
			Name: iface.Name,
			IsUp: iface.Flags&net.FlagUp != 0,
		}
		mac := iface.HardwareAddr.String()
		if mac != "" {
			ni.MAC = &mac
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok && ipnet.IP.To4() != nil {
				ip := ipnet.IP.String()
				ni.IP = &ip
				break
			}
		}
		result = append(result, ni)
	}
	return result
}

func getOSVersion() string {
	switch runtime.GOOS {
	case "darwin":
		return "macOS"
	case "windows":
		return "Windows"
	case "linux":
		data, err := os.ReadFile("/etc/os-release")
		if err == nil {
			for _, line := range splitLines(string(data)) {
				if len(line) > 12 && line[:12] == "PRETTY_NAME=" {
					val := line[12:]
					if len(val) >= 2 && val[0] == '"' {
						val = val[1 : len(val)-1]
					}
					return val
				}
			}
		}
		return "Linux"
	}
	return runtime.GOOS
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func generateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
