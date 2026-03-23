/**
 * FaxesView — Unified sent + received fax list with detail/preview panel.
 *
 * Replaces FaxActivityView + FaxInboxView.
 *
 * Layout: Left list (38%) + Right detail/preview (62%)
 * Active jobs (sending + receiving) are pinned at top.
 * Filter pills: All | Sent | Received
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { getFaxAuditLog, cancelFax } from "@/api/fax";
import { getRtpStreams } from "@/api/packetCapture";
import type { FaxAuditEntry } from "@/api/fax";
import type { SentFaxJob, ReceivedFax } from "@/types/fax";
import type { RtpStreamInfo } from "@/types/packetCapture";
import type { FaxSendProgress, FaxReceiveProgress } from "./FaxShared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppDropdown } from "@/components/ui/app-dropdown";
import {
  Loader2,
  ArrowUpDown,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Trash2,
  XCircle,
  RefreshCw,
  Radio,
  Shield,
  Send,
  Inbox,
  FileText,
  Download,
  Printer,
} from "@/lib/icons";
import { navigateTo } from "@/lib/navigation";
import { formatRelativeTime } from "@/lib/dateTime";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  TransportBadge,
  TEST_PAGES,
  formatBaud,
  formatDuration,
  phaseLabel,
  phasePct,
} from "./FaxShared";
import { TestPagePreviewPanel } from "./FaxSendView";
import { FaxLiveDiagnostics } from "./FaxLiveDiagnostics";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

type Filter = "all" | "sent" | "received";
type HistorySort = "newest" | "oldest" | "status" | "pages";
const NO_FOLDER_VALUE = "__none__";

/** Unified item for the fax list — either a sent job or a received fax */
type FaxListItem =
  | { kind: "sent"; job: SentFaxJob }
  | { kind: "received"; fax: ReceivedFax };

interface FaxesViewProps {
  sendingProgress: Record<string, FaxSendProgress>;
  receivingProgress: Record<string, FaxReceiveProgress>;
}

/* ═══════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════ */

export function FaxesView({ sendingProgress, receivingProgress }: FaxesViewProps) {
  const sentFaxJobs = useTroubleshootingStore((s) => s.sentFaxJobs);
  const receivedFaxes: ReceivedFax[] = useTroubleshootingStore((s) => s.receivedFaxes) ?? [];
  const updateSentFaxJob = useTroubleshootingStore((s) => s.updateSentFaxJob);
  const removeSentFaxJob = useTroubleshootingStore((s) => s.removeSentFaxJob);
  const removeReceivedFax = useTroubleshootingStore((s) => s.removeReceivedFax);
  const faxFolders = useTroubleshootingStore((s) => s.faxFolders);
  const faxFolderAssignments = useTroubleshootingStore((s) => s.faxFolderAssignments);
  const createFaxFolder = useTroubleshootingStore((s) => s.createFaxFolder);
  const renameFaxFolder = useTroubleshootingStore((s) => s.renameFaxFolder);
  const deleteFaxFolder = useTroubleshootingStore((s) => s.deleteFaxFolder);
  const assignFaxFolder = useTroubleshootingStore((s) => s.assignFaxFolder);

  const [filter, setFilter] = useState<Filter>("all");
  const [registrarFilter, setRegistrarFilter] = useState<string>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [historySort, setHistorySort] = useState<HistorySort>("newest");
  const [historyQuery, setHistoryQuery] = useState("");
  const [folderManagerOpen, setFolderManagerOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<FaxAuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedHistoryKeys, setSelectedHistoryKeys] = useState<Set<string>>(new Set());
  const [lastSelectedHistoryKey, setLastSelectedHistoryKey] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteDialogMeta, setDeleteDialogMeta] = useState<{
    mode: "single" | "bulk";
    kind?: "sent" | "received";
    label?: string;
  } | null>(null);
  const metricHydrationAttemptsRef = useRef<Set<string>>(new Set());

  const fetchAudit = useCallback(async () => {
    setLoadingAudit(true);
    try { setAuditLogs((await getFaxAuditLog(200)) ?? []); } catch { /* */ }
    finally { setLoadingAudit(false); }
  }, []);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  // Backfill packet metrics for historical jobs using job or audit capture IDs.
  useEffect(() => {
    let cancelled = false;
    const candidates = sentFaxJobs.filter(
      (job) =>
        !job.packetMetrics &&
        !metricHydrationAttemptsRef.current.has(job.id) &&
        (job.status === "sent" || job.status === "failed"),
    );
    if (!candidates.length) return;

    for (const job of candidates) {
      const audit = auditLogs.find(
        (entry) =>
          (job.sipCallId && entry.sip_call_id === job.sipCallId) ||
          entry.job_id === job.id,
      );
      const captureSessionId = job.captureSessionId ?? audit?.capture_session_id;
      if (!captureSessionId) continue;
      metricHydrationAttemptsRef.current.add(job.id);
      getRtpStreams(captureSessionId)
        .then((streams) => {
          if (cancelled) return;
          const stats = buildRtpStats(streams ?? []);
          if (stats) {
            updateSentFaxJob(job.id, {
              captureSessionId: job.captureSessionId ?? captureSessionId,
              packetMetrics: {
                ...stats,
                capturedAt: new Date().toISOString(),
              },
            });
          } else if (!job.captureSessionId) {
            updateSentFaxJob(job.id, { captureSessionId });
          }
        })
        .catch(() => {
          // Ignore unavailable capture stream details.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [sentFaxJobs, auditLogs, updateSentFaxJob]);

  const registrarOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const j of sentFaxJobs) {
      if (j.registrarId) byId.set(j.registrarId, j.registrarName ?? j.registrarId);
    }
    for (const f of receivedFaxes) {
      if (f.session.registrarId) byId.set(f.session.registrarId, f.session.registrarName ?? f.session.registrarId);
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sentFaxJobs, receivedFaxes]);

  const matchesSentRegistrar = useCallback(
    (job: SentFaxJob) => registrarFilter === "all" || job.registrarId === registrarFilter,
    [registrarFilter],
  );
  const matchesReceivedRegistrar = useCallback(
    (fax: ReceivedFax) => registrarFilter === "all" || fax.session.registrarId === registrarFilter,
    [registrarFilter],
  );
  const matchesActiveReceiveRegistrar = useCallback(
    (rx: FaxReceiveProgress) => registrarFilter === "all" || rx.registrarId === registrarFilter,
    [registrarFilter],
  );

  /* ── Active jobs ── */
  const activeSendJobs = useMemo(
    () => sentFaxJobs.filter((j) => j.status === "sending" && matchesSentRegistrar(j)),
    [sentFaxJobs, matchesSentRegistrar],
  );
  const activeReceives = useMemo(
    () => Object.values(receivingProgress).filter((rx) => matchesActiveReceiveRegistrar(rx)),
    [receivingProgress, matchesActiveReceiveRegistrar],
  );

  /* ── History (completed) ── */
  const completedSent = useMemo(
    () => sentFaxJobs.filter((j) => (j.status === "sent" || j.status === "failed") && matchesSentRegistrar(j)),
    [sentFaxJobs, matchesSentRegistrar],
  );
  const filteredReceivedFaxes = useMemo(
    () => receivedFaxes.filter((f) => matchesReceivedRegistrar(f)),
    [receivedFaxes, matchesReceivedRegistrar],
  );

  const statusRank = useCallback((item: FaxListItem): number => {
    if (item.kind === "received") return 1;
    if (item.job.status === "sent") return 0;
    return 2;
  }, []);

  const getItemTimestamp = useCallback((item: FaxListItem): number => {
    const t = item.kind === "sent" ? (item.job.completedAt ?? item.job.createdAt) : item.fax.receivedAt;
    return new Date(t).getTime();
  }, []);

  const getItemPageCount = useCallback((item: FaxListItem): number => {
    return item.kind === "sent" ? item.job.pageCount : item.fax.pageCount;
  }, []);

  /* ── Merged + filtered + sorted list (memoized to avoid re-sorting on every render) ── */
  const historyItems = useMemo(() => {
    let items: FaxListItem[] = [];
    if (filter === "all" || filter === "sent") {
      items = items.concat(completedSent.map((j) => ({ kind: "sent" as const, job: j })));
    }
    if (filter === "all" || filter === "received") {
      items = items.concat(filteredReceivedFaxes.map((f) => ({ kind: "received" as const, fax: f })));
    }

    if (folderFilter !== "all") {
      items = items.filter((item) => {
        const key = item.kind === "sent" ? `sent:${item.job.id}` : `received:${item.fax.id}`;
        return faxFolderAssignments[key] === folderFilter;
      });
    }

    const query = historyQuery.trim().toLowerCase();
    if (query) {
      items = items.filter((item) => {
        if (item.kind === "sent") {
          return [
            item.job.target,
            item.job.registrarName,
            item.job.registrarId,
            item.job.status,
            item.job.agentName,
          ]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(query));
        }
        return [
          item.fax.sender,
          item.fax.session.registrarName,
          item.fax.session.registrarId,
          item.fax.documentFormat,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query));
      });
    }

    items.sort((a, b) => {
      if (historySort === "oldest") return getItemTimestamp(a) - getItemTimestamp(b);
      if (historySort === "pages") {
        const pageDiff = getItemPageCount(b) - getItemPageCount(a);
        if (pageDiff !== 0) return pageDiff;
        return getItemTimestamp(b) - getItemTimestamp(a);
      }
      if (historySort === "status") {
        const rankDiff = statusRank(a) - statusRank(b);
        if (rankDiff !== 0) return rankDiff;
        return getItemTimestamp(b) - getItemTimestamp(a);
      }
      return getItemTimestamp(b) - getItemTimestamp(a);
    });
    return items;
  }, [filter, completedSent, filteredReceivedFaxes, folderFilter, faxFolderAssignments, historySort, historyQuery, getItemTimestamp, getItemPageCount, statusRank]);
  const hasAnyHistory = completedSent.length > 0 || filteredReceivedFaxes.length > 0;
  const visibleHistoryItems = useMemo(() => historyItems.slice(0, 100), [historyItems]);

  const historyKeyForItem = useCallback((item: FaxListItem): string => {
    return item.kind === "sent" ? `sent:${item.job.id}` : `received:${item.fax.id}`;
  }, []);

  const folderForItem = useCallback((item: FaxListItem): string => {
    const assigned = faxFolderAssignments[historyKeyForItem(item)];
    if (!assigned) return NO_FOLDER_VALUE;
    const valid = faxFolders.some((folder) => folder.id === assigned);
    return valid ? assigned : NO_FOLDER_VALUE;
  }, [faxFolderAssignments, faxFolders, historyKeyForItem]);

  const setFolderForItem = useCallback((item: FaxListItem, folder: string) => {
    const key = historyKeyForItem(item);
    assignFaxFolder(key, folder === NO_FOLDER_VALUE ? "" : folder);
  }, [assignFaxFolder, historyKeyForItem]);

  const visibleHistoryKeys = useMemo(
    () => visibleHistoryItems.map((item) => historyKeyForItem(item)),
    [historyKeyForItem, visibleHistoryItems],
  );
  const visibleHistoryKeyIndex = useMemo(() => {
    const indexByKey = new Map<string, number>();
    visibleHistoryKeys.forEach((key, index) => indexByKey.set(key, index));
    return indexByKey;
  }, [visibleHistoryKeys]);

  const selectHistoryItem = useCallback((item: FaxListItem, useRangeSelection: boolean) => {
    const key = historyKeyForItem(item);
    const keyIndex = visibleHistoryKeyIndex.get(key);
    const lastIndex = lastSelectedHistoryKey ? visibleHistoryKeyIndex.get(lastSelectedHistoryKey) : undefined;

    if (
      useRangeSelection &&
      keyIndex != null &&
      lastIndex != null
    ) {
      const start = Math.min(lastIndex, keyIndex);
      const end = Math.max(lastIndex, keyIndex);
      setSelectedHistoryKeys((prev) => {
        const next = new Set(prev);
        for (let index = start; index <= end; index += 1) {
          const rangeKey = visibleHistoryKeys[index];
          if (rangeKey) next.add(rangeKey);
        }
        return next;
      });
    } else {
      setSelectedHistoryKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }

    setLastSelectedHistoryKey(key);
  }, [historyKeyForItem, lastSelectedHistoryKey, visibleHistoryKeyIndex, visibleHistoryKeys]);

  /* ── Selection resolution ── */
  const selectedSentJob = sentFaxJobs.find((j) => j.id === selectedId);
  const selectedReceived = filteredReceivedFaxes.find((f) => f.id === selectedId);
  const selectedActiveSend = activeSendJobs.find((j) => j.id === selectedId);
  const selectedActiveReceive = activeReceives.find((r) => r.receiveId === selectedId);
  const selectedAudit = selectedSentJob
    ? auditLogs.find(
        (e) =>
          (selectedSentJob.sipCallId && e.sip_call_id === selectedSentJob.sipCallId) ||
          e.job_id === selectedSentJob.id,
      )
    : undefined;

  /* ── Cancel handler for active sends ── */
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const handleCancelSend = async (jobId: string) => {
    setCancellingId(jobId);
    try { await cancelFax(jobId); } catch { /* */ }
    updateSentFaxJob(jobId, { status: "failed", errorMessage: "Cancelled by user", completedAt: new Date().toISOString() });
    setCancellingId(null);
  };

  const totalActive = activeSendJobs.length + activeReceives.length;
  const showHistoryFilters = hasAnyHistory;

  // Auto-select the newest active sending job when it first appears
  const prevActiveSendIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const prevIds = prevActiveSendIdsRef.current;
    const newJob = activeSendJobs.find((j) => !prevIds.has(j.id));
    if (newJob) {
      setSelectedId(newJob.id);
    }
    prevActiveSendIdsRef.current = new Set(activeSendJobs.map((j) => j.id));
  }, [activeSendJobs]);

  useEffect(() => {
    if (!selectedId) return;
    const isVisibleInActive = activeSendJobs.some((j) => j.id === selectedId) || activeReceives.some((r) => r.receiveId === selectedId);
    const isVisibleInHistory = historyItems.some((item) => (item.kind === "sent" ? item.job.id === selectedId : item.fax.id === selectedId));
    if (!isVisibleInActive && !isVisibleInHistory) {
      setSelectedId(null);
    }
  }, [selectedId, activeSendJobs, activeReceives, historyItems]);

  useEffect(() => {
    if (!selectedId) setDetailsOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectionMode) {
      setSelectedHistoryKeys(new Set());
      setLastSelectedHistoryKey(null);
    }
  }, [selectionMode]);

  useEffect(() => {
    if (folderFilter === "all") return;
    if (!faxFolders.some((folder) => folder.id === folderFilter)) {
      setFolderFilter("all");
    }
  }, [faxFolders, folderFilter]);

  useEffect(() => {
    const legacyUnifiedFolder = faxFolders.find((folder) => folder.name.trim().toLowerCase() === "unified");
    if (legacyUnifiedFolder) {
      deleteFaxFolder(legacyUnifiedFolder.id);
    }
  }, [deleteFaxFolder, faxFolders]);

  useEffect(() => {
    if (!selectionMode || selectedHistoryKeys.size === 0) return;
    const visibleKeys = new Set(visibleHistoryItems.map((item) => historyKeyForItem(item)));
    setSelectedHistoryKeys((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((key) => {
        if (visibleKeys.has(key)) next.add(key);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [selectionMode, selectedHistoryKeys.size, visibleHistoryItems, historyKeyForItem]);

  const selectAllVisibleHistory = useCallback(() => {
    setSelectedHistoryKeys(new Set(visibleHistoryItems.map((item) => historyKeyForItem(item))));
    setLastSelectedHistoryKey(visibleHistoryKeys[visibleHistoryKeys.length - 1] ?? null);
  }, [historyKeyForItem, visibleHistoryItems, visibleHistoryKeys]);

  const clearHistorySelection = useCallback(() => {
    setSelectedHistoryKeys(new Set());
    setLastSelectedHistoryKey(null);
  }, []);

  const handleCreateFolder = useCallback(() => {
    const id = createFaxFolder(newFolderName);
    if (id) {
      setNewFolderName("");
      setFolderFilter(id);
    }
  }, [createFaxFolder, newFolderName]);

  const handleRenameFolder = useCallback((folderId: string) => {
    const nextName = (renameDrafts[folderId] ?? "").trim();
    if (!nextName) return;
    renameFaxFolder(folderId, nextName);
  }, [renameDrafts, renameFaxFolder]);

  const handleDeleteSelectedHistory = useCallback(() => {
    const selected = new Set(selectedHistoryKeys);
    const deletingSelectedDetail =
      selectedId != null &&
      (selected.has(`sent:${selectedId}`) || selected.has(`received:${selectedId}`));

    selected.forEach((key) => {
      if (key.startsWith("sent:")) {
        removeSentFaxJob(key.slice("sent:".length));
      } else if (key.startsWith("received:")) {
        removeReceivedFax(key.slice("received:".length));
      }
    });

    if (deletingSelectedDetail) {
      setSelectedId(null);
    }
    setSelectedHistoryKeys(new Set());
    setLastSelectedHistoryKey(null);
    setSelectionMode(false);
    setDeleteDialogMeta(null);
  }, [removeReceivedFax, removeSentFaxJob, selectedHistoryKeys, selectedId]);

  const requestDeleteByKeys = useCallback((keys: string[]) => {
    if (!keys.length) return;
    if (keys.length === 1) {
      const [key] = keys;
      if (key?.startsWith("sent:")) {
        const id = key.slice("sent:".length);
        const sent = sentFaxJobs.find((j) => j.id === id);
        setDeleteDialogMeta({
          mode: "single",
          kind: "sent",
          label: sent?.target ?? "this sent fax",
        });
      } else if (key?.startsWith("received:")) {
        const id = key.slice("received:".length);
        const received = receivedFaxes.find((f) => f.id === id);
        setDeleteDialogMeta({
          mode: "single",
          kind: "received",
          label: received?.sender ?? "this received fax",
        });
      } else {
        setDeleteDialogMeta({ mode: "bulk" });
      }
    } else {
      setDeleteDialogMeta({ mode: "bulk" });
    }
    setSelectedHistoryKeys(new Set(keys));
    setConfirmDeleteOpen(true);
  }, [receivedFaxes, sentFaxJobs]);

  const selectedSentCount = useMemo(
    () => Array.from(selectedHistoryKeys).filter((key) => key.startsWith("sent:")).length,
    [selectedHistoryKeys],
  );
  const selectedReceivedCount = useMemo(
    () => Array.from(selectedHistoryKeys).filter((key) => key.startsWith("received:")).length,
    [selectedHistoryKeys],
  );
  const successfulSentCount = useMemo(
    () => completedSent.filter((job) => job.status === "sent").length,
    [completedSent],
  );
  const failedSentCount = useMemo(
    () => completedSent.filter((job) => job.status === "failed").length,
    [completedSent],
  );
  const selectedPaneTitle = selectedActiveSend
    ? "Active Send Session"
    : selectedActiveReceive
      ? "Active Receive Session"
      : selectedSentJob
        ? "Sent Fax Case"
        : selectedReceived
          ? "Received Fax Case"
          : "Fax Case Workspace";
  const selectedPaneSubtitle = selectedActiveSend
    ? selectedActiveSend.target
    : selectedActiveReceive
      ? selectedActiveReceive.sender ?? "Unknown sender"
      : selectedSentJob
        ? selectedSentJob.target
        : selectedReceived
          ? selectedReceived.sender
          : "Select any fax from the queue to inspect diagnostics and documents.";

  return (
    <div className="h-full min-h-0 ui-panel-shell overflow-hidden">
      <div className="h-full flex min-h-0">
      <div className={cn(
        "flex flex-col min-h-0 bg-muted/10",
        detailsOpen ? "w-[34%] border-r border-border/40" : "w-full"
      )}>
        <div className="shrink-0 border-b border-border/40 px-3 py-2.5 bg-background/50 space-y-2">
          <div className="rounded-md border border-border/35 bg-background/70 p-2 space-y-2">
            <div className="flex items-center gap-2">
              {showHistoryFilters ? (
                <div className="subview-tabs-compact">
                  {(["all", "sent", "received"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      aria-pressed={filter === f}
                      data-state={filter === f ? "active" : "inactive"}
                      className="subview-tab-compact capitalize"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="section-label-sm">Active Sessions</span>
              )}
              <Input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Search number, sender, registrar..."
                className="h-8 text-xs flex-1 min-w-[170px]"
              />
              <TooltipWrapper title="Refresh" description="Reload fax history and audit logs.">
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={fetchAudit} disabled={loadingAudit}>
                  {loadingAudit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </TooltipWrapper>
              {selectedId && !detailsOpen && (
                <Button variant="outline" size="sm" className="h-8 px-2 text-xs shrink-0" onClick={() => setDetailsOpen(true)}>
                  <ChevronRight className="h-3.5 w-3.5 mr-1" />
                  Open
                </Button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1">
                <p className="text-3xs uppercase tracking-wider text-muted-foreground">Active</p>
                <p className="text-xs font-semibold text-foreground tabular-nums">{totalActive}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1">
                <p className="text-3xs uppercase tracking-wider text-muted-foreground">Sent</p>
                <p className="text-xs font-semibold text-success tabular-nums">{successfulSentCount}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1">
                <p className="text-3xs uppercase tracking-wider text-muted-foreground">Failed</p>
                <p className="text-xs font-semibold text-destructive tabular-nums">{failedSentCount}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1">
                <p className="text-3xs uppercase tracking-wider text-muted-foreground">Received</p>
                <p className="text-xs font-semibold text-primary tabular-nums">{filteredReceivedFaxes.length}</p>
              </div>
            </div>
          </div>

          {!selectionMode ? (
            <div className="rounded-md border border-border/35 bg-background/70 p-2 flex items-center gap-2">
              <AppDropdown
                value={historySort}
                onValueChange={(v) => setHistorySort(v as HistorySort)}
                className="ui-control-shell h-8 w-[118px] px-2 text-xs shrink-0"
                triggerPrefix={<ArrowUpDown className="h-3 w-3 text-muted-foreground mr-1" />}
                options={[
                  { value: "newest", label: "Newest" },
                  { value: "oldest", label: "Oldest" },
                  { value: "status", label: "Status" },
                  { value: "pages", label: "Pages" },
                ]}
              />
              <AppDropdown
                value={registrarFilter}
                onValueChange={setRegistrarFilter}
                className="ui-control-shell h-8 w-[170px] px-2 text-xs shrink-0"
                placeholder="All registrars"
                options={[
                  { value: "all", label: "All registrars" },
                  ...registrarOptions.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
              <AppDivider orientation="vertical" size="lg" className="mx-0 h-6 shrink-0" />
              <button
                type="button"
                onClick={() => setFolderFilter("all")}
                className={cn(
                  "h-8 rounded-md border px-2.5 text-xs transition-smooth shrink-0",
                  folderFilter === "all"
                    ? "bg-primary/12 border-primary/30 text-primary"
                    : "border-border/40 text-muted-foreground hover:bg-accent/30"
                )}
              >
                All folders
              </button>
              <div className="flex-1 overflow-x-auto">
                <div className="flex items-center gap-1.5 min-w-max pr-2">
                  {faxFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setFolderFilter(folder.id)}
                      className={cn(
                        "h-8 rounded-md border px-2.5 text-xs transition-smooth",
                        folderFilter === folder.id
                          ? "bg-primary/12 border-primary/30 text-primary"
                          : "border-border/40 text-muted-foreground hover:bg-accent/30"
                      )}
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
              </div>
              <Popover open={folderManagerOpen} onOpenChange={setFolderManagerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Manage folders">
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-3" align="end">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-foreground">Manage folders</p>
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={newFolderName}
                        onChange={(event) => setNewFolderName(event.target.value)}
                        placeholder="Create folder"
                        className="h-8 text-xs"
                      />
                      <Button size="sm" className="h-8 px-2 text-xs" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                        Add
                      </Button>
                    </div>
                    <div className="space-y-1.5 max-h-[220px] overflow-auto">
                      {faxFolders.map((folder) => {
                        const draft = renameDrafts[folder.id] ?? folder.name;
                        return (
                          <div key={folder.id} className="flex items-center gap-1.5 rounded-md border border-border/35 px-2 py-1.5">
                            <Input
                              value={draft}
                              onChange={(event) => setRenameDrafts((prev) => ({ ...prev, [folder.id]: event.target.value }))}
                              className="h-7 text-2xs"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-2xs"
                              onClick={() => handleRenameFolder(folder.id)}
                              disabled={!draft.trim() || draft.trim() === folder.name}
                            >
                              Save
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteFaxFolder(folder.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <TooltipWrapper title="Multi-select" description="Select multiple faxes for bulk actions.">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setSelectionMode(true)}
                  aria-label="Enable multi-select"
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                </Button>
              </TooltipWrapper>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-md border border-border/45 bg-background/60 p-1.5">
              <Badge variant="secondary" className="h-6 px-2 text-2xs border-border/45">
                {selectedHistoryKeys.size} selected
              </Badge>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-2xs" onClick={selectAllVisibleHistory} disabled={visibleHistoryItems.length === 0}>
                <CheckSquare className="h-3.5 w-3.5 mr-1" />
                All
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-2xs" onClick={clearHistorySelection} disabled={selectedHistoryKeys.size === 0}>
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
              <span className="flex-1" />
              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-2xs"
                onClick={() => requestDeleteByKeys(Array.from(selectedHistoryKeys))}
                disabled={selectedHistoryKeys.size === 0}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-2xs"
                onClick={() => {
                  clearHistorySelection();
                  setSelectionMode(false);
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Done
              </Button>
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-auto">
          {/* ── Active jobs pinned top ── */}
          {totalActive > 0 && (
            <div className="px-2 pt-2">
              <div className="rounded-md border border-border/40 bg-background/70 p-2">
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <span className="section-label-sm">Live Traffic</span>
                  <span className="text-2xs text-muted-foreground">{totalActive} active</span>
                </div>
                <div className="space-y-1.5">
                {activeSendJobs.map((job) => (
                  <button key={job.id} type="button" onClick={() => {
                    setSelectedId(job.id);
                    setDetailsOpen(true);
                  }}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left transition-smooth",
                      selectedId === job.id
                        ? "border-primary/35 bg-primary/10"
                        : "border-border/35 hover:bg-accent/30"
                    )}>
                    <div className="flex items-center gap-2">
                      <Send className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-mono font-medium text-foreground truncate">{job.target}</span>
                      <span className="flex-1" />
                      <span className="relative flex h-2 w-2">
                        <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-foreground opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-foreground" />
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-2xs text-muted-foreground">{phaseLabel(sendingProgress[job.id]?.phase)}</span>
                      <span className="flex-1" />
                      <div className="w-16">
                        <Progress value={phasePct(sendingProgress[job.id]?.phase)} className="h-1" />
                      </div>
                    </div>
                  </button>
                ))}
                {activeReceives.map((rx) => (
                  <button key={rx.receiveId} type="button" onClick={() => {
                    setSelectedId(rx.receiveId);
                    setDetailsOpen(true);
                  }}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left transition-smooth",
                      selectedId === rx.receiveId
                        ? "border-primary/35 bg-primary/10"
                        : "border-border/35 hover:bg-accent/30"
                    )}>
                    <div className="flex items-center gap-2">
                      <Inbox className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-mono font-medium text-foreground truncate">{rx.sender ?? "Unknown"}</span>
                      <span className="flex-1" />
                      <span className="relative flex h-2 w-2">
                        <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                      </span>
                    </div>
                    <span className="mt-1 block text-2xs text-muted-foreground">{phaseLabel(rx.phase)}</span>
                  </button>
                ))}
              </div>
            </div>
            </div>
          )}

          {/* ── History ── */}
          {visibleHistoryItems.length > 0 ? (
            <div className="p-2 space-y-1.5">
              <div className="px-1 pb-1">
                <span className="section-label-sm">History</span>
              </div>
              {visibleHistoryItems.map((item) => {
                if (item.kind === "sent") {
                  const j = item.job;
                  const ok = j.status === "sent";
                  const selectedKey = historyKeyForItem(item);
                  const isChecked = selectedHistoryKeys.has(selectedKey);
                  return (
                    <div key={j.id} className="rounded-md border border-border/40 bg-background/80 overflow-hidden">
                      <button
                        type="button"
                        onClick={(event) => {
                          if (selectionMode) {
                            selectHistoryItem(item, event.shiftKey);
                          } else {
                            setSelectedId(j.id);
                            setDetailsOpen(true);
                          }
                        }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-smooth border-l-2",
                          selectedId === j.id
                            ? "bg-primary/12 border-l-primary ring-1 ring-inset ring-primary/30"
                            : "border-l-transparent hover:bg-accent/30"
                        )}
                      >
                        {selectionMode && (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            readOnly
                            onClick={(event) => {
                              event.stopPropagation();
                              selectHistoryItem(item, event.shiftKey);
                            }}
                            className="h-4 w-4 rounded border-border/50 bg-background"
                            aria-label={`Select sent fax to ${j.target}`}
                          />
                        )}
                        <div
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                            ok ? "bg-success/15" : "bg-destructive/15",
                          )}
                        >
                          {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-medium text-foreground block truncate">{j.target}</span>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-3xs px-1.5 py-0 h-4",
                                ok ? "border-success/30 text-success/90" : "border-destructive/30 text-destructive/90"
                              )}
                            >
                              {ok ? "sent" : "failed"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground flex-wrap">
                            <span>{formatRelativeTime(j.completedAt ?? j.createdAt)}</span>
                            {j.pageCount > 0 && <span>{j.pageCount}pg</span>}
                            {j.registrarName && <span>{j.registrarName}</span>}
                            {j.agentName && <span>via {j.agentName}</span>}
                            <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 border-border/40 text-muted-foreground">
                              {faxFolders.find((f) => f.id === folderForItem(item))?.name ?? "No folder"}
                            </Badge>
                          </div>
                        </div>
                        {!selectionMode && (
                          <div
                            className="shrink-0"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <AppDropdown
                              value={folderForItem(item)}
                              onValueChange={(v) => setFolderForItem(item, v)}
                              size="sm"
                              className="ui-control-shell h-7 min-h-7 w-[108px] px-2 text-2xs shrink-0"
                              options={[
                                { value: NO_FOLDER_VALUE, label: "No folder" },
                                ...faxFolders.map((folder) => ({
                                  value: folder.id,
                                  label: folder.name,
                                })),
                              ]}
                            />
                          </div>
                        )}
                        {!selectionMode && (
                          <TooltipWrapper title="Delete fax" description="Remove this sent fax from history.">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={(event) => {
                                event.stopPropagation();
                                requestDeleteByKeys([selectedKey]);
                              }}
                              aria-label={`Delete sent fax to ${j.target}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipWrapper>
                        )}
                      </button>
                    </div>
                  );
                } else {
                  const f = item.fax;
                  const ok = f.session.success;
                  const selectedKey = historyKeyForItem(item);
                  const isChecked = selectedHistoryKeys.has(selectedKey);
                  return (
                    <div key={f.id} className="rounded-md border border-border/40 bg-background/80 overflow-hidden">
                      <button type="button" onClick={(event) => {
                        if (selectionMode) {
                          selectHistoryItem(item, event.shiftKey);
                        } else {
                          setSelectedId(f.id);
                          setDetailsOpen(true);
                        }
                      }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-smooth border-l-2",
                          selectedId === f.id
                            ? "bg-primary/12 border-l-primary ring-1 ring-inset ring-primary/30"
                            : "border-l-transparent hover:bg-accent/30"
                        )}>
                        {selectionMode && (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            readOnly
                            onClick={(event) => {
                              event.stopPropagation();
                              selectHistoryItem(item, event.shiftKey);
                            }}
                            className="h-4 w-4 rounded border-border/50 bg-background"
                            aria-label={`Select fax from ${f.sender}`}
                          />
                        )}
                        <div
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                            ok ? "bg-primary/15" : "bg-destructive/15",
                          )}
                        >
                          {ok ? (
                            <Inbox className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-medium text-foreground block truncate">{f.sender}</span>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-3xs px-1.5 py-0 h-4",
                                ok ? "border-primary/30 text-primary/80" : "border-destructive/30 text-destructive/80",
                              )}
                            >
                              {ok ? "received" : "failed"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground flex-wrap">
                            <span>{formatRelativeTime(f.receivedAt)}</span>
                            <span>{f.pageCount}pg</span>
                            {f.documentFormat && <span className="uppercase">{f.documentFormat}</span>}
                            {f.session.registrarName && <span>{f.session.registrarName}</span>}
                            <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 border-border/40 text-muted-foreground">
                              {faxFolders.find((folder) => folder.id === folderForItem(item))?.name ?? "No folder"}
                            </Badge>
                          </div>
                        </div>
                        {!selectionMode && (
                          <div
                            className="shrink-0"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <AppDropdown
                              value={folderForItem(item)}
                              onValueChange={(v) => setFolderForItem(item, v)}
                              size="sm"
                              className="ui-control-shell h-7 min-h-7 w-[108px] px-2 text-2xs shrink-0"
                              options={[
                                { value: NO_FOLDER_VALUE, label: "No folder" },
                                ...faxFolders.map((folder) => ({
                                  value: folder.id,
                                  label: folder.name,
                                })),
                              ]}
                            />
                          </div>
                        )}
                        {!selectionMode && (
                          <TooltipWrapper title="Delete fax" description="Remove this received fax from history.">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={(event) => {
                                event.stopPropagation();
                                requestDeleteByKeys([selectedKey]);
                              }}
                              aria-label={`Delete received fax from ${f.sender}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipWrapper>
                        )}
                      </button>
                    </div>
                  );
                }
              })}
            </div>
          ) : totalActive === 0 ? (
            <EmptyState variant="inline" icon={<Send />} title="No faxes yet" description="Sent and received faxes will appear here." />
          ) : null}
        </div>
      </div>

      {detailsOpen && (
      <div className="w-[66%] flex flex-col min-h-0 bg-background/40">
        <div className="shrink-0 border-b border-border/40 px-4 py-2.5 bg-background/80 backdrop-blur-sm">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{selectedPaneTitle}</p>
              <p className="text-sm font-medium text-foreground font-mono truncate">{selectedPaneSubtitle}</p>
            </div>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-2xs"
              onClick={() => setDetailsOpen(false)}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Hide details
            </Button>
          </div>
        </div>
        {selectedActiveSend ? (
          <>
            <div className="ui-section-header-md h-11 px-4 flex items-center gap-2 shrink-0 border-b border-border/30">
              <span className="relative flex h-2 w-2">
                <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-foreground opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-foreground" />
              </span>
              <span className="text-xs font-medium text-foreground">Sending to {selectedActiveSend.target}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-6">
              <FaxLiveDiagnostics
                jobId={selectedActiveSend.id}
                target={selectedActiveSend.target}
                progress={sendingProgress[selectedActiveSend.id]}
                onCancel={() => handleCancelSend(selectedActiveSend.id)}
                cancelling={cancellingId === selectedActiveSend.id}
              />
            </div>
          </>
        ) : selectedActiveReceive ? (
          <ActiveReceiveDetail progress={selectedActiveReceive} />
        ) : selectedSentJob && (selectedSentJob.status === "sent" || selectedSentJob.status === "failed") ? (
          <SentFaxDetail job={selectedSentJob} audit={selectedAudit} updateSentFaxJob={updateSentFaxJob} />
        ) : selectedReceived ? (
          <ReceivedFaxDetail fax={selectedReceived} />
        ) : (
          <EmptyState compact variant="inline" title="Select a fax to view details" className="flex-1" />
        )}
      </div>
      )}
      </div>
      {(() => {
        const isSingle = deleteDialogMeta?.mode === "single" && selectedHistoryKeys.size === 1;
        const singleKind = deleteDialogMeta?.kind;
        const singleLabel = deleteDialogMeta?.label;
        const title = isSingle
          ? singleKind === "sent"
            ? "Delete sent fax?"
            : "Delete received fax?"
          : `Delete ${selectedHistoryKeys.size} selected ${selectedHistoryKeys.size === 1 ? "fax" : "faxes"}?`;
        const description = isSingle
          ? singleKind === "sent"
            ? `This will permanently remove the sent fax to ${singleLabel ?? "this target"} from history.`
            : `This will permanently remove the received fax from ${singleLabel ?? "this sender"} from history.`
          : `This will permanently remove ${selectedSentCount} sent and ${selectedReceivedCount} received history item${selectedHistoryKeys.size === 1 ? "" : "s"}. Active jobs are not affected.`;
        return (
          <ConfirmDialog
            open={confirmDeleteOpen}
            onOpenChange={(open) => {
              setConfirmDeleteOpen(open);
              if (!open) setDeleteDialogMeta(null);
            }}
            title={title}
            description={description}
            confirmText={isSingle ? "Delete fax" : "Delete selected"}
            cancelText="Cancel"
            variant="destructive"
            onConfirm={handleDeleteSelectedHistory}
          />
        );
      })()}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Active Receive Detail
   ═══════════════════════════════════════════════════════════════════ */

function ActiveReceiveDetail({ progress }: { progress: FaxReceiveProgress }) {
  const elapsed = progress.elapsedSecs ?? 0;
  const rx = progress.udptlPacketsReceived ?? 0;
  const tx = progress.udptlPacketsSent ?? 0;

  return (
    <>
      <div className="ui-section-header-md h-11 px-4 flex items-center gap-2 shrink-0 border-b border-border/30">
        <span className="relative flex h-2 w-2">
          <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
        </span>
        <span className="text-xs font-medium text-foreground">Receiving from {progress.sender ?? "Unknown"}</span>
        {progress.transport && (
          <Badge variant="secondary" className="text-2xs px-1.5 py-0 h-4 border-primary/40 text-primary ml-auto">{progress.transport}</Badge>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-6 space-y-4">
        <div className="rounded-lg border border-border/40 bg-background/75 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
              <Inbox className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{progress.sender ?? "Unknown Sender"}</p>
              <p className="text-xs text-muted-foreground">{phaseLabel(progress.phase)}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/75 p-4">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">Live transport metrics</p>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Packets RX" value={String(rx)} />
            <StatCard label="Packets TX" value={String(tx)} />
            <StatCard label="Elapsed" value={elapsed > 0 ? `${elapsed}s` : "–"} />
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/75 p-3 text-xs text-muted-foreground">
          Receiving sessions remain visible until handoff completes. Once complete, the document moves into history with full review and folder actions.
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Sent Fax Detail
   ═══════════════════════════════════════════════════════════════════ */

function SentFaxDetail({
  job,
  audit,
  updateSentFaxJob,
}: {
  job: SentFaxJob;
  audit?: FaxAuditEntry;
  updateSentFaxJob: (id: string, update: Partial<SentFaxJob>) => void;
}) {
  const [reviewPage, setReviewPage] = useState(0);
  const [rtpStreams, setRtpStreams] = useState<RtpStreamInfo[]>([]);
  const [loadingRtp, setLoadingRtp] = useState(false);
  const [rtpError, setRtpError] = useState<string | null>(null);

  useEffect(() => {
    setReviewPage(0);
  }, [job.id]);

  useEffect(() => {
    const captureSessionId = job.captureSessionId ?? audit?.capture_session_id;
    if (!captureSessionId) {
      setRtpStreams([]);
      setRtpError(null);
      setLoadingRtp(false);
      return;
    }

    let cancelled = false;
    setLoadingRtp(true);
    setRtpError(null);
    getRtpStreams(captureSessionId)
      .then((streams) => {
        if (cancelled) return;
        const nextStreams = streams ?? [];
        setRtpStreams(nextStreams);
        const nextMetrics = buildRtpStats(nextStreams);
        if (nextMetrics && !isSamePacketMetrics(job.packetMetrics, nextMetrics)) {
          updateSentFaxJob(job.id, {
            packetMetrics: {
              ...nextMetrics,
              capturedAt: new Date().toISOString(),
            },
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRtpStreams([]);
        setRtpError("Unable to load RTP stream diagnostics.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingRtp(false);
      });

    return () => {
      cancelled = true;
    };
  }, [job.id, job.captureSessionId, job.packetMetrics, audit?.capture_session_id, updateSentFaxJob]);

  const ok = job.status === "sent";
  const transport = audit?.transport;
  const baud = audit?.negotiated_baud_rate ?? audit?.baud_rate;
  const ecm = audit?.ecm_used ?? audit?.ecm;
  const pages = audit?.pages_sent ?? audit?.page_count ?? job.pageCount;
  const duration = audit?.duration_ms;
  const errorMsg = job.errorMessage || audit?.error_message;
  const selectedTestPreset = job.sentTestPresetId
    ? TEST_PAGES.find((p) => p.id === job.sentTestPresetId)
    : undefined;
  const isPrebuiltTest = job.source === "prebuilt_test" && Boolean(selectedTestPreset || job.prebuiltDocId);
  const previewPages = job.previewPages ?? [];
  const reviewTotalPages = isPrebuiltTest ? Math.max(1, job.pageCount) : previewPages.length;
  const safeReviewPage = reviewTotalPages > 0 ? Math.min(reviewPage, reviewTotalPages - 1) : 0;
  const diagnosis = getFaxDiagnosis(job, audit);
  const hasCapture = Boolean(job.captureSessionId || audit?.capture_session_id);
  const mediaStats = useMemo(() => buildRtpStats(rtpStreams) ?? job.packetMetrics ?? null, [rtpStreams, job.packetMetrics]);
  const protocolPath = getProtocolPathLabel(audit, job);

  return (
    <>
      <div className="ui-section-header-md h-11 px-4 flex items-center gap-2 shrink-0 flex-wrap border-b border-border/30">
        {ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
        <span className="text-xs font-medium text-foreground font-mono">{job.target}</span>
        <Badge
          variant="secondary"
          className={cn(
            "text-3xs px-1.5 py-0 h-4",
            ok ? "border-success/30 text-success/90" : "border-destructive/30 text-destructive/90",
          )}
        >
          {ok ? "sent" : "failed"}
        </Badge>
        {transport && <TransportBadge transport={transport} />}
        <span className="flex-1" />
        <span className="text-2xs text-muted-foreground">{formatRelativeTime(job.completedAt ?? job.createdAt)}</span>
        {hasCapture && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-2xs"
            onClick={() =>
              navigateTo("packet-capture", "analysis", {
                packetCaptureSessionId: job.captureSessionId ?? audit?.capture_session_id,
                viewerDetailsTab: "raw",
              })
            }
          >
            <Radio className="h-3.5 w-3.5 mr-1" />
            Packet capture
          </Button>
        )}
        {diagnosis.troubleshootArticleId && <TroubleshootLink articleId={diagnosis.troubleshootArticleId} compact />}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-6 space-y-4">
        <section className="rounded-lg border border-border/40 bg-background/75 p-3 space-y-3">
          <div
            className={cn(
              "rounded-lg border px-3 py-3",
              diagnosis.level === "error"
                ? "bg-destructive/5 border-destructive/20"
                : diagnosis.level === "warning"
                  ? "bg-warning/5 border-warning/20"
                  : "bg-success/5 border-success/20",
            )}
          >
            <div className="flex items-start gap-2">
              {diagnosis.level === "error" ? (
                <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              ) : diagnosis.level === "warning" ? (
                <Shield className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{diagnosis.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{diagnosis.summary}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <DetailItem label="Result" value={ok ? "Sent" : "Failed"} />
            <DetailItem label="Issue Class" value={diagnosis.category} />
            <DetailItem label="Protocol Path" value={protocolPath} />
            {job.agentName && <DetailItem label="Via" value={job.agentName} />}
            {job.registrarName && <DetailItem label="Registrar" value={job.registrarName} />}
            {transport && <DetailItem label="Transport" value={transport} />}
            {baud != null && <DetailItem label="Negotiated baud" value={`${formatBaud(baud)} bps`} />}
            {ecm != null && <DetailItem label="ECM" value={ecm ? "Enabled" : "Disabled"} />}
            {pages != null && <DetailItem label="Pages" value={String(pages)} />}
            {duration != null && <DetailItem label="Duration" value={formatDuration(duration)} />}
            {audit?.codec && <DetailItem label="Codec" value={audit.codec} />}
            {audit?.remote_station_id && <DetailItem label="Remote station" value={audit.remote_station_id} />}
            {audit?.sip_call_id && <DetailItem label="SIP Call-ID" value={audit.sip_call_id} mono />}
            {(job.captureSessionId || audit?.capture_session_id) && (
              <DetailItem label="Capture Session" value={job.captureSessionId ?? audit?.capture_session_id ?? "—"} mono />
            )}
            {loadingRtp && !mediaStats && <DetailItem label="Media Metrics" value="Loading capture data..." />}
            {mediaStats && <DetailItem label="RTP Streams" value={String(mediaStats.streamCount)} />}
            {mediaStats && <DetailItem label="Packet Loss" value={`${mediaStats.weightedLoss.toFixed(2)}%`} />}
            {mediaStats && <DetailItem label="Jitter" value={`${mediaStats.weightedJitter.toFixed(1)}ms`} />}
            {mediaStats && <DetailItem label="MOS" value={mediaStats.weightedMos.toFixed(2)} />}
            {mediaStats && <DetailItem label="Packets" value={mediaStats.totalPackets.toLocaleString()} />}
            {mediaStats && <DetailItem label="Worst Loss" value={`${mediaStats.worstLoss.toFixed(2)}%`} />}
            {mediaStats && <DetailItem label="Worst Jitter" value={`${mediaStats.worstJitter.toFixed(1)}ms`} />}
            {job.packetMetrics?.capturedAt && (
              <DetailItem label="Metrics snapshot" value={formatRelativeTime(job.packetMetrics.capturedAt)} />
            )}
          </div>
        </section>

        {!loadingRtp && !mediaStats && (
          <div className="rounded-lg border border-border/40 bg-background/75 px-3 py-2 text-xs text-muted-foreground">
            {rtpError
              ? rtpError
              : transport?.includes("T.38")
                ? "No RTP streams detected. This is expected when fax transport remains on T.38/UDPTL."
                : "No packet-stream quality metrics were available for this session."}
          </div>
        )}

        {audit?.t38_fallback && (
          <div className="flex items-center gap-2 rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning border border-warning/20">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            T.38 fallback to G.711{audit.t38_rejection_reason ? `: ${audit.t38_rejection_reason}` : ""}
          </div>
        )}

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive border border-destructive/20">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {(audit?.request_snippet || audit?.response_snippet) && (
          <div className="rounded-lg border border-border/40 bg-background/75 p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">Signaling excerpts</p>
            {audit?.request_snippet && (
              <pre className="bg-muted/30 rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre">
                {audit.request_snippet}
              </pre>
            )}
            {audit?.response_snippet && (
              <pre className="bg-muted/30 rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre">
                {audit.response_snippet}
              </pre>
            )}
          </div>
        )}

        <section className="rounded-lg border border-border/40 bg-background/75 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Sent pages
            </span>
            <span className="flex-1" />
            {reviewTotalPages > 0 && (
              <span className="text-2xs text-muted-foreground tabular-nums">
                {safeReviewPage + 1} / {reviewTotalPages}
              </span>
            )}
          </div>

          {reviewTotalPages > 0 ? (
            <>
              <div className="subview-tabs-compact overflow-x-auto pb-1">
                {Array.from({ length: reviewTotalPages }).map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    data-state={index === safeReviewPage ? "active" : "inactive"}
                    className="subview-tab-compact ui-hover-press motion-reduce:transform-none focus-visible:shadow-focus shrink-0"
                    onClick={() => setReviewPage(index)}
                  >
                    Page {index + 1}
                  </button>
                ))}
              </div>
              <div className="ui-panel-shell min-h-[360px] flex items-center justify-center rounded-lg overflow-hidden">
                {isPrebuiltTest ? (
                  <TestPagePreviewPanel
                    page={safeReviewPage}
                    mode={job.sentMode ?? "t38"}
                    ecm={job.sentEcm ?? true}
                    baudRate={job.sentBaudRate ?? 14400}
                    toNumber={job.target}
                    generatedAt={job.createdAt}
                    variant={selectedTestPreset?.variant ?? (job.pageCount > 1 ? "full" : "quick")}
                    brandLabel={job.sentBrandLabel}
                    showSipalyzerBrand={selectedTestPreset?.brandable ? false : true}
                  />
                ) : previewPages[safeReviewPage]?.startsWith("data:image") ? (
                  <img src={previewPages[safeReviewPage]} alt={`Sent page ${safeReviewPage + 1}`} className="w-full object-contain max-h-[560px]" />
                ) : (
                  <div className="surface-subtle h-full min-h-[320px] w-full px-6 text-center flex flex-col items-center justify-center gap-2">
                    <FileText className="h-10 w-10 text-muted-foreground/60" />
                    <p className="text-sm font-medium text-foreground">Preview unavailable for this page</p>
                    <p className="text-xs text-muted-foreground">The fax was sent successfully, but a rendered page image was not stored.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="ui-panel-shell p-4">
              <EmptyState
                variant="inline"
                icon={<FileText />}
                title="No page preview saved"
                description={
                    "This fax send does not include stored page thumbnails."
                }
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function getProtocolPathLabel(audit: FaxAuditEntry | undefined, job: SentFaxJob): string {
  if (audit?.t38_fallback) return "T.38 -> G.711 fallback";
  if (audit?.transport) return audit.transport;
  if (job.sentMode === "g711u") return "G.711u";
  if (job.sentMode === "t38") return "T.38";
  return "Unknown";
}

function buildRtpStats(streams: RtpStreamInfo[]) {
  if (!streams.length) return null;
  const weightedSum = streams.reduce(
    (acc, s) => {
      const weight = Math.max(s.packetCount, 1);
      return {
        packets: acc.packets + s.packetCount,
        weightedLoss: acc.weightedLoss + s.lossPercentage * weight,
        weightedJitter: acc.weightedJitter + s.jitter * weight,
        weightedMos: acc.weightedMos + s.mosScore * weight,
        totalWeight: acc.totalWeight + weight,
        worstLoss: Math.max(acc.worstLoss, s.lossPercentage),
        worstJitter: Math.max(acc.worstJitter, s.jitter),
      };
    },
    { packets: 0, weightedLoss: 0, weightedJitter: 0, weightedMos: 0, totalWeight: 0, worstLoss: 0, worstJitter: 0 },
  );

  const denom = Math.max(weightedSum.totalWeight, 1);
  return {
    streamCount: streams.length,
    totalPackets: weightedSum.packets,
    weightedLoss: weightedSum.weightedLoss / denom,
    weightedJitter: weightedSum.weightedJitter / denom,
    weightedMos: weightedSum.weightedMos / denom,
    worstLoss: weightedSum.worstLoss,
    worstJitter: weightedSum.worstJitter,
  };
}

function isSamePacketMetrics(
  existing: SentFaxJob["packetMetrics"] | undefined,
  next: ReturnType<typeof buildRtpStats> | null,
): boolean {
  if (!existing || !next) return false;
  return (
    existing.streamCount === next.streamCount &&
    existing.totalPackets === next.totalPackets &&
    Math.abs(existing.weightedLoss - next.weightedLoss) < 0.0001 &&
    Math.abs(existing.weightedJitter - next.weightedJitter) < 0.0001 &&
    Math.abs(existing.weightedMos - next.weightedMos) < 0.0001 &&
    Math.abs(existing.worstLoss - next.worstLoss) < 0.0001 &&
    Math.abs(existing.worstJitter - next.worstJitter) < 0.0001
  );
}

type FaxDiagnosis = {
  level: "success" | "warning" | "error";
  title: string;
  summary: string;
  category: string;
  nextActions: string[];
  troubleshootArticleId?: string;
};

function getFaxDiagnosis(job: SentFaxJob, audit?: FaxAuditEntry): FaxDiagnosis {
  const message = (job.errorMessage || audit?.error_message || "").toLowerCase();

  if (job.status === "sent") {
    if (audit?.t38_fallback) {
      return {
        level: "warning",
        title: "Sent with fallback transport",
        summary: audit.t38_rejection_reason
          ? `T.38 was rejected and transmission continued over G.711 (${audit.t38_rejection_reason}).`
          : "T.38 was rejected and transmission continued over G.711.",
        category: "Transport fallback",
        nextActions: [
          "If this path is stable, keep current settings and monitor failure rate.",
          "If quality is inconsistent, lower baud rate and keep ECM enabled.",
          "Review packet capture to confirm where T.38 negotiation was rejected.",
        ],
        troubleshootArticleId: "t38-vs-passthrough",
      };
    }
    return {
      level: "success",
      title: "Transmission completed",
      summary: "Fax send completed with no blocking transport errors in the final audit.",
      category: "No fault detected",
      nextActions: [
        "Use Page Review to confirm legibility of fine text and grayscale areas.",
        "Run Full Diagnostic test page for line-quality validation if needed.",
      ],
    };
  }

  if (message.includes("timeout") || message.includes("408") || message.includes("timed out")) {
    return {
      level: "error",
      title: "Signaling timed out",
      summary: "Call setup or protocol handoff did not complete before timeout.",
      category: "Timeout",
      nextActions: [
        "Verify registrar reachability and response timing.",
        "Increase timeout or retry count for high-latency routes.",
        "Check packet capture for missing responses or delayed ACK flow.",
      ],
    };
  }

  if (message.includes("busy") || message.includes("486")) {
    return {
      level: "error",
      title: "Remote endpoint busy",
      summary: "Destination endpoint reported busy or unavailable for this attempt.",
      category: "Remote busy",
      nextActions: [
        "Retry after a short delay.",
        "Validate destination fax number and endpoint availability.",
      ],
    };
  }

  if (message.includes("t.38") || message.includes("t38") || message.includes("488") || message.includes("not acceptable")) {
    return {
      level: "error",
      title: "Transport negotiation failed",
      summary: "Fax transport negotiation failed before stable page transmission.",
      category: "Negotiation",
      nextActions: [
        "Retry with G.711 passthrough mode.",
        "Lower baud rate and keep ECM enabled for noisy paths.",
        "Inspect signaling excerpts for rejection reason details.",
      ],
      troubleshootArticleId: "t38-vs-passthrough",
    };
  }

  if (message.includes("auth") || message.includes("401") || message.includes("403")) {
    return {
      level: "error",
      title: "Authentication or authorization failed",
      summary: "Registrar or endpoint rejected credentials during session setup.",
      category: "Authentication",
      nextActions: [
        "Verify registrar username/password and auth realm.",
        "Re-test registration before sending another fax.",
      ],
    };
  }

  return {
    level: "error",
    title: "Transmission failed",
    summary: job.errorMessage || audit?.error_message || "No additional error details were provided by the backend.",
    category: "General failure",
    nextActions: [
      "Review signaling excerpts for protocol-level context.",
      "Open packet capture and confirm where session teardown starts.",
      "Retry with reduced baud rate if media quality is suspected.",
    ],
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Received Fax Detail
   ═══════════════════════════════════════════════════════════════════ */

function ReceivedFaxDetail({ fax }: { fax: ReceivedFax }) {
  const captureSessionId =
    fax.session.captureSessionId ??
    ((fax.session as FaxReceiveSessionWithLegacyCapture).capture_session_id ?? undefined);
  const canOpenCapture = Boolean(captureSessionId);

  return (
    <>
      <div className="ui-section-header-md h-11 px-4 flex items-center gap-2 shrink-0 border-b border-border/30">
        <Inbox className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium text-foreground font-mono">{fax.sender}</span>
        <span className="flex-1" />
        <span className="text-2xs text-muted-foreground">{formatRelativeTime(fax.receivedAt)}</span>
        <TooltipWrapper title="Save" description="Download the received fax document.">
          <Button variant="outline" size="sm" className="h-7 px-2 gap-1 text-2xs"><Download className="h-3 w-3" />Save</Button>
        </TooltipWrapper>
        <TooltipWrapper title="Print" description="Print the received fax document.">
          <Button variant="outline" size="sm" className="h-7 px-2 gap-1 text-2xs"><Printer className="h-3 w-3" />Print</Button>
        </TooltipWrapper>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-6 space-y-4">
        <div className="rounded-lg border border-border/40 bg-background/75 p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <DetailItem label="From" value={fax.sender} />
            <DetailItem label="Result" value={fax.session.success ? "Received" : "Failed"} />
            <DetailItem label="Pages" value={String(fax.pageCount)} />
            {fax.session.registrarName && <DetailItem label="Registrar" value={fax.session.registrarName} />}
            {fax.session.durationSeconds != null && <DetailItem label="Duration" value={formatDuration(fax.session.durationSeconds * 1000)} />}
          </div>
        </div>

        {!fax.session.success && fax.errorMessage && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive border border-destructive/20">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{fax.errorMessage}</span>
          </div>
        )}

        {fax.documentUrl ? (
          <div className="rounded-lg border border-border/40 bg-background/75 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Document</span>
              <span className="flex-1" />
            </div>
            <div className="rounded-lg overflow-hidden border border-border/30">
              {fax.documentFormat === "image" || fax.documentFormat === "tiff" ? (
                <img src={fax.documentUrl} alt="Fax document" className="w-full object-contain max-h-[500px]" />
              ) : fax.documentFormat === "pdf" ? (
                <iframe src={fax.documentUrl} title="Fax PDF" className="w-full h-[500px] border-0" />
              ) : (
                <div className="surface-subtle h-48 flex items-center justify-center">
                  <FileText className="h-10 w-10 text-muted-foreground/60" />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border/40 bg-background/75 p-4">
            <EmptyState variant="inline" compact icon={<FileText />} title="No preview available" className="h-40" />
          </div>
        )}

        <div className="rounded-lg border border-border/40 bg-background/75 p-3">
          <TooltipWrapper
            title={canOpenCapture ? "View packet capture" : "Packet capture unavailable"}
            description={
              canOpenCapture
                ? "Open this fax session in the packet capture viewer."
                : "No packet capture session is linked to this received fax."
            }
          >
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-2xs"
              onClick={() => {
                if (!captureSessionId) return;
                navigateTo("packet-capture", "analysis", {
                  packetCaptureSessionId: captureSessionId,
                  viewerDetailsTab: "raw",
                });
              }}
              disabled={!canOpenCapture}
            >
              <Radio className="h-3.5 w-3.5 mr-1" />
              {canOpenCapture ? "View packet capture" : "Packet capture unavailable"}
            </Button>
          </TooltipWrapper>
        </div>
      </div>
    </>
  );
}

type FaxReceiveSessionWithLegacyCapture = ReceivedFax["session"] & {
  capture_session_id?: string;
};

/* ═══════════════════════════════════════════════════════════════════
   Small Helpers
   ═══════════════════════════════════════════════════════════════════ */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-panel-shell rounded-lg px-3 py-2.5 text-center hover-lift">
      <span className="text-sm font-bold tabular-nums text-foreground block">{value}</span>
      <span className="text-2xs text-muted-foreground">{label}</span>
    </div>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="section-label-sm block">{label}</span>
      <span className={cn("text-sm text-foreground truncate block", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

