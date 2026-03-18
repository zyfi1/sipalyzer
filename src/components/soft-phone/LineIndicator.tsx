import { useSoftphoneStore } from "@/stores/softphoneStore";
import { cn } from "@/lib/utils";
import { Phone } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

export function LineIndicator() {
  const calls = useSoftphoneStore((s) => s.calls);
  const activeCallId = useSoftphoneStore((s) => s.activeCallId);
  const switchLine = useSoftphoneStore((s) => s.switchLine);

  const liveCalls = calls.filter(
    (c) => c.state === "active" || c.state === "on-hold" || c.state === "ringing" || c.state === "connecting"
  );

  if (liveCalls.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 px-2">
      {liveCalls.map((c, i) => {
        const isActive = c.id === activeCallId;
        const isHeld = c.state === "on-hold";
        const isRinging = c.state === "ringing";
        return (
          <TooltipWrapper content={`Line ${i + 1}: ${c.target} (${c.state})`}>
            <button
              key={c.id}
              type="button"
              onClick={() => switchLine(c.id)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-lg text-2xs font-medium transition-smooth",
                isActive
                  ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : isHeld
                    ? "bg-muted/30 text-muted-foreground hover:bg-accent/40"
                    : isRinging
                      ? "bg-warning/10 text-warning animate-live-breathe motion-reduce:animate-none"
                      : "rounded-md border border-border/40 bg-card/50 text-muted-foreground hover:bg-accent/40",
              )}
            >
              <Phone className="h-2.5 w-2.5" />
              <span>L{i + 1}</span>
              {isHeld && <span className="text-3xs opacity-60">held</span>}
            </button>
          </TooltipWrapper>
        );
      })}
    </div>
  );
}
