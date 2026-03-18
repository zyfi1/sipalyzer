import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Activity,
  RefreshCw,
  XCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  X,
} from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveIndicator } from "@/components/ui/live-indicator";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { FindingCard } from "./FindingCard";
import type { ExpertFinding } from "@/types/packetCapture";

interface FindingsPanelProps {
  findings: ExpertFinding[];
  loading?: boolean;
  livePollingActive?: boolean;
  onRefresh?: () => void;
  onSelectPacket?: (packetIndex: number) => void;
  onInvestigateFinding?: (finding: ExpertFinding) => void;
  analysisMetadata?: {
    packetCount: number;
    dialogCount: number;
    streamCount: number;
    lastAnalyzed: string;
  };
  filterByCallId?: string | null;
}

type Category = ExpertFinding["category"];

const SEVERITY_CONFIG = {
  critical: { icon: XCircle, label: "Critical", color: "text-destructive", defaultOpen: true },
  warning: { icon: AlertTriangle, label: "Warning", color: "text-warning", defaultOpen: true },
  info: { icon: Info, label: "Info", color: "text-muted-foreground", defaultOpen: false },
} as const;

const CATEGORY_LABELS: Record<Category, string> = {
  signaling: "Signaling",
  media: "Media",
  network: "Network",
  security: "Security",
  performance: "Performance",
  fax: "Fax",
};

export function FindingsPanel({
  findings,
  loading = false,
  livePollingActive = false,
  onRefresh,
  onSelectPacket,
  onInvestigateFinding,
  analysisMetadata,
  filterByCallId,
}: FindingsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [showAllCallIds, setShowAllCallIds] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    info: true,
  });

  const callIdFiltered = useMemo(() => {
    if (!filterByCallId || showAllCallIds) return findings;
    return findings.filter((f) => f.relatedCallId === filterByCallId);
  }, [findings, filterByCallId, showAllCallIds]);

  const categoryFiltered = useMemo(() => {
    if (activeCategory === "all") return callIdFiltered;
    return callIdFiltered.filter((f) => f.category === activeCategory);
  }, [callIdFiltered, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<Category, number>> = {};
    for (const f of callIdFiltered) {
      counts[f.category] = (counts[f.category] ?? 0) + 1;
    }
    return counts;
  }, [callIdFiltered]);

  const grouped = useMemo(() => {
    const groups: Record<string, ExpertFinding[]> = { critical: [], warning: [], info: [] };
    for (const f of categoryFiltered) groups[f.severity]?.push(f);
    return groups;
  }, [categoryFiltered]);

  const toggleSection = (severity: string) => {
    setCollapsedSections((prev) => ({ ...prev, [severity]: !prev[severity] }));
  };

  if (loading && findings.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <EmptyState
        compact
        variant="inline"
        icon={<CheckCircle2 />}
        title="No issues detected"
        description="Capture looks clean"
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="ui-section-header-sm flex items-center gap-2 shrink-0">
        <Activity className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium">Diagnostics</span>
        {livePollingActive && <LiveIndicator variant="badge" size="xs" />}
        <div className="flex-1" />
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        )}
      </div>

      {/* Category filter chips */}
      <div className="ui-section-header-sm flex items-center gap-1 py-1.5 shrink-0 overflow-x-auto">
        <Button
          variant={activeCategory === "all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveCategory("all")}
        >
          All
        </Button>
        {(Object.entries(categoryCounts) as [Category, number][]).map(([cat, count]) => (
          <Button
            key={cat}
            variant={activeCategory === cat ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveCategory(cat)}
          >
            {CATEGORY_LABELS[cat]}
            <Badge variant="outline" className="text-3xs ml-1 px-1 py-0 h-3.5 min-w-[14px]">
              {count}
            </Badge>
          </Button>
        ))}
      </div>

      {/* Call-ID filter bar */}
      {filterByCallId && !showAllCallIds && (
        <div className="flex items-center gap-2 border-b border-border/35 bg-primary/[0.08] px-3 py-1 shrink-0">
          <Info className="h-3 w-3 text-primary shrink-0" />
          <span className="text-2xs text-muted-foreground truncate">
            Filtered to Call-ID: <span className="font-mono">{filterByCallId.slice(0, 24)}...</span>
          </span>
          <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => setShowAllCallIds(true)}>
            Show All
          </Button>
        </div>
      )}
      {filterByCallId && showAllCallIds && (
        <div className="flex items-center gap-2 border-b border-border/35 bg-card/60 px-3 py-1 shrink-0">
          <span className="text-2xs text-muted-foreground">Showing all findings</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => setShowAllCallIds(false)}
          >
            <X className="h-3 w-3 mr-0.5" />
            Filter by dialog
          </Button>
        </div>
      )}

      {/* Severity sections */}
      <div className="flex-1 overflow-auto space-y-3 bg-card/50 p-2.5">
        {(["critical", "warning", "info"] as const).map((severity) => {
          const items = grouped[severity] ?? [];
          if (items.length === 0) return null;
          const config = SEVERITY_CONFIG[severity];
          const SevIcon = config.icon;
          const isCollapsed = collapsedSections[severity] ?? !config.defaultOpen;

          return (
            <div key={severity}>
              <button
                type="button"
                onClick={() => toggleSection(severity)}
                className="flex items-center gap-1.5 w-full text-left px-1 py-0.5 rounded hover:bg-accent/30 transition-smooth"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                )}
                <SevIcon className={cn("h-3.5 w-3.5", config.color)} />
                <span className={cn("text-xs font-medium", config.color)}>{config.label}</span>
                <Badge variant="outline" className="text-3xs px-1 py-0 h-3.5 min-w-[14px] ml-auto">
                  {items.length}
                </Badge>
              </button>
              {!isCollapsed && (
                <div className="space-y-2 mt-1.5">
                  {items.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      onSelectPacket={onSelectPacket}
                      onInvestigateFinding={onInvestigateFinding}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {analysisMetadata && (
        <div className="border-t border-border/35 bg-muted/30 px-3 py-2 text-2xs text-muted-foreground shrink-0">
          Analyzed {analysisMetadata.packetCount.toLocaleString()} packets
          {" · "}{analysisMetadata.dialogCount} dialogs
          {" · "}{analysisMetadata.streamCount} streams
          {analysisMetadata.lastAnalyzed && (
            <> {" · "}{new Date(analysisMetadata.lastAnalyzed).toLocaleTimeString()}</>
          )}
        </div>
      )}
    </div>
  );
}
