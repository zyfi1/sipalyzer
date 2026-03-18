import { useState, useEffect } from "react";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";

import { PingView } from "./PingView";
import { TracerouteView } from "./TracerouteView";
import { SpeedTestView } from "./SpeedTestView";
import { MonitorView } from "./MonitorView";
import { MtrView } from "./MtrView";
import { NtpView } from "./NtpView";

const TABS = [
  {
    id: "ping",
    label: "Ping",
    toolId: "ping",
    tip: "ICMP Ping",
    tipDesc: "Send ICMP echo requests to measure round-trip latency, jitter, and packet loss to a target host.",
  },
  {
    id: "traceroute",
    label: "Traceroute",
    toolId: "traceroute",
    tip: "Traceroute",
    tipDesc: "Map the network path hop-by-hop to a destination, showing each router's latency and identifying where delays or drops occur.",
  },
  {
    id: "mtr",
    label: "MTR",
    toolId: "mtr",
    tip: "MTR (Continuous Traceroute)",
    tipDesc: "Combine ping and traceroute in repeated rounds to show per-hop packet loss, latency statistics, and jitter.",
  },
  {
    id: "speed",
    label: "Speed",
    toolId: "speed",
    tip: "Speed & Throughput",
    tipDesc: "Measure internet download/upload speed via HTTP (Cloudflare) and raw UDP throughput to a target host.",
  },
  {
    id: "ntp",
    label: "NTP",
    toolId: "ntp",
    tip: "NTP Time Sync",
    tipDesc: "Check your system clock against NTP servers to detect time drift that can affect SIP authentication and CDR timestamps.",
  },
  {
    id: "monitor",
    label: "Monitor",
    toolId: "monitor",
    tip: "Continuous Monitor",
    tipDesc: "Run an ongoing latency and jitter monitor over time, charting network stability in real time.",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const EXEC_TOOL_MAP: Record<string, string> = Object.fromEntries(
  TABS.map((t) => [t.id, t.toolId]),
);

export function ConnectivityView({ toolId, onExecToolIdChange }: { toolId?: string; onExecToolIdChange?: (id: string) => void }) {
  const [activeTab, setActiveTab] = useState<TabId>("ping");

  useEffect(() => {
    onExecToolIdChange?.(EXEC_TOOL_MAP[activeTab] ?? "ping");
  }, [activeTab, onExecToolIdChange]);
  return (
    <div className="flex flex-col gap-4">
      <ToolSubTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        toolId={toolId}
      />

      {activeTab === "ping" && <PingView />}
      {activeTab === "traceroute" && <TracerouteView />}
      {activeTab === "mtr" && <MtrView />}
      {activeTab === "speed" && <SpeedTestView />}
      {activeTab === "ntp" && <NtpView />}
      {activeTab === "monitor" && <MonitorView />}
    </div>
  );
}
