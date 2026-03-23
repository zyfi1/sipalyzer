import { useState, useEffect, useMemo, useCallback } from "react";
import { useSoftphoneStore, CODEC_OPTIONS } from "@/stores/softphoneStore";
import { useContactsStore } from "@/stores/contactsStore";
import { useRegistrationStore, type Registrar } from "@/stores/registrationStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import type { Call } from "@/lib/softphone";
import { Phone, PhoneOff, ArrowRightLeft, Backspace, ChevronUp, ChevronDown, Mic, Volume2, Inbox, Code } from "@/lib/icons";
import { sendDtmf } from "@/lib/softphone";
import { playDtmfTone } from "@/lib/dtmfTones";
import { cn } from "@/lib/utils";
import { DIAL_KEY_ROWS } from "./softphone-constants";
import { sanitizeDialInput } from "./sanitizeDialInput";
import { digitsOnly } from "@/lib/e164";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { isRegistered } from "@/components/fax-center/FaxShared";
import { AppDropdown } from "@/components/ui/app-dropdown";

const MIC_LEVEL_SNAP_PERCENT = 100;
const MIC_LEVEL_SNAP_WINDOW = 4;

function snapMicLevelPercent(rawPercent: number): number {
  if (Math.abs(rawPercent - MIC_LEVEL_SNAP_PERCENT) <= MIC_LEVEL_SNAP_WINDOW) {
    return MIC_LEVEL_SNAP_PERCENT;
  }
  return rawPercent;
}

/* ═══════════════════════════════════════════════════════════════
   KeypadPane — left pane content when "Keypad" sub-tab is active.
   Modern circular glass keys, centred display, inline settings.
   ═══════════════════════════════════════════════════════════════ */

interface KeypadPaneProps {
  targetInput: string;
  setTargetInput: (value: string) => void;
  expanded?: boolean;
}

export function KeypadPane({ targetInput, setTargetInput, expanded = false }: KeypadPaneProps) {
  const activeRegistrarId = useSoftphoneStore((s) => s.activeRegistrarId);
  const startCall = useSoftphoneStore((s) => s.startCall);
  const activeCallId = useSoftphoneStore((s) => s.activeCallId);
  const calls = useSoftphoneStore((s) => s.calls);
  const mwiState = useSoftphoneStore((s) => s.mwiState);

  // Per-registrar voicemail / MWI
  const registrars = useRegistrationStore((s) => s.registrars);
  const updateRegistrar = useRegistrationStore((s) => s.updateRegistrar);
  const testResults = useRegistrationStore((s) => s.testResults);
  const healthRegistrars = useTroubleshootingStore((s) => s.registrationHealth?.registrars);
  const activeRegistrar = registrars.find((r) => r.id === activeRegistrarId);
  const registrarReady = isRegistered(activeRegistrarId ?? undefined, healthRegistrars, testResults);
  const voicemailNumber = activeRegistrar?.voicemail_number ?? "";
  const mwiEnabled = activeRegistrar?.mwi_enabled ?? false;
  const activeMwi = activeRegistrarId ? mwiState[activeRegistrarId] : undefined;
  const mwiMessagesWaiting = activeMwi?.waiting ?? false;
  const mwiNewCount = activeMwi?.newCount ?? 0;
  const mwiOldCount = activeMwi?.oldCount ?? 0;

  // Settings
  const dndEnabled = useSoftphoneStore((s) => s.dndEnabled);
  const updateSettings = useSoftphoneStore((s) => s.updateSettings);
  const forwardAllEnabled = useSoftphoneStore((s) => s.forwardAllEnabled);
  const forwardAllTarget = useSoftphoneStore((s) => s.forwardAllTarget);
  const forwardBusyEnabled = useSoftphoneStore((s) => s.forwardBusyEnabled);
  const forwardBusyTarget = useSoftphoneStore((s) => s.forwardBusyTarget);
  const forwardNoAnswerEnabled = useSoftphoneStore((s) => s.forwardNoAnswerEnabled);
  const forwardNoAnswerTarget = useSoftphoneStore((s) => s.forwardNoAnswerTarget);
  const preferredCodecs = useSoftphoneStore((s) => s.preferredCodecs);
  const setPreferredCodecs = useSoftphoneStore((s) => s.setPreferredCodecs);
  const [rtpPortDraft, setRtpPortDraft] = useState("");
  const [rtpSaving, setRtpSaving] = useState(false);

  const speedDialContacts = useContactsStore((s) => s.contacts.filter((c) => c.speedDial));

  const endCall = useSoftphoneStore((s) => s.endCall);
  const dtmfPayloadType = useSoftphoneStore((s) => s.dtmfPayloadType);

  const activeCall = calls.find((c) => c.id === activeCallId);
  const hasActiveRegistrar = !!activeRegistrarId && !!activeRegistrar;
  const isDialTargetComplete = useMemo(() => {
    const trimmed = targetInput.trim();
    if (!trimmed) return false;

    // SIP URI target must include both user and host.
    if (trimmed.includes("@")) {
      const compact = trimmed.replace(/\s+/g, "");
      return /^[a-zA-Z0-9_.\-+]+@[^@\s]+$/.test(compact)
        || /^sips?:[a-zA-Z0-9_.\-+]+@[^@\s]+$/i.test(compact);
    }

    // Feature codes like *97 / #31# / *70 should not be treated as incomplete.
    if (trimmed.includes("*") || trimmed.includes("#")) {
      return trimmed.length >= 2;
    }

    // Numeric dial target: treat 1-2 digits as incomplete.
    const digitCount = digitsOnly(trimmed).length;
    return digitCount >= 3;
  }, [targetInput]);
  const canPlace = hasActiveRegistrar && registrarReady && isDialTargetComplete && !activeCall;

  const hasOngoingCall = !!activeCall && activeCall.state !== "ended" && activeCall.state !== "failed";

  useEffect(() => {
    setRtpPortDraft(activeRegistrar?.rtp_port != null ? String(activeRegistrar.rtp_port) : "");
  }, [activeRegistrar?.id, activeRegistrar?.rtp_port]);

  const saveRegistrarRtpPort = useCallback(async () => {
    if (!activeRegistrar?.id || rtpSaving) return;
    const raw = rtpPortDraft.trim();
    const parsed = raw === "" ? undefined : Number(raw);
    if (parsed != null && (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535)) return;
    setRtpSaving(true);
    try {
      await updateRegistrar(activeRegistrar.id, { rtp_port: parsed });
    } finally {
      setRtpSaving(false);
    }
  }, [activeRegistrar?.id, rtpPortDraft, rtpSaving, updateRegistrar]);

  const handleDialKey = (key: string) => {
    // Send DTMF during an active in-call media session.
    if ((activeCall?.state === "active" || activeCall?.state === "on-hold" || activeCall?.state === "connecting") && activeCall?.sipCallId) {
      sendDtmf(activeCall.sipCallId, key, dtmfPayloadType).catch(console.error);
      playDtmfTone(key);
    }
    setTargetInput(sanitizeDialInput(targetInput + key));
  };

  const handlePlaceCall = () => {
    if (!canPlace) return;
    const ctx = useExecutionContextStore.getState().resolvedContext("softphone");
    startCall(targetInput.trim(), ctx);
  };

  const handleEndCall = () => {
    if (activeCall) endCall(activeCall.id);
  };

  const startWithCurrentContext = (target: string) => {
    const ctx = useExecutionContextStore.getState().resolvedContext("softphone");
    startCall(target, ctx);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ── Number display ── */}
      <div className="px-4 pt-3 pb-3 shrink-0">
        <div className={cn(
          "ui-control-shell relative flex items-center justify-center rounded-md px-3 transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
          "focus-within:border-primary/55 focus-within:ring-1 focus-within:ring-primary/35",
          expanded ? "h-12" : "h-11",
        )}>
          <input
            type="text"
            placeholder="Enter number"
            value={targetInput}
            onChange={(e) => setTargetInput(sanitizeDialInput(e.target.value))}
            onPaste={(e) => {
              e.preventDefault();
              const input = e.target as HTMLInputElement;
              const s = input.selectionStart ?? 0;
              const end = input.selectionEnd ?? 0;
              const pasted = (e.clipboardData?.getData("text/plain") ?? "").trim();
              const next = targetInput.slice(0, s) + sanitizeDialInput(pasted) + targetInput.slice(end);
              setTargetInput(sanitizeDialInput(next));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canPlace) handlePlaceCall();
            }}
            className={cn(
              "w-full text-center bg-transparent border-none outline-none",
              "font-mono tracking-wider placeholder:font-semibold placeholder:text-foreground/65",
              targetInput
                ? expanded ? "text-xl font-medium text-foreground" : "text-lg font-medium text-foreground"
                : "text-sm text-foreground/80 font-sans tracking-normal",
            )}
          />
          {targetInput && (
            <button
              type="button"
              onClick={() => setTargetInput("")}
              className="ui-control-shell absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground transition-smooth"
              aria-label="Clear number"
            >
              <Backspace className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status badges */}
        {(dndEnabled || forwardAllEnabled) && (
          <div className="flex items-center justify-center gap-1.5 mt-1">
            {dndEnabled && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs font-bold uppercase tracking-wider bg-destructive/10 text-destructive">
                <PhoneOff className="h-2 w-2" /> DND
              </span>
            )}
            {forwardAllEnabled && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs font-bold uppercase tracking-wider bg-warning/10 text-warning">
                <ArrowRightLeft className="h-2 w-2" /> FWD
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-4">
        {/* ── Keypad cluster — consistent spacing around keys/actions ── */}
        <div className={cn("mx-auto mt-1 w-fit px-4", expanded ? "space-y-2.5" : "space-y-2")}>
          {/* ── Keypad grid — design-system aligned keys ── */}
          <div className={cn(
            "grid grid-cols-3 transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
            expanded ? "gap-2.5" : "gap-2",
          )}>
            {DIAL_KEY_ROWS.map((row, rowIdx) =>
              row.map(({ key: keyChar, letters }) => (
                <button
                  key={`${rowIdx}-${keyChar}`}
                  type="button"
                  className={cn(
                    "ui-control-shell rounded-lg",
                    "hover:bg-accent",
                    "active:scale-[0.97]",
                    "transition-smooth",
                    "flex flex-col items-center justify-center",
                    expanded ? "h-[52px] w-[52px]" : "h-[42px] w-[42px]",
                  )}
                  onClick={() => handleDialKey(keyChar)}
                  aria-label={letters ? `Key ${keyChar} ${letters}` : `Key ${keyChar}`}
                >
                  <span className={cn(
                    "font-mono font-medium text-foreground leading-none tracking-tight",
                    expanded ? "text-lg" : "text-base",
                  )}>
                    {keyChar}
                  </span>
                  {letters && (
                    <span className="uppercase tracking-[0.15em] text-muted-foreground/70 mt-0.5 font-medium text-3xs">
                      {letters}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* ── Call / Hang-up button ── */}
          <div className="flex justify-center">
            {hasOngoingCall ? (
              <button
                type="button"
                onClick={handleEndCall}
                className={cn(
                  "ui-control-shell rounded-lg flex items-center justify-center transition-smooth border-transparent",
                  "active:scale-[0.97]",
                  expanded ? "h-[52px] w-[52px]" : "h-[42px] w-[42px]",
                  "!bg-destructive !text-destructive-foreground !border-destructive/65 hover:!bg-destructive/90 shadow-[0_0_0_1px_hsl(var(--destructive)/0.55)]",
                )}
              >
                <PhoneOff className={expanded ? "h-5 w-5" : "h-4.5 w-4.5"} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePlaceCall}
                disabled={!canPlace}
                className={cn(
                  "ui-control-shell rounded-lg flex items-center justify-center transition-smooth border-transparent",
                  "active:scale-[0.97]",
                  expanded ? "h-[52px] w-[52px]" : "h-[42px] w-[42px]",
                  canPlace
                    ? [
                        "!bg-success !text-success-foreground !border-success/65 shadow-[0_0_0_1px_hsl(var(--success)/0.55)]",
                        "hover:!bg-success/90",
                      ]
                    : "!bg-muted/35 !border-border/40 !text-muted-foreground/60 cursor-not-allowed shadow-none",
                )}
              >
                <Phone className={expanded ? "h-5 w-5" : "h-4.5 w-4.5"} />
              </button>
            )}
          </div>
        </div>
        {activeRegistrar && (
          <p className="text-3xs text-muted-foreground/70 text-center px-4 mt-0.5">
            {`Via ${(activeRegistrar.transport || "udp").toUpperCase()} • ${activeRegistrar.domain}:${activeRegistrar.remote_port} • timeout ${activeRegistrar.timeout_seconds}s`}
          </p>
        )}

        {/* ── Speed dials ── */}
        {speedDialContacts.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 px-3">
            {speedDialContacts.slice(0, 4).map((c) => (
              <TooltipWrapper key={c.id} title={c.name} description={c.phone}>
                <button
                  type="button"
                  onClick={() => {
                    setTargetInput(c.phone);
                    if (registrarReady) startWithCurrentContext(c.phone);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 pl-1 pr-2 py-1 rounded-full",
                    "bg-foreground/[0.04]",
                    "hover:bg-foreground/[0.08] active:scale-[0.97] transition-smooth",
                  )}
                >
                  <span className="h-5 w-5 rounded-full bg-muted/40 flex items-center justify-center text-3xs font-semibold text-muted-foreground">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <span className={cn("text-2xs font-medium text-foreground/80 truncate", expanded ? "max-w-[80px]" : "max-w-[55px]")}>
                    {c.name.split(" ")[0]}
                  </span>
                </button>
              </TooltipWrapper>
            ))}
          </div>
        )}

        {/* ── Voicemail / MWI (per-registrar) ── */}
        {activeRegistrar && (
          <div className="mx-4 mt-1">
            <VoicemailCard
              voicemailNumber={voicemailNumber}
              mwiEnabled={mwiEnabled}
              mwiMessagesWaiting={mwiMessagesWaiting}
              mwiNewCount={mwiNewCount}
              mwiOldCount={mwiOldCount}
              activeRegistrarId={activeRegistrarId}
              registrarReady={registrarReady}
              registrar={activeRegistrar}
              onDial={() => { if (voicemailNumber) startWithCurrentContext(voicemailNumber); }}
              onUpdateRegistrar={updateRegistrar}
            />
          </div>
        )}

        {/* ── Settings section ── */}
        <div className="border-t border-border/50 mx-4 pt-4 space-y-2">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60 px-0.5 mb-1">
            Settings
          </p>
          {/* DND — prominent toggle card */}
          <button
            type="button"
            onClick={() => updateSettings({ dndEnabled: !dndEnabled })}
            className={cn(
              "w-full rounded-lg px-3 py-2.5 flex items-center gap-3 transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)] border",
              dndEnabled
                ? "bg-destructive/10 border-destructive/20"
                : "rounded-md border border-border/40 bg-card/50 hover:bg-card/80 hover:border-border/50",
            )}
          >
            <div className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-smooth",
              dndEnabled ? "bg-destructive/20 text-destructive" : "bg-muted/30 text-muted-foreground",
            )}>
              <PhoneOff className="h-4 w-4" />
            </div>
            <div className="flex-1 text-left">
              <span className={cn("text-xs font-medium", dndEnabled ? "text-destructive" : "text-foreground")}>
                Do Not Disturb
              </span>
              <p className="text-2xs text-muted-foreground leading-tight mt-0.5">
                {dndEnabled ? "Incoming calls blocked" : "Tap to block incoming"}
              </p>
            </div>
            <Toggle id="kp-dnd" checked={dndEnabled} onChange={(v) => updateSettings({ dndEnabled: v })} color="destructive" />
          </button>

          {/* Audio — collapsible */}
          <AudioDeviceSection />

          {/* Forwarding — collapsible */}
          <CollapsibleSection
            icon={<ArrowRightLeft className="h-3 w-3 text-primary" />}
            label="Call Forwarding"
            badge={forwardAllEnabled || forwardBusyEnabled || forwardNoAnswerEnabled ? "ON" : undefined}
            badgeColor="warning"
          >
            <div className="ui-panel-shell divide-y divide-border/20 overflow-hidden">
              <FwdRow id="kp-fwd-all" label="All" on={forwardAllEnabled} target={forwardAllTarget} setOn={(v) => updateSettings({ forwardAllEnabled: v })} setTarget={(v) => updateSettings({ forwardAllTarget: v })} />
              <FwdRow id="kp-fwd-busy" label="Busy" on={forwardBusyEnabled} target={forwardBusyTarget} setOn={(v) => updateSettings({ forwardBusyEnabled: v })} setTarget={(v) => updateSettings({ forwardBusyTarget: v })} />
              <FwdRow id="kp-fwd-na" label="No Answer" on={forwardNoAnswerEnabled} target={forwardNoAnswerTarget} setOn={(v) => updateSettings({ forwardNoAnswerEnabled: v })} setTarget={(v) => updateSettings({ forwardNoAnswerTarget: v })} />
            </div>
          </CollapsibleSection>

          {/* Codecs — collapsible + sortable */}
          <CollapsibleSection
            icon={<Code className="h-3 w-3" />}
            label="Codec Preferences"
            badge={`${preferredCodecs.length}`}
            badgeColor="muted"
          >
            <SortableCodecList preferredCodecs={preferredCodecs} setPreferredCodecs={setPreferredCodecs} />
          </CollapsibleSection>

          {/* Registrar RTP port — per registrar */}
          {activeRegistrar?.id && (
            <CollapsibleSection
              icon={<Volume2 className="h-3 w-3" />}
              label="RTP Port (This Registrar)"
              badge={activeRegistrar.rtp_port != null ? String(activeRegistrar.rtp_port) : "Auto"}
              badgeColor="primary"
            >
              <div className="space-y-2">
                <p className="text-2xs text-muted-foreground">
                  Pinned local RTP port for this registrar. Leave blank to use automatic allocation.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    step={1}
                    value={rtpPortDraft}
                    onChange={(e) => setRtpPortDraft(e.target.value)}
                    className="ui-control-shell w-full h-8 px-2.5 text-xs rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-smooth"
                    placeholder="Auto"
                  />
                  <button
                    type="button"
                    onClick={saveRegistrarRtpPort}
                    disabled={rtpSaving}
                    className={cn(
                      "ui-control-shell h-8 px-3 rounded-md text-xs font-medium transition-smooth",
                      rtpSaving
                        ? "bg-muted/30 text-muted-foreground cursor-not-allowed"
                        : "bg-primary/15 text-primary hover:bg-primary/25",
                    )}
                  >
                    {rtpSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   IncomingCallScreen — right-pane takeover for ringing inbound
   ═══════════════════════════════════════════════════════════════ */

export function IncomingCallScreen({ call }: { call: Call }) {
  const answerInboundCall = useSoftphoneStore((s) => s.answerInboundCall);
  const rejectInboundCall = useSoftphoneStore((s) => s.rejectInboundCall);
  const allContacts = useContactsStore((s) => s.contacts);

  const [ringSeconds, setRingSeconds] = useState(0);
  useEffect(() => {
    setRingSeconds(0);
    const iv = setInterval(() => setRingSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [call.id]);

  const matchedContact = useMemo(() => {
    if (!call.target) return null;
    const num = call.target.replace(/[^\d+]/g, "");
    if (!num) return null;
    return allContacts.find((c) => {
      const cn = c.phone.replace(/[^\d+]/g, "");
      return cn === num || cn.endsWith(num) || num.endsWith(cn);
    }) ?? null;
  }, [call.target, allContacts]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-success/[0.04] via-transparent to-success/[0.02] animate-live-breathe motion-reduce:animate-none pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] rounded-full bg-success/[0.03] animate-live-ripple motion-reduce:animate-none" />
      </div>

      <div className="relative mb-7 z-10">
        <div className="absolute inset-[-14px] rounded-full border border-success/10 animate-live-ripple motion-reduce:animate-none" />
        <div className="absolute inset-[-8px] rounded-full border-2 border-success/20 animate-live-breathe motion-reduce:animate-none" />
        <div className={cn(
          "h-20 w-20 rounded-full flex items-center justify-center relative",
          "bg-gradient-to-br from-success/20 to-success/10 border-2 border-success/30",
          "shadow-[0_0_50px_rgba(34,197,94,0.15)]",
        )}>
          {matchedContact ? (
            <span className="text-2xl font-bold text-success/90">{matchedContact.name.charAt(0).toUpperCase()}</span>
          ) : (
            <Phone className="h-8 w-8 text-success/90" />
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 z-10 mb-2">
        <span className="text-2xs font-semibold uppercase tracking-[0.2em] text-success/80 animate-live-breathe motion-reduce:animate-none">Incoming Call</span>
        {matchedContact ? (
          <>
            <p className="text-xl font-semibold text-foreground mt-1">{matchedContact.name}</p>
            {matchedContact.company && <p className="text-sm text-muted-foreground/60">{matchedContact.company}</p>}
            <p className="text-sm text-muted-foreground/80 font-mono mt-0.5">{call.target}</p>
          </>
        ) : (
          <>
            <p className="text-xl font-semibold text-foreground mt-1">{call.target}</p>
            <p className="text-sm text-muted-foreground/60 mt-0.5">Unknown caller</p>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 mt-1.5 mb-8 z-10">
        <span className="h-1.5 w-1.5 rounded-full bg-success status-online" />
        <span className="text-sm tabular-nums text-muted-foreground/70 font-medium">Ringing {ringSeconds}s</span>
      </div>

      <div className="flex items-center gap-14 z-10">
        <div className="flex flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={() => rejectInboundCall(call.id, 486)}
            className={cn(
              "h-14 w-14 rounded-full flex items-center justify-center transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
              "bg-gradient-to-br from-destructive to-destructive/90 text-destructive-foreground",
              "hover:from-destructive/90 hover:to-destructive hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]",
              "active:scale-95 shadow-lg shadow-destructive/20",
            )}
          >
            <PhoneOff className="h-6 w-6" />
          </button>
          <span className="text-2xs font-medium text-destructive/80">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={() => answerInboundCall(call.id)}
            className={cn(
              "h-14 w-14 rounded-full flex items-center justify-center transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
              "bg-gradient-to-br from-success to-success/90 text-success-foreground",
              "hover:from-success/90 hover:to-success hover:shadow-[0_0_24px_rgba(34,197,94,0.4)]",
              "active:scale-95 shadow-lg shadow-success/20",
            )}
          >
            <Phone className="h-6 w-6" />
          </button>
          <span className="text-2xs font-medium text-success/80">Answer</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Small helpers
   ═══════════════════════════════════════════════════════════════ */

/* ── Audio device picker ── */
function AudioDeviceSection() {
  const audioInputDevices = useSoftphoneStore((s) => s.audioInputDevices);
  const audioOutputDevices = useSoftphoneStore((s) => s.audioOutputDevices);
  const audioInputDeviceId = useSoftphoneStore((s) => s.audioInputDeviceId);
  const audioOutputDeviceId = useSoftphoneStore((s) => s.audioOutputDeviceId);
  const audioInputLevel = useSoftphoneStore((s) => s.audioInputLevel);
  const setAudioInputDevice = useSoftphoneStore((s) => s.setAudioInputDevice);
  const setAudioOutputDevice = useSoftphoneStore((s) => s.setAudioOutputDevice);
  const setAudioInputLevel = useSoftphoneStore((s) => s.setAudioInputLevel);

  const inputLabel = audioInputDevices.find((d) => d.id === audioInputDeviceId)?.name ?? "Default";
  const outputLabel = audioOutputDevices.find((d) => d.id === audioOutputDeviceId)?.name ?? "Default";
  const micGainPercent = Math.max(0, Math.min(200, Math.round(audioInputLevel * 100)));

  return (
    <CollapsibleSection
      icon={<Volume2 className="h-3 w-3" />}
      label="Audio"
      badge={inputLabel === "Default" && outputLabel === "Default" ? undefined : "Custom"}
      badgeColor={inputLabel === "Default" && outputLabel === "Default" ? undefined : "primary"}
    >
      <div className="space-y-3">
        {/* Microphone */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/60 font-medium">
            <Mic className="h-3 w-3" />
            Input
          </div>
          <AppDropdown
            value={audioInputDeviceId ?? "__default__"}
            onValueChange={(value) => setAudioInputDevice(value === "__default__" ? null : value)}
            className="ui-control-shell w-full h-8 px-2 text-xs"
            placeholder="System Default"
            options={[
              { value: "__default__", label: "System Default" },
              ...audioInputDevices.map((d) => ({
                value: d.id,
                label: `${d.name}${d.isDefault ? " (Default)" : ""}`,
              })),
            ]}
          />
        </div>

        {/* Speaker */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/60 font-medium">
            <Volume2 className="h-3 w-3" />
            Output
          </div>
          <AppDropdown
            value={audioOutputDeviceId ?? "__default__"}
            onValueChange={(value) => setAudioOutputDevice(value === "__default__" ? null : value)}
            className="ui-control-shell w-full h-8 px-2 text-xs"
            placeholder="System Default"
            options={[
              { value: "__default__", label: "System Default" },
              ...audioOutputDevices.map((d) => ({
                value: d.id,
                label: `${d.name}${d.isDefault ? " (Default)" : ""}`,
              })),
            ]}
          />
        </div>

        {/* Input level */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-2xs text-muted-foreground/60 font-medium">Microphone Level</span>
            <span className="text-2xs font-mono text-muted-foreground/60 tabular-nums">{micGainPercent}%</span>
          </div>
          <div className="relative">
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={micGainPercent}
              onChange={(e) => {
                const rawPercent = parseInt(e.target.value, 10);
                const snappedPercent = snapMicLevelPercent(rawPercent);
                setAudioInputLevel(snappedPercent / 100);
              }}
              className="relative z-10 w-full h-1 accent-primary bg-muted/40 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-border/70"
            />
          </div>
          <div className="relative h-3 text-3xs font-mono tabular-nums text-muted-foreground/70">
            <span className="absolute left-0">0</span>
            <span className="absolute left-1/2 -translate-x-1/2 text-foreground/80">100</span>
            <span className="absolute right-0">200</span>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}

/* ── Collapsible section ── */
function CollapsibleSection({
  icon,
  label,
  badge,
  badgeColor = "muted",
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  badge?: string;
  badgeColor?: "muted" | "primary" | "warning";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const badgeColors = {
    muted: "bg-muted/50 text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <div className="ui-panel-shell overflow-hidden transition-smooth hover:shadow-card-hover">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-smooth hover:bg-card/80"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]", !open && "-rotate-90")} />
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <span className="text-xs font-medium text-foreground flex-1">{label}</span>
        {badge && (
          <span className={cn("text-2xs font-semibold px-2 py-0.5 rounded-lg", badgeColors[badgeColor])}>
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-3 pb-3 pt-0 border-t border-border/20">{children}</div>}
    </div>
  );
}

/* ── Voicemail / MWI card ── */
function VoicemailCard({
  voicemailNumber,
  mwiEnabled,
  mwiMessagesWaiting,
  mwiNewCount,
  mwiOldCount,
  activeRegistrarId,
  registrarReady,
  registrar,
  onDial,
  onUpdateRegistrar,
}: {
  voicemailNumber: string;
  mwiEnabled: boolean;
  mwiMessagesWaiting: boolean;
  mwiNewCount: number;
  mwiOldCount: number;
  activeRegistrarId: string | null;
  registrarReady: boolean;
  registrar: Registrar;
  onDial: () => void;
  onUpdateRegistrar: (id: string, data: Partial<Registrar>) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)] overflow-hidden",
        !registrarReady && "opacity-60 saturate-0",
        mwiMessagesWaiting
          ? "bg-primary/[0.06] border-primary/20"
          : "bg-foreground/[0.02] border-foreground/[0.04]",
      )}
    >
      {/* Main row — click to dial */}
      <button
        type="button"
        onClick={() => { if (voicemailNumber && registrarReady) onDial(); }}
        disabled={!voicemailNumber || !activeRegistrarId || !registrarReady}
        className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-foreground/[0.03] active:bg-foreground/[0.05] transition-smooth disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <div className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-smooth relative",
          mwiMessagesWaiting ? "bg-primary/20 text-primary" : "bg-muted/20 text-muted-foreground/60",
        )}>
          <Inbox className="h-4 w-4" />
          {mwiMessagesWaiting && mwiNewCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-primary text-primary-foreground text-3xs font-bold flex items-center justify-center shadow-sm">
              {mwiNewCount}
            </span>
          )}
        </div>
        <div className="flex-1 text-left min-w-0">
          <span className={cn(
            "text-xs font-medium",
            mwiMessagesWaiting ? "text-primary" : "text-foreground/70",
          )}>
            Voicemail
          </span>
          <p className="text-2xs text-muted-foreground/60 leading-tight truncate">
            {!registrarReady
              ? "Unavailable while registrar is offline"
              : mwiMessagesWaiting
              ? `${mwiNewCount} new${mwiOldCount > 0 ? ` · ${mwiOldCount} old` : ""}`
              : voicemailNumber
                ? voicemailNumber
                : "Not configured"
            }
          </p>
        </div>
        {/* Settings gear */}
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); setEditing(!editing); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setEditing(!editing); } }}
          className="h-6 w-6 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-muted-foreground/60 hover:bg-foreground/[0.05] transition-smooth"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]", editing && "rotate-180")} />
        </div>
      </button>

      {/* Expandable config */}
      {editing && (
        <div className="border-t border-foreground/[0.04] px-3 py-2.5 space-y-2.5">
          {/* MWI toggle */}
          <label htmlFor="vm-mwi" className="flex items-center gap-3 cursor-pointer">
            <Toggle id="vm-mwi" checked={mwiEnabled} onChange={(v) => {
              if (registrar.id) onUpdateRegistrar(registrar.id, { ...registrar, mwi_enabled: v });
            }} color="primary" />
            <span className="text-xs font-medium text-foreground/80">MWI Notifications</span>
          </label>
          {/* VM number */}
          <div className="space-y-1">
            <span className="text-2xs text-muted-foreground/60 uppercase tracking-wider font-medium">VM Number</span>
            <input
              placeholder="*97"
              value={voicemailNumber}
              onChange={(e) => {
                if (registrar.id) onUpdateRegistrar(registrar.id, { ...registrar, voicemail_number: e.target.value || null });
              }}
              className="ui-control-shell w-full h-8 px-2.5 text-xs rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/25 transition-smooth"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ id, checked, onChange, color = "primary" }: { id: string; checked: boolean; onChange: (v: boolean) => void; color?: "primary" | "destructive" | "warning" }) {
  const colors = { primary: "bg-primary", destructive: "bg-destructive", warning: "bg-warning" };
  return (
    <div className={cn("h-5 w-9 rounded-full relative cursor-pointer transition-smooth duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]", checked ? colors[color] : "bg-muted/50")}>
      <div className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-foreground shadow-sm transition-transform duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]", checked ? "translate-x-4" : "translate-x-0.5")} />
      <input type="checkbox" id={id} className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SortableCodecList — drag-to-reorder preferred codecs
   ═══════════════════════════════════════════════════════════════ */

function SortableCodecList({ preferredCodecs, setPreferredCodecs }: { preferredCodecs: string[]; setPreferredCodecs: (v: string[]) => void }) {
  const availableCodecs = CODEC_OPTIONS.filter((c) => !preferredCodecs.includes(c));

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...preferredCodecs];
    [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
    setPreferredCodecs(next);
  };

  const moveDown = (idx: number) => {
    if (idx >= preferredCodecs.length - 1) return;
    const next = [...preferredCodecs];
    [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
    setPreferredCodecs(next);
  };

  return (
    <div className="space-y-2">
      {/* Active codecs — arrow-sortable */}
      <div className="ui-panel-shell divide-y divide-border/20 overflow-hidden">
        {preferredCodecs.map((codec, idx) => (
          <div
            key={codec}
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-card/80 transition-smooth"
          >
            {/* Up / Down arrows */}
            <div className="flex flex-col shrink-0 -my-0.5">
              <TooltipWrapper content="Move up">
                <button
                  type="button"
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0}
                  className={cn(
                    "h-3 w-4 flex items-center justify-center transition-smooth",
                    idx === 0 ? "text-muted-foreground/60 cursor-default" : "text-muted-foreground/60 hover:text-foreground",
                  )}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
              </TooltipWrapper>
              <TooltipWrapper content="Move down">
                <button
                  type="button"
                  onClick={() => moveDown(idx)}
                  disabled={idx === preferredCodecs.length - 1}
                  className={cn(
                    "h-3 w-4 flex items-center justify-center transition-smooth",
                    idx === preferredCodecs.length - 1 ? "text-muted-foreground/60 cursor-default" : "text-muted-foreground/60 hover:text-foreground",
                  )}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </TooltipWrapper>
            </div>

            <span className="h-4 w-4 rounded-full flex items-center justify-center text-3xs font-bold tabular-nums shrink-0 bg-muted/40 text-foreground">
              {idx + 1}
            </span>
            <span className="font-mono font-medium flex-1">{codec}</span>
            <TooltipWrapper content="Remove">
              <button
                type="button"
                onClick={() => {
                  if (preferredCodecs.length <= 1) return;
                  setPreferredCodecs(preferredCodecs.filter((c) => c !== codec));
                }}
                className={cn(
                  "text-3xs font-medium text-muted-foreground hover:text-destructive transition-smooth px-1",
                  preferredCodecs.length <= 1 && "invisible",
                )}
              >
                ✕
              </button>
            </TooltipWrapper>
          </div>
        ))}
      </div>

      {/* Available codecs — click to add */}
      {availableCodecs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {availableCodecs.map((codec) => (
            <button
              key={codec}
              type="button"
              onClick={() => setPreferredCodecs([...preferredCodecs, codec])}
          className="ui-control-shell px-2 py-1 rounded-md text-3xs font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-smooth"
            >
              + {codec}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FwdRow({ id, label, on, target, setOn, setTarget }: { id: string; label: string; on: boolean; target: string; setOn: (v: boolean) => void; setTarget: (v: string) => void }) {
  return (
    <div className="px-3 py-2.5 space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-3 cursor-pointer">
        <Toggle id={id} checked={on} onChange={setOn} color="warning" />
        <span className="text-xs font-medium text-foreground/80">{label}</span>
      </label>
      {on && (
        <input
          placeholder="Target number or SIP URI..."
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="ui-control-shell w-full h-8 px-2.5 text-xs rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-smooth"
        />
      )}
    </div>
  );
}
