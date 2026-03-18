import { useEffect, useMemo, useState } from "react";
import { importPcap } from "@/api/packetCapture";
import { useNotifications } from "@/hooks/useNotifications";
import { useOpenCapture } from "@/hooks/useOpenCapture";
import { navigateTo } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import type { ExpertFinding } from "@/types/packetCapture";
import { getAnalysisDiagnostics } from "@/lib/diagnostics/query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Info,
  Upload,
  XCircle,
} from "@/lib/icons";
import { CallFlowTimelineView } from "./CallFlowTimelineView";
import { CallRegressionDiffView } from "./CallRegressionDiffView";

type SeverityKey = ExpertFinding["severity"];

const SEVERITY_STYLES: Record<
  SeverityKey,
  { icon: typeof XCircle; label: string; tone: string; badgeClass: string }
> = {
  critical: {
    icon: XCircle,
    label: "Critical",
    tone: "text-destructive",
    badgeClass: "border-destructive/35 bg-destructive/[0.08] text-destructive",
  },
  warning: {
    icon: AlertTriangle,
    label: "Warning",
    tone: "text-warning",
    badgeClass: "border-warning/35 bg-warning/[0.08] text-warning",
  },
  info: {
    icon: Info,
    label: "Info",
    tone: "text-primary",
    badgeClass: "border-primary/35 bg-primary/[0.08] text-primary",
  },
};

function formatDateTime(value: string | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

export function VoipInvestigationHubView() {
  const { notify } = useNotifications();
  const { openViewer } = useOpenCapture();

  const sessions = usePacketCaptureStore((s) => s.sessions);
  const fetchSessions = usePacketCaptureStore((s) => s.fetchSessions);
  const viewerActiveSessionId = usePacketCaptureStore((s) => s.viewerActiveSessionId);
  const setSipLadderRequestedSessionId = usePacketCaptureStore((s) => s.setSipLadderRequestedSessionId);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [findings, setFindings] = useState<ExpertFinding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [uploadingCapture, setUploadingCapture] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<"timeline" | "regression">("timeline");

  useEffect(() => {
    fetchSessions().catch(() => {});
  }, [fetchSessions]);

  useEffect(() => {
    if (viewerActiveSessionId) {
      setSessionId(viewerActiveSessionId);
      return;
    }
    setSessionId((prev) => {
      if (prev && sessions.some((s) => s.id === prev)) return prev;
      return sessions[0]?.id ?? null;
    });
  }, [viewerActiveSessionId, sessions]);

  useEffect(() => {
    if (!sessionId) {
      setFindings([]);
      return;
    }
    setFindingsLoading(true);
    getAnalysisDiagnostics(sessionId)
      .then((result) => setFindings(result))
      .catch(() => setFindings([]))
      .finally(() => setFindingsLoading(false));
  }, [sessionId]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const severityCounts = useMemo(
    () =>
      findings.reduce(
        (acc, finding) => {
          acc[finding.severity] += 1;
          return acc;
        },
        { critical: 0, warning: 0, info: 0 },
      ),
    [findings],
  );

  const health = useMemo(() => {
    if (severityCounts.critical > 0) {
      return {
        label: "Needs immediate attention",
        tone: "text-destructive",
        icon: XCircle,
      };
    }
    if (severityCounts.warning > 0) {
      return {
        label: "Degraded",
        tone: "text-warning",
        icon: AlertTriangle,
      };
    }
    return {
      label: findings.length > 0 ? "Stable with notes" : "Healthy",
      tone: findings.length > 0 ? "text-primary" : "text-success",
      icon: findings.length > 0 ? Info : CheckCircle,
    };
  }, [findings.length, severityCounts.critical, severityCounts.warning]);

  const handleSessionChange = (nextSessionId: string) => {
    setSessionId(nextSessionId);
    setSipLadderRequestedSessionId(nextSessionId);
  };

  const handleOpenViewer = () => {
    if (!sessionId) return;
    openViewer(sessionId);
    navigateTo("packet-capture", "viewer", { packetCaptureSessionId: sessionId });
  };

  const handleUploadCapture = async () => {
    if (uploadingCapture) return;
    setUploadingCapture(true);
    try {
      const importedSessionId = await importPcap();
      await fetchSessions();
      handleSessionChange(importedSessionId);
      notify({
        type: "success",
        title: "Capture imported",
        description: "PCAP uploaded and ready for analysis.",
        source: "forensics",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("cancel")) {
        notify({
          type: "error",
          title: "Capture import failed",
          description: message,
          source: "forensics",
        });
      }
    } finally {
      setUploadingCapture(false);
    }
  };

  const HealthIcon = health.icon;

  return (
    <div className="h-full min-h-0">
      <div className="h-full min-h-0 overflow-hidden flex flex-col">
        <div className="shrink-0 border-b border-border/30 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="section-label-sm">Analysis</span>
            <Tabs
              value={analysisMode}
              onValueChange={(next) => setAnalysisMode(next as "timeline" | "regression")}
              className="w-auto"
            >
              <TabsList className="subview-tabs-compact shrink-0">
                <TabsTrigger value="timeline" className="subview-tab-compact">
                  Call Timeline
                </TabsTrigger>
                <TabsTrigger value="regression" className="subview-tab-compact">
                  Packet Diff
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="min-w-[260px] max-w-[560px] flex-1">
              <Select value={sessionId ?? ""} onValueChange={handleSessionChange}>
                <SelectTrigger className="h-8 text-xs ui-control-shell">
                  <SelectValue placeholder="Select analysis source..." />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.name} ({session.packetCount.toLocaleString()} pkts)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs font-semibold"
                onClick={handleUploadCapture}
                disabled={uploadingCapture}
              >
                <Upload className="h-3.5 w-3.5" />
                {uploadingCapture ? "Uploading..." : "Import Capture"}
              </Button>
              <Button
                variant="neutral"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs font-medium"
                disabled={!sessionId}
                onClick={handleOpenViewer}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Viewer
              </Button>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <div className="inline-flex h-6 items-center gap-1 rounded-sm border border-border/30 px-1.5">
              <HealthIcon className={cn("h-3.5 w-3.5", health.tone)} />
              <span className="text-2xs text-muted-foreground">{health.label}</span>
            </div>
            {(Object.keys(SEVERITY_STYLES) as SeverityKey[]).map((severity) => (
              <Badge key={severity} variant="outline" className={cn("h-5 px-1.5 text-3xs", SEVERITY_STYLES[severity].badgeClass)}>
                {severityCounts[severity]} {SEVERITY_STYLES[severity].label}
              </Badge>
            ))}
            {selectedSession && (
              <span className="ml-auto text-2xs text-muted-foreground">
                {selectedSession.interface} · {selectedSession.packetCount.toLocaleString()} pkts · {formatDateTime(selectedSession.startTime)}
              </span>
            )}
            {!selectedSession && findingsLoading && (
              <span className="ml-auto text-2xs text-muted-foreground">Evaluating findings...</span>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {analysisMode === "timeline" ? (
            <CallFlowTimelineView sessionId={sessionId} />
          ) : (
            <CallRegressionDiffView sessions={sessions} preferredAfterSessionId={sessionId} />
          )}
        </div>
      </div>
    </div>
  );
}
