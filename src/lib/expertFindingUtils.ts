import type { ExpertFinding, RtpStreamInfo } from "@/types/packetCapture";

const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SSRC_RE = /\bssrc\b[:=\s#]*(0x[0-9a-f]+|[0-9]{1,10})\b/gi;
const ENDPOINT_RE = /\b((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})\b/g;

function findingTextParts(finding: ExpertFinding): string[] {
  return [
    finding.title,
    finding.description,
    finding.detail ?? "",
    ...finding.evidence.map((e) => e.value),
    ...finding.evidence.map((e) => e.label ?? ""),
  ];
}

function shouldUseMediaFilter(finding: ExpertFinding): boolean {
  if (finding.category === "media") return true;
  if (finding.evidence.some((e) => e.evidenceType === "rtpStream")) return true;

  const text = findingTextParts(finding).join(" ").toLowerCase();
  if (/\brtp\b|\brtcp\b|\bmos\b|\bjitter\b|\bssrc\b/.test(text)) return true;
  if (text.includes("packet loss") || text.includes(" on stream ")) return true;

  return false;
}

export function getPrimaryPacketIndex(finding: ExpertFinding): number | null {
  const first = finding.evidence.find((e) => e.packetIndices.length > 0)?.packetIndices[0];
  return typeof first === "number" ? first : null;
}

export function hasSpecificPacketEvidence(finding: ExpertFinding): boolean {
  const packetEvidence = finding.evidence.flatMap((e) => e.packetIndices);
  const unique = new Set(packetEvidence);
  return unique.size === 1;
}

export function buildFindingDisplayFilter(finding: ExpertFinding): string {
  if (shouldUseMediaFilter(finding)) {
    const ssrcs = extractSsrcsFromFinding(finding);
    if (ssrcs.length > 0) {
      const ssrcExpr = ssrcs.map((ssrc) => `(rtp.ssrc == ${ssrc} || rtcp.ssrc == ${ssrc})`).join(" || ");
      return `(rtp || rtcp) && (${ssrcExpr})`;
    }

    const endpoints = extractEndpointsFromFinding(finding);
    if (endpoints.length >= 2) {
      const a = endpoints[0]!;
      const b = endpoints[1]!;
      return [
        "(rtp || rtcp) && (",
        `  ((ip.src == ${a.ip} && ip.dst == ${b.ip} && udp.srcport == ${a.port} && udp.dstport == ${b.port}) ||`,
        `   (ip.src == ${b.ip} && ip.dst == ${a.ip} && udp.srcport == ${b.port} && udp.dstport == ${a.port}))`,
        ")",
      ].join("\n");
    }

    const ips = extractIpsFromFinding(finding);
    if (ips.length >= 2) {
      const a = ips[0]!;
      const b = ips[1]!;
      return `(rtp || rtcp) && ((ip.src == ${a} && ip.dst == ${b}) || (ip.src == ${b} && ip.dst == ${a}))`;
    }

    if (ips.length === 1) {
      return `(rtp || rtcp) && ip.addr == ${ips[0]}`;
    }

    return "rtp || rtcp";
  }

  switch (finding.category) {
    case "signaling":
      return "sip";
    case "fax":
      return "t38 || udptl || sip";
    case "security":
      return "sip || tls";
    default:
      return "udp || tcp";
  }
}

export function extractIpsFromFinding(finding: ExpertFinding): string[] {
  const ips = new Set<string>();
  for (const text of findingTextParts(finding)) {
    const matches = text.match(IPV4_RE);
    if (!matches) continue;
    for (const ip of matches) ips.add(ip);
  }
  return Array.from(ips);
}

export function extractSsrcsFromFinding(finding: ExpertFinding): number[] {
  const ssrcs = new Set<number>();
  for (const text of findingTextParts(finding)) {
    SSRC_RE.lastIndex = 0;
    let match: RegExpExecArray | null = SSRC_RE.exec(text);
    while (match) {
      const raw = (match[1] ?? "").trim().toLowerCase();
      const parsed = raw.startsWith("0x")
        ? Number.parseInt(raw.slice(2), 16)
        : Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) ssrcs.add(parsed);
      match = SSRC_RE.exec(text);
    }
  }
  return Array.from(ssrcs);
}

type EndpointRef = { ip: string; port: number };

export function extractEndpointsFromFinding(finding: ExpertFinding): EndpointRef[] {
  const endpoints: EndpointRef[] = [];
  const seen = new Set<string>();

  for (const text of findingTextParts(finding)) {
    ENDPOINT_RE.lastIndex = 0;
    let match: RegExpExecArray | null = ENDPOINT_RE.exec(text);
    while (match) {
      const ip = match[1] ?? "";
      const port = Number.parseInt(match[2] ?? "", 10);
      if (!Number.isFinite(port)) {
        match = ENDPOINT_RE.exec(text);
        continue;
      }
      const key = `${ip}:${port}`;
      if (!seen.has(key)) {
        seen.add(key);
        endpoints.push({ ip, port });
      }
      match = ENDPOINT_RE.exec(text);
    }
  }

  return endpoints;
}

export function isMediaFinding(finding: ExpertFinding): boolean {
  return (
    finding.category === "media" ||
    finding.evidence.some((e) => e.evidenceType === "rtpStream")
  );
}

export function findingMatchesRtpStream(finding: ExpertFinding, stream: RtpStreamInfo): boolean {
  const ips = extractIpsFromFinding(finding);
  const ssrcs = extractSsrcsFromFinding(finding);
  const endpoints = extractEndpointsFromFinding(finding);
  const ssrcMatch = ssrcs.some((ssrc) => ssrc === stream.ssrc);
  if (ssrcMatch) return true;

  if (endpoints.length >= 2) {
    for (let i = 0; i < endpoints.length; i += 1) {
      const a = endpoints[i];
      if (!a) continue;
      for (let j = i + 1; j < endpoints.length; j += 1) {
        const b = endpoints[j];
        if (!b) continue;
        const direct =
          a.ip === stream.srcIp &&
          a.port === stream.srcPort &&
          b.ip === stream.dstIp &&
          b.port === stream.dstPort;
        const reverse =
          a.ip === stream.dstIp &&
          a.port === stream.dstPort &&
          b.ip === stream.srcIp &&
          b.port === stream.srcPort;
        if (direct || reverse) return true;
      }
    }
    return false;
  }

  if (ips.length >= 2) {
    return ips.includes(stream.srcIp) && ips.includes(stream.dstIp);
  }

  return ips.some((ip) => ip === stream.srcIp || ip === stream.dstIp);
}

