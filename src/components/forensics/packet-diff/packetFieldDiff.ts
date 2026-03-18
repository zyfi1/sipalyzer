import type {
  ApplicationLayer,
  PacketInfo,
  ParsedSipMessage,
  RtcpCompoundPacket,
  RtpHeader,
} from "@/types/packetCapture";

export type PacketFieldDiffStatus = "same" | "changed" | "left_only" | "right_only";

export interface PacketFieldDiffRow {
  key: string;
  label: string;
  left: string;
  right: string;
  status: PacketFieldDiffStatus;
}

const EMPTY_VALUE = "—";

function toDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (Array.isArray(value)) return value.length === 0 ? EMPTY_VALUE : value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function putField(
  out: Map<string, { label: string; value: string }>,
  key: string,
  label: string,
  value: unknown,
): void {
  out.set(key, { label, value: toDisplay(value) });
}

function addSipFields(out: Map<string, { label: string; value: string }>, sip: ParsedSipMessage): void {
  putField(out, "sip.method", "SIP Method", sip.method);
  putField(out, "sip.responseCode", "SIP Response Code", sip.responseCode);
  putField(out, "sip.responseText", "SIP Response Text", sip.responseText);
  putField(out, "sip.callId", "SIP Call-ID", sip.callId);
  putField(out, "sip.cseq", "SIP CSeq", sip.cseq);
  putField(out, "sip.from", "SIP From", sip.from);
  putField(out, "sip.to", "SIP To", sip.to);
  putField(out, "sip.contact", "SIP Contact", sip.contact);
  putField(out, "sip.contentType", "SIP Content-Type", sip.contentType);
  putField(out, "sip.contentLength", "SIP Content-Length", sip.contentLength);
  if (sip.body?.sdp) {
    const media = sip.body.sdp.media[0];
    if (media) {
      putField(out, "sdp.mediaType", "SDP Media Type", media.mediaType);
      putField(out, "sdp.port", "SDP Port", media.port);
      putField(out, "sdp.protocol", "SDP Protocol", media.protocol);
      putField(out, "sdp.payloadTypes", "SDP Payload Types", media.payloadTypes);
      putField(out, "sdp.connection", "SDP Connection", media.connection);
    }
  }
}

function addRtpFields(out: Map<string, { label: string; value: string }>, rtp: RtpHeader): void {
  putField(out, "rtp.payloadType", "RTP Payload Type", rtp.payloadType);
  putField(out, "rtp.sequenceNumber", "RTP Sequence", rtp.sequenceNumber);
  putField(out, "rtp.timestamp", "RTP Timestamp", rtp.timestamp);
  putField(out, "rtp.ssrc", "RTP SSRC", rtp.ssrc);
  putField(out, "rtp.marker", "RTP Marker", rtp.marker);
}

function addRtcpFields(out: Map<string, { label: string; value: string }>, rtcp: RtcpCompoundPacket): void {
  putField(out, "rtcp.packetCount", "RTCP Packet Count", rtcp.packets.length);
  const first = rtcp.packets[0];
  putField(out, "rtcp.firstType", "RTCP First Type", first?.packetType);
  putField(out, "rtcp.firstSsrc", "RTCP First SSRC", first?.ssrc);
}

function addApplicationFields(
  out: Map<string, { label: string; value: string }>,
  application: ApplicationLayer | undefined,
): void {
  if (!application) return;
  putField(out, "app.type", "App Layer", application.type);
  switch (application.type) {
    case "Sip":
      addSipFields(out, application.data);
      break;
    case "SipOverWs":
      putField(out, "ws.opcode", "WebSocket Opcode", application.data.wsFrame.opcodeName);
      putField(out, "ws.length", "WebSocket Payload Length", application.data.wsFrame.payloadLength);
      addSipFields(out, application.data.sip);
      break;
    case "Rtp":
    case "Srtp":
      addRtpFields(out, application.data);
      break;
    case "Rtcp":
      addRtcpFields(out, application.data);
      break;
    case "T38":
      putField(out, "t38.seq", "T.38 Sequence", application.data.seq);
      putField(out, "t38.ifpType", "T.38 IFP Type", application.data.ifpType);
      break;
    case "Dns":
      putField(out, "dns.transactionId", "DNS Txn ID", application.data.transactionId);
      putField(out, "dns.isResponse", "DNS Response", application.data.isResponse);
      putField(out, "dns.responseCode", "DNS RCODE", application.data.responseCode);
      putField(out, "dns.questionCount", "DNS Questions", application.data.questions);
      break;
    case "WebSocket":
      putField(out, "ws.opcode", "WebSocket Opcode", application.data.opcodeName);
      putField(out, "ws.length", "WebSocket Payload Length", application.data.payloadLength);
      break;
    case "Unknown":
      putField(out, "app.unknownLength", "Unknown Payload Length", application.data.length);
      break;
  }
}

function extractPacketFields(packet: PacketInfo | null): Map<string, { label: string; value: string }> {
  const out = new Map<string, { label: string; value: string }>();
  if (!packet) return out;

  putField(out, "packet.protocol", "Protocol", packet.protocol);
  putField(out, "packet.timestamp", "Timestamp", packet.timestamp);
  putField(out, "packet.length", "Frame Length", packet.frameLength ?? packet.size);
  putField(out, "packet.src", "Source", `${packet.srcIp}:${packet.srcPort}`);
  putField(out, "packet.dst", "Destination", `${packet.dstIp}:${packet.dstPort}`);

  const ip = packet.decoded?.ip;
  if (ip) {
    putField(out, "ip.ttl", "IP TTL", ip.ttl);
    putField(out, "ip.totalLength", "IP Total Length", ip.totalLength);
    putField(out, "ip.identification", "IP ID", ip.identification);
    putField(out, "ip.flags", "IP Flags", ip.flags);
  }

  const udp = packet.decoded?.udp;
  if (udp) {
    putField(out, "udp.length", "UDP Length", udp.length);
    putField(out, "udp.checksum", "UDP Checksum", udp.checksum);
  }

  addApplicationFields(out, packet.decoded?.application);
  return out;
}

export function diffPacketFields(left: PacketInfo | null, right: PacketInfo | null): PacketFieldDiffRow[] {
  const leftFields = extractPacketFields(left);
  const rightFields = extractPacketFields(right);
  const keys = new Set<string>([...leftFields.keys(), ...rightFields.keys()]);

  const rows: PacketFieldDiffRow[] = [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const leftField = leftFields.get(key);
      const rightField = rightFields.get(key);
      const label = leftField?.label ?? rightField?.label ?? key;
      const leftValue = leftField?.value ?? EMPTY_VALUE;
      const rightValue = rightField?.value ?? EMPTY_VALUE;

      let status: PacketFieldDiffStatus = "same";
      if (leftField && !rightField) status = "left_only";
      else if (!leftField && rightField) status = "right_only";
      else if (leftValue !== rightValue) status = "changed";

      return {
        key,
        label,
        left: leftValue,
        right: rightValue,
        status,
      };
    });

  return rows;
}
