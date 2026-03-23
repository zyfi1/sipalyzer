import type { PacketInfo } from "@/types/packetCapture";

function parseCseqNumber(cseq: string | undefined): string | null {
  if (!cseq) return null;
  const m = cseq.trim().match(/^(\d+)/);
  return m?.[1] ?? null;
}

/**
 * Stable correlation keys for hover/linking across lanes (SIP dialog/transaction, RTP/RTCP SSRC).
 */
export function correlationKeysForPacket(packet: PacketInfo | null | undefined): string[] {
  if (!packet) return [];
  const keys: string[] = [];
  const app = packet.decoded?.application;
  if (!app) return keys;

  switch (app.type) {
    case "Sip": {
      const sip = app.data;
      if (sip.callId) keys.push(`call:${sip.callId}`);
      const cn = parseCseqNumber(sip.cseq);
      if (sip.callId && cn) keys.push(`txn:${sip.callId}:${cn}`);
      break;
    }
    case "SipOverWs": {
      const sip = app.data.sip;
      if (sip.callId) keys.push(`call:${sip.callId}`);
      const cn = parseCseqNumber(sip.cseq);
      if (sip.callId && cn) keys.push(`txn:${sip.callId}:${cn}`);
      break;
    }
    case "Rtp":
    case "Srtp":
      keys.push(`rtp:${app.data.ssrc}`);
      break;
    case "Rtcp": {
      const seen = new Set<number>();
      for (const p of app.data.packets) {
        if (typeof p.ssrc === "number" && !seen.has(p.ssrc)) {
          seen.add(p.ssrc);
          keys.push(`rtcp:${p.ssrc}`);
        }
      }
      break;
    }
    default:
      break;
  }
  return keys;
}

export function voipQualityHint(packet: PacketInfo | null | undefined): string | null {
  if (!packet) return null;
  const app = packet.decoded?.application;
  if (app?.type !== "Rtcp") return null;
  for (const p of app.data.packets) {
    const m = p.voipMetrics;
    if (m && (typeof m.mosLq === "number" || typeof m.mosCq === "number")) {
      const parts: string[] = [];
      if (typeof m.mosLq === "number") parts.push(`MOS-LQ ${m.mosLq.toFixed(2)}`);
      if (typeof m.mosCq === "number") parts.push(`MOS-CQ ${m.mosCq.toFixed(2)}`);
      if (typeof m.rFactor === "number") parts.push(`R ${m.rFactor.toFixed(1)}`);
      return parts.join(" · ");
    }
  }
  return null;
}
