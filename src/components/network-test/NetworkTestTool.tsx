import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useToolStore } from "@/stores/toolStore";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { cn } from "@/lib/utils";
import { AlertCircle } from "@/lib/icons";
import type { NetworkCapabilityReport } from "@/types/networkTest";
import { networkGetCapabilities } from "@/api/networkTest";

import { PingView } from "./views/PingView";
import { TracerouteView } from "./views/TracerouteView";
import { DnsToolView } from "./views/DnsToolView";
import { PortScanView } from "./views/PortScanView";
import { SpeedTestView } from "./views/SpeedTestView";
import { DiscoveryView } from "./views/DiscoveryView";
import { VoipView } from "./VoipView";
import { MonitorView } from "./views/MonitorView";

const SUBVIEW_PING = "ping";
const SUBVIEW_TRACEROUTE = "traceroute";
const SUBVIEW_DNS = "dns";
const SUBVIEW_PORT_SCAN = "port-scan";
const SUBVIEW_SPEED = "speed";
const SUBVIEW_DISCOVERY = "discovery";
const SUBVIEW_VOIP = "voip";
const SUBVIEW_MONITOR = "monitor";

const VALID_SUBVIEWS = [
  SUBVIEW_PING,
  SUBVIEW_TRACEROUTE,
  SUBVIEW_DNS,
  SUBVIEW_PORT_SCAN,
  SUBVIEW_SPEED,
  SUBVIEW_DISCOVERY,
  SUBVIEW_VOIP,
  SUBVIEW_MONITOR,
] as const;

export function NetworkTestTool() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);
  const [activeTab, setActiveTab] = useState<string>(SUBVIEW_PING);
  const [capabilities, setCapabilities] = useState<NetworkCapabilityReport | null>(null);

  useEffect(() => {
    if (activeToolId !== "network-test") return;
    if (activeSubviewId && VALID_SUBVIEWS.includes(activeSubviewId as (typeof VALID_SUBVIEWS)[number])) {
      setActiveTab(activeSubviewId);
      setLastViewedSubview("network-test", activeSubviewId);
      setActiveSubview(null);
    }
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview]);

  useEffect(() => {
    setLastViewedSubview("network-test", activeTab);
  }, [activeTab, setLastViewedSubview]);

  useEffect(() => {
    let cancelled = false;
    networkGetCapabilities()
      .then((report) => {
        if (!cancelled) setCapabilities(report);
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const DEFAULT_EXEC_MAP: Record<string, string> = useMemo(() => ({
    [SUBVIEW_PING]: "ping",
    [SUBVIEW_TRACEROUTE]: "traceroute",
    [SUBVIEW_DNS]: "dns",
    [SUBVIEW_PORT_SCAN]: "portScan",
    [SUBVIEW_SPEED]: "speed",
    [SUBVIEW_DISCOVERY]: "deviceScan",
    [SUBVIEW_VOIP]: "voip",
    [SUBVIEW_MONITOR]: "monitor",
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
          toolId="network-test"
          execToolId={execContextToolId}
          items={[
            { id: SUBVIEW_PING, label: "Ping" },
            { id: SUBVIEW_TRACEROUTE, label: "Traceroute" },
            { id: SUBVIEW_DNS, label: "DNS" },
            { id: SUBVIEW_PORT_SCAN, label: "Port Scan" },
            { id: SUBVIEW_SPEED, label: "Speed" },
            { id: SUBVIEW_DISCOVERY, label: "Discovery" },
            { id: SUBVIEW_VOIP, label: "VoIP" },
            { id: SUBVIEW_MONITOR, label: "Monitor" },
          ]}
          value={activeTab}
          onValueChange={setActiveTab}
        />

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {capabilities && (!capabilities.tracerouteSupported || !capabilities.mtrSupported || !capabilities.wifiSupported) && (
            <div className="mx-3 mt-3 mb-0 ui-surface-card p-2.5 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground min-w-0">
                <p className="font-medium text-foreground mb-0.5">
                  Network tool capability limits detected ({capabilities.platform})
                </p>
                {!capabilities.tracerouteSupported && (
                  <p>Traceroute: unavailable{capabilities.tracerouteReason ? ` — ${capabilities.tracerouteReason}` : ""}</p>
                )}
                {!capabilities.mtrSupported && (
                  <p>MTR: unavailable{capabilities.mtrReason ? ` — ${capabilities.mtrReason}` : ""}</p>
                )}
                {!capabilities.wifiSupported && (
                  <p>Wi-Fi info: unavailable{capabilities.wifiReason ? ` — ${capabilities.wifiReason}` : ""}</p>
                )}
              </div>
            </div>
          )}
          <TabsContent value={SUBVIEW_PING} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <PingView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_TRACEROUTE} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <TracerouteView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_DNS} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <DnsToolView toolId="network-test" onExecToolIdChange={handleSubExecToolIdChange} />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_PORT_SCAN} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <PortScanView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_SPEED} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <SpeedTestView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_DISCOVERY} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <DiscoveryView toolId="network-test" onExecToolIdChange={handleSubExecToolIdChange} />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_VOIP} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <VoipView />
            </div>
          </TabsContent>
          <TabsContent value={SUBVIEW_MONITOR} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto app-view-gutter">
              <MonitorView />
            </div>
          </TabsContent>
        </div>

      </Tabs>
    </div>
  );
}
