/**
 * Active call card showing live call status and metrics.
 * Displays target, state, duration, and real-time quality metrics.
 */

import { useState, useEffect, useRef } from "react";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useToolVisible } from "@/hooks/useToolVisible";
import { getCallMetrics } from "@/lib/softphone";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PhoneCall, PhoneOff, Timer, PlayCircle, Mic, MicOff, ExternalLink } from "@/lib/icons";
import { navigateTo } from "@/lib/navigation";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { Call } from "@/lib/softphone";
import {
  ACTIVITY_CARD_ACTIONS_CLASS,
  ACTIVITY_CARD_BODY_CLASS,
  ACTIVITY_CARD_CLASS,
  ACTIVITY_CARD_CONTENT_CLASS,
  ACTIVITY_CARD_HEADER_CLASS,
  ACTIVITY_CARD_ICON_PING_CLASS,
  ACTIVITY_CARD_ICON_SHELL_CLASS,
  ACTIVITY_CARD_STATS_ROW_CLASS,
  ACTIVITY_CARD_STATUS_LABEL_CLASS,
} from "./activityCardShell";

interface ActiveCallCardProps {
  call: Call;
  onNavigate: () => void;
}

interface LiveMetrics {
  mos: number;
  jitter_ms: number;
  loss_percent: number;
}

function formatDuration(startTime: string): string {
  const start = new Date(startTime).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - start) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function getStateLabel(state: Call["state"]): string {
  switch (state) {
    case "connecting": return "Connecting...";
    case "ringing": return "Ringing...";
    case "active": return "In call";
    case "on-hold": return "On hold";
    case "ended": return "Ended";
    case "failed": return "Failed";
    default: return state;
  }
}

function getStateColor(state: Call["state"]): string {
  switch (state) {
    case "active": return "text-success";
    case "ringing": return "text-warning";
    case "on-hold": return "text-muted-foreground";
    case "failed": return "text-destructive";
    default: return "text-foreground";
  }
}

export function ActiveCallCard({ call, onNavigate }: ActiveCallCardProps) {
  const endCall = useSoftphoneStore((s) => s.endCall);
  const holdCall = useSoftphoneStore((s) => s.holdCall);
  const muteCall = useSoftphoneStore((s) => s.muteCall);
  const isVisible = useToolVisible("troubleshooting");
  
  const [duration, setDuration] = useState(() => formatDuration(call.startTime));
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [ending, setEnding] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update duration every second only when visible
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      setDuration(formatDuration(call.startTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [call.startTime, isVisible]);

  // Poll metrics every 2 seconds for active calls only when visible
  useEffect(() => {
    if (!isVisible || (call.state !== "active" && call.state !== "on-hold")) {
      if (call.state !== "active" && call.state !== "on-hold") {
        setMetrics(null);
      }
      return;
    }

    const poll = async () => {
      try {
        const m = await getCallMetrics(call.id);
        setMetrics({
          mos: m.mos,
          jitter_ms: m.jitter_ms,
          loss_percent: m.loss_percent,
        });
      } catch {
        // Ignore errors
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [call.id, call.state, isVisible]);

  const handleEnd = async () => {
    setEnding(true);
    try {
      await endCall(call.id);
    } finally {
      setEnding(false);
    }
  };

  const handleHold = () => {
    holdCall(call.id, call.state !== "on-hold");
  };

  const handleMute = () => {
    muteCall(call.id, !call.muted);
  };

  const handleOpen = () => {
    navigateTo("soft-phone");
    onNavigate();
  };

  const isActive = call.state === "active" || call.state === "on-hold";
  const isRinging = call.state === "ringing" || call.state === "connecting";

  return (
    <Card className={`${ACTIVITY_CARD_CLASS} ${isActive ? "bg-success/5" : isRinging ? "bg-warning/5" : ""}`}>
      <CardContent className={ACTIVITY_CARD_CONTENT_CLASS}>
        <div className={ACTIVITY_CARD_HEADER_CLASS}>
          {/* Icon */}
          <div className={`${ACTIVITY_CARD_ICON_SHELL_CLASS} ${
            isActive ? "bg-success/20" : isRinging ? "bg-warning/20" : "bg-muted"
          }`}>
            {isRinging && (
              <span className={`${ACTIVITY_CARD_ICON_PING_CLASS} bg-warning/40`} />
            )}
            <PhoneCall className={`relative h-5 w-5 ${isActive ? "text-success" : isRinging ? "text-warning" : "text-muted-foreground"}`} />
          </div>

          <div className={ACTIVITY_CARD_BODY_CLASS}>
            <div className="flex items-center gap-2">
              <span className={`${ACTIVITY_CARD_STATUS_LABEL_CLASS} ${getStateColor(call.state)}`}>
                {getStateLabel(call.state)}
              </span>
              {call.muted && (
                <span className="text-xs text-muted-foreground">(muted)</span>
              )}
            </div>
            <p className="font-medium text-foreground truncate">{call.target}</p>
            
            {/* Stats row */}
            <div className={ACTIVITY_CARD_STATS_ROW_CLASS}>
              <span className="tabular-nums">{duration}</span>
              {metrics && (
                <>
                  <span className={`tabular-nums ${metrics.mos >= 3.5 ? "text-success" : metrics.mos >= 2.5 ? "text-warning" : "text-destructive"}`}>
                    MOS {metrics.mos.toFixed(1)}
                  </span>
                  <span className="tabular-nums">{metrics.jitter_ms.toFixed(0)}ms jitter</span>
                  {metrics.loss_percent > 0 && (
                    <span className="tabular-nums text-warning">{metrics.loss_percent.toFixed(1)}% loss</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className={ACTIVITY_CARD_ACTIONS_CLASS}>
          <TooltipWrapper title="End call" description="Hang up and end this call.">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleEnd}
              disabled={ending}
              className="gap-1.5"
            >
              <PhoneOff className="h-4 w-4" />
              {ending ? "Ending..." : "End call"}
            </Button>
          </TooltipWrapper>
          
          {isActive && (
            <>
              <TooltipWrapper
                title={call.state === "on-hold" ? "Resume" : "Hold"}
                description={call.state === "on-hold" ? "Resume this call." : "Put this call on hold."}
              >
                <Button
                  variant="neutral"
                  size="sm"
                  onClick={handleHold}
                  className="gap-1.5"
                >
                  {call.state === "on-hold" ? (
                    <>
                      <PlayCircle className="h-4 w-4" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Timer className="h-4 w-4" />
                      Hold
                    </>
                  )}
                </Button>
              </TooltipWrapper>
              <TooltipWrapper
                title={call.muted ? "Unmute" : "Mute"}
                description={call.muted ? "Turn your microphone back on." : "Mute your microphone."}
              >
                <Button
                  variant="neutral"
                  size="sm"
                  onClick={handleMute}
                  className="gap-1.5"
                >
                  {call.muted ? (
                    <>
                      <MicOff className="h-4 w-4" />
                      Unmute
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4" />
                      Mute
                    </>
                  )}
                </Button>
              </TooltipWrapper>
            </>
          )}
          
          <TooltipWrapper title="Open Soft Phone" description="Open the Soft Phone tool to manage this call.">
            <Button
              variant="neutral"
              size="sm"
              onClick={handleOpen}
              className="gap-1.5 ml-auto"
            >
              <ExternalLink className="h-4 w-4" />
              Open Soft Phone
            </Button>
          </TooltipWrapper>
        </div>
      </CardContent>
    </Card>
  );
}
