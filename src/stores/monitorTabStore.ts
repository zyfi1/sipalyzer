import { create } from "zustand";
import type { ExecutionContext } from "./executionContextStore";

export interface MonitorTab {
  id: string;
  label: string;
  sessionId: string | null;
  executionContext: ExecutionContext;
  isCapturing: boolean;
  packetCount: number;
  createdAt: number;
}

export interface MonitorFooterState {
  isCapturing: boolean;
  totalPacketCount: number;
  selectedPacketIndex: number | null;
  autoScroll: boolean;
  fps: number;
}

interface MonitorTabState {
  tabs: MonitorTab[];
  activeTabId: string | null;
  footerState: MonitorFooterState;

  addTab: (ctx?: ExecutionContext, label?: string) => string;
  closeTab: (id: string) => void;
  reorderTabs: (draggedId: string, targetId: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<MonitorTab>) => void;
  renameTab: (id: string, label: string) => void;
  setFooterState: (state: Partial<MonitorFooterState>) => void;
}

function nextAvailableIndex(tabs: MonitorTab[], prefix: "Capture" | "Remote"): number {
  const used = new Set<number>();
  const re = new RegExp(`^${prefix}\\s+(\\d+)$`);
  for (const tab of tabs) {
    const match = tab.label.match(re);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) used.add(value);
  }
  let i = 1;
  while (used.has(i)) i += 1;
  return i;
}

function defaultTabLabel(tabs: MonitorTab[], ctx?: ExecutionContext): string {
  const prefix: "Capture" | "Remote" = ctx?.type === "remote" ? "Remote" : "Capture";
  const next = nextAvailableIndex(tabs, prefix);
  return `${prefix} ${next}`;
}

export const useMonitorTabStore = create<MonitorTabState>((set, get) => {
  const firstId = crypto.randomUUID();

  return {
    tabs: [
      {
        id: firstId,
        label: "Capture 1",
        sessionId: null,
        executionContext: { type: "local" },
        isCapturing: false,
        packetCount: 0,
        createdAt: Date.now(),
      },
    ],
    activeTabId: firstId,
    footerState: {
      isCapturing: false,
      totalPacketCount: 0,
      selectedPacketIndex: null,
      autoScroll: false,
      fps: 60,
    },

    addTab: (ctx, label) => {
      const id = crypto.randomUUID();
      const tabs = get().tabs;
      const tab: MonitorTab = {
        id,
        label: label ?? defaultTabLabel(tabs, ctx),
        sessionId: null,
        executionContext: ctx ?? { type: "local" },
        isCapturing: false,
        packetCount: 0,
        createdAt: Date.now(),
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
      return id;
    },

    closeTab: (id) => {
      const { tabs, activeTabId } = get();
      const remaining = tabs.filter((t) => t.id !== id);

      if (remaining.length === 0) {
        const newId = crypto.randomUUID();
        const freshTab: MonitorTab = {
          id: newId,
          label: defaultTabLabel([], { type: "local" }),
          sessionId: null,
          executionContext: { type: "local" },
          isCapturing: false,
          packetCount: 0,
          createdAt: Date.now(),
        };
        set({ tabs: [freshTab], activeTabId: newId });
        return;
      }

      let nextActive = activeTabId;
      if (activeTabId === id) {
        const idx = tabs.findIndex((t) => t.id === id);
        nextActive = remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
      }
      set({ tabs: remaining, activeTabId: nextActive });
    },

    reorderTabs: (draggedId, targetId) =>
      set((s) => {
        if (draggedId === targetId) return s;
        const from = s.tabs.findIndex((t) => t.id === draggedId);
        const to = s.tabs.findIndex((t) => t.id === targetId);
        if (from < 0 || to < 0) return s;
        const next = [...s.tabs];
        const [moved] = next.splice(from, 1);
        if (!moved) return s;
        next.splice(to, 0, moved);
        return { tabs: next };
      }),

    setActiveTab: (id) => set({ activeTabId: id }),

    updateTab: (id, patch) =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      })),

    renameTab: (id, label) =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, label } : t)),
      })),

    setFooterState: (patch) =>
      set((s) => ({ footerState: { ...s.footerState, ...patch } })),
  };
});
