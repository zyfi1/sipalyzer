import { create } from "zustand";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import type {
  MulticastGroup,
  JoinResult,
  SendTestResult,
  IgmpQueryResult,
  SnoopingVerifyResult,
  MulticastPacketEvent,
  ListenerStats,
  AudioStreamState,
  AudioGeneratorState,
} from "@/types/multicast";
import * as api from "@/api/multicast";
import type { ExecutionContext } from "@/stores/executionContextStore";
import {
  dispatchMulticastJoin,
  dispatchMulticastIgmpQuery,
  dispatchMulticastSnoopingVerify,
  dispatchMulticastSendTest,
} from "@/lib/executionDispatch";

// ── Helpers ─────────────────────────────────────────────────────

type TestStatus = "idle" | "running" | "done" | "error";

interface TestState<T> {
  status: TestStatus;
  result: T | null;
  error: string | null;
}

function idle<T>(): TestState<T> {
  return { status: "idle", result: null, error: null };
}

// ── Store ───────────────────────────────────────────────────────

interface MulticastState {
  // Active groups
  activeGroups: MulticastGroup[];
  selectedGroupKey: string | null;

  // Operation states
  joinOp: TestState<JoinResult>;
  igmpQuery: TestState<IgmpQueryResult>;
  snoopingVerify: TestState<SnoopingVerifyResult>;
  sendTest: TestState<SendTestResult>;

  // Streaming data
  listenerStats: Record<string, ListenerStats>;
  packetLog: MulticastPacketEvent[];

  // Source tracking for execution context display
  lastSource: Record<string, { source: "local" | "remote"; agentId?: string }>;
  runtimeError: string | null;

  // Config
  targetGroup: string;
  targetPort: number;
  testCount: number;
  testInterval: number;
  testTtl: number;
  selectedInterface: string;

  // Audio state
  audioStreams: Record<string, AudioStreamState>;
  audioOutputDeviceId: string | null;
  audioVolume: number;
  audioMuted: boolean;

  // Audio generator state
  generators: Record<string, AudioGeneratorState>;
  genToneType: string;
  genFrequency: number;
  genAmplitude: number;
  genCodec: string;
  genSourceMode: "tone" | "microphone" | "tts";
  genInputDeviceId: string | null;
  genInputGain: number;
  ttsText: string;
  ttsSpeaking: boolean;

  // Group selection
  setSelectedGroupKey: (key: string | null) => void;

  // Config setters
  clearRuntimeError: () => void;
  setTargetGroup: (group: string) => void;
  setTargetPort: (port: number) => void;
  setTestCount: (count: number) => void;
  setTestInterval: (interval: number) => void;
  setTestTtl: (ttl: number) => void;
  setSelectedInterface: (iface: string) => void;

  // Actions (all accept optional ctx?: ExecutionContext)
  joinGroup: (group: string, port: number, iface?: string, ctx?: ExecutionContext) => Promise<void>;
  leaveGroup: (group: string, port?: number) => Promise<void>;
  refreshGroups: () => Promise<void>;
  runIgmpQuery: (iface?: string, ctx?: ExecutionContext) => Promise<void>;
  runSnoopingVerify: (group: string, iface?: string, ctx?: ExecutionContext) => Promise<void>;
  startSendTest: (
    group: string,
    port: number,
    count: number,
    intervalMs: number,
    ttl?: number,
    ctx?: ExecutionContext,
  ) => Promise<void>;

  // Audio actions
  startAudio: (group: string, port: number, codec?: string) => Promise<void>;
  stopAudio: (group: string) => Promise<void>;
  setAudioVolume: (group: string, volume: number) => Promise<void>;
  setAudioMuted: (group: string, muted: boolean) => Promise<void>;
  setAudioOutputDevice: (deviceId: string | null) => void;

  // Audio generator actions
  startGenerator: (group: string, port: number) => Promise<void>;
  stopGenerator: (group: string) => Promise<void>;
  setGenToneType: (tone: string) => void;
  setGenFrequency: (freq: number) => void;
  setGenAmplitude: (amp: number) => void;
  setGenCodec: (codec: string) => void;
  setGenSourceMode: (mode: "tone" | "microphone" | "tts") => void;
  setGenInputDevice: (deviceId: string | null) => void;
  setGenInputGain: (gain: number) => void;
  setTtsText: (text: string) => void;
  setTtsSpeaking: (speaking: boolean) => void;
  updateGeneratorTone: (group: string) => Promise<void>;
  updateGeneratorSource: (group: string) => Promise<void>;
  updateGeneratorInputGain: (group: string) => Promise<void>;
  refreshGenerators: () => Promise<void>;

  // Event handlers (called from component useEffect listeners)
  addPacketEvent: (evt: MulticastPacketEvent) => void;
  addPacketEvents: (events: MulticastPacketEvent[]) => void;
  updateListenerStats: (stats: ListenerStats) => void;
  updateAudioStream: (state: AudioStreamState) => void;
  clearPacketLog: () => void;
}

function groupKey(group: string, port: number) {
  return `${group}:${port}`;
}

export function parseGroupKey(key: string): { group: string; port: number } | null {
  const idx = key.lastIndexOf(":");
  if (idx < 0) return null;
  const group = key.slice(0, idx);
  const port = parseInt(key.slice(idx + 1), 10);
  if (isNaN(port)) return null;
  return { group, port };
}

export const useMulticastStore = create<MulticastState>((set, get) => ({
  activeGroups: [],
  selectedGroupKey: null,

  joinOp: idle(),
  igmpQuery: idle(),
  snoopingVerify: idle(),
  sendTest: idle(),

  listenerStats: {},
  packetLog: [],
  lastSource: {},
  runtimeError: null,

  targetGroup: "239.255.0.1",
  targetPort: 5004,
  testCount: 10,
  testInterval: 100,
  testTtl: 32,
  selectedInterface: "",

  audioStreams: {},
  audioOutputDeviceId: null,
  audioVolume: 0.8,
  audioMuted: false,

  generators: {},
  genToneType: "sine",
  genFrequency: 440,
  genAmplitude: 0.5,
  genCodec: "PCMU",
  genSourceMode: "tone",
  genInputDeviceId: null,
  genInputGain: 1.0,
  ttsText: "",
  ttsSpeaking: false,

  clearRuntimeError: () => set({ runtimeError: null }),

  setSelectedGroupKey: (key) => set({ selectedGroupKey: key }),

  setTargetGroup: (group) => set({ targetGroup: group }),
  setTargetPort: (port) => set({ targetPort: port }),
  setTestCount: (count) => set({ testCount: count }),
  setTestInterval: (interval) => set({ testInterval: interval }),
  setTestTtl: (ttl) => set({ testTtl: ttl }),
  setSelectedInterface: (iface) => set({ selectedInterface: iface }),

  joinGroup: async (group, port, iface, ctx) => {
    set({ joinOp: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchMulticastJoin(ctx, group, port, iface)
        : { source: "local" as const, result: await api.multicastJoinGroup(group, port, iface), agentId: undefined };
      if (!res.result.success) {
        set((s) => ({
          joinOp: { status: "error", result: null, error: res.result.error ?? "Join failed" },
          lastSource: {
            ...s.lastSource,
            join: {
              source: res.source,
              agentId: res.agentId,
            },
          },
        }));
        return;
      }
      set((s) => ({
        joinOp: { status: "done", result: res.result, error: null },
        lastSource: {
          ...s.lastSource,
          join: {
            source: res.source,
            agentId: res.agentId,
          },
        },
      }));
      await get().refreshGroups();
      set({ joinOp: idle(), selectedGroupKey: groupKey(group, port) });
    } catch (e: any) {
      set({ joinOp: { status: "error", result: null, error: e.message }, runtimeError: `Join failed: ${e.message}` });
    }
  },

  leaveGroup: async (group, port) => {
    try {
      await api.multicastLeaveGroup(group, port);
      set((s) => {
        const nextAudio = { ...s.audioStreams };
        delete nextAudio[group];
        const nextGen = { ...s.generators };
        delete nextGen[group];
        const nextStats = { ...s.listenerStats };
        delete nextStats[group];

        const wasSelected = s.selectedGroupKey?.startsWith(group + ":");
        const remaining = s.activeGroups.filter((g) => g.group !== group);
        const first = remaining[0];
        const nextSelected = wasSelected
          ? first != null
            ? groupKey(first.group, first.port)
            : null
          : s.selectedGroupKey;

        return {
          audioStreams: nextAudio,
          generators: nextGen,
          listenerStats: nextStats,
          joinOp: idle(),
          selectedGroupKey: nextSelected,
        };
      });
      await get().refreshGroups();
    } catch (e: any) {
      set({ joinOp: { status: "error", result: null, error: e.message }, runtimeError: `Leave failed: ${e.message}` });
    }
  },

  refreshGroups: async () => {
    try {
      const groups = await api.multicastListGroups();
      set({ activeGroups: groups });
    } catch {}
  },

  runIgmpQuery: async (iface, ctx) => {
    set({ igmpQuery: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchMulticastIgmpQuery(ctx, iface)
        : { source: "local" as const, result: await api.multicastIgmpQuery(iface), agentId: undefined };
      const mergedResult = (() => {
        if (res.source !== "local") return res.result;
        const localGroups = get().activeGroups;
        if (localGroups.length === 0) return res.result;
        const groups = [...res.result.groups_found];
        for (const g of localGroups) {
          const existing = groups.find((r) => r.group === g.group);
          if (existing) {
            if (!existing.compatibility_mode.includes("local app joined")) {
              existing.compatibility_mode = `${existing.compatibility_mode} + local app joined`;
            }
          } else {
            groups.push({
              group: g.group,
              last_reporter: "local-app",
              igmp_version: res.result.igmp_version || 2,
              compatibility_mode: "local app joined",
            });
          }
        }
        groups.sort((a, b) => a.group.localeCompare(b.group));
        return {
          ...res.result,
          groups_found: groups,
        };
      })();
      set((s) => ({
        igmpQuery: { status: "done", result: mergedResult, error: null },
        lastSource: {
          ...s.lastSource,
          igmpQuery: {
            source: res.source,
            agentId: res.agentId,
          },
        },
      }));
    } catch (e: any) {
      set({ igmpQuery: { status: "error", result: null, error: e.message } });
    }
  },

  runSnoopingVerify: async (group, iface, ctx) => {
    set({ snoopingVerify: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchMulticastSnoopingVerify(ctx, group, iface)
        : {
            source: "local" as const,
            result: await api.multicastSnoopingVerify(group, iface),
            agentId: undefined,
          };
      set((s) => ({
        snoopingVerify: { status: "done", result: res.result, error: null },
        lastSource: {
          ...s.lastSource,
          snoopingVerify: {
            source: res.source,
            agentId: res.agentId,
          },
        },
      }));
    } catch (e: any) {
      set({ snoopingVerify: { status: "error", result: null, error: e.message } });
    }
  },

  startSendTest: async (group, port, count, intervalMs, ttl, ctx) => {
    set({ sendTest: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchMulticastSendTest(ctx, group, port, count, intervalMs, ttl)
        : {
            source: "local" as const,
            result: await api.multicastSendTest(group, port, count, intervalMs, ttl),
            agentId: undefined,
          };
      set((s) => ({
        sendTest: { status: "done", result: res.result, error: null },
        lastSource: {
          ...s.lastSource,
          sendTest: {
            source: res.source,
            agentId: res.agentId,
          },
        },
      }));
    } catch (e: any) {
      set({ sendTest: { status: "error", result: null, error: e.message } });
    }
  },

  startAudio: async (group, port, codec) => {
    try {
      const { audioOutputDeviceId } = get();
      await api.multicastAudioStart(group, port, audioOutputDeviceId ?? undefined, codec);
      set((s) => ({
        audioStreams: {
          ...s.audioStreams,
          [group]: {
            group,
            playing: true,
            muted: s.audioMuted,
            volume: s.audioVolume,
            codec_name: codec ?? "",
            sample_rate: 0,
            ssrc: 0,
            source_ip: "",
          },
        },
      }));
    } catch (e: any) {
      set({ runtimeError: `Audio receiver start failed: ${e.message}` });
    }
  },

  stopAudio: async (group) => {
    set((s) => {
      const next = { ...s.audioStreams };
      delete next[group];
      return { audioStreams: next };
    });
    try {
      await api.multicastAudioStop(group);
    } catch (e: any) {
      set({ runtimeError: `Audio receiver stop failed: ${e?.message ?? "unknown error"}` });
    }
  },

  setAudioVolume: async (group, volume) => {
    set({ audioVolume: volume });
    try {
      await api.multicastAudioSetVolume(group, volume);
    } catch (e: any) {
      set({ runtimeError: `Failed to set volume: ${e?.message ?? "unknown error"}` });
    }
  },

  setAudioMuted: async (group, muted) => {
    set({ audioMuted: muted });
    try {
      await api.multicastAudioSetMuted(group, muted);
    } catch (e: any) {
      set({ runtimeError: `Failed to set mute: ${e?.message ?? "unknown error"}` });
    }
  },

  setAudioOutputDevice: (deviceId) => set({ audioOutputDeviceId: deviceId }),

  // ── Audio Generator ──────────────────────────────────────────────

  startGenerator: async (group, port) => {
    const { genCodec, genSourceMode, genToneType, genFrequency, genAmplitude, genInputDeviceId } = get();
    try {
      await api.multicastGenerateStart(
        group, port, genCodec, genSourceMode, genToneType,
        genFrequency, genAmplitude,
        genInputDeviceId ?? undefined,
      );
      set((s) => ({
        generators: {
          ...s.generators,
          [group]: {
            group,
            generating: true,
            tone_type: genToneType,
            frequency: genFrequency,
            amplitude: genAmplitude,
            source_mode: genSourceMode,
            input_device_id: genInputDeviceId,
            input_gain: s.genInputGain,
          },
        },
      }));
      await get().refreshGenerators();
    } catch (e: any) {
      set({ runtimeError: `Audio transmitter start failed: ${e.message}` });
    }
  },

  stopGenerator: async (group) => {
    set((s) => {
      const next = { ...s.generators };
      delete next[group];
      return { generators: next };
    });
    try {
      await api.multicastGenerateStop(group);
    } catch (e: any) {
      set({ runtimeError: `Audio transmitter stop failed: ${e?.message ?? "unknown error"}` });
    }
  },

  setGenToneType: (tone) => set({ genToneType: tone }),
  setGenFrequency: (freq) => set({ genFrequency: freq }),
  setGenAmplitude: (amp) => set({ genAmplitude: amp }),
  setGenCodec: (codec) => set({ genCodec: codec }),
  setGenSourceMode: (mode) => set({ genSourceMode: mode }),
  setGenInputDevice: (deviceId) => set({ genInputDeviceId: deviceId }),
  setGenInputGain: (gain) => set({ genInputGain: gain }),
  setTtsText: (text) => set({ ttsText: text }),
  setTtsSpeaking: (speaking) => set({ ttsSpeaking: speaking }),

  updateGeneratorTone: async (group) => {
    const { genToneType, genFrequency, genAmplitude } = get();
    try {
      await api.multicastGenerateSetTone(group, genToneType, genFrequency, genAmplitude);
    } catch {}
  },

  updateGeneratorSource: async (group) => {
    const { genSourceMode, genInputDeviceId } = get();
    try {
      await api.multicastGenerateSetSource(group, genSourceMode, genInputDeviceId ?? undefined);
    } catch {}
  },

  updateGeneratorInputGain: async (group) => {
    const { genInputGain } = get();
    try {
      await api.multicastGenerateSetInputGain(group, genInputGain);
    } catch {}
  },

  refreshGenerators: async () => {
    try {
      const list = await api.multicastGenerateList();
      const map: Record<string, AudioGeneratorState> = {};
      list.forEach((g) => { map[g.group] = g; });
      set({ generators: map });
    } catch {}
  },

  addPacketEvent: (evt) =>
    set((s) => ({
      packetLog: [...s.packetLog.slice(-299), evt],
    })),

  addPacketEvents: (events) =>
    set((s) => {
      const keep = Math.max(0, 300 - events.length);
      return {
        packetLog: [...s.packetLog.slice(-keep), ...events].slice(-300),
      };
    }),

  updateListenerStats: (stats) =>
    set((s) => ({
      listenerStats: { ...s.listenerStats, [stats.group]: stats },
    })),

  updateAudioStream: (state) =>
    set((s) => ({
      audioStreams: { ...s.audioStreams, [state.group]: state },
    })),

  clearPacketLog: () => set({ packetLog: [] }),
}));

function buildMulticastActivityItems(state: MulticastState): ActivityMonitorWorkItem[] {
  const statusMap: Array<[string, string]> = [
    [state.joinOp.status, "Multicast join"],
    [state.igmpQuery.status, "IGMP query"],
    [state.snoopingVerify.status, "Snooping verify"],
    [state.sendTest.status, "Multicast send test"],
  ];
  const rows: ActivityMonitorWorkItem[] = [];
  for (const [status, label] of statusMap) {
    if (status !== "running") continue;
    rows.push({
      key: `network-${label.toLowerCase().replace(/\s+/g, "-")}`,
      name: label,
      detail: "In progress",
      state: "running",
      cpuPct: 12,
      memMb: 90,
      startedAt: Date.now() - 12_000,
      kind: "network",
    });
  }
  return rows;
}

useMulticastStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "multicast-store",
    buildMulticastActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "multicast-store",
  buildMulticastActivityItems(useMulticastStore.getState()),
);
