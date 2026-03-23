/**
 * Home view — overview and quick links. Registration has its own tool; this shows a summary and links to it.
 * Shows registration status, findings, recent timeline, recent captures; tabs above for deep analysis (SIP & RTP, calls, timeline, findings).
 */

import { useState, useCallback } from "react";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { navigateTo } from "@/lib/navigation";
import { HOME_TOOL_ID } from "@/lib/toolRegistry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Server,
  Phone,
  ListOrdered,
  Search,
  Network,
  CheckCircle2,
  XCircle,
  Layers,
  ChevronDown,
  ChevronRight,
  PhoneCall,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { ForensicsTimelineEntry } from "@/types/forensics";
import type { ForensicFinding } from "@/types/forensics";
import type { CaptureSession } from "@/types/packetCapture";
import type { Call } from "@/lib/softphone";

const RECENT_TIMELINE = 15;
const RECENT_CAPTURES = 5;
const RECENT_FINDINGS = 10;
/** Only show expand control when description exceeds this length. */
const LONG_DESCRIPTION_LENGTH = 120;

export type HomeSubviewTabId = "timeline" | "findings" | "calls";

export interface TroubleshootingCenterToolProps {
  /** When provided, "View all" and card clicks switch the parent tab immediately (avoids store-only sync). */
  onSwitchToTab?: (tab: HomeSubviewTabId) => void;
}

type FindingLinkType = NonNullable<ForensicFinding["link"]>["type"];

const FINDING_LINK_CONFIG: Record<FindingLinkType, { actionText: string; description: string }> = {
  capture: {
    actionText: "Open packet capture",
    description: "Open the linked capture session in Packet Monitor.",
  },
  call: {
    actionText: "Open calls view",
    description: "Open the Calls tab to inspect related call history.",
  },
  registrar: {
    actionText: "Open registration",
    description: "Open Registration to inspect registrar health and tests.",
  },
  fax: {
    actionText: "Open fax center",
    description: "Open Fax Center to inspect related fax activity.",
  },
  network: {
    actionText: "Open network tests",
    description: "Open Network Test to re-run VoIP assessment, ping, DNS, and path checks.",
  },
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function getFindingConfidenceCopy(finding: ForensicFinding): string | null {
  if (!finding.confidenceLevel) return null;
  switch (finding.confidenceLevel) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
    default: {
      const _exhaustive: never = finding.confidenceLevel;
      return _exhaustive;
    }
  }
}

export function TroubleshootingCenterTool({ onSwitchToTab }: TroubleshootingCenterToolProps) {
  const registrationHealth = useTroubleshootingStore((s) => s.registrationHealth);
  const callQualitySummaries = useTroubleshootingStore((s) => s.callQualitySummaries);
  const findings = useTroubleshootingStore((s) => s.findings);
  const timeline = useTroubleshootingStore((s) => s.timeline);
  const captureSessions = useTroubleshootingStore((s) => s.captureSessions);
  const loadingHealth = useTroubleshootingStore((s) => s.loadingHealth);
  const lastHealthRefreshAt = useTroubleshootingStore((s) => s.lastHealthRefreshAt);
  const error = useTroubleshootingStore((s) => s.error);
  const refresh = useTroubleshootingStore((s) => s.refresh);
  const selectCallForTrace = useTroubleshootingStore((s) => s.selectCallForTrace);
  const calls = useSoftphoneStore((s) => s.calls);

  const [expandedFindingIds, setExpandedFindingIds] = useState<Set<string>>(new Set());
  const toggleFindingExpand = useCallback((id: string) => {
    setExpandedFindingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const healthRegistrars = registrationHealth?.registrars ?? [];
  const upCount = healthRegistrars.filter((r) => r.registered).length;
  const totalRegistrars = healthRegistrars.length;
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const poorQualityCount = callQualitySummaries.filter((s) => s.qualityTier === "poor").length;

  const recentTimeline = [...timeline].slice(-RECENT_TIMELINE).reverse();
  const recentFindings = [...findings].slice(0, RECENT_FINDINGS);
  const recentCaptures = [...captureSessions]
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, RECENT_CAPTURES);

  const openSubview = (subview: string) => {
    navigateTo(HOME_TOOL_ID, subview);
  };

  /** Switch to a tab (timeline/findings/calls). Uses parent callback when provided so tab switches immediately. */
  const switchToTab = (tab: HomeSubviewTabId) => {
    onSwitchToTab?.(tab);
    navigateTo(HOME_TOOL_ID, tab);
  };

  const openRegistrationTool = () => {
    navigateTo("registration");
  };

  const openCaptureInMonitor = (session: CaptureSession) => {
    navigateTo("packet-capture", "analysis", { packetCaptureSessionId: session.id });
  };

  const analyzeCallById = (callId: string) => {
    const call = calls.find((c) => c.id === callId || c.sipCallId === callId);
    if (!call) return;
    void selectCallForTrace(call as Call, { sessionId: call.captureSessionId ?? undefined });
  };

  const analyzeBestCandidateCall = () => {
    if (callQualitySummaries.length === 0) return;
    const score = (s: (typeof callQualitySummaries)[number]) => {
      if (s.state === "failed") return 3;
      if (s.qualityTier === "poor") return 2;
      if (s.qualityTier === "fair") return 1;
      return 0;
    };
    const candidate = callQualitySummaries.reduce<(typeof callQualitySummaries)[number] | null>((best, current) => {
      if (!best) return current;
      const scoreDelta = score(current) - score(best);
      if (scoreDelta > 0) return current;
      if (scoreDelta < 0) return best;
      return new Date(current.startTime).getTime() > new Date(best.startTime).getTime() ? current : best;
    }, null);
    if (candidate) analyzeCallById(candidate.callId);
  };

  const openFindingLink = (link: NonNullable<ForensicFinding["link"]>) => {
    switch (link.type) {
      case "capture":
        navigateTo("packet-capture", "analysis", { packetCaptureSessionId: link.id });
        return;
      case "call":
        analyzeCallById(link.id);
        openSubview("calls");
        return;
      case "registrar":
        navigateTo("registration");
        return;
      case "fax":
        navigateTo("fax-center", "faxes");
        return;
      case "network":
        navigateTo("network-test", link.id);
        return;
      default: {
        const _exhaustive: never = link.type;
        return _exhaustive;
      }
    }
  };

  return (
    <div className="min-h-full w-full p-4 md:p-6 flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-foreground">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">Home</h1>
            <p className="text-sm text-muted-foreground">
              Overview and quick links. Use the tabs above for deep VoIP/SIP analysis (call quality, timeline, findings, SIP & RTP).
              {lastHealthRefreshAt && (
                <span className="ml-2">· Data as of {new Date(lastHealthRefreshAt).toLocaleString()}</span>
              )}
            </p>
          </div>
        </div>
        <TooltipWrapper title="Refresh" description="Reload registration health and troubleshooting data.">
          <Button variant="neutral" size="sm" onClick={() => refresh()} disabled={loadingHealth} className="gap-2">
            {loadingHealth ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </TooltipWrapper>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground mr-1">Quick actions</span>
        <TooltipWrapper title="Open Registration" description="Open the Registration tool to test and manage SIP registrars.">
          <Button variant="neutral" size="sm" onClick={openRegistrationTool} className="gap-2">
            <Server className="h-3.5 w-3.5" />
            Open Registration
          </Button>
        </TooltipWrapper>
        <TooltipWrapper title="Open Packet Monitor" description="Open Packet Monitor to capture and inspect network traffic.">
          <Button variant="neutral" size="sm" onClick={() => navigateTo("packet-capture", "analysis")} className="gap-2">
            <Network className="h-3.5 w-3.5" />
            Open Packet Monitor
          </Button>
        </TooltipWrapper>
        <TooltipWrapper title="Open Soft Phone" description="Open the Soft Phone tool to place test calls.">
          <Button variant="neutral" size="sm" onClick={() => navigateTo("soft-phone")} className="gap-2">
            <PhoneCall className="h-3.5 w-3.5" />
            Open Soft Phone
          </Button>
        </TooltipWrapper>
      </div>

      {error && (
        <div className="flex items-center gap-2 mb-6 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Summary cards */}
      {recentTimeline.length === 0 && recentFindings.length === 0 && recentCaptures.length === 0 && (
        <EmptyState
          variant="inline"
          title="Get started"
          description="Open Registration to run tests, start a capture, or place a call."
          action={
            <div className="flex flex-wrap gap-2">
              <TooltipWrapper title="Open Registration" description="Open the Registration tool to run tests.">
                <Button size="sm" variant="neutral" className="gap-1.5" onClick={openRegistrationTool}>
                  <Server className="h-3.5 w-3.5" />
                  Open Registration
                </Button>
              </TooltipWrapper>
              <TooltipWrapper title="Start a capture" description="Open Packet Monitor and start a new capture.">
                <Button size="sm" variant="neutral" className="gap-1.5" onClick={() => navigateTo("packet-capture", "analysis")}>
                  <Network className="h-3.5 w-3.5" />
                  Start a capture
                </Button>
              </TooltipWrapper>
              <TooltipWrapper title="View Findings" description="Open the Findings tab to see diagnostic results.">
                <Button size="sm" variant="neutral" className="gap-1.5" onClick={() => openSubview("findings")}>
                  <Search className="h-3.5 w-3.5" />
                  View Findings
                </Button>
              </TooltipWrapper>
            </div>
          }
          className="mb-6"
        />
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
        <Card
          className="cursor-pointer transition-smooth hover:shadow-card-hover"
          onClick={openRegistrationTool}
        >
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              Registration
            </CardTitle>
          </CardHeader>
          <CardContent>
            {registrationHealth ? (
              <>
                <p className="text-2xl font-semibold">
                  {upCount} <span className="text-muted-foreground font-normal">/ {totalRegistrars}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {registrationHealth.metrics?.test_success_rate != null &&
                    `${((registrationHealth.metrics.test_success_rate as number) * 100).toFixed(0)}% pass rate`}
                  {registrationHealth.metrics?.average_response_time != null &&
                    ` · ${registrationHealth.metrics.average_response_time}ms avg`}
                </p>
                <p className="text-xs text-foreground mt-1.5 font-medium">Open Registration tool →</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{loadingHealth ? "Loading…" : "Open Registration to test"}</p>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-smooth hover:shadow-card-hover"
          onClick={() => openSubview("findings")}
        >
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Findings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{findings.length}</p>
            <div className="flex gap-2 mt-1 text-xs flex-wrap">
              {criticalCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {criticalCount} critical
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {warningCount} warning
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-smooth hover:shadow-card-hover"
          onClick={() => {
            analyzeBestCandidateCall();
            switchToTab("calls");
          }}
        >
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              Calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{callQualitySummaries.length}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {poorQualityCount > 0 ? (
                <span className="text-warning dark:text-warning">{poorQualityCount} poor quality</span>
              ) : (
                "Recent call history"
              )}
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-smooth hover:shadow-card-hover"
          onClick={() => switchToTab("timeline")}
        >
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-muted-foreground" />
              Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{timeline.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Events (registration, calls, fax, network)</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 flex-1 min-h-0">
        {/* Recent timeline */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="py-3 flex flex-row items-center justify-between shrink-0">
            <CardTitle
              className="text-base flex items-center gap-2 cursor-pointer hover:text-foreground transition-smooth"
              onClick={() => switchToTab("timeline")}
            >
              <ListOrdered className="h-4 w-4 text-muted-foreground" />
              Recent timeline
            </CardTitle>
            <TooltipWrapper title="View all" description="Open the full timeline view.">
              <Button variant="ghost" size="sm" onClick={() => switchToTab("timeline")}>
                View all
              </Button>
            </TooltipWrapper>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 flex flex-col">
            {recentTimeline.length === 0 ? (
              <EmptyState
                compact
                variant="inline"
                title="No events yet"
                description="Run registration tests, network checks, or place calls."
              />
            ) : (
              <ul className="space-y-2 flex-1 min-h-0 overflow-y-auto">
                {recentTimeline.map((entry: ForensicsTimelineEntry) => (
                  <li
                    key={entry.id}
                    onClick={() => switchToTab("timeline")}
                    className={cn(
                      "flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-smooth",
                      entry.success === false && "bg-destructive/5 text-destructive"
                    )}
                  >
                    {entry.success === true && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
                    {entry.success === false && <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                    <span className="text-muted-foreground shrink-0 w-20">{formatTime(entry.timestamp)}</span>
                    <span className="truncate">{entry.label}</span>
                    {entry.detail && (
                      <span className="text-muted-foreground text-xs shrink-0">{entry.detail}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent findings */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="py-3 flex flex-row items-center justify-between shrink-0">
            <CardTitle
              className="text-base flex items-center gap-2 cursor-pointer hover:text-foreground transition-smooth"
              onClick={() => switchToTab("findings")}
            >
              <Search className="h-4 w-4 text-muted-foreground" />
              Findings
            </CardTitle>
            <TooltipWrapper title="View all" description="Open the full findings view.">
              <Button variant="ghost" size="sm" onClick={() => switchToTab("findings")}>
                View all
              </Button>
            </TooltipWrapper>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 flex flex-col">
            {recentFindings.length === 0 ? (
              <EmptyState
                variant="inline"
                compact
                title="No findings"
                description="Registration, calls, and recent network checks look healthy."
                className="items-start py-4 pt-4 text-left"
              />
            ) : (
              <ul className="space-y-2 flex-1 min-h-0 overflow-y-auto">
                {recentFindings.map((f: ForensicFinding) => {
                  const isExpanded = expandedFindingIds.has(f.id);
                  const descriptionLong = f.description && f.description.length > LONG_DESCRIPTION_LENGTH;
                  const confidenceCopy = getFindingConfidenceCopy(f);
                  const findingLink = f.link ?? null;
                  const linkConfig = findingLink ? FINDING_LINK_CONFIG[findingLink.type] : null;
                  return (
                    <li
                      key={f.id}
                      onClick={() => switchToTab("findings")}
                      className="flex items-start gap-2 text-sm py-2 px-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-smooth"
                    >
                      {descriptionLong ? (
                        <TooltipWrapper title={isExpanded ? "Collapse" : "Expand"} description={isExpanded ? "Collapse this finding's description." : "Expand to show full description."}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFindingExpand(f.id);
                            }}
                            className="shrink-0 p-0.5 rounded hover:bg-muted -m-0.5 mt-0.5"
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                        </TooltipWrapper>
                      ) : (
                        <span className="w-3.5 shrink-0 inline-block" aria-hidden />
                      )}
                      <Badge
                        variant={f.severity === "critical" ? "destructive" : "secondary"}
                        className="text-xs shrink-0"
                      >
                        {f.severity}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{f.title}</p>
                        {f.description && (
                          <p className="text-muted-foreground text-xs mt-0.5">
                            {descriptionLong && !isExpanded
                              ? `${f.description.slice(0, LONG_DESCRIPTION_LENGTH)}…`
                              : f.description}
                          </p>
                        )}
                        {confidenceCopy && (
                          <p className="text-muted-foreground text-xs mt-1">
                            {confidenceCopy}
                            {f.uncertaintyState === "uncertain" ? " (not definitive)" : ""}
                          </p>
                        )}
                        {f.uncertaintyReasons && f.uncertaintyReasons.length > 0 && (
                          <p className="text-muted-foreground text-xs mt-0.5">
                            {f.uncertaintyReasons.map((reason) => reason.message).join(" ")}
                          </p>
                        )}
                        {findingLink && linkConfig && (
                          <TooltipWrapper title={linkConfig.actionText} description={linkConfig.description}>
                            <Button
                              variant="link"
                              className="h-auto p-0 text-xs mt-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openFindingLink(findingLink);
                              }}
                            >
                              {linkConfig.actionText} →
                            </Button>
                          </TooltipWrapper>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent captures */}
      <Card className="mt-6">
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle
            className="text-base flex items-center gap-2 cursor-pointer hover:text-foreground transition-smooth"
            onClick={() => navigateTo("packet-capture", "analysis")}
          >
            <Layers className="h-4 w-4 text-muted-foreground" />
            Recent captures
          </CardTitle>
          <TooltipWrapper title="Packet Monitor" description="Open Packet Monitor to view and manage captures.">
            <Button variant="ghost" size="sm" onClick={() => navigateTo("packet-capture", "analysis")}>
              <Network className="h-4 w-4 mr-1" />
              Packet Monitor
            </Button>
          </TooltipWrapper>
        </CardHeader>
        <CardContent>
          {recentCaptures.length === 0 ? (
            <EmptyState compact variant="inline" title="No captures yet" description="Start a capture from Packet Monitor or place a call." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {recentCaptures.map((session: CaptureSession) => (
                <TooltipWrapper key={session.id} title="Open in viewer" description={`Open this capture (${session.name || session.id}) in the packet capture viewer.`}>
                <Button
                  variant="neutral"
                  size="sm"
                  className="gap-2 text-left justify-start max-w-full"
                  onClick={() => openCaptureInMonitor(session)}
                >
                  <Layers className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{session.name || session.id}</span>
                  <span className="text-muted-foreground text-xs shrink-0">
                    {formatTime(session.startTime)}
                  </span>
                </Button>
              </TooltipWrapper>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
