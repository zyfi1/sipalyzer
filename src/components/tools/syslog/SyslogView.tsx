import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import * as toolsApi from "@/api/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { MetricCard } from "@/components/network-test/components/MetricCard";
import { tooltips } from "@/lib/tooltips";
import { AppDropdown } from "@/components/ui/app-dropdown";
import {
  Activity,
  Play,
  Loader2,
  PowerOff,
  Filter,
  Trash2,
  Download,
  Pause,
  ArrowDownToLine,
} from "@/lib/icons";
import { cn } from "@/lib/utils";

const TOOL_ID = "toolsSyslog";

interface SyslogEntry {
  timestamp: string;
  hostname: string;
  facility: string;
  severity: string;
  app_name: string;
  process_id: string;
  message: string;
}

const SEVERITY_LEVELS = [
  { value: "all", label: "All Severities", color: "text-foreground" },
  { value: "emergency", label: "Emergency", color: "text-destructive" },
  { value: "alert", label: "Alert", color: "text-destructive" },
  { value: "critical", label: "Critical", color: "text-destructive" },
  { value: "error", label: "Error", color: "text-destructive" },
  { value: "warning", label: "Warning", color: "text-warning" },
  { value: "notice", label: "Notice", color: "text-info" },
  { value: "info", label: "Info", color: "text-foreground" },
  { value: "debug", label: "Debug", color: "text-muted-foreground" },
] as const;

const SEVERITY_BADGE_COLORS: Record<string, string> = {
  emergency: "bg-destructive/15 text-destructive border-destructive/20",
  alert: "bg-destructive/15 text-destructive border-destructive/20",
  critical: "bg-destructive/15 text-destructive border-destructive/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  notice: "bg-info/10 text-info border-info/20",
  info: "bg-primary/10 text-primary border-primary/20",
  debug: "bg-muted/30 text-muted-foreground border-border/30",
};

export function SyslogView() {
  const [port, setPort] = useState("514");
  const [filterText, setFilterText] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [entries, setEntries] = useState<SyslogEntry[]>([]);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<Date | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext(TOOL_ID);
  const isRemote = ctx.type === "remote";

  const sendCommand = useRemoteAgentStore((s) => s.sendCommand);
  const pendingCommands = useRemoteAgentStore((s) => s.pendingCommands);

  const agentId = isRemote ? (ctx as { type: "remote"; agentId: string }).agentId : null;

  // Cleanup local listener on unmount
  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, []);

  useEffect(() => {
    if (!listening) return;
    startTimeRef.current = new Date();
    const iv = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSecs(Math.floor((Date.now() - startTimeRef.current.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [listening]);

  // Remote command completion tracking
  useEffect(() => {
    if (!commandId) return;
    const cmd = pendingCommands.find((c) => c.id === commandId);
    if (!cmd) return;
    if (cmd.status === "done" || cmd.status === "error") {
      setListening(false);
    }
  }, [commandId, pendingCommands]);

  // Remote streaming subscription
  useEffect(() => {
    if (!commandId || paused) return;
    const unsub = useRemoteAgentStore.subscribe((state) => {
      const cmd = state.pendingCommands.find((c) => c.id === commandId);
      if (!cmd?.progress) return;
      const partial = (cmd.progress as any)?.partial ?? cmd.progress;
      if (partial && Array.isArray(partial)) {
        setEntries((prev) => [...prev, ...(partial as SyslogEntry[])]);
      }
    });
    return unsub;
  }, [commandId, paused]);

  useEffect(() => {
    if (autoScroll && !paused) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries.length, autoScroll, paused]);

  const stats = useMemo(() => {
    const severityCounts: Record<string, number> = {};
    const sources = new Set<string>();
    for (const e of entries) {
      severityCounts[e.severity] = (severityCounts[e.severity] || 0) + 1;
      if (e.hostname) sources.add(e.hostname);
    }
    const eps = elapsedSecs > 0 ? (entries.length / elapsedSecs).toFixed(1) : "0";
    return { severityCounts, sources: [...sources], eps };
  }, [entries, elapsedSecs]);

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (severityFilter !== "all") {
      result = result.filter((e) => e.severity === severityFilter);
    }
    if (filterText) {
      const lower = filterText.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(lower) ||
          e.hostname.toLowerCase().includes(lower) ||
          e.app_name.toLowerCase().includes(lower),
      );
    }
    return result;
  }, [entries, severityFilter, filterText]);

  const handleStart = useCallback(async () => {
    if (listening) return;
    setEntries([]);
    setListening(true);
    setPaused(false);
    setElapsedSecs(0);

    const parsedPort = parseInt(port) || 514;

    if (isRemote && agentId) {
      try {
        const msgId = await sendCommand(agentId, "SyslogListen", {
          port: parsedPort,
          duration_secs: 0,
          max_entries: 50000,
        });
        setCommandId(msgId);
      } catch {
        setListening(false);
      }
    } else {
      try {
        const sid = await toolsApi.toolsSyslogStart(parsedPort);
        setLocalSessionId(sid);
        const unlisten = await toolsApi.onSyslogBatch(sid, (batch) => {
          setEntries((prev) => [...prev, ...batch]);
        });
        unlistenRef.current = unlisten;
      } catch {
        setListening(false);
      }
    }
  }, [agentId, isRemote, port, listening, sendCommand]);

  const handleStop = useCallback(async () => {
    if (isRemote && agentId && commandId) {
      try {
        await sendCommand(agentId, "StopSyslog", { command_id: commandId });
      } catch { /* ignore */ }
    } else if (localSessionId) {
      try {
        await toolsApi.toolsSyslogStop(localSessionId);
      } catch { /* ignore */ }
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      setLocalSessionId(null);
    }
    setListening(false);
  }, [agentId, isRemote, commandId, localSessionId, sendCommand]);

  const handleExport = useCallback(() => {
    const text = filteredEntries
      .map((e) => `${e.timestamp}\t${e.severity}\t${e.hostname}\t${e.app_name}\t${e.message}`)
      .join("\n");
    saveExportFile(`syslog-${Date.now()}.txt`, textToBase64(text), "Text files", "txt").catch(() => {});
  }, [filteredEntries]);

  const canStart = !listening;

  return (
    <div className="flex flex-col gap-4 pb-8 min-h-full">
      {/* ── Controls card ── */}
      <div className="rounded-md surface px-5 py-4 flex flex-col gap-3">
        {/* Row 1: Port + Start/Stop + toggles */}
        <div className="flex items-center gap-2">
          <TooltipWrapper entry={tooltips.syslogPort}>
            <div className="flex items-center gap-1.5">
              <span className="section-label-sm">Port</span>
              <Input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="514"
                className="h-7 w-16 text-xs font-mono text-center"
                disabled={listening}
              />
            </div>
          </TooltipWrapper>

          {listening ? (
            <>
              <TooltipWrapper entry={tooltips.syslogStop}>
                <Button size="sm" variant="destructive" className="h-7 gap-1.5 text-xs px-3" onClick={handleStop}>
                  <PowerOff className="h-3 w-3" />
                  Stop
                </Button>
              </TooltipWrapper>
              <TooltipWrapper entry={tooltips.syslogPause}>
                <Button
                  size="sm"
                  variant={paused ? "positive" : "neutral"}
                  className="h-7 gap-1.5 text-xs px-3"
                  onClick={() => setPaused(!paused)}
                >
                  <Pause className="h-3 w-3" />
                  {paused ? "Resume" : "Pause"}
                </Button>
              </TooltipWrapper>
            </>
          ) : (
            <TooltipWrapper entry={tooltips.syslogStart}>
              <Button size="sm" className="h-7 gap-1.5 text-xs px-3" onClick={handleStart} disabled={!canStart}>
                <Play className="h-3 w-3" />
                Start Listening
              </Button>
            </TooltipWrapper>
          )}

          {listening && (
            <div className="flex items-center gap-2 ml-1">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success status-online" />
              </span>
              <span className="text-2xs text-success font-medium tabular-nums">
                {formatDuration(elapsedSecs)}
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {entries.length > 0 && (
              <>
                <TooltipWrapper entry={tooltips.syslogExport}>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleExport}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.syslogClear}>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEntries([])}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipWrapper>
              </>
            )}
            <TooltipWrapper entry={tooltips.syslogStats}>
              <div className="flex items-center gap-1.5">
                <span className="text-2xs text-muted-foreground/60">Stats</span>
                <Switch size="sm" checked={showStats} onCheckedChange={setShowStats} />
              </div>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.syslogAutoScroll}>
              <div className="flex items-center gap-1.5">
                <ArrowDownToLine className="h-3 w-3 text-muted-foreground/60" />
                <Switch size="sm" checked={autoScroll} onCheckedChange={setAutoScroll} />
              </div>
            </TooltipWrapper>
          </div>
        </div>

        {/* Row 2: Filters */}
        <div className="flex items-center gap-2">
          <TooltipWrapper entry={tooltips.syslogSeverity}>
            <AppDropdown
              value={severityFilter}
              onValueChange={setSeverityFilter}
              className="w-[140px] h-7 text-xs"
              size="sm"
              options={SEVERITY_LEVELS.map((s) => ({
                value: s.value,
                label: <span className={s.color}>{s.label}</span>,
              }))}
            />
          </TooltipWrapper>
          <div className="relative flex-1">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search messages, hosts, apps..."
              className="h-8 text-xs pl-8 ui-control-shell"
            />
          </div>
          <Badge variant="secondary" className="text-2xs h-6 px-2 shrink-0 tabular-nums">
            {filteredEntries.length === entries.length
              ? `${entries.length}`
              : `${filteredEntries.length} / ${entries.length}`}
          </Badge>
        </div>
      </div>

      {/* ── Stats dashboard ── */}
      {showStats && entries.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_1fr_2fr] gap-3">
          <MetricCard label="Rate" value={`${stats.eps}/s`} />
          <MetricCard label="Sources" value={`${stats.sources.length}`} />
          <MetricCard label="Total" value={`${entries.length}`} />
          <div className="ui-panel-shell rounded-lg p-4">
            <span className="section-label-sm">Severity Breakdown</span>
            <div className="flex items-center gap-1 mt-1.5 h-4">
              {Object.entries(stats.severityCounts)
                .sort(([a], [b]) => severityOrder(a) - severityOrder(b))
                .map(([sev, count]) => {
                  const pct = (count / entries.length) * 100;
                  if (pct < 0.5) return null;
                  return (
                    <TooltipWrapper key={sev} title={`${sev}: ${count} (${pct.toFixed(1)}%)`} side="bottom">
                      <div
                        className={cn("h-4 rounded-lg min-w-[4px] cursor-help transition-smooth", severityBarColor(sev))}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </TooltipWrapper>
                  );
                })}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              {Object.entries(stats.severityCounts)
                .sort(([a], [b]) => severityOrder(a) - severityOrder(b))
                .slice(0, 5)
                .map(([sev, count]) => (
                  <button
                    key={sev}
                    onClick={() => setSeverityFilter(severityFilter === sev ? "all" : sev)}
                    className={cn(
                      "text-2xs tabular-nums transition-smooth",
                      severityFilter === sev ? "font-bold" : "opacity-60 hover:opacity-100",
                      SEVERITY_BADGE_COLORS[sev]?.split(" ")[1] || "text-muted-foreground",
                    )}
                  >
                    {sev.slice(0, 4)} {count}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Message list / empty state ── */}
      {filteredEntries.length === 0 && !listening ? (
        <div className="flex-1 min-h-0 rounded-lg border border-border/20 flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8">
            <div className="h-16 w-16 rounded-lg bg-muted/20 flex items-center justify-center">
              <Activity className="h-7 w-7 text-muted-foreground/60" />
            </div>
            <div className="text-center space-y-1.5 max-w-md">
              <p className="text-sm font-medium text-muted-foreground/60">Syslog Receiver</p>
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                Listen on a UDP port to capture syslog messages from switches, routers, IP phones, and PBX systems.
                Messages stream in real-time with severity classification and source grouping.
              </p>
            </div>
            {canStart && (
              <Button size="sm" className="gap-1.5" onClick={handleStart}>
                <Play className="h-3.5 w-3.5" />
                Start Listening
              </Button>
            )}
            <div className="flex items-center gap-4 text-2xs text-muted-foreground/60">
              <span>Port 514</span>
              <span className="h-3 border-l border-border/20" />
              <span>Port 5514</span>
              <span className="h-3 border-l border-border/20" />
              <span>RFC 3164</span>
              <span className="h-3 border-l border-border/20" />
              <span>RFC 5424</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto ui-panel-shell rounded-md overflow-hidden">
          {listening && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Listening on UDP :{port}</p>
                <p className="text-2xs text-muted-foreground/60 mt-1">
                  Waiting for syslog messages — configure your devices to send syslog to this machine's IP address on port {port}.
                </p>
              </div>
            </div>
          )}

          {filteredEntries.length > 0 && (
            <div className="ui-sticky-header flex items-center gap-0 px-1 py-1 text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">
              <span className="w-[70px] px-2 shrink-0">Time</span>
              <span className="w-[52px] px-1 shrink-0">Sev</span>
              <span className="w-[100px] px-1 shrink-0">Source</span>
              <span className="w-[80px] px-1 shrink-0">App</span>
              <span className="flex-1 px-1">Message</span>
            </div>
          )}

          <div className="divide-y divide-border/20">
            {filteredEntries.map((entry, i) => (
              <SyslogRow key={i} entry={entry} />
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

    </div>
  );
}


function SyslogRow({ entry }: { entry: SyslogEntry }) {
  const sevColors = SEVERITY_BADGE_COLORS[entry.severity] || SEVERITY_BADGE_COLORS.info;
  const isHigh = ["emergency", "alert", "critical", "error"].includes(entry.severity);

  return (
    <div
      className={cn(
        "flex items-start gap-0 px-1 py-0.5 hover:bg-muted/10 transition-smooth group",
        isHigh && "bg-destructive/[0.02]",
      )}
    >
      <span className="w-[70px] px-2 shrink-0 text-2xs font-mono text-muted-foreground/60 pt-px">
        {formatSyslogTime(entry.timestamp)}
      </span>
      <span className="w-[52px] px-1 shrink-0">
        <span className={cn("inline-flex items-center justify-center text-3xs font-semibold rounded px-1 py-0 h-[18px] uppercase border", sevColors)}>
          {entry.severity?.slice(0, 4) || "???"}
        </span>
      </span>
      <span className="w-[100px] px-1 shrink-0 text-2xs font-mono text-muted-foreground/60 truncate pt-px">
        {entry.hostname || "-"}
      </span>
      <span className="w-[80px] px-1 shrink-0 text-2xs font-mono text-primary/60 truncate pt-px">
        {entry.app_name || "-"}
      </span>
      <span className={cn("flex-1 min-w-0 px-1 text-2xs break-all leading-relaxed pt-px", isHigh ? "text-foreground/90" : "text-foreground/70")}>
        {entry.message}
        <CopyTextButton text={entry.message} className="h-5 w-5 opacity-0 group-hover:opacity-100 ml-1 inline-flex" size="icon" />
      </span>
    </div>
  );
}


function formatSyslogTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts.slice(0, 8); }
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function severityOrder(sev: string): number {
  const order: Record<string, number> = {
    emergency: 0, alert: 1, critical: 2, error: 3,
    warning: 4, notice: 5, info: 6, debug: 7,
  };
  return order[sev] ?? 8;
}

function severityBarColor(sev: string): string {
  switch (sev) {
    case "emergency": case "alert": case "critical": return "bg-destructive";
    case "error": return "bg-destructive";
    case "warning": return "bg-warning";
    case "notice": return "bg-info";
    case "info": return "bg-primary";
    case "debug": return "bg-muted-foreground/30";
    default: return "bg-muted-foreground/20";
  }
}
