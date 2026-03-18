import { cn } from "@/lib/utils";
import { Loader2 } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { TOOLKIT_CARD_SHELL, TOOLKIT_UPPER_LABEL } from "./surfaceClasses";

interface MetricCardProps {
  label: string;
  value: string | number | null;
  unit?: string;
  icon?: React.ReactNode;
  status?: "idle" | "running" | "pass" | "warn" | "fail";
  subtitle?: string;
  className?: string;
  tooltip?: { title: string; description?: string };
}

const statusBg = {
  idle: "",
  running: "",
  pass: "bg-success/5",
  warn: "bg-warning/5",
  fail: "bg-destructive/5",
};

const statusDots = {
  pass: "bg-success",
  warn: "bg-warning",
  fail: "bg-destructive",
};

export function MetricCard({
  label,
  value,
  unit,
  icon,
  status = "idle",
  subtitle,
  className,
  tooltip,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        TOOLKIT_CARD_SHELL,
        "p-4 flex flex-col gap-1",
        statusBg[status],
        className
      )}
    >
      <div className="flex items-center justify-between">
        {tooltip ? (
          <TooltipWrapper title={tooltip.title} description={tooltip.description}>
            <span className={cn(TOOLKIT_UPPER_LABEL, "cursor-help")}>
              {label}
            </span>
          </TooltipWrapper>
        ) : (
          <span className={TOOLKIT_UPPER_LABEL}>
            {label}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          {status === "running" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {(status === "pass" || status === "warn" || status === "fail") && (
            <span className={cn("h-2.5 w-2.5 rounded-full", statusDots[status])} />
          )}
          {icon && <span className="text-muted-foreground">{icon}</span>}
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        {status === "running" ? (
          <span className="text-2xl font-bold text-muted-foreground">--</span>
        ) : value !== null && value !== undefined ? (
          <>
            <span className="text-2xl font-bold tabular-nums">{typeof value === "number" ? value.toFixed(1) : value}</span>
            {unit && <span className="text-sm text-muted-foreground font-medium">{unit}</span>}
          </>
        ) : (
          <span className="text-2xl font-bold text-muted-foreground">--</span>
        )}
      </div>
      {subtitle && (
        <span className="text-xs text-muted-foreground mt-0.5">{subtitle}</span>
      )}
    </div>
  );
}
