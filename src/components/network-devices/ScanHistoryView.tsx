import { useState } from "react";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Trash, Clock, Play, Scan, Network } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

const SCAN_MODE_LABELS: Record<string, string> = {
  quick: "Quick",
  sip: "Service",
  full: "Full",
};

export function ScanHistoryView() {
  const history = useNetworkDevicesStore((s) => s.history);
  const loadFromHistory = useNetworkDevicesStore((s) => s.loadFromHistory);
  const deleteHistory = useNetworkDevicesStore((s) => s.deleteHistory);
  const clearHistory = useNetworkDevicesStore((s) => s.clearHistory);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const entryToDelete = history.find((entry) => entry.id === confirmDeleteId) ?? null;

  if (history.length === 0) {
    return (
      <div className="flex-1 min-h-0">
        <EmptyState
          variant="inline"
          icon={<Clock />}
          title="No scan history"
          description="Completed scans will appear here. Run a scan to get started."
          className="h-full min-h-0 p-6"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 w-full ui-hero-surface overflow-hidden flex flex-col">
      <div className="ui-section-header-sm border-b border-border/35">
        <div className="flex items-center justify-between w-full">
        <h3 className="text-sm font-semibold text-foreground">
          Scan History <span className="text-muted-foreground font-normal">({history.length})</span>
        </h3>
        <Button
          variant="neutral"
          size="sm"
          className="h-7 px-2.5 text-xs gap-1.5"
          onClick={() => setConfirmClearHistory(true)}
        >
          <Trash className="h-3.5 w-3.5" />
          Clear All
        </Button>
        </div>
      </div>

      <div className="app-view-surface-pad flex-1 min-h-0 overflow-y-auto space-y-2">
        {history.map((entry) => {
          const hasDevices = entry.devicesFound > 0;
          const modeLabel = SCAN_MODE_LABELS[entry.scanMode ?? "sip"] ?? "SIP";

          return (
            <Card
              key={entry.id}
              className={cn(
                "group relative w-full overflow-hidden transition-smooth",
                "hover:shadow-card-hover",
                "cursor-pointer",
              )}
              onClick={() => loadFromHistory(entry)}
            >
              {/* Subtle top accent line */}
              <div className={cn(
                "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity",
                hasDevices ? "via-success/50" : "via-primary/40",
              )} />

              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Icon container */}
                    <div className={cn(
                      "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                      hasDevices ? "bg-success/10" : "bg-muted/30",
                    )}>
                      <Network className={cn(
                        "h-4.5 w-4.5",
                        hasDevices ? "text-success" : "text-muted-foreground",
                      )} />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* Target + mode badge */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium font-mono truncate">
                          {entry.targets}
                        </span>
                        <Badge variant="secondary" className="text-3xs h-4 px-1.5 uppercase">
                          {modeLabel}
                        </Badge>
                        {entry.scanMode !== "quick" && (
                          <>
                            <Badge variant="secondary" className="text-3xs h-4 px-1.5 uppercase">
                              {entry.method}
                            </Badge>
                            <Badge variant="secondary" className="text-3xs h-4 px-1.5 uppercase">
                              {entry.transport}
                            </Badge>
                          </>
                        )}
                      </div>

                      {/* Metadata row */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {timeAgo(entry.timestamp)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Scan className="h-3 w-3" />
                          <span className="tabular-nums font-medium text-foreground">{entry.devicesFound}</span>
                          {" "}device{entry.devicesFound !== 1 ? "s" : ""}
                        </span>
                        <span className="tabular-nums">{entry.totalScanned.toLocaleString()} steps</span>
                        <span className="tabular-nums">{(entry.durationMs / 1000).toFixed(1)}s</span>
                        {entry.ports.length > 0 && entry.scanMode !== "quick" && (
                          <span>ports: {entry.ports.join(", ")}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions — visible on hover */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <TooltipWrapper content="Load results into scanner view">
                    <Button
                      variant="neutral"
                      size="sm"
                      className="h-7 px-2.5 text-xs gap-1"
                      onClick={(e) => { e.stopPropagation(); loadFromHistory(entry); }}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Load
                    </Button>
                    </TooltipWrapper>
                    <TooltipWrapper content="Delete this entry">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(entry.id);
                      }}
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </Button>
                    </TooltipWrapper>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmClearHistory}
        onOpenChange={setConfirmClearHistory}
        title="Clear scan history?"
        description={`Delete all ${history.length} scan histor${history.length === 1 ? "y entry" : "y entries"}? This cannot be undone.`}
        confirmText="Clear All"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          clearHistory();
          setConfirmClearHistory(false);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteId != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        title="Delete scan history entry?"
        description={
          entryToDelete
            ? `Delete scan result for "${entryToDelete.targets}"? This cannot be undone.`
            : "Delete this scan history entry? This cannot be undone."
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (!confirmDeleteId) return;
          deleteHistory(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}
