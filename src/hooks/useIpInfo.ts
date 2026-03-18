import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeTauri } from "@/api/invoke";

/** Mirrors the Rust IpLookupResult struct */
export interface IpLookupResult {
  ip: string;
  hostname: string | null;
  asn: number | null;
  org: string | null;
  country: string | null;
  prefix: string | null;
  registry: string | null;
  isPrivate: boolean;
}

// In-memory cache with 5-minute TTL
const ipInfoCache = new Map<string, { data: IpLookupResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// Track in-flight requests to avoid duplicate calls for the same IP
// Quick check for private IPs on the frontend (avoids Tauri call)
function isPrivateIp(ip: string): boolean {
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("0.")) return true;
  if (ip === "255.255.255.255") return true;
  // 172.16.0.0 – 172.31.255.255
  const match = ip.match(/^172\.(\d+)\./);
  if (match && match[1]) {
    const second = parseInt(match[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 loopback / link-local
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  return false;
}

export interface UseIpInfoResult {
  info: IpLookupResult | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * React hook that performs an IP intelligence lookup (reverse DNS + ASN via Cymru).
 * Skips the Tauri call for private IPs and caches results for 5 minutes.
 */
export function useIpInfo(ip: string | null | undefined): UseIpInfoResult {
  const ipValue = ip ?? null;
  const privateIp = ipValue ? isPrivateIp(ipValue) : false;
  const cached = ipValue ? ipInfoCache.get(ipValue) : undefined;
  const initialData =
    cached && Date.now() - cached.timestamp < CACHE_TTL
      ? cached.data
      : undefined;

  const query = useQuery<IpLookupResult>({
    queryKey: ["ip-info", ipValue],
    queryFn: async () => {
      if (!ipValue) throw new Error("Missing IP");
      const result = await invokeTauri<IpLookupResult>("ip_lookup", { ip: ipValue });
      ipInfoCache.set(ipValue, { data: result, timestamp: Date.now() });
      return result;
    },
    enabled: Boolean(ipValue) && !privateIp,
    staleTime: CACHE_TTL,
    gcTime: CACHE_TTL * 2,
    initialData,
  });

  useEffect(() => {
    if (!ipValue || privateIp || !query.isError) return;
    const fallback: IpLookupResult = {
      ip: ipValue,
      hostname: null,
      asn: null,
      org: null,
      country: null,
      prefix: null,
      registry: null,
      isPrivate: false,
    };
    ipInfoCache.set(ipValue, { data: fallback, timestamp: Date.now() });
  }, [ipValue, privateIp, query.isError]);

  if (!ipValue) {
    return { info: null, isLoading: false, error: null };
  }

  if (privateIp) {
    return {
      info: {
        ip: ipValue,
        hostname: null,
        asn: null,
        org: null,
        country: null,
        prefix: null,
        registry: null,
        isPrivate: true,
      },
      isLoading: false,
      error: null,
    };
  }

  const fallbackInfo: IpLookupResult = {
    ip: ipValue,
    hostname: null,
    asn: null,
    org: null,
    country: null,
    prefix: null,
    registry: null,
    isPrivate: false,
  };

  return {
    info: query.data ?? (query.isError ? fallbackInfo : null),
    isLoading: query.isLoading,
    error: query.isError ? String(query.error) : null,
  };
}
