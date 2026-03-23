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
import { tooltips } from "@/lib/tooltips";
import { AppDropdown, SelectItem } from "@/components/ui/app-dropdown";
import {
  FileText,
  Play,
  Loader2,
  PowerOff,
  Filter,
  Download,
  Search,
  Trash2,
  ArrowDownToLine,
} from "@/lib/icons";
import { LOG_PRESETS, LOG_CATEGORIES } from "./log-presets";
import { cn } from "@/lib/utils";

const TOOL_ID = "toolsLogs";

export function LogViewerView() {
  const [logPath, setLogPath] = useState("");
  const [filterRegex, setFilterRegex] = useState("");
  const [searchText, setSearchText] = useState("");
  const [tailLines, setTailLines] = useState("500");
  const [mode, setMode] = useState<"fetch" | "tail">("fetch");
  const [loading, setLoading] = useState(false);
  const [tailing, setTailing] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [totalLines, setTotalLines] = useState(0);
  const [fileSize, setFileSize] = useState(0);
  const [tailCommandId, setTailCommandId] = useState<string | null>(null);
  const [wordWrap, setWordWrap] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [jumpLine, setJumpLine] = useState("");
  const [localTailSessionId, setLocalTailSessionId] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const unlistenRef = useRef<(() => void) | null>(null);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext(TOOL_ID);
  const isRemote = ctx.type === "remote";
  const agentId = isRemote ? (ctx as { type: "remote"; agentId: string }).agentId : null;

  const sendCommand = useRemoteAgentStore((s) => s.sendCommand);
  const waitForCommand = useRemoteAgentStore((s) => s.waitForCommand);
  const pendingCommands = useRemoteAgentStore((s) => s.pendingCommands);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, []);

  // Remote tail streaming
  useEffect(() => {
    if (!tailCommandId) return;
    const unsub = useRemoteAgentStore.subscribe((state) => {
      const cmd = state.pendingCommands.find((c) => c.id === tailCommandId);
      if (!cmd?.progress) return;
      const partial = (cmd.progress as any)?.partial ?? cmd.progress;
      if (partial && Array.isArray(partial)) {
        setLines((prev) => [...prev, ...(partial as string[])]);
      }
    });
    return unsub;
  }, [tailCommandId]);

  useEffect(() => {
    if (!tailCommandId) return;
    const cmd = pendingCommands.find((c) => c.id === tailCommandId);
    if (cmd && (cmd.status === "done" || cmd.status === "error")) {
      setTailing(false);
    }
  }, [tailCommandId, pendingCommands]);

  useEffect(() => {
    if (autoScroll && tailing) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines.length, autoScroll, tailing]);

  const { matchCount } = useMemo(() => {
    if (!searchText) return { matchCount: 0 };
    const lower = searchText.toLowerCase();
    let count = 0;
    for (const line of lines) {
      if (line.toLowerCase().includes(lower)) count++;
    }
    return { matchCount: count };
  }, [lines, searchText]);

  const handleFetch = useCallback(async () => {
    if (!logPath.trim()) return;
    setLoading(true);
    setLines([]);
    setSearchText("");
    try {
      if (isRemote && agentId) {
        const msgId = await sendCommand(agentId, "FetchLog", {
          path: logPath.trim(),
          tail_lines: parseInt(tailLines) || 500,
          filter: filterRegex || null,
        });
        const result = await waitForCommand(msgId);
        if ("result" in result) {
          const data = result.result as any;
          setLines(data?.lines ?? []);
          setTotalLines(data?.total_lines ?? 0);
          setFileSize(data?.file_size_bytes ?? 0);
        }
      } else {
        const result = await toolsApi.toolsFetchLog(
          logPath.trim(),
          parseInt(tailLines) || 500,
          filterRegex || null,
        );
        setLines(result.lines);
        setTotalLines(result.total_lines);
        setFileSize(result.file_size_bytes);
      }
    } catch {
      /* handled by store / toast */
    } finally {
      setLoading(false);
    }
  }, [logPath, tailLines, filterRegex, isRemote, agentId, sendCommand, waitForCommand]);

  const handleTailStart = useCallback(async () => {
    if (!logPath.trim()) return;
    setTailing(true);
    setLines([]);
    setSearchText("");

    if (isRemote && agentId) {
      try {
        const msgId = await sendCommand(agentId, "TailLog", {
          path: logPath.trim(),
          filter: filterRegex || null,
        });
        setTailCommandId(msgId);
      } catch {
        setTailing(false);
      }
    } else {
      try {
        const sid = await toolsApi.toolsTailStart(logPath.trim(), filterRegex || null);
        setLocalTailSessionId(sid);
        const unlisten = await toolsApi.onTailLines(sid, (newLines) => {
          setLines((prev) => [...prev, ...newLines]);
        });
        unlistenRef.current = unlisten;
      } catch {
        setTailing(false);
      }
    }
  }, [logPath, filterRegex, isRemote, agentId, sendCommand]);

  const handleTailStop = useCallback(async () => {
    if (isRemote && agentId && tailCommandId) {
      try {
        await sendCommand(agentId, "StopTailLog", { command_id: tailCommandId });
      } catch { /* ignore */ }
    } else if (localTailSessionId) {
      try {
        await toolsApi.toolsTailStop(localTailSessionId);
      } catch { /* ignore */ }
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      setLocalTailSessionId(null);
    }
    setTailing(false);
  }, [agentId, isRemote, tailCommandId, localTailSessionId, sendCommand]);

  const handlePresetSelect = (presetId: string) => {
    const preset = LOG_PRESETS.find((p) => p.id === presetId);
    if (preset) setLogPath(preset.path);
  };

  const handleJumpToLine = () => {
    const num = parseInt(jumpLine);
    if (isNaN(num) || num < 1) return;
    const el = lineRefs.current.get(num - 1);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-primary/10");
      setTimeout(() => el.classList.remove("bg-primary/10"), 2000);
    }
  };

  const handleExport = () => {
    const filename = logPath.split("/").pop() || "log";
    saveExportFile(`${filename}-${Date.now()}.txt`, textToBase64(lines.join("\n")), "Text files", "txt").catch(() => {});
  };

  // Tail now works both locally and remotely

  return (
    <div className="flex flex-col gap-4 pb-8 min-h-full">
      {/* ── Controls card ── */}
      <div className="ui-panel-shell rounded-md px-5 py-4 flex flex-col gap-3">
        {/* Row 1: Presets + path */}
        <div className="flex items-center gap-2">
          <TooltipWrapper entry={tooltips.logPresets}>
            <AppDropdown
              onValueChange={handlePresetSelect}
              className="w-[180px] h-7 text-xs"
              placeholder="Choose a log file..."
              contentClassName="max-h-[300px]"
              contentChildren={LOG_CATEGORIES.map((cat) => (
                <div key={cat}>
                  <div className="px-2 py-1 section-label-sm">{cat}</div>
                  {LOG_PRESETS.filter((p) => p.category === cat).map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.label}</span>
                          <span className="text-2xs text-muted-foreground/60 font-mono">{p.path}</span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </div>
              ))}
            />
          </TooltipWrapper>
          <Input
            value={logPath}
            onChange={(e) => setLogPath(e.target.value)}
            placeholder="/var/log/syslog"
            className="h-7 flex-1 text-xs font-mono"
            disabled={tailing}
            onKeyDown={(e) => e.key === "Enter" && (mode === "fetch" ? handleFetch() : handleTailStart())}
          />
        </div>

        {/* Row 2: Options + actions */}
        <div className="flex items-center gap-2">
          <TooltipWrapper entry={tooltips.logFilter}>
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
              <Input
                value={filterRegex}
                onChange={(e) => setFilterRegex(e.target.value)}
                placeholder="Regex filter"
                className="h-8 w-44 text-xs pl-8 font-mono ui-control-shell"
                disabled={tailing}
              />
            </div>
          </TooltipWrapper>

          {mode === "fetch" && (
            <TooltipWrapper entry={tooltips.logTailLines}>
              <Input
                value={tailLines}
                onChange={(e) => setTailLines(e.target.value)}
                placeholder="Lines"
                className="h-7 w-16 text-xs text-center"
                disabled={loading}
              />
            </TooltipWrapper>
          )}

          {/* Mode toggle */}
          <div className="flex items-center rounded-lg border border-border/30 overflow-hidden">
            <TooltipWrapper entry={tooltips.logFetchMode}>
              <button
                className={cn(
                  "px-2.5 h-7 text-xs transition-smooth",
                  mode === "fetch" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/30",
                )}
                onClick={() => { setMode("fetch"); if (tailing) handleTailStop(); }}
              >
                Fetch
              </button>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.logTailMode}>
              <button
                className={cn(
                  "px-2.5 h-7 text-xs transition-smooth border-l border-border/30",
                  mode === "tail" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/30",
                )}
                onClick={() => setMode("tail")}
              >
                Tail
              </button>
            </TooltipWrapper>
          </div>

          {mode === "fetch" ? (
            <Button size="sm" className="h-7 gap-1.5 text-xs px-3" onClick={handleFetch} disabled={loading || !logPath.trim()}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Fetch
            </Button>
          ) : tailing ? (
            <Button size="sm" variant="destructive" className="h-7 gap-1.5 text-xs px-3" onClick={handleTailStop}>
              <PowerOff className="h-3 w-3" />
              Stop
            </Button>
          ) : (
            <Button size="sm" className="h-7 gap-1.5 text-xs px-3" onClick={handleTailStart} disabled={!logPath.trim()}>
              <Play className="h-3 w-3" />
              Tail
            </Button>
          )}

          {tailing && (
            <div className="flex items-center gap-2 ml-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success status-online" />
              </span>
              <span className="text-2xs text-success font-medium">Tailing</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Toolbar (visible when content loaded) ── */}
      {lines.length > 0 && (
        <div className="ui-panel-shell rounded-md px-5 py-3 flex items-center gap-2">
          <Badge variant="secondary" className="text-2xs h-5 px-1.5 tabular-nums">{lines.length} lines</Badge>
          {totalLines > 0 && (
            <span className="caption-text-sm">of {totalLines.toLocaleString()} total</span>
          )}
          {fileSize > 0 && (
            <span className="caption-text-sm">({formatBytes(fileSize)})</span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <TooltipWrapper entry={tooltips.logSearch}>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                <Input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Find in log..."
                  className="h-8 w-40 text-xs pl-8 ui-control-shell"
                />
              </div>
            </TooltipWrapper>
            {searchText && (
              <Badge variant={matchCount > 0 ? "default" : "secondary"} className="text-2xs h-5 px-1.5 tabular-nums">
                {matchCount} match{matchCount !== 1 ? "es" : ""}
              </Badge>
            )}

            <TooltipWrapper entry={tooltips.logJumpLine}>
              <Input
                value={jumpLine}
                onChange={(e) => setJumpLine(e.target.value)}
                placeholder="Line #"
                className="h-6 w-16 text-xs text-center"
                onKeyDown={(e) => e.key === "Enter" && handleJumpToLine()}
              />
            </TooltipWrapper>

            <TooltipWrapper entry={tooltips.logWordWrap}>
              <div className="flex items-center gap-1">
                <span className="text-2xs text-muted-foreground/60">Wrap</span>
                <Switch size="sm" checked={wordWrap} onCheckedChange={setWordWrap} />
              </div>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.logLineNumbers}>
              <div className="flex items-center gap-1">
                <span className="text-2xs text-muted-foreground/60">#</span>
                <Switch size="sm" checked={showLineNumbers} onCheckedChange={setShowLineNumbers} />
              </div>
            </TooltipWrapper>
            {tailing && (
              <TooltipWrapper entry={tooltips.syslogAutoScroll}>
                <div className="flex items-center gap-1">
                  <ArrowDownToLine className="h-3 w-3 text-muted-foreground/60" />
                  <Switch size="sm" checked={autoScroll} onCheckedChange={setAutoScroll} />
                </div>
              </TooltipWrapper>
            )}
            <TooltipWrapper entry={tooltips.logExport}>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleExport}>
                <Download className="h-3 w-3" />
              </Button>
            </TooltipWrapper>
            <TooltipWrapper title="Clear" description="Clear the current log content from the view">
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setLines([]); setSearchText(""); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipWrapper>
          </div>
        </div>
      )}

      {/* ── Log content / empty state ── */}
      {lines.length === 0 && !loading && !tailing ? (
        <div className="flex-1 min-h-0 rounded-lg border border-border/20 flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8">
            <div className="h-16 w-16 rounded-lg bg-muted/20 flex items-center justify-center">
              <FileText className="h-7 w-7 text-muted-foreground/60" />
            </div>
            <div className="text-center space-y-1.5 max-w-md">
              <p className="text-sm font-medium text-muted-foreground/60">Log Viewer</p>
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                Browse and search log files from PBX systems, SIP servers, network devices, and Linux hosts.
                Select a preset or enter a path, then Fetch to read or Tail to stream live.
              </p>
            </div>
            {logPath.trim() && (
              <Button size="sm" className="gap-1.5" onClick={mode === "fetch" ? handleFetch : handleTailStart}>
                {mode === "fetch" ? <Download className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {mode === "fetch" ? "Fetch Log" : "Start Tail"}
              </Button>
            )}
            <div className="flex items-center gap-4 text-2xs text-muted-foreground/60">
              <span>Fetch</span>
              <span className="h-3 border-l border-border/20" />
              <span>Tail</span>
              <span className="h-3 border-l border-border/20" />
              <span>Regex Filter</span>
              <span className="h-3 border-l border-border/20" />
              <span>Search</span>
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 min-h-0 overflow-y-auto ui-panel-shell rounded-md overflow-hidden font-mono text-2xs"
        >
          {(loading || (tailing && lines.length === 0)) && (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">{loading ? "Fetching log..." : "Waiting for new lines..."}</span>
            </div>
          )}
          <div className="p-0">
            {lines.map((line, i) => {
              const isMatch = searchText && line.toLowerCase().includes(searchText.toLowerCase());
              return (
                <div
                  key={i}
                  ref={(el) => { if (el) lineRefs.current.set(i, el); }}
                  className={cn(
                    "flex hover:bg-muted/10 transition-smooth border-l-2",
                    isMatch ? "bg-warning/5 border-l-warning" : "border-l-transparent",
                  )}
                >
                  {showLineNumbers && (
                    <span className="text-muted-foreground/60 select-none text-right pr-3 pl-2 shrink-0 border-r border-border/20 tabular-nums" style={{ minWidth: "3.5rem" }}>
                      {i + 1}
                    </span>
                  )}
                  <span
                    className={cn(
                      "px-2 py-px min-w-0",
                      wordWrap ? "break-all whitespace-pre-wrap" : "whitespace-pre overflow-x-auto",
                      isMatch && "font-medium",
                    )}
                  >
                    {isMatch ? <HighlightedLine line={line} search={searchText} /> : line}
                  </span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}


function HighlightedLine({ line, search }: { line: string; search: string }) {
  if (!search) return <>{line}</>;
  const parts: React.ReactNode[] = [];
  const lower = line.toLowerCase();
  const searchLower = search.toLowerCase();
  let lastIdx = 0;
  let idx = lower.indexOf(searchLower);
  let key = 0;
  while (idx !== -1) {
    if (idx > lastIdx) {
      parts.push(<span key={key++}>{line.slice(lastIdx, idx)}</span>);
    }
    parts.push(
      <mark key={key++} className="bg-warning/30 text-warning rounded-lg px-0.5">
        {line.slice(idx, idx + search.length)}
      </mark>,
    );
    lastIdx = idx + search.length;
    idx = lower.indexOf(searchLower, lastIdx);
  }
  if (lastIdx < line.length) {
    parts.push(<span key={key++}>{line.slice(lastIdx)}</span>);
  }
  return <>{parts}</>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}
