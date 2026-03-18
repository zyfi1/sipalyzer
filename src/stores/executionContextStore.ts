import { create } from "zustand";
import { useRemoteAgentStore } from "./remoteAgentStore";

// ── Types ──────────────────────────────────────────────────────────────

export type ExecutionContext =
  | { type: "local" }
  | {
      type: "remote";
      agentId: string;
    };

interface ExecutionContextState {
  /** Global default execution context. */
  context: ExecutionContext;
  setContext: (ctx: ExecutionContext) => void;

  /** Per-tool overrides (e.g., softphone uses agent X while ping uses local). */
  toolOverrides: Record<string, ExecutionContext>;
  setToolOverride: (toolId: string, ctx: ExecutionContext) => void;
  clearToolOverride: (toolId: string) => void;

  /**
   * Resolved context for a tool: override > global.
   * If the resolved agent is no longer connected, auto-fallback to local.
   */
  resolvedContext: (toolId: string) => ExecutionContext;

  /** Convenience: true if resolved context for toolId is remote. */
  isRemote: (toolId: string) => boolean;

  /** Get the agent display name for a resolved remote context, or null if local. */
  resolvedAgentName: (toolId: string) => string | null;
}

// ── Store ──────────────────────────────────────────────────────────────

const LOCAL: ExecutionContext = { type: "local" };

export const useExecutionContextStore = create<ExecutionContextState>(
  (set, get) => ({
    context: LOCAL,
    toolOverrides: {},

    setContext: (ctx) =>
      set(() => ({ context: ctx })),

    setToolOverride: (toolId, ctx) =>
      set((s) => ({ toolOverrides: { ...s.toolOverrides, [toolId]: ctx } })),

    clearToolOverride: (toolId) =>
      set((s) => {
        const next = { ...s.toolOverrides };
        delete next[toolId];
        return { toolOverrides: next };
      }),

    resolvedContext: (toolId) => {
      const state = get();
      const ctx = state.toolOverrides[toolId] ?? state.context;
      if (ctx.type === "remote") {
        const connections = useRemoteAgentStore.getState().connections;
        const alive = connections.some(
          (c) => c.id === ctx.agentId && c.status === "connected",
        );
        if (!alive) return LOCAL;
      }
      return ctx;
    },

    isRemote: (toolId) => get().resolvedContext(toolId).type === "remote",

    resolvedAgentName: (toolId) => {
      const ctx = get().resolvedContext(toolId);
      if (ctx.type !== "remote") return null;
      const agent = useRemoteAgentStore
        .getState()
        .connections.find((c) => c.id === ctx.agentId);
      return agent?.name || agent?.hostname || ctx.agentId.slice(0, 8);
    },
  }),
);
