import { useMemo, useState, useEffect, useCallback } from "react";
import dagre from "dagre";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type Edge,
  type ReactFlowInstance,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Network, Search, X } from "@/lib/icons";
import { WolButton } from "./WolButton";
import type { DiscoveredDevice } from "@/types/networkDevices";

const TYPE_COLOR: Record<string, string> = {
  phone: "#5B8DEF",
  pbx: "#34D399",
  gateway: "#F59E0B",
  sbc: "#A78BFA",
  proxy: "#22D3EE",
  softphone: "#818CF8",
  switch: "#FBBF24",
  accesspoint: "#F59E0B",
  unknown: "#6B7280",
  router: "#F97316",
  computer: "#60A5FA",
  server: "#38BDF8",
  printer: "#C084FC",
  camera: "#F87171",
  nas: "#2DD4BF",
  iot: "#A3E635",
};

type GroupBy = "type" | "subnet" | "vendor";
type DensityMode = "compact" | "expanded";
const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "type", label: "Type" },
  { value: "subnet", label: "Subnet" },
  { value: "vendor", label: "Vendor" },
];

function guessCategory(d: DiscoveredDevice): string {
  if (d.sip || d.fingerprint.device_type !== "unknown") return d.fingerprint.device_type;
  const v = (d.oui_vendor ?? "").toLowerCase();
  if (/ubiquiti|netgear|tp-link|aruba|ruckus|cisco|juniper|fortinet|palo alto|mikrotik/.test(v)) return "router";
  if (/apple|dell|lenovo|intel|hewlett|microsoft|asus|acer|samsung/.test(v)) return "computer";
  if (/espressif|sonos|roku|amazon|google|tuya|shelly/.test(v)) return "iot";
  return "unknown";
}

function gatewayDevice(devices: DiscoveredDevice[]): DiscoveredDevice | null {
  return (
    devices.find((d) => guessCategory(d) === "gateway") ??
    devices.find((d) => d.ip.endsWith(".1")) ??
    devices.find((d) => guessCategory(d) === "router") ??
    null
  );
}

function groupKey(device: DiscoveredDevice, groupBy: GroupBy): string {
  if (groupBy === "vendor") return device.fingerprint.vendor || device.oui_vendor || "Unknown";
  if (groupBy === "subnet") {
    const parts = device.ip.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : "other";
  }
  return guessCategory(device);
}

function makeDeviceKey(device: DiscoveredDevice): string {
  const mac = (device.mac_address ?? "").trim().toLowerCase();
  if (mac) return `mac:${mac}`;
  return `ip:${device.ip}`;
}

function discoveryLabel(device: DiscoveredDevice): string {
  switch (device.discovery_method) {
    case "both":
      return "ARP+SIP";
    case "sip":
      return "SIP";
    case "arp":
    default:
      return "ARP";
  }
}

function buildGraph(
  devices: DiscoveredDevice[],
  groupBy: GroupBy,
  density: DensityMode,
  newDeviceKeys: Set<string>,
  changedDeviceKeys: Set<string>,
  getLabel: (d: DiscoveredDevice) => string | null,
): { nodes: Node[]; edges: Edge[]; byNodeId: Map<string, DiscoveredDevice> } {
  const gw = gatewayDevice(devices);
  if (!gw) return { nodes: [], edges: [], byNodeId: new Map() };

  const byNodeId = new Map<string, DiscoveredDevice>();
  const dag = new dagre.graphlib.Graph();
  const compact = density === "compact";
  const devWidth = compact ? 180 : 240;
  const devHeight = compact ? 46 : 60;
  const groupWidth = compact ? 150 : 190;
  dag.setGraph({ rankdir: "LR", nodesep: compact ? 28 : 56, ranksep: compact ? 84 : 150, marginx: 20, marginy: 20 });
  dag.setDefaultEdgeLabel(() => ({}));

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const gwId = `dev:${gw.ip}:${gw.port || 0}`;
  byNodeId.set(gwId, gw);
  dag.setNode(gwId, { width: devWidth, height: devHeight });
  nodes.push({
    id: gwId,
    type: "default",
    position: { x: 0, y: 0 },
    data: { label: `Gateway · ${getLabel(gw) ?? gw.hostname ?? gw.ip}` },
    style: { border: `1px solid ${TYPE_COLOR.gateway}`, background: "#111827", color: "#f9fafb", borderRadius: 10, fontSize: compact ? 10 : 12, width: devWidth },
  });

  const remaining = devices.filter((d) => d !== gw);
  const groups = new Map<string, DiscoveredDevice[]>();
  for (const d of remaining) {
    const key = groupKey(d, groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, list], idx) => {
    const groupId = `group:${idx}:${key}`;
    dag.setNode(groupId, { width: groupWidth, height: compact ? 36 : 44 });
    nodes.push({
      id: groupId,
      position: { x: 0, y: 0 },
      data: { label: `${key} (${list.length})` },
      style: { border: "1px solid #374151", background: "#0b1220", color: "#d1d5db", borderRadius: 8, fontSize: compact ? 10 : 11, width: groupWidth },
    });
    dag.setEdge(gwId, groupId);
    edges.push({
      id: `e:${gwId}:${groupId}`,
      source: gwId,
      target: groupId,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#475569" },
      style: { stroke: "#475569", strokeWidth: 1.25 },
    });

    list.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })).forEach((d) => {
      const id = `dev:${d.ip}:${d.port || 0}`;
      byNodeId.set(id, d);
      const cat = guessCategory(d);
      const deviceKey = makeDeviceKey(d);
      const statusTag = newDeviceKeys.has(deviceKey) ? " [NEW]" : changedDeviceKeys.has(deviceKey) ? " [CHANGED]" : "";
      dag.setNode(id, { width: devWidth, height: devHeight });
      nodes.push({
        id,
        position: { x: 0, y: 0 },
        data: { label: `${getLabel(d) ?? d.hostname ?? d.ip}${statusTag}\n${d.ip}` },
        style: {
          border: `1px solid ${TYPE_COLOR[cat] ?? TYPE_COLOR.unknown}`,
          background: newDeviceKeys.has(deviceKey) ? "#052e16" : changedDeviceKeys.has(deviceKey) ? "#3f1d0b" : "#0f172a",
          color: "#e5e7eb",
          borderRadius: 10,
          fontSize: compact ? 10 : 11,
          width: devWidth,
          whiteSpace: "pre-line",
        },
      });
      dag.setEdge(groupId, id);
      edges.push({
        id: `e:${groupId}:${id}`,
        source: groupId,
        target: id,
        type: "smoothstep",
        label: discoveryLabel(d),
        labelStyle: { fill: "#9ca3af", fontSize: compact ? 9 : 10 },
        labelBgStyle: { fill: "#0b1220", fillOpacity: 0.85 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "#334155" },
        style: { stroke: "#334155", strokeWidth: 1.1 },
      });
    });
  });

  dagre.layout(dag);
  const outNodes = nodes.map((n) => {
    const p = dag.node(n.id);
    return {
      ...n,
      position: { x: p.x - p.width / 2, y: p.y - p.height / 2 },
      sourcePosition: "right",
      targetPosition: "left",
    } as Node;
  });
  return { nodes: outNodes, edges, byNodeId };
}

function DevicePanel({ device }: { device: DiscoveredDevice }) {
  return (
    <div className="surface absolute top-3 right-3 z-10 w-80 overflow-hidden">
      <div className="p-4 space-y-2.5 text-xs">
        <p className="text-sm font-semibold">{device.hostname ?? device.ip}</p>
        <p className="font-mono text-muted-foreground">{device.ip}</p>
        <p className="text-muted-foreground">Vendor: {(device.oui_vendor ?? device.fingerprint.vendor) || "Unknown"}</p>
        <p className="text-muted-foreground">Type: {device.fingerprint.device_type}</p>
        <p className="text-muted-foreground">Open services: {device.open_ports.length}</p>
        {device.mac_address && <WolButton mac={device.mac_address} className="pt-2 border-t border-border/20" />}
      </div>
    </div>
  );
}

export function NetworkMapView() {
  const devices = useNetworkDevicesStore((s) => s.devices);
  const newDeviceKeys = useNetworkDevicesStore((s) => s.newDeviceKeys);
  const changedDeviceKeys = useNetworkDevicesStore((s) => s.changedDeviceKeys);
  const getDeviceLabel = useNetworkDevicesStore((s) => s.getDeviceLabel);
  const selectedMapDeviceIp = useNetworkDevicesStore((s) => s.selectedMapDeviceIp);
  const offlineDevices = useNetworkDevicesStore((s) => s.offlineDevices);
  const mapFocusOffline = useNetworkDevicesStore((s) => s.mapFocusOffline);
  const clearMapFocus = useNetworkDevicesStore((s) => s.clearMapFocus);

  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [density, setDensity] = useState<DensityMode>("expanded");
  const [selected, setSelected] = useState<DiscoveredDevice | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);

  const graph = useMemo(
    () => buildGraph(devices, groupBy, density, new Set(newDeviceKeys), new Set(changedDeviceKeys), getDeviceLabel),
    [devices, groupBy, density, newDeviceKeys, changedDeviceKeys, getDeviceLabel],
  );
  const nodes = graph.nodes;
  const edges = graph.edges;

  useEffect(() => {
    if (!rf || !selectedMapDeviceIp) return;
    const target = nodes.find((n) => n.id.startsWith(`dev:${selectedMapDeviceIp}:`));
    if (!target) return;
    const d = graph.byNodeId.get(target.id) ?? null;
    if (d) setSelected(d);
    rf.setCenter(target.position.x + 120, target.position.y + 30, { zoom: 1.1, duration: 300 });
  }, [rf, selectedMapDeviceIp, nodes, graph.byNodeId]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (!node.id.startsWith("dev:")) return;
    const d = graph.byNodeId.get(node.id) ?? null;
    setSelected(d);
  }, [graph.byNodeId]);

  const focusSearch = useCallback(() => {
    if (!rf || !searchQuery.trim()) return;
    const q = searchQuery.toLowerCase();
    const node = nodes.find((n) => {
      const d = graph.byNodeId.get(n.id);
      if (!d) return false;
      return d.ip.toLowerCase().includes(q) || (d.hostname ?? "").toLowerCase().includes(q) || (d.oui_vendor ?? "").toLowerCase().includes(q);
    });
    if (!node) return;
    const d = graph.byNodeId.get(node.id) ?? null;
    setSelected(d);
    rf.setCenter(node.position.x + 110, node.position.y + 28, { zoom: 1.15, duration: 260 });
  }, [rf, searchQuery, nodes, graph.byNodeId]);

  if (devices.length === 0 || nodes.length === 0) {
    return (
      <div className="flex-1 min-h-0 p-4">
        <EmptyState
          variant="inline"
          icon={<Network />}
          title="No devices to display"
          description="Run a scan to discover devices and view the topology."
          className="h-full min-h-0 p-6"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 relative">
      <div className="surface absolute top-3 left-3 z-10 flex items-center gap-1 p-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && focusSearch()}
            placeholder="Find host..."
            className="ui-control-shell h-8 w-40 pl-8 pr-6 text-2xs"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground">
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        <div className="h-4 w-px bg-border/40 mx-0.5" />
        <div className="subview-tabs-compact">
          {GROUP_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setGroupBy(o.value)}
              data-state={groupBy === o.value ? "active" : "inactive"}
              className="subview-tab-compact !h-7 !px-2"
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-border/40 mx-0.5" />
        <div className="subview-tabs-compact">
          {(["compact", "expanded"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDensity(mode)}
              data-state={density === mode ? "active" : "inactive"}
              className="subview-tab-compact !h-7 !px-2 capitalize"
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <Badge variant="secondary" className="text-2xs font-mono tabular-nums">{devices.length} devices</Badge>
      </div>

      {mapFocusOffline && offlineDevices.length > 0 && (
        <div className="surface absolute top-3 right-3 z-10 w-72 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/40 flex items-center justify-between">
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Offline Devices ({offlineDevices.length})</p>
            <button type="button" onClick={clearMapFocus} className="text-muted-foreground/70 hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto px-3 py-2 space-y-1">
            {offlineDevices.map((d) => (
              <div key={`${d.ip}:${d.port || 0}`} className="text-2xs">
                <p className="font-mono text-foreground/85">{d.ip} <span className="text-warning/80">[OFFLINE]</span></p>
                <p className="text-muted-foreground truncate">{d.hostname ?? d.oui_vendor ?? "Previously seen host"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && <DevicePanel device={selected} />}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        onInit={setRf}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{ type: "smoothstep" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#243244" gap={24} />
        <MiniMap zoomable pannable nodeStrokeWidth={2} />
        <Controls />
        <Panel position="bottom-left" className="surface px-2 py-1 text-2xs text-muted-foreground">
          Click a host to inspect details.
        </Panel>
      </ReactFlow>
    </div>
  );
}
