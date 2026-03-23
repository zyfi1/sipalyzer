import { useState, useRef, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type OnChangeFn, type PaginationState } from "@tanstack/react-table";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AdminPasswordDialog } from "./AdminPasswordDialog";
import { cn } from "@/lib/utils";
import {
  Clock,
  Download,
  Search,
  Trash,
  Check,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "@/lib/icons";
import type {
  AuditEntry,
  AuditQueryFilters,
  AuditStats,
} from "@/api/admin";
import { auditActions, auditCategories, auditQuery, auditStats, auditVerifyChain, auditClear } from "@/api/admin";
import { useUnifiedTable } from "@/lib/table/useUnifiedTable";
import { ADMIN_PANEL, ADMIN_VIEW_CONTAINER } from "./viewStyles";

const PAGE_SIZE = 50;

const CATEGORY_COLORS: Record<string, string> = {
  capture: "border-l-emerald-500/40",
  fax: "border-l-amber-500/40",
  registration: "border-l-sky-500/40",
  agent: "border-l-rose-500/40",
  settings: "border-l-violet-500/40",
  admin: "border-l-red-500/40",
  system: "border-l-muted-foreground/40",
  notes: "border-l-indigo-500/40",
  softphone: "border-l-blue-500/40",
};

const CATEGORY_LABELS: Record<string, string> = {
  capture: "Packet Capture",
  fax: "Fax",
  registration: "SIP Registration",
  agent: "Remote Agent",
  settings: "Settings",
  admin: "Admin",
  system: "System",
  notes: "Notes",
  softphone: "Softphone",
};

const ACTION_LABELS: Record<string, string> = {
  start_capture: "Started capture",
  stop_capture: "Stopped capture",
  stop_listener: "Stopped listener",
  place_call: "Placed call",
  end_call: "Ended call",
  start_listener: "Started listener",
  rename: "Renamed agent",
  disconnect: "Disconnected agent",
  kill: "Terminated agent",
  self_destruct: "Self-destructed agent",
  shell_spawn: "Opened remote shell",
  shell_write: "Sent shell input",
  shell_resize: "Resized shell",
  shell_close: "Closed shell",
  generate_start: "Started agent generation",
  generate_success: "Generated agent binary",
  generate_failed: "Agent generation failed",
  connect_relay: "Connected relay session",
  relay_session_ended: "Relay session ended",
  relay_auth_failed: "Relay authentication failed",
  relay_error: "Relay connection error",
  backup_export: "Created full app backup",
  backup_restore: "Restored full app backup",
  create_note: "Created note",
  update_note: "Updated note",
  delete_note: "Deleted note",
  save_config: "Saved settings",
  answer_inbound: "Answered inbound call",
  reject_inbound: "Rejected inbound call",
  create_registrar: "Created registrar",
  update_registrar: "Updated registrar",
  delete_registrar: "Deleted registrar",
  admin_access: "Opened admin center",
  kill_process: "Killed a task",
  app_start: "App launched",
  audit_clear: "Cleared audit log",
  audit_prune: "Auto-cleaned old entries",
  toggle_feature_flag: "Toggled feature flag",
  command_invoked: "Command invoked",
  command_failed: "Command failed",
};

function displayCategory(raw: string): string {
  return CATEGORY_LABELS[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

function displayAction(raw: string): string {
  return ACTION_LABELS[raw] ?? raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function formatDetail(detail: string): string {
  const normalized = detail
    .replace(/^name=/, "Name: ")
    .replace(/, interface=/, " \u2022 Interface: ")
    .replace(/^registrar=/, "Registrar: ")
    .replace(/^port=/, "Port: ")
    .replace(/^host=/, "Host: ")
    .replace(/, provider=/, " \u2022 Provider: ")
    .replace(/, realm=/, " \u2022 Realm: ")
    .replace(/, transport=/, " \u2022 Transport: ")
    .replace(/^rules=/, "Rules: ")
    .replace(/^participant=/, "Participant: ")
    .replace(/, max=/, " \u2022 Max: ");
  try {
    const parsed = JSON.parse(detail);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return normalized;
  }
}

export function AuditLogView() {
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterAction, setFilterAction] = useState<string>("");
  const [filterSearch, setFilterSearch] = useState("");

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    brokenAt: number | null;
  } | null>(null);

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const entriesQuery = useQuery({
    queryKey: ["admin", "audit", "entries", page, filterCategory, filterAction, filterSearch],
    queryFn: () => {
      const filters: AuditQueryFilters = {
        category: filterCategory || null,
        action: filterAction || null,
        search: filterSearch || null,
      };
      return auditQuery(filters, page, PAGE_SIZE);
    },
  });

  const metaQuery = useQuery<{ stats: AuditStats; categories: string[]; actions: string[] }>({
    queryKey: ["admin", "audit", "meta"],
    queryFn: async () => {
      const [stats, categories, actions] = await Promise.all([
        auditStats(),
        auditCategories(),
        auditActions(),
      ]);
      return { stats, categories, actions };
    },
  });

  const entries: AuditEntry[] = entriesQuery.data?.entries ?? [];
  const total = entriesQuery.data?.total ?? 0;
  const stats = metaQuery.data?.stats ?? null;
  const categories = metaQuery.data?.categories ?? [];
  const actions = metaQuery.data?.actions ?? [];
  const loading = entriesQuery.isFetching;

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const [valid, brokenAt] = await auditVerifyChain();
      setVerifyResult({ valid, brokenAt });
    } catch {
      // silent
    } finally {
      setVerifying(false);
    }
  };

  const handleClearConfirm = () => {
    setConfirmClearOpen(false);
    setPasswordDialogOpen(true);
  };

  const handleClearVerified = async (password: string) => {
    try {
      await auditClear(password);
    } catch {
      // ignore — the backend already verified the password
    }
  };

  const handleClearSuccess = async () => {
    setPasswordDialogOpen(false);
    await queryClient.invalidateQueries({ queryKey: ["admin", "audit", "entries"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "audit", "meta"] });
    setVerifyResult(null);
  };

  const handleExport = () => {
    const lines = entries.map((e) =>
      [e.timestamp, e.category, e.action, e.actor, e.target ?? "", e.detail ?? ""].join("\t"),
    );
    const header = "Timestamp\tCategory\tAction\tActor\tTarget\tDetail";
    const tsv = [header, ...lines].join("\n");
    saveExportFile(`audit-log-${new Date().toISOString().slice(0, 10)}.tsv`, textToBase64(tsv), "TSV files", "tsv").catch(() => {});
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(() => [
    { id: "timestamp", accessorKey: "timestamp" },
    { id: "category", accessorKey: "category" },
    { id: "action", accessorKey: "action" },
    { id: "actor", accessorKey: "actor" },
    { id: "target", accessorFn: (row) => row.target ?? "" },
    { id: "detail", accessorFn: (row) => row.detail ?? "" },
    { id: "seq", accessorKey: "seq" },
  ], []);
  const handlePaginationChange = useCallback<OnChangeFn<PaginationState>>((updater) => {
    setPage((prevPage) => {
      const current: PaginationState = { pageIndex: prevPage, pageSize: PAGE_SIZE };
      const next = typeof updater === "function" ? updater(current) : updater;
      return next.pageIndex;
    });
  }, []);
  const { table } = useUnifiedTable<AuditEntry>({
    data: entries,
    columns,
    manualPagination: true,
    pageCount: totalPages,
    pagination: { pageIndex: page, pageSize: PAGE_SIZE },
    onPaginationChange: handlePaginationChange,
    getRowId: (row) => String(row.id),
  });
  const rows = table.getRowModel().rows;

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  };
  return (
    <div className={ADMIN_VIEW_CONTAINER}>
      {/* Stats bar */}
      <div className={ADMIN_PANEL}>
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold tabular-nums">
              {stats?.total_entries ?? 0}
            </span>
            <span className="text-xs text-muted-foreground">entries</span>
          </div>
          {stats?.earliest && (
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(stats.earliest)} &mdash;{" "}
              {stats.latest ? formatTimestamp(stats.latest) : "now"}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {verifyResult && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-2xs font-semibold",
                  verifyResult.valid
                    ? "bg-emerald-500/12 text-emerald-400"
                    : "bg-destructive/12 text-destructive",
                )}
              >
                {verifyResult.valid
                  ? "No tampering detected"
                  : `Tampering detected at entry #${verifyResult.brokenAt}`}
              </span>
            )}
            {stats && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-2xs font-semibold",
                  stats.chain_valid
                    ? "bg-emerald-500/12 text-emerald-400"
                    : "bg-destructive/12 text-destructive",
                )}
              >
                {stats.chain_valid ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1" />
                    Log intact
                  </>
                ) : (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive mr-1" />
                    Log modified
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className={ADMIN_PANEL}>
        <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap">
          <div className="relative flex-1 min-w-[140px] max-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filterSearch}
              onChange={(e) => {
                setFilterSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search..."
              className="pl-8 h-8 text-xs ui-control-shell"
            />
          </div>
          <AppDropdown
            value={filterCategory || "__all__"}
            onValueChange={(v) => {
              setFilterCategory(v === "__all__" ? "" : v);
              setPage(0);
            }}
            className="h-8 w-[130px] text-xs"
            placeholder="Category"
            options={[
              { value: "__all__", label: "All categories" },
              ...categories.map((c) => ({ value: c, label: displayCategory(c) })),
            ]}
          />
          <AppDropdown
            value={filterAction || "__all__"}
            onValueChange={(v) => {
              setFilterAction(v === "__all__" ? "" : v);
              setPage(0);
            }}
            className="h-8 w-[130px] text-xs"
            placeholder="Action"
            options={[
              { value: "__all__", label: "All actions" },
              ...actions.map((a) => ({ value: a, label: displayAction(a) })),
            ]}
          />

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="neutral"
              size="sm"
              onClick={handleVerify}
              disabled={verifying}
              className="h-8 text-xs"
            >
              {verifying ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Check Integrity
            </Button>
            <Button
              variant="neutral"
              size="sm"
              onClick={handleExport}
              className="h-8 text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Log list */}
      <div
        ref={scrollRef}
        className={cn("flex-1 overflow-auto relative", ADMIN_PANEL)}
      >
        {rows.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full p-6">
            <EmptyState
              icon={<Clock className="h-7 w-7" />}
              title="No audit entries"
              description={
                total === 0
                  ? "Actions performed in the app will be recorded here."
                  : "No entries match the current filters."
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {rows.map((row) => {
              const entry = row.original;
              const colorClass =
                CATEGORY_COLORS[entry.category] ??
                "border-l-muted-foreground/40";
              const isExpanded = expandedId === entry.id;
              return (
                <div key={entry.id}>
                  <button
                    onClick={() =>
                      setExpandedId(isExpanded ? null : entry.id)
                    }
                    className={cn(
                      "w-full text-left border-l-2 flex items-center gap-3 px-4 py-3 transition-smooth hover:bg-muted/20",
                      colorClass,
                    )}
                  >
                    <span className="text-muted-foreground/70 flex-shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums w-[120px] flex-shrink-0">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-2xs font-semibold bg-secondary">
                      {displayCategory(entry.category)}
                    </span>
                    <span className="text-sm text-foreground/90 flex-1 truncate">
                      {displayAction(entry.action)}
                    </span>
                    {entry.target && (
                      <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {entry.target}
                      </span>
                    )}
                    <span className="text-muted-foreground/50 tabular-nums w-[40px] text-right flex-shrink-0 text-2xs">
                      #{entry.seq}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="bg-background/35 rounded-md border border-border/40 p-3 text-xs mx-4 mb-3 space-y-2">
                      <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-2xs">
                        <span className="text-muted-foreground">Category</span>
                        <span className="font-mono">{entry.category}</span>
                        <span className="text-muted-foreground">Action</span>
                        <span className="font-mono">{entry.action}</span>
                        <span className="text-muted-foreground">Actor</span>
                        <span className="font-mono">{entry.actor}</span>
                        <span className="text-muted-foreground">Target</span>
                        <span className="font-mono">{entry.target ?? "—"}</span>
                        <span className="text-muted-foreground">Checksum</span>
                        <span className="font-mono break-all">{entry.checksum}</span>
                      </div>
                      <div className="border-t border-border/40 pt-2">
                        <div className="text-2xs text-muted-foreground mb-1">Detail</div>
                        <pre className="whitespace-pre-wrap break-all text-xs font-mono">
                          {entry.detail ? formatDetail(entry.detail) : "—"}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            Page {table.getState().pagination.pageIndex + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              className="h-7 w-7"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              className="h-7 w-7"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Danger zone */}
      <div className={ADMIN_PANEL}>
        <div className="border-t border-border/40 px-3 py-2.5">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmClearOpen(true)}
            className="h-8 text-xs"
          >
            <Trash className="h-3.5 w-3.5 mr-1" />
            Clear Audit Log
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear Audit Log"
        description='This will permanently delete all audit entries. This action cannot be undone. You will need to enter your admin password to confirm.'
        confirmText="Clear"
        variant="destructive"
        onConfirm={handleClearConfirm}
      />

      <AdminPasswordDialog
        open={passwordDialogOpen}
        onClose={() => setPasswordDialogOpen(false)}
        mode="verify"
        onVerified={handleClearVerified}
        onSuccess={handleClearSuccess}
      />
    </div>
  );
}
