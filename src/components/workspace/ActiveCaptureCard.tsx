/**
 * Active capture card showing live stats for a running packet capture.
 * Displays duration, packet count, packets/sec, and protocol breakdown.
 */

import { useState, useEffect } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useToolVisible } from "@/hooks/useToolVisible";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Network, XCircle, ExternalLink } from "@/lib/icons";
import { navigateTo } from "@/lib/navigation";
import type { CaptureSession, CaptureStatistics } from "@/types/packetCapture";
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

interface ActiveCaptureCardProps {
  session: CaptureSession;
  statistics: CaptureStatistics | null;
  onNavigate: () => void;
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

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ActiveCaptureCard({ session, statistics, onNavigate }: ActiveCaptureCardProps) {
  const stopCapture = usePacketCaptureStore((s) => s.stopCapture);
  const isVisible = useToolVisible("troubleshooting");
  const [duration, setDuration] = useState(() => formatDuration(session.startTime));
  const [stopping, setStopping] = useState(false);

  // Update duration every second only when visible
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      setDuration(formatDuration(session.startTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [session.startTime, isVisible]);

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopCapture(session.id);
    } finally {
      setStopping(false);
    }
  };

  const handleOpen = () => {
    navigateTo("packet-capture", "viewer", { packetCaptureSessionId: session.id });
    onNavigate();
  };

  // Protocol breakdown (top 3)
  const protocols = statistics?.packetsByProtocol ?? {};
  const topProtocols = Object.entries(protocols)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <Card className={`${ACTIVITY_CARD_CLASS} bg-destructive/5`}>
      <CardContent className={ACTIVITY_CARD_CONTENT_CLASS}>
        <div className={ACTIVITY_CARD_HEADER_CLASS}>
          {/* Pulsing indicator */}
          <div className={`${ACTIVITY_CARD_ICON_SHELL_CLASS} bg-destructive/20`}>
            <span className={`${ACTIVITY_CARD_ICON_PING_CLASS} bg-destructive/40`} />
            <Network className="relative h-5 w-5 text-destructive" />
          </div>

          <div className={ACTIVITY_CARD_BODY_CLASS}>
            <div className="flex items-center gap-2">
              <span className={`${ACTIVITY_CARD_STATUS_LABEL_CLASS} text-destructive`}>
                Capturing
              </span>
            </div>
            <p className="font-medium text-foreground truncate">{session.name || session.id}</p>
            
            {/* Stats row */}
            <div className={ACTIVITY_CARD_STATS_ROW_CLASS}>
              <span className="tabular-nums">{duration}</span>
              <span className="tabular-nums">
                {formatNumber(statistics?.totalPackets ?? session.packetCount)} packets
              </span>
              {statistics?.packetsPerSecond != null && (
                <span className="tabular-nums">{Math.round(statistics.packetsPerSecond)}/s</span>
              )}
            </div>

            {/* Protocol breakdown */}
            {topProtocols.length > 0 && (
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                {topProtocols.map(([proto, count]) => (
                  <span key={proto}>
                    {proto}: {formatNumber(count)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className={ACTIVITY_CARD_ACTIONS_CLASS}>
          <TooltipWrapper title="Stop capture" description="Stop this packet capture session.">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStop}
              disabled={stopping}
              className="gap-1.5"
            >
              <XCircle className="h-4 w-4" />
              {stopping ? "Stopping..." : "Stop capture"}
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Open in Monitor" description="Open this capture in the packet capture viewer.">
            <Button
              variant="neutral"
              size="sm"
              onClick={handleOpen}
              className="gap-1.5"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Monitor
            </Button>
          </TooltipWrapper>
        </div>
      </CardContent>
    </Card>
  );
}
