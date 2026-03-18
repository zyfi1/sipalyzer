import { useEffect } from "react";
import { useNetworkStore } from "@/stores/networkStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { WifiNone, RefreshCw } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import {
  resolveWifiQualityPct,
  wifiIconFromQualityPct,
  wifiLabelFromQualityPct,
  wifiToneClassFromQualityPct,
} from "@/lib/wifiSignal";

function signalLabel(pct: number): string {
  return wifiLabelFromQualityPct(pct);
}

function signalColor(pct: number): string {
  return wifiToneClassFromQualityPct(pct);
}

function arcColor(pct: number | null): string {
  const normalized = pct != null ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
  if (normalized >= 80) return "#22c55e";
  if (normalized >= 60) return "hsl(var(--primary))";
  if (normalized > 0) return "#eab308";
  return "#ef4444";
}

function WifiSignalArc({ pct }: { pct: number }) {
  const bars = 4;
  const normalized = Math.max(0, Math.min(100, Math.round(pct)));
  const active = normalized >= 80 ? 4 : normalized >= 60 ? 3 : normalized >= 40 ? 2 : normalized > 0 ? 1 : 0;
  const color = arcColor(pct);

  return (
    <svg viewBox="0 0 80 56" className="w-20 h-14" fill="none">
      {Array.from({ length: bars }, (_, i) => {
        const idx = bars - 1 - i;
        const r = 14 + idx * 11;
        const isActive = idx < active;
        return (
          <path
            key={i}
            d={`M ${40 - r * 0.85} ${48 - r * 0.52} A ${r} ${r} 0 0 1 ${40 + r * 0.85} ${48 - r * 0.52}`}
            stroke={isActive ? color : "currentColor"}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
            className={isActive ? "" : "text-muted-foreground/10"}
          />
        );
      })}
      <circle cx="40" cy="48" r="3.5" fill={color} />
    </svg>
  );
}

function interfaceKind(name: string, description: string): "Wi-Fi" | "Ethernet" | "VPN" | "Loopback" | "Other" {
  const raw = `${name} ${description}`.toLowerCase();
  if (raw.includes("loopback") || name.toLowerCase() === "lo") return "Loopback";
  if (raw.includes("utun") || raw.includes("vpn") || raw.includes("tunnel") || raw.includes("wireguard")) return "VPN";
  if (raw.includes("wi-fi") || raw.includes("wifi") || raw.includes("wlan") || raw.includes("airport")) return "Wi-Fi";
  if (raw.includes("ethernet") || raw.includes("en")) return "Ethernet";
  return "Other";
}

function kindTone(kind: ReturnType<typeof interfaceKind>) {
  switch (kind) {
    case "Wi-Fi":
      return "border-primary/30 bg-primary/10 text-primary/85";
    case "Ethernet":
      return "border-success/30 bg-success/10 text-success/85";
    case "VPN":
      return "border-warning/30 bg-warning/10 text-warning/85";
    case "Loopback":
      return "border-muted-foreground/25 bg-muted/15 text-muted-foreground/75";
    default:
      return "border-border/35 bg-background/30 text-foreground/75";
  }
}

function firstUsableAddress(addresses: string[] | undefined): string {
  if (!addresses?.length) return "No address";
  const nonLoopback = addresses.find((a) => !a.startsWith("127.") && a !== "::1");
  return nonLoopback ?? addresses[0] ?? "No address";
}

export function NetworkAtGlanceSection() {
  const localIp = useNetworkStore((s) => s.localIp);
  const interfaces = useNetworkStore((s) => s.interfaces);
  const refreshNetwork = useNetworkStore((s) => s.refresh);
  const wifi = useNetworkTestStore((s) => s.wifi);
  const fetchWifi = useNetworkTestStore((s) => s.fetchWifi);

  useEffect(() => {
    refreshNetwork();
    fetchWifi();
  }, [refreshNetwork, fetchWifi]);

  const wifiInfo = wifi.result;
  const wifiLoading = wifi.status === "running";
  const signalPct = resolveWifiQualityPct(wifiInfo?.signal_quality_pct, wifiInfo?.rssi_dbm);
  const WifiQualityIcon = wifiIconFromQualityPct(signalPct);

  const handleRefresh = () => {
    refreshNetwork();
    fetchWifi(true);
  };

  const hasWifi = signalPct !== null && wifiInfo?.success !== false;
  const visibleInterfaces = interfaces
    .slice()
    .sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)))
    .slice(0, 6);

  return (
    <div className="surface relative flex flex-col h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-primary/[0.08] via-primary/[0.03] to-transparent" />
      {/* Wi-Fi signal hero */}
      {hasWifi ? (
        <div className="relative px-5 pt-3.5 pb-2.5 shrink-0">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-primary/12">
                <WifiQualityIcon className="h-3.5 w-3.5 text-primary/80" />
              </div>
              <span className="text-3xs font-medium text-muted-foreground/50 uppercase tracking-wider">Wi-Fi</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-foreground/70"
              onClick={handleRefresh}
            >
              <RefreshCw className="h-2.5 w-2.5" />
            </Button>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/35 bg-background/25 px-2.5 py-2 backdrop-blur-[1px]">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-full blur-xl opacity-25" style={{ backgroundColor: arcColor(signalPct) }} />
              <WifiSignalArc pct={signalPct} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-semibold text-foreground/90 truncate">{wifiInfo?.ssid ?? "Wi-Fi"}</p>
                <span className={cn(
                  "text-3xs px-1.5 py-0.5 rounded-full border shrink-0",
                  signalPct >= 80
                    ? "bg-success/12 border-success/35 text-success/85"
                    : signalPct >= 60
                    ? "bg-primary/12 border-primary/35 text-primary/85"
                    : signalPct > 0
                    ? "bg-warning/12 border-warning/35 text-warning/85"
                    : "bg-destructive/12 border-destructive/35 text-destructive/85",
                )}>
                  {signalLabel(signalPct)}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className={cn("text-2xl font-bold tabular-nums leading-none", signalColor(signalPct))}>
                  {signalPct}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(0, signalPct)}%`, backgroundColor: arcColor(signalPct) }}
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {wifiInfo?.rssi_dbm != null && (
                  <span className="rounded-md border border-border/35 bg-background/30 px-1.5 py-0.5 text-3xs text-muted-foreground/60 tabular-nums">{wifiInfo.rssi_dbm} dBm</span>
                )}
                {wifiInfo?.channel != null && (
                  <span className="rounded-md border border-border/35 bg-background/30 px-1.5 py-0.5 text-3xs text-muted-foreground/60">Ch {wifiInfo.channel}</span>
                )}
                {wifiInfo?.tx_rate_mbps != null && (
                  <span className="rounded-md border border-border/35 bg-background/30 px-1.5 py-0.5 text-3xs text-muted-foreground/60 tabular-nums">{wifiInfo.tx_rate_mbps} Mbps</span>
                )}
                {wifiInfo?.security && (
                  <span className="rounded-md border border-border/35 bg-background/30 px-1.5 py-0.5 text-3xs text-muted-foreground/60">{wifiInfo.security}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-5 pt-4 pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-primary/12">
                <WifiNone className="h-3.5 w-3.5 text-primary/80" />
              </div>
              <span className="text-3xs font-medium text-muted-foreground/50 uppercase tracking-wider">Network</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-foreground/70"
              onClick={handleRefresh}
            >
              <RefreshCw className={cn("h-2.5 w-2.5", wifiLoading && "animate-spin")} />
            </Button>
          </div>
          <div className="flex flex-col items-center justify-center py-4">
            {wifiLoading ? (
              <>
                <RefreshCw className="h-6 w-6 text-muted-foreground/20 mb-1.5 animate-spin" />
                <p className="text-xs text-muted-foreground/35">Detecting Wi-Fi…</p>
              </>
            ) : (
              <EmptyState
                compact
                variant="inline"
                icon={<WifiNone />}
                title="No Wi-Fi connected"
                className="py-1"
              />
            )}
          </div>
        </div>
      )}

      {/* Details */}
      <div className="border-t border-border/30 px-5 py-2.5 flex-1 min-h-0 overflow-y-auto space-y-2 bg-gradient-to-b from-background/10 to-transparent">
        {localIp && (
          <div className="rounded-lg border border-border/30 bg-background/25 px-2.5 py-1.5 flex items-center justify-between">
            <span className="text-3xs text-muted-foreground/55">Local IP</span>
            <span className="text-xs font-medium text-foreground/75 tabular-nums">{localIp}</span>
          </div>
        )}

        {visibleInterfaces.length > 0 && (
          <div className="space-y-1">
            <span className="text-3xs text-muted-foreground/35 uppercase tracking-wider font-medium">
              Adapters
            </span>
            <div className="grid grid-cols-1 gap-1">
              {visibleInterfaces.map((iface) => {
                const kind = interfaceKind(iface.name, iface.description);
                const address = firstUsableAddress(iface.addresses);
                return (
                  <div
                    key={`${iface.name}-${address}`}
                    className="rounded-md border border-border/20 bg-background/20 px-2.5 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", iface.isDefault ? "bg-primary" : "bg-muted-foreground/40")} />
                        <span className="text-3xs text-foreground/65 truncate">{iface.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {iface.isDefault && (
                          <span className="text-[10px] px-1 py-0.5 rounded border border-primary/35 bg-primary/12 text-primary/85 uppercase tracking-wide">
                            Default
                          </span>
                        )}
                        <span className={cn("text-[10px] px-1 py-0.5 rounded border", kindTone(kind))}>
                          {kind}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-3xs text-muted-foreground/45 tabular-nums truncate">{address}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
