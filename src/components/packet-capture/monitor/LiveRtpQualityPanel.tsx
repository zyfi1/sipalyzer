/**
 * Live RTP Quality Panel — shows real-time RTP stream quality during packet capture.
 * Polls for active RTP streams, displays quality metrics, and alerts on MOS drops.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invokeTauri } from "@/api/invoke";
import { AlertTriangle, Radio, Copy, Check, X } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useNotificationStore } from "@/stores/notificationStore";
import type { ExpertFinding, RtpStreamInfo } from "@/types/packetCapture";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { EmptyState } from "@/components/ui/empty-state";
import { findingMatchesRtpStream } from "@/lib/expertFindingUtils";

const MOS_ALERT_THRESHOLD = 3.0;
const POLL_INTERVAL_MS = 3000;

function mosQuality(mos: number): "good" | "fair" | "poor" {
  if (mos >= 4) return "good";
  if (mos >= 3) return "fair";
  return "poor";
}

const QUALITY_BADGE: Record<string, string> = {
  good: "bg-success/20 text-success border-success/30",
  fair: "bg-warning/20 text-warning border-warning/30",
  poor: "bg-destructive/20 text-destructive border-destructive/30",
};

interface LiveRtpQualityPanelProps {
  sessionId: string | null;
  isCapturing: boolean;
  focusFinding?: ExpertFinding | null;
  onClearFocus?: () => void;
}

export function LiveRtpQualityPanel({
  sessionId,
  isCapturing,
  focusFinding,
  onClearFocus,
}: LiveRtpQualityPanelProps) {
  const [streams, setStreams] = useState<RtpStreamInfo[]>([]);
  const [expandedSsrc, setExpandedSsrc] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const alertedRef = useRef<Set<number>>(new Set());

  // Poll for live RTP streams
  useEffect(() => {
    if (!sessionId || !isCapturing) {
      setStreams([]);
      return;
    }

    const poll = async () => {
      try {
        const result = await invokeTauri<RtpStreamInfo[]>("get_live_rtp_streams", { sessionId });
        setStreams(result);

        // Alert on MOS drop below threshold
        for (const stream of result) {
          if (stream.mosScore < MOS_ALERT_THRESHOLD && stream.mosScore > 0 && !alertedRef.current.has(stream.ssrc)) {
            alertedRef.current.add(stream.ssrc);
            addNotification({
              type: "warning",
              title: "RTP Quality Alert",
              description: `Stream SSRC ${stream.ssrc} MOS dropped to ${stream.mosScore.toFixed(2)} (${stream.codecName})`,
              source: "packet-capture",
              priority: "high",
            });
          }
        }
      } catch {
        // Ignore polling errors
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionId, isCapturing, addNotification]);

  const handleCopy = useCallback((stream: RtpStreamInfo) => {
    const text = `SSRC: ${stream.ssrc}\nCodec: ${stream.codecName}\n${stream.srcIp}:${stream.srcPort} → ${stream.dstIp}:${stream.dstPort}\nMOS: ${stream.mosScore.toFixed(2)}\nJitter: ${stream.jitter.toFixed(1)}ms\nLoss: ${stream.lossPercentage.toFixed(2)}%\nPackets: ${stream.packetCount}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const visibleStreams = useMemo(() => {
    if (!focusFinding) return streams;
    return streams.filter((stream) => findingMatchesRtpStream(focusFinding, stream));
  }, [focusFinding, streams]);

  useEffect(() => {
    if (!focusFinding) return;
    const first = visibleStreams[0];
    if (first) setExpandedSsrc(first.ssrc);
  }, [focusFinding, visibleStreams]);

  if (!sessionId || !isCapturing) {
    return (
      <EmptyState
        variant="inline"
        icon={<Radio />}
        title="No live RTP quality yet"
        description="Start a capture to monitor RTP MOS, jitter, and loss in real time."
        className="h-full p-6"
      />
    );
  }

  if (streams.length === 0) {
    return (
      <EmptyState
        variant="inline"
        icon={<Radio />}
        title="Monitoring RTP streams"
        description="Waiting for active RTP traffic in this capture."
        className="h-full p-6"
      />
    );
  }

  return (
    <div className="surface-flat flex-1 overflow-y-auto">
      {focusFinding && (
        <div className="surface-subtle sticky top-0 z-10 flex items-center gap-2 border-b border-border/45 px-2 py-1.5 text-2xs">
          <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
          <span className="truncate">Focused on: {focusFinding.title}</span>
          {onClearFocus && (
            <button
              type="button"
              className="ui-control-shell ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
              onClick={onClearFocus}
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      )}

      {focusFinding && visibleStreams.length === 0 && (
        <div className="border-b border-border/40 p-3">
          <EmptyState
            compact
            variant="inline"
            icon={<AlertTriangle />}
            title="No matching RTP stream yet"
            description="No active RTP stream currently matches this focused issue."
          />
        </div>
      )}

      <div className="space-y-1 p-2.5">
        {visibleStreams.map((stream) => {
          const quality = mosQuality(stream.mosScore);
          const isExpanded = expandedSsrc === stream.ssrc;
          const badgeClasses = QUALITY_BADGE[quality] ?? "";

          return (
            <div
              key={stream.ssrc}
              className={cn(
                "rounded-md border transition-smooth",
                isExpanded ? "surface-subtle border-border/55" : "surface-flat border-border/40 hover:bg-muted/30",
              )}
            >
              {/* Compact row */}
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left"
                onClick={() => setExpandedSsrc(isExpanded ? null : stream.ssrc)}
              >
                <span className="inline-flex items-center gap-1">
                  <span className={cn("px-1.5 py-0.5 rounded text-2xs font-bold border", badgeClasses)}>
                    {stream.mosScore.toFixed(1)}
                  </span>
                  {(quality === "fair" || quality === "poor") && (
                    <TroubleshootLink metric="mos" value={stream.mosScore} compact />
                  )}
                </span>
                <span className="font-mono text-muted-foreground truncate flex-1">
                  {stream.srcIp}:{stream.srcPort} → {stream.dstIp}:{stream.dstPort}
                </span>
                <span className="text-muted-foreground font-mono">{stream.codecName}</span>
                <span className="text-muted-foreground font-mono w-12 text-right">{stream.packetCount}</span>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="surface-subtle space-y-2 rounded-b-md border-t border-border/40 px-3 pb-2 pt-2">
                  <div className="grid grid-cols-3 gap-2 text-2xs">
                    <div>
                      <span className="text-muted-foreground block">Loss</span>
                      <span className={cn(
                        "font-mono font-semibold inline-flex items-center gap-1",
                        stream.lossPercentage > 5 ? "text-destructive" : stream.lossPercentage > 1 ? "text-warning" : "text-success",
                      )}>
                        {stream.lossPercentage.toFixed(2)}%
                        {stream.lossPercentage > 1 && (
                          <TroubleshootLink metric="loss" value={stream.lossPercentage} compact />
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Jitter</span>
                      <span className={cn(
                        "font-mono font-semibold inline-flex items-center gap-1",
                        stream.jitter > 30 ? "text-destructive" : stream.jitter > 10 ? "text-warning" : "text-success",
                      )}>
                        {stream.jitter.toFixed(1)} ms
                        {stream.jitter > 10 && (
                          <TroubleshootLink metric="jitter" value={stream.jitter} compact />
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">SSRC</span>
                      <span className="font-mono">{stream.ssrc}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="ui-control-shell inline-flex items-center gap-1 px-2 py-1 text-2xs text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(stream);
                      }}
                    >
                      {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                      {copied ? "Copied" : "Copy info"}
                    </button>
                    {stream.mosScore < MOS_ALERT_THRESHOLD && stream.mosScore > 0 && (
                      <span className="text-2xs text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-2.5 w-2.5" /> Below threshold
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
