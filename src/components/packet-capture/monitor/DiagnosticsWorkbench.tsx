import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ExpertFinding } from "@/types/packetCapture";
import { EmptyState } from "@/components/ui/empty-state";

interface DiagnosticsWorkbenchProps {
  findings: ExpertFinding[];
  loading?: boolean;
  onRefresh?: () => void;
  onOpenPacket?: (packetIndex: number) => void;
  onOpenFinding?: (finding: ExpertFinding) => void;
  showHeader?: boolean;
}

const KPI_ORDER: string[] = [
  "INVITE setup latency",
  "INVITE auth retries",
  "REGISTER auth retries",
  "INVITE provisional depth",
  "INVITE fork branches",
];

const SEVERITY_ORDER: Record<ExpertFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
const CATEGORY_LABELS: Record<ExpertFinding["category"], string> = {
  signaling: "Signaling",
  media: "Media",
  network: "Network",
  security: "Security",
  performance: "Performance",
  fax: "Fax",
};

export function DiagnosticsWorkbench({
  findings,
  loading = false,
  onRefresh,
  onOpenPacket,
  onOpenFinding,
  showHeader = true,
}: DiagnosticsWorkbenchProps) {
  const [activeCategory, setActiveCategory] = useState<ExpertFinding["category"] | "all">("all");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  const categoryCounts = useMemo(() => {
    const counts = new Map<ExpertFinding["category"], number>();
    for (const f of findings) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
    return counts;
  }, [findings]);

  const filteredFindings = useMemo(() => {
    const rows = activeCategory === "all" ? findings : findings.filter((f) => f.category === activeCategory);
    return [...rows].sort((a, b) => {
      const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sev !== 0) return sev;
      return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
    });
  }, [findings, activeCategory]);

  const selectedFinding = useMemo(() => {
    if (!selectedFindingId) return filteredFindings[0] ?? null;
    return filteredFindings.find((f) => f.id === selectedFindingId) ?? filteredFindings[0] ?? null;
  }, [filteredFindings, selectedFindingId]);

  const selectedMetricEvidence = useMemo(() => {
    if (!selectedFinding) return [];
    const metrics = selectedFinding.evidence.filter((e) => e.evidenceType === "value");
    return [...metrics].sort((a, b) => {
      const ai = KPI_ORDER.indexOf(a.label ?? "");
      const bi = KPI_ORDER.indexOf(b.label ?? "");
      const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      if (aRank !== bRank) return aRank - bRank;
      return (a.label ?? "").localeCompare(b.label ?? "");
    });
  }, [selectedFinding]);
  const selectedPacketIndices = useMemo(() => {
    if (!selectedFinding) return [];
    return Array.from(new Set(selectedFinding.evidence.flatMap((e) => e.packetIndices))).slice(0, 8);
  }, [selectedFinding]);
  const selectedPacketCount = useMemo(() => {
    if (!selectedFinding) return 0;
    return new Set(selectedFinding.evidence.flatMap((e) => e.packetIndices)).size;
  }, [selectedFinding]);
  const selectedStreamEvidence = useMemo(() => {
    if (!selectedFinding) return null;
    const streamEvidence = selectedFinding.evidence.find(
      (e) => e.evidenceType === "rtpStream" && e.value.includes("->"),
    );
    return streamEvidence?.value ?? null;
  }, [selectedFinding]);

  return (
    <div className="packet-graphite-stage h-full min-h-0 overflow-hidden flex flex-col rounded-sm border border-border/25 bg-black/[0.05]">
      {showHeader && (
        <div className="ui-section-header-sm flex items-center gap-2">
          <span className="section-label-sm">Diagnostics</span>
          <div className="ml-auto">
            {onRefresh && (
              <Button variant="neutral" size="sm" className="h-8 text-xs" onClick={onRefresh} disabled={loading}>
                Refresh
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="ui-section-header-sm py-1.5 flex flex-wrap items-center gap-1.5">
        <Button variant={activeCategory === "all" ? "secondary" : "ghost"} size="xs" onClick={() => setActiveCategory("all")}>
          All
        </Button>
        {(Array.from(categoryCounts.entries()) as Array<[ExpertFinding["category"], number]>).map(([cat, count]) => (
          <Button
            key={cat}
            variant={activeCategory === cat ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setActiveCategory(cat)}
          >
            {CATEGORY_LABELS[cat]}
            <Badge variant="outline" className="ml-1 h-4 text-3xs">
              {count}
            </Badge>
          </Button>
        ))}
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[minmax(340px,1fr)_minmax(420px,1.2fr)]">
        <div className="border-r border-border/30 overflow-auto bg-black/[0.05]">
          {filteredFindings.map((finding) => (
            <button
              key={finding.id}
              type="button"
              onClick={() => setSelectedFindingId(finding.id)}
              className={cn(
                "w-full text-left px-3 py-2 border-b border-border/20 hover:bg-accent/30 transition-smooth",
                selectedFinding?.id === finding.id && "bg-accent/35",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", finding.severity === "critical" ? "bg-destructive" : finding.severity === "warning" ? "bg-warning" : "bg-primary")} />
                <span className="text-xs font-medium truncate">{finding.title}</span>
                <Badge variant="outline" className="ml-auto h-4 text-3xs">
                  {finding.severity}
                </Badge>
              </div>
              <div className="mt-1 text-2xs text-muted-foreground truncate">
                {finding.category} {finding.relatedCallId ? `· call ${finding.relatedCallId.slice(0, 10)}...` : ""}
              </div>
            </button>
          ))}
        </div>

        <div className="overflow-auto p-3 bg-black/[0.03]">
          {!selectedFinding ? (
            <EmptyState
              variant="inline"
              compact
              title="No findings for this filter."
              className="h-full items-start p-0 pt-0 text-left"
            />
          ) : (
            <div className="px-1 py-1 md:px-2 md:py-2">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">{selectedFinding.title}</h3>
                <Badge variant="outline" className="h-5 text-3xs">
                  {selectedFinding.severity.toUpperCase()}
                </Badge>
              </div>
              <p className="mt-1 text-2xs text-muted-foreground">
                {selectedFinding.category}
                {selectedFinding.relatedCallId ? ` · call ${selectedFinding.relatedCallId.slice(0, 10)}...` : ""}
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-foreground/90">What happened</p>
                  <p className="mt-1 text-sm leading-relaxed">{selectedFinding.explanationSummary ?? selectedFinding.description}</p>
                </div>

                <div className="border-t border-border/25 pt-4">
                  <p className="text-xs font-semibold text-foreground/90">Why it matters</p>
                  <p className="mt-1 text-sm leading-relaxed">{selectedFinding.explanationImpact ?? "Potential impact detected for this call flow window."}</p>
                </div>

                <div className="border-t border-border/25 pt-4">
                  <p className="text-xs font-semibold text-foreground/90">How we know</p>
                  <p className="mt-1 text-sm leading-relaxed">{selectedFinding.explanationWhy ?? "Deterministic rule match based on captured evidence."}</p>
                </div>

                <div className="border-t border-border/25 pt-4">
                  <p className="text-xs font-semibold text-foreground/90">What this means in practice</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {selectedStreamEvidence
                      ? `We can see this issue on stream ${selectedStreamEvidence} in the current analysis window.`
                      : "We can see this issue in the current analysis window."}{" "}
                    {selectedPacketCount > 0
                      ? `You can review packet details around ${selectedPacketIndices
                          .slice(0, 3)
                          .map((idx) => `#${idx}`)
                          .join(", ")}.`
                      : "You can review the stream and diagnostics evidence below to inspect where this behavior appears."}
                  </p>
                </div>

                <div className="border-t border-border/25 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground/90">Evidence</p>
                    <span className="text-2xs text-muted-foreground">
                      {selectedPacketCount} related packet{selectedPacketCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedPacketIndices.map((idx) => (
                      <Button key={idx} size="xs" variant="neutral" className="h-6 text-2xs" onClick={() => onOpenPacket?.(idx)}>
                        #{idx}
                      </Button>
                    ))}
                  </div>
                  {onOpenFinding && (
                    <div className="mt-2.5">
                      <Button
                        size="sm"
                        variant="neutral"
                        className="h-7 text-xs"
                        onClick={() => onOpenFinding(selectedFinding)}
                        disabled={selectedPacketCount === 0}
                      >
                        Open Related Packets
                      </Button>
                      {selectedPacketCount === 0 && (
                        <p className="mt-1 text-2xs text-muted-foreground">
                          No packet-level evidence available for this finding.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {selectedMetricEvidence.length > 0 && (
                  <div className="border-t border-border/25 pt-4">
                    <p className="text-xs font-semibold text-foreground/90 mb-2">Key signaling metrics</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {selectedMetricEvidence.map((metric) => (
                        <div key={metric.label + metric.value} className="surface-subtle rounded-md px-2.5 py-2">
                          <p className="text-3xs uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                          <p className="text-xs font-mono mt-1">{metric.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

