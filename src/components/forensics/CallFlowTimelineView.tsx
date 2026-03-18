/**
 * Unified Call Analysis view — SIP signaling + RTP media in a single tab.
 * Layout: Control bar → Left panel (Signaling / Media sub-tabs) | Collapsible right sidebar (details).
 */

import { useEffect, useState, useMemo, useCallback, useRef } from "react";

import { getRtpStreams, getSipDialogs, exportDialogPcapSave, getCapturePacketsRange } from "@/api/packetCapture";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useOpenCapture } from "@/hooks/useOpenCapture";
import { navigateTo } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ExternalLink, Download, Scan, GitBranch, List, CheckCircle, XCircle, AlertTriangle, BellRing, Circle, Search, Activity, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, RotateCcw } from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { SipDialog, SipDialogMessage } from "@/types/forensics";
import type { PacketInfo, RtpStreamInfo, ExpertFinding } from "@/types/packetCapture";
import { useNotifications } from "@/hooks/useNotifications";
import { useDnsResolution } from "@/hooks/useDnsResolution";
import { SipLadderView, type SipTimestampMode } from "./SipLadderView";
import { MediaAnalysisWorkspace } from "./MediaAnalysisWorkspace";
import { PacketDetailsView } from "@/components/packet-capture/monitor/PacketDetailsView";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getDialogStatus } from "@/lib/sipDialogStatus";
import { getAnalysisDiagnostics } from "@/lib/diagnostics/query";
import { useMediaInvestigationModel } from "./media/model/useMediaInvestigationModel";
import { isIp, isVoipCallDialog } from "./media/model/mediaSelectors";

type SelectedItem =
  | { kind: "sip"; message: SipDialogMessage; index: number }
  | { kind: "rtp"; stream: RtpStreamInfo; index: number };

const DEFAULT_PARTICIPANTS = ["Caller (A)", "Callee (B)"];

function formatDialogParty(value: string | undefined): string {
  if (!value) return "Unknown";
  const cleaned = value.replace(/[<>"]/g, "").trim();
  const sipMatch = cleaned.match(/^(?:sips?:)?([^@;]+)@?([^;]+)?/i);
  if (sipMatch) {
    const user = (sipMatch[1] ?? "").trim();
    const host = (sipMatch[2] ?? "").trim();
    if (user) return user;
    if (host) return host;
  }
  return cleaned || "Unknown";
}

function formatDialogDuration(d: SipDialog): string {
  const start = d.startTime ? new Date(d.startTime).getTime() : NaN;
  const end = d.endTime ? new Date(d.endTime).getTime() : null;
  const lastTs = d.messages.length > 0 ? new Date(d.messages[d.messages.length - 1]!.timestamp).getTime() : null;
  const endMs = end ?? lastTs ?? start;
  if (Number.isNaN(start) || !endMs || endMs <= start) return "—";
  const sec = Math.round((endMs - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m ${s}s`;
}

function formatDialogStartTime(d: SipDialog): string {
  try {
    const t = d.messages[0]?.timestamp ?? d.startTime;
    return new Date(t).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function getParticipantHint(d: SipDialog, maxLen = 20): string {
  const p0 = d.participants?.[0];
  if (!p0) return "";
  const s = p0.replace(/^sip:/i, "").trim();
  return s.length > maxLen ? s.slice(0, maxLen - 2) + "…" : s;
}

function formatCallStatusLabel(d: SipDialog): string {
  const status = getDialogStatus(d);
  if (status === "success") return "Completed";
  if (status === "ringing") return "Ringing";
  if (status === "warning") return "Needs attention";
  if (status === "error") return "Failed";
  return "Unknown";
}

function getCallPartiesLabel(d: SipDialog): string {
  return `${formatDialogParty(d.participants?.[0])} → ${formatDialogParty(d.participants?.[1])}`;
}

/** Full event sequence for tooltip (all SIP methods/responses). */
function getDialogEventSequence(d: SipDialog): string {
  const seq = d.messages.map((m) => m.methodOrCode).join(" → ");
  return seq || "—";
}

/** Condensed label for trigger preview: event summary + time + duration + count. */
function getDialogCondensedLabel(d: SipDialog): string {
  const time = formatDialogStartTime(d);
  const dur = formatDialogDuration(d);
  const status = formatCallStatusLabel(d);
  return `${getCallPartiesLabel(d)} · ${status} · ${time} · ${dur} · ${d.messages.length} messages`;
}

/** Searchable string for filter: event sequence, participant, callId. */
function getDialogSearchValue(d: SipDialog): string {
  const seq = getDialogEventSequence(d);
  const participant = getParticipantHint(d);
  return [seq, participant, d.callId, formatDialogStartTime(d), formatDialogDuration(d)].filter(Boolean).join(" ");
}

interface CallFlowTimelineViewProps {
  sessionId?: string | null;
  onViewPacket?: (sessionId: string, methodOrCode: string, cseq?: string) => void;
  onViewCapture?: (sessionId: string) => void;
}

export function CallFlowTimelineView({ sessionId: externalSessionId }: CallFlowTimelineViewProps) {
  const { notify } = useNotifications();
  const fetchSessions = usePacketCaptureStore((s) => s.fetchSessions);
  const { openViewer } = useOpenCapture();

  const [sessionId, setSessionId] = useState<string | null>(externalSessionId ?? null);
  const [dialogs, setDialogs] = useState<SipDialog[]>([]);
  const [selectedDialogIndex, setSelectedDialogIndex] = useState(-1);
  const [loadingDialogs, setLoadingDialogs] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [selectedPacket, setSelectedPacket] = useState<PacketInfo | null>(null);
  const [selectedPacketLoading, setSelectedPacketLoading] = useState(false);
  const [rtpStreams, setRtpStreams] = useState<RtpStreamInfo[]>([]);
  const [activePanel, setActivePanel] = useState<"signaling" | "media">("signaling");
  const [expertFindings, setExpertFindings] = useState<ExpertFinding[]>([]);
  const [dialogSearchQuery, setDialogSearchQuery] = useState("");
  const [voipCallsOpen, setVoipCallsOpen] = useState(false);
  const [voipCallSearchQuery, setVoipCallSearchQuery] = useState("");
  const [loadingRtpStreams, setLoadingRtpStreams] = useState(false);
  const [signalingSplitPct, setSignalingSplitPct] = useState(36);
  const [isResizingSignaling, setIsResizingSignaling] = useState(false);
  const [packetPaneCollapsed, setPacketPaneCollapsed] = useState(false);
  const [flowPaneCollapsed, setFlowPaneCollapsed] = useState(false);
  const [signalingTimestampMode, setSignalingTimestampMode] = useState<SipTimestampMode>("absolute");
  const packetRequestSeqRef = useRef(0);
  const dialogsRequestSeqRef = useRef(0);
  const rtpRequestSeqRef = useRef(0);
  const findingsRequestSeqRef = useRef(0);
  const dialogsCacheRef = useRef<Map<string, SipDialog[]>>(new Map());
  const rtpStreamsCacheRef = useRef<Map<string, RtpStreamInfo[]>>(new Map());
  const findingsCacheRef = useRef<Map<string, ExpertFinding[]>>(new Map());
  const signalingSplitRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (externalSessionId !== undefined && externalSessionId !== sessionId) {
      setSessionId(externalSessionId);
    }
  }, [externalSessionId, sessionId]);

  useEffect(() => {
    if (!isResizingSignaling) return;
    const onMove = (e: MouseEvent) => {
      const host = signalingSplitRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSignalingSplitPct(Math.max(22, Math.min(78, pct)));
    };
    const onUp = () => setIsResizingSignaling(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizingSignaling]);

  const selectedDialog = selectedDialogIndex >= 0 && selectedDialogIndex < dialogs.length ? dialogs[selectedDialogIndex] ?? null : null;
  const messages = selectedDialog?.messages ?? [];
  const mediaPanelActive = activePanel === "media";

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const sipLadderRequestedSessionId = usePacketCaptureStore((s) => s.sipLadderRequestedSessionId);
  const setSipLadderRequestedSessionId = usePacketCaptureStore((s) => s.setSipLadderRequestedSessionId);
  const viewerActiveSessionId = usePacketCaptureStore((s) => s.viewerActiveSessionId);

  useEffect(() => {
    if (sipLadderRequestedSessionId) {
      setSessionId(sipLadderRequestedSessionId);
      setSipLadderRequestedSessionId(null);
    }
  }, [sipLadderRequestedSessionId, setSipLadderRequestedSessionId]);

  // Auto-sync: when the viewer's active capture changes, follow it in Analysis
  useEffect(() => {
    if (viewerActiveSessionId && viewerActiveSessionId !== sessionId) {
      setSessionId(viewerActiveSessionId);
    }
  }, [viewerActiveSessionId]);

  useEffect(() => {
    if (!sessionId) {
      rtpRequestSeqRef.current += 1;
      setRtpStreams([]);
      setLoadingRtpStreams(false);
      return;
    }
    const cached = rtpStreamsCacheRef.current.get(sessionId);
    if (cached) {
      setRtpStreams(cached);
      setLoadingRtpStreams(false);
      return;
    }
    const requestId = ++rtpRequestSeqRef.current;
    setLoadingRtpStreams(true);
    setRtpStreams([]);
    getRtpStreams(sessionId)
      .then((streams) => {
        if (requestId !== rtpRequestSeqRef.current) return;
        const normalized = streams ?? [];
        rtpStreamsCacheRef.current.set(sessionId, normalized);
        setRtpStreams(normalized);
      })
      .catch(() => {
        if (requestId !== rtpRequestSeqRef.current) return;
        setRtpStreams([]);
      })
      .finally(() => {
        if (requestId !== rtpRequestSeqRef.current) return;
        setLoadingRtpStreams(false);
      });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      findingsRequestSeqRef.current += 1;
      setExpertFindings([]);
      return;
    }
    const cached = findingsCacheRef.current.get(sessionId);
    if (cached) {
      setExpertFindings(cached);
      return;
    }
    const requestId = ++findingsRequestSeqRef.current;
    getAnalysisDiagnostics(sessionId)
      .then((result) => {
        if (requestId !== findingsRequestSeqRef.current) return;
        const normalized = result ?? [];
        findingsCacheRef.current.set(sessionId, normalized);
        setExpertFindings(normalized);
      })
      .catch(() => {
        if (requestId !== findingsRequestSeqRef.current) return;
        setExpertFindings([]);
      })
      .finally(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      dialogsRequestSeqRef.current += 1;
      setDialogs([]);
      setSelectedDialogIndex(-1);
      return;
    }
    const cached = dialogsCacheRef.current.get(sessionId);
    if (cached) {
      setDialogs(cached);
      setLoadingDialogs(false);
      setSelectedDialogIndex((prev) => (prev >= 0 && prev < cached.length ? prev : -1));
      return;
    }
    const requestId = ++dialogsRequestSeqRef.current;
    setLoadingDialogs(true);
    getSipDialogs(sessionId)
      .then((list: SipDialog[] | null) => {
        if (requestId !== dialogsRequestSeqRef.current) return;
        const list_ = list ?? [];
        dialogsCacheRef.current.set(sessionId, list_);
        setDialogs(list_);
        setSelectedDialogIndex((prev) => (prev >= 0 && prev < list_.length ? prev : -1));
      })
      .catch(() => {
        if (requestId !== dialogsRequestSeqRef.current) return;
        setDialogs([]);
      })
      .finally(() => {
        if (requestId !== dialogsRequestSeqRef.current) return;
        setLoadingDialogs(false);
      });
  }, [sessionId]);

  // Full dialog set used by picker + dropdown.
  const filteredDialogEntries = useMemo(() => {
    return dialogs.map((d, i) => ({ dialog: d, originalIndex: i }));
  }, [dialogs]);
  const dialogSearchIndex = useMemo(
    () =>
      new Map(
        filteredDialogEntries.map(({ dialog, originalIndex }) => [
          originalIndex,
          getDialogSearchValue(dialog).toLowerCase(),
        ]),
      ),
    [filteredDialogEntries],
  );

  // Filter by search query (for SIP dialog dropdown)
  const searchFilteredDialogs = useMemo(() => {
    const q = dialogSearchQuery.trim().toLowerCase();
    if (!q) return filteredDialogEntries;
    return filteredDialogEntries.filter(({ originalIndex }) =>
      (dialogSearchIndex.get(originalIndex) ?? "").includes(q)
    );
  }, [filteredDialogEntries, dialogSearchQuery, dialogSearchIndex]);

  const voipFilteredDialogs = useMemo(() => {
    const callDialogs = filteredDialogEntries.filter(({ dialog }) => isVoipCallDialog(dialog));
    const q = voipCallSearchQuery.trim().toLowerCase();
    if (!q) return callDialogs;
    return callDialogs.filter(({ originalIndex }) =>
      (dialogSearchIndex.get(originalIndex) ?? "").includes(q)
    );
  }, [filteredDialogEntries, voipCallSearchQuery, dialogSearchIndex]);

  // Reset dialog selection when filter removes the currently selected dialog
  useEffect(() => {
    if (selectedDialogIndex < 0) return;
    const isVisible = filteredDialogEntries.some(e => e.originalIndex === selectedDialogIndex);
    if (!isVisible) {
      setSelectedDialogIndex(filteredDialogEntries.length > 0 ? filteredDialogEntries[0]!.originalIndex : -1);
    }
  }, [filteredDialogEntries, selectedDialogIndex]);

  // Reset selected item (stream / SIP message) when dialog changes
  useEffect(() => {
    setSelectedItem(null);
    setSelectedPacket(null);
  }, [selectedDialogIndex]);


  const participants = useMemo(() => {
    const p = selectedDialog?.participants;
    if (p && p.length >= 2) return p;
    return DEFAULT_PARTICIPANTS;
  }, [selectedDialog?.participants]);

  const ip0 = participants[0] && isIp(participants[0]) ? participants[0] : null;
  const ip1 = participants[1] && isIp(participants[1]) ? participants[1] : null;
  const dns0 = useDnsResolution(ip0);
  const dns1 = useDnsResolution(ip1);

  const participantLabels = useMemo(() => {
    return participants.map((p, i) => {
      if (i === 0 && ip0) return dns0.hostname ? `${dns0.hostname} (${ip0})` : ip0;
      if (i === 1 && ip1) return dns1.hostname ? `${dns1.hostname} (${ip1})` : ip1;
      return p;
    });
  }, [participants, ip0, ip1, dns0.hostname, dns1.hostname]);

  const participantDetails = useMemo(() => {
    return participantLabels.map((label, i) => {
      if (i === 0 && ip0) return { label, ip: ip0, hostname: dns0.hostname ?? undefined };
      if (i === 1 && ip1) return { label, ip: ip1, hostname: dns1.hostname ?? undefined };
      return { label };
    });
  }, [participantLabels, ip0, ip1, dns0.hostname, dns1.hostname]);

  const selectedMessageIndex = selectedItem?.kind === "sip" ? selectedItem.index : null;
  const hasSelectedSipPacket = selectedItem?.kind === "sip";
  const effectivePacketPaneCollapsed = packetPaneCollapsed || !hasSelectedSipPacket;
  const {
    prioritizedStreams,
    consolidatedStreams,
    findingsByStream,
    mediaSummary,
    mediaHealth,
  } = useMediaInvestigationModel({
    selectedDialog: mediaPanelActive ? selectedDialog : null,
    rtpStreams: mediaPanelActive ? rtpStreams : [],
    expertFindings: mediaPanelActive ? expertFindings : [],
  });
  const hasMediaForSelectedCall = !!(selectedDialog && isVoipCallDialog(selectedDialog) && rtpStreams.length > 0);
  // Fetch full PacketInfo when a SIP message is selected
  useEffect(() => {
    if (!selectedItem || selectedItem.kind !== "sip" || !sessionId) {
      packetRequestSeqRef.current += 1;
      setSelectedPacket(null);
      setSelectedPacketLoading(false);
      return;
    }
    const packetIndex = selectedItem.message.packetIndex;
    const requestId = ++packetRequestSeqRef.current;
    setSelectedPacketLoading(true);
    getCapturePacketsRange(sessionId, packetIndex, 1)
      .then((packets) => {
        if (requestId !== packetRequestSeqRef.current) return;
        setSelectedPacket(packets.length > 0 ? packets[0]! : null);
      })
      .catch(() => {
        if (requestId !== packetRequestSeqRef.current) return;
        setSelectedPacket(null);
      })
      .finally(() => {
        if (requestId !== packetRequestSeqRef.current) return;
        setSelectedPacketLoading(false);
      });
  }, [sessionId, selectedItem?.kind === "sip" ? selectedItem.message.packetIndex : null]);

  const exportPcap = useCallback(() => {
    if (!sessionId || selectedDialog == null || selectedDialogIndex < 0) return;
    exportDialogPcapSave(sessionId, selectedDialogIndex)
      .then((path) => {
        notify({ type: "success", title: "Export Successful", description: `Saved to ${path}`, source: "forensics" });
      })
      .catch((e) => {
        notify({ type: "error", title: "Export Failed", description: e instanceof Error ? e.message : String(e), source: "forensics" });
      });
  }, [sessionId, selectedDialog, selectedDialogIndex, notify]);

  const hasCall = sessionId && selectedDialog != null;
  const hasDialogSearchFilter = dialogSearchQuery.trim().length > 0;
  const isFilteredToNoMatches =
    !loadingDialogs &&
    dialogs.length > 0 &&
    hasDialogSearchFilter &&
    searchFilteredDialogs.length === 0;
  useEffect(() => {
    if (activePanel === "media" && !loadingRtpStreams && !hasMediaForSelectedCall) {
      setActivePanel("signaling");
    }
  }, [activePanel, hasMediaForSelectedCall, loadingRtpStreams]);
  useEffect(() => {
    setSelectedItem(null);
  }, [sessionId, selectedDialogIndex]);
  return (
    <div className="h-full flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="shrink-0 border-b border-border/20 px-2.5 py-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
              <Select
                value={selectedDialogIndex >= 0 && selectedDialogIndex < dialogs.length ? selectedDialogIndex.toString() : ""}
                onValueChange={(v) => {
                  setSelectedDialogIndex(v === "" ? -1 : parseInt(v, 10));
                  setDialogSearchQuery("");
                }}
                disabled={!sessionId || loadingDialogs || !filteredDialogEntries.length}
              >
                <SelectTrigger className="h-8 w-[clamp(280px,32vw,520px)] text-xs ui-control-shell">
                  <SelectValue placeholder="Select a call…">
                    {selectedDialog ? getDialogCondensedLabel(selectedDialog) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="min-w-[var(--radix-select-trigger-width)] w-[460px] max-w-[90vw] isolate p-0" position="popper">
                  <div
                    className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/40 bg-[hsl(var(--card)/1)] px-2.5 py-2"
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Input
                      placeholder="Search by method, code, participant…"
                      value={dialogSearchQuery}
                      onChange={(e) => setDialogSearchQuery(e.target.value)}
                      className="h-8 rounded-[var(--radius-md)] border-border/45 bg-[hsl(var(--background)/0.88)] shadow-none text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  {searchFilteredDialogs.length === 0 ? (
                    <EmptyState compact variant="inline" title="No calls match" />
                  ) : (
                    searchFilteredDialogs.map(({ dialog: d, originalIndex: i }) => {
                      const status = getDialogStatus(d);
                      const statusConfig = {
                        success: { icon: CheckCircle, className: "text-success", bg: "bg-success/[0.08]" },
                        error: { icon: XCircle, className: "text-destructive", bg: "bg-destructive/[0.08]" },
                        warning: { icon: AlertTriangle, className: "text-warning", bg: "bg-warning/[0.08]" },
                        ringing: { icon: BellRing, className: "text-primary", bg: "bg-primary/[0.08]" },
                        unknown: { icon: Circle, className: "text-muted-foreground", bg: "bg-muted/30" },
                      }[status];
                      const StatusIcon = statusConfig.icon;
                      return (
                        <SelectItem key={d.callId + i} value={i.toString()} className="py-1.5 pl-2 pr-8 cursor-pointer">
                          <div className="flex w-full items-center gap-3 min-w-0">
                            <div className={cn("shrink-0 flex items-center justify-center w-6 h-6 rounded", statusConfig.bg)}>
                              <StatusIcon className={cn("h-3.5 w-3.5", statusConfig.className)} />
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                              <span className="font-semibold text-foreground truncate">
                                {getCallPartiesLabel(d)}
                              </span>
                              <span className="text-2xs text-muted-foreground truncate">
                                {formatCallStatusLabel(d)} · Started {formatDialogStartTime(d)} · {formatDialogDuration(d)} · {d.messages.length} messages
                              </span>
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
              </div>
              {sessionId && dialogs.some((d) => isVoipCallDialog(d)) && (
                <Popover open={voipCallsOpen} onOpenChange={setVoipCallsOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="neutral"
                      size="sm"
                      className="h-8 gap-1.5 text-xs px-3 font-medium"
                    >
                      <List className="h-3 w-3" />
                      Filter Calls
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="bottom"
                    sideOffset={6}
                    className="w-[min(700px,92vw)] p-0 overflow-hidden"
                  >
                    <div className="h-10 border-b border-border/45 px-3 flex items-center">
                      <h2 className="text-xs font-semibold">VoIP Calls</h2>
                    </div>
                    <div className="p-3 space-y-2">
                      <Input
                        value={voipCallSearchQuery}
                        onChange={(e) => setVoipCallSearchQuery(e.target.value)}
                        placeholder="Search calls by method, participant, call-id..."
                        className="ui-control-shell h-8 text-xs"
                      />
                      <div className="surface max-h-[52vh] overflow-auto divide-y divide-border/40">
                        {voipFilteredDialogs.length === 0 ? (
                          <EmptyState
                            compact
                            variant="inline"
                            icon={<Search />}
                            title="No matching calls"
                            description="Try a broader search to find dialogs."
                            className="h-full p-6"
                          />
                        ) : (
                          voipFilteredDialogs.map(({ dialog: d, originalIndex: i }) => {
                            const status = getDialogStatus(d);
                            const statusConfig = {
                              success: { icon: CheckCircle, className: "text-success", bg: "bg-success/[0.08]" },
                              error: { icon: XCircle, className: "text-destructive", bg: "bg-destructive/[0.08]" },
                              warning: { icon: AlertTriangle, className: "text-warning", bg: "bg-warning/[0.08]" },
                              ringing: { icon: BellRing, className: "text-primary", bg: "bg-primary/[0.08]" },
                              unknown: { icon: Circle, className: "text-muted-foreground", bg: "bg-muted/30" },
                            }[status];
                            const StatusIcon = statusConfig.icon;
                            const isSelected = selectedDialogIndex === i;
                            return (
                              <button
                                key={`voip-call-${d.callId}-${i}`}
                                type="button"
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-smooth",
                                  isSelected ? "bg-accent/40 text-foreground" : "hover:bg-accent/40",
                                )}
                                onClick={() => {
                                  setSelectedDialogIndex(i);
                                  setDialogSearchQuery("");
                                  setVoipCallsOpen(false);
                                }}
                              >
                                <div className={cn("shrink-0 flex items-center justify-center w-6 h-6 rounded", statusConfig.bg)}>
                                  <StatusIcon className={cn("h-3.5 w-3.5", statusConfig.className)} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold truncate">
                                    {getCallPartiesLabel(d)}
                                  </div>
                                  <div className="text-2xs text-muted-foreground truncate">
                                    {formatCallStatusLabel(d)} · Started {formatDialogStartTime(d)} · {formatDialogDuration(d)} · {d.messages.length} messages
                                  </div>
                                </div>
                                <div className="shrink-0 text-2xs text-muted-foreground font-mono max-w-[200px] truncate">
                                  {d.callId}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              {loadingDialogs && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            {hasCall && (
              <div className="ml-auto flex items-center gap-1">
                <Button variant="neutral" size="sm" className="h-8 gap-1.5 text-xs px-3 font-medium" onClick={exportPcap}>
                  <Download className="h-3 w-3" />
                  PCAP
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <Tabs
              value={activePanel}
              onValueChange={(v) => {
                const nextPanel = v as typeof activePanel;
                setActivePanel(nextPanel);
                if (nextPanel === "media") {
                  const first = prioritizedStreams[0];
                  if (first) {
                    setSelectedItem({ kind: "rtp", stream: first, index: 0 });
                  } else {
                    setSelectedItem(null);
                  }
                  return;
                }
                setSelectedItem(null);
              }}
              className="w-auto"
            >
              <TabsList className="subview-tabs-compact shrink-0">
                <TabsTrigger value="signaling" className="subview-tab-compact">
                  <GitBranch className="h-4 w-4 mr-1.5" />
                  Signaling
                </TabsTrigger>
                <TabsTrigger
                  value="media"
                  disabled={!loadingRtpStreams && !hasMediaForSelectedCall}
                  className={cn(
                    "subview-tab-compact",
                    !loadingRtpStreams && !hasMediaForSelectedCall && "opacity-45",
                  )}
                >
                  <Scan className="h-4 w-4 mr-1.5" />
                  Media
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {activePanel === "signaling" && (
              <div className="flex flex-wrap items-center gap-1.5 min-w-0 w-full">
                <span className="section-label-sm px-1 text-[10px] tracking-[0.06em]">Time</span>
                <Select
                  value={signalingTimestampMode}
                  onValueChange={(value) => setSignalingTimestampMode(value as SipTimestampMode)}
                >
                  <SelectTrigger className="ui-control-shell h-7 w-[98px] text-2xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absolute">Clock</SelectItem>
                    <SelectItem value="delta">Delta</SelectItem>
                    <SelectItem value="relative">Relative</SelectItem>
                  </SelectContent>
                </Select>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <TooltipWrapper
                  title={flowPaneCollapsed ? "Show flow pane" : "Hide flow pane"}
                  description="Toggle the left-side signaling flow."
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={flowPaneCollapsed ? "Show flow pane" : "Hide flow pane"}
                    className={cn("h-7 gap-1 text-2xs px-2", !flowPaneCollapsed && "bg-accent/60")}
                    onClick={() => setFlowPaneCollapsed((prev) => !prev)}
                  >
                    {flowPaneCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
                    <span>Flow</span>
                  </Button>
                </TooltipWrapper>
                {hasSelectedSipPacket && (
                  <TooltipWrapper
                    title={effectivePacketPaneCollapsed ? "Show packet pane" : "Hide packet pane"}
                    description="Toggle the right-side details pane."
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={effectivePacketPaneCollapsed ? "Show packet pane" : "Hide packet pane"}
                      className={cn("h-7 gap-1 text-2xs px-2", !effectivePacketPaneCollapsed && "bg-accent/60")}
                      onClick={() => setPacketPaneCollapsed((prev) => !prev)}
                    >
                      {effectivePacketPaneCollapsed ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />}
                      <span>Packet</span>
                    </Button>
                  </TooltipWrapper>
                )}
                <TooltipWrapper
                  title="Reset layout"
                  description="Restore default pane visibility and width."
                >
                  <Button
                    variant="neutral"
                    size="sm"
                    aria-label="Reset split layout"
                    className="h-7 gap-1 text-2xs px-2.5 font-medium"
                    onClick={() => {
                      setPacketPaneCollapsed(false);
                      setFlowPaneCollapsed(false);
                      setSignalingSplitPct(36);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset</span>
                  </Button>
                </TooltipWrapper>
                {sessionId && selectedItem?.kind === "sip" && (
                  <Button
                    variant="neutral"
                    size="sm"
                    className="h-7 gap-1 text-2xs px-2.5 font-medium"
                    onClick={() => {
                      openViewer(sessionId);
                      navigateTo("packet-capture", "captures");
                    }}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Viewer
                  </Button>
                )}
                </div>
              </div>
            )}
          </div>
        </div>

        <section className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {!sessionId ? (
            <EmptyState
              variant="inline"
              icon={<Activity />}
              title="Select a capture"
              description="Choose a capture session from the sidebar to analyze call signaling and media."
              action={(
                <Button
                  size="sm"
                  variant="neutral"
                  className="h-8 gap-1.5 px-3 text-xs"
                  onClick={() => navigateTo("packet-capture", "captures")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Captures
                </Button>
              )}
            />
          ) : !selectedDialog ? (
            loadingDialogs ? (
              <EmptyState
                variant="inline"
                icon={<Loader2 className="animate-spin" />}
                title="Loading calls"
                description="Reading SIP dialogs from this capture session."
              />
            ) : dialogs.length === 0 ? (
              <EmptyState
                variant="inline"
                icon={<GitBranch />}
                title="No dialogs found"
                description="This capture does not contain any SIP dialogs to analyze."
              />
            ) : isFilteredToNoMatches ? (
              <EmptyState
                variant="inline"
                icon={<Search />}
                title="No calls match this filter"
                description="Try broadening your search to find a dialog."
              />
            ) : (
              <EmptyState
                variant="inline"
                icon={<GitBranch />}
                title="Select a call"
                description="Choose a call from the list above to analyze signaling and media quality."
              />
            )
          ) : (
            <div
              className="flex-1 min-h-0"
            >
              {activePanel === "signaling" ? (
                <div className="h-full min-h-0 overflow-hidden flex flex-col">
                  <div ref={signalingSplitRef} className="flex-1 min-h-0 overflow-hidden flex">
                    {!flowPaneCollapsed && (
                      <div
                        className={cn("h-full min-h-0 overflow-auto", effectivePacketPaneCollapsed ? "w-full" : "")}
                        style={!effectivePacketPaneCollapsed ? { width: `${signalingSplitPct}%` } : undefined}
                      >
                        <SipLadderView
                          messages={messages}
                          participants={participantLabels}
                          participantDetails={participantDetails}
                          timestampMode={signalingTimestampMode}
                          selectedMessageIndex={selectedMessageIndex}
                          onSelectMessage={(index) => {
                            if (index === null) setSelectedItem(null);
                            else if (messages[index]) {
                              setSelectedItem({ kind: "sip", message: messages[index], index });
                              setPacketPaneCollapsed(false);
                            }
                          }}
                        />
                      </div>
                    )}

                    {!effectivePacketPaneCollapsed && !flowPaneCollapsed && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        className="w-1.5 shrink-0 cursor-col-resize bg-border/35 hover:bg-primary/50 transition-colors"
                        onMouseDown={() => setIsResizingSignaling(true)}
                      />
                    )}

                    {!effectivePacketPaneCollapsed && (
                      <div className={cn("h-full min-h-0 overflow-auto", flowPaneCollapsed ? "w-full" : "flex-1")}>
                        {selectedPacketLoading ? (
                          <EmptyState
                            compact
                            variant="inline"
                            icon={<Loader2 className="animate-spin" />}
                            title="Loading packet"
                            description="Fetching packet details for the selected signaling message."
                            className="h-full p-6"
                          />
                        ) : selectedItem?.kind !== "sip" ? (
                          <EmptyState
                            compact
                            variant="inline"
                            icon={<GitBranch />}
                            title="Select a signaling message"
                            description="Choose a SIP event in the ladder to inspect packet details."
                            className="h-full p-6"
                          />
                        ) : (
                          <PacketDetailsView packet={selectedPacket} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                  <MediaAnalysisWorkspace
                    sessionId={sessionId}
                    prioritizedStreams={prioritizedStreams}
                    mediaSummary={mediaSummary}
                    mediaHealth={mediaHealth}
                    findingsByStream={findingsByStream}
                    selectedStream={selectedItem?.kind === "rtp" ? selectedItem.stream : null}
                    onSelectStream={(stream, index) => setSelectedItem({ kind: "rtp", stream, index })}
                    onClearSelection={() => setSelectedItem(null)}
                    consolidatedStreams={consolidatedStreams}
                    expertFindings={expertFindings}
                  />
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
