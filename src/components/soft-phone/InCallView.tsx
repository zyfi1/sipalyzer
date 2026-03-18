import { type MutableRefObject, useState, useEffect, useRef, useCallback } from "react";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { navigateTo } from "@/lib/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Mic, MicOff, PlayCircle, PhoneOff, ArrowRightLeft,
  ChevronDown, ChevronUp, AlertTriangle, CircleArrowOutDownRight, Timer, Radio, FileText,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { SOFTPHONE } from "./softphone-constants";
import { formatCallDuration } from "./softphone-utils";
import {
  ParticleNebula, WaveformRibbon, FrequencyAurora, HeartbeatEKG,
  TerrainRange, BarSpectrum, DigitalRain, VISUALIZER_OPTIONS, type VisualizerId,
} from "./visualizers";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { Call } from "@/lib/softphone";
import { startRecording, stopRecording, isRecording as checkIsRecording } from "@/lib/softphone";
import { speechStartTranscription, speechStopTranscription, speechEnsureModel, speechModelStatus } from "@/api/speech";
import { getTranscriptionSampleRate } from "@/lib/transcription";
import { SipFlowTimeline } from "./SipFlowTimeline";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";

// ---------------------------------------------------------------------------

interface InCallViewProps {
  call: Call;
  displayMetrics: {
    mos: number;
    jitter_ms: number;
    send_peak: number;
    recv_peak: number;
    loss_percent: number;
    lost_packets: number;
  } | null;
  waveformRef: MutableRefObject<{ send: number[]; recv: number[] }>;
  callTimerTick: number;
}

// ---------------------------------------------------------------------------
// Quality helpers
// ---------------------------------------------------------------------------

function mosColor(mos: number) { return mos >= 4 ? "text-success" : mos >= 3 ? "text-warning" : "text-destructive"; }
function mosBg(mos: number) { return mos >= 4 ? "" : mos >= 3 ? "bg-warning/5" : "bg-destructive/5"; }
function mosDotColor(mos: number) { return mos >= 4 ? "bg-success" : mos >= 3 ? "bg-warning" : "bg-destructive"; }
function jitterColor(j: number) { return j < 20 ? "text-success" : j < 50 ? "text-warning" : "text-destructive"; }
function lossColor(l: number) { return l < 1 ? "text-success" : l < 3 ? "text-warning" : "text-destructive"; }


// ---------------------------------------------------------------------------
// Visualizer renderer
// ---------------------------------------------------------------------------

function ActiveVisualizer({ vizId, waveformRef, height }: { vizId: VisualizerId; waveformRef: MutableRefObject<{ send: number[]; recv: number[] }>; height: number }) {
  const sharedProps = {
    waveformRef,
    className: "w-full rounded-lg overflow-hidden",
    style: { height } as React.CSSProperties,
  };
  switch (vizId) {
    case "ribbon": return <WaveformRibbon {...sharedProps} />;
    case "aurora": return <FrequencyAurora {...sharedProps} />;
    case "ekg": return <HeartbeatEKG {...sharedProps} />;
    case "terrain": return <TerrainRange {...sharedProps} />;
    case "bars": return <BarSpectrum {...sharedProps} />;
    case "rain": return <DigitalRain {...sharedProps} />;
    case "nebula": default: return <ParticleNebula {...sharedProps} />;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InCallView({ call, displayMetrics, waveformRef, callTimerTick }: InCallViewProps) {
  const endCall = useSoftphoneStore((s) => s.endCall);
  const holdCall = useSoftphoneStore((s) => s.holdCall);
  const muteCall = useSoftphoneStore((s) => s.muteCall);
  const parkCall = useSoftphoneStore((s) => s.parkCall);
  const visualizer = useSoftphoneStore((s) => s.visualizer);
  const showVisualizer = useSoftphoneStore((s) => s.showVisualizer);
  const updateSettings = useSoftphoneStore((s) => s.updateSettings);
  const setTranscriptionEnabled = useSoftphoneStore((s) => s.setTranscriptionEnabled);
  const setSelectPacketBySip = usePacketCaptureStore((s) => s.setSelectPacketBySip);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const [recording, setRecording] = useState(false);
  const [recLoading, setRecLoading] = useState(false);
  const [transcribeLoading, setTranscribeLoading] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const sipCallId = call.sipCallId;
  const isOnHold = call.state === "on-hold";
  const isMuted = !!call.muted;
  const transcribing = !!call.transcriptionEnabled;
  const isRemoteAgent = !!call.remoteAgentId;
  const errorMsg = call.errorMessage || call.audioError;
  const isDegraded = displayMetrics
    ? displayMetrics.mos < 3 || displayMetrics.jitter_ms > 50 || displayMetrics.loss_percent > 3
    : false;

  // Poll recording state
  useEffect(() => {
    if (!sipCallId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await checkIsRecording(sipCallId);
        if (!cancelled) setRecording(r);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sipCallId]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [call.transcription?.length]);

  // Keep transcript panel open while live transcription is active.
  useEffect(() => {
    if (transcribing) setTranscriptOpen(true);
  }, [transcribing]);

  const toggleRecording = useCallback(async () => {
    if (recLoading || !sipCallId) return;
    setRecLoading(true);
    try {
      if (recording) { await stopRecording(sipCallId); setRecording(false); }
      else { await startRecording(sipCallId); setRecording(true); }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addNotification({
        type: "error",
        title: "Recording Failed",
        description: msg || "Unable to toggle recording.",
        source: "soft-phone",
      });
    }
    setRecLoading(false);
  }, [recording, recLoading, sipCallId, addNotification]);

  const toggleTranscription = useCallback(async () => {
    if (transcribeLoading || !sipCallId) return;
    setTranscribeLoading(true);
    try {
      if (transcribing) {
        await speechStopTranscription(sipCallId);
        setTranscriptionEnabled(call.id, false);
        addNotification({
          type: "info",
          title: "Live Transcription Stopped",
          description: "Speech-to-text is no longer listening.",
          source: "soft-phone",
        });
      } else {
        const status = await speechModelStatus();
        if (!status.downloaded) await speechEnsureModel();
        const sampleRate = getTranscriptionSampleRate(call.negotiatedCodec);
        await speechStartTranscription(sipCallId, sampleRate);
        setTranscriptionEnabled(call.id, true);
        setTranscriptOpen(true);
        addNotification({
          type: "success",
          title: "Live Transcription Started",
          description: "Listening for speech on this call.",
          source: "soft-phone",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addNotification({
        type: "error",
        title: "Live Transcription Failed",
        description: msg || "Unable to start live transcription.",
        source: "soft-phone",
      });
    }
    setTranscribeLoading(false);
  }, [call.id, call.negotiatedCodec, setTranscriptionEnabled, sipCallId, transcribing, transcribeLoading, addNotification]);

  const handleJumpToPacket = useCallback((searchKey: string, cseq?: string) => {
    setSelectPacketBySip({ methodOrCode: searchKey, cseq });
    navigateTo("packet-capture", "analysis");
  }, [setSelectPacketBySip]);

  const transcriptLines = call.transcription ?? [];
  const hasTranscript = transcriptLines.length > 0;
  const transcriptionStatusLabel = transcribeLoading
    ? (transcribing ? "Stopping..." : "Starting...")
    : (transcribing ? "Listening live" : "Idle");

  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-transparent to-card/[0.04]">
      {/* ── Header: target + timer + badges ── */}
      <div className="shrink-0 px-5 py-3 border-b border-border/25">
        <div className="flex items-center gap-3">
          <div className="surface-flat h-8 w-8 rounded-lg flex items-center justify-center shrink-0">
            <ArrowRightLeft className={cn("h-4 w-4", call.isInbound ? "rotate-180 text-primary" : "text-muted-foreground")} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate">{call.target}</p>
            <div className="flex items-center gap-2 text-2xs text-muted-foreground/70">
              <span>{call.isInbound ? "Inbound call" : "Outbound call"}</span>
              {call.negotiatedCodec && (
                <>
                  <span className="opacity-50">·</span>
                  <span className="font-medium">{call.negotiatedCodec}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOnHold && <span className={SOFTPHONE.badgeHold}>On Hold</span>}
            {recording && (
              <span className="text-2xs font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/10 text-destructive flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none" />
                REC
              </span>
            )}
            <span className="tabular-nums font-semibold text-xl" key={callTimerTick}>
              {formatCallDuration(call.startTime, call.endTime)}
            </span>
            {displayMetrics && (
              <span className={cn("h-2 w-2 rounded-full shrink-0", mosDotColor(displayMetrics.mos))} />
            )}
          </div>
        </div>
      </div>

      {/* ── Control bar (below header, always visible) ── */}
      <div className="shrink-0 px-5 py-3 border-b border-border/20">
        <div className="flex items-center gap-3">
          <div className="surface-subtle inline-flex items-center gap-1.5 rounded-lg p-1.5">
            <TooltipWrapper content={isMuted ? "Unmute" : "Mute"}>
              <button
                className={cn("h-9 w-9 rounded-md flex items-center justify-center transition-smooth",
                  isMuted ? "bg-destructive/20 text-destructive ring-1 ring-destructive/30" : "hover:bg-accent/80 text-muted-foreground hover:text-foreground")}
                onClick={() => muteCall(call.id, !isMuted)}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </TooltipWrapper>

            <TooltipWrapper content={isOnHold ? "Resume call" : "Put call on hold"}>
              <button
                className={cn("h-9 w-9 rounded-md flex items-center justify-center transition-smooth",
                  isOnHold ? "bg-warning/20 text-warning ring-1 ring-warning/30" : "hover:bg-accent/80 text-muted-foreground hover:text-foreground")}
                onClick={() => holdCall(call.id, !isOnHold)}
              >
                {isOnHold ? <PlayCircle className="h-4 w-4" /> : <Timer className="h-4 w-4" />}
              </button>
            </TooltipWrapper>

            <TooltipWrapper content={recording ? "Stop recording" : "Record"}>
              <button
                className={cn("h-9 w-9 rounded-md flex items-center justify-center transition-smooth",
                  recording ? "bg-destructive/15 text-destructive ring-1 ring-destructive/45 shadow-sm" : "hover:bg-accent/80 text-muted-foreground hover:text-foreground",
                  recLoading && "opacity-50 pointer-events-none")}
                onClick={toggleRecording}
              >
                <Radio className={cn("h-4 w-4", recording && "animate-live-breathe motion-reduce:animate-none drop-shadow-[0_0_10px_hsl(var(--destructive)/0.75)]")} />
              </button>
            </TooltipWrapper>

            <TooltipWrapper content="Park call">
              <button
                className="h-9 w-9 rounded-md hover:bg-accent/80 text-muted-foreground hover:text-foreground flex items-center justify-center transition-smooth"
                onClick={() => parkCall(call.id)}
              >
                <CircleArrowOutDownRight className="h-4 w-4" />
              </button>
            </TooltipWrapper>

            <TooltipWrapper content={transcribing ? "Stop live transcription" : "Start live transcription"}>
              <button
                className={cn("h-9 w-9 rounded-md flex items-center justify-center transition-smooth",
                  transcribing ? "bg-success/20 text-success ring-1 ring-success/30" : "hover:bg-accent/80 text-muted-foreground hover:text-foreground",
                  transcribeLoading && "opacity-50 pointer-events-none")}
                onClick={toggleTranscription}
              >
                <FileText className="h-4 w-4" />
              </button>
            </TooltipWrapper>
          </div>

          <div className="flex-1" />

          {/* Quality strip */}
          {displayMetrics && (
            <div className={cn("surface-subtle flex items-center gap-4 rounded-lg px-3 py-2 transition-smooth", mosBg(displayMetrics.mos))}>
              <QualityPill label="MOS" value={displayMetrics.mos.toFixed(1)} color={mosColor(displayMetrics.mos)} />
              <QualityPill label="Jitter" value={`${Math.round(displayMetrics.jitter_ms)}ms`} color={jitterColor(displayMetrics.jitter_ms)} />
              <QualityPill label="Loss" value={`${displayMetrics.loss_percent.toFixed(1)}%`} color={lossColor(displayMetrics.loss_percent)} />
              {isDegraded && (
                <TroubleshootLink
                  metric={displayMetrics.mos < 3 ? "mos" : displayMetrics.jitter_ms > 50 ? "jitter" : "loss"}
                  value={displayMetrics.mos < 3 ? displayMetrics.mos : displayMetrics.jitter_ms > 50 ? displayMetrics.jitter_ms : displayMetrics.loss_percent}
                  compact
                />
              )}
            </div>
          )}

          <button
            className={cn("h-10 px-4 rounded-lg flex items-center gap-2 text-sm font-semibold transition-smooth", SOFTPHONE.controlRingEnd)}
            onClick={() => endCall(call.id)}
          >
            <PhoneOff className="h-4 w-4" />
            End
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {errorMsg && (
        <div className="shrink-0 px-5 py-2.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1">{errorMsg}</span>
          <TroubleshootLink articleId="one-way-audio" compact />
        </div>
      )}

      {/* ── Main content: visualizer + SIP flow side by side, scrollable ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Visualizer (compact) */}
          {showVisualizer && !isRemoteAgent && (call.state === "active" || call.state === "on-hold" || call.state === "connecting" || call.state === "ringing") && (
            <div className="ui-panel-shell relative rounded-xl">
              <ActiveVisualizer vizId={visualizer as VisualizerId} waveformRef={waveformRef} height={160} />
              <div className="absolute top-2 left-2 flex items-center gap-3 px-2 py-1 rounded-full bg-card/75 border border-border/40 backdrop-blur-sm text-2xs">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" /><span className="text-muted-foreground">You</span></span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#60a5fa]" /><span className="text-muted-foreground">Them</span></span>
              </div>
              <div className="absolute top-2 right-2">
                <Select value={visualizer} onValueChange={(v) => updateSettings({ visualizer: v as VisualizerId })}>
                  <SelectTrigger className="h-6 w-[130px] text-2xs [&>svg]:h-3 [&>svg]:w-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISUALIZER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id} className="text-xs">{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isRemoteAgent && (
            <div className="ui-panel-shell rounded-xl p-6 text-center text-sm text-muted-foreground">
              Remote call via {call.remoteAgentName || "agent"}
            </div>
          )}

          {/* Live SIP Flow (always visible) */}
          <section className="ui-panel-shell rounded-xl">
            <SipFlowTimeline
              call={call}
              isRemoteAgentCall={isRemoteAgent}
              captureSessionId={call.captureSessionId}
              onJumpToPacket={handleJumpToPacket}
            />
          </section>

          {/* Transcription (always visible, live-updating) */}
          <section className="ui-panel-shell rounded-xl overflow-hidden">
            <button
              className="w-full px-3 py-2.5 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
              onClick={() => setTranscriptOpen(!transcriptOpen)}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Transcription</span>
              <span
                className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-2xs font-medium",
                  transcribing ? "bg-success/15 text-success" : "bg-muted/45 text-muted-foreground",
                )}
              >
                {transcriptionStatusLabel}
              </span>
              {transcribing && <span className="h-1.5 w-1.5 rounded-full bg-success animate-live-breathe motion-reduce:animate-none" />}
              {hasTranscript && <span className="text-2xs text-muted-foreground/60">({transcriptLines.length})</span>}
              <div className="flex-1" />
              <button
                className={cn(
                  "px-2 py-0.5 rounded-full text-2xs font-medium transition-smooth",
                  transcribing ? "bg-success/15 text-success" : "bg-muted/40 text-muted-foreground hover:bg-accent/50",
                  transcribeLoading && "opacity-50 pointer-events-none",
                )}
                onClick={(e) => { e.stopPropagation(); toggleTranscription(); }}
              >
                {transcribing ? "Stop" : "Start"}
              </button>
              {transcriptOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {transcriptOpen && (
              <div className="max-h-[220px] overflow-y-auto px-3 pb-3 space-y-1">
                {hasTranscript ? transcriptLines.map((line, i) => (
                  <div key={i} className="text-xs">
                    <span className={cn("font-medium mr-1.5", line.speaker === "local" ? "text-[#34d399]" : "text-[#60a5fa]")}>
                      {line.speaker === "local" ? "You" : "Remote"}:
                    </span>
                    <span className={cn("text-foreground/80", !line.isFinal && "italic text-foreground/50")}>{line.text}</span>
                  </div>
                )) : (
                  <p className="text-xs text-muted-foreground/75 py-1">
                    {transcribing ? "Listening... speak to see live transcript updates." : "Transcription is idle. Press Start to begin."}
                  </p>
                )}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QualityPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-3xs uppercase tracking-wider text-muted-foreground/50">{label}</span>
      <span className={cn("text-xs font-semibold tabular-nums", color)}>{value}</span>
    </div>
  );
}
