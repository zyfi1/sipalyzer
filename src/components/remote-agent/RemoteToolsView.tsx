import { useState } from "react";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Play, Check, X, Activity, Network, Globe, Scan, Search, Radio } from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";

interface ToolConfig {
  id: string;
  label: string;
  commandType: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: { key: string; label: string; placeholder: string; defaultValue?: string }[];
}

const REMOTE_TOOLS: ToolConfig[] = [
  {
    id: "ping",
    label: "Ping",
    commandType: "Ping",
    icon: Activity,
    fields: [
      { key: "host", label: "Host", placeholder: "8.8.8.8" },
      { key: "count", label: "Count", placeholder: "4", defaultValue: "4" },
    ],
  },
  {
    id: "traceroute",
    label: "Traceroute",
    commandType: "Traceroute",
    icon: Network,
    fields: [
      { key: "host", label: "Host", placeholder: "8.8.8.8" },
      { key: "max_hops", label: "Max Hops", placeholder: "30", defaultValue: "30" },
    ],
  },
  {
    id: "dns",
    label: "DNS Lookup",
    commandType: "DnsLookup",
    icon: Globe,
    fields: [
      { key: "hostname", label: "Hostname", placeholder: "example.com" },
      { key: "record_type", label: "Type", placeholder: "A", defaultValue: "A" },
      { key: "server", label: "Server", placeholder: "System default" },
    ],
  },
  {
    id: "portscan",
    label: "Port Scan",
    commandType: "PortScan",
    icon: Search,
    fields: [
      { key: "host", label: "Host", placeholder: "192.168.1.1" },
      { key: "ports", label: "Ports", placeholder: "22,80,443,5060-5061" },
    ],
  },
  {
    id: "sip-reg",
    label: "SIP Registration",
    commandType: "SipRegistrationTest",
    icon: Activity,
    fields: [
      { key: "registrar", label: "Registrar", placeholder: "sip.example.com" },
      { key: "username", label: "Username", placeholder: "user" },
      { key: "password", label: "Password", placeholder: "pass" },
      { key: "port", label: "Port", placeholder: "5060", defaultValue: "5060" },
    ],
  },
  {
    id: "sip-probe",
    label: "SIP Probe",
    commandType: "SipProbe",
    icon: Activity,
    fields: [
      { key: "target", label: "Target", placeholder: "sip.example.com" },
      { key: "port", label: "Port", placeholder: "5060", defaultValue: "5060" },
      { key: "method", label: "Method", placeholder: "OPTIONS", defaultValue: "OPTIONS" },
    ],
  },
  {
    id: "stun",
    label: "STUN Test",
    commandType: "StunTest",
    icon: Globe,
    fields: [
      { key: "server", label: "Server", placeholder: "stun.l.google.com:19302", defaultValue: "stun.l.google.com:19302" },
    ],
  },
  {
    id: "packet-capture",
    label: "Packet Capture",
    commandType: "PacketCapture",
    icon: Radio,
    fields: [
      { key: "interface", label: "Interface", placeholder: "Auto-detect (e.g. eth0)" },
      { key: "filter", label: "BPF Filter", placeholder: "e.g. port 5060 or host 10.0.0.1" },
      { key: "max_packets", label: "Max Packets", placeholder: "100", defaultValue: "100" },
      { key: "duration_secs", label: "Duration (s)", placeholder: "30", defaultValue: "30" },
    ],
  },
  {
    id: "device-scan",
    label: "Device Scan",
    commandType: "DeviceScan",
    icon: Scan,
    fields: [
      { key: "network", label: "Network", placeholder: "Auto-detect (or 192.168.1.0/24)" },
    ],
  },
  {
    id: "sysinfo",
    label: "System Info",
    commandType: "SystemInfo",
    icon: Activity,
    fields: [],
  },
];

export function RemoteToolsView() {
  const { connections, selectedAgentId, selectAgent, sendCommand, pendingCommands } =
    useRemoteAgentStore();

  const [toolInputs, setToolInputs] = useState<Record<string, Record<string, string>>>({});

  const selectedAgent = connections.find((c) => c.id === selectedAgentId);

  const setInput = (toolId: string, field: string, value: string) => {
    setToolInputs((prev) => ({
      ...prev,
      [toolId]: { ...(prev[toolId] || {}), [field]: value },
    }));
  };

  const runTool = async (tool: ToolConfig) => {
    if (!selectedAgentId) return;
    const inputs = toolInputs[tool.id] || {};
    const params: Record<string, unknown> = {};

    for (const field of tool.fields) {
      const val = inputs[field.key] || field.defaultValue || "";
      if (val) {
        // Convert numeric fields
        if (["count", "max_hops", "port", "timeout_ms", "max_packets", "duration_secs"].includes(field.key)) {
          params[field.key] = parseInt(val, 10);
        } else {
          params[field.key] = val || undefined;
        }
      }
    }

    try {
      await sendCommand(selectedAgentId, tool.commandType, Object.keys(params).length > 0 ? params : undefined);
    } catch {
      // Handled by store
    }
  };

  // Get the latest result for a tool
  const getToolResult = (toolId: string) => {
    const tool = REMOTE_TOOLS.find((t) => t.id === toolId);
    if (!tool) return null;
    return pendingCommands
      .filter((c) => c.agentId === selectedAgentId && c.type === tool.commandType)
      .at(-1);
  };

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">
      {/* Agent Selector */}
      <div className="ui-surface-card flex items-center gap-3 p-3">
        <span className="text-xs text-muted-foreground font-medium">Agent:</span>
        {connections.length === 0 ? (
          <EmptyState compact variant="inline" title="No agents connected" />
        ) : (
          <select
            value={selectedAgentId || ""}
            onChange={(e) => selectAgent(e.target.value || null)}
            className="ui-control-shell flex-1 h-8 px-2 rounded-lg text-sm"
          >
            <option value="">Select an agent...</option>
            {connections.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.hostname} ({agent.os}) — {agent.ip}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tool Grid */}
      {selectedAgent ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {REMOTE_TOOLS.map((tool) => {
            const Icon = tool.icon;
            const cmd = getToolResult(tool.id);
            const isRunning = cmd?.status === "running";
            const isDone = cmd?.status === "done";
            const isError = cmd?.status === "error";

            return (
              <div key={tool.id} className="ui-surface-card p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-sm font-medium flex-1">{tool.label}</span>
                  {isRunning && (
                    <Badge variant="secondary" className="text-2xs animate-live-breathe motion-reduce:animate-none">
                      Running...
                    </Badge>
                  )}
                  {isDone && (
                    <Check className="h-4 w-4 text-success shrink-0" />
                  )}
                  {isError && (
                    <X className="h-4 w-4 text-destructive shrink-0" />
                  )}
                </div>

                {/* Input fields */}
                {tool.fields.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {tool.fields.map((field) => (
                      <div key={field.key} className="flex items-center gap-2">
                        <span className="text-2xs text-muted-foreground w-16 shrink-0">
                          {field.label}
                        </span>
                        <Input
                          value={toolInputs[tool.id]?.[field.key] ?? field.defaultValue ?? ""}
                          onChange={(e) => setInput(tool.id, field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="h-7 text-xs font-mono flex-1"
                          type={field.key === "password" ? "password" : "text"}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  size="sm"
                  variant="neutral"
                  onClick={() => runTool(tool)}
                  disabled={!!isRunning}
                  className="gap-1.5 self-start"
                >
                  <Play className="h-3 w-3" />
                  Run
                </Button>

                {/* Result display */}
                {cmd?.result != null && (
                  <div className="surface-subtle mt-1 max-h-40 overflow-auto rounded p-2 border border-border/30">
                    <pre className="text-2xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                      {formatResult(cmd.result)}
                    </pre>
                  </div>
                )}
                {cmd?.error && (
                  <div className="surface-subtle mt-1 rounded border border-destructive/20 bg-destructive/5 p-2">
                    <span className="text-2xs text-destructive">{cmd.error}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground/60">Select an agent above to run remote tools</p>
        </div>
      )}
    </div>
  );
}

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result == null) return "";
  try {
    const obj = result as Record<string, unknown>;
    const display = "result" in obj ? obj.result : result;
    return JSON.stringify(display, null, 2);
  } catch {
    return String(result);
  }
}
