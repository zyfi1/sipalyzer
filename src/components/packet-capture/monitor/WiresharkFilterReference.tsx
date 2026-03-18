/**
 * Comprehensive Wireshark Display Filter Reference Wiki.
 *
 * Full-blown reference covering every Wireshark display-filter concept:
 * syntax, operators, logical combinators, membership tests, slices,
 * functions, protocol fields, and hundreds of real-world examples.
 */

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Search, Plus, X, Copy, Check,
  Keyboard, Zap, Link2, Globe, Network, Package,
  Phone, MusicNote, FileSearch,
  MapPin, Wrench, TestTube, Clipboard, Printer,
  ArrowRightLeft, Shield, Wifi, HardDrive,
  Tag, Star, BookOpen,
} from "@/lib/icons";
import type { IconComponent } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

// ─── Types ──────────────────────────────────────────────────────────────────

interface FilterReferenceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert?: (text: string) => void;
}

interface WikiSection {
  id: string;
  title: string;
  icon: IconComponent;
  content: WikiEntry[];
}

interface WikiEntry {
  text: string;
  description: string;
  insertable?: boolean;
  heading?: boolean;
}

// ─── Section Icon Map (Lucide icons per design system) ────────────────────

const SECTION_ICONS: Record<string, IconComponent> = {
  syntax: Keyboard,
  operators: Zap,
  logical: Link2,
  ip: Globe,
  tcp: Network,
  udp: Package,
  eth: Network,
  sip: Phone,
  rtp: MusicNote,
  dns: FileSearch,
  http: Globe,
  "arp-icmp": MapPin,
  other: Wrench,
  advanced: TestTube,
  sdp: Clipboard,
  t38: Printer,
  sctp: ArrowRightLeft,
  telecom: Network,
  email: Tag,
  auth: Shield,
  wifi: Wifi,
  industrial: HardDrive,
  database: HardDrive,
  bluetooth: Wifi,
  usb: Link2,
  special: Star,
  recipes: BookOpen,
};

// ─── Reference Data ─────────────────────────────────────────────────────────

const SECTIONS: WikiSection[] = [
  {
    id: "syntax",
    title: "Syntax & Basics",
    icon: SECTION_ICONS.syntax!,
    content: [
      { text: "How Display Filters Work", description: "Display filters select which packets are shown. They are evaluated after capture. A filter expression is a boolean test — packets that match are displayed, those that don't are hidden.", heading: true },
      { text: "Protocol Existence", description: "Typing a bare protocol name shows only packets of that protocol. Example: sip shows only SIP packets; tcp shows TCP, HTTP, and HTTPS.", heading: true },
      { text: "sip", description: "Show only SIP packets", insertable: true },
      { text: "tcp", description: "Show TCP packets (includes HTTP, HTTPS)", insertable: true },
      { text: "udp", description: "Show UDP packets (includes SIP, RTP, DNS)", insertable: true },
      { text: "dns", description: "Show only DNS packets", insertable: true },
      { text: "rtp", description: "Show only RTP packets", insertable: true },
      { text: "http", description: "Show only HTTP packets", insertable: true },
      { text: "arp", description: "Show only ARP packets", insertable: true },
      { text: "icmp", description: "Show only ICMP packets", insertable: true },
      { text: "Field Comparison", description: "Use field == value to test a specific field. Fields are protocol-prefixed (ip.addr, tcp.port, sip.method, etc.).", heading: true },
      { text: "ip.addr == 192.168.1.1", description: "Packets where source OR destination IP is 192.168.1.1", insertable: true },
      { text: "ip.src == 10.0.0.1", description: "Packets from source IP 10.0.0.1", insertable: true },
      { text: "ip.dst == 10.0.0.1", description: "Packets to destination IP 10.0.0.1", insertable: true },
      { text: "tcp.port == 80", description: "TCP packets on port 80 (either direction)", insertable: true },
      { text: "udp.port == 5060", description: "UDP packets on port 5060 (SIP)", insertable: true },
      { text: "frame.len > 1000", description: "Packets larger than 1000 bytes", insertable: true },
    ],
  },
  {
    id: "operators",
    title: "Comparison Operators",
    icon: SECTION_ICONS.operators!,
    content: [
      { text: "Operator Reference", description: "Wireshark supports both C-style and English-word operators. They are interchangeable.", heading: true },
      { text: "==  or  eq", description: "Equal to. Example: ip.addr == 10.0.0.1" },
      { text: "!=  or  ne", description: "Not equal to. Example: ip.addr != 10.0.0.1" },
      { text: ">   or  gt", description: "Greater than. Example: frame.len > 500" },
      { text: "<   or  lt", description: "Less than. Example: tcp.port < 1024" },
      { text: ">=  or  ge", description: "Greater than or equal. Example: ip.ttl >= 64" },
      { text: "<=  or  le", description: "Less than or equal. Example: udp.length <= 100" },
      { text: "Search Operators", description: "For text / byte searching within field values.", heading: true },
      { text: "contains", description: "True if field contains the given string. Example: sip.method contains \"INVITE\"" },
      { text: "matches  or  ~", description: "True if field matches the given Perl-compatible regex (case-insensitive). Example: sip.method ~ \"INVITE|REGISTER\"" },
      { text: "Set Membership", description: "Test if a value is in a set of values.", heading: true },
      { text: "in { ... }", description: "True if field value is in the set. Example: tcp.port in {80, 443, 8080}" },
      { text: "in { a..b }", description: "Ranges supported inside sets. Example: tcp.port in {1..1024}" },
      { text: "Bitwise Operators", description: "For testing individual bits in flag fields.", heading: true },
      { text: "tcp.flags & 0x02", description: "Bitwise AND — true if SYN bit is set", insertable: true },
      { text: "tcp.flags & 0x10", description: "Bitwise AND — true if ACK bit is set", insertable: true },
      { text: "tcp.flags & 0x01", description: "Bitwise AND — true if FIN bit is set", insertable: true },
    ],
  },
  {
    id: "logical",
    title: "Logical Operators",
    icon: SECTION_ICONS.logical!,
    content: [
      { text: "Combining Expressions", description: "Join multiple conditions with logical operators. Parentheses control precedence.", heading: true },
      { text: "&&  or  and", description: "Logical AND — both conditions must be true. Example: sip && ip.addr == 10.0.0.1" },
      { text: "||  or  or", description: "Logical OR — either condition can be true. Example: sip || rtp" },
      { text: "!   or  not", description: "Logical NOT — negates the condition. Example: !arp" },
      { text: "^^  or  xor", description: "Logical XOR — exactly one condition must be true. Example: tcp.port == 80 ^^ tcp.port == 443" },
      { text: "Operator Precedence (high → low)", description: "1) NOT (!), 2) AND (&&), 3) XOR (^^), 4) OR (||). Use parentheses to override.", heading: true },
      { text: "(sip || rtp) && ip.addr == 10.0.0.1", description: "SIP or RTP packets involving 10.0.0.1", insertable: true },
      { text: "!(arp || dns)", description: "Everything except ARP and DNS", insertable: true },
      { text: "ip.src == 10.0.0.1 && ip.dst == 10.0.0.2", description: "Traffic from .1 to .2 specifically", insertable: true },
      { text: "sip || rtp || rtcp", description: "All VoIP signaling and media", insertable: true },
      { text: "Implicit AND", description: "Two conditions with no operator between them are implicitly ANDed. Example: ip.src == 1.2.3.4 ip.dst == 5.6.7.8 is the same as ip.src == 1.2.3.4 && ip.dst == 5.6.7.8", heading: true },
    ],
  },
  {
    id: "ip",
    title: "IP / Network Layer",
    icon: SECTION_ICONS.ip!,
    content: [
      { text: "IPv4 Fields", description: "", heading: true },
      { text: "ip.addr", description: "Source or destination IPv4 address" },
      { text: "ip.src", description: "Source IPv4 address" },
      { text: "ip.dst", description: "Destination IPv4 address" },
      { text: "ip.proto", description: "IP protocol number (6=TCP, 17=UDP, 1=ICMP)" },
      { text: "ip.ttl", description: "Time To Live" },
      { text: "ip.len", description: "Total IP packet length" },
      { text: "ip.id", description: "Identification field" },
      { text: "ip.flags", description: "IP flags (DF, MF)" },
      { text: "ip.frag_offset", description: "Fragment offset" },
      { text: "ip.hdr_len", description: "IP header length" },
      { text: "ip.checksum", description: "IP header checksum" },
      { text: "ip.dsfield", description: "Differentiated Services field (DSCP + ECN)" },
      { text: "ip.dsfield.dscp", description: "DSCP value (QoS marking)" },
      { text: "ip.dsfield.ecn", description: "ECN value" },
      { text: "ip.version", description: "IP version (4 or 6)" },
      { text: "CIDR / Subnet Matching", description: "Use CIDR notation to match entire subnets.", heading: true },
      { text: "ip.addr == 192.168.1.0/24", description: "Any IP in the 192.168.1.0/24 subnet", insertable: true },
      { text: "ip.src == 10.0.0.0/8", description: "Source in 10.0.0.0/8 private range", insertable: true },
      { text: "!(ip.addr == 192.168.0.0/16)", description: "Exclude all 192.168.x.x traffic", insertable: true },
      { text: "IPv6 Fields", description: "", heading: true },
      { text: "ipv6.addr", description: "Source or destination IPv6 address" },
      { text: "ipv6.src", description: "Source IPv6 address" },
      { text: "ipv6.dst", description: "Destination IPv6 address" },
      { text: "ipv6.hlim", description: "Hop limit (equivalent to TTL)" },
      { text: "ipv6.plen", description: "Payload length" },
      { text: "ipv6.nxt", description: "Next header type" },
      { text: "ipv6.flow", description: "Flow label" },
      { text: "ipv6.tclass", description: "Traffic class" },
      { text: "ipv6.version", description: "Version (always 6)" },
    ],
  },
  {
    id: "tcp",
    title: "TCP",
    icon: SECTION_ICONS.tcp!,
    content: [
      { text: "Port Fields", description: "", heading: true },
      { text: "tcp.port", description: "Source or destination TCP port" },
      { text: "tcp.srcport", description: "Source TCP port" },
      { text: "tcp.dstport", description: "Destination TCP port" },
      { text: "Sequence / Acknowledgment", description: "", heading: true },
      { text: "tcp.seq", description: "Sequence number" },
      { text: "tcp.ack", description: "Acknowledgment number" },
      { text: "tcp.nxtseq", description: "Next expected sequence number" },
      { text: "tcp.len", description: "TCP segment data length" },
      { text: "tcp.window_size", description: "Window size value" },
      { text: "tcp.window_size_scalefactor", description: "Window size scaling factor" },
      { text: "TCP Flags", description: "Individual flag bits. Values are 0 or 1.", heading: true },
      { text: "tcp.flags", description: "All flags as a bitmask (e.g. 0x02 = SYN)" },
      { text: "tcp.flags.syn == 1", description: "SYN flag set", insertable: true },
      { text: "tcp.flags.ack == 1", description: "ACK flag set", insertable: true },
      { text: "tcp.flags.fin == 1", description: "FIN flag set", insertable: true },
      { text: "tcp.flags.rst == 1", description: "RST flag set (connection reset)", insertable: true },
      { text: "tcp.flags.push == 1", description: "PSH flag set", insertable: true },
      { text: "tcp.flags.urg == 1", description: "URG flag set", insertable: true },
      { text: "tcp.flags.ecn", description: "ECN flag" },
      { text: "tcp.flags.cwr", description: "CWR flag" },
      { text: "tcp.flags.ns", description: "NS flag" },
      { text: "Other TCP Fields", description: "", heading: true },
      { text: "tcp.checksum", description: "TCP checksum" },
      { text: "tcp.urgent_pointer", description: "Urgent pointer" },
      { text: "tcp.options", description: "TCP options" },
      { text: "tcp.option_kind", description: "TCP option kind" },
      { text: "tcp.stream", description: "TCP stream index" },
      { text: "tcp.analysis.retransmission", description: "TCP retransmission" },
      { text: "tcp.analysis.duplicate_ack", description: "Duplicate ACK" },
      { text: "tcp.analysis.zero_window", description: "Zero window" },
      { text: "tcp.analysis.window_full", description: "Window full" },
      { text: "tcp.analysis.keep_alive", description: "TCP keep-alive" },
      { text: "tcp.analysis.out_of_order", description: "Out-of-order segment" },
      { text: "tcp.analysis.fast_retransmission", description: "Fast retransmission" },
      { text: "Common TCP Examples", description: "", heading: true },
      { text: "tcp.flags.syn == 1 && tcp.flags.ack == 0", description: "SYN-only (new connection attempts)", insertable: true },
      { text: "tcp.flags.rst == 1", description: "Connection resets", insertable: true },
      { text: "tcp.analysis.retransmission", description: "Retransmissions (performance issues)", insertable: true },
      { text: "tcp.port == 443", description: "HTTPS traffic", insertable: true },
      { text: "tcp.port in {80, 443, 8080, 8443}", description: "Common web ports", insertable: true },
    ],
  },
  {
    id: "udp",
    title: "UDP",
    icon: SECTION_ICONS.udp!,
    content: [
      { text: "UDP Fields", description: "", heading: true },
      { text: "udp.port", description: "Source or destination UDP port" },
      { text: "udp.srcport", description: "Source UDP port" },
      { text: "udp.dstport", description: "Destination UDP port" },
      { text: "udp.length", description: "UDP datagram length (header + payload)" },
      { text: "udp.checksum", description: "UDP checksum" },
      { text: "udp.stream", description: "UDP stream index" },
      { text: "Common UDP Examples", description: "", heading: true },
      { text: "udp.port == 5060", description: "SIP signaling port", insertable: true },
      { text: "udp.port == 53", description: "DNS traffic", insertable: true },
      { text: "udp.port in {5060, 5061}", description: "SIP ports", insertable: true },
      { text: "udp.length > 1000", description: "Large UDP packets", insertable: true },
    ],
  },
  {
    id: "eth",
    title: "Ethernet & Frame",
    icon: SECTION_ICONS.eth!,
    content: [
      { text: "Ethernet Fields", description: "", heading: true },
      { text: "eth.addr", description: "Source or destination MAC address" },
      { text: "eth.src", description: "Source MAC address" },
      { text: "eth.dst", description: "Destination MAC address" },
      { text: "eth.type", description: "Ethertype (0x0800=IPv4, 0x0806=ARP, 0x86DD=IPv6)" },
      { text: "eth.len", description: "Ethernet frame length" },
      { text: "eth.lg", description: "Locally administered address bit" },
      { text: "eth.ig", description: "Individual/group (unicast/multicast) bit" },
      { text: "Frame Fields", description: "", heading: true },
      { text: "frame.len", description: "Frame length on the wire" },
      { text: "frame.cap_len", description: "Captured frame length" },
      { text: "frame.number", description: "Frame number in capture" },
      { text: "frame.time", description: "Absolute arrival time" },
      { text: "frame.time_delta", description: "Time since previous displayed frame" },
      { text: "frame.time_delta_displayed", description: "Time since previous displayed frame" },
      { text: "frame.time_relative", description: "Time relative to first frame" },
      { text: "frame.time_epoch", description: "Unix epoch time" },
      { text: "frame.protocols", description: "Protocol stack (e.g. eth:ethertype:ip:udp:sip)" },
      { text: "frame contains \"text\"", description: "Search raw frame bytes for a string", insertable: true },
      { text: "VLAN Fields", description: "", heading: true },
      { text: "vlan.id", description: "VLAN ID (802.1Q tag)" },
      { text: "vlan.priority", description: "VLAN priority (PCP)" },
      { text: "vlan.cfi", description: "VLAN CFI / DEI bit" },
      { text: "vlan.tpid", description: "VLAN Tag Protocol Identifier" },
      { text: "Examples", description: "", heading: true },
      { text: "eth.addr == aa:bb:cc:dd:ee:ff", description: "Traffic to/from specific MAC", insertable: true },
      { text: "eth.dst == ff:ff:ff:ff:ff:ff", description: "Broadcast frames", insertable: true },
      { text: "vlan.id == 100", description: "VLAN 100 traffic", insertable: true },
      { text: "frame.len > 1518", description: "Jumbo / oversized frames", insertable: true },
    ],
  },
  {
    id: "sip",
    title: "SIP (VoIP Signaling)",
    icon: SECTION_ICONS.sip!,
    content: [
      { text: "Request / Response", description: "", heading: true },
      { text: "sip.method", description: "SIP request method (INVITE, REGISTER, BYE, etc.)" },
      { text: "sip.status-code", description: "SIP response status code (200, 404, 503, etc.)" },
      { text: "sip.response_text", description: "SIP response reason phrase" },
      { text: "sip.request-uri", description: "SIP Request-URI" },
      { text: "sip.r-uri", description: "SIP Request-URI (alias)" },
      { text: "Core Headers", description: "", heading: true },
      { text: "sip.call-id", description: "Call-ID header — uniquely identifies a dialog" },
      { text: "sip.from", description: "From header (caller identity)" },
      { text: "sip.to", description: "To header (callee identity)" },
      { text: "sip.contact", description: "Contact header" },
      { text: "sip.via", description: "Via header (routing path)" },
      { text: "sip.cseq", description: "CSeq header (full: \"1 INVITE\")" },
      { text: "sip.cseq.num", description: "CSeq sequence number" },
      { text: "sip.cseq.method", description: "CSeq method name" },
      { text: "sip.content-type", description: "Content-Type header" },
      { text: "sip.content-length", description: "Content-Length header" },
      { text: "sip.expires", description: "Expires header" },
      { text: "sip.max-forwards", description: "Max-Forwards header" },
      { text: "sip.user-agent", description: "User-Agent header" },
      { text: "sip.server", description: "Server header" },
      { text: "URI Sub-fields", description: "", heading: true },
      { text: "sip.from.user", description: "From URI username" },
      { text: "sip.from.host", description: "From URI host" },
      { text: "sip.to.user", description: "To URI username" },
      { text: "sip.to.host", description: "To URI host" },
      { text: "sip.contact.uri", description: "Contact URI" },
      { text: "sip.r-uri.user", description: "Request-URI username" },
      { text: "sip.r-uri.host", description: "Request-URI host" },
      { text: "Authentication", description: "", heading: true },
      { text: "sip.auth.realm", description: "Authentication realm" },
      { text: "sip.auth.nonce", description: "Authentication nonce" },
      { text: "sip.auth.username", description: "Authentication username" },
      { text: "sip.auth.uri", description: "Authentication URI" },
      { text: "sip.auth.algorithm", description: "Authentication algorithm (MD5, SHA-256)" },
      { text: "sip.auth.response", description: "Authentication response hash" },
      { text: "Additional Headers", description: "", heading: true },
      { text: "sip.allow", description: "Allow header (supported methods)" },
      { text: "sip.supported", description: "Supported header (extensions)" },
      { text: "sip.require", description: "Require header" },
      { text: "sip.proxy-require", description: "Proxy-Require header" },
      { text: "sip.route", description: "Route header" },
      { text: "sip.record-route", description: "Record-Route header" },
      { text: "sip.refer-to", description: "Refer-To header" },
      { text: "sip.referred-by", description: "Referred-By header" },
      { text: "sip.replaces", description: "Replaces header" },
      { text: "sip.subscription-state", description: "Subscription-State header" },
      { text: "sip.event", description: "Event header" },
      { text: "sip.reason", description: "Reason header" },
      { text: "sip.p-asserted-identity", description: "P-Asserted-Identity header" },
      { text: "sip.p-preferred-identity", description: "P-Preferred-Identity header" },
      { text: "sip.diversion", description: "Diversion header" },
      { text: "sip.history-info", description: "History-Info header" },
      { text: "sip.privacy", description: "Privacy header" },
      { text: "sip.authorization", description: "Authorization header (full)" },
      { text: "sip.www-authenticate", description: "WWW-Authenticate header (full)" },
      { text: "sip.proxy-authenticate", description: "Proxy-Authenticate header" },
      { text: "sip.proxy-authorization", description: "Proxy-Authorization header" },
      { text: "SIP Status Code Ranges", description: "", heading: true },
      { text: "sip.status-code == 200", description: "200 OK (success)", insertable: true },
      { text: "sip.status-code >= 400", description: "All client/server errors (4xx, 5xx, 6xx)", insertable: true },
      { text: "sip.status-code >= 100 && sip.status-code < 200", description: "Provisional responses (1xx)", insertable: true },
      { text: "sip.status-code == 401 || sip.status-code == 407", description: "Authentication required", insertable: true },
      { text: "sip.status-code == 486 || sip.status-code == 603", description: "Busy / Decline", insertable: true },
      { text: "Common SIP Examples", description: "", heading: true },
      { text: "sip.method == \"INVITE\"", description: "INVITE requests (new calls)", insertable: true },
      { text: "sip.method == \"REGISTER\"", description: "REGISTER requests", insertable: true },
      { text: "sip.method == \"BYE\"", description: "BYE requests (call hangups)", insertable: true },
      { text: "sip.method == \"OPTIONS\"", description: "OPTIONS requests (keep-alive/capability)", insertable: true },
      { text: "sip.method == \"SUBSCRIBE\"", description: "SUBSCRIBE requests", insertable: true },
      { text: "sip.method == \"NOTIFY\"", description: "NOTIFY requests", insertable: true },
      { text: "sip.method == \"REFER\"", description: "REFER requests (call transfer)", insertable: true },
      { text: "sip.method == \"UPDATE\"", description: "UPDATE requests", insertable: true },
      { text: "sip.method == \"INFO\"", description: "INFO requests (DTMF, etc.)", insertable: true },
      { text: "sip.method == \"PRACK\"", description: "PRACK requests (provisional ACK)", insertable: true },
      { text: "sip.method == \"MESSAGE\"", description: "MESSAGE requests (instant messaging)", insertable: true },
      { text: "sip.method == \"PUBLISH\"", description: "PUBLISH requests (presence)", insertable: true },
      { text: "sip.call-id contains \"abc\"", description: "Packets with specific Call-ID substring", insertable: true },
      { text: "sip.from contains \"user@\"", description: "Calls from a specific user", insertable: true },
      { text: "sip.user-agent contains \"Obi\"", description: "Traffic from Obihai devices", insertable: true },
      { text: "sip && ip.addr == 10.0.0.1", description: "SIP traffic to/from a specific host", insertable: true },
    ],
  },
  {
    id: "rtp",
    title: "RTP & RTCP (VoIP Media)",
    icon: SECTION_ICONS.rtp!,
    content: [
      { text: "RTP Fields", description: "", heading: true },
      { text: "rtp.version", description: "RTP version (always 2)" },
      { text: "rtp.p_type  /  rtp.payload_type  /  rtp.pt", description: "Payload type number (0=PCMU, 8=PCMA, 9=G.722, etc.)" },
      { text: "rtp.ssrc", description: "Synchronization Source identifier (hex supported: 0x1234ABCD)" },
      { text: "rtp.seq  /  rtp.sequence", description: "Sequence number" },
      { text: "rtp.timestamp", description: "RTP timestamp" },
      { text: "rtp.marker", description: "Marker bit (1 = start of talkspurt)" },
      { text: "rtp.padding", description: "Padding bit" },
      { text: "rtp.ext  /  rtp.extension", description: "Extension bit" },
      { text: "rtp.cc  /  rtp.csrc.count", description: "CSRC count" },
      { text: "rtp.csrc", description: "Contributing Source identifiers" },
      { text: "rtp.setup-frame", description: "Frame that set up this RTP stream" },
      { text: "Common Payload Types", description: "0=PCMU(G.711μ), 3=GSM, 4=G.723, 8=PCMA(G.711A), 9=G.722, 18=G.729, 96-127=dynamic", heading: true },
      { text: "rtp.p_type == 0", description: "G.711 μ-law (PCMU)", insertable: true },
      { text: "rtp.p_type == 8", description: "G.711 A-law (PCMA)", insertable: true },
      { text: "rtp.p_type == 9", description: "G.722", insertable: true },
      { text: "rtp.p_type == 18", description: "G.729", insertable: true },
      { text: "rtp.p_type >= 96", description: "Dynamic payload types (e.g. H.264)", insertable: true },
      { text: "RTCP Fields", description: "", heading: true },
      { text: "rtcp.pt", description: "RTCP packet type (200=SR, 201=RR, 202=SDES, 203=BYE)" },
      { text: "rtcp.ssrc", description: "RTCP SSRC" },
      { text: "rtcp.version", description: "RTCP version" },
      { text: "rtcp.length", description: "RTCP packet length" },
      { text: "rtcp.sr.ntp_ts", description: "Sender Report NTP timestamp" },
      { text: "rtcp.sr.rtp_ts", description: "Sender Report RTP timestamp" },
      { text: "rtcp.rr.ssrc", description: "Receiver Report SSRC" },
      { text: "rtcp.rr.fraction_lost", description: "Fraction of packets lost" },
      { text: "rtcp.rr.cumulative_lost", description: "Cumulative packets lost" },
      { text: "rtcp.rr.jitter", description: "Interarrival jitter" },
      { text: "rtcp.sdes.type", description: "SDES item type" },
      { text: "rtcp.bye.ssrc", description: "BYE SSRC" },
      { text: "RTP/RTCP Examples", description: "", heading: true },
      { text: "rtp.ssrc == 0x12345678", description: "Specific RTP stream by SSRC", insertable: true },
      { text: "rtp.marker == 1", description: "Packets with marker bit (talkspurt start)", insertable: true },
      { text: "rtp || rtcp", description: "All RTP and RTCP traffic", insertable: true },
      { text: "sip || rtp || rtcp", description: "All VoIP traffic (signaling + media + control)", insertable: true },
    ],
  },
  {
    id: "dns",
    title: "DNS",
    icon: SECTION_ICONS.dns!,
    content: [
      { text: "DNS Fields", description: "", heading: true },
      { text: "dns.id", description: "Transaction ID" },
      { text: "dns.flags", description: "DNS flags field" },
      { text: "dns.flags.response", description: "Response flag (0=query, 1=response)" },
      { text: "dns.flags.opcode", description: "Operation code" },
      { text: "dns.flags.authoritative", description: "Authoritative answer" },
      { text: "dns.flags.truncated", description: "Truncated (TC bit)" },
      { text: "dns.flags.recdesired", description: "Recursion desired (RD)" },
      { text: "dns.flags.recavail", description: "Recursion available (RA)" },
      { text: "dns.flags.rcode", description: "Response code (0=NoError, 3=NXDomain, 2=SERVFAIL)" },
      { text: "dns.count.queries", description: "Number of questions" },
      { text: "dns.count.answers", description: "Number of answer RRs" },
      { text: "dns.count.auth_rr", description: "Number of authority RRs" },
      { text: "dns.count.add_rr", description: "Number of additional RRs" },
      { text: "Query Fields", description: "", heading: true },
      { text: "dns.qry.name", description: "Query name (domain being looked up)" },
      { text: "dns.qry.type", description: "Query type number (1=A, 28=AAAA, 5=CNAME, etc.)" },
      { text: "dns.qry.class", description: "Query class (1=IN)" },
      { text: "Record Types", description: "1=A, 2=NS, 5=CNAME, 6=SOA, 12=PTR, 15=MX, 16=TXT, 28=AAAA, 33=SRV, 35=NAPTR, 255=ANY", heading: true },
      { text: "Response Fields", description: "", heading: true },
      { text: "dns.resp.name", description: "Response record name" },
      { text: "dns.resp.type", description: "Response record type" },
      { text: "dns.resp.ttl", description: "Response record TTL" },
      { text: "dns.a", description: "A record (IPv4 address)" },
      { text: "dns.aaaa", description: "AAAA record (IPv6 address)" },
      { text: "dns.cname", description: "CNAME record (canonical name)" },
      { text: "dns.mx", description: "MX record (mail exchange)" },
      { text: "dns.ns", description: "NS record (name server)" },
      { text: "dns.ptr", description: "PTR record (reverse lookup)" },
      { text: "dns.soa", description: "SOA record (start of authority)" },
      { text: "dns.srv", description: "SRV record (service locator)" },
      { text: "dns.txt", description: "TXT record" },
      { text: "dns.naptr", description: "NAPTR record (used by SIP/ENUM)" },
      { text: "DNS Examples", description: "", heading: true },
      { text: "dns.flags.response == 0", description: "DNS queries only", insertable: true },
      { text: "dns.flags.response == 1", description: "DNS responses only", insertable: true },
      { text: "dns.flags.rcode != 0", description: "DNS errors (NXDomain, SERVFAIL, etc.)", insertable: true },
      { text: "dns.qry.name contains \"example.com\"", description: "Lookups for a specific domain", insertable: true },
      { text: "dns.qry.type == 1", description: "A record queries", insertable: true },
      { text: "dns.qry.type == 28", description: "AAAA record queries", insertable: true },
      { text: "dns.qry.type == 33", description: "SRV record queries (VoIP)", insertable: true },
      { text: "dns.qry.type == 35", description: "NAPTR record queries (ENUM/SIP)", insertable: true },
    ],
  },
  {
    id: "http",
    title: "HTTP & TLS/SSL",
    icon: SECTION_ICONS.http!,
    content: [
      { text: "HTTP Request Fields", description: "", heading: true },
      { text: "http.request", description: "HTTP request (existence test)" },
      { text: "http.request.method", description: "HTTP method (GET, POST, PUT, DELETE, etc.)" },
      { text: "http.request.uri", description: "Request URI path" },
      { text: "http.request.full_uri", description: "Full request URI" },
      { text: "http.request.version", description: "HTTP version (HTTP/1.1, etc.)" },
      { text: "http.host", description: "Host header" },
      { text: "http.user_agent", description: "User-Agent header" },
      { text: "http.referer", description: "Referer header" },
      { text: "http.cookie", description: "Cookie header" },
      { text: "http.authorization", description: "Authorization header" },
      { text: "http.accept", description: "Accept header" },
      { text: "http.accept_encoding", description: "Accept-Encoding header" },
      { text: "HTTP Response Fields", description: "", heading: true },
      { text: "http.response", description: "HTTP response (existence test)" },
      { text: "http.response.code", description: "HTTP status code (200, 404, 500, etc.)" },
      { text: "http.response.phrase", description: "HTTP status phrase" },
      { text: "http.response.version", description: "HTTP response version" },
      { text: "http.content_type", description: "Content-Type header" },
      { text: "http.content_length", description: "Content-Length header" },
      { text: "http.server", description: "Server header" },
      { text: "http.location", description: "Location header (redirects)" },
      { text: "http.set_cookie", description: "Set-Cookie header" },
      { text: "http.www_authenticate", description: "WWW-Authenticate header" },
      { text: "http.transfer_encoding", description: "Transfer-Encoding header" },
      { text: "http.connection", description: "Connection header" },
      { text: "TLS / SSL Fields", description: "", heading: true },
      { text: "tls.record.version", description: "TLS record version" },
      { text: "tls.record.content_type", description: "TLS content type (20=ChangeCipher, 21=Alert, 22=Handshake, 23=Application)" },
      { text: "tls.record.length", description: "TLS record length" },
      { text: "tls.handshake.type", description: "Handshake type (1=ClientHello, 2=ServerHello, 11=Certificate)" },
      { text: "tls.handshake.version", description: "TLS handshake version" },
      { text: "tls.handshake.ciphersuite", description: "Negotiated cipher suite" },
      { text: "tls.handshake.extensions_server_name", description: "Server Name Indication (SNI)" },
      { text: "tls.alert.level", description: "Alert level (1=warning, 2=fatal)" },
      { text: "tls.alert.description", description: "Alert description" },
      { text: "HTTP/TLS Examples", description: "", heading: true },
      { text: "http.request.method == \"GET\"", description: "GET requests", insertable: true },
      { text: "http.request.method == \"POST\"", description: "POST requests", insertable: true },
      { text: "http.response.code >= 400", description: "HTTP errors (4xx + 5xx)", insertable: true },
      { text: "http.response.code == 200", description: "Successful responses", insertable: true },
      { text: "http.host contains \"example.com\"", description: "Requests to specific host", insertable: true },
      { text: "tls.handshake.type == 1", description: "TLS ClientHello", insertable: true },
      { text: "tls.handshake.extensions_server_name contains \"example\"", description: "TLS SNI filter", insertable: true },
    ],
  },
  {
    id: "arp-icmp",
    title: "ARP & ICMP",
    icon: SECTION_ICONS["arp-icmp"]!,
    content: [
      { text: "ARP Fields", description: "", heading: true },
      { text: "arp.opcode", description: "ARP opcode (1=Request, 2=Reply)" },
      { text: "arp.src.hw_mac", description: "Sender hardware (MAC) address" },
      { text: "arp.dst.hw_mac", description: "Target hardware (MAC) address" },
      { text: "arp.src.proto_ipv4", description: "Sender protocol (IP) address" },
      { text: "arp.dst.proto_ipv4", description: "Target protocol (IP) address" },
      { text: "arp.hw.type", description: "Hardware type (1=Ethernet)" },
      { text: "arp.proto.type", description: "Protocol type (0x0800=IPv4)" },
      { text: "ICMP Fields", description: "", heading: true },
      { text: "icmp.type", description: "ICMP type (0=Echo Reply, 3=Dest Unreachable, 8=Echo Request, 11=TTL Exceeded)" },
      { text: "icmp.code", description: "ICMP code (sub-type)" },
      { text: "icmp.checksum", description: "ICMP checksum" },
      { text: "icmp.ident", description: "ICMP identifier (Echo)" },
      { text: "icmp.seq", description: "ICMP sequence number (Echo)" },
      { text: "icmp.mtu", description: "ICMP next-hop MTU" },
      { text: "ICMPv6 Fields", description: "", heading: true },
      { text: "icmpv6.type", description: "ICMPv6 type" },
      { text: "icmpv6.code", description: "ICMPv6 code" },
      { text: "icmpv6.nd.target", description: "Neighbor Discovery target" },
      { text: "Examples", description: "", heading: true },
      { text: "arp.opcode == 1", description: "ARP requests (\"Who has?\")", insertable: true },
      { text: "arp.opcode == 2", description: "ARP replies", insertable: true },
      { text: "icmp.type == 8", description: "Ping requests (Echo Request)", insertable: true },
      { text: "icmp.type == 0", description: "Ping replies (Echo Reply)", insertable: true },
      { text: "icmp.type == 3", description: "Destination Unreachable", insertable: true },
      { text: "icmp.type == 11", description: "TTL Exceeded (traceroute)", insertable: true },
    ],
  },
  {
    id: "other",
    title: "DHCP, STUN, NTP & Others",
    icon: SECTION_ICONS.other!,
    content: [
      { text: "DHCP Fields", description: "", heading: true },
      { text: "dhcp.option.dhcp", description: "DHCP message type (1=Discover, 2=Offer, 3=Request, 5=ACK, 6=NAK)" },
      { text: "dhcp.option.subnet_mask", description: "Subnet mask option" },
      { text: "dhcp.option.router", description: "Router (default gateway) option" },
      { text: "dhcp.option.domain_name_server", description: "DNS server option" },
      { text: "dhcp.option.hostname", description: "Client hostname" },
      { text: "dhcp.option.requested_ip", description: "Requested IP address" },
      { text: "dhcp.option.server_id", description: "DHCP server identifier" },
      { text: "dhcp.option.lease_time", description: "IP address lease time" },
      { text: "dhcp.hw.mac_addr", description: "Client MAC address" },
      { text: "dhcp.ip.client", description: "Client IP address" },
      { text: "dhcp.ip.server", description: "Server IP address (next server)" },
      { text: "STUN Fields", description: "", heading: true },
      { text: "stun.type", description: "STUN message type" },
      { text: "stun.length", description: "STUN message length" },
      { text: "stun.transaction_id", description: "STUN transaction ID" },
      { text: "stun.attr.mapped_address", description: "Mapped address (public IP:port)" },
      { text: "stun.attr.xor_mapped_address", description: "XOR-mapped address" },
      { text: "NTP Fields", description: "", heading: true },
      { text: "ntp.version", description: "NTP version" },
      { text: "ntp.mode", description: "NTP mode (3=Client, 4=Server)" },
      { text: "ntp.stratum", description: "NTP stratum (1=primary, 2-15=secondary)" },
      { text: "SNMP Fields", description: "", heading: true },
      { text: "snmp.version", description: "SNMP version (0=v1, 1=v2c, 3=v3)" },
      { text: "snmp.community", description: "SNMP community string" },
      { text: "snmp.pdu_type", description: "PDU type (0=Get, 1=GetNext, 2=Response, 3=Set)" },
      { text: "snmp.oid", description: "Object Identifier" },
      { text: "SSH Fields", description: "", heading: true },
      { text: "ssh.protocol", description: "SSH protocol string" },
      { text: "ssh.msg_code", description: "SSH message code" },
      { text: "FTP Fields", description: "", heading: true },
      { text: "ftp.request.command", description: "FTP command (USER, PASS, LIST, RETR, etc.)" },
      { text: "ftp.request.arg", description: "FTP command argument" },
      { text: "ftp.response.code", description: "FTP response code" },
      { text: "ftp.response.arg", description: "FTP response text" },
      { text: "SMB Fields", description: "", heading: true },
      { text: "smb.cmd", description: "SMB command" },
      { text: "smb2.cmd", description: "SMB2 command" },
      { text: "smb2.filename", description: "SMB2 filename" },
      { text: "Routing Protocols", description: "", heading: true },
      { text: "ospf.type", description: "OSPF message type" },
      { text: "ospf.router_id", description: "OSPF router ID" },
      { text: "bgp.type", description: "BGP message type" },
      { text: "bgp.as_path", description: "BGP AS path" },
      { text: "Tunneling", description: "", heading: true },
      { text: "gre.proto", description: "GRE encapsulated protocol" },
      { text: "gre.key", description: "GRE key" },
      { text: "mpls.label", description: "MPLS label" },
      { text: "mpls.ttl", description: "MPLS TTL" },
      { text: "vxlan.vni", description: "VXLAN Network Identifier" },
      { text: "QUIC", description: "", heading: true },
      { text: "quic.version", description: "QUIC version" },
      { text: "quic.dcid", description: "Destination Connection ID" },
      { text: "quic.scid", description: "Source Connection ID" },
    ],
  },
  {
    id: "advanced",
    title: "Advanced Syntax",
    icon: SECTION_ICONS.advanced!,
    content: [
      { text: "Field Presence (Existence Test)", description: "A bare field name is true if the field exists in the packet. No operator needed.", heading: true },
      { text: "sip.method", description: "True if the packet contains a SIP method (i.e. is a SIP request)", insertable: true },
      { text: "http.request", description: "True if the packet is an HTTP request", insertable: true },
      { text: "tcp.options.mss", description: "True if MSS option present", insertable: true },
      { text: "Byte Slices (Offset:Length)", description: "Extract bytes from a field. Syntax: field[offset:length]. Offset/length in bytes.", heading: true },
      { text: "eth.src[0:3] == aa:bb:cc", description: "First 3 bytes of source MAC (OUI match)", insertable: true },
      { text: "frame[0:2] == ff:ff", description: "First 2 bytes of raw frame", insertable: true },
      { text: "ip.src[0:2] == c0:a8", description: "Source IP starts with 192.168 (0xC0A8)", insertable: true },
      { text: "Membership Operator (in)", description: "Test if a field value is a member of a set. Use curly braces. Ranges (a..b) are supported.", heading: true },
      { text: "tcp.port in {80, 443, 8080}", description: "TCP port is one of these values", insertable: true },
      { text: "tcp.port in {1..1024}", description: "TCP port in range 1-1024 (well-known ports)", insertable: true },
      { text: "http.response.code in {200, 301, 302, 304}", description: "Common successful/redirect HTTP codes", insertable: true },
      { text: "ip.addr in {192.168.1.0/24}", description: "IP in a subnet (CIDR in set)", insertable: true },
      { text: "Regular Expressions (matches / ~)", description: "Perl-compatible regex. Case-insensitive by default.", heading: true },
      { text: "http.host matches \".*\\.google\\.com$\"", description: "Host ending in .google.com", insertable: true },
      { text: "sip.from ~ \"sip:.*@example\\.com\"", description: "SIP From matching a pattern", insertable: true },
      { text: "dns.qry.name matches \".*\\.ru$\"", description: "DNS queries for .ru domains", insertable: true },
      { text: "String Contains", description: "Case-sensitive substring search.", heading: true },
      { text: "frame contains \"password\"", description: "Raw packet bytes contain 'password'", insertable: true },
      { text: "http.user_agent contains \"Mozilla\"", description: "Mozilla-based User-Agent", insertable: true },
      { text: "sip.user-agent contains \"Obi\"", description: "Obihai VoIP devices", insertable: true },
      { text: "Display Filter Functions", description: "Wireshark provides built-in functions for filters.", heading: true },
      { text: "len()", description: "Returns byte length of a field. Example: len(sip.call-id) > 20" },
      { text: "count()", description: "Returns occurrence count. Example: count(ip.addr) > 2" },
      { text: "string()", description: "Converts numeric field to string. Example: string(ip.addr) contains \"192\"" },
      { text: "upper() / lower()", description: "Case conversion. Example: lower(http.host) contains \"example\"" },
      { text: "max() / min()", description: "Maximum/minimum value of multi-instance field" },
      { text: "abs()", description: "Absolute value. Example: abs(tcp.time_delta) > 1" },
      { text: "Value Types", description: "Fields can have different types. Use the right value format.", heading: true },
      { text: "Unsigned integer", description: "Decimal (80), hex (0x50), octal (0120). Example: tcp.port == 80" },
      { text: "IPv4 address", description: "Dotted notation. Example: ip.addr == 192.168.1.1" },
      { text: "IPv6 address", description: "Colon notation. Example: ipv6.addr == ::1" },
      { text: "Ethernet address", description: "Colon-separated hex. Example: eth.src == aa:bb:cc:dd:ee:ff" },
      { text: "Boolean", description: "0/1, true/false, True/False. Example: tcp.flags.syn == true" },
      { text: "String", description: "Quoted (\"hello\") or raw. Example: sip.method == \"INVITE\"" },
      { text: "Byte string", description: "Colon-separated hex. Example: eth.dst == ff:ff:ff:ff:ff:ff" },
      { text: "Protocol Layers", description: "Some packets have nested protocol layers. Use # to access a specific layer.", heading: true },
      { text: "ip.addr#1 == 10.0.0.1", description: "First IP layer address (e.g. outer tunnel)" },
      { text: "ip.addr#2 == 192.168.1.1", description: "Second IP layer (e.g. inner tunnel)" },
    ],
  },
  {
    id: "sdp",
    title: "SDP (Media Negotiation)",
    icon: SECTION_ICONS.sdp!,
    content: [
      { text: "SDP Fields", description: "SDP is carried inside SIP bodies. These fields describe media sessions.", heading: true },
      { text: "sdp", description: "Packets containing SDP body", insertable: true },
      { text: "sdp.session_name", description: "SDP session name (s= line)" },
      { text: "sdp.owner", description: "SDP owner/creator (o= line)" },
      { text: "sdp.owner.username", description: "SDP origin username" },
      { text: "sdp.owner.sessionid", description: "SDP origin session ID" },
      { text: "sdp.owner.version", description: "SDP origin session version" },
      { text: "sdp.owner.address", description: "SDP origin address" },
      { text: "sdp.connection_info", description: "SDP connection info (c= line)" },
      { text: "sdp.connection_info.address", description: "SDP connection address (media IP)" },
      { text: "sdp.media", description: "SDP media description (m= line)" },
      { text: "sdp.media.media", description: "Media type (audio, video, application, etc.)" },
      { text: "sdp.media.port", description: "Media port number" },
      { text: "sdp.media.proto", description: "Transport protocol (RTP/AVP, UDP, etc.)" },
      { text: "sdp.media.format", description: "Media format / payload type" },
      { text: "sdp.media_attribute", description: "SDP attribute (a= line)" },
      { text: "sdp.media_attr", description: "SDP media attribute value" },
      { text: "sdp.mime_type", description: "SDP MIME type (from rtpmap)" },
      { text: "sdp.sample_rate", description: "SDP sample rate" },
      { text: "sdp.fmtp", description: "SDP format parameters (fmtp)" },
      { text: "sdp.bandwidth", description: "SDP bandwidth (b= line)" },
      { text: "sdp.time", description: "SDP time description (t= line)" },
      { text: "SDP Examples", description: "", heading: true },
      { text: "sdp.media.port == 0", description: "Media port set to 0 (stream rejected/disabled)", insertable: true },
      { text: "sdp.connection_info.address != \"0.0.0.0\"", description: "Active media connections", insertable: true },
      { text: "sdp.media.media == \"audio\"", description: "Audio media lines", insertable: true },
      { text: "sdp.media.media == \"video\"", description: "Video media lines", insertable: true },
      { text: "sip && sdp", description: "SIP packets that carry SDP bodies", insertable: true },
    ],
  },
  {
    id: "t38",
    title: "T.38 / Virtual Fax",
    icon: SECTION_ICONS.t38!,
    content: [
      { text: "T.38 Fields", description: "T.38 is the ITU standard for virtual faxing.", heading: true },
      { text: "t38", description: "Show only T.38 packets", insertable: true },
      { text: "t38.type_of_msg", description: "T.38 message type" },
      { text: "t38.data_field", description: "T.38 data field type" },
      { text: "t38.field_type", description: "T.38 field type (hdlc-data, t4-non-ecm-data, etc.)" },
      { text: "UDPTL Fields", description: "UDPTL is the transport layer commonly used for T.38.", heading: true },
      { text: "udptl", description: "Show only UDPTL packets", insertable: true },
      { text: "udptl.seq", description: "UDPTL sequence number" },
    ],
  },
  {
    id: "sctp",
    title: "SCTP",
    icon: SECTION_ICONS.sctp!,
    content: [
      { text: "SCTP Fields", description: "Stream Control Transmission Protocol — used in telecom (SS7 over IP, Diameter, etc.).", heading: true },
      { text: "sctp", description: "Show only SCTP packets", insertable: true },
      { text: "sctp.srcport", description: "SCTP source port" },
      { text: "sctp.dstport", description: "SCTP destination port" },
      { text: "sctp.port", description: "SCTP port (src or dst)" },
      { text: "sctp.checksum", description: "SCTP checksum" },
      { text: "sctp.chunk_type", description: "SCTP chunk type" },
      { text: "sctp.chunk_length", description: "SCTP chunk length" },
      { text: "sctp.chunk_flags", description: "SCTP chunk flags" },
      { text: "sctp.verification_tag", description: "SCTP verification tag" },
      { text: "sctp.assoc_index", description: "SCTP association index" },
      { text: "sctp.data.tsn", description: "Transmission Sequence Number" },
      { text: "sctp.data.stream_id", description: "Stream identifier" },
      { text: "sctp.data.payload_proto_id", description: "Payload protocol identifier" },
    ],
  },
  {
    id: "telecom",
    title: "Telecom (GTP, Diameter, RADIUS)",
    icon: SECTION_ICONS.telecom!,
    content: [
      { text: "GTP Fields (GPRS Tunneling)", description: "", heading: true },
      { text: "gtp", description: "Show GTP packets", insertable: true },
      { text: "gtp.version", description: "GTP version" },
      { text: "gtp.message", description: "GTP message type" },
      { text: "gtp.teid", description: "Tunnel Endpoint ID" },
      { text: "gtp.seq", description: "GTP sequence number" },
      { text: "gtpv2", description: "GTPv2-C packets", insertable: true },
      { text: "gtpv2.message_type", description: "GTPv2 message type" },
      { text: "Diameter Fields", description: "", heading: true },
      { text: "diameter", description: "Show Diameter packets", insertable: true },
      { text: "diameter.cmd.code", description: "Diameter command code" },
      { text: "diameter.applicationId", description: "Diameter application ID" },
      { text: "diameter.flags.request", description: "Diameter request flag" },
      { text: "diameter.Session-Id", description: "Diameter Session-ID AVP" },
      { text: "diameter.Origin-Host", description: "Diameter Origin-Host AVP" },
      { text: "diameter.Origin-Realm", description: "Diameter Origin-Realm AVP" },
      { text: "diameter.Result-Code", description: "Diameter Result-Code AVP" },
      { text: "RADIUS Fields", description: "", heading: true },
      { text: "radius", description: "Show RADIUS packets", insertable: true },
      { text: "radius.code", description: "RADIUS packet type (1=Access-Request, 2=Accept, 3=Reject)" },
      { text: "radius.id", description: "RADIUS identifier" },
      { text: "radius.authenticator", description: "RADIUS authenticator" },
      { text: "radius.User_Name", description: "RADIUS User-Name attribute" },
      { text: "radius.NAS_IP_Address", description: "RADIUS NAS-IP-Address" },
      { text: "radius.Calling_Station_Id", description: "RADIUS Calling-Station-Id" },
      { text: "radius.Called_Station_Id", description: "RADIUS Called-Station-Id" },
      { text: "radius.Acct_Status_Type", description: "RADIUS Acct-Status-Type" },
      { text: "SS7 / SIGTRAN", description: "", heading: true },
      { text: "m3ua", description: "M3UA (MTP3 User Adaptation)", insertable: true },
      { text: "m2ua", description: "M2UA (MTP2 User Adaptation)", insertable: true },
      { text: "isup", description: "ISUP (ISDN User Part)", insertable: true },
      { text: "isup.message_type", description: "ISUP message type" },
      { text: "mtp3", description: "MTP3 (Message Transfer Part 3)", insertable: true },
      { text: "mtp3.opc", description: "MTP3 originating point code" },
      { text: "mtp3.dpc", description: "MTP3 destination point code" },
      { text: "sccp", description: "SCCP (Signalling Connection Control Part)", insertable: true },
      { text: "tcap", description: "TCAP (Transaction Capabilities Application Part)", insertable: true },
      { text: "map", description: "GSM MAP (Mobile Application Part)", insertable: true },
      { text: "camel", description: "CAMEL (Customised Applications for Mobile)", insertable: true },
    ],
  },
  {
    id: "email",
    title: "SMTP, POP, IMAP",
    icon: SECTION_ICONS.email!,
    content: [
      { text: "SMTP Fields", description: "", heading: true },
      { text: "smtp", description: "Show SMTP packets", insertable: true },
      { text: "smtp.req.command", description: "SMTP command (EHLO, MAIL, RCPT, DATA, etc.)" },
      { text: "smtp.req.parameter", description: "SMTP command parameter" },
      { text: "smtp.rsp.code", description: "SMTP response code" },
      { text: "smtp.rsp.parameter", description: "SMTP response text" },
      { text: "smtp.data.fragments", description: "SMTP data fragments" },
      { text: "POP3 Fields", description: "", heading: true },
      { text: "pop", description: "Show POP3 packets", insertable: true },
      { text: "pop.request.command", description: "POP3 command (USER, PASS, LIST, RETR, etc.)" },
      { text: "pop.response.indicator", description: "POP3 response (+OK, -ERR)" },
      { text: "IMAP Fields", description: "", heading: true },
      { text: "imap", description: "Show IMAP packets", insertable: true },
      { text: "imap.request", description: "IMAP request" },
      { text: "imap.response", description: "IMAP response" },
      { text: "Email Examples", description: "", heading: true },
      { text: "smtp.req.command == \"MAIL\"", description: "SMTP MAIL FROM commands", insertable: true },
      { text: "smtp.rsp.code >= 400", description: "SMTP errors", insertable: true },
      { text: "pop.request.command == \"PASS\"", description: "POP3 password transmission (insecure)", insertable: true },
    ],
  },
  {
    id: "auth",
    title: "LDAP, Kerberos & Auth",
    icon: SECTION_ICONS.auth!,
    content: [
      { text: "LDAP Fields", description: "", heading: true },
      { text: "ldap", description: "Show LDAP packets", insertable: true },
      { text: "ldap.protocolOp", description: "LDAP operation type" },
      { text: "ldap.baseObject", description: "LDAP base DN" },
      { text: "ldap.filter", description: "LDAP search filter string" },
      { text: "ldap.bindResponse.resultCode", description: "Bind result code" },
      { text: "Kerberos Fields", description: "", heading: true },
      { text: "kerberos", description: "Show Kerberos packets", insertable: true },
      { text: "kerberos.msg_type", description: "Kerberos message type" },
      { text: "kerberos.CNameString", description: "Client principal name" },
      { text: "kerberos.SNameString", description: "Service principal name" },
      { text: "kerberos.realm", description: "Kerberos realm" },
      { text: "kerberos.error_code", description: "Kerberos error code" },
      { text: "NTLMSSP Fields", description: "", heading: true },
      { text: "ntlmssp", description: "Show NTLM packets", insertable: true },
      { text: "ntlmssp.messagetype", description: "NTLMSSP message type (1=Negotiate, 2=Challenge, 3=Auth)" },
      { text: "ntlmssp.auth.domain", description: "NTLM domain name" },
      { text: "ntlmssp.auth.username", description: "NTLM username" },
    ],
  },
  {
    id: "wifi",
    title: "Wi-Fi / 802.11",
    icon: SECTION_ICONS.wifi!,
    content: [
      { text: "802.11 Frame Fields", description: "", heading: true },
      { text: "wlan", description: "Show 802.11 wireless frames", insertable: true },
      { text: "wlan.fc.type", description: "Frame type (0=Management, 1=Control, 2=Data)" },
      { text: "wlan.fc.type_subtype", description: "Frame type/subtype" },
      { text: "wlan.fc.retry", description: "Retry flag" },
      { text: "wlan.fc.protected", description: "Protected (encrypted) flag" },
      { text: "wlan.addr", description: "Any 802.11 address" },
      { text: "wlan.sa", description: "Source address" },
      { text: "wlan.da", description: "Destination address" },
      { text: "wlan.ta", description: "Transmitter address" },
      { text: "wlan.ra", description: "Receiver address" },
      { text: "wlan.bssid", description: "BSSID (AP MAC)" },
      { text: "wlan.ssid", description: "SSID (network name)" },
      { text: "wlan_radio.signal_dbm", description: "Signal strength (dBm)" },
      { text: "wlan_radio.channel", description: "Wi-Fi channel" },
      { text: "wlan_radio.frequency", description: "Wi-Fi frequency (MHz)" },
      { text: "wlan_radio.data_rate", description: "Data rate (Mbps)" },
      { text: "Wi-Fi Examples", description: "", heading: true },
      { text: "wlan.fc.type == 0", description: "Management frames (beacons, probes, auth)", insertable: true },
      { text: "wlan.fc.type_subtype == 0x08", description: "Beacon frames", insertable: true },
      { text: "wlan.fc.type_subtype == 0x04", description: "Probe Request frames", insertable: true },
      { text: "wlan.fc.type_subtype == 0x00", description: "Association Request frames", insertable: true },
      { text: "wlan.fc.type_subtype == 0x0b", description: "Authentication frames", insertable: true },
      { text: "wlan.fc.type_subtype == 0x0c", description: "Deauthentication frames", insertable: true },
      { text: "wlan.ssid == \"MyNetwork\"", description: "Specific SSID", insertable: true },
      { text: "wlan.bssid == aa:bb:cc:dd:ee:ff", description: "Specific access point", insertable: true },
    ],
  },
  {
    id: "industrial",
    title: "Industrial / SCADA",
    icon: SECTION_ICONS.industrial!,
    content: [
      { text: "Modbus Fields", description: "", heading: true },
      { text: "modbus", description: "Show Modbus packets", insertable: true },
      { text: "modbus.func_code", description: "Modbus function code" },
      { text: "modbus.reference_num", description: "Modbus register reference" },
      { text: "modbus.word_cnt", description: "Modbus word count" },
      { text: "modbus.exception_code", description: "Modbus exception code" },
      { text: "mbtcp.trans_id", description: "Modbus TCP transaction ID" },
      { text: "mbtcp.unit_id", description: "Modbus TCP unit ID" },
      { text: "DNP3 Fields", description: "", heading: true },
      { text: "dnp3", description: "Show DNP3 packets", insertable: true },
      { text: "dnp3.src", description: "DNP3 source address" },
      { text: "dnp3.dst", description: "DNP3 destination address" },
      { text: "dnp3.ctl.func_code", description: "DNP3 function code" },
      { text: "IEC 60870-5-104", description: "", heading: true },
      { text: "iec60870_104", description: "Show IEC 104 packets", insertable: true },
      { text: "OPC UA Fields", description: "", heading: true },
      { text: "opcua", description: "Show OPC UA packets", insertable: true },
      { text: "opcua.transport.type", description: "OPC UA transport type" },
      { text: "S7comm (Siemens)", description: "", heading: true },
      { text: "s7comm", description: "Show S7comm packets (Siemens PLCs)", insertable: true },
      { text: "s7comm.param.func", description: "S7comm function code" },
      { text: "EtherNet/IP & CIP", description: "", heading: true },
      { text: "enip", description: "Show EtherNet/IP packets", insertable: true },
      { text: "cip", description: "Show CIP packets", insertable: true },
      { text: "cip.service", description: "CIP service code" },
    ],
  },
  {
    id: "database",
    title: "Database Protocols",
    icon: SECTION_ICONS.database!,
    content: [
      { text: "MySQL Fields", description: "", heading: true },
      { text: "mysql", description: "Show MySQL packets", insertable: true },
      { text: "mysql.command", description: "MySQL command type" },
      { text: "mysql.query", description: "MySQL query text" },
      { text: "mysql.error_code", description: "MySQL error code" },
      { text: "PostgreSQL Fields", description: "", heading: true },
      { text: "pgsql", description: "Show PostgreSQL packets", insertable: true },
      { text: "pgsql.type", description: "PostgreSQL message type" },
      { text: "pgsql.query", description: "PostgreSQL query text" },
      { text: "Microsoft SQL Server", description: "", heading: true },
      { text: "tds", description: "Show TDS (MS SQL) packets", insertable: true },
      { text: "tds.type", description: "TDS message type" },
      { text: "MongoDB Fields", description: "", heading: true },
      { text: "mongo", description: "Show MongoDB packets", insertable: true },
      { text: "mongo.opcode", description: "MongoDB operation code" },
      { text: "Examples", description: "", heading: true },
      { text: "mysql.command == 3", description: "MySQL queries (COM_QUERY)", insertable: true },
      { text: "mysql.error_code != 0", description: "MySQL errors", insertable: true },
      { text: "pgsql.type == \"Q\"", description: "PostgreSQL simple queries", insertable: true },
    ],
  },
  {
    id: "bluetooth",
    title: "Bluetooth",
    icon: SECTION_ICONS.bluetooth!,
    content: [
      { text: "Bluetooth Fields", description: "", heading: true },
      { text: "bluetooth", description: "Show Bluetooth packets", insertable: true },
      { text: "bthci_evt", description: "Bluetooth HCI events", insertable: true },
      { text: "bthci_cmd", description: "Bluetooth HCI commands", insertable: true },
      { text: "bthci_acl", description: "Bluetooth ACL data", insertable: true },
      { text: "btl2cap", description: "Bluetooth L2CAP", insertable: true },
      { text: "btrfcomm", description: "Bluetooth RFCOMM", insertable: true },
      { text: "btatt", description: "Bluetooth ATT (Low Energy)", insertable: true },
      { text: "btsmp", description: "Bluetooth SMP (Security Manager)", insertable: true },
      { text: "BLE (Low Energy)", description: "", heading: true },
      { text: "btle", description: "Bluetooth Low Energy link layer", insertable: true },
      { text: "btle.advertising_header.pdu_type", description: "BLE advertising PDU type" },
      { text: "btatt.opcode", description: "BLE ATT opcode" },
      { text: "btatt.handle", description: "BLE ATT handle" },
    ],
  },
  {
    id: "usb",
    title: "USB",
    icon: SECTION_ICONS.usb!,
    content: [
      { text: "USB Fields", description: "", heading: true },
      { text: "usb", description: "Show USB packets", insertable: true },
      { text: "usb.transfer_type", description: "Transfer type (0=ISO, 1=Interrupt, 2=Control, 3=Bulk)" },
      { text: "usb.endpoint_address", description: "Endpoint address" },
      { text: "usb.device_address", description: "Device address" },
      { text: "usb.bcdUSB", description: "USB version" },
      { text: "usb.idVendor", description: "Vendor ID" },
      { text: "usb.idProduct", description: "Product ID" },
      { text: "usb.setup.bRequest", description: "USB setup request type" },
      { text: "usb.urb_type", description: "URB type" },
    ],
  },
  {
    id: "special",
    title: "Wireshark Special Fields",
    icon: SECTION_ICONS.special!,
    content: [
      { text: "Expert Info Fields", description: "Wireshark's built-in analysis annotations.", heading: true },
      { text: "_ws.expert", description: "Any expert info present", insertable: true },
      { text: "_ws.expert.severity", description: "Expert info severity (0=Comment, 1=Chat, 2=Note, 3=Warn, 4=Error)" },
      { text: "_ws.expert.message", description: "Expert info message text" },
      { text: "_ws.expert.group", description: "Expert info group" },
      { text: "Coloring / Display", description: "", heading: true },
      { text: "_ws.col.info", description: "Info column text (as displayed)" },
      { text: "_ws.col.protocol", description: "Protocol column text" },
      { text: "_ws.col.source", description: "Source column text" },
      { text: "_ws.col.destination", description: "Destination column text" },
      { text: "Conversation / Stream", description: "", heading: true },
      { text: "tcp.stream", description: "TCP stream index (follow TCP stream)", insertable: true },
      { text: "udp.stream", description: "UDP stream index", insertable: true },
      { text: "tcp.stream eq 5", description: "Specific TCP conversation by stream index", insertable: true },
      { text: "Packet Marking", description: "", heading: true },
      { text: "frame.marked", description: "Manually marked packets", insertable: true },
      { text: "frame.ignored", description: "Ignored packets", insertable: true },
      { text: "frame.comment", description: "Packets with comments" },
      { text: "frame.ref_time", description: "Packets set as time reference", insertable: true },
      { text: "Capture Info", description: "", heading: true },
      { text: "frame.cap_len", description: "Capture length (may differ from wire length)" },
      { text: "frame.interface_id", description: "Capture interface index" },
      { text: "frame.interface_name", description: "Capture interface name" },
    ],
  },
  {
    id: "recipes",
    title: "Common Recipes",
    icon: SECTION_ICONS.recipes!,
    content: [
      { text: "VoIP Troubleshooting", description: "", heading: true },
      { text: "sip || rtp || rtcp", description: "All VoIP traffic", insertable: true },
      { text: "sip.status-code >= 400", description: "SIP errors only", insertable: true },
      { text: "sip.method == \"INVITE\" || sip.status-code == 200", description: "Call setups and answers", insertable: true },
      { text: "sip.method == \"REGISTER\" && sip.status-code >= 400", description: "Failed registrations", insertable: true },
      { text: "rtp.p_type == 0 || rtp.p_type == 8", description: "G.711 audio streams", insertable: true },
      { text: "Network Troubleshooting", description: "", heading: true },
      { text: "tcp.analysis.retransmission", description: "TCP retransmissions", insertable: true },
      { text: "tcp.flags.rst == 1", description: "Connection resets", insertable: true },
      { text: "tcp.flags.syn == 1 && tcp.flags.ack == 0", description: "New connection attempts", insertable: true },
      { text: "icmp.type == 3", description: "Destination unreachable", insertable: true },
      { text: "dns.flags.rcode != 0", description: "DNS failures", insertable: true },
      { text: "frame.len > 1500", description: "Oversized packets", insertable: true },
      { text: "Security Analysis", description: "", heading: true },
      { text: "tcp.port == 23", description: "Telnet (unencrypted remote access)", insertable: true },
      { text: "ftp.request.command == \"PASS\"", description: "FTP password transmission", insertable: true },
      { text: "http.request.method == \"POST\" && http.content_type contains \"form\"", description: "Form submissions", insertable: true },
      { text: "dns.qry.name contains \"malware\"", description: "Suspicious DNS lookups", insertable: true },
      { text: "Traffic Isolation", description: "", heading: true },
      { text: "ip.addr == 192.168.1.100 && ip.addr == 192.168.1.1", description: "Conversation between two hosts", insertable: true },
      { text: "!(arp || dns || stp)", description: "Hide noise protocols", insertable: true },
      { text: "ip.src == 10.0.0.0/8 && !ip.dst == 10.0.0.0/8", description: "Outbound traffic from private network", insertable: true },
      { text: "tcp.port in {80, 443, 8080, 8443}", description: "All web traffic", insertable: true },
      { text: "ip.addr in {10.0.0.1, 10.0.0.2, 10.0.0.3}", description: "Traffic involving specific hosts", insertable: true },
    ],
  },
];

// ─── Search helpers ─────────────────────────────────────────────────────────

function tokenize(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAllTokens(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  return tokens.every(t => lower.includes(t));
}

function highlightText(text: string, tokens: string[]): React.ReactNode {
  if (tokens.length === 0) return text;

  const sortedTokens = [...tokens].sort((a, b) => b.length - a.length);
  const pattern = sortedTokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

interface SearchResult {
  section: WikiSection;
  entry: WikiEntry;
  entryIndex: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function WiresharkFilterReference({ open, onOpenChange, onInsert }: FilterReferenceProps) {
  const [activeSection, setActiveSection] = useState(SECTIONS[0]?.id ?? "syntax");
  const [search, setSearch] = useState("");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setCopiedText(null);
    }
  }, [open]);

  const tokens = useMemo(() => tokenize(search), [search]);
  const isSearching = tokens.length > 0;

  const sectionMatchCounts = useMemo(() => {
    if (!isSearching) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const section of SECTIONS) {
      const count = section.content.filter(e =>
        matchesAllTokens(`${e.text} ${e.description}`, tokens)
      ).length;
      if (count > 0) counts.set(section.id, count);
    }
    return counts;
  }, [isSearching, tokens]);

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!isSearching) return [];
    const results: SearchResult[] = [];
    for (const section of SECTIONS) {
      for (let i = 0; i < section.content.length; i++) {
        const entry = section.content[i]!;
        if (matchesAllTokens(`${entry.text} ${entry.description}`, tokens)) {
          results.push({ section, entry, entryIndex: i });
        }
      }
    }
    return results;
  }, [isSearching, tokens]);

  const filteredSections = useMemo(() => {
    if (!isSearching) return SECTIONS;
    return SECTIONS.filter(s => sectionMatchCounts.has(s.id));
  }, [isSearching, sectionMatchCounts]);

  const currentSection = isSearching ? null : (SECTIONS.find(s => s.id === activeSection) ?? SECTIONS[0]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 1500);
  }, []);

  const handleInsert = useCallback((text: string) => {
    onInsert?.(text);
    onOpenChange(false);
  }, [onInsert, onOpenChange]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeSection, search]);

  const renderEntry = useCallback((entry: WikiEntry, idx: number, sectionTitle?: string) => {
    if (entry.heading) {
      return (
        <div key={`h-${idx}`} className="pt-5 pb-2 first:pt-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
              {isSearching ? highlightText(entry.text, tokens) : entry.text}
            </h3>
            <div className="flex-1 h-px bg-border/30" />
          </div>
          {entry.description && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              {isSearching ? highlightText(entry.description, tokens) : entry.description}
            </p>
          )}
        </div>
      );
    }

    const isInsertable = entry.insertable && onInsert;
    const isCopied = copiedText === entry.text;

    return (
      <div
        key={`e-${idx}`}
        className={cn(
          "group relative flex items-start gap-3 rounded-md border border-transparent px-3 py-2 transition-smooth",
          isInsertable
            ? "cursor-pointer hover:border-primary/35 hover:bg-primary/[0.06]"
            : "hover:border-border/40 hover:bg-muted/25"
        )}
        onClick={isInsertable ? () => handleInsert(entry.text) : undefined}
      >
        {sectionTitle && (
          <span className="absolute -top-0.5 right-2 text-3xs text-muted-foreground/50 font-medium uppercase tracking-wider">
            {sectionTitle}
          </span>
        )}

        <code className={cn(
          "font-mono text-xs font-medium flex-shrink-0 min-w-0 max-w-[50%] break-all leading-relaxed",
          isInsertable ? "text-primary/90 group-hover:text-primary" : "text-foreground/90"
        )}>
          {isSearching ? highlightText(entry.text, tokens) : entry.text}
        </code>

        <span className="text-xs text-muted-foreground leading-relaxed flex-1 min-w-0">
          {isSearching ? highlightText(entry.description, tokens) : entry.description}
        </span>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-auto">
          {entry.insertable && onInsert && (
            <TooltipWrapper content="Insert into filter">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleInsert(entry.text); }}
                className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-primary/15 text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipWrapper>
          )}
          <TooltipWrapper content="Copy to clipboard">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleCopy(entry.text); }}
              className={cn(
                "h-6 w-6 flex items-center justify-center rounded-md",
                isCopied ? "text-success" : "hover:bg-muted/60 text-muted-foreground"
              )}
            >
              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </TooltipWrapper>
        </div>
      </div>
    );
  }, [isSearching, tokens, copiedText, onInsert, handleInsert, handleCopy]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="graphite-modal-content h-[86vh] min-h-0 max-h-[calc(min(100vh,100dvh)-2rem)] overflow-hidden p-0"
        style={{ width: "98vw", maxWidth: "98vw" }}
      >
        {/* ── Header ── */}
        <DialogHeader className="surface-subtle flex-shrink-0 border-b border-border/40 px-5 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold">Display Filter Reference</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Wireshark-compatible syntax — click any example to insert
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 text-2xs text-muted-foreground mr-6">
              <kbd className="rounded-md border border-border/45 bg-muted/10 px-1.5 py-0.5 font-mono">click</kbd>
              <span>insert</span>
            </div>
          </div>

          {/* ── Search bar ── */}
          <div className="relative mt-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchInputRef}
              placeholder="Search fields, protocols, operators, examples..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ui-control-shell h-8 pl-8 pr-8 font-mono text-xs focus-visible:border-primary/35 focus-visible:bg-card"
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); searchInputRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="mt-2 flex min-h-0 flex-1 overflow-hidden">
          {/* ── Sidebar ── */}
          <nav className="surface-flat w-56 flex-shrink-0 overflow-y-auto border-r border-border/40 px-2 py-2 scrollbar-thin">
            {filteredSections.map((section) => {
              const matchCount = sectionMatchCounts.get(section.id);
              const isActive = !isSearching && activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(section.id);
                    if (isSearching) setSearch("");
                  }}
                  className={cn(
                    "mb-0.5 flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-left text-xs transition-smooth",
                    isActive
                      ? "border-primary/30 bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:border-border/40 hover:bg-muted/30 hover:text-foreground"
                  )}
                >
                  <section.icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate flex-1">{section.title}</span>
                  {matchCount !== undefined && (
                    <span className="text-3xs tabular-nums text-primary/70 bg-primary/10 rounded-full px-1.5 py-0.5 flex-shrink-0">
                      {matchCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* ── Content area ── */}
          <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 scrollbar-thin">
            {isSearching ? (
              searchResults.length === 0 ? (
                <EmptyState compact variant="inline" title="No results match your search" />
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-muted-foreground">
                      <span className="text-foreground font-medium tabular-nums">{searchResults.length}</span>
                      {" "}result{searchResults.length !== 1 ? "s" : ""} across{" "}
                      <span className="text-foreground font-medium tabular-nums">{sectionMatchCounts.size}</span>
                      {" "}section{sectionMatchCounts.size !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    {searchResults.map((result, idx) =>
                      renderEntry(result.entry, idx, result.section.title)
                    )}
                  </div>
                </div>
              )
            ) : currentSection ? (
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <currentSection.icon className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">{currentSection.title}</h2>
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    {currentSection.content.filter(e => !e.heading).length} entries
                  </span>
                </div>
                <div className="space-y-0.5">
                  {currentSection.content.map((entry, idx) => renderEntry(entry, idx))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="surface-subtle flex flex-shrink-0 items-center justify-between border-t border-border/40 px-5 py-2 text-2xs text-muted-foreground">
          <span>{SECTIONS.length} sections &middot; {SECTIONS.reduce((acc, s) => acc + s.content.filter(e => !e.heading).length, 0)} fields &amp; examples</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-primary/40" />
              clickable = insertable
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
