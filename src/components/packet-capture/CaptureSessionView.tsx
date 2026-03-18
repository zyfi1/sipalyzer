import { useEffect, useState } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface CaptureSessionViewProps {
  sessionId: string;
}

export function CaptureSessionView({ sessionId }: CaptureSessionViewProps) {
  const fetchSession = usePacketCaptureStore((s) => s.fetchSession);
  const activeSession = usePacketCaptureStore((s) => s.activeSession);
  const [session, setSession] = useState(activeSession);

  useEffect(() => {
    fetchSession(sessionId);
  }, [sessionId, fetchSession]);

  useEffect(() => {
    if (activeSession?.id === sessionId) {
      setSession(activeSession);
    }
  }, [activeSession, sessionId]);

  if (!session || session.id !== sessionId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading session details...
        </CardContent>
      </Card>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "running":
        return <Badge variant="default">Running</Badge>;
      case "stopped":
        return <Badge variant="secondary">Stopped</Badge>;
      case "paused":
        return <Badge variant="outline">Paused</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Session Details</span>
          {getStatusBadge(session.status)}
        </CardTitle>
        <CardDescription>{session.name}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {session.description && (
          <div>
            <div className="text-sm font-medium mb-1">Description</div>
            <div className="text-sm text-muted-foreground">{session.description}</div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium mb-1">Interface</div>
            <div className="text-sm text-muted-foreground">{session.interface}</div>
          </div>
          <div>
            <div className="text-sm font-medium mb-1">Packets Captured</div>
            <div className="text-sm text-muted-foreground">
              {session.packetCount.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium mb-1">Start Time</div>
            <div className="text-sm text-muted-foreground">
              {format(new Date(session.startTime), "MMM d, yyyy HH:mm:ss")}
            </div>
          </div>
          {session.endTime && (
            <div>
              <div className="text-sm font-medium mb-1">End Time</div>
              <div className="text-sm text-muted-foreground">
                {format(new Date(session.endTime), "MMM d, yyyy HH:mm:ss")}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Protocols</div>
          <div className="flex flex-wrap gap-2">
            {session.filterConfig.protocols.map((protocol) => (
              <Badge key={protocol} variant="outline">
                {protocol}
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-1">PCAP File</div>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {session.filePath}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
