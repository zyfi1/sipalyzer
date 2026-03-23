/**
 * PacketCaptureTool — Unified capture toolset.
 *
 * Subviews: Monitor | Captures | Viewer | Analysis | Packet Diff | Remote SSH | Scheduled
 */

import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useMonitorTabStore } from "@/stores/monitorTabStore";
import { useToolStore } from "@/stores/toolStore";
import { useToolVisible } from "@/hooks/useToolVisible";

import { cn } from "@/lib/utils";
import { navigateTo } from "@/lib/navigation";
import { Tabs, TabsContent, AnimatedTabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { tooltips } from "@/lib/tooltips";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { ExecutionContextSelector } from "@/components/ui/execution-context-selector";
import type { ExecutionContext } from "@/stores/executionContextStore";

const MonitorTabsWrapper = lazy(() =>
  import("./monitor/MonitorTabsWrapper").then((m) => ({ default: m.MonitorTabsWrapper }))
);
const PacketViewerView = lazy(() =>
  import("./PacketViewerView").then((m) => ({ default: m.PacketViewerView }))
);
const CapturesView = lazy(() =>
  import("./CapturesView").then((m) => ({ default: m.CapturesView }))
);
const RemoteCaptureView = lazy(() =>
  import("./RemoteCaptureView").then((m) => ({ default: m.RemoteCaptureView }))
);
const ScheduledCapturesPanel = lazy(() =>
  import("./ScheduledCapturesPanel").then((m) => ({ default: m.ScheduledCapturesPanel }))
);
const VoipInvestigationHubView = lazy(() =>
  import("@/components/forensics/VoipInvestigationHubView").then((m) => ({ default: m.VoipInvestigationHubView }))
);
const CallRegressionDiffView = lazy(() =>
  import("@/components/forensics/CallRegressionDiffView").then((m) => ({ default: m.CallRegressionDiffView }))
);

const VALID_TABS = ["monitor", "captures", "viewer", "analysis", "packet-diff", "remote", "scheduled"] as const;
type TabValue = (typeof VALID_TABS)[number];

function PacketSubviewFallback({ label }: { label: string }) {
  return (
    <div className="ui-surface-card flex-1 min-h-0 p-3">
      <div className="text-xs text-muted-foreground mb-3">{label} loading...</div>
      <div className="h-8 skeleton mb-3" />
      <div className="h-24 skeleton mb-3" />
      <div className="h-24 skeleton" />
    </div>
  );
}

export function PacketCaptureTool() {
  const fetchInterfaces = usePacketCaptureStore((s) => s.fetchInterfaces);
  const fetchSessions = usePacketCaptureStore((s) => s.fetchSessions);
  const activeSessionId = usePacketCaptureStore((s) => s.activeSessionId);
  const runningSessionIds = usePacketCaptureStore((s) => s.runningSessionIds);
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);
  const isVisible = useToolVisible("packet-capture");
  const activeMonitorTabId = useMonitorTabStore((s) => s.activeTabId);
  const activeMonitorTab = useMonitorTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const updateMonitorTab = useMonitorTabStore((s) => s.updateTab);
  const [activeTab, setActiveTab] = useState<TabValue>("monitor");

  const handleContextChange = useCallback((ctx: ExecutionContext) => {
    if (activeMonitorTabId) updateMonitorTab(activeMonitorTabId, { executionContext: ctx });
  }, [activeMonitorTabId, updateMonitorTab]);

  const [headerPortal, setHeaderPortal] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderPortal(document.getElementById("header-tool-widget-custom"));
  }, []);

  // Fetch interfaces when visible (deferred for smoother paint)
  useEffect(() => {
    if (!isVisible) return;
    const schedule = () => {
      if (typeof requestIdleCallback !== "undefined") {
        const id = requestIdleCallback(() => fetchInterfaces(), { timeout: 200 });
        return () => cancelIdleCallback(id);
      }
      const t = setTimeout(fetchInterfaces, 100);
      return () => clearTimeout(t);
    };
    const cancel = schedule();
    return () => cancel?.();
  }, [fetchInterfaces, isVisible]);

  useEffect(() => {
    if (isVisible && (activeTab === "captures" || activeTab === "remote" || activeTab === "viewer" || activeTab === "analysis" || activeTab === "packet-diff")) {
      fetchSessions();
    }
  }, [activeTab, fetchSessions, isVisible]);

  // Poll statistics only when visible and there's an active running session
  useEffect(() => {
    if (!isVisible || !activeSessionId || !runningSessionIds.includes(activeSessionId)) return;
    const interval = setInterval(() => {
      const { fetchStatistics } = usePacketCaptureStore.getState();
      fetchStatistics(activeSessionId);
    }, 8000);
    return () => clearInterval(interval);
  }, [activeSessionId, runningSessionIds, isVisible]);

  useEffect(() => {
    if (activeToolId !== "packet-capture") return;
    if (!activeSubviewId) return;

    const tab = activeSubviewId === "packet-monitor"
      ? "monitor"
      : activeSubviewId === "hub"
        ? "analysis"
        : activeSubviewId;

    if ((VALID_TABS as readonly string[]).includes(tab)) {
      setActiveTab(tab as TabValue);
      setLastViewedSubview("packet-capture", tab);
    }
    setActiveSubview(null);
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview]);

  const handleViewCapture = useCallback((sessionId: string) => {
    navigateTo("packet-capture", "viewer", { packetCaptureSessionId: sessionId });
    setActiveTab("viewer");
  }, []);

  // Keep sidebar in sync when tab changes locally
  useEffect(() => {
    setLastViewedSubview("packet-capture", activeTab);
  }, [activeTab, setLastViewedSubview]);

  const tabConfig = [
    { value: "monitor" as const, label: "Monitor" },
    { value: "captures" as const, label: "Captures", tooltip: tooltips.captureTabCaptures },
    { value: "viewer" as const, label: "Viewer", tooltip: tooltips.captureTabViewer },
    { value: "analysis" as const, label: "Analysis", tooltip: tooltips.captureTabAnalysis },
    { value: "packet-diff" as const, label: "Packet Diff" },
    { value: "remote" as const, label: "Remote SSH", tooltip: tooltips.captureTabRemote },
    { value: "scheduled" as const, label: "Scheduled", tooltip: tooltips.captureTabScheduled },
  ];
  return (
    <div className="packet-graphite-theme app-tool-width flex flex-col h-full overflow-hidden">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="flex-1 flex flex-col gap-0 overflow-hidden">
        <ToolHeader
          toolId="packet-capture"
          items={tabConfig.map(({ value, label }) => ({ id: value, label }))}
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabValue)}
        />

        {isVisible && activeTab === "monitor" && headerPortal && createPortal(
          <div className="flex items-center ml-0">
            <ExecutionContextSelector
              value={activeMonitorTab?.executionContext ?? { type: "local" }}
              onChange={handleContextChange}
              disabled={activeMonitorTab?.isCapturing}
              className="w-[150px] max-w-[150px]"
            />
          </div>,
          headerPortal,
        )}

        <div className="flex-1 flex flex-col min-h-0">
          {/* Monitor — forceMount to keep active captures running across tab switches */}
        <TabsContent
          value="monitor"
          forceMount
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <Suspense fallback={<PacketSubviewFallback label="Monitor" />}>
            <div className="ui-panel-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden">
              <MonitorTabsWrapper />
            </div>
          </Suspense>
        </TabsContent>

        <AnimatedTabsContent className={cn(activeTab === "monitor" && "hidden")}>
          <TabsContent value="analysis" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full min-h-0 app-view-gutter">
              <div className="ui-panel-shell h-full min-h-0 overflow-hidden">
                <Suspense fallback={<PacketSubviewFallback label="Analysis" />}>
                  <VoipInvestigationHubView />
                </Suspense>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="packet-diff" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full min-h-0 app-view-gutter">
              <div className="ui-panel-shell h-full min-h-0 overflow-hidden">
                <Suspense fallback={<PacketSubviewFallback label="Packet Diff" />}>
                  <CallRegressionDiffView sessions={sessions} preferredAfterSessionId={activeSessionId} />
                </Suspense>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="viewer" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full min-h-0 flex flex-col overflow-hidden">
              <Suspense fallback={<PacketSubviewFallback label="Viewer" />}>
                <PacketViewerView />
              </Suspense>
            </div>
          </TabsContent>

          <TabsContent value="captures" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full min-h-0 flex flex-col overflow-hidden">
              <Suspense fallback={<PacketSubviewFallback label="Captures" />}>
                <CapturesView />
              </Suspense>
            </div>
          </TabsContent>

          <TabsContent value="remote" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full min-h-0 flex flex-col overflow-hidden">
              <Suspense fallback={<PacketSubviewFallback label="Remote SSH" />}>
                <RemoteCaptureView onViewCapture={handleViewCapture} />
              </Suspense>
            </div>
          </TabsContent>

          <TabsContent value="scheduled" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full min-h-0 flex flex-col overflow-hidden">
              <Suspense fallback={<PacketSubviewFallback label="Scheduled" />}>
                <ScheduledCapturesPanel />
              </Suspense>
            </div>
          </TabsContent>
        </AnimatedTabsContent>

        </div>
      </Tabs>
    </div>
  );
}
