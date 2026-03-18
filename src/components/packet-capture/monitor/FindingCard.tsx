import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { XCircle, AlertTriangle, Info, ChevronRight, ChevronDown } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import type { ExpertFinding } from "@/types/packetCapture";

interface FindingCardProps {
  finding: ExpertFinding;
  onSelectPacket?: (packetIndex: number) => void;
  onInvestigateFinding?: (finding: ExpertFinding) => void;
  compact?: boolean;
}

const SEVERITY_ICON = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const SEVERITY_ICON_COLOR = {
  critical: "text-destructive",
  warning: "text-warning",
  info: "text-primary",
} as const;

const SEVERITY_TONE = {
  critical: "border-destructive/30",
  warning: "border-warning/30",
  info: "border-border/45",
} as const;

export function FindingCard({
  finding,
  onSelectPacket,
  onInvestigateFinding,
  compact = false,
}: FindingCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  const Icon = SEVERITY_ICON[finding.severity];
  const allPacketIndices = useMemo(
    () => finding.evidence.flatMap((e) => e.packetIndices),
    [finding.evidence],
  );
  const maxChips = compact ? 3 : 5;
  const visibleIndices = allPacketIndices.slice(0, maxChips);
  const overflowCount = allPacketIndices.length - maxChips;

  return (
    <div
      className={cn(
        "rounded-md border bg-card/50 transition-smooth",
        SEVERITY_TONE[finding.severity],
        onInvestigateFinding && "cursor-pointer hover:border-border/60 hover:bg-muted/30",
        compact ? "p-2" : "p-2.5",
      )}
      onClick={() => onInvestigateFinding?.(finding)}
      onKeyDown={(e) => {
        if (!onInvestigateFinding) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInvestigateFinding(finding);
        }
      }}
      role={onInvestigateFinding ? "button" : undefined}
      tabIndex={onInvestigateFinding ? 0 : undefined}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <Icon className={cn("size-3.5 shrink-0", SEVERITY_ICON_COLOR[finding.severity])} />
        <span className="text-xs font-medium truncate">{finding.title}</span>
        {finding.count > 1 && (
          <Badge variant="outline" className="ml-auto h-4 shrink-0 border-border/40 bg-muted/25 px-1 text-3xs">
            {finding.count}
          </Badge>
        )}
      </div>

      {/* Description */}
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{finding.description}</p>

      {/* Collapsible detail */}
      {!compact && finding.detail && (
        <div className="mt-1.5 border-t border-border/30 pt-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDetailOpen((o) => !o);
            }}
            className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground/70 transition-smooth hover:text-muted-foreground"
          >
            {detailOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            Details
          </button>
          {detailOpen && (
            <pre className="mt-1 whitespace-pre-wrap pl-3.5 font-mono text-2xs text-muted-foreground/70">
              {finding.detail}
            </pre>
          )}
        </div>
      )}

      {/* Evidence chips */}
      {visibleIndices.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {visibleIndices.map((idx) => (
            <button
              key={idx}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectPacket?.(idx);
              }}
              className="cursor-pointer rounded-md border border-border/40 bg-muted/25 px-2 py-0.5 font-mono text-2xs transition-smooth hover:bg-muted/45"
            >
              #{idx}
            </button>
          ))}
          {overflowCount > 0 && (
            <span className="rounded-md border border-border/35 bg-muted/20 px-2 py-0.5 font-mono text-2xs text-muted-foreground">
              +{overflowCount} more
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      {(finding.articleId || onInvestigateFinding) && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-border/30 pt-1.5" onClick={(e) => e.stopPropagation()}>
          {onInvestigateFinding && (
            <Button
              variant="neutral"
              size="sm"
              className="px-2"
              onClick={(e) => {
                e.stopPropagation();
                onInvestigateFinding(finding);
              }}
            >
              Open Filtered Packets
            </Button>
          )}
          {finding.articleId && <TroubleshootLink articleId={finding.articleId} compact />}
        </div>
      )}
    </div>
  );
}
