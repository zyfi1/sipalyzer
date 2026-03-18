import { create } from "zustand";
import * as api from "@/api/remoteAgent";
import type { AgentConnection } from "@/api/remoteAgent";
import { useNotificationStore } from "./notificationStore";
import { injectAgentRawFrames, injectAgentPacketInfos, stopAgentCaptureSession } from "@/api/packetCapture";
import type {
  RemoteCommandName,
  RemoteCommandParams,
} from "@/types/remoteCommandContract";
import {
  remoteErrorDataSchema,
  remoteAgentReplyEnvelopeSchema,
  remoteChatDataSchema,
  remoteProgressDataSchema,
  remoteStreamDataSchema,
  unwrapRemoteResultEnvelope,
} from "@/contracts/remoteReplySchemas";
import {
  buildRelayRestorePlan,
  relaySessionIdFromControllerAddress,
} from "@/lib/relaySessions";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";

// ── Agent capture frame batching ──
// Accumulates raw frames and flushes in batches to reduce Tauri IPC overhead.
const agentFrameBatches = new Map<string, { frames: string[]; timer: ReturnType<typeof setTimeout> | null }>();
const BATCH_SIZE = 50;
const BATCH_FLUSH_MS = 100;
const MAX_INJECT_RETRIES = 5;
const INJECT_RETRY_MS = 200;

function formatValidationError(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 280 ? `${compact.slice(0, 280)}...` : compact;
}

function isLikelyConnectionFailure(error: unknown): boolean {
  const msg = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("not connected") ||
    msg.includes("disconnected") ||
    msg.includes("connection closed") ||
    msg.includes("timed out") ||
    msg.includes("ws error") ||
    msg.includes("send failed")
  );
}

function flushAgentFrames(sessionId: string, retryCount = 0) {
  const batch = agentFrameBatches.get(sessionId);
  if (!batch || batch.frames.length === 0) return;
  const frames = batch.frames.splice(0);
  batch.timer = null;
  injectAgentRawFrames(sessionId, frames).catch((err) => {
    if (retryCount < MAX_INJECT_RETRIES && String(err).includes("not found")) {
      // Session not created yet — put frames back and retry
      const b = agentFrameBatches.get(sessionId);
      if (b) {
        b.frames.unshift(...frames);
        b.timer = setTimeout(() => flushAgentFrames(sessionId, retryCount + 1), INJECT_RETRY_MS);
      }
    }
  });
}

function enqueueAgentFrame(sessionId: string, base64Frame: string) {
  let batch = agentFrameBatches.get(sessionId);
  if (!batch) {
    batch = { frames: [], timer: null };
    agentFrameBatches.set(sessionId, batch);
  }
  batch.frames.push(base64Frame);
  if (batch.frames.length >= BATCH_SIZE) {
    if (batch.timer) { clearTimeout(batch.timer); batch.timer = null; }
    flushAgentFrames(sessionId);
  } else if (!batch.timer) {
    batch.timer = setTimeout(() => flushAgentFrames(sessionId), BATCH_FLUSH_MS);
  }
}

function cleanupAgentFrameBatch(sessionId: string) {
  const batch = agentFrameBatches.get(sessionId);
  if (batch) {
    if (batch.timer) clearTimeout(batch.timer);
    if (batch.frames.length > 0) flushAgentFrames(sessionId);
    agentFrameBatches.delete(sessionId);
  }
}

// ── Types ──────────────────────────────────────────────────────────────

export interface PendingCommand {
  id: string;
  agentId: string;
  type: string;
  status: "pending" | "running" | "done" | "error";
  progress: number | null;
  result: unknown | null;
  error: string | null;
  startedAt: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  agentId: string | null;
  agentHostname: string | null;
  type:
    | "connected"
    | "disconnected"
    | "command_sent"
    | "command_result"
    | "command_error"
    | "killed"
    | "self_destructed"
    | "generated"
    | "auth_failed"
    | "auth_success"
    | "heartbeat_timeout"
    | "permission_error"
    | "agent_expired"
    | "reconnected"
    | "relay_waiting"
    | "relay_error"
    | "chat_message";
  message: string;
  data?: unknown;
}

export interface GeneratedConfig {
  id: string;
  agentId: string;
  targetOs: string;
  controllerAddress: string;
  authToken: string;
  /** Timestamp of the most recent build (updated on rebuild). */
  generatedAt: string;
  /** Timestamp of the original creation (never changes). Falls back to generatedAt for older records. */
  createdAt?: string;
  /** Number of times this agent has been rebuilt. */
  rebuiltCount?: number;
  label: string | null;
  zipPath: string;
  profile: string;
  experience?: "minimal" | "full";
}

export interface RemoteChatMessage {
  id: string;
  agentId: string;
  sender: string;
  text: string;
  timestamp: string;
  unread: boolean;
}

// ── Store ──────────────────────────────────────────────────────────────

interface RemoteAgentState {
  // Connections
  connections: AgentConnection[];
  selectedAgentId: string | null;

  // Commands
  pendingCommands: PendingCommand[];

  // Activity log
  activityLog: ActivityLogEntry[];

  // Generated configs history
  generatedConfigs: GeneratedConfig[];

  // Persisted agent names (survives app restarts)
  agentNames: Record<string, string>;

  // Relay sessions (controller ↔ relay connections awaiting agents)
  activeRelaySessions: Set<string>;
  chatMessages: RemoteChatMessage[];

  // ── Actions ──

  // Connections
  refreshConnections: () => Promise<void>;
  selectAgent: (id: string | null) => void;
  renameAgent: (id: string, name: string | null) => Promise<void>;
  addKnownAgent: (id: string, name: string) => void;
  disconnectAgent: (id: string) => Promise<void>;
  killAgent: (id: string) => Promise<void>;
  selfDestructAgent: (id: string) => Promise<void>;

  // Commands
  sendCommand: {
    <TCommand extends RemoteCommandName>(
      agentId: string,
      commandType: TCommand,
      params?: RemoteCommandParams<TCommand>,
    ): Promise<string>;
    (
      agentId: string,
      commandType: string,
      params?: Record<string, unknown>,
    ): Promise<string>;
  };
  updateCommandStatus: (commandId: string, update: Partial<PendingCommand>) => void;
  /** Await completion of a remote command. Resolves with result or rejects with error. */
  waitForCommand: (msgId: string) => Promise<{ result: unknown } | { error: string }>;

  // Activity
  addLogEntry: (entry: Omit<ActivityLogEntry, "id" | "timestamp">) => void;
  clearActivityLog: () => void;

  // Generation
  addGeneratedConfig: (config: GeneratedConfig) => void;
  clearGeneratedConfigs: () => void;

  // Relay sessions
  addRelaySession: (sessionId: string) => void;
  removeRelaySession: (sessionId: string) => void;
  /** One-click tunnel restore for a specific agent. */
  ensureRelayForAgent: (agentId: string) => Promise<boolean>;
  /** Reconnect relay sessions for persisted deployed agents (startup recovery). */
  restoreRelaySessions: () => Promise<number>;

  // Handle events from backend
  handleAgentConnected: (agentId: string, remoteAddr: string, profile?: string, capabilities?: string[]) => void;
  handleAgentDisconnected: (agentId: string, reason?: string) => void;
  handleAgentResponse: (reply: { id: string; response: { type: string; data?: unknown }; agentId?: string }) => void;
}

/** Returns user-assigned name if set, otherwise hostname, otherwise agentId. */
function agentDisplayName(agent: AgentConnection | undefined, agentId?: string): string {
  if (agent?.name) return agent.name;
  if (agent?.hostname) return agent.hostname;
  return agentId || "Unknown";
}

export const useRemoteAgentStore = create<RemoteAgentState>((set, get) => ({
  connections: [],
  selectedAgentId: null,
  pendingCommands: [],
  activityLog: [],
  generatedConfigs: [],
  agentNames: {},
  activeRelaySessions: new Set<string>(),
  chatMessages: [],

  // ── Connections ──

  refreshConnections: async () => {
    try {
      const connections = await api.listConnections();
      // Restore persisted names for reconnected agents
      const { agentNames } = get();
      const withNames = connections.map((c) => {
        const savedName = agentNames[c.id];
        if (savedName && !c.name) {
          // Re-apply persisted name to the backend (fire-and-forget)
          api.renameAgent(c.id, savedName).catch(() => {});
          return { ...c, name: savedName };
        }
        return c;
      });
      set({ connections: withNames });
    } catch {
      // Ignore
    }
  },

  selectAgent: (id) => set({ selectedAgentId: id }),

  renameAgent: async (id: string, name: string | null) => {
    try {
      await api.renameAgent(id, name);
      // Optimistically update the local connections list and persisted names
      set((s) => {
        const agentNames = { ...s.agentNames };
        if (name) {
          agentNames[id] = name;
        } else {
          delete agentNames[id];
        }
        return {
          connections: s.connections.map((c) =>
            c.id === id ? { ...c, name } : c
          ),
          agentNames,
        };
      });
    } catch (e: any) {
      useNotificationStore.getState().addNotification({
        type: "error",
        title: "Rename Failed",
        description: e.message || "Failed to rename agent",
        source: "system",
        priority: "normal",
      });
    }
  },

  addKnownAgent: (id: string, name: string) => {
    const displayName = name || id.slice(0, 8);
    set((s) => {
      const agentNames = { ...s.agentNames, [id]: displayName };
      // If the agent is already connected, apply the name immediately
      const conn = s.connections.find((c) => c.id === id);
      if (conn) {
        api.renameAgent(id, displayName).catch(() => {});
        return {
          agentNames,
          connections: s.connections.map((c) =>
            c.id === id ? { ...c, name: displayName } : c
          ),
        };
      }
      return { agentNames };
    });
  },

  disconnectAgent: async (id: string) => {
    try {
      await api.disconnectAgent(id);
      const agent = get().connections.find((c) => c.id === id);
      const display = agentDisplayName(agent, id);
      get().addLogEntry({
        agentId: id,
        agentHostname: display,
        type: "disconnected",
        message: `Disconnected ${display}`,
      });
      get().refreshConnections();
    } catch (e: any) {
      useNotificationStore.getState().addNotification({
        type: "error",
        title: "Disconnect Failed",
        description: e.message,
        source: "system",
        priority: "normal",
      });
    }
  },

  killAgent: async (id: string) => {
    try {
      await api.killAgent(id);
      const agent = get().connections.find((c) => c.id === id);
      const display = agentDisplayName(agent, id);
      get().addLogEntry({
        agentId: id,
        agentHostname: display,
        type: "killed",
        message: `Terminated ${display}`,
      });
      useNotificationStore.getState().addNotification({
        type: "info",
        title: "Agent Terminated",
        description: `${display} process terminated remotely`,
        source: "system",
        priority: "normal",
        navigation: { tool: "remote-agent", view: "registry" },
      });
      get().refreshConnections();
    } catch (e: any) {
      useNotificationStore.getState().addNotification({
        type: "error",
        title: "Kill Failed",
        description: e.message,
        source: "system",
        priority: "normal",
      });
    }
  },

  selfDestructAgent: async (id: string) => {
    try {
      await api.selfDestructAgent(id);
      const agent = get().connections.find((c) => c.id === id);
      const display = agentDisplayName(agent, id);
      get().addLogEntry({
        agentId: id,
        agentHostname: display,
        type: "self_destructed",
        message: `Removed ${display} (binary deleted)`,
      });
      useNotificationStore.getState().addNotification({
        type: "success",
        title: "Agent Removed",
        description: `${display} binary deleted from remote machine`,
        source: "system",
        priority: "normal",
        navigation: { tool: "remote-agent", view: "registry" },
      });
      get().refreshConnections();
    } catch (e: any) {
      useNotificationStore.getState().addNotification({
        type: "error",
        title: "Remove Failed",
        description: e.message,
        source: "system",
        priority: "normal",
      });
      throw e;
    }
  },

  // ── Commands ──

  sendCommand: (async (
    agentId: string,
    commandType: string,
    params?: Record<string, unknown>,
  ) => {
    const command = params
      ? { command: commandType, params }
      : { command: commandType };
    let msgId: string;
    try {
      msgId = await api.sendCommand(agentId, command);
    } catch (err) {
      if (!isLikelyConnectionFailure(err)) throw err;

      // VPN and flaky WAN links can drop the direct session briefly.
      // Auto-heal relay path once, wait for reattach, then retry command send.
      await get().ensureRelayForAgent(agentId).catch(() => {});
      for (let i = 0; i < 8; i += 1) {
        await get().refreshConnections().catch(() => {});
        const connected = get().connections.some(
          (c) => c.id === agentId && c.status === "connected",
        );
        if (connected) break;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      msgId = await api.sendCommand(agentId, command);
    }
    const pending: PendingCommand = {
      id: msgId,
      agentId,
      type: commandType,
      status: "running",
      progress: null,
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
    };
    set((s) => ({ pendingCommands: [...s.pendingCommands, pending] }));

    const agent = get().connections.find((c) => c.id === agentId);
    const display = agentDisplayName(agent, agentId);
    get().addLogEntry({
      agentId,
      agentHostname: display,
      type: "command_sent",
      message: `Sent ${commandType} to ${display}`,
    });

    return msgId;
  }) as RemoteAgentState["sendCommand"],

  updateCommandStatus: (commandId, update) => {
    set((s) => ({
      pendingCommands: s.pendingCommands.map((c) =>
        c.id === commandId ? { ...c, ...update } : c
      ),
    }));
  },

  waitForCommand: (msgId) => {
    return new Promise((resolve) => {
      const check = () => {
        const cmd = get().pendingCommands.find((c) => c.id === msgId);
        if (!cmd) {
          // Command not found -- agent may have disconnected and state was cleared
          resolve({ error: "Command not found (agent may have disconnected)" });
          return true;
        }
        if (cmd.status === "done") {
          const unwrapped = unwrapRemoteResultEnvelope(cmd.result);
          if (!unwrapped.ok) {
            resolve({ error: unwrapped.error });
            return true;
          }
          resolve({ result: unwrapped.result });
          return true;
        }
        if (cmd.status === "error") {
          resolve({ error: cmd.error || "Unknown remote error" });
          return true;
        }
        // Check if the agent is still connected
        const agentAlive = get().connections.some((c) => c.id === cmd.agentId);
        if (!agentAlive) {
          resolve({ error: `Agent disconnected while command was in progress` });
          return true;
        }
        return false;
      };
      if (check()) return;
      const unsub = useRemoteAgentStore.subscribe(() => {
        if (check()) unsub();
      });
    });
  },

  // ── Activity Log ──

  addLogEntry: (entry) => {
    const logEntry: ActivityLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    set((s) => ({
      activityLog: [logEntry, ...s.activityLog].slice(0, 2000),
    }));
  },

  clearActivityLog: () => set({ activityLog: [] }),

  // ── Generation ──

  addGeneratedConfig: (config) => {
    set((s) => ({
      generatedConfigs: [config, ...s.generatedConfigs].slice(0, 50),
    }));
    // Auto-start tunnel as part of deploy lifecycle (one-click behavior).
    // Relay deduplication is handled by backend/session guards.
    const sid = relaySessionIdFromControllerAddress(config.controllerAddress);
    if (sid) {
      api.connectRelay(sid, config.authToken).catch(() => {});
    }
    get().addLogEntry({
      agentId: config.agentId,
      agentHostname: null,
      type: "generated",
      message: `Agent deployed for ${config.targetOs} (${config.label || config.agentId.slice(0, 8)})`,
      data: { targetOs: config.targetOs, label: config.label, experience: config.experience ?? "full" },
    });
  },

  clearGeneratedConfigs: () => {
    set({ generatedConfigs: [] });
  },

  // ── Relay Sessions ──

  addRelaySession: (sessionId: string) => {
    set((s) => {
      const next = new Set(s.activeRelaySessions);
      next.add(sessionId);
      return { activeRelaySessions: next };
    });
  },

  removeRelaySession: (sessionId: string) => {
    set((s) => {
      const next = new Set(s.activeRelaySessions);
      next.delete(sessionId);
      return { activeRelaySessions: next };
    });
  },

  ensureRelayForAgent: async (agentId: string) => {
    const plan = buildRelayRestorePlan(get().generatedConfigs, agentId);
    if (!plan.length) return false;
    let started = false;
    for (const target of plan) {
      try {
        await api.connectRelay(target.sessionId, target.authToken);
        started = true;
      } catch {
        // Backend emits relay-error events with details.
      }
    }
    return started;
  },

  restoreRelaySessions: async () => {
    const plan = buildRelayRestorePlan(get().generatedConfigs);
    if (!plan.length) return 0;
    let started = 0;
    for (const target of plan) {
      try {
        await api.connectRelay(target.sessionId, target.authToken);
        started += 1;
      } catch {
        // The backend emits relay error events with details; ignore here.
      }
    }
    return started;
  },

  // ── Event handlers (called from App-level event listeners) ──

  handleAgentConnected: (agentId, remoteAddr, _profile?, _capabilities?) => {
    const savedName = get().agentNames[agentId];
    if (savedName) {
      api.renameAgent(agentId, savedName).catch(() => {});
    }

    // Detect reconnection: check if this agent was previously seen in the activity log
    const wasConnectedBefore = get().activityLog.some(
      (e) => e.agentId === agentId && (e.type === "connected" || e.type === "reconnected")
    );

    get().refreshConnections();

    const displayName = savedName || agentId.slice(0, 8);
    const isRelay = remoteAddr.startsWith("relay:");
    const addrDisplay = isRelay ? "via secure relay" : `from ${remoteAddr}`;
    const eventType = wasConnectedBefore ? "reconnected" : "connected";
    const verb = wasConnectedBefore ? "reconnected" : "connected";

    get().addLogEntry({
      agentId,
      agentHostname: savedName || null,
      type: eventType,
      message: `Agent ${displayName} ${verb} ${addrDisplay}`,
    });
    useNotificationStore.getState().addNotification({
      type: "success",
      title: wasConnectedBefore ? "Agent Reconnected" : "Agent Connected",
      description: `${displayName} ${verb} ${addrDisplay}`,
      source: "system",
      priority: "normal",
      navigation: { tool: "remote-agent", view: "registry" },
    });
  },

  handleAgentDisconnected: (agentId, reason?) => {
    const agent = get().connections.find((c) => c.id === agentId);
    const display = agentDisplayName(agent, agentId);

    // Backend now keeps disconnected agents in the manager, so a simple
    // refresh will return them with status="disconnected" and last_heartbeat set.
    get().refreshConnections();

    const inflightCmds = get().pendingCommands.filter(
      (c) => c.agentId === agentId && (c.status === "running" || c.status === "pending")
    );
    for (const cmd of inflightCmds) {
      get().updateCommandStatus(cmd.id, {
        status: "error",
        error: `Agent ${display} disconnected while command was in progress`,
      });
    }

    const REASON_LABELS: Record<string, { type: ActivityLogEntry["type"]; label: string }> = {
      heartbeat_timeout: { type: "heartbeat_timeout", label: "heartbeat timeout" },
      ping_failure:      { type: "heartbeat_timeout", label: "ping failure" },
      ws_error:          { type: "disconnected", label: "WebSocket error" },
      send_error:        { type: "disconnected", label: "send error" },
      connection_lost:   { type: "disconnected", label: "connection lost" },
      clean_close:       { type: "disconnected", label: "clean disconnect" },
      controller_closed: { type: "disconnected", label: "controller closed" },
    };

    const resolved = reason && REASON_LABELS[reason]
      ? REASON_LABELS[reason]
      : { type: "disconnected" as const, label: "disconnected" };

    const reasonSuffix = reason && REASON_LABELS[reason]
      ? ` (${resolved.label})`
      : "";

    get().addLogEntry({
      agentId,
      agentHostname: display,
      type: resolved.type,
      message: `Agent ${display} disconnected${reasonSuffix}`,
      data: reason ? { reason } : undefined,
    });
    useNotificationStore.getState().addNotification({
      type: resolved.type === "heartbeat_timeout" ? "error" : "warning",
      title: resolved.type === "heartbeat_timeout" ? "Agent Heartbeat Timeout" : "Agent Disconnected",
      description: `${display} disconnected${reasonSuffix}`,
      source: "system",
      priority: "normal",
      navigation: { tool: "remote-agent", view: "registry" },
    });

    // Auto-heal relay tunnel for transient network failures so users keep
    // one-click behavior and existing UDP/SIP/RTP tools continue to run on-agent.
    // Keep tunnel establishment automatic; try to ensure relay whenever a managed
    // agent is offline and there is no active relay session yet.
    const config = get().generatedConfigs.find((cfg) => cfg.agentId === agentId);
    const sid = config ? relaySessionIdFromControllerAddress(config.controllerAddress) : null;
    if (sid && !get().activeRelaySessions.has(sid)) {
      get().ensureRelayForAgent(agentId).catch(() => {});
    }

  },

  handleAgentResponse: (reply) => {
    const replyParse = remoteAgentReplyEnvelopeSchema.safeParse(reply);
    if (!replyParse.success) {
      get().addLogEntry({
        agentId: null,
        agentHostname: null,
        type: "command_error",
        message: `Dropped invalid remote-agent reply: ${formatValidationError(replyParse.error.message)}`,
      });
      return;
    }
    const { id, response } = replyParse.data;
    const type = response.type;

    if (type === "Heartbeat") {
      // Update connection data
      get().refreshConnections();
      return;
    }

    if (type === "Result") {
      const cmd = get().pendingCommands.find((c) => c.id === id);
      // For PacketCapture, result is a packet count; for others, keep existing behavior
      const existingResult = cmd?.result;
      const isCapture = cmd?.type === "PacketCapture";
      const keepExisting = isCapture || (Array.isArray(existingResult) && existingResult.length > 0);
      get().updateCommandStatus(id, {
        status: "done",
        result: keepExisting ? existingResult : response.data,
      });
      if (cmd) {
        const agent = get().connections.find((c) => c.id === cmd.agentId);
        const display = agentDisplayName(agent, cmd.agentId);
        const elapsed = cmd.startedAt
          ? `${((Date.now() - new Date(cmd.startedAt).getTime()) / 1000).toFixed(1)}s`
          : "";
        get().addLogEntry({
          agentId: cmd.agentId,
          agentHostname: display,
          type: "command_result",
          message: `${cmd.type} completed${elapsed ? ` in ${elapsed}` : ""} on ${display}`,
          data: response.data,
        });
        if (isCapture) {
          cleanupAgentFrameBatch(id);
          stopAgentCaptureSession(id).catch(() => {});
        }
      }
      return;
    }

    if (type === "Error") {
      const cmd = get().pendingCommands.find((c) => c.id === id);
      const parsedErrorData = remoteErrorDataSchema.safeParse(response.data ?? {});
      if (!parsedErrorData.success) {
        const validationMessage = `Invalid remote error payload for ${id}: ${formatValidationError(parsedErrorData.error.message)}`;
        get().updateCommandStatus(id, {
          status: "error",
          error: validationMessage,
        });
        get().addLogEntry({
          agentId: cmd?.agentId ?? null,
          agentHostname: null,
          type: "command_error",
          message: validationMessage,
          data: response.data,
        });
        return;
      }

      const errorData = parsedErrorData.data;
      const errorMsg = errorData.message || "Unknown error";
      const errorCode = errorData.code || "";
      get().updateCommandStatus(id, {
        status: "error",
        error: errorMsg,
      });
      if (cmd) {
        const agent = get().connections.find((c) => c.id === cmd.agentId);
        const display = agentDisplayName(agent, cmd.agentId);
        const isPermissionError = errorCode === "CAPTURE_PERMISSION" || errorCode === "NOT_AVAILABLE";
        get().addLogEntry({
          agentId: cmd.agentId,
          agentHostname: display,
          type: isPermissionError ? "permission_error" : "command_error",
          message: `${cmd.type} ${isPermissionError ? "permission denied" : "failed"} on ${display}: ${errorMsg}`,
          data: response.data,
        });
        if (cmd.type === "PacketCapture") {
          cleanupAgentFrameBatch(id);
          stopAgentCaptureSession(id).catch(() => {});
        }
      }
      return;
    }

    if (type === "Progress") {
      const cmd = get().pendingCommands.find((c) => c.id === id);
      // Don't overwrite result if command is already done (race between progress and result)
      if (cmd && (cmd.status === "done" || cmd.status === "error")) return;
      const parsedProgress = remoteProgressDataSchema.safeParse(response.data ?? {});
      if (!parsedProgress.success) {
        get().addLogEntry({
          agentId: cmd?.agentId ?? null,
          agentHostname: null,
          type: "command_error",
          message: `Dropped invalid progress payload for ${id}: ${formatValidationError(parsedProgress.error.message)}`,
          data: response.data,
        });
        return;
      }
      const data = parsedProgress.data;
      get().updateCommandStatus(id, {
        progress: data?.progress ?? null,
        // Store partial data for subscribers (e.g., softphone tracking call state)
        result: data?.partial ?? data ?? null,
      });
      return;
    }

    if (type === "StreamData") {
      const cmd = get().pendingCommands.find((c) => c.id === id);
      if (cmd) {
        const parsedChunk = remoteStreamDataSchema.safeParse(response.data ?? {});
        if (!parsedChunk.success) {
          get().addLogEntry({
            agentId: cmd.agentId,
            agentHostname: null,
            type: "command_error",
            message: `Dropped invalid stream payload for ${id}: ${formatValidationError(parsedChunk.error.message)}`,
            data: response.data,
          });
          return;
        }
        const chunk = parsedChunk.data;
        // For PacketCapture commands, inject frames into the Rust backend
        // instead of accumulating in memory.
        if (cmd.type === "PacketCapture") {
          if (chunk?.data) {
            enqueueAgentFrame(id, chunk.data);
          } else if (chunk?.packet_info) {
            injectAgentPacketInfos(id, [chunk.packet_info]).catch(() => {});
          }
          const currentCount = (cmd.result as number) || 0;
          get().updateCommandStatus(id, {
            result: currentCount + 1,
          });
        } else {
          // Non-capture streaming: accumulate data as before
          const existing = (cmd.result as any[]) || [];
          get().updateCommandStatus(id, {
            result: [...existing, chunk],
          });
        }
      }
      return;
    }

    if (type === "ChatMessage") {
      const parsedChat = remoteChatDataSchema.safeParse(response.data ?? {});
      if (!parsedChat.success) return;
      const agentId = reply.agentId;
      if (!agentId) return;
      const chat = parsedChat.data;
      const message: RemoteChatMessage = {
        id: crypto.randomUUID(),
        agentId,
        sender: chat.sender || "remote",
        text: chat.text,
        timestamp: chat.timestamp || new Date().toISOString(),
        unread: true,
      };
      set((s) => ({ chatMessages: [...s.chatMessages, message].slice(-1000) }));
      const agent = get().connections.find((c) => c.id === agentId);
      const display = agentDisplayName(agent, agentId);
      get().addLogEntry({
        agentId,
        agentHostname: display,
        type: "chat_message",
        message: `Chat message from ${display}`,
        data: message,
      });
      return;
    }
  },
}));

function buildRemoteAgentActivityItems(state: RemoteAgentState): ActivityMonitorWorkItem[] {
  const rows: ActivityMonitorWorkItem[] = [];
  for (const cmd of state.pendingCommands) {
    if (!(cmd.status === "running" || cmd.status === "pending")) continue;
    const progress =
      typeof cmd.progress === "number" && Number.isFinite(cmd.progress)
        ? `${Math.round(cmd.progress)}%`
        : "in progress";
    rows.push({
      key: `agent-cmd-${cmd.id}`,
      name: `Remote agent: ${cmd.type}`,
      detail: `Agent ${cmd.agentId.slice(0, 8)} • ${progress}`,
      state: cmd.status === "pending" ? "warning" : "running",
      cpuPct: cmd.status === "pending" ? 6 : 16,
      memMb: cmd.status === "pending" ? 72 : 118,
      startedAt: cmd.startedAt ? new Date(cmd.startedAt).getTime() : Date.now() - 5_000,
      kind: "agent",
    });
  }
  return rows.slice(0, 40);
}

useRemoteAgentStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "remote-agent-store",
    buildRemoteAgentActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "remote-agent-store",
  buildRemoteAgentActivityItems(useRemoteAgentStore.getState()),
);
