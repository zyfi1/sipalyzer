import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToolStore } from "@/stores/toolStore";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { cn } from "@/lib/utils";
import { listen } from "@/lib/tauriEvents";
import { useNotifications } from "@/hooks/useNotifications";
import type { ScanProgressEvent } from "@/types/networkDevices";

// ── Views ────────────────────────────────────────────────────────
const PathReachabilityView = lazy(() =>
  import("@/components/network/views/PathReachabilityView").then((m) => ({ default: m.PathReachabilityView }))
);
const NameAccessView = lazy(() =>
  import("@/components/network/views/NameAccessView").then((m) => ({ default: m.NameAccessView }))
);
const DiscoveryWorkspaceView = lazy(() =>
  import("@/components/network/views/DiscoveryWorkspaceView").then((m) => ({ default: m.DiscoveryWorkspaceView }))
);
const RealtimeMediaView = lazy(() =>
  import("@/components/network/views/RealtimeMediaView").then((m) => ({ default: m.RealtimeMediaView }))
);

// ── Subview constants ────────────────────────────────────────────
const SUBVIEW_PATH_PERFORMANCE = "path-performance";
const SUBVIEW_DNS_ACCESS = "dns-access";
const SUBVIEW_DISCOVERY = "discovery";
const SUBVIEW_MULTICAST = "multicast";

/** Maps legacy subview IDs to current tab IDs */
const LEGACY_MAP: Record<string, string> = {
  // Canonical IA IDs (identity mapping)
  [SUBVIEW_PATH_PERFORMANCE]: SUBVIEW_PATH_PERFORMANCE,
  [SUBVIEW_DNS_ACCESS]: SUBVIEW_DNS_ACCESS,
  [SUBVIEW_DISCOVERY]: SUBVIEW_DISCOVERY,
  [SUBVIEW_MULTICAST]: SUBVIEW_MULTICAST,
  // Legacy top-level IDs
  overview: SUBVIEW_PATH_PERFORMANCE,
  connectivity: SUBVIEW_PATH_PERFORMANCE,
  path: SUBVIEW_PATH_PERFORMANCE,
  probe: SUBVIEW_DNS_ACCESS,
  access: SUBVIEW_DNS_ACCESS,
  devices: SUBVIEW_DISCOVERY,
  voip: SUBVIEW_DNS_ACCESS,
  media: SUBVIEW_MULTICAST,
  "devices-media": SUBVIEW_MULTICAST,
  // Legacy child IDs
  ping: SUBVIEW_PATH_PERFORMANCE,
  traceroute: SUBVIEW_PATH_PERFORMANCE,
  speed: SUBVIEW_PATH_PERFORMANCE,
  monitor: SUBVIEW_PATH_PERFORMANCE,
  tests: SUBVIEW_PATH_PERFORMANCE,
  dns: SUBVIEW_DNS_ACCESS,
  "port-scan": SUBVIEW_DNS_ACCESS,
  scanner: SUBVIEW_DISCOVERY,
  map: SUBVIEW_DISCOVERY,
  history: SUBVIEW_DISCOVERY,
};

const VALID_TABS = [SUBVIEW_PATH_PERFORMANCE, SUBVIEW_DNS_ACCESS, SUBVIEW_DISCOVERY, SUBVIEW_MULTICAST] as const;

const TOOL_ID = "network";

function NetworkSubviewFallback({ label }: { label: string }) {
  return (
    <div className="flex-1 min-h-0 rounded-lg border border-border/30 bg-card/40 p-3">
      <div className="text-xs text-muted-foreground mb-3">{label} loading...</div>
      <div className="h-8 skeleton mb-3" />
      <div className="h-24 skeleton mb-3" />
      <div className="h-24 skeleton" />
    </div>
  );
}

export function NetworkTool() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);
  const [activeTab, setActiveTab] = useState<string>(SUBVIEW_PATH_PERFORMANCE);

  // ── Network Test store ─────────────────────────────────────────

  // ── Network Devices store ──────────────────────────────────────
  const devStatus = useNetworkDevicesStore((s) => s.status);
  const devices = useNetworkDevicesStore((s) => s.devices);
  const handleProgress = useNetworkDevicesStore((s) => s.handleProgress);
  const { success, error: notifyError, warning } = useNotifications();

  // ── Subview routing ────────────────────────────────────────────
  useEffect(() => {
    if (activeToolId !== TOOL_ID) return;
    if (!activeSubviewId) return;

    const tab = LEGACY_MAP[activeSubviewId] ?? activeSubviewId;

    if ((VALID_TABS as readonly string[]).includes(tab)) {
      setActiveTab(tab);
      setLastViewedSubview(TOOL_ID, tab);
    }
    setActiveSubview(null);
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview]);

  useEffect(() => {
    setLastViewedSubview(TOOL_ID, activeTab);
  }, [activeTab, setLastViewedSubview]);

  // ── Device scan progress events ────────────────────────────────
  useEffect(() => {
    const unlisten = listen<ScanProgressEvent>("network-devices-progress", (event) => {
      handleProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleProgress]);

  // ── Device scan notifications ──────────────────────────────────
  const prevStatusRef = useState<string>("idle");
  useEffect(() => {
    if (prevStatusRef[0] === "running" && devStatus === "done") {
      if (devices.length > 0) {
        success(`Scan complete — found ${devices.length} device${devices.length !== 1 ? "s" : ""}`, undefined, { source: "network-devices" });
      } else {
        warning("Scan complete — no devices found", undefined, { source: "network-devices" });
      }
    } else if (prevStatusRef[0] === "running" && devStatus === "error") {
      notifyError("Scan failed", useNetworkDevicesStore.getState().error ?? undefined, { source: "network-devices" });
    }
    prevStatusRef[0] = devStatus;
  }, [devStatus, devices.length, success, warning, notifyError, prevStatusRef]);

  const DEFAULT_EXEC_MAP: Record<string, string> = useMemo(() => ({
    [SUBVIEW_PATH_PERFORMANCE]: "ping",
    [SUBVIEW_DNS_ACCESS]: "dns",
    [SUBVIEW_DISCOVERY]: "deviceScan",
    [SUBVIEW_MULTICAST]: "multicast",
  }), []);

  const [subExecToolId, setSubExecToolId] = useState<string | null>(null);
  const lastTabRef = useRef(activeTab);

  useEffect(() => {
    if (activeTab !== lastTabRef.current) {
      setSubExecToolId(null);
      lastTabRef.current = activeTab;
    }
  }, [activeTab]);

  const execContextToolId = subExecToolId ?? DEFAULT_EXEC_MAP[activeTab] ?? "ping";
  const handleSubExecToolIdChange = useCallback((id: string) => {
    setSubExecToolId(id);
  }, []);
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)} className="flex-1 flex flex-col gap-0 overflow-hidden">
        <ToolHeader
          toolId={TOOL_ID}
          execToolId={execContextToolId}
          items={[
            { id: SUBVIEW_PATH_PERFORMANCE, label: "Routing" },
            { id: SUBVIEW_DNS_ACCESS, label: "Connectivity" },
            { id: SUBVIEW_DISCOVERY, label: "Devices" },
            { id: SUBVIEW_MULTICAST, label: "Multicast" },
          ]}
          value={activeTab}
          onValueChange={setActiveTab}
        />

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabsContent value={SUBVIEW_PATH_PERFORMANCE} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <Suspense fallback={<NetworkSubviewFallback label="Routing" />}>
                <PathReachabilityView toolId={TOOL_ID} onExecToolIdChange={handleSubExecToolIdChange} />
              </Suspense>
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_DNS_ACCESS} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <Suspense fallback={<NetworkSubviewFallback label="Connectivity" />}>
                <NameAccessView toolId={TOOL_ID} onExecToolIdChange={handleSubExecToolIdChange} />
              </Suspense>
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_DISCOVERY} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <Suspense fallback={<NetworkSubviewFallback label="Devices" />}>
                <DiscoveryWorkspaceView toolId={TOOL_ID} onExecToolIdChange={handleSubExecToolIdChange} />
              </Suspense>
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_MULTICAST} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <Suspense fallback={<NetworkSubviewFallback label="Multicast" />}>
                <RealtimeMediaView toolId={TOOL_ID} onExecToolIdChange={handleSubExecToolIdChange} />
              </Suspense>
            </div>
          </TabsContent>
        </div>

      </Tabs>
    </div>
  );
}
