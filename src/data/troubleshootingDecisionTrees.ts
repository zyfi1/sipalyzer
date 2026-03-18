/**
 * Interactive Troubleshooting Decision Trees.
 *
 * Each tree guides the user through a series of questions to diagnose
 * a specific VoIP/SIP/RTP/T.38 issue. Terminal nodes link to KB articles.
 *
 * All branching logic and diagnostic steps sourced from:
 * - Cisco VoIP Troubleshooting Guides
 * - RFC 3261, 3263, 3264, 4028
 * - pbxmechanic.com, onsip.com, voip-info.org, Sansay TAC
 */

import type { TsDecisionTree } from "@/types/troubleshootingEngine";

export const DECISION_TREES: TsDecisionTree[] = [

  // ═══════════════════════════════════════════════════════════════
  // 1. NO AUDIO
  // ═══════════════════════════════════════════════════════════════

  {
    id: "dt-no-audio",
    title: "No Audio / One-Way Audio",
    domain: "rtp",
    description: "Diagnose calls that connect but have missing audio in one or both directions.",
    startNodeId: "start",
    nodes: [
      { id: "start", type: "question", text: "Is audio missing in both directions or only one?", options: [
        { label: "Both directions (complete silence)", nextNodeId: "both-silent" },
        { label: "One direction only (one-way audio)", nextNodeId: "one-way" },
      ]},

      { id: "both-silent", type: "question", text: "Does the SDP in the INVITE/200 OK show a valid IP address in the c= line?", detail: "Capture the SIP exchange and check: c=IN IP4 <address>. If it shows 0.0.0.0 or a private IP, that's the problem.", options: [
        { label: "Shows 0.0.0.0", nextNodeId: "sdp-zero" },
        { label: "Shows a private IP (10.x, 192.168.x, 172.16-31.x)", nextNodeId: "sdp-private" },
        { label: "Shows a valid public IP", nextNodeId: "both-valid-ip" },
      ]},

      { id: "sdp-zero", type: "result", text: "SDP contains 0.0.0.0 — media stream is effectively disabled.", detail: "c=IN IP4 0.0.0.0 is a legacy hold indicator (RFC 3264 Section 8.4; modern hold uses a=sendonly/a=inactive per RFC 8866). If unintentional, the SIP client failed to determine its IP address. Set the external/public IP manually in your client settings, or configure your provider's outbound proxy.", articleId: "no-audio" },

      { id: "sdp-private", type: "result", text: "Private IP in SDP — NAT issue. Remote endpoint can't reach your LAN address.", detail: "Use your provider's outbound proxy (most handle NAT automatically), or set your public IP as the external address in your client/PBX. Also check if SIP ALG is enabled on your router and disable it.", articleId: "one-way-audio" },

      { id: "both-valid-ip", type: "question", text: "Are RTP packets being sent by both sides? (Check with Packet Capture)", options: [
        { label: "Neither side sends RTP", nextNodeId: "no-rtp-sent" },
        { label: "Both send but not received", nextNodeId: "rtp-blocked" },
        { label: "RTP is flowing in both directions", nextNodeId: "rtp-flowing-no-audio" },
      ]},

      { id: "no-rtp-sent", type: "result", text: "No RTP sent — check the SDP media negotiation.", detail: "Verify the m=audio line has a non-zero port and the codec was successfully negotiated. Check for m=audio 0 which means media was rejected.", articleId: "no-audio" },

      { id: "rtp-blocked", type: "result", text: "RTP is sent but not received — firewall blocking the media path.", detail: "Open UDP ports 10000-20000 (or your configured RTP range) bidirectionally. Check for stateful firewall dropping UDP return traffic.", articleId: "firewall-port-requirements" },

      { id: "rtp-flowing-no-audio", type: "result", text: "RTP flows in both directions but no audio — likely a codec or audio device issue.", detail: "Check if the correct codec is being decoded. Verify audio input/output devices are working. Check volume/mute settings.", articleId: "codec-negotiation-failures" },

      { id: "one-way", type: "question", text: "Which direction has audio?", options: [
        { label: "Caller hears callee, but callee can't hear caller", nextNodeId: "caller-to-callee-only" },
        { label: "Callee hears caller, but caller can't hear callee", nextNodeId: "callee-to-caller-only" },
      ]},

      { id: "caller-to-callee-only", type: "question", text: "Is SIP ALG enabled on the caller's router?", options: [
        { label: "Yes / Not sure", nextNodeId: "disable-alg-caller" },
        { label: "No, SIP ALG is disabled", nextNodeId: "check-nat-caller" },
      ]},

      { id: "disable-alg-caller", type: "result", text: "Disable SIP ALG on the caller's router — this is the #1 cause of one-way audio.", detail: "SIP ALG rewrites SDP and Contact headers, causing RTP to be sent to the wrong address. Disable it and retest.", articleId: "sip-alg-problems" },

      { id: "check-nat-caller", type: "result", text: "Check NAT/firewall on the caller's side — inbound RTP may be blocked.", detail: "The caller's firewall may allow outbound RTP but block inbound. Enable UDP connection tracking or open the RTP port range bidirectionally.", articleId: "one-way-audio" },

      { id: "callee-to-caller-only", type: "question", text: "Is SIP ALG enabled on the callee's router?", options: [
        { label: "Yes / Not sure", nextNodeId: "disable-alg-callee" },
        { label: "No, SIP ALG is disabled", nextNodeId: "check-nat-callee" },
      ]},

      { id: "disable-alg-callee", type: "result", text: "Disable SIP ALG on the callee's router.", detail: "Same cause as the caller side — SIP ALG is rewriting headers on the callee's end. Disable it and retest.", articleId: "sip-alg-problems" },

      { id: "check-nat-callee", type: "result", text: "Check NAT/firewall on the callee's side — inbound RTP may be blocked.", detail: "Open firewall for bidirectional RTP (UDP 10000-20000). If behind NAT, use the provider's outbound proxy or set the external/public IP manually.", articleId: "one-way-audio" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 2. REGISTRATION FAILURE
  // ═══════════════════════════════════════════════════════════════

  {
    id: "dt-registration-failure",
    title: "Registration Failure",
    domain: "sip",
    description: "Diagnose SIP registration failures by response code and symptoms.",
    startNodeId: "start",
    nodes: [
      { id: "start", type: "question", text: "What response do you see to the REGISTER request?", options: [
        { label: "401 Unauthorized", nextNodeId: "q-401" },
        { label: "403 Forbidden", nextNodeId: "q-403" },
        { label: "407 Proxy Auth Required", nextNodeId: "q-407" },
        { label: "408 Timeout / No response", nextNodeId: "q-408" },
        { label: "423 Interval Too Brief", nextNodeId: "q-423" },
        { label: "Other error or unknown", nextNodeId: "q-other" },
      ]},

      { id: "q-401", type: "question", text: "Is this the first 401 (challenge) or a repeated 401 after sending credentials?", detail: "A single 401 is normal — it's the digest authentication challenge. Repeated 401s mean authentication is failing.", options: [
        { label: "First 401 only (then 200 OK)", nextNodeId: "r-401-normal" },
        { label: "Repeated 401 loop", nextNodeId: "r-401-loop" },
      ]},

      { id: "r-401-normal", type: "result", text: "This is normal SIP digest authentication — no issue.", detail: "REGISTER → 401 (challenge) → REGISTER (with credentials) → 200 OK is the normal flow.", articleId: "digest-auth-deep-dive" },

      { id: "r-401-loop", type: "result", text: "Authentication credentials are wrong — check username, password, and realm.", detail: "Verify: (1) username matches what the provider expects (auth username may differ from SIP username), (2) password is correct, (3) realm matches the WWW-Authenticate challenge.", articleId: "reg-401-unauthorized" },

      { id: "q-403", type: "result", text: "403 Forbidden — your IP may not be whitelisted, or the account is blocked.", detail: "Check: (1) IP whitelisting with your provider, (2) account status (not disabled/locked), (3) SIP domain in From header matches provider requirements.", articleId: "reg-403-forbidden" },

      { id: "q-407", type: "result", text: "407 Proxy Authentication Required — configure proxy credentials.", detail: "Proxy authentication is separate from registrar authentication. Check Proxy-Authenticate header for required credentials.", articleId: "reg-407-proxy-auth" },

      { id: "q-408", type: "question", text: "Can you ping the SIP server IP?", options: [
        { label: "Yes, ping works", nextNodeId: "q-408-ping-ok" },
        { label: "No, ping fails", nextNodeId: "r-408-unreachable" },
      ]},

      { id: "q-408-ping-ok", type: "question", text: "Is port 5060 (or 5061 for TLS) open on the server?", options: [
        { label: "Yes, port is open", nextNodeId: "r-408-dns" },
        { label: "No, port is closed", nextNodeId: "r-408-port" },
        { label: "Not sure", nextNodeId: "a-408-port-scan" },
      ]},

      { id: "a-408-port-scan", type: "action", text: "Run a port scan to check if SIP ports are open.", toolLink: { toolId: "network", subviewId: "connectivity", label: "Port Scan" }, options: [
        { label: "Port is open", nextNodeId: "r-408-dns" },
        { label: "Port is closed", nextNodeId: "r-408-port" },
      ]},

      { id: "r-408-unreachable", type: "result", text: "Server is unreachable — check routing, ISP, and firewall.", detail: "The SIP server IP cannot be reached. Check for network outages, ISP issues, or firewall rules blocking outbound traffic.", articleId: "sip-408-timeout" },

      { id: "r-408-port", type: "result", text: "SIP port is closed — server may be down or firewall is blocking.", detail: "Port 5060 (UDP/TCP) or 5061 (TLS) is not responding. Check if the server is running, and if firewalls allow SIP traffic.", articleId: "firewall-port-requirements" },

      { id: "r-408-dns", type: "result", text: "Server is reachable but not responding to SIP — check DNS resolution and transport.", detail: "DNS may resolve to the wrong IP. Try using the IP directly. Also try TCP transport if UDP is being filtered.", articleId: "dns-srv-naptr-failures" },

      { id: "q-423", type: "result", text: "423 Interval Too Brief — increase the Expires value.", detail: "Check the Min-Expires header in the 423 response. Set your Expires to at least that value.", articleId: "reg-expiry-keepalive" },

      { id: "q-other", type: "action", text: "Capture the REGISTER exchange with Packet Monitor and examine the exact response code.", detail: "Use SIPalyzer's Packet Capture to see the full SIP exchange. The response code will indicate the specific issue.", toolLink: { toolId: "packet-capture", subviewId: "viewer", label: "Capture SIP Traffic" }, options: [
        { label: "I found the response code", nextNodeId: "start" },
      ]},
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 3. CALL DROPS
  // ═══════════════════════════════════════════════════════════════

  {
    id: "dt-call-drops",
    title: "Call Drops",
    domain: "sip",
    description: "Diagnose calls that connect but then disconnect unexpectedly.",
    startNodeId: "start",
    nodes: [
      { id: "start", type: "question", text: "When does the call drop?", options: [
        { label: "Exactly at ~30-32 seconds", nextNodeId: "q-30s" },
        { label: "At a regular interval (e.g., every 30 min, 1 hour)", nextNodeId: "q-session-timer" },
        { label: "Randomly / at irregular times", nextNodeId: "q-random" },
        { label: "Immediately after answer (< 5 seconds)", nextNodeId: "q-immediate" },
      ]},

      { id: "q-30s", type: "result", text: "Call drops at 30 seconds — ACK not received by the server.", detail: "After 200 OK, the server expects an ACK within 32 seconds (Timer H = 64×T1). If the ACK is blocked by NAT or SIP ALG, the server retransmits 200 OK then terminates. Disable SIP ALG and check NAT/firewall.", articleId: "call-drops-30-seconds" },

      { id: "q-session-timer", type: "question", text: "Check the INVITE/200 OK for a Session-Expires header. Is it present?", options: [
        { label: "Yes, and the interval matches when the call drops", nextNodeId: "r-session-timer" },
        { label: "No Session-Expires header found", nextNodeId: "q-random" },
      ]},

      { id: "r-session-timer", type: "result", text: "Session timer expiry — the designated refresher is not sending re-INVITE/UPDATE before the timer expires.", detail: "Check which side is the refresher (uac or uas parameter in Session-Expires). Ensure it sends a re-INVITE or UPDATE at ~50% of the interval.", articleId: "session-timer-expiry" },

      { id: "q-random", type: "question", text: "What causes the disconnect? (Check Packet Capture for the final SIP message)", options: [
        { label: "BYE from the server / far end", nextNodeId: "r-bye-server" },
        { label: "BYE from local side", nextNodeId: "r-bye-local" },
        { label: "481 response to mid-call request", nextNodeId: "r-481" },
        { label: "No SIP message — just stops", nextNodeId: "r-network-drop" },
      ]},

      { id: "r-bye-server", type: "result", text: "Server sent BYE — check server-side call limits, billing, or routing policies.", detail: "The server intentionally ended the call. Check for: call duration limits, billing/credit exhaustion, or administrative policies.", articleId: "session-timer-expiry" },

      { id: "r-bye-local", type: "result", text: "Local side sent BYE — check for accidental hangup, UI issue, or client bug.", detail: "Your SIP client sent the BYE. Check for: timeout settings, error handling that triggers hangup, or user interface issues." },

      { id: "r-481", type: "result", text: "481 Call Does Not Exist — the server lost the dialog state.", detail: "The server may have been restarted, or NAT/SIP ALG is rewriting dialog identifiers (Call-ID, tags).", articleId: "sip-481-does-not-exist" },

      { id: "r-network-drop", type: "result", text: "No SIP termination message — likely a network interruption.", detail: "The TCP/UDP connection was lost without a proper SIP BYE. Check for network outages, WiFi disconnections, or NAT binding expiry.", articleId: "sip-408-timeout" },

      { id: "q-immediate", type: "question", text: "Is there a SIP error response before the disconnect?", options: [
        { label: "488 Not Acceptable Here", nextNodeId: "r-488" },
        { label: "403 Forbidden", nextNodeId: "r-forbidden" },
        { label: "603 Decline or 486 Busy-style rejection", nextNodeId: "r-declined" },
        { label: "200 OK received then BYE immediately", nextNodeId: "r-immediate-bye" },
      ]},

      { id: "r-488", type: "result", text: "488 — Codec or media negotiation failed.", detail: "The SDP offer was rejected. Check for common codecs between endpoints.", articleId: "sip-488-not-acceptable" },

      { id: "r-forbidden", type: "result", text: "403 Forbidden — server-side policy rejected the call.", detail: "403 is policy/authz related (ACL, account policy, outbound route restrictions, caller-ID policy). Verify trunk policy and account permissions.", articleId: "reg-403-forbidden" },

      { id: "r-declined", type: "result", text: "Call was declined/busy at the destination side.", detail: "603 Decline means the user intentionally rejected or DND/auto-reject logic handled the call. Troubleshoot as a user-availability flow (similar to 486/600 busy handling).", articleId: "sip-486-busy" },

      { id: "r-immediate-bye", type: "result", text: "Call answered then immediately terminated — check for billing issues, routing loops, or media failures.", detail: "Some systems answer then hang up when they detect a problem (no media, wrong codec, etc.). Check the BYE's Reason header for details." },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 4. POOR AUDIO QUALITY
  // ═══════════════════════════════════════════════════════════════

  {
    id: "dt-poor-quality",
    title: "Poor Audio Quality",
    domain: "rtp",
    description: "Diagnose choppy, garbled, echoing, or delayed audio during calls.",
    startNodeId: "start",
    nodes: [
      { id: "start", type: "question", text: "What type of audio problem are you experiencing?", options: [
        { label: "Choppy / words cut off", nextNodeId: "q-choppy" },
        { label: "Robotic / garbled / distorted", nextNodeId: "q-robotic" },
        { label: "Echo", nextNodeId: "r-echo" },
        { label: "Delayed (conversation overlap)", nextNodeId: "q-delay" },
        { label: "Static / noise", nextNodeId: "q-static" },
      ]},

      { id: "q-choppy", type: "question", text: "Check RTP statistics — is packet loss above 1%?", options: [
        { label: "Yes, loss > 1%", nextNodeId: "r-packet-loss" },
        { label: "No, loss is low", nextNodeId: "q-choppy-jitter" },
      ]},

      { id: "r-packet-loss", type: "result", text: "Packet loss is causing choppy audio.", detail: "Above 1% loss degrades voice quality. Above 3% is clearly noticeable. Enable QoS, switch to wired ethernet, and investigate the network path with traceroute.", articleId: "packet-loss-impact" },

      { id: "q-choppy-jitter", type: "question", text: "Is jitter above 30ms?", options: [
        { label: "Yes, jitter > 30ms", nextNodeId: "r-high-jitter" },
        { label: "No, jitter is normal", nextNodeId: "r-choppy-other" },
      ]},

      { id: "r-high-jitter", type: "result", text: "High jitter is causing choppy audio.", detail: "Jitter above 30ms causes packets to arrive too late for the jitter buffer, resulting in effective packet loss. Enable QoS, use wired ethernet, and increase jitter buffer size.", articleId: "high-jitter" },

      { id: "r-choppy-other", type: "result", text: "Low loss and jitter but still choppy — check for CPU overload, codec issues, or device problems.", detail: "The network may be fine but the endpoint is struggling. Check CPU usage, try a different codec, and ensure audio drivers are up to date.", articleId: "poor-mos-score" },

      { id: "q-robotic", type: "result", text: "Robotic/garbled audio — usually caused by packet loss combined with codec artifacts.", detail: "Lower-bitrate codecs (G.729) produce robotic sounds under packet loss. Try G.711 for more graceful degradation, or use G.722 for wideband quality.", articleId: "codec-negotiation-failures" },

      { id: "r-echo", type: "result", text: "Echo — typically caused by acoustic feedback from the remote endpoint's speaker/microphone.", detail: "Echo is usually a hardware issue on the remote side, not a network issue. The remote endpoint should enable echo cancellation. High latency makes echo more noticeable (echo perceived with delay > 25ms round trip). Reduce network latency to minimize perceived echo.", articleId: "poor-mos-score" },

      { id: "q-delay", type: "question", text: "What is the one-way latency to the SIP server?", options: [
        { label: "Below 150ms", nextNodeId: "r-delay-normal" },
        { label: "150-300ms", nextNodeId: "r-delay-moderate" },
        { label: "Above 300ms", nextNodeId: "r-delay-high" },
      ]},

      { id: "r-delay-normal", type: "result", text: "Latency is within ITU-T G.114 recommendation (< 150ms one-way).", detail: "The delay should not be noticeable. If conversation overlap still occurs, the issue may be on the far end of the call.", articleId: "poor-mos-score" },

      { id: "r-delay-moderate", type: "result", text: "Moderate latency (150-300ms) — noticeable delay, possible conversation overlap.", detail: "This exceeds the ITU-T G.114 recommendation. Check for: geographic distance, routing inefficiency, or QoS issues adding delay.", articleId: "poor-mos-score" },

      { id: "r-delay-high", type: "result", text: "High latency (> 300ms) — severe conversation difficulty.", detail: "At this delay, normal conversation is very difficult. Check: routing path (traceroute), if a media relay is adding extra hops, or if the ISP has high-latency routing.", articleId: "poor-mos-score" },

      { id: "q-static", type: "result", text: "Static or noise — usually a hardware or codec issue, not network-related.", detail: "Check: (1) headset/microphone connections, (2) electrical interference near audio equipment, (3) if using analog phone lines, check for crosstalk. For digital calls, try switching codecs." },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 5. FAX FAILURE
  // ═══════════════════════════════════════════════════════════════

  {
    id: "dt-fax-failure",
    title: "Fax Failure",
    domain: "t38",
    description: "Diagnose fax transmission failures over SIP/T.38.",
    startNodeId: "start",
    nodes: [
      { id: "start", type: "question", text: "What type of fax failure?", options: [
        { label: "Complete failure — no pages received", nextNodeId: "q-complete" },
        { label: "Partial — some pages missing or corrupted", nextNodeId: "q-partial" },
        { label: "Works one direction but not the other", nextNodeId: "q-direction" },
        { label: "Intermittent — fails sometimes", nextNodeId: "q-intermittent" },
      ]},

      { id: "q-complete", type: "question", text: "What fax transport method is being used?", detail: "Check the SIP/SDP for the transport: T.38 (m=image ... udptl t38) or G.711 passthrough (m=audio with G.711 codec).", options: [
        { label: "T.38 UDPTL", nextNodeId: "q-t38-complete" },
        { label: "G.711 Passthrough", nextNodeId: "q-g711-complete" },
        { label: "Not sure", nextNodeId: "a-check-transport" },
      ]},

      { id: "a-check-transport", type: "action", text: "Capture the fax call with Packet Monitor to determine the transport method.", toolLink: { toolId: "packet-capture", subviewId: "viewer", label: "Capture Fax Call" }, options: [
        { label: "T.38 UDPTL detected", nextNodeId: "q-t38-complete" },
        { label: "G.711 audio detected", nextNodeId: "q-g711-complete" },
      ]},

      { id: "q-t38-complete", type: "question", text: "Does the re-INVITE to switch to T.38 succeed (200 OK)?", options: [
        { label: "Yes, 200 OK to T.38 re-INVITE", nextNodeId: "r-t38-network" },
        { label: "No, re-INVITE rejected (488 or other error)", nextNodeId: "r-t38-rejected" },
        { label: "No re-INVITE seen (call starts as T.38)", nextNodeId: "r-t38-network" },
      ]},

      { id: "r-t38-rejected", type: "result", text: "T.38 re-INVITE rejected — the far end doesn't support T.38.", detail: "Fall back to G.711 passthrough. Ensure all intermediaries (SBCs, proxies) support T.38 pass-through.", articleId: "t38-reinvite-switchover" },

      { id: "r-t38-network", type: "result", text: "T.38 connection established but fax fails — check network quality.", detail: "T.38 requires: delay < 1000ms, jitter < 300ms. Run a network quality test. Also check T.38 redundancy settings and ECM.", articleId: "t38-network-requirements" },

      { id: "q-g711-complete", type: "result", text: "G.711 passthrough fax failure — network requirements are strict.", detail: "G.711 fax passthrough requires: jitter < 30ms, near-zero packet loss, no silence suppression, no echo cancellation, no compressed codecs. Consider switching to T.38 which is more tolerant.", articleId: "t38-vs-passthrough" },

      { id: "q-partial", type: "result", text: "Partial fax — pages lost or corrupted during transmission.", detail: "Enable ECM (Error Correction Mode) for page-level retransmission. Increase T.38 redundancy. Reduce baud rate from 14400 to 9600. Check for burst packet loss.", articleId: "t38-page-loss" },

      { id: "q-direction", type: "result", text: "Unidirectional fax failure — the receiving side sets negotiation parameters.", detail: "Test both directions. The receiving fax machine often controls negotiation. Ensure both sides support the same fax protocol (T.38 or passthrough). Check that all devices in the path use the same method.", articleId: "t38-vs-passthrough" },

      { id: "q-intermittent", type: "question", text: "What is the failure rate?", options: [
        { label: "Less than 8-10%", nextNodeId: "r-normal-rate" },
        { label: "More than 10%", nextNodeId: "r-high-rate" },
      ]},

      { id: "r-normal-rate", type: "result", text: "A failure rate around 8% is normal for fax over SIP trunks.", detail: "Per Sansay TAC, approximately 8% failure rate is expected for SIP trunk faxing. If failures are always from specific numbers, the issue is likely on the remote end.", articleId: "t38-network-requirements" },

      { id: "r-high-rate", type: "result", text: "High failure rate — investigate network quality and fax configuration.", detail: "Check network conditions (jitter, loss, latency). Enable ECM. Use T.38 instead of passthrough. Reduce baud rate. Increase redundancy.", articleId: "t38-page-loss" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 6. DNS RESOLUTION
  // ═══════════════════════════════════════════════════════════════

  {
    id: "dt-dns-resolution",
    title: "DNS Resolution for SIP",
    domain: "dns",
    description: "Diagnose SIP server discovery failures via DNS (RFC 3263).",
    startNodeId: "start",
    nodes: [
      { id: "start", type: "question", text: "Can you reach the SIP server by IP address directly?", options: [
        { label: "Yes, it works with IP address", nextNodeId: "q-dns-issue" },
        { label: "No, it doesn't work even with IP", nextNodeId: "r-not-dns" },
      ]},

      { id: "r-not-dns", type: "result", text: "The problem is not DNS — the server is unreachable even by IP.", detail: "Check: firewall rules, server status, network routing. This is a connectivity issue, not a DNS issue.", articleId: "sip-408-timeout" },

      { id: "q-dns-issue", type: "question", text: "Do DNS SRV records exist for the domain? Query _sip._udp.<domain>", options: [
        { label: "Yes, SRV records found", nextNodeId: "q-srv-correct" },
        { label: "No SRV records (NXDOMAIN or empty)", nextNodeId: "q-naptr" },
      ]},

      { id: "q-srv-correct", type: "question", text: "Do the SRV records point to the correct host and port?", options: [
        { label: "Yes, correct host and port", nextNodeId: "q-a-record" },
        { label: "No, wrong host or port", nextNodeId: "r-fix-srv" },
      ]},

      { id: "r-fix-srv", type: "result", text: "SRV records point to the wrong target — update DNS.", detail: "The SRV record's target host or port is incorrect. Update the DNS zone to point to the correct SIP server.", articleId: "dns-config-for-sip" },

      { id: "q-a-record", type: "question", text: "Does the SRV target hostname resolve to the correct IP (A/AAAA record)?", options: [
        { label: "Yes, correct IP", nextNodeId: "r-dns-ok" },
        { label: "No, wrong IP or no A record", nextNodeId: "r-fix-a-record" },
      ]},

      { id: "r-dns-ok", type: "result", text: "DNS is configured correctly. The issue may be intermittent DNS failures or caching.", detail: "DNS resolution is correct but may fail intermittently. Check DNS server reliability, TTL values, and try multiple DNS resolvers.", articleId: "dns-srv-naptr-failures" },

      { id: "r-fix-a-record", type: "result", text: "The A/AAAA record for the SRV target is missing or incorrect.", detail: "Add or fix the A/AAAA record for the hostname referenced in the SRV record.", articleId: "dns-config-for-sip" },

      { id: "q-naptr", type: "question", text: "Do NAPTR records exist for the domain?", options: [
        { label: "Yes, NAPTR records found", nextNodeId: "r-check-naptr" },
        { label: "No NAPTR records", nextNodeId: "q-a-direct" },
      ]},

      { id: "r-check-naptr", type: "result", text: "NAPTR records exist but SRV records are missing — check NAPTR replacement fields.", detail: "NAPTR records should point to SRV record names. Verify the replacement field and flags are correct per RFC 3263.", articleId: "dns-config-for-sip" },

      { id: "q-a-direct", type: "question", text: "Does the domain have a direct A/AAAA record?", options: [
        { label: "Yes", nextNodeId: "r-a-only" },
        { label: "No — domain has no DNS records", nextNodeId: "r-no-dns" },
      ]},

      { id: "r-a-only", type: "result", text: "Only A/AAAA records exist — SIP will default to port 5060 UDP.", detail: "Without SRV records, SIP clients fall back to the A record with port 5060 and UDP transport per RFC 3263. This works but doesn't support transport selection or failover. Consider adding SRV records.", articleId: "dns-config-for-sip" },

      { id: "r-no-dns", type: "result", text: "No DNS records at all — the domain is not configured.", detail: "The SIP domain has no DNS records. You need to either: add DNS records, or use the server IP directly instead of a domain name.", articleId: "dns-srv-naptr-failures" },
    ],
  },
];

/** Quick lookup: decision tree by ID. */
const _treeIndex = new Map<string, TsDecisionTree>();
for (const dt of DECISION_TREES) _treeIndex.set(dt.id, dt);

/** Get a decision tree by ID. */
export function getDecisionTreeById(id: string): TsDecisionTree | undefined {
  return _treeIndex.get(id);
}
