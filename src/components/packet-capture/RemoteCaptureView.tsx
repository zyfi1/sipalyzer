/**
 * Remote Capture View — the content for the "Remote" tab in Packet Monitor.
 *
 * Shows:
 *  - Active remote capture sessions with live status
 *  - Past remote sessions from the captures list
 *  - "New Remote Capture" button that opens the wizard
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { RemoteCaptureWizard } from "./RemoteCaptureWizard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  Globe,
  Plus,
  Square,
  Eye,
  Clock,
  Network,
  Wifi,
  Server,
} from "@/lib/icons";
import { formatDateTime } from "@/lib/dateTime";
import type { CaptureSession, RemoteCaptureConfig, CaptureCapabilityReport } from "@/types/packetCapture";
import { EmptyState } from "@/components/ui/empty-state";
import { LiveIndicator, liveRingClass } from "@/components/ui/live-indicator";
import { getCaptureCapabilities } from "@/api/packetCapture";

interface RemoteCaptureViewProps {
  onViewCapture?: (sessionId: string) => void;
}

export function RemoteCaptureView({ onViewCapture }: RemoteCaptureViewProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<CaptureCapabilityReport | null>(null);
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const runningSessionIds = usePacketCaptureStore((s) => s.runningSessionIds);
  const remoteSessionIds = usePacketCaptureStore((s) => s.remoteSessionIds);
  const startRemoteCapture = usePacketCaptureStore((s) => s.startRemoteCapture);
  const stopRemoteCapture = usePacketCaptureStore((s) => s.stopRemoteCapture);
  const fetchSessions = usePacketCaptureStore((s) => s.fetchSessions);
  const fetchActiveRemoteSessions = usePacketCaptureStore((s) => s.fetchActiveRemoteSessions);

  // Fetch sessions and active remotes on mount
  useEffect(() => {
    fetchSessions();
    fetchActiveRemoteSessions();
  }, [fetchSessions, fetchActiveRemoteSessions]);

  useEffect(() => {
    let cancelled = false;
    getCaptureCapabilities()
      .then((report) => {
        if (!cancelled) setCapabilities(report);
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter sessions to only remote ones
  const remoteSessions = useMemo(
    () => sessions.filter((s) => s.source?.type === "remote"),
    [sessions]
  );

  // Split into active and history
  const activeSessions = useMemo(
    () => remoteSessions.filter((s) => runningSessionIds.includes(s.id) || remoteSessionIds.includes(s.id)),
    [remoteSessions, runningSessionIds, remoteSessionIds]
  );

  const historySessions = useMemo(
    () => remoteSessions.filter((s) => !runningSessionIds.includes(s.id) && !remoteSessionIds.includes(s.id)),
    [remoteSessions, runningSessionIds, remoteSessionIds]
  );

  const handleStart = useCallback(
    async (config: RemoteCaptureConfig) => {
      const sessionId = await startRemoteCapture(config);
      // Navigate to monitor tab with the new session
      if (onViewCapture) {
        onViewCapture(sessionId);
      }
    },
    [startRemoteCapture, onViewCapture]
  );

  const handleStop = useCallback(
    async (sessionId: string) => {
      await stopRemoteCapture(sessionId);
      fetchSessions();
    },
    [stopRemoteCapture, fetchSessions]
  );

  const handleView = useCallback(
    (sessionId: string) => {
      if (onViewCapture) {
        onViewCapture(sessionId);
      }
    },
    [onViewCapture]
  );

  const isEmpty = activeSessions.length === 0 && historySessions.length === 0;
  const remoteCaptureAvailable = capabilities?.remoteCaptureSupported !== false;
  return (
    <>
      <div className="h-full min-h-0 app-view-gutter">
        <div className="ui-panel-shell h-full min-h-0 flex flex-col overflow-hidden">
          <div className="flex-none border-b border-border/35 px-4 py-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-label">Remote SSH Capture</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Capture packets from remote hosts via SSH, similar to Wireshark sshdump.
                </p>
              </div>
              <Button size="sm" onClick={() => setWizardOpen(true)} disabled={!remoteCaptureAvailable}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Remote Capture
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 app-view-stack">
            {isEmpty ? (
              <EmptyState
                variant="inline"
                icon={<Globe />}
                title="No remote captures yet"
                description="Connect to a remote host via SSH to capture packets with tcpdump. Packets are streamed back and displayed in the live monitor."
                action={
                  <Button
                    size="sm"
                    variant="neutral"
                    className="h-8 gap-1.5 px-3 text-xs"
                    onClick={() => setWizardOpen(true)}
                    disabled={!remoteCaptureAvailable}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Start Remote Capture
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {/* Active captures */}
                {activeSessions.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Active Captures
                    </h4>
                    <div className="space-y-2">
                      {activeSessions.map((session) => (
                        <RemoteSessionCard
                          key={session.id}
                          session={session}
                          isRunning={true}
                          onStop={() => handleStop(session.id)}
                          onView={() => handleView(session.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* History */}
                {historySessions.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      History
                    </h4>
                    <div className="space-y-2">
                      {historySessions.map((session) => (
                        <RemoteSessionCard
                          key={session.id}
                          session={session}
                          isRunning={false}
                          onView={() => handleView(session.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Wizard dialog — always rendered */}
      <RemoteCaptureWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onStart={handleStart}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Session card
// ---------------------------------------------------------------------------

interface RemoteSessionCardProps {
  session: CaptureSession;
  isRunning: boolean;
  onStop?: () => void;
  onView?: () => void;
}

function RemoteSessionCard({
  session,
  isRunning,
  onStop,
  onView,
}: RemoteSessionCardProps) {
  const host = session.source?.host ?? "unknown";
  const username = session.source?.username ?? "";

  return (
    <div
      className={cn(
        "ui-surface-card p-3 flex items-center gap-3 transition-smooth",
        isRunning
          ? liveRingClass
          : "hover:bg-muted/30"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "shrink-0 flex items-center justify-center h-9 w-9 rounded-md",
          isRunning ? "bg-accent" : "bg-muted"
        )}
      >
        <Server
          className={cn(
            "h-4.5 w-4.5",
            isRunning ? "text-foreground" : "text-muted-foreground"
          )}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{session.name}</span>
          {isRunning && (
            <LiveIndicator variant="badge" label="LIVE" size="xs" />
          )}
          <Badge variant="secondary" className="text-2xs px-1.5 py-0 h-4">
            Remote
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {username ? `${username}@` : ""}
            {host}
          </span>
          <span className="flex items-center gap-1">
            <Wifi className="h-3 w-3" />
            {session.interface.replace("remote:", "")}
          </span>
          <span className="flex items-center gap-1">
            <Network className="h-3 w-3" />
            {session.packetCount.toLocaleString()} pkts
          </span>
          {session.startTime && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDateTime(session.startTime)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isRunning && onStop && (
          <TooltipWrapper content="Stop capture">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onStop}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          </TooltipWrapper>
        )}
        {onView && (
          <TooltipWrapper content="View in monitor">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onView}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </TooltipWrapper>
        )}
      </div>
    </div>
  );
}
