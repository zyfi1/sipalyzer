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
import {
  X,
  Eye,
  FolderOpen,
  Upload,
  Trash2,
  Radio,
  ChevronRight,
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

  /** Match monitor tab content: flat shell inside tool chrome (no nested graphite card). */
  const emptyShellClass = "ui-panel-shell flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg";

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
      <div className="flex h-full flex-col overflow-hidden bg-transparent">
        <div className="flex min-h-0 flex-1 px-3 pb-3 pt-2">
          <div
            className={cn(
              emptyShellClass,
              "overflow-y-auto overscroll-contain",
              "bg-gradient-to-b from-muted/[0.12] via-transparent to-transparent",
            )}
          >
            <div className="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
              {/* Compact hero — avoid fill-height EmptyState (felt like a huge empty box) */}
              <section className="flex flex-col items-center text-center" aria-labelledby="packet-viewer-empty-title">
                <div
                  className={cn(
                    "mb-4 flex h-14 w-14 items-center justify-center rounded-2xl",
                    "border border-border/50 bg-card/45 text-muted-foreground shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.06)]",
                  )}
                >
                  <Eye className="h-7 w-7 opacity-90" aria-hidden />
                </div>
                <h2
                  id="packet-viewer-empty-title"
                  className="text-balance text-base font-semibold tracking-tight text-foreground sm:text-[1.05rem]"
                >
                  No capture open
                </h2>
                <p className="mt-2 max-w-[22rem] text-pretty text-sm leading-relaxed text-muted-foreground/85">
                  Open a session from Captures or import a PCAP to inspect packets, SIP flows, and decoded fields.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    className="h-9 gap-1.5 px-4 text-xs font-semibold"
                    onClick={handleImport}
                    disabled={importing}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {importing ? "Importing…" : "Import PCAP"}
                  </Button>
                  {sessions.length > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 px-4 text-xs"
                      onClick={() => navigateTo("packet-capture", "captures")}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Browse captures
                    </Button>
                  ) : null}
                </div>
              </section>

              {/* Recent sessions — same width as hero, reads as one flow */}
              {recentSessions.length > 0 ? (
                <section className="w-full" aria-label="Recent capture sessions">
                  <div className="mb-2.5 flex items-end justify-between gap-3 px-0.5">
                    <div className="min-w-0 text-left">
                      <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                        Recent captures
                      </p>
                      <p className="mt-0.5 text-2xs text-muted-foreground/60">Click a row to open in the viewer</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                      onClick={() => setConfirmClearSessions(true)}
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear all
                    </Button>
                  </div>
                  <ul
                    className={cn(
                      "overflow-hidden rounded-xl border border-border/45 bg-card/25",
                      "shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.04)]",
                    )}
                  >
                    {recentSessions.map((session) => {
                      const isRunning = runningSessionIds.includes(session.id);
                      const statusLabel = isRunning ? "Running" : session.status;
                      return (
                        <li key={session.id} className="border-b border-border/35 last:border-b-0">
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-smooth",
                              "hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                              isRunning && liveRingClass,
                            )}
                            onClick={() => openTab(session.id)}
                          >
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate text-xs font-medium text-foreground">{session.name}</span>
                            </span>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "shrink-0 tabular-nums text-3xs h-5 px-1.5 font-medium",
                                isRunning && "border-primary/35 bg-primary/10 text-primary",
                              )}
                            >
                              {statusLabel}
                            </Badge>
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
        </div>
        <ConfirmDialog
          open={confirmClearSessions}
          onOpenChange={setConfirmClearSessions}
          title="Clear all stopped captures?"
          description="Remove all stopped capture sessions? Running sessions will not be affected. This cannot be undone."
          confirmText="Clear all"
          cancelText="Cancel"
          variant="destructive"
          onConfirm={handleClearSessions}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
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
                  <Radio className="h-3 w-3 shrink-0 opacity-50" />
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
      <div className="relative min-h-0 flex-1">
        {openTabs.map((tabId) => {
          const session = getSession(tabId);
          const isActive = tabId === activeTabId;
          return (
            <div
              key={tabId}
              className={cn(
                "absolute inset-0 px-2 pb-2 pt-1 transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
                isActive
                  ? "opacity-100 translate-y-0"
                  : "pointer-events-none translate-y-1 opacity-0",
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
                <div className={cn(emptyShellClass, "items-center justify-center p-6 text-sm text-muted-foreground")}>
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
