import { useState, useCallback } from "react";
import { MetricCard } from "../components/MetricCard";
import { ResultSourceBadge } from "../components/ResultSourceBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Shield, Globe, Loader2, Play, RefreshCw } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { tooltips } from "@/lib/tooltips";
import * as api from "@/api/networkTest";
import type { NatDetectResult } from "@/types/networkTest";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { dispatchNatDetect } from "@/lib/executionDispatch";
import { normalizeNatDetectResult } from "@/lib/resultNormalizers";

type ServerMode = "preset" | "custom";

type NatRunHistoryItem = {
  id: string;
  serverLabel: string;
  natType: string;
  algDetected: boolean | null;
  elapsedMs: number | null;
  source: "local" | "remote";
  timestamp: string;
};

type NatResultMeta = {
  hasMappedAddress: boolean;
  hasLocalAddress: boolean;
  hasElapsedMs: boolean;
  hasAlgDetected: boolean;
  hasHairpinSupported: boolean;
  hasUdpTimeoutSecs: boolean;
};

type NatDeepCheckItem = {
  id: string;
  serverLabel: string;
  natType: string;
  algDetected: boolean | null;
  elapsedMs: number | null;
  mappedIp: string | null;
  success: boolean;
  error: string | null;
};

const STUN_PRESETS = [
  { id: "google", label: "Google Public STUN", host: "stun.l.google.com", port: 19302 },
  { id: "cloudflare", label: "Cloudflare STUN", host: "stun.cloudflare.com", port: 3478 },
  { id: "nextcloud", label: "Nextcloud STUN", host: "stun.nextcloud.com", port: 443 },
  { id: "sipgate", label: "Sipgate STUN", host: "stun.sipgate.net", port: 10000 },
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function isValidBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildNatResultMeta(rawResult: unknown): NatResultMeta {
  const raw = asRecord(rawResult);
  const mappedPort = raw.mapped_port ?? raw.external_port ?? raw.public_port;
  const localPort = raw.local_port;
  const elapsedMs = raw.elapsed_ms ?? raw.response_ms;
  const udpTimeout = raw.udp_timeout_secs ?? raw.udp_timeout;

  return {
    hasMappedAddress: isNonEmptyString(raw.mapped_ip ?? raw.external_ip ?? raw.public_ip) && isValidNumber(mappedPort) && mappedPort > 0,
    hasLocalAddress: isNonEmptyString(raw.local_ip) && isValidNumber(localPort) && localPort > 0,
    hasElapsedMs: isValidNumber(elapsedMs) && elapsedMs >= 0,
    hasAlgDetected: isValidBoolean(raw.alg_detected ?? raw.sip_alg_detected),
    hasHairpinSupported: isValidBoolean(raw.hairpin_supported ?? raw.hairpin),
    hasUdpTimeoutSecs: isValidNumber(udpTimeout) && udpTimeout > 0,
  };
}

export default function NatAlgPanel() {
  const [mode, setMode] = useState<ServerMode>("preset");
  const [presetId, setPresetId] = useState<(typeof STUN_PRESETS)[number]["id"]>("google");
  const [customHost, setCustomHost] = useState("");
  const [customPort, setCustomPort] = useState("3478");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<NatDetectResult | null>(null);
  const [resultMeta, setResultMeta] = useState<NatResultMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastServerLabel, setLastServerLabel] = useState<string>("");
  const [history, setHistory] = useState<NatRunHistoryItem[]>([]);
  const [deepCheckRunning, setDeepCheckRunning] = useState(false);
  const [deepCheckItems, setDeepCheckItems] = useState<NatDeepCheckItem[]>([]);
  const [lastSource, setLastSource] = useState<{ source: "local" | "remote"; agentId?: string } | null>(null);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("natDetect");
  const agentName = lastSource?.source === "remote" ? (resolvedAgentName("natDetect") ?? undefined) : undefined;

  const selectedPreset = STUN_PRESETS.find((p) => p.id === presetId) ?? STUN_PRESETS[0];
  const parsedCustomPort = Number.parseInt(customPort, 10);
  const safeCustomPort = Number.isFinite(parsedCustomPort) && parsedCustomPort > 0 && parsedCustomPort <= 65535
    ? parsedCustomPort
    : 3478;

  const effectiveServer = mode === "preset"
    ? {
        host: selectedPreset.host,
        port: selectedPreset.port,
        label: `${selectedPreset.label} (${selectedPreset.host}:${selectedPreset.port})`,
      }
    : {
        host: customHost.trim(),
        port: safeCustomPort,
        label: customHost.trim() ? `Custom (${customHost.trim()}:${safeCustomPort})` : "Custom (not configured)",
      };

  const canRun = mode === "preset" || customHost.trim().length > 0;
  const runningAny = running || deepCheckRunning;

  const runDetectionOnce = useCallback(async (
    host: string,
    port: number,
    serverLabel: string,
    setAsPrimary: boolean,
  ): Promise<NatDeepCheckItem> => {
    const remoteStunServer = host ? `${host}:${port}` : undefined;
    try {
      const res = await dispatchNatDetect(
        ctx,
        () => api.networkNatDetect(host || undefined, port),
        remoteStunServer,
      );
      const payload = normalizeNatDetectResult(res.result) as NatDetectResult;
      const payloadMeta = payload as NatDetectResult & { success?: boolean; error?: string | null };
      const rawMeta = buildNatResultMeta(res.result);
      const item: NatDeepCheckItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        serverLabel,
        natType: payload.nat_type?.trim() || "Unknown",
        algDetected: rawMeta.hasAlgDetected ? payload.alg_detected : null,
        elapsedMs: rawMeta.hasElapsedMs ? payload.elapsed_ms : null,
        mappedIp: rawMeta.hasMappedAddress ? payload.mapped_ip : null,
        success: payloadMeta.success !== false,
        error: payloadMeta.error ?? null,
      };

      if (setAsPrimary) {
        setResult(payload);
        setResultMeta(rawMeta);
        setError(payloadMeta.error ?? null);
        setLastServerLabel(serverLabel);
        setLastSource({ source: res.source, agentId: res.agentId });
      }
      setHistory((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          serverLabel,
          natType: item.natType,
          algDetected: item.algDetected,
          elapsedMs: item.elapsedMs,
          source: res.source as "local" | "remote",
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 8));
      return item;
    } catch (e: any) {
      if (setAsPrimary) {
        setError(e.message);
        setResultMeta(null);
      }
      const failed: NatDeepCheckItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        serverLabel,
        natType: "failed",
        algDetected: null,
        elapsedMs: null,
        mappedIp: null,
        success: false,
        error: e.message ?? "Detection failed",
      };
      setHistory((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          serverLabel,
          natType: failed.natType,
          algDetected: null,
          elapsedMs: null,
          source: (ctx.type === "local" ? "local" : "remote") as "local" | "remote",
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 8));
      return failed;
    }
  }, [ctx]);

  const handleRun = useCallback(async () => {
    if (runningAny || !canRun) return;
    setRunning(true);
    setError(null);
    setDeepCheckItems([]);
    try {
      await runDetectionOnce(effectiveServer.host, effectiveServer.port, effectiveServer.label, true);
    } finally {
      setRunning(false);
    }
  }, [runningAny, canRun, effectiveServer, runDetectionOnce]);

  const handleDeepCheck = useCallback(async () => {
    if (runningAny || !canRun) return;
    setDeepCheckRunning(true);
    setError(null);
    setDeepCheckItems([]);
    try {
      const servers = mode === "preset"
        ? [
            selectedPreset,
            ...STUN_PRESETS.filter((preset) => preset.id !== selectedPreset.id),
          ]
        : [{ id: "custom", label: "Custom", host: effectiveServer.host, port: effectiveServer.port }];

      const items: NatDeepCheckItem[] = [];
      for (let i = 0; i < servers.length; i++) {
        const server = servers[i]!;
        const label = `${server.label} (${server.host}:${server.port})`;
        const item = await runDetectionOnce(server.host, server.port, label, i === 0);
        items.push(item);
      }
      setDeepCheckItems(items);
    } finally {
      setDeepCheckRunning(false);
    }
  }, [runningAny, canRun, mode, selectedPreset, effectiveServer, runDetectionOnce]);

  const natTypeText = result?.nat_type?.trim() || "Unknown";
  const algDetected = resultMeta?.hasAlgDetected && typeof result?.alg_detected === "boolean" ? result.alg_detected : null;
  const hairpinSupported = resultMeta?.hasHairpinSupported && typeof result?.hairpin_supported === "boolean" ? result.hairpin_supported : null;
  const udpTimeoutSecs = resultMeta?.hasUdpTimeoutSecs && typeof result?.udp_timeout_secs === "number" ? result.udp_timeout_secs : null;
  const elapsedMs = resultMeta?.hasElapsedMs && typeof result?.elapsed_ms === "number" ? result.elapsed_ms : null;
  const mappedAddress = resultMeta?.hasMappedAddress && result
    ? `${result.mapped_ip}:${result.mapped_port}`
    : "--";
  const localAddress = resultMeta?.hasLocalAddress && result
    ? `${result.local_ip}:${result.local_port}`
    : "--";
  const modifiedHeaders = Array.isArray(result?.modified_headers) ? result.modified_headers : [];

  const natColor = result
    ? natTypeText.toLowerCase().includes("cone") ||
      natTypeText.toLowerCase().includes("open")
      ? "text-success"
      : natTypeText.toLowerCase().includes("symmetric")
        ? "text-destructive"
        : "text-warning"
    : "text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="ui-hero-surface app-view-surface-pad space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/35 pb-2">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">NAT / ALG Toolbox</h3>
              <p className="text-2xs text-muted-foreground/75">
                Run NAT classification with preset or custom STUN endpoints.
              </p>
            </div>
          </div>
          {result && (
            <Badge variant="secondary" className="h-6 px-2 text-2xs">
              {natTypeText}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="subview-tabs-compact">
            <button
              type="button"
              data-state={mode === "preset" ? "active" : "inactive"}
              onClick={() => setMode("preset")}
              className="subview-tab-compact !h-8 !px-3 text-xs"
              disabled={runningAny}
            >
              Preset
            </button>
            <button
              type="button"
              data-state={mode === "custom" ? "active" : "inactive"}
              onClick={() => setMode("custom")}
              className="subview-tab-compact !h-8 !px-3 text-xs"
              disabled={runningAny}
            >
              Custom
            </button>
          </div>

          {mode === "preset" ? (
            <Select value={presetId} onValueChange={(v) => setPresetId(v as (typeof STUN_PRESETS)[number]["id"])} disabled={runningAny}>
              <SelectTrigger className="h-8 min-w-[420px] w-[min(64vw,560px)] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STUN_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id} className="text-xs">
                    {preset.label} - {preset.host}:{preset.port}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <>
              <div className="relative min-w-[220px] flex-1">
                <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={customHost}
                  onChange={(e) => setCustomHost(e.target.value)}
                  placeholder="stun.example.com"
                  className="h-8 pl-8 text-xs"
                  disabled={runningAny}
                  onKeyDown={(e) => e.key === "Enter" && handleRun()}
                />
              </div>
              <Input
                value={customPort}
                onChange={(e) => setCustomPort(e.target.value.replace(/\D/g, ""))}
                placeholder="3478"
                className="h-8 w-24 text-xs"
                disabled={runningAny}
                onKeyDown={(e) => e.key === "Enter" && handleRun()}
              />
            </>
          )}

          <TooltipWrapper
            title="Detect NAT/ALG"
            description="Run STUN-based NAT classification and SIP ALG detection."
            side="bottom"
          >
            <Button className="h-8 gap-1.5 px-3 text-xs" onClick={handleRun} disabled={runningAny || !canRun}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Detect
            </Button>
          </TooltipWrapper>
          <TooltipWrapper
            title="Deep Check"
            description="Run NAT/ALG detection against multiple STUN presets to verify consistency."
            side="bottom"
          >
            <Button
              variant="outline"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={handleDeepCheck}
              disabled={runningAny || !canRun}
            >
              {deepCheckRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Deep Check
            </Button>
          </TooltipWrapper>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-muted-foreground/70">Endpoint</span>
          <Badge variant="outline" className="h-5 px-1.5 text-3xs font-mono">
            {effectiveServer.host ? `${effectiveServer.host}:${effectiveServer.port}` : "not configured"}
          </Badge>
          {error && (
            <span className="text-2xs text-destructive">{error}</span>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!result && !running && !error && (
        <EmptyState
          variant="inline"
          icon={<Shield />}
          title="No NAT/ALG results yet"
          description="Run a detection to classify your NAT type and detect SIP ALG behavior."
          className="h-full min-h-0 p-6"
        />
      )}

      {/* Running */}
      {(running || deepCheckRunning) && !result && (
        <div className="flex items-center justify-center gap-3 py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            {deepCheckRunning ? "Running deep NAT/ALG checks..." : "Detecting NAT behavior..."}
          </span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {lastSource && (
            <ResultSourceBadge source={lastSource.source} agentName={agentName} />
          )}

          {lastServerLabel && (
            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
              <span>Server</span>
              <Badge variant="outline" className="h-5 px-1.5 text-3xs">
                {lastServerLabel}
              </Badge>
            </div>
          )}

          {/* NAT type hero */}
          <TooltipWrapper entry={tooltips.netNatType}>
            <div className="ui-hero-surface text-center py-3 cursor-help">
              <p className="section-label-sm mb-2">
                NAT Type
              </p>
              <p className={cn("text-2xl font-bold", natColor)}>
                {natTypeText}
              </p>
            </div>
          </TooltipWrapper>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <MetricCard
              label="Mapped Address"
              value={mappedAddress}
              subtitle="Public IP and port"
            />
            <MetricCard
              label="Local Address"
              value={localAddress}
              subtitle="Local socket address"
            />
            <MetricCard
              label="Response"
              value={elapsedMs != null ? elapsedMs.toFixed(0) : "--"}
              unit="ms"
              status={elapsedMs != null && elapsedMs < 100 ? "pass" : "warn"}
            />
            <TooltipWrapper entry={tooltips.netAlgDetected}>
              <div className="cursor-help">
                <MetricCard
                  label="ALG Detected"
                  value={algDetected == null ? "Unknown" : algDetected ? "Yes" : "No"}
                  status={algDetected == null ? "warn" : algDetected ? "fail" : "pass"}
                />
              </div>
            </TooltipWrapper>
            <MetricCard
              label="Hairpin"
              value={hairpinSupported == null ? "Unknown" : hairpinSupported ? "Supported" : "Not Supported"}
              status={hairpinSupported == null ? "warn" : hairpinSupported ? "pass" : "warn"}
            />
            <MetricCard
              label="UDP Timeout"
              value={udpTimeoutSecs != null ? udpTimeoutSecs.toFixed(0) : "--"}
              unit="s"
              status={udpTimeoutSecs != null && udpTimeoutSecs >= 30 ? "pass" : "warn"}
            />
          </div>

          {deepCheckItems.length > 0 && (
            <div className="ui-hero-surface overflow-hidden">
              <div className="ui-section-header-sm border-b border-border/35">
                <span className="text-xs font-semibold text-foreground">Deep Check Summary</span>
              </div>
              <div className="app-view-surface-pad space-y-3">
                {(() => {
                  const successful = deepCheckItems.filter((item) => item.success);
                  const failed = deepCheckItems.length - successful.length;
                  const natSet = new Set(successful.map((item) => item.natType.toLowerCase()));
                  const algHits = successful.filter((item) => item.algDetected === true).length;
                  const mappedIpSet = new Set(successful.map((item) => item.mappedIp).filter(Boolean) as string[]);
                  const consistency = natSet.size <= 1 ? "Consistent" : "Mixed";
                  const consistencyTone = natSet.size <= 1 ? "text-success" : "text-warning";
                  const mappedTone = mappedIpSet.size <= 1 ? "text-success" : "text-warning";
                  return (
                    <>
                      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
                        <MetricCard
                          label="Servers Tested"
                          value={deepCheckItems.length.toString()}
                          subtitle={`${successful.length} successful`}
                        />
                        <MetricCard
                          label="NAT Consistency"
                          value={consistency}
                          status={natSet.size <= 1 ? "pass" : "warn"}
                        />
                        <MetricCard
                          label="ALG Hits"
                          value={algHits.toString()}
                          subtitle="across presets"
                          status={algHits === 0 ? "pass" : "fail"}
                        />
                        <MetricCard
                          label="Mapped IP Drift"
                          value={mappedIpSet.size <= 1 ? "No" : "Yes"}
                          status={mappedIpSet.size <= 1 ? "pass" : "warn"}
                        />
                        <MetricCard
                          label="Failures"
                          value={failed.toString()}
                          status={failed === 0 ? "pass" : "warn"}
                        />
                      </div>
                      <div className="text-2xs text-muted-foreground">
                        <span className={consistencyTone}>NAT type {consistency.toLowerCase()}</span>
                        <span> · </span>
                        <span className={mappedTone}>
                          {mappedIpSet.size <= 1 ? "Mapped IP stable across servers" : "Mapped IP differs across servers"}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Warnings */}
          {natTypeText.toLowerCase().includes("symmetric") && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/[0.06] border border-destructive/15">
              <Badge variant="destructive" className="text-3xs px-1.5 py-0 h-4 shrink-0">Warning</Badge>
              <span className="text-2xs text-destructive/80">
                Symmetric NAT may cause issues with VoIP, WebRTC, and peer-to-peer connections.
              </span>
            </div>
          )}

          {algDetected === true && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/[0.06] border border-destructive/15">
              <Badge variant="destructive" className="text-3xs px-1.5 py-0 h-4 shrink-0">ALG</Badge>
              <span className="text-2xs text-destructive/80">
                SIP ALG was detected. This can cause call failures and should be disabled on the firewall.
              </span>
            </div>
          )}

          {modifiedHeaders.length > 0 && (
            <div className="ui-hero-surface p-3">
              <p className="section-label-sm mb-1">Modified SIP Headers</p>
              <div className="flex flex-wrap gap-1.5">
                {modifiedHeaders.map((header) => (
                  <Badge key={header} variant="outline" className="h-5 px-1.5 text-3xs">
                    {header}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="ui-hero-surface overflow-hidden">
          <div className="ui-section-header-sm border-b border-border/35">
            <span className="text-xs font-semibold text-foreground">Recent Runs</span>
          </div>
          <div className="max-h-52 overflow-auto">
            {history.map((item, idx) => (
              <div key={item.id} className={cn("flex items-center gap-2 px-3 py-2 text-xs", idx > 0 && "border-t border-border/20")}>
                <span className="w-32 truncate text-muted-foreground">{item.serverLabel}</span>
                <span className="flex-1 truncate">{item.natType}</span>
                <span className={cn("text-2xs", item.algDetected === true ? "text-destructive" : item.algDetected === false ? "text-success" : "text-muted-foreground")}>
                  {item.algDetected == null ? "ERR" : item.algDetected ? "ALG" : "Clean"}
                </span>
                <span className="w-14 text-right text-2xs text-muted-foreground tabular-nums">
                  {item.elapsedMs != null ? `${item.elapsedMs.toFixed(0)}ms` : "--"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
