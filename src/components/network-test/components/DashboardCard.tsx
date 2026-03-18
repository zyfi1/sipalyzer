import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Loader2, RefreshCw } from "@/lib/icons";
import { TOOLKIT_CARD_SHELL, TOOLKIT_ICON_SHELL, TOOLKIT_UPPER_LABEL } from "./surfaceClasses";

interface DashboardCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | null;
  subtitle?: string | null;
  status: "loading" | "success" | "warning" | "error" | "idle";
  onRefresh?: () => void;
  children?: React.ReactNode;
  className?: string;
}

const statusIndicator = {
  loading: "bg-muted-foreground animate-live-breathe motion-reduce:animate-none",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

const statusBg = {
  loading: "",
  success: "bg-success/5",
  warning: "bg-warning/5",
  error: "bg-destructive/5",
  idle: "",
};

export function DashboardCard({
  icon,
  title,
  value,
  subtitle,
  status,
  onRefresh,
  children,
  className,
}: DashboardCardProps) {
  return (
    <div
      className={cn(
        TOOLKIT_CARD_SHELL,
        "p-5 flex flex-col gap-3 relative group",
        statusBg[status],
        className
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={TOOLKIT_ICON_SHELL}>
            {icon}
          </div>
          <div>
            <div className={TOOLKIT_UPPER_LABEL}>{title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full transition-smooth", statusIndicator[status])} />
          {onRefresh && (
            <TooltipWrapper title="Refresh" description="Re-run this check to get the latest result.">
              <button
                onClick={onRefresh}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted/50"
                disabled={status === "loading"}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", status === "loading" && "animate-spin")} />
              </button>
            </TooltipWrapper>
          )}
        </div>
      </div>

      {/* Value */}
      <div>
        {status === "loading" ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Checking...</span>
          </div>
        ) : (
          <>
            <div className="text-xl font-bold tabular-nums">{value ?? "--"}</div>
            {subtitle && (
              <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
            )}
          </>
        )}
      </div>

      {/* Optional extra content */}
      {children}
    </div>
  );
}
