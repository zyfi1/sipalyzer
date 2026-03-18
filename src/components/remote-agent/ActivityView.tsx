import { useState, useRef, useEffect, useCallback } from "react";
import { useRemoteAgentStore, type ActivityLogEntry } from "@/stores/remoteAgentStore";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { buildHtmlTableReport } from "@/lib/exportHtml";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Trash, Download, Search, List, ChevronDown, ChevronRight,
  Table, FileText,
} from "@/lib/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { exportAuditLog } from "@/api/remoteAgent";
import { save } from "@tauri-apps/plugin-dialog";

// ── Label + color map ──

const TYPE_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  connected:          { label: "Connected",    color: "text-success",            dot: "bg-success" },
  reconnected:        { label: "Reconnected",  color: "text-success",            dot: "bg-success" },
  disconnected:       { label: "Disconnected", color: "text-warning",            dot: "bg-warning" },
  heartbeat_timeout:  { label: "Timeout",      color: "text-destructive",        dot: "bg-destructive" },
  auth_success:       { label: "Auth OK",      color: "text-success",            dot: "bg-success" },
  auth_failed:        { label: "Auth Failed",  color: "text-destructive",        dot: "bg-destructive" },
  generated:          { label: "Deployed",     color: "text-info",               dot: "bg-info" },
  command_sent:       { label: "Command",      color: "text-info",               dot: "bg-info" },
  command_result:     { label: "Result",       color: "text-info",               dot: "bg-info" },
  command_error:      { label: "Error",        color: "text-destructive",        dot: "bg-destructive" },
  permission_error:   { label: "Permission",   color: "text-warning",            dot: "bg-warning" },
  killed:             { label: "Killed",       color: "text-warning",            dot: "bg-warning" },
  self_destructed:    { label: "Removed",      color: "text-destructive",        dot: "bg-destructive" },
  agent_expired:      { label: "Expired",      color: "text-muted-foreground",   dot: "bg-muted-foreground" },
  relay_waiting:      { label: "Relay",        color: "text-primary",            dot: "bg-primary" },
  relay_error:        { label: "Relay Error",  color: "text-warning",            dot: "bg-warning" },
};

type Severity = "error" | "warning" | "success" | "neutral";

const SEVERITY_MAP: Record<string, Severity> = {
  command_error: "error",
  auth_failed: "error",
  permission_error: "error",
  heartbeat_timeout: "error",
  self_destructed: "warning",
  disconnected: "warning",
  killed: "warning",
  relay_error: "warning",
  connected: "success",
  reconnected: "success",
  auth_success: "success",
  command_result: "success",
  generated: "success",
};

const SEVERITY_BORDER: Record<Severity, string> = {
  error: "border-l-2 border-l-destructive/40",
  warning: "border-l-2 border-l-warning/40",
  success: "border-l-2 border-l-success/40",
  neutral: "",
};

const EXPORT_OPTION_CLASS =
  "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-muted/10 transition-smooth";

const TYPE_CHIP_CLASS = "px-2 py-0.5 rounded-lg text-2xs font-medium transition-smooth";

// ── Main Component ──

export function ActivityView() {
  const { activityLog, clearActivityLog } = useRemoteAgentStore();
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [newEntryCount, setNewEntryCount] = useState(0);
  const prevLogLenRef = useRef(activityLog.length);

  const filteredLog = activityLog.filter((entry) => {
    if (typeFilter && entry.type !== typeFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.agentHostname?.toLowerCase().includes(q) ||
        entry.agentId?.toLowerCase().includes(q) ||
        entry.type.includes(q)
      );
    }
    return true;
  });

  useEffect(() => {
    const diff = activityLog.length - prevLogLenRef.current;
    prevLogLenRef.current = activityLog.length;
    if (diff > 0 && !isNearBottom) {
      setNewEntryCount((n) => n + diff);
    }
  }, [activityLog.length, isNearBottom]);

  useEffect(() => {
    if (isNearBottom && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activityLog.length, isNearBottom]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const near = scrollRef.current.scrollTop < 50;
    setIsNearBottom(near);
    if (near) setNewEntryCount(0);
  }, []);

  const scrollToTop = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      setIsNearBottom(true);
      setNewEntryCount(0);
    }
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Export ──

  const exportCSV = () => {
    const data = filteredLog.map((e) => ({
      timestamp: e.timestamp,
      type: e.type,
      agent: e.agentHostname || e.agentId || "—",
      message: e.message,
      data: e.data ? JSON.stringify(e.data) : "",
    }));
    const csv = [
      "Timestamp,Type,Agent,Message,Data",
      ...data.map(
        (d) =>
          `"${d.timestamp}","${d.type}","${d.agent}","${d.message.replace(/"/g, '""')}","${d.data.replace(/"/g, '""')}"`
      ),
    ].join("\n");
    saveExportFile(`sipalyzer-agent-activity-${new Date().toISOString().slice(0, 10)}.csv`, textToBase64(csv), "CSV files", "csv").catch(() => {});
    setExportOpen(false);
  };

  const exportJSON = () => {
    const json = JSON.stringify(filteredLog, null, 2);
    saveExportFile(`sipalyzer-agent-activity-${new Date().toISOString().slice(0, 10)}.json`, textToBase64(json), "JSON files", "json").catch(() => {});
    setExportOpen(false);
  };

  const exportHTML = () => {
    const rows = filteredLog.map((entry) => ({
      timestamp: entry.timestamp,
      type: TYPE_LABELS[entry.type]?.label ?? entry.type,
      agent: entry.agentHostname || entry.agentId || "—",
      message: entry.message,
      data: entry.data ? JSON.stringify(entry.data) : "",
    }));
    const html = buildHtmlTableReport({
      title: "Remote Agent Activity",
      subtitle: "Filtered activity log export",
      columns: [
        { key: "timestamp", label: "Timestamp" },
        { key: "type", label: "Type" },
        { key: "agent", label: "Agent" },
        { key: "message", label: "Message" },
        { key: "data", label: "Data" },
      ],
      rows,
    });
    saveExportFile(`sipalyzer-agent-activity-${new Date().toISOString().slice(0, 10)}.html`, textToBase64(html), "HTML files", "html").catch(() => {});
    setExportOpen(false);
  };

  const saveAuditLog = async () => {
    try {
      const path = await save({
        title: "Save Audit Log",
        defaultPath: `sipalyzer-audit-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await exportAuditLog(filteredLog, path);
    } catch {
      // cancelled
    }
    setExportOpen(false);
  };

  const uniqueTypes = [...new Set(activityLog.map((e) => e.type))];
  const errorCount = activityLog.filter((e) => SEVERITY_MAP[e.type] === "error").length;
  const warningCount = activityLog.filter((e) => SEVERITY_MAP[e.type] === "warning").length;

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="ui-surface-card overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search activity..."
              className="h-8 text-xs pl-8 ui-control-shell"
            />
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-border/20 shrink-0" />

          {/* Stats pills */}
          {activityLog.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-2xs tabular-nums text-muted-foreground/60 px-1.5">
                {filteredLog.length}
                {filteredLog.length !== activityLog.length && (
                  <span className="text-muted-foreground/60">/{activityLog.length}</span>
                )}
              </span>
              {errorCount > 0 && (
                <button
                  onClick={() => setTypeFilter(typeFilter === "command_error" ? null : "command_error")}
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs tabular-nums font-medium transition-smooth",
                    typeFilter === "command_error"
                      ? "bg-destructive/15 text-destructive"
                      : "text-destructive/60 hover:bg-destructive/10",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  {errorCount}
                </button>
              )}
              {warningCount > 0 && (
                <button
                  onClick={() => setTypeFilter(typeFilter === "disconnected" ? null : "disconnected")}
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs tabular-nums font-medium transition-smooth",
                    typeFilter === "disconnected"
                      ? "bg-warning/15 text-warning"
                      : "text-warning/60 hover:bg-warning/10",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-warning status-warning" />
                  {warningCount}
                </button>
              )}
            </div>
          )}

          {/* Separator */}
          <div className="w-px h-5 bg-border/20 shrink-0" />

          {/* Export dropdown */}
          <Popover open={exportOpen} onOpenChange={setExportOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="neutral" className="gap-1.5 h-7 px-2">
                <Download className="h-3.5 w-3.5" />
                <span className="text-2xs">Export</span>
                <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", exportOpen && "rotate-180")} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-[200px] p-1.5">
              <button
                onClick={exportCSV}
                className={EXPORT_OPTION_CLASS}
              >
                <Table className="h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                  <p className="text-xs font-medium text-foreground/80">CSV</p>
                  <p className="text-2xs text-muted-foreground/60">Spreadsheet format</p>
                </div>
              </button>
              <button
                onClick={exportJSON}
                className={EXPORT_OPTION_CLASS}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                  <p className="text-xs font-medium text-foreground/80">JSON</p>
                  <p className="text-2xs text-muted-foreground/60">Raw structured data</p>
                </div>
              </button>
              <button
                onClick={exportHTML}
                className={EXPORT_OPTION_CLASS}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                  <p className="text-xs font-medium text-foreground/80">HTML</p>
                  <p className="text-2xs text-muted-foreground/60">Styled report format</p>
                </div>
              </button>
              <div className="border-t border-border/20 my-1" />
              <button
                onClick={saveAuditLog}
                className={EXPORT_OPTION_CLASS}
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                  <p className="text-xs font-medium text-foreground/80">Save to Disk</p>
                  <p className="text-2xs text-muted-foreground/60">Full audit log file</p>
                </div>
              </button>
            </PopoverContent>
          </Popover>

          {/* Clear */}
          <TooltipWrapper content="Clear log">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmClearOpen(true)}
            className="h-7 w-7 p-0 text-muted-foreground/60 hover:text-destructive"
            disabled={activityLog.length === 0}
          >
            <Trash className="h-3.5 w-3.5" />
          </Button>
          </TooltipWrapper>
        </div>

        {/* Type filter chips */}
        {uniqueTypes.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap px-3 pb-2.5 pt-0.5">
            <button
              onClick={() => setTypeFilter(null)}
              className={cn(
                TYPE_CHIP_CLASS,
                typeFilter === null
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/10"
              )}
            >
              All
            </button>
            {uniqueTypes.map((type) => {
              const info = TYPE_LABELS[type];
              const isSelected = typeFilter === type;
              return (
                <button
                  key={type}
                  onClick={() => setTypeFilter(isSelected ? null : type)}
                  className={cn(
                    "inline-flex items-center gap-1",
                    TYPE_CHIP_CLASS,
                    isSelected
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/10"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", info?.dot || "bg-muted-foreground")} />
                  {info?.label || type}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Log Entries ── */}
      <div className="ui-surface-card flex-1 overflow-auto relative" ref={scrollRef} onScroll={handleScroll}>
        {filteredLog.length === 0 ? (
          <EmptyState
            variant="inline"
            compact
            icon={<List />}
            title="No activity"
            description={filter || typeFilter ? "No entries match the current filters." : "Activity will appear here as you interact with agents."}
          />
        ) : (
          <div className="flex flex-col">
            {filteredLog.map((entry, i) => (
              <LogEntry
                key={entry.id}
                entry={entry}
                isFirst={i === 0}
                expanded={expandedIds.has(entry.id)}
                onToggle={() => toggleExpanded(entry.id)}
              />
            ))}
          </div>
        )}

        {newEntryCount > 0 && (
          <button
            onClick={scrollToTop}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-2xs px-3 py-1 rounded-full cursor-pointer hover:bg-primary/90 transition-smooth z-50"
          >
            {newEntryCount} new {newEntryCount === 1 ? "entry" : "entries"} — click to scroll
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear Activity Log"
        description={`Clear all ${activityLog.length} activity entries? This cannot be undone.`}
        confirmText="Clear"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={clearActivityLog}
      />
    </div>
  );
}

// ── Log Entry Row ──

function LogEntry({
  entry,
  isFirst,
  expanded,
  onToggle,
}: {
  entry: ActivityLogEntry;
  isFirst: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const info = TYPE_LABELS[entry.type] || { label: entry.type, color: "text-muted-foreground", dot: "bg-muted-foreground" };
  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric" });
  const severity = SEVERITY_MAP[entry.type] || "neutral";
  const borderClass = SEVERITY_BORDER[severity];
  const hasData = entry.data !== undefined && entry.data !== null;

  return (
    <div
      className={cn(
        "transition-smooth",
        borderClass,
        !isFirst && "border-t border-border/30"
      )}
    >
      <button
        onClick={hasData ? onToggle : undefined}
        className={cn(
          "ui-data-row w-full flex items-start gap-2 py-2 px-3 text-left transition-smooth",
          hasData && "cursor-pointer",
        )}
      >
        <span className="shrink-0 w-3.5 pt-0.5">
          {hasData ? (
            expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
            )
          ) : null}
        </span>

        <span className="text-2xs text-muted-foreground/60 font-mono shrink-0 w-28 pt-0.5 tabular-nums">
          {dateStr} {timeStr}
        </span>
        <span className="inline-flex items-center gap-1 shrink-0 min-w-[70px]">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", info.dot)} />
          <span className={cn("text-2xs font-medium", info.color)}>
            {info.label}
          </span>
        </span>
        {entry.agentHostname && (
          <span className="text-2xs text-muted-foreground font-medium shrink-0 bg-muted/10 px-1.5 py-0.5 rounded">
            {entry.agentHostname}
          </span>
        )}
        <span className="text-xs text-foreground/70 flex-1 min-w-0 truncate">{entry.message}</span>
      </button>

      {expanded && hasData && (
        <div className="bg-muted/10 rounded-lg p-3 mt-1 mb-2 mx-3 ml-6">
          <pre className="text-2xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
            {JSON.stringify(entry.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

