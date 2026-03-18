import { useEffect, useState, useRef, useCallback, memo } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check, Loader2, HelpCircle } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { IpAddress } from "@/components/ui/IpAddress";
import type { PacketInfo, DecodedPacket, DnsMessage, PacketDataFidelity, PacketProvenance } from "@/types/packetCapture";
import { useDnsResolution } from "@/hooks/useDnsResolution";
import { EmptyState } from "@/components/ui/empty-state";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { getPacketRawBytes } from "@/api/packetCapture";

// DNS record type names
const DNS_RECORD_TYPES: Record<number, string> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  12: "PTR",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  33: "SRV",
};

// DNS response code names
const DNS_RESPONSE_CODES: Record<number, string> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
};

const getDnsRecordTypeName = (type: number): string => {
  return DNS_RECORD_TYPES[type] || `TYPE${type}`;
};

const getDnsResponseCodeName = (code: number): string => {
  return DNS_RESPONSE_CODES[code] || `RCODE${code}`;
};

/** Key-value row with normalized layout: key never wraps, value wraps with break-word. */
function DetailRow({
  label,
  value,
  tooltip,
  copyText,
  valueClassName = "font-mono text-xs",
}: {
  label: string;
  value: React.ReactNode;
  tooltip?: { title: string; description?: string } | { title: string; content?: string };
  copyText?: string;
  valueClassName?: string;
}) {
  const resolvedCopyText =
    copyText ??
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : undefined);
  const labelEl = (
    <span className={`text-muted-foreground whitespace-nowrap shrink-0 ${tooltip ? "cursor-help" : ""}`}>
      {label}
    </span>
  );
  return (
    <div className="ui-data-row group grid grid-cols-[minmax(0,max-content)_1fr] items-baseline gap-x-3 gap-y-0.5 rounded px-2 py-1.5 -mx-2 last:border-b-0 transition-smooth">
      <div className="min-w-0 shrink-0">
        {tooltip ? (
          <TooltipWrapper entry={tooltip}>{labelEl}</TooltipWrapper>
        ) : (
          labelEl
        )}
      </div>
      <div className="min-w-0 flex items-center justify-end gap-2">
        <div className={`min-w-0 break-all text-right ${valueClassName}`}>
          {value}
        </div>
        {resolvedCopyText ? <CopyButton text={resolvedCopyText} /> : null}
      </div>
    </div>
  );
}

function MiniFieldRow({
  label,
  value,
  copyText,
  tooltip,
  valueClassName = "font-mono text-2xs",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  copyText?: string;
  tooltip?: { title: string; description?: string } | { title: string; content?: string };
  valueClassName?: string;
}) {
  const labelEl = <span className="text-muted-foreground text-2xs cursor-help">{label}</span>;
  return (
    <div className="group flex items-center justify-between gap-2 py-0.5">
      <div className="min-w-0">
        {tooltip ? <TooltipWrapper entry={tooltip}>{labelEl}</TooltipWrapper> : labelEl}
      </div>
      <div className="min-w-0 flex items-center gap-1.5">
        <span className={valueClassName}>{value}</span>
        {copyText ? <CopyButton text={copyText} /> : null}
      </div>
    </div>
  );
}

interface PacketDetailsViewProps {
  packet: PacketInfo | null;
  sessionId?: string | null;
  packetIndex?: number | null;
  initialTab?: "overview" | "protocol" | "raw";
}

const RAW_BYTES_CACHE_MAX_ENTRIES = 300;
const rawBytesCache = new Map<string, number[]>();
const rawBytesCacheOrder: string[] = [];
const rawBytesErrorCache = new Map<string, string>();
const rawBytesErrorCacheOrder: string[] = [];
const rawBytesInFlightCache = new Map<string, Promise<number[]>>();

function upsertBoundedCache<T>(
  cache: Map<string, T>,
  order: string[],
  key: string,
  value: T,
  maxEntries: number
) {
  cache.set(key, value);
  const existing = order.indexOf(key);
  if (existing !== -1) order.splice(existing, 1);
  order.push(key);
  while (order.length > maxEntries) {
    const oldest = order.shift();
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function useCopyFeedback(durationMs = 1800) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markCopied = useCallback(() => {
    setCopied(true);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, durationMs);
  }, [clearTimer, durationMs]);

  useEffect(() => clearTimer, [clearTimer]);

  return { copied, markCopied };
}

function PacketDetailsViewComponent({ packet, sessionId, packetIndex, initialTab = "overview" }: PacketDetailsViewProps) {
  const [activeTab, setActiveTab] = useState(initialTab);

  if (!packet) {
    return (
      <EmptyState variant="inline" title="Select a packet to view details" className="h-full p-6" />
    );
  }

  const decoded = packet.decoded;
  const resolvedPacketIndex = packet.originalIndex ?? packetIndex ?? null;

  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Tabs Navigation - Sticky */}
      <div className="ui-floating-header-sm px-2 py-1.5">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "overview" | "protocol" | "raw")}
          className="w-full"
        >
          <TabsList variant="line" className="w-fit gap-1 p-0 bg-transparent border-0 shadow-none">
            <TooltipWrapper entry={tooltips.captureTabOverview}>
              <TabsTrigger value="overview" className="h-7 px-2.5 text-xs">Overview</TabsTrigger>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.captureTabProtocol}>
              <TabsTrigger value="protocol" className="h-7 px-2.5 text-xs">Protocol</TabsTrigger>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.captureTabRaw}>
              <TabsTrigger value="raw" className="h-7 px-2.5 text-xs">Raw</TabsTrigger>
            </TooltipWrapper>
          </TabsList>
        </Tabs>
      </div>

      {/* Content Area - Scrollable */}
      <div className="flex-1 min-h-0 overflow-auto px-2.5 py-2">
        {activeTab === "overview" && <OverviewTab packet={packet} />}
        {activeTab === "protocol" && <ProtocolTreeTab packet={packet} decoded={decoded} />}
        {activeTab === "raw" && (
          <RawDataTab packet={packet} sessionId={sessionId} packetIndex={resolvedPacketIndex} />
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { copied, markCopied } = useCopyFeedback();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      markCopied();
    } catch {
      // Ignore clipboard failures to avoid UI lockups.
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`opacity-0 group-hover:opacity-100 transition-smooth p-1 rounded ${
        copied 
          ? "opacity-100 bg-success/20 hover:bg-success/30" 
          : "hover:bg-muted"
      }`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success animate-in fade-in zoom-in duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

function OverviewTab({ packet }: { packet: PacketInfo }) {
  const { copied, markCopied } = useCopyFeedback();
  const srcDns = useDnsResolution(packet.srcIp);
  const dstDns = useDnsResolution(packet.dstIp);
  // Safely extract DNS data with proper type checking
  const getDnsData = (): DnsMessage | null => {
    if (packet.decoded?.application?.type === "Dns") {
      const app = packet.decoded.application;
      if (app && "data" in app && app.data) {
        return app.data as DnsMessage;
      }
    }
    return null;
  };
  
  const isDnsPacket = packet.protocol === "DNS" || packet.decoded?.application?.type === "Dns";
  const dnsData = getDnsData();
  const normalizedProvenance: PacketProvenance | undefined =
    packet.dataProvenance ??
    (packet.provenance && typeof packet.provenance === "object" ? packet.provenance : undefined);
  const fidelity: PacketDataFidelity | undefined =
    packet.dataFidelity ??
    packet.fidelity ??
    normalizedProvenance?.fidelity;
  const provenanceText =
    normalizedProvenance?.source ||
    normalizedProvenance?.method ||
    (typeof packet.provenance === "string" ? packet.provenance : undefined);
  const fidelityDisplay = fidelity
    ? fidelity === "authoritative"
      ? "Authoritative"
      : fidelity === "derived"
        ? "Derived"
        : fidelity === "simulated"
          ? "Simulated"
          : "Unknown"
    : null;
  // Derive concise info similar to list view
  const getPacketInfo = (): string => {
    if (packet.decoded?.application) {
      const app = packet.decoded.application;
      if (app.type === "Sip") {
        if (app.data.method) {
          return app.data.method.toUpperCase();
        }
        if (app.data.responseCode) {
          const code = app.data.responseCode;
          const text = (app.data.responseText || "").trim();
          return text ? `${code} ${text}` : `${code}`;
        }
        if (packet.summary) {
          const match = packet.summary.match(/SIP\\s+(\\d+\\s+\\w+|\\w+)(?=\\s|$)/);
          if (match) {
            return (match[1] ?? "").trim();
          }
        }
        return "SIP";
      } else if (app.type === "Rtp" || app.type === "Srtp") {
        const prefix = app.type === "Srtp" ? "SRTP" : "RTP";
        if (app.data.dtmfEvent) {
          return `${prefix} DTMF '${app.data.dtmfEvent.digit}' PT:${app.data.payloadType} SSRC:0x${app.data.ssrc.toString(16)}`;
        }
        return `${prefix} PT:${app.data.payloadType} SSRC:0x${app.data.ssrc.toString(16)}`;
      } else if (app.type === "Rtcp") {
        const rtcp = app.data as any;
        if (rtcp.packets && rtcp.packets.length > 0) {
          const first = rtcp.packets[0];
          const typeName = first.packetType === 200 ? "SR" : first.packetType === 201 ? "RR" : first.packetType === 202 ? "SDES" : first.packetType === 203 ? "BYE" : "RTCP";
          return `RTCP ${typeName} SSRC:0x${first.ssrc?.toString(16) ?? '0'}`;
        }
        return "RTCP";
      } else if (app.type === "T38") {
        const t38 = app.data;
        const ifp = t38.ifpType ?? "UDPTL";
        return `T.38 ${ifp} seq ${t38.seq ?? 0}`;
      }
    }

    if (packet.protocol === "SIP" && packet.summary) {
      const match = packet.summary.match(/SIP\\s+(\\d+\\s+\\w+|\\w+)(?=\\s|$)/);
      if (match) {
        return (match[1] ?? "").trim();
      }
    }

    if (packet.protocol === "FAX") {
      if (packet.summary) {
        const m = packet.summary.match(/T\.38\s+(\S+)\s+seq\s+(\d+)/);
        if (m) return `T.38 ${m[1]} seq ${m[2]}`;
      }
      return "T.38 UDPTL";
    }

    if (packet.protocol === "ICMP" || packet.protocol === "ARP" || packet.protocol === "Other") {
      return `${packet.protocol} ${packet.srcIp} -> ${packet.dstIp}`;
    }

    return `${packet.protocol} ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`;
  };

  const infoText = getPacketInfo();

  const copyAll = async () => {
    let text = `Packet Overview
Timestamp: ${new Date(packet.timestamp).toISOString()}
Protocol: ${packet.protocol}
Payload: ${packet.size} bytes${packet.frameLength != null && packet.frameLength !== packet.size ? `, Frame: ${packet.frameLength} bytes` : ""}
Source: ${packet.srcIp}:${packet.srcPort}${srcDns.hostname ? ` (${srcDns.hostname})` : ""}
Destination: ${packet.dstIp}:${packet.dstPort}${dstDns.hostname ? ` (${dstDns.hostname})` : ""}`;
    if (fidelityDisplay || provenanceText) {
      text += `\nFidelity: ${fidelityDisplay ?? "N/A"}`;
      if (provenanceText) {
        text += `\nProvenance: ${provenanceText}`;
      }
      if (normalizedProvenance?.details) {
        text += `\nProvenance Details: ${normalizedProvenance.details}`;
      }
    }
    
    if (dnsData && typeof dnsData === 'object' && 'transactionId' in dnsData) {
      text += `\n\nDNS Information:
Type: ${dnsData.isResponse ? "Response" : "Query"}
Transaction ID: 0x${typeof dnsData.transactionId === 'number' ? dnsData.transactionId.toString(16) : 'N/A'}
Questions: ${dnsData.queries && Array.isArray(dnsData.queries) ? dnsData.queries.length : 0}`;
      if (dnsData.queries && Array.isArray(dnsData.queries) && dnsData.queries.length > 0) {
        text += `\nQueries:`;
        dnsData.queries.forEach((q: any) => {
          text += `\n  - ${q.name || 'N/A'} (Type: ${q.qtype || 'N/A'}, Class: ${q.qclass || 'N/A'})`;
        });
      }
      if (dnsData.answers && Array.isArray(dnsData.answers) && dnsData.answers.length > 0) {
        text += `\nAnswers: ${dnsData.answers.length}`;
        dnsData.answers.forEach((a: any) => {
          text += `\n  - ${a.name || 'N/A'} -> ${a.data || 'N/A'} (TTL: ${a.ttl || 'N/A'})`;
        });
      }
    }
    
    try {
      await navigator.clipboard.writeText(text);
      markCopied();
    } catch {
      // Clipboard may be unavailable in some environments.
    }
  };

  return (
    <div className="space-y-2.5 text-xs">
      <div className="mb-1 flex justify-end">
        <Button
          variant={copied ? "positive" : "neutral"}
          size="sm"
          className="h-7 text-xs transition-smooth"
          onClick={copyAll}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5 animate-in fade-in zoom-in duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy All
            </>
          )}
        </Button>
      </div>

      {/* General Info */}
      <div className="space-y-0.5 px-1">
        <div className="ui-data-row group flex items-center justify-between py-1.5">
          <TooltipWrapper entry={tooltips.colTime}><span className="text-muted-foreground cursor-help">Timestamp</span></TooltipWrapper>
          <div className="flex items-center gap-2">
            <span className="font-mono">{new Date(packet.timestamp).toISOString()}</span>
            <CopyButton text={new Date(packet.timestamp).toISOString()} />
          </div>
        </div>
        <div className="ui-data-row group flex items-center justify-between py-1.5">
          <TooltipWrapper entry={tooltips.colProtocol}><span className="text-muted-foreground cursor-help">Protocol</span></TooltipWrapper>
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips[`proto${packet.protocol.charAt(0).toUpperCase() + packet.protocol.slice(1).toLowerCase()}` as keyof typeof tooltips] as any || { title: packet.protocol }}>
              <Badge variant="outline" className="text-xs h-5 cursor-help">{packet.protocol}</Badge>
            </TooltipWrapper>
            <CopyButton text={packet.protocol} />
          </div>
        </div>
        <div className="ui-data-row group flex items-center justify-between py-1.5">
          <TooltipWrapper entry={tooltips.colInfo}><span className="text-muted-foreground cursor-help">Info</span></TooltipWrapper>
          <div className="flex items-center gap-2 max-w-[65%] justify-end">
            <span className="font-semibold text-foreground truncate">{infoText}</span>
            <CopyButton text={infoText} />
          </div>
        </div>
        {packet.summary && (
          <div className="ui-data-row group flex items-center justify-between py-1.5">
            <span className="text-muted-foreground">Summary</span>
            <div className="flex items-center gap-2 max-w-[65%] justify-end">
              <span className="text-foreground text-2xs truncate">{packet.summary}</span>
              <CopyButton text={packet.summary} />
            </div>
          </div>
        )}
        <div className="ui-data-row group flex items-center justify-between py-1.5">
          <TooltipWrapper entry={tooltips.colLength}><span className="text-muted-foreground cursor-help">Payload</span></TooltipWrapper>
          <div className="flex items-center gap-2">
            <span>{packet.size} bytes</span>
            <CopyButton text={`${packet.size} bytes`} />
          </div>
        </div>
        {packet.frameLength != null && packet.frameLength !== packet.size && (
          <div className="ui-data-row group flex items-center justify-between py-1.5">
            <span className="text-muted-foreground">Frame</span>
            <div className="flex items-center gap-2">
              <span>{packet.frameLength} bytes</span>
              <CopyButton text={`${packet.frameLength} bytes`} />
            </div>
          </div>
        )}
      </div>

      {/* Network Info */}
      <div className="space-y-0.5 border-t border-border/25 px-1 pt-2">
        <div className="ui-data-row group flex items-center justify-between py-1.5">
          <TooltipWrapper entry={tooltips.colSource}><span className="text-muted-foreground cursor-help">Source IP</span></TooltipWrapper>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end gap-0.5">
              <IpAddress ip={packet.srcIp} variant="mono" size="sm" showCopyOnHover />
              {srcDns.isLoading && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                  Resolving...
                </span>
              )}
              {srcDns.hostname && !srcDns.isLoading && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Host:</span>
                  <span className="text-xs text-foreground font-semibold">{srcDns.hostname}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="ui-data-row group flex items-center justify-between py-1.5">
          <TooltipWrapper entry={tooltips.fieldTcpSrcPort}><span className="text-muted-foreground cursor-help">Source Port</span></TooltipWrapper>
          <div className="flex items-center gap-2">
            <span className="font-mono">{packet.srcPort}</span>
            <CopyButton text={packet.srcPort.toString()} />
          </div>
        </div>
        <div className="ui-data-row group flex items-center justify-between py-1.5">
          <TooltipWrapper entry={tooltips.colDestination}><span className="text-muted-foreground cursor-help">Destination IP</span></TooltipWrapper>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end gap-0.5">
              <IpAddress ip={packet.dstIp} variant="mono" size="sm" showCopyOnHover />
              {dstDns.isLoading && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                  Resolving...
                </span>
              )}
              {dstDns.hostname && !dstDns.isLoading && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Host:</span>
                  <span className="text-xs text-foreground font-semibold">{dstDns.hostname}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="ui-data-row group flex items-center justify-between py-1.5">
          <TooltipWrapper entry={tooltips.fieldTcpDstPort}><span className="text-muted-foreground cursor-help">Destination Port</span></TooltipWrapper>
          <div className="flex items-center gap-2">
            <span className="font-mono">{packet.dstPort}</span>
            <CopyButton text={packet.dstPort.toString()} />
          </div>
        </div>
      </div>

      {/* DNS Information Section */}
      {isDnsPacket && dnsData && typeof dnsData === 'object' && 'transactionId' in dnsData && (
        <div className="mt-2.5 space-y-1.5 border-t border-border/25 pt-2.5">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs font-semibold text-foreground">DNS Information</span>
            <TooltipWrapper entry={tooltips.protoDns}>
              <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
            </TooltipWrapper>
          </div>
          <div className="space-y-2">
            <div className="ui-data-row group flex items-center justify-between py-1.5">
              <TooltipWrapper entry={tooltips.fieldDnsType}><span className="text-muted-foreground cursor-help">Type</span></TooltipWrapper>
              <div className="flex items-center gap-2">
                <Badge variant={dnsData.isResponse ? "default" : "secondary"} className="text-xs h-5">
                  {dnsData.isResponse ? "Response" : "Query"}
                </Badge>
                <CopyButton text={dnsData.isResponse ? "Response" : "Query"} />
              </div>
            </div>
            <div className="ui-data-row group flex items-center justify-between py-1.5">
              <TooltipWrapper entry={tooltips.fieldDnsTransactionId}><span className="text-muted-foreground cursor-help">Transaction ID</span></TooltipWrapper>
              <div className="flex items-center gap-2">
                <span className="font-mono">0x{typeof dnsData.transactionId === 'number' ? dnsData.transactionId.toString(16).toUpperCase().padStart(4, '0') : 'N/A'}</span>
                <CopyButton text={`0x${typeof dnsData.transactionId === 'number' ? dnsData.transactionId.toString(16).toUpperCase().padStart(4, '0') : 'N/A'}`} />
              </div>
            </div>
            {dnsData.isResponse && (
              <div className="ui-data-row group flex items-center justify-between py-1.5">
                <TooltipWrapper entry={tooltips.fieldDnsResponseCode}><span className="text-muted-foreground cursor-help">Response Code</span></TooltipWrapper>
                <div className="flex items-center gap-2">
                  <Badge 
                    variant={
                      dnsData.responseCode === 0 ? "default" : 
                      dnsData.responseCode === 3 ? "destructive" : 
                      "secondary"
                    } 
                    className="text-xs h-5"
                  >
                    {getDnsResponseCodeName(dnsData.responseCode ?? 0)}
                  </Badge>
                  <CopyButton text={getDnsResponseCodeName(dnsData.responseCode ?? 0)} />
                </div>
              </div>
            )}
            {dnsData.queries && Array.isArray(dnsData.queries) && dnsData.queries.length > 0 && (
              <div className="py-1.5">
                <div className="text-xs font-semibold mb-1.5 text-muted-foreground">
                  {dnsData.isResponse ? "Question" : "Query"} {dnsData.queries.length > 1 ? `(${dnsData.queries.length})` : ""}
                </div>
                <div className="space-y-1">
                  {dnsData.queries.map((query, idx) => (
                    <div key={idx} className="ui-data-row group flex items-center justify-between py-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-foreground truncate">{query.name}</div>
                        <div className="text-2xs text-muted-foreground mt-0.5">
                          Type: <span className="font-mono font-semibold">{getDnsRecordTypeName(query.qtype ?? 0)}</span>
                          {query.qclass !== 1 && `, Class: ${query.qclass}`}
                        </div>
                      </div>
                      <CopyButton text={query.name} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {dnsData.isResponse && dnsData.answers && Array.isArray(dnsData.answers) && dnsData.answers.length > 0 && (
              <div className="py-1.5">
                <div className="text-xs font-semibold mb-1.5 text-muted-foreground">Answer{dnsData.answers.length > 1 ? `s (${dnsData.answers.length})` : ""}</div>
                <div className="space-y-1">
                  {dnsData.answers.map((answer, idx) => (
                    <div key={idx} className="ui-data-row group flex items-center justify-between py-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-foreground truncate">{answer.name}</div>
                        <div className="text-xs text-foreground mt-0.5 font-mono">→ {answer.data}</div>
                        <div className="text-2xs text-muted-foreground mt-0.5">
                          <span className="font-semibold">{getDnsRecordTypeName(answer.rtype ?? 0)}</span>
                          {answer.ttl > 0 && ` • TTL: ${answer.ttl}s`}
                        </div>
                      </div>
                      <CopyButton text={`${answer.name} -> ${answer.data}`} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {dnsData.isResponse && (!dnsData.answers || dnsData.answers.length === 0) && (
              <div className="py-1.5">
                <EmptyState
                  compact
                  variant="inline"
                  title="No answers in response"
                  className="items-start justify-start p-0 text-left italic"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function ProtocolTreeTab({ packet, decoded }: { packet: PacketInfo; decoded?: DecodedPacket }) {
  const { copied, markCopied } = useCopyFeedback();

  // Get IPs for DNS resolution - use packet data as primary source
  const srcIp = packet?.srcIp || decoded?.ip?.srcIp || null;
  const dstIp = packet?.dstIp || decoded?.ip?.dstIp || null;
  const srcDns = useDnsResolution(srcIp);
  const dstDns = useDnsResolution(dstIp);

  if (!packet) {
    return <EmptyState compact variant="inline" title="No packet data available" />;
  }

  const copyProtocolTree = async () => {
    const lines: string[] = [];

    if (decoded?.ethernet) {
      lines.push(`Ethernet`);
      lines.push(`  Destination MAC: ${decoded.ethernet.dstMac}`);
      lines.push(`  Source MAC: ${decoded.ethernet.srcMac}`);
      lines.push(`  Type: 0x${decoded.ethernet.ethertype.toString(16)}`);
    }

    if (decoded?.ip) {
      lines.push(`IP`);
      lines.push(`  Version: ${decoded.ip.version}`);
      lines.push(`  TTL: ${decoded.ip.ttl}`);
      lines.push(`  Protocol: ${decoded.ip.protocol}`);
      lines.push(`  Source: ${decoded.ip.srcIp}${srcDns.hostname ? ` (${srcDns.hostname})` : ""}`);
      lines.push(`  Destination: ${decoded.ip.dstIp}${dstDns.hostname ? ` (${dstDns.hostname})` : ""}`);
    }

    if (decoded?.udp) {
      lines.push(`UDP`);
      lines.push(`  Source Port: ${decoded.udp.srcPort || 0}`);
      lines.push(`  Destination Port: ${decoded.udp.dstPort || 0}`);
      lines.push(`  Length: ${decoded.udp.length || 0} bytes`);
    }

    if (decoded?.tcp) {
      lines.push(`TCP`);
      lines.push(`  Source Port: ${decoded.tcp.srcPort || 0}`);
      lines.push(`  Destination Port: ${decoded.tcp.dstPort || 0}`);
      lines.push(`  Sequence: ${decoded.tcp.sequence || 0}`);
      lines.push(`  Acknowledgment: ${decoded.tcp.acknowledgment || 0}`);
    }

    if (decoded?.application) {
      if (decoded.application.type === "Sip") {
        lines.push(`SIP`);
        if (decoded.application.data.method) {
          lines.push(`  Method: ${decoded.application.data.method}`);
        }
        if (decoded.application.data.responseCode) {
          lines.push(`  Response Code: ${decoded.application.data.responseCode}`);
          if (decoded.application.data.responseText) {
            lines.push(`  Status: ${decoded.application.data.responseText}`);
          }
        }
      } else if (decoded.application.type === "Rtp" || decoded.application.type === "Srtp") {
        lines.push(decoded.application.type === "Srtp" ? `SRTP (encrypted)` : `RTP`);
        lines.push(`  Payload Type: ${decoded.application.data.payloadType || 0}`);
        lines.push(`  Sequence Number: ${decoded.application.data.sequenceNumber || 0}`);
        lines.push(`  Timestamp: ${decoded.application.data.timestamp || 0}`);
        lines.push(`  SSRC: 0x${(decoded.application.data.ssrc || 0).toString(16)}`);
        if (decoded.application.data.dtmfEvent) {
          const d = decoded.application.data.dtmfEvent;
          lines.push(`  DTMF Event: '${d.digit}' (event ${d.event})`);
          lines.push(`  DTMF End: ${d.endOfEvent}, Volume: ${d.volume}, Duration: ${d.duration}`);
        }
      } else if (decoded.application.type === "Rtcp") {
        const rtcp = decoded.application.data as any;
        lines.push(`RTCP`);
        if (rtcp.packets && Array.isArray(rtcp.packets)) {
          rtcp.packets.forEach((pkt: any, idx: number) => {
            const typeName = pkt.packetType === 200 ? "Sender Report (SR)" : 
                             pkt.packetType === 201 ? "Receiver Report (RR)" : 
                             pkt.packetType === 202 ? "Source Description (SDES)" : 
                             pkt.packetType === 203 ? "Goodbye (BYE)" : `Type ${pkt.packetType}`;
            lines.push(`  [${idx + 1}] ${typeName}`);
            lines.push(`    SSRC: 0x${(pkt.ssrc || 0).toString(16)}`);
            if (pkt.senderReport) {
              lines.push(`    Packets Sent: ${pkt.senderReport.packetCount}`);
              lines.push(`    Bytes Sent: ${pkt.senderReport.octetCount}`);
            }
            if (pkt.receiverReports && pkt.receiverReports.length > 0) {
              pkt.receiverReports.forEach((rr: any) => {
                lines.push(`    Report for SSRC: 0x${(rr.ssrc || 0).toString(16)}`);
                lines.push(`      Loss: ${((rr.fractionLost / 256) * 100).toFixed(1)}% (${rr.cumulativeLost} cumulative)`);
                lines.push(`      Jitter: ${rr.jitter}`);
              });
            }
            if (pkt.sdesItems && pkt.sdesItems.length > 0) {
              pkt.sdesItems.forEach((item: any) => {
                lines.push(`    ${item.itemTypeName}: ${item.value}`);
              });
            }
          });
        }
      } else if (decoded.application.type === "Dns") {
        const dnsData = decoded.application.data as any;
        if (dnsData && typeof dnsData === 'object' && 'transactionId' in dnsData) {
          lines.push(`DNS`);
          lines.push(`  Type: ${(dnsData as any).isResponse ? "Response" : "Query"}`);
          const txId = (dnsData as any).transactionId;
          lines.push(`  Transaction ID: 0x${typeof txId === 'number' ? txId.toString(16) : 'N/A'}`);
          const queries = (dnsData as any).queries;
          lines.push(`  Questions: ${Array.isArray(queries) ? queries.length : 0}`);
          if (Array.isArray(queries)) {
            queries.forEach((q: any) => {
              lines.push(`  Query: ${q.name || 'N/A'} (Type: ${q.qtype || 'N/A'}, Class: ${q.qclass || 'N/A'})`);
            });
          }
          const answers = (dnsData as any).answers;
          lines.push(`  Answers: ${Array.isArray(answers) ? answers.length : 0}`);
          if (Array.isArray(answers)) {
            answers.forEach((a: any) => {
              lines.push(`  Answer: ${a.name || 'N/A'} -> ${a.data || 'N/A'} (TTL: ${a.ttl || 'N/A'})`);
            });
          }
        }
      } else if (decoded.application.type === "T38") {
        const t38 = decoded.application.data;
        lines.push(`T.38 UDPTL`);
        lines.push(`  Type: ${t38.udptlType ?? 0} (0=primary only)`);
        lines.push(`  Sequence: ${t38.seq ?? 0}`);
        lines.push(`  Primary length: ${t38.primaryLen ?? 0} bytes`);
        if (t38.ifpType) lines.push(`  IFP: ${t38.ifpType}`);
      }
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      markCopied();
    } catch {
      // Clipboard may be unavailable in some environments.
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex justify-end mb-2">
        <Button
          variant={copied ? "positive" : "neutral"}
          size="sm"
          className="h-7 text-xs transition-smooth"
          onClick={copyProtocolTree}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5 animate-in fade-in zoom-in duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy All
            </>
          )}
        </Button>
      </div>

      {/* Ethernet Layer */}
      {decoded?.ethernet && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-2xs px-1.5 py-0 bg-accent text-foreground border-border">
              Ethernet II
            </Badge>
          </div>
          <div className="space-y-0 pl-2">
            <DetailRow label="Destination MAC" value={decoded.ethernet.dstMac} tooltip={tooltips.colDstMac} />
            <DetailRow label="Source MAC" value={decoded.ethernet.srcMac} tooltip={tooltips.colSrcMac} />
            <DetailRow label="Ethertype" value={`0x${decoded.ethernet.ethertype.toString(16).toUpperCase()}`} />
          </div>
        </div>
      )}

      {/* IP Layer */}
      {(decoded?.ip || packet.srcIp || packet.dstIp) && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-2xs px-1.5 py-0 bg-success/10 text-success border-success/20">
              {decoded?.ip ? `IPv${decoded.ip.version}` : 'IP'}
            </Badge>
            <span className="text-xs text-muted-foreground">Network</span>
          </div>
          <div className="space-y-0 pl-2">
            {decoded?.ip && (
              <>
                <DetailRow label="Version" value={decoded.ip.version} tooltip={tooltips.fieldIpVersion} />
                <DetailRow label="Header Length" value={`${decoded.ip.headerLength} bytes`} tooltip={tooltips.fieldIpHeaderLen} />
                <DetailRow label="Total Length" value={`${decoded.ip.totalLength} bytes`} tooltip={tooltips.fieldIpTotalLen} />
                <DetailRow label="TTL" value={decoded.ip.ttl} tooltip={tooltips.fieldIpTtl} />
                <DetailRow label="Protocol" value={decoded.ip.protocol} tooltip={tooltips.fieldIpProtocol} />
                <DetailRow label="Checksum" value={`0x${decoded.ip.checksum?.toString(16).padStart(4, "0")}`} tooltip={tooltips.fieldIpChecksum} />
              </>
            )}
            <DetailRow
              label="Source IP"
              value={
                <div className="flex flex-col items-end gap-0.5">
                  <IpAddress ip={decoded?.ip?.srcIp || packet.srcIp} variant="mono" size="sm" showCopyOnHover />
                  {srcDns.hostname && <span className="text-2xs text-muted-foreground">{srcDns.hostname}</span>}
                </div>
              }
              tooltip={tooltips.colSource}
              valueClassName="font-mono text-xs"
            />
            <DetailRow
              label="Destination IP"
              value={
                <div className="flex flex-col items-end gap-0.5">
                  <IpAddress ip={decoded?.ip?.dstIp || packet.dstIp} variant="mono" size="sm" showCopyOnHover />
                  {dstDns.hostname && <span className="text-2xs text-muted-foreground">{dstDns.hostname}</span>}
                </div>
              }
              tooltip={tooltips.colDestination}
              valueClassName="font-mono text-xs"
            />
          </div>
        </div>
      )}

      {/* Transport Layer */}
      {decoded?.tcp && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips.protoTcp}>
              <Badge variant="outline" className="text-2xs px-1.5 py-0 bg-warning/10 text-warning-foreground border-warning/20 cursor-help">
                TCP
              </Badge>
            </TooltipWrapper>
            <span className="text-xs text-muted-foreground">Transport</span>
          </div>
          <div className="space-y-0 pl-2">
            <DetailRow label="Source Port" value={decoded.tcp.srcPort || packet.srcPort} tooltip={tooltips.fieldTcpSrcPort} />
            <DetailRow label="Destination Port" value={decoded.tcp.dstPort || packet.dstPort} tooltip={tooltips.fieldTcpDstPort} />
            <DetailRow label="Sequence" value={decoded.tcp.sequence} tooltip={tooltips.fieldTcpSeq} />
            <DetailRow label="Acknowledgment" value={decoded.tcp.acknowledgment} tooltip={tooltips.fieldTcpAck} />
            <DetailRow label="Window Size" value={decoded.tcp.window} tooltip={tooltips.fieldTcpWindowSize} />
            <DetailRow label="Checksum" value={`0x${decoded.tcp.checksum?.toString(16).padStart(4, "0")}`} tooltip={tooltips.fieldTcpChecksum} />
          </div>
        </div>
      )}

      {decoded?.udp && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips.protoUdp}>
              <Badge variant="outline" className="text-2xs px-1.5 py-0 bg-info/10 text-info border-info/20 cursor-help">
                UDP
              </Badge>
            </TooltipWrapper>
            <span className="text-xs text-muted-foreground">Transport</span>
          </div>
          <div className="space-y-0 pl-2">
            <DetailRow label="Source Port" value={decoded.udp.srcPort || packet.srcPort} tooltip={tooltips.fieldUdpSrcPort} />
            <DetailRow label="Destination Port" value={decoded.udp.dstPort || packet.dstPort} tooltip={tooltips.fieldUdpDstPort} />
            <DetailRow label="Length" value={`${decoded.udp.length} bytes`} tooltip={tooltips.fieldUdpLength} />
            <DetailRow label="Checksum" value={`0x${decoded.udp.checksum?.toString(16).padStart(4, "0")}`} tooltip={tooltips.fieldUdpChecksum} />
          </div>
        </div>
      )}

      {/* Application Layer */}
      {decoded?.application && decoded.application.type === "Sip" && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips.protoSip}>
              <Badge variant="outline" className="text-2xs px-1.5 py-0 bg-destructive/10 text-destructive border-destructive/20 cursor-help">
                SIP
              </Badge>
            </TooltipWrapper>
            <span className="text-xs text-muted-foreground">Application</span>
          </div>
          <div className="space-y-0 pl-2">
            {decoded.application.data.method && (
              <DetailRow
                label="Method"
                value={decoded.application.data.method}
                tooltip={tooltips[`sipMethod${decoded.application.data.method.charAt(0).toUpperCase() + decoded.application.data.method.slice(1).toLowerCase()}` as keyof typeof tooltips] as any || { title: decoded.application.data.method }}
                valueClassName="font-mono text-xs font-semibold"
              />
            )}
            {decoded.application.data.responseCode && (
              <>
                <DetailRow
                  label="Response Code"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold">{decoded.application.data.responseCode}</span>
                      <TroubleshootLink sipCode={typeof decoded.application.data.responseCode === "number" ? decoded.application.data.responseCode : parseInt(String(decoded.application.data.responseCode), 10)} compact />
                    </span>
                  }
                  copyText={String(decoded.application.data.responseCode)}
                  tooltip={tooltips.fieldSipResponseCode}
                  valueClassName=""
                />
                {decoded.application.data.responseText && (
                  <DetailRow label="Status" value={decoded.application.data.responseText} tooltip={tooltips.fieldSipStatus} />
                )}
              </>
            )}
            {decoded.application.data.from && (
              <DetailRow label="From" value={decoded.application.data.from} tooltip={tooltips.fieldSipFrom} />
            )}
            {decoded.application.data.to && (
              <DetailRow label="To" value={decoded.application.data.to} tooltip={tooltips.fieldSipTo} />
            )}
            {decoded.application.data.callId && (
              <DetailRow label="Call-ID" value={decoded.application.data.callId} tooltip={tooltips.fieldSipCallId} />
            )}
            {decoded.application.data.cseq && (
              <DetailRow label="CSeq" value={decoded.application.data.cseq} tooltip={tooltips.fieldSipCseq} />
            )}
          </div>
        </div>
      )}

      {decoded?.application && (decoded.application.type === "Rtp" || decoded.application.type === "Srtp") && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips.protoRtp}>
              <Badge variant="outline" className={`text-2xs px-1.5 py-0 cursor-help ${decoded.application.type === "Srtp" ? "bg-warning/10 text-warning border-warning/20" : "bg-info/10 text-info border-info/20"}`}>
                {decoded.application.type === "Srtp" ? "SRTP" : "RTP"}
              </Badge>
            </TooltipWrapper>
            <span className="text-xs text-muted-foreground">Application</span>
          </div>
          <div className="space-y-0 pl-2">
            <DetailRow label="Version" value={decoded.application.data.version || 2} tooltip={tooltips.fieldRtpVersion} />
            <DetailRow label="Payload Type" value={decoded.application.data.payloadType} tooltip={tooltips.fieldRtpPayloadType} />
            <DetailRow label="Sequence Number" value={decoded.application.data.sequenceNumber} tooltip={tooltips.fieldRtpSeqNum} />
            <DetailRow label="Timestamp" value={decoded.application.data.timestamp} tooltip={tooltips.fieldRtpTimestamp} />
            <DetailRow label="SSRC" value={`0x${decoded.application.data.ssrc?.toString(16).toUpperCase().padStart(8, "0")}`} tooltip={tooltips.fieldRtpSsrc} />
            {decoded.application.data.encrypted && (
              <DetailRow label="Encryption" value="SRTP (encrypted)" />
            )}
            {decoded.application.data.dtmfEvent && (
              <>
                <DetailRow label="DTMF Digit" value={decoded.application.data.dtmfEvent.digit} />
                <DetailRow label="DTMF Event" value={decoded.application.data.dtmfEvent.event} />
                <DetailRow label="End of Event" value={decoded.application.data.dtmfEvent.endOfEvent ? "Yes" : "No"} />
                <DetailRow label="Volume" value={`-${decoded.application.data.dtmfEvent.volume} dBm0`} />
                <DetailRow label="Duration" value={decoded.application.data.dtmfEvent.duration} />
              </>
            )}
          </div>
        </div>
      )}

      {decoded?.application && decoded.application.type === "Rtcp" && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips.protoRtcp}>
              <Badge variant="outline" className="text-2xs px-1.5 py-0 bg-success/10 text-success border-success/20 cursor-help">
                RTCP
              </Badge>
            </TooltipWrapper>
            <span className="text-xs text-muted-foreground">Application</span>
          </div>
          {(() => {
            const rtcp = decoded.application.data as any;
            const packets = rtcp.packets || [];
            return (
              <div className="space-y-2 pl-2">
                {packets.map((pkt: any, idx: number) => {
                  const typeName = pkt.packetType === 200 ? "Sender Report (SR)" : 
                                   pkt.packetType === 201 ? "Receiver Report (RR)" : 
                                   pkt.packetType === 202 ? "Source Description (SDES)" : 
                                   pkt.packetType === 203 ? "Goodbye (BYE)" : 
                                   pkt.packetType === 204 ? "Application (APP)" :
                                   pkt.packetType === 205 ? "Transport FB (RTPFB)" :
                                   pkt.packetType === 206 ? "Payload FB (PSFB)" :
                                   pkt.packetType === 207 ? "Extended Report (XR)" : `Type ${pkt.packetType}`;
                  return (
                    <div key={idx} className="border-l-2 border-success/30 pl-2 space-y-1">
                      <div className="text-xs font-semibold text-success">{typeName}</div>
                      <MiniFieldRow
                        label="SSRC"
                        tooltip={tooltips.fieldRtcpSsrc}
                        value={`0x${pkt.ssrc?.toString(16).toUpperCase().padStart(8, '0')}`}
                        copyText={`0x${pkt.ssrc?.toString(16).toUpperCase().padStart(8, '0')}`}
                        valueClassName="font-mono text-xs"
                      />
                      
                      {/* Sender Report details */}
                      {pkt.senderReport && (
                        <div className="space-y-0.5 bg-muted/20 rounded p-1.5">
                          <TooltipWrapper entry={tooltips.fieldRtcpSr}><div className="text-2xs font-semibold text-muted-foreground mb-1 cursor-help">Sender Info</div></TooltipWrapper>
                          <MiniFieldRow
                            label="Packets Sent"
                            tooltip={tooltips.fieldRtcpPacketsSent}
                            value={pkt.senderReport.packetCount?.toLocaleString()}
                            copyText={String(pkt.senderReport.packetCount ?? "")}
                          />
                          <MiniFieldRow
                            label="Bytes Sent"
                            tooltip={tooltips.fieldRtcpBytesSent}
                            value={pkt.senderReport.octetCount?.toLocaleString()}
                            copyText={String(pkt.senderReport.octetCount ?? "")}
                          />
                          <MiniFieldRow
                            label="RTP Timestamp"
                            tooltip={tooltips.fieldRtcpRtpTimestamp}
                            value={pkt.senderReport.rtpTimestamp}
                            copyText={String(pkt.senderReport.rtpTimestamp ?? "")}
                          />
                        </div>
                      )}
                      
                      {/* Receiver Reports */}
                      {pkt.receiverReports && pkt.receiverReports.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-2xs font-semibold text-muted-foreground">Reception Reports ({pkt.receiverReports.length})</div>
                          {pkt.receiverReports.map((rr: any, rrIdx: number) => (
                            <div key={rrIdx} className="bg-muted/20 rounded p-1.5 space-y-0.5">
                              <MiniFieldRow
                                label="Source SSRC"
                                tooltip={tooltips.fieldRtcpSourceSsrc}
                                value={`0x${rr.ssrc?.toString(16).toUpperCase().padStart(8, '0')}`}
                                copyText={`0x${rr.ssrc?.toString(16).toUpperCase().padStart(8, '0')}`}
                              />
                              <MiniFieldRow
                                label="Fraction Lost"
                                tooltip={tooltips.fieldRtcpFractionLost}
                                value={`${((rr.fractionLost / 256) * 100).toFixed(1)}%`}
                                copyText={`${((rr.fractionLost / 256) * 100).toFixed(1)}%`}
                              />
                              <MiniFieldRow
                                label="Cumulative Lost"
                                tooltip={tooltips.fieldRtcpCumulativeLost}
                                value={rr.cumulativeLost}
                                copyText={String(rr.cumulativeLost ?? "")}
                              />
                              <MiniFieldRow
                                label={
                                  <span className="flex items-center gap-1">
                                    <span>Jitter</span>
                                    <HelpCircle className="h-2.5 w-2.5 text-muted-foreground/60 hover:text-muted-foreground" />
                                  </span>
                                }
                                tooltip={tooltips.fieldRtcpJitter}
                                value={rr.jitter}
                                copyText={String(rr.jitter ?? "")}
                              />
                              <MiniFieldRow
                                label="Highest Seq"
                                tooltip={tooltips.fieldRtcpHighestSeq}
                                value={rr.highestSeq}
                                copyText={String(rr.highestSeq ?? "")}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* SDES items */}
                      {pkt.sdesItems && pkt.sdesItems.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-2xs font-semibold text-muted-foreground">SDES Items ({pkt.sdesItems.length})</div>
                          {pkt.sdesItems.map((item: any, sIdx: number) => (
                            <div key={sIdx} className="bg-muted/20 rounded px-1.5">
                              <MiniFieldRow
                                label={item.itemTypeName}
                                value={item.value}
                                copyText={String(item.value ?? "")}
                                valueClassName="font-mono text-2xs truncate max-w-[150px]"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* BYE reason */}
                      {pkt.byeReason && (
                        <MiniFieldRow label="Reason" value={pkt.byeReason} copyText={String(pkt.byeReason)} />
                      )}

                      {/* RTCP-XR VoIP Metrics */}
                      {pkt.voipMetrics && (
                        <div className="space-y-0.5 bg-muted/20 rounded p-1.5">
                          <div className="text-2xs font-semibold text-muted-foreground mb-1">VoIP Metrics (RFC 3611)</div>
                          <MiniFieldRow label="Source SSRC" value={`0x${pkt.voipMetrics.ssrcSource?.toString(16).toUpperCase().padStart(8, '0')}`} copyText={`0x${pkt.voipMetrics.ssrcSource?.toString(16).toUpperCase().padStart(8, '0')}`} />
                          <MiniFieldRow label="Loss Rate" value={`${((pkt.voipMetrics.lossRate / 256) * 100).toFixed(1)}%`} copyText={`${((pkt.voipMetrics.lossRate / 256) * 100).toFixed(1)}%`} />
                          <MiniFieldRow label="Discard Rate" value={`${((pkt.voipMetrics.discardRate / 256) * 100).toFixed(1)}%`} copyText={`${((pkt.voipMetrics.discardRate / 256) * 100).toFixed(1)}%`} />
                          <MiniFieldRow label="R-Factor" value={pkt.voipMetrics.rFactor} copyText={String(pkt.voipMetrics.rFactor ?? "")} />
                          <MiniFieldRow label="MOS-LQ" value={pkt.voipMetrics.mosLq > 0 ? (pkt.voipMetrics.mosLq / 10).toFixed(1) : "N/A"} copyText={pkt.voipMetrics.mosLq > 0 ? (pkt.voipMetrics.mosLq / 10).toFixed(1) : "N/A"} />
                          <MiniFieldRow label="MOS-CQ" value={pkt.voipMetrics.mosCq > 0 ? (pkt.voipMetrics.mosCq / 10).toFixed(1) : "N/A"} copyText={pkt.voipMetrics.mosCq > 0 ? (pkt.voipMetrics.mosCq / 10).toFixed(1) : "N/A"} />
                          <MiniFieldRow label="Round Trip Delay" value={`${pkt.voipMetrics.roundTripDelay} ms`} copyText={`${pkt.voipMetrics.roundTripDelay} ms`} />
                          <MiniFieldRow label="End System Delay" value={`${pkt.voipMetrics.endSystemDelay} ms`} copyText={`${pkt.voipMetrics.endSystemDelay} ms`} />
                          <MiniFieldRow label="Signal Level" value={`${pkt.voipMetrics.signalLevel} dBm`} copyText={`${pkt.voipMetrics.signalLevel} dBm`} />
                          <MiniFieldRow label="Noise Level" value={`${pkt.voipMetrics.noiseLevel} dBm`} copyText={`${pkt.voipMetrics.noiseLevel} dBm`} />
                          <MiniFieldRow label="JB Nominal" value={`${pkt.voipMetrics.jbNominal} ms`} copyText={`${pkt.voipMetrics.jbNominal} ms`} />
                          <MiniFieldRow label="JB Maximum" value={`${pkt.voipMetrics.jbMaximum} ms`} copyText={`${pkt.voipMetrics.jbMaximum} ms`} />
                          <MiniFieldRow label="Burst Density" value={`${((pkt.voipMetrics.burstDensity / 256) * 100).toFixed(1)}%`} copyText={`${((pkt.voipMetrics.burstDensity / 256) * 100).toFixed(1)}%`} />
                          <MiniFieldRow label="Gap Density" value={`${((pkt.voipMetrics.gapDensity / 256) * 100).toFixed(1)}%`} copyText={`${((pkt.voipMetrics.gapDensity / 256) * 100).toFixed(1)}%`} />
                          <MiniFieldRow label="Burst Duration" value={`${pkt.voipMetrics.burstDuration} ms`} copyText={`${pkt.voipMetrics.burstDuration} ms`} />
                          <MiniFieldRow label="Gap Duration" value={`${pkt.voipMetrics.gapDuration} ms`} copyText={`${pkt.voipMetrics.gapDuration} ms`} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {decoded?.application && decoded.application.type === "Dns" && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips.protoDns}>
              <Badge variant="outline" className="text-2xs px-1.5 py-0 bg-info/10 text-info border-info/20 cursor-help">
                DNS
              </Badge>
            </TooltipWrapper>
            <span className="text-xs text-muted-foreground">Application</span>
          </div>
          <div className="space-y-0 pl-2">
            <DetailRow
              label="Type"
              value={<Badge variant="secondary" className="text-2xs px-1.5 py-0">{(decoded.application.data as any).isResponse ? "Response" : "Query"}</Badge>}
              copyText={(decoded.application.data as any).isResponse ? "Response" : "Query"}
              tooltip={tooltips.fieldDnsType}
              valueClassName=""
            />
            <DetailRow
              label="Transaction ID"
              value={`0x${typeof (decoded.application.data as any).transactionId === "number" ? (decoded.application.data as any).transactionId.toString(16).toUpperCase().padStart(4, "0") : "N/A"}`}
              tooltip={tooltips.fieldDnsTransactionId}
            />
            <DetailRow
              label="Response Code"
              value={typeof (decoded.application.data as any).responseCode === "number" ? (decoded.application.data as any).responseCode : "N/A"}
              tooltip={tooltips.fieldDnsResponseCode}
            />
            {(decoded.application.data as any).queries && Array.isArray((decoded.application.data as any).queries) && (decoded.application.data as any).queries.length > 0 && (
              <div className="py-1">
                <div className="text-xs font-semibold mb-1 text-muted-foreground">Queries ({(decoded.application.data as any).queries.length})</div>
                <div className="space-y-1">
                  {(decoded.application.data as any).queries.map((query: any, idx: number) => (
                    <div key={idx} className="rounded bg-muted/30 px-2 py-1">
                      <MiniFieldRow label="Name" value={query.name || "N/A"} copyText={String(query.name || "N/A")} />
                      <MiniFieldRow
                        label="Type"
                        value={query.qtype ? getDnsRecordTypeName(query.qtype) : "N/A"}
                        copyText={query.qtype ? getDnsRecordTypeName(query.qtype) : "N/A"}
                      />
                      <MiniFieldRow label="Class" value={query.qclass || "N/A"} copyText={String(query.qclass || "N/A")} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(decoded.application.data as any).answers && Array.isArray((decoded.application.data as any).answers) && (decoded.application.data as any).answers.length > 0 && (
              <div className="py-1">
                <div className="text-xs font-semibold mb-1 text-muted-foreground">Answers ({(decoded.application.data as any).answers.length})</div>
                <div className="space-y-1">
                  {(decoded.application.data as any).answers.map((answer: any, idx: number) => (
                    <div key={idx} className="rounded bg-muted/30 px-2 py-1">
                      <MiniFieldRow label="Name" value={answer.name || "N/A"} copyText={String(answer.name || "N/A")} />
                      <MiniFieldRow label="Data" value={answer.data || "N/A"} copyText={String(answer.data || "N/A")} />
                      <MiniFieldRow label="TTL" value={answer.ttl ? `${answer.ttl}s` : "N/A"} copyText={answer.ttl ? `${answer.ttl}s` : "N/A"} />
                      <MiniFieldRow
                        label="Type"
                        value={answer.rtype ? getDnsRecordTypeName(answer.rtype) : "N/A"}
                        copyText={answer.rtype ? getDnsRecordTypeName(answer.rtype) : "N/A"}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {decoded?.application && decoded.application.type === "T38" && (
        <div className="space-y-2 px-2.5 py-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <TooltipWrapper entry={tooltips.protoT38}>
              <Badge variant="outline" className="text-2xs px-1.5 py-0 bg-warning/10 text-warning border-warning/20 cursor-help">
                T.38 / FAX
              </Badge>
            </TooltipWrapper>
            <span className="text-xs text-muted-foreground">Application (UDPTL)</span>
          </div>
          <div className="space-y-0 pl-2">
            <DetailRow label="UDPTL type" value={`${decoded.application.data.udptlType ?? 0} (0 = primary only)`} tooltip={tooltips.fieldT38UdptlType} />
            <DetailRow label="Sequence" value={decoded.application.data.seq ?? 0} tooltip={tooltips.fieldT38Sequence} />
            <DetailRow label="Primary length" value={`${decoded.application.data.primaryLen ?? 0} bytes`} tooltip={tooltips.fieldT38PrimaryLen} />
            {decoded.application.data.ifpType && (
              <DetailRow label="IFP type" value={decoded.application.data.ifpType} tooltip={tooltips.fieldT38IfpType} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function RawDataTab({
  packet,
  sessionId,
  packetIndex,
}: {
  packet: PacketInfo;
  sessionId?: string | null;
  packetIndex?: number | null;
}) {
  const { copied, markCopied } = useCopyFeedback();
  const [viewMode, setViewMode] = useState<"hex" | "text">("hex");
  const [fetchedRawBytes, setFetchedRawBytes] = useState<number[] | null>(null);
  const [isFetchingRawBytes, setIsFetchingRawBytes] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Get all raw packet bytes: rawPayload (RTP/DNS from backend), SIP rawMessage, or Unknown data
  const getAllRawBytes = (): number[] => {
    if (packet.rawPayload && Array.isArray(packet.rawPayload) && packet.rawPayload.length > 0) {
      return packet.rawPayload;
    }
    if (packet.decoded?.application) {
      const app = packet.decoded.application;
      if (app.type === "Sip" && app.data.rawMessage) {
        return Array.from(new TextEncoder().encode(app.data.rawMessage));
      }
      if (app.type === "T38") {
        return packet.rawPayload && Array.isArray(packet.rawPayload) ? packet.rawPayload : [];
      }
      if (app.type === "Unknown" && app.data && Array.isArray(app.data)) {
        return app.data;
      }
    }
    return [];
  };

  const formatHexDump = (bytes: number[], offset: number = 0): string => {
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const hex = chunk
        .map((b, idx) => {
          const hexStr = b.toString(16).padStart(2, '0').toUpperCase();
          // Add spacing every 8 bytes for better readability
          return (idx > 0 && idx % 8 === 0) ? `  ${hexStr}` : ` ${hexStr}`;
        })
        .join('')
        .trim();
      
      const ascii = chunk
        .map(b => {
          if (b >= 32 && b < 127) {
            return String.fromCharCode(b);
          } else if (b === 0) {
            return '·';
          } else {
            return '.';
          }
        })
        .join('');
      
      const address = (offset + i).toString(16).padStart(8, '0').toUpperCase();
      const hexPadded = hex.padEnd(47, ' ');
      lines.push(`${address}  ${hexPadded}  |${ascii}|`);
    }
    return lines.join('\n');
  };

  const formatTextDump = (bytes: number[]): string => {
    if (!bytes.length) return "";

    // First pass: UTF-8 decode (lossy) for protocols that carry text.
    const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    const printableUtf8 = utf8Text
      .split("")
      .filter((c) => (c >= " " && c <= "~") || c === "\n" || c === "\r" || c === "\t").length;
    const utf8Ratio = printableUtf8 / utf8Text.length;

    if (utf8Text.length > 0 && utf8Ratio > 0.7) {
      return utf8Text;
    }

    // Binary-safe fallback for "Text" mode: show 1:1 byte-to-char projection and
    // replace non-printables with "." instead of switching back to hex dump.
    // This keeps Text view stable and readable for RTP/UDPTL/compressed payloads.
    const chars = bytes.map((b) => {
      if (b === 10 || b === 13 || b === 9) return String.fromCharCode(b); // \n \r \t
      if (b >= 32 && b <= 126) return String.fromCharCode(b);
      return ".";
    });

    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += 96) {
      lines.push(chars.slice(i, i + 96).join(""));
    }
    return lines.join("\n");
  };

  const inlineRawBytes = getAllRawBytes();
  const hasInlineData = inlineRawBytes.length > 0;
  const cacheKey =
    sessionId && typeof packetIndex === "number" ? `${sessionId}:${packetIndex}` : null;

  useEffect(() => {
    setFetchedRawBytes(null);
    setFetchError(null);

    if (hasInlineData || !cacheKey || typeof packetIndex !== "number") {
      return;
    }

    const cached = rawBytesCache.get(cacheKey);
    if (cached) {
      setFetchedRawBytes(cached);
      return;
    }

    const cachedError = rawBytesErrorCache.get(cacheKey);
    if (cachedError) {
      setFetchError(cachedError);
      return;
    }

    const sessionIdValue = sessionId;
    if (typeof sessionIdValue !== "string") return;

    let request = rawBytesInFlightCache.get(cacheKey);
    if (!request) {
      request = getPacketRawBytes(sessionIdValue, packetIndex);
      rawBytesInFlightCache.set(cacheKey, request);
    }

    let cancelled = false;
    setIsFetchingRawBytes(true);
    request
      .then((bytes) => {
        if (cancelled) return;
        upsertBoundedCache(rawBytesCache, rawBytesCacheOrder, cacheKey, bytes, RAW_BYTES_CACHE_MAX_ENTRIES);
        setFetchedRawBytes(bytes);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load raw bytes";
        upsertBoundedCache(
          rawBytesErrorCache,
          rawBytesErrorCacheOrder,
          cacheKey,
          message,
          RAW_BYTES_CACHE_MAX_ENTRIES
        );
        setFetchError(message);
      })
      .finally(() => {
        rawBytesInFlightCache.delete(cacheKey);
        if (!cancelled) {
          setIsFetchingRawBytes(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, hasInlineData, packetIndex, sessionId]);

  const rawBytes = hasInlineData ? inlineRawBytes : (fetchedRawBytes ?? []);
  const hasData = rawBytes.length > 0;

  const getDisplayData = (): string => {
    if (!hasData) {
      return "No raw packet data available";
    }

    if (viewMode === "text") {
      return formatTextDump(rawBytes);
    } else {
      return formatHexDump(rawBytes);
    }
  };

  const displayData = getDisplayData();

  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(displayData);
      markCopied();
    } catch {
      // Clipboard may be unavailable in some environments.
    }
  };

  return (
    <div className="space-y-2 h-full flex flex-col">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">View:</span>
          <div className="flex gap-1">
            <Button
              variant={viewMode === "hex" ? "default" : "neutral"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setViewMode("hex")}
            >
              Hex
            </Button>
            <Button
              variant={viewMode === "text" ? "default" : "neutral"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setViewMode("text")}
            >
              Text
            </Button>
          </div>
          {hasData && (
            <span className="text-xs text-muted-foreground ml-2">
              {rawBytes.length} bytes
            </span>
          )}
        </div>
        <Button
          variant={copied ? "positive" : "neutral"}
          size="sm"
          className="h-7 text-xs transition-smooth"
          onClick={copyRaw}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5 animate-in fade-in zoom-in duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs p-3 border border-border/20 rounded-md bg-black/[0.03]">
        {isFetchingRawBytes ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            Loading raw bytes...
          </div>
        ) : fetchError ? (
          <EmptyState
            compact
            variant="inline"
            title="Failed to load raw packet data"
            description={fetchError}
          />
        ) : hasData ? (
          viewMode === "hex" ? (
            <SyntaxHighlighter 
              language="text" 
              style={vscDarkPlus} 
              customStyle={{ 
                margin: 0, 
                fontSize: "10px",
                lineHeight: "1.5",
                maxHeight: 'none',
                background: 'transparent',
                fontFamily: 'var(--font-mono)'
              }}
              wrapLines={false}
              showLineNumbers={false}
              PreTag="pre"
            >
              {displayData}
            </SyntaxHighlighter>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-2xs leading-relaxed">
              {displayData}
            </pre>
          )
        ) : (
          <EmptyState
            compact
            variant="inline"
            title="No raw packet data available"
            description="Raw bytes are not stored for this packet"
          />
        )}
      </div>
    </div>
  );
}

export const PacketDetailsView = memo(PacketDetailsViewComponent, (prevProps, nextProps) => {
  // Only re-render if packet actually changed
  return prevProps.packet?.timestamp === nextProps.packet?.timestamp && 
         prevProps.packet === nextProps.packet;
});
