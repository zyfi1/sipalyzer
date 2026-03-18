---
date: 2026-02-19
topic: master-tool-ideas-expanded
---

# SIPalyzer — Expanded Master Tool Ideas List

Synthesized from the original 35-item list, competitive analysis (VoIPmonitor, Homer, SIPVicious, sngrep, TransNexus, SIP3, testRTC, Sipfront, etc.), WebRTC/modern protocol research, telecom engineer workflow studies, and VoIP security analysis.

**Legend:**
- `[EXISTING]` = Data/infra exists in the codebase already
- `[BACKEND DONE]` = Rust backend complete, needs UI
- `[ORIGINAL #N]` = From the original 35-item list
- `[NEW]` = Discovered through research, not on original list
- Effort: S (small, <1 day), M (medium, 1-3 days), L (large, 3-7 days), XL (extra-large, 1-2+ weeks)

---

## TIER 0 — Quick Wins (Small Effort, Daily Use)

These can be shipped fast, used constantly, and demonstrate breadth.

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 1 | **Wake-on-LAN UI Button** | Add a button in Network Devices view to trigger WOL for discovered devices with known MACs. | S | `[ORIGINAL #9]` `[BACKEND DONE]` — `wake_on_lan` Tauri command exists, OUI lookup exists. Literally just a button + toast. |
| 2 | **SIP Response Code Reference** | Interactive searchable reference of all SIP codes (1xx-6xx) with RFC links, plain-English explanations, troubleshooting steps, causes, and actions. | S | `[ORIGINAL #33]` `[EXISTING]` — `sipResponseCodeMap.ts` has full data with `SipCodeEntry` (code, name, description, rfcReference, causes, actions). Just needs a standalone browse/search UI. |
| 3 | **Port Reference Guide** | Quick lookup of VoIP/telecom ports — SIP (5060/5061), RTP (10000-20000), SRTP, STUN (3478), TURN (3479/5349), T.38, SNMP (161/162), Syslog (514), TFTP (69), etc. Firewall checklist copy-paste format. | S | `[ORIGINAL #34]` — Port data referenced in filter autocomplete. Add a static reference UI with search and "copy firewall rules" button. |
| 4 | **Password Generator** | Generate SIP auth passwords, PSKs, HMAC secrets, API tokens. Configurable length, complexity, character sets. Strength meter + one-click copy. | S | `[ORIGINAL #29]` — Password generation types exist in `composer.ts`/`sshStore.ts`. Pure frontend. |
| 5 | **Epoch / Timestamp Converter** | Convert between Unix epoch, ISO 8601, SIP Date header format, NTP timestamp, local time. Auto-detect input format. Relative time display ("3 hours ago"). | S | `[ORIGINAL #30]` — Referenced in wiki data. Pure frontend calculator. |
| 6 | **Base64 / Hex / URL Encoder** | Encode/decode Base64, hex, URL encoding, SIP URI escaping, JWT decode. Multi-tab interface. | S | `[ORIGINAL #31]` — Base64 used across codebase. Pure frontend. |
| 7 | **DSCP / ToS / IP Precedence Converter** | Convert between DSCP value, ToS byte, IP Precedence. Presets for VoIP voice (EF/DSCP 46), signaling (CS3/DSCP 24), video (AF41). Copy-paste for router ACLs. | S | `[NEW]` — Every VoIP engineer needs this daily. Competitor tools (packetmischief) exist but as web-only. |
| 8 | **SIP Header Quick Reference** | Searchable reference of SIP headers (From, To, Via, CSeq, Call-ID, Contact, Route, Record-Route, etc.) with RFC references, Wireshark display filter names, and examples. | S | `[NEW]` — `crafterWikiData.ts` has partial data. Complements the Response Code Reference. |

---

## TIER 1 — High-Impact Core Analysis Tools

These define SIPalyzer's competitive position as a desktop SIP/VoIP analysis platform.

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 9 | **SDP Analyzer / Negotiation Visualizer** | Paste INVITE + 200 OK (or extract from capture), get visual SDP offer/answer breakdown — codecs offered vs accepted, rejected media lines, ICE candidates, SRTP attributes (a=crypto, a=fingerprint), bandwidth, ptime, telephone-event. "What went wrong" diagnostic for media negotiation failures. | L | `[ORIGINAL #13]` `[EXISTING]` — `sip_parser.rs` already parses SDP. Some offer/answer references in wiki. The SDP parser in Rust provides the backbone; UI is the main work. |
| 10 | **STIR/SHAKEN Attestation Checker** | Extract Identity header from INVITE, decode PASSporT JWT (header/payload/signature), fetch cert from x5u URL, verify signature, display attestation level (A/B/C) with explanation, show originating SP. Parse P-Stir-Verstat header. | M | `[ORIGINAL #11]` — Research confirms: Sansay has a decoder, Kamailio has a module, TransNexus has CPS. No desktop tool does this well. High differentiation. JWT decode is frontend-possible; cert fetch/verify needs backend. |
| 11 | **RTCP Analysis Dashboard** | Parse RTCP Sender/Receiver Reports from captures. Display RTT, jitter, packet loss, fraction lost as time-series charts. Support RTCP-XR (RFC 3611) for VoIP metrics, burst/gap loss, delay. Per-stream and per-call views. | L | `[ORIGINAL #19]` `[EXISTING]` — `rtp_analyzer.rs` exists, RTCP references in packet capture types and filter autocomplete. RTP stream extraction already works. Main work is RTCP-specific parsing and time-series visualization. |
| 12 | **HEP/Homer Integration** | SIPalyzer as both HEP capture agent (send captures to Homer) and HEP receiver (accept HEP streams from PBXes/SBCs). Ingest live production SIP traffic without packet capture. Optional Go agent for remote HEP capture. | XL | `[ORIGINAL #10]` — Homer/SIPCAPTURE is the standard. HEP3 protocol is well-documented. This positions SIPalyzer as a desktop Homer viewer. Remote agent infra already exists in `remote_agent/`. |
| 13 | **SIP Load Tester (Visual SIPp)** | Visual SIP stress testing UI over SIPp or custom engine. Define scenarios (REGISTER floods, INVITE/BYE cycles, OPTIONS bursts), set CPS/concurrent call limits, real-time graphs of response times/failures/retransmissions. Export results. | XL | `[ORIGINAL #12]` — Sipfront charges for this. SIPp is CLI-only. A visual wrapper is a major differentiator. Crafter (`crafter_send_sip`) provides the foundation for single messages; load testing needs a loop engine. |
| 14 | **Regex / Dial Plan Tester** | Test dial plan regex against phone numbers — Asterisk pattern syntax (`_NXXNXXXXXX`), FreeSWITCH regex, Kamailio regex, 3CX rules. Batch test with number lists. Show match/no-match with capture groups. | M | `[ORIGINAL #32]` — Filter bar has regex but no dial plan testing. High daily-use value. Pure frontend + pattern engine. |
| 15 | **Erlang B/C Calculator** | Erlang B (trunk sizing) and Erlang C (call center staffing). Input: busy-hour traffic (BHT/CCS), target blocking/wait time. Output: required trunks/agents. Extended Erlang B for retry. Visual graph of blocking vs. trunks. | M | `[ORIGINAL #4]` — erlang.com has web versions; no desktop tool integrates this. Pairs naturally with SIP Trunk Capacity Planner (#22). |
| 16 | **TLS / Certificate Inspector** | Connect to host:port, pull TLS cert chain, display issuer/subject/SANs/expiry/algo/key size/chain validation/OCSP status. Warn on expiring/weak/self-signed certs. Support SIP TLS (5061) and HTTPS. Show TLS version and cipher suite negotiated. | M | `[ORIGINAL #20]` — Research confirms this is used daily for debugging TLS SIP. Backend needs TLS inspection; frontend displays chain. |
| 17 | **Number Intelligence Lookup** | Enter phone number, get E.164 format, country/region, carrier (LRN), line type (landline/mobile/VoIP), CNAM. Numbering plan validation. | M | `[ORIGINAL #16]` — Some CNAM/carrier references in forensics. Needs external API integration or local numbering plan database. |

---

## TIER 2 — Solid Differentiation Features

These build out SIPalyzer's competitive moat and address gaps found in research.

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 18 | **SIPVicious-style Security Scanner** | SIP extension enumeration (OPTIONS/REGISTER probing), server fingerprinting (User-Agent extraction, method support), auth strength audit (Digest nonce analysis, realm extraction), passive vulnerability detection from captures. Report generation. | L | `[ORIGINAL #3]` — SIPVicious OSS is Python CLI. No desktop GUI equivalent. Can start passive (analyze captures) and add active scanning later. |
| 19 | **PBX Config Auditor** | Import PBX config snippets (Asterisk sip.conf/pjsip.conf, FreeSWITCH XML, 3CX backup). Audit for: insecure contexts, missing ACLs, weak passwords, codec misconfigs, unused trunks, missing failover, TLS not enabled, no SRTP. Security score. | L | `[ORIGINAL #6]` — No competitor does this as a desktop tool. Config parsing is the main challenge; can start with Asterisk only and expand. |
| 20 | **SRTP Key Exchange Analyzer** | Analyze SRTP key negotiation from SDP — show crypto suite (AES_CM_128, AES_256), key lengths, master key lifetimes, SDES vs DTLS-SRTP classification. Detect mismatches causing media failure. Flag SDES keys exposed in cleartext SIP (security risk per RFC 4568). | M | `[ORIGINAL #5]` `[EXISTING]` — SDP parsing exists in `sip_parser.rs`. Research confirms: key extraction from `a=crypto:` is well-documented. Can integrate with srtp-decrypt if available on PATH. |
| 21 | **SRTP Decryption (from SDES Keys)** | Auto-extract crypto keys from SDP `a=crypto:` lines in captured INVITE/200 OK. Decrypt SRTP streams for playback/analysis. Support TLS key log file import for TLS-encrypted SIP. | L | `[ORIGINAL #21]` — Research confirms: srtp-decrypt tool exists; VoIPmonitor does this. Major differentiation for desktop tool. Needs Rust SRTP implementation or srtp-decrypt integration. |
| 22 | **SIP Trunk Capacity Planner** | Input call volume, average duration, codec, grade of service target. Calculate: required SIP channels (Erlang B/C), bandwidth per codec (with L2/IP/UDP/RTP overhead), CPS requirements, peak-hour projections. Visual "what-if" graphs. | M | `[ORIGINAL #18]` — Pairs with Erlang Calculator. Research found Odin's Spear has a trunk capacity feature; no standalone desktop tool exists. |
| 23 | **Subnet Calculator / IP Utilities** | Visual subnet calculator: CIDR notation, wildcard masks, host ranges, supernetting, VLSM planning, IP-to-binary. Range overlap detector for "is this IP in this subnet?" Voice VLAN planning helper. | M | `[ORIGINAL #17]` — Every network engineer uses web-based versions. Desktop integration with other SIPalyzer tools (auto-fill from discovered subnets) is the differentiator. |
| 24 | **VoIP Bandwidth Calculator** | Select codec (G.711, G.729, G.722, Opus, iLBC, AMR), concurrent calls, layer (Ethernet/PPP/MPLS). Calculate: kbps, packets per second, frame delay. Show MOS estimate. IPv4 vs IPv6 overhead comparison. | M | `[NEW]` — Research found: Packetizer, PlanetCalc, erlang.com all have web versions. No desktop tool integrates this with live codec detection from captures. |
| 25 | **Codec Comparison Reference** | Interactive table of VoIP codecs: G.711 (a-law/μ-law), G.729, G.722, Opus, iLBC, AMR, T.38, G.726. Show bitrate, sample rate, frame size, MOS range, packet-loss resilience, CPU usage, license status. | S | `[NEW]` — Complements bandwidth calculator. Static data + optional link to listen to codec samples. |
| 26 | **E.164 / Dial Plan Formatter** | Enter number in any format, show E.164/national/international/RFC 3966 tel: URI/SIP URI. Include dial plan rule tester for Asterisk/FreeSWITCH/3CX syntax. Numbering plan database for country validation. | M | `[ORIGINAL #24]` — Combines well with Number Intelligence Lookup and Dial Plan Tester. |
| 27 | **SIP Message Diff Tool** | Paste two SIP messages side-by-side. SIP-aware structured diff that understands header semantics — highlight which changes matter (Via hop added, CSeq incremented, Route modified) vs. cosmetic (whitespace, header ordering). | M | `[ORIGINAL #28]` — Referenced in knowledge base. Provision Viewer already has a Diff view that could be adapted. |
| 28 | **Yealink Phone Control (ACTION URIs)** | Send HTTP ACTION URI commands to Yealink phones — reboot, check-sync, factory reset, DND toggle, autoprovision trigger, push XML browser pages. Bulk operations across multiple phones. | M | `[ORIGINAL #1]` `[EXISTING]` — `device_send_command` and `device_test_connectivity` Tauri commands exist. `deviceControlStore.ts` exists. Needs a dedicated control panel UI with phone selection. |
| 29 | **Additional Phone Model Provisioning** | Extend Provision Viewer beyond Yealink to support Poly (Polycom), Cisco SPA/MPP, Grandstream, Fanvil, SNOM provisioning formats, field references, and device mockups. | L | `[ORIGINAL #2]` — Provision Viewer infra exists. Each vendor is a separate data effort. Start with Poly (most common after Yealink). |
| 30 | **IP Phone Config Backup & Diff** | Connect to phone web admin API, download config, store timestamped snapshots, diff versions. Support Yealink (HTTP), potentially Poly/Cisco. | L | `[ORIGINAL #25]` `[EXISTING]` — Provision Viewer Diff view exists. `fetch_provision_file` and `fetch_url` APIs exist. Main work: config snapshot storage and automated fetch. |

---

## TIER 3 — Advanced Analysis & Monitoring

These position SIPalyzer as a serious engineering platform.

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 31 | **SNMP Trap Receiver** | Listen for inbound SNMP traps from devices/PBXes. Real-time display with severity coloring, OID translation, filtering by source/OID/severity. Completes the existing SNMP poller. | L | `[ORIGINAL #14]` `[EXISTING]` — `network_snmp_poll` Tauri command exists in `snmp.rs`. Trap receiver needs a UDP listener (new Rust code) + frontend display. |
| 32 | **MIB Browser** | Load MIB files, browse OID tree visually. GET/SET/WALK/GETBULK against devices. Graph polled values over time. Pre-load VoIP MIBs for Yealink, Cisco, Poly. | XL | `[ORIGINAL #15]` — Major feature. MIB parsing is complex. Could use an existing Rust MIB parser crate. High value for device troubleshooting. |
| 33 | **CDR Generator / Call Analytics** | Auto-generate CDRs from captures and softphone calls — caller, callee, setup/answer/end times, duration, disposition, codec, MOS estimate. Export CSV/JSON. Analytics dashboard: calls per hour, avg duration, top callers/callees, failure rate. | L | `[ORIGINAL #22]` `[EXISTING]` — SIP dialog extraction, RTP analysis, and CDR export commands already exist in packet capture backend. Forensics has partial types. Main work: unified CDR view + analytics charts. |
| 34 | **Network Interface Monitor / Traffic Dashboard** | Real-time per-interface traffic: bytes in/out, packets/sec, errors, drops, utilization percentage. Optional agent for remote host monitoring. | L | `[ORIGINAL #26]` — Some monitor references in packet monitor. `network_test` module has interface listing. Needs periodic polling + time-series charts. |
| 35 | **E911 / Emergency Services Tester** | Verify SIP INVITE contains correct PIDF-LO (location object), check 911/933 routing rules, validate PSAP connectivity patterns. Compliance checker for Kari's Law and RAY BAUM's Act. | L | `[ORIGINAL #7]` — Niche but critical for enterprises. PIDF-LO parsing from SIP INVITE body. |
| 36 | **SIP Fuzzer** | Send malformed SIP messages to test server robustness — oversized headers, invalid chars, truncated bodies, duplicate headers, malformed SDP. Template-based with predefined fuzz vectors. Safety warnings. | L | `[ORIGINAL #8]` — SIPVicious PRO has this. Crafter (`crafter_send_sip`) provides the send infrastructure. Fuzz vectors are the main data work. |
| 37 | **Webhook / Event System** | Configure webhooks for events: MOS drop below threshold, registration failure, device discovered, capture completed. Support Slack, Teams, PagerDuty, generic HTTP POST. | L | `[ORIGINAL #23]` — Platform feature that makes SIPalyzer "always-on" useful. Backend: event bus + HTTP POST. |
| 38 | **Multicast / IGMP Tester** | Test multicast group join/leave, send/receive test packets, verify IGMP snooping. For VoIP paging groups and MoH distribution. | M | `[ORIGINAL #27]` — Niche. Useful for paging system debugging. |

---

## TIER 4 — NEW Ideas from Research (Not on Original List)

These emerged from competitive analysis, engineer workflow research, and market gap analysis.

### WebRTC & Modern Protocol Analysis

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 39 | **WebRTC Stats Viewer** | Import WebRTC getStats/webrtc-internals dumps. Visualize ICE candidates, codec negotiation, jitter/loss/RTT time-series. Correlate with SIP captures by time/Call-ID. Desktop alternative to browser-only tools (rtcStats, watchRTC). | XL | `[NEW]` — Major gap: no desktop tool combines SIP pcap + WebRTC stats. Engineers juggle browser tools + Wireshark today. |
| 40 | **SIP-over-WebSocket Decoder** | Decode SIP messages transported over WebSocket (ws://) and Secure WebSocket (wss://). Extract SIP from WebSocket frames in captures. Ladder diagram and filtering same as UDP/TCP SIP. | L | `[NEW]` — Browser-based softphones (JsSIP, SIP.js) use WSS. SIP Inspector Pro is the only tool doing this; no open desktop equivalent. |
| 41 | **ICE/STUN/TURN Analyzer** | From pcap: extract STUN binding requests/responses, TURN allocate/permissions, ICE connectivity checks. Visualize candidate pairs, show which pair was selected, timing. Correlate with SDP ICE candidates. | L | `[NEW]` — Critical for WebRTC debugging. Trickle ICE and ICE Server Tester are live-only; post-mortem from pcap is a gap. |
| 42 | **One-Way Audio Diagnostic Wizard** | Guided diagnostic for the #1 VoIP support issue. Analyze capture/config for: NAT/topology issues, codec mismatches, SRTP mismatches, firewall blocking, direct media problems. Step-by-step checklist with evidence from trace. | M | `[NEW]` — Research confirms one-way audio is the dominant SIP-WebRTC issue. A wizard that automates the 10-minute triage is highly valuable. |
| 43 | **SIP over WebSocket Tester** | Like the existing Composer/Crafter but for SIP over WebSocket. Connect to ws:// or wss:// endpoint, send SIP REGISTER/INVITE/OPTIONS, see responses. For testing browser-based VoIP gateways. | M | `[NEW]` — Extends existing Crafter infra. Increasingly needed as browser VoIP grows. |

### Security & Compliance

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 44 | **Toll Fraud Detector (Passive)** | Analyze captures for fraud patterns: registration hijacking attempts (high REGISTER failure rate from single IP), extension scanning (sequential REGISTER/OPTIONS), premium number dialing patterns, wangiri (short ring, many sources), geographic inconsistencies (From vs Contact location). | L | `[NEW]` — Research found: frameworks exist in academia (SUNSHINE, IFIP) but no desktop tool implements passive detection from pcap. |
| 45 | **Encryption Compliance Report** | Per capture/session: TLS for signaling (Y/N, version, cipher), SRTP for media (Y/N, suite), STIR/SHAKEN present (Y/N, attestation). Pass/fail against configurable policies (e.g., "HIPAA requires encryption"). Export PDF for auditors. | M | `[NEW]` — Research found: FCC CPNI penalties up to $220K/violation. HIPAA requires ePHI encryption. No tool generates a single compliance view from a capture. |
| 46 | **Cleartext SIP Detector** | Flag any SIP over UDP or TCP without TLS in captures. List all endpoints transmitting cleartext SIP with credentials (REGISTER with auth). Severity: Critical if auth present, Warning if no auth. Suggest "upgrade to TLS." | S | `[NEW]` — Quick analysis pass over any capture. Pairs with Zero-Trust Checklist. |
| 47 | **Zero-Trust VoIP Checklist** | Automated checklist from capture: TLS for signaling, SRTP for media, mutual TLS (client cert present), no cleartext SIP, strong Digest auth (nonce quality), VLAN segmentation hints (from IP subnets). Export as security assessment. | M | `[NEW]` — NSA and NIST have zero-trust guidelines. No tool auto-generates a VoIP-specific checklist from a capture. |
| 48 | **SIP RFC Compliance Checker** | Analyze captured SIP messages for RFC 3261 compliance: required headers present, valid syntax, correct CSeq handling, proper Via processing, valid URI formats. Flag violations with RFC section references. | M | `[NEW]` — SIPVicious PRO has fuzzing; passive RFC compliance checking from captures is different and complementary. |

### Workflow & Productivity

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 49 | **Call Quality Report Generator** | From capture or live session: per-call report with MOS, jitter, packet loss, latency, codec, duration, SIP response codes. Template-based PDF/HTML export. Include SIP ladder diagram snapshot. | L | `[NEW]` — VoIPmonitor and VQcapture do this server-side. Desktop report generation from pcap is a gap. Pairs with CDR Generator (#33). |
| 50 | **Network Readiness Assessment** | One-page summary from recent tests/captures: bandwidth test results, latency, jitter, packet loss, MOS estimate, firewall port check, DNS resolution, STUN/TURN reachability. Export PDF for customer/ISP handoff. | M | `[NEW]` — Research found: PathSolutions and Reply Cloud do this as SaaS. Desktop version with export is a gap. Network test infra already exists. |
| 51 | **SIP Health Monitor** | Periodic OPTIONS ping to SIP endpoints. Track availability, response time, status codes over time. Alert on failures. Dashboard with uptime %. | M | `[NEW]` — Research found: this is the most-requested monitoring feature. Crafter can send OPTIONS; needs scheduling + persistence + dashboard. |
| 52 | **Bulk Config Export/Import** | Export discovered endpoints, codecs, trunk configurations to CSV. Import CSV to compare configurations across sites. "Config diff" between two sites. | M | `[NEW]` — Cisco BAT-style workflow. Provision Viewer has diff infra. |
| 53 | **CLI / Scriptable Interface** | Run SIPalyzer from command line: `sipalyzer analyze capture.pcap --format json`, `sipalyzer bandwidth --codec g711 --calls 50`, `sipalyzer health-check sip.example.com`. For CI/CD and script integration. | L | `[NEW]` — SIPVicious PRO emphasizes CI/CD. Tauri supports CLI args. Enables scripted workflows and integration with existing toolchains. |
| 54 | **Shareable Evidence Package** | Export a "troubleshooting package" containing: capture file (with optional anonymization), SIP ladder diagram, RTP quality metrics, call timeline, relevant CDRs. Single .zip for sharing with vendors/carriers. | M | `[NEW]` — Research found: shareable evidence packages for SLA disputes and vendor escalation are highly requested. `support_package` Tauri command already exists. |

### AI-Assisted Analysis

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 55 | **AI Root-Cause Suggestions** | Rule-based + lightweight ML engine that suggests probable causes from SIP/SDP/RTCP/ICE in current capture. E.g., "Codec mismatch between offer and answer", "High jitter suggests congestion", "NAT detected — consider STUN/TURN". | L | `[NEW]` — Research found: ML for VoIP quality is active (MiniatureVQNet, MFCC+MLP). Start rule-based using existing `troubleshootingEngine.ts`, evolve to ML. |
| 56 | **Local MOS Estimator (from RTCP)** | Estimate MOS from RTCP metrics (jitter, loss, delay) using E-model (ITU-T G.107) locally. No audio needed. Display MOS time-series alongside RTP stream. | M | `[NEW]` — Research found: OLR and E-model are standard. `rtp_analyzer.rs` already has quality metrics. E-model calculation is well-documented. |
| 57 | **Audio Quality Analyzer** | For decoded RTP/softphone recordings: silence detection, clipping detection, noise floor measurement, spectral analysis. Waveform visualization with annotations. | L | `[NEW]` — VoIPmonitor has this. `rtp_analyzer.rs` + Vosk model + audio infrastructure already exist for the softphone. Extension to analysis is feasible. |

### Protocol References & Education

| # | Tool | Description | Effort | Notes |
|---|------|-------------|--------|-------|
| 58 | **RFC 6035 / RTCP-XR Quality Report Importer** | Import SIP PUBLISH quality reports (RFC 6035) or RTCP-XR data. Display VoIP metrics (MOS, delay, jitter, loss, burst/gap) in standardized format. Correlate with captures. | M | `[NEW]` — Research found: Mitel Performance Analytics uses RFC 6035. No desktop tool imports these reports. |
| 59 | **SIP Sequence Diagram Generator** | From capture or manual input: generate publication-quality SIP call flow diagrams (Mermaid/SVG/PNG). Include timing, response codes, media events. Export for documentation and reports. | M | `[NEW]` — Call flow exists in the app; this adds export capability for documentation. |
| 60 | **VoIP Troubleshooting Decision Tree** | Interactive guided troubleshooting: "No audio?" → "One-way or both?" → "Check NAT/SRTP/codec"... Uses existing `troubleshootingDecisionTrees.ts` data with a standalone interactive UI. | M | `[EXISTING]` — Decision trees exist in data. Needs a dedicated interactive UI beyond the current troubleshooting home view. |

---

## Priority Matrix (Recommended Build Order)

### Phase 1 — Ship This Week (Quick Wins)
1. Wake-on-LAN UI Button (#1) — literally a button
2. SIP Response Code Reference (#2) — data exists
3. Port Reference Guide (#3) — static data
4. Password Generator (#4) — pure frontend
5. Epoch/Timestamp Converter (#5) — pure frontend
6. Base64/Hex/URL Encoder (#6) — pure frontend
7. DSCP/ToS Converter (#7) — pure frontend
8. Codec Comparison Reference (#25) — static data
9. SIP Header Reference (#8) — partial data exists
10. Cleartext SIP Detector (#46) — quick pass over captures

### Phase 2 — Next Sprint (High-Impact Core)
11. SDP Analyzer/Negotiation Visualizer (#9) — SDP parser exists
12. STIR/SHAKEN Checker (#10) — high differentiation
13. Erlang B/C Calculator (#15) — daily use
14. Regex/Dial Plan Tester (#14) — daily use
15. TLS/Certificate Inspector (#16) — daily use
16. SRTP Key Exchange Analyzer (#20) — SDP parser exists
17. VoIP Bandwidth Calculator (#24) — daily use
18. Yealink Phone Control UI (#28) — backend exists
19. Local MOS Estimator (#56) — RTP analyzer exists
20. SIP Health Monitor (#51) — crafter infra exists

### Phase 3 — Competitive Moat
21. RTCP Analysis Dashboard (#11) — RTP infra exists
22. CDR Generator/Analytics (#33) — partial data exists
23. Number Intelligence Lookup (#17)
24. SIP Trunk Capacity Planner (#22)
25. Security Scanner (#18)
26. SRTP Decryption (#21)
27. One-Way Audio Wizard (#42)
28. Call Quality Report Generator (#49)
29. Network Readiness Assessment (#50)
30. Encryption Compliance Report (#45)

### Phase 4 — Platform Features
31. HEP/Homer Integration (#12)
32. SIP Load Tester (#13)
33. WebRTC Stats Viewer (#39)
34. SIP-over-WebSocket Decoder (#40)
35. MIB Browser (#32)
36. PBX Config Auditor (#19)
37. CLI/Scriptable Interface (#53)
38. Webhook/Event System (#37)
39. AI Root-Cause Suggestions (#55)
40. Audio Quality Analyzer (#57)

---

## Competitive Positioning Summary

**What makes SIPalyzer unique (based on research):**

1. **Desktop-first, offline-capable** — VoIPmonitor, Homer, SIP3 are all server/cloud. SIPalyzer works air-gapped.
2. **All-in-one toolkit** — Competitors specialize (sngrep = capture, SIPVicious = security, Homer = HEP, TransNexus = STIR/SHAKEN). SIPalyzer integrates everything.
3. **Integrated softphone + analysis** — No competitor has a built-in SIP phone alongside capture/analysis.
4. **Device provisioning + analysis** — Yealink YDMP is vendor-locked. SIPalyzer does provisioning AND packet analysis.
5. **Fax + SIP + RTP** — T.38 fax center alongside SIP analysis is unique.
6. **Remote agent architecture** — Built-in remote capture agent (Go binary) is a differentiator vs. sngrep/Wireshark.

**Gaps vs. competitors to close:**
- VoIPmonitor: AI transcription, OLAP analytics, recording → CDR Generator + Audio Analyzer address this
- Homer: HEP/EEP → HEP Integration addresses this
- SIPVicious: Security scanning → Security Scanner addresses this
- TransNexus: STIR/SHAKEN → Attestation Checker addresses this
- testRTC: WebRTC diagnostics → WebRTC Stats Viewer addresses this

---

## Total Count

- **Original list items (refined):** 35
- **New items from research:** 25
- **Grand total:** 60 tool ideas

