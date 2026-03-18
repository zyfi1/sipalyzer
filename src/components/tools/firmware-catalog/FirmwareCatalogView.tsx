import { useCallback, useEffect, useMemo, useState } from "react";
import { useFirmwareCatalogStore } from "@/stores/firmwareCatalogStore";
import type { FirmwareEntry, FirmwareCacheEntry } from "@/api/tools";
import type { DownloadState } from "@/stores/firmwareCatalogStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HardDrive,
  Download,
  Play,
  Trash,
  MagnifyingGlass,
  Check,
  StopIcon,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Info,
  Globe,
} from "@/lib/icons";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const TOOL_ID = "toolsFirmware";

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function cmpVer(a: string, b: string): number {
  const ap = a.split(".").map(Number);
  const bp = b.split(".").map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const d = (bp[i] ?? 0) - (ap[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/* ── Device Setup Guide ────────────────────────────────────────────── */

function ConfigRow({ label, value, mono, copy }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1 border-b border-border/20 last:border-b-0">
      <span className="text-2xs text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={cn("text-2xs flex-1 min-w-0 truncate select-all", mono ? "font-mono text-primary font-semibold" : "font-medium")}>{value}</span>
      {copy && <CopyTextButton text={value} />}
    </div>
  );
}

function DeviceSetupGuide({ baseUrl, remote, entryIds, catalog, cache, onStop }: {
  baseUrl: string;
  remote: boolean;
  entryIds: string[];
  catalog: FirmwareEntry[];
  cache: Map<string, FirmwareCacheEntry>;
  onStop: () => void;
}) {
  const [showGuide, setShowGuide] = useState(false);

  const servedEntries = useMemo(() => catalog.filter((e) => entryIds.includes(e.id)), [catalog, entryIds]);

  const servedVendors = useMemo(() => {
    const v = new Set(servedEntries.map((e) => e.vendor));
    return { poly: v.has("poly"), yealink: v.has("yealink") };
  }, [servedEntries]);

  const servedFiles = useMemo(() => {
    const all: string[] = [];
    for (const e of servedEntries) {
      const ce = cache.get(e.id);
      if (ce) all.push(...ce.files);
    }
    return all;
  }, [servedEntries, cache]);

  const yealinkRomFiles = useMemo(() => servedFiles.filter((f) => f.toLowerCase().endsWith(".rom")), [servedFiles]);
  const polyLdFiles = useMemo(() => servedFiles.filter((f) => f.toLowerCase().endsWith(".sip.ld") || f.toLowerCase().endsWith(".ld")), [servedFiles]);
  const polyCfgFiles = useMemo(() => servedFiles.filter((f) => f.toLowerCase().endsWith(".cfg")), [servedFiles]);

  const trailing = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const { port, hostPort } = (() => {
    try {
      const u = new URL(baseUrl);
      return {
        port: u.port || "8069",
        hostPort: `${u.hostname}:${u.port || "8069"}`,
      };
    } catch {
      const cleaned = baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      return { port: "8069", hostPort: cleaned };
    }
  })();
  const showPoly = servedVendors.poly || !servedVendors.yealink;
  const showYealink = servedVendors.yealink || !servedVendors.poly;

  return (
    <div className="rounded-md surface shrink-0 animate-panel-enter overflow-hidden border-l-2 border-success">
      <div className="px-4 py-2.5 flex items-center gap-3">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
        </span>
        <span className="text-xs font-medium text-success">Serving{remote ? " (Remote)" : ""}</span>
        <code className="text-xs font-mono bg-muted/20 px-2 py-0.5 rounded-lg">{baseUrl}</code>
        <CopyTextButton text={baseUrl} />
        {servedEntries.map((e) => (
          <Badge key={e.id} variant="outline" className="text-2xs py-0">{e.series} v{e.version}</Badge>
        ))}
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-smooth"
          onClick={() => setShowGuide(!showGuide)}
        >
          <Info className="h-3 w-3" />
          Setup
          {showGuide ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <span className="w-px h-4 bg-border/20" />
        <Button size="sm" variant="destructive" className="h-6 text-2xs px-2 gap-1" onClick={onStop}>
          <StopIcon className="h-3 w-3" />Stop
        </Button>
      </div>

      {showGuide && (
        <div className="px-4 pb-3 border-t border-border/20 pt-2.5 space-y-2.5">
          <div className={cn("grid gap-2.5", showPoly && showYealink ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 max-w-xl")}>
            {showPoly && (
              <div className="rounded-lg surface overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 bg-muted/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="text-xs font-semibold text-foreground">Poly VVX</span>
                  <Badge variant="outline" className="text-2xs py-0 px-1.5">UCS 5.x / 6.x</Badge>
                  <span className="text-2xs text-muted-foreground ml-auto">pw: 456</span>
                </div>
                <div className="p-2.5 space-y-2">
                  <div className="bg-muted/10 rounded-lg border border-border/20 px-3 py-1.5">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-2xs font-semibold text-foreground">Settings</span>
                      <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/60" />
                      <span className="text-2xs font-semibold text-primary">Provisioning Server</span>
                    </div>
                    <ConfigRow label="Server Type" value="HTTP" />
                    <ConfigRow label="Server Address" value={hostPort} mono copy />
                  </div>
                  <p className="text-2xs text-muted-foreground/70 leading-relaxed">
                    Recommended VVX format: <span className="font-medium text-foreground">Server Type = HTTP</span> and
                    <span className="font-medium text-foreground"> Server Address = {hostPort}</span> (no scheme). Then save and reboot.
                    VVX needs both firmware <code className="font-mono text-2xs">.ld</code> and config <code className="font-mono text-2xs">.cfg</code> files available on the server root.
                  </p>
                  {polyLdFiles.length > 0 && (
                    <div className="bg-muted/10 rounded-lg border border-border/20 px-3 py-1.5">
                      <div className="text-2xs font-semibold text-foreground mb-1">Software Upgrade (direct URL)</div>
                      {polyLdFiles.slice(0, 4).map((f, i) => (
                        <ConfigRow key={f} label={`Firmware ${i + 1}`} value={`${trailing}${f}`} mono copy />
                      ))}
                      {polyLdFiles.length > 4 && (
                        <p className="text-2xs text-muted-foreground/70 pt-1">Showing first 4 firmware URLs. Use provisioning method for full model coverage.</p>
                      )}
                      <p className="text-2xs text-muted-foreground/70 pt-1">
                        In VVX Software Upgrade, use the full URL (with <code className="font-mono">http://</code>) for your model file.
                      </p>
                    </div>
                  )}
                  {polyLdFiles.length === 0 || polyCfgFiles.length === 0 ? (
                    <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5">
                      <p className="text-2xs text-warning">
                        Poly package incomplete for provisioning: detected {polyLdFiles.length} .ld and {polyCfgFiles.length} .cfg files. Re-download this firmware entry before serving.
                      </p>
                    </div>
                  ) : null}
                  {polyLdFiles.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-2xs text-muted-foreground shrink-0 pt-0.5">{polyLdFiles.length} files:</span>
                      <div className="flex flex-wrap gap-1">
                        {polyLdFiles.map((f) => (
                          <code key={f} className="text-2xs font-mono bg-muted/10 px-1.5 py-px rounded-lg text-muted-foreground">{f}</code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {showYealink && (
              <div className="rounded-lg surface overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 bg-muted/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-success" />
                  <span className="text-xs font-semibold text-foreground">Yealink</span>
                  <Badge variant="outline" className="text-2xs py-0 px-1.5">T2/T3/T4/T5</Badge>
                  <span className="text-2xs text-muted-foreground ml-auto">pw: admin</span>
                </div>
                <div className="p-2.5 space-y-2">
                  <div className="bg-muted/10 rounded-lg border border-border/20 px-3 py-1.5">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-2xs font-semibold text-foreground">Settings</span>
                      <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/60" />
                      <span className="text-2xs font-semibold text-primary">Upgrade</span>
                    </div>
                    {yealinkRomFiles.length > 0 ? (
                      yealinkRomFiles.map((f) => (
                        <ConfigRow key={f} label={f.replace(".rom", "")} value={`${trailing}${f}`} mono copy />
                      ))
                    ) : (
                      <ConfigRow label="Firmware URL" value={`${trailing}<model>.rom`} mono copy />
                    )}
                  </div>
                  <p className="text-2xs text-muted-foreground/70 leading-relaxed">
                    Full ROM URL per model → click <span className="font-medium text-foreground">Upgrade</span>. Reboots in ~5 min.
                    Alt: <span className="font-medium text-foreground">Settings → Auto Provision</span> → Server URL: <code className="font-mono text-2xs">{trailing}</code>
                  </p>
                  {yealinkRomFiles.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-2xs text-muted-foreground shrink-0 pt-0.5">{yealinkRomFiles.length} files:</span>
                      <div className="flex flex-wrap gap-1">
                        {yealinkRomFiles.map((f) => (
                          <code key={f} className="text-2xs font-mono bg-muted/10 px-1.5 py-px rounded-lg text-muted-foreground">{f}</code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 px-1">
            <Globe className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            <p className="text-2xs text-muted-foreground/60">
              Phones must reach <code className="font-mono">{baseUrl}</code> on the same network. Firewall: allow TCP port {port}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Series Row ────────────────────────────────────────────────────── */

interface SeriesGroup {
  key: string;
  vendor: string;
  series: string;
  models: string;
  entries: FirmwareEntry[];
}

function SeriesRow({ group, downloads, cache, remotePaths, isRemote, onDownload, onServe, onDelete }: {
  group: SeriesGroup;
  downloads: Map<string, DownloadState>;
  cache: Map<string, FirmwareCacheEntry>;
  remotePaths: Map<string, string>;
  isRemote: boolean;
  onDownload: (e: FirmwareEntry) => void;
  onServe: (e: FirmwareEntry) => void;
  onDelete: (e: FirmwareEntry) => void;
}) {
  const [selectedId, setSelectedId] = useState(group.entries[0]!.id);

  const entry = group.entries.find((e) => e.id === selectedId) ?? group.entries[0]!;
  const dl = downloads.get(entry.id);
  const isCached = isRemote ? remotePaths.has(entry.id) : cache.has(entry.id);
  const isReady = isCached || dl?.status === "done";
  const isDl = dl?.status === "downloading";
  const isExtracting = dl?.status === "extracting";
  const isBusy = isDl || isExtracting;
  const isErr = dl?.status === "error";
  const ce = cache.get(entry.id);

  const cachedForGroup = (id: string) => isRemote ? remotePaths.has(id) : cache.has(id);
  const readyCount = group.entries.filter((e) => cachedForGroup(e.id) || downloads.get(e.id)?.status === "done").length;

  return (
    <div className={cn(
      "transition-smooth hover:bg-muted/10",
      isReady && "bg-success/10",
      isErr && "bg-destructive/10",
    )}>
      <div className="px-4 py-3 flex items-center gap-4">
        {/* Identity */}
        <div className="flex items-center gap-2.5 w-56 shrink-0 min-w-0">
          <div className={cn("w-2 h-2 rounded-full shrink-0", group.vendor === "yealink" ? "bg-success" : "bg-primary")} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground whitespace-nowrap">
                {group.vendor === "yealink" ? "Yealink" : "Poly"} {group.series}
              </span>
              {readyCount > 0 && (
                <Badge variant="outline" className="text-2xs text-success py-0 px-1 gap-0.5 shrink-0">
                  <Check className="h-2.5 w-2.5" />{readyCount}
                </Badge>
              )}
            </div>
            <p className="text-2xs text-muted-foreground truncate leading-snug mt-0.5">{group.models}</p>
          </div>
        </div>

        {/* Version dropdown */}
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger size="sm" className="w-44 h-7 text-xs font-mono tabular-nums shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-64">
            {group.entries.map((e, i) => {
              const eCached = cachedForGroup(e.id);
              const eDl = downloads.get(e.id);
              const eReady = eCached || eDl?.status === "done";
              return (
                <TooltipWrapper
                  key={e.id}
                  title={e.notes || `v${e.version}`}
                  description={e.notes ? `${formatBytes(e.size_bytes)}` : undefined}
                  side="right"
                >
                  <SelectItem value={e.id}>
                    <span className="flex items-center gap-2 w-full">
                      {eReady && <Check className="h-3 w-3 text-success shrink-0" />}
                      <span className="font-mono tabular-nums">v{e.version}</span>
                      {i === 0 && <span className="text-2xs text-success font-medium">latest</span>}
                      <span className="text-2xs text-muted-foreground ml-auto tabular-nums">{e.size_bytes > 0 ? formatBytes(e.size_bytes) : ""}</span>
                    </span>
                  </SelectItem>
                </TooltipWrapper>
              );
            })}
          </SelectContent>
        </Select>

        {/* Size */}
        <div className="w-20 shrink-0 text-right">
          <span className="text-2xs text-muted-foreground tabular-nums">
            {entry.size_bytes > 0 ? formatBytes(entry.size_bytes) : "—"}
          </span>
        </div>

        {/* Notes */}
        <div className="flex-1 min-w-0">
          {entry.notes ? (
            <TooltipWrapper title={entry.notes}>
              <p className="text-2xs text-muted-foreground/70 truncate cursor-help">{entry.notes}</p>
            </TooltipWrapper>
          ) : (
            <span className="text-2xs text-muted-foreground/60">—</span>
          )}
        </div>

        {/* Status + Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isBusy && dl ? (
            <div className="flex items-center gap-2.5 w-52">
              <span className="text-2xs tabular-nums font-medium text-muted-foreground shrink-0 w-20 text-right">
                {isExtracting
                  ? `${Math.round(dl.progress)}%${dl.filesExtracted > 0 ? ` · ${dl.filesExtracted}` : ""}`
                  : `${Math.round(dl.progress)}%`
                }
              </span>
              <Progress
                value={dl.progress}
                className={cn("h-1.5 flex-1", isExtracting && "[&>div]:bg-warning bg-warning/20")}
              />
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="animate-live-ripple motion-reduce:animate-none absolute h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
            </div>
          ) : isReady ? (
            <>
              <Badge variant="outline" className="text-2xs text-success py-0 px-1.5 gap-0.5">
                <Check className="h-2.5 w-2.5" />Cached
              </Badge>
              <Button size="sm" variant="positive" className="h-7 text-2xs px-2.5 gap-1 active:scale-[0.97]" onClick={() => onServe(entry)}>
                <Play className="h-3 w-3" />Serve
              </Button>
              {!isRemote && (
                <TooltipWrapper title="Remove from cache">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 w-7 p-0 text-muted-foreground active:scale-[0.97]"
                    onClick={() => onDelete(entry)}
                  >
                    <Trash className="h-3 w-3" />
                  </Button>
                </TooltipWrapper>
              )}
            </>
          ) : isErr ? (
            <>
              <TooltipWrapper title={dl?.error ?? "Download failed"}>
                <Badge variant="outline" className="text-2xs text-destructive py-0 px-1.5 cursor-help">Error</Badge>
              </TooltipWrapper>
              <Button size="sm" variant="neutral" className="h-7 text-2xs px-2.5 gap-1 active:scale-[0.97]" onClick={() => onDownload(entry)}>
                <Download className="h-3 w-3" />Retry
              </Button>
            </>
          ) : (
            <Button size="sm" variant="neutral" className="h-7 text-2xs px-2.5 gap-1 active:scale-[0.97]" onClick={() => onDownload(entry)}>
              <Download className="h-3 w-3" />Download
            </Button>
          )}
        </div>
      </div>

      {isReady && !isRemote && ce && ce.files.length > 0 && (
        <div className="px-4 pb-2.5 -mt-1 ml-[26px]">
          <p className="text-2xs text-success/70">
            {ce.files.length} file{ce.files.length !== 1 ? "s" : ""} · {formatBytes(ce.size)} — {ce.files.slice(0, 4).join(", ")}{ce.files.length > 4 ? `, +${ce.files.length - 4} more` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Main View ─────────────────────────────────────────────────────── */

export function FirmwareCatalogView() {
  const store = useFirmwareCatalogStore();
  const {
    catalog, cache, downloads, serve, remotePaths, updateChecks,
    checkingUpdates, filter, loaded, cacheDir, loadCatalog, setFilter,
    setCacheDir, checkForUpdates, downloadFirmware, downloadFirmwareRemote,
    serveFirmware, serveFirmwareRemote, stopServing, clearCache,
  } = store;

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext(TOOL_ID);
  const isRemote = ctx.type === "remote";
  const sendCommand = useRemoteAgentStore((s) => s.sendCommand);
  const waitForCommand = useRemoteAgentStore((s) => s.waitForCommand);
  const agentId = isRemote && ctx.type === "remote" ? ctx.agentId : null;

  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [vendor, setVendor] = useState<"all" | "yealink" | "poly">("all");

  useEffect(() => { if (!loaded) loadCatalog(); }, [loaded, loadCatalog]);
  useEffect(() => {
    if (loaded && !updateChecks && !checkingUpdates) checkForUpdates();
  }, [loaded, updateChecks, checkingUpdates, checkForUpdates]);

  const filtered = useMemo(() => catalog.filter((e) => {
    if (vendor !== "all" && e.vendor !== vendor) return false;
    if (filter.search) {
      const s = filter.search.toLowerCase();
      if (!`${e.models} ${e.series} ${e.version} ${e.notes}`.toLowerCase().includes(s)) return false;
    }
    return true;
  }), [catalog, vendor, filter.search]);

  const groups = useMemo((): SeriesGroup[] => {
    const m: Record<string, FirmwareEntry[]> = {};
    for (const e of filtered) {
      const k = `${e.vendor}-${e.series}`;
      (m[k] ??= []).push(e);
    }
    for (const k of Object.keys(m)) m[k]!.sort((a, b) => cmpVer(a.version, b.version));
    return Object.entries(m).map(([k, entries]) => ({
      key: k,
      vendor: entries[0]!.vendor,
      series: entries[0]!.series,
      models: entries[0]!.models.split(",").map((s) => s.trim()).join(", "),
      entries,
    })).sort((a, b) => a.vendor.localeCompare(b.vendor) || a.series.localeCompare(b.series));
  }, [filtered]);

  const doDownload = useCallback(async (e: FirmwareEntry) => {
    if (isRemote && agentId) await downloadFirmwareRemote(e.id, agentId, sendCommand, waitForCommand);
    else await downloadFirmware(e.id);
  }, [isRemote, agentId, sendCommand, waitForCommand, downloadFirmware, downloadFirmwareRemote]);

  const doServe = useCallback(async (e: FirmwareEntry) => {
    if (isRemote && agentId) await serveFirmwareRemote(e.id, agentId, sendCommand, waitForCommand);
    else await serveFirmware(e.id);
  }, [isRemote, agentId, sendCommand, waitForCommand, serveFirmware, serveFirmwareRemote]);

  const doDelete = useCallback((e: FirmwareEntry) => {
    setDeleteTarget({ id: e.id, label: `${e.vendor === "yealink" ? "Yealink" : "Poly"} ${e.series} v${e.version}` });
  }, []);

  const pickCacheDir = useCallback(async () => {
    try {
      const result = await open({ directory: true, title: "Choose firmware download folder" });
      if (typeof result === "string") await setCacheDir(result);
    } catch { /* user cancelled */ }
  }, [setCacheDir]);

  const resetCacheDir = useCallback(() => setCacheDir(undefined), [setCacheDir]);

  const cachedCount = cache.size;
  const cachedSize = useMemo(() => { let t = 0; cache.forEach((v) => t += v.size); return t; }, [cache]);
  const totalVersions = filtered.length;
  const activeDl = useMemo(() => {
    let c = 0;
    downloads.forEach((d) => { if (d.status === "downloading" || d.status === "extracting") c++; });
    return c;
  }, [downloads]);

  if (!loaded) {
    return (
      <div className="flex flex-col flex-1 min-h-0 gap-3 pb-6">
        <div className="rounded-md surface p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-56 rounded-lg skeleton" />
            <div className="flex-1" />
            <div className="h-8 w-24 rounded-lg skeleton" />
          </div>
          <div className="flex items-center gap-4">
            <div className="h-9 flex-1 max-w-sm rounded-lg skeleton" />
            <div className="h-7 w-20 rounded-lg skeleton" />
            <div className="h-7 w-20 rounded-lg skeleton" />
          </div>
        </div>
        <div className="flex-1 min-h-0 rounded-md surface overflow-hidden">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-4 py-3.5 flex items-center gap-4 border-b border-border/20">
              <div className="w-2 h-2 rounded-full skeleton" />
              <div className="space-y-1.5 w-48">
                <div className="h-4 w-32 rounded-lg skeleton" />
                <div className="h-2.5 w-44 rounded-lg skeleton" />
              </div>
              <div className="h-7 w-44 rounded-lg skeleton" />
              <div className="flex-1" />
              <div className="h-7 w-20 rounded-lg skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3 pb-6">
      {/* Serve panel */}
      {serve && (
        <DeviceSetupGuide
          baseUrl={serve.httpUrl}
          remote={serve.remote}
          entryIds={serve.entryIds}
          catalog={catalog}
          cache={cache}
          onStop={() => stopServing(agentId, sendCommand)}
        />
      )}

      {/* Controls panel */}
      <div className="rounded-md surface shrink-0 animate-panel-enter overflow-hidden">
        {/* Row 1: Title area with vendor tabs + stats + sync */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-4">
          <HardDrive className="h-4 w-4 text-primary shrink-0" />
          <span className="section-title">Firmware Catalog</span>

          <div className="flex items-center bg-muted/20 rounded-lg p-0.5 shrink-0">
            {(["all", "yealink", "poly"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVendor(v)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth active:scale-[0.97]",
                  vendor === v ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "all" ? "All" : v === "yealink" ? "Yealink" : "Poly"}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Stats pills */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              <span className="font-semibold text-foreground">{groups.length}</span> series · <span className="font-semibold text-foreground">{totalVersions}</span> versions
            </span>

            {!isRemote && cachedCount > 0 && (
              <>
                <span className="w-px h-4 bg-border/20" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="font-semibold text-success">{cachedCount}</span> cached · {formatBytes(cachedSize)}
                </span>
                <Button size="sm" variant="destructive" className="h-7 text-2xs px-2 active:scale-[0.97]" onClick={() => setClearAllOpen(true)}>
                  Clear
                </Button>
              </>
            )}
            {isRemote && (
              <>
                <span className="w-px h-4 bg-border/20" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="font-semibold text-success">{remotePaths.size}</span> on agent
                </span>
              </>
            )}
            {activeDl > 0 && (
              <>
                <span className="w-px h-4 bg-border/20" />
                <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-live-ripple motion-reduce:animate-none absolute h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative rounded-full h-1.5 w-1.5 bg-primary" />
                  </span>
                  <span className="font-semibold text-primary">{activeDl}</span> active
                </span>
              </>
            )}
          </div>

          <span className="w-px h-4 bg-border/20" />

          <TooltipWrapper title="Check mirrors for new firmware versions">
            <Button size="sm" variant="neutral" className="h-8 text-xs px-3 gap-1.5 active:scale-[0.97]" disabled={checkingUpdates} onClick={checkForUpdates}>
              <RefreshCw className={cn("h-3.5 w-3.5", checkingUpdates && "animate-spin")} />
              Sync
            </Button>
          </TooltipWrapper>
        </div>

        {/* Row 2: Search + download location */}
        <div className="px-4 pb-4 flex items-center gap-4">
          <div className="flex-1 relative max-w-sm">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              placeholder="Search models, versions, notes..."
              value={filter.search}
              onChange={(e) => setFilter({ search: e.target.value })}
              className="h-8 text-sm pl-8 ui-control-shell"
            />
          </div>

          <div className="flex-1" />

          {!isRemote && (
            <div className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground shrink-0">Download to</span>
              <code className="text-xs font-mono text-foreground truncate min-w-0 max-w-xs">
                {cacheDir ?? "—"}
              </code>
              <Button size="sm" variant="neutral" className="h-7 text-2xs px-2 gap-1 shrink-0 active:scale-[0.97]" onClick={pickCacheDir}>
                Change
              </Button>
              <TooltipWrapper title="Reset to default app data directory">
                <Button size="sm" variant="neutral" className="h-7 text-2xs px-1.5 shrink-0 active:scale-[0.97]" onClick={resetCacheDir}>
                  Reset
                </Button>
              </TooltipWrapper>
            </div>
          )}
        </div>
      </div>

      {/* Firmware list */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-md surface overflow-hidden animate-panel-enter">
        {groups.length === 0 ? (
          <div className="py-16">
            <EmptyState
              variant="inline"
              compact
              icon={<HardDrive className="h-5 w-5" />}
              title="No firmware found"
              description={filter.search || vendor !== "all" ? "Adjust your search or filter" : "Catalog is empty"}
            />
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {groups.map((g) => (
              <SeriesRow
                key={g.key}
                group={g}
                downloads={downloads}
                cache={cache}
                remotePaths={remotePaths}
                isRemote={isRemote}
                onDownload={doDownload}
                onServe={doServe}
                onDelete={doDelete}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        title="Clear Firmware Cache"
        description="Delete all downloaded firmware files from the local cache. You will need to re-download them to serve again."
        variant="destructive"
        confirmText="Clear All"
        open={clearAllOpen}
        onOpenChange={setClearAllOpen}
        onConfirm={() => clearCache()}
      />

      <ConfirmDialog
        title="Delete Cached Firmware"
        description={`Remove ${deleteTarget?.label ?? "this firmware"} from the local cache? The extracted files will be permanently deleted.`}
        variant="destructive"
        confirmText="Delete"
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => { if (deleteTarget) clearCache(deleteTarget.id); setDeleteTarget(null); }}
      />
    </div>
  );
}
