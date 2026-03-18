package main

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Yealink model → User-Agent
var yealinkUserAgents = map[string]string{
	"T57W": "Yealink SIP-T57W 96.86.0.45", "T54W": "Yealink SIP-T54W 96.86.0.45",
	"T53W": "Yealink SIP-T53W 96.86.0.45", "T53": "Yealink SIP-T53 96.86.0.45",
	"T48U": "Yealink SIP-T48U 66.86.0.25", "T48S": "Yealink SIP-T48S 66.86.0.25",
	"T46U": "Yealink SIP-T46U 66.86.0.25", "T46S": "Yealink SIP-T46S 66.86.0.25",
	"T43U": "Yealink SIP-T43U 66.86.0.25", "T42U": "Yealink SIP-T42U 66.86.0.25",
	"T42S": "Yealink SIP-T42S 66.86.0.25", "T41S": "Yealink SIP-T41S 66.86.0.25",
	"T48G": "Yealink SIP-T48G 28.81.0.25", "T46G": "Yealink SIP-T46G 28.81.0.25",
	"T42G": "Yealink SIP-T42G 28.81.0.25", "T41P": "Yealink SIP-T41P 28.81.0.25",
	"T40P": "Yealink SIP-T40P 28.81.0.25", "T40G": "Yealink SIP-T40G 28.81.0.25",
	"T34W": "Yealink SIP-T34W 96.86.0.45", "T33G": "Yealink SIP-T33G 96.86.0.45",
	"T33P": "Yealink SIP-T33P 96.86.0.45", "T31W": "Yealink SIP-T31W 96.86.0.45",
	"T31G": "Yealink SIP-T31G 96.86.0.45", "T31P": "Yealink SIP-T31P 96.86.0.45",
	"T31": "Yealink SIP-T31 96.86.0.45", "T30P": "Yealink SIP-T30P 96.86.0.45",
	"T30": "Yealink SIP-T30 96.86.0.45",
	"T29G": "Yealink SIP-T29G 58.80.0.30", "T27G": "Yealink SIP-T27G 58.80.0.30",
	"T23P": "Yealink SIP-T23P 58.80.0.30", "T21P": "Yealink SIP-T21P 58.80.0.30",
	"T19P": "Yealink SIP-T19P 58.80.0.30",
	"CP925": "Yealink SIP-CP925 148.86.0.25", "CP920": "Yealink SIP-CP920 148.86.0.25",
	"VP59": "Yealink SIP-VP59 124.86.0.25",
}

var polyUserAgents = map[string]string{
	"VVX150": "PolycomVVX-VVX_150-UA/6.4.4.8275", "VVX250": "PolycomVVX-VVX_250-UA/6.4.4.8275",
	"VVX350": "PolycomVVX-VVX_350-UA/6.4.4.8275", "VVX450": "PolycomVVX-VVX_450-UA/6.4.4.8275",
	"VVX101": "PolycomVVX-VVX_101-UA/5.9.7.3480", "VVX201": "PolycomVVX-VVX_201-UA/5.9.7.3480",
	"VVX301": "PolycomVVX-VVX_301-UA/5.9.7.3480", "VVX311": "PolycomVVX-VVX_311-UA/5.9.7.3480",
	"VVX401": "PolycomVVX-VVX_401-UA/5.9.7.3480", "VVX411": "PolycomVVX-VVX_411-UA/5.9.7.3480",
	"VVX501": "PolycomVVX-VVX_501-UA/5.9.7.3480", "VVX601": "PolycomVVX-VVX_601-UA/5.9.7.3480",
	"VVX300": "PolycomVVX-VVX_300-UA/5.9.7.3480", "VVX310": "PolycomVVX-VVX_310-UA/5.9.7.3480",
	"VVX400": "PolycomVVX-VVX_400-UA/5.9.7.3480", "VVX410": "PolycomVVX-VVX_410-UA/5.9.7.3480",
	"VVX500": "PolycomVVX-VVX_500-UA/5.9.7.3480", "VVX600": "PolycomVVX-VVX_600-UA/5.9.7.3480",
	"VVX1500": "PolycomVVX-VVX_1500-UA/5.9.7.3480",
	"SPIP550": "PolycomSoundPointIP-SPIP_550-UA/4.0.15.1009",
	"SPIP560": "PolycomSoundPointIP-SPIP_560-UA/4.0.15.1009",
	"SPIP650": "PolycomSoundPointIP-SPIP_650-UA/4.0.15.1009",
	"SPIP670": "PolycomSoundPointIP-SPIP_670-UA/4.0.15.1009",
	"SPIP335": "PolycomSoundPointIP-SPIP_335-UA/4.0.15.1009",
	"SPIP450": "PolycomSoundPointIP-SPIP_450-UA/4.0.15.1009",
	"Trio8500": "PolycomRealPresenceTrio-Trio_8500-UA/7.2.2.1094",
	"Trio8800": "PolycomRealPresenceTrio-Trio_8800-UA/7.2.2.1094",
	"TrioC60": "PolycomRealPresenceTrio-Trio_C60-UA/7.2.2.1094",
}

func RunFetchProvision(p FetchProvisionParams) (*FetchProvisionResult, error) {
	vendor := "yealink"
	if p.Vendor != nil && *p.Vendor != "" {
		vendor = *p.Vendor
	}

	mac, err := normalizeMac(p.Mac)
	if err != nil {
		return nil, err
	}

	baseUA, ok := getProvisionUA(p.Model, vendor)
	if !ok {
		return nil, fmt.Errorf("unknown %s model '%s'", vendor, p.Model)
	}

	var finalURL string
	if vendor == "poly" {
		finalURL = buildPolyProvisionURL(p.ProviderUrl, mac)
	} else {
		finalURL = buildProvisionURL(p.ProviderUrl, mac)
	}

	sendMacInUA := true
	if vendor == "poly" {
		sendMacInUA = false
	}
	if p.IncludeMacInUa != nil {
		sendMacInUA = *p.IncludeMacInUa
	}

	retryLog := []string{}
	initialUA := baseUA
	if sendMacInUA {
		initialUA = baseUA + " " + macWithColons(mac)
	}

	body, status, redirects, uaUsed, err := doProvisionFetch(finalURL, initialUA)
	if err != nil {
		return nil, err
	}
	if sendMacInUA {
		retryLog = append(retryLog, fmt.Sprintf("Request: UA with MAC %s → status %d", macWithColons(mac), status))
	} else {
		retryLog = append(retryLog, fmt.Sprintf("Request: UA without MAC → status %d", status))
	}

	// Retry without MAC in UA if 403/404
	if sendMacInUA && (status == 403 || status == 404) && len(body) < 500 {
		retryLog = append(retryLog, "Retrying with UA without MAC")
		b2, s2, r2, u2, err2 := doProvisionFetch(finalURL, baseUA)
		if err2 == nil {
			retryLog = append(retryLog, fmt.Sprintf("Attempt 2: UA without MAC → status %d", s2))
			body, status, redirects, uaUsed = b2, s2, r2, u2
		} else {
			retryLog = append(retryLog, fmt.Sprintf("Attempt 2 failed: %v", err2))
		}
	}

	parseable := looksProvisionParseable(body)
	var parsed *ParsedProvisionCfg
	if parseable {
		if vendor == "poly" || looksPolyXML(body) {
			parsed = parsePolyCfg(body)
			if parsed == nil {
				parsed = parseYealinkCfg(body)
			}
		} else {
			parsed = parseYealinkCfg(body)
		}
	}

	return &FetchProvisionResult{
		Raw:       body,
		Parsed:    parsed,
		Parseable: parseable,
		RequestInfo: ProvisionRequestInfo{
			FinalUrl:  finalURL,
			UserAgent: uaUsed,
			MacUsed:   mac,
			Status:    status,
			Redirects: redirects,
			RetryLog:  retryLog,
		},
	}, nil
}

func normalizeMac(input string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(input))
	s = strings.NewReplacer(":", "", "-", "", ".", "", " ", "").Replace(s)
	if len(s) != 12 {
		return "", fmt.Errorf("MAC must be 12 hex characters, got %d", len(s))
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return "", fmt.Errorf("MAC must contain only hex digits (0-9, a-f)")
		}
	}
	return s, nil
}

func macWithColons(mac string) string {
	if len(mac) != 12 {
		return mac
	}
	return fmt.Sprintf("%s:%s:%s:%s:%s:%s",
		mac[0:2], mac[2:4], mac[4:6], mac[6:8], mac[8:10], mac[10:12])
}

func getProvisionUA(model, vendor string) (string, bool) {
	if vendor == "poly" {
		ua, ok := polyUserAgents[model]
		return ua, ok
	}
	ua, ok := yealinkUserAgents[model]
	return ua, ok
}

func buildProvisionURL(template, mac string) string {
	url := strings.TrimSpace(template)
	macLower := strings.ToLower(mac)

	url = strings.ReplaceAll(url, "{mac}", macLower)
	url = strings.ReplaceAll(url, "{MAC}", macLower)

	lower := strings.ToLower(url)
	if idx := strings.Index(lower, "%mac%"); idx >= 0 {
		url = url[:idx] + macLower + url[idx+5:]
	}

	lower = strings.ToLower(url)
	if strings.HasSuffix(lower, "mac.cfg") {
		n := len(url) - 7
		url = url[:n] + macLower + ".cfg"
	} else if idx := strings.Index(lower, "/mac.cfg"); idx >= 0 {
		url = url[:idx] + "/" + macLower + ".cfg"
	}

	if !strings.Contains(strings.ToLower(url), macLower) {
		trimmed := strings.TrimRight(url, "/")
		if trimmed == "" || !strings.Contains(trimmed, ".cfg") || strings.HasSuffix(url, "/") {
			url = trimmed + "/" + macLower + ".cfg"
		}
	}
	return url
}

func buildPolyProvisionURL(template, mac string) string {
	url := strings.TrimSpace(template)
	macLower := strings.ToLower(mac)

	url = strings.ReplaceAll(url, "{mac}", macLower)
	url = strings.ReplaceAll(url, "{MAC}", macLower)

	lower := strings.ToLower(url)
	if idx := strings.Index(lower, "%mac%"); idx >= 0 {
		url = url[:idx] + macLower + url[idx+5:]
	}

	lower = strings.ToLower(url)
	if strings.HasSuffix(lower, "mac.cfg") || strings.HasSuffix(lower, "mac-phone.cfg") {
		lastSlash := strings.LastIndex(url, "/")
		start := 0
		if lastSlash >= 0 {
			start = lastSlash + 1
		}
		url = url[:start] + macLower + ".cfg"
	}

	if !strings.Contains(strings.ToLower(url), macLower) {
		trimmed := strings.TrimRight(url, "/")
		url = trimmed + "/" + macLower + ".cfg"
	}
	return url
}

func doProvisionFetch(url, userAgent string) (body string, status int, redirects []string, uaUsed string, err error) {
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", 0, nil, userAgent, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := client.Do(req)
	if err != nil {
		return "", 0, nil, userAgent, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", 0, nil, userAgent, fmt.Errorf("reading body: %w", err)
	}

	finalURL := resp.Request.URL.String()
	var redir []string
	if finalURL != url {
		redir = []string{url, finalURL}
	}

	return string(b), resp.StatusCode, redir, userAgent, nil
}

func looksProvisionParseable(body string) bool {
	if looksPolyXML(body) {
		return true
	}
	lines := strings.Split(body, "\n")
	var linesWithEquals, totalNonEmpty int
	for i, line := range lines {
		if i >= 100 {
			break
		}
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		totalNonEmpty++
		if strings.Contains(t, "=") {
			linesWithEquals++
		}
	}
	if totalNonEmpty == 0 {
		return false
	}
	return float64(linesWithEquals)/float64(totalNonEmpty) > 0.5
}

var polyAttrPatterns = []string{"reg.", "voIpProt.", "tcpIpApp.", "call.", "feature.", "attendant.", "nat.", "dir.", "mb."}

func looksPolyXML(body string) bool {
	trimmed := strings.TrimSpace(body)
	if !strings.HasPrefix(trimmed, "<") && !strings.HasPrefix(trimmed, "<?xml") {
		return false
	}
	count := 0
	lines := strings.Split(trimmed, "\n")
	for i, line := range lines {
		if i >= 50 {
			break
		}
		t := strings.TrimSpace(line)
		for _, pat := range polyAttrPatterns {
			if strings.Contains(t, pat) {
				count++
				break
			}
		}
	}
	return count >= 2
}

var xmlAttrRe = regexp.MustCompile(`(\w[\w.]*)\s*=\s*"([^"]*)"`)

func parseYealinkCfg(body string) *ParsedProvisionCfg {
	groups := map[string][]ProvisionKeyValue{}
	var entries []ProvisionKeyValue

	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		eqIdx := strings.Index(t, "=")
		if eqIdx < 0 {
			continue
		}
		key := strings.TrimSpace(t[:eqIdx])
		value := strings.TrimSpace(t[eqIdx+1:])
		if key == "" {
			continue
		}

		prefix := key
		if dotIdx := strings.Index(key, "."); dotIdx >= 0 {
			prefix = key[:dotIdx+1]
		}
		kv := ProvisionKeyValue{Key: key, Value: value}
		groups[prefix] = append(groups[prefix], kv)
		entries = append(entries, kv)
	}

	if len(entries) == 0 {
		return nil
	}
	return &ParsedProvisionCfg{Groups: groups, Entries: entries}
}

func parsePolyCfg(body string) *ParsedProvisionCfg {
	groups := map[string][]ProvisionKeyValue{}
	var entries []ProvisionKeyValue

	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "<!--") {
			continue
		}
		for _, m := range xmlAttrRe.FindAllStringSubmatch(t, -1) {
			key := m[1]
			value := m[2]
			if key == "" || key == "xmlns" || key == "xml" || strings.HasPrefix(key, "xmlns:") {
				continue
			}
			prefix := key
			if dotIdx := strings.Index(key, "."); dotIdx >= 0 {
				prefix = key[:dotIdx+1]
			}
			kv := ProvisionKeyValue{Key: key, Value: value}
			groups[prefix] = append(groups[prefix], kv)
			entries = append(entries, kv)
		}
	}

	if len(entries) == 0 {
		return nil
	}
	return &ParsedProvisionCfg{Groups: groups, Entries: entries}
}
