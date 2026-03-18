package main

import (
	"crypto/md5"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

// ─── Types ──────────────────────────────────────────────────────────────────

type DeviceControlParams struct {
	IP      string          `json:"ip"`
	Vendor  string          `json:"vendor"`
	Command string          `json:"command"`
	Params  json.RawMessage `json:"params"`
	Auth    struct {
		Username string `json:"username"`
		Password string `json:"password"`
	} `json:"auth"`
}

type DeviceControlResult struct {
	Success      bool   `json:"success"`
	StatusCode   int    `json:"status_code"`
	ResponseBody string `json:"response_body"`
	Error        string `json:"error,omitempty"`
}

// ─── Entry point ────────────────────────────────────────────────────────────

func RunDeviceControl(p DeviceControlParams) (DeviceControlResult, error) {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Timeout: 10 * time.Second,
		Jar:     jar,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
				MinVersion:         tls.VersionTLS10,
			},
			TLSHandshakeTimeout: 5 * time.Second,
			DialContext: (&net.Dialer{
				Timeout: 5 * time.Second,
			}).DialContext,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	var params map[string]interface{}
	if len(p.Params) > 0 {
		json.Unmarshal(p.Params, &params)
	}
	if params == nil {
		params = make(map[string]interface{})
	}

	switch p.Vendor {
	case "yealink":
		return yealinkSend(client, p.IP, p.Command, params, p.Auth.Username, p.Auth.Password)
	case "poly":
		return polySend(client, p.IP, p.Command, params, p.Auth.Username, p.Auth.Password)
	default:
		return DeviceControlResult{}, fmt.Errorf("unsupported vendor: %s", p.Vendor)
	}
}

// ─── Yealink ────────────────────────────────────────────────────────────────

func yealinkQuery(command string, params map[string]interface{}) (string, error) {
	switch command {
	// System
	case "reboot":
		return "key=Reboot", nil
	case "check_sync":
		return "key=AutoP", nil
	case "factory_reset":
		return "key=Reset", nil
	case "back_idle":
		return "key=BACK_IDLE", nil

	// DND
	case "dnd_on":
		return "key=DNDOn", nil
	case "dnd_off":
		return "key=DNDOff", nil

	// Audio
	case "speaker":
		return "key=SPEAKER", nil
	case "headset":
		return "key=HEADSET", nil
	case "mute":
		return "key=MUTE", nil
	case "volume_up":
		return "key=VOLUME_UP", nil
	case "volume_down":
		return "key=VOLUME_DOWN", nil

	// Call control
	case "answer":
		return "key=ANSWER", nil
	case "end_call":
		return "key=CALLEND", nil
	case "hangup":
		return "key=X", nil
	case "offhook":
		return "key=OFFHOOK", nil
	case "onhook":
		return "key=ONHOOK", nil
	case "hold":
		return "key=F_HOLD", nil
	case "transfer":
		return "key=F_TRANSFER", nil
	case "conference":
		return "key=F_CONFERENCE", nil
	case "swap":
		return "key=SWAP", nil
	case "split":
		return "key=SPLIT", nil
	case "call_waiting_on":
		return "key=CallWaitingOn", nil
	case "call_waiting_off":
		return "key=CallWaitingOff", nil

	// Navigation
	case "ok":
		return "key=OK", nil
	case "enter":
		return "key=ENTER", nil
	case "cancel":
		return "key=CANCEL", nil
	case "nav_up":
		return "key=UP", nil
	case "nav_down":
		return "key=DOWN", nil
	case "nav_left":
		return "key=LEFT", nil
	case "nav_right":
		return "key=RIGHT", nil

	// Keypad
	case "pound":
		return "key=%23", nil
	case "star":
		return "key=*", nil
	case "digit_0":
		return "key=0", nil
	case "digit_1":
		return "key=1", nil
	case "digit_2":
		return "key=2", nil
	case "digit_3":
		return "key=3", nil
	case "digit_4":
		return "key=4", nil
	case "digit_5":
		return "key=5", nil
	case "digit_6":
		return "key=6", nil
	case "digit_7":
		return "key=7", nil
	case "digit_8":
		return "key=8", nil
	case "digit_9":
		return "key=9", nil

	// Soft keys / special
	case "f1":
		return "key=F1", nil
	case "f2":
		return "key=F2", nil
	case "f3":
		return "key=F3", nil
	case "f4":
		return "key=F4", nil
	case "msg":
		return "key=MSG", nil
	case "redial":
		return "key=RD", nil

	// Dial
	case "call":
		number, _ := params["number"].(string)
		if number == "" {
			return "", fmt.Errorf("missing 'number' for call command")
		}
		outURI, _ := params["outgoing_uri"].(string)
		if outURI == "" {
			return fmt.Sprintf("number=%s", url.QueryEscape(number)), nil
		}
		return fmt.Sprintf("number=%s&outgoing_uri=%s", url.QueryEscape(number), url.QueryEscape(outURI)), nil

	// Blind transfer
	case "blind_transfer":
		dest, _ := params["number"].(string)
		if dest == "" {
			return "", fmt.Errorf("missing 'number' for blind_transfer")
		}
		return fmt.Sprintf("key=BTrans=%s", url.QueryEscape(dest)), nil

	// DTMF during active call
	case "send_dtmf":
		digits, _ := params["digits"].(string)
		if digits == "" {
			return "", fmt.Errorf("missing 'digits' for send_dtmf")
		}
		duration := 300
		if d, ok := params["duration"].(float64); ok && d > 0 {
			duration = int(d)
		}
		return fmt.Sprintf("Key=%s&Duration=%d", url.QueryEscape(digits), duration), nil

	// Phone config
	case "phonecfg_get":
		param, _ := params["param"].(string)
		if param == "" {
			return "phonecfg=get&accounts=1&dnd=1&fw=1", nil
		}
		return fmt.Sprintf("phonecfg=get&%s", url.QueryEscape(param)), nil
	case "phonecfg_set":
		settings, _ := params["settings"].(string)
		if settings == "" {
			return "", fmt.Errorf("missing 'settings' for phonecfg_set")
		}
		return fmt.Sprintf("phonecfg=set&%s", settings), nil

	// Call forwarding
	case "fwd_always_on":
		dest, _ := params["number"].(string)
		if dest == "" {
			return "", fmt.Errorf("missing 'number' for forward")
		}
		return fmt.Sprintf("key=AlwaysFwdOn=%s", url.QueryEscape(dest)), nil
	case "fwd_always_off":
		return "key=AlwaysFwdOff", nil
	case "fwd_busy_on":
		dest, _ := params["number"].(string)
		if dest == "" {
			return "", fmt.Errorf("missing 'number' for forward")
		}
		return fmt.Sprintf("key=BusyFwdOn=%s", url.QueryEscape(dest)), nil
	case "fwd_busy_off":
		return "key=BusyFwdOff", nil
	case "fwd_noanswer_on":
		dest, _ := params["number"].(string)
		if dest == "" {
			return "", fmt.Errorf("missing 'number' for forward")
		}
		secs := 24
		if s, ok := params["seconds"].(float64); ok && s > 0 {
			secs = int(s)
		}
		return fmt.Sprintf("key=NoAnswFwdOn=%s=%d", url.QueryEscape(dest), secs), nil
	case "fwd_noanswer_off":
		return "key=NoAnswFwdOff", nil

	default:
		return "", fmt.Errorf("unknown Yealink command: %s", command)
	}
}

func yealinkSend(client *http.Client, ip, command string, params map[string]interface{}, user, pass string) (DeviceControlResult, error) {
	schemes := []string{"http", "https"}

	// XML push — POST XML body to /servlet
	if command == "xml_push" {
		xmlBody, _ := params["xml"].(string)
		var lastErr error
		for _, scheme := range schemes {
			reqURL := fmt.Sprintf("%s://%s/servlet", scheme, ip)
			req, err := http.NewRequest("POST", reqURL, strings.NewReader(xmlBody))
			if err != nil {
				lastErr = err
				continue
			}
			req.SetBasicAuth(user, pass)
			req.Header.Set("Content-Type", "application/xml")
			resp, err := client.Do(req)
			if err != nil {
				lastErr = err
				continue
			}
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return DeviceControlResult{
				Success:      resp.StatusCode >= 200 && resp.StatusCode < 300,
				StatusCode:   resp.StatusCode,
				ResponseBody: string(body),
				Error:        friendlyYealinkError(resp.StatusCode),
			}, nil
		}
		if lastErr != nil {
			return DeviceControlResult{}, fmt.Errorf("XML push failed — could not connect to %s: %v", ip, lastErr)
		}
		return DeviceControlResult{}, fmt.Errorf("XML push failed — could not connect to %s", ip)
	}

	// Regular command — GET /servlet?key=...
	query, err := yealinkQuery(command, params)
	if err != nil {
		return DeviceControlResult{}, err
	}

	var attempts []string
	bestStatus := 0
	bestBody := ""

	for _, scheme := range schemes {
		reqURL := fmt.Sprintf("%s://%s/servlet?%s", scheme, ip, query)
		req, err := http.NewRequest("GET", reqURL, nil)
		if err != nil {
			attempts = append(attempts, fmt.Sprintf("%s → %v", scheme, err))
			continue
		}
		req.SetBasicAuth(user, pass)
		resp, err := client.Do(req)
		if err != nil {
			attempts = append(attempts, fmt.Sprintf("%s → %v", scheme, err))
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return DeviceControlResult{
				Success:      true,
				StatusCode:   resp.StatusCode,
				ResponseBody: string(body),
			}, nil
		}
		if resp.StatusCode > bestStatus {
			bestStatus = resp.StatusCode
			bestBody = string(body)
		}
		attempts = append(attempts, fmt.Sprintf("%s → HTTP %d", scheme, resp.StatusCode))
	}

	detail := strings.Join(attempts, " | ")

	if bestStatus > 0 {
		errMsg := friendlyYealinkError(bestStatus)
		if errMsg == "" {
			errMsg = fmt.Sprintf("HTTP %d [%s]", bestStatus, detail)
		}
		return DeviceControlResult{
			Success:      false,
			StatusCode:   bestStatus,
			ResponseBody: bestBody,
			Error:        errMsg,
		}, nil
	}

	return DeviceControlResult{
		Success:      false,
		StatusCode:   0,
		ResponseBody: "",
		Error: fmt.Sprintf(
			"Could not reach %s. Tried: [%s]. "+
				"Verify: (1) phone IP is correct, (2) you are on the same LAN/VLAN, "+
				"(3) the phone's web server is enabled.", ip, detail),
	}, nil
}

func friendlyYealinkError(status int) string {
	switch status {
	case 401:
		return "Authentication failed — check web admin username/password."
	case 403:
		return "403 Forbidden — Action URI is disabled or your IP is not allowed. " +
			"Set features.action_uri_limit_ip = any in the phone config."
	default:
		return ""
	}
}

// ─── Poly ───────────────────────────────────────────────────────────────────

func wrapPolyData(inner interface{}) string {
	wrapped := map[string]interface{}{"data": inner}
	b, _ := json.Marshal(wrapped)
	return string(b)
}

func polyRef(params map[string]interface{}) string {
	ref, _ := params["callRef"].(string)
	if ref == "" {
		return wrapPolyData(map[string]interface{}{})
	}
	return wrapPolyData(map[string]interface{}{"Ref": ref})
}

func polySend(client *http.Client, ip, command string, params map[string]interface{}, user, pass string) (DeviceControlResult, error) {
	base := fmt.Sprintf("https://%s", ip)
	var reqURL, method, bodyStr string

	switch command {
	case "reboot":
		reqURL, method = base+"/api/v1/mgmt/safeReboot", "POST"
	case "restart":
		reqURL, method = base+"/api/v1/mgmt/safeRestart", "POST"
	case "factory_reset":
		reqURL, method = base+"/api/v1/mgmt/factoryReset", "POST"
	case "config_reset":
		reqURL, method = base+"/api/v1/mgmt/configReset", "POST"
	case "device_info":
		reqURL, method = base+"/api/v1/mgmt/device/info", "GET"
	case "network_info":
		reqURL, method = base+"/api/v1/mgmt/network/info", "GET"
	case "line_info":
		reqURL, method = base+"/api/v1/mgmt/lineInfo", "GET"
	case "call_status":
		reqURL, method = base+"/api/v2/webCallControl/callStatus", "GET"
	case "config_set":
		reqURL, method = base+"/api/v1/mgmt/config/set", "POST"
		cfg, _ := params["config"]
		bodyStr = wrapPolyData(cfg)
	case "call":
		number, _ := params["number"].(string)
		if number == "" {
			return DeviceControlResult{}, fmt.Errorf("missing 'number' for call command")
		}
		line := "1"
		if l, ok := params["line"].(string); ok && l != "" {
			line = l
		}
		callType := "SIP"
		if t, ok := params["type"].(string); ok && t != "" {
			callType = t
		}
		reqURL, method = base+"/api/v1/callctrl/dial", "POST"
		bodyStr = wrapPolyData(map[string]interface{}{"Dest": number, "Line": line, "Type": callType})
	case "end_call":
		reqURL, method = base+"/api/v1/callctrl/endCall", "POST"
		bodyStr = polyRef(params)
	case "answer_call":
		reqURL, method = base+"/api/v1/callctrl/answerCall", "POST"
		bodyStr = polyRef(params)
	case "reject_call":
		reqURL, method = base+"/api/v1/callctrl/rejectCall", "POST"
		bodyStr = polyRef(params)
	case "hold":
		reqURL, method = base+"/api/v1/callctrl/holdCall", "POST"
		bodyStr = polyRef(params)
	case "resume":
		reqURL, method = base+"/api/v1/callctrl/resumeCall", "POST"
		bodyStr = polyRef(params)
	case "mute":
		reqURL, method = base+"/api/v1/callctrl/mute", "POST"
		bodyStr = wrapPolyData(map[string]interface{}{})
	case "send_dtmf":
		digits, _ := params["digits"].(string)
		if digits == "" {
			return DeviceControlResult{}, fmt.Errorf("missing 'digits' for send_dtmf command")
		}
		reqURL, method = base+"/api/v1/callctrl/sendDTMF", "POST"
		bodyStr = wrapPolyData(map[string]interface{}{"Digits": digits})
	default:
		return DeviceControlResult{}, fmt.Errorf("unknown Poly command: %s", command)
	}

	var bodyReader io.Reader
	if bodyStr != "" {
		bodyReader = strings.NewReader(bodyStr)
	}
	req, err := http.NewRequest(method, reqURL, bodyReader)
	if err != nil {
		return DeviceControlResult{}, err
	}
	req.SetBasicAuth(user, pass)
	if bodyStr != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := client.Do(req)
	if err != nil {
		return DeviceControlResult{}, fmt.Errorf("could not reach Poly phone at %s: %v", ip, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	result := DeviceControlResult{
		Success:      resp.StatusCode >= 200 && resp.StatusCode < 300,
		StatusCode:   resp.StatusCode,
		ResponseBody: string(respBody),
	}
	if resp.StatusCode == 401 {
		result.Error = "Authentication failed — check credentials."
	}
	return result, nil
}

// md5Hex is shared across the package (also used by tool_sip.go).
func md5Hex(s string) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(s)))
}
