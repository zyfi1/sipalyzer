import { useEffect, useState } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { navigateTo } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Clock, 
  Download, 
  Eye, 
  Trash2, 
  Trash,
  FileText,
  List,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  RefreshCw,
} from "@/lib/icons";
import { useNotifications } from "@/hooks/useNotifications";
import type { CaptureSession } from "@/types/packetCapture";
import { CapturePreviewModal } from "./CapturePreviewModal";
import { ExportDialog } from "./monitor/ExportDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

export function RecentCapturesPanel() {
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const loadingSessions = usePacketCaptureStore((s) => s.loadingSessions);
  const fetchSessions = usePacketCaptureStore((s) => s.fetchSessions);
  const deleteSession = usePacketCaptureStore((s) => s.deleteSession);
  const requestCaptureSessionOpen = usePacketCaptureStore((s) => s.requestCaptureSessionOpen);
  const { notify } = useNotifications();
  const [previewSession, setPreviewSession] = useState<CaptureSession | null>(null);
  const [exportSession, setExportSession] = useState<CaptureSession | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleDelete = async (sessionId: string) => {
    try {
      setDeletingId(sessionId);
      await deleteSession(sessionId);
      notify({ source: "packet-capture",
        type: "success",
        title: "Session Deleted",
        description: "Capture session has been deleted",
      });
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed to Delete",
        description: error.message || "Unknown error",
      });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleDeleteAll = async () => {
    try {
      setDeletingId("all");
      for (const session of sessions) {
        await deleteSession(session.id);
      }
      notify({ source: "packet-capture",
        type: "success",
        title: "All Sessions Deleted",
        description: `Deleted ${sessions.length} capture session(s)`,
      });
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed to Delete All",
        description: error.message || "Unknown error",
      });
    } finally {
      setDeletingId(null);
      setConfirmDeleteAll(false);
    }
  };

  const handleExport = async (session: CaptureSession) => {
    setExportSession(session);
  };

  const handleViewSession = (sessionId: string) => {
    requestCaptureSessionOpen(sessionId);
    navigateTo("packet-capture", "viewer", { packetCaptureSessionId: sessionId });
  };

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDuration = (startTime: string, endTime?: string) => {
    if (!endTime) return null;
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const diffMs = end - start;
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return `${diffSecs}s`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ${diffMins % 60}m`;
  };

  const groupSessions = (sessions: CaptureSession[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const groups: { label: string; sessions: CaptureSession[] }[] = [
      { label: "Today", sessions: [] },
      { label: "Yesterday", sessions: [] },
      { label: "This Week", sessions: [] },
      { label: "Older", sessions: [] },
    ];

    sessions.forEach((session) => {
      const sessionDate = new Date(session.startTime);
      const g0 = groups[0];
      const g1 = groups[1];
      const g2 = groups[2];
      const g3 = groups[3];
      if (sessionDate >= today && g0) {
        g0.sessions.push(session);
      } else if (sessionDate >= yesterday && g1) {
        g1.sessions.push(session);
      } else if (sessionDate >= weekAgo && g2) {
        g2.sessions.push(session);
      } else if (g3) {
        g3.sessions.push(session);
      }
    });

    return groups.filter((g) => g.sessions.length > 0);
  };

  if (loadingSessions) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
        Loading captures...
      </div>
    );
  }

  const groupedSessions = groupSessions(sessions);

  return (
    <>
      <div className="h-full flex flex-col min-h-0">
        <div className="ui-surface-card flex-1 min-h-0 overflow-y-auto">
          {/* Header Row */}
          <div className="surface-subtle flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Saved Captures</span>
              {sessions.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {sessions.length}
                </Badge>
              )}
            </div>
            {sessions.length > 0 && (
              <TooltipWrapper content="Delete all captures">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 w-7 p-0"
                  onClick={() => setConfirmDeleteAll(true)}
                  disabled={deletingId === "all"}
                >
                  <Trash className="h-3.5 w-3.5" />
                </Button>
              </TooltipWrapper>
            )}
          </div>

          {/* Content */}
          {groupedSessions.length === 0 ? (
            <EmptyState
              compact
              variant="inline"
              icon={<FolderOpen />}
              title="No capture sessions yet"
              description="Start a capture in the Packet Monitor."
            />
          ) : (
            groupedSessions.map((group) => {
              const isCollapsed = collapsedGroups.has(group.label);
              return (
                <div key={group.label}>
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="surface-subtle w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-smooth"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    <span>{group.label}</span>
                    <span className="opacity-60">({group.sessions.length})</span>
                  </button>
                  
                  {/* Sessions */}
                  {!isCollapsed && (
                    <div className="divide-y divide-border/30">
                      {group.sessions.map((session) => (
                        <div
                          key={session.id}
                          className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-smooth"
                        >
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{session.name}</span>
                              {session.status.toLowerCase() === "running" && (
                                <Badge variant="default" className="text-2xs h-4 px-1.5">Live</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDate(session.startTime)}
                              </span>
                              <span className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {session.packetCount.toLocaleString()} pkts
                              </span>
                              {formatDuration(session.startTime, session.endTime) && (
                                <span>{formatDuration(session.startTime, session.endTime)}</span>
                              )}
                            </div>
                          </div>
                          
                          {/* Actions */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <TooltipWrapper content="View in monitor">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => handleViewSession(session.id)}
                              >
                                <List className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipWrapper>
                            <TooltipWrapper content="Quick preview">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => setPreviewSession(session)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipWrapper>
                            <TooltipWrapper content="Export">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => handleExport(session)}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipWrapper>
                            <TooltipWrapper content="Delete">
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 w-7 p-0"
                                onClick={() => setConfirmDeleteId(session.id)}
                                disabled={deletingId === session.id || deletingId === "all"}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipWrapper>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {previewSession && (
        <CapturePreviewModal
          session={previewSession}
          open={!!previewSession}
          onOpenChange={(open) => !open && setPreviewSession(null)}
        />
      )}

      {exportSession && (
        <ExportDialog
          open={!!exportSession}
          onOpenChange={(open) => !open && setExportSession(null)}
          packets={[]}
          sessionId={exportSession.id}
        />
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          open={!!confirmDeleteId}
          onOpenChange={(open) => !open && setConfirmDeleteId(null)}
          title="Delete Capture Session"
          description="Are you sure you want to delete this capture session? This action cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          variant="destructive"
          onConfirm={() => handleDelete(confirmDeleteId)}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteAll}
        onOpenChange={setConfirmDeleteAll}
        title="Delete All Capture Sessions"
        description={`Are you sure you want to delete all ${sessions.length} capture session(s)? This action cannot be undone.`}
        confirmText="Delete All"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDeleteAll}
      />
    </>
  );
}
