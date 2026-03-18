/**
 * CallStatusWidget — compact, self-contained call status bar for headers.
 *
 * Shows the current softphone state (idle / ringing / active / on-hold)
 * with quick-action buttons.  Clicking the pill opens a popover dropdown
 * with full call controls (mute, hold, record, transfer, end).
 *
 * Fully standalone — reads from stores and manages its own timer so it
 * can be dropped into any header without props.
 *
 * Supports two shapes via `shape` prop:
 *  - "compact": small icon-only button (suitable for tight header layouts)
 *  - "badge" (default): pill with status text, caller, and duration
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useContactsStore } from "@/stores/contactsStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import {
  Phone,
  PhoneOff,
  PlayCircle,
  Timer,
  MicOff,
  Mic,
  ArrowRightLeft,
  ChevronDown,
  Check,
  Backspace,
  Inbox,
  Activity,
  Radio,
  FileText,
} from "@/lib/icons";
import {
  startRecording,
  stopRecording,
  isRecording as checkIsRecording,
  sendRefer,
  sendDtmf,
  getCallMetrics,
} from "@/lib/softphone";
import {
  speechModelStatus,
  speechEnsureModel,
  speechStartTranscription,
  speechStopTranscription,
} from "@/api/speech";
import { getTranscriptionSampleRate } from "@/lib/transcription";
import { playDtmfTone } from "@/lib/dtmfTones";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getUseCase, isRegistered } from "@/components/fax-center/FaxShared";
import { DIAL_KEY_ROWS } from "./softphone-constants";
import { sanitizeDialInput } from "./sanitizeDialInput";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

interface CallStatusWidgetProps {
  /** Override end-call handler (e.g. to snapshot metrics). Falls back to store.endCall. */
  onEndCall?: (callId: string) => Promise<void>;
  /** Header item shape variant: "compact" (icon only) or "badge" (full pill). */
  shape?: string;
}

export function CallStatusWidget({ onEndCall, shape = "badge" }: CallStatusWidgetProps) {
  const activeCallId = useSoftphoneStore((s) => s.activeCallId);
  const calls = useSoftphoneStore((s) => s.calls);
  const holdCall = useSoftphoneStore((s) => s.holdCall);
  const muteCall = useSoftphoneStore((s) => s.muteCall);
  const endCall = useSoftphoneStore((s) => s.endCall);
  const answerInboundCall = useSoftphoneStore((s) => s.answerInboundCall);
  const rejectInboundCall = useSoftphoneStore((s) => s.rejectInboundCall);
  const activeRegistrarId = useSoftphoneStore((s) => s.activeRegistrarId);
  const watchedRegistrarIds = useSoftphoneStore((s) => s.watchedRegistrarIds);
  const setWatchedRegistrars = useSoftphoneStore((s) => s.setWatchedRegistrars);
  const setTranscriptionEnabled = useSoftphoneStore((s) => s.setTranscriptionEnabled);
  const setActiveRegistrar = useSoftphoneStore((s) => s.setActiveRegistrar);
  const startCall = useSoftphoneStore((s) => s.startCall);
  const dtmfPayloadType = useSoftphoneStore((s) => s.dtmfPayloadType);
  const inboundListenerActive = useSoftphoneStore((s) => s.inboundListenerActive);
  const testRegistration = useRegistrationStore((s) => s.testRegistration);
  const allContacts = useContactsStore((s) => s.contacts);
  const registrars = useRegistrationStore((s) => s.registrars);
  const testResults = useRegistrationStore((s) => s.testResults);
  const healthRegistrars = useTroubleshootingStore((s) => s.registrationHealth?.registrars);
  const mwiState = useSoftphoneStore((s) => s.mwiState);

  const registrarsForCalling = useMemo(
    () =>
      registrars.filter(
        (r) =>
          getUseCase(r)
            ?.split(",")
            .map((s) => s.trim())
            .includes("calling"),
      ),
    [registrars],
  );

  const effectiveWatched = useMemo(
    () => (watchedRegistrarIds.length > 0 ? watchedRegistrarIds : activeRegistrarId ? [activeRegistrarId] : []),
    [watchedRegistrarIds, activeRegistrarId],
  );

  const watchedReadyCount = useMemo(
    () => effectiveWatched.filter((id) => isRegistered(id, healthRegistrars, testResults)).length,
    [effectiveWatched, healthRegistrars, testResults],
  );

  const activeCall = calls.find((c) => c.id === activeCallId);
  const incomingRinging = activeCall?.state === "ringing" && activeCall?.isInbound;
  const isLive = activeCall?.state === "active" || activeCall?.state === "on-hold";
  const isOnHold = activeCall?.state === "on-hold";
  const isConnecting = activeCall?.state === "connecting" || (activeCall?.state === "ringing" && !activeCall?.isInbound);
  const addNotification = useNotificationStore((s) => s.addNotification);

  // Popover open state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [idlePopoverOpen, setIdlePopoverOpen] = useState(false);
  const [dialInput, setDialInput] = useState("");
  const [registeringRegistrarId, setRegisteringRegistrarId] = useState<string | null>(null);

  // Self-contained timer
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isLive) { setTick(0); return; }
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [isLive]);

  // Recording state
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!activeCall?.sipCallId || !isLive) { setRecording(false); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const rec = await checkIsRecording(activeCall.sipCallId!);
        if (!cancelled) setRecording(rec);
      } catch { /* ignore */ }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [activeCall?.sipCallId, isLive]);

  const handleToggleRecording = useCallback(async () => {
    if (!activeCall?.sipCallId) return;
    try {
      if (recording) { await stopRecording(activeCall.sipCallId); setRecording(false); }
      else { await startRecording(activeCall.sipCallId); setRecording(true); }
    } catch (e) { console.error("Recording toggle failed:", e); }
  }, [activeCall?.sipCallId, recording]);

  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const handleToggleTranscription = useCallback(async () => {
    if (!activeCall?.sipCallId) return;
    if (activeCall.transcriptionEnabled) {
      try { await speechStopTranscription(activeCall.sipCallId); } catch { /* ignore */ }
      setTranscriptionEnabled(activeCall.id, false);
      addNotification({
        type: "info",
        title: "Live Transcription Stopped",
        description: "Speech-to-text is no longer listening.",
        source: "soft-phone",
      });
    } else {
      setTranscriptLoading(true);
      try {
        const status = await speechModelStatus();
        if (!status.downloaded) await speechEnsureModel();
        const sr = getTranscriptionSampleRate(activeCall.negotiatedCodec);
        await speechStartTranscription(activeCall.sipCallId, sr);
        setTranscriptionEnabled(activeCall.id, true);
        addNotification({
          type: "success",
          title: "Live Transcription Started",
          description: "Listening for speech on this call.",
          source: "soft-phone",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addNotification({
          type: "error",
          title: "Live Transcription Failed",
          description: msg || "Unable to start live transcription.",
          source: "soft-phone",
        });
      } finally {
        setTranscriptLoading(false);
      }
    }
  }, [activeCall?.sipCallId, activeCall?.id, activeCall?.transcriptionEnabled, activeCall?.negotiatedCodec, setTranscriptionEnabled, addNotification]);

  // Live metrics polling
  const [liveMetrics, setLiveMetrics] = useState<{
    mos: number;
    jitter_ms: number;
    loss_percent: number;
  } | null>(null);
  useEffect(() => {
    if (!activeCall?.sipCallId || !isLive) { setLiveMetrics(null); return; }
    let cancelled = false;
    const sipId = activeCall.sipCallId;
    const poll = async () => {
      while (!cancelled) {
        try {
          const m = await getCallMetrics(sipId);
          if (!cancelled) setLiveMetrics({ mos: m.mos, jitter_ms: m.jitter_ms, loss_percent: m.loss_percent });
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [activeCall?.sipCallId, isLive]);

  /** MOS → quality label + color class */
  const callQuality = useMemo(() => {
    if (!liveMetrics) return null;
    const mos = liveMetrics.mos;
    if (mos >= 4.0) return { label: "Excellent", color: "text-success", dot: "bg-success", ring: "ring-success/20" };
    if (mos >= 3.5) return { label: "Good", color: "text-success", dot: "bg-success", ring: "ring-success/20" };
    if (mos >= 3.0) return { label: "Fair", color: "text-warning", dot: "bg-warning", ring: "ring-warning/20" };
    if (mos >= 2.5) return { label: "Poor", color: "text-warning", dot: "bg-warning", ring: "ring-warning/20" };
    return { label: "Bad", color: "text-destructive", dot: "bg-destructive", ring: "ring-destructive/20" };
  }, [liveMetrics]);

  // Transfer state
  const [transferTarget, setTransferTarget] = useState("");
  const [showTransfer, setShowTransfer] = useState(false);

  const handleTransfer = useCallback(async () => {
    if (!activeCall || !transferTarget.trim() || !activeRegistrarId) return;
    if (activeCall.sipCallId && activeCall.fromTag && activeCall.toTag && activeCall.targetUri) {
      try {
        const cseq = (activeCall.dialogCSeq ?? 1) + 1;
        await sendRefer(
          activeRegistrarId, activeCall.sipCallId, activeCall.fromTag, activeCall.toTag,
          activeCall.targetUri, activeCall.remoteContactUri ?? null, activeCall.responseToHeader ?? null,
          cseq, transferTarget.trim(),
        );
        const endCallStore = useSoftphoneStore.getState().endCall;
        await endCallStore(activeCall.id, undefined, { transferredTo: transferTarget.trim() });
        setShowTransfer(false);
        setTransferTarget("");
        return;
      } catch { /* fall through */ }
    }
    // Fallback: hold + end + redial
    try { await holdCall(activeCall.id, true); } catch { /* ignore */ }
    const store = useSoftphoneStore.getState();
    await store.endCall(activeCall.id, undefined, { transferredTo: transferTarget.trim() });
    const ctx = (await import("@/stores/executionContextStore")).useExecutionContextStore.getState().resolvedContext("softphone");
    store.startCall(transferTarget.trim(), ctx);
    setShowTransfer(false);
    setTransferTarget("");
  }, [activeCall, transferTarget, activeRegistrarId, holdCall]);

  // Format duration
  const duration = useMemo(() => {
    if (!activeCall?.startTime || !isLive) return null;
    const secs = Math.max(0, Math.floor((Date.now() - new Date(activeCall.startTime).getTime()) / 1000));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.startTime, isLive, tick]);

  // Resolve caller name
  const callerLabel = useMemo(() => {
    if (!activeCall?.target) return "Unknown";
    const num = activeCall.target.replace(/[^\d+]/g, "");
    const match = allContacts.find((c) => {
      const cn = c.phone.replace(/[^\d+]/g, "");
      return cn === num || cn.endsWith(num) || num.endsWith(cn);
    });
    return match?.name ?? activeCall.target;
  }, [activeCall?.target, allContacts]);

  const handleEnd = async (id: string) => {
    if (onEndCall) await onEndCall(id);
    else await endCall(id);
    setPopoverOpen(false);
  };

  // Close popover when call ends
  useEffect(() => {
    if (!activeCall) setPopoverOpen(false);
  }, [activeCall]);

  /* ── Compact shape: icon-only button ── */
  if (shape === "compact") {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center transition-smooth",
              isLive
                ? "bg-success/15 text-success hover:bg-success/25"
                : incomingRinging
                  ? "bg-success/15 text-success animate-live-breathe motion-reduce:animate-none"
                  : isConnecting
                    ? "bg-accent text-foreground animate-live-breathe motion-reduce:animate-none"
                    : "bg-muted/20 text-muted-foreground/60 hover:text-muted-foreground/80",
            )}
          >
            <Phone className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        {renderPopoverContent()}
      </Popover>
    );
  }

  /* ── Badge shape (default): full pill ── */

  /* ── Idle: clickable badge with registrar picker + mini dialpad ── */
  if (!activeCall) {
    const anyReady = watchedReadyCount > 0;
    const callRegistrarId = activeRegistrarId ?? effectiveWatched[0] ?? null;
    const selectedCallRegistrar = callRegistrarId
      ? registrarsForCalling.find((r) => r.id === callRegistrarId)
      : null;
    const selectedCallRegistrarReady = isRegistered(selectedCallRegistrar?.id, healthRegistrars, testResults);
    const canPlace = Boolean(callRegistrarId && dialInput.trim() && selectedCallRegistrarReady);

    const handlePlaceCall = async () => {
      if (!canPlace) return;
      const ctx = (await import("@/stores/executionContextStore")).useExecutionContextStore.getState().resolvedContext("softphone");
      startCall(dialInput.trim(), ctx);
      setDialInput("");
      setIdlePopoverOpen(false);
    };

    return (
      <Popover
        open={idlePopoverOpen}
        onOpenChange={(open) => {
          setIdlePopoverOpen(open);
          if (!open) setDialInput("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-full border text-xs transition-smooth whitespace-nowrap",
              "bg-muted/20 border-border/20 hover:bg-muted/20 hover:border-border/40",
              idlePopoverOpen && "ring-1 ring-border",
            )}
          >
            <Phone className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            {effectiveWatched.length > 0 ? (
              <>
                <div className="flex items-center gap-0.5">
                  {effectiveWatched.slice(0, 5).map((id) => (
                    <span
                      key={id}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isRegistered(id, healthRegistrars, testResults) ? "bg-success" : "bg-muted-foreground/40",
                      )}
                    />
                  ))}
                  {effectiveWatched.length > 5 && (
                    <span className="text-3xs text-muted-foreground/60">+{effectiveWatched.length - 5}</span>
                  )}
                </div>
                <span className="text-muted-foreground/60 font-medium">
                  {anyReady ? `${watchedReadyCount}/${effectiveWatched.length} ready` : "Offline"}
                </span>
              </>
            ) : (
              <>
                <span className={cn("h-1.5 w-1.5 rounded-full", activeRegistrarId && anyReady ? "bg-success" : "bg-muted-foreground/25")} />
                <span className="text-muted-foreground/60 font-medium">
                  {activeRegistrarId
                    ? inboundListenerActive ? "Available" : "Ready"
                    : "Select registrar"}
                </span>
              </>
            )}
            <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform", idlePopoverOpen && "rotate-180")} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[280px] p-0 ui-panel-shell rounded-md overflow-hidden"
        >
          <div className="flex flex-col">
            {/* ── Voicemail / MWI ── Prominent, clickable */}
            {(() => {
              const vmEntries = effectiveWatched
                .map((id) => {
                  const r = registrars.find((x) => x.id === id);
                  if (!r?.voicemail_number) return null;
                  const mwi = mwiState[id];
                  const hasMessages = mwi?.waiting && (mwi.newCount > 0 || mwi.oldCount > 0);
                  return { id, name: r.name, vmNum: r.voicemail_number, mwi, hasMessages };
                })
                .filter(Boolean) as { id: string; name: string; vmNum: string; mwi?: { newCount: number; oldCount: number }; hasMessages: boolean }[];

              if (vmEntries.length === 0) return null;

              return (
                <div className="p-2 border-b border-border/20">
                  {vmEntries.map(({ id, name, vmNum, mwi, hasMessages }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setActiveRegistrar(id);
                        const ctx = useExecutionContextStore.getState().resolvedContext("softphone");
                        startCall(vmNum, ctx);
                        setIdlePopoverOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-smooth",
                        "hover:bg-muted/20 active:scale-[0.98]",
                        hasMessages ? "bg-primary/10" : "bg-muted/10",
                      )}
                    >
                      <div className="relative shrink-0">
                        <div className={cn(
                          "h-9 w-9 rounded-lg flex items-center justify-center",
                          hasMessages ? "bg-primary/25 text-primary" : "bg-muted/20 text-muted-foreground/60",
                        )}>
                          <Inbox className="h-4 w-4" />
                        </div>
                        {hasMessages && mwi && mwi.newCount > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-2xs font-bold flex items-center justify-center">
                            {mwi.newCount}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground">Voicemail</div>
                        <div className="text-2xs text-muted-foreground/70 truncate">
                          {hasMessages && mwi
                            ? `${mwi.newCount} new${mwi.oldCount > 0 ? ` · ${mwi.oldCount} old` : ""}`
                            : `${name} · ${vmNum}`}
                        </div>
                      </div>
                      <span className="text-2xs font-medium text-foreground shrink-0">Dial →</span>
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* ── Registrar selector (dropdown) ── */}
            <div className="px-2 py-1.5 border-b border-border/20">
              <p className="section-label-sm mb-1">
                Registrars
              </p>
              {registrarsForCalling.length === 0 ? (
                <EmptyState
                  compact
                  variant="inline"
                  title="No calling registrars"
                  className="items-start px-0 py-1 text-left"
                />
              ) : (
                <div className="space-y-1.5">
                  <Select
                    value={callRegistrarId ?? registrarsForCalling[0]?.id ?? ""}
                    onValueChange={(v) => {
                      setActiveRegistrar(v || null);
                      setWatchedRegistrars(v ? [v] : []);
                    }}
                  >
                    <SelectTrigger className="h-7 w-full text-2xs font-medium [&_svg]:size-3">
                      <Check className="h-2.5 w-2.5 shrink-0" />
                      <SelectValue placeholder="Select registrar" />
                    </SelectTrigger>
                    <SelectContent>
                      {registrarsForCalling.map((r) => {
                        const ready = isRegistered(r.id, healthRegistrars, testResults);
                        return (
                          <SelectItem key={r.id ?? r.name} value={r.id ?? ""}>
                            <span className="flex items-center gap-1.5">
                              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ready ? "bg-success" : "bg-warning")} />
                              {r.name}
                              <span className="text-3xs text-muted-foreground/70">{ready ? "Ready" : "Idle"}</span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {selectedCallRegistrar && !selectedCallRegistrarReady && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!selectedCallRegistrar.id || registeringRegistrarId) return;
                        setRegisteringRegistrarId(selectedCallRegistrar.id);
                        try {
                          const ctx = useExecutionContextStore.getState().resolvedContext("registration");
                          await testRegistration(selectedCallRegistrar.id, ctx);
                        } finally {
                          setRegisteringRegistrarId(null);
                        }
                      }}
                      disabled={!!registeringRegistrarId}
                      className={cn(
                        "w-full h-7 ui-control-shell px-2 text-left text-2xs font-medium",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                      )}
                    >
                      {registeringRegistrarId === selectedCallRegistrar.id ? "Registering..." : "Register now"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Keypad (primary) ── */}
            <div className="p-3">
              <div className="relative flex items-center justify-center h-10 mb-2 rounded-lg bg-muted/20 px-3">
                <input
                  type="text"
                  placeholder="Enter number"
                  value={dialInput}
                  onChange={(e) => setDialInput(sanitizeDialInput(e.target.value))}
                  onPaste={(e) => {
                    e.preventDefault();
                    const input = e.target as HTMLInputElement;
                    const s = input.selectionStart ?? 0;
                    const end = input.selectionEnd ?? 0;
                    const pasted = (e.clipboardData?.getData("text/plain") ?? "").trim();
                    setDialInput(sanitizeDialInput(dialInput.slice(0, s) + sanitizeDialInput(pasted) + dialInput.slice(end)));
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handlePlaceCall()}
                  className={cn(
                    "w-full text-center bg-transparent border-none outline-none font-mono tracking-wider",
                    dialInput ? "text-base font-medium text-foreground" : "text-sm text-muted-foreground/60",
                  )}
                />
                {dialInput && (
                  <button type="button" onClick={() => setDialInput("")} className="absolute right-2 text-muted-foreground/60 hover:text-foreground transition-smooth">
                    <Backspace className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 w-fit mx-auto mb-3">
                {DIAL_KEY_ROWS.map((row, rowIdx) =>
                  row.map(({ key: keyChar, letters }) => (
                    <button
                      key={`${rowIdx}-${keyChar}`}
                      type="button"
                      onClick={() => setDialInput(sanitizeDialInput(dialInput + keyChar))}
                      className={cn(
                        "h-10 w-10 rounded-lg flex flex-col items-center justify-center",
                        "bg-secondary shadow-card",
                        "hover:bg-accent hover:shadow-card-hover",
                        "active:scale-[0.97] transition-smooth",
                      )}
                      aria-label={letters ? `Key ${keyChar} ${letters}` : `Key ${keyChar}`}
                    >
                      <span className="text-sm font-medium text-foreground">{keyChar}</span>
                      {letters && <span className="text-3xs uppercase tracking-[0.1em] text-muted-foreground/70 mt-0.5">{letters}</span>}
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={handlePlaceCall}
                disabled={!canPlace}
                className={cn(
                  "w-full h-9 rounded-md px-3.5 flex items-center justify-center gap-1.5 text-sm font-semibold transition-smooth",
                  canPlace
                    ? "bg-success text-success-foreground hover:bg-success/90 active:scale-[0.98]"
                    : "bg-muted/20 text-muted-foreground/60 cursor-not-allowed",
                )}
              >
                <Phone className="h-4.5 w-4.5" />
                Call
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  /* ── Connecting (outbound ringing) ── */
  if (isConnecting) {
    const connectRegistrar = registrars.find((r) => r.id === activeCall?.registrarId);
    const connectRegistrarLabel = connectRegistrar?.name || connectRegistrar?.domain || null;

    return (
      <div className="flex items-center gap-0 rounded-lg bg-muted/10 shadow-card text-xs overflow-hidden">
        {/* Animated connecting indicator */}
        <div className="flex items-center justify-center w-8 self-stretch border-r border-border/20 bg-muted/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-live-breathe motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-foreground/30 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-foreground/40" />
          </span>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 min-w-0 flex-1">
          <div className="flex flex-col items-start min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="section-label-sm shrink-0 bg-muted/20 px-1 py-0.5 rounded">OUT</span>
              <span className="font-semibold text-foreground truncate max-w-[130px] text-2xs leading-tight">{callerLabel}</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-3xs text-muted-foreground/60 font-medium">Connecting</span>
              <span className="inline-flex gap-0.5">
                <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/40 animate-live-breathe motion-reduce:animate-none" style={{ animationDelay: "0ms" }} />
                <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/40 animate-live-breathe motion-reduce:animate-none" style={{ animationDelay: "var(--motion-duration-navigation)" }} />
                <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/40 animate-live-breathe motion-reduce:animate-none" style={{ animationDelay: "calc(var(--motion-duration-navigation) * 2)" }} />
              </span>
              {connectRegistrarLabel && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="text-3xs text-muted-foreground/60 truncate max-w-[80px]">{connectRegistrarLabel}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleEnd(activeCall.id)}
            className="h-6 px-2.5 rounded-lg bg-destructive/15 text-destructive text-2xs font-semibold hover:bg-destructive/25 transition-smooth ml-auto shrink-0"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  /* ── Incoming ringing ── */
  if (incomingRinging) {
    const ringRegistrar = registrars.find((r) => r.id === activeCall?.registrarId);
    const ringRegistrarLabel = ringRegistrar?.name || ringRegistrar?.domain || null;

    return (
      <div className="flex items-center gap-0 rounded-lg bg-success/5 shadow-card text-xs overflow-hidden">
        {/* Animated ringing indicator */}
        <div className="flex items-center justify-center w-8 self-stretch border-r border-success/10 bg-success/[0.06]">
          <Phone className="h-3.5 w-3.5 text-success animate-live-breathe motion-reduce:animate-none" />
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 min-w-0 flex-1 bg-success/[0.03]">
          <div className="flex flex-col items-start min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="section-label-sm shrink-0 bg-primary/10 px-1 py-0.5 rounded">IN</span>
              <span className="font-semibold text-foreground truncate max-w-[130px] text-2xs leading-tight">{callerLabel}</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-3xs text-success/70 font-medium">Incoming Call</span>
              {ringRegistrarLabel && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="text-3xs text-muted-foreground/60 truncate max-w-[80px]">{ringRegistrarLabel}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <button
              type="button"
              onClick={() => answerInboundCall(activeCall.id)}
              className="h-6 px-2.5 rounded-lg bg-success text-success-foreground text-2xs font-semibold hover:bg-success/90 transition-smooth"
            >
              Answer
            </button>
            <button
              type="button"
              onClick={() => rejectInboundCall(activeCall.id, 486)}
              className="h-6 px-2.5 rounded-lg bg-destructive/70 text-destructive-foreground text-2xs font-semibold hover:bg-destructive/90 transition-smooth"
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Active / On Hold — clickable pill opens popover ── */
  const qualityDotColor = callQuality?.dot ?? (isOnHold ? "bg-warning" : "bg-success");

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-0 rounded-lg border text-xs transition-smooth overflow-hidden",
            isOnHold
              ? "bg-warning/[0.04] border-warning/15 hover:bg-warning/[0.08]"
              : "bg-success/[0.04] border-success/15 hover:bg-success/[0.08]",
            popoverOpen && "ring-1 ring-border",
          )}
        >
          {/* Quality indicator bar */}
          <div className={cn(
            "flex items-center justify-center w-8 h-full self-stretch border-r",
            isOnHold ? "border-warning/10 bg-warning/[0.06]" : "border-success/10 bg-success/[0.06]",
          )}>
            <span className={cn("relative flex h-2 w-2")}>
              {!isOnHold && <span className={cn("animate-live-breathe motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full opacity-40", qualityDotColor)} />}
              <span className={cn("relative inline-flex rounded-full h-2 w-2", qualityDotColor)} />
            </span>
          </div>

          {/* Main info area */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
            {/* Caller + state */}
            <div className="flex flex-col items-start min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                {activeCall?.isInbound ? (
                  <span className="section-label-sm shrink-0">IN</span>
                ) : (
                  <span className="section-label-sm shrink-0">OUT</span>
                )}
                <span className="font-semibold text-foreground truncate max-w-[130px] text-2xs leading-tight">
                  {callerLabel}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className={cn(
                  "text-3xs font-medium",
                  isOnHold ? "text-warning/70" : "text-success/70",
                )}>
                  {isOnHold ? "Hold" : "Active"}
                </span>
                {activeCall?.negotiatedCodec && (
                  <>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="text-3xs font-mono text-muted-foreground/60">{activeCall.negotiatedCodec}</span>
                  </>
                )}
                {liveMetrics && (
                  <>
                    <span className="text-muted-foreground/60">·</span>
                    <span className={cn("text-3xs font-medium", callQuality?.color ?? "text-muted-foreground/60")}>
                      {liveMetrics.mos.toFixed(1)} MOS
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Duration */}
            {duration && (
              <span className="font-mono font-semibold text-foreground/80 tabular-nums text-2xs shrink-0">
                {duration}
              </span>
            )}

            {/* Status badges */}
            <div className="flex items-center gap-1 shrink-0">
              {activeCall?.muted && (
                <TooltipWrapper content="Muted">
                  <span className="h-5 w-5 rounded-lg bg-warning/15 flex items-center justify-center">
                    <MicOff className="h-2.5 w-2.5 text-warning" />
                  </span>
                </TooltipWrapper>
              )}
              {recording && (
                <TooltipWrapper content="Recording">
                  <span className="h-5 w-5 rounded-lg bg-destructive/15 flex items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none" />
                  </span>
                </TooltipWrapper>
              )}
              {activeCall?.transcriptionEnabled && (
                <TooltipWrapper content="Transcribing">
                  <span className="h-5 w-5 rounded-lg bg-primary/15 flex items-center justify-center">
                    <Activity className="h-2.5 w-2.5 text-primary" />
                  </span>
                </TooltipWrapper>
              )}
            </div>

            <ChevronDown className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform ml-0.5",
              popoverOpen && "rotate-180",
            )} />
          </div>
        </button>
      </PopoverTrigger>
      {renderPopoverContent()}
    </Popover>
  );

  /* ── Popover dropdown with full call controls ── */
  function renderPopoverContent() {
    if (!activeCall || !isLive) return null;

    const callRegistrar = registrars.find((r) => r.id === activeCall.registrarId);
    const callRegistrarLabel = callRegistrar?.name || callRegistrar?.domain || null;
    const transcriptLines = activeCall.transcription ?? [];
    const recentTranscriptLines = transcriptLines.slice(-3);

    return (
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[300px] p-0 ui-panel-shell rounded-md overflow-hidden"
      >
        {/* ── Rich call info header ── */}
        <div className="px-4 py-3 border-b border-border/20">
          {/* Top row: caller + duration */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Quality dot with colored ring */}
              <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center shrink-0 ring-2",
                isOnHold ? "bg-warning/10 ring-warning/20" : `bg-success/10 ${callQuality?.ring ?? "ring-success/20"}`,
              )}>
                <Phone className={cn("h-3.5 w-3.5", isOnHold ? "text-warning" : "text-success")} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {activeCall.isInbound ? (
                    <span className="section-label-sm shrink-0 bg-primary/10 px-1 py-0.5 rounded">IN</span>
                  ) : (
                    <span className="section-label-sm shrink-0 bg-muted/20 px-1 py-0.5 rounded">OUT</span>
                  )}
                  <span className="text-sm font-semibold text-foreground truncate">{callerLabel}</span>
                </div>
                {activeCall.target !== callerLabel && (
                  <p className="text-2xs text-muted-foreground/60 font-mono truncate">{activeCall.target}</p>
                )}
              </div>
            </div>
            {duration && (
              <span className="font-mono font-bold text-foreground tabular-nums text-sm shrink-0">
                {duration}
              </span>
            )}
          </div>

          {/* Info chips row */}
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            {/* State chip */}
            <span className={cn(
              "text-3xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-lg",
              isOnHold
                ? "bg-warning/10 text-warning"
                : "bg-success/10 text-success",
            )}>
              {isOnHold ? "On Hold" : "Active"}
            </span>

            {/* Codec chip */}
            {activeCall.negotiatedCodec && (
              <span className="text-3xs font-mono font-medium px-1.5 py-0.5 rounded-lg bg-muted/20 text-muted-foreground/60">
                {activeCall.negotiatedCodec}
              </span>
            )}

            {/* Registrar chip */}
            {callRegistrarLabel && (
              <span className="text-3xs font-medium px-1.5 py-0.5 rounded-lg bg-muted/20 text-muted-foreground/60 truncate max-w-[120px]">
                {callRegistrarLabel}
              </span>
            )}

            {/* Muted badge */}
            {activeCall.muted && (
              <span className="text-3xs font-semibold px-1.5 py-0.5 rounded-lg bg-warning/10 text-warning flex items-center gap-1">
                <MicOff className="h-2.5 w-2.5" /> Muted
              </span>
            )}

            {/* Recording badge */}
            {recording && (
              <span className="text-3xs font-semibold px-1.5 py-0.5 rounded-lg bg-destructive/10 text-destructive flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none" /> Rec
              </span>
            )}
          </div>

          {/* Live quality metrics bar */}
          {liveMetrics && (
            <div className="flex items-center gap-3 mt-2.5 pt-2 border-t border-border/20">
              <MetricCell
                label="MOS"
                value={liveMetrics.mos.toFixed(1)}
                color={callQuality?.color ?? "text-foreground/80"}
              />
              <div className="w-px h-5 bg-border/10" />
              <MetricCell
                label="Jitter"
                value={`${Math.round(liveMetrics.jitter_ms)}ms`}
                color={liveMetrics.jitter_ms > 50 ? "text-destructive" : liveMetrics.jitter_ms > 30 ? "text-warning" : "text-foreground/80"}
              />
              <div className="w-px h-5 bg-border/10" />
              <MetricCell
                label="Loss"
                value={`${liveMetrics.loss_percent.toFixed(1)}%`}
                color={liveMetrics.loss_percent > 2 ? "text-destructive" : liveMetrics.loss_percent > 0.5 ? "text-warning" : "text-foreground/80"}
              />
              <div className="w-px h-5 bg-border/10" />
              <MetricCell
                label="Quality"
                value={callQuality?.label ?? "—"}
                color={callQuality?.color ?? "text-muted-foreground/60"}
              />
            </div>
          )}
        </div>

        {/* Control grid */}
        <div className="px-3.5 py-2.5 flex flex-wrap gap-1.5">
          <WidgetBtn
            icon={activeCall.muted ? MicOff : Mic}
            label={activeCall.muted ? "Unmute" : "Mute"}
            active={activeCall.muted}
            activeColor="amber"
            onClick={() => muteCall(activeCall.id, !activeCall.muted)}
          />
          <WidgetBtn
            icon={isOnHold ? PlayCircle : Timer}
            label={isOnHold ? "Resume" : "Hold"}
            active={isOnHold}
            activeColor="green"
            onClick={() => holdCall(activeCall.id, !isOnHold)}
          />
          <WidgetBtn
            icon={Radio}
            label={recording ? "Stop Rec" : "Record"}
            active={recording}
            activeColor="red"
            onClick={handleToggleRecording}
          />
          <WidgetBtn
            icon={FileText}
            label={transcriptLoading ? "Loading" : activeCall.transcriptionEnabled ? "Listening" : "STT"}
            active={activeCall.transcriptionEnabled}
            activeColor="blue"
            onClick={handleToggleTranscription}
            disabled={transcriptLoading}
          />
          <WidgetBtn
            icon={ArrowRightLeft}
            label="Transfer"
            onClick={() => setShowTransfer(!showTransfer)}
            active={showTransfer}
          />
        </div>

        {/* Live transcript preview */}
        {(activeCall.transcriptionEnabled || recentTranscriptLines.length > 0) && (
          <div className="px-3.5 pb-2.5">
            <div className="rounded-lg border border-border/25 bg-muted/20 px-2.5 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <FileText className="h-3 w-3 text-primary" />
                <span className="text-2xs font-medium text-foreground/90">Live transcription</span>
                <div className="flex-1" />
                <span className={cn(
                  "text-3xs px-1.5 py-0.5 rounded-full",
                  activeCall.transcriptionEnabled ? "bg-success/15 text-success" : "bg-muted/40 text-muted-foreground",
                )}>
                  {activeCall.transcriptionEnabled ? "Listening" : "Stopped"}
                </span>
              </div>
              {recentTranscriptLines.length > 0 ? (
                <div className="space-y-1">
                  {recentTranscriptLines.map((line, idx) => (
                    <div key={`${line.timestamp}-${idx}`} className="text-2xs leading-snug">
                      <span className={cn(
                        "font-medium mr-1",
                        line.speaker === "local" ? "text-[#34d399]" : "text-[#60a5fa]",
                      )}>
                        {line.speaker === "local" ? "You:" : "Remote:"}
                      </span>
                      <span className={cn("text-foreground/80", !line.isFinal && "italic text-muted-foreground/70")}>
                        {line.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-2xs text-muted-foreground/70 italic">
                  Listening for speech...
                </p>
              )}
            </div>
          </div>
        )}

        {/* Inline transfer input */}
        {showTransfer && (
          <div className="px-3.5 pb-2.5 flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Transfer to..."
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTransfer()}
              className="flex-1 h-7 px-2.5 text-xs rounded-lg bg-muted/20 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-foreground/20"
              autoFocus
            />
            <button
              type="button"
              onClick={handleTransfer}
              disabled={!transferTarget.trim()}
              className="h-7 px-2.5 rounded-lg text-2xs font-medium bg-accent text-foreground hover:bg-accent disabled:opacity-30 transition-smooth"
            >
              Go
            </button>
          </div>
        )}

        {/* DTMF keypad for active call */}
        <DtmfKeypad
          sipCallId={activeCall.sipCallId}
          dtmfPayloadType={dtmfPayloadType}
        />

        {/* End call */}
        <div className="px-3.5 py-2 border-t border-border/20">
          <button
            type="button"
            onClick={() => handleEnd(activeCall.id)}
            className="w-full h-7 rounded-lg bg-destructive/15 text-destructive text-xs font-semibold hover:bg-destructive/25 transition-smooth flex items-center justify-center gap-1.5"
          >
            <PhoneOff className="h-3 w-3" />
            End Call
          </button>
        </div>
      </PopoverContent>
    );
  }
}

/* ── Small widget control button ── */
/* ── Metric cell for popover header ── */
function MetricCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center flex-1 min-w-0">
      <span className={cn("text-2xs font-semibold tabular-nums leading-none", color)}>{value}</span>
      <span className="section-label-sm mt-0.5">{label}</span>
    </div>
  );
}

/* ── DTMF Keypad for active-call popover ── */
function DtmfKeypad({
  sipCallId,
  dtmfPayloadType,
}: {
  sipCallId?: string | null;
  dtmfPayloadType: number;
}) {
  const [dtmfBuffer, setDtmfBuffer] = useState("");
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDtmf = useCallback(
    (keyChar: string) => {
      if (!sipCallId) return;
      setDtmfBuffer((prev) => prev + keyChar);
      sendDtmf(sipCallId, keyChar, dtmfPayloadType).catch(console.error);
      playDtmfTone(keyChar);

      // Brief flash on the pressed key
      setFlashKey(keyChar);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashKey(null), 180);
    },
    [sipCallId, dtmfPayloadType],
  );

  return (
    <div className="px-3.5 py-2.5 border-t border-border/20">
      <p className="section-label-sm mb-2">
        Keypad (DTMF)
      </p>

      {/* Sent-digits display */}
      {dtmfBuffer && (
        <div className="relative flex items-center justify-center h-8 mb-2 rounded-lg bg-muted/20 px-3">
          <span className="font-mono text-sm font-semibold tracking-[0.2em] text-foreground/80 truncate">
            {dtmfBuffer}
          </span>
          <button
            type="button"
            onClick={() => setDtmfBuffer("")}
            className="absolute right-2 text-muted-foreground/60 hover:text-foreground/80 transition-smooth"
            aria-label="Clear DTMF buffer"
          >
            <Backspace className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
        {DIAL_KEY_ROWS.map((row, rowIdx) =>
          row.map(({ key: keyChar, letters }) => (
            <button
              key={`dtmf-${rowIdx}-${keyChar}`}
              type="button"
              onClick={() => handleDtmf(keyChar)}
              className={cn(
                "h-10 w-10 rounded-lg flex flex-col items-center justify-center",
                "bg-secondary shadow-card",
                "hover:bg-accent hover:shadow-card-hover",
                "active:scale-[0.95] transition-all duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
                flashKey === keyChar && "bg-primary/20 scale-[0.95]",
              )}
              aria-label={letters ? `Send ${keyChar} ${letters}` : `Send ${keyChar}`}
            >
              <span className="text-sm font-medium text-foreground leading-none">{keyChar}</span>
              {letters && (
                <span className="text-3xs uppercase tracking-[0.1em] text-muted-foreground/70 mt-0.5">
                  {letters}
                </span>
              )}
            </button>
          )),
        )}
      </div>
    </div>
  );
}

function WidgetBtn({
  icon: Icon,
  label,
  active,
  activeColor = "primary",
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }> | (() => React.ReactNode);
  label: string;
  active?: boolean;
  activeColor?: "primary" | "amber" | "green" | "red" | "blue";
  onClick: () => void;
  disabled?: boolean;
}) {
  const colorMap = {
    primary: "border-border bg-muted/40 text-foreground",
    amber: "border-warning/30 bg-warning/10 text-warning",
    green: "border-success/30 bg-success/10 text-success",
    red: "border-destructive/30 bg-destructive/10 text-destructive",
    blue: "border-primary/30 bg-primary/10 text-primary",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-2xs font-medium transition-smooth border",
        active
          ? colorMap[activeColor]
          : "border-foreground/[0.05] bg-foreground/[0.02] text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground/80",
        disabled && "opacity-50 cursor-wait",
      )}
    >
      {typeof Icon === "function" && Icon.length === 0 ? (Icon as () => React.ReactNode)() : <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}
