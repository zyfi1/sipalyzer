import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useMcpStore } from "@/stores/mcpStore";
import { navigateTo } from "@/lib/navigation";

const DEFAULT_ARGS = `{"query":"registration failure 401"}`;
const DEFAULT_OBJECTIVE = "Investigate and summarize SIP registration failures with concrete next actions.";

type SetupMode = "quick" | "advanced";
type Transport = "stdio" | "network";
type OrchestrationStrategy = "parallel" | "round-robin" | "primary-fallback";

const PRESET_PROFILES: Array<{
  id: string;
  name: string;
  transport: Transport;
  endpoint: string | null;
  command: string | null;
  description: string;
}> = [
  {
    id: "local-mcp-stdio",
    name: "Local MCP (stdio)",
    transport: "stdio",
    endpoint: null,
    command: "node ./mcp-server.js",
    description: "Run a local MCP server process from command line.",
  },
  {
    id: "remote-mcp-http",
    name: "Remote MCP (HTTP)",
    transport: "network",
    endpoint: "http://127.0.0.1:9595",
    command: null,
    description: "Connect to a remote/network MCP endpoint over HTTP.",
  },
  {
    id: "remote-mcp-tcp",
    name: "Remote MCP (TCP)",
    transport: "network",
    endpoint: "tcp://127.0.0.1:9595",
    command: null,
    description: "Connect to a low-latency TCP MCP endpoint.",
  },
];

const AGENT_ROLE_POOL = ["Planner", "Researcher", "Verifier", "Synthesizer"] as const;
const SETUP_STEPS = ["Create profile", "Validate connection", "Connect + sync", "Run mission"] as const;

function isStrategy(value: string): value is OrchestrationStrategy {
  return value === "parallel" || value === "round-robin" || value === "primary-fallback";
}

function isActivityFilter(value: string): value is "all" | "info" | "error" {
  return value === "all" || value === "info" || value === "error";
}

export function McpView() {
  const {
    profiles,
    statuses,
    toolsByServer,
    resourcesByServer,
    promptsByServer,
    hostedState,
    activity,
    selectedServerId,
    orchestrationInFlight,
    refreshAll,
    setSelectedServer,
    upsertProfile,
    deleteProfile,
    connectServer,
    testServer,
    disconnectServer,
    loadCatalog,
    callTool,
    orchestrate,
    startHostedServer,
    stopHostedServer,
    clearActivity,
  } = useMcpStore();

  const [setupMode, setSetupMode] = useState<SetupMode>("quick");
  const [name, setName] = useState("Primary MCP");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [endpoint, setEndpoint] = useState("");
  const [command, setCommand] = useState("");
  const [toolName, setToolName] = useState("search_knowledge_base");
  const [toolArgs, setToolArgs] = useState(DEFAULT_ARGS);
  const [callOutput, setCallOutput] = useState("");
  const [missionObjective, setMissionObjective] = useState(DEFAULT_OBJECTIVE);
  const [strategy, setStrategy] = useState<OrchestrationStrategy>("round-robin");
  const [hostNetwork, setHostNetwork] = useState(true);
  const [hostStdio, setHostStdio] = useState(true);
  const [setupStatus, setSetupStatus] = useState<"idle" | "testing" | "connecting" | "ready">("idle");
  const [savingProfile, setSavingProfile] = useState(false);
  const [multiAgentSummary, setMultiAgentSummary] = useState<string>("");
  const [activityFilter, setActivityFilter] = useState<"all" | "info" | "error">("all");
  const [lastConnectedServerId, setLastConnectedServerId] = useState<string | null>(null);

  const selectedServer = useMemo(
    () => profiles.find((p) => p.id === selectedServerId) ?? null,
    [profiles, selectedServerId],
  );

  const selectedStatus = useMemo(
    () => statuses.find((s) => s.serverId === selectedServerId) ?? null,
    [statuses, selectedServerId],
  );

  const selectedTools = selectedServerId ? toolsByServer[selectedServerId] ?? [] : [];
  const selectedResources = selectedServerId ? resourcesByServer[selectedServerId] ?? [] : [];
  const selectedPrompts = selectedServerId ? promptsByServer[selectedServerId] ?? [] : [];
  const connectedServers = useMemo(() => statuses.filter((status) => status.connected), [statuses]);
  const filteredActivity = useMemo(
    () => activity.filter((entry) => activityFilter === "all" || entry.level === activityFilter),
    [activity, activityFilter],
  );
  const setupProgressIndex = useMemo(() => {
    if (connectedServers.length > 0 && selectedTools.length > 0) return 3;
    if (connectedServers.length > 0) return 2;
    if (setupStatus === "ready" || setupStatus === "testing" || setupStatus === "connecting") return 1;
    if (profiles.length > 0) return 0;
    return 0;
  }, [connectedServers.length, selectedTools.length, setupStatus, profiles.length]);
  const canSaveProfile = name.trim().length > 1 && (transport === "network" ? endpoint.trim().length > 0 : command.trim().length > 0);
  const missionReady = connectedServers.length > 0 && toolName.trim().length > 0;
  const hostedTransportEnabled = hostNetwork || hostStdio;
  const formDirty = useMemo(() => {
    if (!selectedServer) return false;
    return (
      selectedServer.name !== name ||
      selectedServer.transport !== transport ||
      (selectedServer.endpoint ?? "") !== endpoint ||
      (selectedServer.command ?? "") !== command
    );
  }, [selectedServer, name, transport, endpoint, command]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedServerId && profiles.length > 0) {
      setSelectedServer(profiles[0]!.id);
    }
  }, [profiles, selectedServerId, setSelectedServer]);

  useEffect(() => {
    if (!selectedServer) return;
    setName(selectedServer.name);
    setTransport(selectedServer.transport === "network" ? "network" : "stdio");
    setEndpoint(selectedServer.endpoint ?? "");
    setCommand(selectedServer.command ?? "");
  }, [selectedServer]);

  const saveProfile = async () => {
    if (!canSaveProfile) return;
    setSavingProfile(true);
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "mcp-server";
    try {
      await upsertProfile({
        id,
        name,
        transport,
        endpoint: endpoint || null,
        command: command || null,
        args: [],
        env: {},
        enabled: true,
      });
      setSelectedServer(id);
      setSetupStatus("idle");
    } finally {
      setSavingProfile(false);
    }
  };

  const runCall = async () => {
    if (!selectedServerId) return;
    try {
      JSON.parse(toolArgs.trim() || "{}");
    } catch {
      setCallOutput("Invalid JSON arguments. Please fix JSON before running.");
      return;
    }
    const result = await callTool(selectedServerId, toolName, toolArgs.trim() || "{}");
    if (result) setCallOutput(result.contentJson);
  };

  const testAndConnect = async () => {
    if (!selectedServerId || formDirty) return;
    setSetupStatus("testing");
    const testResult = await testServer(selectedServerId);
    if (!testResult?.ok) {
      setSetupStatus("idle");
      return;
    }
    setSetupStatus("connecting");
    const connected = await connectServer(selectedServerId);
    if (!connected) {
      setSetupStatus("idle");
      return;
    }
    const loaded = await loadCatalog(selectedServerId);
    if (!loaded) {
      setSetupStatus("idle");
      return;
    }
    setSetupStatus("ready");
    setLastConnectedServerId(selectedServerId);
  };

  const applyPreset = (presetId: string) => {
    const preset = PRESET_PROFILES.find((item) => item.id === presetId);
    if (!preset) return;
    setName(preset.name);
    setTransport(preset.transport);
    setEndpoint(preset.endpoint ?? "");
    setCommand(preset.command ?? "");
    setSetupMode("quick");
  };

  const buildOrchestrationTasks = () => {
    if (!connectedServers.length) return [];
    const resolveRole = (index: number): string => {
      if (strategy === "primary-fallback") {
        return index === 0 ? "Primary" : "Fallback";
      }
      return AGENT_ROLE_POOL[index % AGENT_ROLE_POOL.length] ?? "Planner";
    };
    return connectedServers.map((server, index) => ({
      serverId: server.serverId,
      toolName,
      argumentsJson: toolArgs.trim() || "{}",
      agentRole: resolveRole(index),
      objective: missionObjective,
    }));
  };

  const runMultiAgent = async () => {
    const tasks = buildOrchestrationTasks();
    if (!tasks.length) return;
    try {
      JSON.parse(toolArgs.trim() || "{}");
    } catch {
      setCallOutput("Invalid JSON arguments. Please fix JSON before launching multi-agent mission.");
      return;
    }
    const result = await orchestrate(tasks);
    if (result) {
      setCallOutput(JSON.stringify(result, null, 2));
      setMultiAgentSummary(
        `${result.succeededTasks}/${result.totalTasks} agents completed mission "${missionObjective}"`,
      );
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-8 min-h-full">
      <div className="ui-panel-shell rounded-md px-5 py-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">MCP Mission Control</p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Enterprise-grade MCP orchestration built into Tools. Set up in minutes, run single-server tests,
              then launch coordinated multi-agent missions across your connected MCP fleet.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Badge variant="secondary">{profiles.length} profiles</Badge>
            <Badge variant="secondary">{connectedServers.length} connected</Badge>
            <Badge variant={setupStatus === "ready" ? "default" : "secondary"}>
              Setup: {setupStatus}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {PRESET_PROFILES.map((preset) => (
            <Button key={preset.id} size="sm" variant="secondary" onClick={() => applyPreset(preset.id)}>
              {preset.name}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => navigateTo("composer", "docs")}>
            MCP docs
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {SETUP_STEPS.map((label, idx) => {
            const active = idx <= setupProgressIndex;
            return (
              <div
                key={label}
                className={`rounded-md border px-3 py-2 text-2xs transition ${
                  active ? "border-border bg-accent/30 text-foreground" : "border-border/30 text-muted-foreground"
                }`}
              >
                <p className="font-semibold">{idx + 1}. {label}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="ui-panel-shell rounded-md px-5 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Guided Setup</p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={setupMode === "quick" ? "secondary" : "ghost"}
                onClick={() => setSetupMode("quick")}
              >
                Quick
              </Button>
              <Button
                size="sm"
                variant={setupMode === "advanced" ? "secondary" : "ghost"}
                onClick={() => setSetupMode("advanced")}
              >
                Advanced
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Profile name" />
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value === "network" ? "network" : "stdio")}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="stdio">Local stdio server</option>
              <option value="network">Remote network server</option>
            </select>
            {transport === "network" ? (
              <Input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="http://127.0.0.1:9595 or tcp://127.0.0.1:9595"
                className="col-span-2"
              />
            ) : (
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="node ./mcp-server.js"
                className="col-span-2"
              />
            )}
            {setupMode === "advanced" && (
              <p className="col-span-2 text-2xs text-muted-foreground">
                Advanced mode keeps direct transport controls visible for power users.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void saveProfile()} size="sm" disabled={savingProfile || !canSaveProfile}>
              {savingProfile ? "Saving..." : "Save profile"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedServerId || formDirty}
              onClick={() => void testAndConnect()}
            >
              Test + Connect
            </Button>
            <Button size="sm" variant="ghost" disabled={!selectedServerId} onClick={() => selectedServerId && void deleteProfile(selectedServerId)}>
              Delete
            </Button>
          </div>
          <p className="text-2xs text-muted-foreground">
            Tip: choose a preset, fill one field, Save profile, then Test + Connect.
          </p>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {profiles.map((profile) => {
              const status = statuses.find((s) => s.serverId === profile.id);
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedServer(profile.id)}
                  className={`w-full text-left rounded-md border px-3 py-2 transition ${selectedServerId === profile.id ? "border-border bg-accent/30" : "border-border/30 hover:bg-muted/20"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{profile.name}</span>
                    <Badge variant="secondary">{profile.transport}</Badge>
                  </div>
                  <div className="text-2xs text-muted-foreground mt-1">
                    {status?.connected ? "Connected" : "Disconnected"}
                  </div>
                </button>
              );
            })}
          </div>
          {setupMode === "advanced" ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={!selectedServerId} onClick={() => selectedServerId && void connectServer(selectedServerId)}>
                Connect
              </Button>
              <Button size="sm" variant="secondary" disabled={!selectedServerId} onClick={() => selectedServerId && void testServer(selectedServerId)}>
                Test
              </Button>
              <Button size="sm" variant="ghost" disabled={!selectedServerId} onClick={() => selectedServerId && void disconnectServer(selectedServerId)}>
                Disconnect
              </Button>
              <Button size="sm" variant="ghost" disabled={!selectedServerId} onClick={() => selectedServerId && void loadCatalog(selectedServerId)}>
                Refresh Catalog
              </Button>
            </div>
          ) : null}
          {formDirty ? (
            <div className="rounded-md border border-border/30 p-2 text-2xs text-amber-300">
              Unsaved profile edits detected. Save profile before Test + Connect.
            </div>
          ) : null}
          <div className="rounded-md border border-border/30 p-2 text-2xs text-muted-foreground">
            {selectedServerId == null
              ? "Select or create a profile to begin."
              : setupStatus === "testing"
                ? "Testing connectivity..."
                : setupStatus === "connecting"
                  ? "Connecting and syncing catalog..."
                  : setupStatus === "ready"
                    ? `Ready. ${lastConnectedServerId ?? selectedServerId} passed setup.`
                    : "Profile saved. Run Test + Connect when ready."}
          </div>
        </div>

        <div className="ui-panel-shell rounded-md px-5 py-4 flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Hosted MCP Server</p>
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <Switch checked={hostStdio} onCheckedChange={setHostStdio} />
              stdio
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <Switch checked={hostNetwork} onCheckedChange={setHostNetwork} />
              network
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!hostedTransportEnabled}
              onClick={() => void startHostedServer({ stdioEnabled: hostStdio, networkEnabled: hostNetwork })}
            >
              Start Hosted Server
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void stopHostedServer()}>
              Stop
            </Button>
          </div>
          <div className="rounded-md border border-border/30 p-3 text-xs">
            {hostedState ? (
              <div className="space-y-1">
                <p>Bind: {hostedState.networkBind}:{hostedState.networkPort}</p>
                <p>Token: {hostedState.authToken}</p>
                <p>Published tools: {hostedState.publishedToolCount}</p>
              </div>
            ) : (
              <p className="text-muted-foreground">Hosted server is stopped.</p>
            )}
          </div>
          <p className="text-2xs text-muted-foreground">
            Hosted mode lets external clients connect to SIPalyzer over stdio and/or secured network transport.
          </p>
          <div className="rounded-md border border-border/30 p-2 text-2xs text-muted-foreground">
            Recommended for production: enable network + rotate auth token regularly.
          </div>
          {!hostedTransportEnabled ? (
            <div className="rounded-md border border-border/30 p-2 text-2xs text-destructive">
              Enable at least one transport before starting hosted server.
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="ui-panel-shell rounded-md px-5 py-4 flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Catalog</p>
          <p className="text-2xs text-muted-foreground">
            {selectedServer?.name ?? "Select a server"} {selectedStatus?.connected ? "(connected)" : "(offline)"}
          </p>
          <div className="grid grid-cols-3 gap-2 text-2xs">
            <div className="rounded border border-border/30 p-2">Tools: {selectedTools.length}</div>
            <div className="rounded border border-border/30 p-2">Resources: {selectedResources.length}</div>
            <div className="rounded border border-border/30 p-2">Prompts: {selectedPrompts.length}</div>
          </div>
          <div className="max-h-44 overflow-y-auto space-y-1 text-2xs">
            {selectedTools.map((tool) => (
              <div key={`${tool.serverId}:${tool.name}`} className="rounded border border-border/30 px-2 py-1">
                <p className="font-medium">{tool.name}</p>
                <p className="text-muted-foreground">{tool.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="ui-panel-shell rounded-md px-5 py-4 flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Playground + Multi-Agent</p>
          <Input value={missionObjective} onChange={(e) => setMissionObjective(e.target.value)} placeholder="Mission objective" />
          <select
            value={strategy}
            onChange={(e) => setStrategy(isStrategy(e.target.value) ? e.target.value : "round-robin")}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="parallel">Parallel Blitz (all agents in parallel)</option>
            <option value="round-robin">Role Rotation (planner/researcher/verifier/synthesizer)</option>
            <option value="primary-fallback">Primary + Fallback</option>
          </select>
          <Input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="Tool name" />
          <textarea
            value={toolArgs}
            onChange={(e) => setToolArgs(e.target.value)}
            className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-xs"
            placeholder='{"key":"value"}'
          />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!selectedServerId} onClick={() => void runCall()}>
              Run on selected server
            </Button>
            <Button size="sm" variant="secondary" disabled={orchestrationInFlight || !missionReady} onClick={() => void runMultiAgent()}>
              Launch multi-agent mission
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigateTo("composer", "docs")}>
              Open MCP docs
            </Button>
          </div>
          <div className="rounded-md border border-border/30 p-2 text-2xs text-muted-foreground">
            {multiAgentSummary || (
              <EmptyState
                compact
                variant="inline"
                title="No mission launched yet"
                description="Connect two or more servers for multi-agent orchestration."
              />
            )}
          </div>
          <div className="rounded-md border border-border/30 p-2 text-2xs text-muted-foreground">
            Strategy: {strategy}. Connected agents: {connectedServers.length}. Tool: {toolName || "none"}.
          </div>
          {callOutput ? (
            <pre className="text-2xs rounded-md border border-border/30 bg-muted/20 p-3 max-h-44 overflow-auto">{callOutput}</pre>
          ) : (
            <div className="rounded-md border border-border/30 bg-muted/20 p-3">
              <EmptyState compact variant="inline" title="No output yet" description="Run a tool call to view output." />
            </div>
          )}
        </div>
      </div>

      <div className="ui-panel-shell rounded-md px-5 py-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Activity</p>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{activity.length}</Badge>
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(isActivityFilter(e.target.value) ? e.target.value : "all")}
              className="h-8 rounded-md border border-input bg-background px-2 text-2xs"
            >
              <option value="all">All</option>
              <option value="info">Info</option>
              <option value="error">Errors</option>
            </select>
            <Button size="sm" variant="ghost" onClick={() => clearActivity()}>
              Clear
            </Button>
          </div>
        </div>
        <div className="max-h-52 overflow-y-auto space-y-1">
          {filteredActivity.map((entry) => (
            <div key={entry.id} className="rounded border border-border/25 px-3 py-2 text-2xs">
              <div className="flex items-center justify-between">
                <span className={entry.level === "error" ? "text-destructive" : "text-foreground"}>{entry.message}</span>
                <span className="text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
          {filteredActivity.length === 0 ? (
            <div className="rounded border border-border/25 px-3 py-2">
              <EmptyState compact variant="inline" title="No activity for this filter yet" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
