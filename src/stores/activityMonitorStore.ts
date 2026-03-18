import { create } from "zustand";

export type ActivityMonitorWorkKind = "capture" | "call" | "fax" | "network" | "agent" | "registration";
export type ActivityMonitorWorkState = "running" | "warning";

export interface ActivityMonitorWorkItem {
  key: string;
  name: string;
  detail: string;
  state: ActivityMonitorWorkState;
  cpuPct: number;
  memMb: number;
  startedAt: number;
  kind: ActivityMonitorWorkKind;
  captureSessionId?: string;
  callId?: string;
  canStop?: boolean;
}

interface ActivityMonitorState {
  itemsBySource: Record<string, ActivityMonitorWorkItem[]>;
  items: ActivityMonitorWorkItem[];
  updatedAt: number;
  setSourceItems: (source: string, items: ActivityMonitorWorkItem[]) => void;
  clearSourceItems: (source: string) => void;
}

function sortAndClamp(items: ActivityMonitorWorkItem[]): ActivityMonitorWorkItem[] {
  return [...items].sort((a, b) => b.startedAt - a.startedAt).slice(0, 120);
}

function equalItems(a: ActivityMonitorWorkItem[], b: ActivityMonitorWorkItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return false;
    if (
      x.key !== y.key
      || x.name !== y.name
      || x.detail !== y.detail
      || x.state !== y.state
      || x.cpuPct !== y.cpuPct
      || x.memMb !== y.memMb
      || x.startedAt !== y.startedAt
      || x.kind !== y.kind
      || x.captureSessionId !== y.captureSessionId
      || x.callId !== y.callId
      || x.canStop !== y.canStop
    ) {
      return false;
    }
  }
  return true;
}

export const useActivityMonitorStore = create<ActivityMonitorState>((set, get) => ({
  itemsBySource: {},
  items: [],
  updatedAt: Date.now(),

  setSourceItems: (source, items) => {
    const currentBySource = get().itemsBySource;
    const nextBySource = { ...currentBySource, [source]: items };
    const merged = sortAndClamp(Object.values(nextBySource).flat());
    const currentMerged = get().items;
    if (equalItems(currentMerged, merged)) return;
    set({ itemsBySource: nextBySource, items: merged, updatedAt: Date.now() });
  },

  clearSourceItems: (source) => {
    const currentBySource = get().itemsBySource;
    if (!(source in currentBySource)) return;
    const nextBySource = { ...currentBySource };
    delete nextBySource[source];
    const merged = sortAndClamp(Object.values(nextBySource).flat());
    set({ itemsBySource: nextBySource, items: merged, updatedAt: Date.now() });
  },
}));
