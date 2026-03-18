import { Desktop, Satellite } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface ResultSourceBadgeProps {
  source: "local" | "remote";
  agentName?: string;
  className?: string;
}

export function ResultSourceBadge({
  source,
  agentName,
  className,
}: ResultSourceBadgeProps) {
  const detail = source === "remote" ? agentName : undefined;

  if (source === "local") {
    return (
      <div className={cn("inline-flex items-center", className)}>
        <TooltipWrapper entry={tooltips.netSourceLocal}>
          <Badge variant="outline" className="h-5 px-2 gap-1 text-2xs border-border/40 text-muted-foreground bg-muted/10">
            <Desktop className="h-3 w-3" />
            <span>Local</span>
          </Badge>
        </TooltipWrapper>
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <TooltipWrapper entry={tooltips.netSourceAgent(detail ?? "Unknown")}>
        <Badge variant="outline" className="h-5 px-2 gap-1 text-2xs border-primary/30 text-primary bg-primary/[0.08]">
          <Satellite className="h-3 w-3" />
          <span>Remote</span>
        </Badge>
      </TooltipWrapper>
      {detail && (
        <span className="text-2xs text-muted-foreground/75 truncate max-w-[220px]">
          {detail}
        </span>
      )}
    </div>
  );
}
