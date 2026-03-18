import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Play, RefreshCw } from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
  getDbInfo,
  listTables,
  runQuery,
  type TableInfo,
  type QueryResult,
  type DbInfo,
  vacuumDb,
} from "@/api/admin";
import { ADMIN_PANEL, ADMIN_PANEL_MUTED, ADMIN_VIEW_CONTAINER } from "./viewStyles";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TABLE_DESCRIPTIONS: Record<string, string> = {
  registrars: "SIP registrar configurations",
  global_settings: "App preferences and settings",
  session_state: "Saved session data",
  test_results: "SIP test results and history",
  note_folders: "Note folder organization",
  notes: "User notes and documents",
  note_versions: "Note revision history",
  note_templates: "Note templates",
  registrar_folders: "Registrar folder organization",
  capture_sessions: "Packet capture sessions",
  saved_filters: "Saved packet filter presets",
  packet_bookmarks: "Bookmarked packets",
  scheduled_captures: "Scheduled capture jobs",
  audit_log: "Admin activity log",
  capture_folders: "Capture folder organization",
};

export function DatabaseInspectorView() {
  const [sql, setSql] = useState("SELECT * FROM global_settings LIMIT 100");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [vacuumOpen, setVacuumOpen] = useState(false);
  const [vacuuming, setVacuuming] = useState(false);
  const queryClient = useQueryClient();

  const {
    data: tableData,
    refetch,
  } = useQuery<{ tables: TableInfo[]; dbInfo: DbInfo }>({
    queryKey: ["admin", "database-inspector"],
    queryFn: async () => {
      const [tables, dbInfo] = await Promise.all([listTables(), getDbInfo()]);
      return { tables, dbInfo };
    },
  });

  const vacuumMutation = useMutation({
    mutationFn: vacuumDb,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "database-inspector"] });
    },
  });

  const tables = tableData?.tables ?? [];
  const dbInfo = tableData?.dbInfo ?? null;

  const handleRun = async () => {
    if (!sql.trim()) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const r = await runQuery(sql);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setRunning(false);
    }
  };

  const handleVacuum = async () => {
    setVacuuming(true);
    try {
      await vacuumMutation.mutateAsync();
    } catch {
      // silent
    } finally {
      setVacuuming(false);
      setVacuumOpen(false);
    }
  };

  const handleTableClick = (name: string) => {
    setSql(`SELECT * FROM "${name}" LIMIT 100`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  };
  return (
    <div className={ADMIN_VIEW_CONTAINER}>
      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-3 flex-1 min-h-0">
        {/* Table list sidebar */}
        <div className={cn(ADMIN_PANEL, "overflow-auto min-h-[220px]")}>
          <div className={cn("p-3", ADMIN_PANEL_MUTED)}>
            <p className="text-xs font-semibold text-foreground/90 uppercase tracking-wide">Tables</p>
          </div>
          <div className="divide-y divide-border/30">
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => handleTableClick(t.name)}
                className="w-full text-left flex flex-col gap-0.5 px-3 py-2.5 transition-smooth hover:bg-muted/20"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs text-foreground/90 truncate">{t.name}</span>
                  <span className="rounded-md border border-border/40 bg-muted/25 px-2 py-0.5 text-2xs font-medium text-muted-foreground tabular-nums flex-shrink-0">
                    {t.row_count} {t.row_count === 1 ? "row" : "rows"}
                  </span>
                </div>
                {TABLE_DESCRIPTIONS[t.name] && (
                  <span className="text-muted-foreground text-2xs">
                    {TABLE_DESCRIPTIONS[t.name]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className={cn(ADMIN_PANEL, "flex flex-col min-h-0 overflow-auto")}>
          {/* DB info + actions bar */}
          <div className={cn("flex items-center gap-2 px-4 py-2.5 border-b border-border/40 flex-wrap", ADMIN_PANEL_MUTED)}>
            {dbInfo && (
              <>
                <span className="rounded-md border border-border/40 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">
                  Size: {formatBytes(dbInfo.file_size_bytes)}
                </span>
                <span className="rounded-md border border-border/40 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">
                  {dbInfo.table_count} tables
                </span>
                <span className="rounded-md border border-border/40 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">
                  Mode: {dbInfo.wal_mode === "wal" ? "WAL (Write-Ahead)" : dbInfo.wal_mode}
                </span>
              </>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="neutral"
                size="sm"
                onClick={() => setVacuumOpen(true)}
                className="h-8 text-xs"
              >
                Vacuum
              </Button>
              <Button
                variant="neutral"
                size="sm"
                onClick={() => void refetch()}
                className="h-8 text-xs"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Query editor */}
          <div className="m-3 rounded-md surface overflow-hidden">
            <div className="ui-section-header-md flex items-center justify-between px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">SQL Query (read-only)</p>
              <Button
                size="sm"
                variant="positive"
                onClick={handleRun}
                disabled={running || !sql.trim()}
                className="h-8 text-xs"
              >
                <Play className="h-3 w-3 mr-1" />
                {running ? "Running..." : "Run"}
              </Button>
            </div>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              className="w-full bg-transparent px-3 py-2 text-xs font-mono resize-none focus:outline-none"
              placeholder="SELECT * FROM ..."
              spellCheck={false}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mx-3 rounded-md bg-destructive/10 border border-destructive/35 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="flex-1 overflow-auto m-3 rounded-md surface overflow-hidden">
              <div className="ui-section-header-md px-3 py-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  {result.row_count} row{result.row_count !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30">
                      {result.columns.map((col) => (
                        <th
                          key={col}
                          className="text-left text-xs text-muted-foreground px-3 py-2 font-medium whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/30 hover:bg-accent/30">
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className="px-3 py-1.5 text-xs text-foreground/90 font-mono whitespace-nowrap max-w-[300px] truncate"
                          >
                            {cell === null ? (
                              <span className="text-muted-foreground/50">NULL</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={vacuumOpen}
        onOpenChange={setVacuumOpen}
        title="Vacuum Database"
        description="This will reclaim unused space and optimize the database. The app may briefly pause during the operation."
        confirmText={vacuuming ? "Running..." : "Vacuum"}
        onConfirm={handleVacuum}
      />
    </div>
  );
}
