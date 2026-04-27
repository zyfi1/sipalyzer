import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Plus, Play, Loader2, Shield, Square, Trash, Info } from "@/lib/icons";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import type { PortTestEntry, PortProtocol, PortTestResult } from "@/types/networkTest";

const PORT_PROTOCOL_OPTIONS: { value: PortProtocol; label: string }[] = [
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

export function PortTestPanel({ borderless = false }: { borderless?: boolean } = {}) {
  const portScan = useNetworkTestStore((s) => s.portScan);
  const runPortScan = useNetworkTestStore((s) => s.runPortScan);
  const dismissPortScan = useNetworkTestStore((s) => s.dismissPortScan);
  const customPortEntries = useNetworkTestStore((s) => s.customPortEntries);
  const setCustomPortEntries = useNetworkTestStore((s) => s.setCustomPortEntries);
  const lastSource = useNetworkTestStore((s) => s.lastSource);
  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("portScan");
  const viaAgent = lastSource.portScan?.source === "remote" ? resolvedAgentName("portScan") : null;

  const [portHost, setPortHost] = useState("");
  const [newPort, setNewPort] = useState("");
  const [newProtocol, setNewProtocol] = useState<PortProtocol>("tcp");
  const [newLabel, setNewLabel] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "pass" | "closed" | "filtered">("all");
  const [confirmClearPorts, setConfirmClearPorts] = useState(false);

  const isRunning = portScan.status === "running";
  const effectiveHost = portHost.trim() || "127.0.0.1";

  const appendEntries = useCallback((entries: PortTestEntry[]) => {
    if (entries.length === 0) return;
    const existing = new Set(customPortEntries.map((entry) => `${entry.port}:${entry.protocol}`));
    const unique = entries.filter((entry) => !existing.has(`${entry.port}:${entry.protocol}`));
    if (unique.length > 0) {
      setCustomPortEntries([...customPortEntries, ...unique]);
    }
  }, [customPortEntries, setCustomPortEntries]);

  const addEntry = useCallback(() => {
    if (!newPort.trim()) return;
    const entries: PortTestEntry[] = [];
    if (newPort.includes("-")) {
      const [startStr = "", endStr = ""] = newPort.split("-");
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);
      if (!isNaN(start) && !isNaN(end) && start > 0 && end <= 65535 && start <= end && end - start <= 100) {
        for (let p = start; p <= end; p++) {
          entries.push({ port: p, protocol: newProtocol, label: newLabel || null });
        }
      }
    } else {
      const port = parseInt(newPort.trim(), 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        entries.push({ port, protocol: newProtocol, label: newLabel || null });
      }
    }
    appendEntries(entries);
    setNewPort("");
    setNewLabel("");
  }, [newPort, newProtocol, newLabel, appendEntries]);

  const addCommon = useCallback((entry: PortTestEntry) => {
    appendEntries([entry]);
  }, [appendEntries]);

  const removeEntry = useCallback(
    (index: number) => setCustomPortEntries(customPortEntries.filter((_, i) => i !== index)),
    [customPortEntries, setCustomPortEntries]
  );

  const runTest = useCallback(() => {
    if (customPortEntries.length > 0) runPortScan(effectiveHost, customPortEntries, ctx);
  }, [customPortEntries, effectiveHost, runPortScan, ctx]);

  const rawResults = portScan.result?.results ?? [];
  const filteredResults = rawResults.filter((result) => {
    if (resultFilter === "all") return true;
    if (resultFilter === "pass") return isPass(result.status);
    return result.status === resultFilter;
  });

  return (
    <>
    <div className="space-y-4">
      <div className={cn("ui-hero-surface app-view-surface-pad space-y-3", borderless ? "" : "transition-smooth hover:shadow-card-hover")}>
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-destructive" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Port Scan</h3>
            <p className="text-2xs text-muted-foreground/70">TCP/UDP connectivity checks with reusable scan queues.</p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Host</label>
            <TooltipWrapper title="Host" description="Target hostname or IP to scan. Leave empty for localhost.">
              <Input
                value={portHost}
                onChange={(e) => setPortHost(e.target.value)}
                placeholder="Leave empty for localhost"
                className="h-10"
                disabled={isRunning}
                onKeyDown={(e) => e.key === "Enter" && customPortEntries.length > 0 && runTest()}
              />
            </TooltipWrapper>
          </div>
          {isRunning && (
            <TooltipWrapper title="Stop scan" description="Abandon the port scan UI; in-flight probes may still complete in the background.">
              <Button type="button" variant="destructive" onClick={dismissPortScan} className="h-10 gap-1.5 px-4">
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </TooltipWrapper>
          )}
          <TooltipWrapper title="Scan" description="Run the queued ports against the target host.">
            <Button
              onClick={runTest}
              disabled={isRunning || customPortEntries.length === 0}
              className="h-10 gap-1.5 px-5"
            >
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isRunning ? "Scanning..." : "Scan"}
            </Button>
          </TooltipWrapper>
        </div>

        <div className="flex items-end gap-2">
          <div className="w-40">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Port / Range</label>
            <TooltipWrapper title="Port or range" description="Single port (e.g. 80) or range (e.g. 8000-8010). Max 100 ports per range.">
              <Input
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
                placeholder="80 or 8000-8010"
                className="h-10 text-xs font-mono"
                onKeyDown={(e) => e.key === "Enter" && addEntry()}
                disabled={isRunning}
              />
            </TooltipWrapper>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Protocol</label>
            <TooltipWrapper title="Protocol" description="Choose TCP or UDP for the port(s) to scan.">
              <span className="inline-flex">
                <AppDropdown
                  value={newProtocol}
                  onValueChange={(v) => setNewProtocol(v as PortProtocol)}
                  options={PORT_PROTOCOL_OPTIONS}
                  className="w-24 h-10 text-xs"
                />
              </span>
            </TooltipWrapper>
          </div>
          <div className="flex-1 min-w-[100px]">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Label</label>
            <TooltipWrapper title="Label" description="Optional label for this port in the results (e.g. HTTP, SIP).">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Optional"
                className="h-10 text-xs"
                onKeyDown={(e) => e.key === "Enter" && addEntry()}
                disabled={isRunning}
              />
            </TooltipWrapper>
          </div>
          <TooltipWrapper title="Add port" description="Add this port or range to the queue.">
            <Button variant="neutral" className="h-10 gap-1.5 text-xs px-3.5" onClick={addEntry} disabled={isRunning || !newPort.trim()}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </TooltipWrapper>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-muted-foreground/65 mr-1">Quick add</span>
          <button type="button" className="h-7 rounded-md border border-border/35 bg-muted/15 px-2 text-2xs text-muted-foreground hover:bg-muted/25 hover:text-foreground transition-smooth" onClick={() => addCommon({ port: 5060, protocol: "udp", label: "SIP UDP" })} disabled={isRunning}>SIP UDP 5060</button>
          <button type="button" className="h-7 rounded-md border border-border/35 bg-muted/15 px-2 text-2xs text-muted-foreground hover:bg-muted/25 hover:text-foreground transition-smooth" onClick={() => addCommon({ port: 5061, protocol: "tcp", label: "SIP TLS" })} disabled={isRunning}>SIP TLS 5061</button>
          <button type="button" className="h-7 rounded-md border border-border/35 bg-muted/15 px-2 text-2xs text-muted-foreground hover:bg-muted/25 hover:text-foreground transition-smooth" onClick={() => addCommon({ port: 443, protocol: "tcp", label: "HTTPS" })} disabled={isRunning}>HTTPS 443</button>
          <button type="button" className="h-7 rounded-md border border-border/35 bg-muted/15 px-2 text-2xs text-muted-foreground hover:bg-muted/25 hover:text-foreground transition-smooth" onClick={() => addCommon({ port: 8443, protocol: "tcp", label: "WSS" })} disabled={isRunning}>WSS 8443</button>
        </div>

        {customPortEntries.length > 0 ? (
          <div className="ui-hero-surface overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-muted/10 border-b border-border/20">
              <span className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                {customPortEntries.length} port{customPortEntries.length !== 1 ? "s" : ""} queued
              </span>
              <TooltipWrapper title="Clear all" description="Remove all queued ports from the scan list.">
                <button
                  className="text-2xs text-muted-foreground hover:text-destructive transition-smooth"
                  onClick={() => setConfirmClearPorts(true)}
                >
                  Clear all
                </button>
              </TooltipWrapper>
            </div>
            <div className="max-h-[140px] overflow-y-auto divide-y divide-border/20">
              {customPortEntries.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-muted/10 transition-smooth group">
                  <span className="font-mono tabular-nums font-medium w-14">{entry.port}</span>
                  <Badge variant="secondary" className="text-3xs h-4 px-1.5 uppercase">{entry.protocol}</Badge>
                  <span className="text-muted-foreground truncate flex-1">{entry.label || ""}</span>
                  <TooltipWrapper title="Remove" description="Remove this port from the scan list.">
                    <button
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-smooth p-0.5"
                      onClick={() => removeEntry(i)}
                    >
                      <Trash className="h-3 w-3" />
                    </button>
                  </TooltipWrapper>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            variant="card"
            compact
            icon={<Shield />}
            title="No ports queued"
            description="Add one or more ports, then run a scan against the target host."
          />
        )}
      </div>

      {/* Results */}
      {portScan.result && rawResults.length > 0 && (
        <div className="ui-hero-surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-muted/10 border-b border-border/20">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground/60">
                <span className="font-mono">{portScan.result.host}</span>
              </span>
              {viaAgent && <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4">via {viaAgent}</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <ResultSummary results={rawResults} />
              <AppDivider orientation="vertical" size="md" className="mx-0" />
              <div className="inline-flex items-center gap-1">
                <button type="button" className={cn("h-6 rounded-md px-2 text-3xs transition-smooth", resultFilter === "all" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/20")} onClick={() => setResultFilter("all")}>All</button>
                <button type="button" className={cn("h-6 rounded-md px-2 text-3xs transition-smooth", resultFilter === "pass" ? "bg-success/15 text-success" : "text-muted-foreground hover:bg-muted/20")} onClick={() => setResultFilter("pass")}>Pass</button>
                <button type="button" className={cn("h-6 rounded-md px-2 text-3xs transition-smooth", resultFilter === "closed" ? "bg-destructive/15 text-destructive" : "text-muted-foreground hover:bg-muted/20")} onClick={() => setResultFilter("closed")}>Closed</button>
                <button type="button" className={cn("h-6 rounded-md px-2 text-3xs transition-smooth", resultFilter === "filtered" ? "bg-warning/15 text-warning" : "text-muted-foreground hover:bg-muted/20")} onClick={() => setResultFilter("filtered")}>Filtered</button>
              </div>
            </div>
          </div>
          <div className="divide-y divide-border/20 max-h-[240px] overflow-y-auto">
            {filteredResults.map((r, i) => (
              <PortResultRow key={i} result={r} />
            ))}
            {filteredResults.length === 0 && (
              <div className="px-5 py-4 text-xs text-muted-foreground/70">No results for current filter.</div>
            )}
          </div>
        </div>
      )}
    </div>

    <ConfirmDialog
      open={confirmClearPorts}
      onOpenChange={setConfirmClearPorts}
      title="Clear all queued ports?"
      description={`Remove all ${customPortEntries.length} port${customPortEntries.length !== 1 ? "s" : ""} from the scan list? This cannot be undone.`}
      confirmText="Clear All"
      cancelText="Cancel"
      variant="destructive"
      onConfirm={() => { setCustomPortEntries([]); setConfirmClearPorts(false); }}
    />
    </>
  );
}

// ── Result summary ───────────────────────────────────────────────

/** Whether a port status counts as reachable / pass. */
function isPass(status: string) { return status === "open" || status === "open_filtered"; }

function ResultSummary({ results }: { results: PortTestResult[] }) {
  const open = results.filter((r) => r.status === "open").length;
  const openFiltered = results.filter((r) => r.status === "open_filtered").length;
  const closed = results.filter((r) => r.status === "closed").length;
  const filtered = results.filter((r) => r.status === "filtered").length;
  const passCount = open + openFiltered;
  const total = results.length;
  return (
    <div className="flex items-center gap-2">
      {passCount > 0 && (
        <TooltipWrapper
          title={`${passCount} reachable`}
          description={open > 0 && openFiltered > 0
            ? `${open} confirmed open + ${openFiltered} likely open (UDP no-response)`
            : openFiltered > 0
              ? `${openFiltered} likely open — UDP ports with no ICMP reject (typical pass)`
              : `${open} confirmed open — received a response`}
        >
          <span className="flex items-center gap-1 text-2xs text-success cursor-help">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />{passCount}/{total} pass
          </span>
        </TooltipWrapper>
      )}
      {closed > 0 && (
        <TooltipWrapper title={tooltips.netPortStatusClosed.title} description={tooltips.netPortStatusClosed.description}>
          <span className="flex items-center gap-1 text-2xs text-destructive cursor-help">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />{closed} closed
          </span>
        </TooltipWrapper>
      )}
      {filtered > 0 && (
        <TooltipWrapper title={tooltips.netPortStatusFiltered.title} description={tooltips.netPortStatusFiltered.description}>
          <span className="flex items-center gap-1 text-2xs text-warning cursor-help">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />{filtered} filtered
          </span>
        </TooltipWrapper>
      )}
    </div>
  );
}

// ── Result row ───────────────────────────────────────────────────

function statusTooltip(status: string) {
  switch (status) {
    case "open": return tooltips.netPortStatusOpen;
    case "open_filtered": return tooltips.netPortStatusOpenFiltered;
    case "closed": return tooltips.netPortStatusClosed;
    case "filtered": return tooltips.netPortStatusFiltered;
    default: return undefined;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "open": return "Open";
    case "open_filtered": return "Open*";
    case "closed": return "Closed";
    case "filtered": return "Filtered";
    default: return status;
  }
}

const DOT_COLORS: Record<string, string> = {
  open: "bg-success",
  open_filtered: "bg-success/70",
  closed: "bg-destructive",
  filtered: "bg-warning",
};

function PortResultRow({ result: r }: { result: PortTestResult }) {
  const tip = statusTooltip(r.status);
  const isReachable = isPass(r.status);

  return (
    <div className="flex items-center gap-3 px-5 py-2 text-xs hover:bg-muted/10 transition-smooth">
      <span className={cn("h-2 w-2 rounded-full shrink-0", DOT_COLORS[r.status] ?? "bg-muted")} />
      <span className="font-mono tabular-nums w-14 shrink-0 font-medium">{r.port}</span>
      <Badge variant="secondary" className="text-3xs h-4 px-1.5 uppercase shrink-0">{r.protocol}</Badge>
      <span className={cn(
        "font-medium shrink-0 flex items-center gap-1",
        isReachable && "text-success",
        r.status === "closed" && "text-destructive",
        r.status === "filtered" && "text-warning",
      )}>
        {statusLabel(r.status)}
        {tip && (
          <TooltipWrapper title={tip.title} description={tip.description} side="right">
            <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0" />
          </TooltipWrapper>
        )}
      </span>
      {r.label && <span className="text-muted-foreground truncate">{r.label}</span>}
      {isReachable && (
        <Badge variant="secondary" className="text-3xs h-3.5 px-1 border-success/30 bg-success/[0.06] text-success shrink-0 ml-auto">
          PASS
        </Badge>
      )}
      <span className={cn("tabular-nums text-muted-foreground shrink-0", isReachable ? "" : "ml-auto")}>
        {r.response_ms !== null ? `${r.response_ms.toFixed(0)} ms` : "--"}
      </span>
    </div>
  );
}
