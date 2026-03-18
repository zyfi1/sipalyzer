import { Button } from "@/components/ui/button";
import { Activity, ArrowRight, Radio, Scan } from "@/lib/icons";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { useMulticastStore } from "@/stores/multicastStore";
import { cn } from "@/lib/utils";

const DESTINATIONS = [
  {
    id: "path",
    title: "Routing",
    summary: "Reachability checks and route/latency diagnostics are grouped here.",
  },
  {
    id: "access",
    title: "Connectivity",
    summary: "DNS, NAT/ALG, and port/service accessibility tools now live here.",
  },
  {
    id: "devices-media",
    title: "Devices + Media",
    summary: "Device discovery, VoIP assessment, and multicast monitoring are consolidated here.",
  },
] as const;

interface NetworkOverviewViewProps {
  onNavigate: (tabId: "path" | "access" | "devices-media") => void;
}

export function NetworkOverviewView({ onNavigate }: NetworkOverviewViewProps) {
  const healthCheckStatus = useNetworkTestStore((s) => s.healthCheck.status);
  const bulkRunning = useNetworkTestStore((s) => s.bulkRunning);
  const monitorRunning = useNetworkTestStore((s) => s.monitorRunning);
  const discoveredDevices = useNetworkDevicesStore((s) => s.devices.length);
  const activeGroups = useMulticastStore((s) => s.activeGroups.length);

  const networkTestRunning =
    healthCheckStatus === "running" || bulkRunning || monitorRunning;

  return (
    <div className="flex flex-col gap-4">
      <div className="surface-flat app-view-surface-pad">
        <h3 className="section-label-sm mb-1">Network Tool Information Architecture</h3>
        <p className="text-sm text-muted-foreground">
          Use the sections below to jump directly to the condensed destinations.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {DESTINATIONS.map((item) => (
          <div key={item.id} className="surface-flat app-view-surface-pad flex flex-col gap-3">
            <div>
              <h4 className="text-sm font-semibold">{item.title}</h4>
              <p className="text-xs text-muted-foreground mt-1">{item.summary}</p>
            </div>
            <Button
              size="sm"
              className="w-fit gap-1.5"
              onClick={() => onNavigate(item.id)}
            >
              Open {item.title}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="surface-flat app-view-surface-pad flex items-center gap-2.5">
          <Activity
            className={cn(
              "h-4 w-4",
              networkTestRunning ? "text-success" : "text-muted-foreground/60",
            )}
          />
          <div>
            <p className="section-label-sm">Network Test</p>
            <p className="text-xs text-muted-foreground">
              {networkTestRunning ? "Running now" : "Idle"}
            </p>
          </div>
        </div>

        <div className="surface-flat app-view-surface-pad flex items-center gap-2.5">
          <Scan className="h-4 w-4 text-primary" />
          <div>
            <p className="section-label-sm">Discovered Devices</p>
            <p className="text-xs text-muted-foreground">
              {discoveredDevices} device{discoveredDevices !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="surface-flat app-view-surface-pad flex items-center gap-2.5">
          <Radio className="h-4 w-4 text-primary" />
          <div>
            <p className="section-label-sm">Active Multicast Groups</p>
            <p className="text-xs text-muted-foreground">
              {activeGroups} group{activeGroups !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
