import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Play, Square, Trash, Download, Scan, Wifi, Loader2, RefreshCw, Network, Info, ChevronDown, Globe, Shield, Copy, Check } from "@/lib/icons";
import { IpAddress } from "@/components/ui/IpAddress";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ColumnDef, type SortingFn } from "@tanstack/react-table";
import { ScanFilterBar } from "./ScanFilterBar";
import { ExportDialog } from "./ExportDialog";
import { WolButton } from "./WolButton";
import type { DiscoveredDevice, ScanMode, SubnetInfo } from "@/types/networkDevices";
import * as api from "@/api/networkDevices";
import { ResultSourceBadge } from "@/components/network-test/components/ResultSourceBadge";
import { useUnifiedTable } from "@/lib/table/useUnifiedTable";

// ── CIDR Range definitions ──────────────────────────────────────

interface CidrOption {
  mask: number;
  hosts: number;
  label: string;
  description: string;
  time: string;
  category: "single" | "small" | "medium" | "large";
}

const CIDR_OPTIONS: CidrOption[] = [
  { mask: 32, hosts: 1,      label: "/32",  description: "Single host",             time: "< 1s",    category: "single" },
  { mask: 30, hosts: 2,      label: "/30",  description: "Point-to-point link",     time: "< 1s",    category: "single" },
  { mask: 28, hosts: 14,     label: "/28",  description: "Micro subnet",            time: "~2s",     category: "small" },
  { mask: 27, hosts: 30,     label: "/27",  description: "Small office / VLAN",     time: "~5s",     category: "small" },
  { mask: 26, hosts: 62,     label: "/26",  description: "Medium office",           time: "~10s",    category: "small" },
  { mask: 25, hosts: 126,    label: "/25",  description: "Half Class C",            time: "~20s",    category: "medium" },
  { mask: 24, hosts: 254,    label: "/24",  description: "Standard LAN (Class C)",  time: "~30s",    category: "medium" },
  { mask: 23, hosts: 510,    label: "/23",  description: "Double subnet",           time: "~1 min",  category: "medium" },
  { mask: 22, hosts: 1022,   label: "/22",  description: "Large office / campus",   time: "~2 min",  category: "large" },
  { mask: 21, hosts: 2046,   label: "/21",  description: "Building complex",        time: "~4 min",  category: "large" },
  { mask: 20, hosts: 4094,   label: "/20",  description: "Enterprise campus",       time: "~8 min",  category: "large" },
  { mask: 16, hosts: 65534,  label: "/16",  description: "Full Class B (max)",      time: "~30 min", category: "large" },
];

const CATEGORY_COLORS: Record<CidrOption["category"], string> = {
  single: "text-success",
  small: "text-info",
  medium: "text-warning",
  large: "text-destructive",
};

const CATEGORY_BG: Record<CidrOption["category"], string> = {
  single: "bg-success/10",
  small: "bg-info/10",
  medium: "bg-warning/10",
  large: "bg-destructive/10",
};

function extractBaseIp(target: string): string | null {
  const trimmed = target.trim().split(",")[0]?.trim() ?? "";
  const cidrMatch = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/\d+$/);
  if (cidrMatch) return cidrMatch[1]!;
  const rangeMatch = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/);
  if (rangeMatch) return `${rangeMatch[1]}.0`;
  const ipMatch = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (ipMatch) return `${ipMatch[1]}.0`;
  return null;
}

function extractCurrentMask(target: string): number | null {
  const match = target.trim().match(/\/(\d+)$/);
  return match ? parseInt(match[1]!, 10) : null;
}

// ── CIDR Picker Popover ─────────────────────────────────────────

function CidrPicker({ targets, onSelect, disabled }: { targets: string; onSelect: (cidr: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const currentMask = extractCurrentMask(targets);
  const baseIp = extractBaseIp(targets);

  const handleSelect = (opt: CidrOption) => {
    onSelect(`${baseIp ?? "192.168.1.0"}/${opt.mask}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "ui-control-shell inline-flex items-center justify-center gap-1.5 h-10 px-3.5 shrink-0 font-mono text-xs font-medium tabular-nums transition-smooth disabled:pointer-events-none disabled:opacity-50",
            currentMask !== null && "text-primary",
          )}
          disabled={disabled}
        >
          {currentMask !== null ? `/${currentMask}` : "CIDR"}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] p-0 overflow-hidden" sideOffset={6}>
        <div className="px-4 pt-3.5 pb-2.5 border-b">
          <p className="text-xs font-semibold">CIDR Subnet Mask</p>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Select a range to scan.{" "}
            {baseIp ? (
              <span className="font-mono text-foreground/70">{baseIp}</span>
            ) : (
              <span className="text-muted-foreground/60">Enter a target first.</span>
            )}
          </p>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {CIDR_OPTIONS.map((opt) => {
            const isActive = currentMask === opt.mask;
            return (
              <button key={opt.mask} type="button" onClick={() => handleSelect(opt)} className={cn("w-full flex items-center gap-3 px-4 py-2 text-left transition-smooth", isActive ? "bg-primary/10" : "hover:bg-muted/40")}>
                <span className={cn("w-11 text-center py-0.5 rounded font-mono text-2xs font-bold tabular-nums shrink-0", isActive ? "bg-primary/20 text-primary" : CATEGORY_BG[opt.category], !isActive && CATEGORY_COLORS[opt.category])}>
                  {opt.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-xs leading-tight", isActive ? "text-primary font-medium" : "text-foreground/90")}>{opt.description}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5 tabular-nums">{opt.hosts.toLocaleString()} host{opt.hosts !== 1 ? "s" : ""}</p>
                </div>
                <span className={cn("text-2xs font-mono tabular-nums shrink-0", opt.category === "large" ? "text-destructive/70" : "text-muted-foreground/60")}>{opt.time}</span>
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="surface-subtle px-4 py-2 border-t">
          <p className="text-2xs text-muted-foreground/70">Larger ranges take longer. Quick scan recommended for /20 and above.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Target Combobox (input + subnet dropdown) ───────────────────

const IFACE_TYPE_ICON: Record<string, React.ReactNode> = {
  wifi: <Wifi className="h-3.5 w-3.5" />,
  ethernet: <Network className="h-3.5 w-3.5" />,
  vpn: <Shield className="h-3.5 w-3.5" />,
  virtual: <Globe className="h-3.5 w-3.5" />,
  other: <Network className="h-3.5 w-3.5" />,
};

const IFACE_TYPE_COLOR: Record<string, string> = {
  wifi: "text-info",
  ethernet: "text-success",
  vpn: "text-primary",
  virtual: "text-warning",
  other: "text-muted-foreground",
};

function TargetCombobox({ value, onChange, onSelect, disabled, onEnter }: {
  value: string; onChange: (v: string) => void; onSelect: (cidr: string) => void; disabled?: boolean; onEnter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subnets, setSubnets] = useState<SubnetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchSubnets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setSubnets(await api.networkDevicesListSubnets()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!hasFetched.current) { hasFetched.current = true; fetchSubnets(); }
  }, [fetchSubnets]);

  const handleSelect = (subnet: SubnetInfo) => {
    onSelect(subnet.cidr);
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectedSubnet = subnets.find((s) => s.cidr === value.trim());
  const selectorColor = selectedSubnet ? (IFACE_TYPE_COLOR[selectedSubnet.interface_type] ?? IFACE_TYPE_COLOR.other) : "text-muted-foreground/60";
  const selectorIcon = selectedSubnet ? (IFACE_TYPE_ICON[selectedSubnet.interface_type] ?? IFACE_TYPE_ICON.other) : <Network className="h-3.5 w-3.5" />;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn("relative grid h-10 rounded-md overflow-hidden transition-smooth", "focus-within:ring-1 focus-within:ring-primary/30", open && "ring-1 ring-primary/30", disabled && "opacity-50 pointer-events-none")}
          style={{ gridTemplateColumns: "1fr 1fr" }}
        >
          <div className="flex items-center rounded-l-md border border-border/55 border-r-0 bg-card/50">
            <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); if (e.key === "Enter") e.stopPropagation(); }}
              onFocus={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
              placeholder="192.168.1.0/24" className="w-full min-w-0 bg-transparent pl-3 pr-2 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 outline-none" disabled={disabled}
            />
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
            className={cn("flex items-center gap-2 px-3 h-full rounded-r-md border border-border/55 border-l-0 bg-muted/20", "hover:bg-muted/30 transition-smooth text-left")} tabIndex={-1}
          >
            <span className={cn("shrink-0", selectorColor)}>{selectorIcon}</span>
            <div className="flex-1 min-w-0 overflow-hidden">
              {selectedSubnet ? (
                <>
                  <p className="text-2xs font-medium text-foreground truncate leading-tight">{selectedSubnet.friendly_name || selectedSubnet.interface_name}</p>
                  <p className="text-3xs text-muted-foreground font-mono truncate leading-tight mt-px">
                    {selectedSubnet.local_ip}{selectedSubnet.gateway ? ` · gw ${selectedSubnet.gateway}` : ""}
                  </p>
                </>
              ) : (
                <p className="text-2xs text-muted-foreground truncate">Select subnet...</p>
              )}
            </div>
            {selectedSubnet && (
              <span className={cn("px-1.5 py-0.5 rounded text-3xs font-semibold uppercase tracking-wider shrink-0",
                selectedSubnet.interface_type === "wifi" ? "bg-info/10 text-info" :
                selectedSubnet.interface_type === "ethernet" ? "bg-success/10 text-success" :
                selectedSubnet.interface_type === "vpn" ? "bg-primary/10 text-primary" :
                selectedSubnet.interface_type === "virtual" ? "bg-warning/10 text-warning" :
                "bg-muted text-muted-foreground"
              )}>{selectedSubnet.interface_type}</span>
            )}
            <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </PopoverTrigger>

      <PopoverContent align="start" className="p-0 overflow-hidden" style={{ width: "var(--radix-popover-trigger-width)" }} sideOffset={4} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="surface-subtle px-3.5 py-2.5 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="h-3.5 w-3.5 text-muted-foreground/60" />
            <p className="section-label-sm">Network Interfaces</p>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); fetchSubnets(); }} disabled={loading}
            className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-smooth disabled:opacity-50">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {loading && subnets.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Detecting interfaces...
            </div>
          )}
          {error && <div className="px-3.5 py-3 text-xs text-destructive">{error}</div>}
          {!loading && !error && subnets.length === 0 && (
            <EmptyState
              variant="inline"
              compact
              icon={<Network />}
              title="No interfaces detected"
              description="No local subnets were detected."
              className="py-6"
            />
          )}
          {subnets.map((subnet, i) => {
            const isActive = value.trim() === subnet.cidr;
            const color = IFACE_TYPE_COLOR[subnet.interface_type] ?? IFACE_TYPE_COLOR.other;
            const icon = IFACE_TYPE_ICON[subnet.interface_type] ?? IFACE_TYPE_ICON.other;
            return (
              <button key={`${subnet.interface_name}-${subnet.cidr}-${i}`} type="button" onClick={() => handleSelect(subnet)}
                className={cn("w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-smooth", isActive ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/40 border-l-2 border-l-transparent")}
              >
                <span className={cn("shrink-0", color)}>{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-mono text-xs font-semibold", isActive ? "text-primary" : "text-foreground")}>{subnet.cidr}</span>
                    {subnet.is_default && <span className="px-1.5 py-px rounded text-3xs font-bold uppercase tracking-wider bg-primary/15 text-primary leading-tight">default</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-2xs text-muted-foreground truncate">{subnet.friendly_name || subnet.interface_name}</span>
                    <span className="text-2xs text-muted-foreground/60">·</span>
                    <span className="text-2xs text-muted-foreground/70 font-mono">{subnet.local_ip}</span>
                    {subnet.gateway && (<><span className="text-2xs text-muted-foreground/60">·</span><span className="text-2xs text-muted-foreground/60 font-mono">gw {subnet.gateway}</span></>)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("px-1.5 py-0.5 rounded text-3xs font-medium capitalize",
                    subnet.interface_type === "wifi" ? "bg-info/10 text-info" : subnet.interface_type === "ethernet" ? "bg-success/10 text-success" : subnet.interface_type === "vpn" ? "bg-primary/10 text-primary" : subnet.interface_type === "virtual" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                  )}>{subnet.interface_type}</span>
                  <span className="text-2xs text-muted-foreground/60 tabular-nums font-mono w-16 text-right">{subnet.host_count.toLocaleString()} ip{subnet.host_count !== 1 ? "s" : ""}</span>
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Scan mode pills ──────────────────────────────────────────────

const SCAN_MODE_OPTIONS: { value: ScanMode; label: string; description: string }[] = [
  { value: "quick", label: "Quick", description: "ARP sweep only — fast host + MAC discovery" },
  { value: "sip", label: "Service", description: "ARP + service probes — fingerprint running services on discovered devices" },
  { value: "full", label: "Full", description: "ARP + rDNS + port scan + banner grab — comprehensive network audit" },
];

const ENRICHMENT_PRESET_OPTIONS = [
  {
    value: "fast",
    label: "Fast",
    description: "Minimal enrichment. Prioritizes speed over detail.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Recommended default. Good speed/detail tradeoff.",
  },
  {
    value: "deep",
    label: "Deep",
    description: "Maximum enrichment with deeper fingerprinting.",
  },
] as const;

// ── Config Panel ─────────────────────────────────────────────────

function ConfigPanel() {
  const targets = useNetworkDevicesStore((s) => s.targets);
  const scanMode = useNetworkDevicesStore((s) => s.scanMode);
  const status = useNetworkDevicesStore((s) => s.status);
  const timeoutMs = useNetworkDevicesStore((s) => s.timeoutMs);
  const concurrency = useNetworkDevicesStore((s) => s.concurrency);
  const enrichmentPreset = useNetworkDevicesStore((s) => s.enrichmentPreset);
  const probed = useNetworkDevicesStore((s) => s.probed);
  const totalProbes = useNetworkDevicesStore((s) => s.totalProbes);
  const phaseLabel = useNetworkDevicesStore((s) => s.phaseLabel);
  const phaseProbed = useNetworkDevicesStore((s) => s.phaseProbed);
  const phaseTotal = useNetworkDevicesStore((s) => s.phaseTotal);
  const devices = useNetworkDevicesStore((s) => s.devices);

  const setTargets = useNetworkDevicesStore((s) => s.setTargets);
  const setScanMode = useNetworkDevicesStore((s) => s.setScanMode);
  const setTimeoutMs = useNetworkDevicesStore((s) => s.setTimeoutMs);
  const setConcurrency = useNetworkDevicesStore((s) => s.setConcurrency);
  const setEnrichmentPreset = useNetworkDevicesStore((s) => s.setEnrichmentPreset);
  const startScan = useNetworkDevicesStore((s) => s.startScan);
  const stopScan = useNetworkDevicesStore((s) => s.stopScan);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext("deviceScan");

  const hasAutoDetected = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (hasAutoDetected.current) return;
    if (targets.trim()) return;
    hasAutoDetected.current = true;
    (async () => {
      try {
        const subnets = await api.networkDevicesListSubnets();
        const defaultSubnet = subnets.find((s) => s.is_default) ?? subnets[0];
        if (defaultSubnet && !useNetworkDevicesStore.getState().targets.trim()) {
          setTargets(defaultSubnet.cidr);
        }
      } catch { /* user can type manually */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = status === "running";
  const deviceCount = devices.length;
  const activeMode =
    SCAN_MODE_OPTIONS.find((m) => m.value === scanMode) ??
    SCAN_MODE_OPTIONS[0] ?? {
      value: "balanced",
      label: "Balanced",
      description: "Balanced scan profile.",
    };

  return (
    <div className="surface relative overflow-hidden transition-smooth">
      {/* ── Header (always visible) ── */}
      <div className="relative flex items-center gap-2.5 px-4 py-3">
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <div className="surface-subtle h-9 w-9 rounded-md flex items-center justify-center shrink-0">
            <Scan className="h-4 w-4 text-primary/80" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold leading-tight">Network Scanner</h3>
            <p className="text-2xs text-muted-foreground mt-0.5 font-mono tabular-nums truncate">
              {targets || "No target set"}
              {deviceCount > 0 && !isRunning && <span className="text-foreground/60"> · {deviceCount} device{deviceCount !== 1 ? "s" : ""}</span>}
            </p>
          </div>
        </button>

        {/* Primary controls */}
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <div className="subview-tabs-compact">
            {SCAN_MODE_OPTIONS.map((opt) => (
              <TooltipWrapper key={opt.value} title={opt.label} description={opt.description}>
                <button
                  type="button"
                  onClick={() => setScanMode(opt.value)}
                  disabled={isRunning}
                  data-state={scanMode === opt.value ? "active" : "inactive"}
                  className={cn(
                    "subview-tab-compact !h-7 !px-2.5",
                    isRunning && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {opt.label}
                </button>
              </TooltipWrapper>
            ))}
          </div>

          <div className="subview-tabs-compact hidden xl:flex">
            {ENRICHMENT_PRESET_OPTIONS.map((preset) => (
              <TooltipWrapper key={preset.value} title={`${preset.label} profile`} description={preset.description}>
                <button
                  type="button"
                  onClick={() => setEnrichmentPreset(preset.value)}
                  disabled={isRunning}
                  data-state={enrichmentPreset === preset.value ? "active" : "inactive"}
                  className={cn(
                    "subview-tab-compact !h-7 !px-2 capitalize",
                    isRunning && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {preset.label}
                </button>
              </TooltipWrapper>
            ))}
          </div>

          {!isRunning ? (
            <TooltipWrapper title="Scan" description="Start scanning the target range.">
              <button
                type="button"
                onClick={() => { if (targets.trim()) startScan(ctx); }}
                disabled={!targets.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-smooth hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              >
                <Play className="h-3 w-3" /> Scan
              </button>
            </TooltipWrapper>
          ) : (
            <TooltipWrapper title="Stop" description="Stop the current scan.">
              <button
                type="button"
                onClick={() => stopScan()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground transition-smooth hover:bg-destructive/90"
              >
                <Square className="h-3 w-3" /> Stop
              </button>
            </TooltipWrapper>
          )}
        </div>

        <button type="button" onClick={() => setCollapsed((c) => !c)} className="p-1 shrink-0">
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]", !collapsed && "rotate-180")} />
        </button>
      </div>

      {/* ── Expanded config body ── */}
      {!collapsed && (
        <div className="border-t border-border/35 px-4 py-4">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* Main controls */}
            <div className="xl:col-span-8 space-y-3">
              <div className="rounded-md border border-border/35 bg-background/25 p-3">
                <div className="flex items-center gap-1 mb-2">
                  <label className="text-xs font-medium text-muted-foreground">Target Range</label>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-3xs uppercase tracking-wider bg-primary/15 text-primary border border-primary/20">live</span>
                  <TooltipWrapper title="Target" description="CIDR notation (192.168.1.0/24), IP range (10.0.0.1-50), or comma-separated IPs.">
                    <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0" />
                  </TooltipWrapper>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 min-w-0">
                    <TargetCombobox
                      value={targets}
                      onChange={(v) => setTargets(v)}
                      onSelect={(cidr) => setTargets(cidr)}
                      disabled={isRunning}
                      onEnter={() => { if (targets.trim() && !isRunning) startScan(ctx); }}
                    />
                  </div>
                  <CidrPicker targets={targets} onSelect={(cidr) => setTargets(cidr)} disabled={isRunning} />
                </div>
              </div>

              {/* Advanced settings (collapsible) */}
              <div className="rounded-md border border-border/35 bg-background/25 p-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((a) => !a)}
                  className="flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-smooth"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-180")} />
                  Advanced Settings
                </button>
                {showAdvanced && (
                  <div className="mt-3 grid grid-cols-2 gap-3 max-w-[260px]">
                    <div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Timeout</label>
                        <TooltipWrapper title="Timeout (ms)" description="Adjust host response wait time for this scan. Increase for slower networks, decrease for faster scans.">
                          <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0" />
                        </TooltipWrapper>
                      </div>
                      <Input
                        type="number"
                        value={timeoutMs}
                        onChange={(e) => setTimeoutMs(parseInt(e.target.value, 10) || 2000)}
                        className="h-9 font-mono text-xs"
                        disabled={isRunning}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Parallel</label>
                        <TooltipWrapper title="Parallel Probes" description="Set scan concurrency. Higher values scan faster but use more network and CPU resources.">
                          <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0" />
                        </TooltipWrapper>
                      </div>
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        value={concurrency}
                        onChange={(e) => setConcurrency(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 20)))}
                        className="h-9 font-mono text-xs"
                        disabled={isRunning}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right rail summary */}
            <div className="xl:col-span-4">
              <div className="rounded-md border border-border/35 bg-background/25 p-3 space-y-3">
                <p className="text-2xs uppercase tracking-wider text-muted-foreground">Active Profile</p>
                <div>
                  <p className="text-sm font-semibold text-primary">{activeMode.label}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5">{activeMode.description}</p>
                  <p className="text-2xs text-muted-foreground mt-2">
                    Enrichment profile:{" "}
                    <span className="text-foreground capitalize font-medium">{enrichmentPreset}</span>
                    {" "}(
                    {ENRICHMENT_PRESET_OPTIONS.find((o) => o.value === enrichmentPreset)?.description ?? "Custom profile"}
                    )
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-card/40 border border-border/35 px-2.5 py-2">
                    <p className="text-2xs text-muted-foreground uppercase tracking-wider">Timeout</p>
                    <p className="font-mono tabular-nums mt-0.5">{timeoutMs} ms</p>
                  </div>
                  <div className="rounded-md bg-card/40 border border-border/35 px-2.5 py-2">
                    <p className="text-2xs text-muted-foreground uppercase tracking-wider">Parallel</p>
                    <p className="font-mono tabular-nums mt-0.5">{concurrency}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {isRunning && (
        <div className="border-t border-border/35 bg-muted/15 px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {phaseLabel ?? "Scanning..."}
            </span>
            <span className="text-xs font-medium tabular-nums">{probed} / {totalProbes}</span>
          </div>
          <Progress value={totalProbes > 0 ? (probed / totalProbes) * 100 : 0} className="h-1.5" />
          {phaseTotal > 0 && (
            <div className="mt-2 text-2xs text-muted-foreground tabular-nums">
              Phase: {phaseProbed} / {phaseTotal}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Discovery method badge ───────────────────────────────────────

function DiscoveryBadge({ method }: { method: string }) {
  const colors: Record<string, string> = { arp: "bg-success/20 text-success", sip: "bg-primary/20 text-primary", both: "bg-info/20 text-info" };
  const labels: Record<string, string> = { arp: "ARP", sip: "Probe", both: "Both" };
  return (
    <span className={cn("inline-flex px-1.5 py-0.5 rounded-full text-2xs font-medium", colors[method] ?? "bg-muted text-muted-foreground")}>
      {labels[method] ?? method.toUpperCase()}
    </span>
  );
}

function formatDeviceType(type: DiscoveredDevice["fingerprint"]["device_type"]): string {
  switch (type) {
    case "pbx":
      return "PBX";
    case "sbc":
      return "SBC";
    case "accesspoint":
      return "Access Point";
    case "nas":
      return "NAS";
    case "iot":
      return "IoT";
    default:
      return type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : "Unknown";
  }
}

const ipSortingFn: SortingFn<DiscoveredDevice> = (rowA, rowB, columnId) =>
  String(rowA.getValue(columnId)).localeCompare(String(rowB.getValue(columnId)), undefined, { numeric: true });

const GRID_COLS = "minmax(100px,1.2fr) minmax(80px,1fr) minmax(110px,1fr) minmax(90px,1fr) minmax(70px,0.7fr) 50px 50px";

function useCopyAction() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }, []);
  return { copiedKey, copy };
}

// ── Results Table ────────────────────────────────────────────────

function ResultsTable() {
  const getFilteredDevices = useNetworkDevicesStore((s) => s.getFilteredDevices);
  const getDeviceLabel = useNetworkDevicesStore((s) => s.getDeviceLabel);
  const setDeviceLabel = useNetworkDevicesStore((s) => s.setDeviceLabel);
  const diffSummary = useNetworkDevicesStore((s) => s.diffSummary);
  const offlineDevices = useNetworkDevicesStore((s) => s.offlineDevices);
  const showOfflineOnMap = useNetworkDevicesStore((s) => s.showOfflineOnMap);
  const lastSource = useNetworkDevicesStore((s) => s.lastSource);
  const expandedDeviceId = useNetworkDevicesStore((s) => s.expandedDeviceId);
  const setExpandedDevice = useNetworkDevicesStore((s) => s.setExpandedDevice);
  const showOnMap = useNetworkDevicesStore((s) => s.showOnMap);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const devices = useNetworkDevicesStore((s) => s.devices);
  const filter = useNetworkDevicesStore((s) => s.filter);
  const clearResults = useNetworkDevicesStore((s) => s.clearResults);
  const agentName =
    lastSource?.source === "remote"
      ? resolvedAgentName("deviceScan") ?? undefined
      : undefined;

  const [showExport, setShowExport] = useState(false);
  const [showOffline, setShowOffline] = useState(false);

  const filtered = useMemo(() => getFilteredDevices(), [devices, filter, getFilteredDevices]);
  const columns = useMemo<ColumnDef<DiscoveredDevice, unknown>[]>(() => [
    {
      id: "ip",
      accessorKey: "ip",
      sortingFn: ipSortingFn,
      enableHiding: false,
    },
    {
      id: "hostname",
      accessorFn: (row) => row.hostname ?? "",
    },
    {
      id: "mac_address",
      accessorFn: (row) => row.mac_address ?? "",
    },
    {
      id: "oui_vendor",
      accessorFn: (row) => row.oui_vendor ?? (row.fingerprint.vendor ?? ""),
    },
    {
      id: "services",
      accessorFn: (row) => row.open_ports.length,
    },
    {
      id: "rtt_ms",
      accessorFn: (row) => row.rtt_ms ?? Number.MAX_SAFE_INTEGER,
    },
    {
      id: "discovery_method",
      accessorKey: "discovery_method",
    },
  ], []);

  const { table } = useUnifiedTable<DiscoveredDevice>({
    data: filtered,
    columns,
    initialSorting: [{ id: "ip", desc: false }],
    getRowId: (row) => `${row.ip}:${row.port || 0}`,
  });
  const rows = table.getRowModel().rows;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const device = rows[index]?.original;
      if (!device) return 36;
      return expandedDeviceId === `${device.ip}:${device.port || 0}` ? 420 : 36;
    },
    overscan: 10,
  });

  useEffect(() => { virtualizer.measure(); }, [expandedDeviceId, virtualizer]);

  const SortHeader = ({ field, label, className: cls }: { field: string; label: string; className?: string }) => {
    const column = table.getColumn(field);
    const sortDir = column?.getIsSorted();
    return (
      <button type="button" onClick={() => column?.toggleSorting(sortDir === "asc")}
      className={cn("flex items-center gap-1 text-2xs font-medium text-muted-foreground hover:text-foreground transition-smooth select-none", cls)}>
      {label}
      {sortDir && <span className="text-foreground">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    );
  };

  const handleRowClick = (device: DiscoveredDevice) => {
    const id = `${device.ip}:${device.port || 0}`;
    setExpandedDevice(expandedDeviceId === id ? null : id);
  };

  if (devices.length === 0) return null;

  return (
    <div className="ui-surface-card overflow-hidden flex-1 flex flex-col min-h-0">
      <div className="p-4 space-y-3">
        <ScanFilterBar />
        <div className="flex items-center gap-2">
          {lastSource && (
            <ResultSourceBadge source={lastSource.source} agentName={agentName} />
          )}
          {diffSummary && (
            <>
              <span className="inline-flex px-1.5 py-0.5 rounded-full text-2xs font-medium bg-success/15 text-success">New {diffSummary.newCount}</span>
              <span className="inline-flex px-1.5 py-0.5 rounded-full text-2xs font-medium bg-warning/15 text-warning">Changed {diffSummary.changedCount}</span>
              <span className="inline-flex px-1.5 py-0.5 rounded-full text-2xs font-medium bg-muted text-muted-foreground">Offline {diffSummary.offlineCount}</span>
            </>
          )}
          <Button variant="neutral" size="sm" className="h-7 px-2.5 text-xs gap-1.5" onClick={() => setShowExport(true)}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button variant="neutral" size="sm" className="h-7 px-2.5 text-xs gap-1.5" onClick={clearResults}>
            <Trash className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
        {offlineDevices.length > 0 && (
          <div className="rounded-md border border-border/35 bg-muted/20 overflow-hidden">
            <div className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium">Offline since baseline ({offlineDevices.length})</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-border/45 bg-card/40 px-1.5 py-0.5 text-3xs text-foreground hover:bg-accent/40 transition-smooth"
                  onClick={() => showOfflineOnMap()}
                >
                  <Network className="h-3 w-3" /> Show in Map
                </button>
                <button type="button" onClick={() => setShowOffline((v) => !v)} className="hover:text-foreground transition-smooth">
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showOffline && "rotate-180")} />
                </button>
              </div>
            </div>
            {showOffline && (
              <div className="border-t border-border/35 px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                {offlineDevices.map((d) => (
                  <div key={`${d.ip}:${d.port || 0}`} className="text-2xs text-muted-foreground font-mono">
                    {d.ip}{d.hostname ? ` · ${d.hostname}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t bg-muted/10 flex-1 flex flex-col min-h-0">
        {rows.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<Scan />}
            title="No devices match filters"
            description="Try adjusting your filter criteria."
            className="h-full min-h-0 p-6"
          />
        ) : (
          <>
            <div className="grid gap-2 px-4 py-2 text-2xs border-b bg-muted/30" style={{ gridTemplateColumns: GRID_COLS }}>
              <SortHeader field="ip" label="IP Address" />
              <SortHeader field="hostname" label="Hostname" />
              <SortHeader field="mac_address" label="MAC" />
              <SortHeader field="oui_vendor" label="Vendor" />
              <SortHeader field="services" label="Services" />
              <SortHeader field="rtt_ms" label="RTT" />
              <SortHeader field="discovery_method" label="Via" />
            </div>

            <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto">
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const device = row?.original;
                  if (!row || !device) return null;
                  const id = row.id;
                  const isExpanded = expandedDeviceId === id;
                  const portCount = device.open_ports.length;

                  return (
                    <div key={id} ref={virtualizer.measureElement} data-index={virtualRow.index}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}>
                      <button type="button" onClick={() => handleRowClick(device)}
                        className={cn("w-full grid gap-2 px-4 py-2 text-xs border-b border-border/40 hover:bg-accent/50 transition-smooth text-left group", isExpanded && "bg-accent border-l-2 border-l-primary")}
                        style={{ gridTemplateColumns: GRID_COLS }}>
                        <span className="truncate"><IpAddress ip={device.ip} size="sm" variant="mono" className="text-xs" /></span>
                        <span className="truncate text-muted-foreground">{resolveHostnameDisplay(device, getDeviceLabel(device))}</span>
                        <span className="font-mono truncate text-muted-foreground text-2xs">{device.mac_address ?? "—"}</span>
                        <span className="truncate">{device.oui_vendor ?? (device.fingerprint.vendor || "—")}</span>
                        <span>
                          {portCount > 0 ? (
                            <span className="inline-flex px-1.5 py-0.5 rounded-full text-2xs font-medium bg-success/15 text-success">{portCount} open</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </span>
                        <span className="font-mono tabular-nums text-muted-foreground">{device.rtt_ms != null ? `${device.rtt_ms.toFixed(0)}ms` : "—"}</span>
                        <DiscoveryBadge method={device.discovery_method} />
                      </button>

                      {isExpanded && (
                        <DeviceDetail
                          device={device}
                          label={getDeviceLabel(device)}
                          onSetLabel={(next) => setDeviceLabel(device, next)}
                          onShowOnMap={() => showOnMap(device.ip)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {showExport && <ExportDialog devices={getFilteredDevices()} onClose={() => setShowExport(false)} />}
    </div>
  );
}

// ── Expanded Device Detail ───────────────────────────────────────

function DeviceDetail({ device, label, onSetLabel, onShowOnMap }: { device: DiscoveredDevice; label: string | null; onSetLabel: (label: string) => void; onShowOnMap: () => void }) {
  const { copiedKey, copy } = useCopyAction();
  const hasSip = !!device.sip || !!device.user_agent;

  return (
    <div className="px-4 py-4 bg-muted/10 border-b border-border/40 space-y-4">
      {/* Network */}
      <div>
        <SectionLabel>Network</SectionLabel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-2">
          <DetailRow label="IP Address" value={device.ip} />
          <DetailRow label="Label" value={label?.trim() || "—"} />
          <DetailRow label="Device Type" value={formatDeviceType(device.fingerprint.device_type)} />
          <DetailRow label="Hostname" value={device.hostname?.trim() || "—"} />
          <DetailRow label="MAC Address" value={device.mac_address ?? "—"} />
          <DetailRow label="OUI Vendor" value={device.oui_vendor ?? "—"} />
          <DetailRow label="RTT" value={device.rtt_ms != null ? `${device.rtt_ms.toFixed(1)} ms` : "—"} />
          <DetailRow label="Discovery" value={device.discovery_method.toUpperCase()} />
        </div>
      </div>

      {/* Services */}
      {device.open_ports.length > 0 && (
        <div>
          <SectionLabel>Services ({device.open_ports.length} open port{device.open_ports.length !== 1 ? "s" : ""})</SectionLabel>
          <div className="mt-2 rounded-md border border-border/40 bg-card/40 overflow-hidden">
            <div className="surface-subtle grid grid-cols-[60px_60px_1fr_1fr] gap-2 px-3 py-1.5 text-2xs font-medium text-muted-foreground border-b">
              <span>Port</span><span>Proto</span><span>Service</span><span>Banner</span>
            </div>
            {device.open_ports.map((p) => (
              <div key={`${p.port}-${p.protocol}`} className="grid grid-cols-[60px_60px_1fr_1fr] gap-2 px-3 py-1.5 text-xs border-b border-border/30 last:border-b-0">
                <span className="font-mono tabular-nums text-foreground">{p.port}</span>
                <span className="text-muted-foreground uppercase text-2xs">{p.protocol}</span>
                <span className="text-foreground">{p.service_name || "—"}</span>
                <TooltipWrapper content={p.banner || undefined}><span className="text-muted-foreground truncate font-mono text-2xs">{p.banner || "—"}</span></TooltipWrapper>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SIP (only when relevant) */}
      {hasSip && (
        <div>
          <SectionLabel>SIP</SectionLabel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-2">
            {device.sip ? (
              <>
                <DetailRow label="Port" value={`${device.sip.port}/${device.sip.transport}`} />
                <DetailRow label="Status" value={String(device.sip.status_code)} />
                <DetailRow label="User-Agent" value={device.sip.user_agent} />
                <DetailRow label="Server" value={device.sip.server_header} />
                <DetailRow label="Allow" value={device.sip.allow_header} />
                <DetailRow label="Contact" value={device.sip.contact_header} />
              </>
            ) : (
              <>
                {device.user_agent && <DetailRow label="User-Agent" value={device.user_agent} />}
                {device.server_header && <DetailRow label="Server" value={device.server_header} />}
              </>
            )}
          </div>
          {(device.sip?.raw_response || (!device.sip && device.raw_response)) && (
            <pre className="mt-3 text-2xs font-mono text-muted-foreground bg-card/40 rounded-md border border-border/40 p-3 max-h-48 overflow-auto whitespace-pre-wrap break-all">
              {device.sip?.raw_response || device.raw_response}
            </pre>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-border/20 flex-wrap">
        {device.mac_address && <WolButton mac={device.mac_address} />}
        <ActionButton
          icon={copiedKey === "ip" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          label={copiedKey === "ip" ? "Copied!" : "Copy IP"}
          onClick={() => copy("ip", device.ip)}
        />
        <ActionButton
          icon={<Network className="h-3.5 w-3.5" />}
          label="Set Label"
          onClick={() => {
            const next = window.prompt("Remembered device label", label ?? device.hostname ?? device.ip);
            if (next && next.trim()) onSetLabel(next.trim());
          }}
        />
        {device.mac_address && (
          <ActionButton
            icon={copiedKey === "mac" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            label={copiedKey === "mac" ? "Copied!" : "Copy MAC"}
            onClick={() => copy("mac", device.mac_address!)}
          />
        )}
        <TooltipWrapper title="Show on Map" description="Switch to the Map tab and highlight this device.">
          <button type="button" onClick={(e) => { e.stopPropagation(); onShowOnMap(); }}
            className="ui-control-shell inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth">
            <Network className="h-3.5 w-3.5" /> Show on Map
          </button>
        </TooltipWrapper>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>;
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <TooltipWrapper title={label}>
      <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="ui-control-shell inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth">
        {icon} {label}
      </button>
    </TooltipWrapper>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value || value === "—") {
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-muted-foreground w-20 shrink-0 font-medium">{label}</span>
        <span className="text-muted-foreground/60">—</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-muted-foreground w-20 shrink-0 font-medium">{label}</span>
      <span className="font-mono break-all flex-1">{value}</span>
    </div>
  );
}

function resolveHostnameDisplay(device: DiscoveredDevice, label: string | null): string {
  const cleanLabel = (label ?? "").trim();
  if (cleanLabel) return cleanLabel;
  const cleanHostname = (device.hostname ?? "").trim();
  return cleanHostname || "—";
}

// ── Scanner View (main export) ───────────────────────────────────

export function ScannerView() {
  const status = useNetworkDevicesStore((s) => s.status);
  const error = useNetworkDevicesStore((s) => s.error);
  const devices = useNetworkDevicesStore((s) => s.devices);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <ConfigPanel />

      {error && status === "error" && (
        <div className="rounded-md border border-destructive/35 bg-destructive/8 p-4 text-sm text-destructive">{error}</div>
      )}

      {devices.length === 0 && status !== "running" && status !== "error" && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <EmptyState
            variant="inline"
            icon={<Wifi />}
            title="No scan results"
            description="Configure targets above and click Scan to discover devices on your network."
            className="h-full min-h-0 p-6"
          />
        </div>
      )}

      <ResultsTable />
    </div>
  );
}
