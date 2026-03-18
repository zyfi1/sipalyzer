import { create } from "zustand";
import { useNotificationStore } from "@/stores/notificationStore";
import * as api from "@/api/mcp";

export interface McpActivityEntry {
  id: string;
  timestamp: string;
  level: "info" | "error";
  message: string;
}

interface McpStoreState {
  profiles: api.McpServerProfile[];
  statuses: api.McpServerStatus[];
  toolsByServer: Record<string, api.McpToolDescriptor[]>;
  resourcesByServer: Record<string, api.McpResourceDescriptor[]>;
  promptsByServer: Record<string, api.McpPromptDescriptor[]>;
  hostedState: api.McpHostedServerState | null;
  activity: McpActivityEntry[];
  selectedServerId: string | null;
  orchestrationInFlight: boolean;

  refreshAll: () => Promise<void>;
  setSelectedServer: (serverId: string | null) => void;
  upsertProfile: (profile: api.McpServerProfile) => Promise<void>;
  deleteProfile: (serverId: string) => Promise<void>;
  connectServer: (serverId: string) => Promise<boolean>;
  testServer: (serverId: string) => Promise<api.McpConnectionTestResult | null>;
  disconnectServer: (serverId: string) => Promise<boolean>;
  loadCatalog: (serverId: string) => Promise<boolean>;
  callTool: (serverId: string, toolName: string, argumentsJson: string) => Promise<api.McpToolCallResult | null>;
  orchestrate: (tasks: api.McpOrchestrationTask[]) => Promise<api.McpOrchestrationResult | null>;
  startHostedServer: (payload: {
    stdioEnabled: boolean;
    networkEnabled: boolean;
    networkBind?: string | null;
    networkPort?: number | null;
    authToken?: string | null;
  }) => Promise<void>;
  stopHostedServer: () => Promise<void>;
  addActivity: (entry: Omit<McpActivityEntry, "id" | "timestamp">) => void;
  clearActivity: () => void;
  handleServerStatusEvent: (payload: { serverId: string; connected: boolean }) => void;
  handleAgentProgressEvent: (payload: {
    taskId: string;
    index: number;
    total: number;
    serverId: string;
    toolName: string;
    agentRole?: string | null;
    objective?: string | null;
  }) => void;
}

export const useMcpStore = create<McpStoreState>((set, get) => ({
  profiles: [],
  statuses: [],
  toolsByServer: {},
  resourcesByServer: {},
  promptsByServer: {},
  hostedState: null,
  activity: [],
  selectedServerId: null,
  orchestrationInFlight: false,

  refreshAll: async () => {
    try {
      const [profiles, statuses, hostedState] = await Promise.all([
        api.mcpListProfiles(),
        api.mcpListServerStatus(),
        api.mcpGetHostedServerState(),
      ]);
      set({ profiles, statuses, hostedState });
    } catch (error) {
      get().addActivity({ level: "error", message: `MCP refresh failed: ${String(error)}` });
    }
  },

  setSelectedServer: (serverId) => set({ selectedServerId: serverId }),

  upsertProfile: async (profile) => {
    await api.mcpUpsertProfile(profile);
    await get().refreshAll();
    get().addActivity({ level: "info", message: `Saved MCP profile ${profile.name}` });
  },

  deleteProfile: async (serverId) => {
    await api.mcpDeleteProfile(serverId);
    await get().refreshAll();
    set((s) => ({ selectedServerId: s.selectedServerId === serverId ? null : s.selectedServerId }));
    get().addActivity({ level: "info", message: `Deleted MCP profile ${serverId}` });
  },

  connectServer: async (serverId) => {
    try {
      const status = await api.mcpConnectServer(serverId);
      set((s) => ({
        statuses: [...s.statuses.filter((item) => item.serverId !== serverId), status],
      }));
      await get().loadCatalog(serverId);
      useNotificationStore.getState().addNotification({
        source: "system",
        type: "success",
        title: "MCP Connected",
        description: `${serverId} is now connected`,
      });
      get().addActivity({ level: "info", message: `Connected MCP server ${serverId}` });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      get().addActivity({ level: "error", message: `Connect failed for ${serverId}: ${message}` });
      useNotificationStore.getState().addNotification({
        source: "system",
        type: "error",
        title: "MCP Connect Failed",
        description: message,
      });
      return false;
    }
  },

  testServer: async (serverId) => {
    try {
      const result = await api.mcpTestServerConnection(serverId);
      get().addActivity({
        level: result.ok ? "info" : "error",
        message: `Test ${serverId}: ${result.message}`,
      });
      useNotificationStore.getState().addNotification({
        source: "system",
        type: result.ok ? "success" : "warning",
        title: result.ok ? "MCP Test Passed" : "MCP Test Failed",
        description: result.message,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      get().addActivity({ level: "error", message: `Test failed for ${serverId}: ${message}` });
      return null;
    }
  },

  disconnectServer: async (serverId) => {
    try {
      await api.mcpDisconnectServer(serverId);
      set((s) => ({
        statuses: s.statuses.map((status) =>
          status.serverId === serverId ? { ...status, connected: false } : status,
        ),
      }));
      get().addActivity({ level: "info", message: `Disconnected MCP server ${serverId}` });
      useNotificationStore.getState().addNotification({
        source: "system",
        type: "info",
        title: "MCP Disconnected",
        description: `${serverId} disconnected`,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      get().addActivity({ level: "error", message: `Disconnect failed for ${serverId}: ${message}` });
      return false;
    }
  },

  loadCatalog: async (serverId) => {
    const [toolsResult, resourcesResult, promptsResult] = await Promise.allSettled([
      api.mcpListTools(serverId),
      api.mcpListResources(serverId),
      api.mcpListPrompts(serverId),
    ]);
    const tools = toolsResult.status === "fulfilled" ? toolsResult.value : [];
    const resources = resourcesResult.status === "fulfilled" ? resourcesResult.value : [];
    const prompts = promptsResult.status === "fulfilled" ? promptsResult.value : [];
    set((s) => ({
      toolsByServer: { ...s.toolsByServer, [serverId]: tools },
      resourcesByServer: { ...s.resourcesByServer, [serverId]: resources },
      promptsByServer: { ...s.promptsByServer, [serverId]: prompts },
    }));
    const failedSections = [
      toolsResult.status === "rejected" ? "tools" : null,
      resourcesResult.status === "rejected" ? "resources" : null,
      promptsResult.status === "rejected" ? "prompts" : null,
    ].filter((item): item is string => item != null);
    if (failedSections.length > 0) {
      get().addActivity({
        level: "error",
        message: `Catalog refresh partial failure (${failedSections.join(", ")}) for ${serverId}`,
      });
      return false;
    }
    return true;
  },

  callTool: async (serverId, toolName, argumentsJson) => {
    try {
      const result = await api.mcpCallTool(serverId, toolName, argumentsJson);
      get().addActivity({
        level: result.ok ? "info" : "error",
        message: `${serverId}.${toolName}: ${result.ok ? "ok" : result.error ?? "failed"}`,
      });
      return result;
    } catch (error) {
      get().addActivity({ level: "error", message: `Tool call failed: ${String(error)}` });
      return null;
    }
  },

  orchestrate: async (tasks) => {
    set({ orchestrationInFlight: true });
    try {
      const result = await api.mcpOrchestrateCall(tasks);
      get().addActivity({
        level: "info",
        message: `Multi-agent orchestration completed (${result.succeededTasks}/${result.totalTasks})`,
      });
      return result;
    } catch (error) {
      get().addActivity({ level: "error", message: `Multi-agent orchestration failed: ${String(error)}` });
      return null;
    } finally {
      set({ orchestrationInFlight: false });
    }
  },

  startHostedServer: async (payload) => {
    const state = await api.mcpStartHostedServer(payload);
    set({ hostedState: state });
    get().addActivity({ level: "info", message: `Hosted MCP server started on ${state.networkBind}:${state.networkPort}` });
    useNotificationStore.getState().addNotification({
      source: "system",
      type: "success",
      title: "Hosted MCP Server Started",
      description: `${state.networkBind}:${state.networkPort} (${state.networkEnabled ? "network" : ""}${state.networkEnabled && state.stdioEnabled ? " + " : ""}${state.stdioEnabled ? "stdio" : ""})`,
    });
  },

  stopHostedServer: async () => {
    await api.mcpStopHostedServer();
    set({ hostedState: null });
    get().addActivity({ level: "info", message: "Hosted MCP server stopped" });
    useNotificationStore.getState().addNotification({
      source: "system",
      type: "info",
      title: "Hosted MCP Server Stopped",
      description: "Hosted MCP transports were stopped",
    });
  },

  addActivity: (entry) =>
    set((s) => ({
      activity: [
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          ...entry,
        },
        ...s.activity,
      ].slice(0, 400),
    })),

  clearActivity: () => set({ activity: [] }),

  handleServerStatusEvent: (payload) => {
    set((state) => ({
      statuses: state.statuses.some((status) => status.serverId === payload.serverId)
        ? state.statuses.map((status) =>
            status.serverId === payload.serverId
              ? { ...status, connected: payload.connected }
              : status,
          )
        : [
            ...state.statuses,
            {
              serverId: payload.serverId,
              connected: payload.connected,
              lastError: null,
              capabilities: [],
              toolCount: 0,
              resourceCount: 0,
              promptCount: 0,
            },
          ],
    }));
    get().addActivity({
      level: "info",
      message: `Server ${payload.serverId} ${payload.connected ? "connected" : "disconnected"}`,
    });
  },

  handleAgentProgressEvent: (payload) => {
    const role = payload.agentRole ? ` [${payload.agentRole}]` : "";
    const objective = payload.objective ? ` - ${payload.objective}` : "";
    get().addActivity({
      level: "info",
      message: `Orchestration ${payload.taskId}: ${payload.index + 1}/${payload.total} on ${payload.serverId}.${payload.toolName}${role}${objective}`,
    });
  },
}));
