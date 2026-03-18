/**
 * Softphone state: active registrar, calls list. No auto-start of packet capture.
 */

import { create } from "zustand";
import { nanoid } from "nanoid";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import type { Call, AudioDevice, CallSavedMetrics, SipLogEntry } from "@/lib/softphone";
import {
  placeCall,
  endCall as endCallApi,
  cancelCall as cancelCallApi,
  holdCall as holdCallApi,
  listAudioInputDevices,
  listAudioOutputDevices,
  startMedia,
  stopMedia,
  setMuted as setMutedApi,
  setInputGain as setInputGainApi,
  setAudioDevices as setAudioDevicesApi,
  answerInboundCall as answerInboundCallApi,
  rejectInboundCall as rejectInboundCallApi,
  getCallMetrics,
  getCallJitterHistory,
  JITTER_BUFFER_DEFAULT_MIN_MS,
  JITTER_BUFFER_DEFAULT_MAX_MS,
  JITTER_BUFFER_MIN_MS,
  JITTER_BUFFER_MAX_MS,
  sendRefer,
  sendDtmf,
  subscribeBLF,
  unsubscribeBLF,
  joinConference as joinConferenceApi,
  leaveConference as leaveConferenceApi,
} from "@/lib/softphone";
import { stopCapture } from "@/api/packetCapture";
import { speechStopTranscription } from "@/api/speech";
import { normalizeDialInput } from "@/lib/e164";
import type { ExecutionContext } from "@/stores/executionContextStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { getRegistrarPassword } from "@/api/registration";
import { dispatchHangupCall } from "@/lib/executionDispatch";
import { useRegistrationStore } from "@/stores/registrationStore";

/** Parse tag= from To header (e.g. "<sip:u@h>;tag=abc" -> "abc"). */
function parseTagFromToHeader(toHeader: string): string | null {
  const i = toHeader.search(/tag=/i);
  if (i === -1) return null;
  const rest = toHeader.slice(i + 4);
  const end = rest.search(/[;\s]/);
  const tag = end === -1 ? rest.trim() : rest.slice(0, end).trim();
  return tag.replace(/^"|"$/g, "") || null;
}

function countLiveCalls(calls: Call[]): number {
  return calls.filter((call) =>
    call.state === "connecting" ||
    call.state === "ringing" ||
    call.state === "active" ||
    call.state === "on-hold"
  ).length;
}

export const CODEC_OPTIONS = ["PCMU", "PCMA", "G722"] as const;

const DEFAULT_PREFERRED_CODECS = [...CODEC_OPTIONS];
const DEFAULT_CODEC_REGISTRAR_KEY = "__default__";

/** Speed dial entry. */
export interface SpeedDialEntry {
  id: string;
  label: string;
  number: string;
}

/** BLF (Busy Lamp Field) entry with presence state. */
export interface BlfEntry {
  id: string;
  type: "extension" | "park";
  label: string;
  extension: string;
  /** Presence state: idle, busy, ringing, offline. Updated by NOTIFY or polling. */
  state: "idle" | "busy" | "ringing" | "offline" | "unknown";
  /** Park-specific: the slot number (e.g. "701") */
  parkSlot?: string;
  /** Park-specific: who is currently parked in this slot */
  parkedCaller?: string;
  /** Park-specific: who parked the call */
  parkedBy?: string;
  /** Park-specific: ISO timestamp when call was parked */
  parkedAt?: string;
}

interface SoftphoneState {
  activeRegistrarId: string | null;
  calls: Call[];
  /** SIP events that arrived before a call had sipCallId bound. */
  pendingSipByCallId: Record<string, SipLogEntry[]>;
  activeCallId: string | null;
  audioInputDeviceId: string | null;
  audioOutputDeviceId: string | null;
  /** Microphone input level 0.0-2.0 (0%-200%); applied at capture. */
  audioInputLevel: number;
  audioInputDevices: AudioDevice[];
  audioOutputDevices: AudioDevice[];
  /** Codec preferences keyed by registrar ID (with a default fallback key). */
  preferredCodecsByRegistrar: Record<string, string[]>;
  preferredCodecs: string[];
  jitterBufferMinMs: number;
  jitterBufferMaxMs: number;
  /** MOH: system only (send silence so server plays MOH). */
  mohPreset: string;

  // ── Settings (Phase 0) ──
  dndEnabled: boolean;
  autoAnswerEnabled: boolean;
  autoAnswerDelayMs: number;
  ringtonePreset: string;
  ringbackEnabled: boolean;
  callWaitingEnabled: boolean;
  maxSimultaneousCalls: number;
  dtmfMode: "rfc2833" | "sip-info";
  dtmfPayloadType: number;
  autoRecordEnabled: boolean;
  recordingFormat: "wav";
  recordingStereo: boolean;
  clickToDialEnabled: boolean;
  autoOpenOnIncoming: boolean;
  forwardAllEnabled: boolean;
  forwardAllTarget: string;
  forwardBusyEnabled: boolean;
  forwardBusyTarget: string;
  forwardNoAnswerEnabled: boolean;
  forwardNoAnswerTarget: string;
  forwardNoAnswerTimeout: number;

  // ── Call Park ──
  parkExtension: string;
  /** "refer" = SIP REFER to park extension; "dtmf" = send park code as in-band DTMF tones. */
  parkMethod: "refer" | "dtmf";

  // ── Audio Quality (Phase 3) ──
  agcEnabled: boolean;
  vadEnabled: boolean;
  plcEnabled: boolean;

  // ── Security (Phase 5) ──
  srtpEnabled: boolean;
  srtpMode: "disabled" | "optional" | "mandatory";

  // ── Speed Dial (Phase 4) ──
  speedDialEntries: SpeedDialEntry[];

  // ── BLF / Presence (keyed by registrar ID) ──
  blfEntries: Record<string, BlfEntry[]>;

  // ── Call Notes (Phase 4) ──
  callNotes: Record<string, string>;

  // ── Audio Visualizer ──
  /** Which visualizer preset to use for the live audio section. */
  visualizer: "nebula" | "ribbon" | "aurora" | "ekg" | "terrain" | "bars" | "rain";
  /** Show or hide the in-call visualizer panel. */
  showVisualizer: boolean;

  // ── MWI (Message Waiting Indicator) — per-registrar ──
  mwiState: Record<string, { waiting: boolean; newCount: number; oldCount: number }>;

  // ── Inbound listener status ──
  inboundListenerActive: boolean;
  inboundListenerPort: number | null;
  inboundListenerPorts: number[];

  /** Registrar IDs to show in the header badge (multi-watch). When empty, falls back to activeRegistrarId. */
  watchedRegistrarIds: string[];

  setActiveRegistrar: (id: string | null) => void;
  setWatchedRegistrars: (ids: string[]) => void;
  setMohPreset: (preset: string) => void;
  /** Update any settings field(s) by partial merge. */
  updateSettings: (partial: Partial<Pick<SoftphoneState,
    | "dndEnabled" | "autoAnswerEnabled" | "autoAnswerDelayMs"
    | "ringtonePreset" | "ringbackEnabled" | "callWaitingEnabled"
    | "maxSimultaneousCalls" | "dtmfMode" | "dtmfPayloadType"
    | "autoRecordEnabled" | "recordingFormat" | "recordingStereo"
    | "clickToDialEnabled" | "autoOpenOnIncoming"
    | "forwardAllEnabled" | "forwardAllTarget" | "forwardBusyEnabled"
    | "forwardBusyTarget" | "forwardNoAnswerEnabled" | "forwardNoAnswerTarget"
    | "forwardNoAnswerTimeout" | "mohPreset" | "parkExtension" | "parkMethod"
    | "agcEnabled" | "vadEnabled" | "plcEnabled"
    | "srtpEnabled" | "srtpMode"
    | "visualizer" | "showVisualizer"
  >>) => void;
  setAudioInputDevice: (id: string | null) => void;
  setAudioOutputDevice: (id: string | null) => void;
  setAudioInputLevel: (level: number) => void;
  setPreferredCodecs: (codecs: string[]) => void;
  setJitterBuffer: (minMs: number, maxMs: number) => void;
  fetchAudioDevices: () => Promise<void>;
  startCall: (target: string, ctx?: ExecutionContext) => Promise<void>;
  endCall: (
    callId: string,
    snapshot?: {
      metrics: CallSavedMetrics;
      jitterHistory: { t: number[]; j: number[] };
      metricsHistory: { t: number; mos: number; jitter_ms: number; loss_percent: number }[];
    },
    options?: { transferredTo?: string }
  ) => Promise<void>;
  holdCall: (callId: string, onHold: boolean) => Promise<void>;
  muteCall: (callId: string, muted: boolean) => void;
  /** Park the active call by REFER to the configured park extension. */
  parkCall: (callId: string) => Promise<void>;
  /** Retrieve a parked call by dialling the park retrieve extension. */
  retrieveParkedCall: (slot?: string) => Promise<void>;
  // ── Speed Dial actions ──
  addSpeedDial: (entry: Omit<SpeedDialEntry, "id">) => void;
  removeSpeedDial: (id: string) => void;
  reorderSpeedDial: (fromIdx: number, toIdx: number) => void;

  // ── BLF / Presence actions ──
  addBlfEntry: (registrarId: string, label: string, extension: string, type?: "extension" | "park", parkSlot?: string) => void;
  removeBlfEntry: (registrarId: string, id: string) => void;
  updateBlfState: (registrarId: string, extension: string, state: BlfEntry["state"]) => void;
  /** Add a batch of park slot keys (e.g. slots 701-710). */
  addParkKeys: (registrarId: string, startSlot: number, count: number) => void;
  /** Update park slot occupancy from a park/unpark event. */
  updateParkSlot: (slot: string, occupied: boolean, caller?: string, parkedBy?: string) => void;

  /** Switch the active line (active call) — auto-holds the current line. */
  switchLine: (callId: string) => Promise<void>;

  /** Merge two calls into a local conference. Resumes both calls. */
  mergeConference: (callIdA: string, callIdB: string) => Promise<void>;
  /** Split a conference — puts one leg back on hold. */
  splitConference: (callId: string) => Promise<void>;

  // ── Call Notes actions ──
  setCallNote: (callId: string, note: string) => void;

  /** Update call progress (statusCode, statusText) for real-time signal flow. */
  setCallProgress: (callId: string, statusCode: number, statusText: string) => void;
  /** Update an inbound call with dialog info so BYE can be sent later. */
  setInboundDialogInfo: (sipCallId: string, info: {
    fromTag: string;
    toTag: string;
    targetUri: string;
    remoteContactUri: string | null;
    responseToHeader: string | null;
  }) => void;
  /** Mark call as ended when far end sends BYE (backend emits softphone:call_ended_by_remote). */
  setCallEndedByRemote: (sipCallId: string) => void;
  /** Add an inbound voice call (backend emitted softphone:incoming_call). */
  setIncomingCall: (payload: {
    registrarId: string;
    callId: string;
    from: string;
    fromDisplay: string;
    to: string;
    requestUri: string;
  }) => void;
  /** Answer an inbound ringing call (by frontend call id). */
  answerInboundCall: (callId: string) => Promise<void>;
  /** Reject an inbound ringing call (by frontend call id). */
  rejectInboundCall: (callId: string, statusCode?: number) => Promise<void>;
  /** Remove a single call from history (e.g. delete entry). */
  removeCall: (callId: string) => void;
  /** Clear all call history. */
  clearCalls: () => void;
  /** Update MWI state from backend event (per-registrar). */
  setMwiState: (registrarId: string, waiting: boolean, newCount: number, oldCount: number) => void;
  /** Update inbound listener status. */
  setInboundListenerStatus: (active: boolean, port: number | null, ports?: number[]) => void;
  /** Continuously save current RTP metrics to a call (so final stats are kept no matter how the call ends). */
  updateCallMetrics: (
    callId: string,
    snapshot: {
      metrics: CallSavedMetrics;
      jitterHistory: { t: number[]; j: number[] };
      metricsHistory: { t: number; mos: number; jitter_ms: number; loss_percent: number }[];
    }
  ) => void;

  // ── Live Transcription ──
  /** Toggle live transcription for the active call. */
  setTranscriptionEnabled: (callId: string, enabled: boolean) => void;
  /** Append a transcript line from a Vosk event. */
  appendTranscript: (callId: string, line: import("@/lib/softphone").TranscriptLine) => void;

  /** Append a SIP message log entry (from backend event). */
  appendSipMessage: (sipCallId: string, entry: import("@/lib/softphone").SipLogEntry) => void;

  /** Append a DTMF digit event (from backend event). */
  appendDtmf: (sipCallId: string, digit: string, direction: "send" | "recv", timestamp: string) => void;
}

export const useSoftphoneStore = create<SoftphoneState>((set, get) => ({
  activeRegistrarId: null,
  calls: [],
  pendingSipByCallId: {},
  activeCallId: null,
  audioInputDeviceId: null,
  audioOutputDeviceId: null,
  audioInputLevel: 1.0,
  audioInputDevices: [],
  audioOutputDevices: [],
  preferredCodecs: [...DEFAULT_PREFERRED_CODECS],
  preferredCodecsByRegistrar: { [DEFAULT_CODEC_REGISTRAR_KEY]: [...DEFAULT_PREFERRED_CODECS] },
  jitterBufferMinMs: JITTER_BUFFER_DEFAULT_MIN_MS,
  jitterBufferMaxMs: JITTER_BUFFER_DEFAULT_MAX_MS,
  mohPreset: "system",

  // Settings defaults
  dndEnabled: false,
  autoAnswerEnabled: false,
  autoAnswerDelayMs: 0,
  ringtonePreset: "default",
  ringbackEnabled: true,
  callWaitingEnabled: true,
  maxSimultaneousCalls: 2,
  dtmfMode: "rfc2833",
  dtmfPayloadType: 101,
  autoRecordEnabled: false,
  recordingFormat: "wav",
  recordingStereo: true,
  clickToDialEnabled: true,
  autoOpenOnIncoming: true,
  forwardAllEnabled: false,
  forwardAllTarget: "",
  forwardBusyEnabled: false,
  forwardBusyTarget: "",
  forwardNoAnswerEnabled: false,
  forwardNoAnswerTarget: "",
  forwardNoAnswerTimeout: 20,
  parkExtension: "*70",
  parkMethod: "refer",

  // Audio quality defaults
  agcEnabled: true,
  vadEnabled: false,
  plcEnabled: true,

  // Security defaults
  srtpEnabled: false,
  srtpMode: "disabled",

  // Speed dial defaults
  speedDialEntries: [],
  blfEntries: {},

  // Call notes
  callNotes: {},

  // Visualizer default
  visualizer: "nebula",
  showVisualizer: true,

  // MWI defaults (per-registrar)
  mwiState: {},

  // Inbound listener status
  inboundListenerActive: false,
  inboundListenerPort: null,
  inboundListenerPorts: [],

  // Header badge: which registrars to watch (empty = use activeRegistrarId)
  watchedRegistrarIds: [],

  setActiveRegistrar: (id) =>
    set((s) => {
      const key = id ?? DEFAULT_CODEC_REGISTRAR_KEY;
      const nextPreferred =
        s.preferredCodecsByRegistrar[key] && s.preferredCodecsByRegistrar[key]!.length > 0
          ? s.preferredCodecsByRegistrar[key]!
          : s.preferredCodecsByRegistrar[DEFAULT_CODEC_REGISTRAR_KEY] && s.preferredCodecsByRegistrar[DEFAULT_CODEC_REGISTRAR_KEY]!.length > 0
            ? s.preferredCodecsByRegistrar[DEFAULT_CODEC_REGISTRAR_KEY]!
            : [...DEFAULT_PREFERRED_CODECS];
      return {
        activeRegistrarId: id,
        preferredCodecs: [...nextPreferred],
      };
    }),
  setWatchedRegistrars: (ids) => set({ watchedRegistrarIds: ids }),
  setMohPreset: (preset) => set({ mohPreset: preset }),
  updateSettings: (partial) => set(partial),

  setPreferredCodecs: (codecs) =>
    set((s) => {
      const normalized = codecs.length > 0 ? codecs : [...DEFAULT_PREFERRED_CODECS];
      const key = s.activeRegistrarId ?? DEFAULT_CODEC_REGISTRAR_KEY;
      return {
        preferredCodecs: [...normalized],
        preferredCodecsByRegistrar: {
          ...s.preferredCodecsByRegistrar,
          [key]: [...normalized],
        },
      };
    }),

  setJitterBuffer: (minMs, maxMs) =>
    set({
      jitterBufferMinMs: Math.max(JITTER_BUFFER_MIN_MS, Math.min(JITTER_BUFFER_MAX_MS, minMs)),
      jitterBufferMaxMs: Math.max(JITTER_BUFFER_MIN_MS, Math.min(JITTER_BUFFER_MAX_MS, Math.max(minMs, maxMs))),
    }),

  setAudioInputDevice: (id) => {
    set({ audioInputDeviceId: id });
    // If there's an active call, hot-swap the audio device without restarting RTP
    const { activeCallId, calls, audioOutputDeviceId } = get();
    const activeCall = activeCallId ? calls.find((c) => c.id === activeCallId) : null;
    if (activeCall?.sipCallId && (activeCall.state === "active" || activeCall.state === "on-hold")) {
      setAudioDevicesApi(activeCall.sipCallId, id, audioOutputDeviceId).catch(() => {});
    }
  },

  setAudioOutputDevice: (id) => {
    set({ audioOutputDeviceId: id });
    // If there's an active call, hot-swap the audio device without restarting RTP
    const { activeCallId, calls, audioInputDeviceId } = get();
    const activeCall = activeCallId ? calls.find((c) => c.id === activeCallId) : null;
    if (activeCall?.sipCallId && (activeCall.state === "active" || activeCall.state === "on-hold")) {
      setAudioDevicesApi(activeCall.sipCallId, audioInputDeviceId, id).catch(() => {});
    }
  },

  setAudioInputLevel: (level) => {
    const normalizedLevel = Math.max(0, Math.min(2, level));
    set({ audioInputLevel: normalizedLevel });
    const { activeCallId, calls } = get();
    const activeCall = activeCallId ? calls.find((c) => c.id === activeCallId) : null;
    if (activeCall?.sipCallId) {
      setInputGainApi(activeCall.sipCallId, normalizedLevel).catch(() => {});
    }
  },

  fetchAudioDevices: async () => {
    try {
      const [inputs, outputs] = await Promise.all([
        listAudioInputDevices(),
        listAudioOutputDevices(),
      ]);
      set((s) => {
        const inputIds = new Set(inputs.map((d) => d.id));
        const outputIds = new Set(outputs.map((d) => d.id));
        const lostInput = s.audioInputDeviceId != null && !inputIds.has(s.audioInputDeviceId);
        const lostOutput = s.audioOutputDeviceId != null && !outputIds.has(s.audioOutputDeviceId);
        const nextInput =
          lostInput ? (inputs[0]?.id ?? null) : s.audioInputDeviceId;
        const nextOutput =
          lostOutput ? (outputs[0]?.id ?? null) : s.audioOutputDeviceId;
        return {
          audioInputDevices: inputs,
          audioOutputDevices: outputs,
          ...(lostInput || lostOutput
            ? { audioInputDeviceId: nextInput, audioOutputDeviceId: nextOutput }
            : {}),
        };
      });
    } catch (e) {
      console.warn("Failed to fetch audio devices", e);
      set({ audioInputDevices: [], audioOutputDevices: [] });
    }
  },

  startCall: async (target, ctx) => {
    const { calls, maxSimultaneousCalls } = get();
    const liveCalls = countLiveCalls(calls);
    const lineLimit = Math.max(1, maxSimultaneousCalls || 1);
    if (liveCalls >= lineLimit) {
      throw new Error(`Maximum simultaneous calls reached (${lineLimit}).`);
    }
    const registrarId = get().activeRegistrarId;
    if (!registrarId) {
      throw new Error("No registrar selected");
    }
    const normalizedTarget = normalizeDialInput(target);

    const id = nanoid();
    const startTime = new Date().toISOString();

    // Remote command call path
    if (ctx && ctx.type !== "local") {
      const registrar = useRegistrationStore.getState().registrars.find((r) => r.id === registrarId);
      if (!registrar) throw new Error("Registrar not found");
      const password = await getRegistrarPassword(registrarId);
      const { connections } = useRemoteAgentStore.getState();
      const dispatchAgentId: string = ctx.agentId;
      if (!dispatchAgentId) {
        throw new Error("Remote agent is not selected.");
      }
      if (
        !connections.some(
          (connection) =>
            connection.id === dispatchAgentId &&
            connection.status === "connected",
        )
      ) {
        throw new Error(
          `Remote worker ${dispatchAgentId} is disconnected. Reconnect the worker and retry the call.`,
        );
      }
      const agentName = connections.find((c) => c.id === dispatchAgentId)?.name
        || connections.find((c) => c.id === dispatchAgentId)?.hostname
        || dispatchAgentId.slice(0, 8);

      const call: Call = {
        id,
        target,
        state: "connecting",
        startTime,
        muted: false,
        remoteAgentId: dispatchAgentId,
        remoteAgentName: agentName,
        registrarId,
      };
      set((s) => ({ calls: [call, ...s.calls], activeCallId: id }));

      try {
        const { sendCommand } = useRemoteAgentStore.getState();
        const msgId = await sendCommand(dispatchAgentId, "SipCall", {
          target: registrar.domain,
          port: registrar.remote_port,
          to_user: normalizedTarget,
          caller_id: registrar.username,
          domain: registrar.domain,
          username: registrar.username,
          password,
          duration_secs: 30,
        });

        // Store the command ID for hangup
        set((s) => ({
          calls: s.calls.map((c) =>
            c.id === id ? { ...c, remoteCommandId: msgId } : c
          ),
        }));

        // Subscribe to progress events for this command
        let lastProgressState = "";
        const unsub = useRemoteAgentStore.subscribe((state) => {
          const cmd = state.pendingCommands.find((c) => c.id === msgId);
          if (!cmd) return;

          // Handle progress events (state updates from agent)
          // Progress comes with partial data containing { state, elapsed_ms, ... }
          if (cmd.status === "running" && cmd.result) {
            const partial = cmd.result as Record<string, any>;
            const progressState = partial?.state;

            // Handle periodic RTP metrics updates from the agent
            if (progressState === "metrics") {
              const metricsSnap: CallSavedMetrics = {
                mos: Number(partial.mos ?? 0),
                jitter_ms: Number(partial.jitter_ms ?? 0),
                send_peak: Number(partial.send_peak ?? 0),
                recv_peak: Number(partial.recv_peak ?? 0),
                loss_percent: Number(partial.loss_percent ?? 0),
                lost_packets: Number(partial.lost_packets ?? 0),
              };
              const jitterT = (partial.jitter_history_t as number[]) ?? [];
              const jitterJ = (partial.jitter_history_j as number[]) ?? [];
              const historyPoint = {
                t: Date.now() / 1000,
                mos: metricsSnap.mos,
                jitter_ms: metricsSnap.jitter_ms,
                loss_percent: metricsSnap.loss_percent,
              };
              set((s) => ({
                calls: s.calls.map((c) => {
                  if (c.id !== id) return c;
                  const prevHistory = c.savedMetricsHistory ?? [];
                  const nextHistory = [...prevHistory, historyPoint].slice(-120);
                  return {
                    ...c,
                    savedMetrics: metricsSnap,
                    savedJitterHistory: { t: jitterT, j: jitterJ },
                    savedMetricsHistory: nextHistory,
                  };
                }),
              }));
              return; // Don't process as a call state change
            }

            if (progressState && progressState !== lastProgressState) {
              lastProgressState = progressState;
              // Map agent states to call states -- "completed" should NOT go to "ended"
              // here; the final Result handles that. "completed" just means BYE was sent.
              const stateMap: Record<string, Call["state"]> = {
                trying: "connecting",
                ringing: "ringing",
                answered: "active",
                sending_audio: "active",
              };
              const callState = stateMap[progressState];
              if (callState) {
                const currentCall = get().calls.find((c) => c.id === id);
                // Only advance state forward, never regress (e.g. don't go from "ended" back to "active")
                if (currentCall && currentCall.state !== "ended" && currentCall.state !== "failed") {
                  const extraFields: Partial<Call> = {};
                  // Store statusCode-like info for diagnostics timeline
                  if (progressState === "trying") {
                    extraFields.statusCode = 100;
                    extraFields.statusText = "Trying";
                  } else if (progressState === "ringing") {
                    extraFields.statusCode = 180;
                    extraFields.statusText = "Ringing";
                  } else if (progressState === "answered") {
                    extraFields.statusCode = 200;
                    extraFields.statusText = "OK";
                    extraFields.responseTimeMs = partial?.answer_time_ms ?? partial?.elapsed_ms;
                  }
                  set((s) => ({
                    calls: s.calls.map((c) =>
                      c.id === id ? { ...c, state: callState, ...extraFields } : c
                    ),
                  }));
                }
              }
            }
          }

          // Handle final result
          if (cmd.status === "done") {
            unsub();
            // Result from agent is wrapped: { success, result: { ... actual data ... }, elapsed_ms }
            const rawResult = cmd.result as Record<string, any> | null;
            const result = rawResult?.result ?? rawResult;
            set((s) => {
              const updatedCalls = s.calls.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      state: "ended" as const,
                      endTime: c.endTime ?? new Date().toISOString(),
                      remotePcapBase64: result?.pcap_base64 ?? null,
                      responseTimeMs: c.responseTimeMs ?? result?.answer_time_ms,
                      statusCode: c.statusCode && c.statusCode >= 200 ? c.statusCode : (result?.status ? Number(result.status) : c.statusCode),
                    }
                  : c
              );
              // Clear activeCallId if this was the active call
              const stillActive = updatedCalls.find(
                (c) => c.id !== id && c.state !== "ended" && c.state !== "failed"
              );
              return {
                calls: updatedCalls,
                activeCallId: s.activeCallId === id ? (stillActive?.id ?? null) : s.activeCallId,
              };
            });
          }

          // Handle error
          if (cmd.status === "error") {
            unsub();
            set((s) => {
              const updatedCalls = s.calls.map((c) =>
                c.id === id
                  ? { ...c, state: "failed" as const, errorMessage: cmd.error ?? "Remote call failed" }
                  : c
              );
              const stillActive = updatedCalls.find(
                (c) => c.id !== id && c.state !== "ended" && c.state !== "failed"
              );
              return {
                calls: updatedCalls,
                activeCallId: s.activeCallId === id ? (stillActive?.id ?? null) : s.activeCallId,
              };
            });
          }
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        set((s) => ({
          calls: s.calls.map((c) =>
            c.id === id ? { ...c, state: "failed" as const, errorMessage } : c
          ),
        }));
      }
      return;
    }

    // Local call path
    const call: Call = {
      id,
      target,
      state: "connecting",
      startTime,
      muted: false,
      registrarId,
    };
    set((s) => ({
      calls: [call, ...s.calls],
      activeCallId: id,
    }));
    try {
      const { preferredCodecsByRegistrar } = get();
      const callPreferredCodecs =
        preferredCodecsByRegistrar[registrarId] && preferredCodecsByRegistrar[registrarId]!.length > 0
          ? preferredCodecsByRegistrar[registrarId]!
          : preferredCodecsByRegistrar[DEFAULT_CODEC_REGISTRAR_KEY] && preferredCodecsByRegistrar[DEFAULT_CODEC_REGISTRAR_KEY]!.length > 0
            ? preferredCodecsByRegistrar[DEFAULT_CODEC_REGISTRAR_KEY]!
            : [...DEFAULT_PREFERRED_CODECS];
      const result = await placeCall(registrarId, normalizedTarget, callPreferredCodecs, id);
      const code = Number(result.status_code);
      const hasRtp =
        result.remote_rtp_address != null &&
        result.remote_rtp_address !== "" &&
        result.remote_rtp_port != null;
      const isAnswered =
        (code >= 200 && code < 300) ||
        hasRtp ||
        result.ok === true;
      const callState = isAnswered
        ? "active"
        : code === 180 || code === 183
          ? "ringing"
          : "failed";
      set((s) => {
        const pendingSip = s.pendingSipByCallId[result.call_id] ?? [];
        const nextPendingSip = { ...s.pendingSipByCallId };
        if (result.call_id in nextPendingSip) {
          delete nextPendingSip[result.call_id];
        }
        return {
          calls: s.calls.map((c) =>
            c.id === id
              ? {
                  ...c,
                  state: callState,
                  sipCallId: result.call_id,
                  fromTag: result.from_tag,
                  toTag: result.to_tag ?? undefined,
                  responseToHeader: result.response_to_header ?? undefined,
                  targetUri: result.target_uri,
                  remoteContactUri: result.remote_contact_uri ?? undefined,
                  negotiatedCodec: result.negotiated_codec ?? undefined,
                  negotiatedPt: result.negotiated_pt ?? undefined,
                  remoteRtpAddress: result.remote_rtp_address ?? undefined,
                  remoteRtpPort: result.remote_rtp_port ?? undefined,
                  statusCode: code,
                  statusText: result.status_text,
                  responseTimeMs: result.response_time_ms,
                  requestMessage: result.request_message,
                  responseMessage: result.response_message,
                  errorMessage: callState === "failed" ? (result.status_text ? `${code} ${result.status_text}` : String(code)) : undefined,
                  localRtpPort: result.local_rtp_port,
                  localIp: result.local_ip ?? undefined,
                  dialogCSeq: result.dialog_cseq ?? 1,
                  captureSessionId: result.capture_session_id ?? undefined,
                  sipLog: pendingSip.length > 0 ? [...(c.sipLog ?? []), ...pendingSip] : c.sipLog,
                }
              : c
          ),
          pendingSipByCallId: nextPendingSip,
        };
      });
      if (isAnswered && hasRtp) {
        const { audioInputDeviceId, audioOutputDeviceId, audioInputLevel, jitterBufferMinMs, jitterBufferMaxMs, mohPreset } = get();
        const normalizedInputLevel = Math.max(0, Math.min(2, audioInputLevel));
        // Brief delay so ringback AudioContext can close and release the default output before native media engine opens it (avoids no-audio after answer).
        const startMediaArgs = [
          result.call_id,
          result.local_rtp_port,
          result.remote_rtp_address!,
          result.remote_rtp_port!,
          audioInputDeviceId,
          audioOutputDeviceId,
          jitterBufferMinMs,
          jitterBufferMaxMs,
          result.negotiated_codec ?? undefined,
          result.negotiated_pt ?? undefined,
          mohPreset,
          normalizedInputLevel,
        ] as const;
        const doStartMedia = () =>
          startMedia(...startMediaArgs).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn("Start media failed", msg);
            set((s) => ({
              calls: s.calls.map((c) =>
                c.id === id ? { ...c, audioError: msg || "Audio unavailable" } : c
              ),
            }));
          });
        setTimeout(doStartMedia, 120);
      } else if (isAnswered && (!result.remote_rtp_address || result.remote_rtp_port == null)) {
        set((s) => ({
          calls: s.calls.map((c) =>
            c.id === id ? { ...c, audioError: "No RTP in 200 OK SDP" } : c
          ),
        }));
      }

      // Stop capture for failed calls — no BYE listener will be set up to do it later.
      // Give a small delay so the capture thread can flush any remaining packets.
      if (callState === "failed" && result.capture_session_id) {
        setTimeout(() => {
          stopCapture(result.capture_session_id!).catch((e) =>
            console.warn("stopCapture for failed call:", e)
          );
        }, 500);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("placeCall failed", err);
      set((s) => ({
        calls: s.calls.map((c) =>
          c.id === id ? { ...c, state: "failed" as const, errorMessage } : c
        ),
      }));
    }
  },

  endCall: async (callId, snapshot, options) => {
    const callForRegistrar = get().calls.find((c) => c.id === callId);
    const activeRegistrarId = callForRegistrar?.registrarId ?? get().activeRegistrarId;
    const now = new Date().toISOString();

    // ── Remote call hangup path ──
    const remoteCall = get().calls.find((c) => c.id === callId);
    if (remoteCall?.remoteAgentId) {
      set((s) => {
        const updatedCalls = s.calls.map((c) =>
          c.id === callId ? { ...c, state: "ended" as const, endTime: c.endTime ?? now } : c
        );
        // Find next active call that isn't this one
        const stillActive = updatedCalls.find(
          (c) => c.id !== callId && c.state !== "ended" && c.state !== "failed"
        );
        return {
          calls: updatedCalls,
          activeCallId: s.activeCallId === callId ? (stillActive?.id ?? null) : s.activeCallId,
        };
      });
      // Fire-and-forget: tell the agent to send BYE (only if we have a command ID)
      if (remoteCall.remoteCommandId) {
        console.log("[softphone] Sending HangupCall to agent", remoteCall.remoteAgentId, "command", remoteCall.remoteCommandId);
        dispatchHangupCall(remoteCall.remoteAgentId, remoteCall.remoteCommandId)
          .then(() => console.log("[softphone] HangupCall dispatched successfully"))
          .catch((e) => console.warn("[softphone] Remote hangup failed:", e));
      } else {
        console.warn("[softphone] Cannot send HangupCall: no remoteCommandId on call", callId);
      }
      return;
    }

    // ── 1. Optimistic UI update — mark ended IMMEDIATELY so the UI is responsive ──
    set((s) => {
      const updated = s.calls.map((c) => {
        if (c.id !== callId) return c;
        const base = {
          ...c,
          state: "ended" as const,
          endTime: c.endTime ?? now,
          ...(options?.transferredTo != null ? { transferredTo: options.transferredTo } : {}),
        };
        if (snapshot) {
          return {
            ...base,
            savedMetrics: snapshot.metrics,
            savedJitterHistory: snapshot.jitterHistory,
            savedMetricsHistory: snapshot.metricsHistory,
          };
        }
        return base;
      });
      const stillActive = updated.find(
        (c) => c.id !== callId && c.state !== "ended" && c.state !== "failed"
      );
      return {
        calls: updated,
        activeCallId: stillActive ? stillActive.id : null,
      };
    });

    // ── 2. Background cleanup ──
    // Re-read the call from the store AFTER the UI update to get the latest dialog info
    // (fromTag, toTag, targetUri may have been set asynchronously after initial placement).
    const call = get().calls.find((c) => c.id === callId);

    // ALWAYS stop media if we have a sipCallId — this must happen regardless of
    // whether we can send BYE/CANCEL. Prevents audio from continuing after visual end.
    if (call?.sipCallId) {
      stopMedia(call.sipCallId).catch((e) =>
        console.warn("stopMedia failed:", e)
      );
    }

    // Send BYE or CANCEL (fire-and-forget — backend also stops capture internally)
    if (
      call?.sipCallId &&
      call.fromTag != null &&
      call.targetUri &&
      activeRegistrarId
    ) {
      const doSignaling = async () => {
        try {
          if (call.toTag != null && call.toTag !== "") {
            const byeCSeq = (call.dialogCSeq ?? 1) + 1;
            await endCallApi(
              activeRegistrarId,
              call.sipCallId!,
              call.fromTag!,
              call.toTag,
              call.targetUri!,
              call.remoteContactUri ?? null,
              call.responseToHeader ?? null,
              byeCSeq
            );
          } else {
            await cancelCallApi(activeRegistrarId, call.sipCallId!, call.fromTag!, call.targetUri!);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("endCall/cancelCall failed:", msg);
          set((s) => ({
            calls: s.calls.map((c) =>
              c.id === callId ? { ...c, errorMessage: `BYE failed: ${msg}` } : c
            ),
          }));
        }
      };
      doSignaling();
    } else if (call?.sipCallId && !call.fromTag) {
      // If we still don't have dialog info, retry once after a short delay
      // (dialog info may arrive from backend event just after the call was placed).
      setTimeout(() => {
        const retryCall = get().calls.find((c) => c.id === callId);
        if (retryCall?.sipCallId && retryCall.fromTag && retryCall.targetUri && activeRegistrarId) {
          if (retryCall.toTag) {
            const byeCSeq = (retryCall.dialogCSeq ?? 1) + 1;
            endCallApi(activeRegistrarId, retryCall.sipCallId!, retryCall.fromTag!, retryCall.toTag, retryCall.targetUri!, retryCall.remoteContactUri ?? null, retryCall.responseToHeader ?? null, byeCSeq).catch(() => {});
          } else {
            cancelCallApi(activeRegistrarId, retryCall.sipCallId!, retryCall.fromTag!, retryCall.targetUri!).catch(() => {});
          }
        } else {
          console.warn("endCall: still missing dialog data after retry, cannot send BYE/CANCEL.");
        }
      }, 300);
    }

    // Stop live transcription (fire-and-forget)
    if (call?.sipCallId && call?.transcriptionEnabled) {
      speechStopTranscription(call.sipCallId).catch((e) =>
        console.warn("speechStopTranscription failed:", e)
      );
    }

    // Safety net: stop associated packet capture
    if (call?.captureSessionId) {
      stopCapture(call.captureSessionId).catch((e) =>
        console.warn("stopCapture failed (may already be stopped):", e)
      );
    }
  },

  holdCall: async (callId, onHold) => {
    const { calls, activeRegistrarId } = get();
    const call = calls.find((c) => c.id === callId);
    if (!call?.sipCallId || !call.fromTag || !call.targetUri || !activeRegistrarId) {
      set((s) => ({
        calls: s.calls.map((c) =>
          c.id === callId ? { ...c, errorMessage: "Hold: missing call or registrar" } : c
        ),
      }));
      return;
    }
    const toTag = call.toTag ?? parseTagFromToHeader(call.responseToHeader ?? "");
    if (!toTag) {
      set((s) => ({
        calls: s.calls.map((c) =>
          c.id === callId ? { ...c, errorMessage: "Hold: no To tag (dialog not ready)" } : c
        ),
      }));
      return;
    }
    try {
      const nextCSeq = (call.dialogCSeq ?? 1) + 1;
      const usedCSeq = await holdCallApi(
        activeRegistrarId,
        call.sipCallId,
        call.fromTag,
        toTag,
        call.targetUri,
        call.remoteContactUri ?? null,
        onHold,
        nextCSeq,
        call.localRtpPort ?? null,
        call.localIp ?? null
      );
      set((s) => ({
        calls: s.calls.map((c) =>
          c.id === callId
            ? { ...c, state: onHold ? "on-hold" : "active", errorMessage: undefined, dialogCSeq: usedCSeq }
            : c
        ),
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Hold failed", e);
      set((s) => ({
        calls: s.calls.map((c) =>
          c.id === callId ? { ...c, errorMessage: `Hold failed: ${msg}` } : c
        ),
      }));
    }
  },

  muteCall: async (callId, muted) => {
    const call = get().calls.find((c) => c.id === callId);
    if (call?.sipCallId) {
      try {
        await setMutedApi(call.sipCallId, muted);
      } catch (e) {
        console.error("setMuted failed — mic state unchanged", e);
        return;
      }
    }
    const event = { at: new Date().toISOString(), type: muted ? ("mute" as const) : ("unmute" as const) };
    set((s) => ({
      calls: s.calls.map((c) =>
        c.id === callId ? { ...c, muted, muteEvents: [...(c.muteEvents ?? []), event] } : c
      ),
    }));
  },

  parkCall: async (callId) => {
    const { calls, activeRegistrarId, parkExtension, parkMethod, dtmfPayloadType } = get();
    const call = calls.find((c) => c.id === callId);
    if (!call?.sipCallId || !activeRegistrarId) return;

    if (parkMethod === "dtmf") {
      // Send park extension digits as in-band DTMF tones with inter-digit delay
      try {
        for (let i = 0; i < parkExtension.length; i++) {
          const digit = parkExtension[i]!;
          await sendDtmf(call.sipCallId, digit, dtmfPayloadType);
          if (i < parkExtension.length - 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        set((s) => ({
          calls: s.calls.map((c) =>
            c.id === callId ? { ...c, transferredTo: `Park/DTMF (${parkExtension})` } : c
          ),
        }));
      } catch (e) {
        console.error("Park (DTMF) failed", e);
      }
      return;
    }

    // REFER method (default)
    if (!call.fromTag || !call.targetUri) return;
    const toTag = call.toTag ?? parseTagFromToHeader(call.responseToHeader ?? "");
    if (!toTag) return;
    try {
      const nextCSeq = (call.dialogCSeq ?? 1) + 1;
      const domain = call.targetUri.replace(/^sip:.*@/, "").replace(/[;>].*/, "");
      const referTo = `sip:${parkExtension}@${domain}`;
      await sendRefer(
        activeRegistrarId,
        call.sipCallId,
        call.fromTag,
        toTag,
        call.targetUri,
        call.remoteContactUri ?? null,
        call.responseToHeader ?? null,
        nextCSeq,
        referTo,
      );
      set((s) => ({
        calls: s.calls.map((c) =>
          c.id === callId ? { ...c, transferredTo: `Park (${parkExtension})`, dialogCSeq: nextCSeq } : c
        ),
      }));
    } catch (e) {
      console.error("Park (REFER) failed", e);
    }
  },

  retrieveParkedCall: async (slot) => {
    const { activeRegistrarId, parkExtension } = get();
    if (!activeRegistrarId) return;
    const target = slot || parkExtension;
    get().startCall(target);
  },

  addSpeedDial: (entry) => {
    const id = nanoid();
    set((s) => ({
      speedDialEntries: [...s.speedDialEntries, { ...entry, id }],
    }));
  },

  removeSpeedDial: (id) => {
    set((s) => ({
      speedDialEntries: s.speedDialEntries.filter((e) => e.id !== id),
    }));
  },

  reorderSpeedDial: (fromIdx, toIdx) => {
    set((s) => {
      const entries = [...s.speedDialEntries];
      const [moved] = entries.splice(fromIdx, 1);
      if (moved) entries.splice(toIdx, 0, moved);
      return { speedDialEntries: entries };
    });
  },

  addBlfEntry: (registrarId, label, extension, type = "extension", parkSlot) => {
    const id = nanoid();
    const entry: BlfEntry = {
      id, type, label, extension, state: type === "park" ? "idle" : "unknown" as const,
      ...(parkSlot ? { parkSlot } : {}),
    };
    set((s) => {
      const prev = s.blfEntries[registrarId] ?? [];
      return { blfEntries: { ...s.blfEntries, [registrarId]: [...prev, entry] } };
    });
    if (type === "extension") {
      subscribeBLF(registrarId, extension).catch((e) =>
        console.warn("[BLF] SUBSCRIBE failed:", e)
      );
    }
  },

  removeBlfEntry: (registrarId, id) => {
    const entries = get().blfEntries[registrarId] ?? [];
    const entry = entries.find((e) => e.id === id);
    set((s) => ({
      blfEntries: { ...s.blfEntries, [registrarId]: (s.blfEntries[registrarId] ?? []).filter((e) => e.id !== id) },
    }));
    if (entry) {
      unsubscribeBLF(registrarId, entry.extension).catch(() => {});
    }
  },

  updateBlfState: (registrarId, extension, state) => {
    set((s) => {
      const prev = s.blfEntries[registrarId] ?? [];
      if (!prev.some((e) => e.extension === extension)) return {};
      return { blfEntries: { ...s.blfEntries, [registrarId]: prev.map((e) => e.extension === extension ? { ...e, state } : e) } };
    });
  },

  addParkKeys: (registrarId, startSlot, count) => {
    set((s) => {
      const prev = s.blfEntries[registrarId] ?? [];
      const existingSlots = new Set(prev.filter((e) => e.type === "park").map((e) => e.parkSlot));
      const newEntries: BlfEntry[] = [];
      for (let i = 0; i < count; i++) {
        const slot = String(startSlot + i);
        if (existingSlots.has(slot)) continue;
        newEntries.push({
          id: nanoid(),
          type: "park",
          label: `Park ${slot}`,
          extension: slot,
          state: "idle",
          parkSlot: slot,
        });
      }
      return { blfEntries: { ...s.blfEntries, [registrarId]: [...prev, ...newEntries] } };
    });
  },

  updateParkSlot: (slot, occupied, caller, parkedBy) => {
    set((s) => {
      const updated: Record<string, BlfEntry[]> = {};
      for (const [regId, entries] of Object.entries(s.blfEntries)) {
        updated[regId] = entries.map((e) =>
          e.type === "park" && e.parkSlot === slot
            ? { ...e, state: occupied ? "busy" as const : "idle" as const, parkedCaller: occupied ? caller : undefined, parkedBy: occupied ? parkedBy : undefined, parkedAt: occupied ? new Date().toISOString() : undefined }
            : e
        );
      }
      return { blfEntries: { ...s.blfEntries, ...updated } };
    });
  },

  mergeConference: async (callIdA, callIdB) => {
    const confId = nanoid(8);
    const { holdCall: hold } = get();
    const callA = get().calls.find((c) => c.id === callIdA);
    const callB = get().calls.find((c) => c.id === callIdB);
    if (callA?.state === "on-hold") {
      try { await hold(callIdA, false); } catch { /* best effort */ }
    }
    if (callB?.state === "on-hold") {
      try { await hold(callIdB, false); } catch { /* best effort */ }
    }
    set((s) => ({
      calls: s.calls.map((c) =>
        c.id === callIdA || c.id === callIdB
          ? { ...c, conferenceId: confId }
          : c
      ),
    }));
    // Wire backend audio mixer
    if (callA?.sipCallId) joinConferenceApi(callA.sipCallId, confId).catch(() => {});
    if (callB?.sipCallId) joinConferenceApi(callB.sipCallId, confId).catch(() => {});
  },

  splitConference: async (callId) => {
    const { holdCall: hold, calls } = get();
    const call = calls.find((c) => c.id === callId);
    if (!call?.conferenceId) return;
    const confId = call.conferenceId;
    const confCalls = calls.filter((c) => c.conferenceId === confId);
    try { await hold(callId, true); } catch { /* best effort */ }
    // Remove from backend mixer
    if (call.sipCallId) leaveConferenceApi(call.sipCallId).catch(() => {});
    set((s) => ({
      calls: s.calls.map((c) => {
        if (c.id === callId) return { ...c, conferenceId: null };
        if (c.conferenceId === confId && confCalls.length <= 2) {
          if (c.sipCallId) leaveConferenceApi(c.sipCallId).catch(() => {});
          return { ...c, conferenceId: null };
        }
        return c;
      }),
    }));
  },

  switchLine: async (callId) => {
    const { calls, activeCallId, holdCall: hold } = get();
    if (callId === activeCallId) return;
    // Hold current active call
    const current = calls.find((c) => c.id === activeCallId);
    if (current && current.state === "active") {
      try { await hold(current.id, true); } catch { /* best effort */ }
    }
    // Resume target call
    const target = calls.find((c) => c.id === callId);
    if (target && target.state === "on-hold") {
      try { await hold(target.id, false); } catch { /* best effort */ }
    }
    set({ activeCallId: callId });
  },

  setCallNote: (callId, note) => {
    set((s) => ({
      callNotes: { ...s.callNotes, [callId]: note },
    }));
  },

  setCallProgress: (callId, statusCode, statusText) => {
    set((s) => ({
      calls: s.calls.map((c) =>
        c.id === callId ? { ...c, statusCode, statusText } : c
      ),
    }));
  },

  setInboundDialogInfo: (sipCallId, info) => {
    const norm = (id: string) => (id ?? "").trim().toLowerCase();
    const n = norm(sipCallId);
    set((s) => ({
      calls: s.calls.map((c) =>
        norm(c.sipCallId ?? "") === n
          ? {
              ...c,
              fromTag: info.fromTag,
              toTag: info.toTag,
              targetUri: info.targetUri,
              remoteContactUri: info.remoteContactUri ?? undefined,
              responseToHeader: info.responseToHeader ?? undefined,
            }
          : c
      ),
    }));
  },

  setCallEndedByRemote: (sipCallId) => {
    const now = new Date().toISOString();
    const norm = (id: string) => (id ?? "").trim().toLowerCase();
    const n = norm(sipCallId);

    // Try to do a final metrics snapshot before stopping media.
    // This ensures savedMetrics are present even if the polling interval hadn't run yet.
    (async () => {
      try {
        const [metricsResult, jitterResult] = await Promise.all([
          getCallMetrics(sipCallId).catch(() => null),
          getCallJitterHistory(sipCallId).catch(() => null),
        ]);
        if (metricsResult) {
          set((s) => ({
            calls: s.calls.map((c) => {
              if (norm(c.sipCallId ?? "") !== n) return c;
              return {
                ...c,
                savedMetrics: {
                  mos: metricsResult.mos,
                  jitter_ms: metricsResult.jitter_ms,
                  send_peak: metricsResult.send_peak,
                  recv_peak: metricsResult.recv_peak,
                  loss_percent: metricsResult.loss_percent,
                  lost_packets: metricsResult.lost_packets,
                },
                savedJitterHistory: jitterResult
                  ? { t: jitterResult.timestamps_sec, j: jitterResult.jitter_ms }
                  : c.savedJitterHistory,
              };
            }),
          }));
        }
      } catch {
        // Metrics fetch failed — the call may have already been stopped. savedMetrics from polling are still preserved.
      }
    })();

    set((s) => {
      const ended = s.calls.find((c) => norm(c.sipCallId ?? "") === n);
      const calls = s.calls.map((c) =>
        norm(c.sipCallId ?? "") === n
          ? { ...c, state: "ended" as const, endTime: c.endTime ?? now }
          : c
      );
      const activeCall = s.activeCallId ? s.calls.find((c) => c.id === s.activeCallId) : null;
      const activeWasEnded =
        (s.activeCallId && ended && s.activeCallId === ended.id) ||
        (activeCall && norm(activeCall.sipCallId ?? "") === n);
      return {
        calls,
        activeCallId: activeWasEnded ? null : s.activeCallId,
      };
    });
    stopMedia(sipCallId).catch(() => {});

    // Stop live transcription if active.
    speechStopTranscription(sipCallId).catch(() => {});

    // Safety net: stop associated packet capture.
    const endedCall = get().calls.find((c) => norm(c.sipCallId ?? "") === n);
    if (endedCall?.captureSessionId) {
      stopCapture(endedCall.captureSessionId).catch(() => {});
    }
  },

  setIncomingCall: (payload) => {
    const state = get();
    const lineLimit = Math.max(1, state.maxSimultaneousCalls || 1);
    const liveCalls = countLiveCalls(state.calls);
    const callWaitingAllowed = state.callWaitingEnabled;
    const hasCapacity = liveCalls < lineLimit;
    const canPresentIncoming = hasCapacity && (callWaitingAllowed || liveCalls === 0);
    if (!canPresentIncoming) {
      rejectInboundCallApi(payload.callId, 486).catch(() => {});
      return;
    }

    const target = payload.fromDisplay?.trim() || payload.from?.trim() || "Unknown";
    const now = new Date().toISOString();
    const call: Call = {
      id: nanoid(),
      target,
      state: "ringing",
      startTime: now,
      sipCallId: payload.callId,
      isInbound: true,
      registrarId: payload.registrarId,
    };
    set((s) => {
      if (s.calls.some((existing) => existing.sipCallId === payload.callId)) {
        return s;
      }
      return { calls: [call, ...s.calls], activeCallId: s.activeCallId ?? call.id };
    });
  },

  answerInboundCall: async (callId) => {
    const { calls } = get();
    const call = calls.find((c) => c.id === callId);
    if (!call?.sipCallId || !call?.registrarId) return;
    // Immediately show "connecting" so the user gets visual feedback while 200 OK / ACK exchange happens.
    set((s) => ({
      calls: s.calls.map((c) => (c.id === callId ? { ...c, state: "connecting" as const } : c)),
      activeCallId: callId,
    }));
    try {
      const captureSessionId = await answerInboundCallApi(call.registrarId, call.sipCallId);
      set((s) => ({
        calls: s.calls.map((c) =>
          c.id === callId
            ? { ...c, state: "active" as const, captureSessionId: captureSessionId ?? undefined }
            : c
        ),
        activeCallId: callId,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((s) => ({
        calls: s.calls.map((c) => (c.id === callId ? { ...c, state: "failed" as const, errorMessage: msg } : c)),
      }));
    }
  },

  rejectInboundCall: async (callId, statusCode = 486) => {
    const { calls } = get();
    const call = calls.find((c) => c.id === callId);
    if (!call?.sipCallId) return;
    try {
      await rejectInboundCallApi(call.sipCallId, statusCode);
      const now = new Date().toISOString();
      set((s) => ({
        calls: s.calls.map((c) => (c.id === callId ? { ...c, state: "ended" as const, endTime: now } : c)),
        activeCallId: s.activeCallId === callId ? null : s.activeCallId,
      }));
    } catch {
      const now = new Date().toISOString();
      set((s) => ({
        calls: s.calls.map((c) => (c.id === callId ? { ...c, state: "ended" as const, endTime: now } : c)),
        activeCallId: s.activeCallId === callId ? null : s.activeCallId,
      }));
    }
  },

  removeCall: (callId) => {
    set((s) => {
      const next = s.calls.filter((c) => c.id !== callId);
      const wasActive = s.activeCallId === callId;
      return {
        calls: next,
        activeCallId: wasActive ? null : s.activeCallId,
      };
    });
  },

  clearCalls: () => {
    set({ calls: [], pendingSipByCallId: {}, activeCallId: null });
  },

  updateCallMetrics: (callId, snapshot) => {
    set((s) => ({
      calls: s.calls.map((c) =>
        c.id === callId
          ? {
              ...c,
              savedMetrics: snapshot.metrics,
              savedJitterHistory: snapshot.jitterHistory,
              savedMetricsHistory: snapshot.metricsHistory,
            }
          : c
      ),
    }));
  },

  setMwiState: (registrarId, waiting, newCount, oldCount) => {
    set((s) => ({
      mwiState: {
        ...s.mwiState,
        [registrarId]: { waiting, newCount, oldCount },
      },
    }));
  },

  setInboundListenerStatus: (active, port, ports = []) => {
    set({ inboundListenerActive: active, inboundListenerPort: port, inboundListenerPorts: ports });
  },

  // ── Live Transcription ──
  setTranscriptionEnabled: (callId, enabled) => {
    set((s) => ({
      calls: s.calls.map((c) =>
        c.id === callId ? { ...c, transcriptionEnabled: enabled, transcription: enabled ? (c.transcription ?? []) : c.transcription } : c
      ),
    }));
  },

  appendTranscript: (callId, line) => {
    set((s) => ({
      calls: s.calls.map((c) => {
        if (c.id !== callId) return c;
        const existing = c.transcription ?? [];
        if (line.isFinal) {
          const filtered = existing.filter(
            (l) => l.isFinal || l.speaker !== line.speaker
          );
          return { ...c, transcription: [...filtered, line] };
        } else {
          const filtered = existing.filter(
            (l) => l.isFinal || l.speaker !== line.speaker
          );
          return { ...c, transcription: [...filtered, line] };
        }
      }),
    }));
  },

  appendSipMessage: (sipCallId, entry) => {
    set((s) => {
      let matched = false;
      const calls = s.calls.map((c) => {
        if (c.sipCallId !== sipCallId) return c;
        matched = true;
        const log = c.sipLog ?? [];
        if (log.length >= 500) return { ...c, sipLog: [...log.slice(-400), entry] };
        return { ...c, sipLog: [...log, entry] };
      });

      if (matched) {
        return { calls };
      }

      const pending = s.pendingSipByCallId[sipCallId] ?? [];
      const nextPending = {
        ...s.pendingSipByCallId,
        [sipCallId]: pending.length >= 500 ? [...pending.slice(-400), entry] : [...pending, entry],
      };
      return { calls, pendingSipByCallId: nextPending };
    });
  },

  appendDtmf: (sipCallId, digit, direction, timestamp) => {
    set((s) => ({
      calls: s.calls.map((c) => {
        if (c.sipCallId !== sipCallId) return c;
        const digits = c.dtmfDigits ?? [];
        return { ...c, dtmfDigits: [...digits, { digit, direction, timestamp }] };
      }),
    }));
  },
}));

function buildSoftphoneActivityItems(state: SoftphoneState): ActivityMonitorWorkItem[] {
  const rows: ActivityMonitorWorkItem[] = [];
  for (const call of state.calls) {
    if (!["connecting", "ringing", "active", "on-hold"].includes(call.state)) continue;
    rows.push({
      key: `call-${call.id}`,
      name: `Call: ${call.target || call.id}`,
      detail: `${call.state}`,
      state: "running",
      cpuPct: 20,
      memMb: 125,
      startedAt: call.startTime ? new Date(call.startTime).getTime() : Date.now() - 10_000,
      kind: "call",
      callId: call.id,
      canStop: true,
    });
  }
  return rows.slice(0, 40);
}

useSoftphoneStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "softphone-store",
    buildSoftphoneActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "softphone-store",
  buildSoftphoneActivityItems(useSoftphoneStore.getState()),
);
