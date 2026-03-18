import type { PacketInfo } from "@/types/packetCapture";

const PROTOCOL_LABEL_COLORS: Record<string, string> = {
  SIP: "text-info",
  RTP: "text-success",
  SRTP: "text-primary",
  RTCP: "text-info",
  FAX: "text-warning",
  DNS: "text-warning",
  HTTP: "text-success",
  HTTPS: "text-info",
  TCP: "text-muted-foreground",
  UDP: "text-muted-foreground",
  ICMP: "text-destructive",
  ARP: "text-primary",
};

const PROTOCOL_ROW_TINTS: Record<string, string> = {
  SIP: "bg-info/[0.06]",
  RTP: "bg-success/[0.05]",
  SRTP: "bg-primary/[0.05]",
  RTCP: "bg-info/[0.05]",
  DNS: "bg-warning/[0.06]",
  HTTP: "bg-success/[0.06]",
  HTTPS: "bg-info/[0.06]",
  TCP: "bg-info/[0.03]",
  UDP: "bg-warning/[0.03]",
  ICMP: "bg-destructive/[0.06]",
  ARP: "bg-primary/[0.05]",
  FAX: "bg-warning/[0.05]",
};

function normalizeProtocol(protocol: string | undefined): string {
  return (protocol ?? "").toUpperCase();
}

export function getProtocolLabelColor(protocol: string | undefined): string {
  return PROTOCOL_LABEL_COLORS[normalizeProtocol(protocol)] || "text-foreground";
}

export function getProtocolRowTint(protocol: string | undefined): string {
  return PROTOCOL_ROW_TINTS[normalizeProtocol(protocol)] || "";
}

function getSipResponseCode(packet: PacketInfo): number | null {
  const app = packet.decoded?.application;
  if (app?.type === "Sip" && app.data.responseCode) return app.data.responseCode;
  if (app?.type === "SipOverWs" && app.data.sip.responseCode) return app.data.sip.responseCode;
  const m = (packet.summary ?? "").match(/\bSIP\s+(\d{3})\b/i);
  return m ? Number(m[1]) : null;
}

function getHttpResponseCode(packet: PacketInfo): number | null {
  const summary = packet.summary ?? "";
  const m = summary.match(/\bHTTP\/\d(?:\.\d)?\s+(\d{3})\b/i);
  return m ? Number(m[1]) : null;
}

export function getPacketRowTint(packet: PacketInfo): string {
  const protocol = normalizeProtocol(packet.protocol);
  const baseTint = PROTOCOL_ROW_TINTS[protocol] || "";

  if (protocol === "DNS") {
    const app = packet.decoded?.application;
    if (app?.type === "Dns") {
      if (app.data.isResponse) {
        if ((app.data.responseCode ?? 0) >= 3) return "bg-destructive/[0.06]";
        return "bg-warning/[0.08]";
      }
      return "bg-warning/[0.05]";
    }
    return baseTint;
  }

  if (protocol === "SIP") {
    const code = getSipResponseCode(packet);
    if (code !== null) {
      if (code >= 500) return "bg-destructive/[0.07]";
      if (code >= 400) return "bg-warning/[0.08]";
      if (code >= 300) return "bg-warning/[0.06]";
      if (code >= 200) return "bg-success/[0.06]";
      return "bg-info/[0.06]";
    }
    return baseTint;
  }

  if (protocol === "HTTP" || protocol === "HTTPS") {
    const code = getHttpResponseCode(packet);
    if (code !== null) {
      if (code >= 500) return "bg-destructive/[0.07]";
      if (code >= 400) return "bg-warning/[0.08]";
      if (code >= 300) return "bg-warning/[0.06]";
      if (code >= 200) return "bg-success/[0.07]";
      return "bg-info/[0.05]";
    }
    return protocol === "HTTPS" ? "bg-info/[0.06]" : "bg-success/[0.06]";
  }

  return baseTint;
}
