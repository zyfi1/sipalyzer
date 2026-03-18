import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { listen } from "@/lib/tauriEvents";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useToolStore } from "@/stores/toolStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useToolVisible } from "@/hooks/useToolVisible";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { getCallMetrics, getCallJitterHistory, getCallWaveform } from "@/lib/softphone";
import { Activity, ChevronLeft, Grid3x3, Hash, Mic, PhoneCall, Radio, Users } from "@/lib/icons";
import { isRecording as checkIsRecording } from "@/lib/softphone";
import { cn } from "@/lib/utils";
import { ViewFooter, ViewFooterDivider, ViewFooterItem, ViewFooterSpacer } from "@/components/layout/ViewFooter";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { SoftphoneHeader } from "./SoftphoneHeader";
import { KeypadPane, IncomingCallScreen } from "./DialerView";
import { CallsView } from "./CallsView";
import { ContactsView } from "./ContactsView";
import { InCallView } from "./InCallView";
import { PostCallView } from "./PostCallView";
import { RecordingView } from "./RecordingView";
import { BlfPanel } from "./BlfPanel";
import { LineIndicator } from "./LineIndicator";
import { METRICS_HISTORY_MAX } from "./softphone-utils";
import { useRingbackTone } from "./useRingbackTone";
import { useIncomingRingtone } from "./useIncomingRingtone";

type LeftTab = "keypad" | "contacts" | "blf";
type RightView = "calls" | "recordings";
const SUBVIEW_TO_LEFT: Record<string, LeftTab> = { phone: "keypad", keypad: "keypad", contacts: "contacts", blf: "blf", "line-keys": "blf" };
const SUBVIEW_TO_RIGHT: Record<string, RightView> = { recordings: "recordings" };

export function SoftPhoneTool() {
  const calls = useSoftphoneStore((s) => s.calls);
  const activeCallId = useSoftphoneStore((s) => s.activeCallId);
  const setCallProgress = useSoftphoneStore((s) => s.setCallProgress);
  const setIncomingCall = useSoftphoneStore((s) => s.setIncomingCall);
  const updateCallMetrics = useSoftphoneStore((s) => s.updateCallMetrics);
  const fetchAudioDevices = useSoftphoneStore((s) => s.fetchAudioDevices);

  const fetchRegistrars = useRegistrationStore((s) => s.fetchRegistrars);
  const registrars = useRegistrationStore((s) => s.registrars);
  const activeRegistrarId = useSoftphoneStore((s) => s.activeRegistrarId);
  const mwiState = useSoftphoneStore((s) => s.mwiState);
  const inboundListenerActive = useSoftphoneStore((s) => s.inboundListenerActive);
  const setActiveTool = useToolStore((s) => s.setActiveTool);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);
  const isVisible = useToolVisible("soft-phone");

  // ── Pane sub-tab management ──
  const [leftTab, setLeftTab] = useState<LeftTab>("keypad");
  const [rightView, setRightView] = useState<RightView>("calls");

  const [anyRecording, setAnyRecording] = useState(false);
  useEffect(() => {
    if (!isVisible) return;
    const liveCall = calls.find((c) => c.state === "active" || c.state === "on-hold" || c.state === "connecting");
    if (!liveCall?.sipCallId) { setAnyRecording(false); return; }
    let cancelled = false;
    const poll = async () => {
      try { if (!cancelled) setAnyRecording(await checkIsRecording(liveCall.sipCallId!)); } catch { /* ignore */ }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [calls, isVisible]);

  // Sync with subview routing from useToolStore (e.g. navigateTo("soft-phone", "contacts"))
  useEffect(() => {
    if (activeToolId !== "soft-phone") return;
    if (!activeSubviewId) return;
    const lt = SUBVIEW_TO_LEFT[activeSubviewId];
    if (lt) setLeftTab(lt);
    const rv = SUBVIEW_TO_RIGHT[activeSubviewId];
    if (rv) setRightView(rv);
    else if (lt) {
      setRightView("calls");
    }
    setLastViewedSubview("soft-phone", activeSubviewId);
    setActiveSubview(null);
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview]);

  // Fall back to keypad if on BLF tab and registrar is deselected
  useEffect(() => {
    if (leftTab === "blf" && !activeRegistrarId) setLeftTab("keypad");
  }, [activeRegistrarId, leftTab]);

  // ── Shared state ──
  const [targetInput, setTargetInput] = useState("");
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{
    mos: number;
    jitter_ms: number;
    send_peak: number;
    recv_peak: number;
    loss_percent: number;
    lost_packets: number;
  } | null>(null);
  const [, setJitterHistory] = useState<{ t: number[]; j: number[] }>({ t: [], j: [] });
  const [metricsHistory, setMetricsHistory] = useState<
    { t: number; mos: number; jitter_ms: number; loss_percent: number }[]
  >([]);
  const metricsInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const metricsHistoryRef = useRef<{ t: number; mos: number; jitter_ms: number; loss_percent: number }[]>([]);
  const waveformRef = useRef<{ send: number[]; recv: number[] }>({ send: [], recv: [] });
  const [callTimerTick, setCallTimerTick] = useState(0);
  const qualityAlertedRef = useRef(false);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const checkQualityAlert = useCallback((mos: number, jitter_ms: number, loss_percent: number) => {
    const mosBad = mos < 3.0 && mos > 0;
    const jitterBad = jitter_ms > 50;
    const lossBad = loss_percent > 3;
    const degraded = mosBad || jitterBad || lossBad;
    if (degraded && !qualityAlertedRef.current) {
      qualityAlertedRef.current = true;
      const reasons: string[] = [];
      if (mosBad) reasons.push(`MOS ${mos.toFixed(1)}`);
      if (jitterBad) reasons.push(`Jitter ${jitter_ms.toFixed(0)}ms`);
      if (lossBad) reasons.push(`Loss ${loss_percent.toFixed(1)}%`);
      addNotification({
        type: "warning",
        title: "Call Quality Degraded",
        description: reasons.join(", "),
        source: "soft-phone",
        priority: "high",
        navigation: { tool: "soft-phone" },
      });
    } else if (!degraded && qualityAlertedRef.current) {
      qualityAlertedRef.current = false;
    }
  }, [addNotification]);

  const activeCall = calls.find((c) => c.id === activeCallId);
  const activeRegistrar = registrars.find((r) => r.id === activeRegistrarId) ?? null;
  const registrarMwi = activeRegistrarId ? mwiState[activeRegistrarId] : undefined;
  const liveCalls = calls.filter((c) =>
    c.state === "active" || c.state === "on-hold" || c.state === "connecting" || c.state === "ringing"
  );
  const activeCallsCount = calls.filter((c) => c.state === "active").length;
  const heldCallsCount = calls.filter((c) => c.state === "on-hold").length;
  const ringingCallsCount = calls.filter((c) => c.state === "ringing").length;
  useRingbackTone(activeCall?.state === "ringing" && !activeCall?.isInbound);
  const hasInboundRinging = calls.some((c) => c.state === "ringing" && c.isInbound);
  const ringtonePreset = useSoftphoneStore((s) => s.ringtonePreset);
  useIncomingRingtone(hasInboundRinging, ringtonePreset);

  // ── Derived metrics ──
  const selectedCall =
    calls.find((c) => c.id === selectedCallId) ||
    activeCall ||
    (calls.length > 0 ? calls[0] : undefined);
  const metricsApplyToSelected = selectedCall?.sipCallId != null && selectedCall.sipCallId === activeCall?.sipCallId;
  const isRemoteSelected = !!selectedCall?.remoteAgentId;
  const isRemoteLive = isRemoteSelected && (selectedCall?.state === "active" || selectedCall?.state === "on-hold" || selectedCall?.state === "connecting" || selectedCall?.state === "ringing");

  // For ended calls, compute averages from the full metrics history instead of using the last snapshot
  const endedCallAverageMetrics = useMemo(() => {
    if (!selectedCall || selectedCall.state !== "ended") return null;
    const history = selectedCall.savedMetricsHistory;
    const saved = selectedCall.savedMetrics;
    if (!history || history.length === 0) return saved ?? null;
    const n = history.length;
    const avgMos = history.reduce((sum, p) => sum + p.mos, 0) / n;
    const avgJitter = history.reduce((sum, p) => sum + p.jitter_ms, 0) / n;
    const avgLoss = history.reduce((sum, p) => sum + p.loss_percent, 0) / n;
    return {
      mos: avgMos,
      jitter_ms: avgJitter,
      loss_percent: avgLoss,
      // send_peak / recv_peak / lost_packets: use max from saved snapshots (not averaged)
      send_peak: saved?.send_peak ?? 0,
      recv_peak: saved?.recv_peak ?? 0,
      lost_packets: saved?.lost_packets ?? 0,
    };
  }, [selectedCall?.id, selectedCall?.state, selectedCall?.savedMetrics, selectedCall?.savedMetricsHistory]);

  // For active remote calls, the agent pushes metrics via progress events into savedMetrics.
  // Use those directly as the live metrics display.
  const displayMetrics =
    metricsApplyToSelected
      ? metrics
      : isRemoteLive
        ? (selectedCall?.savedMetrics ?? null)
        : selectedCall?.state === "ended"
          ? (endedCallAverageMetrics ?? null)
          : null;
  const displayMetricsHistory =
    metricsApplyToSelected
      ? metricsHistory
      : (isRemoteLive || selectedCall?.state === "ended") && selectedCall?.savedMetricsHistory
        ? selectedCall.savedMetricsHistory
        : [];
  // isShowingSavedMetrics no longer needed — PostCallView handles this internally

  // ── Timer ──
  useEffect(() => {
    if (!isVisible) return;
    const hasLiveCall = calls.some(
      (c) => !c.endTime && (c.state === "active" || c.state === "on-hold" || c.state === "connecting" || c.state === "ringing")
    );
    if (!hasLiveCall) return;
    const interval = setInterval(() => setCallTimerTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [calls, isVisible]);

  // ── Fetch registrars and audio devices once ──
  useEffect(() => {
    fetchRegistrars();
    fetchAudioDevices();
  }, [fetchRegistrars, fetchAudioDevices]);

  // Poll audio devices while visible
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(fetchAudioDevices, 30_000);
    return () => clearInterval(interval);
  }, [fetchAudioDevices, isVisible]);

  // ── Poll call metrics ──
  useEffect(() => {
    const sipId = activeCall?.sipCallId;
    const isActive = activeCall?.state === "active" || activeCall?.state === "on-hold";
    if (!sipId || !isActive || !isVisible) {
    if (!sipId || !isActive) {
      setMetrics(null);
      setJitterHistory({ t: [], j: [] });
      setMetricsHistory([]);
      metricsHistoryRef.current = [];
      }
      if (metricsInterval.current) {
        clearInterval(metricsInterval.current);
        metricsInterval.current = null;
      }
      return;
    }
    metricsHistoryRef.current = [];
    const poll = async () => {
      try {
        const [m, h] = await Promise.all([
          getCallMetrics(sipId),
          getCallJitterHistory(sipId),
        ]);
        const metricsSnapshot = {
          mos: m.mos,
          jitter_ms: m.jitter_ms,
          send_peak: m.send_peak,
          recv_peak: m.recv_peak,
          loss_percent: m.loss_percent,
          lost_packets: m.lost_packets,
        };
        setMetrics(metricsSnapshot);
        const jitterSnapshot = h.timestamps_sec.length > 0 ? { t: h.timestamps_sec, j: h.jitter_ms } : { t: [] as number[], j: [] as number[] };
        setJitterHistory(jitterSnapshot);
        const newPoint = { t: Date.now() / 1000, mos: m.mos, jitter_ms: m.jitter_ms, loss_percent: m.loss_percent };
        const nextHistory = [...metricsHistoryRef.current, newPoint].slice(-METRICS_HISTORY_MAX);
        metricsHistoryRef.current = nextHistory;
        setMetricsHistory(nextHistory);
        updateCallMetrics(activeCall!.id, {
          metrics: metricsSnapshot,
          jitterHistory: jitterSnapshot,
          metricsHistory: nextHistory,
        });
        checkQualityAlert(m.mos, m.jitter_ms, m.loss_percent);
      } catch {
        /* ignore */
      }
    };
    qualityAlertedRef.current = false;
    poll();
    metricsInterval.current = setInterval(poll, 2000);
    return () => {
      if (metricsInterval.current) clearInterval(metricsInterval.current);
    };
  }, [activeCall?.id, activeCall?.sipCallId, activeCall?.state, updateCallMetrics, isVisible, checkQualityAlert]);

  // ── Poll waveform (sequential — waits for each IPC round-trip before scheduling next) ──
  useEffect(() => {
    const sipId = activeCall?.sipCallId;
    const isActive = activeCall?.state === "active" || activeCall?.state === "on-hold";
    const shouldPollWaveform = isVisible && rightView === "calls";
    if (!sipId || !isActive || !shouldPollWaveform) {
      waveformRef.current = { send: [], recv: [] };
      return;
    }
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
      try {
        const w = await getCallWaveform(sipId);
          if (!cancelled) waveformRef.current = { send: w.send, recv: w.recv };
        } catch { /* ignore */ }
        // Keep polling reasonably fast for visual smoothness without IPC overload.
        await new Promise((r) => setTimeout(r, 140));
      }
    };
    loop();
    return () => { cancelled = true; };
  }, [activeCall?.sipCallId, activeCall?.state, isVisible, rightView]);

  // ── Event listeners ──
  useEffect(() => {
    const unlistenPromise = listen<{ pending_call_id: string; status_code: number; status_text: string }>(
      "softphone:call_progress",
      (event) => {
        const { pending_call_id, status_code, status_text } = event.payload;
        setCallProgress(pending_call_id, status_code, status_text);
      }
    );
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, [setCallProgress]);

  useEffect(() => {
    const unlistenPromise = listen<{
      registrarId: string;
      callId: string;
      from: string;
      fromDisplay: string;
      to: string;
      requestUri: string;
      autoAnswer?: boolean;
    }>("softphone:incoming_call", (event) => {
      const store = useSoftphoneStore.getState();

      // DND: auto-reject with 486 Busy Here
      if (store.dndEnabled) {
        store.rejectInboundCall(event.payload.callId, 486);
        return;
      }

      // Call waiting: if there's an active call, auto-hold it before presenting the new one.
      const activeCalls = store.calls.filter(c => c.state === "active");
      if (activeCalls.length > 0 && store.callWaitingEnabled) {
        for (const ac of activeCalls) {
          store.holdCall(ac.id, true).catch(console.error);
        }
      }

      setIncomingCall(event.payload);
      setActiveTool("soft-phone");

      const fromDisplay = event.payload.fromDisplay || event.payload.from || "Unknown";
      useNotificationStore.getState().addNotification({
        type: "info",
        title: "Incoming Call",
        description: `Incoming call from ${fromDisplay}`,
        source: "soft-phone",
        priority: "urgent",
        persistent: true,
        navigation: { tool: "soft-phone" },
      });

      // Auto-answer: when enabled globally OR when INVITE carries intercom/auto-answer headers
      const shouldAutoAnswer = store.autoAnswerEnabled || event.payload.autoAnswer === true;
      if (shouldAutoAnswer) {
        const delay = event.payload.autoAnswer ? 0 : (store.autoAnswerDelayMs || 0);
        setTimeout(() => {
          const currentStore = useSoftphoneStore.getState();
          const call = currentStore.calls.find(c => c.id === event.payload.callId || c.sipCallId === event.payload.callId);
          if (call && call.state === "ringing" && call.isInbound) {
            currentStore.answerInboundCall(call.id);
          }
        }, delay);
      }
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, [setIncomingCall, setActiveTool]);

  // ── MWI event listener (per-registrar) ──
  useEffect(() => {
    const unlistenPromise = listen<{
      registrarId: string;
      messagesWaiting: boolean;
      newCount: number;
      oldCount: number;
    }>("softphone:mwi_update", (event) => {
      const { registrarId: regId, messagesWaiting, newCount, oldCount } = event.payload;
      useSoftphoneStore.getState().setMwiState(regId, messagesWaiting, newCount, oldCount);
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  // ── Listen for inbound dialog info (tags, URIs needed for BYE) ──
  useEffect(() => {
    const unlistenPromise = listen<{
      callId: string;
      fromTag: string;
      toTag: string;
      targetUri: string;
      remoteContactUri: string | null;
      responseToHeader: string | null;
    }>("softphone:inbound_dialog_info", (event) => {
      const { callId, fromTag, toTag, targetUri, remoteContactUri, responseToHeader } = event.payload;
      useSoftphoneStore.getState().setInboundDialogInfo(callId, {
        fromTag,
        toTag,
        targetUri,
        remoteContactUri,
        responseToHeader,
      });
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  // speech:transcript listener is in App.tsx with the other global event listeners

  // ── Auto-subscribe MWI when registrar changes (per-registrar setting) ──
  const mwiEnabled = activeRegistrar?.mwi_enabled ?? false;
  useEffect(() => {
    if (!activeRegistrarId || !mwiEnabled) return;
    import("@/lib/softphone").then(({ subscribeMwi }) => {
      subscribeMwi(activeRegistrarId).catch((e) =>
        console.warn("Failed to subscribe MWI", e)
      );
    });
    return () => {
      import("@/lib/softphone").then(({ unsubscribeMwi }) => {
        unsubscribeMwi(activeRegistrarId).catch(() => {});
      });
    };
  }, [activeRegistrarId, mwiEnabled]);

  // ── OPTIONS keepalive when registrar is active ──
  useEffect(() => {
    if (!activeRegistrarId) return;
    import("@/lib/softphone").then(({ startOptionsKeepalive }) => {
      startOptionsKeepalive(activeRegistrarId).catch((e) =>
        console.warn("Failed to start OPTIONS keepalive", e)
      );
    });
    return () => {
      import("@/lib/softphone").then(({ stopOptionsKeepalive }) => {
        stopOptionsKeepalive(activeRegistrarId).catch(() => {});
      });
    };
  }, [activeRegistrarId]);

  // ── Auto-select / cleanup ──
  const prevActiveCallIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeCallId && activeCallId !== prevActiveCallIdRef.current) {
      setSelectedCallId(null);
    }
    if (!activeCallId && prevActiveCallIdRef.current) {
      const prevId = prevActiveCallIdRef.current;
      const endedCall = calls.find((c) => c.id === prevId);
      if (endedCall && (endedCall.state === "ended" || endedCall.state === "failed")) {
        setSelectedCallId(prevId);
        setTargetInput("");
      }
    }
    prevActiveCallIdRef.current = activeCallId ?? null;
  }, [activeCallId, calls]);

  useEffect(() => {
    if (selectedCallId && !calls.some((c) => c.id === selectedCallId)) {
      setSelectedCallId(null);
    }
  }, [calls, selectedCallId]);

  // ── Right pane overlay conditions ──
  const incomingRinging = activeCall?.state === "ringing" && activeCall?.isInbound;
  const hasLiveSession = activeCall && (activeCall.state === "active" || activeCall.state === "on-hold" || activeCall.state === "connecting");
  const selectedEndedCall = selectedCallId
    ? calls.find((c) => c.id === selectedCallId && (c.state === "ended" || c.state === "failed"))
    : undefined;

  // Determine if right pane should show a detail overlay
  const showDetailOverlay = incomingRinging || hasLiveSession || !!selectedEndedCall;
  const detailCall = hasLiveSession ? activeCall : selectedEndedCall ?? undefined;
  const leftModes = [
    { id: "keypad" as const, label: "Dialpad", icon: Hash },
    { id: "contacts" as const, label: "Contacts", icon: Users },
    { id: "blf" as const, label: "Line Keys", icon: Grid3x3, disabled: !activeRegistrarId },
  ];
  const rightModes = [
    { id: "calls" as const, label: "Calls", icon: PhoneCall, badge: calls.length > 0 ? String(calls.length) : undefined },
    { id: "recordings" as const, label: "Recordings", icon: Mic, badge: anyRecording ? "LIVE" : undefined },
  ];
  const activeRegistrarInboundPort = useMemo(() => {
    const port = activeRegistrar?.listening_port ?? activeRegistrar?.local_port ?? null;
    return typeof port === "number" && port > 0 ? port : null;
  }, [activeRegistrar?.listening_port, activeRegistrar?.local_port]);
  const inboundPortsTooltip = activeRegistrarInboundPort
    ? `Active registrar port: :${activeRegistrarInboundPort}`
    : "No active registrar listen port configured";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ToolHeader toolId="soft-phone" execToolId="softphone" />
      {/* Registrar picker portals into app header when active */}
      <SoftphoneHeader />
      <LineIndicator />

      {/* ── Two-pane layout ── */}
      <div className="flex-1 min-h-0 app-view-gutter">
        <div className="ui-panel-shell h-full min-h-0 overflow-hidden bg-gradient-to-b from-card/15 to-transparent">
          <div className="grid h-full min-h-0 lg:grid-cols-[388px_minmax(0,1fr)]">
            {/* ════════════ LEFT PANE: Keypad / Contacts ════════════ */}
            <div className="min-h-0 overflow-hidden flex flex-col border-b border-border/30 lg:border-b-0 lg:border-r lg:border-border/30">
              <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
                <div className="softphone-view-switch">
                  {leftModes.map((mode) => {
                    const Icon = mode.icon;
                    const active = leftTab === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        disabled={mode.disabled}
                        onClick={() => !mode.disabled && setLeftTab(mode.id)}
                        className={cn("softphone-view-chip", active && "is-active", mode.disabled && "is-disabled")}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{mode.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  {!activeRegistrarId && (
                    <span className="text-2xs text-muted-foreground/60">Select registrar for line keys</span>
                  )}
                </div>
              </div>

              {/* Content */}
              {leftTab === "keypad" ? (
                <KeypadPane targetInput={targetInput} setTargetInput={setTargetInput} expanded />
              ) : leftTab === "blf" ? (
                <div className="flex-1 overflow-y-auto p-3">
                  <BlfPanel />
                </div>
              ) : (
                <ContactsView setTargetInput={setTargetInput} />
              )}
            </div>

            {/* ════════════ RIGHT PANE ════════════ */}
            <div className="min-w-0 overflow-hidden flex flex-col min-h-0">
              <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
                <div className="softphone-view-switch">
                  {rightModes.map((mode) => {
                    const Icon = mode.icon;
                    const active = rightView === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                          if (mode.id === "calls") setSelectedCallId(null);
                          setRightView(mode.id);
                        }}
                        className={cn("softphone-view-chip", active && "is-active")}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{mode.label}</span>
                        {mode.badge && (
                          <span className={cn("softphone-view-badge", mode.id === "recordings" && anyRecording && "is-live")}>
                            {mode.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  {anyRecording && (
                    <span className="inline-flex items-center gap-1 text-2xs font-medium text-destructive">
                      <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none" />
                      Recording live
                    </span>
                  )}
                </div>
              </div>

              {rightView === "recordings" ? (
                <RecordingView />
              ) : incomingRinging && activeCall ? (
                <IncomingCallScreen call={activeCall} />
              ) : showDetailOverlay && detailCall ? (
                <>
                  {!hasLiveSession && (
                    <div className="px-4 py-1.5 border-y border-border/20 bg-muted/15 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedCallId(null)}
                        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Back to recents
                      </button>
                    </div>
                  )}
                  {hasLiveSession ? (
                    <InCallView
                      call={detailCall}
                      displayMetrics={displayMetrics}
                      waveformRef={waveformRef}
                      callTimerTick={callTimerTick}
                    />
                  ) : (
                    <PostCallView
                      call={detailCall}
                      displayMetrics={displayMetrics}
                      displayMetricsHistory={displayMetricsHistory}
                    />
                  )}
                </>
              ) : (
                <CallsView
                  selectedCallId={selectedCallId}
                  setSelectedCallId={setSelectedCallId}
                  setTargetInput={setTargetInput}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <ViewFooter>
        {liveCalls.length > 0 ? (
          <ViewFooterItem>
            <PhoneCall className="h-3 w-3" />
            <span className="font-medium text-foreground tabular-nums">{liveCalls.length}</span>
            <span>live</span>
          </ViewFooterItem>
        ) : (
          <ViewFooterItem>
            <Activity className="h-3 w-3" />
            <span>Idle</span>
          </ViewFooterItem>
        )}

        {(activeCallsCount > 0 || heldCallsCount > 0 || ringingCallsCount > 0) && (
          <>
            <ViewFooterDivider />
            <ViewFooterItem>
              <span className="tabular-nums">{activeCallsCount}</span>
              <span>active</span>
            </ViewFooterItem>
            <ViewFooterItem>
              <span className="tabular-nums">{heldCallsCount}</span>
              <span>held</span>
            </ViewFooterItem>
            <ViewFooterItem>
              <span className="tabular-nums">{ringingCallsCount}</span>
              <span>ringing</span>
            </ViewFooterItem>
          </>
        )}

        <ViewFooterDivider />
        <ViewFooterItem>
          <Radio className="h-3 w-3" />
          <span className="truncate max-w-[220px]">{activeRegistrar?.name ?? "No registrar"}</span>
        </ViewFooterItem>

        {registrarMwi && (
          <>
            <ViewFooterDivider />
            <ViewFooterItem className={registrarMwi.waiting ? "text-warning" : undefined}>
              <Mic className="h-3 w-3" />
              <span>VM</span>
              <span className="tabular-nums">{registrarMwi.newCount}</span>
            </ViewFooterItem>
          </>
        )}

        {anyRecording && (
          <>
            <ViewFooterDivider />
            <ViewFooterItem className="text-destructive">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none" />
              <span>Recording</span>
            </ViewFooterItem>
          </>
        )}

        <ViewFooterSpacer />

        {activeRegistrarId && activeRegistrar ? (
          <TooltipWrapper
            title="Inbound Listener"
            description={inboundListenerActive ? inboundPortsTooltip : "Listener is currently off"}
          >
            <ViewFooterItem className={inboundListenerActive ? "text-success" : "text-muted-foreground/70"}>
              {inboundListenerActive ? (
                <>
                  <span>Listening</span>
                  {activeRegistrarInboundPort ? <span className="tabular-nums">:{activeRegistrarInboundPort}</span> : null}
                </>
              ) : (
                <>
                  <span>Listener off</span>
                  {activeRegistrarInboundPort ? <span className="tabular-nums">:{activeRegistrarInboundPort}</span> : null}
                </>
              )}
            </ViewFooterItem>
          </TooltipWrapper>
        ) : (
          <ViewFooterItem className="text-muted-foreground/70">
            <span>Select registrar for listener status</span>
          </ViewFooterItem>
        )}
      </ViewFooter>
    </div>
  );
}
