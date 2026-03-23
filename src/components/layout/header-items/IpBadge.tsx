import { useEffect, useRef, useState } from "react";
import { Map, Marker } from "pigeon-maps";
import { Globe, GlobeLock, MapPin, Network } from "@/lib/icons";
import { useNetworkStore } from "@/stores/networkStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { cleanAddress } from "@/lib/networkUtils";
import { cn } from "@/lib/utils";
import { dnsGeoIp } from "@/api/dns";
import type { GeoIpResult } from "@/types/dns";
import {
  resolveWifiQualityPct,
  wifiIconFromQualityPct,
  wifiLabelFromQualityPct,
  wifiToneClassFromQualityPct,
} from "@/lib/wifiSignal";

type LinkKind = "wifi" | "ethernet" | "vpn";
type GeoStatus = "idle" | "running" | "done" | "error";

function hasUsableAddress(addresses: string[] | undefined): boolean {
  if (!addresses?.length) return false;
  return addresses.some((a) => {
    const clean = cleanAddress(a);
    return clean && clean !== "::1" && !clean.startsWith("127.");
  });
}

function inferKind(raw: string): LinkKind {
  if (raw.includes("utun") || raw.includes("vpn") || raw.includes("tunnel") || raw.includes("wireguard")) return "vpn";
  if (
    raw.includes("wi-fi") ||
    raw.includes("wifi") ||
    raw.includes("wlan") ||
    raw.includes("airport") ||
    raw.includes("wireless") ||
    raw.includes("802.11")
  ) return "wifi";
  // On macOS, en0 is commonly Wi-Fi unless explicitly marked as Ethernet/LAN.
  if (raw.includes("en0") && !raw.includes("ethernet") && !raw.includes(" lan ")) return "wifi";
  if (raw.includes("ethernet") || raw.includes("eth") || raw.includes(" lan ")) return "ethernet";
  return "ethernet";
}

function pickLinkKind(
  interfaces: Array<{ name: string; description: string; addresses?: string[]; isDefault?: boolean }>,
  localIp: string | null,
): LinkKind {
  const byLocalIp = localIp
    ? interfaces.find((iface) => iface.addresses?.some((a) => cleanAddress(a) === localIp))
    : undefined;
  const byDefault = interfaces.find((iface) => iface.isDefault && hasUsableAddress(iface.addresses));
  const nonVpnFallback = interfaces.find((iface) => {
    const raw = `${iface.name} ${iface.description}`.toLowerCase();
    return hasUsableAddress(iface.addresses) && inferKind(raw) !== "vpn";
  });
  const fallback = interfaces.find((iface) => hasUsableAddress(iface.addresses)) ?? interfaces[0];
  const active = byLocalIp ?? byDefault ?? nonVpnFallback ?? fallback;
  if (!active) return "ethernet";
  return inferKind(`${active.name} ${active.description}`.toLowerCase());
}

export function IpBadge() {
  const localIp = useNetworkStore((s) => s.localIp);
  const loadingLocal = useNetworkStore((s) => s.loading);
  const interfaces = useNetworkStore((s) => s.interfaces);
  const stun = useNetworkTestStore((s) => s.stun);
  const runStun = useNetworkTestStore((s) => s.runStun);
  const healthCheck = useNetworkTestStore((s) => s.healthCheck);
  const wifi = useNetworkTestStore((s) => s.wifi);
  const fetchWifi = useNetworkTestStore((s) => s.fetchWifi);
  const wanIp = stun.result?.public_ip ?? null;
  const loadingWan = stun.status === "running";
  const linkKind = pickLinkKind(interfaces, localIp);
  const lastStunLocalIpRef = useRef<string | null>(null);
  const lastGeoIpRef = useRef<string | null>(null);
  const geoRetryRef = useRef<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<"local" | "wan" | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [geoResult, setGeoResult] = useState<GeoIpResult | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Refresh WAN IP when local route changes so tooltip doesn't show stale data.
    if (!localIp || stun.status === "running") return;
    if (lastStunLocalIpRef.current === localIp) return;
    lastStunLocalIpRef.current = localIp;
    void runStun();
  }, [localIp, stun.status, runStun]);

  useEffect(() => {
    // Prime WAN IP once on first load if no localIp has been detected yet.
    if (!localIp && !wanIp && stun.status === "idle") {
      void runStun();
    }
  }, [localIp, wanIp, stun.status, runStun]);

  useEffect(() => {
    if (linkKind !== "wifi") return;
    if (wifi.status === "running") return;
    if (resolveWifiQualityPct(wifi.result) != null) return;
    void fetchWifi();
  }, [linkKind, wifi.status, wifi.result, fetchWifi]);

  useEffect(() => {
    let isCancelled = false;

    if (!wanIp) {
      setGeoStatus("idle");
      setGeoResult(null);
      lastGeoIpRef.current = null;
      geoRetryRef.current.clear();
      return;
    }

    if (lastGeoIpRef.current === wanIp) return;

    lastGeoIpRef.current = wanIp;
    setGeoStatus("running");
    void dnsGeoIp(wanIp)
      .then((result) => {
        if (isCancelled) return;
        setGeoResult(result);
        setGeoStatus(result.success ? "done" : "error");

        // Backend GeoIP uses a global rate limiter and may temporarily fall back
        // to ASN-only metadata; retry once after the limiter window for full geo.
        const needsFullGeoRetry =
          result.source !== "ipwho.is" &&
          (!result.country || result.lat == null || result.lon == null) &&
          !geoRetryRef.current.has(wanIp);
        if (!needsFullGeoRetry) return;

        geoRetryRef.current.add(wanIp);
        setTimeout(() => {
          if (isCancelled) return;
          void dnsGeoIp(wanIp)
            .then((retry) => {
              if (isCancelled) return;
              setGeoResult(retry);
              setGeoStatus(retry.success ? "done" : "error");
            })
            .catch(() => {
              // Keep prior result if retry fails.
            });
        }, 1700);
      })
      .catch(() => {
        if (isCancelled) return;
        setGeoResult(null);
        setGeoStatus("error");
      });

    return () => {
      isCancelled = true;
    };
  }, [wanIp]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const copyIp = async (value: string, field: "local" | "wan") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedField(null), 1100);
    } catch {
      // Clipboard can fail in restricted contexts; silently ignore.
    }
  };

  const Icon = linkKind === "vpn" ? GlobeLock : Network;
  const label = linkKind === "vpn" ? "VPN" : linkKind === "wifi" ? "Wi-Fi" : "Ethernet";

  let qualityLabel: "Excellent" | "Good" | "Fair" | "Poor" | "Unknown" = "Unknown";
  let qualityClass = "text-muted-foreground";
  let qualityHint = "Quality data unavailable";
  let WifiIcon = wifiIconFromQualityPct(null);

  const wifiQuality = resolveWifiQualityPct(wifi.result);
  const loss = healthCheck.result?.packet_loss_pct;
  const latency = healthCheck.result?.avg_latency_ms;
  const internetReachable = healthCheck.result?.internet_reachable;

  if (linkKind === "wifi" && typeof wifiQuality === "number") {
    qualityLabel = wifiLabelFromQualityPct(wifiQuality);
    qualityClass = wifiToneClassFromQualityPct(wifiQuality);
    WifiIcon = wifiIconFromQualityPct(wifiQuality);
    qualityHint = `Wi-Fi signal ${wifiQuality}%`;
  } else if (typeof loss === "number" || typeof latency === "number" || typeof internetReachable === "boolean") {
    if (internetReachable === false || (typeof loss === "number" && loss >= 5) || (typeof latency === "number" && latency >= 180)) {
      qualityLabel = "Poor";
      qualityClass = "text-destructive";
    } else if ((typeof loss === "number" && loss >= 1) || (typeof latency === "number" && latency >= 90)) {
      qualityLabel = "Fair";
      qualityClass = "text-warning";
    } else {
      qualityLabel = "Good";
      qualityClass = "text-success";
    }
    const parts: string[] = [];
    if (typeof latency === "number") parts.push(`${Math.round(latency)} ms`);
    if (typeof loss === "number") parts.push(`${loss.toFixed(1)}% loss`);
    qualityHint = parts.length > 0 ? parts.join(" · ") : qualityHint;
  }

  const geoLat = geoResult?.lat;
  const geoLon = geoResult?.lon;
  const hasGeoCoords =
    typeof geoLat === "number" &&
    Number.isFinite(geoLat) &&
    typeof geoLon === "number" &&
    Number.isFinite(geoLon);
  const mapZoom = geoResult?.city ? 8 : geoResult?.region ? 6 : 5;

  const geoLocation = [geoResult?.city, geoResult?.region, geoResult?.country]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(", ");
  const geoMeta = [geoResult?.asn, geoResult?.isp || geoResult?.org]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" · ");

  return (
    <TooltipWrapper
      side="bottom"
      interactive
      content={
        <div className="min-w-[340px] max-w-[420px] space-y-2.5">
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-foreground leading-snug">{label} connection</p>
                <span className={cn("text-2xs rounded-full px-1.5 py-0.5 border border-border/50 bg-muted/35", qualityClass)}>
                  {qualityLabel}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-snug truncate">{qualityHint}</p>
              <div className="text-2xs text-muted-foreground/85 flex items-center gap-1.5 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                {geoStatus === "running" ? (
                  <span>Locating WAN endpoint...</span>
                ) : geoLocation ? (
                  <span className="truncate">{geoLocation}</span>
                ) : geoResult?.country_code ? (
                  <span className="truncate">Country: {geoResult.country_code}</span>
                ) : (
                  <span>Location unavailable</span>
                )}
              </div>
              {geoMeta ? (
                <div className="text-2xs text-muted-foreground/75 truncate">{geoMeta}</div>
              ) : null}
              {geoResult?.source ? (
                <div className="text-3xs text-muted-foreground/65 truncate">
                  Source: {geoResult.source}
                </div>
              ) : null}
              {geoStatus === "error" && geoResult?.error ? (
                <div className="text-3xs text-warning/90 truncate">
                  {geoResult.error}
                </div>
              ) : null}
            </div>
            <div className="relative h-[86px] w-[142px] rounded-md border border-border/40 bg-sidebar/65 overflow-hidden shrink-0">
              {hasGeoCoords ? (
                <>
                  <div className="absolute inset-0">
                    <Map
                      center={[geoLat, geoLon]}
                      zoom={mapZoom}
                      minZoom={1}
                      maxZoom={10}
                      mouseEvents={false}
                      touchEvents={false}
                      attribution={false}
                      metaWheelZoom={false}
                      twoFingerDrag={false}
                    >
                      <Marker anchor={[geoLat, geoLon]} width={18} color="hsl(var(--primary))" />
                    </Map>
                  </div>
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,hsl(var(--background)/0.04),hsl(var(--background)/0.18))]" />
                </>
              ) : (
                <>
                  <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(to_right,hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.35)_1px,transparent_1px)] [background-size:16px_16px]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.18),transparent_55%),radial-gradient(circle_at_80%_70%,hsl(var(--accent)/0.15),transparent_60%)]" />
                  <Globe className="absolute left-1/2 top-1/2 h-4 w-4 text-muted-foreground/60 -translate-x-1/2 -translate-y-1/2" />
                </>
              )}
              <div className="pointer-events-none absolute left-1.5 bottom-1 rounded-[4px] border border-border/40 bg-background/80 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                WAN map
              </div>
            </div>
          </div>

          <div className="h-px w-full bg-border/40" />

          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-md border border-border/40 bg-muted/30 px-2 py-1">
              <p className="text-2xs text-muted-foreground">Local IP</p>
              {localIp ? (
                <button
                  type="button"
                  onClick={() => void copyIp(localIp, "local")}
                  className="mt-0.5 text-xs text-foreground/90 tabular-nums underline-offset-2 hover:underline"
                  title="Click to copy"
                >
                  {localIp}
                </button>
              ) : (
                <p className="mt-0.5 text-xs text-foreground/80">{loadingLocal ? "Detecting…" : "Unavailable"}</p>
              )}
              {copiedField === "local" && <p className="text-2xs text-success mt-0.5">Copied</p>}
            </div>

            <div className="rounded-md border border-border/40 bg-muted/30 px-2 py-1">
              <p className="text-2xs text-muted-foreground">WAN IP</p>
              {wanIp ? (
                <button
                  type="button"
                  onClick={() => void copyIp(wanIp, "wan")}
                  className="mt-0.5 text-xs text-foreground/90 tabular-nums underline-offset-2 hover:underline"
                  title="Click to copy"
                >
                  {wanIp}
                </button>
              ) : (
                <p className="mt-0.5 text-xs text-foreground/80">{loadingWan ? "Detecting…" : "Unavailable"}</p>
              )}
              {copiedField === "wan" && <p className="text-2xs text-success mt-0.5">Copied</p>}
            </div>
          </div>

          {geoResult?.timezone ? (
            <div className="text-2xs text-muted-foreground/80">Timezone: {geoResult.timezone}</div>
          ) : null}
        </div>
      }
    >
      <div
        className={cn(
          "header-icon-button relative",
          (loadingLocal || loadingWan) && "opacity-80",
        )}
        aria-label="Connection and IP information"
      >
        {linkKind === "wifi" ? (
          <WifiIcon className={cn("h-4 w-4 shrink-0", qualityClass)} strokeWidth={1.9} />
        ) : (
          <Icon className={cn("h-4 w-4", qualityClass)} strokeWidth={1.9} />
        )}
      </div>
    </TooltipWrapper>
  );
}
