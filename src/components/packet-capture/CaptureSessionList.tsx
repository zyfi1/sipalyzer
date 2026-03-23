import { useEffect, useState } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Download, Eye, ExternalLink } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { format } from "date-fns";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useNotifications } from "@/hooks/useNotifications";
import { useOpenCapture } from "@/hooks/useOpenCapture";

interface CaptureSessionListProps {
  onSelectSession: (sessionId: string) => void;
}

export function CaptureSessionList({ onSelectSession }: CaptureSessionListProps) {
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const loadingSessions = usePacketCaptureStore((s) => s.loadingSessions);
  const fetchSessions = usePacketCaptureStore((s) => s.fetchSessions);
  const deleteSession = usePacketCaptureStore((s) => s.deleteSession);
  const exportPcap = usePacketCaptureStore((s) => s.exportPcap);
  const { notify } = useNotifications();
  const { openModal } = useOpenCapture();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleDelete = async (sessionId: string) => {
    try {
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
    }
  };

  const handleExport = async (sessionId: string) => {
    try {
      setExportingId(sessionId);
      // Export to default location (backend will create exports directory)
      const exportedPath = await exportPcap(sessionId);
      notify({ source: "packet-capture",
        type: "success",
        title: "Export Successful",
        description: `PCAP file exported to: ${exportedPath}`,
      });
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Export Failed",
        description: error.message || "Unknown error",
      });
    } finally {
      setExportingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "running":
        return <Badge variant="default">Running</Badge>;
      case "stopped":
        return <Badge variant="secondary">Stopped</Badge>;
      case "imported":
        return <Badge variant="secondary">Imported</Badge>;
      case "paused":
        return <Badge variant="secondary">Paused</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loadingSessions) {
    return (
      <Card className="ui-surface-card shadow-none">
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading sessions...
        </CardContent>
      </Card>
    );
  }

  if (sessions.length === 0) {
    return (
      <EmptyState variant="inline" title="No capture sessions found" description="Start a capture to see sessions here." />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="ui-surface-card shadow-none">
        <CardHeader className="border-b border-border/40 pb-3">
          <CardTitle>Capture Sessions</CardTitle>
          <CardDescription>View and manage your packet capture sessions</CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="ui-surface-card flex items-center justify-between p-4 transition-smooth hover:bg-accent/30"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold truncate">{session.name}</h3>
                    {getStatusBadge(session.status)}
                  </div>
                  {session.description && (
                    <p className="text-sm text-muted-foreground truncate mb-1">
                      {session.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{session.interface}</span>
                    <span>{session.packetCount.toLocaleString()} packets</span>
                    <span>
                      {format(new Date(session.startTime), "MMM d, yyyy HH:mm:ss")}
                    </span>
                    {session.endTime && (
                      <span>
                        Duration: {Math.round(
                          (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000
                        )}s
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <TooltipWrapper entry={tooltips.captureQuickView}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openModal(session.id, session)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                  <TooltipWrapper entry={tooltips.captureOpenFull}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onSelectSession(session.id)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                  <TooltipWrapper entry={tooltips.captureExportPcap}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleExport(session.id)}
                      disabled={exportingId === session.id}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                  <TooltipWrapper entry={tooltips.captureDeleteSession}>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => setDeletingId(session.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {deletingId && (
        <ConfirmDialog
          open={!!deletingId}
          onOpenChange={(open) => !open && setDeletingId(null)}
          onConfirm={() => deletingId && handleDelete(deletingId)}
          title="Delete Capture Session"
          description="Are you sure you want to delete this capture session? The PCAP file will also be deleted."
        />
      )}
    </div>
  );
}
