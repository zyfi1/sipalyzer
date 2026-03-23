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
import { AppDropdown, SelectItem } from "@/components/ui/app-dropdown";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AlertTriangle,
  CheckCircle,
  Circle,
  ExternalLink,
  Info,
  Search,
  Upload,
  XCircle,
} from "@/lib/icons";
import { CallFlowTimelineView } from "./CallFlowTimelineView";

type SeverityKey = ExpertFinding["severity"];

const SEVERITY_STYLES: Record<SeverityKey, { icon: typeof XCircle; tone: string }> = {
  critical: { icon: XCircle, tone: "text-destructive" },
  warning: { icon: AlertTriangle, tone: "text-warning" },
  info: { icon: Info, tone: "text-primary" },
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
  const [captureSearch, setCaptureSearch] = useState("");
  const [findings, setFindings] = useState<ExpertFinding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [uploadingCapture, setUploadingCapture] = useState(false);
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

  const filteredHubSessions = useMemo(() => {
    const q = captureSearch.trim().toLowerCase();
    const list = [...sessions].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
    if (!q) return list;
    return list.filter((s) =>
      `${s.name} ${s.interface} ${s.status} ${s.packetCount} ${s.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [sessions, captureSearch]);

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
    setCaptureSearch("");
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
        <div className="shrink-0 border-b border-border/25 bg-[hsl(var(--card)/0.35)] px-2 py-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">
              Analysis
            </span>
            <div className="min-w-0 flex-1 basis-[min(100%,240px)] sm:max-w-lg">
              <AppDropdown
                size="md"
                value={sessionId ?? ""}
                onValueChange={handleSessionChange}
                className="w-full min-w-0 font-normal"
                placeholder="Choose capture to analyze…"
                valueDisplay={
                  selectedSession ? (
                    <span className="block min-w-0 truncate text-left font-medium">
                      {selectedSession.name}{" "}
                      <span className="font-normal text-muted-foreground">
                        ({selectedSession.packetCount.toLocaleString()} pkts)
                      </span>
                    </span>
                  ) : null
                }
                contentPosition="popper"
                contentClassName="min-w-[var(--radix-select-trigger-width)] w-[min(560px,92vw)] max-w-[92vw] isolate p-0"
                contentChildren={(
                  <>
                    <div
                      className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/40 bg-[hsl(var(--card)/1)] px-2.5 py-2"
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Input
                        size="sm"
                        placeholder="Search captures by name, interface, status…"
                        value={captureSearch}
                        onChange={(e) => setCaptureSearch(e.target.value)}
                        className="min-w-0 flex-1 text-xs"
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                    {filteredHubSessions.length === 0 ? (
                      <EmptyState compact variant="inline" title="No captures match" />
                    ) : (
                      filteredHubSessions.map((session) => (
                        <SelectItem key={session.id} value={session.id} className="py-1.5 pl-2 pr-8 cursor-pointer">
                          <div className="flex w-full items-center gap-3 min-w-0">
                            <div
                              className={cn(
                                "shrink-0 flex items-center justify-center w-6 h-6 rounded",
                                session.status.toLowerCase() === "running" ? "bg-success/[0.08]" : "bg-muted/30",
                              )}
                            >
                              <Circle
                                className={cn(
                                  "h-3.5 w-3.5",
                                  session.status.toLowerCase() === "running"
                                    ? "text-success"
                                    : "text-muted-foreground",
                                )}
                              />
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                              <span className="font-semibold text-foreground truncate">{session.name}</span>
                              <span className="text-2xs text-muted-foreground truncate">
                                {session.packetCount.toLocaleString()} pkts · {formatDateTime(session.startTime)}
                              </span>
                            </div>
                            <Badge variant="secondary" className="h-5 px-1.5 text-3xs shrink-0">
                              {session.status}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </>
                )}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1 text-[10px] leading-none text-muted-foreground">
              <span className="inline-flex items-center gap-0.5 rounded border border-border/35 bg-background/30 px-1.5 py-0.5">
                <HealthIcon className={cn("h-3 w-3 shrink-0", health.tone)} />
                <span className="max-w-[9rem] truncate">{health.label}</span>
              </span>
              <span className="hidden sm:inline text-border">·</span>
              <span className={cn("tabular-nums", SEVERITY_STYLES.critical.tone)}>
                {severityCounts.critical} crit
              </span>
              <span className="text-border/60">·</span>
              <span className={cn("tabular-nums", SEVERITY_STYLES.warning.tone)}>
                {severityCounts.warning} warn
              </span>
              <span className="text-border/60">·</span>
              <span className={cn("tabular-nums", SEVERITY_STYLES.info.tone)}>
                {severityCounts.info} info
              </span>
            </div>
            {selectedSession && (
              <span className="hidden min-[900px]:inline text-[10px] text-muted-foreground/80 tabular-nums truncate max-w-[14rem]">
                {selectedSession.interface} · {selectedSession.packetCount.toLocaleString()} pkts · {formatDateTime(selectedSession.startTime)}
              </span>
            )}
            {!selectedSession && findingsLoading && (
              <span className="text-[10px] text-muted-foreground">Evaluating…</span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1 px-2.5 text-2xs font-semibold"
                onClick={handleUploadCapture}
                disabled={uploadingCapture}
              >
                <Upload className="h-3 w-3" />
                {uploadingCapture ? "…" : "Import"}
              </Button>
              <Button
                variant="neutral"
                size="sm"
                className="h-7 gap-1 px-2.5 text-2xs font-medium"
                disabled={!sessionId}
                onClick={handleOpenViewer}
              >
                <ExternalLink className="h-3 w-3" />
                Viewer
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <CallFlowTimelineView sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}
