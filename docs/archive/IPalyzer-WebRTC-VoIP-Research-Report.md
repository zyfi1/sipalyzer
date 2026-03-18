# SIPalyzer: WebRTC Diagnostics & Modern VoIP Analysis — Research Report

Research on WebRTC diagnostics, SIP–WebRTC interworking, modern protocol analysis, AI/ML in VoIP, and cloud-native tools to identify tool features, capabilities, and **market gaps** a desktop SIP analysis product (SIPalyzer) could fill.  
*(Note: The 35-item roadmap was not found in the workspace; share it to map this report explicitly to “features NOT already on the roadmap.”)*

---

## 1. WebRTC Diagnostics Tools and Features

### 1.1 Current Tool Landscape (2025–2026)

**Browser extensions & built-ins**

- **WebRTC Lens** ([WebRTC Lens | WebRTC for Developers](https://webrtc-developers.com/lens)): Cross-browser (Chrome, Edge, Firefox, Safari) extension with 50+ detection rules for network issues, codec mismatches, bandwidth problems; real-time call quality and performance; usable in development and field diagnostics.
- **Firefox about:webrtc** ([Debugging with about:webrtc in Firefox](https://blog.mozilla.org/webrtc/debugging-with-aboutwebrtc-in-firefox-getting-data-out/)): Inspects RTCPeerConnection stats, connection logs, media context; supports copying stats reports and history for bug reports.
- **Chrome chrome://webrtc-internals**: Native ICE/stats view; data lost when tab/connection closes and must be opened before the call ([rtcStats – webrtc-internals improvement](https://www.rtcstats.com/blog/can-webrtc-internals-be-improved-upon)).

**Cloud / SaaS**

- **rtcStats** ([rtcStats – troubleshoot and debug WebRTC](https://rtcstats.com/)): Turns raw WebRTC metrics into insights; open-source client SDK; automatic collection without keeping the tab open; better handling of closed connections and history; free tier and paid API ([rtcStats – webrtc-internals improvement](https://www.rtcstats.com/blog/can-webrtc-internals-be-improved-upon)).
- **qualityRTC** ([qualityRTC: WebRTC network testing and diagnosis](https://network-test.testrtc.com/)): WebRTC network testing and diagnosis.
- **watchRTC (testRTC/Cyara)** ([How can watchRTC improve your WebRTC service operations?](https://testrtc.com/how-can-watchrtc-improve-your-webrtc-service-operations/)): Passive monitoring; collects getStats-style telemetry from real users; watchRTC Live for real-time analysis; dashboards; custom keys, events, webhooks, stream mapping, proxy support ([Integration with watchRTC – testRTC](https://support.testrtc.com/hc/en-us/sections/8428298192015-Integration-with-watchRTC)); widgets for Call Quality, Video P2P, Video Bandwidth, TURN Connectivity, Throughput, Device State, DNS Lookup ([Widgets Library – testRTC](https://support.testrtc.com/hc/en-us/sections/8428284062351-Widgets-Library)).

**Specialized debugging**

- **video_replay** ([Capture & Replay WebRTC video streams – video_replay 2025](https://webrtchacks.com/capture-and-replay-streams-with-video-replay/)): libWebRTC tool to capture/replay video for media debugging; 2025 update adds pcap from Chrome and RtpDump for unencrypted RTP.
- **WebRTC Externals** ([WebRTC Externals – cross-browser WebRTC debug extension](https://webrtchacks.com/webrtc-externals/)): Cross-browser extension; ICE inspection, API call tracking, stats visualization.

### 1.2 ICE Candidate Debugging

- **Trickle ICE** ([Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)): Official sample; tests ICE with STUN/TURN; shows candidates in real time; checks srflx/relay.
- **ICE Server Tester** ([ICE Server Tester](https://icetester.org/?lang=en)): Batch STUN/TURN/TURNS tests; real-time candidate view; UDP/TCP/TLS; test history in local storage.
- **Mozilla Media Panel** ([New Tool for Debugging WebRTC](https://blog.mozilla.org/webrtc/new-tool-debugging-webrtc/)): RTP/RTCP bytes, API calls with args, ICE candidates with traffic stats, raw SDP.

### 1.3 WebRTC Stats API Visualization

- **getStats / RTCStatsReport** ([RTCStatsReport - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsReport)): Map-like structure; iteration (forEach, entries, keys, values) for aggregation.
- watchRTC and rtcStats both consume getStats and provide dashboards and deductions; rtcStats emphasizes organization and retention vs. raw webrtc-internals ([Everything you wanted to know about webrtc-internals and getStats](https://bloggeek.me/webrtc-internals/)).

### 1.4 testRTC / Location Insights / “Odin”

- **testRTC**: Global data centers and on-prem probes; network profiles (WiFi, 3G, 4G, ADSL) with adjustable loss; firewall options (block UDP, force TURN, port 443); scripting (e.g. `.rtcSetNetworkProfile()`); PSTN/SIP ↔ WebRTC support ([How to test network behavior in testRTC?](https://testrtc.com/how-to-test-network-behavior-in-testrtc/), [Global Monitoring](https://testrtc.com/global-monitoring/)).
- **“Odin”** in the WebRTC product sense did not clearly match one product; Oracle WebRTC Session Controller and separate Odin plugins (e.g. [Odin Plugins – gateway log, RPC monitor](https://github.com/tal-tech/odinPlugin)) appear as different solutions.

### 1.5 webrtc-internals Limitations (that alternatives address)

From [rtcStats – webrtc-internals improvement](https://www.rtcstats.com/blog/can-webrtc-internals-be-improved-upon): information overload, data loss on connection close, limited history, must be opened before the call, developer-only UX.

### 1.6 Gaps SIPalyzer Could Fill (desktop SIP focus)

- **Desktop-native WebRTC + SIP in one place**: Most WebRTC tooling is browser/cloud; few desktop tools combine SIP capture (e.g. pcap/sniffer) with WebRTC stats/ICE in a single analyst workflow.
- **ICE/STUN/TURN visualization from packet capture**: Tools like Trickle ICE and ICE Server Tester are live-only; a desktop analyzer could correlate ICE from pcap (STUN binding requests/responses, TURN allocate) with SIP/SDP and WebRTC stats.
- **Offline getStats + pcap correlation**: Accept exported getStats (or webrtc-internals dumps) and align them with pcap by time/call-id for post-mortem without cloud.
- **Persistent, open-ended history**: Unlike webrtc-internals, store and search WebRTC-related events and stats locally with no tab/session limit.

---

## 2. SIP-to-WebRTC Gateway Diagnostics

### 2.1 Typical Failure Modes and Triage

- **One-way audio** is a dominant issue when crossing SIP–WebRTC ([Fixing One-Way Audio in SIP–WebRTC Calls (Fast Guide)](https://medium.com/@justin.edgewoods/fixing-one-way-audio-in-sip-webrtc-calls-fast-guide-5b8de308bc24)): PBX direct media exposing private IPs, codec/SRTP mismatch, firewall/NAT, wrong SDP/ICE candidates.
- **Suggested 10-minute triage**: Export browser getStats + PBX SIP/SDP traces; confirm ICE and SRTP flow; add TURN for symmetric NAT/CGNAT; open firewall for SRTP/DTLS; lock codecs (e.g. Opus), require SRTP on WebRTC; disable PBX direct media; ICE restart with public STUN; verify capture permissions and loopback.

### 2.2 Tools Used at the Boundary

- **SIPCAPTURE/HOMER** ([SIPCAPTURE VoIP & RTC Analyzer](https://sipcapture.org/), [HEPIC](https://sipcapture.org/hepic/)): SIP signaling, RTCP, WebRTC signaling, logs; HEP/EEP; Asterisk, Kamailio, OpenSIPS, FreeSWITCH, RTPEngine.
- **SIP trace logs** ([Viewing SIP Trace Logs - SIPERB WebRTC Softphone](https://siperb.com/kb/article/viewing-sip-trace-logs)): Full inbound/outbound SIP with headers/body for setup and message-level debug.
- **WebRTC–SIP proxies** (e.g. Siperb): Anchor RTP at the gateway to avoid direct media and topology exposure ([Fixing One-Way Audio in SIP–WebRTC Calls](https://medium.com/@justin.edgewoods/fixing-one-way-audio-in-sip-webrtc-calls-fast-guide-5b8de308bc24)).

### 2.3 Oracle WebRTC Session Controller

- Signaling engine (SIP, WebSocket, timeouts), logging for SIP, HTTP/WebSocket, Diameter, JSON, media; troubleshooting and session/glare handling ([Oracle Communications WebRTC Session Controller System Administrator's Guide](https://docs.oracle.com/cd/E69505_01/doc.72/e69506.pdf), [Configuring Signaling Properties and Media Nodes](https://docs.oracle.com/cd/E55119_01/doc.71/e55122/wsc_signaling.htm)).

### 2.4 How Engineers Actually Debug SIP→WebRTC

- Combine **browser getStats + PBX/SBC SIP traces**; check **ICE state and SRTP flow**; use **TURN and firewall/codec/SDP fixes**; use **HOMER/HEP** where available for unified capture; use **SIP ladder + RTP/RTCP** in tools like VoIPmonitor and HOMER.

### 2.5 Gaps SIPalyzer Could Fill

- **Unified SIP + WebRTC timeline**: Single desktop view showing SIP dialogs (INVITE, re-INVITE, 200 OK, SDP) and WebRTC events (ICE, DTLS, getStats) on one timeline with a shared call/session id.
- **Gateway-centric view**: Tag which leg is “SIP” vs “WebRTC” and show codec/SRTP/ICE per leg; highlight mismatches (e.g. Opus on one leg, G.711 on the other).
- **One-way audio checklist**: Guided checklist driven by the trace (direct media, codecs, NAT/firewall hints) with references to the exact messages/frames.

---

## 3. Modern Protocol Analysis

### 3.1 SIP over WebSocket (WSS)

- **SIP Inspector Pro** ([SIP Inspector Pro](https://www.sipinspector.com/)): SIP analysis with WebSocket and WSS; UDP/TCP/TLS; multiple calls/dialogs; interoperability and stress/load testing; live audio, digit injection, IPv4/IPv6.
- **WSSiP** ([WSSiP: A Websocket Manipulation Proxy | NCC Group](https://www.nccgroup.com/us/research-blog/wssip-a-websocket-manipulation-proxy/)): Intercept and manipulate WebSocket messages (ASCII/binary); useful for WSS debugging.
- **JsSIP** ([JsSIP - the Javascript SIP library](https://jssip.net/)): SIP over WebSocket (RFC 7118); WebRTC media; works with Asterisk, Kamailio, OverSIP.
- **OpenSIPS**: WebSocket and WSS; browser and classic clients; often with RTPengine ([openSIPS WebSocket Tutorial](https://www.opensips.org/Documentation/Tutorials-WebSocket-2-2)).

### 3.2 ODIN / SIP Monitoring (Telco)

- **Odine Orion™** ([Odine Orion™](https://odine.com/solutions/orion/)): Cloud voice management: routing, rating, real-time reporting, analytics for wholesale voice.
- **TeraQuant / Oracle (OCOM)** ([SIP Monitoring VoIP For Telco CSPs](https://teraquant.com/solutions/voip-sip-monitoring/sip-monitoring-csp/)): SIP monitoring for CSPs; cost reduction, fraud prevention; CDR, SLA/KPI, encrypted VoIP monitoring.
- **VoIPmonitor** ([VoIPmonitor® | VoIP & SIP Monitoring & Call Recording](https://www.voipmonitor.org/)): SIP and WebRTC; MOS, jitter, loss; ladder diagrams; TLS/SRTP decryption; 100k+ concurrent calls; TAP or SBC duplication.

### 3.3 HTTP/2 and gRPC in Telecom

- **gRPC over HTTP/2** ([gRPC on HTTP/2](https://grpc.io/blog/grpc-on-http2/)): Channels, streams, multiplexing, connection management; suitable for internal signaling and control planes, not yet standard for classic SIP user-plane.
- Use in telecom is mostly **internal APIs and control**, not replacing SIP at the edge in mainstream tools yet.

### 3.4 Gaps SIPalyzer Could Fill

- **SIP over WebSocket in a desktop analyzer**: Decode WSS and extract SIP from WebSocket frames; ladder diagram and filtering same as for UDP/TCP SIP (SIP Inspector Pro is a separate product; a desktop “all transports” analyzer is a gap).
- **WSS + RTP/RTCP in one session**: Same capture/session showing WSS SIP and RTP/RTCP (and optionally STUN/TURN) for browser-originated calls.
- **gRPC/HTTP2 optional parsing**: If SIPalyzer later targets control-plane or internal APIs, add optional gRPC/HTTP2 parsing alongside SIP.

---

## 4. AI/ML in VoIP Analysis

### 4.1 Quality Prediction and MOS

- **ML for VoIP quality**: Ordinal Logistic Regression (OLR) and other ML used for MOS prediction; OLR reported to outperform tools like VQmon® for wideband codecs ([An Effective ML Approach to Quality Assessment of VoIP Calls](https://ieeexplore.ieee.org/document/9051984/)); MFCCs + multilayer perceptron for QoE ([Quality of Experience Prediction for VoIP Calls Using Audio MFCCs and Multilayer Perceptron](https://ieeexplore.ieee.org/document/9919483)).
- **Lightweight DNN**: e.g. MiniatureVQNet for non-intrusive VoIP speech quality ([MiniatureVQNet](https://www.mdpi.com/2076-3417/13/4/2455)).

### 4.2 Root Cause and Real-Time Categories

- **Clustering of audio metrics** to identify root causes; real-time categories: “good,” “mildly choppy,” “severely choppy,” “no audio,” with solutions applied in-call ([Call Audio Quality Determination and Root Cause Analysis Using Machine Learning](https://www.tdcommons.org/dpubs_series/5772/)).

### 4.3 SIP/RTCP and Standards

- **RFC 6035**: SIP event package for VoIP quality reporting; RTCP-XR and related metrics to quality collectors ([RFC 6035](https://www.rfc-editor.org/info/rfc6035)); aligns with SIP PUBLISH and reporting in solutions like Mitel Performance Analytics ([VQ Reporting Solution Guide](https://www.mitel.com/sites/default/files/s3_imports/Applications/Analytics/Mitel%20Performance%20Analytics/3.4/EN/VQ_Reporting_Solution_Guide.pdf)).

### 4.4 AI Call Quality and Voice Agents (2025)

- **Zoom 2025**: Focus on transcription/caption WER, TTFW, turn latency ([Zoom AI SDK Phone Quality Report 2025](https://www.zoom.com/en/blog/zoom-ai-sdk-phone-quality-report-2025)).
- **100% call audit**: AI monitoring of all calls; transcription, NLP for resolution/sentiment/compliance; reported error and escalation reductions ([AI Call Quality Monitoring: 100% Audit, Zero Effort](https://qcall.ai/ai-call-quality-monitoring)).
- **Multi-layer diagnostics**: Telephony/audio, ASR, LLM, TTS ([Post-Call Analytics for Voice Agents](https://hamming.ai/resources/post-call-analytics-voice-agents-metrics-monitoring)).

### 4.5 Gaps SIPalyzer Could Fill

- **Protocol-level ML for desktop**: Use RTCP-XR, RTCP, and SIP/ SDP from pcap (and optional getStats) to train or run lightweight models (e.g. MOS or “good/choppy/no audio”) **locally** in a desktop tool, without sending audio to the cloud.
- **Root-cause suggestions from trace**: Rule-based or small ML model that suggests causes (NAT, codec mismatch, loss, jitter) from SIP/SDP/RTCP/ICE in the current capture.
- **RFC 6035 / RTCP-XR import**: Ingest quality reports (SIP PUBLISH or files) and correlate with SIP/RTP/RTCP in the same session for a protocol-centric quality view.

---

## 5. Cloud-Native VoIP Tools

### 5.1 Elastic and Auto-Scaling

- **Cloud-native VoIP**: Containerized microservices, auto-scaling, load distribution to handle call surges ([Real Use Cases of Cloud-Native Elastic VoIP Infrastructures](https://www.ecosmob.com/cloud-native-voip-infrastructure-use-cases/)).

### 5.2 Monitoring and Analytics

- **SIP3** ([SIP3 - Monitor your VoIP and RTC traffic real-time](https://sip3.io/)): Real-time dashboards, live call monitoring, OpenAPI; aimed at large VoIP providers.
- **HOMER/SIPCAPTURE** ([SIPCAPTURE](https://sipcapture.org/)): Open-source; call-flow visualization, REST API, HEP; Docker and traditional installs ([Quick Install · sipcapture/homer](https://github.com/sipcapture/homer/wiki/Quick-Install)).
- **Twilio Voice Insights** ([Voice Insights Events and Metrics API | Twilio](https://twilio.com/en-us/changelog/voice-insights-events-and-metrics-api)): Events and metrics API for call quality (jitter, loss, etc.).

### 5.3 Containerized SIP Testing

- **Sipfront** ([Sipfront Documentation](https://sipfront.com/docs/)): SaaS; containerized agents (Docker/Kubernetes); functional and load tests (tens of thousands of concurrent calls); hybrid with local agents ([Hybrid Cloud Testing with Local Sipfront Agents](https://sipfront.com/blog/2021/04/traffic-generation-agents-in-your-own-local-environment)); agent pools use Kamailio, rtpengine, baresip, sipp ([Agent Pools](https://sipfront.com/docs/agent-pools/about/)).
- **Kubernetes**: webrtc2sip and rtpengine have K8s/Docker deployments ([webrtc2sip-kubernetes](https://github.com/mihaliak/webrtc2sip-kubernetes), [rtpengine-k8s-l7mp-test](https://github.com/l7mp/rtpengine-k8s-l7mp-test)).

### 5.4 What Practitioners Value

- Correlating **call quality with network events** and **historical pattern analysis**; reports of fewer disruptions and faster resolution with monitoring ([Voip Call Monitoring Software in 2025 - Callin](https://callin.io/voip-call-monitoring-software/)).

### 5.5 Gaps SIPalyzer Could Fill

- **Desktop-first for on-prem and air-gapped**: Focus on **local pcap and trace analysis** where cloud or HEP is not allowed; no dependency on HEP/cloud for core workflow.
- **K8s/container-aware without being in-cluster**: Import captures or HEP from cluster edge (e.g. from a node or sidecar); display call flows and quality without running SIPalyzer inside Kubernetes.
- **Correlation without SaaS**: Local correlation of quality (RTCP-XR, jitter, loss) with SIP/RTP/ICE in the same UI, without sending data to Twilio/SIP3/watchRTC.

---

## Summary: High-Value Gaps for SIPalyzer

| Area | Gap | Why it matters |
|------|-----|----------------|
| WebRTC | Desktop SIP + WebRTC in one tool (pcap + getStats/ICE) | Engineers today juggle browser tools, cloud, and separate SIP analyzers. |
| WebRTC | ICE/STUN/TURN from pcap with SDP/codec correlation | Debug NAT/relay and one-way audio from a single capture. |
| SIP–WebRTC | Unified SIP + WebRTC timeline and “gateway view” | Faster triage at the boundary; clear SIP vs WebRTC leg view. |
| Protocol | SIP over WebSocket (WSS) decode and ladder in desktop analyzer | Browser and softphone calls are often WSS; few desktop tools do WSS + RTP in one. |
| AI/ML | Local MOS/quality and root-cause hints from RTCP/SIP/SDP | Privacy and offline; no need to send audio to the cloud. |
| Cloud-native | Desktop-first, pcap/HEP-optional, no cloud required | On-prem, air-gapped, and compliance-friendly analysis. |

---

## Sources

- [qualityRTC: WebRTC network testing and diagnosis](https://network-test.testrtc.com/)
- [rtcStats - the easiest way to troubleshoot and debug WebRTC](https://rtcstats.com/)
- [WebRTC Lens | WebRTC for Developers](https://webrtc-developers.com/lens)
- [Capture & Replay WebRTC video streams for debugging – video_replay 2025 update](https://webrtchacks.com/capture-and-replay-streams-with-video-replay/)
- [Debugging with about:webrtc in Firefox](https://blog.mozilla.org/webrtc/debugging-with-aboutwebrtc-in-firefox-getting-data-out/)
- [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
- [ICE Server Tester](https://icetester.org/?lang=en)
- [New Tool for Debugging WebRTC - Mozilla](https://blog.mozilla.org/webrtc/new-tool-debugging-webrtc/)
- [WebRTC Externals – the cross-browser WebRTC debug extension](https://webrtchacks.com/webrtc-externals/)
- [Here's how you can improve upon webrtc-internals by using rtcstats.com](https://www.rtcstats.com/blog/can-webrtc-internals-be-improved-upon)
- [Everything you wanted to know about webrtc-internals and getStats](https://bloggeek.me/webrtc-internals/)
- [@testrtc/watchrtc-sdk](https://www.npmjs.com/package/%40testrtc%2Fwatchrtc-sdk)
- [Widgets Library – testRTC](https://support.testrtc.com/hc/en-us/sections/8428284062351-Widgets-Library)
- [How can watchRTC improve your WebRTC service operations?](https://testrtc.com/how-can-watchrtc-improve-your-webrtc-service-operations/)
- [Integration with watchRTC – testRTC](https://support.testrtc.com/hc/en-us/sections/8428298192015-Integration-with-watchRTC)
- [How to test network behavior in testRTC?](https://testrtc.com/how-to-test-network-behavior-in-testrtc/)
- [Global Monitoring – testRTC](https://testrtc.com/global-monitoring/)
- [GitHub - tal-tech/odinPlugin](https://github.com/tal-tech/odinPlugin)
- [Oracle Communications WebRTC Session Controller System Administrator's Guide](https://docs.oracle.com/cd/E69505_01/doc.72/e69506.pdf)
- [Configuring WebRTC Session Controller Signaling Properties and Media Nodes](https://docs.oracle.com/cd/E55119_01/doc.71/e55122/wsc_signaling.htm)
- [VoIPmonitor® | VoIP & SIP Monitoring & Call Recording](https://www.voipmonitor.org/)
- [Fixing One-Way Audio in SIP–WebRTC Calls (Fast Guide)](https://medium.com/@justin.edgewoods/fixing-one-way-audio-in-sip-webrtc-calls-fast-guide-5b8de308bc24)
- [SIPCAPTURE VoIP & RTC Analyzer](https://sipcapture.org/)
- [SIPCAPTURE HEPIC](https://sipcapture.org/hepic/)
- [Viewing SIP Trace Logs - SIPERB WebRTC Softphone](https://siperb.com/kb/article/viewing-sip-trace-logs)
- [SIP Inspector Pro](https://www.sipinspector.com/)
- [WSSiP: A Websocket Manipulation Proxy | NCC Group](https://www.nccgroup.com/us/research-blog/wssip-a-websocket-manipulation-proxy/)
- [JsSIP - the Javascript SIP library](https://jssip.net/)
- [openSIPS | Documentation / Tutorials-WebSocket-2-2](https://www.opensips.org/Documentation/Tutorials-WebSocket-2-2)
- [Odine Orion™](https://odine.com/solutions/orion/)
- [SIP Monitoring VoIP For Telco CSPs](https://teraquant.com/solutions/voip-sip-monitoring/sip-monitoring-csp/)
- [gRPC on HTTP/2 Engineering](https://grpc.io/blog/grpc-on-http2/)
- [An Effective Machine Learning (ML) Approach to Quality Assessment of Voice Over IP (VoIP) Calls](https://ieeexplore.ieee.org/document/9051984/)
- [Quality of Experience Prediction for VoIP Calls Using Audio MFCCs and Multilayer Perceptron](https://ieeexplore.ieee.org/document/9919483/)
- [MiniatureVQNet: A Light-Weight Deep Neural Network for Non-Intrusive Evaluation of VoIP Speech Quality](https://www.mdpi.com/2076-3417/13/4/2455)
- [Call Audio Quality Determination and Root Cause Analysis Using Machine Learning](https://www.tdcommons.org/dpubs_series/5772/)
- [RFC 6035 - SIP Event Package for Voice Quality Reporting](https://www.rfc-editor.org/info/rfc6035)
- [Zoom AI SDK Phone Quality Report 2025](https://www.zoom.com/en/blog/zoom-ai-sdk-phone-quality-report-2025/)
- [AI Call Quality Monitoring: 100% Audit, Zero Effort](https://qcall.ai/ai-call-quality-monitoring)
- [Post-Call Analytics for Voice Agents: Metrics and Monitoring | Hamming AI](https://hamming.ai/resources/post-call-analytics-voice-agents-metrics-monitoring)
- [Real Use Cases of Cloud-Native Elastic VoIP Infrastructures](https://www.ecosmob.com/cloud-native-voip-infrastructure-use-cases/)
- [SIP3 - Monitor your VoIP and RTC traffic real-time](https://sip3.io/)
- [Quick Install · sipcapture/homer Wiki · GitHub](https://github.com/sipcapture/homer/wiki/Quick-Install)
- [Voice Insights Events and Metrics API | Twilio](https://twilio.com/en-us/changelog/voice-insights-events-and-metrics-api)
- [Voip Call Monitoring Software in 2025 - Callin](https://callin.io/voip-call-monitoring-software/)
- [webrtc2sip-kubernetes](https://github.com/mihaliak/webrtc2sip-kubernetes)
- [rtpengine-k8s-l7mp-test](https://github.com/l7mp/rtpengine-k8s-l7mp-test)
- [Sipfront Documentation](https://sipfront.com/docs/)
- [Hybrid Cloud Testing with Local Sipfront Agents](https://sipfront.com/blog/2021/04/traffic-generation-agents-in-your-own-local-environment)
- [Agent Pools – Sipfront](https://sipfront.com/docs/agent-pools/about/)
- [SIP Workbench: SIP protocol analyzer](http://sipworkbench.com/)
- [sngrep: Capture and Analyse SIP Packets](https://docs.tegsoft.com/docs/sngrep)
- [RTCStatsReport - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsReport)
