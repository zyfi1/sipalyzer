/**
 * RTP stream list — data-dense rows matching WarperPacketList aesthetic.
 * Fixed-height rows, mono font, quality-tinted backgrounds, compact header.
 */

import { useEffect, useRef } from "react";
import { ArrowRight, XCircle, AlertTriangle } from "@/lib/icons";
import { IpAddress } from "@/components/ui/IpAddress";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { RtpStreamInfo, ExpertFinding } from "@/types/packetCapture";
import { cn } from "@/lib/utils";

function mosQuality(mos: number): "good" | "fair" | "poor" {
  if (mos >= 4) return "good";
  if (mos >= 3) return "fair";
  return "poor";
}

/** Row tinting based on quality (like Wireshark protocol tinting). */
const QUALITY_ROW_BG: Record<string, string> = {
  good: "bg-success/[0.04]",
  fair: "bg-warning/[0.06]",
  poor: "bg-destructive/[0.06]",
};

const QUALITY_BADGE: Record<string, string> = {
  good: "bg-success/20 text-success border-success/30",
  fair: "bg-warning/20 text-warning border-warning/30",
  poor: "bg-destructive/20 text-destructive border-destructive/30",
};

export interface RtpStreamTableProps {
  streams: RtpStreamInfo[];
  selectedStream: RtpStreamInfo | null;
  onSelectStream: (stream: RtpStreamInfo, index: number) => void;
  findingsByStream?: Map<string, ExpertFinding[]>;
}

export function RtpStreamTable({
  streams,
  selectedStream,
  onSelectStream,
  findingsByStream,
}: RtpStreamTableProps) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!selectedStream) return;
    const selected = streams.find((stream) => stream.ssrc === selectedStream.ssrc);
    if (!selected) return;
    const key = `${selected.ssrc}-${selected.firstPacketTime}`;
    const row = rowRefs.current.get(key);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedStream, streams]);

  if (streams.length === 0) {
    return (
      <div className="surface px-4 py-6 text-center">
        <p className="text-sm font-medium text-foreground">RTP streams</p>
        <p className="text-xs text-muted-foreground mt-2">Select a capture and a call to see streams for that call.</p>
      </div>
    );
  }

  return (
    <div className="surface overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center h-8 section-label-sm border-b border-border select-none bg-background"
        style={{ paddingLeft: 8, paddingRight: 8 }}
      >
        <span className="w-6 shrink-0" />
        <span className="w-16 shrink-0 pl-1">Quality</span>
        <span className="w-14 shrink-0 text-right">MOS</span>
        <span className="w-14 shrink-0 text-right">Loss</span>
        <span className="w-14 shrink-0 text-right">Jitter</span>
        <span className="w-14 shrink-0 pl-2">Codec</span>
        <span className="flex-1 min-w-0 pl-3">Source → Dest</span>
        <span className="w-14 shrink-0 text-right">Pkts</span>
      </div>

      {/* Rows */}
      <div>
        {streams.map((stream, index) => {
          const isSelected = selectedStream?.ssrc === stream.ssrc;
          const quality = mosQuality(stream.mosScore);
          const qualityLabel = quality === "good" ? "GOOD" : quality === "fair" ? "FAIR" : "POOR";
          const rowBg = QUALITY_ROW_BG[quality] ?? "";
          const badgeClasses = QUALITY_BADGE[quality] ?? "";
          const streamKey = `${stream.srcIp}:${stream.srcPort}->${stream.dstIp}:${stream.dstPort}`;
          const streamFindings = findingsByStream?.get(streamKey) ?? findingsByStream?.get(String(stream.ssrc));

          const rowKey = `${stream.ssrc}-${stream.firstPacketTime}`;
          return (
            <div
              key={rowKey}
              ref={(el) => {
                if (el) rowRefs.current.set(rowKey, el);
                else rowRefs.current.delete(rowKey);
              }}
              onClick={() => onSelectStream(stream, index)}
              className={cn(
                "flex items-center text-xs font-mono cursor-pointer select-none",
                "border-b border-border/40 transition-smooth duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
                isSelected
                  ? "bg-accent text-accent-foreground border-l-2 border-l-primary ring-1 ring-primary/20"
                  : cn(rowBg, "hover:bg-accent/40 text-foreground"),
              )}
              style={{
                height: 36,
                paddingLeft: isSelected ? 6 : 8,
                paddingRight: 8,
              }}
              role="row"
              aria-selected={isSelected}
            >
              {/* Finding indicator */}
              <span className="w-6 shrink-0 flex items-center justify-center">
                {streamFindings && streamFindings.length > 0 && (
                  <TooltipWrapper content={streamFindings.map(f => f.title).join(", ")}>
                    {streamFindings.some(f => f.severity === "critical")
                      ? <XCircle className="h-3 w-3 text-destructive" />
                      : <AlertTriangle className="h-3 w-3 text-warning" />
                    }
                  </TooltipWrapper>
                )}
              </span>

              {/* Quality badge */}
              <span className="w-16 shrink-0">
                <span className={cn(
                  "inline-block px-1.5 py-0.5 rounded text-2xs font-bold leading-none border tracking-wide",
                  badgeClasses,
                )}>
                  {qualityLabel}
                </span>
              </span>

              {/* MOS */}
              <span className={cn(
                "w-14 shrink-0 text-right font-semibold tabular-nums",
                quality === "good" ? "text-success" : quality === "fair" ? "text-warning" : "text-destructive",
              )}>
                {stream.mosScore.toFixed(2)}
              </span>

              {/* Loss */}
              <span className={cn(
                "w-14 shrink-0 text-right tabular-nums",
                stream.lossPercentage > 5 ? "text-destructive" : stream.lossPercentage > 1 ? "text-warning" : "text-muted-foreground",
              )}>
                {stream.lossPercentage.toFixed(1)}%
              </span>

              {/* Jitter */}
              <span className={cn(
                "w-14 shrink-0 text-right tabular-nums",
                stream.jitter > 30 ? "text-destructive" : stream.jitter > 10 ? "text-warning" : "text-muted-foreground",
              )}>
                {stream.jitter.toFixed(0)}ms
              </span>

              {/* Codec */}
              {stream.codecName.startsWith("PT") ? (
                <TooltipWrapper title={`Payload Type ${stream.payloadType}`} description="Dynamic payload type — no SDP rtpmap found in capture to resolve codec name.">
                  <span className="w-14 shrink-0 pl-2 font-semibold text-muted-foreground italic cursor-help">
                    {stream.codecName}
                  </span>
                </TooltipWrapper>
              ) : (
                <span className="w-14 shrink-0 pl-2 text-foreground font-semibold">
                  {stream.codecName}
                </span>
              )}

              {/* Source → Dest */}
              <span className="flex-1 min-w-0 pl-3 flex items-center gap-1 text-muted-foreground truncate">
                <IpAddress ip={`${stream.srcIp}:${stream.srcPort}`} size="sm" variant="mono" showCopyOnHover={false} />
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <IpAddress ip={`${stream.dstIp}:${stream.dstPort}`} size="sm" variant="mono" showCopyOnHover={false} />
              </span>

              {/* Packets */}
              <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                {stream.packetCount.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
