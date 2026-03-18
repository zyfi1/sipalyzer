import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToolStore } from "@/stores/toolStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { useMulticastStore } from "@/stores/multicastStore";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { ViewFooter, ViewFooterItem, ViewFooterSpacer, ViewFooterDivider } from "@/components/layout/ViewFooter";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { cn } from "@/lib/utils";
import { Activity, Clock, Globe, Network, Radio, Scan } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { LiveIndicator } from "@/components/ui/live-indicator";
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
  const healthCheck = useNetworkTestStore((s) => s.healthCheck);
  const bulkRunning = useNetworkTestStore((s) => s.bulkRunning);
  const monitorRunning = useNetworkTestStore((s) => s.monitorRunning);
  const monitorSamples = useNetworkTestStore((s) => s.monitorSamples);

  // ── Network Devices store ──────────────────────────────────────
  const devStatus = useNetworkDevicesStore((s) => s.status);
  const devices = useNetworkDevicesStore((s) => s.devices);
  const probed = useNetworkDevicesStore((s) => s.probed);
  const totalProbes = useNetworkDevicesStore((s) => s.totalProbes);
  const phaseLabel = useNetworkDevicesStore((s) => s.phaseLabel);
  const durationMs = useNetworkDevicesStore((s) => s.durationMs);
  const handleProgress = useNetworkDevicesStore((s) => s.handleProgress);
  const { success, error: notifyError, warning } = useNotifications();

  // ── Multicast store ─────────────────────────────────────────────
  const multicastGroups = useMulticastStore((s) => s.activeGroups);
  const multicastAudioStreams = useMulticastStore((s) => s.audioStreams);
  const multicastAudioPlaying = Object.values(multicastAudioStreams).some((s) => s.playing);
  const multicastGenerators = useMulticastStore((s) => s.generators);
  const multicastGenerating = Object.keys(multicastGenerators).length > 0;

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

  const anyTestRunning = healthCheck.status === "running" || bulkRunning || monitorRunning;
  const devScanning = devStatus === "running";
  const progressPct = totalProbes > 0 ? Math.round((probed / totalProbes) * 100) : 0;
  const isPathTab = activeTab === SUBVIEW_PATH_PERFORMANCE;
  const isAccessTab = activeTab === SUBVIEW_DNS_ACCESS;
  const isDiscoveryTab = activeTab === SUBVIEW_DISCOVERY;
  const isMulticastTab = activeTab === SUBVIEW_MULTICAST;

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

        <ViewFooter>
          {(isPathTab || isAccessTab) ? (
            <>
              {anyTestRunning ? (
                <TooltipWrapper title="Active Operation" description="A network test or monitor is currently running.">
                  <ViewFooterItem>
                    <LiveIndicator variant="dot" size="sm" />
                    <span className="text-foreground font-medium">
                      {monitorRunning ? "Monitoring" : bulkRunning ? "Testing All" : healthCheck.status === "running" ? "Health Check" : "Testing"}
                    </span>
                  </ViewFooterItem>
                </TooltipWrapper>
              ) : (
                <TooltipWrapper title="Status" description="No active network operations in this view.">
                  <ViewFooterItem>
                    <Activity className="h-3 w-3" />
                    <span>Ready</span>
                  </ViewFooterItem>
                </TooltipWrapper>
              )}

              {healthCheck.result && (
                <>
                  <ViewFooterDivider />
                  <TooltipWrapper title="Internet Connectivity" description={healthCheck.result.internet_reachable ? "Internet is reachable from this machine." : "No internet connectivity detected."}>
                    <ViewFooterItem>
                      <Globe className="h-3 w-3" />
                      <span>{healthCheck.result.internet_reachable ? "Online" : "Offline"}</span>
                    </ViewFooterItem>
                  </TooltipWrapper>
                </>
              )}

              <ViewFooterSpacer />

              {isPathTab && monitorSamples.length > 0 && (
                <TooltipWrapper title="Monitor Samples" description={`${monitorSamples.length} latency samples collected by the continuous monitor.`}>
                  <ViewFooterItem>
                    <Network className="h-3 w-3" />
                    <span className="tabular-nums">{monitorSamples.length}</span>
                    <span>samples</span>
                  </ViewFooterItem>
                </TooltipWrapper>
              )}
            </>
          ) : null}

          {isDiscoveryTab ? (
            <>
              {devScanning ? (
                <TooltipWrapper title="Device Scan Progress" description={`${phaseLabel ? `${phaseLabel} — ` : ""}${probed} of ${totalProbes} scan steps complete (${progressPct}%).`}>
                  <ViewFooterItem>
                    <LiveIndicator variant="dot" size="sm" />
                    <span className="text-foreground font-medium">Scanning</span>
                    <span className="tabular-nums">{progressPct}%</span>
                  </ViewFooterItem>
                </TooltipWrapper>
              ) : (
                <TooltipWrapper title="Status" description={devStatus === "done" ? "Last scan completed successfully." : "No active scan in this view."}>
                  <ViewFooterItem>
                    <Activity className="h-3 w-3" />
                    <span>{devStatus === "done" ? "Complete" : "Ready"}</span>
                  </ViewFooterItem>
                </TooltipWrapper>
              )}

              {devices.length > 0 && (
                <>
                  <ViewFooterDivider />
                  <TooltipWrapper title="Discovered Devices" description={`${devices.length} device${devices.length !== 1 ? "s" : ""} found on the local network from the most recent scan.`}>
                    <ViewFooterItem>
                      <Scan className="h-3 w-3" />
                      <span className="tabular-nums">{devices.length}</span>
                      <span>device{devices.length !== 1 ? "s" : ""}</span>
                    </ViewFooterItem>
                  </TooltipWrapper>
                </>
              )}

              <ViewFooterSpacer />

              {totalProbes > 0 && (
                <TooltipWrapper title="Scan Progress" description={`${probed} of ${totalProbes} scan steps completed.`}>
                  <ViewFooterItem>
                    <Network className="h-3 w-3" />
                    <span className="tabular-nums">{probed}/{totalProbes}</span>
                    <span>steps</span>
                  </ViewFooterItem>
                </TooltipWrapper>
              )}

              {durationMs > 0 && (
                <>
                  <ViewFooterDivider />
                  <TooltipWrapper title="Scan Duration" description={`Total elapsed time for the last device scan: ${(durationMs / 1000).toFixed(1)} seconds.`}>
                    <ViewFooterItem>
                      <Clock className="h-3 w-3" />
                      <span className="tabular-nums">{(durationMs / 1000).toFixed(1)}s</span>
                    </ViewFooterItem>
                  </TooltipWrapper>
                </>
              )}
            </>
          ) : null}

          {isMulticastTab ? (
            <>
              {multicastGenerating ? (
                <TooltipWrapper title="Audio Generator" description="Generating and transmitting RTP audio to a multicast group.">
                  <ViewFooterItem>
                    <Radio className="h-3 w-3 text-primary" />
                    <span>Generating</span>
                    <LiveIndicator variant="dot" size="sm" className="ml-1" />
                  </ViewFooterItem>
                </TooltipWrapper>
              ) : (
                <ViewFooterItem>
                  <Activity className="h-3 w-3" />
                  <span>{multicastGroups.length > 0 ? "Listening" : "Ready"}</span>
                </ViewFooterItem>
              )}

              {multicastGroups.length > 0 && (
                <>
                  <ViewFooterDivider />
                  <TooltipWrapper title="Multicast Groups" description={`${multicastGroups.length} active multicast group${multicastGroups.length !== 1 ? "s" : ""}.`}>
                    <ViewFooterItem>
                      <Radio className="h-3 w-3" />
                      <span className="tabular-nums">{multicastGroups.length}</span>
                      <span>group{multicastGroups.length !== 1 ? "s" : ""}</span>
                      {multicastAudioPlaying && (
                        <LiveIndicator variant="dot" size="sm" className="ml-1" />
                      )}
                    </ViewFooterItem>
                  </TooltipWrapper>
                </>
              )}

              <ViewFooterSpacer />
            </>
          ) : null}
        </ViewFooter>
      </Tabs>
    </div>
  );
}
