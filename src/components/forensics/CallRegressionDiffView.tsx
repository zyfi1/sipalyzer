import { useEffect, useMemo, useState } from "react";
import { getCallSessions, getRtpStreams, getSipDialogs, getCapturePacketsRange } from "@/api/packetCapture";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { cn } from "@/lib/utils";
import { useOpenCapture } from "@/hooks/useOpenCapture";
import { navigateTo } from "@/lib/navigation";
import { buildPacketDiffRows } from "./packet-diff/packetDiffEngine";
import type { PacketDiffAlignmentMode } from "./packet-diff/packetDiffEngine";
import { PacketDiffSplitView } from "./packet-diff/PacketDiffSplitView";
import {
  GitCompareArrows,
  Loader2,
  AlertTriangle,
  ExternalLink,
  CheckCircle,
  XCircle,
  Circle,
  Search,
} from "@/lib/icons";
import type { CaptureSession, PacketInfo, RtpStreamInfo } from "@/types/packetCapture";
import type { ReconstructedCallSession, SipDialog } from "@/types/forensics";

interface CallRegressionDiffViewProps {
  sessions: CaptureSession[];
  preferredAfterSessionId?: string | null;
}

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

function formatSeconds(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}s`;
}

function safeAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

type SessionData = {
  calls: ReconstructedCallSession[];
  dialogs: SipDialog[];
  rtpStreams: RtpStreamInfo[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
};

type CallSnapshot = {
  sessionId: string;
  sessionName: string;
  call: ReconstructedCallSession;
  primaryCallId: string | null;
  callIds: string[];
  sipMessageCount: number;
  signalingPacketCount: number;
  mediaStreamCount: number;
  rtpPacketCount: number;
  avgMos: number | null;
  avgJitterMs: number | null;
  avgLossPercent: number | null;
  criticalAnomalyCount: number;
  warningAnomalyCount: number;
  faxEventCount: number;
};

const PACKET_DIFF_FETCH_LIMIT = 3000;
const PACKET_DIFF_PACKET_LIMIT = 1200;
const PACKET_DIFF_ROW_LIMIT = 500;

function compactText(value: string, max = 48): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function callTriggerLabel(call: ReconstructedCallSession | null): string {
  if (!call) return "";
  const parties = partiesLabel(call);
  return `${parties} · ${prettyDisposition(call.disposition)} · ${formatSeconds(call.durationSec ?? null)}`;
}

function compactCallTriggerLabel(call: ReconstructedCallSession | null): string {
  return compactText(callTriggerLabel(call), 72);
}

function sessionTriggerLabel(session: CaptureSession | null): string {
  if (!session) return "";
  return compactText(`${session.name} · ${formatDateTime(session.startTime)}`, 72);
}

function formatPartyLabel(value: string | undefined): string {
  if (!value) return "Unknown";
  const cleaned = value.replace(/[<>"]/g, "").trim();
  const sipMatch = cleaned.match(/^(?:sips?:)?([^@;]+)@?([^;]+)?/i);
  if (sipMatch) {
    const user = (sipMatch[1] ?? "").trim();
    const host = (sipMatch[2] ?? "").trim();
    if (user && host) return `${user}@${host}`;
    if (user) return user;
    if (host) return host;
  }
  return cleaned || "Unknown";
}

function partiesLabel(call: ReconstructedCallSession): string {
  const left = formatPartyLabel(call.parties[0]);
  const right = formatPartyLabel(call.parties[1]);
  return `${left} ↔ ${right}`;
}


function prettyDisposition(value: ReconstructedCallSession["disposition"]): string {
  if (!value) return "Unknown";
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function dispositionUi(value: ReconstructedCallSession["disposition"]): {
  icon: typeof CheckCircle;
  className: string;
  bg: string;
} {
  switch (value) {
    case "answered":
      return { icon: CheckCircle, className: "text-success", bg: "bg-success/[0.08]" };
    case "failed":
    case "busy":
      return { icon: XCircle, className: "text-destructive", bg: "bg-destructive/[0.08]" };
    case "cancelled":
    case "no-answer":
      return { icon: AlertTriangle, className: "text-warning", bg: "bg-warning/[0.08]" };
    case "in-progress":
      return { icon: Circle, className: "text-primary", bg: "bg-primary/[0.08]" };
    default:
      return { icon: Circle, className: "text-muted-foreground", bg: "bg-muted/30" };
  }
}

function packetCallId(packet: PacketInfo): string | null {
  const app = packet.decoded?.application;
  if (!app) return null;
  if (app.type === "Sip") return app.data.callId ?? null;
  if (app.type === "SipOverWs") return app.data.sip.callId ?? null;
  return null;
}

export function CallRegressionDiffView({
  sessions,
  preferredAfterSessionId,
}: CallRegressionDiffViewProps) {
  const { openViewer } = useOpenCapture();
  const orderedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      ),
    [sessions],
  );
  const [beforeSessionId, setBeforeSessionId] = useState<string>("");
  const [afterSessionId, setAfterSessionId] = useState<string>("");
  const [beforeCallId, setBeforeCallId] = useState<string>("");
  const [afterCallId, setAfterCallId] = useState<string>("");
  const [beforeSessionSearch, setBeforeSessionSearch] = useState("");
  const [afterSessionSearch, setAfterSessionSearch] = useState("");
  const [beforeCallSearch, setBeforeCallSearch] = useState("");
  const [afterCallSearch, setAfterCallSearch] = useState("");
  const [sessionData, setSessionData] = useState<Record<string, SessionData>>({});

  useEffect(() => {
    if (orderedSessions.length === 0) {
      setBeforeSessionId("");
      setAfterSessionId("");
      return;
    }
    setAfterSessionId((prev) => {
      if (prev && orderedSessions.some((session) => session.id === prev)) return prev;
      if (
        preferredAfterSessionId &&
        orderedSessions.some((session) => session.id === preferredAfterSessionId)
      ) {
        return preferredAfterSessionId;
      }
      return orderedSessions[0]?.id ?? "";
    });
  }, [orderedSessions, preferredAfterSessionId]);

  useEffect(() => {
    setBeforeSessionId((prev) => {
      if (prev && orderedSessions.some((session) => session.id === prev)) {
        return prev;
      }
      const candidate = orderedSessions.find((session) => session.id !== afterSessionId);
      return candidate?.id ?? "";
    });
  }, [orderedSessions, afterSessionId]);

  const beforeSession = useMemo(
    () => orderedSessions.find((session) => session.id === beforeSessionId) ?? null,
    [orderedSessions, beforeSessionId],
  );
  const afterSession = useMemo(
    () => orderedSessions.find((session) => session.id === afterSessionId) ?? null,
    [orderedSessions, afterSessionId],
  );

  useEffect(() => {
    const ids = [beforeSessionId, afterSessionId].filter(Boolean);
    for (const sessionId of ids) {
      const existing = sessionData[sessionId];
      if (existing && (existing.loading || existing.loaded)) continue;
      setSessionData((prev) => ({
        ...prev,
        [sessionId]: {
          calls: [],
          dialogs: [],
          rtpStreams: [],
          loading: true,
          loaded: false,
          error: null,
        },
      }));
      void Promise.all([
        getCallSessions(sessionId),
        getSipDialogs(sessionId),
        getRtpStreams(sessionId),
      ])
        .then(([calls, dialogs, rtpStreams]) => {
          setSessionData((prev) => ({
            ...prev,
            [sessionId]: { calls, dialogs, rtpStreams, loading: false, loaded: true, error: null },
          }));
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setSessionData((prev) => ({
            ...prev,
            [sessionId]: {
              calls: [],
              dialogs: [],
              rtpStreams: [],
              loading: false,
              loaded: true,
              error: message,
            },
          }));
        });
    }
  }, [beforeSessionId, afterSessionId, sessionData]);

  const beforeData = sessionData[beforeSessionId];
  const afterData = sessionData[afterSessionId];

  useEffect(() => {
    const calls = beforeData?.calls ?? [];
    setBeforeCallId((prev) => {
      if (prev && calls.some((call) => call.id === prev)) return prev;
      return calls[0]?.id ?? "";
    });
    setBeforeCallSearch("");
  }, [beforeData]);

  useEffect(() => {
    const calls = afterData?.calls ?? [];
    setAfterCallId((prev) => {
      if (prev && calls.some((call) => call.id === prev)) return prev;
      return calls[0]?.id ?? "";
    });
    setAfterCallSearch("");
  }, [afterData]);

  useEffect(() => {
    if (!beforeSessionId || !afterSessionId || !beforeCallId || !afterCallId) return;
    if (beforeSessionId !== afterSessionId) return;
    if (beforeCallId !== afterCallId) return;
    const alternatives = (afterData?.calls ?? []).filter((call) => call.id !== beforeCallId);
    if (alternatives.length > 0) {
      const next = alternatives[0];
      if (next) setAfterCallId(next.id);
      return;
    }
    setAfterCallId("");
  }, [beforeSessionId, afterSessionId, beforeCallId, afterCallId, afterData]);

  const escapeFilterValue = (value: string): string =>
    value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const openCallInViewer = (sessionId: string, callId: string) => {
    const filter = `sip.Call-ID == "${escapeFilterValue(callId)}"`;
    openViewer(sessionId, undefined, { filter });
    navigateTo("packet-capture", "viewer", { packetCaptureSessionId: sessionId });
  };

  const openPacketInViewer = (sessionId: string, packetIndex: number) => {
    const frameNumber = packetIndex + 1;
    const filter = `frame.number == ${frameNumber}`;
    openViewer(sessionId, undefined, { filter });
    navigateTo("packet-capture", "viewer", { packetCaptureSessionId: sessionId });
  };

  const makeSnapshot = (
    sideSessionId: string,
    sideSessionName: string,
    selectedCallId: string,
    data: SessionData | undefined,
  ): CallSnapshot | null => {
    if (!data) return null;
    const call = data.calls.find((row) => row.id === selectedCallId);
    if (!call) return null;
    const legCallIds = call.legs.map((leg) => leg.callId).filter((id): id is string => Boolean(id));
    const primaryCallId = legCallIds[0] ?? null;
    const callIdSet = new Set(legCallIds);
    const sipMessageCount = data.dialogs
      .filter((dialog) => callIdSet.has(dialog.callId))
      .reduce((sum, dialog) => sum + dialog.messages.length, 0);
    const signalingPacketCount = call.events.filter((event) => typeof event.packetIndex === "number").length;
    const ssrcSet = new Set(call.mediaRefs.map((ref) => ref.ssrc).filter((ssrc): ssrc is number => typeof ssrc === "number"));
    const relatedRtp = data.rtpStreams.filter((stream) => ssrcSet.has(stream.ssrc));
    const avgMos = safeAverage(relatedRtp.map((row) => row.mosScore).filter(Number.isFinite));
    const avgJitterMs = safeAverage(relatedRtp.map((row) => row.jitter).filter(Number.isFinite));
    const avgLossPercent = safeAverage(relatedRtp.map((row) => row.lossPercentage).filter(Number.isFinite));
    const rtpPacketCount = relatedRtp.reduce((sum, row) => sum + row.packetCount, 0);
    const criticalAnomalyCount = call.anomalies.filter((anomaly) => anomaly.severity === "critical").length;
    const warningAnomalyCount = call.anomalies.filter((anomaly) => anomaly.severity === "warning").length;
    const faxEventCount = call.events.filter((event) => {
      const type = event.type.toLowerCase();
      const label = event.label.toLowerCase();
      return type.includes("fax") || label.includes("fax");
    }).length;
    return {
      sessionId: sideSessionId,
      sessionName: sideSessionName,
      call,
      primaryCallId,
      callIds: legCallIds,
      sipMessageCount,
      signalingPacketCount,
      mediaStreamCount: call.mediaRefs.length,
      rtpPacketCount,
      avgMos,
      avgJitterMs,
      avgLossPercent,
      criticalAnomalyCount,
      warningAnomalyCount,
      faxEventCount,
    };
  };

  const leftSnapshot = useMemo(
    () =>
      makeSnapshot(
        beforeSessionId,
        beforeSession?.name ?? "Call A",
        beforeCallId,
        beforeData,
      ),
    [beforeSessionId, beforeSession?.name, beforeCallId, beforeData],
  );
  const rightSnapshot = useMemo(
    () =>
      makeSnapshot(
        afterSessionId,
        afterSession?.name ?? "Call B",
        afterCallId,
        afterData,
      ),
    [afterSessionId, afterSession?.name, afterCallId, afterData],
  );

  const beforeSessionOptions = useMemo(() => {
    const q = beforeSessionSearch.trim().toLowerCase();
    if (!q) return orderedSessions;
    return orderedSessions.filter((session) => {
      const haystack = `${session.name} ${session.interface} ${session.status} ${session.packetCount}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [orderedSessions, beforeSessionSearch]);

  const afterSessionOptions = useMemo(() => {
    const q = afterSessionSearch.trim().toLowerCase();
    if (!q) return orderedSessions;
    return orderedSessions.filter((session) => {
      const haystack = `${session.name} ${session.interface} ${session.status} ${session.packetCount}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [orderedSessions, afterSessionSearch]);

  const beforeCallOptions = useMemo(() => {
    const q = beforeCallSearch.trim().toLowerCase();
    const calls = beforeData?.calls ?? [];
    if (!q) return calls;
    return calls.filter((call) => {
      const haystack = `${call.id} ${call.disposition} ${call.parties.join(" ")} ${partiesLabel(call)} ${call.legs.map((l) => l.callId ?? "").join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [beforeData, beforeCallSearch]);

  const afterCallOptions = useMemo(() => {
    const q = afterCallSearch.trim().toLowerCase();
    const calls = afterData?.calls ?? [];
    if (!q) return calls;
    return calls.filter((call) => {
      const haystack = `${call.id} ${call.disposition} ${call.parties.join(" ")} ${partiesLabel(call)} ${call.legs.map((l) => l.callId ?? "").join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [afterData, afterCallSearch]);

  const [packetDiffMode, setPacketDiffMode] = useState<PacketDiffAlignmentMode>("flow");
  const [timestampWindowMsText, setTimestampWindowMsText] = useState("250");
  const [showMismatchesOnly, setShowMismatchesOnly] = useState(true);
  const [packetDiffLoading, setPacketDiffLoading] = useState(false);
  const [packetDiffError, setPacketDiffError] = useState<string | null>(null);
  const [leftPackets, setLeftPackets] = useState<PacketInfo[]>([]);
  const [rightPackets, setRightPackets] = useState<PacketInfo[]>([]);
  const timestampWindowMs = useMemo(() => {
    const parsed = Number(timestampWindowMsText);
    if (!Number.isFinite(parsed) || parsed < 0) return 250;
    return parsed;
  }, [timestampWindowMsText]);

  useEffect(() => {
    if (!leftSnapshot || !rightSnapshot) {
      setLeftPackets([]);
      setRightPackets([]);
      setPacketDiffError(null);
      return;
    }
    let cancelled = false;
    setPacketDiffLoading(true);
    setPacketDiffError(null);

    Promise.all([
      getCapturePacketsRange(leftSnapshot.sessionId, 0, PACKET_DIFF_FETCH_LIMIT),
      getCapturePacketsRange(rightSnapshot.sessionId, 0, PACKET_DIFF_FETCH_LIMIT),
    ])
      .then(([left, right]) => {
        if (cancelled) return;
        const leftCallIdSet = new Set(leftSnapshot.callIds.filter(Boolean));
        const rightCallIdSet = new Set(rightSnapshot.callIds.filter(Boolean));
        const filteredLeft =
          leftCallIdSet.size > 0
            ? left.filter((packet) => {
                const callId = packetCallId(packet);
                return callId ? leftCallIdSet.has(callId) : false;
              })
            : left;
        const filteredRight =
          rightCallIdSet.size > 0
            ? right.filter((packet) => {
                const callId = packetCallId(packet);
                return callId ? rightCallIdSet.has(callId) : false;
              })
            : right;
        setLeftPackets(filteredLeft.slice(0, PACKET_DIFF_PACKET_LIMIT));
        setRightPackets(filteredRight.slice(0, PACKET_DIFF_PACKET_LIMIT));
      })
      .catch((error) => {
        if (cancelled) return;
        setLeftPackets([]);
        setRightPackets([]);
        setPacketDiffError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setPacketDiffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leftSnapshot, rightSnapshot]);

  const packetDiffRows = useMemo(
    () =>
      buildPacketDiffRows(leftPackets, rightPackets, {
        mode: packetDiffMode,
        timestampWindowMs,
        maxRows: PACKET_DIFF_ROW_LIMIT,
        showMismatchesOnly,
      }),
    [leftPackets, rightPackets, packetDiffMode, timestampWindowMs, showMismatchesOnly],
  );

  const handleOpenPacket = (side: "left" | "right", packetIndex: number) => {
    const sessionId = side === "left" ? beforeSessionId : afterSessionId;
    openPacketInViewer(sessionId, packetIndex);
  };

  const anyLoading = Boolean(beforeData?.loading || afterData?.loading);
  const errorMessage = beforeData?.error ?? afterData?.error ?? null;
  const sameCallSelected =
    Boolean(beforeSessionId) &&
    Boolean(afterSessionId) &&
    Boolean(beforeCallId) &&
    Boolean(afterCallId) &&
    beforeSessionId === afterSessionId &&
    beforeCallId === afterCallId;

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <div className="shrink-0 border-b border-border/30 px-2 py-2">
        <div className="flex items-center">
          <span className="section-label-sm">Packet Diff</span>
        </div>

        <div className="mt-2 surface-flat p-2">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1.5 items-end">
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-muted-foreground">Left session</div>
            <Select value={beforeSessionId} onValueChange={(value) => {
              setBeforeSessionId(value);
              setBeforeSessionSearch("");
            }}>
              <TooltipWrapper entry={tooltips.packetDiffLeftSession}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="Select left session">
                    {sessionTriggerLabel(beforeSession)}
                  </SelectValue>
                </SelectTrigger>
              </TooltipWrapper>
              <SelectContent className="min-w-[var(--radix-select-trigger-width)] w-[min(520px,92vw)] max-w-[92vw] isolate p-0" position="popper">
                <div
                  className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/40 bg-[hsl(var(--card)/1)] px-2.5 py-2"
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    placeholder="Search sessions..."
                    value={beforeSessionSearch}
                    onChange={(e) => setBeforeSessionSearch(e.target.value)}
                    className="h-7 rounded-[var(--radius-md)] border-border/45 bg-[hsl(var(--background)/0.88)] shadow-none text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                {beforeSessionOptions.length === 0 ? (
                  <EmptyState compact variant="inline" title="No sessions match" />
                ) : beforeSessionOptions.map((session) => (
                  <SelectItem key={`before-${session.id}`} value={session.id} className="py-1.5 pl-2 pr-8 cursor-pointer">
                    <div className="flex w-full items-center gap-3 min-w-0">
                      <div className={cn(
                        "shrink-0 flex items-center justify-center w-6 h-6 rounded",
                        session.status.toLowerCase() === "running" ? "bg-success/[0.08]" : "bg-muted/30",
                      )}>
                        <Circle className={cn(
                          "h-3.5 w-3.5",
                          session.status.toLowerCase() === "running" ? "text-success" : "text-muted-foreground",
                        )} />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="font-semibold text-foreground truncate">{session.name}</span>
                        <span className="text-2xs text-muted-foreground truncate">
                          {session.packetCount.toLocaleString()} packets · {formatDateTime(session.startTime)}
                        </span>
                      </div>
                      <Badge variant="outline" className="h-5 px-1.5 text-3xs shrink-0">
                        {session.status}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-muted-foreground">Left call</div>
            <Select value={beforeCallId} onValueChange={(value) => {
              setBeforeCallId(value);
              setBeforeCallSearch("");
            }}>
              <TooltipWrapper entry={tooltips.packetDiffLeftCall}>
                <SelectTrigger className="h-8 w-full text-xs ui-control-shell">
                  <SelectValue placeholder="Select left call">
                    {compactCallTriggerLabel((beforeData?.calls ?? []).find((call) => call.id === beforeCallId) ?? null)}
                  </SelectValue>
                </SelectTrigger>
              </TooltipWrapper>
              <SelectContent className="min-w-[var(--radix-select-trigger-width)] w-[min(520px,92vw)] max-w-[92vw] isolate p-0" position="popper">
                <div
                  className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/40 bg-[hsl(var(--card)/1)] px-2.5 py-2"
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    placeholder="Search calls..."
                    value={beforeCallSearch}
                    onChange={(e) => setBeforeCallSearch(e.target.value)}
                    className="h-7 rounded-[var(--radius-md)] border-border/45 bg-[hsl(var(--background)/0.88)] shadow-none text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                {beforeCallOptions.length === 0 ? (
                  <EmptyState compact variant="inline" title="No calls match" />
                ) : beforeCallOptions.map((call) => {
                  const ui = dispositionUi(call.disposition);
                  const StatusIcon = ui.icon;
                  const parties = partiesLabel(call);
                  const callId = call.legs.find((leg) => typeof leg.callId === "string")?.callId ?? call.id;
                  const isDuplicate = beforeSessionId === afterSessionId && call.id === afterCallId;
                  return (
                    <SelectItem
                      key={`before-call-${call.id}`}
                      value={call.id}
                      className="py-1.5 pl-2 pr-8 cursor-pointer"
                      disabled={isDuplicate}
                    >
                      <div className="flex w-full items-start gap-3 min-w-0">
                        <div className={cn("shrink-0 flex items-center justify-center w-6 h-6 rounded", ui.bg)}>
                          <StatusIcon className={cn("h-3.5 w-3.5", ui.className)} />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.75">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-foreground truncate" title={parties || "Unknown parties"}>
                              {parties || "Unknown parties"}
                            </span>
                            <Badge variant="outline" className="h-4 px-1 text-3xs shrink-0">
                              {prettyDisposition(call.disposition)}
                            </Badge>
                          </div>
                          <span className="text-3xs text-muted-foreground font-mono truncate" title={callId}>
                            {callId}
                          </span>
                        </div>
                        <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                          {formatSeconds(call.durationSec ?? null)}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-muted-foreground">Right session</div>
            <Select value={afterSessionId} onValueChange={(value) => {
              setAfterSessionId(value);
              setAfterSessionSearch("");
            }}>
              <TooltipWrapper entry={tooltips.packetDiffRightSession}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="Select right session">
                    {sessionTriggerLabel(afterSession)}
                  </SelectValue>
                </SelectTrigger>
              </TooltipWrapper>
              <SelectContent className="min-w-[var(--radix-select-trigger-width)] w-[min(520px,92vw)] max-w-[92vw] isolate p-0" position="popper">
                <div
                  className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/40 bg-[hsl(var(--card)/1)] px-2.5 py-2"
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    placeholder="Search sessions..."
                    value={afterSessionSearch}
                    onChange={(e) => setAfterSessionSearch(e.target.value)}
                    className="h-7 rounded-[var(--radius-md)] border-border/45 bg-[hsl(var(--background)/0.88)] shadow-none text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                {afterSessionOptions.length === 0 ? (
                  <EmptyState compact variant="inline" title="No sessions match" />
                ) : afterSessionOptions.map((session) => (
                  <SelectItem key={`after-${session.id}`} value={session.id} className="py-1.5 pl-2 pr-8 cursor-pointer">
                    <div className="flex w-full items-center gap-3 min-w-0">
                      <div className={cn(
                        "shrink-0 flex items-center justify-center w-6 h-6 rounded",
                        session.status.toLowerCase() === "running" ? "bg-success/[0.08]" : "bg-muted/30",
                      )}>
                        <Circle className={cn(
                          "h-3.5 w-3.5",
                          session.status.toLowerCase() === "running" ? "text-success" : "text-muted-foreground",
                        )} />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="font-semibold text-foreground truncate">{session.name}</span>
                        <span className="text-2xs text-muted-foreground truncate">
                          {session.packetCount.toLocaleString()} packets · {formatDateTime(session.startTime)}
                        </span>
                      </div>
                      <Badge variant="outline" className="h-5 px-1.5 text-3xs shrink-0">
                        {session.status}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-muted-foreground">Right call</div>
            <Select value={afterCallId} onValueChange={(value) => {
              setAfterCallId(value);
              setAfterCallSearch("");
            }}>
              <TooltipWrapper entry={tooltips.packetDiffRightCall}>
                <SelectTrigger className="h-8 w-full text-xs ui-control-shell">
                  <SelectValue placeholder="Select right call">
                    {compactCallTriggerLabel((afterData?.calls ?? []).find((call) => call.id === afterCallId) ?? null)}
                  </SelectValue>
                </SelectTrigger>
              </TooltipWrapper>
              <SelectContent className="min-w-[var(--radix-select-trigger-width)] w-[min(520px,92vw)] max-w-[92vw] isolate p-0" position="popper">
                <div
                  className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/40 bg-[hsl(var(--card)/1)] px-2.5 py-2"
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    placeholder="Search calls..."
                    value={afterCallSearch}
                    onChange={(e) => setAfterCallSearch(e.target.value)}
                    className="h-7 rounded-[var(--radius-md)] border-border/45 bg-[hsl(var(--background)/0.88)] shadow-none text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                {afterCallOptions.length === 0 ? (
                  <EmptyState compact variant="inline" title="No calls match" />
                ) : afterCallOptions.map((call) => {
                  const ui = dispositionUi(call.disposition);
                  const StatusIcon = ui.icon;
                  const parties = partiesLabel(call);
                  const callId = call.legs.find((leg) => typeof leg.callId === "string")?.callId ?? call.id;
                  const isDuplicate = beforeSessionId === afterSessionId && call.id === beforeCallId;
                  return (
                    <SelectItem
                      key={`after-call-${call.id}`}
                      value={call.id}
                      className="py-1.5 pl-2 pr-8 cursor-pointer"
                      disabled={isDuplicate}
                    >
                      <div className="flex w-full items-start gap-3 min-w-0">
                        <div className={cn("shrink-0 flex items-center justify-center w-6 h-6 rounded", ui.bg)}>
                          <StatusIcon className={cn("h-3.5 w-3.5", ui.className)} />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.75">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-foreground truncate" title={parties || "Unknown parties"}>
                              {parties || "Unknown parties"}
                            </span>
                            <Badge variant="outline" className="h-4 px-1 text-3xs shrink-0">
                              {prettyDisposition(call.disposition)}
                            </Badge>
                          </div>
                          <span className="text-3xs text-muted-foreground font-mono truncate" title={callId}>
                            {callId}
                          </span>
                        </div>
                        <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                          {formatSeconds(call.durationSec ?? null)}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        {orderedSessions.length < 2 ? (
          <EmptyState
            variant="inline"
            icon={<GitCompareArrows />}
            title="Need two capture sessions"
            description="Import at least two captures to compare calls side by side."
          />
        ) : anyLoading ? (
          <EmptyState
            variant="inline"
            icon={<Loader2 className="animate-spin" />}
            title="Loading call data"
            description="Fetching call sessions, SIP dialogs, and RTP streams."
          />
        ) : errorMessage ? (
          <EmptyState
            variant="inline"
            icon={<AlertTriangle />}
            title="Comparison data load failed"
            description={errorMessage}
          />
        ) : sameCallSelected ? (
          <EmptyState
            variant="inline"
            icon={<GitCompareArrows />}
            title="Pick two different calls"
            description="Call A and Call B currently reference the same call in the same session. Select a different call on either side."
          />
        ) : !leftSnapshot || !rightSnapshot ? (
          <EmptyState
            variant="inline"
            icon={<GitCompareArrows />}
            title="Select two calls to compare"
            description="Pick one call on each side to render a direct side-by-side difference table."
          />
        ) : (
          <div className="space-y-2">
            <section className="surface border border-border/35 rounded-[var(--radius-lg)] overflow-hidden">
              <div className="px-2.5 py-2 border-b border-border/30 flex flex-wrap items-center gap-1.5">
                <TooltipWrapper entry={tooltips.packetDiffTitle}>
                  <span className="text-xs font-semibold">Packet Diff</span>
                </TooltipWrapper>
                <TooltipWrapper
                  title="Left call ID"
                  description={leftSnapshot.call.id}
                >
                  <Badge variant="outline" className="h-5 px-1.5 text-3xs ml-1">
                    L: {compactText(leftSnapshot.call.id, 20)}
                  </Badge>
                </TooltipWrapper>
                <TooltipWrapper
                  title="Right call ID"
                  description={rightSnapshot.call.id}
                >
                  <Badge variant="outline" className="h-5 px-1.5 text-3xs">
                    R: {compactText(rightSnapshot.call.id, 20)}
                  </Badge>
                </TooltipWrapper>
                <span className="text-3xs text-muted-foreground ml-auto">Align rows</span>
                <Select
                  value={packetDiffMode}
                  onValueChange={(value) => setPacketDiffMode(value as PacketDiffAlignmentMode)}
                >
                  <TooltipWrapper entry={tooltips.packetDiffAlignMode}>
                    <SelectTrigger className="h-7 w-[138px] text-3xs">
                      <SelectValue placeholder="Alignment" />
                    </SelectTrigger>
                  </TooltipWrapper>
                  <SelectContent>
                    <SelectItem value="index">index</SelectItem>
                    <SelectItem value="timestamp">timestamp</SelectItem>
                    <SelectItem value="flow">flow</SelectItem>
                  </SelectContent>
                </Select>
                {packetDiffMode === "timestamp" && (
                  <TooltipWrapper entry={tooltips.packetDiffTimestampWindow}>
                    <Input
                      type="number"
                      min={0}
                      value={timestampWindowMsText}
                      onChange={(e) => setTimestampWindowMsText(e.target.value)}
                      className="h-7 w-[126px] text-3xs"
                      aria-label="Timestamp window (ms)"
                      placeholder="Window (ms)"
                    />
                  </TooltipWrapper>
                )}
                <TooltipWrapper entry={tooltips.packetDiffMismatchesOnly}>
                  <Button
                    variant={showMismatchesOnly ? "default" : "neutral"}
                    size="sm"
                    className="h-7 px-2 text-3xs"
                    onClick={() => setShowMismatchesOnly((v) => !v)}
                  >
                    {showMismatchesOnly ? "Mismatches only: on" : "Mismatches only: off"}
                  </Button>
                </TooltipWrapper>
                {leftSnapshot.primaryCallId && (
                  <TooltipWrapper entry={tooltips.packetDiffOpenLeftCall}>
                    <Button
                      variant="neutral"
                      size="sm"
                      className="h-7 px-2 text-3xs"
                      onClick={() => openCallInViewer(leftSnapshot.sessionId, leftSnapshot.primaryCallId!)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Open L
                    </Button>
                  </TooltipWrapper>
                )}
                {rightSnapshot.primaryCallId && (
                  <TooltipWrapper entry={tooltips.packetDiffOpenRightCall}>
                    <Button
                      variant="neutral"
                      size="sm"
                      className="h-7 px-2 text-3xs"
                      onClick={() => openCallInViewer(rightSnapshot.sessionId, rightSnapshot.primaryCallId!)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Open R
                    </Button>
                  </TooltipWrapper>
                )}
              </div>
              <PacketDiffSplitView
                rows={packetDiffRows}
                loading={packetDiffLoading}
                error={packetDiffError}
                leftLabel="Left packet rows"
                rightLabel="Right packet rows"
                onOpenPacket={handleOpenPacket}
              />
            </section>

          </div>
        )}
      </div>
    </div>
  );
}
