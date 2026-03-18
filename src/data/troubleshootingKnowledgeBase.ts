/**
 * Comprehensive VoIP/SIP/RTP/T.38/Networking Troubleshooting Knowledge Base.
 *
 * CONTENT SOURCING POLICY:
 * Every cause, diagnostic step, solution, and threshold in this file is sourced from
 * published standards, vendor documentation, or established community resources.
 * Zero AI-generated troubleshooting advice.
 *
 * Primary Sources:
 * - RFC 3261 (SIP), RFC 3263 (SIP DNS), RFC 3264 (SDP Offer/Answer), RFC 8866 (SDP, obsoletes RFC 4566)
 * - RFC 4028 (Session Timers), RFC 4733 (DTMF), RFC 7616 (Digest Auth)
 * - RFC 8446 (TLS 1.3), RFC 8862 (Secure Media)
 * - ITU-T G.107 (E-Model), G.114 (Delay), P.800 (MOS), T.38 (FoIP)
 * - Cisco CUBE/UCM/QoS Design Guides
 * - Asterisk/FreeSWITCH community documentation
 * - voip-info.org, pbxmechanic.com, onsip.com, Sansay TAC
 * - viirtue.com (SIP ALG 2026), videosdk.live (Jitter 2025), AVOXI (QoS 2025)
 */

import type { TsArticle } from "@/types/troubleshootingEngine";

export const KNOWLEDGE_BASE_ARTICLES: TsArticle[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // SIP REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "reg-401-unauthorized",
    title: "401 Unauthorized Loop — Repeated Authentication Failures",
    domains: ["sip"],
    categories: ["registration"],
    severity: "critical",
    symptoms: [
      "REGISTER returns 401 Unauthorized repeatedly in a loop (not just the initial challenge)",
      "Phone shows 'Registration Failed' or 'Authentication Error' after providing credentials",
      "Continuous REGISTER → 401 → REGISTER (with credentials) → 401 loop in packet capture",
      "Note: A single 401 followed by 200 OK is NORMAL — SIP digest auth requires a challenge/response exchange",
    ],
    causes: [
      { summary: "Wrong credentials", likelihood: "high", detail: "Username, password, or authentication username is incorrect. Many providers use a different 'auth username' than the SIP username/extension number." },
      { summary: "Realm mismatch", likelihood: "medium", detail: "The realm in the WWW-Authenticate challenge does not match the realm configured on the client. The digest hash is computed over realm, so a mismatch causes the hash to fail." },
      { summary: "Nonce expired or stale", likelihood: "medium", detail: "The server's nonce has expired between the challenge and the response. Some servers have very short nonce lifetimes." },
      { summary: "Algorithm mismatch", likelihood: "low", detail: "Server requires MD5-sess or SHA-256 but client only supports MD5. Check the 'algorithm' parameter in WWW-Authenticate." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the SIP REGISTER exchange with SIPalyzer Packet Monitor", expected: "You should see: REGISTER → 401 (with WWW-Authenticate) → REGISTER (with Authorization) → 200 OK or another 401" },
      { order: 2, instruction: "In the 401 response, examine the WWW-Authenticate header: note the realm, nonce, algorithm, and qop values" },
      { order: 3, instruction: "In the second REGISTER, examine the Authorization header: verify username, realm, uri, nonce, and response hash" },
      { order: 4, instruction: "Compare the realm in WWW-Authenticate with the realm in Authorization — they must match exactly" },
      { order: 5, instruction: "Verify the username in Authorization matches what the provider expects (may differ from extension number)" },
    ],
    solutions: [
      { summary: "Fix credentials", steps: ["Verify the exact username, auth username, and password with your provider", "Update credentials in SIPalyzer Registration settings", "Re-test registration"], appliesWhen: "When credentials are incorrect" },
      { summary: "Match realm", steps: ["Copy the realm value from the 401 WWW-Authenticate header", "Configure this exact realm on your SIP client", "Re-test registration"], appliesWhen: "When realm does not match" },
      { summary: "Handle stale nonce", steps: ["If the 401 contains stale=true, the client should automatically retry with the new nonce", "If your client doesn't handle stale nonces, update firmware/software", "Consider reducing registration interval to keep nonce fresh"], appliesWhen: "When nonce has expired" },
    ],
    relatedSipCodes: [401, 403, 407],
    relatedArticleIds: ["reg-403-forbidden", "reg-407-proxy-auth", "digest-auth-deep-dive"],
    references: [
      { title: "RFC 3261 Section 22 — Usage of HTTP Authentication", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-22", type: "rfc" },
      { title: "RFC 7616 — HTTP Digest Access Authentication", url: "https://datatracker.ietf.org/doc/html/rfc7616", type: "rfc" },
      { title: "Asterisk PJSIP: Registration Auth Failures (403/401)", url: "https://mylinehub.com/articles/asterisk-pjsip-registration-auth-failures-latest", type: "community" },
      { title: "SIP Trunk Registration Problems — Dialaxy", url: "https://dialaxy.com/troubleshooting-support/sip-trunk-registration-problems/", type: "community" },
    ],
    sipalizerTools: [
      { toolId: "registration", label: "Test Registration" },
      { toolId: "packet-capture", subviewId: "viewer", label: "Capture SIP Exchange" },
      { toolId: "composer", subviewId: "requests", label: "Craft REGISTER Request" },
    ],
    keywords: ["401", "unauthorized", "authentication", "digest", "credentials", "password", "realm", "nonce", "registration", "failed"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "reg-403-forbidden",
    title: "403 Forbidden — Registration Blocked",
    domains: ["sip"],
    categories: ["registration"],
    severity: "critical",
    symptoms: [
      "REGISTER returns 403 Forbidden",
      "Credentials are correct but registration is still rejected",
      "Works from one IP but not another",
    ],
    causes: [
      { summary: "IP not in ACL", likelihood: "high", detail: "The server has an IP-based access control list and your source IP is not on it. Common with SIP trunking providers that require IP whitelisting." },
      { summary: "Account disabled/blocked", likelihood: "medium", detail: "The user account has been disabled by an administrator or automatically blocked due to too many failed attempts." },
      { summary: "Wrong SIP domain", likelihood: "medium", detail: "Credentials are correct but the From or To URI uses a domain the server does not accept for this account." },
      { summary: "Geographic restriction", likelihood: "low", detail: "Some providers restrict registration from certain countries or IP ranges." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Verify your public IP address matches what is whitelisted with the provider" },
      { order: 2, instruction: "Check if the 403 response body or Warning header contains additional detail" },
      { order: 3, instruction: "Try registering from a different network to determine if it's IP-based" },
      { order: 4, instruction: "Verify the SIP domain in the From and To headers matches the provider's requirements" },
    ],
    solutions: [
      { summary: "Whitelist your IP", steps: ["Log into your SIP provider portal", "Add your public IP to the allowed IP list", "Wait for propagation (some providers take up to 5 minutes)", "Re-test registration"], appliesWhen: "When provider uses IP whitelisting" },
      { summary: "Unblock account", steps: ["Contact your provider to check if the account is locked", "If locked due to failed auth attempts, wait for the lockout period or request unlock", "Update credentials if they were changed"], appliesWhen: "When account is blocked" },
      { summary: "Fix SIP domain", steps: ["Check provider documentation for the correct SIP domain", "Update From and To URIs to use the correct domain", "Re-test registration"], appliesWhen: "When domain is wrong" },
    ],
    relatedSipCodes: [403, 401],
    relatedArticleIds: ["reg-401-unauthorized"],
    references: [
      { title: "RFC 3261 Section 21.4.4 — 403 Forbidden", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-21.4.4", type: "rfc" },
      { title: "SIP Trunk Registration Problems — Dialaxy", url: "https://dialaxy.com/troubleshooting-support/sip-trunk-registration-problems/", type: "community" },
    ],
    sipalizerTools: [
      { toolId: "registration", label: "Test Registration" },
      { toolId: "network", subviewId: "connectivity", label: "Check Network" },
    ],
    keywords: ["403", "forbidden", "blocked", "ACL", "whitelist", "IP", "registration", "domain"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "reg-407-proxy-auth",
    title: "407 Proxy Authentication Loop — Calls Fail Despite Registration",
    domains: ["sip"],
    categories: ["registration", "call-setup"],
    severity: "critical",
    symptoms: [
      "INVITE returns 407 Proxy Authentication Required repeatedly (not just the initial challenge)",
      "Registration works but calls fail with repeated 407 loops",
      "A single 407 followed by a successful re-send is NORMAL (proxy digest auth challenge/response)",
      "Different credentials needed for proxy vs registrar",
    ],
    causes: [
      { summary: "Missing proxy credentials", likelihood: "high", detail: "The outbound proxy requires authentication separately from the registrar. The proxy uses Proxy-Authenticate/Proxy-Authorization headers instead of WWW-Authenticate/Authorization." },
      { summary: "Wrong proxy credentials", likelihood: "medium", detail: "Proxy credentials differ from registration credentials. Some providers use different username/password for the proxy." },
      { summary: "No outbound proxy configured", likelihood: "medium", detail: "The SIP client is sending requests directly instead of through the required outbound proxy." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the SIP exchange and look for 407 response" },
      { order: 2, instruction: "Check the Proxy-Authenticate header in the 407 for realm and algorithm" },
      { order: 3, instruction: "Verify your client is configured with proxy authentication credentials" },
      { order: 4, instruction: "Confirm the outbound proxy address is configured correctly" },
    ],
    solutions: [
      { summary: "Configure proxy credentials", steps: ["Set proxy auth username and password (may differ from registration credentials)", "Configure the outbound proxy address", "Re-test the call"], appliesWhen: "When proxy credentials are missing or wrong" },
    ],
    relatedSipCodes: [407, 401],
    relatedArticleIds: ["reg-401-unauthorized"],
    references: [
      { title: "RFC 3261 Section 21.4.8 — 407 Proxy Authentication Required", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-21.4.8", type: "rfc" },
      { title: "407 Troubleshooting — CounterPath", url: "https://support.counterpath.com/hc/407-troubleshooting", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "registration", label: "Test Registration" },
      { toolId: "composer", subviewId: "requests", label: "Test with Composer" },
    ],
    keywords: ["407", "proxy", "authentication", "proxy-authenticate", "outbound proxy"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "dns-srv-naptr-failures",
    title: "DNS SRV/NAPTR Resolution Failures for SIP",
    domains: ["sip", "dns"],
    categories: ["registration", "dns-resolution"],
    severity: "critical",
    symptoms: [
      "Registration fails with no response (timeout)",
      "DNS lookup for SIP server returns no results",
      "SRV records not found for _sip._udp or _sip._tcp",
      "Call attempts time out without any SIP response",
    ],
    causes: [
      { summary: "Missing DNS SRV records", likelihood: "high", detail: "The SIP domain does not have _sip._udp, _sip._tcp, or _sips._tcp SRV records configured. Per RFC 3263, SIP uses these records to discover servers." },
      { summary: "DNS server unreachable", likelihood: "medium", detail: "The configured DNS server is not responding or is blocking queries." },
      { summary: "NAPTR records misconfigured", likelihood: "medium", detail: "NAPTR records exist but point to wrong service/protocol, or have incorrect replacement fields." },
      { summary: "DNSSEC validation failure", likelihood: "low", detail: "DNS responses fail DNSSEC validation, causing the resolver to reject them." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Use SIPalyzer DNS tool to query SRV records: _sip._udp.<domain> and _sip._tcp.<domain>", expected: "Should return at least one SRV record with host, port, priority, and weight" },
      { order: 2, instruction: "Query NAPTR records for the domain", expected: "Should return NAPTR records with SIP service flags (s, S, or empty) pointing to SRV record names" },
      { order: 3, instruction: "If no SRV/NAPTR records, query A/AAAA records for the domain directly", expected: "Should return an IP address. Without SRV, SIP defaults to port 5060 UDP per RFC 3263" },
      { order: 4, instruction: "Verify the resolved IP is reachable (ping, port scan on 5060)" },
    ],
    solutions: [
      { summary: "Use direct IP instead of DNS", steps: ["Configure the SIP server address as an IP:port instead of a domain", "This bypasses DNS resolution entirely", "Only use as a workaround — proper DNS is recommended"], appliesWhen: "When DNS is misconfigured and you need immediate service" },
      { summary: "Fix DNS records", steps: ["Add SRV records: _sip._udp.<domain> pointing to your SIP server", "Add SRV records: _sip._tcp.<domain> for TCP transport", "Add SRV records: _sips._tcp.<domain> for TLS transport", "Ensure A/AAAA records exist for the SRV target hosts", "Set appropriate priorities and weights for failover"], appliesWhen: "When you control the DNS zone" },
      { summary: "Change DNS server", steps: ["Try a different DNS server (e.g., 8.8.8.8, 1.1.1.1)", "Check if your ISP's DNS server is blocking or filtering SRV queries"], appliesWhen: "When your DNS server is not responding" },
    ],
    relatedSipCodes: [408],
    relatedArticleIds: ["sip-408-timeout", "dns-config-for-sip"],
    references: [
      { title: "RFC 3263 — Locating SIP Servers", url: "https://datatracker.ietf.org/doc/html/rfc3263", type: "rfc" },
      { title: "RFC 2782 — DNS SRV Records", url: "https://datatracker.ietf.org/doc/html/rfc2782", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "voip", label: "SIP DNS Resolution" },
      { toolId: "network", subviewId: "connectivity", label: "DNS Lookup" },
    ],
    keywords: ["DNS", "SRV", "NAPTR", "resolution", "lookup", "timeout", "_sip._udp", "_sip._tcp", "RFC 3263"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "nat-registration-issues",
    title: "NAT Registration Issues — SIP ALG and Contact Rewriting",
    domains: ["sip", "network"],
    categories: ["registration", "nat-firewall"],
    severity: "critical",
    symptoms: [
      "Registration succeeds but incoming calls don't arrive",
      "Registration works initially but drops after a few minutes",
      "Contact header shows private IP (10.x, 192.168.x, 172.16-31.x) in captures",
      "SIP ALG rewriting headers unexpectedly",
    ],
    causes: [
      { summary: "SIP ALG active on router", likelihood: "high", detail: "SIP Application Layer Gateway on the router rewrites SIP headers (Contact, Via, SDP c= line) in ways that break modern VoIP. SIP ALG accounts for nearly 40% of call setup failures and over 25% of one-way audio incidents in SMB environments (viirtue.com 2026)." },
      { summary: "Private IP in Contact header", likelihood: "high", detail: "The UA sends its private/LAN IP in the Contact header. The registrar stores this address and sends incoming calls to it, which is unreachable from the internet." },
      { summary: "NAT binding timeout", likelihood: "medium", detail: "The NAT translation entry expires before the registration refresh, causing the server to send traffic to a closed NAT pinhole." },
      { summary: "Double NAT", likelihood: "medium", detail: "Two NAT devices in the path (e.g., ISP modem + router), making it harder to maintain consistent NAT mappings." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture REGISTER on both sides of the NAT (inside and outside if possible)", expected: "Compare Contact headers — if they differ, SIP ALG may be rewriting them" },
      { order: 2, instruction: "Check the Contact header in the 200 OK response from the registrar", expected: "It should show the public IP:port that the server will use for incoming requests" },
      { order: 3, instruction: "Check router settings for SIP ALG / SIP helper / SIP transformations" },
      { order: 4, instruction: "Monitor registration keep-alive interval vs NAT binding timeout", expected: "Re-registration interval should be shorter than NAT timeout (typically 30-60 seconds for UDP)" },
    ],
    solutions: [
      { summary: "Disable SIP ALG", steps: ["Access your router admin panel", "Find SIP ALG, SIP Helper, or SIP Transformations setting", "Disable it completely", "Reboot the router", "Re-test registration and incoming calls"], appliesWhen: "SIP ALG is active (most common fix)" },
      { summary: "Configure outbound proxy", steps: ["Configure your provider's outbound proxy — most providers handle NAT traversal automatically through their proxy infrastructure", "Enable rport in Via header (RFC 3581) to signal NAT awareness", "If your provider doesn't offer a proxy, set your public IP as the external address manually"], appliesWhen: "When the UA needs to advertise its public address" },
      { summary: "Reduce registration interval", steps: ["Set registration expiry to 60 seconds or less", "This keeps the NAT pinhole open with frequent re-registrations", "Some providers enforce minimum expiry — check Min-Expires header"], appliesWhen: "When NAT bindings expire before re-registration" },
      { summary: "Eliminate double NAT", steps: ["Put the ISP modem in bridge mode", "Or place the VoIP device in the DMZ of the outer NAT", "Ensure only one device is performing NAT"], appliesWhen: "When double NAT is present" },
    ],
    relatedSipCodes: [408, 480],
    relatedArticleIds: ["one-way-audio", "sip-alg-problems", "nat-traversal-stun-turn"],
    references: [
      { title: "How to Solve SIP ALG Problems in 2026 — Viirtue", url: "https://viirtue.com/how-to-solve-sip-alg-problems-in-2026-a-practical-voip-guide-for-smbs-and-msps/", type: "community" },
      { title: "RFC 3581 — Symmetric Response Routing (rport)", url: "https://datatracker.ietf.org/doc/html/rfc3581", type: "rfc" },
      { title: "VoIP: SIP phones cannot make/receive calls — SonicWall", url: "https://www.sonicwall.com/support/knowledge-base/voip-sip-phones-cannot-make-and-or-receive-calls/170505972489729", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "registration", label: "Test Registration" },
      { toolId: "packet-capture", subviewId: "viewer", label: "Capture SIP Traffic" },
      { toolId: "network", subviewId: "voip", label: "Network Test" },
    ],
    keywords: ["NAT", "SIP ALG", "Contact header", "private IP", "registration", "keep-alive", "double NAT", "firewall", "rport"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "reg-expiry-keepalive",
    title: "Registration Expiry and Keep-Alive Failures",
    domains: ["sip"],
    categories: ["registration"],
    severity: "warning",
    symptoms: [
      "Registration drops periodically and then re-registers",
      "Intermittent 'not registered' status",
      "Incoming calls fail during brief unregistered windows",
    ],
    causes: [
      { summary: "Re-register interval too long", likelihood: "high", detail: "The re-registration timer fires after the server's expiry window closes, leaving a gap where the UA is unregistered." },
      { summary: "NAT binding expires", likelihood: "high", detail: "UDP NAT bindings typically expire in 30-120 seconds. If registration expiry is longer (e.g., 3600s), the NAT pinhole closes and the re-REGISTER from the server perspective comes from a new source." },
      { summary: "Network interruption", likelihood: "medium", detail: "Brief network outages cause the re-REGISTER to fail, and the UA doesn't retry quickly enough." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the Expires value in the 200 OK response to REGISTER", expected: "Note the actual expiry granted by the server (may differ from what was requested)" },
      { order: 2, instruction: "Monitor re-registration timing in the packet capture", expected: "Re-REGISTER should fire at approximately 50-75% of the Expires interval" },
      { order: 3, instruction: "Check if the server responds with 423 Interval Too Brief", expected: "If so, check Min-Expires header for the minimum acceptable value" },
    ],
    solutions: [
      { summary: "Reduce Expires interval", steps: ["Set Expires to 120 seconds or less for UDP behind NAT", "This ensures frequent re-registration keeps the NAT pinhole open", "Re-test to confirm server accepts the shorter interval"], appliesWhen: "When behind NAT with UDP transport" },
      { summary: "Use TCP or TLS transport", steps: ["Switch from UDP to TCP or TLS", "TCP connections maintain the NAT mapping for the duration of the connection", "This eliminates the NAT binding expiry problem"], appliesWhen: "When NAT binding timeout is the issue" },
      { summary: "Configure SIP keep-alive", steps: ["Enable SIP OPTIONS keep-alive or CRLF keep-alive", "Set keep-alive interval to 20-30 seconds", "This keeps the NAT pinhole open between registrations"], appliesWhen: "When you cannot reduce Expires interval" },
    ],
    relatedSipCodes: [423],
    relatedArticleIds: ["nat-registration-issues"],
    references: [
      { title: "RFC 3261 Section 10.2 — Constructing the REGISTER Request", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-10.2", type: "rfc" },
      { title: "RFC 5626 — Managing Client-Initiated Connections (outbound)", url: "https://datatracker.ietf.org/doc/html/rfc5626", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "registration", label: "Test Registration" },
      { toolId: "packet-capture", subviewId: "viewer", label: "Monitor Re-Registration Timing" },
    ],
    keywords: ["expiry", "expires", "keep-alive", "re-register", "timeout", "423", "Min-Expires", "NAT binding"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "tls-registration-failures",
    title: "TLS/Certificate Registration Failures",
    domains: ["sip", "security"],
    categories: ["registration", "certificates"],
    severity: "critical",
    symptoms: [
      "TLS connection to SIP server fails",
      "Certificate validation error during registration",
      "Registration works on port 5060 (UDP) but not 5061 (TLS)",
      "Handshake timeout on TLS connection",
    ],
    causes: [
      { summary: "Certificate expired or not yet valid", likelihood: "high", detail: "The server's TLS certificate has expired or its 'not before' date is in the future. Check the certificate dates." },
      { summary: "Certificate hostname mismatch", likelihood: "high", detail: "The SIP domain does not match the CN or SAN (Subject Alternative Name) in the server certificate." },
      { summary: "Untrusted CA", likelihood: "medium", detail: "The certificate was issued by a CA not in the client's trust store (self-signed or private CA)." },
      { summary: "TLS version mismatch", likelihood: "medium", detail: "Client and server cannot agree on a TLS version. Some older servers only support TLS 1.0/1.1 which modern clients reject." },
      { summary: "Wrong port", likelihood: "low", detail: "Client connecting to 5060 with TLS (should be 5061) or vice versa." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Verify the server is listening on port 5061 for TLS", expected: "Port scan should show 5061 open" },
      { order: 2, instruction: "Check the server certificate using openssl s_client -connect <server>:5061", expected: "Should show a valid certificate chain" },
      { order: 3, instruction: "Verify certificate dates (not before / not after)" },
      { order: 4, instruction: "Check that the SIP domain matches the CN or SAN in the certificate" },
    ],
    solutions: [
      { summary: "Renew certificate", steps: ["Obtain a new certificate for the SIP domain", "Install it on the SIP server", "Restart the SIP service", "Re-test TLS registration"], appliesWhen: "When certificate is expired" },
      { summary: "Fix hostname", steps: ["Ensure the certificate's CN or SAN matches the SIP domain you're connecting to", "Or use the server's IP/hostname as the registration target instead"], appliesWhen: "When hostname doesn't match certificate" },
      { summary: "Install CA certificate", steps: ["Add the server's CA certificate to your client's trust store", "For self-signed certs, import the server certificate directly"], appliesWhen: "When CA is not trusted" },
    ],
    relatedSipCodes: [403],
    relatedArticleIds: ["tls-certificate-verification", "srtp-key-negotiation"],
    references: [
      { title: "RFC 8446 — TLS 1.3", url: "https://datatracker.ietf.org/doc/html/rfc8446", type: "rfc" },
      { title: "RFC 8862 — Best Practices for Securing RTP Media Signaled with SIP", url: "https://datatracker.ietf.org/doc/html/rfc8862", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "registration", label: "Test TLS Registration" },
      { toolId: "network", subviewId: "connectivity", label: "Port Scan 5061" },
    ],
    keywords: ["TLS", "certificate", "SSL", "5061", "handshake", "expired", "hostname", "CA", "trust", "SIPS"],
    lastUpdated: "2025-06-01",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SIP CALL SETUP
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "sip-400-bad-request",
    title: "400 Bad Request — Malformed SIP Syntax or Headers",
    domains: ["sip"],
    categories: ["call-setup", "registration", "interop"],
    severity: "critical",
    symptoms: [
      "INVITE or REGISTER returns 400 Bad Request immediately",
      "Response appears before authentication or routing checks happen",
      "Only one endpoint or trunk returns 400 while others accept the same call",
      "Packet capture shows unusual header formatting, URI encoding, or Content-Length mismatch",
    ],
    causes: [
      { summary: "Malformed SIP start-line or required headers", likelihood: "high", detail: "Request-Line or mandatory headers (Via, To, From, Call-ID, CSeq, Max-Forwards) are missing, duplicated incorrectly, or syntactically invalid." },
      { summary: "URI format/escaping issue", likelihood: "high", detail: "Invalid characters or bad escaping in Request-URI, From, or To (for example spaces, unescaped semicolons, or malformed display-name quoting)." },
      { summary: "Content-Length does not match message body", likelihood: "medium", detail: "The body length in bytes does not match Content-Length, so the parser rejects the message as malformed." },
      { summary: "Header folding/line-ending interoperability issue", likelihood: "medium", detail: "Non-standard line endings, obsolete folding, or proxy/SBC rewriting can produce a message another SIP stack cannot parse." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the raw failing SIP message and inspect the start-line plus all mandatory headers", expected: "Request-Line is valid and all required headers are present exactly once where required" },
      { order: 2, instruction: "Validate Request-URI, To, and From syntax (scheme, user@domain, parameters, quoting/escaping)", expected: "No illegal characters and URI grammar conforms to SIP/URI ABNF" },
      { order: 3, instruction: "Compare Content-Length value with actual body byte length", expected: "Content-Length exactly matches body size (or is 0 when no body exists)" },
      { order: 4, instruction: "Replay a minimal known-good request in Composer and add custom headers incrementally", expected: "400 appears only after introducing the malformed field, isolating the root cause" },
      { order: 5, instruction: "If an SBC/proxy is in path, compare pre- and post-proxy captures", expected: "No intermediary rewrites create malformed headers or URI parameters" },
    ],
    solutions: [
      { summary: "Correct mandatory header and URI syntax", steps: ["Fix Request-Line and required headers to RFC-conformant format", "Normalize URI formatting (valid user@domain, properly escaped parameters, consistent quoting)", "Retest with a clean INVITE/REGISTER template"], appliesWhen: "When parser rejects malformed headers or URIs" },
      { summary: "Fix message framing", steps: ["Set Content-Length from actual byte length of body", "Ensure CRLF framing is correct and avoid non-standard header folding", "If generated by code, use a tested SIP library/serializer instead of manual string concatenation"], appliesWhen: "When body length or framing causes parser failure" },
      { summary: "Isolate intermediary rewriting", steps: ["Bypass or disable problematic SIP ALG/SBC normalization policy", "Apply header normalization rules on the intermediary", "Confirm message remains valid on both sides of the hop"], appliesWhen: "When requests break only through a specific proxy/SBC path" },
    ],
    relatedSipCodes: [400],
    relatedArticleIds: ["sip-alg-problems", "sip-488-not-acceptable"],
    references: [
      { title: "RFC 3261 Section 21.4.1 — 400 Bad Request", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-21.4.1", type: "rfc" },
      { title: "RFC 3261 Section 8.1.1 — UAC Behavior and Mandatory Header Fields", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-8.1.1", type: "rfc" },
      { title: "RFC 3261 Section 7 — SIP Messages (Syntax and Header Rules)", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-7", type: "rfc" },
      { title: "Basic SIP Call Flows & Troubleshooting Commands — Cisco Community", url: "https://community.cisco.com/t5/collaboration-knowledge-base/basic-sip-call-flows-amp-troubleshooting-commands/ta-p/3110162", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "composer", subviewId: "requests", label: "Craft and Validate SIP Request" },
      { toolId: "packet-capture", subviewId: "viewer", label: "Inspect Raw SIP Message" },
    ],
    keywords: ["400", "bad request", "malformed", "syntax", "Request-URI", "Content-Length", "header parsing", "ABNF", "invalid SIP message"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "sip-404-not-found",
    title: "404 Not Found — User or Extension Does Not Exist",
    domains: ["sip"],
    categories: ["call-setup"],
    severity: "critical",
    symptoms: [
      "INVITE returns 404 Not Found",
      "Call attempt fails immediately with 'number not found'",
    ],
    causes: [
      { summary: "Extension does not exist", likelihood: "high", detail: "The called number/extension is not configured on the server. Verify the number exists." },
      { summary: "Wrong domain in Request-URI", likelihood: "medium", detail: "The domain portion of the SIP URI does not match the server's domain. The server looks up the user in its own domain only." },
      { summary: "Dial plan mismatch", likelihood: "medium", detail: "The dialed number pattern doesn't match any route in the server's dial plan." },
      { summary: "User not registered", likelihood: "low", detail: "Some servers return 404 instead of 480 when the user exists but is not currently registered." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the Request-URI in the INVITE — verify the user part and domain" },
      { order: 2, instruction: "Verify the called extension exists on the server" },
      { order: 3, instruction: "Check the server's dial plan or routing rules for matching patterns" },
      { order: 4, instruction: "Test with a known-working extension to isolate the issue" },
    ],
    solutions: [
      { summary: "Correct the called number", steps: ["Verify the exact format expected by the server (e.g., with or without country code)", "Update the dialed number and retry"], appliesWhen: "When the extension or number is wrong" },
      { summary: "Fix the domain", steps: ["Check provider documentation for the correct SIP domain", "Update the Request-URI domain to match", "Some providers require specific formats like user@sip.provider.com"], appliesWhen: "When the domain is incorrect" },
    ],
    relatedSipCodes: [404, 484, 604],
    relatedArticleIds: ["dns-srv-naptr-failures"],
    references: [
      { title: "RFC 3261 Section 21.4.5 — 404 Not Found", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-21.4.5", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "composer", subviewId: "requests", label: "Craft INVITE" },
      { toolId: "soft-phone", label: "Test Call" },
    ],
    keywords: ["404", "not found", "extension", "user", "dial plan", "routing", "Request-URI"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "sip-408-timeout",
    title: "408 Request Timeout — No Response from Server",
    domains: ["sip", "network"],
    categories: ["call-setup", "registration"],
    severity: "critical",
    symptoms: [
      "INVITE or REGISTER returns 408 Request Timeout after ~32 seconds",
      "No response at all from the server (client generates 408 locally)",
      "Call attempt takes a long time before failing",
    ],
    causes: [
      { summary: "Server unreachable", likelihood: "high", detail: "The destination server IP is not reachable due to network issue, firewall block, or server being down." },
      { summary: "DNS resolves to wrong IP", likelihood: "medium", detail: "DNS resolution returns an incorrect or stale IP address that doesn't correspond to a running SIP server." },
      { summary: "Firewall blocking SIP", likelihood: "high", detail: "A firewall between client and server is blocking SIP traffic on port 5060 (UDP/TCP) or 5061 (TLS)." },
      { summary: "UDP packet loss", likelihood: "medium", detail: "Significant packet loss on the network path causes all retransmissions of the SIP request to be lost. Timer B (32s = 64 * T1) expires." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Ping the SIP server IP to verify basic connectivity", expected: "Should get responses. If not, there's a network/routing issue" },
      { order: 2, instruction: "Check DNS resolution for the SIP domain", expected: "Should resolve to the correct IP address" },
      { order: 3, instruction: "Port scan the server on 5060/5061", expected: "Ports should be open" },
      { order: 4, instruction: "Check local and remote firewall rules for SIP traffic" },
      { order: 5, instruction: "Try TCP transport if UDP is being lost or blocked" },
    ],
    solutions: [
      { summary: "Fix network connectivity", steps: ["Verify routing to the SIP server", "Check for ISP-level SIP blocking (some ISPs block port 5060)", "If ISP blocks 5060, try an alternate port or use TLS on 5061"], appliesWhen: "When the server is unreachable" },
      { summary: "Open firewall ports", steps: ["Allow outbound UDP/TCP 5060 for SIP signaling", "Allow outbound UDP/TCP 5061 for SIP over TLS", "Allow UDP 10000-20000 for RTP media", "Ensure stateful firewall allows return traffic"], appliesWhen: "When firewall is blocking" },
      { summary: "Fix DNS", steps: ["Verify DNS SRV/A records point to the correct server IP", "Try using the server IP directly to bypass DNS issues", "Consider using a more reliable DNS resolver"], appliesWhen: "When DNS returns wrong IP" },
    ],
    relatedSipCodes: [408, 504],
    relatedArticleIds: ["dns-srv-naptr-failures", "firewall-port-requirements"],
    references: [
      { title: "RFC 3261 Section 17.1.1.1 — Timer A and Timer B (INVITE transaction)", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-17.1.1.1", type: "rfc" },
      { title: "Basic SIP Call Flows & Troubleshooting — Cisco Community", url: "https://community.cisco.com/t5/collaboration-knowledge-base/basic-sip-call-flows-amp-troubleshooting-commands/ta-p/3110162", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "connectivity", label: "Ping & Port Scan" },
      { toolId: "network", subviewId: "voip", label: "SIP DNS Resolution" },
      { toolId: "packet-capture", subviewId: "viewer", label: "Capture to Verify Retransmissions" },
    ],
    keywords: ["408", "timeout", "unreachable", "Timer B", "32 seconds", "no response", "firewall", "DNS"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "sip-480-unavailable",
    title: "480 Temporarily Unavailable — Endpoint Offline",
    domains: ["sip"],
    categories: ["call-setup"],
    severity: "warning",
    symptoms: [
      "INVITE returns 480 Temporarily Unavailable",
      "Called party's phone shows as offline or unregistered",
    ],
    causes: [
      { summary: "Endpoint not registered", likelihood: "high", detail: "The called endpoint is powered off, lost network, or its registration expired." },
      { summary: "DND active", likelihood: "medium", detail: "The endpoint has Do Not Disturb enabled." },
      { summary: "All group members busy", likelihood: "low", detail: "If the destination is a ring group, all members may be unavailable." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check registration status of the called endpoint" },
      { order: 2, instruction: "Verify the endpoint is powered on and has network connectivity" },
      { order: 3, instruction: "Check if DND is enabled on the endpoint" },
    ],
    solutions: [
      { summary: "Re-register the endpoint", steps: ["Power cycle the phone or restart the SIP client", "Verify network connectivity", "Wait for registration to succeed, then retry the call"] },
    ],
    relatedSipCodes: [480, 486],
    relatedArticleIds: ["reg-expiry-keepalive"],
    references: [
      { title: "RFC 3261 Section 21.4.18 — 480 Temporarily Unavailable", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-21.4.18", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "registration", label: "Check Registration Status" },
    ],
    keywords: ["480", "temporarily unavailable", "offline", "unregistered", "DND", "not reachable"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "sip-486-busy",
    title: "486 Busy Here / 600 Busy Everywhere",
    domains: ["sip"],
    categories: ["call-setup"],
    severity: "info",
    symptoms: [
      "INVITE returns 486 Busy Here",
      "Caller hears busy tone",
    ],
    causes: [
      { summary: "Endpoint is on another call", likelihood: "high", detail: "The endpoint does not support call waiting or has reached its concurrent call limit." },
      { summary: "User rejected the call", likelihood: "medium", detail: "User pressed the reject button on the phone." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check if the called endpoint is already on a call" },
      { order: 2, instruction: "Verify call waiting is enabled if multiple calls should be supported" },
    ],
    solutions: [
      { summary: "Enable call waiting or forwarding", steps: ["Enable call waiting on the endpoint", "Or configure call-forward-on-busy to redirect to voicemail or another extension"] },
    ],
    relatedSipCodes: [486, 600],
    relatedArticleIds: [],
    references: [
      { title: "RFC 3261 Section 21.4.24 — 486 Busy Here", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-21.4.24", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "soft-phone", label: "Test Call" },
    ],
    keywords: ["486", "busy", "600", "call waiting", "reject", "concurrent"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "sip-488-not-acceptable",
    title: "488 Not Acceptable Here — SDP/Codec Mismatch",
    domains: ["sip"],
    categories: ["call-setup", "codec"],
    severity: "critical",
    symptoms: [
      "INVITE returns 488 Not Acceptable Here",
      "Call setup fails immediately after INVITE",
      "Works with some endpoints but not others (codec compatibility varies)",
    ],
    causes: [
      { summary: "No common codec", likelihood: "high", detail: "The SDP offer contains codecs that the answerer does not support. There must be at least one common codec for the call to succeed." },
      { summary: "SRTP mismatch", likelihood: "medium", detail: "One side requires SRTP (crypto suite in SDP) while the other does not support it, or the crypto suites don't match." },
      { summary: "Media type unsupported", likelihood: "medium", detail: "The SDP contains media types (e.g., video) that the answerer does not support." },
      { summary: "Payload type mismatch", likelihood: "low", detail: "Dynamic codec payload type numbers (96-127) are not properly negotiated between offer and answer." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the INVITE and inspect the SDP body", expected: "Look at the m=audio line for offered codecs" },
      { order: 2, instruction: "Compare offered codecs with what the destination supports" },
      { order: 3, instruction: "Check for crypto/SRTP lines in the SDP if encryption is involved" },
      { order: 4, instruction: "Verify payload type numbers match for dynamic codecs (a=rtpmap lines)" },
    ],
    solutions: [
      { summary: "Add common codec", steps: ["Include G.711 (PCMU/PCMA) in your SDP offer — it's the most universally supported codec", "Order codecs by preference with the most compatible first", "Ensure at least 2-3 codecs are offered for better compatibility"], appliesWhen: "When no codecs match" },
      { summary: "Align SRTP settings", steps: ["If one side requires SRTP, configure the other to also support SRTP", "Ensure crypto suites match (AES_CM_128_HMAC_SHA1_80 is most common)", "Or disable SRTP on both sides if encryption is not required"], appliesWhen: "When SRTP/encryption mismatch" },
    ],
    relatedSipCodes: [488, 415, 606],
    relatedArticleIds: ["codec-negotiation-failures"],
    references: [
      { title: "RFC 3264 — An Offer/Answer Model with SDP", url: "https://datatracker.ietf.org/doc/html/rfc3264", type: "rfc" },
      { title: "SDP Negotiation With Examples — Teraquant", url: "https://teraquant.com/session-description-protocol-negotiation-examples/", type: "community" },
      { title: "Which Codecs does 3CX support? — 3CX", url: "https://3cx.com/docs/sip-trunk-codecs-sdp", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Inspect SDP in Capture" },
      { toolId: "composer", subviewId: "requests", label: "Craft INVITE with Custom SDP" },
    ],
    keywords: ["488", "not acceptable", "codec", "SDP", "mismatch", "SRTP", "G.711", "PCMU", "PCMA", "negotiation"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "sip-503-unavailable",
    title: "503 Service Unavailable — Server Overloaded or Down",
    domains: ["sip"],
    categories: ["call-setup", "registration"],
    severity: "critical",
    symptoms: [
      "INVITE or REGISTER returns 503 Service Unavailable",
      "Calls fail intermittently during peak hours",
      "Server was recently restarted",
    ],
    causes: [
      { summary: "Server overloaded", likelihood: "high", detail: "Too many concurrent sessions or registrations. The server is throttling to protect itself." },
      { summary: "Maintenance window", likelihood: "medium", detail: "Server is being upgraded or restarted." },
      { summary: "Backend failure", likelihood: "medium", detail: "A dependency (database, PSTN gateway, routing engine) has failed." },
      { summary: "License limit", likelihood: "low", detail: "Server has reached its licensed concurrent session limit." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the Retry-After header in the 503 response", expected: "If present, indicates when to retry" },
      { order: 2, instruction: "Check if the server is reachable (it may respond to OPTIONS even when overloaded)" },
      { order: 3, instruction: "If DNS SRV has multiple entries, check if failover to alternate server works" },
    ],
    solutions: [
      { summary: "Retry after delay", steps: ["Wait for the duration specified in Retry-After header", "If no Retry-After, wait 30-60 seconds and retry", "Implement exponential backoff for automated retries"] },
      { summary: "Failover to alternate server", steps: ["If DNS SRV records list multiple servers with different priorities", "Try the next server in the priority list", "Configure your client to support SRV-based failover"] },
    ],
    relatedSipCodes: [503, 500],
    relatedArticleIds: ["sip-408-timeout"],
    references: [
      { title: "RFC 3261 Section 21.5.4 — 503 Service Unavailable", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-21.5.4", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "connectivity", label: "Check Server" },
      { toolId: "composer", subviewId: "requests", label: "Send OPTIONS" },
    ],
    keywords: ["503", "service unavailable", "overloaded", "retry", "failover", "maintenance"],
    lastUpdated: "2025-06-01",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDIA / AUDIO QUALITY
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "one-way-audio",
    title: "One-Way Audio — Can Hear But Not Be Heard (or Vice Versa)",
    domains: ["sip", "rtp", "network"],
    categories: ["one-way-audio", "media", "nat-firewall"],
    severity: "critical",
    symptoms: [
      "Audio in only one direction (caller hears callee but not vice versa, or opposite)",
      "Call connects successfully (200 OK) but media is unidirectional",
      "Problem occurs only for calls crossing NAT boundaries",
    ],
    causes: [
      { summary: "SIP ALG rewriting SDP", likelihood: "high", detail: "SIP ALG on the router rewrites the SDP c= (connection) line or media port, causing RTP to be sent to the wrong address. SIP ALG accounts for over 25% of one-way audio incidents (viirtue.com 2026)." },
      { summary: "NAT — private IP in SDP", likelihood: "high", detail: "The SDP c= line contains a private IP address (10.x, 192.168.x, 172.16-31.x). The remote endpoint tries to send RTP to this unreachable address." },
      { summary: "Firewall blocking inbound RTP", likelihood: "high", detail: "The firewall allows outbound RTP but blocks inbound RTP packets (no symmetric NAT or stateful tracking for UDP)." },
      { summary: "Codec mismatch (unidirectional)", likelihood: "low", detail: "One direction uses a codec the other endpoint doesn't properly decode." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the SIP INVITE and 200 OK, examine SDP c= line and m= line on both sides", expected: "Both should have publicly reachable IPs. If you see 10.x, 192.168.x, or 172.x, that's a NAT problem" },
      { order: 2, instruction: "Check if SIP ALG is enabled on the router" },
      { order: 3, instruction: "Verify RTP packets flow in both directions using SIPalyzer Packet Capture", expected: "You should see RTP packets from both source and destination. If missing in one direction, that direction's audio is blocked" },
      { order: 4, instruction: "Check firewall rules for UDP traffic on the RTP port range (typically 10000-20000)" },
      { order: 5, instruction: "Test by connecting the phone directly to the modem (bypassing the router) to isolate router issues" },
    ],
    solutions: [
      { summary: "Disable SIP ALG", steps: ["Access router admin panel", "Disable SIP ALG / SIP Helper / SIP Transformations", "Reboot the router", "Re-test the call"], appliesWhen: "SIP ALG is active (check this first — most common cause)" },
      { summary: "Fix NAT traversal", steps: ["Configure your provider's outbound proxy — most handle NAT and media relay automatically", "If your provider doesn't offer a proxy, set your public IP as the external/advertised address", "Ensure rport is used in Via header (RFC 3581)", "Reduce registration interval to keep NAT pinholes open"], appliesWhen: "When private IP appears in SDP" },
      { summary: "Open firewall for RTP", steps: ["Allow bidirectional UDP traffic on ports 10000-20000", "Or configure the firewall for symmetric NAT / connection tracking for UDP", "Place VoIP device in DMZ as a last resort"], appliesWhen: "When firewall blocks inbound RTP" },
      { summary: "Eliminate double NAT", steps: ["Put ISP modem in bridge mode", "Disable NAT on the secondary router", "Ensure only one NAT device in the path"], appliesWhen: "When double NAT is present" },
    ],
    relatedSipCodes: [183],
    relatedArticleIds: ["no-audio", "sip-alg-problems", "nat-registration-issues", "firewall-port-requirements"],
    references: [
      { title: "Troubleshooting One-Way Audio — OnSIP", url: "https://support.onsip.com/hc/en-us/articles/204132734-Troubleshooting-One-Way-Audio", type: "community" },
      { title: "Correcting One-way Audio — PBX Mechanic", url: "https://www.pbxmechanic.com/troubleshoot-oneway-audio.html", type: "community" },
      { title: "One-way Audio — VoIP-Info", url: "https://www.voip-info.org/one-way-audio/", type: "community" },
      { title: "How to Solve SIP ALG Problems in 2026 — Viirtue", url: "https://viirtue.com/how-to-solve-sip-alg-problems-in-2026-a-practical-voip-guide-for-smbs-and-msps/", type: "community" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Capture & Inspect SDP" },
      { toolId: "soft-phone", subviewId: "diagnostics", label: "Test Call Quality" },
      { toolId: "network", subviewId: "voip", label: "Network Test" },
    ],
    keywords: ["one-way audio", "one way", "unidirectional", "NAT", "SIP ALG", "SDP", "private IP", "firewall", "RTP blocked"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "no-audio",
    title: "No Audio — Complete Silence on Both Sides",
    domains: ["sip", "rtp", "network"],
    categories: ["media", "nat-firewall"],
    severity: "critical",
    symptoms: [
      "Call connects but no audio in either direction",
      "Both parties hear complete silence",
      "SDP shows 0.0.0.0 in c= line or port 0 in m= line",
    ],
    causes: [
      { summary: "RTP ports blocked by firewall", likelihood: "high", detail: "Both directions of RTP are blocked. The signaling (SIP) works but the media path (RTP) is completely blocked." },
      { summary: "0.0.0.0 in SDP c= line", likelihood: "medium", detail: "The SDP contains c=IN IP4 0.0.0.0 which is a legacy hold indicator (RFC 3264 Section 8.4). Modern implementations use a=sendonly/a=inactive instead (RFC 8866). If 0.0.0.0 appears unintentionally, it means the UA failed to determine its IP." },
      { summary: "Port 0 in SDP m= line", likelihood: "medium", detail: "m=audio 0 RTP/AVP means the media stream is disabled/rejected. This can happen when codec negotiation fails silently." },
      { summary: "Media server/relay failure", likelihood: "low", detail: "If calls are relayed through a media server (SBC, B2BUA), that server may have failed." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the SIP exchange and check the SDP in INVITE and 200 OK", expected: "c= line should have a valid public IP, m= line should have a non-zero port" },
      { order: 2, instruction: "Check if RTP packets are being sent at all using Packet Monitor", expected: "Should see bidirectional RTP traffic on the negotiated ports" },
      { order: 3, instruction: "Verify firewall allows UDP on the RTP port range in both directions" },
    ],
    solutions: [
      { summary: "Open RTP ports", steps: ["Allow UDP 10000-20000 (or your configured RTP range) in both directions", "Ensure stateful connection tracking is enabled for UDP"], appliesWhen: "When firewall blocks all RTP" },
      { summary: "Fix SDP addressing", steps: ["If 0.0.0.0 in SDP, configure the UA with the correct external IP manually or use your provider's outbound proxy", "Disable SIP ALG which may cause this", "Verify the UA is not incorrectly detecting a hold condition"], appliesWhen: "When SDP has invalid address" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["one-way-audio", "firewall-port-requirements"],
    references: [
      { title: "RFC 3264 Section 8.4 — Putting a Session on Hold", url: "https://datatracker.ietf.org/doc/html/rfc3264#section-8.4", type: "rfc" },
      { title: "Troubleshooting sound problems — MikoPBX", url: "https://docs.mikopbx.com/mikopbx/english/faq/troubleshooting/solving-sound-problems", type: "community" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Inspect SDP & RTP" },
      { toolId: "network", subviewId: "connectivity", label: "Port Scan RTP Range" },
    ],
    keywords: ["no audio", "silence", "0.0.0.0", "port 0", "RTP blocked", "media", "firewall"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "poor-mos-score",
    title: "Poor MOS Score — Degraded Voice Quality Analysis",
    domains: ["rtp", "network"],
    categories: ["audio-quality"],
    severity: "warning",
    symptoms: [
      "MOS score below 3.6 (fair) or below 3.1 (poor)",
      "Voice sounds choppy, robotic, or garbled",
      "Users report call quality issues",
    ],
    causes: [
      { summary: "High packet loss", likelihood: "high", detail: "Packet loss above 1% degrades voice quality. Above 3% is noticeable with all codecs. Above 5% makes conversation difficult. Per ITU-T G.107 E-Model, packet loss directly reduces the R-factor." },
      { summary: "Excessive jitter", likelihood: "high", detail: "Jitter above 30ms degrades quality. The jitter buffer absorbs some variation, but excessive jitter causes packets to arrive too late to be played, resulting in effective packet loss." },
      { summary: "High latency", likelihood: "medium", detail: "One-way delay above 150ms (ITU-T G.114 recommendation) causes noticeable delay. Above 250ms, conversation becomes difficult with overlap and echo." },
      { summary: "Codec choice", likelihood: "medium", detail: "Lower-bitrate codecs (G.729 at 8kbps) have lower inherent MOS than G.711 (64kbps). Under impairment, lower-bitrate codecs degrade faster." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the RTP stream statistics in SIPalyzer Diagnostics", expected: "Note MOS, jitter, and packet loss values" },
      { order: 2, instruction: "If MOS < 3.6: check if jitter > 30ms, loss > 1%, or latency > 150ms" },
      { order: 3, instruction: "Run a network quality test to the SIP server", expected: "Jitter should be < 30ms, loss < 1%, latency < 150ms one-way" },
      { order: 4, instruction: "Check for network congestion during the time of poor quality" },
    ],
    solutions: [
      { summary: "Enable QoS", steps: ["Configure DSCP marking: EF (46) for RTP media, CS3 (24) or AF31 (26) for SIP signaling", "Enable QoS on all routers/switches in the path", "Configure priority queuing for marked traffic"], appliesWhen: "When competing traffic causes congestion" },
      { summary: "Reduce jitter", steps: ["Enable QoS to prioritize voice traffic", "Use wired ethernet instead of WiFi", "Increase jitter buffer size on the endpoint", "Check for network congestion and resolve"], appliesWhen: "When jitter is the primary cause" },
      { summary: "Switch codec", steps: ["Use G.711 (PCMU/PCMA) for best quality when bandwidth permits (87.2 kbps per call)", "Use G.729 for lower bandwidth (31.2 kbps per call) when network is constrained"], appliesWhen: "When codec is contributing to poor quality" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["high-jitter", "packet-loss-impact", "qos-dscp-marking"],
    references: [
      { title: "ITU-T G.107 — The E-Model: a computational model for use in transmission planning", url: "https://www.itu.int/rec/T-REC-G.107", type: "standard" },
      { title: "ITU-T G.114 — One-way transmission time", url: "https://www.itu.int/rec/T-REC-G.114", type: "standard" },
      { title: "RTP, Jitter and audio quality in VoIP — Smartvox", url: "https://kb.smartvox.co.uk/voip-sip/rtp-jitter-audio-quality-voip/", type: "community" },
      { title: "Voice Quality — Oracle Session Monitor", url: "https://docs.oracle.com/en/industries/communications/session-monitor/5.2/omuser/voice-quality.html", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "soft-phone", subviewId: "diagnostics", label: "Call Quality Diagnostics" },
      { toolId: "network", subviewId: "voip", label: "VoIP Quality Test" },
      { toolId: "packet-capture", subviewId: "viewer", label: "RTP Stream Analysis" },
    ],
    keywords: ["MOS", "quality", "E-Model", "G.107", "voice quality", "choppy", "garbled", "robotic", "R-factor"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "high-jitter",
    title: "High Jitter — Packet Arrival Time Variation",
    domains: ["rtp", "network"],
    categories: ["audio-quality", "qos"],
    severity: "warning",
    symptoms: [
      "Jitter exceeds 30ms (warning) or 50ms (critical)",
      "Audio sounds choppy with intermittent gaps",
      "Words are cut off or missing",
    ],
    causes: [
      { summary: "Network congestion", likelihood: "high", detail: "Competing traffic (downloads, backups, video streaming) causes variable delays as packets queue in routers." },
      { summary: "WiFi interference", likelihood: "high", detail: "Wireless connections introduce variable latency due to interference, channel contention, and retransmissions. WiFi is inherently more jittery than ethernet." },
      { summary: "No QoS configured", likelihood: "medium", detail: "Without QoS, voice packets compete with all other traffic for bandwidth and buffer space." },
      { summary: "Outdated/overloaded network equipment", likelihood: "medium", detail: "Old routers or switches with insufficient buffer capacity drop or delay packets under load." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Run a VoIP quality test to measure jitter to the SIP server", expected: "Jitter should be < 30ms for good quality (Cisco recommendation)" },
      { order: 2, instruction: "Test with a wired connection if currently on WiFi", expected: "Jitter should improve significantly on wired" },
      { order: 3, instruction: "Check network utilization during jitter events", expected: "Look for bandwidth-heavy applications running simultaneously" },
      { order: 4, instruction: "Check the jitter buffer size on the endpoint" },
    ],
    solutions: [
      { summary: "Use wired ethernet", steps: ["Connect VoIP devices via ethernet cable instead of WiFi", "If WiFi is required, use 5GHz band and ensure strong signal"], appliesWhen: "When WiFi is causing jitter" },
      { summary: "Configure QoS", steps: ["Mark voice RTP packets with DSCP EF (46)", "Configure priority queuing on routers", "Set bandwidth reservation for voice traffic"], appliesWhen: "When network congestion is the cause" },
      { summary: "Increase jitter buffer", steps: ["Increase the jitter buffer size on the endpoint (e.g., 50-100ms)", "Note: larger jitter buffer increases latency as a tradeoff", "Adaptive jitter buffers automatically adjust — ensure this feature is enabled"], appliesWhen: "When moderate jitter cannot be eliminated" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["poor-mos-score", "qos-dscp-marking", "packet-loss-impact"],
    references: [
      { title: "Jitter VoIP: Complete Guide — VideoSDK (2025)", url: "https://www.videosdk.live/developer-hub/voip/jitter-voip", type: "community" },
      { title: "RTP, Jitter and audio quality — Smartvox", url: "https://kb.smartvox.co.uk/voip-sip/rtp-jitter-audio-quality-voip/", type: "community" },
      { title: "RFC 3550 Section 6.4.1 — Jitter Calculation", url: "https://datatracker.ietf.org/doc/html/rfc3550#section-6.4.1", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "voip", label: "Jitter Test" },
      { toolId: "soft-phone", subviewId: "diagnostics", label: "Live Jitter Monitor" },
    ],
    keywords: ["jitter", "choppy", "gaps", "WiFi", "QoS", "jitter buffer", "variable delay", "congestion"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "packet-loss-impact",
    title: "Packet Loss Impact on Voice Quality",
    domains: ["rtp", "network"],
    categories: ["audio-quality", "qos"],
    severity: "warning",
    symptoms: [
      "Packet loss exceeds 1% (warning) or 3% (critical)",
      "Audio has gaps, missing words, or robotic quality",
      "MOS score degrades proportionally to loss",
    ],
    causes: [
      { summary: "Network congestion / buffer overflow", likelihood: "high", detail: "Router transmit buffers fill up during traffic bursts, causing packets to be dropped. This is the primary QoS challenge on LANs per Cisco." },
      { summary: "WiFi packet loss", likelihood: "high", detail: "WiFi retransmissions and interference cause real packet loss and late arrivals treated as loss." },
      { summary: "ISP network issues", likelihood: "medium", detail: "Packet loss occurring on the ISP's network between your premises and the SIP server." },
      { summary: "Faulty network equipment", likelihood: "low", detail: "Bad cables, failing switch ports, or overloaded interfaces." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Run a packet loss test to the SIP server", expected: "Loss should be < 1% for acceptable voice quality" },
      { order: 2, instruction: "Check both RTCP Sender Reports and Receiver Reports for loss statistics" },
      { order: 3, instruction: "Monitor loss over time to determine if it's constant or bursty" },
      { order: 4, instruction: "Run traceroute to identify which hop is introducing loss" },
    ],
    solutions: [
      { summary: "Enable QoS with priority queuing", steps: ["Configure DSCP EF marking for voice RTP", "Set up Low Latency Queuing (LLQ) on the router", "Reserve bandwidth for voice traffic (87.2 kbps per G.711 call)"], appliesWhen: "When congestion causes buffer overflow" },
      { summary: "Fix network infrastructure", steps: ["Replace faulty cables or switch ports", "Upgrade router/switch if overloaded", "Switch from WiFi to wired for VoIP devices"], appliesWhen: "When hardware is the issue" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["poor-mos-score", "high-jitter", "qos-dscp-marking"],
    references: [
      { title: "Decipher RTP Stream for Packet Loss — Cisco", url: "https://www.cisco.com/c/en/us/support/docs/quality-of-service-qos/real-time-protocol-rtp/117881-probsol-qos-00.html", type: "vendor" },
      { title: "Check for network impairments — PJSIP Documentation", url: "https://docs.pjsip.org/en/latest/specific-guides/audio-troubleshooting/checks/rx_quality.html", type: "community" },
      { title: "Voice QoS: ToS-CoS Packet Marking — Cisco", url: "https://www.cisco.com/c/en/us/support/docs/voice/voice-quality/23442-tos-cos.html", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "voip", label: "Packet Loss Test" },
      { toolId: "network", subviewId: "connectivity", label: "Traceroute" },
    ],
    keywords: ["packet loss", "loss", "dropped packets", "buffer overflow", "QoS", "congestion", "gaps"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "codec-negotiation-failures",
    title: "Codec Negotiation Failures — SDP Offer/Answer Mismatch",
    domains: ["sip", "rtp"],
    categories: ["codec", "call-setup"],
    severity: "critical",
    symptoms: [
      "488 Not Acceptable Here response to INVITE",
      "Call connects but audio is noisy or distorted (wrong codec decoded)",
      "Different codecs shown on each side of the call",
    ],
    causes: [
      { summary: "No common codec in SDP", likelihood: "high", detail: "The offerer's codec list has no overlap with the answerer's supported codecs. Both endpoints must support at least one common codec." },
      { summary: "Dynamic payload type mismatch", likelihood: "medium", detail: "Dynamic codecs use payload types 96-127 that must be negotiated via a=rtpmap. If the answerer uses a different PT number than expected, audio fails." },
      { summary: "Codec parameters mismatch", likelihood: "medium", detail: "Codec parameters in a=fmtp don't match (e.g., G.729 with or without Annex B, or mismatched bandwidth modes)." },
      { summary: "Codec preference order", likelihood: "low", detail: "Codecs are listed in order of preference in the m= line by the offerer. RFC 3264 recommends the answerer consider this ordering, but the answerer ultimately picks based on its own preference and capabilities." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the INVITE and 200 OK (or 488), compare SDP m=audio lines" },
      { order: 2, instruction: "List the codecs offered (payload types in m= line) and map them using a=rtpmap" },
      { order: 3, instruction: "Check if there's at least one common codec between offer and answer" },
      { order: 4, instruction: "Verify a=fmtp parameters match for the negotiated codec" },
    ],
    solutions: [
      { summary: "Include G.711 as fallback", steps: ["Always include G.711 (PCMU payload type 0 and/or PCMA payload type 8) in your SDP offer", "G.711 is the most universally supported codec", "Place it after your preferred codec in the m= line"], appliesWhen: "For maximum compatibility" },
      { summary: "Fix dynamic payload types", steps: ["For dynamic codecs, extract the payload type from the remote SDP", "Don't hardcode dynamic PT numbers — always use the value from the negotiation", "Verify a=rtpmap lines map correctly"], appliesWhen: "When dynamic codecs fail" },
    ],
    relatedSipCodes: [488, 415, 606],
    relatedArticleIds: ["sip-488-not-acceptable"],
    references: [
      { title: "RFC 3264 — An Offer/Answer Model with SDP", url: "https://datatracker.ietf.org/doc/html/rfc3264", type: "rfc" },
      { title: "Checking codec negotiation — PJSIP", url: "https://docs.pjsip.org/en/latest/specific-guides/audio-troubleshooting/checks/codec_nego.html", type: "community" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Compare SDP Offer/Answer" },
    ],
    keywords: ["codec", "negotiation", "SDP", "offer", "answer", "payload type", "rtpmap", "G.711", "G.729", "mismatch"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "dtmf-issues",
    title: "DTMF Not Working — Tone Detection Failures",
    domains: ["sip", "rtp"],
    categories: ["dtmf", "media"],
    severity: "warning",
    symptoms: [
      "DTMF digits not detected by IVR or voicemail systems",
      "Touch tones heard by the other party but not processed",
      "Some digits work but others are missed",
    ],
    causes: [
      { summary: "DTMF method mismatch", likelihood: "high", detail: "One side uses RFC 4733 (telephone-event in RTP) while the other expects SIP INFO or in-band audio DTMF. Both sides must agree on the method." },
      { summary: "Missing telephone-event in SDP", likelihood: "high", detail: "The SDP does not include 'telephone-event' in the m= line or lacks the a=fmtp line specifying supported events (0-16)." },
      { summary: "In-band DTMF with low-bitrate codec", likelihood: "medium", detail: "In-band DTMF (audio tones) does not work with compressed codecs like G.729 because the codec distorts the tone frequencies." },
      { summary: "DTMF payload type conflict", likelihood: "low", detail: "The dynamic payload type for telephone-event (typically 101) conflicts with another codec assignment." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the SDP for telephone-event: look for 'telephone-event' in the m= line and a=rtpmap:101 telephone-event/8000" },
      { order: 2, instruction: "Determine which DTMF method each side uses (RFC 4733, SIP INFO, or in-band)" },
      { order: 3, instruction: "If using RFC 4733, verify both sides agree on the payload type for telephone-event" },
      { order: 4, instruction: "If using SIP INFO, check that the server accepts INFO messages with application/dtmf-relay content" },
    ],
    solutions: [
      { summary: "Use RFC 4733 (recommended)", steps: ["Configure both endpoints to use RFC 4733/2833 DTMF", "Ensure telephone-event is in the SDP m= line", "Standard payload type is 101 but can be any dynamic value (96-127)", "Include a=fmtp:101 0-16 to indicate supported events"], appliesWhen: "For most SIP deployments (industry standard)" },
      { summary: "Match DTMF methods", steps: ["If one side only supports SIP INFO, configure the other to also use SIP INFO", "If using in-band, ensure a wideband codec is used (G.711, not G.729)"], appliesWhen: "When endpoint DTMF methods don't match" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["codec-negotiation-failures"],
    references: [
      { title: "RFC 4733 — RTP Payload for DTMF Digits", url: "https://datatracker.ietf.org/doc/html/rfc4733", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Check SDP for telephone-event" },
      { toolId: "soft-phone", label: "Test DTMF" },
    ],
    keywords: ["DTMF", "telephone-event", "RFC 4733", "RFC 2833", "SIP INFO", "in-band", "tones", "IVR", "touch tone"],
    lastUpdated: "2025-06-01",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CALL DROPS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "call-drops-30-seconds",
    title: "Call Drops at 30 Seconds — ACK Not Received",
    domains: ["sip", "network"],
    categories: ["call-drops", "nat-firewall"],
    severity: "critical",
    symptoms: [
      "Calls disconnect exactly ~30-32 seconds after being answered",
      "Audio may work briefly before disconnect",
      "One-way audio followed by disconnect at 30s",
    ],
    causes: [
      { summary: "ACK not reaching the server", likelihood: "high", detail: "After sending 200 OK, the server waits for ACK. If NAT/firewall blocks the ACK, the server retransmits 200 OK until Timer H expires (~32 seconds), then terminates the dialog. Per RFC 3261, the UAS will retransmit the 200 OK up to 64 times (Timer H = 64*T1)." },
      { summary: "SIP ALG corrupting routing", likelihood: "high", detail: "SIP ALG rewrites Contact or Record-Route headers, causing the ACK to be sent to the wrong address." },
      { summary: "NAT/firewall blocking return path", likelihood: "high", detail: "The ACK is sent but the NAT mapping has changed or the firewall blocks it." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the SIP exchange around the 30-second mark", expected: "You should see: INVITE → 200 OK → (no ACK) → 200 OK retransmits → BYE at ~32s" },
      { order: 2, instruction: "Check if ACK is being sent by the client" },
      { order: 3, instruction: "If ACK is sent but not received, check NAT/firewall between the endpoints" },
      { order: 4, instruction: "Check the Contact header in the 200 OK — is it reachable from the client?" },
    ],
    solutions: [
      { summary: "Disable SIP ALG", steps: ["Disable SIP ALG on the router", "This is the most common fix for 30-second call drops"], appliesWhen: "When SIP ALG is rewriting headers" },
      { summary: "Fix NAT for ACK routing", steps: ["Ensure the Contact header in 200 OK has a reachable address", "Open firewall for SIP traffic on all required ports", "Configure outbound proxy to handle NAT traversal"], appliesWhen: "When ACK is blocked by NAT/firewall" },
    ],
    relatedSipCodes: [408, 481],
    relatedArticleIds: ["sip-alg-problems", "nat-registration-issues", "session-timer-expiry"],
    references: [
      { title: "VoIP calls drop after 30 seconds — VOIspeed", url: "https://www.voispeed.com/manuali/voip-calls-drop-after-30-seconds/?lang=en", type: "community" },
      { title: "How to Analyze the 30 Seconds Hangup Problem — Yeastar", url: "https://www.yeastarshopkenya.co.ke/how-to-analyze-the-30-seconds-hangup-problem/", type: "community" },
      { title: "RFC 3261 Section 13.3.1.4 — Timer H", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-13.3.1.4", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Capture Around 30s Mark" },
    ],
    keywords: ["30 seconds", "32 seconds", "ACK", "Timer H", "call drop", "disconnect", "NAT", "SIP ALG"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "session-timer-expiry",
    title: "Session Timer Expiry — Call Drops at Configured Interval",
    domains: ["sip"],
    categories: ["call-drops", "session-timers"],
    severity: "critical",
    symptoms: [
      "Calls disconnect at a regular interval (e.g., every 30 minutes, 1 hour)",
      "Calls drop at exactly the Session-Expires time",
      "BYE sent by the refresher endpoint at timer expiry",
    ],
    causes: [
      { summary: "Session refresh not sent", likelihood: "high", detail: "RFC 4028 requires periodic re-INVITE or UPDATE to refresh the session. If the refresher fails to send it before Session-Expires, the other side terminates the call." },
      { summary: "re-INVITE blocked by NAT/firewall", likelihood: "medium", detail: "The refresh re-INVITE is blocked in transit, so the peer never receives it and terminates the session." },
      { summary: "422 Session Interval Too Small", likelihood: "medium", detail: "The server rejects the Session-Expires value as too small. The call proceeds without proper session timers, leading to unexpected disconnects." },
      { summary: "Mismatched refresher role", likelihood: "low", detail: "Both sides think the other is the refresher, so neither sends the refresh." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the INVITE and 200 OK for Session-Expires and Min-SE headers", expected: "Note the Session-Expires value and the refresher parameter (uac or uas)" },
      { order: 2, instruction: "Time how long the call lasts before dropping — it should match Session-Expires" },
      { order: 3, instruction: "Look for re-INVITE or UPDATE at approximately half the Session-Expires interval" },
      { order: 4, instruction: "If re-INVITE is sent but fails, check for 422 or 491 responses" },
    ],
    solutions: [
      { summary: "Fix session timer configuration", steps: ["Ensure the designated refresher (uac or uas) is sending re-INVITE or UPDATE before expiry", "Set Session-Expires to a reasonable value (1800 seconds / 30 min is common)", "Ensure Min-SE is set appropriately on both sides"], appliesWhen: "When session timer is misconfigured" },
      { summary: "Disable session timers", steps: ["If session timers cause problems and are not required, disable them", "Remove 'timer' from the Supported header", "Note: this removes session liveness checking"], appliesWhen: "When session timers are not needed" },
    ],
    relatedSipCodes: [422, 491],
    relatedArticleIds: ["call-drops-30-seconds", "reinvite-failures"],
    references: [
      { title: "RFC 4028 — Session Timers in SIP", url: "https://datatracker.ietf.org/doc/html/rfc4028", type: "rfc" },
      { title: "SIP Session Timers — Cisco CUBE", url: "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/voice/cube_sip/configuration/15-mt/cube-sip-15-mt-book/voi-sip-sess-tmr.pdf", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Check Session-Expires in SIP" },
    ],
    keywords: ["session timer", "Session-Expires", "Min-SE", "re-INVITE", "UPDATE", "RFC 4028", "periodic disconnect", "422"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "sip-481-does-not-exist",
    title: "481 Call/Transaction Does Not Exist — Dialog State Lost",
    domains: ["sip"],
    categories: ["call-drops"],
    severity: "critical",
    symptoms: [
      "Mid-call request (BYE, re-INVITE, UPDATE) returns 481",
      "Call drops unexpectedly after server restart",
      "481 in response to BYE (call already terminated on server side)",
    ],
    causes: [
      { summary: "Server restarted / lost state", likelihood: "high", detail: "The SIP server was restarted and lost its dialog state (Call-ID, tags). Subsequent in-dialog requests fail because the server no longer knows about the call." },
      { summary: "NAT rewriting dialog identifiers", likelihood: "medium", detail: "SIP ALG or NAT rewrites Call-ID, From-tag, or To-tag, causing the server to not recognize the dialog." },
      { summary: "Race condition", likelihood: "low", detail: "Both sides terminated the dialog simultaneously, and a request arrived after the dialog was already destroyed." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check if the SIP server was recently restarted" },
      { order: 2, instruction: "Compare Call-ID and tags in the request vs. what the server expects" },
      { order: 3, instruction: "Check for SIP ALG modifying dialog identifiers" },
    ],
    solutions: [
      { summary: "Handle gracefully", steps: ["If 481 to BYE, the call is already terminated — no action needed", "If 481 to re-INVITE, the dialog is lost — re-establish the call", "Configure the server for dialog state persistence across restarts if supported"] },
    ],
    relatedSipCodes: [481],
    relatedArticleIds: ["call-drops-30-seconds", "sip-alg-problems"],
    references: [
      { title: "RFC 3261 Section 21.4.19 — 481 Call/Transaction Does Not Exist", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-21.4.19", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Compare Dialog IDs" },
    ],
    keywords: ["481", "does not exist", "dialog", "Call-ID", "tag", "server restart", "state lost"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "reinvite-failures",
    title: "re-INVITE Failures — Mid-Call Modifications Rejected",
    domains: ["sip"],
    categories: ["call-drops", "media"],
    severity: "warning",
    symptoms: [
      "Call hold/unhold fails",
      "Codec change mid-call fails",
      "re-INVITE returns 491 Request Pending (glare)",
      "Audio stops after failed re-INVITE",
    ],
    causes: [
      { summary: "Glare (491)", likelihood: "high", detail: "Both endpoints sent a re-INVITE simultaneously. Per RFC 3261 Section 14.1, the UA that did NOT generate the Call-ID retries after 0-2 seconds, and the Call-ID owner retries after 2.1-4 seconds." },
      { summary: "SDP renegotiation failure", likelihood: "medium", detail: "The new SDP offer in the re-INVITE is rejected by the peer (488 or 606)." },
      { summary: "NAT/firewall blocks re-INVITE", likelihood: "medium", detail: "The re-INVITE is blocked by NAT or firewall, causing the modification to fail." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the re-INVITE and response" },
      { order: 2, instruction: "If 491: check if both sides sent re-INVITE at the same time (glare)" },
      { order: 3, instruction: "If 488/606: compare old and new SDP for compatibility" },
    ],
    solutions: [
      { summary: "Handle glare", steps: ["Ensure your SIP client properly handles 491 by retrying after the appropriate delay", "Consider using UPDATE instead of re-INVITE for session timer refresh to reduce glare"], appliesWhen: "When 491 glare occurs" },
    ],
    relatedSipCodes: [491, 488],
    relatedArticleIds: ["session-timer-expiry"],
    references: [
      { title: "RFC 3261 Section 14.1 — Modifying an Existing Session (re-INVITE)", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-14.1", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Capture re-INVITE" },
    ],
    keywords: ["re-INVITE", "491", "glare", "hold", "unhold", "codec change", "mid-call", "session modification"],
    lastUpdated: "2025-06-01",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // T.38 FAX
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "t38-vs-passthrough",
    title: "T.38 vs G.711 Passthrough — Choosing the Right Fax Method",
    domains: ["t38", "sip"],
    categories: ["fax"],
    severity: "info",
    symptoms: [
      "Fax fails with one method but works with another",
      "Unclear which fax method to use",
      "High fax failure rate on SIP trunks",
    ],
    causes: [
      { summary: "Wrong method for the network conditions", likelihood: "high", detail: "T.38 is more robust than G.711 passthrough because it has built-in redundancy. However, both endpoints and all intermediaries must support T.38. G.711 passthrough requires very low jitter (< 30ms) and zero packet loss." },
      { summary: "Mixed methods in call path", likelihood: "medium", detail: "One leg uses T.38 while another uses G.711 passthrough. Fax protocols cannot be transcoded between T.38 and audio like voice calls can." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Determine the fax transport on each leg of the call (T.38 UDPTL or G.711 passthrough)" },
      { order: 2, instruction: "Verify all devices in the call path support the same fax method" },
      { order: 3, instruction: "Check network conditions: for G.711 passthrough, jitter must be < 30ms and packet loss near zero" },
    ],
    solutions: [
      { summary: "Use T.38 when possible", steps: ["Configure all endpoints for T.38 UDPTL", "T.38 is more tolerant of network impairments than G.711 passthrough", "Ensure the re-INVITE switchover to T.38 is supported by all intermediaries"], appliesWhen: "When all endpoints support T.38" },
      { summary: "Use G.711 passthrough", steps: ["Use G.711 μ-law or A-law (uncompressed) — never use compressed codecs for fax", "Disable echo cancellation for fax calls", "Ensure jitter < 30ms and packet loss is near zero", "Disable VAD (Voice Activity Detection) and silence suppression"], appliesWhen: "When T.38 is not supported" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["t38-page-loss", "t38-reinvite-switchover", "t38-network-requirements"],
    references: [
      { title: "T.38 Fax over IP Design Best Practices — Cisco Community", url: "https://community.cisco.com/t5/collaboration-knowledge-base/t-38-fax-over-ip-design-best-practices-questions-and-answers/ta-p/3116604", type: "vendor" },
      { title: "Fax T.38 Troubleshooting Guide — Sansay TAC", url: "https://support.sansay.com/t/18c8yz/fax-t-38-troubleshooting-guide", type: "vendor" },
      { title: "Commonly Supported Fax/Modem Call Flows — Cisco", url: "https://www.cisco.com/c/en/us/support/docs/voice/t38/215863-commonly-supported-fax-modem-call-flows.html", type: "vendor" },
      { title: "Fax-SIP Troubleshoot Guide — Cisco", url: "https://www.cisco.com/c/en/us/support/docs/voice/session-initiation-protocol-sip/118647-technote-sip-00.html", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "fax-center", subviewId: "send", label: "Send Test Fax" },
      { toolId: "packet-capture", subviewId: "viewer", label: "Inspect T.38/RTP in Capture" },
    ],
    keywords: ["T.38", "fax", "passthrough", "G.711", "UDPTL", "fax method", "ECM"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "t38-page-loss",
    title: "T.38 Fax Page Loss and Partial Images",
    domains: ["t38"],
    categories: ["fax"],
    severity: "warning",
    symptoms: [
      "Received fax has missing pages",
      "Pages are partially rendered (half an image)",
      "Fax transmission reports partial success",
    ],
    causes: [
      { summary: "Packet loss during T.38 transmission", likelihood: "high", detail: "T.38 UDPTL uses redundancy to mitigate packet loss, but excessive loss can still cause data corruption. Even with redundancy, burst loss defeats the error correction." },
      { summary: "ECM disabled", likelihood: "medium", detail: "Error Correction Mode provides page-level retransmission. Without ECM, corrupted pages are delivered as-is instead of being retried." },
      { summary: "Jitter exceeding T.38 tolerance", likelihood: "medium", detail: "T.38 can tolerate up to 300ms of jitter, but beyond that, packets arrive too late and data is lost." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the fax session details for page count sent vs received" },
      { order: 2, instruction: "Examine RTCP or T.38 session logs for packet loss during transmission" },
      { order: 3, instruction: "Verify ECM is enabled on both the sending and receiving fax endpoints" },
      { order: 4, instruction: "Run a network quality test — jitter should be < 300ms for T.38, < 30ms for passthrough" },
    ],
    solutions: [
      { summary: "Enable ECM", steps: ["Enable Error Correction Mode on both fax endpoints", "ECM provides page-level retransmission for corrupted pages", "This is the most effective fix for partial pages"] },
      { summary: "Increase T.38 redundancy", steps: ["Configure T.38 redundancy level (typically 1-3 redundant copies)", "Higher redundancy uses more bandwidth but better handles packet loss", "Most gateways default to 0-1 redundancy"], appliesWhen: "When packet loss is moderate" },
      { summary: "Reduce baud rate", steps: ["Lower the fax speed from 14400 to 9600 or 7200 bps", "Lower speeds are more robust against network impairments"], appliesWhen: "When network conditions are poor" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["t38-vs-passthrough", "t38-network-requirements"],
    references: [
      { title: "Fax T.38 Troubleshooting Guide — Sansay TAC", url: "https://support.sansay.com/t/18c8yz/fax-t-38-troubleshooting-guide", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "fax-center", subviewId: "history", label: "Check Fax History" },
    ],
    keywords: ["T.38", "fax", "page loss", "partial", "ECM", "redundancy", "missing pages", "corrupt"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "t38-reinvite-switchover",
    title: "T.38 re-INVITE Switchover Failures",
    domains: ["t38", "sip"],
    categories: ["fax"],
    severity: "critical",
    symptoms: [
      "Fax call starts as audio (G.711) but fails to switch to T.38",
      "re-INVITE for T.38 is rejected by the far end",
      "Fax fails immediately after CNG/CED tone detection",
    ],
    causes: [
      { summary: "Far end doesn't support T.38", likelihood: "high", detail: "The remote gateway or SBC does not support T.38 UDPTL and rejects the re-INVITE to switch." },
      { summary: "SBC strips re-INVITE", likelihood: "medium", detail: "An intermediary SBC or B2BUA blocks or strips the T.38 re-INVITE." },
      { summary: "SDP negotiation failure", likelihood: "medium", detail: "The T.38 SDP parameters (UDPTL vs TCP, max datagram, etc.) are not compatible." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the call and look for the re-INVITE with T.38 SDP (m=image ... udptl t38)" },
      { order: 2, instruction: "Check the response to the re-INVITE — 200 OK (success) or error code" },
      { order: 3, instruction: "If rejected, check if the far end supports T.38 at all" },
    ],
    solutions: [
      { summary: "Fall back to G.711 passthrough", steps: ["If T.38 re-INVITE is rejected, configure fallback to G.711 passthrough", "Ensure G.711 is used (not compressed codecs)", "Disable echo cancellation and VAD for fax calls"], appliesWhen: "When remote end doesn't support T.38" },
    ],
    relatedSipCodes: [488],
    relatedArticleIds: ["t38-vs-passthrough"],
    references: [
      { title: "Fax-SIP Troubleshoot Guide — Cisco", url: "https://www.cisco.com/c/en/us/support/docs/voice/session-initiation-protocol-sip/118647-technote-sip-00.html", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Inspect T.38 re-INVITE" },
      { toolId: "fax-center", subviewId: "send", label: "Send Test Fax" },
    ],
    keywords: ["T.38", "re-INVITE", "switchover", "CNG", "CED", "fax detection", "UDPTL", "fallback"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "t38-network-requirements",
    title: "T.38 Network Performance Requirements",
    domains: ["t38", "network"],
    categories: ["fax", "qos"],
    severity: "info",
    symptoms: [
      "Faxes fail intermittently",
      "Fax failure rate exceeds 8-10%",
      "Pages arrive corrupted despite ECM",
    ],
    causes: [
      { summary: "Network conditions exceed T.38 tolerances", likelihood: "high", detail: "T.38 requires: delay < 1000ms one-way, jitter < 300ms. G.711 passthrough requires: delay < 1000ms, jitter < 30ms, near-zero packet loss. Exceeding these causes failures (Cisco/Sansay)." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Run a network quality test to the fax destination", expected: "Delay < 1000ms, Jitter < 300ms for T.38 or < 30ms for passthrough" },
      { order: 2, instruction: "Check baseline fax failure rate — around 8% is normal for SIP trunks (Sansay TAC)" },
    ],
    solutions: [
      { summary: "Improve network quality", steps: ["Enable QoS for fax traffic (same DSCP as voice — EF/46)", "Use T.38 instead of passthrough for better tolerance", "Ensure adequate bandwidth for fax (typically same as G.711 — 87.2 kbps)"] },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["t38-vs-passthrough", "t38-page-loss", "qos-dscp-marking"],
    references: [
      { title: "Fax-SIP Troubleshoot Guide — Cisco", url: "https://www.cisco.com/c/en/us/support/docs/voice/session-initiation-protocol-sip/118647-technote-sip-00.html", type: "vendor" },
      { title: "Fax T.38 Troubleshooting Guide — Sansay TAC", url: "https://support.sansay.com/t/18c8yz/fax-t-38-troubleshooting-guide", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "voip", label: "VoIP Quality Test" },
    ],
    keywords: ["T.38", "network requirements", "delay", "jitter", "packet loss", "fax failure rate", "8%"],
    lastUpdated: "2025-06-01",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NETWORK
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "qos-dscp-marking",
    title: "QoS / DSCP Marking for VoIP",
    domains: ["network"],
    categories: ["qos"],
    severity: "info",
    symptoms: [
      "Voice quality degrades during periods of network congestion",
      "Other traffic (downloads, backups) impacts call quality",
      "Good quality on quiet network, poor during busy periods",
    ],
    causes: [
      { summary: "No QoS configured", likelihood: "high", detail: "Without QoS, voice packets compete equally with all other traffic for bandwidth and buffer space. During congestion, voice packets are dropped or delayed alongside everything else." },
      { summary: "DSCP not honored end-to-end", likelihood: "medium", detail: "DSCP markings are set on the LAN but stripped or ignored by the ISP or WAN equipment." },
      { summary: "Wrong DSCP values", likelihood: "low", detail: "Packets marked with wrong DSCP values, so QoS policies don't match." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture voice packets and check the DSCP/ToS field in the IP header", expected: "RTP should be marked with EF (46/0x2E), SIP signaling with CS3 (24) or AF31 (26)" },
      { order: 2, instruction: "Check QoS configuration on routers and switches in the path" },
      { order: 3, instruction: "Verify the ISP honors your DSCP markings (many ISPs strip them at the edge)" },
    ],
    solutions: [
      { summary: "Configure DSCP marking", steps: ["Mark RTP media with DSCP EF (46) — Expedited Forwarding", "Mark SIP signaling with DSCP CS3 (24) or AF31 (26)", "Configure routers with Low Latency Queuing (LLQ) for EF traffic", "Reserve bandwidth for voice: 87.2 kbps per G.711 call"], appliesWhen: "For all VoIP deployments" },
      { summary: "Configure LAN QoS", steps: ["Map DSCP to 802.1p CoS for Layer 2 prioritization", "Configure switch ports connected to phones as voice VLANs", "Enable strict priority queuing for voice CoS values (typically CoS 5)"], appliesWhen: "For LAN environments" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["high-jitter", "packet-loss-impact", "poor-mos-score", "bandwidth-calculation"],
    references: [
      { title: "The 2025 Guide to VoIP QoS — AVOXI", url: "https://avoxi.com/blog/voip-qos", type: "community" },
      { title: "Troubleshooting VoIP QoS and DSCP — ThousandEyes", url: "https://www.thousandeyes.com/blog/troubleshooting-voip-qos-and-dscp", type: "vendor" },
      { title: "Voice QoS: ToS-CoS Packet Marking — Cisco", url: "https://www.cisco.com/c/en/us/support/docs/voice/voice-quality/23442-tos-cos.html", type: "vendor" },
      { title: "RFC 2474 — Definition of the Differentiated Services Field", url: "https://datatracker.ietf.org/doc/html/rfc2474", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Check DSCP in Packets" },
      { toolId: "network", subviewId: "voip", label: "VoIP Quality Test" },
    ],
    keywords: ["QoS", "DSCP", "EF", "ToS", "CoS", "priority", "queuing", "LLQ", "quality of service", "bandwidth"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "sip-alg-problems",
    title: "SIP ALG — Application Layer Gateway Problems",
    domains: ["sip", "network"],
    categories: ["nat-firewall"],
    severity: "critical",
    symptoms: [
      "One-way audio",
      "Registration succeeds but calls fail",
      "Calls drop after 30 seconds",
      "Random call failures that are hard to reproduce",
      "SIP headers appear modified between client and server captures",
    ],
    causes: [
      { summary: "SIP ALG rewriting headers", likelihood: "high", detail: "SIP ALG was designed for legacy on-premises VoIP systems but conflicts with modern cloud VoIP, encrypted SIP (TLS/SRTP), and outbound proxy architectures. It rewrites Contact, Via, Route, Record-Route headers, and SDP c= lines, often incorrectly. Nearly 40% of call setup failures in SMB environments are caused by SIP ALG (viirtue.com 2026)." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture SIP traffic on both sides of the router (LAN and WAN)" },
      { order: 2, instruction: "Compare SIP headers — if Contact, Via, or SDP differs, SIP ALG is active" },
      { order: 3, instruction: "Check router settings for SIP ALG, SIP Helper, SIP Transformations, or SIP Inspection" },
    ],
    solutions: [
      { summary: "Disable SIP ALG", steps: ["Access router admin panel", "Locate SIP ALG, SIP Helper, or SIP Transformation setting", "Disable it completely", "Reboot the router", "Re-test registration and calls", "Common router locations: Security > ALG, Firewall > ALG, NAT > Application Layer Gateway"], appliesWhen: "Always — SIP ALG should be disabled for modern VoIP" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["one-way-audio", "call-drops-30-seconds", "nat-registration-issues"],
    references: [
      { title: "How to Solve SIP ALG Problems in 2026 — Viirtue", url: "https://viirtue.com/how-to-solve-sip-alg-problems-in-2026-a-practical-voip-guide-for-smbs-and-msps/", type: "community" },
      { title: "VoIP: SIP phones cannot make/receive calls — SonicWall", url: "https://www.sonicwall.com/support/knowledge-base/voip-sip-phones-cannot-make-and-or-receive-calls/170505972489729", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Compare LAN/WAN Captures" },
    ],
    keywords: ["SIP ALG", "ALG", "Application Layer Gateway", "SIP Helper", "header rewriting", "Contact", "Via", "SDP"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "nat-traversal-stun-turn",
    title: "NAT Traversal for VoIP — Practical Solutions",
    domains: ["network", "sip"],
    categories: ["nat-firewall"],
    severity: "info",
    symptoms: [
      "Calls work on LAN but fail across NAT",
      "Private IP appears in SDP c= line instead of public IP",
      "Audio works in one direction only when calling across NAT",
    ],
    causes: [
      { summary: "NAT prevents direct media flow", likelihood: "high", detail: "NAT translates private IPs to public IPs, but SIP/SDP carries the private IP in the signaling, causing the remote endpoint to send media to an unreachable address." },
      { summary: "SIP ALG rewriting addresses incorrectly", likelihood: "high", detail: "Many consumer routers have SIP ALG enabled by default, which rewrites SIP headers and SDP in unpredictable ways. This is the #1 cause of NAT-related VoIP issues." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture the SIP INVITE and 200 OK — check c= lines in the SDP for private IPs", expected: "Both sides should show routable addresses. Private IPs (10.x, 192.168.x, 172.16-31.x) indicate NAT is not being handled." },
      { order: 2, instruction: "Check if SIP ALG is enabled on the router (often on by default)", expected: "SIP ALG should be disabled for most VoIP setups" },
      { order: 3, instruction: "Verify your VoIP provider's NAT traversal settings are configured correctly" },
    ],
    solutions: [
      { summary: "Disable SIP ALG", steps: ["Access router admin panel", "Disable SIP ALG / SIP Helper / SIP Transformations", "Reboot the router", "Re-test — this alone resolves the majority of NAT issues"], appliesWhen: "Always check this first — most common fix" },
      { summary: "Use your provider's outbound proxy", steps: ["Most VoIP providers offer an outbound proxy that handles NAT traversal automatically", "Configure the outbound proxy address in your SIP client settings", "The proxy rewrites SDP and relays media as needed", "This is the simplest and most reliable approach for most users"], appliesWhen: "When your provider offers an outbound proxy (most do)" },
      { summary: "Set external IP manually", steps: ["If your public IP is static, configure it as the external/public address in your SIP client or PBX", "This tells the client to use this address in SDP instead of the private IP", "Does not work with dynamic IP addresses"], appliesWhen: "When you have a static public IP" },
      { summary: "Reduce registration interval", steps: ["Set registration expiry to 30-60 seconds", "Frequent re-registrations keep NAT pinholes open", "Check your provider's minimum expiry requirements"], appliesWhen: "When NAT bindings expire and incoming calls fail" },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["nat-registration-issues", "one-way-audio", "sip-alg-problems"],
    references: [
      { title: "RFC 3581 — Symmetric Response Routing (rport)", url: "https://datatracker.ietf.org/doc/html/rfc3581", type: "rfc" },
      { title: "How to Solve SIP ALG Problems in 2026 — Viirtue", url: "https://viirtue.com/how-to-solve-sip-alg-problems-in-2026-a-practical-voip-guide-for-smbs-and-msps/", type: "community" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "voip", label: "Network Test" },
    ],
    keywords: ["NAT", "traversal", "outbound proxy", "SIP ALG", "private IP", "public IP", "external address"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "firewall-port-requirements",
    title: "Firewall Port Requirements for VoIP",
    domains: ["network"],
    categories: ["nat-firewall"],
    severity: "info",
    symptoms: [
      "SIP signaling works but media fails",
      "Registration fails from certain networks",
      "Calls fail behind corporate firewalls",
    ],
    causes: [
      { summary: "Required ports not open", likelihood: "high", detail: "VoIP requires multiple port ranges for signaling and media. Corporate firewalls often block the wide UDP port range needed for RTP." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Test connectivity on SIP ports (5060 UDP/TCP, 5061 TLS)" },
      { order: 2, instruction: "Test connectivity on RTP port range (10000-20000 UDP)" },
      { order: 3, instruction: "Check if the firewall has stateful UDP tracking enabled" },
    ],
    solutions: [
      { summary: "Open required ports", steps: [
        "SIP Signaling: UDP 5060, TCP 5060, TLS 5061 (bidirectional)",
        "RTP Media: UDP 10000-20000 (bidirectional) — or your configured RTP port range",
        "Enable stateful connection tracking for UDP so return packets are automatically allowed",
        "Some providers use non-standard ports — check your provider's documentation",
      ] },
    ],
    relatedSipCodes: [408],
    relatedArticleIds: ["sip-408-timeout", "one-way-audio", "no-audio"],
    references: [
      { title: "RFC 3261 — SIP default ports", url: "https://datatracker.ietf.org/doc/html/rfc3261", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "connectivity", label: "Port Scan" },
    ],
    keywords: ["firewall", "ports", "5060", "5061", "RTP", "UDP", "TCP", "TLS", "blocked", "corporate"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "dns-config-for-sip",
    title: "DNS Configuration for SIP — SRV, NAPTR, and A Records",
    domains: ["dns", "sip"],
    categories: ["dns-resolution"],
    severity: "info",
    symptoms: [
      "Clients cannot discover SIP server automatically",
      "No failover when primary SIP server goes down",
      "Transport protocol not selected correctly",
    ],
    causes: [
      { summary: "Missing or incorrect DNS records", likelihood: "high", detail: "Per RFC 3263, SIP clients use NAPTR → SRV → A/AAAA records to discover the SIP server address, port, and transport. Missing records prevent proper discovery." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Query NAPTR records for the SIP domain", expected: "Should return records with SIP service flags" },
      { order: 2, instruction: "Query SRV records: _sip._udp.<domain>, _sip._tcp.<domain>, _sips._tcp.<domain>", expected: "Should return host, port, priority, weight" },
      { order: 3, instruction: "Verify A/AAAA records exist for the SRV target hosts" },
    ],
    solutions: [
      { summary: "Configure proper DNS records", steps: [
        "NAPTR: Point to SRV record names with appropriate service/protocol flags",
        "SRV: _sip._udp.<domain> → priority 10, weight 100, port 5060, host sip.example.com",
        "SRV: _sip._tcp.<domain> → priority 20, weight 100, port 5060, host sip.example.com",
        "SRV: _sips._tcp.<domain> → priority 5, weight 100, port 5061, host sip.example.com",
        "A: sip.example.com → <server IP>",
        "For failover: add secondary SRV records with higher priority numbers",
      ] },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["dns-srv-naptr-failures"],
    references: [
      { title: "RFC 3263 — Locating SIP Servers", url: "https://datatracker.ietf.org/doc/html/rfc3263", type: "rfc" },
      { title: "RFC 2782 — DNS SRV Records", url: "https://datatracker.ietf.org/doc/html/rfc2782", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "voip", label: "SIP DNS Resolution" },
      { toolId: "network", subviewId: "connectivity", label: "DNS Lookup" },
    ],
    keywords: ["DNS", "SRV", "NAPTR", "A record", "AAAA", "RFC 3263", "discovery", "failover", "priority"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "bandwidth-calculation",
    title: "Bandwidth Calculation for VoIP Calls",
    domains: ["network"],
    categories: ["qos"],
    severity: "info",
    symptoms: [
      "Need to plan bandwidth for VoIP deployment",
      "Calls fail when too many are active simultaneously",
      "Quality degrades with more concurrent calls",
    ],
    causes: [
      { summary: "Insufficient bandwidth", likelihood: "high", detail: "Each VoIP call requires dedicated bandwidth. Without enough bandwidth for all concurrent calls, quality degrades for all calls." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Calculate bandwidth needed per call based on codec" },
      { order: 2, instruction: "Multiply by maximum concurrent calls" },
      { order: 3, instruction: "Compare with available bandwidth (including overhead for other traffic)" },
    ],
    solutions: [
      { summary: "Plan bandwidth correctly", steps: [
        "G.711: 87.2 kbps per call (64 kbps codec + IP/UDP/RTP/L2 overhead at 20ms ptime)",
        "G.729: 31.2 kbps per call (8 kbps codec + overhead)",
        "Overhead per packet: 58 bytes = IP(20) + UDP(8) + RTP(12) + Ethernet(18 = 6 dest + 6 src + 2 type + 4 FCS)",
        "At 20ms ptime: 50 packets/second × (codec payload + 58 bytes overhead)",
        "Reserve 20-30% additional bandwidth headroom for signaling and bursts",
        "Example: 10 concurrent G.711 calls = 10 × 87.2 = 872 kbps minimum",
      ] },
    ],
    relatedSipCodes: [],
    relatedArticleIds: ["qos-dscp-marking"],
    references: [
      { title: "Modify Bandwidth Consumption Calculation for Voice Calls — Cisco (Doc ID 7934)", url: "https://www.cisco.com/c/en/us/support/docs/voice/voice-quality/7934-bwidth-consume.html", type: "vendor" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "voip", label: "Bandwidth Test" },
    ],
    keywords: ["bandwidth", "capacity", "concurrent calls", "G.711", "G.729", "overhead", "kbps", "ptime"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "mtu-fragmentation",
    title: "MTU and IP Fragmentation Issues for VoIP",
    domains: ["network"],
    categories: ["qos"],
    severity: "warning",
    symptoms: [
      "Large SIP messages (with SDP) fail intermittently",
      "513 Message Too Large responses",
      "Call setup works sometimes but not always (depends on SDP size)",
    ],
    causes: [
      { summary: "SIP over UDP exceeds MTU", likelihood: "high", detail: "UDP SIP messages larger than the path MTU (typically 1500 bytes minus headers = ~1472 bytes for UDP payload) get fragmented. If any fragment is lost, the entire message is lost." },
      { summary: "Fragmentation blocked by firewall", likelihood: "medium", detail: "Some firewalls block IP fragments for security reasons." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the size of SIP messages in your captures", expected: "Messages over ~1300 bytes may fragment on some paths" },
      { order: 2, instruction: "Look for IP fragmentation in captures (More Fragments flag, Fragment Offset)" },
      { order: 3, instruction: "Test with TCP transport which handles large messages natively" },
    ],
    solutions: [
      { summary: "Switch to TCP for large messages", steps: ["RFC 3261 recommends TCP for messages larger than the path MTU", "Configure SIP to use TCP transport", "Most SIP implementations auto-switch to TCP for large messages"], appliesWhen: "When UDP fragmentation causes issues" },
      { summary: "Reduce SDP size", steps: ["Offer fewer codecs to reduce SDP body size", "Remove unnecessary SDP attributes", "Use compact SIP header forms"], appliesWhen: "When you need to stay on UDP" },
    ],
    relatedSipCodes: [513],
    relatedArticleIds: [],
    references: [
      { title: "RFC 3261 Section 18.1.1 — Sending Requests (UDP size guidance)", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-18.1.1", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Check Message Sizes" },
    ],
    keywords: ["MTU", "fragmentation", "UDP", "TCP", "513", "large message", "SDP size", "path MTU"],
    lastUpdated: "2025-06-01",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "tls-certificate-verification",
    title: "TLS Certificate Verification for SIP",
    domains: ["security", "sip"],
    categories: ["certificates"],
    severity: "warning",
    symptoms: [
      "TLS handshake fails when connecting to SIP server",
      "Certificate warnings or errors",
      "Calls work over UDP but not TLS",
    ],
    causes: [
      { summary: "Certificate expired", likelihood: "high", detail: "The server's TLS certificate has expired." },
      { summary: "Hostname mismatch", likelihood: "high", detail: "The certificate's CN or SAN does not match the domain being connected to." },
      { summary: "Untrusted CA", likelihood: "medium", detail: "Self-signed certificate or CA not in the trust store." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check the certificate expiry date" },
      { order: 2, instruction: "Verify CN/SAN matches the SIP domain" },
      { order: 3, instruction: "Check the certificate chain for trusted CA" },
    ],
    solutions: [
      { summary: "Fix certificate issues", steps: ["Renew expired certificates", "Ensure CN/SAN matches the SIP domain", "Add CA to trust store for private CAs"] },
    ],
    relatedSipCodes: [437],
    relatedArticleIds: ["tls-registration-failures", "srtp-key-negotiation"],
    references: [
      { title: "RFC 8446 — TLS 1.3", url: "https://datatracker.ietf.org/doc/html/rfc8446", type: "rfc" },
      { title: "RFC 8862 — Securing RTP Media with SIP", url: "https://datatracker.ietf.org/doc/html/rfc8862", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "network", subviewId: "connectivity", label: "Test TLS Connection" },
    ],
    keywords: ["TLS", "certificate", "SSL", "handshake", "expired", "CA", "trust", "hostname", "SAN"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "srtp-key-negotiation",
    title: "SRTP Key Negotiation — SDES vs DTLS-SRTP",
    domains: ["security", "rtp"],
    categories: ["certificates", "media"],
    severity: "warning",
    symptoms: [
      "488 response when SRTP is required",
      "No audio when SRTP is enabled on one side only",
      "Encryption mismatch between endpoints",
    ],
    causes: [
      { summary: "SRTP method mismatch", likelihood: "high", detail: "One endpoint uses SDES (crypto attributes in SDP) while the other uses DTLS-SRTP. They are incompatible." },
      { summary: "Crypto suite mismatch", likelihood: "medium", detail: "Both use SDES but offer different crypto suites (e.g., AES_CM_128 vs AES_256)." },
      { summary: "One side doesn't support SRTP", likelihood: "medium", detail: "Mandatory SRTP on one side, no SRTP support on the other." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Check SDP for a=crypto lines (SDES) or a=fingerprint/a=setup lines (DTLS-SRTP)" },
      { order: 2, instruction: "Compare encryption methods between offer and answer" },
      { order: 3, instruction: "Check if the m= line uses RTP/SAVP (SRTP) or RTP/AVP (plain RTP)" },
    ],
    solutions: [
      { summary: "Align encryption settings", steps: ["Ensure both endpoints use the same SRTP method (SDES or DTLS-SRTP)", "For SDES: ensure AES_CM_128_HMAC_SHA1_80 is offered (most common)", "For DTLS-SRTP: ensure fingerprint and setup attributes are correct", "Or disable SRTP on both sides if encryption is not required"] },
    ],
    relatedSipCodes: [488],
    relatedArticleIds: ["tls-certificate-verification", "sip-488-not-acceptable"],
    references: [
      { title: "RFC 8862 — Securing RTP Media with SIP", url: "https://datatracker.ietf.org/doc/html/rfc8862", type: "rfc" },
      { title: "RFC 4568 — SDP Security Descriptions (SDES)", url: "https://datatracker.ietf.org/doc/html/rfc4568", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "packet-capture", subviewId: "viewer", label: "Check SDP Crypto Lines" },
    ],
    keywords: ["SRTP", "SDES", "DTLS-SRTP", "encryption", "crypto", "AES", "fingerprint", "SAVP", "secure"],
    lastUpdated: "2025-06-01",
  },

  {
    id: "digest-auth-deep-dive",
    title: "SIP Digest Authentication Deep Dive",
    domains: ["sip", "security"],
    categories: ["registration", "certificates"],
    severity: "info",
    symptoms: [
      "Need to understand how SIP digest authentication works",
      "Authentication debugging: want to verify the hash calculation",
    ],
    causes: [
      { summary: "Reference article", likelihood: "high", detail: "This is an informational article explaining how SIP digest authentication works per RFC 7616." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Capture a REGISTER exchange showing the 401 challenge and authenticated REGISTER" },
      { order: 2, instruction: "Extract from WWW-Authenticate: realm, nonce, qop, algorithm" },
      { order: 3, instruction: "From the Authorization header: username, uri, nc (nonce count), cnonce, response" },
      { order: 4, instruction: "Compute: HA1 = MD5(username:realm:password), HA2 = MD5(method:uri), response = MD5(HA1:nonce:nc:cnonce:qop:HA2)" },
      { order: 5, instruction: "Compare computed response with the one in the Authorization header" },
    ],
    solutions: [
      { summary: "Understanding the digest calculation", steps: [
        "Step 1: Server sends 401 with WWW-Authenticate: Digest realm=..., nonce=..., qop=auth, algorithm=MD5",
        "Step 2: Client computes HA1 = MD5(username:realm:password)",
        "Step 3: Client computes HA2 = MD5(REGISTER:sip:domain)",
        "Step 4: Client computes response = MD5(HA1:nonce:nc:cnonce:qop:HA2)",
        "Step 5: Client sends REGISTER with Authorization header containing the response",
        "SIPalyzer auto-computes this when you add credentials to a registrar",
      ] },
    ],
    relatedSipCodes: [401, 407],
    relatedArticleIds: ["reg-401-unauthorized", "reg-407-proxy-auth"],
    references: [
      { title: "RFC 7616 — HTTP Digest Access Authentication", url: "https://datatracker.ietf.org/doc/html/rfc7616", type: "rfc" },
      { title: "RFC 3261 Section 22 — Usage of HTTP Authentication", url: "https://datatracker.ietf.org/doc/html/rfc3261#section-22", type: "rfc" },
    ],
    sipalizerTools: [
      { toolId: "registration", label: "Test with Digest Auth" },
      { toolId: "composer", subviewId: "requests", label: "Craft Authenticated Request" },
    ],
    keywords: ["digest", "authentication", "MD5", "SHA-256", "nonce", "realm", "HA1", "HA2", "WWW-Authenticate", "Authorization", "RFC 7616"],
    lastUpdated: "2025-06-01",
  },
  {
    id: "mcp-server-integration-failures",
    title: "MCP Integration Failures — Server Profiles, Tool Calls, and Orchestration",
    domains: ["general", "security", "network"],
    categories: ["interop", "nat-firewall", "certificates"],
    severity: "warning",
    symptoms: [
      "MCP profile shows disconnected even after connect action",
      "Tool calls fail with schema or transport errors",
      "Multi-agent orchestration returns mixed/partial outcomes",
      "Hosted MCP network server is unreachable from clients",
    ],
    causes: [
      { summary: "Transport mismatch", likelihood: "high", detail: "Profile transport (stdio/network) does not match the target MCP server runtime or endpoint." },
      { summary: "Schema mismatch", likelihood: "high", detail: "Tool arguments do not satisfy input schema, causing validation or execution errors." },
      { summary: "Network/auth controls", likelihood: "medium", detail: "Hosted network mode is blocked by firewall or rejected due to invalid/expired auth token." },
      { summary: "Non-idempotent fanout", likelihood: "medium", detail: "Orchestration sends parallel operations with side effects, causing divergent outcomes." },
    ],
    diagnosticSteps: [
      { order: 1, instruction: "Open Tools > MCP and verify profile transport settings and connection status per server." },
      { order: 2, instruction: "Refresh catalog and compare tool names/argument schema before calling a tool." },
      { order: 3, instruction: "Run one single-server call with minimal JSON arguments to isolate schema issues." },
      { order: 4, instruction: "If hosted network mode is enabled, validate bind/port/token and confirm network reachability from client host." },
      { order: 5, instruction: "For orchestration failures, compare per-server results and retry with idempotent, side-effect-safe tasks." },
    ],
    solutions: [
      { summary: "Normalize profile config", steps: ["Match transport to server runtime (stdio command vs network endpoint)", "Store consistent env/args per profile", "Reconnect and refresh capabilities"] },
      { summary: "Fix argument contracts", steps: ["Validate payload against tool input schema", "Use smallest reproducible payload", "Expand arguments incrementally after success"] },
      { summary: "Harden hosted server access", steps: ["Rotate auth token and update clients", "Confirm bind address/port and firewall rules", "Disable network transport if only local stdio is needed"] },
      { summary: "Stabilize orchestration", steps: ["Split irreversible operations from read-only fanout tasks", "Use retries only for idempotent operations", "Review audit/activity entries before replay"] },
    ],
    relatedArticleIds: ["dns-srv-naptr-failures", "tls-certificate-verification"],
    references: [
      { title: "Model Context Protocol Documentation", url: "https://modelcontextprotocol.io", type: "standard" },
      { title: "RFC 6455 — The WebSocket Protocol", url: "https://datatracker.ietf.org/doc/html/rfc6455", type: "rfc" },
      { title: "OWASP API Security Top 10", url: "https://owasp.org/API-Security/", type: "standard" },
    ],
    sipalizerTools: [
      { toolId: "tools", subviewId: "mcp", label: "MCP Integration View" },
      { toolId: "admin-center", label: "Audit and Health" },
    ],
    keywords: ["mcp", "model context protocol", "tool call", "schema", "orchestration", "multi-agent", "token", "network transport", "stdio"],
    lastUpdated: "2026-03-11",
  },
];

/** Quick lookup: article by ID. */
let articleIndex: Map<string, TsArticle> | null = null;

function getArticleIndex(): Map<string, TsArticle> {
  if (articleIndex) return articleIndex;
  const index = new Map<string, TsArticle>();
  for (const a of KNOWLEDGE_BASE_ARTICLES) index.set(a.id, a);
  articleIndex = index;
  return index;
}

/** Get a KB article by ID. */
export function getArticleById(id: string): TsArticle | undefined {
  return getArticleIndex().get(id);
}

/** Get all articles for a given domain. */
export function getArticlesByDomain(domain: TsArticle["domains"][number]): TsArticle[] {
  return KNOWLEDGE_BASE_ARTICLES.filter((a) => a.domains.includes(domain));
}

/** Get all articles matching a SIP response code. */
export function getArticlesBySipCode(code: number): TsArticle[] {
  return KNOWLEDGE_BASE_ARTICLES.filter((a) => a.relatedSipCodes?.includes(code));
}
