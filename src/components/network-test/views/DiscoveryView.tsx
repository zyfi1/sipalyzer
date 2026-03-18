import { useState, useEffect, lazy, Suspense } from "react";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";

import { ScannerView } from "@/components/network-devices/ScannerView";
import { ScanHistoryView } from "@/components/network-devices/ScanHistoryView";

const NetworkMapView = lazy(() =>
  import("@/components/network-devices/NetworkMapView").then((m) => ({ default: m.NetworkMapView })),
);

const SnmpPanel = lazy(() => import("./SnmpPanel"));

const DISC_TABS = [
  { id: "scanner", label: "Device Scanner", execToolId: "deviceScan", tip: "Device Scanner", tipDesc: "Scan your local network to discover devices, identify vendors via OUI, detect open services, and grab banners." },
  { id: "map", label: "Topology Map", execToolId: "deviceScan", tip: "Network Map", tipDesc: "Visual topology diagram of discovered devices arranged around the gateway, grouped by type, subnet, or vendor." },
  { id: "history", label: "Scan History", execToolId: "deviceScan", tip: "Scan History", tipDesc: "Browse previous scan results with timestamps, device counts, and the ability to reload past snapshots." },
  { id: "snmp", label: "SNMP Polling", execToolId: "snmpPoll", tip: "SNMP Poller", tipDesc: "Poll a device via SNMP to retrieve system info, interface statistics, and operational status." },
] as const;

type DiscTab = (typeof DISC_TABS)[number]["id"];

const DISC_EXEC_MAP: Record<string, string> = Object.fromEntries(
  DISC_TABS.map((t) => [t.id, t.execToolId]),
);

export function DiscoveryView({ toolId, onExecToolIdChange }: { toolId?: string; onExecToolIdChange?: (id: string) => void }) {
  const [activeTab, setActiveTab] = useState<DiscTab>("scanner");
  const status = useNetworkDevicesStore((s) => s.status);
  const requestMapTab = useNetworkDevicesStore((s) => s.requestMapTab);
  const clearMapRequest = useNetworkDevicesStore((s) => s.clearMapRequest);
  const canViewMap = status === "done";
  const visibleTabs = canViewMap ? DISC_TABS : DISC_TABS.filter((tab) => tab.id !== "map");

  useEffect(() => {
    if (requestMapTab && canViewMap) {
      setActiveTab("map");
    }
    if (requestMapTab) clearMapRequest();
  }, [requestMapTab, canViewMap, clearMapRequest]);

  useEffect(() => {
    if (activeTab === "map" && !canViewMap) {
      setActiveTab("scanner");
    }
  }, [activeTab, canViewMap]);

  useEffect(() => {
    onExecToolIdChange?.(DISC_EXEC_MAP[activeTab] ?? "deviceScan");
  }, [activeTab, onExecToolIdChange]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ToolSubTabs
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        toolId={toolId}
      />

      {activeTab === "scanner" && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <ScannerView />
        </div>
      )}
      {canViewMap && activeTab === "map" && (
        <div className="surface-flat flex-1 min-h-[500px] overflow-hidden">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-muted-foreground py-20">Loading map…</div>}>
            <NetworkMapView />
          </Suspense>
        </div>
      )}
      {activeTab === "history" && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <ScanHistoryView />
        </div>
      )}
      {activeTab === "snmp" && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <Suspense fallback={<div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>}>
            <SnmpPanel />
          </Suspense>
        </div>
      )}
    </div>
  );
}
