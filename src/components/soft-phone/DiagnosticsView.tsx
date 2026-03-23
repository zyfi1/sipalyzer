import { type MutableRefObject, useState, useEffect, useRef, useCallback } from "react";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { buildHtmlTableReport } from "@/lib/exportHtml";
import { navigateTo } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AppDropdown } from "@/components/ui/app-dropdown";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Activity,
  Network,
  Radio,
  Clock,
  CheckCircle,
  PhoneOff,
  PhoneOffIcon,
  ArrowRightLeft,
  FileText,
  Mic,
  MicOff,
  Loader2,
  PlayCircle,
  Timer,
  CircleArrowOutDownRight,
  AlertTriangle,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/dateTime";
import { SOFTPHONE } from "./softphone-constants";
import {
  formatCallDuration,
  formatDurationMs,
} from "./softphone-utils";
import {
  ParticleNebula,
  WaveformRibbon,
  FrequencyAurora,
  HeartbeatEKG,
  TerrainRange,
  BarSpectrum,
  DigitalRain,
  VISUALIZER_OPTIONS,
  type VisualizerId,
} from "./visualizers";
import { SoftphoneSection } from "./SoftphoneSection";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { Call } from "@/lib/softphone";
import {
  startRecording,
  stopRecording,
  isRecording as checkIsRecording,
} from "@/lib/softphone";
import {
  speechModelStatus,
  speechEnsureModel,
  speechStartTranscription,
  speechStopTranscription,
} from "@/api/speech";
import { getTranscriptionSampleRate } from "@/lib/transcription";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SipFlowTimeline } from "./SipFlowTimeline";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";

interface DiagnosticsViewProps {
  selectedCall: Call | undefined;
  displayMetrics: {
    mos: number;
    jitter_ms: number;
    send_peak: number;
    recv_peak: number;
    loss_percent: number;
    lost_packets: number;
  } | null;
  displayMetricsHistory: { t: number; mos: number; jitter_ms: number; loss_percent: number }[];
  metricsApplyToSelected: boolean;
  isShowingSavedMetrics: boolean;
  waveformRef: MutableRefObject<{ send: number[]; recv: number[] }>;
  callTimerTick: number;
  setSelectedCallId: (id: string | null) => void;
}

export function DiagnosticsView({
  selectedCall,
  displayMetrics,
  displayMetricsHistory,
  metricsApplyToSelected,
  isShowingSavedMetrics,
  waveformRef,
  callTimerTick,
  setSelectedCallId,
}: DiagnosticsViewProps) {
  const calls = useSoftphoneStore((s) => s.calls);
  const activeCallId = useSoftphoneStore((s) => s.activeCallId);
  const endCall = useSoftphoneStore((s) => s.endCall);
  const holdCall = useSoftphoneStore((s) => s.holdCall);
  const muteCall = useSoftphoneStore((s) => s.muteCall);
  const parkCall = useSoftphoneStore((s) => s.parkCall);
  const jitterBufferMinMs = useSoftphoneStore((s) => s.jitterBufferMinMs);
  const jitterBufferMaxMs = useSoftphoneStore((s) => s.jitterBufferMaxMs);
  const clearCalls = useSoftphoneStore((s) => s.clearCalls);
  const visualizer = useSoftphoneStore((s) => s.visualizer);
  const showVisualizer = useSoftphoneStore((s) => s.showVisualizer);
  const updateSettings = useSoftphoneStore((s) => s.updateSettings);
  const setSelectPacketBySip = usePacketCaptureStore((s) => s.setSelectPacketBySip);
  const activeCall = calls.find((c) => c.id === activeCallId);
  const isRemoteAgentCall = !!selectedCall?.remoteAgentId;
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const autoRecordEnabled = useSoftphoneStore((s) => s.autoRecordEnabled);

  const [recording, setRecording] = useState(false);
  const [recLoading, setRecLoading] = useState(false);

  useEffect(() => {
    if (!selectedCall?.sipCallId || selectedCall.state === "ended") {
      setRecording(false);
      return;
    }
    const poll = async () => {
      try { setRecording(await checkIsRecording(selectedCall.sipCallId!)); } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [selectedCall?.sipCallId, selectedCall?.state]);

  useEffect(() => {
    if (!autoRecordEnabled || !activeCall?.sipCallId || activeCall.state !== "active") return;
    let cancelled = false;
    (async () => {
      try {
        const already = await checkIsRecording(activeCall.sipCallId!);
        if (!already && !cancelled) {
          await startRecording(activeCall.sipCallId!);
          if (!cancelled) setRecording(true);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [autoRecordEnabled, activeCall?.sipCallId, activeCall?.state]);

  const handleToggleRecording = async () => {
    if (!selectedCall?.sipCallId) return;
    setRecLoading(true);
    try {
      if (recording) {
        await stopRecording(selectedCall.sipCallId);
        setRecording(false);
      } else {
        await startRecording(selectedCall.sipCallId);
        setRecording(true);
      }
    } catch (e) { console.error("Recording toggle failed:", e); }
    finally { setRecLoading(false); }
  };

  // Limit to last 20 calls for the selector
  const selectorCalls = calls.slice(0, 20);

  const onHold = selectedCall?.state === "on-hold";

  const hasRtp =
    selectedCall?.remoteRtpAddress != null &&
    selectedCall?.remoteRtpPort != null &&
    selectedCall?.localRtpPort != null;

  const statusCode = selectedCall?.statusCode ?? 0;
  const rtpScore = displayMetrics
    ? Math.max(0, Math.min(100, Math.round((displayMetrics.mos / 4.5) * 100 - displayMetrics.jitter_ms * 0.4 - (displayMetrics.loss_percent ?? 0) * 2.2)))
    : null;
  const rtpScoreLabel = rtpScore == null ? "—" : rtpScore >= 85 ? "Excellent" : rtpScore >= 70 ? "Good" : rtpScore >= 50 ? "Fair" : "Poor";
  const mosColor =
    displayMetrics?.mos == null
      ? "text-foreground"
      : displayMetrics.mos >= 4.0
        ? "text-success"
        : displayMetrics.mos >= 3.5
          ? "text-success"
          : displayMetrics.mos >= 2.5
            ? "text-warning"
            : "text-destructive";
  const jitterColor =
    displayMetrics?.jitter_ms == null
      ? "text-foreground"
      : displayMetrics.jitter_ms <= 20
        ? "text-success"
        : displayMetrics.jitter_ms <= 50
          ? "text-warning"
          : "text-destructive";
  const lossColor =
    displayMetrics?.loss_percent == null
      ? "text-foreground"
      : displayMetrics.loss_percent < 1
        ? "text-success"
        : displayMetrics.loss_percent <= 3
          ? "text-warning"
          : "text-destructive";
  const rtpScoreColor =
    rtpScore == null
      ? "bg-muted"
      : rtpScore >= 85
        ? "from-success/70 to-success/40"
        : rtpScore >= 70
          ? "from-success/60 to-success/30"
          : rtpScore >= 50
            ? "from-warning/70 to-warning/40"
            : "from-destructive/70 to-destructive/40";

  const sipStepsRaw = [
    { id: "invite", label: "INVITE", active: selectedCall != null },
    { id: "100", label: "100 Trying", active: statusCode >= 100 },
    { id: "180", label: "180/183", active: statusCode === 180 || statusCode === 183 || statusCode >= 200 },
    { id: "200", label: "200 OK", active: statusCode >= 200 && statusCode < 300 },
    { id: "ack", label: "ACK", active: selectedCall?.state === "active" || selectedCall?.state === "on-hold" },
    { id: "rtp", label: "RTP", active: hasRtp },
  ];
  const sipLastActive = sipStepsRaw.map((s) => s.active).lastIndexOf(true);
  const sipSteps = sipStepsRaw.map((step, idx) => ({
    ...step,
    isCurrent: step.active && idx === sipLastActive,
    isCompleted: step.active && idx < sipLastActive,
  }));

  const inCallSteps: { id: string; label: string; active: boolean }[] = [
    { id: "hold", label: "Hold", active: onHold },
    { id: "mute", label: "Mute", active: selectedCall?.muted === true },
    { id: "transfer", label: "Transfer", active: !!selectedCall?.transferredTo },
  ];

  // Shared chart tooltip
  const QualityTooltip = (props: { active?: boolean; payload?: ReadonlyArray<{ value?: number; name?: string }>; label?: string; metricLabel: string; unit: string; format: (v: number) => string }) => {
    const { active, payload, label, metricLabel, unit, format } = props;
    const p0 = payload?.[0];
    if (!active || !payload?.length || p0?.value == null) return null;
    return (
      <div className="ui-floating-surface min-w-[120px] px-3 py-2 text-popover-foreground">
        <div className="text-2xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold">{metricLabel}: {format(p0.value)}{unit}</div>
      </div>
    );
  };

  // ── Call history selector helper ──
  const renderCallSelector = () => {
    if (selectorCalls.length === 0) return null;

    const endedCalls = selectorCalls.filter((c) => c.state === "ended" || c.state === "failed");

    return (
      <div className="ui-panel-shell px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="section-label-sm">
            Call History ({selectorCalls.length})
          </span>
          {endedCalls.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearHistory(true)}
              className="text-2xs font-medium text-muted-foreground hover:text-destructive transition-smooth px-1.5 py-0.5 rounded hover:bg-destructive/5"
            >
              Clear history
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {selectorCalls.map((c) => {
            const isLive = c.state === "active" || c.state === "ringing" || c.state === "on-hold";
            const isSelected = c.id === selectedCall?.id;
            const mosScore = c.savedMetrics?.mos;
            const mosColor = mosScore == null
              ? ""
              : mosScore >= 4.0
                ? "text-success"
                : mosScore >= 2.5
                  ? "text-warning"
                  : "text-destructive";
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCallId(c.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-2xs border transition-smooth",
                  isSelected
                    ? "border-primary/40 bg-primary/10 text-foreground font-medium shadow-sm"
                    : "rounded-md border border-border/40 bg-card/50 text-muted-foreground hover:bg-card/80 hover:text-foreground hover:border-border/50",
                )}
              >
                {isLive && <span className="h-1.5 w-1.5 rounded-full bg-success status-online shrink-0" />}
                {!isLive && c.state === "ended" && <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />}
                {!isLive && c.state === "failed" && <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />}
                <span className="truncate max-w-[100px]">{c.target}</span>
                {c.endTime && c.startTime && (
                  <span className="text-3xs text-muted-foreground/60 tabular-nums">
                    {formatCallDuration(c.startTime, c.endTime)}
                  </span>
                )}
                {mosScore != null && (
                  <span className={cn("text-3xs font-semibold tabular-nums", mosColor)}>
                    {mosScore.toFixed(1)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (!selectedCall) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {renderCallSelector()}
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState
            variant="inline"
            className="min-h-[320px]"
            icon={<Activity />}
            title="No Call Selected"
            description={
              calls.length > 0
                ? "Select a call from the history above to view diagnostics."
                : "Make or receive a call to view SIP signaling, RTP metrics, and call timeline."
            }
          />
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ── Call history selector ── */}
      {renderCallSelector()}

      {/* Header */}
      <div className="ui-panel-shell px-5 py-3 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(SOFTPHONE.callAvatar, "h-9 w-9 shrink-0")}>
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Diagnostics</h2>
              <p className="text-xs text-muted-foreground/80 truncate mt-0.5">{selectedCall.target}</p>
            </div>
            {isShowingSavedMetrics && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-2xs font-medium bg-warning/10 text-warning">
                <Clock className="h-2.5 w-2.5" />
                Saved snapshot
              </span>
            )}
            {recording && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-2xs font-medium bg-destructive/10 text-destructive">
                <span className="h-2 w-2 rounded-full bg-destructive animate-live-breathe motion-reduce:animate-none" />
                Recording
              </span>
            )}
          </div>
          {selectedCall.captureSessionId && (
            <Button
              variant="neutral"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => {
                (window as any).loadCaptureSession?.(selectedCall.captureSessionId);
                navigateTo("packet-capture", "analysis", {
                  packetCaptureSessionId: selectedCall.captureSessionId!,
                });
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Packets
            </Button>
          )}
        </div>

        {/* ── In-call controls (only for live calls) ── */}
        {selectedCall.id === activeCallId && (selectedCall.state === "active" || selectedCall.state === "on-hold" || selectedCall.state === "connecting") && (
          <div className="flex items-center gap-2">
            {/* Hold */}
            <button
              type="button"
              onClick={() => holdCall(selectedCall.id, selectedCall.state !== "on-hold")}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-smooth border",
                selectedCall.state === "on-hold"
                  ? "bg-warning/15 text-warning border-warning/30"
                  : "rounded-md border-border/40 bg-card/50 text-muted-foreground hover:text-foreground hover:bg-card/80",
              )}
            >
              {selectedCall.state === "on-hold" ? <PlayCircle className="h-3 w-3" /> : <Timer className="h-3 w-3" />}
              {selectedCall.state === "on-hold" ? "Resume" : "Hold"}
            </button>
            {/* Mute */}
            <button
              type="button"
              onClick={() => muteCall(selectedCall.id, !selectedCall.muted)}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-smooth border",
                selectedCall.muted
                  ? "bg-warning/15 text-warning border-warning/30"
                  : "rounded-md border-border/40 bg-card/50 text-muted-foreground hover:text-foreground hover:bg-card/80",
              )}
            >
              {selectedCall.muted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
              {selectedCall.muted ? "Unmute" : "Mute"}
            </button>
            {/* Record */}
            <button
              type="button"
              onClick={handleToggleRecording}
              disabled={recLoading}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-smooth border",
                recording
                  ? "bg-destructive/15 text-destructive border-destructive/30"
                  : "rounded-md border-border/40 bg-card/50 text-muted-foreground hover:text-foreground hover:bg-card/80",
              )}
            >
              <Radio className={cn("h-3 w-3", recording && "animate-live-breathe motion-reduce:animate-none")} />
              {recLoading ? "..." : recording ? "Stop Rec" : "Record"}
            </button>
            {/* Park */}
            <button
              type="button"
              onClick={() => parkCall(selectedCall.id)}
              className="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-smooth border border-border/40 bg-card/50 text-muted-foreground hover:text-foreground hover:bg-card/80"
            >
              <CircleArrowOutDownRight className="h-3 w-3" />
              Park
            </button>
            {/* Spacer */}
            <div className="flex-1" />
            {/* End call */}
            <button
              type="button"
              onClick={() => endCall(selectedCall.id)}
              className="h-8 px-4 rounded-lg bg-destructive/15 text-destructive text-xs font-semibold hover:bg-destructive/25 transition-smooth flex items-center gap-1.5"
            >
              <PhoneOff className="h-3 w-3" />
              End Call
            </button>
          </div>
        )}
      </div>

      {/* Content — single scrollable view with all sections */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-5">

          {/* ═══════ SIGNAL FLOW ═══════ */}
          <div className="ui-panel-shell p-4 space-y-4 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Network className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className={cn(SOFTPHONE.sectionTitle)}>Signal flow</span>
              <span className="text-muted-foreground/70 text-xs">·</span>
              <TooltipWrapper content={selectedCall.target}>
                <span className={cn(SOFTPHONE.value, "text-xs truncate")}>{selectedCall.target}</span>
              </TooltipWrapper>
            </div>
            <div className="mb-3">
              <p className="section-label-sm mb-2">Call setup</p>
              <div className="overflow-x-auto pb-2 -mx-1 scrollbar-thin">
                <div className="flex items-center gap-0 flex-nowrap min-w-0 min-h-[40px]">
                  {sipSteps.map((step, idx) => (
                    <div key={step.id} className="flex items-center shrink-0">
                      <TooltipWrapper content={step.active ? (step.isCurrent ? "Current step" : "Completed") : "Pending"}>
                      <div
                        className={cn(
                          "signal-flow-step h-8 min-w-[72px] px-3 rounded-lg border text-2xs font-semibold flex items-center justify-center",
                          step.active && "signal-flow-step-active",
                          step.isCurrent && "signal-flow-step-current",
                          step.active
                            ? step.isCurrent
                              ? "border-foreground/30 bg-muted/40 text-foreground shadow-sm"
                              : "border-foreground/20 bg-accent text-foreground"
                            : "border-border/50 bg-muted/30 text-muted-foreground"
                        )}
                      >
                        {step.label}
                      </div>
                    </TooltipWrapper>
                      {idx < sipSteps.length - 1 && (
                        <div
                          className={cn(
                            "signal-flow-connector h-0.5 w-5 sm:w-6 shrink-0 mx-0.5 rounded-full",
                            sipSteps[idx + 1]?.active ? "signal-flow-connector-filled bg-foreground/30" : "bg-border/80"
                          )}
                          style={{ transformOrigin: "left center" }}
                          aria-hidden
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <p className="section-label-sm mb-2">In-call</p>
              <div className="flex flex-wrap items-center gap-2">
                {inCallSteps.map((step) => (
                  <TooltipWrapper key={step.id} content={step.active ? "Active" : "Inactive"}>
                    <div
                      className={cn(
                        "signal-flow-step h-8 min-w-[72px] px-3 rounded-lg border text-2xs font-semibold flex items-center justify-center",
                        step.active && "signal-flow-step-active",
                        step.active
                          ? "border-foreground/20 bg-accent text-foreground"
                          : "border-border/50 bg-muted/30 text-muted-foreground"
                      )}
                    >
                      {step.label}
                    </div>
                  </TooltipWrapper>
                ))}
              </div>
            </div>
          </div>

          {/* ═══════ QUALITY ALERT BANNER ═══════ */}
          {displayMetrics && (
            displayMetrics.mos < 3.0 && displayMetrics.mos > 0
              || displayMetrics.jitter_ms > 50
              || displayMetrics.loss_percent > 3
          ) && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-xs font-medium text-destructive">
                Call quality degraded
                {displayMetrics.mos < 3.0 && displayMetrics.mos > 0 && ` — MOS ${displayMetrics.mos.toFixed(1)}`}
                {displayMetrics.jitter_ms > 50 && ` — Jitter ${displayMetrics.jitter_ms.toFixed(0)}ms`}
                {displayMetrics.loss_percent > 3 && ` — Loss ${displayMetrics.loss_percent.toFixed(1)}%`}
              </span>
            </div>
          )}

          {/* ═══════ QUALITY METRICS ═══════ */}
          <div className="grid grid-cols-3 gap-3">
            <div className={SOFTPHONE.metricCard}>
              <div className={SOFTPHONE.metricLabel}>MOS Score</div>
              <div className={cn(
                SOFTPHONE.metricValue,
                displayMetrics?.mos != null && displayMetrics.mos >= 4.0 && SOFTPHONE.metricGood,
                displayMetrics?.mos != null && displayMetrics.mos >= 3.0 && displayMetrics.mos < 4.0 && SOFTPHONE.metricWarning,
                displayMetrics?.mos != null && displayMetrics.mos < 3.0 && SOFTPHONE.metricBad,
              )}>
                <span className="inline-flex items-center gap-1">
                  {displayMetrics?.mos != null ? displayMetrics.mos.toFixed(1) : "—"}
                  {displayMetrics?.mos != null && <TroubleshootLink metric="mos" value={displayMetrics.mos} compact />}
                </span>
              </div>
            </div>
            <div className={SOFTPHONE.metricCard}>
              <div className={SOFTPHONE.metricLabel}>Jitter</div>
              <div className={cn(
                SOFTPHONE.metricValue,
                displayMetrics?.jitter_ms != null && displayMetrics.jitter_ms <= 20 && SOFTPHONE.metricGood,
                displayMetrics?.jitter_ms != null && displayMetrics.jitter_ms > 20 && displayMetrics.jitter_ms <= 50 && SOFTPHONE.metricWarning,
                displayMetrics?.jitter_ms != null && displayMetrics.jitter_ms > 50 && SOFTPHONE.metricBad,
              )}>
                <span className="inline-flex items-center gap-1">
                  {displayMetrics?.jitter_ms != null ? `${displayMetrics.jitter_ms.toFixed(0)}ms` : "—"}
                  {displayMetrics?.jitter_ms != null && <TroubleshootLink metric="jitter" value={displayMetrics.jitter_ms} compact />}
                </span>
              </div>
            </div>
            <div className={SOFTPHONE.metricCard}>
              <div className={SOFTPHONE.metricLabel}>Loss</div>
              <div className={cn(
                SOFTPHONE.metricValue,
                displayMetrics?.loss_percent != null && displayMetrics.loss_percent <= 1 && SOFTPHONE.metricGood,
                displayMetrics?.loss_percent != null && displayMetrics.loss_percent > 1 && displayMetrics.loss_percent <= 3 && SOFTPHONE.metricWarning,
                displayMetrics?.loss_percent != null && displayMetrics.loss_percent > 3 && SOFTPHONE.metricBad,
              )}>
                <span className="inline-flex items-center gap-1">
                  {displayMetrics?.loss_percent != null ? `${displayMetrics.loss_percent.toFixed(1)}%` : "—"}
                  {displayMetrics?.loss_percent != null && <TroubleshootLink metric="loss" value={displayMetrics.loss_percent} compact />}
                </span>
              </div>
            </div>
          </div>

          {/* ═══════ RTP STATS EXPORT ═══════ */}
          {(displayMetrics || displayMetricsHistory.length > 0) && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-2xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border/40 bg-card/50 hover:bg-accent/40 transition-smooth"
                onClick={() => {
                  const rows = displayMetricsHistory.map((p) => ({
                    timestamp: new Date(p.t * 1000).toISOString(),
                    mos: +p.mos.toFixed(2),
                    jitter_ms: +p.jitter_ms.toFixed(1),
                    loss_percent: +p.loss_percent.toFixed(2),
                  }));
                  if (displayMetrics && rows.length === 0) {
                    rows.push({
                      timestamp: new Date().toISOString(),
                      mos: +displayMetrics.mos.toFixed(2),
                      jitter_ms: +displayMetrics.jitter_ms.toFixed(1),
                      loss_percent: +displayMetrics.loss_percent.toFixed(2),
                    });
                  }
                  const json = JSON.stringify({ call_id: selectedCall?.sipCallId, codec: selectedCall?.negotiatedCodec, samples: rows }, null, 2);
                  saveExportFile(`rtp-stats-${selectedCall?.sipCallId?.slice(0, 8) ?? "call"}.json`, textToBase64(json), "JSON files", "json").catch(() => {});
                }}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="text-2xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border/40 bg-card/50 hover:bg-accent/40 transition-smooth"
                onClick={() => {
                  const rows = displayMetricsHistory.map((p) =>
                    `${new Date(p.t * 1000).toISOString()},${p.mos.toFixed(2)},${p.jitter_ms.toFixed(1)},${p.loss_percent.toFixed(2)}`
                  );
                  if (displayMetrics && rows.length === 0) {
                    rows.push(`${new Date().toISOString()},${displayMetrics.mos.toFixed(2)},${displayMetrics.jitter_ms.toFixed(1)},${displayMetrics.loss_percent.toFixed(2)}`);
                  }
                  const csv = ["timestamp,mos,jitter_ms,loss_percent", ...rows].join("\n");
                  saveExportFile(`rtp-stats-${selectedCall?.sipCallId?.slice(0, 8) ?? "call"}.csv`, textToBase64(csv), "CSV files", "csv").catch(() => {});
                }}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="text-2xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border/40 bg-card/50 hover:bg-accent/40 transition-smooth"
                onClick={() => {
                  const rows = displayMetricsHistory.map((p) => ({
                    timestamp: new Date(p.t * 1000).toISOString(),
                    mos: +p.mos.toFixed(2),
                    jitter_ms: +p.jitter_ms.toFixed(1),
                    loss_percent: +p.loss_percent.toFixed(2),
                  }));
                  if (displayMetrics && rows.length === 0) {
                    rows.push({
                      timestamp: new Date().toISOString(),
                      mos: +displayMetrics.mos.toFixed(2),
                      jitter_ms: +displayMetrics.jitter_ms.toFixed(1),
                      loss_percent: +displayMetrics.loss_percent.toFixed(2),
                    });
                  }
                  const html = buildHtmlTableReport({
                    title: "Softphone RTP Diagnostics",
                    subtitle: `Call ${selectedCall?.sipCallId ?? "unknown"} · Codec ${selectedCall?.negotiatedCodec ?? "unknown"}`,
                    columns: [
                      { key: "timestamp", label: "Timestamp" },
                      { key: "mos", label: "MOS", align: "right" },
                      { key: "jitter_ms", label: "Jitter (ms)", align: "right" },
                      { key: "loss_percent", label: "Loss (%)", align: "right" },
                    ],
                    rows,
                  });
                  saveExportFile(`rtp-stats-${selectedCall?.sipCallId?.slice(0, 8) ?? "call"}.html`, textToBase64(html), "HTML files", "html").catch(() => {});
                }}
              >
                Export HTML
              </button>
            </div>
          )}

          {/* Codec & RTP Info */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground/80 px-1">
            <span className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">{selectedCall.negotiatedCodec ?? "—"}</span>
              codec
            </span>
            <span className="opacity-30">|</span>
            <span>
              RTP {selectedCall.localRtpPort ?? "—"} ↔ {selectedCall.remoteRtpAddress && selectedCall.remoteRtpPort ? `${selectedCall.remoteRtpAddress}:${selectedCall.remoteRtpPort}` : "—"}
            </span>
          </div>

          {selectedCall.errorMessage && (
            <div className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
              <span className="flex-1">{selectedCall.errorMessage}</span>
              <TroubleshootLink articleId="one-way-audio" compact />
            </div>
          )}
          {selectedCall.audioError && (
            <div className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
              <span className="flex-1">Audio: {selectedCall.audioError}</span>
              <TroubleshootLink articleId="one-way-audio" compact />
            </div>
          )}

          {/* ═══════ LIVE AUDIO ═══════ */}
          {showVisualizer && activeCall && !activeCall.remoteAgentId && (activeCall.state === "active" || activeCall.state === "on-hold") && (
            <SoftphoneSection title="Live audio" icon={Radio}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" aria-hidden /> You</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> Them</span>
                </span>
                <VisualizerPicker value={visualizer} onChange={(v) => updateSettings({ visualizer: v })} />
              </div>
              <ActiveVisualizer vizId={visualizer} waveformRef={waveformRef} />
            </SoftphoneSection>
          )}

          {/* ═══════ LIVE TRANSCRIPTION ═══════ */}
          <TranscriptionSection call={selectedCall} />

          {/* ═══════ RTP QUALITY CHARTS ═══════ */}
          <section className="ui-panel-shell p-4 space-y-4">
            <div className={cn(SOFTPHONE.sectionTitle, "flex items-center gap-2")}>
              <Activity className="h-4 w-4 text-muted-foreground" />
              {isShowingSavedMetrics ? "Final metrics" : "RTP & quality"}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] gap-4">
              <div className="flex flex-col items-center gap-2">
                <div className={cn("h-24 w-24 rounded-full bg-gradient-to-br p-1 shadow-sm", rtpScoreColor)}>
                  <div className="h-full w-full rounded-full bg-background/80 flex flex-col items-center justify-center">
                    <span className={cn("text-xl font-semibold tabular-nums", rtpScore == null ? "text-foreground" : rtpScore >= 85 ? "text-success" : rtpScore >= 70 ? "text-success" : rtpScore >= 50 ? "text-warning" : "text-destructive")}>{rtpScore ?? "—"}</span>
                    <span className={cn("text-2xs uppercase font-medium", rtpScore == null ? "text-muted-foreground" : rtpScore >= 85 ? "text-success/80" : rtpScore >= 70 ? "text-success/80" : rtpScore >= 50 ? "text-warning/80" : "text-destructive/80")}>{rtpScoreLabel}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs text-muted-foreground text-center">
                  <div><div className="uppercase">MOS</div><div className={cn("font-medium tabular-nums", mosColor)}>{displayMetrics?.mos != null ? displayMetrics.mos.toFixed(1) : "—"}</div></div>
                  <div><div className="uppercase">Jitter</div><div className={cn("font-medium tabular-nums", jitterColor)}>{displayMetrics?.jitter_ms != null ? `${displayMetrics.jitter_ms.toFixed(0)} ms` : "—"}</div></div>
                  <div><div className="uppercase">Loss</div><div className={cn("font-medium tabular-nums", lossColor)}>{displayMetrics?.loss_percent != null ? `${displayMetrics.loss_percent.toFixed(2)}%` : "—"}</div></div>
                  <div><div className="uppercase">Send</div><div className="text-foreground font-medium tabular-nums">{displayMetrics?.send_peak != null ? `${Math.round(displayMetrics.send_peak * 100)}%` : "—"}</div></div>
                </div>
                {displayMetrics?.loss_percent != null && (
                  <div className="w-full">
                    <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                      <div className={cn("h-full transition-smooth", displayMetrics.loss_percent < 1 ? "bg-success" : displayMetrics.loss_percent < 3 ? "bg-warning" : "bg-destructive")} style={{ width: `${Math.min(100, displayMetrics.loss_percent * 2)}%` }} />
                    </div>
                    <div className="text-2xs text-muted-foreground mt-0.5">Packet loss</div>
                  </div>
                )}
              </div>
              {displayMetricsHistory.length >= 1 && (() => {
                const chartData = displayMetricsHistory.map((p) => ({ time: formatTime(new Date(p.t * 1000).toISOString()), mos: p.mos, jitter_ms: p.jitter_ms, loss_percent: p.loss_percent }));
                const avgMos = chartData.length > 0 ? chartData.reduce((s, d) => s + d.mos, 0) / chartData.length : displayMetrics?.mos ?? 0;
                const mosChartColor = avgMos >= 4.0 ? "hsl(var(--success))" : avgMos >= 2.5 ? "hsl(var(--warning))" : avgMos > 0 ? "hsl(var(--destructive))" : "hsl(var(--foreground))";
                const maxJitter = Math.max(1, ...displayMetricsHistory.map((p) => p.jitter_ms));
                const maxLoss = Math.max(0.5, ...displayMetricsHistory.map((p) => p.loss_percent));
                const chartMargin = { top: 4, right: 8, left: 4, bottom: 16 };
                const xAxisHide = { dataKey: "time" as const, tick: false, axisLine: false, height: 4 };
                return (
                  <div className="space-y-3">
                    <div className="text-2xs font-medium text-muted-foreground">Quality over time</div>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="h-16"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={chartMargin}><defs><linearGradient id="mosGradientSp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={mosChartColor} stopOpacity={0.4} /><stop offset="100%" stopColor={mosChartColor} stopOpacity={0.05} /></linearGradient></defs><CartesianGrid strokeDasharray="2 2" className="stroke-muted/30" vertical={false} /><XAxis {...xAxisHide} /><YAxis domain={[1, 4.5]} width={24} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} /><Tooltip content={(p) => <QualityTooltip active={p.active} payload={p.payload} label={p.label != null ? String(p.label) : undefined} metricLabel="MOS" unit="" format={(v) => v.toFixed(1)} />} /><Area type="monotone" dataKey="mos" stroke={mosChartColor} strokeWidth={2} fill="url(#mosGradientSp)" /></AreaChart></ResponsiveContainer></div>
                      <div className="h-16"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={chartMargin}><defs><linearGradient id="jitterGradientSp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.4} /><stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.05} /></linearGradient></defs><CartesianGrid strokeDasharray="2 2" className="stroke-muted/30" vertical={false} /><XAxis {...xAxisHide} /><YAxis domain={[0, maxJitter]} width={28} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} tickFormatter={(v) => `${Number(v)}`} /><Tooltip content={(p) => <QualityTooltip active={p.active} payload={p.payload} label={p.label != null ? String(p.label) : undefined} metricLabel="Jitter" unit=" ms" format={(v) => v.toFixed(0)} />} /><Area type="monotone" dataKey="jitter_ms" stroke="#0ea5e9" strokeWidth={2} fill="url(#jitterGradientSp)" /></AreaChart></ResponsiveContainer></div>
                      <div className="h-16"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={chartMargin}><defs><linearGradient id="lossGradientSp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.4} /><stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.05} /></linearGradient></defs><CartesianGrid strokeDasharray="2 2" className="stroke-muted/30" vertical={false} /><XAxis dataKey="time" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" axisLine={false} tickLine={false} /><YAxis domain={[0, maxLoss]} width={28} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} tickFormatter={(v) => `${Number(v)}%`} /><Tooltip content={(p) => <QualityTooltip active={p.active} payload={p.payload} label={p.label != null ? String(p.label) : undefined} metricLabel="Loss" unit="%" format={(v) => v.toFixed(2)} />} /><Area type="monotone" dataKey="loss_percent" stroke="hsl(var(--destructive))" strokeWidth={2} fill="url(#lossGradientSp)" /></AreaChart></ResponsiveContainer></div>
                    </div>
                  </div>
                );
              })()}
            </div>
            {!displayMetrics && (
              <p className="text-xs text-muted-foreground">
                {selectedCall?.remoteAgentId
                  ? "Waiting for RTP metrics from remote agent…"
                  : metricsApplyToSelected ? "No live metrics yet." : "Select the active call for live RTP metrics."}
              </p>
            )}
          </section>

          {/* ═══════ RTP & CODEC DETAIL ═══════ */}
          <SoftphoneSection title="RTP & codec">
            <div className="flex flex-wrap gap-2 text-xs">
              {isRemoteAgentCall ? (
                <>
                  <span className={SOFTPHONE.chip}>PCMU/8000 (via {selectedCall.remoteAgentName ?? "agent"})</span>
                  <span className={SOFTPHONE.chip}>{selectedCall.state === "active" || selectedCall.state === "on-hold" ? "RTP active" : hasRtp ? "RTP up" : "—"}</span>
                </>
              ) : (
                <>
                  <span className={SOFTPHONE.chip}>Local {selectedCall.localRtpPort ?? "—"}</span>
                  <span className={SOFTPHONE.chip}>Remote {selectedCall.remoteRtpAddress && selectedCall.remoteRtpPort ? `${selectedCall.remoteRtpAddress}:${selectedCall.remoteRtpPort}` : "—"}</span>
                  <span className={SOFTPHONE.chip}>{selectedCall.negotiatedCodec ?? "—"} {selectedCall.negotiatedPt != null ? `(${selectedCall.negotiatedPt})` : ""}</span>
                  <span className={SOFTPHONE.chip}>Jitter buf {jitterBufferMinMs}-{jitterBufferMaxMs} ms</span>
                  <span className={SOFTPHONE.chip}>{hasRtp ? "RTP up" : "No RTP"}</span>
                </>
              )}
            </div>
          </SoftphoneSection>

          {/* ═══════ TIMELINE ═══════ */}
          <SoftphoneSection title="Timeline" icon={Clock}>
            <div className="flex items-center justify-between gap-3" key={`overview-timer-${callTimerTick}`}>
              <div />
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold tabular-nums text-foreground" aria-live="polite">{formatCallDuration(selectedCall.startTime, selectedCall.endTime)}</span>
                {!selectedCall.endTime && (selectedCall.state === "active" || selectedCall.state === "on-hold") && (
                  <span className="section-label-sm text-success">Live</span>
                )}
              </div>
            </div>
            {(() => {
              const startMs = selectedCall.startTime ? new Date(selectedCall.startTime).getTime() : 0;
              const endMs = selectedCall.endTime ? new Date(selectedCall.endTime).getTime() : Date.now();
              const totalMs = Math.max(0, endMs - startMs);
              const responseMs = selectedCall.responseTimeMs ?? 0;
              const holdEvs = selectedCall.holdEvents ?? [];
              const muteEvs = selectedCall.muteEvents ?? [];
              type SegKind = "answer" | "talk" | "hold" | "mute";
              type MergeEv = { at: string; type: "hold" | "resume" | "mute" | "unmute" };
              const merged: MergeEv[] = [
                ...holdEvs.map((e) => ({ at: e.at, type: e.type as "hold" | "resume" })),
                ...muteEvs.map((e) => ({ at: e.at, type: e.type as "mute" | "unmute" })),
              ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

              const segments: { fromMs: number; toMs: number; fromPct: number; toPct: number; kind: SegKind }[] = [];
              if (totalMs > 0) {
                const responsePct = responseMs >= 0 ? Math.min(100, (responseMs / totalMs) * 100) : 0;
                segments.push({ fromMs: 0, toMs: responseMs, fromPct: 0, toPct: responsePct, kind: "answer" });
                let currentMs = responseMs;
                let holdState = false;
                let muteState = false;
                for (const ev of merged) {
                  const evMs = new Date(ev.at).getTime() - startMs;
                  if (evMs > currentMs && evMs <= totalMs) {
                    const kind: SegKind = holdState ? "hold" : muteState ? "mute" : "talk";
                    segments.push({ fromMs: currentMs, toMs: evMs, fromPct: (currentMs / totalMs) * 100, toPct: (evMs / totalMs) * 100, kind });
                    currentMs = evMs;
                  }
                  if (ev.type === "hold") holdState = true;
                  else if (ev.type === "resume") holdState = false;
                  else if (ev.type === "mute") muteState = true;
                  else if (ev.type === "unmute") muteState = false;
                }
                const kind: SegKind = holdState ? "hold" : muteState ? "mute" : "talk";
                if (currentMs < totalMs) {
                  segments.push({ fromMs: currentMs, toMs: totalMs, fromPct: (currentMs / totalMs) * 100, toPct: 100, kind });
                }
              }
              const segmentColors: Record<SegKind, string> = { answer: "bg-warning/70", talk: "bg-success/70", hold: "bg-muted", mute: "bg-foreground/30" };
              const segmentLabels: Record<SegKind, string> = { answer: "To answer", talk: "Talk", hold: "On hold", mute: "Muted" };
              const startIso = selectedCall.startTime;
              return (
                <div className="space-y-4">
                  <div className="h-3 w-full rounded-full bg-muted/50 overflow-hidden flex">
                    {segments.length > 0 ? (
                      segments.map((seg, i) => {
                        const fromTime = startIso ? new Date(startMs + seg.fromMs).toISOString() : undefined;
                        const toTime = startIso ? new Date(startMs + seg.toMs).toISOString() : undefined;
                        const duration = formatDurationMs(seg.toMs - seg.fromMs);
                        const segTitle = segmentLabels[seg.kind];
                        const segDesc = `${formatTime(fromTime)} → ${formatTime(toTime)}. Duration: ${duration}`;
                        return (
                          <TooltipWrapper key={i} title={segTitle} description={segDesc} delayDuration={200}>
                            <div
                              className={cn("h-full transition-smooth cursor-default", segmentColors[seg.kind], i === 0 && "rounded-l-full", i === segments.length - 1 && "rounded-r-full")}
                              style={{ width: `${seg.toPct - seg.fromPct}%` }}
                            />
                          </TooltipWrapper>
                        );
                      })
                    ) : (
                      <>
                        <TooltipWrapper title="To answer" description="Time until remote answered">
                          <div className="h-full rounded-l-full bg-warning/70" style={{ width: `${Math.min(100, totalMs > 0 ? (responseMs / totalMs) * 100 : 0)}%` }} />
                        </TooltipWrapper>
                        <TooltipWrapper title="Talk time" description="Active conversation (not on hold, not muted)">
                          <div className="h-full flex-1 rounded-r-full bg-success/70" />
                        </TooltipWrapper>
                      </>
                    )}
                  </div>
                  <div className={cn("grid gap-4 text-xs", selectedCall.transferredTo ? "grid-cols-4" : "grid-cols-3")}>
                    <TooltipWrapper title="Started" description={`Call start time (local). ${formatTime(selectedCall.startTime)}`}>
                      <div className={cn(SOFTPHONE.chip, "flex items-center gap-2 p-3")}>
                        <div className="rounded-full bg-muted/50 p-1.5"><Clock className="h-3.5 w-3.5 text-muted-foreground" /></div>
                        <div>
                          <div className="section-label">Started</div>
                          <div className={cn(SOFTPHONE.value, "mt-0.5")}>{formatTime(selectedCall.startTime)}</div>
                        </div>
                      </div>
                    </TooltipWrapper>
                    <TooltipWrapper title="Response" description={`Time from INVITE sent until 200 OK received. ${selectedCall.responseTimeMs != null && selectedCall.responseTimeMs > 0 ? `${selectedCall.responseTimeMs} ms` : "—"}`}>
                      <div className={cn(SOFTPHONE.chip, "flex items-center gap-2 p-3")}>
                        <div className="rounded-full bg-muted/50 p-1.5"><CheckCircle className="h-3.5 w-3.5 text-muted-foreground" /></div>
                        <div>
                          <div className="section-label">Response</div>
                          <div className={cn(SOFTPHONE.value, "mt-0.5")}>{selectedCall.responseTimeMs != null && selectedCall.responseTimeMs > 0 ? `${selectedCall.responseTimeMs} ms` : "—"}</div>
                        </div>
                      </div>
                    </TooltipWrapper>
                    <TooltipWrapper title="Ended" description={`Call end time (local). ${formatTime(selectedCall.endTime)}`}>
                      <div className={cn(SOFTPHONE.chip, "flex items-center gap-2 p-3")}>
                        <div className="rounded-full bg-muted/50 p-1.5"><PhoneOffIcon className="h-3.5 w-3.5 text-muted-foreground" /></div>
                        <div>
                          <div className="section-label">Ended</div>
                          <div className={cn(SOFTPHONE.value, "mt-0.5")}>{formatTime(selectedCall.endTime)}</div>
                        </div>
                      </div>
                    </TooltipWrapper>
                    {selectedCall.transferredTo && (
                      <TooltipWrapper title="Transferred to" description={`Call was transferred by re-INVITE to ${selectedCall.transferredTo}.`}>
                        <div className={cn(SOFTPHONE.chip, "flex items-center gap-2 p-3")}>
                          <div className="rounded-full bg-muted/50 p-1.5"><ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" /></div>
                          <div>
                            <div className="section-label">Transferred to</div>
                            <TooltipWrapper content={selectedCall.transferredTo}>
                              <div className={cn(SOFTPHONE.value, "mt-0.5 truncate")}>{selectedCall.transferredTo}</div>
                            </TooltipWrapper>
                          </div>
                        </div>
                      </TooltipWrapper>
                    )}
                  </div>
                </div>
              );
            })()}
          </SoftphoneSection>

          {/* ═══════ UNIFIED SIP FLOW ═══════ */}
          <section className="ui-panel-shell p-4 space-y-4">
            <SipFlowTimeline
              call={selectedCall}
              isRemoteAgentCall={isRemoteAgentCall}
              captureSessionId={selectedCall?.captureSessionId}
              onJumpToPacket={(searchKey, cseq) => {
                if (selectedCall?.captureSessionId) {
                  setSelectPacketBySip({ methodOrCode: searchKey, cseq });
                  navigateTo("packet-capture", "analysis", {
                    packetCaptureSessionId: selectedCall.captureSessionId,
                  });
                }
              }}
            />
          </section>

        </div>
      </div>
    </div>

    <ConfirmDialog
      open={confirmClearHistory}
      onOpenChange={setConfirmClearHistory}
      title="Clear call history?"
      description="Remove all calls from the diagnostics history? This cannot be undone."
      confirmText="Clear All"
      cancelText="Cancel"
      variant="destructive"
      onConfirm={() => { clearCalls(); setConfirmClearHistory(false); }}
    />
    </>
  );
}

/* ── Visualizer picker (compact dropdown) ── */
function VisualizerPicker({
  value,
  onChange,
}: {
  value: VisualizerId;
  onChange: (v: VisualizerId) => void;
}) {
  return (
    <AppDropdown
      value={value}
      onValueChange={(v) => onChange(v as VisualizerId)}
      size="sm"
      className="h-6 min-h-6 w-[140px] px-2 text-2xs font-medium [&>svg]:h-3 [&>svg]:w-3"
      contentAlign="end"
      options={VISUALIZER_OPTIONS.map((opt) => ({
        value: opt.id,
        label: opt.label,
        itemClassName: "text-xs",
      }))}
    />
  );
}

/* ── Active visualizer renderer ── */
function ActiveVisualizer({
  vizId,
  waveformRef,
}: {
  vizId: VisualizerId;
  waveformRef: React.MutableRefObject<{ send: number[]; recv: number[] }>;
}) {
  const sharedProps = {
    waveformRef,
    className: "w-full rounded-lg ui-panel-shell",
    style: { height: 220, minHeight: 220 },
  };

  switch (vizId) {
    case "ribbon":
      return <WaveformRibbon {...sharedProps} />;
    case "aurora":
      return <FrequencyAurora {...sharedProps} />;
    case "ekg":
      return <HeartbeatEKG {...sharedProps} />;
    case "terrain":
      return <TerrainRange {...sharedProps} />;
    case "bars":
      return <BarSpectrum {...sharedProps} />;
    case "rain":
      return <DigitalRain {...sharedProps} />;
    case "nebula":
    default:
      return <ParticleNebula {...sharedProps} />;
  }
}

/* ── TranscriptionSection ── */
function TranscriptionSection({ call }: { call: Call | undefined }) {
  const setTranscriptionEnabled = useSoftphoneStore((s) => s.setTranscriptionEnabled);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [modelLoading, setModelLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isActive = call?.state === "active" || call?.state === "on-hold";
  const transcriptLines = call?.transcription ?? [];
  const finalLines = transcriptLines.filter((l) => l.isFinal);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptLines.length]);

  const handleToggle = useCallback(async () => {
    if (!call?.sipCallId) return;
    if (call.transcriptionEnabled) {
      try { await speechStopTranscription(call.sipCallId); } catch { /* ignore */ }
      setTranscriptionEnabled(call.id, false);
      addNotification({
        type: "info",
        title: "Live Transcription Stopped",
        description: "Speech-to-text is no longer listening.",
        source: "soft-phone",
      });
    } else {
      setModelLoading(true);
      try {
        const status = await speechModelStatus();
        if (!status.downloaded) await speechEnsureModel();
        const sr = getTranscriptionSampleRate(call.negotiatedCodec);
        await speechStartTranscription(call.sipCallId, sr);
        setTranscriptionEnabled(call.id, true);
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
        setModelLoading(false);
      }
    }
  }, [call?.sipCallId, call?.id, call?.transcriptionEnabled, call?.negotiatedCodec, setTranscriptionEnabled, addNotification]);

  if (!call) return null;

  // For ended calls — only show if there's transcription data
  if (!isActive && finalLines.length === 0) return null;

  const lines = isActive ? transcriptLines : finalLines;

  return (
    <SoftphoneSection title="Transcription" icon={FileText}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {call.transcriptionEnabled && (
            <span className="h-1.5 w-1.5 rounded-full bg-success status-online" />
          )}
          <span className="text-2xs text-muted-foreground/60">
            {isActive
              ? call.transcriptionEnabled ? "Listening..." : "Speech-to-text"
              : `${finalLines.length} line${finalLines.length !== 1 ? "s" : ""}`
            }
          </span>
        </div>
        {isActive && (
          <button
            type="button"
            onClick={handleToggle}
            disabled={modelLoading}
            className={cn(
              "px-2.5 py-1 rounded-lg text-2xs font-medium transition-smooth",
              call.transcriptionEnabled
                ? "bg-success/15 text-success hover:bg-destructive/15 hover:text-destructive"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              modelLoading && "opacity-50 cursor-wait",
            )}
          >
            {modelLoading ? (
              <span className="flex items-center gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" />Loading...</span>
            ) : call.transcriptionEnabled ? "ON" : "OFF"}
          </button>
        )}
      </div>

      {lines.length > 0 ? (
        <div className="max-h-56 overflow-y-auto rounded-lg bg-background/40 px-3 py-2 space-y-1.5">
          {lines.map((line, i) => (
            <div key={`${line.timestamp}-${i}`} className="flex gap-2.5 text-xs leading-snug">
              <span className={cn(
                "shrink-0 section-label-sm mt-0.5 w-12",
                line.speaker === "local" ? "text-primary" : "text-success",
              )}>
                {line.speaker === "local" ? "You" : "Remote"}
              </span>
              <span className={cn("text-foreground/90", !line.isFinal && "italic text-muted-foreground/60")}>
                {line.text}
              </span>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
      ) : isActive && call.transcriptionEnabled ? (
        <p className="text-2xs text-muted-foreground/60 text-center py-3 italic">
          Listening for speech...
        </p>
      ) : null}
    </SoftphoneSection>
  );
}

