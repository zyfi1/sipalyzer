import { Desktop, Satellite } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

/**
 * `data-slot` hooks for **result-source badges** (local vs remote test execution).
 * Use in tests, DevTools, or design-system audits — not a generic `Badge` variant.
 */
export const RESULT_SOURCE_BADGE_SLOT = {
  badge: "result-source-badge",
  agentLabel: "result-source-badge-agent",
} as const;

/** Shared outlined chip shell (square corners with app radius — not pill). */
const resultSourceBadgeShell =
  "inline-flex items-center justify-center gap-1 h-5 min-h-5 px-2 text-2xs font-semibold leading-none rounded-[var(--radius-md)] border shadow-none [&>svg]:size-3 [&>svg]:shrink-0";

interface ResultSourceBadgeProps {
  source: "local" | "remote";
  agentName?: string;
  className?: string;
}

/**
 * **Result-source badges** — shows whether the last network/test surface ran on this
 * machine (**local**) or via a **remote** agent. Each chip is an outlined badge aligned
 * with `ui-control-shell` / header controls (`rounded-[var(--radius-md)]`), not `Badge` pills.
 */
export function ResultSourceBadge({ source, agentName, className }: ResultSourceBadgeProps) {
  const detail = source === "remote" ? agentName : undefined;

  if (source === "local") {
    return (
      <div className={cn("inline-flex items-center", className)}>
        <TooltipWrapper entry={tooltips.netSourceLocal}>
          <span
            role="status"
            data-slot={RESULT_SOURCE_BADGE_SLOT.badge}
            data-result-source="local"
            className={cn(
              resultSourceBadgeShell,
              "border-border/55 bg-muted/[0.06] text-muted-foreground",
            )}
          >
            <Desktop className="h-3 w-3" aria-hidden />
            <span>Local</span>
          </span>
        </TooltipWrapper>
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <TooltipWrapper entry={tooltips.netSourceAgent(detail ?? "Unknown")}>
        <span
          role="status"
          data-slot={RESULT_SOURCE_BADGE_SLOT.badge}
          data-result-source="remote"
          className={cn(
            resultSourceBadgeShell,
            "border-primary/45 bg-primary/[0.08] text-primary",
          )}
        >
          <Satellite className="h-3 w-3" aria-hidden />
          <span>Remote</span>
        </span>
      </TooltipWrapper>
      {detail ? (
        <span
          data-slot={RESULT_SOURCE_BADGE_SLOT.agentLabel}
          className={cn(
            resultSourceBadgeShell,
            "max-w-[220px] truncate border-border/50 bg-transparent font-mono font-medium text-muted-foreground/85",
          )}
          title={detail}
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}
