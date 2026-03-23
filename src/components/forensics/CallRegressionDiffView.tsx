import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getCallSessions, getRtpStreams, getSipDialogs, getCapturePackets } from "@/api/packetCapture";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { AppDropdown, SelectItem } from "@/components/ui/app-dropdown";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { cn } from "@/lib/utils";
import { useOpenCapture } from "@/hooks/useOpenCapture";
import { navigateTo } from "@/lib/navigation";
import { defaultTrafficGroupSelection, type PacketTrafficGroupId } from "./packet-diff/packetDiffCategories";
import { PacketDiffControls } from "./packet-diff/PacketDiffControls";
import {
  alignPacketDiffRows,
  applyPacketDiffVisibilityFiltersWithCapMeta,
  computePacketDiffPairingHealth,
} from "./packet-diff/packetDiffEngine";
import type { PacketDiffAlignmentMode } from "./packet-diff/packetDiffEngine";
import { PacketDiffPairingHealthBar } from "./packet-diff/PacketDiffPairingHealthBar";
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
import {
  callMatchesTracePreset,
  primarySipCallId,
  traceHints,
  type CallTraceListPreset,
} from "./callTraceListFilter";
import { CallTracePresetBar } from "./CallTracePresetBar";

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

/** Best-effort SIP “shape” from reconstructed events (REGISTER vs INVITE call, etc.). */
function inferPrimarySipMethod(call: ReconstructedCallSession): string {
  const blob = call.events.map((e) => `${e.type} ${e.label} ${e.detail ?? ""} ${e.eventType ?? ""}`).join(" ").toUpperCase();
  if (/\bINVITE\b/.test(blob)) return "INVITE";
  if (/\bREGISTER\b/.test(blob)) return "REGISTER";
  if (/\bSUBSCRIBE\b/.test(blob)) return "SUBSCRIBE";
  if (/\bNOTIFY\b/.test(blob)) return "NOTIFY";
  if (/\bOPTIONS\b/.test(blob)) return "OPTIONS";
  if (/\bMESSAGE\b/.test(blob)) return "MESSAGE";
  if (/\bREFER\b/.test(blob)) return "REFER";
  if (/\bINFO\b/.test(blob)) return "INFO";
  if (/\bBYE\b/.test(blob)) return "BYE";
  return "SIP";
}

/** One-line trigger label: method · parties or short Call-ID · disposition (matches single-line Select triggers). */
function reconstructedSessionTriggerDisplay(call: ReconstructedCallSession | null): ReactNode {
  if (!call) return null;
  const method = inferPrimarySipMethod(call);
  const parties = partiesLabel(call);
  const disp = prettyDisposition(call.disposition);
  const sipCallId = primarySipCallId(call);
  const partiesUnknown = parties === "Unknown ↔ Unknown" || !parties.trim();
  const middle = partiesUnknown ? compactText(sipCallId, 36) : compactText(parties, 42);
  const title = `${sipCallId}\nTrace id: ${call.id}\n${disp}`;

  return (
    <span
      className="block min-w-0 w-full truncate whitespace-nowrap text-left text-xs font-normal leading-tight text-foreground"
      title={title}
    >
      <span className="font-semibold text-primary">{method}</span>
      <span className="text-muted-foreground"> · </span>
      {partiesUnknown ? (
        <span className="font-mono text-[11px] text-muted-foreground">{middle}</span>
      ) : (
        <span>{middle}</span>
      )}
      <span className="text-muted-foreground"> · {disp}</span>
    </span>
  );
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

/** SSRCs present on decoded RTP/SRTP/RTCP (for session-scoped diff without SIP Call-ID on media frames). */
function collectPacketSsrcs(packet: PacketInfo): Set<number> {
  const out = new Set<number>();
  const app = packet.decoded?.application;
  if (!app) return out;
  if (app.type === "Rtp" || app.type === "Srtp") {
    out.add(app.data.ssrc);
    return out;
  }
  if (app.type === "Rtcp") {
    for (const p of app.data.packets) {
      out.add(p.ssrc);
      for (const rr of p.receiverReports) {
        out.add(rr.ssrc);
      }
      if (p.voipMetrics) {
        out.add(p.voipMetrics.ssrcSource);
      }
      for (const s of p.byeSsrcs ?? []) {
        out.add(s);
      }
    }
  }
  return out;
}

function sessionMediaSsrcSet(call: ReconstructedCallSession): Set<number> {
  return new Set(call.mediaRefs.map((m) => m.ssrc).filter((n): n is number => typeof n === "number"));
}

/**
 * Session scope: SIP by Call-ID, plus RTP/RTCP whose SSRC appears on the reconstructed trace.
 * If the trace has no leg Call-IDs, keep full fetched list (legacy / REGISTER-only traces).
 */
function packetMatchesSessionFilter(packet: PacketInfo, snapshot: CallSnapshot): boolean {
  const callIdSet = new Set(snapshot.callIds.filter(Boolean));
  if (callIdSet.size === 0) return true;

  const cid = packetCallId(packet);
  if (cid && callIdSet.has(cid)) return true;

  const mediaSsrcs = sessionMediaSsrcSet(snapshot.call);
  if (mediaSsrcs.size === 0) return false;

  for (const s of collectPacketSsrcs(packet)) {
    if (mediaSsrcs.has(s)) return true;
  }
  return false;
}

type PacketDiffScope = "session" | "capture";

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
  const [beforeCallPreset, setBeforeCallPreset] = useState<CallTraceListPreset>("all");
  const [afterCallPreset, setAfterCallPreset] = useState<CallTraceListPreset>("all");
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
    setBeforeCallSearch("");
    setBeforeCallPreset("all");
  }, [beforeSessionId]);

  useEffect(() => {
    setAfterCallSearch("");
    setAfterCallPreset("all");
  }, [afterSessionId]);

  const beforeCallsAfterPreset = useMemo(() => {
    const calls = beforeData?.calls ?? [];
    const dialogs = beforeData?.dialogs ?? [];
    return calls.filter((c) => callMatchesTracePreset(c, dialogs, beforeCallPreset));
  }, [beforeData, beforeCallPreset]);

  const afterCallsAfterPreset = useMemo(() => {
    const calls = afterData?.calls ?? [];
    const dialogs = afterData?.dialogs ?? [];
    return calls.filter((c) => callMatchesTracePreset(c, dialogs, afterCallPreset));
  }, [afterData, afterCallPreset]);

  useEffect(() => {
    setBeforeCallId((prev) => {
      if (prev && beforeCallsAfterPreset.some((call) => call.id === prev)) return prev;
      return beforeCallsAfterPreset[0]?.id ?? "";
    });
  }, [beforeCallsAfterPreset]);

  useEffect(() => {
    setAfterCallId((prev) => {
      if (prev && afterCallsAfterPreset.some((call) => call.id === prev)) return prev;
      return afterCallsAfterPreset[0]?.id ?? "";
    });
  }, [afterCallsAfterPreset]);

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
    const dialogs = beforeData?.dialogs ?? [];
    if (!q) return beforeCallsAfterPreset;
    return beforeCallsAfterPreset.filter((call) => {
      const hints = traceHints(call, dialogs);
      const haystack = [
        call.id,
        call.disposition,
        ...call.parties,
        partiesLabel(call),
        ...call.legs.map((l) => l.callId ?? ""),
        primarySipCallId(call),
        hints.sipMsgCount > 0 ? "sip rtp voip" : "",
        hints.hasMedia ? "media rtp codec" : "",
        hints.hasFax ? "fax t38 t.38" : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [beforeCallSearch, beforeCallsAfterPreset, beforeData]);

  const afterCallOptions = useMemo(() => {
    const q = afterCallSearch.trim().toLowerCase();
    const dialogs = afterData?.dialogs ?? [];
    if (!q) return afterCallsAfterPreset;
    return afterCallsAfterPreset.filter((call) => {
      const hints = traceHints(call, dialogs);
      const haystack = [
        call.id,
        call.disposition,
        ...call.parties,
        partiesLabel(call),
        ...call.legs.map((l) => l.callId ?? ""),
        primarySipCallId(call),
        hints.sipMsgCount > 0 ? "sip rtp voip" : "",
        hints.hasMedia ? "media rtp codec" : "",
        hints.hasFax ? "fax t38 t.38" : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [afterCallSearch, afterCallsAfterPreset, afterData]);

  const [packetDiffMode, setPacketDiffMode] = useState<PacketDiffAlignmentMode>("flow");
  const [packetDiffScope, setPacketDiffScope] = useState<PacketDiffScope>("capture");
  const [timestampWindowMsText, setTimestampWindowMsText] = useState("250");
  const [showMismatchesOnly, setShowMismatchesOnly] = useState(false);
  const [hideRepetitiveTcpAcks, setHideRepetitiveTcpAcks] = useState(false);
  const [trafficGroupFilter, setTrafficGroupFilter] = useState<Set<PacketTrafficGroupId>>(
    () => defaultTrafficGroupSelection(),
  );
  const [packetDiffLoading, setPacketDiffLoading] = useState(false);
  const [packetDiffError, setPacketDiffError] = useState<string | null>(null);
  const [leftPackets, setLeftPackets] = useState<PacketInfo[]>([]);
  const [rightPackets, setRightPackets] = useState<PacketInfo[]>([]);
  const timestampWindowMs = useMemo(() => {
    const parsed = Number(timestampWindowMsText);
    if (!Number.isFinite(parsed) || parsed < 0) return 250;
    return parsed;
  }, [timestampWindowMsText]);

  const captureDiffReady =
    Boolean(beforeSessionId && afterSessionId) &&
    beforeSessionId !== afterSessionId &&
    Boolean(beforeData?.loaded && afterData?.loaded);

  useEffect(() => {
    const sessionReady = Boolean(leftSnapshot && rightSnapshot);
    if (packetDiffScope === "capture" ? !captureDiffReady : !sessionReady) {
      setLeftPackets([]);
      setRightPackets([]);
      setPacketDiffError(null);
      return;
    }

    const leftSid = beforeSessionId;
    const rightSid = afterSessionId;

    let cancelled = false;
    setPacketDiffLoading(true);
    setPacketDiffError(null);

    Promise.all([
      getCapturePackets(leftSid, PACKET_DIFF_FETCH_LIMIT, { compactForDiff: true }),
      getCapturePackets(rightSid, PACKET_DIFF_FETCH_LIMIT, { compactForDiff: true }),
    ])
      .then(([left, right]) => {
        if (cancelled) return;
        if (packetDiffScope === "capture") {
          setLeftPackets(left.slice(0, PACKET_DIFF_PACKET_LIMIT));
          setRightPackets(right.slice(0, PACKET_DIFF_PACKET_LIMIT));
          return;
        }
        if (!leftSnapshot || !rightSnapshot) return;
        const filteredLeft = left.filter((packet) => packetMatchesSessionFilter(packet, leftSnapshot));
        const filteredRight = right.filter((packet) => packetMatchesSessionFilter(packet, rightSnapshot));
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
  }, [
    packetDiffScope,
    captureDiffReady,
    beforeSessionId,
    afterSessionId,
    leftSnapshot,
    rightSnapshot,
  ]);

  const alignedPacketDiffRows = useMemo(
    () =>
      alignPacketDiffRows(leftPackets, rightPackets, {
        mode: packetDiffMode,
        timestampWindowMs,
      }),
    [leftPackets, rightPackets, packetDiffMode, timestampWindowMs],
  );

  const pairingHealth = useMemo(
    () =>
      leftPackets.length === 0 && rightPackets.length === 0
        ? null
        : computePacketDiffPairingHealth(alignedPacketDiffRows),
    [alignedPacketDiffRows, leftPackets.length, rightPackets.length],
  );

  const { packetDiffRows, packetDiffTableTruncated } = useMemo(() => {
    const { rows, truncatedByMaxRows } = applyPacketDiffVisibilityFiltersWithCapMeta(
      alignedPacketDiffRows,
      {
        maxRows: PACKET_DIFF_ROW_LIMIT,
        showMismatchesOnly,
        hideRepetitiveTcpAcks,
        trafficGroupsEnabled: trafficGroupFilter,
      },
    );
    return { packetDiffRows: rows, packetDiffTableTruncated: truncatedByMaxRows };
  }, [alignedPacketDiffRows, showMismatchesOnly, hideRepetitiveTcpAcks, trafficGroupFilter]);

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
  const sameCaptureSelected =
    Boolean(beforeSessionId) && Boolean(afterSessionId) && beforeSessionId === afterSessionId;
  const duplicateSideSelection =
    packetDiffScope === "capture" ? sameCaptureSelected : sameCallSelected;
  const showPacketDiff =
    !duplicateSideSelection &&
    (packetDiffScope === "capture" ? captureDiffReady : Boolean(leftSnapshot && rightSnapshot));

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <div className="shrink-0 border-b border-border/30 px-2 py-2">
        <TooltipWrapper entry={tooltips.packetDiffTitle}>
          <div className="flex flex-col gap-0.5">
            <span className="section-label-sm">Compare packets</span>
            <span className="text-3xs text-muted-foreground hidden sm:block">
              Same idea as a Wireshark-style diff: one row = one pairing between captures.
            </span>
          </div>
        </TooltipWrapper>

        <div className="mt-2 surface-flat p-2">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1.5 items-end">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-col gap-0.5">
                <div className="text-xs font-medium text-muted-foreground">Left capture</div>
                <div className="text-3xs text-muted-foreground/90 leading-snug hidden xl:block">
                  Packet recording · side A
                </div>
              </div>
            <TooltipWrapper entry={tooltips.packetDiffLeftSession}>
              <span className="block w-full min-w-0">
                <AppDropdown
                  size="md"
                  value={beforeSessionId}
                  onValueChange={(value: string) => {
                    setBeforeSessionId(value);
                    setBeforeSessionSearch("");
                  }}
                  className="w-full min-w-0 font-normal"
                  placeholder="Choose capture for side A"
                  valueDisplay={beforeSession ? sessionTriggerLabel(beforeSession) : null}
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
                          placeholder="Search by name, interface, status…"
                          value={beforeSessionSearch}
                          onChange={(e) => setBeforeSessionSearch(e.target.value)}
                          className="min-w-0 flex-1 text-xs"
                          onPointerDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      {beforeSessionOptions.length === 0 ? (
                        <EmptyState compact variant="inline" title="No captures match" />
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
                            <Badge variant="secondary" className="h-5 px-1.5 text-3xs shrink-0">
                              {session.status}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </>
                  )}
                />
              </span>
            </TooltipWrapper>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex flex-col gap-0.5">
                <div className="text-xs font-medium text-muted-foreground">Left session</div>
                <div className="text-3xs text-muted-foreground/90 leading-snug hidden xl:block">
                  Reconstructed trace · search & presets
                </div>
              </div>
            <TooltipWrapper entry={tooltips.packetDiffLeftCall}>
              <span className="block w-full min-w-0">
                <AppDropdown
                  size="md"
                  value={beforeCallId}
                  onValueChange={(value: string) => {
                    setBeforeCallId(value);
                    setBeforeCallSearch("");
                  }}
                  className="w-full min-w-0 font-normal"
                  placeholder="Choose session on A"
                  valueDisplay={reconstructedSessionTriggerDisplay(
                    (beforeData?.calls ?? []).find((call) => call.id === beforeCallId) ?? null,
                  )}
                  contentPosition="popper"
                  contentClassName="min-w-[var(--radix-select-trigger-width)] w-[min(560px,92vw)] max-w-[92vw] isolate p-0"
                  contentChildren={(
                    <>
                      <div
                        className="sticky top-0 z-20 flex flex-col gap-0 border-b border-border/40 bg-[hsl(var(--card)/1)]"
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
                          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <Input
                            size="sm"
                            placeholder="Search parties, SIP Call-ID, disposition…"
                            value={beforeCallSearch}
                            onChange={(e) => setBeforeCallSearch(e.target.value)}
                            className="min-w-0 flex-1 text-xs"
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </div>
                        <CallTracePresetBar value={beforeCallPreset} onChange={setBeforeCallPreset} />
                      </div>
                      {beforeCallOptions.length === 0 ? (
                        <EmptyState
                          compact
                          variant="inline"
                          title={
                            (beforeData?.calls ?? []).length === 0
                              ? "No sessions in this capture"
                              : beforeCallsAfterPreset.length === 0
                                ? "Nothing matches this preset"
                                : "No matches for your search"
                          }
                          description={
                            (beforeData?.calls ?? []).length === 0
                              ? "Open this capture in Call Flows to verify reconstruction."
                              : beforeCallsAfterPreset.length === 0
                                ? "Try All or VoIP, or pick another capture."
                                : "Clear the search box or widen your terms."
                          }
                        />
                      ) : beforeCallOptions.map((call) => {
                        const ui = dispositionUi(call.disposition);
                        const StatusIcon = ui.icon;
                        const parties = partiesLabel(call);
                        const sipCallId = primarySipCallId(call);
                        const hints = traceHints(call, beforeData?.dialogs ?? []);
                        const isDuplicate = beforeSessionId === afterSessionId && call.id === afterCallId;
                        return (
                          <SelectItem
                            key={`before-call-${call.id}`}
                            value={call.id}
                            className="py-2 pl-2 pr-8 cursor-pointer"
                            disabled={isDuplicate}
                          >
                            <div className="flex w-full items-start gap-3 min-w-0">
                              <div className={cn("shrink-0 flex items-center justify-center w-6 h-6 rounded", ui.bg)}>
                                <StatusIcon className={cn("h-3.5 w-3.5", ui.className)} />
                              </div>
                              <div className="flex-1 min-w-0 flex flex-col gap-1">
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  <span className="font-semibold text-foreground truncate min-w-0" title={parties || "Unknown parties"}>
                                    {parties || "Unknown parties"}
                                  </span>
                                  <Badge variant="secondary" className="h-4 px-1 text-3xs shrink-0">
                                    {prettyDisposition(call.disposition)}
                                  </Badge>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {hints.sipMsgCount > 0 ? (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal border-border/50">
                                      SIP {hints.sipMsgCount}
                                    </Badge>
                                  ) : null}
                                  {hints.hasMedia ? (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal border-primary/35 text-primary/90">
                                      RTP
                                    </Badge>
                                  ) : null}
                                  {hints.hasFax ? (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal border-warning/40 text-warning">
                                      Fax
                                    </Badge>
                                  ) : null}
                                  {call.anomalies.length > 0 ? (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal border-destructive/35 text-destructive">
                                      {call.anomalies.length} issue{call.anomalies.length === 1 ? "" : "s"}
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="min-w-0">
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">SIP Call-ID</span>
                                  <span className="block text-3xs text-muted-foreground font-mono truncate" title={sipCallId}>
                                    {sipCallId}
                                  </span>
                                </div>
                              </div>
                              <span className="shrink-0 text-2xs text-muted-foreground tabular-nums pt-0.5">
                                {formatSeconds(call.durationSec ?? null)}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </>
                  )}
                />
              </span>
            </TooltipWrapper>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex flex-col gap-0.5">
                <div className="text-xs font-medium text-muted-foreground">Right capture</div>
                <div className="text-3xs text-muted-foreground/90 leading-snug hidden xl:block">
                  Packet recording · side B
                </div>
              </div>
            <TooltipWrapper entry={tooltips.packetDiffRightSession}>
              <span className="block w-full min-w-0">
                <AppDropdown
                  size="md"
                  value={afterSessionId}
                  onValueChange={(value: string) => {
                    setAfterSessionId(value);
                    setAfterSessionSearch("");
                  }}
                  className="w-full min-w-0 font-normal"
                  placeholder="Choose capture for side B"
                  valueDisplay={afterSession ? sessionTriggerLabel(afterSession) : null}
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
                          placeholder="Search by name, interface, status…"
                          value={afterSessionSearch}
                          onChange={(e) => setAfterSessionSearch(e.target.value)}
                          className="min-w-0 flex-1 text-xs"
                          onPointerDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      {afterSessionOptions.length === 0 ? (
                        <EmptyState compact variant="inline" title="No captures match" />
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
                            <Badge variant="secondary" className="h-5 px-1.5 text-3xs shrink-0">
                              {session.status}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </>
                  )}
                />
              </span>
            </TooltipWrapper>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex flex-col gap-0.5">
                <div className="text-xs font-medium text-muted-foreground">Right session</div>
                <div className="text-3xs text-muted-foreground/90 leading-snug hidden xl:block">
                  Reconstructed trace · search & presets
                </div>
              </div>
            <TooltipWrapper entry={tooltips.packetDiffRightCall}>
              <span className="block w-full min-w-0">
                <AppDropdown
                  size="md"
                  value={afterCallId}
                  onValueChange={(value: string) => {
                    setAfterCallId(value);
                    setAfterCallSearch("");
                  }}
                  className="w-full min-w-0 font-normal"
                  placeholder="Choose session on B"
                  valueDisplay={reconstructedSessionTriggerDisplay(
                    (afterData?.calls ?? []).find((call) => call.id === afterCallId) ?? null,
                  )}
                  contentPosition="popper"
                  contentClassName="min-w-[var(--radix-select-trigger-width)] w-[min(560px,92vw)] max-w-[92vw] isolate p-0"
                  contentChildren={(
                    <>
                      <div
                        className="sticky top-0 z-20 flex flex-col gap-0 border-b border-border/40 bg-[hsl(var(--card)/1)]"
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
                          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <Input
                            size="sm"
                            placeholder="Search parties, SIP Call-ID, disposition…"
                            value={afterCallSearch}
                            onChange={(e) => setAfterCallSearch(e.target.value)}
                            className="min-w-0 flex-1 text-xs"
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </div>
                        <CallTracePresetBar value={afterCallPreset} onChange={setAfterCallPreset} />
                      </div>
                      {afterCallOptions.length === 0 ? (
                        <EmptyState
                          compact
                          variant="inline"
                          title={
                            (afterData?.calls ?? []).length === 0
                              ? "No sessions in this capture"
                              : afterCallsAfterPreset.length === 0
                                ? "Nothing matches this preset"
                                : "No matches for your search"
                          }
                          description={
                            (afterData?.calls ?? []).length === 0
                              ? "Open this capture in Call Flows to verify reconstruction."
                              : afterCallsAfterPreset.length === 0
                                ? "Try All or VoIP, or pick another capture."
                                : "Clear the search box or widen your terms."
                          }
                        />
                      ) : afterCallOptions.map((call) => {
                        const ui = dispositionUi(call.disposition);
                        const StatusIcon = ui.icon;
                        const parties = partiesLabel(call);
                        const sipCallId = primarySipCallId(call);
                        const hints = traceHints(call, afterData?.dialogs ?? []);
                        const isDuplicate = beforeSessionId === afterSessionId && call.id === beforeCallId;
                        return (
                          <SelectItem
                            key={`after-call-${call.id}`}
                            value={call.id}
                            className="py-2 pl-2 pr-8 cursor-pointer"
                            disabled={isDuplicate}
                          >
                            <div className="flex w-full items-start gap-3 min-w-0">
                              <div className={cn("shrink-0 flex items-center justify-center w-6 h-6 rounded", ui.bg)}>
                                <StatusIcon className={cn("h-3.5 w-3.5", ui.className)} />
                              </div>
                              <div className="flex-1 min-w-0 flex flex-col gap-1">
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  <span className="font-semibold text-foreground truncate min-w-0" title={parties || "Unknown parties"}>
                                    {parties || "Unknown parties"}
                                  </span>
                                  <Badge variant="secondary" className="h-4 px-1 text-3xs shrink-0">
                                    {prettyDisposition(call.disposition)}
                                  </Badge>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {hints.sipMsgCount > 0 ? (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal border-border/50">
                                      SIP {hints.sipMsgCount}
                                    </Badge>
                                  ) : null}
                                  {hints.hasMedia ? (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal border-primary/35 text-primary/90">
                                      RTP
                                    </Badge>
                                  ) : null}
                                  {hints.hasFax ? (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal border-warning/40 text-warning">
                                      Fax
                                    </Badge>
                                  ) : null}
                                  {call.anomalies.length > 0 ? (
                                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal border-destructive/35 text-destructive">
                                      {call.anomalies.length} issue{call.anomalies.length === 1 ? "" : "s"}
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="min-w-0">
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">SIP Call-ID</span>
                                  <span className="block text-3xs text-muted-foreground font-mono truncate" title={sipCallId}>
                                    {sipCallId}
                                  </span>
                                </div>
                              </div>
                              <span className="shrink-0 text-2xs text-muted-foreground tabular-nums pt-0.5">
                                {formatSeconds(call.durationSec ?? null)}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </>
                  )}
                />
              </span>
            </TooltipWrapper>
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-start sm:flex-wrap border-t border-border/20 pt-2">
            <span className="text-2xs font-medium text-muted-foreground shrink-0 pt-1">Packets from</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={cn(
                  "h-7 px-2.5 text-3xs rounded-md border transition-colors",
                  packetDiffScope === "session"
                    ? "border-primary/50 bg-primary text-primary-foreground shadow-sm"
                    : "border-border/50 bg-background/80 text-foreground hover:bg-muted/50",
                )}
                onClick={() => setPacketDiffScope("session")}
              >
                Selected trace only
              </button>
              <button
                type="button"
                className={cn(
                  "h-7 px-2.5 text-3xs rounded-md border transition-colors",
                  packetDiffScope === "capture"
                    ? "border-primary/50 bg-primary text-primary-foreground shadow-sm"
                    : "border-border/50 bg-background/80 text-foreground hover:bg-muted/50",
                )}
                onClick={() => setPacketDiffScope("capture")}
              >
                Whole capture
              </button>
            </div>
            <p className="text-3xs text-muted-foreground leading-snug sm:flex-1 min-w-[14rem] pt-0.5">
              {packetDiffScope === "capture"
                ? `Up to ${PACKET_DIFF_FETCH_LIMIT.toLocaleString()} frames loaded per side, diff capped at ${PACKET_DIFF_PACKET_LIMIT.toLocaleString()}. No trace filter.`
                : "SIP matches leg Call-ID; RTP/RTCP includes frames whose SSRC appears on the reconstructed trace."}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        {orderedSessions.length < 2 ? (
          <EmptyState
            variant="inline"
            icon={<GitCompareArrows />}
            title="Need two captures"
            description="Import or record at least two packet captures to compare sessions side by side."
          />
        ) : anyLoading ? (
          <EmptyState
            variant="inline"
            icon={<Loader2 className="animate-spin" />}
            title="Loading sessions"
            description="Fetching reconstructed sessions, SIP dialogs, and RTP streams for the selected captures."
          />
        ) : errorMessage ? (
          <EmptyState
            variant="inline"
            icon={<AlertTriangle />}
            title="Comparison data load failed"
            description={errorMessage}
          />
        ) : duplicateSideSelection ? (
          <EmptyState
            variant="inline"
            icon={<GitCompareArrows />}
            title={packetDiffScope === "capture" ? "Pick two different captures" : "Pick two different sessions"}
            description={
              packetDiffScope === "capture"
                ? "Side A and B must be different packet recordings for a whole-capture diff."
                : "Both sides point at the same session in the same capture. Choose another trace on one side."
            }
          />
        ) : !showPacketDiff ? (
          <EmptyState
            variant="inline"
            icon={<GitCompareArrows />}
            title={packetDiffScope === "capture" ? "Cannot compare yet" : "Select two sessions"}
            description={
              packetDiffScope === "capture"
                ? "Choose two different captures above. Reconstructed traces are optional in whole-capture mode."
                : "Choose one reconstructed session on the left capture and one on the right to build the packet diff."
            }
          />
        ) : (
          <div className="space-y-2">
            <section
              className="surface border border-border/35 rounded-[var(--radius-lg)] overflow-hidden"
              aria-label="Packet comparison table"
            >
              <div className="px-2.5 py-2 border-b border-border/30 flex flex-wrap items-center gap-2">
                {packetDiffScope === "capture" ? (
                  <>
                    <Badge variant="secondary" className="h-5 px-1.5 text-3xs">
                      A: {compactText(beforeSession?.name ?? "Capture A", 28)}
                    </Badge>
                    <Badge variant="secondary" className="h-5 px-1.5 text-3xs">
                      B: {compactText(afterSession?.name ?? "Capture B", 28)}
                    </Badge>
                    <Badge variant="secondary" className="h-5 px-1.5 text-3xs border border-primary/30 text-primary/90 bg-primary/[0.06]">
                      Whole capture
                    </Badge>
                  </>
                ) : (
                  leftSnapshot &&
                  rightSnapshot && (
                    <>
                      <TooltipWrapper title="Left trace id (internal)" description={leftSnapshot.call.id}>
                        <Badge variant="secondary" className="h-5 px-1.5 text-3xs">
                          A trace: {compactText(leftSnapshot.call.id, 20)}
                        </Badge>
                      </TooltipWrapper>
                      <TooltipWrapper title="Right trace id (internal)" description={rightSnapshot.call.id}>
                        <Badge variant="secondary" className="h-5 px-1.5 text-3xs">
                          B trace: {compactText(rightSnapshot.call.id, 20)}
                        </Badge>
                      </TooltipWrapper>
                    </>
                  )
                )}
                <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto sm:ml-auto sm:justify-end">
                  {packetDiffScope === "capture" ? (
                    <>
                      <TooltipWrapper title="Open this capture in the packet viewer" description="No display filter applied.">
                        <Button
                          variant="neutral"
                          size="sm"
                          className="h-7 px-2 text-3xs"
                          onClick={() => {
                            openViewer(beforeSessionId, beforeSession ?? undefined, {});
                            navigateTo("packet-capture", "viewer", { packetCaptureSessionId: beforeSessionId });
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Open A in viewer
                        </Button>
                      </TooltipWrapper>
                      <TooltipWrapper title="Open this capture in the packet viewer" description="No display filter applied.">
                        <Button
                          variant="neutral"
                          size="sm"
                          className="h-7 px-2 text-3xs"
                          onClick={() => {
                            openViewer(afterSessionId, afterSession ?? undefined, {});
                            navigateTo("packet-capture", "viewer", { packetCaptureSessionId: afterSessionId });
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Open B in viewer
                        </Button>
                      </TooltipWrapper>
                    </>
                  ) : (
                    leftSnapshot &&
                    rightSnapshot && (
                      <>
                        {leftSnapshot.primaryCallId ? (
                          <TooltipWrapper entry={tooltips.packetDiffOpenLeftCall}>
                            <Button
                              variant="neutral"
                              size="sm"
                              className="h-7 px-2 text-3xs"
                              onClick={() => openCallInViewer(leftSnapshot.sessionId, leftSnapshot.primaryCallId!)}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Open A in viewer
                            </Button>
                          </TooltipWrapper>
                        ) : null}
                        {rightSnapshot.primaryCallId ? (
                          <TooltipWrapper entry={tooltips.packetDiffOpenRightCall}>
                            <Button
                              variant="neutral"
                              size="sm"
                              className="h-7 px-2 text-3xs"
                              onClick={() => openCallInViewer(rightSnapshot.sessionId, rightSnapshot.primaryCallId!)}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Open B in viewer
                            </Button>
                          </TooltipWrapper>
                        ) : null}
                      </>
                    )
                  )}
                </div>
              </div>
              <PacketDiffControls
                alignmentMode={packetDiffMode}
                onAlignmentModeChange={setPacketDiffMode}
                timestampWindowMsText={timestampWindowMsText}
                onTimestampWindowMsTextChange={setTimestampWindowMsText}
                trafficGroupFilter={trafficGroupFilter}
                onTrafficGroupFilterChange={setTrafficGroupFilter}
                problemsOnly={showMismatchesOnly}
                onProblemsOnlyChange={setShowMismatchesOnly}
                hideIdleTcpAck={hideRepetitiveTcpAcks}
                onHideIdleTcpAckChange={setHideRepetitiveTcpAcks}
              />
              <PacketDiffPairingHealthBar
                health={packetDiffLoading ? null : pairingHealth}
                tableTruncated={packetDiffTableTruncated}
                maxTableRows={PACKET_DIFF_ROW_LIMIT}
                loading={packetDiffLoading}
              />
              <PacketDiffSplitView
                rows={packetDiffRows}
                loading={packetDiffLoading}
                error={packetDiffError}
                leftLabel="Capture A"
                rightLabel="Capture B"
                onOpenPacket={handleOpenPacket}
              />
            </section>

          </div>
        )}
      </div>
    </div>
  );
}
