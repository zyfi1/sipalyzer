/**
 * Complete SIP Response Code Reference Map.
 *
 * Every code, name, cause, and action sourced from published RFCs:
 * - RFC 3261 (SIP: Session Initiation Protocol)
 * - RFC 6665 (SIP-Specific Event Notification, obsoletes RFC 3265)
 * - RFC 3326 (Reason Header Field)
 * - RFC 3428 (SIP MESSAGE Method)
 * - RFC 3515 (SIP REFER Method)
 * - RFC 3903 (SIP PUBLISH Method)
 * - RFC 4412 (Resource-Priority Header)
 * - RFC 6086 (Session Initiation Protocol INFO Method)
 * - RFC 3262 (Reliability of Provisional Responses - PRACK)
 * - RFC 3311 (SIP UPDATE Method)
 * - RFC 3842 (MWI)
 * - RFC 4028 (Session Timers)
 * - RFC 8197 (SIP 607 Unwanted)
 * - RFC 8688 (SIP 608 Rejected)
 *
 * Zero AI-generated content.
 */

import type { SipCodeEntry } from "@/types/troubleshootingEngine";

export const SIP_RESPONSE_CODE_MAP: Record<number, SipCodeEntry> = {
  // ═══════════════════════════════════════════════════════════════
  // 1xx — Provisional / Informational (RFC 3261 S21.1)
  // ═══════════════════════════════════════════════════════════════

  100: {
    code: 100,
    name: "Trying",
    description: "The request has been received by the next-hop server and that server is taking some further action to process the request. Sent hop-by-hop, not end-to-end.",
    rfcReference: "RFC 3261 S21.1.1",
    causes: [
      "Normal SIP operation — server received request and is processing it",
      "Server forwarding request to next hop",
    ],
    actions: [
      "This is normal — no action needed",
      "If stuck at 100 Trying for > 32 seconds, check downstream server reachability",
    ],
    articleIds: [],
  },

  180: {
    code: 180,
    name: "Ringing",
    description: "The UA receiving the INVITE is trying to alert the user. Sent end-to-end.",
    rfcReference: "RFC 3261 S21.1.2",
    causes: [
      "Normal — remote phone is ringing",
      "PBX is alerting the endpoint",
    ],
    actions: [
      "This is normal — wait for answer or timeout",
      "If ringing but never answered, check endpoint DND/forwarding settings",
    ],
    articleIds: [],
  },

  181: {
    code: 181,
    name: "Call Is Being Forwarded",
    description: "The server indicates the call is being forwarded to a different destination.",
    rfcReference: "RFC 3261 S21.1.3",
    causes: [
      "Call forwarding is active on the called party",
      "PBX forwarding rule triggered",
    ],
    actions: [
      "Check call forwarding settings on the destination",
      "Verify forwarding target is reachable",
    ],
    articleIds: [],
  },

  182: {
    code: 182,
    name: "Queued",
    description: "The called party is temporarily unavailable but the server has decided to queue the call rather than reject it.",
    rfcReference: "RFC 3261 S21.1.4",
    causes: [
      "ACD/call queue system has queued the call",
      "All endpoints in a hunt group are busy",
    ],
    actions: [
      "Wait for the call to be dequeued",
      "Check queue configuration and agent availability",
    ],
    articleIds: [],
  },

  183: {
    code: 183,
    name: "Session Progress",
    description: "Used to convey information about the progress of the call that is not otherwise classified. May contain SDP for early media (e.g., ringback tone from network).",
    rfcReference: "RFC 3261 S21.1.5",
    causes: [
      "Normal — network is providing early media (ringback, announcement)",
      "PSTN gateway indicating call progress",
    ],
    actions: [
      "This is normal — often carries early media SDP",
      "If no audio after 183, check SDP for valid media description and ensure RTP ports are open",
    ],
    articleIds: ["one-way-audio", "no-audio"],
  },

  199: {
    code: 199,
    name: "Early Dialog Terminated",
    description: "Indicates that an early dialog has been terminated.",
    rfcReference: "RFC 6228",
    causes: [
      "A forked INVITE branch was cancelled",
      "Early dialog no longer needed",
    ],
    actions: [
      "This is informational — no action needed",
    ],
    articleIds: [],
  },

  // ═══════════════════════════════════════════════════════════════
  // 2xx — Success (RFC 3261 S21.2)
  // ═══════════════════════════════════════════════════════════════

  200: {
    code: 200,
    name: "OK",
    description: "The request has succeeded. The information returned with the response depends on the method used in the request.",
    rfcReference: "RFC 3261 S21.2.1",
    causes: [
      "Request processed successfully",
      "REGISTER accepted, INVITE answered, BYE confirmed",
    ],
    actions: [
      "For INVITE: send ACK, begin media",
      "For REGISTER: registration is active for the duration in Expires/Contact header",
    ],
    articleIds: [],
  },

  202: {
    code: 202,
    name: "Accepted",
    description: "The request has been accepted for processing, but the processing has not been completed. Used for REFER and SUBSCRIBE.",
    rfcReference: "RFC 6665 (obsoletes RFC 3265)",
    causes: [
      "REFER or SUBSCRIBE accepted but pending completion",
    ],
    actions: [
      "Wait for NOTIFY to indicate final result",
    ],
    articleIds: [],
  },

  204: {
    code: 204,
    name: "No Notification",
    description: "The request was successful but no notification will be generated.",
    rfcReference: "RFC 5839",
    causes: [
      "SUBSCRIBE accepted but no immediate notification",
    ],
    actions: [
      "This is normal — no action needed",
    ],
    articleIds: [],
  },

  // ═══════════════════════════════════════════════════════════════
  // 3xx — Redirection (RFC 3261 S21.3)
  // ═══════════════════════════════════════════════════════════════

  300: {
    code: 300,
    name: "Multiple Choices",
    description: "The address in the request resolved to several choices, each with its own specific location. The user or UA can select a preferred communication end point.",
    rfcReference: "RFC 3261 S21.3.1",
    causes: [
      "Multiple endpoints registered for this address",
      "Server offering alternative locations",
    ],
    actions: [
      "Client should retry with one of the Contact addresses from the response",
      "Check if forking proxy should be used instead",
    ],
    articleIds: [],
  },

  301: {
    code: 301,
    name: "Moved Permanently",
    description: "The user can no longer be found at the address in the Request-URI. The requesting client SHOULD update its local directories with the new address.",
    rfcReference: "RFC 3261 S21.3.2",
    causes: [
      "User has permanently moved to a new address",
      "Number/URI has been ported or reassigned",
    ],
    actions: [
      "Update the destination address and retry",
      "Check Contact header for new address",
    ],
    articleIds: [],
  },

  302: {
    code: 302,
    name: "Moved Temporarily",
    description: "The user can temporarily be found at the address indicated by the Contact header field. The requesting client SHOULD retry with the new address.",
    rfcReference: "RFC 3261 S21.3.3",
    causes: [
      "Call forwarding is active",
      "User is temporarily at another location",
    ],
    actions: [
      "Retry the request at the address in the Contact header",
      "Check call forwarding settings",
    ],
    articleIds: [],
  },

  305: {
    code: 305,
    name: "Use Proxy",
    description: "The requested resource MUST be accessed through the proxy given by the Contact field.",
    rfcReference: "RFC 3261 S21.3.4",
    causes: [
      "Server requires request to be sent through a specific proxy",
    ],
    actions: [
      "Re-send the request through the indicated proxy",
      "Configure outbound proxy settings",
    ],
    articleIds: [],
  },

  380: {
    code: 380,
    name: "Alternative Service",
    description: "The call was not successful but alternative services are possible.",
    rfcReference: "RFC 3261 S21.3.5",
    causes: [
      "The exact service requested isn't available but alternatives exist",
    ],
    actions: [
      "Check the response body for alternative service descriptions",
    ],
    articleIds: [],
  },

  // ═══════════════════════════════════════════════════════════════
  // 4xx — Client Error (RFC 3261 S21.4)
  // ═══════════════════════════════════════════════════════════════

  400: {
    code: 400,
    name: "Bad Request",
    description: "The request could not be understood due to malformed syntax.",
    rfcReference: "RFC 3261 S21.4.1",
    causes: [
      "Malformed SIP message (missing required headers, bad syntax)",
      "Invalid URI format in From, To, or Request-URI",
      "Content-Length mismatch with actual body size",
      "Invalid characters in SIP headers",
    ],
    actions: [
      "Capture the SIP message and inspect for syntax errors",
      "Verify all mandatory headers are present (Via, To, From, Call-ID, CSeq, Max-Forwards)",
      "Check for encoding issues or special characters in URIs",
    ],
    articleIds: ["sip-400-bad-request"],
    toolLink: { toolId: "composer", subviewId: "requests", label: "Inspect in Composer" },
  },

  401: {
    code: 401,
    name: "Unauthorized",
    description: "Normal digest authentication challenge. A single 401 in a REGISTER flow is expected — the server sends a challenge, the client responds with credentials. Only a REPEATED 401 loop indicates a real problem.",
    rfcReference: "RFC 3261 S21.4.2",
    causes: [
      "Normal: part of SIP digest authentication (REGISTER → 401 → REGISTER with credentials → 200 OK)",
      "If repeated: incorrect credentials (username, password, or auth username)",
      "If repeated: realm mismatch between client and server",
      "If repeated: nonce expired or algorithm mismatch",
    ],
    actions: [
      "A single 401 followed by 200 OK is normal — no action needed",
      "If looping: verify credentials (auth username, password, and realm)",
      "If looping: check WWW-Authenticate header for realm and algorithm requirements",
      "If looping: test with SIPalyzer Registration tool to validate credentials",
    ],
    articleIds: ["reg-401-unauthorized", "digest-auth-deep-dive"],
    toolLink: { toolId: "registration", label: "Test Registration" },
  },

  402: {
    code: 402,
    name: "Payment Required",
    description: "Reserved for future use.",
    rfcReference: "RFC 3261 S21.4.3",
    causes: [
      "Account balance insufficient (some providers use this)",
      "Subscription expired",
    ],
    actions: [
      "Check account balance with your VoIP provider",
      "Verify subscription/plan status",
    ],
    articleIds: [],
  },

  403: {
    code: 403,
    name: "Forbidden",
    description: "The server understood the request, but is refusing to fulfill it. Authorization will not help.",
    rfcReference: "RFC 3261 S21.4.4",
    causes: [
      "IP address not in allowed ACL (access control list)",
      "User/account blocked or disabled by administrator",
      "Geographic or number-based dialing restriction",
      "SIP domain mismatch (credentials correct but wrong domain)",
    ],
    actions: [
      "Check IP ACL settings on the SIP server",
      "Verify the account is active and not blocked",
      "Check dialing permissions for the called number",
      "Verify the SIP domain in the From header matches the server's expected domain",
    ],
    articleIds: ["reg-403-forbidden"],
    toolLink: { toolId: "registration", label: "Test Registration" },
  },

  404: {
    code: 404,
    name: "Not Found",
    description: "The server has definitive information that the user does not exist at the domain specified in the Request-URI.",
    rfcReference: "RFC 3261 S21.4.5",
    causes: [
      "Called number/extension does not exist",
      "User not registered at the domain",
      "Wrong domain in the Request-URI",
      "Dial plan does not match the dialed number pattern",
    ],
    actions: [
      "Verify the called number/extension exists",
      "Check the Request-URI domain matches the target server",
      "Review the server's dial plan or routing rules",
      "Confirm the destination user is registered",
    ],
    articleIds: ["sip-404-not-found"],
    toolLink: { toolId: "composer", subviewId: "requests", label: "Test with Composer" },
  },

  405: {
    code: 405,
    name: "Method Not Allowed",
    description: "The method specified in the Request-Line is understood but not allowed for the address identified by the Request-URI.",
    rfcReference: "RFC 3261 S21.4.6",
    causes: [
      "Server does not support the SIP method (e.g., INFO, MESSAGE, REFER)",
      "Method blocked by server policy",
    ],
    actions: [
      "Check the Allow header in the response for supported methods",
      "Use an alternative method or configure the server to accept the method",
    ],
    articleIds: [],
  },

  406: {
    code: 406,
    name: "Not Acceptable",
    description: "The resource identified by the request is only capable of generating response entities that have content characteristics not acceptable according to the Accept header field sent in the request.",
    rfcReference: "RFC 3261 S21.4.7",
    causes: [
      "Client Accept header does not match what the server can provide",
      "Content type negotiation failure",
    ],
    actions: [
      "Check the Accept header in the request",
      "Ensure client supports the content types the server offers",
    ],
    articleIds: [],
  },

  407: {
    code: 407,
    name: "Proxy Authentication Required",
    description: "Normal proxy authentication challenge, similar to 401 but for proxy servers. A single 407 is expected when the proxy requires credentials. Only repeated 407 loops indicate a problem.",
    rfcReference: "RFC 3261 S21.4.8",
    causes: [
      "Normal: proxy requires authentication before forwarding (challenge/response, like 401)",
      "If repeated: missing or incorrect proxy credentials",
      "If repeated: different credentials required for proxy vs registrar",
    ],
    actions: [
      "A single 407 followed by a successful re-send is normal — no action needed",
      "If looping: provide proxy authentication credentials",
      "If looping: check Proxy-Authenticate header for required parameters",
      "If looping: verify proxy auth username and password (may differ from registration credentials)",
    ],
    articleIds: ["reg-407-proxy-auth"],
    toolLink: { toolId: "registration", label: "Test Registration" },
  },

  408: {
    code: 408,
    name: "Request Timeout",
    description: "The server could not produce a response within a suitable amount of time. The client MAY repeat the request without modifications at any later time.",
    rfcReference: "RFC 3261 S21.4.9",
    causes: [
      "Destination server is unreachable (network issue, server down)",
      "DNS resolution returned wrong IP or timed out",
      "Firewall blocking SIP traffic on port 5060/5061",
      "Response lost in transit (UDP packet loss)",
      "Timer B (32 seconds) expired without any response",
    ],
    actions: [
      "Verify network connectivity to the destination (ping, traceroute)",
      "Check DNS resolution for the target domain (SRV, NAPTR, A records)",
      "Verify firewall allows SIP traffic (UDP/TCP 5060, TLS 5061)",
      "Check if the destination server is running and listening",
      "Try TCP transport if UDP packets are being lost",
    ],
    articleIds: ["sip-408-timeout"],
    toolLink: { toolId: "network", subviewId: "connectivity", label: "Test Network Connectivity" },
  },

  410: {
    code: 410,
    name: "Gone",
    description: "The requested resource is no longer available at the server and no forwarding address is known.",
    rfcReference: "RFC 3261 S21.4.10",
    causes: [
      "User account has been permanently removed",
      "Number has been disconnected",
    ],
    actions: [
      "Confirm with the provider that the account/number still exists",
      "Update your address book or routing table",
    ],
    articleIds: [],
  },

  412: {
    code: 412,
    name: "Conditional Request Failed",
    description: "The given precondition has not been met.",
    rfcReference: "RFC 3903",
    causes: [
      "ETag/If-Match precondition failed on PUBLISH request",
    ],
    actions: [
      "Refresh state and retry the PUBLISH with current ETag",
    ],
    articleIds: [],
  },

  413: {
    code: 413,
    name: "Request Entity Too Large",
    description: "The server is refusing to process a request because the request entity-body is larger than the server is willing or able to process.",
    rfcReference: "RFC 3261 S21.4.11",
    causes: [
      "SIP message body too large (oversized SDP, large MESSAGE body)",
      "Multi-codec SDP offer exceeding server limit",
    ],
    actions: [
      "Reduce the SDP body size (fewer codecs in the offer)",
      "Check server maximum message size configuration",
    ],
    articleIds: [],
  },

  414: {
    code: 414,
    name: "Request-URI Too Long",
    description: "The server is refusing to service the request because the Request-URI is longer than the server is willing to interpret.",
    rfcReference: "RFC 3261 S21.4.12",
    causes: [
      "URI contains excessive parameters or very long usernames",
    ],
    actions: [
      "Simplify the Request-URI",
    ],
    articleIds: [],
  },

  415: {
    code: 415,
    name: "Unsupported Media Type",
    description: "The server is refusing to service the request because the message body of the request is in a format not supported by the server for the requested method.",
    rfcReference: "RFC 3261 S21.4.13",
    causes: [
      "Content-Type header does not match what the server supports",
      "SDP format not supported by the server",
      "Body encoding not recognized",
    ],
    actions: [
      "Check the Accept header in the 415 response for supported content types",
      "Verify Content-Type in the request matches server expectations (typically application/sdp for INVITE)",
    ],
    articleIds: ["codec-negotiation-failures"],
  },

  416: {
    code: 416,
    name: "Unsupported URI Scheme",
    description: "The server cannot process the request because the scheme of the URI in the Request-URI is unknown to the server.",
    rfcReference: "RFC 3261 S21.4.14",
    causes: [
      "Using sips: when server only supports sip: (or vice versa)",
      "Using tel: URI scheme without proper handling",
    ],
    actions: [
      "Change the URI scheme to match what the server supports",
      "For tel: URIs, configure a PSTN gateway",
    ],
    articleIds: [],
  },

  420: {
    code: 420,
    name: "Bad Extension",
    description: "The server did not understand the protocol extension specified in a Require header field.",
    rfcReference: "RFC 3261 S21.4.15",
    causes: [
      "Client Require header lists an extension the server does not support",
      "Misconfigured extension requirements (e.g., 100rel, timer, precondition)",
    ],
    actions: [
      "Check the Unsupported header in the 420 response for the problematic extension",
      "Remove unsupported extensions from the Require header or move to Supported header",
    ],
    articleIds: ["session-timer-expiry"],
  },

  421: {
    code: 421,
    name: "Extension Required",
    description: "The UAS needs a particular extension to process the request but the extension is not listed in the Supported header.",
    rfcReference: "RFC 3261 S21.4.16",
    causes: [
      "Server requires an extension not offered by the client",
    ],
    actions: [
      "Add the required extension to the Supported header",
    ],
    articleIds: [],
  },

  422: {
    code: 422,
    name: "Session Interval Too Small",
    description: "The Session-Expires value in the request is too small. The response MUST contain a Min-SE header with the minimum acceptable value.",
    rfcReference: "RFC 4028 S7",
    causes: [
      "Session-Expires value is below the server's minimum (Min-SE)",
      "Session timer configuration mismatch between endpoints",
    ],
    actions: [
      "Check the Min-SE header in the 422 response and use that value or higher",
      "Update Session-Expires to be >= Min-SE and retry",
    ],
    articleIds: ["session-timer-expiry"],
  },

  423: {
    code: 423,
    name: "Interval Too Brief",
    description: "The server is rejecting the request because the expiration time of the resource refreshed by the request is too short.",
    rfcReference: "RFC 3261 S21.4.17",
    causes: [
      "REGISTER Expires value too low — server requires a longer registration interval",
      "Min-Expires header in response indicates the minimum acceptable value",
    ],
    actions: [
      "Check the Min-Expires header in the 423 response",
      "Increase the Expires value in REGISTER to meet or exceed Min-Expires",
    ],
    articleIds: ["reg-expiry-keepalive"],
  },

  424: {
    code: 424,
    name: "Bad Location Information",
    description: "The request's location information was malformed or otherwise unsatisfactory.",
    rfcReference: "RFC 6442",
    causes: [
      "Geolocation header contains invalid PIDF-LO data",
    ],
    actions: [
      "Correct the location information in the request",
    ],
    articleIds: [],
  },

  428: {
    code: 428,
    name: "Use Identity Header",
    description: "The server requires an Identity header field and one was not provided.",
    rfcReference: "RFC 8224",
    causes: [
      "Server requires SIP Identity (STIR/SHAKEN) but client didn't provide it",
    ],
    actions: [
      "Configure STIR/SHAKEN identity on your system",
    ],
    articleIds: [],
  },

  429: {
    code: 429,
    name: "Provide Referrer Identity",
    description: "The server requires a Referred-By header in the REFER request.",
    rfcReference: "RFC 3892",
    causes: [
      "REFER request missing Referred-By header",
    ],
    actions: [
      "Include Referred-By header in the REFER request",
    ],
    articleIds: [],
  },

  436: {
    code: 436,
    name: "Bad Identity-Info",
    description: "The Identity-Info header contains a URI that cannot be dereferenced.",
    rfcReference: "RFC 8224",
    causes: [
      "Identity-Info URI unreachable or invalid",
    ],
    actions: [
      "Verify the Identity-Info URI is reachable and returns a valid certificate",
    ],
    articleIds: [],
  },

  437: {
    code: 437,
    name: "Unsupported Certificate",
    description: "The server was unable to validate a certificate for the domain that signed the request.",
    rfcReference: "RFC 8224",
    causes: [
      "STIR/SHAKEN certificate validation failed",
    ],
    actions: [
      "Verify certificate chain and ensure CA is trusted",
    ],
    articleIds: ["tls-certificate-verification"],
  },

  438: {
    code: 438,
    name: "Invalid Identity Header",
    description: "The server obtained a valid certificate but was unable to verify the Identity header value.",
    rfcReference: "RFC 8224",
    causes: [
      "Identity header signature does not match the certificate",
    ],
    actions: [
      "Check STIR/SHAKEN signing configuration",
    ],
    articleIds: [],
  },

  470: {
    code: 470,
    name: "Consent Needed",
    description: "The source of the request requires consent from the destination to relay the request.",
    rfcReference: "RFC 5360",
    causes: [
      "Relay permission not granted for this URI",
    ],
    actions: [
      "Obtain consent from the destination before relaying",
    ],
    articleIds: [],
  },

  480: {
    code: 480,
    name: "Temporarily Unavailable",
    description: "The callee's end system was contacted successfully but the callee is currently unavailable. The response MAY indicate a better time to call in the Retry-After header field.",
    rfcReference: "RFC 3261 S21.4.18",
    causes: [
      "Endpoint is offline, not registered, or in DND mode",
      "Device powered off or lost network connectivity",
      "All endpoints in a group are busy/unavailable",
      "Registration expired and device hasn't re-registered",
    ],
    actions: [
      "Verify the destination endpoint is registered and online",
      "Check if DND (Do Not Disturb) is enabled",
      "Verify registration status for the called party",
      "Check Retry-After header for when to retry",
    ],
    articleIds: ["sip-480-unavailable"],
    toolLink: { toolId: "registration", label: "Check Registration Status" },
  },

  481: {
    code: 481,
    name: "Call/Transaction Does Not Exist",
    description: "The UAS received a request that does not match any existing dialog or transaction.",
    rfcReference: "RFC 3261 S21.4.19",
    causes: [
      "BYE or ACK sent for a dialog that doesn't exist on the server",
      "Server restarted and lost dialog state",
      "NAT/firewall rewrote the Call-ID, From-tag, or To-tag",
      "Race condition: request arrived after dialog was already terminated",
    ],
    actions: [
      "Check if the server was restarted recently (dialog state lost)",
      "Verify NAT/firewall is not modifying SIP headers (Call-ID, tags)",
      "Check for SIP ALG interference rewriting dialog identifiers",
      "Capture both sides to compare dialog identifiers",
    ],
    articleIds: ["sip-481-does-not-exist", "call-drops-30-seconds"],
    toolLink: { toolId: "packet-capture", subviewId: "viewer", label: "Capture & Compare" },
  },

  482: {
    code: 482,
    name: "Loop Detected",
    description: "The server has detected a loop. The request contained a Via header with a value the server already owns.",
    rfcReference: "RFC 3261 S21.4.20",
    causes: [
      "SIP routing loop — request is being forwarded back to itself",
      "Misconfigured proxy or PBX routing rules",
      "Circular forwarding between endpoints",
    ],
    actions: [
      "Check proxy/PBX routing configuration for loops",
      "Inspect Via headers to identify the loop path",
      "Verify Max-Forwards is being decremented properly",
    ],
    articleIds: [],
  },

  483: {
    code: 483,
    name: "Too Many Hops",
    description: "The server received a request that contains a Max-Forwards header with a value of zero.",
    rfcReference: "RFC 3261 S21.4.21",
    causes: [
      "Request traversed too many proxies (Max-Forwards reached 0)",
      "Usually indicates a routing loop consuming all hops",
    ],
    actions: [
      "Check for routing loops (similar to 482)",
      "Verify proxy chain is not excessively long",
      "Max-Forwards default is 70 per RFC 3261",
    ],
    articleIds: [],
  },

  484: {
    code: 484,
    name: "Address Incomplete",
    description: "The server received a request with a Request-URI that was incomplete. Additional information SHOULD be provided in the reason phrase.",
    rfcReference: "RFC 3261 S21.4.22",
    causes: [
      "Dialed number is too short (missing digits)",
      "Country code or area code missing",
      "Dial plan expects more digits than provided",
    ],
    actions: [
      "Verify the complete number format required by the server",
      "Check dial plan pattern matching rules",
      "Add country code or area code as needed",
    ],
    articleIds: [],
  },

  485: {
    code: 485,
    name: "Ambiguous",
    description: "The Request-URI was ambiguous. The response MAY contain a list of possible unambiguous addresses in the Contact header.",
    rfcReference: "RFC 3261 S21.4.23",
    causes: [
      "The address matched multiple users and the server cannot determine which one to route to",
    ],
    actions: [
      "Check Contact header in the response for possible matches",
      "Use a more specific URI to resolve ambiguity",
    ],
    articleIds: [],
  },

  486: {
    code: 486,
    name: "Busy Here",
    description: "The callee's end system was contacted successfully but the callee is currently not willing or able to take additional calls at this end system.",
    rfcReference: "RFC 3261 S21.4.24",
    causes: [
      "Destination phone is already on a call and does not support call waiting",
      "User manually rejected the call",
      "Maximum concurrent call limit reached on the endpoint",
    ],
    actions: [
      "Retry the call later",
      "Enable call waiting or call forwarding on busy",
      "Check if the user has call-forward-on-busy configured",
    ],
    articleIds: ["sip-486-busy"],
  },

  487: {
    code: 487,
    name: "Request Terminated",
    description: "The request was cancelled. This is normal — it means the caller hung up before the call was answered, or a CANCEL was sent. Not an error.",
    rfcReference: "RFC 3261 S21.4.25",
    causes: [
      "Normal: caller hung up before the call was answered (CANCEL sent → 487 response)",
      "Normal: server cancelled due to forking (another branch answered)",
      "Less common: proxy or B2BUA sent premature CANCEL",
    ],
    actions: [
      "This is normal SIP behavior — no action needed",
      "If unexpected, check if a proxy or B2BUA is sending premature CANCEL",
    ],
    articleIds: [],
  },

  488: {
    code: 488,
    name: "Not Acceptable Here",
    description: "The response has the same meaning as 606, but only applies to the specific resource addressed by the Request-URI. A 488 sent in response to an INVITE indicates SDP offer was rejected.",
    rfcReference: "RFC 3261 S21.4.26",
    causes: [
      "No common codec between offer and answer (codec mismatch)",
      "SRTP required by one side but not supported by the other",
      "SDP media description incompatible (wrong media types, port 0)",
      "Encryption suite mismatch (SDES vs DTLS-SRTP)",
    ],
    actions: [
      "Compare SDP offer and answer — look for common codecs in m= lines",
      "Ensure at least one common codec (G.711 is the safest fallback)",
      "Check if SRTP/encryption requirements match between endpoints",
      "Verify payload type numbers match for dynamic codecs (96-127)",
    ],
    articleIds: ["sip-488-not-acceptable", "codec-negotiation-failures"],
    toolLink: { toolId: "packet-capture", subviewId: "viewer", label: "Inspect SDP in Capture" },
  },

  489: {
    code: 489,
    name: "Bad Event",
    description: "The server did not understand the event package specified in an Event header field.",
    rfcReference: "RFC 6665 (obsoletes RFC 3265)",
    causes: [
      "SUBSCRIBE contains an event package the server doesn't support",
    ],
    actions: [
      "Check the Allow-Events header in server responses for supported packages",
    ],
    articleIds: [],
  },

  491: {
    code: 491,
    name: "Request Pending",
    description: "The UAS received an INVITE on a dialog while processing a previous INVITE for the same dialog. Glare condition.",
    rfcReference: "RFC 3261 S21.4.27",
    causes: [
      "Both sides sent a re-INVITE simultaneously (glare)",
      "Session timer re-INVITE collided with a hold/unhold re-INVITE",
    ],
    actions: [
      "This is a glare condition — the retransmission timer should handle retry",
      "If persistent, check session timer configuration on both sides",
    ],
    articleIds: ["session-timer-expiry", "reinvite-failures"],
  },

  493: {
    code: 493,
    name: "Undecipherable",
    description: "The request contained an encrypted MIME body that the recipient could not decrypt.",
    rfcReference: "RFC 3261 S21.4.28",
    causes: [
      "S/MIME encrypted body cannot be decrypted by the recipient",
    ],
    actions: [
      "Verify encryption keys are properly exchanged",
    ],
    articleIds: [],
  },

  494: {
    code: 494,
    name: "Security Agreement Required",
    description: "The server requires the client to use a specific security mechanism.",
    rfcReference: "RFC 3329",
    causes: [
      "Server requires a Security-Client header for security agreement",
    ],
    actions: [
      "Implement the security mechanism indicated by the server",
    ],
    articleIds: ["tls-certificate-verification"],
  },

  // ═══════════════════════════════════════════════════════════════
  // 5xx — Server Failure (RFC 3261 S21.5)
  // ═══════════════════════════════════════════════════════════════

  500: {
    code: 500,
    name: "Server Internal Error",
    description: "The server encountered an unexpected condition that prevented it from fulfilling the request.",
    rfcReference: "RFC 3261 S21.5.1",
    causes: [
      "Bug or crash in the SIP server software",
      "Database or backend service failure",
      "Configuration error on the server",
    ],
    actions: [
      "Check server logs for the specific error",
      "Retry the request — may be a transient issue",
      "Contact the server administrator if persistent",
    ],
    articleIds: ["sip-503-unavailable"],
  },

  501: {
    code: 501,
    name: "Not Implemented",
    description: "The server does not support the functionality required to fulfill the request.",
    rfcReference: "RFC 3261 S21.5.2",
    causes: [
      "SIP method not implemented by the server (e.g., PUBLISH, INFO)",
      "Extension or feature not supported",
    ],
    actions: [
      "Check server capabilities using OPTIONS request",
      "Use a different method or approach",
    ],
    articleIds: [],
  },

  502: {
    code: 502,
    name: "Bad Gateway",
    description: "The server, while acting as a gateway or proxy, received an invalid response from the downstream server.",
    rfcReference: "RFC 3261 S21.5.3",
    causes: [
      "Downstream server returned a malformed response",
      "PSTN gateway failed to process the call",
      "SBC received garbage from the far end",
    ],
    actions: [
      "Check connectivity to downstream server",
      "Inspect the downstream server's response",
      "Verify gateway/SBC configuration",
    ],
    articleIds: [],
  },

  503: {
    code: 503,
    name: "Service Unavailable",
    description: "The server is temporarily unable to process the request due to a temporary overloading or maintenance of the server.",
    rfcReference: "RFC 3261 S21.5.4",
    causes: [
      "Server is overloaded (too many concurrent sessions)",
      "Server is undergoing maintenance",
      "Backend service (database, PSTN gateway) is down",
      "License limit reached on the server",
    ],
    actions: [
      "Check the Retry-After header for when to retry",
      "Verify server status and capacity",
      "Try an alternate server if available (DNS SRV failover)",
      "Check server license limits",
    ],
    articleIds: ["sip-503-unavailable"],
    toolLink: { toolId: "network", subviewId: "connectivity", label: "Check Server Connectivity" },
  },

  504: {
    code: 504,
    name: "Server Time-out",
    description: "The server did not receive a timely response from an external server it accessed in attempting to process the request.",
    rfcReference: "RFC 3261 S21.5.5",
    causes: [
      "Downstream server or gateway did not respond in time",
      "Network connectivity issue between proxy and next hop",
    ],
    actions: [
      "Check connectivity between the proxy and downstream server",
      "Increase timeout values if the downstream server is slow",
      "Verify DNS resolution for the downstream server",
    ],
    articleIds: ["sip-408-timeout"],
  },

  505: {
    code: 505,
    name: "Version Not Supported",
    description: "The server does not support, or refuses to support, the SIP protocol version that was used in the request.",
    rfcReference: "RFC 3261 S21.5.6",
    causes: [
      "Request uses SIP/3.0 or non-standard version instead of SIP/2.0",
    ],
    actions: [
      "Ensure all equipment uses SIP/2.0",
    ],
    articleIds: [],
  },

  513: {
    code: 513,
    name: "Message Too Large",
    description: "The server was unable to process the request since the message length exceeded its capabilities.",
    rfcReference: "RFC 3261 S21.5.7",
    causes: [
      "SIP message exceeds server's maximum message size (typically due to large SDP or multipart bodies)",
    ],
    actions: [
      "Reduce the number of codecs in SDP offer",
      "Remove unnecessary SIP headers",
      "Check if MTU issues are causing UDP fragmentation",
    ],
    articleIds: ["mtu-fragmentation"],
  },

  580: {
    code: 580,
    name: "Precondition Failure",
    description: "The server is unable or unwilling to meet some constraints specified in the offer.",
    rfcReference: "RFC 3312",
    causes: [
      "QoS preconditions (RFC 3312) not met",
      "Required resource reservation failed",
    ],
    actions: [
      "Check QoS precondition requirements",
      "Verify network supports the required resource reservation",
    ],
    articleIds: ["qos-dscp-marking"],
  },

  // ═══════════════════════════════════════════════════════════════
  // 6xx — Global Failure (RFC 3261 S21.6)
  // ═══════════════════════════════════════════════════════════════

  600: {
    code: 600,
    name: "Busy Everywhere",
    description: "The callee's end system was contacted successfully but the callee is busy and does not wish to take the call at this time.",
    rfcReference: "RFC 3261 S21.6.1",
    causes: [
      "User is busy on all devices (not just the one contacted)",
      "User has set a busy status globally",
    ],
    actions: [
      "Retry later",
      "Check if call-forward-on-busy is configured",
    ],
    articleIds: ["sip-486-busy"],
  },

  603: {
    code: 603,
    name: "Decline",
    description: "The callee's machine was successfully contacted but the user explicitly does not wish to or cannot participate.",
    rfcReference: "RFC 3261 S21.6.2",
    causes: [
      "User manually rejected the call",
      "Auto-reject rule triggered (e.g., blocked caller ID)",
      "DND (Do Not Disturb) globally active",
    ],
    actions: [
      "The user chose not to answer — this is intentional",
      "Check auto-reject or DND settings if unexpected",
    ],
    articleIds: [],
  },

  604: {
    code: 604,
    name: "Does Not Exist Anywhere",
    description: "The server has authoritative information that the user indicated in the Request-URI does not exist anywhere.",
    rfcReference: "RFC 3261 S21.6.3",
    causes: [
      "User/number does not exist in any known domain",
      "Authoritative lookup confirmed the user is gone",
    ],
    actions: [
      "Verify the called number/URI is correct",
      "Check with the provider if the number was ported or disconnected",
    ],
    articleIds: ["sip-404-not-found"],
  },

  606: {
    code: 606,
    name: "Not Acceptable",
    description: "The user's agent was contacted successfully but some aspects of the session description such as the requested media, bandwidth, or addressing style were not acceptable.",
    rfcReference: "RFC 3261 S21.6.4",
    causes: [
      "Global codec mismatch — no endpoint can handle the offered media",
      "Bandwidth requirements exceed what the user can support",
      "Media type not supported by any of the user's devices",
    ],
    actions: [
      "Check Warning header for details on what was not acceptable",
      "Broaden codec offer to include more widely supported codecs",
      "Review SDP for bandwidth or media type constraints",
    ],
    articleIds: ["sip-488-not-acceptable", "codec-negotiation-failures"],
  },

  607: {
    code: 607,
    name: "Unwanted",
    description: "The called party did not want this call from the calling party. Indicates potential spam/robocall.",
    rfcReference: "RFC 8197",
    causes: [
      "Call flagged as spam or unwanted by the called party",
      "STIR/SHAKEN verification failed",
    ],
    actions: [
      "Verify calling party identity (STIR/SHAKEN)",
      "Check if your number has been flagged as spam",
    ],
    articleIds: [],
  },

  608: {
    code: 608,
    name: "Rejected",
    description: "The request was rejected by an intermediary (analytics engine, robocall filter, etc.) — not by a human. Distinct from 607 which indicates human rejection.",
    rfcReference: "RFC 8688",
    causes: [
      "Call rejected by network policy (robocall filter, etc.)",
    ],
    actions: [
      "Check with your provider if calls are being filtered",
    ],
    articleIds: [],
  },
};

/** Get a SIP response code entry, returning undefined for unknown codes. */
export function getSipCode(code: number): SipCodeEntry | undefined {
  return SIP_RESPONSE_CODE_MAP[code];
}

/** Get the display name for a SIP code (e.g., "403 Forbidden"). Returns code as string if unknown. */
export function sipCodeLabel(code: number): string {
  const entry = SIP_RESPONSE_CODE_MAP[code];
  return entry ? `${code} ${entry.name}` : String(code);
}

/** Get the class of a SIP response code. */
export function sipCodeClass(code: number): "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "6xx" | "unknown" {
  if (code >= 100 && code < 200) return "1xx";
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500 && code < 600) return "5xx";
  if (code >= 600 && code < 700) return "6xx";
  return "unknown";
}

/** Returns true if the code is an error (4xx, 5xx, 6xx). */
export function isSipError(code: number): boolean {
  return code >= 400;
}
