import type { TracerouteHop } from "@/types/networkTest";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface TracerouteTableProps {
  hops: TracerouteHop[];
  maxRtt?: number;
}

export function TracerouteTable({ hops, maxRtt: maxRttProp }: TracerouteTableProps) {
  const maxRtt = maxRttProp ?? Math.max(
    ...hops.flatMap((h) => h.rtt_ms.filter((r): r is number => r !== null)),
    1,
  );

  return (
    <div className="ui-hero-surface overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[36px_1fr_72px_1fr] items-center text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider bg-muted/10 px-3 py-2">
        <TooltipWrapper entry={tooltips.netTraceHop}>
          <span className="cursor-help">Hop</span>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.netTraceHost}>
          <span className="cursor-help">Host</span>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.netTraceAvgRtt}>
          <span className="text-right cursor-help">Avg RTT</span>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.netTraceProbes}>
          <span className="text-right pr-1 cursor-help">Probes</span>
        </TooltipWrapper>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border/20">
        {hops.map((hop) => (
          <div
            key={hop.hop}
            className="grid grid-cols-[36px_1fr_72px_1fr] items-center px-3 py-2 text-xs hover:bg-muted/10 transition-smooth"
          >
            {/* Hop number */}
            <span className="tabular-nums text-muted-foreground/60 font-medium text-2xs">
              {hop.hop}
            </span>

            {/* Host / IP */}
            <span className="font-mono text-2xs truncate pr-2 text-foreground/80">
              {hop.ip ?? (
                <span className="text-muted-foreground/60">* * *</span>
              )}
            </span>

            {/* Average RTT */}
            <span className="text-right tabular-nums">
              {hop.avg_rtt_ms !== null ? (
                <span
                  className={cn(
                    "font-medium text-2xs",
                    hop.avg_rtt_ms > 150
                      ? "text-destructive"
                      : hop.avg_rtt_ms > 50
                        ? "text-warning"
                        : "text-success",
                  )}
                >
                  {hop.avg_rtt_ms.toFixed(1)}
                  <span className="text-3xs text-muted-foreground/60 ml-0.5">ms</span>
                </span>
              ) : (
                <span className="text-muted-foreground/60">--</span>
              )}
            </span>

            {/* Latency probe bars */}
            <div className="flex items-center gap-1.5 justify-end">
              {hop.rtt_ms.map((rtt, i) => (
                <div key={i} className="flex-1 max-w-20">
                  {rtt !== null ? (
                    <div className="flex items-center gap-1">
                      <div className="flex-1 h-1 bg-muted/10 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-smooth",
                            rtt > 150
                              ? "bg-destructive/70"
                              : rtt > 50
                                ? "bg-warning/70"
                                : "bg-success/70",
                          )}
                          style={{ width: `${Math.min(100, (rtt / maxRtt) * 100)}%` }}
                        />
                      </div>
                      <span className="text-3xs tabular-nums text-muted-foreground/60 w-7 text-right">
                        {rtt.toFixed(0)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-3xs text-muted-foreground/60 text-center block">*</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
