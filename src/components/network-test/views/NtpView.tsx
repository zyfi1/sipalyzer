import { useState, useCallback, useMemo } from "react";
import { ToolViewShell } from "../components/ToolViewShell";
import { ResultSourceBadge } from "../components/ResultSourceBadge";
import { MetricCard } from "../components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Badge } from "@/components/ui/badge";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Clock, Loader2, Play } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { tooltips } from "@/lib/tooltips";
import * as api from "@/api/networkTest";
import type { NtpCheckResult } from "@/types/networkTest";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { dispatchNtpCheck } from "@/lib/executionDispatch";

type NtpPreset = {
  id: string;
  label: string;
  servers: string[];
};

const NTP_PRESETS: NtpPreset[] = [
  { id: "public-mix", label: "Public Mix (Recommended)", servers: ["pool.ntp.org", "time.google.com", "time.cloudflare.com"] },
  { id: "cloudflare", label: "Cloudflare", servers: ["time.cloudflare.com", "time.cloudflare.com"] },
  { id: "google", label: "Google", servers: ["time.google.com", "time1.google.com", "time2.google.com"] },
  { id: "nist", label: "NIST / Public", servers: ["time.nist.gov", "pool.ntp.org"] },
];

const NTP_PRESET_OPTIONS = NTP_PRESETS.map((p) => ({ value: p.id, label: p.label }));

function parseServerList(value: string): string[] {
  const list = value
    .split(/[,\n]+/)
    .map((server) => server.trim())
    .filter(Boolean);
  return Array.from(new Set(list));
}

export function NtpView() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<NtpCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<{ source: "local" | "remote"; agentId?: string } | null>(null);
  const [mode, setMode] = useState<"preset" | "manual">("preset");
  const [presetId, setPresetId] = useState<string>(NTP_PRESETS[0]?.id ?? "public-mix");
  const [manualServers, setManualServers] = useState("pool.ntp.org, time.google.com, time.cloudflare.com");

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("ntp");
  const agentName = lastSource?.source === "remote" ? (resolvedAgentName("ntp") ?? undefined) : undefined;

  const selectedServers = useMemo(() => {
    if (mode === "manual") return parseServerList(manualServers);
    const preset = NTP_PRESETS.find((item) => item.id === presetId) ?? NTP_PRESETS[0];
    return preset?.servers ?? [];
  }, [mode, presetId, manualServers]);

  const handleRun = useCallback(async () => {
    if (running) return;
    if (selectedServers.length === 0) {
      setError("Add at least one NTP server.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      if (ctx.type !== "local") {
        const res = await dispatchNtpCheck(ctx, selectedServers, () => api.networkNtpCheck(selectedServers));
        setResult(res.result as NtpCheckResult);
        setLastSource({ source: res.source, agentId: res.agentId });
      } else {
        const r = await api.networkNtpCheck(selectedServers);
        setResult(r);
        setLastSource({ source: "local" });
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }, [running, ctx, selectedServers]);

  const statusColor =
    result?.clock_status === "ok"
      ? "text-success"
      : result?.clock_status === "warning"
        ? "text-warning"
        : result?.clock_status === "critical"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <ToolViewShell
      icon={Clock}
      tint="text-warning"
      title="NTP Check"
      description="Verify time synchronization against NTP servers"
      compact
    >
      {/* Controls */}
      <div className="ui-hero-surface app-view-surface-pad">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <TooltipWrapper
              title="NTP Time Sync Check"
              description="Query one or more NTP servers to verify your clock accuracy and drift."
              side="bottom"
            >
              <span><Clock className="h-4 w-4 text-muted-foreground/60 shrink-0" /></span>
            </TooltipWrapper>

            <div className="subview-tabs-compact shrink-0">
              <button
                type="button"
                data-state={mode === "preset" ? "active" : "inactive"}
                onClick={() => setMode("preset")}
                className="subview-tab-compact !h-8 !px-3 text-xs"
              >
                Preset
              </button>
              <button
                type="button"
                data-state={mode === "manual" ? "active" : "inactive"}
                onClick={() => setMode("manual")}
                className="subview-tab-compact !h-8 !px-3 text-xs"
              >
                Manual
              </button>
            </div>

            <div className="flex-1 min-w-[280px]">
              {mode === "preset" ? (
                <AppDropdown
                  value={presetId}
                  onValueChange={setPresetId}
                  options={NTP_PRESET_OPTIONS}
                  placeholder="Select NTP preset"
                  className="h-8"
                  disabled={running}
                />
              ) : (
                <Input
                  value={manualServers}
                  onChange={(e) => setManualServers(e.target.value)}
                  placeholder="e.g. pool.ntp.org, time.cloudflare.com, time.google.com"
                  className="h-8"
                  disabled={running}
                />
              )}
            </div>

            <TooltipWrapper
              title="Run NTP Check"
              description="Queries the selected server set and reports offset, delay, and stratum."
              side="bottom"
            >
              <Button className="h-8 gap-1.5 px-3 text-xs" onClick={handleRun} disabled={running || selectedServers.length === 0}>
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Check
              </Button>
            </TooltipWrapper>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs text-muted-foreground/65">Servers</span>
            {selectedServers.map((server) => (
              <span
                key={server}
                className="inline-flex h-5 items-center rounded-md border border-border/35 bg-muted/12 px-1.5 text-3xs font-medium text-muted-foreground/85"
              >
                {server}
              </span>
            ))}
            {selectedServers.length === 0 && (
              <span className="text-2xs text-destructive">No valid servers configured</span>
            )}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!result && !running && !error && (
        <div className="ui-hero-surface overflow-hidden">
          <div className="app-view-surface-pad">
            <EmptyState
              variant="card"
              icon={<Clock />}
              title="NTP check is ready"
              description="Run a sync check to validate clock drift, delay, and stratum across your selected NTP servers."
              action={(
                <Button
                  className="h-8 gap-1.5 px-3 text-xs"
                  onClick={handleRun}
                  disabled={selectedServers.length === 0}
                >
                  <Play className="h-3.5 w-3.5" />
                  Check time sync
                </Button>
              )}
              className="min-h-[260px]"
            />
          </div>
        </div>
      )}

      {/* Running */}
      {running && !result && (
        <div className="ui-hero-surface app-view-surface-pad">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Querying NTP servers...</span>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {lastSource && (
            <ResultSourceBadge source={lastSource.source} agentName={agentName} />
          )}
          {/* Clock status hero */}
          <div className="ui-hero-surface app-view-surface-pad">
            <TooltipWrapper entry={tooltips.netNtpStatus}>
              <div className="text-center py-2 cursor-help">
                <p className="section-label-sm mb-2">
                  Clock Status
                </p>
                <p className={cn("text-2xl font-bold capitalize", statusColor)}>
                  {result.clock_status}
                </p>
              </div>
            </TooltipWrapper>
          </div>

          {/* Server results */}
          <div className="ui-hero-surface overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netNtpServer}><span className="cursor-help">Server</span></TooltipWrapper></th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netNtpStratum}><span className="cursor-help">Stratum</span></TooltipWrapper></th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netNtpOffset}><span className="cursor-help">Offset</span></TooltipWrapper></th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netNtpDelay}><span className="cursor-help">Delay</span></TooltipWrapper></th>
                </tr>
              </thead>
              <tbody>
                {result.servers.map((s) => {
                  const offsetAbs = Math.abs(s.offset_ms);
                  const offsetColor = offsetAbs < 50
                    ? "text-success"
                    : offsetAbs < 1000
                      ? "text-warning"
                      : "text-destructive";
                  return (
                    <tr key={s.server} className="border-b border-border/20 hover:bg-muted/20 transition-smooth">
                      <td className="px-4 py-2 font-mono">{s.server}</td>
                      <td className="px-4 py-2 text-center">
                        {s.success ? (
                          <TooltipWrapper content="Server responded successfully">
                            <Badge variant="default" className="text-3xs px-1.5 py-0 h-4 cursor-help">OK</Badge>
                          </TooltipWrapper>
                        ) : (
                          <TooltipWrapper content="Server failed to respond or returned an error">
                            <Badge variant="destructive" className="text-3xs px-1.5 py-0 h-4 cursor-help">Fail</Badge>
                          </TooltipWrapper>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{s.success ? s.stratum : "--"}</td>
                      <td className={cn("px-4 py-2 text-right font-mono", offsetColor)}>
                        {s.success ? `${s.offset_ms >= 0 ? "+" : ""}${s.offset_ms.toFixed(2)} ms` : s.error || "--"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                        {s.success ? `${s.delay_ms.toFixed(2)} ms` : "--"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Time info */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Local Time" value={formatTime(result.local_time)} />
            <MetricCard label="UTC Time" value={formatTime(result.utc_time)} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && !result && (
        <p className="text-xs text-destructive px-1">{error}</p>
      )}
    </ToolViewShell>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  } catch {
    return iso;
  }
}
