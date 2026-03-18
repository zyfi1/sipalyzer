/**
 * PacketViewerView — Tabbed multi-capture viewer.
 *
 * Allows opening multiple capture sessions simultaneously, each in its own tab.
 * Uses CaptureSessionViewer for the actual packet viewing.
 */

import { useState, useEffect, useCallback } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useOpenCaptureViewer } from "@/hooks/useOpenCapture";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  X,
  Eye,
  FolderOpen,
  Upload,
  Trash2,
  Laptop,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";
import { navigateTo } from "@/lib/navigation";
import type { CaptureSession } from "@/types/packetCapture";
import { importPcap } from "@/api/packetCapture";
import { CaptureSessionViewer } from "./CaptureSessionViewer";
import { liveRingClass, LiveIndicator } from "@/components/ui/live-indicator";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CaptureTabRail } from "./shared/CaptureTabRail";
import {
  CAPTURE_TAB_PILL_ACTIVE_CLASS,
  CAPTURE_TAB_PILL_BASE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS,
  CAPTURE_TAB_PILL_INACTIVE_CLASS,
} from "./shared/tabPillStyles";

export function PacketViewerView() {
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const fetchSessions = usePacketCaptureStore((s) => s.fetchSessions);
  const fetchSessionsImmediate = usePacketCaptureStore((s) => s.fetchSessionsImmediate);
  const runningSessionIds = usePacketCaptureStore((s) => s.runningSessionIds);
  const setViewerActiveSessionId = usePacketCaptureStore((s) => s.setViewerActiveSessionId);
  const { notify } = useNotifications();

  // Ordered list of open tab session IDs and active tab
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Initial filters from external open requests
  const [tabFilters, setTabFilters] = useState<Record<string, string>>({});
  const [tabDetailsTabs, setTabDetailsTabs] = useState<Record<string, "overview" | "protocol" | "raw">>({});

  // ── Sync active viewer session to store so Analysis tab can follow ──
  useEffect(() => {
    setViewerActiveSessionId(activeTabId);
  }, [activeTabId, setViewerActiveSessionId]);

  // ── Listen for external "open viewer" requests (e.g. from analysis) ──
  const { sessionId: requestedSessionId, options: requestedOptions, isRequested, clearRequest } = useOpenCaptureViewer();

  useEffect(() => {
    if (isRequested && requestedSessionId) {
      // Refresh sessions immediately (no debounce) so this capture is available in the list
      fetchSessionsImmediate();
      openTab(requestedSessionId, requestedOptions?.filter, requestedOptions?.detailsTab);
      clearRequest();
    }
  }, [isRequested, requestedSessionId, requestedOptions, clearRequest, fetchSessionsImmediate]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ── Tab management ──
  const openTab = useCallback((sessionId: string, initialFilter?: string, detailsTab?: "overview" | "protocol" | "raw") => {
    setOpenTabs((prev) => {
      if (prev.includes(sessionId)) {
        // Already open — activate and update filter if requested.
        setActiveTabId(sessionId);
        if (initialFilter !== undefined) {
          setTabFilters((filters) => ({ ...filters, [sessionId]: initialFilter }));
        }
        if (detailsTab) {
          setTabDetailsTabs((tabs) => ({ ...tabs, [sessionId]: detailsTab }));
        }
        return prev;
      }
      const next = [...prev, sessionId];
      setActiveTabId(sessionId);
      return next;
    });
    if (initialFilter) {
      setTabFilters((prev) => ({ ...prev, [sessionId]: initialFilter }));
    }
    if (detailsTab) {
      setTabDetailsTabs((prev) => ({ ...prev, [sessionId]: detailsTab }));
    }
  }, []);

  const closeTab = useCallback((sessionId: string) => {
    setOpenTabs((prev) => {
      const idx = prev.indexOf(sessionId);
      const next = prev.filter((id) => id !== sessionId);

      // If we closed the active tab, pick an adjacent one
      if (activeTabId === sessionId) {
        if (next.length === 0) {
          setActiveTabId(null);
        } else {
          // Prefer the tab to the left, or the first one
          const newIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[newIdx] ?? null);
        }
      }
      return next;
    });
    setTabFilters((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setTabDetailsTabs((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, [activeTabId]);

  const closeAllTabs = useCallback(() => {
    setOpenTabs([]);
    setActiveTabId(null);
    setTabFilters({});
    setTabDetailsTabs({});
  }, []);

  // ── Import PCAP ──
  const [importing, setImporting] = useState(false);
  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const sessionId = await importPcap();
      notify({ source: "packet-capture", type: "success", title: "Import Successful", description: "PCAP file imported." });
      await fetchSessions();
      openTab(sessionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("cancelled")) {
        notify({ source: "packet-capture", type: "error", title: "Import Failed", description: msg });
      }
    } finally {
      setImporting(false);
    }
  }, [fetchSessions, notify, openTab]);

  // ── Resolve sessions for open tabs ──
  const getSession = (id: string): CaptureSession | undefined =>
    sessions.find((s) => s.id === id);

  const panelClass = "packet-graphite-panel overflow-hidden rounded-lg";

  // ── Recent sessions for the empty state ──
  const recentSessions = sessions.slice(0, 8);

  // ── Clear all stopped sessions ──
  const deleteAllSessions = usePacketCaptureStore((s) => s.deleteAllSessions);
  const [confirmClearSessions, setConfirmClearSessions] = useState(false);
  const handleClearSessions = useCallback(async () => {
    try {
      await deleteAllSessions("stopped");
      await fetchSessions();
      notify({ source: "packet-capture", type: "success", title: "Cleared", description: "All stopped captures cleared." });
    } catch (e) {
      notify({ source: "packet-capture", type: "error", title: "Failed", description: e instanceof Error ? e.message : String(e) });
    }
    setConfirmClearSessions(false);
  }, [deleteAllSessions, fetchSessions, notify]);

  // ── Empty state ──
  if (openTabs.length === 0) {
    return (
      <div className="h-full flex flex-col overflow-hidden rounded-lg bg-muted/[0.08]">
        <div className="flex-1 min-h-0 p-1.5">
          <div className={cn(panelClass, "h-full w-full p-4")}>
          <div className="h-full w-full max-w-3xl mx-auto flex flex-col justify-center gap-4">
            <EmptyState
              variant="inline"
              icon={<Eye />}
              title="No captures open"
              description="Open a capture session to view its packets, or import a PCAP file."
              className="h-full"
              action={
                <div className="flex items-center gap-2">
                  {sessions.length > 0 && (
                    <Button size="sm" variant="neutral" className="h-8 gap-1.5 px-3 text-xs" onClick={() => navigateTo("packet-capture", "captures")}>
                      <FolderOpen className="h-3.5 w-3.5" />
                      Browse Captures
                    </Button>
                  )}
                  <Button size="sm" variant="neutral" className="h-8 gap-1.5 px-3 text-xs" onClick={handleImport} disabled={importing}>
                    <Upload className="h-3.5 w-3.5" />
                    {importing ? "Importing…" : "Import PCAP"}
                  </Button>
                </div>
              }
            />

            {/* Quick-open list of recent sessions */}
            {recentSessions.length > 0 && (
              <div className="mx-auto w-full max-w-md ui-surface-card p-0 overflow-hidden">
                <div className="ui-section-header-sm flex items-center justify-between">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Captures</h4>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 px-2.5 text-xs gap-1.5"
                    onClick={() => setConfirmClearSessions(true)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear
                  </Button>
                </div>
                <div className="flex flex-col overflow-hidden">
                  {recentSessions.map((session) => {
                    const isRunning = runningSessionIds.includes(session.id);
                    return (
                      <button
                        key={session.id}
                        type="button"
                        className={cn(
                          "ui-data-row flex items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-xs transition-smooth hover:bg-accent/35 last:border-b-0",
                          isRunning && liveRingClass,
                        )}
                        onClick={() => openTab(session.id)}
                      >
                        <span className="flex-1 truncate font-medium">{session.name}</span>
                        <span className="text-muted-foreground shrink-0">
                          {isRunning ? "Running" : session.status}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
        <ConfirmDialog
          open={confirmClearSessions}
          onOpenChange={setConfirmClearSessions}
          title="Clear all stopped captures?"
          description="Remove all stopped capture sessions? Running sessions will not be affected. This cannot be undone."
          confirmText="Clear All"
          cancelText="Cancel"
          variant="destructive"
          onConfirm={handleClearSessions}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-lg bg-muted/[0.08]">
      <CaptureTabRail
            items={openTabs}
            getKey={(tabId) => tabId}
            renderItem={(tabId) => {
              const session = getSession(tabId);
              const isActive = tabId === activeTabId;
              const isRunning = session?.status === "Running";
              const label = session?.name || tabId.slice(0, 8);
              const packetCount = session?.packetCount ?? 0;
              return (
                <button
                  type="button"
                  className={cn(
                    CAPTURE_TAB_PILL_BASE_CLASS,
                    isActive ? CAPTURE_TAB_PILL_ACTIVE_CLASS : CAPTURE_TAB_PILL_INACTIVE_CLASS,
                  )}
                  onClick={() => setActiveTabId(tabId)}
                >
                  <Laptop className="h-3 w-3 shrink-0 opacity-50" />
                  <span className="min-w-0 flex-1 max-w-[150px] truncate">{label}</span>
                  {isRunning && <LiveIndicator variant="dot" size="xs" />}
                  {packetCount > 0 && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-3xs h-4 px-1 tabular-nums ml-0.5 shrink-0",
                        isRunning
                          ? "bg-primary/12 text-primary border border-primary/30"
                          : "bg-muted/40 text-muted-foreground border border-border/35",
                      )}
                    >
                      {packetCount >= 1000 ? `${(packetCount / 1000).toFixed(1)}K` : packetCount}
                    </Badge>
                  )}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tabId);
                    }}
                    className={cn(
                      CAPTURE_TAB_PILL_CLOSE_CLASS,
                      isActive ? CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS : CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS,
                    )}
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                </button>
              );
            }}
            afterRightArrow={openTabs.length > 1 ? (
              <div className="shrink-0 flex items-center gap-1 border-l border-border/35 px-2 mr-1">
                <Button size="sm" variant="neutral" className="h-[1.88rem] px-2 text-xs" onClick={closeAllTabs}>
                  Close all
                </Button>
              </div>
            ) : undefined}
      />

      {/* ── Viewer tabs content (monitor-style stacked panels) ── */}
      <div className="relative flex-1 min-h-0">
        {openTabs.map((tabId) => {
          const session = getSession(tabId);
          const isActive = tabId === activeTabId;
          return (
            <div
              key={tabId}
              className={cn(
                "absolute inset-0 p-1.5 transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
                isActive
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-1 pointer-events-none",
              )}
            >
              {session ? (
                <CaptureSessionViewer
                  key={tabId}
                  session={session}
                  onClose={() => closeTab(tabId)}
                  onImport={handleImport}
                  importing={importing}
                  initialFilter={tabFilters[tabId]}
                  initialDetailsTab={tabDetailsTabs[tabId]}
                  expanded
                />
              ) : (
                <div className={cn(panelClass, "h-full flex items-center justify-center text-sm text-muted-foreground")}>
                  Session not found. It may have been deleted.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
    );
}
