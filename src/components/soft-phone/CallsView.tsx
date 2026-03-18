import { useState, useMemo } from "react";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { EmptyState } from "@/components/ui/empty-state";
import { Phone, PhoneOff, ArrowUp, ArrowDown, History, Trash2, Globe, Radio, Laptop } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/dateTime";
import { formatCallDuration } from "./softphone-utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface CallsViewProps {
  selectedCallId: string | null;
  setSelectedCallId: (id: string | null) => void;
  setTargetInput: (value: string) => void;
}

export function CallsView({
  selectedCallId,
  setSelectedCallId,
  setTargetInput,
}: CallsViewProps) {
  const calls = useSoftphoneStore((s) => s.calls);
  const clearCalls = useSoftphoneStore((s) => s.clearCalls);
  const removeCall = useSoftphoneStore((s) => s.removeCall);
  const registrars = useRegistrationStore((s) => s.registrars);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRemoveCallId, setConfirmRemoveCallId] = useState<string | null>(null);
  const callToRemove = calls.find((c) => c.id === confirmRemoveCallId) ?? null;

  // Build a lookup map for registrar names
  const registrarMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of registrars) {
      if (r.id) map[r.id] = r.name || r.domain || r.id;
    }
    return map;
  }, [registrars]);

  return (
    <>
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/20 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs font-medium text-muted-foreground">
            Recent Calls
            {calls.length > 0 && (
              <span className="ml-1.5 text-muted-foreground/60">({calls.length})</span>
            )}
          </span>
        </div>
        {calls.length > 0 && (
          <TooltipWrapper content="Clear all call history">
            <button
              type="button"
              className="h-6 w-6 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-smooth"
              onClick={() => setConfirmClear(true)}
              aria-label="Clear all calls"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </TooltipWrapper>
        )}
      </div>

      {/* Call list */}
      {calls.length === 0 ? (
        <EmptyState
          compact
          variant="inline"
          icon={<Phone />}
          title="No calls yet"
          description="Place or receive a call to see your history here."
          className="flex-1 p-6"
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0">
          {calls.slice(0, 100).map((c) => {
            const isSelected = selectedCallId === c.id;
            const isFailed = c.state === "failed";
            const isLive = c.state === "active" || c.state === "ringing" || c.state === "on-hold";
            const isInbound = c.isInbound === true;
            const disposition = isFailed
              ? "failed"
              : c.state === "ended" && c.transferredTo
                ? "transferred"
                : c.state === "ended"
                  ? "completed"
                  : c.state;
            const registrarLabel = c.registrarId ? registrarMap[c.registrarId] : null;

            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCallId(isSelected ? null : c.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-lg transition-all duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)] group",
                  isSelected
                    ? "bg-accent shadow-card"
                    : "hover:bg-muted/30 border border-transparent",
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Icon with direction */}
                  <div className={cn(
                    "h-9 w-9 rounded-full flex items-center justify-center shrink-0 relative",
                    isLive ? "bg-success/10 text-success"
                      : isFailed ? "bg-destructive/10 text-destructive"
                        : "bg-muted/40 text-muted-foreground"
                  )}>
                    {isLive ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-success status-online" />
                    ) : isFailed ? (
                      <PhoneOff className="h-4 w-4" />
                    ) : (
                      <Phone className="h-4 w-4" />
                    )}
                    <span className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center border-2 border-card",
                      isInbound ? "bg-primary/20 text-primary" : "bg-success/20 text-success"
                    )}>
                      {isInbound ? <ArrowDown className="h-2 w-2" /> : <ArrowUp className="h-2 w-2" />}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground truncate text-sm leading-tight">{c.target}</span>
                      {/* Execution origin badge */}
                      {c.remoteAgentId ? (
                        <span className="text-3xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold uppercase tracking-wider shrink-0 inline-flex items-center gap-0.5">
                          <Globe className="h-2 w-2" />
                          Remote
                        </span>
                      ) : (
                        <span className="text-3xs px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground/60 font-bold uppercase tracking-wider shrink-0 inline-flex items-center gap-0.5">
                          <Laptop className="h-2 w-2" />
                          Local
                        </span>
                      )}
                      {disposition === "failed" && (
                        <span className="text-3xs px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium shrink-0">Failed</span>
                      )}
                      {disposition === "transferred" && (
                        <span className="text-3xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">Transferred</span>
                      )}
                    </div>
                    {/* Agent name for remote calls */}
                    {c.remoteAgentName && (
                      <div className="text-2xs text-primary/60 mt-0.5 flex items-center gap-1 truncate">
                        <Radio className="h-2 w-2 shrink-0" />
                        <span className="truncate">via {c.remoteAgentName}</span>
                      </div>
                    )}
                    <div className="text-2xs text-muted-foreground/60 mt-0.5 flex items-center gap-1 flex-wrap">
                      {/* Direction */}
                      <span className={cn(
                        "inline-flex items-center gap-0.5 font-semibold",
                        isInbound ? "text-primary/70" : "text-success/70",
                      )}>
                        {isInbound ? <ArrowDown className="h-2 w-2" /> : <ArrowUp className="h-2 w-2" />}
                        {isInbound ? "In" : "Out"}
                      </span>
                      {/* Registrar */}
                      {registrarLabel && (
                        <>
                          <span className="opacity-30">·</span>
                          <span className="inline-flex items-center gap-0.5 text-muted-foreground/60 truncate max-w-[80px]">
                            {registrarLabel}
                          </span>
                        </>
                      )}
                      <span className="opacity-30">·</span>
                      <span>{formatTime(c.startTime)}</span>
                      {c.endTime && (
                        <>
                          <span className="opacity-30">·</span>
                          <span>{formatCallDuration(c.startTime, c.endTime)}</span>
                        </>
                      )}
                      {c.negotiatedCodec && (
                        <>
                          <span className="opacity-30">·</span>
                          <span className="font-mono">{c.negotiatedCodec}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions (visible on hover) */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
                    <TooltipWrapper content="Redial">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setTargetInput(c.target); }}
                        className="h-7 w-7 rounded-full bg-success/10 hover:bg-success/20 flex items-center justify-center transition-smooth"
                      >
                        <Phone className="h-3 w-3 text-success" />
                      </button>
                    </TooltipWrapper>
                    {!isLive && (
                      <TooltipWrapper content="Remove from history">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmRemoveCallId(c.id);
                          }}
                          className="h-7 w-7 rounded-full hover:bg-destructive/15 flex items-center justify-center transition-smooth"
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground/60 hover:text-destructive" />
                        </button>
                      </TooltipWrapper>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>

    <ConfirmDialog
      open={confirmClear}
      onOpenChange={setConfirmClear}
      title="Clear all call history?"
      description={`Remove all ${calls.length} call${calls.length !== 1 ? "s" : ""} from history? This cannot be undone.`}
      confirmText="Clear All"
      cancelText="Cancel"
      variant="destructive"
      onConfirm={() => { clearCalls(); setSelectedCallId(null); setConfirmClear(false); }}
    />
    <ConfirmDialog
      open={confirmRemoveCallId != null}
      onOpenChange={(open) => {
        if (!open) setConfirmRemoveCallId(null);
      }}
      title="Remove call from history?"
      description={
        callToRemove
          ? `Remove ${callToRemove.target} from call history? This cannot be undone.`
          : "Remove this call from call history? This cannot be undone."
      }
      confirmText="Remove"
      cancelText="Cancel"
      variant="destructive"
      onConfirm={() => {
        if (!confirmRemoveCallId) return;
        if (selectedCallId === confirmRemoveCallId) setSelectedCallId(null);
        removeCall(confirmRemoveCallId);
        setConfirmRemoveCallId(null);
      }}
    />
    </>
  );
}
