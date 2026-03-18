import { create } from "zustand";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";

export interface IncomingFaxCall {
  registrarId: string;
  callId: string;
  from: string;
  fromDisplay: string;
  to: string;
  requestUri: string;
}

interface IncomingFaxStoreState {
  activeIncomingFaxCall: IncomingFaxCall | null;
  queuedIncomingFaxCalls: IncomingFaxCall[];
  enqueueIncomingFaxCall: (call: IncomingFaxCall) => boolean;
  resolveActiveIncomingFaxCall: (callId?: string) => void;
  clearIncomingFaxState: () => void;
}

export const useIncomingFaxStore = create<IncomingFaxStoreState>((set, get) => ({
  activeIncomingFaxCall: null,
  queuedIncomingFaxCalls: [],

  enqueueIncomingFaxCall: (call) => {
    const { activeIncomingFaxCall, queuedIncomingFaxCalls } = get();
    const duplicate =
      activeIncomingFaxCall?.callId === call.callId ||
      queuedIncomingFaxCalls.some((queued) => queued.callId === call.callId);
    if (duplicate) return false;

    if (!activeIncomingFaxCall) {
      set({ activeIncomingFaxCall: call });
      return true;
    }

    set((state) => ({
      queuedIncomingFaxCalls: [...state.queuedIncomingFaxCalls, call],
    }));
    return true;
  },

  resolveActiveIncomingFaxCall: (callId) => {
    set((state) => {
      if (callId && state.activeIncomingFaxCall?.callId !== callId) {
        return state;
      }
      const [next, ...rest] = state.queuedIncomingFaxCalls;
      return {
        activeIncomingFaxCall: next ?? null,
        queuedIncomingFaxCalls: rest,
      };
    });
  },

  clearIncomingFaxState: () => {
    set({
      activeIncomingFaxCall: null,
      queuedIncomingFaxCalls: [],
    });
  },
}));

function buildIncomingFaxActivityItems(state: IncomingFaxStoreState): ActivityMonitorWorkItem[] {
  const rows: ActivityMonitorWorkItem[] = [];
  if (state.activeIncomingFaxCall) {
    rows.push({
      key: `fax-incoming-active-${state.activeIncomingFaxCall.callId}`,
      name: `Incoming fax: ${state.activeIncomingFaxCall.fromDisplay || state.activeIncomingFaxCall.from || state.activeIncomingFaxCall.callId}`,
      detail: `Receiving to ${state.activeIncomingFaxCall.to}`,
      state: "running",
      cpuPct: 12,
      memMb: 96,
      startedAt: Date.now() - 12_000,
      kind: "fax",
    });
  }
  for (const queued of state.queuedIncomingFaxCalls) {
    rows.push({
      key: `fax-incoming-queued-${queued.callId}`,
      name: `Queued incoming fax: ${queued.fromDisplay || queued.from || queued.callId}`,
      detail: `Waiting to receive on ${queued.to}`,
      state: "warning",
      cpuPct: 4,
      memMb: 44,
      startedAt: Date.now() - 8_000,
      kind: "fax",
    });
  }
  return rows.slice(0, 20);
}

useIncomingFaxStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "incoming-fax-store",
    buildIncomingFaxActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "incoming-fax-store",
  buildIncomingFaxActivityItems(useIncomingFaxStore.getState()),
);
