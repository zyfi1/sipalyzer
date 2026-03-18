import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Power, Loader2, Check } from "@/lib/icons";
import { networkDevicesWakeOnLan } from "@/api/networkDevices";
import { cn } from "@/lib/utils";

type WolState = "idle" | "sending" | "sent" | "error";

export function WolButton({ mac, className }: { mac: string; className?: string }) {
  const [state, setState] = useState<WolState>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setState("sending");
    setError(null);
    try {
      await networkDevicesWakeOnLan(mac);
      setState("sent");
      setTimeout(() => setState("idle"), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <TooltipWrapper
        title="Wake-on-LAN"
        description={`Send a magic packet to wake ${mac}. The device must support WoL and be connected via Ethernet.`}
      >
        <Button
          variant={state === "error" ? "destructive" : state === "sent" ? "positive" : "neutral"}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleClick}
          disabled={state === "sending"}
        >
          {state === "sending" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : state === "sent" ? (
            <Check className="h-3 w-3" />
          ) : (
            <Power className="h-3 w-3" />
          )}
          {state === "sent" ? "Packet Sent" : state === "sending" ? "Sending…" : "Wake Device"}
        </Button>
      </TooltipWrapper>
      {state === "error" && error && (
        <span className="text-2xs text-destructive truncate max-w-[200px]">{error}</span>
      )}
    </div>
  );
}
