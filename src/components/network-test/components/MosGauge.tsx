import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface MosGaugeProps {
  mos: number | null;
  quality?: string;
  loading?: boolean;
  className?: string;
}

function mosColor(mos: number): string {
  if (mos >= 4.0) return "text-success";
  if (mos >= 2.5) return "text-warning";
  return "text-destructive";
}

function mosArcColor(mos: number): string {
  if (mos >= 4.0) return "stroke-success";
  if (mos >= 2.5) return "stroke-warning";
  return "stroke-destructive";
}

export function MosGauge({ mos, quality, loading, className }: MosGaugeProps) {
  const size = 160;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius; // Half circle
  const normalizedMos = mos !== null ? Math.max(1, Math.min(5, mos)) : 1;
  const progress = (normalizedMos - 1) / 4; // 0 to 1
  const dashOffset = circumference * (1 - progress);

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="relative" style={{ width: size, height: size / 2 + 20 }}>
        <svg
          width={size}
          height={size / 2 + strokeWidth}
          viewBox={`0 0 ${size} ${size / 2 + strokeWidth}`}
          className="overflow-visible"
        >
          {/* Background arc */}
          <path
            d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-muted/30"
            strokeLinecap="round"
          />
          {/* Value arc */}
          {mos !== null && !loading && (
            <path
              d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
              fill="none"
              strokeWidth={strokeWidth}
              className={mosArcColor(mos)}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{
                transition: `stroke-dashoffset var(--motion-duration-overlay) var(--motion-ease-overlay)`,
              }}
            />
          )}
        </svg>
        {/* Center value */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          {loading ? (
            <span className="text-2xl font-bold text-muted-foreground">...</span>
          ) : mos !== null ? (
            <span className={cn("text-3xl font-bold tabular-nums", mosColor(mos))}>
              {mos.toFixed(2)}
            </span>
          ) : (
            <span className="text-2xl font-bold text-muted-foreground">--</span>
          )}
        </div>
      </div>
      <div className="text-center">
        <TooltipWrapper entry={tooltips.netMosScore}>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-help">
            MOS Score
          </div>
        </TooltipWrapper>
        {quality && !loading && (
          <div className={cn("text-sm font-medium", mos !== null ? mosColor(mos) : "text-muted-foreground")}>
            {quality}
          </div>
        )}
      </div>
    </div>
  );
}
