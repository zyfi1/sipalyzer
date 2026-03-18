import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Plus, Trash, Zap } from "@/lib/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { navigateTo } from "@/lib/navigation";
import { toolRegistry } from "@/lib/toolRegistry";
import { cn } from "@/lib/utils";
import { useHomeStore, type HomeQuickActionItem } from "@/stores/homeStore";

type ResolvedQuickAction = HomeQuickActionItem & {
  resolvedLabel: string;
  resolvedToolName: string;
  resolvedSubviewLabel?: string;
  icon: ComponentType<{ className?: string }>;
};
const QUICK_LAUNCH_SLOT_COUNT = 6;

function sameSlotIds(a: (string | null)[], b: (string | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function resolveQuickActionLabel(
  action: HomeQuickActionItem,
  toolName: string,
  subviewLabel?: string,
): string {
  const custom = action.label?.trim();
  if (custom) return custom;
  if (subviewLabel) return `${toolName} - ${subviewLabel}`;
  return toolName;
}

export function HomeQuickActionsPanel({ className, editMode: _editMode = false }: { className?: string; editMode?: boolean }) {
  const homeQuickActions = useHomeStore((s) => s.homeQuickActions);
  const toggleHomeQuickAction = useHomeStore((s) => s.toggleHomeQuickAction);
  const setHomeQuickActions = useHomeStore((s) => s.setHomeQuickActions);
  const syncHomeQuickActions = useHomeStore((s) => s.syncHomeQuickActions);

  useEffect(() => {
    syncHomeQuickActions();
  }, [syncHomeQuickActions]);

  const resolvedActions = useMemo<ResolvedQuickAction[]>(() => {
    const toolsById = new Map(
      toolRegistry.getAll().filter((tool) => !tool.hidden).map((tool) => [tool.id, tool]),
    );
    return homeQuickActions.flatMap((action) => {
      const tool = toolsById.get(action.toolId);
      if (!tool) return [];
      const subview = action.subviewId
        ? (tool.subviews ?? []).find((candidate) => candidate.id === action.subviewId)
        : undefined;
      if (action.subviewId && !subview) return [];
      return [
        {
          ...action,
          resolvedLabel: resolveQuickActionLabel(action, tool.name, subview?.label),
          resolvedToolName: tool.name,
          resolvedSubviewLabel: subview?.label,
          icon: tool.icon,
        },
      ];
    });
  }, [homeQuickActions]);

  const enabledActions = useMemo(
    () => resolvedActions.filter((action) => action.enabled),
    [resolvedActions],
  );
  const resolvedActionsById = useMemo(
    () => new Map(resolvedActions.map((action) => [action.id, action])),
    [resolvedActions],
  );
  const selectedCount = enabledActions.length;
  const enabledActionIds = useMemo(
    () => enabledActions.map((action) => action.id),
    [enabledActions],
  );
  const [slotActionIds, setSlotActionIds] = useState<(string | null)[]>(
    Array.from({ length: QUICK_LAUNCH_SLOT_COUNT }, () => null),
  );
  const actionSlots = useMemo<(ResolvedQuickAction | null)[]>(
    () => slotActionIds.map((id) => (id ? (resolvedActionsById.get(id) ?? null) : null)),
    [resolvedActionsById, slotActionIds],
  );
  const availableActions = useMemo(
    () => resolvedActions.filter((action) => !action.enabled),
    [resolvedActions],
  );
  const [openPlaceholderIndex, setOpenPlaceholderIndex] = useState<number | null>(null);
  const [addActionQuery, setAddActionQuery] = useState("");
  const [hoveredActionId, setHoveredActionId] = useState<string | null>(null);
  const [armedDeleteActionId, setArmedDeleteActionId] = useState<string | null>(null);
  const [confirmDeleteActionId, setConfirmDeleteActionId] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [showHeaderReset, setShowHeaderReset] = useState(false);
  const deleteRevealTimerRef = useRef<number | null>(null);
  const headerRevealTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (deleteRevealTimerRef.current != null) {
        window.clearTimeout(deleteRevealTimerRef.current);
      }
      if (headerRevealTimerRef.current != null) {
        window.clearTimeout(headerRevealTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
    setSlotActionIds((previous) => {
      const next = Array.from({ length: QUICK_LAUNCH_SLOT_COUNT }, (_, index) => previous[index] ?? null);
      const enabledSet = new Set(enabledActionIds);
      for (let i = 0; i < next.length; i += 1) {
        const id = next[i];
        if (id && !enabledSet.has(id)) {
          next[i] = null;
        }
      }
      const used = new Set(next.filter((value): value is string => Boolean(value)));
      const missingEnabled = enabledActionIds.filter((id) => !used.has(id));
      for (let i = 0; i < next.length && missingEnabled.length > 0; i += 1) {
        if (!next[i]) {
          const nextId = missingEnabled.shift();
          if (nextId) next[i] = nextId;
        }
      }
      return sameSlotIds(previous, next) ? previous : next;
    });
  }, [enabledActionIds]);

  const filteredAvailableActions = useMemo(() => {
    const query = addActionQuery.trim().toLowerCase();
    if (!query) return availableActions;
    return availableActions.filter((candidate) =>
      candidate.resolvedLabel.toLowerCase().includes(query) ||
      candidate.resolvedToolName.toLowerCase().includes(query),
    );
  }, [addActionQuery, availableActions]);

  const clearAllTiles = () => {
    setHomeQuickActions(
      homeQuickActions.map((action) => ({
        ...action,
        enabled: false,
      })),
    );
    setSlotActionIds(Array.from({ length: QUICK_LAUNCH_SLOT_COUNT }, () => null));
    setOpenPlaceholderIndex(null);
    setAddActionQuery("");
    setShowHeaderReset(false);
  };

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}
      onMouseEnter={() => {
        if (headerRevealTimerRef.current != null) {
          window.clearTimeout(headerRevealTimerRef.current);
        }
        headerRevealTimerRef.current = window.setTimeout(() => {
          setShowHeaderReset(true);
        }, 650);
      }}
      onMouseLeave={() => {
        if (headerRevealTimerRef.current != null) {
          window.clearTimeout(headerRevealTimerRef.current);
          headerRevealTimerRef.current = null;
        }
        setShowHeaderReset(false);
      }}
    >
      <div className="flex items-center justify-between border-b border-border/45 px-3 py-2">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary/75" />
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-foreground/90">
            Quick Launch
          </h2>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <p className="text-2xs text-muted-foreground/75">{selectedCount}/{QUICK_LAUNCH_SLOT_COUNT}</p>
          {showHeaderReset && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmClearOpen(true);
              }}
              className="ui-control-shell inline-flex h-6 items-center gap-1 rounded-sm border border-border/45 px-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
              aria-label="Clear quick launch tiles"
            >
              <Trash className="h-3 w-3 text-rose-300/95" />
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 p-2">
        <div className="grid h-full min-h-0 grid-cols-3 grid-rows-2 gap-2">
          {actionSlots.map((action, index) => {
            if (!action) {
              return (
                <Popover
                  key={`quick-action-empty-${index}`}
                  open={openPlaceholderIndex === index}
                  onOpenChange={(open) => {
                    setOpenPlaceholderIndex(open ? index : null);
                    if (!open) setAddActionQuery("");
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-full min-h-0 w-full flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.26)_0%,hsl(var(--background)/0.20)_100%)] px-2 text-muted-foreground/75 transition-[border-color,background,color] duration-200 hover:border-border/70 hover:bg-[linear-gradient(180deg,hsl(var(--card)/0.34)_0%,hsl(var(--background)/0.24)_100%)] hover:text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                      aria-label="Add quick action"
                    >
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border-2 border-dashed border-border/55 bg-background/25">
                        <Plus className="h-4 w-4" />
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.12em]">
                        Add Action
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="center" className="w-[min(20rem,calc(100vw-2rem))] p-2">
                    <div className="space-y-2">
                      <p className="px-1 text-2xs text-muted-foreground/78">
                        Select an action for this slot
                      </p>
                      <Input
                        value={addActionQuery}
                        onChange={(e) => setAddActionQuery(e.target.value)}
                        placeholder="Search actions..."
                        className="h-8 text-xs"
                      />
                      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                        {filteredAvailableActions.length > 0 ? (
                          filteredAvailableActions.map((candidate) => {
                            const Icon = candidate.icon;
                            return (
                              <button
                                key={`quick-action-add-${candidate.id}`}
                                type="button"
                                onClick={() => {
                                  setSlotActionIds((previous) => {
                                    const next = Array.from({ length: QUICK_LAUNCH_SLOT_COUNT }, (_, slotIdx) => previous[slotIdx] ?? null);
                                    for (let i = 0; i < next.length; i += 1) {
                                      if (next[i] === candidate.id) next[i] = null;
                                    }
                                    next[index] = candidate.id;
                                    return next;
                                  });
                                  toggleHomeQuickAction(candidate.id, true);
                                  setOpenPlaceholderIndex(null);
                                  setAddActionQuery("");
                                }}
                                className="ui-control-shell inline-flex h-8 w-full items-center gap-2 rounded-sm border border-border/40 bg-background/30 px-2 text-left text-2xs text-foreground/88 transition-[border-color,background,color] duration-200 hover:border-border/70 hover:bg-background/45 hover:text-foreground"
                              >
                                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border/45 bg-background/40">
                                  <Icon className="h-3 w-3 text-foreground/75" />
                                </span>
                                <span className="truncate">{candidate.resolvedLabel}</span>
                              </button>
                            );
                          })
                        ) : (
                          <p className="px-1 py-2 text-2xs text-muted-foreground/78">
                            {availableActions.length === 0
                              ? "No additional actions available."
                              : "No actions match that search."}
                          </p>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              );
            }
            const Icon = action.icon;
            return (
              <div
                key={action.id}
                className="relative h-full min-h-0 w-full"
                onMouseEnter={() => {
                  setHoveredActionId(action.id);
                  if (deleteRevealTimerRef.current != null) {
                    window.clearTimeout(deleteRevealTimerRef.current);
                  }
                  deleteRevealTimerRef.current = window.setTimeout(() => {
                    setArmedDeleteActionId(action.id);
                  }, 750);
                }}
                onMouseLeave={() => {
                  setHoveredActionId((prev) => (prev === action.id ? null : prev));
                  if (deleteRevealTimerRef.current != null) {
                    window.clearTimeout(deleteRevealTimerRef.current);
                    deleteRevealTimerRef.current = null;
                  }
                  setArmedDeleteActionId((prev) => (prev === action.id ? null : prev));
                }}
              >
                <button
                  type="button"
                  onClick={() => navigateTo(action.toolId, action.subviewId)}
                  className={cn(
                    "ui-control-shell inline-flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 rounded-md border bg-[linear-gradient(180deg,hsl(var(--card)/0.62)_0%,hsl(var(--background)/0.50)_100%)] px-2 text-xs text-foreground/90 transition-[transform,border-color,background,color,opacity] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-background/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                    "cursor-pointer border-border/45",
                  )}
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/35 bg-background/30">
                    <Icon className="h-5 w-5 text-foreground/85" />
                  </span>
                  {action.resolvedSubviewLabel ? (
                    <span className="flex min-h-[2.85rem] max-w-full flex-col items-center justify-center px-1 text-center leading-tight">
                      <span
                        className="text-[11px] text-foreground/92"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {action.resolvedToolName}
                      </span>
                      <span
                        className="text-2xs text-muted-foreground/82"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 1,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {action.resolvedSubviewLabel}
                      </span>
                    </span>
                  ) : (
                    <span
                      className="max-w-full px-1 text-center text-[11px] leading-tight"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {action.resolvedLabel}
                    </span>
                  )}
                </button>
                {hoveredActionId === action.id && armedDeleteActionId === action.id && (
                  <button
                    type="button"
                    aria-label={`Remove ${action.resolvedLabel} quick action`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteActionId(action.id);
                    }}
                    className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-sm border border-rose-500/45 bg-rose-500/14 text-rose-300 transition-colors hover:bg-rose-500/22 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/35"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDeleteActionId != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteActionId(null);
        }}
        title="Remove quick action?"
        description="This removes the action from your 2x3 quick launch. You can add it back from an empty slot."
        confirmText="Remove"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (!confirmDeleteActionId) return;
          setSlotActionIds((previous) => previous.map((id) => (id === confirmDeleteActionId ? null : id)));
          toggleHomeQuickAction(confirmDeleteActionId, false);
          setConfirmDeleteActionId(null);
          setArmedDeleteActionId(null);
        }}
      />
      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear quick launch tiles?"
        description="This will remove all quick action tiles. You can add them back from the dotted placeholders."
        confirmText="Clear All"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={clearAllTiles}
      />
    </div>
  );
}
