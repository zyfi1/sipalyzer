import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { XCircle, AlertTriangle, Info } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExpertFinding } from "@/types/packetCapture";

interface ExpertSummaryBarProps {
  findings: ExpertFinding[];
  onViewAll?: () => void;
}

export function ExpertSummaryBar({ findings, onViewAll }: ExpertSummaryBarProps) {
  const criticalCount = useMemo(() => findings.filter((f) => f.severity === "critical").length, [findings]);
  const warningCount = useMemo(() => findings.filter((f) => f.severity === "warning").length, [findings]);
  const hasCritical = criticalCount > 0;

  if (findings.length === 0) return null;

  const SevIcon = hasCritical ? XCircle : warningCount > 0 ? AlertTriangle : Info;

  return (
    <div
      className={cn(
        "mx-2 my-1 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs",
        hasCritical
          ? "border-destructive/35 bg-destructive/[0.05]"
          : warningCount > 0
            ? "border-warning/35 bg-warning/[0.05]"
            : "border-border/45 bg-muted/20",
      )}
    >
      <SevIcon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          hasCritical ? "text-destructive" : warningCount > 0 ? "text-warning" : "text-primary",
        )}
      />
      <span className="font-medium">{findings.length} issues detected:</span>
      <div className="flex items-center gap-1.5">
        {criticalCount > 0 && (
          <Badge variant="destructive" className="h-4 px-1.5 text-3xs">
            {criticalCount} critical
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge variant="secondary" className="h-4 border border-border/40 bg-card/60 px-1.5 text-3xs">
            {warningCount} warnings
          </Badge>
        )}
      </div>
      <div className="flex-1" />
      {onViewAll && (
        <Button
          variant="neutral"
          size="sm"
          className="px-2"
          onClick={onViewAll}
        >
          View All
        </Button>
      )}
    </div>
  );
}
