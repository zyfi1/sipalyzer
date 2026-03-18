import { useEffect, useState } from "react";
import { listen } from "@/lib/tauriEvents";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { ToolViewShell } from "../components/ToolViewShell";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Zap, Loader2, Play, BarChart3, ArrowDownToLine, ArrowUpFromLine, HelpCircle,
  Globe, Timer, Activity, Network,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { tooltips } from "@/lib/tooltips";
import type { SpeedTestProgressEvent } from "@/types/networkTest";

// ── Hero metric card ────────────────────────────────────────────

function HeroMetric({
  icon: Icon,
  label,
  value,
  unit,
  tone = "text-foreground",
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  loading?: boolean;
}) {
  return (
    <div className="ui-hero-metric px-3.5 py-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5 text-muted-foreground/70")} />
        <span className="text-2xs uppercase tracking-[0.08em] text-muted-foreground/70">{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-1.5">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/70" />
        ) : (
          <span className={cn("text-2xl font-semibold tabular-nums leading-none", tone)}>{value}</span>
        )}
        {unit && <span className="pb-0.5 text-xs text-muted-foreground/70">{unit}</span>}
      </div>
    </div>
  );
}

// ── Stat row helper ─────────────────────────────────────────────

function StatRow({ icon: Icon, label, value, unit, tip, tipDesc, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; unit?: string;
  tip?: string; tipDesc?: string; color?: string;
}) {
  const inner = (
    <div className={cn("flex items-center gap-3 px-3 py-1.5 rounded-lg transition-smooth", tip && "hover:bg-muted/10 cursor-help")}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", color ?? "text-muted-foreground/60")} />
      <span className="text-xs text-muted-foreground/70 flex-1">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      {unit && <span className="text-2xs text-muted-foreground/60 -ml-1">{unit}</span>}
    </div>
  );
  if (tip) {
    return <TooltipWrapper title={tip} description={tipDesc} side="top">{inner}</TooltipWrapper>;
  }
  return inner;
}

function InfoButton({
  title,
  description,
  side = "right",
}: {
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipWrapper title={title} description={description} side={side}>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] border border-border/35 bg-muted/10 text-muted-foreground/70 transition-smooth hover:bg-muted/18 hover:text-foreground/90"
        aria-label={`${title} info`}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
    </TooltipWrapper>
  );
}

// ── Rating helpers ──────────────────────────────────────────────

function speedRating(mbps: number): { label: string; color: string } {
  if (mbps >= 200) return { label: "Excellent", color: "text-success" };
  if (mbps >= 50) return { label: "Good", color: "text-success" };
  if (mbps >= 15) return { label: "Fair", color: "text-warning" };
  if (mbps >= 3) return { label: "Slow", color: "text-warning" };
  return { label: "Very Slow", color: "text-destructive" };
}

function qualityTone(label: string): string {
  const value = label.toLowerCase();
  if (value.includes("excellent") || value.includes("high") || value.includes("good")) return "text-success";
  if (value.includes("fair") || value.includes("medium")) return "text-warning";
  if (value.includes("low") || value.includes("poor") || value.includes("slow")) return "text-destructive";
  return "text-muted-foreground";
}

function pickNumber(source: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function pickString(source: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function formatConfidence(source: Record<string, unknown> | null, fallbackLabel: string): string {
  const explicitLabel = pickString(source, ["quality", "confidence_label", "grade", "classification"]);
  if (explicitLabel) return explicitLabel;

  const rawScore = pickNumber(source, ["confidence", "confidence_score", "quality_score"]);
  if (rawScore !== undefined) {
    const pct = rawScore <= 1 ? rawScore * 100 : rawScore;
    return `${Math.max(0, Math.min(100, pct)).toFixed(0)}%`;
  }

  return fallbackLabel;
}

// ═══════════════════════════════════════════════════════════════════

type SpeedSourceOption = {
  id: string;
  name: string;
  source: string;
};

const SPEED_SOURCE_PRESETS: [SpeedSourceOption, ...SpeedSourceOption[]] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    source: "cloudflare",
  },
  {
    id: "librespeed",
    name: "LibreSpeed Official",
    source: "librespeed",
  },
  {
    id: "clouvider-ams",
    name: "Clouvider Amsterdam",
    source: "librespeed|Clouvider Amsterdam|https://ams.speedtest.clouvider.net/backend|garbage.php|empty.php|empty.php",
  },
  {
    id: "clouvider-atl",
    name: "Clouvider Atlanta",
    source: "librespeed|Clouvider Atlanta|https://atl.speedtest.clouvider.net/backend|garbage.php|empty.php|empty.php",
  },
  {
    id: "clouvider-lon",
    name: "Clouvider London",
    source: "librespeed|Clouvider London|https://lon.speedtest.clouvider.net/backend|garbage.php|empty.php|empty.php",
  },
  {
    id: "sharktech-chi",
    name: "Sharktech Chicago",
    source: "librespeed|Sharktech Chicago|https://chispeed.sharktech.net|backend/garbage.php|backend/empty.php|backend/empty.php",
  },
  {
    id: "sharktech-den",
    name: "Sharktech Denver",
    source: "librespeed|Sharktech Denver|https://denspeed.sharktech.net|backend/garbage.php|backend/empty.php|backend/empty.php",
  },
  {
    id: "sharktech-las",
    name: "Sharktech Las Vegas",
    source: "librespeed|Sharktech Las Vegas|https://lasspeed.sharktech.net|backend/garbage.php|backend/empty.php|backend/empty.php",
  },
  {
    id: "digitalocean-in",
    name: "DigitalOcean Bangalore",
    source: "librespeed|DigitalOcean Bangalore|https://in1.backend.librespeed.org|garbage.php|empty.php|empty.php",
  },
  {
    id: "garr-bologna",
    name: "GARR Bologna",
    source: "librespeed|GARR Bologna|https://st-be-bo1.infra.garr.it|garbage.php|empty.php|empty.php",
  },
  {
    id: "garr-rome",
    name: "GARR Rome",
    source: "librespeed|GARR Rome|https://st-be-rm2.infra.garr.it|garbage.php|empty.php|empty.php",
  },
  {
    id: "cesnet-prague",
    name: "CESNET Prague",
    source: "librespeed|CESNET Prague|https://speedtest.cesnet.cz|backend/garbage.php|backend/empty.php|backend/empty.php",
  },
  {
    id: "turris-prague",
    name: "Turris Prague",
    source: "librespeed|Turris Prague|https://librespeed.turris.cz|backend/garbage.php|backend/empty.php|backend/empty.php",
  },
  {
    id: "rackgenius-mi",
    name: "RackGenius Michigan",
    source: "librespeed|RackGenius Michigan|https://mispeed.rackgenius.com|backend/garbage.php|backend/empty.php|backend/empty.php",
  },
  {
    id: "a573-tokyo",
    name: "A573 Tokyo",
    source: "librespeed|A573 Tokyo|https://librespeed.a573.net|backend/garbage.php|backend/empty.php|backend/empty.php",
  },
  {
    id: "hostafrica-za",
    name: "HostAfrica Johannesburg",
    source: "librespeed|HostAfrica Johannesburg|https://za1.backend.librespeed.org|garbage.php|empty.php|empty.php",
  },
  {
    id: "time4vps-vilnius",
    name: "Time4VPS Vilnius",
    source: "librespeed|Time4VPS Vilnius|https://lt1.backend.librespeed.org|garbage.php|empty.php|empty.php",
  },
  {
    id: "riverside-virginia",
    name: "Riverside Virginia",
    source: "librespeed|Riverside Virginia|https://speed.riverside.rocks|garbage.php|empty.php|empty.php",
  },
];

const DEFAULT_SPEED_SOURCE: SpeedSourceOption = {
  id: "cloudflare",
  name: "Cloudflare",
  source: "cloudflare",
};

export function SpeedTestView() {
  const speedTest = useNetworkTestStore((s) => s.speedTest);
  const progress = useNetworkTestStore((s) => s.speedTestProgress);
  const setProgress = useNetworkTestStore((s) => s.setSpeedTestProgress);
  const runSpeedTest = useNetworkTestStore((s) => s.runSpeedTest);
  const bandwidthTest = useNetworkTestStore((s) => s.bandwidthTest);
  const runBandwidthTest = useNetworkTestStore((s) => s.runBandwidthTest);

  const speedRunning = speedTest.status === "running";
  const bwRunning = bandwidthTest.status === "running";
  const anyRunning = speedRunning || bwRunning;
  const [selectedSourceId, setSelectedSourceId] = useState<string>(DEFAULT_SPEED_SOURCE.id);
  const sr = speedTest.result;
  const br = bandwidthTest.result;
  const srAny = (sr as Record<string, unknown> | null) ?? null;

  useEffect(() => {
    const unsub = listen<SpeedTestProgressEvent>("speed-test-progress", (e) => setProgress(e.payload));
    return () => { unsub.then((fn) => fn()); };
  }, [setProgress]);

  const phaseLabel = progress?.phase === "latency" ? "Measuring latency"
    : progress?.phase === "download" ? "Testing download"
    : progress?.phase === "upload" ? "Testing upload" : null;

  const handleRunAll = () => {
    const selectedSource = SPEED_SOURCE_PRESETS.find((s) => s.id === selectedSourceId)?.source ?? DEFAULT_SPEED_SOURCE.source;
    if (!speedRunning) {
      // Force-refresh speed test to avoid stale cached results.
      runSpeedTest(true, selectedSource);
    }
    if (!bwRunning) {
      // Slightly longer run improves UDP throughput stability.
      runBandwidthTest("localhost", undefined, 8);
    }
  };
  const hasValidSource = SPEED_SOURCE_PRESETS.some((s) => s.id === selectedSourceId);

  const dlMbps = sr ? sr.download_mbps : 0;
  const ulMbps = sr ? sr.upload_mbps : 0;
  const brDlMbps = br ? br.download_kbps / 1000 : 0;
  const brUlMbps = br ? br.upload_kbps / 1000 : 0;
  const dlLoaded = pickNumber(srAny, ["download_loaded_latency_ms", "latency_download_ms"]);
  const ulLoaded = pickNumber(srAny, ["upload_loaded_latency_ms", "latency_upload_ms"]);
  const combinedLoaded = dlLoaded != null && ulLoaded != null ? (dlLoaded + ulLoaded) / 2 : undefined;
  const hasLoadedLatency = combinedLoaded != null || pickNumber(srAny, ["loaded_latency_ms", "latency_under_load_ms"]) != null;
  const latencyMs = combinedLoaded ?? pickNumber(srAny, [
    "loaded_latency_ms",
    "latency_under_load_ms",
    "download_loaded_latency_ms",
    "upload_loaded_latency_ms",
    "latency_download_ms",
    "latency_upload_ms",
    "latency_ms",
  ]) ?? 0;
  const latencyLabel = hasLoadedLatency ? "Loaded latency" : "Latency";
  const inferredQuality = speedRating(Math.max(dlMbps, ulMbps)).label;
  const confidenceValue = formatConfidence(srAny, inferredQuality);
  const confidenceTone = qualityTone(confidenceValue);

  return (
    <ToolViewShell
      icon={Zap}
      tint="text-warning"
      title="Speed & Throughput"
      description="Internet speed and UDP throughput measurement"
      compact
    >
      {/* ── Run button ───────────────────────────────── */}
      <div className="ui-hero-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="inline-flex h-8 items-center rounded-md border border-border/35 bg-muted/15 px-2 text-2xs font-medium uppercase tracking-[0.08em] text-muted-foreground/75">
              Source
            </span>
            <Select
              value={selectedSourceId}
              onValueChange={setSelectedSourceId}
              disabled={anyRunning}
            >
              <SelectTrigger className="w-[260px]" size="sm">
                <SelectValue placeholder="Select preset source" />
              </SelectTrigger>
              <SelectContent>
                {SPEED_SOURCE_PRESETS.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TooltipWrapper title="Run Speed Tests" description="Runs internet speed test against the selected source and UDP throughput in parallel." side="bottom">
            <Button size="sm" className="h-8 gap-1.5 px-3 text-xs shrink-0" onClick={handleRunAll} disabled={anyRunning || !hasValidSource}>
              {anyRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {anyRunning ? "Testing…" : "Run"}
            </Button>
          </TooltipWrapper>
        </div>
      </div>

      {/* ── Results grid (always visible) ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ═══ INTERNET SPEED ═══════════════════════════ */}
        <div className="ui-hero-surface flex h-full flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-5 pt-4 pb-2">
            <Globe className="h-3.5 w-3.5 text-warning/60" />
            <h3 className="section-label-sm">Internet Speed</h3>
            <InfoButton
              title={tooltips.netSpeedInternetSection.title}
              description={tooltips.netSpeedInternetSection.description}
            />
            {speedRunning && progress && (
              <span className="ml-auto flex items-center gap-1.5 text-3xs text-muted-foreground/60">
                <Loader2 className="h-3 w-3 animate-spin" />
                {phaseLabel} · {progress.progress_pct.toFixed(0)}%
              </span>
            )}
            {sr && !speedRunning && sr.server && (
              <span className="ml-auto text-3xs text-muted-foreground/60 tabular-nums">via {sr.server}</span>
            )}
          </div>
          <div className="px-5 pb-2">
            <span className="inline-flex items-center rounded-full border border-border/20 bg-muted/10 px-2 py-0.5 text-3xs uppercase tracking-[0.08em] text-muted-foreground/70">
              WAN test (HTTP)
            </span>
          </div>

          {/* Progress bar — visible while running */}
          {speedRunning && progress && (
            <div className="px-5 pt-1 pb-0">
              <div className="h-1 rounded-full bg-muted/10 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
                    progress.phase === "download" ? "bg-success"
                      : progress.phase === "upload" ? "bg-primary"
                        : "bg-warning",
                  )}
                  style={{ width: `${Math.min(100, progress.progress_pct)}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 px-4 pt-1 pb-2">
            <TooltipWrapper title={tooltips.netSpeedDownload.title} description={tooltips.netSpeedDownload.description} side="bottom">
              <div className="cursor-help">
                <HeroMetric
                  icon={ArrowDownToLine}
                  label="Download"
                  value={(speedRunning && progress?.phase === "download" ? (progress.current_mbps ?? 0) : dlMbps).toFixed(1)}
                  unit="Mbps"
                  tone="text-success"
                  loading={speedRunning && progress?.phase !== "download" && !sr}
                />
              </div>
            </TooltipWrapper>
            <TooltipWrapper title={tooltips.netSpeedUpload.title} description={tooltips.netSpeedUpload.description} side="bottom">
              <div className="cursor-help">
                <HeroMetric
                  icon={ArrowUpFromLine}
                  label="Upload"
                  value={(speedRunning && progress?.phase === "upload" ? (progress.current_mbps ?? 0) : ulMbps).toFixed(1)}
                  unit="Mbps"
                  tone="text-primary"
                  loading={speedRunning && progress?.phase !== "upload" && !sr}
                />
              </div>
            </TooltipWrapper>
            <TooltipWrapper title={tooltips.netSpeedLatency.title} description={tooltips.netSpeedLatency.description} side="bottom">
              <div className="cursor-help">
                <HeroMetric
                  icon={Activity}
                  label={latencyLabel}
                  value={sr ? latencyMs.toFixed(0) : "—"}
                  unit="ms"
                  tone="text-foreground"
                  loading={speedRunning && !sr}
                />
              </div>
            </TooltipWrapper>
            <TooltipWrapper title="Connection Quality" description="Confidence and quality indicator for current internet speed measurement; falls back to inferred rating when backend confidence is unavailable." side="bottom">
              <div className="cursor-help">
                <HeroMetric
                  icon={BarChart3}
                  label="Confidence"
                  value={sr ? confidenceValue : "—"}
                  tone={confidenceTone}
                  loading={speedRunning && !sr}
                />
              </div>
            </TooltipWrapper>
          </div>

          <div className="flex items-center justify-center gap-4 pb-2 pt-0">
            {sr ? (
              <>
                {(() => { const r = speedRating(dlMbps); return <span className={cn("section-label-sm", r.color)}>↓ {r.label}</span>; })()}
                <div className="w-px h-3 bg-border/20" />
                {(() => { const r = speedRating(ulMbps); return <span className={cn("section-label-sm", r.color)}>↑ {r.label}</span>; })()}
              </>
            ) : (
              <span className="text-2xs text-muted-foreground/60">{speedRunning ? "Measuring…" : "Waiting for test"}</span>
            )}
          </div>

          <div className="border-t border-border/20 px-2 py-1.5 space-y-0">
            <StatRow icon={ArrowDownToLine} label="Download" value={sr ? dlMbps.toFixed(1) : "—"} unit="Mbps" tip={tooltips.netSpeedDownload.title} tipDesc={tooltips.netSpeedDownload.description} color="text-success/60" />
            <StatRow icon={ArrowUpFromLine} label="Upload" value={sr ? ulMbps.toFixed(1) : "—"} unit="Mbps" tip={tooltips.netSpeedUpload.title} tipDesc={tooltips.netSpeedUpload.description} color="text-primary/70" />
            <StatRow icon={Activity} label={latencyLabel} value={sr ? latencyMs.toFixed(0) : "—"} unit="ms" tip={tooltips.netSpeedLatency.title} tipDesc={tooltips.netSpeedLatency.description} />
            <StatRow icon={BarChart3} label="Jitter" value={sr ? sr.jitter_ms.toFixed(1) : "—"} unit="ms" tip={tooltips.netSpeedJitter.title} tipDesc={tooltips.netSpeedJitter.description} />
          </div>
        </div>

        {/* ═══ UDP THROUGHPUT ════════════════════════════ */}
          <div className="ui-hero-surface flex h-full flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-5 pt-4 pb-2">
            <Network className="h-3.5 w-3.5 text-info/60" />
            <h3 className="section-label-sm">UDP Throughput</h3>
            <InfoButton
              title={tooltips.netBandwidthSection.title}
              description={tooltips.netBandwidthSection.description}
            />
            {bwRunning && (
              <span className="ml-auto flex items-center gap-1.5 text-3xs text-muted-foreground/60">
                <Loader2 className="h-3 w-3 animate-spin" />
                Testing…
              </span>
            )}
            {br && !bwRunning && (
              <span className="ml-auto text-3xs text-muted-foreground/60 tabular-nums">{br.host}</span>
            )}
          </div>
          <div className="px-5 pb-2">
            <span className="inline-flex items-center rounded-full border border-border/20 bg-muted/10 px-2 py-0.5 text-3xs uppercase tracking-[0.08em] text-muted-foreground/70">
              Local test (UDP loopback)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 px-4 pt-1 pb-2">
            <TooltipWrapper title={tooltips.netBandwidthDownload.title} description={tooltips.netBandwidthDownload.description} side="bottom">
              <div className="cursor-help">
                <HeroMetric
                  icon={ArrowDownToLine}
                  label="Download"
                  value={br ? brDlMbps.toFixed(1) : "—"}
                  unit="Mbps"
                  tone="text-success"
                  loading={bwRunning && !br}
                />
              </div>
            </TooltipWrapper>
            <TooltipWrapper title={tooltips.netBandwidthUpload.title} description={tooltips.netBandwidthUpload.description} side="bottom">
              <div className="cursor-help">
                <HeroMetric
                  icon={ArrowUpFromLine}
                  label="Upload"
                  value={br ? brUlMbps.toFixed(1) : "—"}
                  unit="Mbps"
                  tone="text-primary"
                  loading={bwRunning && !br}
                />
              </div>
            </TooltipWrapper>
            <TooltipWrapper title="Packet Loss" description="UDP packet loss measured during the local throughput run." side="bottom">
              <div className="cursor-help">
                <HeroMetric
                  icon={BarChart3}
                  label="Loss"
                  value={br ? br.packet_loss_pct.toFixed(1) : "—"}
                  unit="%"
                  tone={br ? (br.packet_loss_pct > 1 ? "text-destructive" : "text-success") : "text-foreground"}
                  loading={bwRunning && !br}
                />
              </div>
            </TooltipWrapper>
            <TooltipWrapper title={tooltips.netBandwidthDuration.title} description={tooltips.netBandwidthDuration.description} side="bottom">
              <div className="cursor-help">
                <HeroMetric
                  icon={Timer}
                  label="Duration"
                  value={br ? (br.duration_ms / 1000).toFixed(1) : "—"}
                  unit="sec"
                  tone="text-foreground"
                  loading={bwRunning && !br}
                />
              </div>
            </TooltipWrapper>
          </div>

          <div className="flex items-center justify-center gap-4 pb-2 pt-0">
            {br ? (
              <>
                {(() => { const r = speedRating(brDlMbps); return <span className={cn("section-label-sm", r.color)}>↓ {r.label}</span>; })()}
                <div className="w-px h-3 bg-border/20" />
                {(() => { const r = speedRating(brUlMbps); return <span className={cn("section-label-sm", r.color)}>↑ {r.label}</span>; })()}
              </>
            ) : (
              <span className="text-2xs text-muted-foreground/60">{bwRunning ? "Measuring…" : "Waiting for test"}</span>
            )}
          </div>

          <div className="border-t border-border/20 px-2 py-1.5 space-y-0">
            <StatRow icon={ArrowDownToLine} label="Download" value={br ? brDlMbps.toFixed(1) : "—"} unit="Mbps" tip={tooltips.netBandwidthDownload.title} tipDesc={tooltips.netBandwidthDownload.description} color="text-success/60" />
            <StatRow icon={ArrowUpFromLine} label="Upload" value={br ? brUlMbps.toFixed(1) : "—"} unit="Mbps" tip={tooltips.netBandwidthUpload.title} tipDesc={tooltips.netBandwidthUpload.description} color="text-primary/70" />
            <StatRow icon={BarChart3} label="Data transferred" value={br ? formatBytes(br.bytes_sent + br.bytes_received) : "—"} tip={tooltips.netBandwidthBytes.title} tipDesc={tooltips.netBandwidthBytes.description} />
            <StatRow icon={Timer} label="Duration" value={br ? (br.duration_ms / 1000).toFixed(1) : "—"} unit="sec" tip={tooltips.netBandwidthDuration.title} tipDesc={tooltips.netBandwidthDuration.description} />
          </div>
        </div>
      </div>

      {/* ── Compare note ─────────────────────────────── */}
      {sr && br && !anyRunning && (
        <div className="ui-hero-metric flex items-center gap-2 px-4 py-2.5">
          <InfoButton
            title={tooltips.netSpeedVsBandwidth.title}
            description={tooltips.netSpeedVsBandwidth.description}
            side="bottom"
          />
          <span className="text-2xs text-muted-foreground/60">
            Internet Speed tests your ISP via HTTP. UDP Throughput tests local packet processing capacity —{" "}
            <TooltipWrapper title={tooltips.netSpeedVsBandwidth.title} description={tooltips.netSpeedVsBandwidth.description} side="bottom">
              <span className="text-muted-foreground/60 underline decoration-dotted underline-offset-2 cursor-help">
                differences are expected
              </span>
            </TooltipWrapper>
          </span>
        </div>
      )}

      {/* ── Errors ───────────────────────────────────── */}
      {speedTest.error && !speedRunning && <p className="text-xs text-destructive px-1">{speedTest.error}</p>}
      {bandwidthTest.error && !bwRunning && <p className="text-xs text-destructive px-1">{bandwidthTest.error}</p>}
    </ToolViewShell>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
