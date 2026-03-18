/**
 * Crafter Wiki reference data — comprehensive SIP, HTTP, and SSH reference.
 */

export type InsertTarget = "method" | "header" | "copy";

export interface WikiEntry {
  text: string;
  description: string;
  insertable?: boolean;
  insertTarget?: InsertTarget;
  heading?: boolean;
  sipTemplate?: {
    method?: string;
    uri?: string;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    bodyContentType?: string;
  };
  httpTemplate?: {
    method?: string;
    url?: string;
    bodyType?: string;
    bodyJson?: string;
  };
}

export interface WikiSection {
  id: string;
  title: string;
  protocol: "sip" | "http" | "ssh" | "mcp";
  content: WikiEntry[];
}

export const WIKI_SECTIONS: WikiSection[] = [
  // ════════════════════════════════════════════════════════════════════════
  // SIP: METHODS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "sip-methods",
    title: "SIP Methods",
    protocol: "sip",
    content: [
      { text: "SIP Request Methods", description: "SIP uses request-response semantics. Each method has a specific purpose. Required headers vary by method. RFC 3261 defines the core methods; extensions add more.", heading: true },
      { text: "REGISTER", description: "Register a contact address with a registrar. Required for inbound calls. Sends Contact, Expires. 401/407 triggers digest auth. Send Expires: 0 to unregister.", insertable: true, insertTarget: "method" },
      { text: "INVITE", description: "Initiate a call or session. Requires SDP body (application/sdp) for media negotiation. Flow: INVITE → 100 Trying → 180 Ringing → 200 OK → ACK. Contact and SDP are critical.", insertable: true, insertTarget: "method" },
      { text: "ACK", description: "Confirm receipt of final response to INVITE. Must match CSeq of the INVITE. Sent after 200 OK to complete the 3-way handshake. No response expected.", insertable: true, insertTarget: "method" },
      { text: "BYE", description: "Terminate an established call/session. Sent by either party. Must be in-dialog (has To-tag, From-tag, Route set). 200 OK confirms teardown.", insertable: true, insertTarget: "method" },
      { text: "CANCEL", description: "Cancel a pending INVITE before a final response. Only works for INVITE. Can only be sent before 2xx; after 200 OK use BYE instead.", insertable: true, insertTarget: "method" },
      { text: "OPTIONS", description: "Query capabilities of a server or user agent. Lightweight ping — no body required. Returns Allow, Supported, Accept headers. Use to check reachability.", insertable: true, insertTarget: "method" },
      { text: "INFO", description: "Send mid-dialog information. Common: DTMF digits via application/dtmf-relay body. Must be in-dialog. Not for session negotiation.", insertable: true, insertTarget: "method" },
      { text: "NOTIFY", description: "Deliver event notifications. Paired with SUBSCRIBE. Common events: check-sync (Yealink reboot), message-summary (MWI/voicemail), presence, dialog.", insertable: true, insertTarget: "method" },
      { text: "MESSAGE", description: "Send an instant message out-of-dialog. Body is the message (text/plain, text/html). Request-URI is the recipient. No session created.", insertable: true, insertTarget: "method" },
      { text: "SUBSCRIBE", description: "Subscribe to event notifications. Requires Event header. Expires header sets duration. Server responds with 200 OK then sends NOTIFYs.", insertable: true, insertTarget: "method" },
      { text: "PUBLISH", description: "Publish event state to a server. Used for presence. Server stores and distributes to subscribers via NOTIFY.", insertable: true, insertTarget: "method" },
      { text: "REFER", description: "Ask the recipient to send a request to a third party. Blind transfer: Refer-To header has target URI. Receiver sends INVITE to the target, then NOTIFYs back progress.", insertable: true, insertTarget: "method" },
      { text: "UPDATE", description: "Modify session parameters before a final response. Can renegotiate SDP (add video, change codec) without full re-INVITE. RFC 3311.", insertable: true, insertTarget: "method" },
      { text: "PRACK", description: "Acknowledge a reliable provisional response (1xx with 100rel). Required when Require: 100rel is used. Ensures 1xx isn't lost on UDP.", insertable: true, insertTarget: "method" },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SIP: RESPONSE CODES
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "sip-responses",
    title: "SIP Response Codes",
    protocol: "sip",
    content: [
      { text: "Response Code Classes", description: "SIP uses 3-digit status codes. 1xx: provisional (processing); 2xx: success; 3xx: redirect; 4xx: client error; 5xx: server error; 6xx: global failure. Only one final response (2xx–6xx) per transaction.", heading: true },

      { text: "1xx Provisional", description: "Request received, still processing. Sent before final response. Stops client retransmissions. Multiple 1xx are allowed.", heading: true },
      { text: "100 Trying", description: "Request received, being processed. Stops retransmissions. Usually sent immediately by first proxy/UAS.", insertable: true, insertTarget: "copy" },
      { text: "180 Ringing", description: "User agent is alerting the called user. Phone is ringing. May include early media (ringback tone) in some setups.", insertable: true, insertTarget: "copy" },
      { text: "181 Call Is Being Forwarded", description: "Call is being forwarded to another destination.", insertable: true, insertTarget: "copy" },
      { text: "182 Queued", description: "Called party is temporarily unavailable. Call is queued.", insertable: true, insertTarget: "copy" },
      { text: "183 Session Progress", description: "Provisional response with SDP. Used for early media (ringback tone from network, announcement). Often paired with 100rel.", insertable: true, insertTarget: "copy" },
      { text: "199 Early Dialog Terminated", description: "Early dialog (forked INVITE) was terminated. RFC 6228.", insertable: true, insertTarget: "copy" },

      { text: "2xx Success", description: "Request succeeded.", heading: true },
      { text: "200 OK", description: "Success. For INVITE: includes SDP answer, starts session. For REGISTER: confirms binding. For BYE: confirms call teardown.", insertable: true, insertTarget: "copy" },
      { text: "202 Accepted", description: "Request accepted for processing but not yet completed. Used for REFER, SUBSCRIBE. Processing continues asynchronously.", insertable: true, insertTarget: "copy" },
      { text: "204 No Notification", description: "SUBSCRIBE succeeded but no NOTIFY will be sent. RFC 5839.", insertable: true, insertTarget: "copy" },

      { text: "3xx Redirect", description: "Request should be retried at a different URI. Contact header contains the new location(s).", heading: true },
      { text: "300 Multiple Choices", description: "Multiple options for the user. Contact header lists alternatives.", insertable: true, insertTarget: "copy" },
      { text: "301 Moved Permanently", description: "User permanently moved. Update address book. Contact has new URI.", insertable: true, insertTarget: "copy" },
      { text: "302 Moved Temporarily", description: "User temporarily at different location. Don't update address book. Retry at Contact URI.", insertable: true, insertTarget: "copy" },
      { text: "305 Use Proxy", description: "Request must go through the indicated proxy.", insertable: true, insertTarget: "copy" },
      { text: "380 Alternative Service", description: "Call not successful but alternative services are possible.", insertable: true, insertTarget: "copy" },

      { text: "4xx Client Error", description: "Request can't be fulfilled. Problem is on the client side. Fix and retry.", heading: true },
      { text: "400 Bad Request", description: "Malformed request. Check syntax, required headers, body format.", insertable: true, insertTarget: "copy" },
      { text: "401 Unauthorized", description: "Authentication required by UAS. WWW-Authenticate header has realm, nonce. Retry with Authorization header containing digest response.", insertable: true, insertTarget: "copy" },
      { text: "403 Forbidden", description: "Server understood but refuses. Credentials valid but action not permitted. Check ACLs, permissions.", insertable: true, insertTarget: "copy" },
      { text: "404 Not Found", description: "User/URI does not exist on this server. Check Request-URI, To header.", insertable: true, insertTarget: "copy" },
      { text: "405 Method Not Allowed", description: "Method recognized but not allowed for this URI. Allow header lists valid methods.", insertable: true, insertTarget: "copy" },
      { text: "406 Not Acceptable", description: "Resource only generates responses with content not acceptable per Accept headers.", insertable: true, insertTarget: "copy" },
      { text: "407 Proxy Auth Required", description: "Proxy requires authentication. Proxy-Authenticate has realm/nonce. Retry with Proxy-Authorization.", insertable: true, insertTarget: "copy" },
      { text: "408 Request Timeout", description: "Server could not produce response in time. Request may have never reached the UAS.", insertable: true, insertTarget: "copy" },
      { text: "410 Gone", description: "User existed but is no longer available. Permanently removed.", insertable: true, insertTarget: "copy" },
      { text: "412 Conditional Request Failed", description: "Precondition in request failed. RFC 3903.", insertable: true, insertTarget: "copy" },
      { text: "413 Request Entity Too Large", description: "Body too large. Server refuses.", insertable: true, insertTarget: "copy" },
      { text: "414 Request-URI Too Long", description: "URI exceeds server limit.", insertable: true, insertTarget: "copy" },
      { text: "415 Unsupported Media Type", description: "Body Content-Type not supported. Check Content-Type, Accept headers.", insertable: true, insertTarget: "copy" },
      { text: "416 Unsupported URI Scheme", description: "Request-URI scheme not supported (e.g. tel: when only sip: is accepted).", insertable: true, insertTarget: "copy" },
      { text: "420 Bad Extension", description: "Extension in Require header not supported. Unsupported header lists which.", insertable: true, insertTarget: "copy" },
      { text: "421 Extension Required", description: "Server needs a specific extension not indicated by client.", insertable: true, insertTarget: "copy" },
      { text: "422 Session Interval Too Small", description: "Session-Expires too small. Min-SE header has minimum. RFC 4028.", insertable: true, insertTarget: "copy" },
      { text: "423 Interval Too Brief", description: "Expires or Contact expires too short. Min-Expires header has minimum.", insertable: true, insertTarget: "copy" },
      { text: "428 Use Identity Header", description: "Server policy requires Identity header. RFC 4474.", insertable: true, insertTarget: "copy" },
      { text: "436 Bad Identity-Info", description: "Identity-Info header invalid.", insertable: true, insertTarget: "copy" },
      { text: "437 Unsupported Certificate", description: "Certificate in Identity-Info can't be validated.", insertable: true, insertTarget: "copy" },
      { text: "438 Invalid Identity Header", description: "Identity header signature invalid.", insertable: true, insertTarget: "copy" },
      { text: "480 Temporarily Unavailable", description: "Callee currently unavailable. May become available later. Check device registration.", insertable: true, insertTarget: "copy" },
      { text: "481 Call/Transaction Does Not Exist", description: "UAS received a request not matching any dialog or transaction. Stale BYE, ACK to wrong dialog.", insertable: true, insertTarget: "copy" },
      { text: "482 Loop Detected", description: "Server detected a loop (request received twice). Check Record-Route, Via.", insertable: true, insertTarget: "copy" },
      { text: "483 Too Many Hops", description: "Max-Forwards reached zero. Too many proxies in path.", insertable: true, insertTarget: "copy" },
      { text: "484 Address Incomplete", description: "Request-URI is incomplete. Overlap dialing — send more digits.", insertable: true, insertTarget: "copy" },
      { text: "485 Ambiguous", description: "Request-URI is ambiguous. Multiple users match.", insertable: true, insertTarget: "copy" },
      { text: "486 Busy Here", description: "Callee is busy at this endpoint. User declined or on another call.", insertable: true, insertTarget: "copy" },
      { text: "487 Request Terminated", description: "Request was cancelled (CANCEL received) or replaced.", insertable: true, insertTarget: "copy" },
      { text: "488 Not Acceptable Here", description: "SDP offer not acceptable. Codec mismatch, media type not supported. Check SDP capabilities.", insertable: true, insertTarget: "copy" },
      { text: "489 Bad Event", description: "Event package in Event header not supported. RFC 3265.", insertable: true, insertTarget: "copy" },
      { text: "491 Request Pending", description: "Server has a pending request for this dialog. Retry after a delay.", insertable: true, insertTarget: "copy" },
      { text: "493 Undecipherable", description: "Request body encrypted with unsupported scheme.", insertable: true, insertTarget: "copy" },
      { text: "494 Security Agreement Required", description: "Security mechanism negotiation needed. RFC 3329.", insertable: true, insertTarget: "copy" },

      { text: "5xx Server Error", description: "Server failure. Request may be valid — problem is on the server side.", heading: true },
      { text: "500 Server Internal Error", description: "Server encountered an unexpected condition. Temporary — retry later.", insertable: true, insertTarget: "copy" },
      { text: "501 Not Implemented", description: "Method not implemented by this server.", insertable: true, insertTarget: "copy" },
      { text: "502 Bad Gateway", description: "Received invalid response from downstream server.", insertable: true, insertTarget: "copy" },
      { text: "503 Service Unavailable", description: "Server overloaded or maintenance. Retry-After header may suggest delay. Try alternate server.", insertable: true, insertTarget: "copy" },
      { text: "504 Server Time-out", description: "Server didn't receive timely response from downstream.", insertable: true, insertTarget: "copy" },
      { text: "505 Version Not Supported", description: "SIP version not supported. Must be SIP/2.0.", insertable: true, insertTarget: "copy" },
      { text: "513 Message Too Large", description: "Message body exceeds server capacity.", insertable: true, insertTarget: "copy" },
      { text: "580 Precondition Failure", description: "Preconditions (RFC 3312) not met.", insertable: true, insertTarget: "copy" },

      { text: "6xx Global Failure", description: "Request will fail everywhere. Do not retry at other locations.", heading: true },
      { text: "600 Busy Everywhere", description: "Callee is busy at all known locations.", insertable: true, insertTarget: "copy" },
      { text: "603 Decline", description: "Callee explicitly declined. Does not want to or cannot participate.", insertable: true, insertTarget: "copy" },
      { text: "604 Does Not Exist Anywhere", description: "User does not exist anywhere (not just this server).", insertable: true, insertTarget: "copy" },
      { text: "606 Not Acceptable", description: "Session description not acceptable. Similar to 488 but global.", insertable: true, insertTarget: "copy" },
      { text: "607 Unwanted", description: "Callee does not want this call. Robocall/spam rejection. RFC 8197.", insertable: true, insertTarget: "copy" },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SIP: HEADERS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "sip-headers",
    title: "SIP Headers",
    protocol: "sip",
    content: [
      { text: "Required Headers (every request)", description: "Via, From, To, Call-ID, CSeq, Max-Forwards. Use 'Auto-fill required headers' in the builder to generate these.", heading: true },
      { text: "Via", description: "Routing path. SIP/2.0/TRANSPORT host:port;branch=z9hG4bK... Branch must be globally unique per transaction. Responses follow Via path back.", insertable: true, insertTarget: "header" },
      { text: "From", description: "Logical sender. <sip:user@host>;tag=xxx. Tag is mandatory, identifies the dialog leg. Display name optional.", insertable: true, insertTarget: "header" },
      { text: "To", description: "Logical recipient. <sip:user@host>. Tag added by UAS in response (forms dialog ID with From-tag + Call-ID).", insertable: true, insertTarget: "header" },
      { text: "Call-ID", description: "Unique identifier for a dialog/call. Format: uuid@host. Same for all messages in a dialog. Globally unique.", insertable: true, insertTarget: "header" },
      { text: "CSeq", description: "Sequence number + method name. Format: 1 INVITE. Increment for each new request in dialog. ACK and CANCEL use same CSeq as INVITE.", insertable: true, insertTarget: "header" },
      { text: "Max-Forwards", description: "Hop limit. Decremented by each proxy. Typically 70. Prevents routing loops.", insertable: true, insertTarget: "header" },

      { text: "Common Request Headers", description: "Frequently used headers beyond the required set.", heading: true },
      { text: "Contact", description: "Direct URI for subsequent requests. Required in REGISTER (binding), INVITE (dialog). Format: <sip:user@ip:port;transport=udp>.", insertable: true, insertTarget: "header" },
      { text: "Expires", description: "Registration or subscription duration in seconds. REGISTER: 3600 typical. Expires: 0 means unregister/unsubscribe.", insertable: true, insertTarget: "header" },
      { text: "Content-Type", description: "Body MIME type. application/sdp for SDP, application/dtmf-relay for DTMF, text/plain for MESSAGE.", insertable: true, insertTarget: "header" },
      { text: "Content-Length", description: "Body length in bytes. Auto-set by stack. Required if body present.", insertable: true, insertTarget: "header" },
      { text: "User-Agent", description: "Client identity string. E.g. 'Yealink SIP-T46G 28.73.0.50'. Many servers use this for device identification.", insertable: true, insertTarget: "header" },
      { text: "Allow", description: "Lists methods this UA supports. E.g. INVITE, ACK, BYE, CANCEL, OPTIONS, NOTIFY, REFER. Sent in responses and REGISTER.", insertable: true, insertTarget: "header" },
      { text: "Supported", description: "Lists SIP extensions supported. E.g. 100rel, timer, replaces, path, outbound. Informational, no obligation.", insertable: true, insertTarget: "header" },
      { text: "Require", description: "Lists extensions the peer MUST support. If not supported, 420 Bad Extension is returned. Use sparingly.", insertable: true, insertTarget: "header" },
      { text: "Event", description: "Event package name. Required for SUBSCRIBE/NOTIFY. Values: check-sync, message-summary, presence, dialog, refer.", insertable: true, insertTarget: "header" },
      { text: "Subscription-State", description: "In NOTIFY: active, pending, or terminated. Includes expires parameter. E.g. active;expires=3600.", insertable: true, insertTarget: "header" },
      { text: "Refer-To", description: "Transfer target URI for REFER. E.g. <sip:target@host>. Receiver sends INVITE to this URI.", insertable: true, insertTarget: "header" },
      { text: "Referred-By", description: "Identity of the transferor in a REFER. Allows the target to know who initiated the transfer.", insertable: true, insertTarget: "header" },
      { text: "Replaces", description: "Dialog identifier to replace. Used for attended transfer. Format: call-id;to-tag=...;from-tag=...", insertable: true, insertTarget: "header" },

      { text: "Routing Headers", description: "Control request routing through proxies and back.", heading: true },
      { text: "Record-Route", description: "Proxy adds this to stay in the signaling path. UAS copies to Route set for subsequent requests.", insertable: true, insertTarget: "header" },
      { text: "Route", description: "Pre-loaded route set. Determines proxy path for in-dialog requests. Built from Record-Route.", insertable: true, insertTarget: "header" },
      { text: "Path", description: "Like Record-Route but for REGISTER. Proxies add Path headers so they stay in the path for incoming requests.", insertable: true, insertTarget: "header" },
      { text: "Service-Route", description: "Returned by registrar to tell UA which proxy to use for outbound requests.", insertable: true, insertTarget: "header" },

      { text: "Identity & Privacy Headers", description: "Caller ID, privacy, and trust.", heading: true },
      { text: "P-Asserted-Identity", description: "Trusted caller ID. Set by trusted proxy after authentication. Format: \"Display\" <sip:user@host>. Not sent to untrusted networks.", insertable: true, insertTarget: "header" },
      { text: "P-Preferred-Identity", description: "UA's preferred identity. Proxy validates and converts to P-Asserted-Identity if trusted.", insertable: true, insertTarget: "header" },
      { text: "Remote-Party-ID", description: "Legacy caller ID header (pre-RFC). Still used by Cisco. party=calling;screen=yes;privacy=off.", insertable: true, insertTarget: "header" },
      { text: "Privacy", description: "Privacy preferences. Values: none, id (hide identity), header, session, user, critical.", insertable: true, insertTarget: "header" },
      { text: "Diversion", description: "Call forwarding info. Shows original called number and reason (unconditional, busy, no-answer, unavailable).", insertable: true, insertTarget: "header" },
      { text: "History-Info", description: "RFC 7044. Records call routing history (retargeting). More flexible than Diversion.", insertable: true, insertTarget: "header" },

      { text: "Session & Timer Headers", description: "Session management and keep-alive.", heading: true },
      { text: "Session-Expires", description: "Session timer duration in seconds. E.g. 1800;refresher=uac. Endpoint must send re-INVITE/UPDATE before expiry.", insertable: true, insertTarget: "header" },
      { text: "Min-SE", description: "Minimum acceptable Session-Expires. Server returns 422 if proposed value is too small.", insertable: true, insertTarget: "header" },
      { text: "Reason", description: "Why a BYE/CANCEL was sent. Format: SIP;cause=location;text=\"reason\". E.g. Q.850;cause=16;text=\"Normal clearing\".", insertable: true, insertTarget: "header" },
      { text: "Retry-After", description: "Seconds to wait before retrying. Sent with 503, 480, 600, 603.", insertable: true, insertTarget: "header" },

      { text: "Auth Headers", description: "Digest authentication challenge and response.", heading: true },
      { text: "WWW-Authenticate", description: "Challenge from UAS (401). Contains realm, nonce, qop, algorithm. Client computes digest response.", insertable: true, insertTarget: "header" },
      { text: "Authorization", description: "Digest response to 401. Contains username, realm, nonce, uri, response, cnonce, nc, qop.", insertable: true, insertTarget: "header" },
      { text: "Proxy-Authenticate", description: "Challenge from proxy (407). Same format as WWW-Authenticate.", insertable: true, insertTarget: "header" },
      { text: "Proxy-Authorization", description: "Digest response to 407. Same format as Authorization.", insertable: true, insertTarget: "header" },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SIP: SDP & MEDIA
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "sip-sdp",
    title: "SDP & Media",
    protocol: "sip",
    content: [
      { text: "SDP Overview", description: "Session Description Protocol describes media capabilities. Included in INVITE (offer) and 200 OK (answer). Content-Type: application/sdp.", heading: true },
      { text: "v=0", description: "Version. Always 0." },
      { text: "o=username sess-id sess-version IN IP4 addr", description: "Origin. Session identifier. sess-id/sess-version are numeric. IP is the session creator's address." },
      { text: "s=-", description: "Session name. Usually '-' (dash)." },
      { text: "c=IN IP4 addr", description: "Connection address. Media destination IP. 0.0.0.0 means 'hold' (no media). Use actual IP in production." },
      { text: "t=0 0", description: "Timing. 0 0 means session is permanent/unbounded." },
      { text: "m=audio port RTP/AVP payloads", description: "Media line. port=RTP port, payloads=codec numbers. E.g. m=audio 10000 RTP/AVP 0 8 18 101." },
      { text: "m=video port RTP/AVP payloads", description: "Video media line. E.g. m=video 20000 RTP/AVP 96 97." },

      { text: "Common Audio Codecs", description: "Payload type numbers for standard codecs.", heading: true },
      { text: "0 — PCMU (G.711 μ-law)", description: "8kHz, 64kbps. North America standard. Best quality for voice. No compression.", insertable: true, insertTarget: "copy" },
      { text: "8 — PCMA (G.711 A-law)", description: "8kHz, 64kbps. Europe/international standard. Equivalent quality to PCMU.", insertable: true, insertTarget: "copy" },
      { text: "9 — G.722", description: "16kHz wideband, 64kbps. HD voice. Much better quality than G.711.", insertable: true, insertTarget: "copy" },
      { text: "18 — G.729", description: "8kHz, 8kbps. Compressed. Good quality at low bandwidth. Licensed codec (sometimes).", insertable: true, insertTarget: "copy" },
      { text: "4 — G.723.1", description: "8kHz, 5.3/6.3kbps. Highly compressed. Used in older video conferencing.", insertable: true, insertTarget: "copy" },
      { text: "3 — GSM", description: "8kHz, 13kbps. Mobile phone codec.", insertable: true, insertTarget: "copy" },
      { text: "101 — telephone-event (DTMF)", description: "RFC 4733/2833 DTMF tones. a=rtpmap:101 telephone-event/8000 a=fmtp:101 0-16.", insertable: true, insertTarget: "copy" },

      { text: "SDP Attributes", description: "a= lines modify media behavior.", heading: true },
      { text: "a=rtpmap:PT codec/rate", description: "Maps payload type to codec name. E.g. a=rtpmap:0 PCMU/8000." },
      { text: "a=fmtp:PT params", description: "Format parameters. E.g. a=fmtp:101 0-16 (DTMF events 0-9,*,#,A-D,flash)." },
      { text: "a=sendrecv", description: "Both directions. Default if omitted. Normal call mode.", insertable: true, insertTarget: "copy" },
      { text: "a=sendonly", description: "Only send media. Used for announcements, music on hold.", insertable: true, insertTarget: "copy" },
      { text: "a=recvonly", description: "Only receive media. Listening/recording mode.", insertable: true, insertTarget: "copy" },
      { text: "a=inactive", description: "No media in either direction. Call on hold.", insertable: true, insertTarget: "copy" },
      { text: "a=ptime:20", description: "Packet time in ms. 20ms is standard. Affects bandwidth and latency." },
      { text: "a=crypto:...", description: "SRTP key exchange (SDES). E.g. a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:base64key. Used with SIP over TLS." },

      { text: "SIP URIs & Transport", description: "Addressing and transport options.", heading: true },
      { text: "sip:user@host", description: "Standard SIP URI. UDP by default on port 5060.", insertable: true, insertTarget: "copy" },
      { text: "sip:user@host:port", description: "Explicit port. E.g. sip:alice@pbx.example.com:5060.", insertable: true, insertTarget: "copy" },
      { text: "sip:user@host;transport=tcp", description: "TCP transport. Port 5060.", insertable: true, insertTarget: "copy" },
      { text: "sips:user@host", description: "Secure SIP (TLS). Port 5061 by default. Mandatory encryption.", insertable: true, insertTarget: "copy" },
      { text: "tel:+15551234567", description: "Tel URI for PSTN numbers. E.g. tel:+1-555-123-4567. Used in Request-URI, Diversion, Refer-To.", insertable: true, insertTarget: "copy" },
      { text: "Port 5060 (UDP/TCP)", description: "Default SIP signaling port. UDP is most common. TCP for large messages or reliable transport." },
      { text: "Port 5061 (TLS)", description: "Default SIP TLS port. Encrypted signaling." },
      { text: "RTP Ports (10000–20000)", description: "Media ports. Negotiated per-call via SDP. Even ports for RTP, odd for RTCP." },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SIP: CALL FLOWS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "sip-flows",
    title: "SIP Call Flows",
    protocol: "sip",
    content: [
      { text: "Basic Call Setup (INVITE)", description: "Caller → INVITE → Proxy → 100 Trying → UAS → 180 Ringing → 200 OK (with SDP answer) → ACK → RTP media flows → BYE → 200 OK.", heading: true },
      { text: "Registration Flow", description: "UA → REGISTER → Registrar → 401 Unauthorized (with challenge) → REGISTER (with Authorization) → 200 OK (with Contact bindings). Refresh before Expires.", heading: true },
      { text: "Call Hold", description: "Send re-INVITE with SDP c=0.0.0.0 or a=sendonly/a=inactive. Peer responds 200 OK with a=recvonly or a=inactive. Music on hold is separate.", heading: true },
      { text: "Call Resume", description: "Send re-INVITE with normal SDP (real IP, a=sendrecv). Peer responds 200 OK.", heading: true },
      { text: "Blind Transfer", description: "A calls B. A sends REFER to B with Refer-To: C. B sends INVITE to C, sends NOTIFY to A with progress. A gets 200 OK NOTIFY, sends BYE to B.", heading: true },
      { text: "Attended Transfer", description: "A calls B. A puts B on hold, calls C. A sends REFER to C with Refer-To: B (Replaces header). C sends INVITE to B with Replaces. A drops out.", heading: true },
      { text: "SUBSCRIBE/NOTIFY", description: "UA → SUBSCRIBE (Event: message-summary) → 200 OK → NOTIFY (with message-summary body) → 200 OK. NOTIFY sent on state change and before subscription expires.", heading: true },
      { text: "Forking", description: "Proxy sends INVITE to multiple contacts simultaneously (parallel forking) or sequentially (serial forking). First 2xx wins. Others get CANCEL.", heading: true },
      { text: "NAT Traversal", description: "Common issues: private IP in Contact/SDP, symmetric NAT blocks RTP. Solutions: STUN, TURN, ICE, SIP ALG (often broken), rport parameter, outbound proxy.", heading: true },
      { text: "SIP Timers", description: "T1=500ms (RTT estimate), T2=4s (max retransmit interval), Timer B=32s (INVITE transaction timeout), Timer F=32s (non-INVITE timeout), Timer C=3min+ (proxy INVITE timeout).", heading: true },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SIP: TEMPLATES
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "sip-templates",
    title: "SIP Templates",
    protocol: "sip",
    content: [
      { text: "Quick-load templates", description: "Click to load a pre-built request into the SIP builder. Customize URI, headers, and body before sending.", heading: true },

      { text: "OPTIONS Ping", description: "Lightweight reachability check. No auth, no body.", sipTemplate: { method: "OPTIONS", uri: "sip:192.168.1.1:5060" } },
      { text: "Basic REGISTER", description: "Minimal registration. Add digest auth credentials if you get 401.", sipTemplate: { method: "REGISTER", uri: "sip:registrar.example.com" } },
      { text: "Unregister (Expires: 0)", description: "Remove registration binding. Set Expires: 0 and Contact: *.", sipTemplate: { method: "REGISTER", uri: "sip:registrar.example.com", headers: [{ key: "Expires", value: "0" }, { key: "Contact", value: "*" }] } },
      { text: "INVITE with SDP", description: "Basic audio call with PCMU + PCMA + DTMF.", sipTemplate: { method: "INVITE", uri: "sip:user@host", body: "v=0\r\no=sipalyzer 0 0 IN IP4 0.0.0.0\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=audio 10000 RTP/AVP 0 8 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:101 telephone-event/8000\r\na=fmtp:101 0-16\r\na=sendrecv\r\na=ptime:20\r\n", bodyContentType: "application/sdp" } },
      { text: "INVITE HD Audio (G.722)", description: "Wideband audio call with G.722 + fallback.", sipTemplate: { method: "INVITE", uri: "sip:user@host", body: "v=0\r\no=sipalyzer 0 0 IN IP4 0.0.0.0\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=audio 10000 RTP/AVP 9 0 8 101\r\na=rtpmap:9 G722/8000\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:101 telephone-event/8000\r\na=fmtp:101 0-16\r\na=sendrecv\r\na=ptime:20\r\n", bodyContentType: "application/sdp" } },
      { text: "INFO DTMF Digit", description: "Send DTMF digit 1 via INFO.", sipTemplate: { method: "INFO", uri: "sip:user@host", body: "Signal=1\r\nDuration=160\r\n", bodyContentType: "application/dtmf-relay" } },
      { text: "MESSAGE (text)", description: "Send an instant message.", sipTemplate: { method: "MESSAGE", uri: "sip:user@host", body: "Hello from SIPalyzer", bodyContentType: "text/plain" } },
      { text: "NOTIFY check-sync (Yealink reboot)", description: "Reboot a Yealink phone via check-sync.", sipTemplate: { method: "NOTIFY", uri: "sip:phone@192.168.1.100", headers: [{ key: "Event", value: "check-sync;reboot=true" }] } },
      { text: "NOTIFY MWI (voicemail)", description: "Message Waiting Indicator notification.", sipTemplate: { method: "NOTIFY", uri: "sip:user@host", headers: [{ key: "Event", value: "message-summary" }, { key: "Subscription-State", value: "active" }], body: "Messages-Waiting: yes\r\nMessage-Account: sip:*97@host\r\nVoice-Message: 2/0 (0/0)\r\n", bodyContentType: "application/simple-message-summary" } },
      { text: "SUBSCRIBE MWI", description: "Subscribe to voicemail notifications.", sipTemplate: { method: "SUBSCRIBE", uri: "sip:user@host", headers: [{ key: "Event", value: "message-summary" }, { key: "Expires", value: "3600" }, { key: "Accept", value: "application/simple-message-summary" }] } },
      { text: "SUBSCRIBE Presence", description: "Subscribe to user presence.", sipTemplate: { method: "SUBSCRIBE", uri: "sip:user@host", headers: [{ key: "Event", value: "presence" }, { key: "Expires", value: "3600" }, { key: "Accept", value: "application/pidf+xml" }] } },
      { text: "REFER Blind Transfer", description: "Blind transfer to a target.", sipTemplate: { method: "REFER", uri: "sip:user@host", headers: [{ key: "Refer-To", value: "sip:target@example.com" }] } },
      { text: "BYE", description: "End an active call.", sipTemplate: { method: "BYE", uri: "sip:user@host" } },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SIP: TROUBLESHOOTING
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "sip-troubleshooting",
    title: "SIP Troubleshooting",
    protocol: "sip",
    content: [
      { text: "Registration Fails (401/403)", description: "401: Check username, password, realm. Verify digest calculation. 403: Credentials correct but IP/user blocked. Check ACLs.", heading: true },
      { text: "No Audio (one-way or both)", description: "Check SDP c= line for correct IP (not 0.0.0.0 unless hold). Verify RTP ports are open. NAT issues: private IP in SDP. Use packet capture to verify RTP flow.", heading: true },
      { text: "408 Request Timeout", description: "Message never reached destination or response lost. Check DNS resolution, routing, firewall rules, target is listening on correct port/transport.", heading: true },
      { text: "488 Not Acceptable Here", description: "SDP codec mismatch. Check m= line payload types match peer's capabilities. Ensure at least one common codec.", heading: true },
      { text: "Oops, 503 Service Unavailable", description: "Server overloaded or down. Check Retry-After header. Try alternate server or failover IP.", heading: true },
      { text: "SRTP/TLS Issues", description: "Certificate mismatch, expired cert, wrong port (5061 for TLS). SRTP requires matching crypto suites in SDP.", heading: true },
      { text: "Calls Drop After 30 Seconds", description: "Session timer issue. Check Session-Expires, Min-SE headers. Ensure re-INVITE or UPDATE sent before timer expires.", heading: true },
      { text: "Calls Drop After ~32 Seconds", description: "ACK not received after 200 OK. NAT/firewall blocking return path. Check Contact header has reachable IP. Check Record-Route.", heading: true },
      { text: "DTMF Not Working", description: "Check DTMF method: RFC 2833/4733 (telephone-event in SDP), SIP INFO (application/dtmf-relay), or in-band. Both sides must agree.", heading: true },
      { text: "Caller ID Issues", description: "Check From header display name and URI. P-Asserted-Identity for trusted networks. Remote-Party-ID for legacy. Privacy header for hiding.", heading: true },
      { text: "Digest Auth Explained", description: "Server sends 401 with WWW-Authenticate: Digest realm=..., nonce=..., qop=auth. Client computes: HA1=MD5(user:realm:pass), HA2=MD5(method:uri), response=MD5(HA1:nonce:nc:cnonce:qop:HA2). SIPalyzer auto-retries when you add username/password.", heading: true },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // HTTP: METHODS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "http-methods",
    title: "HTTP Methods",
    protocol: "http",
    content: [
      { text: "HTTP Request Methods", description: "Methods define the action on a resource. Safe: doesn't modify state. Idempotent: same result if repeated. RFC 7231, RFC 5789.", heading: true },
      { text: "GET", description: "Retrieve a resource. Safe, idempotent. No body. Query params in URL (?key=value). Most common method.", insertable: true, insertTarget: "method" },
      { text: "POST", description: "Create a resource or submit data. NOT idempotent. Body: JSON, form data, XML, etc. Returns 201 Created or 200 OK.", insertable: true, insertTarget: "method" },
      { text: "PUT", description: "Replace a resource entirely. Idempotent. Body is the full new representation. Creates if not exists (201) or replaces (200/204).", insertable: true, insertTarget: "method" },
      { text: "PATCH", description: "Partial update. Body is the delta/changes only. Idempotent (should be). RFC 5789. Returns 200 OK or 204 No Content.", insertable: true, insertTarget: "method" },
      { text: "DELETE", description: "Remove a resource. Idempotent. Usually no body. Returns 200 OK or 204 No Content.", insertable: true, insertTarget: "method" },
      { text: "HEAD", description: "Like GET but response has no body. Use for checking existence, size (Content-Length), caching (ETag, Last-Modified).", insertable: true, insertTarget: "method" },
      { text: "OPTIONS", description: "Query server capabilities. CORS preflight uses this. Returns Allow header listing supported methods.", insertable: true, insertTarget: "method" },
      { text: "TRACE", description: "Echo back the request. For debugging proxy chains. Usually disabled for security (XST attacks).", insertable: true, insertTarget: "method" },
      { text: "CONNECT", description: "Establish a tunnel (HTTPS through proxy). Used by HTTP proxies for SSL/TLS.", insertable: true, insertTarget: "method" },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // HTTP: STATUS CODES
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "http-status",
    title: "HTTP Status Codes",
    protocol: "http",
    content: [
      { text: "Status Code Classes", description: "1xx: informational; 2xx: success; 3xx: redirect; 4xx: client error; 5xx: server error.", heading: true },

      { text: "1xx Informational", description: "Interim responses. Request received, continue processing.", heading: true },
      { text: "100 Continue", description: "Client should continue sending the body. Sent in response to Expect: 100-continue.", insertable: true, insertTarget: "copy" },
      { text: "101 Switching Protocols", description: "Server switching to protocol requested in Upgrade header (e.g. WebSocket).", insertable: true, insertTarget: "copy" },

      { text: "2xx Success", description: "Request succeeded.", heading: true },
      { text: "200 OK", description: "Success. Body contains the representation. Most common success response.", insertable: true, insertTarget: "copy" },
      { text: "201 Created", description: "Resource created successfully. Location header has URI of new resource.", insertable: true, insertTarget: "copy" },
      { text: "202 Accepted", description: "Request accepted but processing not complete. Async operation — check back later.", insertable: true, insertTarget: "copy" },
      { text: "204 No Content", description: "Success but no body. Common for DELETE, PUT. Don't change the current page.", insertable: true, insertTarget: "copy" },
      { text: "206 Partial Content", description: "Range request fulfilled. Content-Range header describes the part. Used for large file downloads/streaming.", insertable: true, insertTarget: "copy" },

      { text: "3xx Redirect", description: "Further action needed. Usually follow Location header.", heading: true },
      { text: "301 Moved Permanently", description: "Resource permanently at new URL. Update bookmarks. Search engines transfer SEO.", insertable: true, insertTarget: "copy" },
      { text: "302 Found", description: "Temporary redirect. Keep using original URL. Browser may change POST to GET (historical).", insertable: true, insertTarget: "copy" },
      { text: "303 See Other", description: "Redirect using GET. Used after POST to redirect to a GET resource.", insertable: true, insertTarget: "copy" },
      { text: "304 Not Modified", description: "Cached version is still valid. Sent when If-None-Match or If-Modified-Since matches. No body.", insertable: true, insertTarget: "copy" },
      { text: "307 Temporary Redirect", description: "Same as 302 but MUST keep the same method. POST stays POST.", insertable: true, insertTarget: "copy" },
      { text: "308 Permanent Redirect", description: "Same as 301 but MUST keep the same method. POST stays POST.", insertable: true, insertTarget: "copy" },

      { text: "4xx Client Error", description: "Problem is on the client side. Fix request and retry.", heading: true },
      { text: "400 Bad Request", description: "Malformed request. Check JSON syntax, required fields, Content-Type header.", insertable: true, insertTarget: "copy" },
      { text: "401 Unauthorized", description: "Authentication required. Include Authorization header. WWW-Authenticate describes the scheme.", insertable: true, insertTarget: "copy" },
      { text: "403 Forbidden", description: "Authenticated but not authorized. Valid credentials, insufficient permissions.", insertable: true, insertTarget: "copy" },
      { text: "404 Not Found", description: "Resource doesn't exist at this URL. Check path, ID, spelling.", insertable: true, insertTarget: "copy" },
      { text: "405 Method Not Allowed", description: "Method not supported for this URL. Allow header lists what's supported.", insertable: true, insertTarget: "copy" },
      { text: "406 Not Acceptable", description: "Server can't produce response matching Accept headers.", insertable: true, insertTarget: "copy" },
      { text: "408 Request Timeout", description: "Server timed out waiting for the request.", insertable: true, insertTarget: "copy" },
      { text: "409 Conflict", description: "Conflict with current resource state. E.g. duplicate key, version mismatch.", insertable: true, insertTarget: "copy" },
      { text: "410 Gone", description: "Resource permanently removed. Unlike 404, this is intentional and permanent.", insertable: true, insertTarget: "copy" },
      { text: "411 Length Required", description: "Content-Length header is required.", insertable: true, insertTarget: "copy" },
      { text: "412 Precondition Failed", description: "Condition in If-Match, If-Unmodified-Since failed.", insertable: true, insertTarget: "copy" },
      { text: "413 Payload Too Large", description: "Body exceeds server limit.", insertable: true, insertTarget: "copy" },
      { text: "414 URI Too Long", description: "URL exceeds server limit. Move params to body.", insertable: true, insertTarget: "copy" },
      { text: "415 Unsupported Media Type", description: "Content-Type not supported. E.g. sending XML when only JSON is accepted.", insertable: true, insertTarget: "copy" },
      { text: "422 Unprocessable Entity", description: "Syntax is valid but semantics are wrong. Common in APIs for validation errors.", insertable: true, insertTarget: "copy" },
      { text: "429 Too Many Requests", description: "Rate limited. Check Retry-After header. Implement backoff.", insertable: true, insertTarget: "copy" },
      { text: "451 Unavailable for Legal Reasons", description: "Blocked for legal reasons (censorship, GDPR, court order).", insertable: true, insertTarget: "copy" },

      { text: "5xx Server Error", description: "Problem is on the server side. Request may be valid.", heading: true },
      { text: "500 Internal Server Error", description: "Generic server failure. Bug, unhandled exception, misconfiguration.", insertable: true, insertTarget: "copy" },
      { text: "501 Not Implemented", description: "Server doesn't support the method.", insertable: true, insertTarget: "copy" },
      { text: "502 Bad Gateway", description: "Reverse proxy / load balancer got invalid response from upstream.", insertable: true, insertTarget: "copy" },
      { text: "503 Service Unavailable", description: "Server overloaded or in maintenance. Check Retry-After header.", insertable: true, insertTarget: "copy" },
      { text: "504 Gateway Timeout", description: "Proxy/gateway didn't get a timely response from upstream server.", insertable: true, insertTarget: "copy" },
      { text: "505 HTTP Version Not Supported", description: "Server doesn't support the HTTP version in the request.", insertable: true, insertTarget: "copy" },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // HTTP: HEADERS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "http-headers",
    title: "HTTP Headers",
    protocol: "http",
    content: [
      { text: "Request Headers", description: "Headers the client sends to the server.", heading: true },
      { text: "Content-Type", description: "Body MIME type. application/json, application/x-www-form-urlencoded, multipart/form-data, text/plain, text/xml.", insertable: true, insertTarget: "header" },
      { text: "Accept", description: "Acceptable response types. application/json, text/html, */*. Comma-separated with quality: text/html,application/json;q=0.9.", insertable: true, insertTarget: "header" },
      { text: "Authorization", description: "Credentials. Basic base64(user:pass), Bearer <token>, or custom scheme.", insertable: true, insertTarget: "header" },
      { text: "User-Agent", description: "Client identity. Browser, app name, version. Some APIs require it.", insertable: true, insertTarget: "header" },
      { text: "Host", description: "Target hostname and port. Required in HTTP/1.1. E.g. Host: api.example.com.", insertable: true, insertTarget: "header" },
      { text: "Content-Length", description: "Body size in bytes. Required for POST/PUT unless chunked.", insertable: true, insertTarget: "header" },
      { text: "Cookie", description: "Send cookies to server. Format: name=value; name2=value2.", insertable: true, insertTarget: "header" },
      { text: "Referer", description: "URL of the page that linked to this request. Privacy: can be suppressed.", insertable: true, insertTarget: "header" },
      { text: "Origin", description: "Origin of the request (scheme + host + port). Used for CORS.", insertable: true, insertTarget: "header" },
      { text: "X-Requested-With", description: "Indicates AJAX request. Value: XMLHttpRequest. Used by some frameworks.", insertable: true, insertTarget: "header" },
      { text: "X-API-Key", description: "API key authentication. Custom header used by many APIs.", insertable: true, insertTarget: "header" },
      { text: "X-Forwarded-For", description: "Original client IP when behind proxy/LB. May contain chain of IPs.", insertable: true, insertTarget: "header" },
      { text: "X-Forwarded-Proto", description: "Original protocol (http/https) when behind proxy.", insertable: true, insertTarget: "header" },

      { text: "Caching Headers", description: "Control caching behavior between client, proxies, and server.", heading: true },
      { text: "Cache-Control", description: "Directives: no-cache, no-store, max-age=3600, must-revalidate, public, private.", insertable: true, insertTarget: "header" },
      { text: "If-None-Match", description: "Conditional GET. Value is ETag from previous response. 304 if unchanged.", insertable: true, insertTarget: "header" },
      { text: "If-Modified-Since", description: "Conditional GET. Date from previous Last-Modified. 304 if not modified since.", insertable: true, insertTarget: "header" },
      { text: "ETag", description: "Response header. Entity tag (version identifier). Used with If-None-Match for caching.", insertable: true, insertTarget: "header" },

      { text: "CORS Headers", description: "Cross-Origin Resource Sharing. Server must include these for browser cross-origin requests.", heading: true },
      { text: "Access-Control-Allow-Origin", description: "Which origins can access. * for any, or specific origin. Response header.", insertable: true, insertTarget: "header" },
      { text: "Access-Control-Allow-Methods", description: "Allowed methods for CORS. E.g. GET, POST, PUT, DELETE.", insertable: true, insertTarget: "header" },
      { text: "Access-Control-Allow-Headers", description: "Allowed request headers. E.g. Content-Type, Authorization, X-API-Key.", insertable: true, insertTarget: "header" },
      { text: "Access-Control-Max-Age", description: "How long preflight results can be cached (seconds).", insertable: true, insertTarget: "header" },

      { text: "Response Headers", description: "Headers the server sends back.", heading: true },
      { text: "Set-Cookie", description: "Set a cookie. name=value; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600.", insertable: true, insertTarget: "header" },
      { text: "Location", description: "Redirect URL (3xx) or newly created resource URL (201 Created).", insertable: true, insertTarget: "header" },
      { text: "WWW-Authenticate", description: "Authentication scheme for 401. E.g. Bearer realm=\"api\", Basic realm=\"protected\".", insertable: true, insertTarget: "header" },
      { text: "Retry-After", description: "Seconds to wait before retrying (429, 503). E.g. Retry-After: 60.", insertable: true, insertTarget: "header" },
      { text: "Content-Disposition", description: "How to handle body. inline (display) or attachment; filename=\"file.pdf\" (download).", insertable: true, insertTarget: "header" },

      { text: "Auth Patterns", description: "Common authentication approaches.", heading: true },
      { text: "Basic Auth", description: "Authorization: Basic base64(username:password). Simple but insecure over HTTP. Always use HTTPS." },
      { text: "Bearer Token", description: "Authorization: Bearer <token>. Used for OAuth2, JWT, API tokens. Most common for REST APIs." },
      { text: "API Key in Header", description: "X-API-Key: your-key-here. Custom header. Simple, no standard. Check API docs." },
      { text: "API Key in Query", description: "?api_key=your-key. Visible in URL/logs. Less secure than header." },
      { text: "OAuth2 Flow", description: "Client gets token from auth server → sends Bearer token with requests → refresh when expired." },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // HTTP: CONTENT TYPES
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "http-content-types",
    title: "HTTP Content Types",
    protocol: "http",
    content: [
      { text: "Common Content Types", description: "Set Content-Type header to tell the server what format the body is in.", heading: true },
      { text: "application/json", description: "JSON. Most common for REST APIs. {\"key\": \"value\"}.", insertable: true, insertTarget: "copy" },
      { text: "application/x-www-form-urlencoded", description: "Form encoding. key=value&key2=value2. Default for HTML forms.", insertable: true, insertTarget: "copy" },
      { text: "multipart/form-data", description: "File uploads. Each part has its own Content-Type. Used for binary data.", insertable: true, insertTarget: "copy" },
      { text: "text/plain", description: "Plain text. No formatting.", insertable: true, insertTarget: "copy" },
      { text: "text/html", description: "HTML content.", insertable: true, insertTarget: "copy" },
      { text: "text/xml / application/xml", description: "XML data. Used by SOAP, some legacy APIs.", insertable: true, insertTarget: "copy" },
      { text: "application/octet-stream", description: "Binary data. Used for file downloads, raw bytes.", insertable: true, insertTarget: "copy" },
      { text: "application/pdf", description: "PDF document.", insertable: true, insertTarget: "copy" },
      { text: "image/png / image/jpeg", description: "Image formats. Used in uploads and responses.", insertable: true, insertTarget: "copy" },
      { text: "application/graphql+json", description: "GraphQL request body. {\"query\": \"{ users { id name } }\"}.", insertable: true, insertTarget: "copy" },

      { text: "Accept Header Values", description: "Tell the server what response formats you accept.", heading: true },
      { text: "application/json", description: "Want JSON back. Most APIs." },
      { text: "*/*", description: "Accept anything. Browser default." },
      { text: "text/html,application/json;q=0.9", description: "Prefer HTML, accept JSON with lower priority." },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // HTTP: TEMPLATES
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "http-templates",
    title: "HTTP Templates",
    protocol: "http",
    content: [
      { text: "Quick-load templates", description: "Click to load a pre-built request into the HTTP builder.", heading: true },

      { text: "GET JSON", description: "Simple GET request expecting JSON response.", httpTemplate: { method: "GET", url: "https://api.example.com/resource" } },
      { text: "POST JSON", description: "Create a resource with JSON body.", httpTemplate: { method: "POST", url: "https://api.example.com/resource", bodyType: "json", bodyJson: '{\n  "name": "Example",\n  "email": "user@example.com"\n}' } },
      { text: "PUT Update", description: "Replace a resource with JSON body.", httpTemplate: { method: "PUT", url: "https://api.example.com/resource/1", bodyType: "json", bodyJson: '{\n  "name": "Updated Name",\n  "email": "updated@example.com"\n}' } },
      { text: "PATCH Partial Update", description: "Partially update a resource.", httpTemplate: { method: "PATCH", url: "https://api.example.com/resource/1", bodyType: "json", bodyJson: '{\n  "name": "New Name"\n}' } },
      { text: "DELETE", description: "Delete a resource by ID.", httpTemplate: { method: "DELETE", url: "https://api.example.com/resource/1" } },
      { text: "GraphQL Query", description: "GraphQL request template.", httpTemplate: { method: "POST", url: "https://api.example.com/graphql", bodyType: "json", bodyJson: '{\n  "query": "{ users { id name email } }",\n  "variables": {}\n}' } },
      { text: "Webhook Test", description: "POST a webhook payload.", httpTemplate: { method: "POST", url: "https://webhook.example.com/hook", bodyType: "json", bodyJson: '{\n  "event": "test",\n  "timestamp": "2024-01-01T00:00:00Z",\n  "data": {}\n}' } },
      { text: "Health Check", description: "Simple health/readiness endpoint.", httpTemplate: { method: "GET", url: "https://api.example.com/health" } },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // HTTP: REST PATTERNS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "http-patterns",
    title: "HTTP REST Patterns",
    protocol: "http",
    content: [
      { text: "REST API Conventions", description: "Standard patterns for RESTful API design and usage.", heading: true },
      { text: "GET /resources", description: "List all resources. Usually returns array. Supports pagination: ?page=1&limit=20." },
      { text: "GET /resources/:id", description: "Get a single resource by ID. Returns 404 if not found." },
      { text: "POST /resources", description: "Create a new resource. Body has the data. Returns 201 + Location header." },
      { text: "PUT /resources/:id", description: "Replace entire resource. Body is complete representation. Creates if not exists." },
      { text: "PATCH /resources/:id", description: "Partial update. Body has only changed fields." },
      { text: "DELETE /resources/:id", description: "Delete a resource. Returns 200 or 204." },

      { text: "Pagination", description: "Common patterns for paginating large result sets.", heading: true },
      { text: "Offset-based: ?page=2&limit=25", description: "Page number + page size. Simple. Inconsistent on insert/delete." },
      { text: "Cursor-based: ?after=abc123&limit=25", description: "Cursor (opaque token) marks position. Consistent even with changes. Preferred for large/real-time data." },
      { text: "Link header", description: "Link: <url?page=3>; rel=\"next\", <url?page=1>; rel=\"prev\". Standard pagination links." },

      { text: "Error Response Patterns", description: "Common error response body formats.", heading: true },
      { text: "RFC 7807 Problem Details", description: "{\"type\": \"uri\", \"title\": \"Not Found\", \"status\": 404, \"detail\": \"User 123 not found\"}. Content-Type: application/problem+json." },
      { text: "Simple error object", description: "{\"error\": \"not_found\", \"message\": \"User not found\"}. Common custom format." },
      { text: "Validation errors", description: "{\"errors\": [{\"field\": \"email\", \"message\": \"invalid format\"}]}. Array of field-specific errors." },

      { text: "Rate Limiting", description: "APIs limit request rate to prevent abuse.", heading: true },
      { text: "X-RateLimit-Limit", description: "Maximum requests allowed in the window." },
      { text: "X-RateLimit-Remaining", description: "Requests remaining in current window." },
      { text: "X-RateLimit-Reset", description: "Unix timestamp when the window resets." },
      { text: "429 Too Many Requests", description: "Rate limit exceeded. Check Retry-After header. Implement exponential backoff." },

      { text: "Versioning", description: "How APIs handle breaking changes.", heading: true },
      { text: "URL path: /v1/resources, /v2/resources", description: "Most common. Clear, easy to route." },
      { text: "Header: Accept: application/vnd.api+json;version=2", description: "Version in Accept header. Cleaner URLs." },
      { text: "Query param: ?version=2", description: "Simple but less standard." },

      { text: "CORS (Cross-Origin)", description: "Browser security for cross-origin requests.", heading: true },
      { text: "Simple requests", description: "GET, HEAD, POST with standard Content-Types. No preflight needed." },
      { text: "Preflight (OPTIONS)", description: "Browser sends OPTIONS before non-simple requests. Server must respond with Allow-Origin, Allow-Methods, Allow-Headers." },
      { text: "Credentials (cookies/auth)", description: "Need Access-Control-Allow-Credentials: true. Cannot use * for Allow-Origin." },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SSH: COMMANDS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "ssh-commands",
    title: "SSH Command Reference",
    protocol: "ssh",
    content: [
      { text: "Core SSH Commands", description: "Portable OpenSSH commands for day-to-day remote access and troubleshooting.", heading: true },
      { text: "ssh user@host", description: "Open an interactive SSH session to a host.", insertable: true, insertTarget: "copy" },
      { text: "ssh -p 2222 user@host", description: "Connect using a non-default SSH port.", insertable: true, insertTarget: "copy" },
      { text: "ssh -i ~/.ssh/id_ed25519 user@host", description: "Connect with a specific private key.", insertable: true, insertTarget: "copy" },
      { text: "ssh -v user@host", description: "Verbose output to debug connection/authentication flow.", insertable: true, insertTarget: "copy" },
      { text: "ssh -J jump@bastion user@target", description: "Connect through a jump host (bastion).", insertable: true, insertTarget: "copy" },
      { text: "ssh user@host 'uname -a'", description: "Run a one-off remote command and exit.", insertable: true, insertTarget: "copy" },
      { text: "ssh-copy-id user@host", description: "Install your public key on a remote host for key auth.", insertable: true, insertTarget: "copy" },
      { text: "ssh-keygen -t ed25519 -C \"name@host\"", description: "Generate a modern SSH keypair.", insertable: true, insertTarget: "copy" },
      { text: "ssh-keygen -l -f ~/.ssh/id_ed25519.pub", description: "Display a public key fingerprint.", insertable: true, insertTarget: "copy" },
      { text: "ssh-keyscan -H host >> ~/.ssh/known_hosts", description: "Add host key to known_hosts non-interactively.", insertable: true, insertTarget: "copy" },
    ],
  },
  {
    id: "ssh-tunnels",
    title: "SSH Tunnels & File Transfer",
    protocol: "ssh",
    content: [
      { text: "Tunnels", description: "Common forwarding patterns using local, remote, and SOCKS tunnels.", heading: true },
      { text: "ssh -L 5432:127.0.0.1:5432 user@db-host", description: "Local port forward for remote Postgres.", insertable: true, insertTarget: "copy" },
      { text: "ssh -R 2222:127.0.0.1:22 user@host", description: "Expose local SSH service on remote host.", insertable: true, insertTarget: "copy" },
      { text: "ssh -D 1080 user@host", description: "Create a local SOCKS5 proxy over SSH.", insertable: true, insertTarget: "copy" },
      { text: "ssh -N -L 8080:127.0.0.1:80 user@host", description: "Tunnel-only mode (no remote shell).", insertable: true, insertTarget: "copy" },
      { text: "File Transfer", description: "Portable upload/download commands over SSH.", heading: true },
      { text: "scp file.txt user@host:/tmp/", description: "Copy local file to remote host.", insertable: true, insertTarget: "copy" },
      { text: "scp user@host:/var/log/syslog ./", description: "Copy remote file to local machine.", insertable: true, insertTarget: "copy" },
      { text: "scp -P 2222 file.txt user@host:/tmp/", description: "SCP with custom SSH port.", insertable: true, insertTarget: "copy" },
      { text: "rsync -av ./local/ user@host:/remote/", description: "Sync directory to remote host with delta transfer.", insertable: true, insertTarget: "copy" },
      { text: "rsync -av --dry-run ./local/ user@host:/remote/", description: "Preview rsync changes before syncing.", insertable: true, insertTarget: "copy" },
      { text: "sftp user@host", description: "Interactive SFTP file transfer session.", insertable: true, insertTarget: "copy" },
    ],
  },
  {
    id: "mcp-quickstart",
    title: "MCP Quickstart",
    protocol: "mcp",
    content: [
      {
        text: "Model Context Protocol",
        description:
          "MCP lets SIPalyzer both consume external MCP servers and expose SIPalyzer capabilities to external MCP clients.",
        heading: true,
      },
      {
        text: "Tools integration",
        description:
          "Open Tools > MCP to create profiles, connect servers, browse tool catalogs, run single calls, and run multi-agent orchestration.",
      },
      {
        text: "Transports",
        description:
          "Use stdio transport for local command-based MCP servers, or network transport for remote endpoint-based servers.",
      },
      {
        text: "Hosted MCP server",
        description:
          "SIPalyzer can host an MCP server over stdio and/or network. Network mode uses auth token access controls.",
      },
      {
        text: "Operational guidance",
        description:
          "Validate tool schemas before calls, keep payloads deterministic, and review audit/activity logs after orchestration runs.",
      },
      {
        text: "Native integration",
        description:
          "MCP status and orchestration progress events are tracked globally, so Tools > MCP activity stays consistent with notifications and persisted session state.",
      },
    ],
  },
  {
    id: "mcp-runbook",
    title: "MCP Operations Runbook",
    protocol: "mcp",
    content: [
      { text: "Connection troubleshooting", description: "Verify endpoint/command values, credentials/tokens, and network reachability.", heading: true },
      { text: "Schema mismatch", description: "If tool calls fail, compare arguments against input schema and retry with minimal JSON payload." },
      { text: "Orchestration safety", description: "For multi-agent runs, use idempotent tasks and compare outputs before executing irreversible actions." },
      { text: "Security posture", description: "Rotate hosted server tokens, limit exposed tools, and disable hosting during incident response." },
      { text: "Auditability", description: "Use Admin Center and MCP activity feeds to trace calls, progress events, and failures." },
      { text: "UI placement", description: "MCP is built directly into Tools as a native subview to match SIPalyzer workflow and navigation patterns." },
    ],
  },
];
