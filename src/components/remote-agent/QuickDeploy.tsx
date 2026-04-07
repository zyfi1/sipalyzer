import { useEffect, useState } from "react";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import * as api from "@/api/remoteAgent";
import { RELAY_URL } from "@/api/remoteAgent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";
import {
  CalendarClock, Check, ChevronLeft, ChevronRight, Download, Timer,
  WindowsLogo, AppleLogo, LinuxLogo, X,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { listen } from "@/lib/tauriEvents";
import { save, open } from "@tauri-apps/plugin-dialog";

// ── Types ────────────────────────────────────────────────────────────

type TargetOS = "windows" | "macos-x64" | "macos-arm64" | "linux";

interface CompileProgress {
  stage: string;
  message: string;
  progress: number | null;
}

type DeployStage = "idle" | "saving" | "compiling" | "done" | "error";

const PLATFORMS: {
  id: TargetOS;
  label: string;
  sub: string;
  ext: string;
  Icon: React.ComponentType<{ className?: string }>;
  idleIcon: string;
  idleBg: string;
  idleBorder: string;
  activeIcon: string;
  activeBg: string;
  activeBorder: string;
}[] = [
  { id: "windows", label: "Windows", sub: "x64", ext: ".exe", Icon: WindowsLogo, idleIcon: "text-muted-foreground/60", idleBg: "bg-muted/10", idleBorder: "border-border/30", activeIcon: "text-info", activeBg: "bg-info/10", activeBorder: "border-info/30" },
  { id: "macos-arm64", label: "macOS", sub: "Apple Silicon", ext: "", Icon: AppleLogo, idleIcon: "text-muted-foreground/60", idleBg: "bg-muted/10", idleBorder: "border-border/30", activeIcon: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/30" },
  { id: "macos-x64", label: "macOS", sub: "Intel", ext: "", Icon: AppleLogo, idleIcon: "text-muted-foreground/60", idleBg: "bg-muted/10", idleBorder: "border-border/30", activeIcon: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/30" },
  { id: "linux", label: "Linux", sub: "x64", ext: "", Icon: LinuxLogo, idleIcon: "text-muted-foreground/60", idleBg: "bg-muted/10", idleBorder: "border-border/30", activeIcon: "text-warning", activeBg: "bg-warning/10", activeBorder: "border-warning/30" },
];
const WIP_PLATFORMS = new Set<TargetOS>(["linux"]);
const LEGACY_PLATFORMS = new Set<TargetOS>(["macos-x64"]);

function buildControllerAddressList(
  relayAddress: string,
  detected: api.AddressDetectionResult | null,
): string {
  const out: string[] = [relayAddress];
  const seen = new Set<string>([relayAddress]);
  if (detected) {
    for (const candidate of detected.addresses) {
      const addr = candidate.ip.trim();
      if (!addr || seen.has(addr)) continue;
      // Keep the relay tunnel as primary, then add direct/VPN interface candidates.
      if (candidate.type === "public" && candidate.unreachable) continue;
      seen.add(addr);
      out.push(addr);
    }
  }
  return out.join("|");
}

const LIFETIME_PRESETS = [
  { id: "1h", label: "1h", seconds: 3600 },
  { id: "24h", label: "24h", seconds: 86400 },
  { id: "48h", label: "48h", seconds: 172800 },
  { id: "7d", label: "7d", seconds: 604800 },
  { id: "never", label: "∞", seconds: null as number | null, labelClass: "text-xl leading-none -mt-0.5" },
];

function parseDateString(value: string): Date | undefined {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function formatDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Component ────────────────────────────────────────────────────────

export function QuickDeploy() {
  const { addGeneratedConfig } = useRemoteAgentStore();
  const getDefaultCustomDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<TargetOS>>(new Set());
  const [lifetimeMode, setLifetimeMode] = useState<string>("24h");
  const [customDate, setCustomDate] = useState<string>(getDefaultCustomDate);
  const [customHour, setCustomHour] = useState<string>("09");
  const [customMinute, setCustomMinute] = useState<string>("00");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [stage, setStage] = useState<DeployStage>("idle");
  const [progress, setProgress] = useState(0);
  const [stageMessage, setStageMessage] = useState("");
  const [deployTotal, setDeployTotal] = useState(0);
  const [deployDone, setDeployDone] = useState(0);

  const isDeploying = stage === "saving" || stage === "compiling";

  const resolvedExpiry = (() => {
    if (lifetimeMode === "custom") {
      const [y, m, d] = customDate.split("-").map(Number);
      const hh = Number(customHour);
      const mm = Number(customMinute);
      if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
      const target = new Date(y, m - 1, d, hh, mm, 0, 0);
      const seconds = Math.round((target.getTime() - Date.now()) / 1000);
      return seconds > 0 ? seconds : null;
    }
    return LIFETIME_PRESETS.find((l) => l.id === lifetimeMode)?.seconds ?? null;
  })();

  const deployableSelectionCount = Array.from(selectedPlatforms).filter((id) => !WIP_PLATFORMS.has(id)).length;
  const firstDeployablePlatformId = Array.from(selectedPlatforms).find((id) => !WIP_PLATFORMS.has(id));
  const canDeploy = deployableSelectionCount > 0 && !isDeploying && (lifetimeMode !== "custom" || resolvedExpiry !== null);
  const selectedCustomDate = parseDateString(customDate);

  useEffect(() => {
    const unlisten = listen<CompileProgress>("remote-agent:compile-progress", (e) => {
      if (stage === "compiling") {
        setProgress((e.payload.progress ?? 0) * 100);
        setStageMessage(e.payload.message);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [stage]);

  const togglePlatform = (id: TargetOS) => {
    if (WIP_PLATFORMS.has(id)) return;
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeploy = async () => {
    if (!canDeploy) return;

    const token = await api.generateToken();
    const platforms = Array.from(selectedPlatforms).filter((id) => !WIP_PLATFORMS.has(id));
    const isBatch = platforms.length > 1;
    const shortId = crypto.randomUUID().slice(0, 8);
    const listenerPort = await api.getListenerPort().catch(() => 0);
    const detectedAddresses =
      listenerPort > 0 ? await api.detectAddresses(listenerPort).catch(() => null) : null;

    setStage("saving");
    setStageMessage("Choose save location...");

    let savePaths: { os: TargetOS; path: string }[] = [];

    if (isBatch) {
      let folder: string | null = null;
      try {
        const result = await open({ directory: true, title: "Choose folder for agent binaries" });
        if (typeof result === "string") folder = result;
      } catch { /* cancelled */ }
      if (!folder) { setStage("idle"); return; }
      savePaths = platforms.map((os) => {
        const p = PLATFORMS.find((pl) => pl.id === os)!;
        return { os, path: `${folder}/sipalyzer-agent-${shortId}-${os}${p.ext || ""}` };
      });
    } else {
      const os = platforms[0]!;
      const p = PLATFORMS.find((pl) => pl.id === os)!;
      let savePath: string | null = null;
      try {
        savePath = await save({
          title: `Save ${p.label} Agent`,
          defaultPath: `sipalyzer-agent-${shortId}${p.ext || ""}`,
        });
      } catch { /* cancelled */ }
      if (!savePath) { setStage("idle"); return; }
      savePaths = [{ os, path: savePath }];
    }

    setStage("compiling");
    setDeployTotal(savePaths.length);
    setDeployDone(0);
    let hadError = false;

    const experience = "full" as const;

    for (let i = 0; i < savePaths.length; i++) {
      const { os, path } = savePaths[i]!;
      const plat = PLATFORMS.find((p) => p.id === os)!;
      setStageMessage(
        isBatch
          ? `Building ${plat.label} ${plat.sub}... (${i + 1}/${savePaths.length})`
          : `Compiling ${plat.label} agent...`
      );
      setProgress(0);
      setDeployDone(i);

      try {
        const agentSessionId = crypto.randomUUID();
        const relayControllerAddr = `${RELAY_URL}/session/${agentSessionId}`;
        const controllerAddr = buildControllerAddressList(relayControllerAddr, detectedAddresses);

        const res = await api.generateAgentPackage(
          {
            target_os: os,
            controller_address: controllerAddr,
            use_tls: true,
            auth_token: token,
            expires_seconds: resolvedExpiry,
            label: null,
            profile: experience,
            experience,
            daemon_headless: false,
          },
          path,
        );

        await api.connectRelay(agentSessionId, token);

        const now = new Date().toISOString();
        addGeneratedConfig({
          id: crypto.randomUUID(),
          agentId: res.agent_id,
          targetOs: os,
          controllerAddress: controllerAddr,
          authToken: res.auth_token,
          generatedAt: now,
          createdAt: now,
          rebuiltCount: 0,
          label: null,
          zipPath: res.binary_path,
          profile: experience,
          experience,
        });
      } catch (err: any) {
        hadError = true;
        setStage("error");
        setStageMessage(
          isBatch
            ? `${plat.label} failed: ${err?.message || "Build error"}`
            : err?.message || "Build failed"
        );
        setTimeout(() => { setStage("idle"); setProgress(0); }, 5000);
        return;
      }
    }

    if (!hadError) {
      setDeployDone(savePaths.length);
      setStage("done");
      setStageMessage(isBatch ? `${savePaths.length} agents ready` : "Agent ready");
      setTimeout(() => { setStage("idle"); setProgress(0); }, 4000);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="ui-surface-card shrink-0 transition-smooth overflow-hidden">
      <div className="px-5 pt-5 pb-5 flex flex-col gap-4">
        {/* ── Header ── */}
        <div className="flex items-center gap-3">
          <div className="surface-subtle h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border border-border/35">
            <Download className="h-4.5 w-4.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold leading-tight">Deploy Agent</h3>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 border border-success/20">
                <span className="w-1.5 h-1.5 rounded-full bg-success status-online" />
                <span className="text-2xs font-medium text-success/80">Secure relay</span>
              </span>
            </div>
            <p className="text-2xs text-muted-foreground mt-0.5">
              Select platforms, set expiry, and deploy
            </p>
          </div>
        </div>

        {/* ── Platform Tiles ── */}
        <div className="grid grid-cols-2 gap-2.5">
          {PLATFORMS.map((p) => {
            const isWip = WIP_PLATFORMS.has(p.id);
            const isLegacy = LEGACY_PLATFORMS.has(p.id);
            const isActive = selectedPlatforms.has(p.id);
            const isWindows = p.id === "windows";
            const isLinux = p.id === "linux";
            const activeTone = isWindows ? "info" : isLinux ? "warning" : "primary";
            return (
              <button
                key={p.id}
                onClick={() => togglePlatform(p.id)}
                disabled={isDeploying || isWip}
                className={cn(
                  "ui-choice-tile relative flex min-h-[88px] items-start gap-3 px-3 py-3 text-left",
                  activeTone === "info"
                    ? "ui-choice-tone-info"
                    : activeTone === "warning"
                      ? "ui-choice-tone-warning"
                      : "ui-choice-tone-primary",
                  isWip
                    ? "border-border/35 bg-muted/6 opacity-55 cursor-not-allowed"
                    : isActive && "is-active",
                  isDeploying && "opacity-50 pointer-events-none"
                )}
              >
                {isWip && (
                  <div className="absolute top-1.5 right-1.5">
                    <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      WIP
                    </span>
                  </div>
                )}
                {!isWip && isLegacy && (
                  <div className="absolute top-1.5 right-1.5">
                    <span className="inline-flex h-5 items-center rounded-[var(--radius-sm)] border border-warning/28 bg-background/72 px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning/85 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)]">
                      LEGACY
                    </span>
                  </div>
                )}
                {isActive && (
                  <div className="absolute top-1.5 right-1.5">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-success/35 bg-success/12">
                      <Check className="h-2.5 w-2.5 text-success" />
                    </span>
                  </div>
                )}
                <span
                  className={cn(
                    "h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-smooth",
                    isWip
                      ? "border border-border/25 bg-muted/10"
                      : isActive
                        ? "ui-choice-identity"
                        : "border border-border/35 bg-background/30"
                  )}
                >
                  <p.Icon className={cn(
                    "h-5 w-5 transition-smooth",
                    isWip ? "text-muted-foreground/45" : isActive ? p.activeIcon : p.idleIcon
                  )} />
                </span>
                <div className="text-left min-w-0">
                  <div className={cn(
                    "text-xs font-semibold leading-tight transition-smooth",
                    isWip ? "text-muted-foreground/65" : isActive ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {p.label}
                  </div>
                  <div className={cn(
                    "text-2xs leading-tight mt-0.5 transition-smooth",
                    isWip ? "text-muted-foreground/50" : isActive ? "text-muted-foreground" : "text-muted-foreground/60"
                  )}>
                    {p.sub}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Expiry + Deploy ── */}
        {stage === "idle" ? (
          <div className="flex flex-col gap-3">
            {/* Expiry picker */}
            <div className="rounded-lg border border-border/30 bg-muted/10 p-3">
              <div className="flex items-center gap-2 mb-2.5">
                <Timer className="h-3.5 w-3.5 text-info/70" />
                <span className="section-label-sm">Expires after</span>
              </div>
              <div className="flex items-center gap-1">
                {LIFETIME_PRESETS.map((l) => (
                  <Button
                    key={l.id}
                    onClick={() => setLifetimeMode(l.id)}
                    disabled={isDeploying}
                    variant={lifetimeMode === l.id ? "default" : "neutral"}
                    className={cn(
                      "flex-1 h-8 rounded-lg text-xs font-semibold transition-smooth border",
                      lifetimeMode === l.id
                        ? "border-primary/45 bg-primary/90 text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                        : "text-muted-foreground/70 border-border/20 bg-background/20 hover:text-foreground hover:bg-muted/20"
                    )}
                    size="sm"
                  >
                    <span className={l.labelClass}>{l.label}</span>
                  </Button>
                ))}
                <Button
                  onClick={() => setLifetimeMode("custom")}
                  disabled={isDeploying}
                  variant={lifetimeMode === "custom" ? "default" : "neutral"}
                  className={cn(
                    "flex-1 h-8 rounded-lg text-xs font-semibold transition-smooth border",
                    lifetimeMode === "custom"
                      ? "border-primary/45 bg-primary/90 text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                      : "text-muted-foreground/70 border-border/20 bg-background/20 hover:text-foreground hover:bg-muted/20"
                  )}
                  size="sm"
                >
                  Custom
                </Button>
              </div>
              {lifetimeMode === "custom" && (
                <div className="mt-2.5 grid grid-cols-1 gap-2.5 border-t border-border/20 pt-2.5 md:grid-cols-2">
                  <label className="text-2xs text-muted-foreground/75 md:col-span-1">
                    <span className="mb-1 inline-flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      Date
                    </span>
                    <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="neutral"
                          size="sm"
                          className="h-10 w-full justify-start gap-2 rounded-lg px-3 text-sm font-mono"
                        >
                          <CalendarClock className="h-4 w-4 text-muted-foreground/75" />
                          {selectedCustomDate ? format(selectedCustomDate, "MMM d, yyyy") : "Select date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-auto p-2">
                        <DayPicker
                          mode="single"
                          selected={selectedCustomDate}
                          onSelect={(date) => {
                            if (!date) return;
                            setCustomDate(formatDateString(date));
                            setDatePickerOpen(false);
                          }}
                          fromDate={new Date()}
                          showOutsideDays
                          className="rounded-md"
                          classNames={{
                            months: "flex flex-col",
                            month: "space-y-2",
                            month_caption: "relative flex items-center justify-center px-8 pb-1",
                            caption_label: "text-sm font-semibold text-foreground",
                            nav: "absolute inset-x-0 top-0 flex items-center justify-between px-0.5",
                            button_previous: "ui-control-shell inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground",
                            button_next: "ui-control-shell inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground",
                            month_grid: "w-full border-collapse",
                            weekdays: "grid grid-cols-7 gap-1",
                            weekday: "h-8 text-2xs text-muted-foreground/75 font-medium text-center leading-8",
                            weeks: "mt-1 space-y-1",
                            week: "grid grid-cols-7 gap-1",
                            day: "text-center",
                            day_button: "inline-flex h-8 w-8 items-center justify-center rounded-md text-xs transition-smooth hover:bg-accent/30",
                            selected: "bg-primary/20 text-primary border border-primary/40 hover:bg-primary/25",
                            today: "border border-border/50 text-foreground",
                            outside: "text-muted-foreground/45",
                            disabled: "text-muted-foreground/35 opacity-50",
                          }}
                          components={{
                            Chevron: ({ orientation }) =>
                              orientation === "left" ? (
                                <ChevronLeft className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              ),
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </label>
                  <div className="flex items-end md:col-span-1">
                    <div className="w-full">
                      <span className="mb-1 inline-flex items-center gap-1 text-2xs text-muted-foreground/75">
                        <Timer className="h-3 w-3" />
                        Time
                      </span>
                      <div className="ui-control-shell flex h-10 items-center gap-2 rounded-lg px-2">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={customHour}
                          onChange={(e) => setCustomHour(e.target.value.replace(/\D/g, "").slice(0, 2))}
                          onBlur={() => {
                            const n = Number(customHour);
                            if (Number.isNaN(n)) {
                              setCustomHour("");
                              return;
                            }
                            setCustomHour(String(Math.max(0, Math.min(23, n))).padStart(2, "0"));
                          }}
                          placeholder="HH"
                          className="h-8 w-16 border-border/35 bg-background/30 px-2 text-center text-sm font-mono"
                        />
                        <span className="text-muted-foreground/80 text-sm font-semibold">:</span>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={customMinute}
                          onChange={(e) => setCustomMinute(e.target.value.replace(/\D/g, "").slice(0, 2))}
                          onBlur={() => {
                            const n = Number(customMinute);
                            if (Number.isNaN(n)) {
                              setCustomMinute("");
                              return;
                            }
                            setCustomMinute(String(Math.max(0, Math.min(59, n))).padStart(2, "0"));
                          }}
                          placeholder="MM"
                          className="h-8 w-16 border-border/35 bg-background/30 px-2 text-center text-sm font-mono"
                        />
                        <span className="text-2xs text-muted-foreground/75 ml-1">24h</span>
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className={cn(
                      "h-8 w-full rounded-md border px-2.5 text-xs inline-flex items-center",
                      resolvedExpiry == null
                        ? "border-destructive/35 bg-destructive/8 text-destructive"
                        : "border-success/25 bg-success/8 text-success"
                    )}>
                      {resolvedExpiry == null ? "Pick a future date/time" : `Expires in ${Math.max(1, Math.floor(resolvedExpiry / 3600))}h`}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Deploy button */}
            <Button
              className="w-full gap-2 h-10"
              disabled={!canDeploy}
              onClick={handleDeploy}
            >
              <Download className="h-4 w-4" />
              {selectedPlatforms.size === 0
                ? "Select a platform"
                : deployableSelectionCount === 1
                  ? `Deploy ${PLATFORMS.find((p) => p.id === firstDeployablePlatformId)?.label} Agent`
                  : `Deploy ${deployableSelectionCount} Agents`}
            </Button>
          </div>
        ) : stage === "done" ? (
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-success/10 border border-success/30">
            <Check className="h-4 w-4 text-success shrink-0" />
            <span className="text-sm text-success font-medium">{stageMessage}</span>
          </div>
        ) : stage === "error" ? (
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-destructive/10 border border-destructive/30">
            <X className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-sm text-destructive truncate">{stageMessage}</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Spinner className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-sm text-primary font-medium truncate flex-1">
                {stageMessage}
              </span>
              {stage === "compiling" && (
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {Math.round(progress)}%
                </span>
              )}
            </div>
            {stage === "compiling" && (
              <div className="w-full h-1.5 rounded-full bg-muted/20 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            {deployTotal > 1 && (
              <p className="text-2xs text-muted-foreground/60 text-center">
                {deployDone} of {deployTotal} complete
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
