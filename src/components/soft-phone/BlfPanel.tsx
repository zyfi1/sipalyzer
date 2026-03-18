import { useState, useMemo } from "react";
import { useSoftphoneStore, type BlfEntry } from "@/stores/softphoneStore";
import { cn } from "@/lib/utils";
import { Phone, Plus, X, Users, Pause, Play } from "@/lib/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useExecutionContextStore } from "@/stores/executionContextStore";

const STATE_COLORS: Record<BlfEntry["state"], { dot: string; label: string; text: string }> = {
  idle: { dot: "bg-success", label: "Available", text: "text-success" },
  busy: { dot: "bg-destructive", label: "Busy", text: "text-destructive" },
  ringing: { dot: "bg-warning animate-live-breathe motion-reduce:animate-none", label: "Ringing", text: "text-warning" },
  offline: { dot: "bg-muted-foreground/30", label: "Offline", text: "text-muted-foreground/60" },
  unknown: { dot: "bg-muted-foreground/30", label: "Unknown", text: "text-muted-foreground/60" },
};

const PARK_STATE: Record<string, { dot: string; label: string; text: string }> = {
  idle: { dot: "bg-success/60", label: "Empty", text: "text-success/80" },
  busy: { dot: "bg-warning animate-live-breathe motion-reduce:animate-none", label: "Occupied", text: "text-warning" },
};

export function BlfPanel() {
  const activeRegistrarId = useSoftphoneStore((s) => s.activeRegistrarId);
  const allBlfEntries = useSoftphoneStore((s) => s.blfEntries);
  const addBlfEntry = useSoftphoneStore((s) => s.addBlfEntry);
  const addParkKeys = useSoftphoneStore((s) => s.addParkKeys);
  const removeBlfEntry = useSoftphoneStore((s) => s.removeBlfEntry);
  const startCall = useSoftphoneStore((s) => s.startCall);
  const parkCall = useSoftphoneStore((s) => s.parkCall);
  const calls = useSoftphoneStore((s) => s.calls);
  const activeCallId = useSoftphoneStore((s) => s.activeCallId);

  const entries = activeRegistrarId ? (allBlfEntries[activeRegistrarId] ?? []) : [];
  const extensionEntries = useMemo(() => entries.filter((e) => (e.type ?? "extension") === "extension"), [entries]);
  const parkEntries = useMemo(() => entries.filter((e) => e.type === "park"), [entries]);

  const activeCall = calls.find((c) => c.id === activeCallId);
  const canPark = activeCall && (activeCall.state === "active" || activeCall.state === "on-hold");

  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<"extension" | "park">("extension");
  const [newLabel, setNewLabel] = useState("");
  const [newExt, setNewExt] = useState("");
  const [parkSlotCount, setParkSlotCount] = useState("4");
  const [parkStartSlot, setParkStartSlot] = useState("701");
  const [parkLoading, setParkLoading] = useState<string | null>(null);
  const [confirmRemoveEntry, setConfirmRemoveEntry] = useState<{
    id: string;
    kind: "extension" | "park";
    label: string;
  } | null>(null);

  const handleAddExtension = () => {
    if (!activeRegistrarId || !newLabel.trim() || !newExt.trim()) return;
    addBlfEntry(activeRegistrarId, newLabel.trim(), newExt.trim(), "extension");
    setNewLabel("");
    setNewExt("");
    setAdding(false);
  };

  const handleAddParkKeys = () => {
    if (!activeRegistrarId) return;
    const start = parseInt(parkStartSlot) || 701;
    const count = Math.min(Math.max(parseInt(parkSlotCount) || 1, 1), 20);
    addParkKeys(activeRegistrarId, start, count);
    setAdding(false);
    setParkSlotCount("4");
    setParkStartSlot("701");
  };

  const handleParkToSlot = async (slot: string) => {
    if (!canPark || !activeCall) return;
    setParkLoading(slot);
    try {
      await parkCall(activeCall.id);
    } catch (e) {
      console.error("Park failed:", e);
    } finally {
      setParkLoading(null);
    }
  };

  const handleRetrieve = (slot: string) => {
    const ctx = useExecutionContextStore.getState().resolvedContext("softphone");
    startCall(slot, ctx);
  };

  if (!activeRegistrarId) {
    return (
      <EmptyState
        compact
        variant="inline"
        icon={<Users />}
        title="No registrar selected"
        description="Select a registrar to manage line keys."
        className="py-8"
      />
    );
  }

  return (
    <>
    <div className="flex flex-col gap-3 pb-2">
      {/* ── Park Slots ── */}
      {parkEntries.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-2.5 py-1">
            <span className="section-label-sm">Park Slots</span>
            <span className="text-3xs text-muted-foreground/50">
              {parkEntries.filter((e) => e.state === "busy").length}/{parkEntries.length} occupied
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1 px-1">
            {parkEntries.map((e) => {
              const occupied = e.state === "busy";
              const style = PARK_STATE[occupied ? "busy" : "idle"]!;
              const loading = parkLoading === e.parkSlot;
              return (
                <div
                  key={e.id}
                  className={cn(
                    "relative flex flex-col gap-1 px-2.5 py-2 rounded-lg border transition-smooth group",
                    occupied
                      ? "border-warning/30 bg-warning/5"
                      : "border-border/40 bg-card/50 hover:bg-accent/30",
                  )}
                >
                  <TooltipWrapper content="Remove slot">
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmRemoveEntry({
                          id: e.id,
                          kind: "park",
                          label: e.parkSlot ?? e.label,
                        })
                      }
                      className="absolute top-1 right-1 h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-smooth opacity-0 group-hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </TooltipWrapper>

                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", style.dot)} />
                    <span className="text-2xs font-semibold tabular-nums text-foreground">{e.parkSlot}</span>
                    <span className={cn("text-3xs font-medium ml-auto", style.text)}>{style.label}</span>
                  </div>

                  {occupied && e.parkedCaller && (
                    <TooltipWrapper content={`Parked by ${e.parkedBy ?? "unknown"}`}>
                      <div className="text-3xs text-muted-foreground truncate">
                        {e.parkedCaller} → parked by {e.parkedBy ?? "—"}
                      </div>
                    </TooltipWrapper>
                  )}

                  <div className="flex gap-1 mt-0.5">
                    {occupied ? (
                      <button
                        type="button"
                        onClick={() => handleRetrieve(e.parkSlot!)}
                        className="flex-1 h-6 rounded-md text-3xs font-semibold bg-success/10 text-success hover:bg-success/20 transition-smooth flex items-center justify-center gap-1"
                      >
                        <Play className="h-2.5 w-2.5" />
                        Retrieve
                      </button>
                    ) : canPark ? (
                      <button
                        type="button"
                        onClick={() => handleParkToSlot(e.parkSlot!)}
                        disabled={loading}
                        className="flex-1 h-6 rounded-md text-3xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-smooth flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        <Pause className="h-2.5 w-2.5" />
                        {loading ? "Parking..." : "Park Here"}
                      </button>
                    ) : (
                      <span className="flex-1 h-6 flex items-center justify-center text-3xs text-muted-foreground/40">
                        No active call
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Extension Presence ── */}
      <div>
        {(extensionEntries.length > 0 || parkEntries.length > 0) && (
          <div className="px-2.5 py-1">
            <span className="section-label-sm">Extensions</span>
          </div>
        )}

        {extensionEntries.length === 0 && parkEntries.length === 0 && !adding && (
          <EmptyState compact variant="inline" title="No line keys configured" description="Add extension monitors or park slots to get started." />
        )}

        {extensionEntries.map((e) => {
          const style = STATE_COLORS[e.state] ?? STATE_COLORS.unknown;
          return (
            <div
              key={e.id}
              className="surface-flat flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-accent/30 transition-smooth group"
            >
              <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", style.dot)} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{e.label}</div>
                <div className="text-2xs text-muted-foreground/60">{e.extension}</div>
              </div>
              <span className={cn("text-2xs font-medium shrink-0", style.text)}>
                {style.label}
              </span>
              <TooltipWrapper content={`Call ${e.extension}`}>
                <button
                  type="button"
                  onClick={() => {
                    const ctx = useExecutionContextStore.getState().resolvedContext("softphone");
                    startCall(e.extension, ctx);
                  }}
                  className="h-6 w-6 rounded-full flex items-center justify-center bg-success/10 text-success hover:bg-success/20 transition-smooth opacity-0 group-hover:opacity-100"
                >
                  <Phone className="h-3 w-3" />
                </button>
              </TooltipWrapper>
              <TooltipWrapper content="Remove">
                <button
                  type="button"
                  onClick={() =>
                    setConfirmRemoveEntry({
                      id: e.id,
                      kind: "extension",
                      label: e.label || e.extension,
                    })
                  }
                  className="h-5 w-5 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-smooth opacity-0 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </TooltipWrapper>
            </div>
          );
        })}
      </div>

      {/* ── Add Form ── */}
      {adding ? (
        <div className="flex flex-col gap-2 p-2.5 ui-panel-shell rounded-lg mx-1">
          {/* Type selector */}
          <div className="flex gap-1 p-0.5 rounded-md bg-background/50">
            <button
              type="button"
              onClick={() => setAddType("extension")}
              className={cn(
                "flex-1 py-1 rounded text-2xs font-medium transition-smooth",
                addType === "extension" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Extension
            </button>
            <button
              type="button"
              onClick={() => setAddType("park")}
              className={cn(
                "flex-1 py-1 rounded text-2xs font-medium transition-smooth",
                addType === "park" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Park Slots
            </button>
          </div>

          {addType === "extension" ? (
            <>
              <Input
                placeholder="Label (e.g. Front Desk)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="h-7 text-xs"
                autoFocus
              />
              <Input
                placeholder="Extension (e.g. 1001)"
                value={newExt}
                onChange={(e) => setNewExt(e.target.value)}
                className="h-7 text-xs"
                onKeyDown={(e) => e.key === "Enter" && handleAddExtension()}
              />
            </>
          ) : (
            <>
              <div className="flex gap-1.5">
                <div className="flex-1">
                  <label className="text-3xs text-muted-foreground/60 mb-0.5 block">Start Slot</label>
                  <Input
                    placeholder="701"
                    value={parkStartSlot}
                    onChange={(e) => setParkStartSlot(e.target.value)}
                    className="h-7 text-xs tabular-nums"
                    autoFocus
                  />
                </div>
                <div className="flex-1">
                  <label className="text-3xs text-muted-foreground/60 mb-0.5 block">Count</label>
                  <Input
                    placeholder="4"
                    value={parkSlotCount}
                    onChange={(e) => setParkSlotCount(e.target.value)}
                    className="h-7 text-xs tabular-nums"
                    onKeyDown={(e) => e.key === "Enter" && handleAddParkKeys()}
                  />
                </div>
              </div>
              <p className="text-3xs text-muted-foreground/50">
                Creates park keys for slots {parkStartSlot}–{parseInt(parkStartSlot || "701") + Math.max(parseInt(parkSlotCount || "1") - 1, 0)}
              </p>
            </>
          )}

          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-6 text-2xs flex-1" onClick={() => { setAdding(false); setAddType("extension"); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 text-2xs flex-1"
              onClick={addType === "extension" ? handleAddExtension : handleAddParkKeys}
            >
              {addType === "extension" ? "Add" : `Add ${Math.min(Math.max(parseInt(parkSlotCount) || 1, 1), 20)} Slots`}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-2xs text-muted-foreground/60 hover:text-foreground hover:bg-accent/30 transition-smooth"
        >
          <Plus className="h-3 w-3" />
          Add key
        </button>
      )}
    </div>
    <ConfirmDialog
      open={confirmRemoveEntry != null}
      onOpenChange={(open) => {
        if (!open) setConfirmRemoveEntry(null);
      }}
      title={confirmRemoveEntry?.kind === "park" ? "Remove park slot?" : "Remove line key?"}
      description={
        confirmRemoveEntry
          ? `Remove ${confirmRemoveEntry.kind === "park" ? "park slot" : "line key"} "${confirmRemoveEntry.label}"? This cannot be undone.`
          : "Remove this entry? This cannot be undone."
      }
      confirmText="Remove"
      cancelText="Cancel"
      variant="destructive"
      onConfirm={() => {
        if (!confirmRemoveEntry) return;
        removeBlfEntry(activeRegistrarId, confirmRemoveEntry.id);
        setConfirmRemoveEntry(null);
      }}
    />
    </>
  );
}
