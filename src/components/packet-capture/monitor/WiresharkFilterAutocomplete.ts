/**
 * Context-aware Wireshark display-filter autocomplete engine.
 *
 * Parses the filter expression up to the cursor, determines what kind of
 * token is expected (field, operator, value, logical), and returns ranked
 * suggestions with category grouping.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Suggestion {
  /** Text to insert */
  text: string;
  /** Human-readable description */
  description: string;
  /** Category for grouping & badge rendering */
  category: "field" | "operator" | "protocol" | "value" | "logical" | "modifier" | "history";
  /** Higher = better match (used for sorting) */
  score: number;
}

export type SuggestionContext =
  | "field"      // expecting a field name or protocol (start of expression, after logical)
  | "operator"   // expecting a comparison operator (after a field name)
  | "value"      // expecting a value (after field + operator)
  | "logical"    // expecting && / || / and / or (after a complete expression)
  | "unknown";

interface ContextResult {
  context: SuggestionContext;
  currentWord: { word: string; start: number; end: number };
  /** The field name preceding the operator (available when context is "value" or "operator") */
  precedingField?: string;
  /** The operator preceding the value (available when context is "value") */
  precedingOp?: string;
}

// ─── Token Helpers ──────────────────────────────────────────────────────────

/** Find the word at the cursor (letters, digits, dots, dashes, underscores, colons). */
function getWordAtCursor(text: string, cursor: number): { word: string; start: number; end: number } {
  let start = cursor;
  let end = cursor;
  while (start > 0 && /[\w.:\-]/.test(text[start - 1] ?? "")) start--;
  while (end < text.length && /[\w.:\-]/.test(text[end] ?? "")) end++;
  return { word: text.substring(start, end), start, end };
}

/** Tokenize the text before cursor into coarse tokens (ignoring strings for simplicity). */
function tokenizeBefore(text: string): string[] {
  // Split on whitespace but preserve operators like ==, !=, >=, <=, &&, ||
  const tokens: string[] = [];
  const regex = /===|!==|==|!=|>=|<=|&&|\|\||[><~!()]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[\w.:\-\/]+/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

const COMPARISON_OPS = new Set([
  "==", "===", "!=", "!==", ">", "<", ">=", "<=",
  "eq", "ne", "gt", "lt", "ge", "le",
  "any_eq", "all_eq", "any_ne", "all_ne",
  "contains", "matches", "~",
]);

const LOGICAL_OPS = new Set(["&&", "||", "and", "or", "xor", "^^"]);

const KNOWN_PROTOCOLS = new Set([
  "ip", "ipv4", "ipv6", "tcp", "udp", "sip", "rtp", "rtcp", "http", "https",
  "dns", "icmp", "icmpv6", "arp", "fax", "t38", "tls", "ssl", "dhcp", "ftp",
  "smtp", "pop", "imap", "ssh", "snmp", "ntp", "stun", "quic", "gre",
  "ospf", "bgp", "mpls", "vlan", "igmp", "smb", "smb2", "eth", "ethernet",
  "sctp", "sdp", "mgcp", "h323", "h225", "h245", "isup", "mtp3", "m2ua", "m3ua",
  "diameter", "radius", "ldap", "modbus", "dnp3", "s7comm", "enip",
]);

// ─── Context Parser ─────────────────────────────────────────────────────────

export function getFilterContext(text: string, cursor: number): ContextResult {
  const word = getWordAtCursor(text, cursor);
  const textBefore = text.substring(0, word.start).trimEnd();

  // Nothing before → expect field/protocol
  if (!textBefore) {
    return { context: "field", currentWord: word };
  }

  const tokens = tokenizeBefore(textBefore);
  if (tokens.length === 0) {
    return { context: "field", currentWord: word };
  }

  const lastToken = (tokens[tokens.length - 1] ?? "").toLowerCase();
  const secondLast = tokens.length >= 2 ? (tokens[tokens.length - 2] ?? "").toLowerCase() : "";

  // After a logical operator → expect field/protocol
  if (LOGICAL_OPS.has(lastToken) || lastToken === "(" || lastToken === "!") {
    return { context: "field", currentWord: word };
  }

  // After a comparison operator → expect a value
  if (COMPARISON_OPS.has(lastToken)) {
    // Walk back to find the field name
    let fieldName = secondLast;
    // Could also be "! field op" → field is secondLast
    return { context: "value", currentWord: word, precedingField: fieldName, precedingOp: lastToken };
  }

  // The last token looks like a field (contains a dot, or is a known protocol prefix)
  if (lastToken.includes(".") || KNOWN_PROTOCOLS.has(lastToken)) {
    // If the current word is empty → user just typed a field and hit space → suggest operators
    if (!word.word) {
      return { context: "operator", currentWord: word, precedingField: lastToken };
    }
    // If the current word looks like it could be an operator → suggest operators
    if (word.word.length <= 3 && !word.word.includes(".")) {
      return { context: "operator", currentWord: word, precedingField: lastToken };
    }
  }

  // After a field + operator + value (complete expression) → suggest logical operators
  if (tokens.length >= 3) {
    const maybeOp = secondLast;
    if (COMPARISON_OPS.has(maybeOp)) {
      // tokens: [... field, op, value] → expression is complete
      return { context: "logical", currentWord: word };
    }
  }

  // After a bare protocol (like "sip") with no operator → could be logical or operator
  if (KNOWN_PROTOCOLS.has(lastToken) && !word.word) {
    // After bare protocol and space → could go either way, but prefer logical/operator
    return { context: "logical", currentWord: word };
  }

  // Default: suggest fields
  return { context: "field", currentWord: word };
}

// ─── Value Suggestions ──────────────────────────────────────────────────────

const FIELD_VALUES: Record<string, Array<{ text: string; description: string }> | string> = {
  // SIP methods
  "sip.method": [
    { text: "INVITE", description: "Initiate a call" },
    { text: "REGISTER", description: "Register a contact" },
    { text: "BYE", description: "Terminate a call" },
    { text: "CANCEL", description: "Cancel a pending INVITE" },
    { text: "ACK", description: "Acknowledge an INVITE" },
    { text: "OPTIONS", description: "Query capabilities" },
    { text: "SUBSCRIBE", description: "Subscribe to events" },
    { text: "NOTIFY", description: "Event notification" },
    { text: "REFER", description: "Transfer a call" },
    { text: "INFO", description: "Mid-dialog information" },
    { text: "UPDATE", description: "Update session parameters" },
    { text: "PRACK", description: "Provisional ACK" },
    { text: "MESSAGE", description: "Instant message" },
    { text: "PUBLISH", description: "Publish event state" },
  ],
  "sip.cseq.method": [
    { text: "INVITE", description: "CSeq method: INVITE" },
    { text: "REGISTER", description: "CSeq method: REGISTER" },
    { text: "BYE", description: "CSeq method: BYE" },
    { text: "CANCEL", description: "CSeq method: CANCEL" },
    { text: "ACK", description: "CSeq method: ACK" },
    { text: "OPTIONS", description: "CSeq method: OPTIONS" },
    { text: "SUBSCRIBE", description: "CSeq method: SUBSCRIBE" },
    { text: "NOTIFY", description: "CSeq method: NOTIFY" },
  ],
  // SIP status codes
  "sip.status-code": [
    { text: "100", description: "Trying" },
    { text: "180", description: "Ringing" },
    { text: "183", description: "Session Progress" },
    { text: "200", description: "OK" },
    { text: "202", description: "Accepted" },
    { text: "301", description: "Moved Permanently" },
    { text: "302", description: "Moved Temporarily" },
    { text: "400", description: "Bad Request" },
    { text: "401", description: "Unauthorized" },
    { text: "403", description: "Forbidden" },
    { text: "404", description: "Not Found" },
    { text: "405", description: "Method Not Allowed" },
    { text: "407", description: "Proxy Authentication Required" },
    { text: "408", description: "Request Timeout" },
    { text: "480", description: "Temporarily Unavailable" },
    { text: "481", description: "Call/Transaction Does Not Exist" },
    { text: "486", description: "Busy Here" },
    { text: "487", description: "Request Terminated" },
    { text: "488", description: "Not Acceptable Here" },
    { text: "489", description: "Bad Event" },
    { text: "491", description: "Request Pending" },
    { text: "500", description: "Server Internal Error" },
    { text: "501", description: "Not Implemented" },
    { text: "502", description: "Bad Gateway" },
    { text: "503", description: "Service Unavailable" },
    { text: "504", description: "Server Time-out" },
    { text: "600", description: "Busy Everywhere" },
    { text: "603", description: "Decline" },
    { text: "604", description: "Does Not Exist Anywhere" },
  ],
  // HTTP methods
  "http.request.method": [
    { text: "GET", description: "HTTP GET" },
    { text: "POST", description: "HTTP POST" },
    { text: "PUT", description: "HTTP PUT" },
    { text: "DELETE", description: "HTTP DELETE" },
    { text: "PATCH", description: "HTTP PATCH" },
    { text: "HEAD", description: "HTTP HEAD" },
    { text: "OPTIONS", description: "HTTP OPTIONS" },
    { text: "CONNECT", description: "HTTP CONNECT" },
    { text: "TRACE", description: "HTTP TRACE" },
  ],
  // HTTP status codes
  "http.response.code": [
    { text: "200", description: "OK" },
    { text: "201", description: "Created" },
    { text: "204", description: "No Content" },
    { text: "301", description: "Moved Permanently" },
    { text: "302", description: "Found" },
    { text: "304", description: "Not Modified" },
    { text: "400", description: "Bad Request" },
    { text: "401", description: "Unauthorized" },
    { text: "403", description: "Forbidden" },
    { text: "404", description: "Not Found" },
    { text: "405", description: "Method Not Allowed" },
    { text: "500", description: "Internal Server Error" },
    { text: "502", description: "Bad Gateway" },
    { text: "503", description: "Service Unavailable" },
    { text: "504", description: "Gateway Timeout" },
  ],
  // DNS query types
  "dns.qry.type": [
    { text: "1", description: "A (IPv4 address)" },
    { text: "2", description: "NS (Name server)" },
    { text: "5", description: "CNAME (Canonical name)" },
    { text: "6", description: "SOA (Start of authority)" },
    { text: "12", description: "PTR (Pointer)" },
    { text: "15", description: "MX (Mail exchange)" },
    { text: "16", description: "TXT (Text)" },
    { text: "28", description: "AAAA (IPv6 address)" },
    { text: "33", description: "SRV (Service)" },
    { text: "35", description: "NAPTR (Naming Authority Pointer)" },
    { text: "255", description: "ANY (All records)" },
  ],
  // RTP payload types
  "rtp.payload_type": [
    { text: "0", description: "PCMU (G.711 u-law)" },
    { text: "3", description: "GSM" },
    { text: "4", description: "G.723" },
    { text: "8", description: "PCMA (G.711 a-law)" },
    { text: "9", description: "G.722" },
    { text: "18", description: "G.729" },
    { text: "26", description: "JPEG" },
    { text: "31", description: "H.261" },
    { text: "34", description: "H.263" },
    { text: "96", description: "Dynamic (commonly VP8)" },
    { text: "97", description: "Dynamic" },
    { text: "98", description: "Dynamic" },
    { text: "101", description: "Dynamic (commonly telephone-event)" },
    { text: "111", description: "Dynamic" },
  ],
  // Common ports
  "tcp.port": [
    { text: "22", description: "SSH" },
    { text: "25", description: "SMTP" },
    { text: "53", description: "DNS" },
    { text: "80", description: "HTTP" },
    { text: "110", description: "POP3" },
    { text: "143", description: "IMAP" },
    { text: "443", description: "HTTPS" },
    { text: "993", description: "IMAPS" },
    { text: "995", description: "POP3S" },
    { text: "3306", description: "MySQL" },
    { text: "5432", description: "PostgreSQL" },
    { text: "8080", description: "HTTP alt" },
    { text: "8443", description: "HTTPS alt" },
  ],
  "tcp.srcport": "tcp.port",
  "tcp.dstport": "tcp.port",
  "udp.port": [
    { text: "53", description: "DNS" },
    { text: "67", description: "DHCP server" },
    { text: "68", description: "DHCP client" },
    { text: "69", description: "TFTP" },
    { text: "123", description: "NTP" },
    { text: "161", description: "SNMP" },
    { text: "162", description: "SNMP trap" },
    { text: "500", description: "IKE" },
    { text: "514", description: "Syslog" },
    { text: "1719", description: "H.323 RAS" },
    { text: "1720", description: "H.323 Call Signaling" },
    { text: "4500", description: "IPSec NAT-T" },
    { text: "5060", description: "SIP" },
    { text: "5061", description: "SIP TLS" },
  ],
  "udp.srcport": "udp.port",
  "udp.dstport": "udp.port",
  // Boolean fields
  "tcp.flags.syn": [
    { text: "1", description: "SYN flag set" },
    { text: "0", description: "SYN flag not set" },
  ],
  "tcp.flags.ack": [
    { text: "1", description: "ACK flag set" },
    { text: "0", description: "ACK flag not set" },
  ],
  "tcp.flags.fin": [
    { text: "1", description: "FIN flag set" },
    { text: "0", description: "FIN flag not set" },
  ],
  "tcp.flags.rst": [
    { text: "1", description: "RST flag set" },
    { text: "0", description: "RST flag not set" },
  ],
  "tcp.flags.push": [
    { text: "1", description: "PSH flag set" },
    { text: "0", description: "PSH flag not set" },
  ],
  "rtp.marker": [
    { text: "1", description: "Marker bit set" },
    { text: "0", description: "Marker bit not set" },
  ],
  "dns.flags.response": [
    { text: "1", description: "DNS response" },
    { text: "0", description: "DNS query" },
  ],
  // DHCP message type
  "dhcp.option.dhcp": [
    { text: "1", description: "Discover" },
    { text: "2", description: "Offer" },
    { text: "3", description: "Request" },
    { text: "4", description: "Decline" },
    { text: "5", description: "ACK" },
    { text: "6", description: "NAK" },
    { text: "7", description: "Release" },
    { text: "8", description: "Inform" },
  ],
  // ICMP types
  "icmp.type": [
    { text: "0", description: "Echo Reply" },
    { text: "3", description: "Destination Unreachable" },
    { text: "5", description: "Redirect" },
    { text: "8", description: "Echo Request (ping)" },
    { text: "11", description: "Time Exceeded" },
  ],
  // ARP opcodes
  "arp.opcode": [
    { text: "1", description: "ARP Request" },
    { text: "2", description: "ARP Reply" },
  ],
  // IP protocol number
  "ip.proto": [
    { text: "1", description: "ICMP" },
    { text: "6", description: "TCP" },
    { text: "17", description: "UDP" },
    { text: "47", description: "GRE" },
    { text: "50", description: "ESP" },
    { text: "51", description: "AH" },
    { text: "89", description: "OSPF" },
    { text: "132", description: "SCTP" },
  ],
  // TLS handshake types
  "tls.handshake.type": [
    { text: "1", description: "Client Hello" },
    { text: "2", description: "Server Hello" },
    { text: "11", description: "Certificate" },
    { text: "12", description: "Server Key Exchange" },
    { text: "13", description: "Certificate Request" },
    { text: "14", description: "Server Hello Done" },
    { text: "15", description: "Certificate Verify" },
    { text: "16", description: "Client Key Exchange" },
    { text: "20", description: "Finished" },
  ],
  // RTCP packet types
  "rtcp.pt": [
    { text: "200", description: "Sender Report (SR)" },
    { text: "201", description: "Receiver Report (RR)" },
    { text: "202", description: "Source Description (SDES)" },
    { text: "203", description: "BYE" },
    { text: "204", description: "APP" },
  ],
  // Ethernet types
  "eth.type": [
    { text: "0x0800", description: "IPv4" },
    { text: "0x0806", description: "ARP" },
    { text: "0x86DD", description: "IPv6" },
    { text: "0x8100", description: "802.1Q VLAN" },
    { text: "0x8847", description: "MPLS unicast" },
  ],
  // SNMP versions
  "snmp.version": [
    { text: "0", description: "SNMPv1" },
    { text: "1", description: "SNMPv2c" },
    { text: "3", description: "SNMPv3" },
  ],
};

/** Resolve value references (some fields point to another field's values). */
function getValuesForField(field: string): Array<{ text: string; description: string }> {
  const lower = field.toLowerCase();
  const entry = FIELD_VALUES[lower];
  if (!entry) return [];
  if (typeof entry === "string") return getValuesForField(entry);
  return entry;
}

// ─── Logical Operator Suggestions ───────────────────────────────────────────

const LOGICAL_SUGGESTIONS: Suggestion[] = [
  { text: "&&", description: "Logical AND", category: "logical", score: 100 },
  { text: "||", description: "Logical OR", category: "logical", score: 99 },
  { text: "and", description: "Logical AND (English)", category: "logical", score: 80 },
  { text: "or", description: "Logical OR (English)", category: "logical", score: 79 },
  { text: "xor", description: "Logical XOR (English)", category: "logical", score: 60 },
  { text: "^^", description: "Logical XOR", category: "logical", score: 59 },
];

// ─── Operator Suggestions ───────────────────────────────────────────────────

const OPERATOR_SUGGESTIONS: Suggestion[] = [
  { text: "==", description: "Equal to", category: "operator", score: 100 },
  { text: "!=", description: "Not equal to", category: "operator", score: 95 },
  { text: ">", description: "Greater than", category: "operator", score: 80 },
  { text: "<", description: "Less than", category: "operator", score: 79 },
  { text: ">=", description: "Greater or equal", category: "operator", score: 78 },
  { text: "<=", description: "Less or equal", category: "operator", score: 77 },
  { text: "contains", description: "Contains substring", category: "operator", score: 90 },
  { text: "matches", description: "Regex match", category: "operator", score: 85 },
  { text: "~", description: "Regex match (alias)", category: "operator", score: 84 },
  { text: "===", description: "Equal (all fields)", category: "operator", score: 50 },
  { text: "!==", description: "Not equal (any field)", category: "operator", score: 49 },
  { text: "in", description: "Set membership { ... }", category: "operator", score: 88 },
  { text: "eq", description: "Equal (English)", category: "operator", score: 40 },
  { text: "ne", description: "Not equal (English)", category: "operator", score: 39 },
  { text: "gt", description: "Greater than (English)", category: "operator", score: 38 },
  { text: "lt", description: "Less than (English)", category: "operator", score: 37 },
  { text: "ge", description: "Greater or equal (English)", category: "operator", score: 36 },
  { text: "le", description: "Less or equal (English)", category: "operator", score: 35 },
];

// ─── Main Suggestion Generator ──────────────────────────────────────────────

export function getSuggestions(
  filter: string,
  cursor: number,
  allFields: Array<{ text: string; description: string; category: "field" | "protocol" }>,
  filterHistory: string[],
): Suggestion[] {
  const ctx = getFilterContext(filter, cursor);
  const word = ctx.currentWord.word.toLowerCase();
  const results: Suggestion[] = [];

  switch (ctx.context) {
    case "field": {
      // Show history when the input is empty or nearly empty
      if (!filter.trim() || word === filter.trim().toLowerCase()) {
        for (const h of filterHistory.slice(0, 5)) {
          if (!word || h.toLowerCase().startsWith(word)) {
            results.push({ text: h, description: "Recent filter", category: "history", score: 200 });
          }
        }
      }

      // Suggest protocols and fields
      for (const f of allFields) {
        const score = scoreMatch(f.text, word);
        if (score > 0) {
          results.push({ ...f, score });
        }
      }
      break;
    }

    case "operator": {
      for (const op of OPERATOR_SUGGESTIONS) {
        const score = word ? scoreMatch(op.text, word) : op.score;
        if (score > 0 || !word) {
          results.push({ ...op, score: word ? score : op.score });
        }
      }
      break;
    }

    case "value": {
      const field = ctx.precedingField ?? "";
      const values = getValuesForField(field);

      if (values.length > 0) {
        for (const v of values) {
          const score = word ? scoreMatch(v.text, word) : 100 - values.indexOf(v);
          if (score > 0 || !word) {
            results.push({
              text: isNumericStr(v.text) ? v.text : `"${v.text}"`,
              description: v.description,
              category: "value",
              score: word ? score : 100 - values.indexOf(v),
            });
          }
        }
      }

      // If the field looks like an IP field, suggest some common network examples
      if (field.includes("ip.") && !word) {
        results.push(
          { text: "192.168.", description: "Private network (class C)", category: "value", score: 50 },
          { text: "10.", description: "Private network (class A)", category: "value", score: 49 },
          { text: "172.16.", description: "Private network (class B)", category: "value", score: 48 },
        );
      }
      break;
    }

    case "logical": {
      for (const l of LOGICAL_SUGGESTIONS) {
        const score = word ? scoreMatch(l.text, word) : l.score;
        if (score > 0 || !word) {
          results.push({ ...l, score: word ? score : l.score });
        }
      }
      // Also suggest negation
      if (!word || "!".startsWith(word) || "not".startsWith(word)) {
        results.push({ text: "!", description: "Negation (NOT)", category: "logical", score: word ? 90 : 50 });
        results.push({ text: "not", description: "Negation (English)", category: "logical", score: word ? 85 : 45 });
      }
      break;
    }

    default: {
      // Fallback: show everything
      for (const f of allFields) {
        const score = scoreMatch(f.text, word);
        if (score > 0) results.push({ ...f, score });
      }
      break;
    }
  }

  // Sort by score descending, then alphabetically
  results.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));

  // Deduplicate
  const seen = new Set<string>();
  const unique: Suggestion[] = [];
  for (const r of results) {
    if (!seen.has(r.text)) {
      seen.add(r.text);
      unique.push(r);
    }
  }

  return unique.slice(0, 30);
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function scoreMatch(target: string, query: string): number {
  if (!query) return 50; // No query → everything matches with base score
  const tLow = target.toLowerCase();
  const qLow = query.toLowerCase();

  // Exact match
  if (tLow === qLow) return 1000;

  // Exact prefix match
  if (tLow.startsWith(qLow)) {
    // Shorter targets score higher for prefix matches (more specific)
    return 500 + Math.max(0, 100 - target.length);
  }

  // Dot-segment prefix: "ip.s" matches "ip.src"
  const tSegments = tLow.split(".");
  const qSegments = qLow.split(".");
  if (qSegments.length > 1) {
    let segMatch = true;
    for (let i = 0; i < qSegments.length; i++) {
      const ts = tSegments[i] ?? "";
      const qs = qSegments[i] ?? "";
      if (!ts.startsWith(qs)) { segMatch = false; break; }
    }
    if (segMatch && qSegments.length <= tSegments.length) {
      return 400 + Math.max(0, 50 - target.length);
    }
  }

  // Contains match
  if (tLow.includes(qLow)) {
    return 200 + Math.max(0, 50 - tLow.indexOf(qLow));
  }

  // Word boundary match: "method" matches "sip.Method"
  const lastSegment = tSegments[tSegments.length - 1] ?? "";
  if (lastSegment.toLowerCase().startsWith(qLow)) {
    return 300 + Math.max(0, 50 - target.length);
  }

  return 0; // No match
}

function isNumericStr(s: string): boolean {
  return /^[0-9]/.test(s) || s.startsWith("0x");
}

// ─── Ghost Text ─────────────────────────────────────────────────────────────

/**
 * Compute the ghost text (the portion of the top suggestion that extends
 * beyond what the user has typed) to display inline after the cursor.
 */
export function getGhostText(
  filter: string,
  cursor: number,
  topSuggestion: Suggestion | undefined,
): string {
  if (!topSuggestion) return "";

  const word = getWordAtCursor(filter, cursor);
  const typed = word.word;
  if (!typed) return "";

  const suggestion = topSuggestion.text;
  const sLow = suggestion.toLowerCase();
  const tLow = typed.toLowerCase();

  // Only show ghost if suggestion starts with what's typed
  if (sLow.startsWith(tLow) && suggestion.length > typed.length) {
    return suggestion.slice(typed.length);
  }

  return "";
}

// ─── Filter History (centralised via uiPrefsStore) ──────────────────────────

import { useUiPrefsStore } from "@/stores/uiPrefsStore";

export function loadFilterHistory(): string[] {
  return useUiPrefsStore.getState().wiresharkFilterHistory;
}

export function saveFilterToHistory(filter: string): string[] {
  if (!filter.trim()) return loadFilterHistory();
  useUiPrefsStore.getState().addWiresharkFilterHistory(filter);
  return useUiPrefsStore.getState().wiresharkFilterHistory;
}

export function removeFilterFromHistory(filter: string): string[] {
  useUiPrefsStore.getState().removeWiresharkFilterHistory(filter);
  return useUiPrefsStore.getState().wiresharkFilterHistory;
}

export function clearFilterHistory(): string[] {
  useUiPrefsStore.getState().clearWiresharkFilterHistory();
  return useUiPrefsStore.getState().wiresharkFilterHistory;
}

// ─── Highlight helpers ──────────────────────────────────────────────────────

/** Split text into [before, match, after] for highlighting the matched portion. */
export function highlightMatch(text: string, query: string): [string, string, string] {
  if (!query) return [text, "", ""];
  const tLow = text.toLowerCase();
  const qLow = query.toLowerCase();
  const idx = tLow.indexOf(qLow);
  if (idx === -1) return [text, "", ""];
  return [
    text.slice(0, idx),
    text.slice(idx, idx + query.length),
    text.slice(idx + query.length),
  ];
}

// ─── Category labels for display ────────────────────────────────────────────

export const CATEGORY_LABELS: Record<string, string> = {
  field: "Field",
  protocol: "Protocol",
  operator: "Operator",
  value: "Value",
  logical: "Logic",
  modifier: "Modifier",
  history: "History",
};

export const CATEGORY_COLORS: Record<string, string> = {
  field: "text-chart-blue",
  protocol: "text-chart-green",
  operator: "text-chart-yellow",
  value: "text-chart-blue",
  logical: "text-chart-red",
  modifier: "text-chart-cyan",
  history: "text-muted-foreground",
};
