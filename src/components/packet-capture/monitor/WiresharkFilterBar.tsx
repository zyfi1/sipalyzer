import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Search, X, CheckCircle2, AlertTriangle, BookOpen, Clock, Trash2 } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";
import type { PacketInfo } from "@/types/packetCapture";
import { WiresharkFilterReference } from "./WiresharkFilterReference";
import {
  getSuggestions,
  getGhostText,
  highlightMatch,
  loadFilterHistory,
  saveFilterToHistory,
  removeFilterFromHistory,
  clearFilterHistory,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  type Suggestion,
} from "./WiresharkFilterAutocomplete";

interface WiresharkFilterBarProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  filteredCount: number;
  /** Label shown after count (default "packets"), e.g. "calls" or "streams" */
  matchLabel?: string;
}

interface FilterParseResult {
  isValid: boolean;
  error?: string;
}

// ── All field + protocol entries for the autocomplete engine ──
// (Categories: "field" for dotted names, "protocol" for bare protocol names.)

const ALL_AUTOCOMPLETE_FIELDS: Array<{ text: string; description: string; category: "field" | "protocol" }> = [
  // IP fields
  { text: "ip.addr", description: "IP address (source or destination)", category: "field" },
  { text: "ip.src", description: "Source IP address", category: "field" },
  { text: "ip.dst", description: "Destination IP address", category: "field" },
  { text: "ip.len", description: "IP packet length", category: "field" },
  { text: "ip.hdr_len", description: "IP header length", category: "field" },
  { text: "ip.ttl", description: "IP Time To Live", category: "field" },
  { text: "ip.proto", description: "IP protocol number", category: "field" },
  { text: "ip.version", description: "IP version", category: "field" },
  { text: "ip.flags", description: "IP flags", category: "field" },
  { text: "ip.frag_offset", description: "IP fragment offset", category: "field" },
  { text: "ip.id", description: "IP identification", category: "field" },
  { text: "ip.checksum", description: "IP checksum", category: "field" },
  { text: "ip.dsfield", description: "IP Differentiated Services Field", category: "field" },
  
  // TCP fields
  { text: "tcp.port", description: "TCP port (source or destination)", category: "field" },
  { text: "tcp.srcport", description: "TCP source port", category: "field" },
  { text: "tcp.dstport", description: "TCP destination port", category: "field" },
  { text: "tcp.flags", description: "TCP flags", category: "field" },
  { text: "tcp.flags.syn", description: "TCP SYN flag", category: "field" },
  { text: "tcp.flags.ack", description: "TCP ACK flag", category: "field" },
  { text: "tcp.flags.fin", description: "TCP FIN flag", category: "field" },
  { text: "tcp.flags.rst", description: "TCP RST flag", category: "field" },
  { text: "tcp.flags.push", description: "TCP PSH flag", category: "field" },
  { text: "tcp.flags.urg", description: "TCP URG flag", category: "field" },
  { text: "tcp.seq", description: "TCP sequence number", category: "field" },
  { text: "tcp.ack", description: "TCP acknowledgment number", category: "field" },
  { text: "tcp.window", description: "TCP window size", category: "field" },
  { text: "tcp.window_size", description: "TCP window size value", category: "field" },
  { text: "tcp.checksum", description: "TCP checksum", category: "field" },
  { text: "tcp.urgent_pointer", description: "TCP urgent pointer", category: "field" },
  { text: "tcp.options", description: "TCP options", category: "field" },
  { text: "tcp.len", description: "TCP segment length", category: "field" },
  
  // UDP fields
  { text: "udp.port", description: "UDP port (source or destination)", category: "field" },
  { text: "udp.srcport", description: "UDP source port", category: "field" },
  { text: "udp.dstport", description: "UDP destination port", category: "field" },
  { text: "udp.length", description: "UDP length", category: "field" },
  { text: "udp.checksum", description: "UDP checksum", category: "field" },
  
  // Frame/Ethernet fields
  { text: "frame.len", description: "Frame length", category: "field" },
  { text: "frame.number", description: "Frame number", category: "field" },
  { text: "frame.time", description: "Frame timestamp", category: "field" },
  { text: "frame.time_delta", description: "Time delta from previous frame", category: "field" },
  { text: "frame.time_relative", description: "Time relative to first frame", category: "field" },
  { text: "eth.addr", description: "Ethernet address", category: "field" },
  { text: "eth.src", description: "Ethernet source MAC", category: "field" },
  { text: "eth.dst", description: "Ethernet destination MAC", category: "field" },
  { text: "eth.type", description: "Ethernet type", category: "field" },
  { text: "eth.len", description: "Ethernet length", category: "field" },
  
  // SIP fields (exact Wireshark field names, case-sensitive)
  { text: "sip.Method", description: "SIP method", category: "field" },
  { text: "sip.Status-Code", description: "SIP status code", category: "field" },
  { text: "sip.Status", description: "SIP status text", category: "field" },
  { text: "sip.Call-ID", description: "SIP Call-ID header", category: "field" },
  { text: "sip.From", description: "SIP From header", category: "field" },
  { text: "sip.To", description: "SIP To header", category: "field" },
  { text: "sip.Contact", description: "SIP Contact header", category: "field" },
  { text: "sip.CSeq", description: "SIP CSeq header (full)", category: "field" },
  { text: "sip.CSeq.num", description: "SIP CSeq sequence number", category: "field" },
  { text: "sip.CSeq.method", description: "SIP CSeq method", category: "field" },
  { text: "sip.Via", description: "SIP Via header", category: "field" },
  { text: "sip.Request-URI", description: "SIP Request-URI", category: "field" },
  { text: "sip.User-Agent", description: "SIP User-Agent header", category: "field" },
  { text: "sip.Content-Type", description: "SIP Content-Type header", category: "field" },
  { text: "sip.Content-Length", description: "SIP Content-Length header", category: "field" },
  { text: "sip.Accept", description: "SIP Accept header", category: "field" },
  { text: "sip.Accept-Encoding", description: "SIP Accept-Encoding header", category: "field" },
  { text: "sip.Accept-Language", description: "SIP Accept-Language header", category: "field" },
  { text: "sip.Alert-Info", description: "SIP Alert-Info header", category: "field" },
  { text: "sip.Allow", description: "SIP Allow header", category: "field" },
  { text: "sip.Allow-Events", description: "SIP Allow-Events header", category: "field" },
  { text: "sip.Authorization", description: "SIP Authorization header", category: "field" },
  { text: "sip.Authentication-Info", description: "SIP Authentication-Info header", category: "field" },
  { text: "sip.Branch", description: "SIP Branch parameter (Via)", category: "field" },
  { text: "sip.Expires", description: "SIP Expires header", category: "field" },
  { text: "sip.Max-Forwards", description: "SIP Max-Forwards header", category: "field" },
  { text: "sip.Min-Expires", description: "SIP Min-Expires header", category: "field" },
  { text: "sip.Organization", description: "SIP Organization header", category: "field" },
  { text: "sip.Priority", description: "SIP Priority header", category: "field" },
  { text: "sip.Proxy-Authenticate", description: "SIP Proxy-Authenticate header", category: "field" },
  { text: "sip.Proxy-Authorization", description: "SIP Proxy-Authorization header", category: "field" },
  { text: "sip.Proxy-Require", description: "SIP Proxy-Require header", category: "field" },
  { text: "sip.Record-Route", description: "SIP Record-Route header", category: "field" },
  { text: "sip.Refer-To", description: "SIP Refer-To header", category: "field" },
  { text: "sip.Referenced-By", description: "SIP Referenced-By header", category: "field" },
  { text: "sip.Referred-By", description: "SIP Referred-By header", category: "field" },
  { text: "sip.Reject-Contact", description: "SIP Reject-Contact header", category: "field" },
  { text: "sip.Replaces", description: "SIP Replaces header", category: "field" },
  { text: "sip.Require", description: "SIP Require header", category: "field" },
  { text: "sip.Retry-After", description: "SIP Retry-After header", category: "field" },
  { text: "sip.Route", description: "SIP Route header", category: "field" },
  { text: "sip.Server", description: "SIP Server header", category: "field" },
  { text: "sip.Subject", description: "SIP Subject header", category: "field" },
  { text: "sip.Subscription-State", description: "SIP Subscription-State header", category: "field" },
  { text: "sip.Supported", description: "SIP Supported header", category: "field" },
  { text: "sip.Timestamp", description: "SIP Timestamp header", category: "field" },
  { text: "sip.Unsupported", description: "SIP Unsupported header", category: "field" },
  { text: "sip.Warning", description: "SIP Warning header", category: "field" },
  { text: "sip.WWW-Authenticate", description: "SIP WWW-Authenticate header", category: "field" },
  // SIP URI fields
  { text: "sip.contact.uri", description: "SIP Contact URI", category: "field" },
  { text: "sip.contact.host", description: "SIP Contact host", category: "field" },
  { text: "sip.contact.port", description: "SIP Contact port", category: "field" },
  { text: "sip.contact.user", description: "SIP Contact user", category: "field" },
  { text: "sip.from.uri", description: "SIP From URI", category: "field" },
  { text: "sip.from.host", description: "SIP From host", category: "field" },
  { text: "sip.from.port", description: "SIP From port", category: "field" },
  { text: "sip.from.user", description: "SIP From user", category: "field" },
  { text: "sip.to.uri", description: "SIP To URI", category: "field" },
  { text: "sip.to.host", description: "SIP To host", category: "field" },
  { text: "sip.to.port", description: "SIP To port", category: "field" },
  { text: "sip.to.user", description: "SIP To user", category: "field" },
  // SIP authentication fields
  { text: "sip.auth", description: "SIP authentication", category: "field" },
  { text: "sip.auth.algorithm", description: "SIP auth algorithm", category: "field" },
  { text: "sip.auth.nonce", description: "SIP auth nonce", category: "field" },
  { text: "sip.auth.realm", description: "SIP auth realm", category: "field" },
  { text: "sip.auth.username", description: "SIP auth username", category: "field" },
  { text: "sip.auth.response", description: "SIP auth response", category: "field" },
  { text: "sip.auth.uri", description: "SIP auth URI", category: "field" },
  
  // RTP fields (exact Wireshark field names)
  { text: "rtp.ssrc", description: "RTP SSRC", category: "field" },
  { text: "rtp.payload_type", description: "RTP payload type", category: "field" },
  { text: "rtp.seq", description: "RTP sequence number", category: "field" },
  { text: "rtp.timestamp", description: "RTP timestamp", category: "field" },
  { text: "rtp.marker", description: "RTP marker bit", category: "field" },
  { text: "rtp.version", description: "RTP version", category: "field" },
  { text: "rtp.padding", description: "RTP padding bit", category: "field" },
  { text: "rtp.ext", description: "RTP extension bit", category: "field" },
  { text: "rtp.cc", description: "RTP CSRC count", category: "field" },
  { text: "rtp.csrc", description: "RTP CSRC", category: "field" },
  { text: "rtp.setup", description: "RTP setup method", category: "field" },
  { text: "rtp.setup-frame", description: "RTP setup frame", category: "field" },
  
  // RTCP fields (exact Wireshark field names)
  { text: "rtcp.pt", description: "RTCP packet type", category: "field" },
  { text: "rtcp.ssrc", description: "RTCP SSRC", category: "field" },
  { text: "rtcp.version", description: "RTCP version", category: "field" },
  { text: "rtcp.length", description: "RTCP length", category: "field" },
  { text: "rtcp.sr.ssrc", description: "RTCP SR SSRC", category: "field" },
  { text: "rtcp.sr.ntp_ts", description: "RTCP SR NTP timestamp", category: "field" },
  { text: "rtcp.sr.rtp_ts", description: "RTCP SR RTP timestamp", category: "field" },
  { text: "rtcp.rr.ssrc", description: "RTCP RR SSRC", category: "field" },
  { text: "rtcp.sdes.type", description: "RTCP SDES type", category: "field" },
  { text: "rtcp.bye.ssrc", description: "RTCP BYE SSRC", category: "field" },
  
  // ICMP fields (exact Wireshark field names)
  { text: "icmp.type", description: "ICMP type", category: "field" },
  { text: "icmp.code", description: "ICMP code", category: "field" },
  { text: "icmp.checksum", description: "ICMP checksum", category: "field" },
  { text: "icmp.ident", description: "ICMP identifier", category: "field" },
  { text: "icmp.seq", description: "ICMP sequence", category: "field" },
  { text: "icmp.reserved", description: "ICMP reserved", category: "field" },
  { text: "icmp.mtu", description: "ICMP MTU", category: "field" },
  { text: "icmp.data", description: "ICMP data", category: "field" },
  
  // ICMPv6 fields
  { text: "icmpv6.type", description: "ICMPv6 type", category: "field" },
  { text: "icmpv6.code", description: "ICMPv6 code", category: "field" },
  { text: "icmpv6.checksum", description: "ICMPv6 checksum", category: "field" },
  { text: "icmpv6.ident", description: "ICMPv6 identifier", category: "field" },
  { text: "icmpv6.seq", description: "ICMPv6 sequence", category: "field" },
  { text: "icmpv6.mtu", description: "ICMPv6 MTU", category: "field" },
  { text: "icmpv6.nd.target", description: "ICMPv6 ND target", category: "field" },
  { text: "icmpv6.nd.opt", description: "ICMPv6 ND option", category: "field" },
  
  // DNS fields (exact Wireshark field names)
  { text: "dns.id", description: "DNS transaction ID", category: "field" },
  { text: "dns.flags", description: "DNS flags", category: "field" },
  { text: "dns.flags.response", description: "DNS response flag", category: "field" },
  { text: "dns.flags.opcode", description: "DNS opcode", category: "field" },
  { text: "dns.flags.authoritative", description: "DNS authoritative", category: "field" },
  { text: "dns.flags.truncated", description: "DNS truncated", category: "field" },
  { text: "dns.flags.recdesired", description: "DNS recursion desired", category: "field" },
  { text: "dns.flags.recavail", description: "DNS recursion available", category: "field" },
  { text: "dns.flags.z", description: "DNS reserved", category: "field" },
  { text: "dns.flags.checkdisable", description: "DNS checking disabled", category: "field" },
  { text: "dns.flags.rcode", description: "DNS response code", category: "field" },
  { text: "dns.count.queries", description: "DNS query count", category: "field" },
  { text: "dns.count.answers", description: "DNS answer count", category: "field" },
  { text: "dns.count.auth_rr", description: "DNS authority RR count", category: "field" },
  { text: "dns.count.add_rr", description: "DNS additional RR count", category: "field" },
  { text: "dns.qry.name", description: "DNS query name", category: "field" },
  { text: "dns.qry.type", description: "DNS query type", category: "field" },
  { text: "dns.qry.class", description: "DNS query class", category: "field" },
  { text: "dns.resp.name", description: "DNS response name", category: "field" },
  { text: "dns.resp.type", description: "DNS response type", category: "field" },
  { text: "dns.resp.class", description: "DNS response class", category: "field" },
  { text: "dns.resp.ttl", description: "DNS response TTL", category: "field" },
  { text: "dns.a", description: "DNS A record", category: "field" },
  { text: "dns.aaaa", description: "DNS AAAA record", category: "field" },
  { text: "dns.cname", description: "DNS CNAME", category: "field" },
  { text: "dns.mx", description: "DNS MX record", category: "field" },
  { text: "dns.ns", description: "DNS NS record", category: "field" },
  { text: "dns.ptr", description: "DNS PTR record", category: "field" },
  { text: "dns.soa", description: "DNS SOA record", category: "field" },
  { text: "dns.srv", description: "DNS SRV record", category: "field" },
  { text: "dns.txt", description: "DNS TXT record", category: "field" },
  
  // HTTP fields (exact Wireshark field names)
  { text: "http.request.method", description: "HTTP request method", category: "field" },
  { text: "http.request.uri", description: "HTTP request URI", category: "field" },
  { text: "http.request.version", description: "HTTP request version", category: "field" },
  { text: "http.response.code", description: "HTTP response code", category: "field" },
  { text: "http.response.phrase", description: "HTTP response phrase", category: "field" },
  { text: "http.response.version", description: "HTTP response version", category: "field" },
  { text: "http.host", description: "HTTP Host header", category: "field" },
  { text: "http.user_agent", description: "HTTP User-Agent header", category: "field" },
  { text: "http.content_type", description: "HTTP Content-Type header", category: "field" },
  { text: "http.content_length", description: "HTTP Content-Length header", category: "field" },
  { text: "http.accept", description: "HTTP Accept header", category: "field" },
  { text: "http.accept_encoding", description: "HTTP Accept-Encoding header", category: "field" },
  { text: "http.accept_language", description: "HTTP Accept-Language header", category: "field" },
  { text: "http.authorization", description: "HTTP Authorization header", category: "field" },
  { text: "http.cookie", description: "HTTP Cookie header", category: "field" },
  { text: "http.location", description: "HTTP Location header", category: "field" },
  { text: "http.referer", description: "HTTP Referer header", category: "field" },
  { text: "http.server", description: "HTTP Server header", category: "field" },
  { text: "http.set_cookie", description: "HTTP Set-Cookie header", category: "field" },
  { text: "http.www_authenticate", description: "HTTP WWW-Authenticate header", category: "field" },
  { text: "http.request", description: "HTTP request", category: "field" },
  { text: "http.response", description: "HTTP response", category: "field" },
  
  // HTTPS/TLS fields (exact Wireshark field names)
  { text: "tls.record.version", description: "TLS record version", category: "field" },
  { text: "tls.record.content_type", description: "TLS record content type", category: "field" },
  { text: "tls.record.length", description: "TLS record length", category: "field" },
  { text: "tls.handshake.type", description: "TLS handshake type", category: "field" },
  { text: "tls.handshake.version", description: "TLS handshake version", category: "field" },
  { text: "tls.handshake.ciphersuite", description: "TLS cipher suite", category: "field" },
  { text: "tls.handshake.extensions_server_name", description: "TLS SNI", category: "field" },
  { text: "tls.alert.level", description: "TLS alert level", category: "field" },
  { text: "tls.alert.description", description: "TLS alert description", category: "field" },
  { text: "ssl.record.version", description: "SSL record version", category: "field" },
  { text: "ssl.record.content_type", description: "SSL record content type", category: "field" },
  { text: "ssl.handshake.type", description: "SSL handshake type", category: "field" },
  { text: "ssl.handshake.version", description: "SSL handshake version", category: "field" },
  { text: "ssl.handshake.ciphersuite", description: "SSL cipher suite", category: "field" },
  
  // ARP fields (exact Wireshark field names)
  { text: "arp.opcode", description: "ARP opcode", category: "field" },
  { text: "arp.hw.type", description: "ARP hardware type", category: "field" },
  { text: "arp.proto.type", description: "ARP protocol type", category: "field" },
  { text: "arp.hw.size", description: "ARP hardware size", category: "field" },
  { text: "arp.proto.size", description: "ARP protocol size", category: "field" },
  { text: "arp.src.hw_mac", description: "ARP source hardware MAC", category: "field" },
  { text: "arp.dst.hw_mac", description: "ARP destination hardware MAC", category: "field" },
  { text: "arp.src.proto_ipv4", description: "ARP source protocol IPv4", category: "field" },
  { text: "arp.dst.proto_ipv4", description: "ARP destination protocol IPv4", category: "field" },
  
  // IPv6 fields
  { text: "ipv6.version", description: "IPv6 version", category: "field" },
  { text: "ipv6.tclass", description: "IPv6 traffic class", category: "field" },
  { text: "ipv6.flow", description: "IPv6 flow label", category: "field" },
  { text: "ipv6.plen", description: "IPv6 payload length", category: "field" },
  { text: "ipv6.nxt", description: "IPv6 next header", category: "field" },
  { text: "ipv6.hlim", description: "IPv6 hop limit", category: "field" },
  { text: "ipv6.src", description: "IPv6 source", category: "field" },
  { text: "ipv6.dst", description: "IPv6 destination", category: "field" },
  { text: "ipv6.addr", description: "IPv6 address (source or destination)", category: "field" },
  
  // VLAN fields
  { text: "vlan.id", description: "VLAN ID", category: "field" },
  { text: "vlan.priority", description: "VLAN priority", category: "field" },
  { text: "vlan.cfi", description: "VLAN CFI", category: "field" },
  { text: "vlan.tpid", description: "VLAN TPID", category: "field" },
  
  // IGMP fields
  { text: "igmp.type", description: "IGMP type", category: "field" },
  { text: "igmp.max_resp_time", description: "IGMP max response time", category: "field" },
  { text: "igmp.checksum", description: "IGMP checksum", category: "field" },
  { text: "igmp.group", description: "IGMP group address", category: "field" },
  
  // DHCP fields
  { text: "dhcp.option.dhcp", description: "DHCP message type", category: "field" },
  { text: "dhcp.option.subnet_mask", description: "DHCP subnet mask", category: "field" },
  { text: "dhcp.option.router", description: "DHCP router", category: "field" },
  { text: "dhcp.option.domain_name_server", description: "DHCP DNS server", category: "field" },
  { text: "dhcp.option.hostname", description: "DHCP hostname", category: "field" },
  { text: "dhcp.option.requested_ip", description: "DHCP requested IP", category: "field" },
  { text: "dhcp.option.server_id", description: "DHCP server ID", category: "field" },
  { text: "dhcp.option.client_id", description: "DHCP client ID", category: "field" },
  { text: "dhcp.option.lease_time", description: "DHCP lease time", category: "field" },
  { text: "dhcp.hw.mac_addr", description: "DHCP MAC address", category: "field" },
  { text: "dhcp.ip.client", description: "DHCP client IP", category: "field" },
  { text: "dhcp.ip.server", description: "DHCP server IP", category: "field" },
  { text: "dhcp.ip.relay", description: "DHCP relay IP", category: "field" },
  
  // SMB fields
  { text: "smb.cmd", description: "SMB command", category: "field" },
  { text: "smb.flags", description: "SMB flags", category: "field" },
  { text: "smb.flags2", description: "SMB flags2", category: "field" },
  { text: "smb.uid", description: "SMB UID", category: "field" },
  { text: "smb.tid", description: "SMB TID", category: "field" },
  { text: "smb.pid", description: "SMB PID", category: "field" },
  { text: "smb.mid", description: "SMB MID", category: "field" },
  { text: "smb.filename", description: "SMB filename", category: "field" },
  { text: "smb2.cmd", description: "SMB2 command", category: "field" },
  { text: "smb2.status", description: "SMB2 status", category: "field" },
  { text: "smb2.flags", description: "SMB2 flags", category: "field" },
  { text: "smb2.tree", description: "SMB2 tree", category: "field" },
  { text: "smb2.filename", description: "SMB2 filename", category: "field" },
  
  // SSH fields
  { text: "ssh.protocol", description: "SSH protocol", category: "field" },
  { text: "ssh.version", description: "SSH version", category: "field" },
  { text: "ssh.packet_length", description: "SSH packet length", category: "field" },
  { text: "ssh.padding_length", description: "SSH padding length", category: "field" },
  { text: "ssh.msg_code", description: "SSH message code", category: "field" },
  
  // FTP fields
  { text: "ftp.request.command", description: "FTP request command", category: "field" },
  { text: "ftp.request.arg", description: "FTP request argument", category: "field" },
  { text: "ftp.response.code", description: "FTP response code", category: "field" },
  { text: "ftp.response.arg", description: "FTP response argument", category: "field" },
  
  // SNMP fields
  { text: "snmp.version", description: "SNMP version", category: "field" },
  { text: "snmp.community", description: "SNMP community", category: "field" },
  { text: "snmp.pdu_type", description: "SNMP PDU type", category: "field" },
  { text: "snmp.request_id", description: "SNMP request ID", category: "field" },
  { text: "snmp.error", description: "SNMP error", category: "field" },
  { text: "snmp.error_index", description: "SNMP error index", category: "field" },
  { text: "snmp.oid", description: "SNMP OID", category: "field" },
  { text: "snmp.value", description: "SNMP value", category: "field" },
  
  // NTP fields
  { text: "ntp.version", description: "NTP version", category: "field" },
  { text: "ntp.mode", description: "NTP mode", category: "field" },
  { text: "ntp.stratum", description: "NTP stratum", category: "field" },
  { text: "ntp.precision", description: "NTP precision", category: "field" },
  { text: "ntp.root_delay", description: "NTP root delay", category: "field" },
  { text: "ntp.root_dispersion", description: "NTP root dispersion", category: "field" },
  { text: "ntp.ref_id", description: "NTP reference ID", category: "field" },
  { text: "ntp.ref", description: "NTP reference timestamp", category: "field" },
  { text: "ntp.orig", description: "NTP origin timestamp", category: "field" },
  { text: "ntp.recv", description: "NTP receive timestamp", category: "field" },
  { text: "ntp.xmt", description: "NTP transmit timestamp", category: "field" },
  
  // STUN fields
  { text: "stun.type", description: "STUN message type", category: "field" },
  { text: "stun.length", description: "STUN message length", category: "field" },
  { text: "stun.magic_cookie", description: "STUN magic cookie", category: "field" },
  { text: "stun.transaction_id", description: "STUN transaction ID", category: "field" },
  { text: "stun.attr.type", description: "STUN attribute type", category: "field" },
  { text: "stun.attr.length", description: "STUN attribute length", category: "field" },
  { text: "stun.attr.mapped_address", description: "STUN mapped address", category: "field" },
  { text: "stun.attr.xor_mapped_address", description: "STUN XOR mapped address", category: "field" },
  
  // QUIC fields
  { text: "quic.header_form", description: "QUIC header form", category: "field" },
  { text: "quic.long.packet_type", description: "QUIC long packet type", category: "field" },
  { text: "quic.version", description: "QUIC version", category: "field" },
  { text: "quic.dcid", description: "QUIC destination connection ID", category: "field" },
  { text: "quic.scid", description: "QUIC source connection ID", category: "field" },
  { text: "quic.token", description: "QUIC token", category: "field" },
  { text: "quic.packet_number", description: "QUIC packet number", category: "field" },
  
  // GRE fields
  { text: "gre.flags", description: "GRE flags", category: "field" },
  { text: "gre.version", description: "GRE version", category: "field" },
  { text: "gre.proto", description: "GRE protocol", category: "field" },
  { text: "gre.checksum", description: "GRE checksum", category: "field" },
  { text: "gre.key", description: "GRE key", category: "field" },
  { text: "gre.seq", description: "GRE sequence", category: "field" },
  
  // OSPF fields
  { text: "ospf.version", description: "OSPF version", category: "field" },
  { text: "ospf.type", description: "OSPF type", category: "field" },
  { text: "ospf.length", description: "OSPF length", category: "field" },
  { text: "ospf.router_id", description: "OSPF router ID", category: "field" },
  { text: "ospf.area_id", description: "OSPF area ID", category: "field" },
  { text: "ospf.checksum", description: "OSPF checksum", category: "field" },
  { text: "ospf.auth_type", description: "OSPF auth type", category: "field" },
  
  // BGP fields
  { text: "bgp.type", description: "BGP message type", category: "field" },
  { text: "bgp.version", description: "BGP version", category: "field" },
  { text: "bgp.as", description: "BGP AS number", category: "field" },
  { text: "bgp.hold_time", description: "BGP hold time", category: "field" },
  { text: "bgp.keepalive", description: "BGP keepalive", category: "field" },
  { text: "bgp.nlri", description: "BGP NLRI", category: "field" },
  { text: "bgp.path_attribute", description: "BGP path attribute", category: "field" },
  { text: "bgp.origin", description: "BGP origin", category: "field" },
  { text: "bgp.as_path", description: "BGP AS path", category: "field" },
  { text: "bgp.next_hop", description: "BGP next hop", category: "field" },
  
  // MPLS fields
  { text: "mpls.label", description: "MPLS label", category: "field" },
  { text: "mpls.exp", description: "MPLS experimental", category: "field" },
  { text: "mpls.bottom", description: "MPLS bottom of stack", category: "field" },
  { text: "mpls.ttl", description: "MPLS TTL", category: "field" },

  // ── Protocols (bare names) ──
  { text: "ip", description: "Internet Protocol", category: "protocol" },
  { text: "ipv4", description: "IPv4", category: "protocol" },
  { text: "ipv6", description: "IPv6", category: "protocol" },
  { text: "tcp", description: "Transmission Control Protocol", category: "protocol" },
  { text: "udp", description: "User Datagram Protocol", category: "protocol" },
  { text: "sip", description: "Session Initiation Protocol", category: "protocol" },
  { text: "rtp", description: "Real-time Transport Protocol", category: "protocol" },
  { text: "srtp", description: "Secure Real-time Transport Protocol", category: "protocol" },
  { text: "rtcp", description: "RTP Control Protocol", category: "protocol" },
  { text: "http", description: "Hypertext Transfer Protocol", category: "protocol" },
  { text: "https", description: "HTTP Secure", category: "protocol" },
  { text: "dns", description: "Domain Name System", category: "protocol" },
  { text: "icmp", description: "Internet Control Message Protocol", category: "protocol" },
  { text: "icmpv6", description: "ICMPv6", category: "protocol" },
  { text: "arp", description: "Address Resolution Protocol", category: "protocol" },
  { text: "fax", description: "FAX/T.38", category: "protocol" },
  { text: "tls", description: "Transport Layer Security", category: "protocol" },
  { text: "ssl", description: "Secure Sockets Layer", category: "protocol" },
  { text: "dhcp", description: "Dynamic Host Configuration Protocol", category: "protocol" },
  { text: "ftp", description: "File Transfer Protocol", category: "protocol" },
  { text: "smtp", description: "Simple Mail Transfer Protocol", category: "protocol" },
  { text: "pop", description: "Post Office Protocol", category: "protocol" },
  { text: "imap", description: "Internet Message Access Protocol", category: "protocol" },
  { text: "ssh", description: "Secure Shell", category: "protocol" },
  { text: "snmp", description: "Simple Network Management Protocol", category: "protocol" },
  { text: "ntp", description: "Network Time Protocol", category: "protocol" },
  { text: "stun", description: "Session Traversal Utilities for NAT", category: "protocol" },
  { text: "quic", description: "QUIC Transport Protocol", category: "protocol" },
  { text: "gre", description: "Generic Routing Encapsulation", category: "protocol" },
  { text: "ospf", description: "Open Shortest Path First", category: "protocol" },
  { text: "bgp", description: "Border Gateway Protocol", category: "protocol" },
  { text: "eth", description: "Ethernet", category: "protocol" },
  { text: "vlan", description: "Virtual LAN (802.1Q)", category: "protocol" },
  { text: "smb", description: "Server Message Block", category: "protocol" },
  { text: "sctp", description: "Stream Control Transmission Protocol", category: "protocol" },
  { text: "sdp", description: "Session Description Protocol", category: "protocol" },
];


export function WiresharkFilterBar({
  filter,
  onFilterChange,
  filteredCount,
  matchLabel = "packets",
}: WiresharkFilterBarProps) {
  const [parseResult, setParseResult] = useState<FilterParseResult>({ isValid: true });
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 380 });
  const [showFilterReference, setShowFilterReference] = useState(false);
  const [filterHistory, setFilterHistory] = useState<string[]>(() => loadFilterHistory());
  const [ghostText, setGhostText] = useState("");
  const lastErrorRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const { warning: showWarning } = useNotifications();

  // ── Context-aware suggestions via the autocomplete engine ──
  const suggestionsMemo = useMemo(() => {
    if (!showAutocomplete) return [];
    return getSuggestions(filter, cursorPosition, ALL_AUTOCOMPLETE_FIELDS, filterHistory);
  }, [filter, cursorPosition, showAutocomplete, filterHistory]);

  useEffect(() => {
    setSuggestions(suggestionsMemo);
    setSelectedSuggestionIndex(0);
  }, [suggestionsMemo]);

  // ── Ghost text (inline completion hint) ──
  useEffect(() => {
    if (!showAutocomplete || suggestions.length === 0) {
      setGhostText("");
      return;
    }
    const top = suggestions[0];
    if (top && top.category !== "history") {
      setGhostText(getGhostText(filter, cursorPosition, top));
    } else {
      setGhostText("");
    }
  }, [filter, cursorPosition, suggestions, showAutocomplete]);

  // Validate filter syntax (debounced to avoid excessive parsing while typing)
  useEffect(() => {
    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce validation to avoid parsing on every keystroke
    debounceTimerRef.current = setTimeout(() => {
      if (!filter.trim()) {
        setParseResult({ isValid: true });
        lastErrorRef.current = null;
        return;
      }

      try {
        const result = parseWiresharkFilter(filter);
        setParseResult(result);
        
        // Show toast notification for errors
        if (!result.isValid && result.error) {
          // Only show toast if error changed (to avoid spam)
          if (result.error !== lastErrorRef.current) {
            showWarning("Filter Error", result.error, { source: "packet-capture" });
            lastErrorRef.current = result.error;
          }
        } else {
          lastErrorRef.current = null;
        }
      } catch (error: any) {
        const errorMessage = error.message || "Invalid filter syntax";
        setParseResult({
          isValid: false,
          error: errorMessage,
        });
        if (errorMessage !== lastErrorRef.current) {
          showWarning("Filter Error", errorMessage, { source: "packet-capture" });
          lastErrorRef.current = errorMessage;
        }
      }
    }, 300); // 300ms debounce for validation

    // Cleanup
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]); // showWarning is stable enough, don't need it in deps

  // ── Calculate dropdown position when autocomplete is shown ──
  useLayoutEffect(() => {
    if (!showAutocomplete || suggestions.length === 0) return;

    const updateDropdownPosition = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 8;
      const gap = 4;
      const preferredWidth = Math.min(Math.max(rect.width, 420), 560);
      const width = Math.min(preferredWidth, viewportWidth - margin * 2);

      let left = rect.left;
      left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

      const defaultTop = rect.bottom + gap;
      const spaceBelow = viewportHeight - defaultTop - margin;
      const spaceAbove = rect.top - gap - margin;
      const prefersAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
      const top = prefersAbove
        ? Math.max(margin, rect.top - Math.min(380, spaceAbove))
        : defaultTop;
      const maxHeight = Math.max(180, Math.min(380, viewportHeight - top - margin));

      setDropdownPosition({ top, left, width, maxHeight });
    };

    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [showAutocomplete, suggestions.length]);

  // ── Scroll selected item into view ──
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedSuggestionIndex]);

  // ── Filter parser (unchanged logic) ──
  const parseWiresharkFilter = (filterStr: string): FilterParseResult => {
    if (!filterStr.trim()) return { isValid: true };

    // Detect: ip.addr == X && ip.addr == Y (where X != Y)
    const ipAddrConflict = filterStr.match(/ip\.addr\s*==\s*([\d.]+)\s*&&\s*ip\.addr\s*==\s*([\d.]+)/);
    if (ipAddrConflict) {
      const a = ipAddrConflict[1] ?? "", b = ipAddrConflict[2] ?? "";
      if (a !== b) return { isValid: false, error: `Impossible: ip.addr both ${a} and ${b}. Use src/dst.` };
    }

    const portConflict = filterStr.match(/(tcp|udp|dns)\.port\s*==\s*(\d+)\s*&&\s*(tcp|udp|dns)\.port\s*==\s*(\d+)/);
    if (portConflict) {
      const p2 = portConflict[2] ?? "", p4 = portConflict[4] ?? "";
      if (p2 !== p4) {
        const proto = (portConflict[1] ?? "") || (portConflict[3] ?? "");
        return { isValid: false, error: `Impossible: ${proto}.port both ${p2} and ${p4}. Use srcport/dstport.` };
      }
    }

    if (filterStr.includes("dns.port")) return { isValid: false, error: "dns.port does not exist. Use: udp.port" };

    const protocolConflict = filterStr.match(/\b(sip|dns|tcp|udp|rtp|srtp|rtcp|http|https|icmp|arp)\s*&&\s*(sip|dns|tcp|udp|rtp|srtp|rtcp|http|https|icmp|arp)\b/gi);
    if (protocolConflict) {
      const match = protocolConflict[0] ?? "";
      const protocols = match.split(/\s*&&\s*/).map(p => p.trim().toLowerCase());
      const p0 = protocols[0] ?? "", p1 = protocols[1] ?? "";
      if (p0 !== p1) return { isValid: false, error: `Impossible: packet can't be ${p0} and ${p1}. Use ||` };
    }

    let parenCount = 0, inString = false, escapeNext = false, stringChar = "";
    for (let i = 0; i < filterStr.length; i++) {
      const char = filterStr[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (char === "\\") { escapeNext = true; continue; }
      if ((char === '"' || char === "'") && !inString) { inString = true; stringChar = char; continue; }
      if (char === stringChar && inString) { inString = false; stringChar = ""; continue; }
      if (inString) continue;
      if (char === "(") parenCount++;
      if (char === ")") parenCount--;
      if (parenCount < 0) return { isValid: false, error: "Unmatched closing parenthesis" };
    }
    if (inString) return { isValid: false, error: "Unclosed string literal" };
    if (parenCount !== 0) return { isValid: false, error: "Unmatched opening parenthesis" };

    return { isValid: true };
  };

  // ── Debounce ──
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); }, []);

  // ── Get current word at cursor (for insertion) ──
  const getCurrentWord = useCallback((text: string, cursor: number) => {
    let start = cursor, end = cursor;
    while (start > 0 && /[\w.:\-]/.test(text[start - 1] ?? "")) start--;
    while (end < text.length && /[\w.:\-]/.test(text[end] ?? "")) end++;
    return { word: text.substring(start, end), start, end };
  }, []);

  // ── Input change handler ──
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const cursor = e.target.selectionStart || 0;
    setCursorPosition(cursor);
    setShowAutocomplete(true);
    onFilterChange(value);
  }, [onFilterChange]);

  // ── Insert suggestion ──
  const insertSuggestion = useCallback((suggestion: Suggestion) => {
    if (!inputRef.current) return;

    // History items replace the whole filter
    if (suggestion.category === "history") {
      onFilterChange(suggestion.text);
      setShowAutocomplete(false);
      setTimeout(() => {
        if (inputRef.current) {
          const end = suggestion.text.length;
          inputRef.current.setSelectionRange(end, end);
          inputRef.current.focus();
          setCursorPosition(end);
        }
      }, 0);
      return;
    }

    const currentWord = getCurrentWord(filter, cursorPosition);
    const before = filter.substring(0, currentWord.start);
    const after = filter.substring(currentWord.end);

    // Auto-add space after certain categories for fluid typing
    const needsTrailingSpace = suggestion.category === "operator" || suggestion.category === "logical" || suggestion.category === "protocol";
    const insertText = suggestion.text + (needsTrailingSpace ? " " : "");
    const newFilter = before + insertText + after;

    onFilterChange(newFilter);
    setShowAutocomplete(false);

    setTimeout(() => {
      if (inputRef.current) {
        const newCursor = currentWord.start + insertText.length;
        inputRef.current.setSelectionRange(newCursor, newCursor);
        inputRef.current.focus();
        setCursorPosition(newCursor);
        // Re-open autocomplete for next token
        setShowAutocomplete(true);
      }
    }, 0);
  }, [filter, cursorPosition, onFilterChange, getCurrentWord]);

  // ── Accept ghost text (Tab when no dropdown selection is appropriate) ──
  const acceptGhostText = useCallback(() => {
    if (!ghostText || !inputRef.current) return false;
    const currentWord = getCurrentWord(filter, cursorPosition);
    const before = filter.substring(0, currentWord.end);
    const after = filter.substring(currentWord.end);
    const newFilter = before + ghostText + after;
    onFilterChange(newFilter);
    setTimeout(() => {
      if (inputRef.current) {
        const newCursor = currentWord.end + ghostText.length;
        inputRef.current.setSelectionRange(newCursor, newCursor);
        inputRef.current.focus();
        setCursorPosition(newCursor);
      }
    }, 0);
    return true;
  }, [ghostText, filter, cursorPosition, onFilterChange, getCurrentWord]);

  // ── Keyboard handling ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showAutocomplete && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        // If ghost text exists and user hasn't scrolled the selection, accept ghost text
        if (ghostText && selectedSuggestionIndex === 0) {
          acceptGhostText();
          return;
        }
        const suggestion = suggestions[selectedSuggestionIndex];
        if (suggestion) insertSuggestion(suggestion);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const suggestion = suggestions[selectedSuggestionIndex];
        if (suggestion) {
          insertSuggestion(suggestion);
          // Save to history when user commits a full filter via Enter at top level
          if (suggestion.category !== "history" && filter.trim()) {
            setFilterHistory(saveFilterToHistory(filter.trim()));
          }
        }
        return;
      }
      if (e.key === "Escape") {
        setShowAutocomplete(false);
        return;
      }
    }

    // Enter without autocomplete → save filter to history
    if (e.key === "Enter" && filter.trim()) {
      setFilterHistory(saveFilterToHistory(filter.trim()));
    }
  }, [showAutocomplete, suggestions, selectedSuggestionIndex, ghostText, acceptGhostText, insertSuggestion, filter]);

  const handleFocus = useCallback(() => {
    setShowAutocomplete(true);
    setFilterHistory(loadFilterHistory());
  }, []);

  const handleRemoveHistoryEntry = useCallback((entry: string) => {
    setFilterHistory(removeFilterFromHistory(entry));
  }, []);

  const handleClearHistory = useCallback(() => {
    setFilterHistory(clearFilterHistory());
  }, []);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (autocompleteRef.current?.contains(e.relatedTarget as Node)) return;
    // Delay to allow click on autocomplete item
    setTimeout(() => setShowAutocomplete(false), 200);
    // Save on blur if filter has content
    if (filter.trim()) setFilterHistory(saveFilterToHistory(filter.trim()));
  }, [filter]);

  // ── Highlighted text renderer ──
  const renderHighlightedText = useCallback((text: string) => {
    const currentWord = getCurrentWord(filter, cursorPosition);
    const query = currentWord.word;
    if (!query) return <span>{text}</span>;
    const [before, match, after] = highlightMatch(text, query);
    if (!match) return <span>{text}</span>;
    return (
      <span>
        {before}<span className="text-foreground font-bold">{match}</span>{after}
      </span>
    );
  }, [filter, cursorPosition, getCurrentWord]);

  return (
    <div className="relative flex-1 min-w-0">
      {/* Input with ghost text overlay */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
        <Input
          ref={inputRef}
          placeholder="Filter — e.g. sip, ip.addr == 10.0.0.1, tcp.port == 5060"
          value={filter}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSelect={(e) => {
            const target = e.target as HTMLInputElement;
            setCursorPosition(target.selectionStart || 0);
          }}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={cn(
            "ui-control-shell pl-8 h-7 text-xs font-mono w-full",
            !parseResult.isValid
              ? "pr-44 border-warning/50 focus-visible:ring-warning/50"
              : filter ? "pr-44" : "pr-16"
          )}
        />
        {/* Ghost text overlay (inline completion hint) */}
        {ghostText && showAutocomplete && (
          <span
            ref={ghostRef}
            className="absolute top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground/60 pointer-events-none whitespace-pre select-none"
            style={{ left: `calc(1.75rem + ${filter.length}ch)` }}
            aria-hidden
          >
            {ghostText}
          </span>
        )}
      </div>

      {/* Right-side controls */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {filter && parseResult.isValid && (
          <TooltipWrapper entry={tooltips.filterMatchCount}>
            <span className="text-2xs text-muted-foreground tabular-nums whitespace-nowrap mr-0.5 cursor-help">
              {filteredCount.toLocaleString()} {matchLabel}
            </span>
          </TooltipWrapper>
        )}
        {filter && !parseResult.isValid && parseResult.error && (
          <TooltipWrapper content={<div className="max-w-xs"><div className="font-semibold text-destructive mb-1">Filter Error</div><div>{parseResult.error}</div></div>}>
            <span className="text-2xs text-destructive truncate max-w-[120px] mr-0.5 cursor-help">
              {parseResult.error}
            </span>
          </TooltipWrapper>
        )}
        <TooltipWrapper entry={tooltips.captureFilterReference} side="top">
          <button
            type="button"
            onClick={() => setShowFilterReference(true)}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <BookOpen className="h-3.5 w-3.5" />
          </button>
        </TooltipWrapper>
        {filter && (
          <>
            {parseResult.isValid ? (
              <TooltipWrapper entry={tooltips.filterValid} side="top">
                <CheckCircle2 className="h-3.5 w-3.5 text-success cursor-help" />
              </TooltipWrapper>
            ) : (
              <TooltipWrapper entry={tooltips.captureInvalidFilter(parseResult.error || "Invalid filter")} side="top">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              </TooltipWrapper>
            )}
            <TooltipWrapper entry={tooltips.filterClear} side="top">
              <button
                type="button"
                onClick={() => onFilterChange("")}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </TooltipWrapper>
          </>
        )}
      </div>

      {/* ── Autocomplete Dropdown (portalled to body) ── */}
      {showAutocomplete && suggestions.length > 0 && inputRef.current && createPortal(
        <div
          ref={autocompleteRef}
          className="fixed z-[9997] ui-panel-shell rounded-md overflow-y-auto"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
            maxHeight: `${dropdownPosition.maxHeight}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Hint header */}
          <div className="ui-section-header-sm flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {suggestions[0]?.category === "history" ? (
                <>
                  <Clock className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground/90">Filter History</span>
                </>
              ) : (
                <span className="font-medium text-foreground/90">Filter Suggestions</span>
              )}
              {ghostText && <span className="text-2xs text-muted-foreground/70">Tab to complete</span>}
            </div>
            {suggestions[0]?.category === "history" ? (
              <button
                type="button"
                onClick={handleClearHistory}
                className="ui-control-shell inline-flex h-6 items-center gap-1 px-2 text-2xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            ) : (
              <span className="flex items-center gap-1.5 text-2xs">
                <kbd className="px-1 py-0.5 rounded bg-muted text-3xs">↑↓</kbd>
                <kbd className="px-1 py-0.5 rounded bg-muted text-3xs">Enter</kbd>
              </span>
            )}
          </div>
          <div className="ui-section-header-sm py-1 text-2xs text-muted-foreground/80">
            {suggestions[0]?.category === "history"
              ? "Select to re-apply, or remove individual entries."
              : "Use arrows to navigate, Enter/Tab to accept."}
          </div>

          <div className="p-1.5">
            {suggestions.map((suggestion, index) => {
              const isSelected = index === selectedSuggestionIndex;
              const catLabel = CATEGORY_LABELS[suggestion.category] ?? suggestion.category;
              const catColor = CATEGORY_COLORS[suggestion.category] ?? "text-muted-foreground";

              return (
                <button
                  key={`${suggestion.text}-${index}`}
                  ref={isSelected ? selectedItemRef : undefined}
                  type="button"
                  onClick={() => insertSuggestion(suggestion)}
                  onMouseEnter={() => setSelectedSuggestionIndex(index)}
                  className={cn(
                    "w-full text-left px-2.5 py-2 rounded-md text-xs flex items-center gap-2 transition-smooth",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  {/* Category badge */}
                  <span className={cn("w-[54px] shrink-0 text-3xs font-semibold uppercase tracking-wider", catColor)}>
                    {catLabel}
                  </span>

                  {/* Suggestion text (highlighted) */}
                  <span className="font-mono font-medium truncate min-w-0">
                    {suggestion.category === "history" ? (
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{suggestion.text}</span>
                      </span>
                    ) : (
                      renderHighlightedText(suggestion.text)
                    )}
                  </span>

                  {/* Description */}
                  {suggestion.description && suggestion.category !== "history" && (
                    <span className="text-muted-foreground text-2xs truncate ml-auto shrink-0 max-w-[180px]">
                      {suggestion.description}
                    </span>
                  )}

                  {suggestion.category === "history" && (
                    <button
                      type="button"
                      className="ml-auto h-6 w-6 flex items-center justify-center rounded hover:bg-accent/60 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveHistoryEntry(suggestion.text);
                      }}
                      aria-label={`Remove ${suggestion.text} from history`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {/* Filter Reference Wiki */}
      <WiresharkFilterReference
        open={showFilterReference}
        onOpenChange={setShowFilterReference}
        onInsert={(text) => {
          onFilterChange(text);
        }}
      />
    </div>
  );
}

// Cache for normalized filters to avoid repeated string operations
const filterCache = new Map<string, string>();
const MAX_CACHE_SIZE = 100;

function normalizeFilter(filter: string): string {
  // Check cache first
  const cached = filterCache.get(filter);
  if (cached !== undefined) {
    return cached;
  }

  // Normalize filter: Wireshark-compatible operators (English and C-like)
  let normalized = filter
    .replace(/\bnot\b/gi, "!")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||")
    .replace(/\bxor\b/gi, "^^")
    .replace(/\bany_eq\b/gi, "==")
    .replace(/\ball_eq\b/gi, "===")
    .replace(/\ball_ne\b/gi, "!=")
    .replace(/\bany_ne\b/gi, "!==")
    .replace(/\beq\b/gi, "==")
    .replace(/\bne\b/gi, "!=")
    .replace(/\bgt\b/gi, ">")
    .replace(/\blt\b/gi, "<")
    .replace(/\bge\b/gi, ">=")
    .replace(/\ble\b/gi, "<=")
    // matches operator (Wireshark: "matches" or "~" for regex)
    .replace(/\bmatches\b/gi, "~")
    // Fix dns.port -> udp.port (DNS uses UDP)
    .replace(/dns\.port/gi, "udp.port")
    .replace(/dns\.srcport/gi, "udp.srcport")
    .replace(/dns\.dstport/gi, "udp.dstport")
    .trim();

  // Cache the result (with size limit)
  if (filterCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (simple FIFO)
    const firstKey = filterCache.keys().next().value;
    if (firstKey) filterCache.delete(firstKey);
  }
  filterCache.set(filter, normalized);

  return normalized;
}

// Enhanced Wireshark filter evaluation with comprehensive syntax support
export function evaluateWiresharkFilter(filter: string, packet: PacketInfo): boolean {
  if (!filter.trim()) {
    return true;
  }

  // Use cached normalization
  const normalized = normalizeFilter(filter);

  // Handle parentheses first - find innermost parentheses (use original case for inner content)
  if (normalized.includes("(")) {
    let start = normalized.lastIndexOf("(");
    let end = normalized.indexOf(")", start);
    if (end !== -1) {
      const inner = normalized.substring(start + 1, end);
      const innerResult = evaluateWiresharkFilter(inner, packet);
      const before = normalized.substring(0, start);
      const after = normalized.substring(end + 1);
      const newFilter = before + (innerResult ? "1" : "0") + after;
      return evaluateWiresharkFilter(newFilter, packet);
    }
  }

  // Handle negation - use original case (higher precedence than && and ||)
  if (normalized.startsWith("!")) {
    return !evaluateWiresharkFilter(normalized.substring(1).trim(), packet);
  }

  // ── Operator precedence (lowest to highest): OR < XOR < AND < NOT ──────
  // We split by the LOWEST precedence operator first at the top level.
  // Each resulting sub-expression is then recursively evaluated, which will
  // handle the next-higher-precedence operators.

  // Handle logical OR (lowest precedence) - Wireshark: or, ||
  if (normalized.includes("||")) {
    const parts = splitByOperator(normalized, "||");
    if (parts.length >= 2) {
      return parts.some(part => evaluateWiresharkFilter(part.trim(), packet));
    }
  }

  // Handle logical XOR (Wireshark: xor, ^^)
  if (normalized.includes("^^")) {
    const parts = splitByOperator(normalized, "^^");
    if (parts.length >= 2) {
      let result = evaluateWiresharkFilter((parts[0] ?? "").trim(), packet);
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i] ?? "";
        const right = evaluateWiresharkFilter(part.trim(), packet);
        result = (result && !right) || (!result && right);
      }
      return result;
    }
  }

  // Handle logical AND (highest binary precedence) - Wireshark: and, &&
  if (normalized.includes("&&")) {
    const parts = splitByOperator(normalized, "&&");
    if (parts.length >= 2) {
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length === 0) continue;
        if (!evaluateWiresharkFilter(trimmed, packet)) {
          return false; // Early exit on first false
        }
      }
      return true; // All parts were true
    }
  }

  // Evaluate single condition
  return evaluateFilterCondition(normalized, packet);
}

function splitByOperator(filter: string, op: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parenCount = 0;
  let inString = false;
  let stringChar = '';
  let escapeNext = false;

  for (let i = 0; i < filter.length; i++) {
    const char = filter[i] ?? "";
    
    if (escapeNext) {
      escapeNext = false;
      current += char;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      current += char;
      continue;
    }
    
    if (char === '"' || char === "'") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
    }

    if (inString) {
      current += char;
      continue;
    }

    if (char === "(") parenCount++;
    if (char === ")") parenCount--;

    // Check for operator match (case-sensitive for && and ||)
    if (parenCount === 0 && filter.substring(i, i + op.length) === op) {
      parts.push(current.trim());
      current = "";
      i += op.length - 1; // Skip the operator
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(p => p.length > 0); // Remove empty parts
}

/** Evaluate field ~ "regex" (Wireshark matches, case-insensitive). Returns null if pattern is null. */
function evalMatches(fieldValue: string, pattern: string | null): boolean | null {
  if (pattern === null) return null;
  try {
    return new RegExp(pattern, "i").test(fieldValue);
  } catch {
    return false;
  }
}

function evaluateFilterCondition(condition: string, packet: PacketInfo): boolean {
  condition = condition.trim();
  if (!condition) return true;

  const condLower = condition.toLowerCase();
  const protocolUpper = packet.protocol.toUpperCase();

  // ── Protocol shortcuts (case-insensitive) ──────────────────────────────
  // Check if it's a bare protocol name with no operator
  if (!condition.includes(" ") && !condition.includes("=") && !condition.includes(">") && !condition.includes("<") && !condition.includes("~") && !condition.includes("{")) {
    switch (condLower) {
      case "ip": case "ipv4": return true;
      case "ipv6": return false;
      case "tcp": return protocolUpper === "TCP" || protocolUpper === "HTTP" || protocolUpper === "HTTPS";
      case "udp": return ["UDP", "SIP", "RTP", "SRTP", "RTCP", "FAX", "DNS"].includes(protocolUpper);
      case "sip": return protocolUpper === "SIP";
      case "rtp": return protocolUpper === "RTP" || protocolUpper === "SRTP";
      case "srtp": return protocolUpper === "SRTP";
      case "rtcp": return protocolUpper === "RTCP";
      case "fax": case "t38": case "udptl": return protocolUpper === "FAX";
      case "http": return protocolUpper === "HTTP";
      case "https": case "tls": case "ssl": return protocolUpper === "HTTPS";
      case "dns": return protocolUpper === "DNS";
      case "icmp": return protocolUpper === "ICMP";
      case "icmpv6": return false;
      case "arp": return protocolUpper === "ARP";
      case "eth": case "ethernet": return true;
      // "1" / "0" from parenthesized sub-expression results
      case "1": return true;
      case "0": return false;
    }
  }

  // ── "matches" / "~" operator: field ~ "regex" ─────────────────────────
  const matchesMatch = condition.match(/^([\w.:-]+)\s*~\s*"((?:[^"\\]|\\.)*)"/);
  if (matchesMatch) {
    const field = matchesMatch[1] ?? "";
    const pattern = (matchesMatch[2] ?? "").replace(/\\(.)/g, (_, c: string) =>
      c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c === '"' ? '"' : c);
    const fieldVal = getFieldValue(field, packet);
    const r = evalMatches(fieldVal, pattern);
    return r ?? false;
  }

  // ── "frame contains" / "field contains" ────────────────────────────────
  const containsQuotedMatch = condition.match(/^([\w.:-]+)\s+contains\s+"((?:[^"\\]|\\.)*)"/);
  if (containsQuotedMatch) {
    const field = containsQuotedMatch[1] ?? "";
    const search = (containsQuotedMatch[2] ?? "").replace(/\\(.)/g, (_, c: string) =>
      c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c === '"' ? '"' : c);
    const fieldVal = getFieldValue(field, packet);
    return fieldVal.toLowerCase().includes(search.toLowerCase());
  }
  const containsUnquotedMatch = condition.match(/^([\w.:-]+)\s+contains\s+(\S+)/);
  if (containsUnquotedMatch) {
    const field = containsUnquotedMatch[1] ?? "";
    const search = containsUnquotedMatch[2] ?? "";
    const fieldVal = getFieldValue(field, packet);
    return fieldVal.toLowerCase().includes(search.toLowerCase());
  }

  // ── "field in { val1, val2, ... }" ────────────────────────────────────
  const inSetMatch = condition.match(/^([\w.:-]+)\s+in\s+\{\s*(.+)\s*\}$/);
  if (inSetMatch) {
    const field = (inSetMatch[1] ?? "").toLowerCase();
    const content = (inSetMatch[2] ?? "").trim();
    const parts = content.split(",").map(p => p.trim());

    // IP address set
    if (field === "ip.addr" || field === "ip.src" || field === "ip.dst") {
      const ips = parts.filter(p => /^[\d.]+$/.test(p) || p.includes("/"));
      const ipsToCheck = field === "ip.addr" ? [packet.srcIp, packet.dstIp] :
                         field === "ip.src" ? [packet.srcIp] : [packet.dstIp];
      for (const checkIp of ipsToCheck) {
        for (const ip of ips) {
          if (ip.includes("/")) {
            try {
              const [cidrIp, prefix] = ip.split("/");
              if (isIpInCidr(checkIp, cidrIp ?? "", parseInt(prefix ?? "0", 10))) return true;
            } catch { /* skip */ }
          } else if (checkIp === ip) return true;
        }
      }
      return false;
    }

    // Port set
    if (field.endsWith(".port") || field.endsWith(".srcport") || field.endsWith(".dstport")) {
      const numSet = new Set<number>();
      for (const p of parts) {
        const rangeMatch = p.match(/^(\d+)\s*\.\.\s*(\d+)$/);
        if (rangeMatch) {
          const a = parseInt(rangeMatch[1] ?? "0", 10);
          const b = parseInt(rangeMatch[2] ?? "0", 10);
          for (let i = a; i <= b; i++) numSet.add(i);
        } else {
          const n = parseInt(p, 10);
          if (!isNaN(n)) numSet.add(n);
        }
      }
      const portsToCheck = field.endsWith(".srcport") ? [packet.srcPort] :
                           field.endsWith(".dstport") ? [packet.dstPort] : [packet.srcPort, packet.dstPort];
      return portsToCheck.some(p => numSet.has(p));
    }
    return false;
  }

  // ── "tcp.flags & 0x02" (bitwise AND) ──────────────────────────────────
  const tcpFlagsBitMatch = condition.match(/tcp\.flags\s*&\s*(0x[\da-fA-F]+|\d+)/);
  if (tcpFlagsBitMatch && packet.decoded?.tcp) {
    const maskStr = tcpFlagsBitMatch[1] ?? "0";
    const mask = maskStr.startsWith("0x") ? parseInt(maskStr, 16) : parseInt(maskStr, 10);
    return (packet.decoded.tcp.flags & mask) !== 0;
  }

  // ── Generic field op value comparison ──────────────────────────────────
  const genericMatch = condition.match(/^([\w.:-]+)\s*(===?|!==?|>=?|<=?)\s*(.+)$/);
  if (genericMatch) {
    const field = genericMatch[1] ?? "";
    const op = genericMatch[2] ?? "";
    let valueStr = (genericMatch[3] ?? "").trim();
    // Strip surrounding quotes
    if ((valueStr.startsWith('"') && valueStr.endsWith('"')) || (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
      valueStr = valueStr.slice(1, -1);
    }
    return evaluateFieldComparison(field, op, valueStr, packet);
  }

  // ── Default: only try substring match if no operator chars present ─────
  if (!condition.match(/[=<>!&|()~{}]/)) {
    return packet.summary.toLowerCase().includes(condLower) ||
           packet.srcIp.includes(condition) ||
           packet.dstIp.includes(condition) ||
           packet.protocol.toLowerCase().includes(condLower);
  }

    return false;
  }

/** Get the string value of any Wireshark field for a packet (case-insensitive field names). */
function getFieldValue(field: string, packet: PacketInfo): string {
  const f = field.toLowerCase();

  // Frame/packet-level
  if (f === "frame") return packet.summary || "";
  if (f === "frame.len" || f === "frame.length") return String(packet.frameLength ?? packet.size);
  if (f === "ip.len" || f === "ip.length") return String(packet.size);

  // IP fields
  if (f === "ip.addr") return `${packet.srcIp} ${packet.dstIp}`;
  if (f === "ip.src") return packet.srcIp;
  if (f === "ip.dst") return packet.dstIp;
  if (f === "ip.ttl") return String(packet.decoded?.ip?.ttl ?? "");
  if (f === "ip.proto" || f === "ip.protocol") return String(packet.decoded?.ip?.protocol ?? "");
  if (f === "ip.id") return String(packet.decoded?.ip?.identification ?? "");

  // Ethernet fields
  if (f === "eth.src") return packet.decoded?.ethernet?.srcMac ?? "";
  if (f === "eth.dst") return packet.decoded?.ethernet?.dstMac ?? "";
  if (f === "eth.addr") return `${packet.decoded?.ethernet?.srcMac ?? ""} ${packet.decoded?.ethernet?.dstMac ?? ""}`;
  if (f === "eth.type") return String(packet.decoded?.ethernet?.ethertype ?? "");

  // TCP fields
  if (f === "tcp.flags") return String(packet.decoded?.tcp?.flags ?? "");
  if (f === "tcp.flags.syn") return String(packet.decoded?.tcp ? ((packet.decoded.tcp.flags & 0x02) !== 0 ? 1 : 0) : "");
  if (f === "tcp.flags.ack") return String(packet.decoded?.tcp ? ((packet.decoded.tcp.flags & 0x10) !== 0 ? 1 : 0) : "");
  if (f === "tcp.flags.fin") return String(packet.decoded?.tcp ? ((packet.decoded.tcp.flags & 0x01) !== 0 ? 1 : 0) : "");
  if (f === "tcp.flags.rst" || f === "tcp.flags.reset") return String(packet.decoded?.tcp ? ((packet.decoded.tcp.flags & 0x04) !== 0 ? 1 : 0) : "");
  if (f === "tcp.flags.push" || f === "tcp.flags.psh") return String(packet.decoded?.tcp ? ((packet.decoded.tcp.flags & 0x08) !== 0 ? 1 : 0) : "");
  if (f === "tcp.flags.urg") return String(packet.decoded?.tcp ? ((packet.decoded.tcp.flags & 0x20) !== 0 ? 1 : 0) : "");
  if (f === "tcp.seq" || f === "tcp.sequence") return String(packet.decoded?.tcp?.sequence ?? "");
  if (f === "tcp.ack") return String(packet.decoded?.tcp?.acknowledgment ?? "");
  if (f === "tcp.window" || f === "tcp.window_size") return String(packet.decoded?.tcp?.window ?? "");

  // SIP fields (case-insensitive lookup)
  if (f.startsWith("sip.") && packet.decoded?.application?.type === "Sip") {
    const sip = packet.decoded.application.data;
    switch (f) {
      case "sip.method": case "sip.request.method": return sip.method ?? "";
      case "sip.status-code": case "sip.status_code": case "sip.response.code": return String(sip.responseCode ?? "");
      case "sip.response_text": case "sip.reason": case "sip.status": return sip.responseText ?? "";
      case "sip.call-id": case "sip.callid": case "sip.call_id": return sip.callId ?? "";
      case "sip.from": case "sip.from.addr": return sip.from ?? "";
      case "sip.to": case "sip.to.addr": return sip.to ?? "";
      case "sip.request-uri": case "sip.r-uri": case "sip.requesturi": return sip.requestUri ?? "";
      case "sip.user-agent": case "sip.user_agent": return sip.headers?.["user-agent"] ?? "";
      case "sip.expires": return sip.headers?.["expires"] ?? "";
      case "sip.contact": case "sip.contact.addr": return sip.contact ?? "";
      case "sip.cseq": return sip.cseq ?? "";
      case "sip.cseq.num": return (sip.cseq ?? "").split(" ")[0] ?? "";
      case "sip.cseq.method": return (sip.cseq ?? "").split(" ").slice(1).join(" ") ?? "";
      case "sip.via": return sip.via?.join(" ") ?? "";
      case "sip.content-type": case "sip.content_type": return sip.contentType ?? "";
      case "sip.content-length": case "sip.content_length": return String(sip.contentLength ?? "");
      default: {
        // Try generic header lookup: sip.xxx -> header "xxx"
        const headerName = f.slice(4); // strip "sip."
        return sip.headers?.[headerName] ?? sip.headers?.[headerName.toLowerCase()] ?? "";
      }
    }
  }

  // DNS fields
  if (f.startsWith("dns.") && packet.decoded?.application?.type === "Dns") {
    const dns = packet.decoded.application.data;
    switch (f) {
      case "dns.qry.name": case "dns.query.name":
        return dns.queries?.map((q: { name: string }) => q.name).join(" ") ?? "";
      case "dns.flags.response":
        return dns.isResponse ? "1" : "0";
      case "dns.qry.type": case "dns.query.type":
        return dns.queries?.map((q: { qtype: number }) => String(q.qtype)).join(" ") ?? "";
      case "dns.count.queries": case "dns.qdcount":
        return String(dns.questions ?? "");
      case "dns.count.answers": case "dns.ancount":
        return String(dns.answerRrs ?? "");
      case "dns.response_code": case "dns.rcode":
        return String(dns.responseCode ?? "");
      default: return "";
    }
  }

  // RTP fields
  if (f.startsWith("rtp.") && (packet.decoded?.application?.type === "Rtp" || packet.decoded?.application?.type === "Srtp")) {
    const rtp = packet.decoded.application.data;
    switch (f) {
      case "rtp.version": return String(rtp.version ?? "");
      case "rtp.p_type": case "rtp.payload_type": case "rtp.pt": return String(rtp.payloadType ?? "");
      case "rtp.seq": case "rtp.sequence": case "rtp.sequence_number": return String(rtp.sequenceNumber ?? "");
      case "rtp.timestamp": case "rtp.ts": return String(rtp.timestamp ?? "");
      case "rtp.ssrc": return String(rtp.ssrc ?? "");
      case "rtp.marker": return rtp.marker ? "1" : "0";
      case "rtp.csrc": case "rtp.csrc.count": case "rtp.cc": return String(rtp.csrcCount ?? rtp.csrc?.length ?? "");
      case "rtp.padding": return rtp.padding ? "1" : "0";
      case "rtp.ext": case "rtp.extension": return rtp.extension ? "1" : "0";
      default: return "";
    }
  }

  return "";
}

/** Evaluate a generic field comparison: field op value. */
function evaluateFieldComparison(field: string, op: string, valueStr: string, packet: PacketInfo): boolean {
  const f = field.toLowerCase();

  // ── IP address comparisons (special: CIDR, addr matches src or dst) ───
  if (f === "ip.addr" || f === "ip.src" || f === "ip.dst") {
    const ipsToCheck = f === "ip.addr" ? [packet.srcIp, packet.dstIp] :
                       f === "ip.src" ? [packet.srcIp] : [packet.dstIp];
    if (valueStr.includes("/")) {
      // CIDR
      try {
        const [cidrIp, prefix] = valueStr.split("/");
        const prefixLen = parseInt(prefix ?? "0", 10);
        const result = ipsToCheck.some(ip => isIpInCidr(ip, cidrIp ?? "", prefixLen));
        return (op === "==" || op === "===") ? result : (op === "!=" || op === "!==") ? !result : false;
      } catch { return false; }
    }
    const result = ipsToCheck.some(ip => ip === valueStr);
    return (op === "==" || op === "===") ? result : (op === "!=" || op === "!==") ? !result : false;
  }

  // ── Port comparisons ──────────────────────────────────────────────────
  if (f.endsWith(".port") || f.endsWith(".srcport") || f.endsWith(".dstport")) {
    const port = parseInt(valueStr, 10);
    if (isNaN(port)) return false;
    const portsToCheck = f.endsWith(".srcport") ? [packet.srcPort] :
                         f.endsWith(".dstport") ? [packet.dstPort] : [packet.srcPort, packet.dstPort];
    if (op === "==" || op === "===") return portsToCheck.some(p => p === port);
    if (op === "!=" || op === "!==") return portsToCheck.every(p => p !== port);
    // For >, <, >=, <= on multi-port, any port matching is enough
    return portsToCheck.some(p => matchComparison(p, op, port));
  }

  // ── Ethernet address comparison ───────────────────────────────────────
  if (f === "eth.src" || f === "eth.dst" || f === "eth.addr") {
    const targetMac = normalizeMac(valueStr);
    if (f === "eth.addr") {
      const srcMac = normalizeMac(packet.decoded?.ethernet?.srcMac ?? "");
      const dstMac = normalizeMac(packet.decoded?.ethernet?.dstMac ?? "");
      const result = srcMac === targetMac || dstMac === targetMac;
      return (op === "==" || op === "===") ? result : (op === "!=" || op === "!==") ? !result : false;
    }
    const packetMac = normalizeMac(f === "eth.src" ? (packet.decoded?.ethernet?.srcMac ?? "") : (packet.decoded?.ethernet?.dstMac ?? ""));
    const result = packetMac === targetMac;
    return (op === "==" || op === "===") ? result : (op === "!=" || op === "!==") ? !result : false;
  }

  // ── Numeric fields ────────────────────────────────────────────────────
  const fieldVal = getFieldValue(field, packet);
  if (fieldVal === "") return false;

  // Try numeric comparison first
  const fieldNum = parseSmartNumber(fieldVal);
  const targetNum = parseSmartNumber(valueStr);
  if (fieldNum !== null && targetNum !== null) {
    return matchComparison(fieldNum, op, targetNum);
  }

  // ── String comparison ─────────────────────────────────────────────────
  if (op === "==" || op === "===") {
    // For DNS query type, support name aliases
    if (f === "dns.qry.type" || f === "dns.query.type") {
      const typeNum = dnsTypeNameToNumber(valueStr);
      if (typeNum !== null) {
        return fieldVal.split(" ").some(v => parseInt(v, 10) === typeNum);
      }
    }
    return fieldVal.toLowerCase() === valueStr.toLowerCase();
  }
  if (op === "!=" || op === "!==") {
    return fieldVal.toLowerCase() !== valueStr.toLowerCase();
  }

  return false;
}

/** Parse a number from string, supporting hex (0x...) and decimal. */
function parseSmartNumber(s: string): number | null {
  if (!s || s === "") return null;
  const trimmed = s.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const n = parseInt(trimmed, 16);
    return isNaN(n) ? null : n;
  }
  const n = Number(trimmed);
  return isNaN(n) ? null : n;
}

/** Convert DNS type name to number. */
function dnsTypeNameToNumber(name: string): number | null {
  const map: Record<string, number> = {
    A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16,
    AAAA: 28, SRV: 33, NAPTR: 35, ANY: 255,
  };
  return map[name.toUpperCase()] ?? null;
}

function matchComparison(value: number, operator: string, target: number): boolean {
  switch (operator) {
    case "==":
    case "===":
      return value === target;
    case "!=":
    case "!==":
      return value !== target;
    case ">":
      return value > target;
    case ">=":
      return value >= target;
    case "<":
      return value < target;
    case "<=":
      return value <= target;
    default:
      return false;
  }
}

function normalizeMac(mac: string): string {
  // Normalize MAC address to lowercase with colons
  return mac.toLowerCase().replace(/[.\-]/g, ":").replace(/:+/g, ":");
}

function isIpInCidr(ip: string, cidrIp: string, prefixLen: number): boolean {
  try {
    const ipParts = ip.split(".").map(Number);
    const cidrParts = cidrIp.split(".").map(Number);
    
    if (ipParts.length !== 4 || cidrParts.length !== 4) return false;
    
    const ipNum = ((ipParts[0] ?? 0) << 24) + ((ipParts[1] ?? 0) << 16) + ((ipParts[2] ?? 0) << 8) + (ipParts[3] ?? 0);
    const cidrNum = ((cidrParts[0] ?? 0) << 24) + ((cidrParts[1] ?? 0) << 16) + ((cidrParts[2] ?? 0) << 8) + (cidrParts[3] ?? 0);
    const mask = (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
    
    return (ipNum & mask) === (cidrNum & mask);
  } catch {
    return false;
  }
}
