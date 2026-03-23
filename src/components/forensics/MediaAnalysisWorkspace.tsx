import { useEffect, useMemo, useState } from "react";
import type { ExpertFinding, RtpStreamInfo } from "@/types/packetCapture";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle, Radio } from "@/lib/icons";
import { VOIP_QUALITY_THRESHOLDS } from "@/lib/voipQualityThresholds";
import { RtpStreamDetailView } from "./RtpStreamDetailView";
import { CombinedStreamPlayer } from "./CombinedStreamPlayer";
import { getRtpStreamKey } from "./media/model/types";
import type { MediaHealth, MediaSummary } from "./media/model/types";

interface MediaAnalysisWorkspaceProps {
  sessionId: string | null;
  prioritizedStreams: RtpStreamInfo[];
  mediaSummary: MediaSummary;
  mediaHealth: MediaHealth;
  findingsByStream: Map<string, ExpertFinding[]>;
  selectedStream: RtpStreamInfo | null;
  onSelectStream: (stream: RtpStreamInfo, index: number) => void;
  onClearSelection: () => void;
  consolidatedStreams: RtpStreamInfo[];
  expertFindings: ExpertFinding[];
}

function streamLabel(stream: RtpStreamInfo): string {
  return `${stream.srcIp}:${stream.srcPort} -> ${stream.dstIp}:${stream.dstPort}`;
}

function streamIsDegraded(stream: RtpStreamInfo): boolean {
  return (
    stream.lossPercentage >= VOIP_QUALITY_THRESHOLDS.lossPct.warning ||
    stream.mosScore < VOIP_QUALITY_THRESHOLDS.mos.warning ||
    stream.jitter >= VOIP_QUALITY_THRESHOLDS.jitterMs.warning
  );
}

export function MediaAnalysisWorkspace({
  sessionId,
  prioritizedStreams,
  mediaSummary,
  mediaHealth,
  findingsByStream,
  selectedStream,
  onSelectStream,
  onClearSelection,
  consolidatedStreams,
  expertFindings,
}: MediaAnalysisWorkspaceProps) {
  const [compareStreamId, setCompareStreamId] = useState<string | null>(null);
  const streamById = useMemo(
    () => new Map(prioritizedStreams.map((stream) => [getRtpStreamKey(stream), stream])),
    [prioritizedStreams],
  );
  const selectedStreamKey = selectedStream ? getRtpStreamKey(selectedStream) : null;
  const resolvedSelectedStream = selectedStreamKey ? (streamById.get(selectedStreamKey) ?? null) : null;
  const focusStream = resolvedSelectedStream ?? prioritizedStreams[0] ?? null;
  const focusStreamId = focusStream ? getRtpStreamKey(focusStream) : null;
  const compareStream = compareStreamId ? (streamById.get(compareStreamId) ?? null) : null;
  const canCompare = !!focusStream && !!compareStream && focusStreamId !== compareStreamId;
  const hasBaselinePair = consolidatedStreams.length === 2 && !!consolidatedStreams[0] && !!consolidatedStreams[1];
  const qualityStatement = `MOS ${mediaSummary.avgMos?.toFixed(2) ?? "—"} · Loss ${
    mediaSummary.avgLoss != null ? `${mediaSummary.avgLoss.toFixed(2)}%` : "—"
  } · Jitter ${mediaSummary.avgJitter != null ? `${mediaSummary.avgJitter.toFixed(1)}ms` : "—"}`;

  useEffect(() => {
    if (!compareStreamId) return;
    if (!streamById.has(compareStreamId)) setCompareStreamId(null);
  }, [compareStreamId, streamById]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-2 gap-2 bg-[radial-gradient(140%_120%_at_0%_0%,hsl(var(--accent)/0.12),transparent_40%),radial-gradient(120%_100%_at_100%_0%,hsl(var(--primary)/0.10),transparent_35%)]">
      <div className="shrink-0 rounded-xl border border-border/30 bg-[hsl(var(--card)/0.9)] shadow-elevated backdrop-blur px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Media Investigation</p>
          <span className="text-2xs text-muted-foreground">{qualityStatement}</span>
          <Badge variant="secondary" className={cn("ml-auto h-5 px-2 text-3xs", mediaHealth.tone)}>
            {mediaHealth.label}
          </Badge>
          <Badge variant="secondary" className="h-5 px-2 text-3xs">{prioritizedStreams.length} Streams</Badge>
          <Badge variant="secondary" className="h-5 px-2 text-3xs">{mediaSummary.degradedStreams} Degraded</Badge>
          <Button variant="neutral" size="sm" className="h-7 px-2.5 text-2xs" onClick={onClearSelection}>
            Reset
          </Button>
        </div>
      </div>

      {prioritizedStreams.length === 0 ? (
        <div className="flex-1 min-h-0 ui-surface-card overflow-hidden flex flex-col">
          <div className="ui-section-header-sm flex items-center gap-1.5">
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Media Streams</p>
          </div>
          <EmptyState
            variant="inline"
            icon={<Radio />}
            title="No streams found for this call"
            description="No RTP streams were associated with the selected call."
            className="h-full px-6 py-10"
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden grid gap-2 xl:grid-cols-[minmax(300px,0.82fr)_minmax(780px,1.9fr)]">
          <div className="min-h-0 overflow-hidden ui-surface-card flex flex-col">
            <div className="ui-section-header-sm shrink-0 flex items-center gap-1.5">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Incident Queue</p>
              <Badge variant="secondary" className="ml-auto h-5 px-2 text-3xs">{prioritizedStreams.length}</Badge>
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-1.5 py-1.5 space-y-1">
              {prioritizedStreams.map((stream, index) => {
                const streamKey = getRtpStreamKey(stream);
                const issues = findingsByStream.get(streamKey)?.length ?? 0;
                const isFocus = focusStreamId === streamKey;
                const degraded = streamIsDegraded(stream);
                return (
                  <button
                    key={streamKey}
                    type="button"
                    onClick={() => onSelectStream(stream, index)}
                    className={cn(
                      "w-full rounded-lg border px-2.5 py-2 text-left transition-smooth",
                      "bg-[hsl(var(--background)/0.36)] border-border/25 hover:bg-accent/15 hover:border-border/35",
                      isFocus && "bg-accent/20 border-primary/35 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.24)]",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {degraded ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                      ) : (
                        <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
                      )}
                      <span className="text-2xs font-medium truncate">{streamLabel(stream)}</span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "ml-auto h-4 px-1.5 text-3xs",
                          degraded ? "border-warning/35 text-warning" : "border-success/35 text-success",
                        )}
                      >
                        {degraded ? "Needs Attention" : "Healthy"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-3xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                      <span>MOS {stream.mosScore.toFixed(2)}</span>
                      <span>Loss {stream.lossPercentage.toFixed(2)}%</span>
                      <span>Jitter {stream.jitter.toFixed(1)}ms</span>
                      {issues > 0 ? <span className="text-warning">{issues} issues</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="shrink-0 border-t border-border/20 px-2.5 py-2 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Compare</p>
                {prioritizedStreams
                  .filter((stream) => getRtpStreamKey(stream) !== focusStreamId)
                  .slice(0, 4)
                  .map((stream) => {
                    const id = getRtpStreamKey(stream);
                    return (
                      <Button
                        key={`cmp-${id}`}
                        variant={compareStreamId === id ? "neutral" : "ghost"}
                        size="sm"
                        className="h-6 text-3xs px-2"
                        onClick={() => setCompareStreamId(id)}
                      >
                        {stream.srcIp}
                      </Button>
                    );
                  })}
              </div>
              {sessionId && ((canCompare && focusStream && compareStream) || (!canCompare && hasBaselinePair)) ? (
                <div className="rounded-lg border border-border/20 bg-[hsl(var(--background)/0.32)] p-1.5">
                  <CombinedStreamPlayer
                    sessionId={sessionId}
                    leftStream={canCompare && focusStream ? focusStream : consolidatedStreams[0]!}
                    rightStream={canCompare && compareStream ? compareStream : consolidatedStreams[1]!}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 overflow-hidden ui-surface-card flex flex-col">
            <div className="ui-section-header-sm shrink-0 flex items-center gap-1.5">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Stream Details</p>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {focusStream && sessionId ? (
                <RtpStreamDetailView stream={focusStream} sessionId={sessionId} expertFindings={expertFindings} />
              ) : (
                <EmptyState
                  variant="inline"
                  icon={<Radio />}
                  title="Select a stream to inspect"
                  description="Choose one stream from the incident queue."
                  className="h-full px-6 py-10"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
