package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/miekg/dns"
)

var recordTypeMap = map[string]uint16{
	"A":     dns.TypeA,
	"AAAA":  dns.TypeAAAA,
	"MX":    dns.TypeMX,
	"TXT":   dns.TypeTXT,
	"SRV":   dns.TypeSRV,
	"NAPTR": dns.TypeNAPTR,
	"CNAME": dns.TypeCNAME,
	"NS":    dns.TypeNS,
	"SOA":   dns.TypeSOA,
	"PTR":   dns.TypePTR,
}

func RunDnsLookup(p DnsLookupParams) (*DnsResult, error) {
	if p.Hostname == "" {
		return nil, fmt.Errorf("hostname is required")
	}
	recordType := strings.ToUpper(p.RecordType)
	if recordType == "" {
		recordType = "A"
	}
	qtype, ok := recordTypeMap[recordType]
	if !ok {
		return nil, fmt.Errorf("unsupported record type: %s", p.RecordType)
	}

	server := "8.8.8.8:53"
	if p.Server != nil && *p.Server != "" {
		s := strings.TrimSpace(*p.Server)
		if !strings.Contains(s, ":") {
			s += ":53"
		}
		server = s
	} else {
		if cfg, err := dns.ClientConfigFromFile("/etc/resolv.conf"); err == nil && len(cfg.Servers) > 0 {
			server = net.JoinHostPort(cfg.Servers[0], cfg.Port)
		}
	}

	query := p.Hostname
	if qtype == dns.TypePTR {
		// For PTR, hostname should be an IP; convert to in-addr.arpa / ip6.arpa
		ip := net.ParseIP(p.Hostname)
		if ip == nil {
			return nil, fmt.Errorf("PTR lookup requires an IP address")
		}
		query, _ = dns.ReverseAddr(p.Hostname)
		if query == "" {
			return nil, fmt.Errorf("invalid IP for PTR")
		}
	}
	if !strings.HasSuffix(query, ".") && qtype != dns.TypePTR {
		query = query + "."
	}

	c := new(dns.Client)
	c.Timeout = 5 * time.Second
	m := new(dns.Msg)
	m.SetQuestion(query, qtype)
	m.RecursionDesired = true

	start := time.Now()
	r, _, err := c.Exchange(m, server)
	elapsedMs := uint64(time.Since(start).Milliseconds())
	if err != nil {
		return nil, fmt.Errorf("dns query: %w", err)
	}
	if r == nil || r.Rcode != dns.RcodeSuccess {
		rcode := "unknown"
		if r != nil {
			rcode = dns.RcodeToString[r.Rcode]
		}
		return nil, fmt.Errorf("dns rcode: %s", rcode)
	}

	var records []DnsRecord
	for _, ans := range r.Answer {
		rec := dnsRRToRecord(ans)
		if rec != nil {
			records = append(records, *rec)
		}
	}
	// Include authority and extra if we want; for simplicity only Answer
	result := &DnsResult{
		Query:      p.Hostname,
		RecordType: recordType,
		Server:     &server,
		Records:    records,
		ElapsedMs:  elapsedMs,
	}
	return result, nil
}

func dnsRRToRecord(rr dns.RR) *DnsRecord {
	if rr == nil {
		return nil
	}
	rec := &DnsRecord{RecordType: dns.TypeToString[rr.Header().Rrtype]}
	if ttl := rr.Header().Ttl; ttl > 0 {
		ttl32 := uint32(ttl)
		rec.TTL = &ttl32
	}
	switch v := rr.(type) {
	case *dns.A:
		rec.Value = v.A.String()
	case *dns.AAAA:
		rec.Value = v.AAAA.String()
	case *dns.CNAME:
		rec.Value = v.Target
	case *dns.NS:
		rec.Value = v.Ns
	case *dns.MX:
		rec.Value = fmt.Sprintf("%d %s", v.Preference, v.Mx)
	case *dns.TXT:
		rec.Value = strings.Join(v.Txt, " ")
	case *dns.SRV:
		rec.Value = fmt.Sprintf("%d %d %d %s", v.Priority, v.Weight, v.Port, v.Target)
	case *dns.SOA:
		rec.Value = fmt.Sprintf("%s %s %d %d %d %d %d", v.Ns, v.Mbox, v.Serial, v.Refresh, v.Retry, v.Expire, v.Minttl)
	case *dns.PTR:
		rec.Value = v.Ptr
	case *dns.NAPTR:
		rec.Value = fmt.Sprintf("%d %d %q %q %q %s", v.Order, v.Preference, v.Flags, v.Service, v.Regexp, v.Replacement)
	default:
		rec.Value = rr.String()
	}
	return rec
}

// ─── DNS helpers ────────────────────────────────────────────────────────

func dnsServer(server *string, port *uint16) string {
	s := "8.8.8.8"
	if server != nil && *server != "" {
		s = strings.TrimSpace(*server)
	} else {
		if cfg, err := dns.ClientConfigFromFile("/etc/resolv.conf"); err == nil && len(cfg.Servers) > 0 {
			s = cfg.Servers[0]
		}
	}
	p := "53"
	if port != nil && *port > 0 {
		p = fmt.Sprintf("%d", *port)
	}
	if !strings.Contains(s, ":") {
		s = net.JoinHostPort(s, p)
	}
	return s
}

func dnsQuery(c *dns.Client, server string, name string, qtype uint16) (*dns.Msg, time.Duration, error) {
	m := new(dns.Msg)
	if !strings.HasSuffix(name, ".") {
		name += "."
	}
	m.SetQuestion(name, qtype)
	m.RecursionDesired = true
	r, rtt, err := c.Exchange(m, server)
	return r, rtt, err
}

func rrListToRecords(rrs []dns.RR) []DnsRecord {
	var out []DnsRecord
	for _, rr := range rrs {
		if r := dnsRRToRecord(rr); r != nil {
			out = append(out, *r)
		}
	}
	return out
}

// ─── DnsSipResolve: RFC 3263 NAPTR → SRV → A/AAAA chain ────────────────

func RunDnsSipResolve(p DnsSipResolveParams) (*DnsSipResolveResult, error) {
	if p.Domain == "" {
		return nil, fmt.Errorf("domain is required")
	}
	server := dnsServer(p.Server, p.Port)
	c := &dns.Client{Timeout: 5 * time.Second}
	result := &DnsSipResolveResult{Domain: p.Domain}

	// Step 1: NAPTR query
	naptrStart := time.Now()
	naptrResp, _, naptrErr := dnsQuery(c, server, p.Domain, dns.TypeNAPTR)
	step1 := SipResolveStep{
		Type:      "NAPTR",
		Query:     p.Domain,
		ElapsedMs: uint64(time.Since(naptrStart).Milliseconds()),
	}
	if naptrErr != nil {
		e := naptrErr.Error()
		step1.Error = &e
	} else {
		step1.Records = rrListToRecords(naptrResp.Answer)
	}
	result.Steps = append(result.Steps, step1)

	// Collect SRV targets from NAPTR records
	type srvTarget struct {
		name      string
		transport string
	}
	var srvTargets []srvTarget

	if naptrErr == nil && naptrResp != nil {
		for _, rr := range naptrResp.Answer {
			if naptr, ok := rr.(*dns.NAPTR); ok {
				transport := "udp"
				svc := strings.ToLower(naptr.Service)
				if strings.Contains(svc, "+d2t") {
					transport = "tcp"
				} else if strings.Contains(svc, "+d2s") {
					transport = "sctp"
				} else if strings.Contains(svc, "sips") || strings.Contains(svc, "+d2w") {
					transport = "tls"
				}
				if naptr.Replacement != "" {
					srvTargets = append(srvTargets, srvTarget{name: naptr.Replacement, transport: transport})
				}
			}
		}
	}

	// If no NAPTR results, try SRV directly
	if len(srvTargets) == 0 {
		srvTargets = append(srvTargets,
			srvTarget{name: fmt.Sprintf("_sip._udp.%s", p.Domain), transport: "udp"},
			srvTarget{name: fmt.Sprintf("_sip._tcp.%s", p.Domain), transport: "tcp"},
			srvTarget{name: fmt.Sprintf("_sips._tcp.%s", p.Domain), transport: "tls"},
		)
	}

	// Step 2: SRV queries
	for _, st := range srvTargets {
		srvStart := time.Now()
		srvResp, _, srvErr := dnsQuery(c, server, st.name, dns.TypeSRV)
		step := SipResolveStep{
			Type:      "SRV",
			Query:     st.name,
			ElapsedMs: uint64(time.Since(srvStart).Milliseconds()),
		}
		if srvErr != nil {
			e := srvErr.Error()
			step.Error = &e
		} else {
			step.Records = rrListToRecords(srvResp.Answer)

			for _, rr := range srvResp.Answer {
				if srv, ok := rr.(*dns.SRV); ok {
					target := strings.TrimSuffix(srv.Target, ".")

					// Step 3: A/AAAA for each SRV target
					aStart := time.Now()
					aResp, _, aErr := dnsQuery(c, server, srv.Target, dns.TypeA)
					aStep := SipResolveStep{
						Type:      "A",
						Query:     target,
						ElapsedMs: uint64(time.Since(aStart).Milliseconds()),
					}
					if aErr != nil {
						e := aErr.Error()
						aStep.Error = &e
					} else {
						aStep.Records = rrListToRecords(aResp.Answer)
					}
					result.Steps = append(result.Steps, aStep)

					result.Targets = append(result.Targets, SipResolveTarget{
						Host:      target,
						Port:      srv.Port,
						Transport: st.transport,
						Priority:  srv.Priority,
						Weight:    srv.Weight,
					})
				}
			}
		}
		result.Steps = append(result.Steps, step)
	}

	// Fallback: if no SRV results, resolve the domain itself as A record
	if len(result.Targets) == 0 {
		aStart := time.Now()
		aResp, _, aErr := dnsQuery(c, server, p.Domain, dns.TypeA)
		step := SipResolveStep{
			Type:      "A",
			Query:     p.Domain,
			ElapsedMs: uint64(time.Since(aStart).Milliseconds()),
		}
		if aErr != nil {
			e := aErr.Error()
			step.Error = &e
		} else {
			step.Records = rrListToRecords(aResp.Answer)
			for _, rr := range aResp.Answer {
				if a, ok := rr.(*dns.A); ok {
					result.Targets = append(result.Targets, SipResolveTarget{
						Host:      a.A.String(),
						Port:      5060,
						Transport: "udp",
						Priority:  0,
						Weight:    0,
					})
				}
			}
		}
		result.Steps = append(result.Steps, step)
	}

	return result, nil
}

// ─── DnsReverse: PTR lookup with optional FCrDNS ────────────────────────

func RunDnsReverse(p DnsReverseParams) (*DnsReverseResult, error) {
	if p.IP == "" {
		return nil, fmt.Errorf("ip is required")
	}
	server := dnsServer(p.Server, p.Port)
	c := &dns.Client{Timeout: 5 * time.Second}

	arpa, err := dns.ReverseAddr(p.IP)
	if err != nil {
		return nil, fmt.Errorf("invalid IP: %w", err)
	}

	start := time.Now()
	m := new(dns.Msg)
	m.SetQuestion(arpa, dns.TypePTR)
	m.RecursionDesired = true
	r, _, err := c.Exchange(m, server)
	elapsed := uint64(time.Since(start).Milliseconds())
	if err != nil {
		return nil, fmt.Errorf("reverse dns: %w", err)
	}

	var hostnames []string
	for _, rr := range r.Answer {
		if ptr, ok := rr.(*dns.PTR); ok {
			hostnames = append(hostnames, strings.TrimSuffix(ptr.Ptr, "."))
		}
	}

	result := &DnsReverseResult{
		IP:        p.IP,
		Hostnames: hostnames,
		ElapsedMs: elapsed,
	}

	// FCrDNS: Forward-Confirmed reverse DNS
	if p.FCrDNS && len(hostnames) > 0 {
		verified := false
		for _, hostname := range hostnames {
			aResp, _, aErr := dnsQuery(c, server, hostname, dns.TypeA)
			if aErr != nil {
				continue
			}
			for _, rr := range aResp.Answer {
				if a, ok := rr.(*dns.A); ok {
					if a.A.String() == p.IP {
						verified = true
						break
					}
				}
			}
			if !verified {
				// Also check AAAA
				aaaaResp, _, aaaaErr := dnsQuery(c, server, hostname, dns.TypeAAAA)
				if aaaaErr == nil {
					for _, rr := range aaaaResp.Answer {
						if aaaa, ok := rr.(*dns.AAAA); ok {
							if aaaa.AAAA.String() == p.IP {
								verified = true
								break
							}
						}
					}
				}
			}
			if verified {
				break
			}
		}
		result.Verified = &verified
	}

	return result, nil
}

// ─── DnsDig: Raw DNS query with full response details ───────────────────

func RunDnsDig(p DnsDigParams) (*DnsDigResult, error) {
	if p.Domain == "" {
		return nil, fmt.Errorf("domain is required")
	}
	recordType := strings.ToUpper(p.RecordType)
	if recordType == "" {
		recordType = "A"
	}
	qtype, ok := recordTypeMap[recordType]
	if !ok {
		return nil, fmt.Errorf("unsupported record type: %s", p.RecordType)
	}

	server := dnsServer(p.Server, p.Port)
	c := &dns.Client{Timeout: 5 * time.Second}
	if p.UseTCP {
		c.Net = "tcp"
	}

	query := p.Domain
	if !strings.HasSuffix(query, ".") {
		query += "."
	}

	m := new(dns.Msg)
	m.SetQuestion(query, qtype)
	m.RecursionDesired = true // default
	if p.Flags != nil {
		if p.Flags.RD != nil {
			m.RecursionDesired = *p.Flags.RD
		}
		if p.Flags.CD != nil {
			m.CheckingDisabled = *p.Flags.CD
		}
		if p.Flags.AD != nil {
			m.AuthenticatedData = *p.Flags.AD
		}
	}

	start := time.Now()
	r, _, err := c.Exchange(m, server)
	elapsed := uint64(time.Since(start).Milliseconds())
	if err != nil {
		return nil, fmt.Errorf("dns query: %w", err)
	}

	status := "NOERROR"
	if r != nil {
		if s, ok := dns.RcodeToString[r.Rcode]; ok {
			status = s
		}
	}

	result := &DnsDigResult{
		Query:      p.Domain,
		RecordType: recordType,
		Server:     server,
		Status:     status,
		ElapsedMs:  elapsed,
		Answer:     rrListToRecords(r.Answer),
		Authority:  rrListToRecords(r.Ns),
		Additional: rrListToRecords(r.Extra),
	}
	if r != nil {
		result.Flags = DigResFlags{
			QR: r.Response,
			AA: r.Authoritative,
			TC: r.Truncated,
			RD: r.RecursionDesired,
			RA: r.RecursionAvailable,
			AD: r.AuthenticatedData,
			CD: r.CheckingDisabled,
		}
	}

	return result, nil
}

// ─── DnsGeoIp: GeoIP lookup via ip-api.com ──────────────────────────────

func RunDnsGeoIp(p DnsGeoIpParams) (*GeoIpBatchResult, error) {
	if len(p.IPs) == 0 {
		return nil, fmt.Errorf("at least one IP is required")
	}

	httpClient := &http.Client{Timeout: 10 * time.Second}
	var results []GeoIpResult

	// ip-api.com supports batch queries (up to 100)
	type ipAPIResp struct {
		Status      string  `json:"status"`
		Message     string  `json:"message"`
		Query       string  `json:"query"`
		Country     string  `json:"country"`
		CountryCode string  `json:"countryCode"`
		RegionName  string  `json:"regionName"`
		City        string  `json:"city"`
		Lat         float64 `json:"lat"`
		Lon         float64 `json:"lon"`
		ISP         string  `json:"isp"`
		Org         string  `json:"org"`
		AS          string  `json:"as"`
	}

	// Try batch API first (POST to /batch)
	if len(p.IPs) > 1 {
		batchBody, _ := json.Marshal(p.IPs)
		resp, err := httpClient.Post("http://ip-api.com/batch?fields=status,message,query,country,countryCode,regionName,city,lat,lon,isp,org,as", "application/json", strings.NewReader(string(batchBody)))
		if err == nil {
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			var batchResp []ipAPIResp
			if json.Unmarshal(body, &batchResp) == nil {
				for _, r := range batchResp {
					gr := GeoIpResult{IP: r.Query}
					if r.Status == "success" {
						gr.Country = strPtr(r.Country)
						gr.CountryCode = strPtr(r.CountryCode)
						gr.Region = strPtr(r.RegionName)
						gr.City = strPtr(r.City)
						gr.Lat = &r.Lat
						gr.Lon = &r.Lon
						gr.ISP = strPtr(r.ISP)
						gr.Org = strPtr(r.Org)
						gr.AS = strPtr(r.AS)
					} else {
						gr.Error = strPtr(r.Message)
					}
					results = append(results, gr)
				}
				return &GeoIpBatchResult{Results: results}, nil
			}
		}
	}

	// Fallback: query one at a time
	for _, ip := range p.IPs {
		gr := GeoIpResult{IP: ip}
		resp, err := httpClient.Get(fmt.Sprintf("http://ip-api.com/json/%s?fields=status,message,query,country,countryCode,regionName,city,lat,lon,isp,org,as", ip))
		if err != nil {
			e := err.Error()
			gr.Error = &e
			results = append(results, gr)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var r ipAPIResp
		if json.Unmarshal(body, &r) != nil {
			e := "failed to parse response"
			gr.Error = &e
		} else if r.Status != "success" {
			gr.Error = strPtr(r.Message)
		} else {
			gr.Country = strPtr(r.Country)
			gr.CountryCode = strPtr(r.CountryCode)
			gr.Region = strPtr(r.RegionName)
			gr.City = strPtr(r.City)
			gr.Lat = &r.Lat
			gr.Lon = &r.Lon
			gr.ISP = strPtr(r.ISP)
			gr.Org = strPtr(r.Org)
			gr.AS = strPtr(r.AS)
		}
		results = append(results, gr)

		// Rate limit: ip-api.com allows 45 req/min for free tier
		if len(p.IPs) > 1 {
			time.Sleep(100 * time.Millisecond)
		}
	}

	return &GeoIpBatchResult{Results: results}, nil
}

// strPtr is defined in tool_ping.go
