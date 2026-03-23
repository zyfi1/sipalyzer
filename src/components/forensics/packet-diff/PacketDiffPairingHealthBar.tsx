import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { cn } from "@/lib/utils";
import type { PacketDiffPairingHealth } from "./packetDiffEngine";

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export interface PacketDiffPairingHealthBarProps {
  health: PacketDiffPairingHealth | null;
  /** True when more rows matched filters than the table can show. */
  tableTruncated: boolean;
  maxTableRows: number;
  loading?: boolean;
}

export function PacketDiffPairingHealthBar({
  health,
  tableTruncated,
  maxTableRows,
  loading,
}: PacketDiffPairingHealthBarProps) {
  if (loading) {
    return (
      <div className="px-2.5 py-1.5 border-t border-border/20 bg-muted/[0.08] text-3xs text-muted-foreground">
        Updating pairing summary…
      </div>
    );
  }

  if (!health || health.totalRows === 0) {
    return null;
  }

  const orphanTone =
    health.orphanFraction > 0.35
      ? "text-destructive"
      : health.orphanFraction > 0.15
        ? "text-warning"
        : "text-muted-foreground";

  return (
    <TooltipWrapper entry={tooltips.packetDiffPairingHealth}>
      <div className="px-2.5 py-1.5 border-t border-border/20 bg-muted/[0.08] flex flex-wrap items-center gap-x-2 gap-y-1 text-3xs leading-snug">
        <span className="font-medium text-foreground">Pairing sanity check</span>
        <span className="text-muted-foreground hidden sm:inline">—</span>
        <span className="text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{health.totalRows.toLocaleString()}</span> rows
          lined up
        </span>
        <span className="text-muted-foreground hidden sm:inline">·</span>
        <span className="text-muted-foreground">
          <span className="text-foreground font-medium tabular-nums">{pct(health.pairedFraction)}</span> have a packet
          on both captures
        </span>
        <span className={cn("tabular-nums", orphanTone)}>
          · <span className="text-foreground font-medium">{pct(health.orphanFraction)}</span> unmatched (
          {health.leftOnly.toLocaleString()} only A, {health.rightOnly.toLocaleString()} only B)
        </span>
        <span className="text-muted-foreground hidden lg:inline">
          · Of pairs:{" "}
          <span className="text-foreground font-medium tabular-nums">{pct(health.exactAmongPairedFraction)}</span> same
          decode,{" "}
          <span className="text-foreground font-medium tabular-nums">{pct(health.changedAmongPairedFraction)}</span>{" "}
          different
        </span>
        {tableTruncated ? (
          <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal text-warning border-warning/30">
            Showing first {maxTableRows.toLocaleString()} rows only
          </Badge>
        ) : null}
      </div>
    </TooltipWrapper>
  );
}
