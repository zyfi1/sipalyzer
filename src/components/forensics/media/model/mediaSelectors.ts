import { VOIP_QUALITY_THRESHOLDS } from "@/lib/voipQualityThresholds";
import { findingMatchesRtpStream } from "@/lib/expertFindingUtils";
import type { SipDialog } from "@/types/forensics";
import type { ExpertFinding, RtpStreamInfo } from "@/types/packetCapture";
import { getRtpStreamKey } from "./types";
import type { MediaHealth, MediaSummary } from "./types";

const MEDIA_WINDOW_MARGIN_MS = 10_000;

export function isEndpointInCapture(ip: string): boolean {
  if (!ip || ip === "0.0.0.0" || ip === "::" || ip === "255.255.255.255") return false;
  if (ip === "::1" || ip.startsWith("ff")) return false;
  const parts = ip.split(".");
  if (parts.length === 4) {
    const first = parseInt(parts[0] ?? "0", 10);
    if (Number.isNaN(first) || first === 127 || (first >= 224 && first <= 239)) return false;
  }
  return true;
}

export function isIp(value: string): boolean {
  if (!value || value.length < 7) return false;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  if (value.includes(":") && /^[0-9a-fA-F:]+$/.test(value)) return true;
  return false;
}

export function extractIp(value: string): string | null {
  if (!value) return null;
  if (isIp(value)) return value;
  const hostMatch = value.match(/@([^;>\s]+)/);
  const host = hostMatch?.[1]?.replace(/^\[|\]$/g, "");
  if (host && isIp(host)) return host;
  const ipv4 = value.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  return ipv4?.[1] ?? null;
}

export function isVoipCallDialog(dialog: SipDialog): boolean {
  return dialog.messages.some((m) => m.methodOrCode.trim().toUpperCase() === "INVITE");
}

export function getDialogEndpointIps(selectedDialog: SipDialog | null): Set<string> {
  const endpoints = new Set<string>();
  if (!selectedDialog?.participants) return endpoints;
  for (const participant of selectedDialog.participants) {
    const ip = extractIp(participant);
    if (ip) endpoints.add(ip);
  }
  return endpoints;
}

export function getDialogWindowStreams(selectedDialog: SipDialog | null, rtpStreams: RtpStreamInfo[]): RtpStreamInfo[] {
  const validStreams = rtpStreams.filter(
    (stream) => isEndpointInCapture(stream.srcIp) && isEndpointInCapture(stream.dstIp),
  );
  const messages = selectedDialog?.messages ?? [];
  if (!messages.length || !validStreams.length) return [];
  const first = messages[0];
  const last = messages[messages.length - 1];
  if (!first || !last) return [];
  const startMs = new Date(first.timestamp).getTime();
  const endMs = new Date(last.timestamp).getTime();
  return validStreams.filter((stream) => {
    const streamStart = new Date(stream.firstPacketTime).getTime();
    const streamEnd = new Date(stream.lastPacketTime).getTime();
    return streamEnd >= (startMs - MEDIA_WINDOW_MARGIN_MS) && streamStart <= (endMs + MEDIA_WINDOW_MARGIN_MS);
  });
}

export function filterStreamsForDialogContext(
  rtpInRange: RtpStreamInfo[],
  endpointIps: Set<string>,
): RtpStreamInfo[] {
  const valid = rtpInRange.filter(
    (stream) => isEndpointInCapture(stream.srcIp) && isEndpointInCapture(stream.dstIp),
  );
  if (endpointIps.size === 0) return valid;
  return valid.filter((stream) => endpointIps.has(stream.srcIp) || endpointIps.has(stream.dstIp));
}

export function isDegradedStream(stream: RtpStreamInfo): boolean {
  return (
    stream.lossPercentage >= VOIP_QUALITY_THRESHOLDS.lossPct.warning ||
    stream.mosScore < VOIP_QUALITY_THRESHOLDS.mos.warning ||
    stream.jitter >= VOIP_QUALITY_THRESHOLDS.jitterMs.warning
  );
}

export function buildMediaSummary(streamsForTable: RtpStreamInfo[]): MediaSummary {
  if (streamsForTable.length === 0) {
    return { avgMos: null, avgLoss: null, avgJitter: null, degradedStreams: 0 };
  }
  let mosTotal = 0;
  let lossTotal = 0;
  let jitterTotal = 0;
  let degradedStreams = 0;
  for (const stream of streamsForTable) {
    mosTotal += stream.mosScore;
    lossTotal += stream.lossPercentage;
    jitterTotal += stream.jitter;
    if (isDegradedStream(stream)) degradedStreams += 1;
  }
  return {
    avgMos: mosTotal / streamsForTable.length,
    avgLoss: lossTotal / streamsForTable.length,
    avgJitter: jitterTotal / streamsForTable.length,
    degradedStreams,
  };
}

export function buildPrioritizedStreams(streamsForTable: RtpStreamInfo[]): RtpStreamInfo[] {
  const score = (stream: RtpStreamInfo) =>
    stream.lossPercentage * 10 + (5 - stream.mosScore) * 5 + stream.jitter / 10;
  return [...streamsForTable].sort((a, b) => score(b) - score(a));
}

export function buildConsolidatedStreams(streamsForTable: RtpStreamInfo[]): RtpStreamInfo[] {
  if (!streamsForTable.length) return [];
  const byIpPair = new Map<string, RtpStreamInfo>();
  for (const stream of streamsForTable) {
    const key = `${stream.srcIp}\t${stream.dstIp}`;
    const duration = new Date(stream.lastPacketTime).getTime() - new Date(stream.firstPacketTime).getTime();
    const existing = byIpPair.get(key);
    const existingDuration = existing
      ? new Date(existing.lastPacketTime).getTime() - new Date(existing.firstPacketTime).getTime()
      : -1;
    if (!existing || duration > existingDuration) byIpPair.set(key, stream);
  }
  const byDuration = Array.from(byIpPair.values()).sort(
    (a, b) =>
      new Date(b.lastPacketTime).getTime() -
      new Date(b.firstPacketTime).getTime() -
      (new Date(a.lastPacketTime).getTime() - new Date(a.firstPacketTime).getTime()),
  );
  return byDuration.slice(0, 2).sort(
    (a, b) => new Date(a.firstPacketTime).getTime() - new Date(b.firstPacketTime).getTime(),
  );
}

export function buildMediaHealth(prioritizedStreams: RtpStreamInfo[]): MediaHealth {
  if (prioritizedStreams.length === 0) return { label: "No media", tone: "text-muted-foreground" };
  const worst = prioritizedStreams[0];
  if (!worst) return { label: "No media", tone: "text-muted-foreground" };
  if (isDegradedStream(worst)) return { label: "Needs attention", tone: "text-warning" };
  return { label: "Healthy", tone: "text-success" };
}

export function buildFindingsByStream(
  streamsForTable: RtpStreamInfo[],
  expertFindings: ExpertFinding[],
): Map<string, ExpertFinding[]> {
  const byStream = new Map<string, ExpertFinding[]>();
  for (const stream of streamsForTable) {
    const key = getRtpStreamKey(stream);
    const matched = expertFindings.filter((finding) => findingMatchesRtpStream(finding, stream));
    if (matched.length > 0) byStream.set(key, matched);
  }
  return byStream;
}
