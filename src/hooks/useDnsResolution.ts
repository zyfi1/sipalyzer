import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeTauri } from "@/api/invoke";
import { reverseDnsLookup } from "@/api/packetCapture";

// Cache for DNS resolutions to avoid repeated lookups
const dnsCache = new Map<string, { hostname: string | null; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface UseDnsResolutionResult {
  hostname: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to perform reverse DNS lookup for an IP address
 * Caches results to avoid repeated lookups
 */
export function useDnsResolution(ip: string | null): UseDnsResolutionResult {
  const cached = ip ? dnsCache.get(ip) : undefined;
  const initialData =
    cached && Date.now() - cached.timestamp < CACHE_TTL
      ? cached.hostname
      : undefined;

  const query = useQuery<string | null>({
    queryKey: ["dns-resolution", ip],
    queryFn: async () => {
      if (!ip) throw new Error("Missing IP");
      const result = await Promise.race<string | null>([
        reverseDnsLookup(ip),
        new Promise<string | null>((resolve) => {
          setTimeout(() => resolve(null), 5000);
        }),
      ]);
      const resolved = result || null;
      dnsCache.set(ip, {
        hostname: resolved,
        timestamp: Date.now(),
      });
      return resolved;
    },
    enabled: Boolean(ip),
    staleTime: CACHE_TTL,
    gcTime: CACHE_TTL * 2,
    initialData,
  });

  useEffect(() => {
    if (!ip || !query.isError) return;
    dnsCache.set(ip, {
      hostname: null,
      timestamp: Date.now(),
    });
  }, [ip, query.isError]);

  return {
    hostname: ip ? (query.data ?? null) : null,
    isLoading: Boolean(ip) && query.isLoading,
    error: query.isError ? String(query.error) : null,
  };
}

/**
 * Batch DNS resolution for multiple IPs
 */
export async function batchDnsResolution(
  ips: string[]
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  // Check cache first
  const uncachedIps: string[] = [];
  for (const ip of ips) {
    const cached = dnsCache.get(ip);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      results.set(ip, cached.hostname);
    } else {
      uncachedIps.push(ip);
    }
  }

  // Perform batch lookup for uncached IPs
  if (uncachedIps.length > 0) {
    try {
      const batchResults = await invokeTauri<Record<string, string | null>>(
        "batch_reverse_dns_lookup",
        { ips: uncachedIps }
      );

      // Update cache and results
      for (const [ip, hostname] of Object.entries(batchResults)) {
        results.set(ip, hostname);
        dnsCache.set(ip, {
          hostname,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      // On error, mark all as failed
      for (const ip of uncachedIps) {
        results.set(ip, null);
        dnsCache.set(ip, {
          hostname: null,
          timestamp: Date.now(),
        });
      }
    }
  }

  return results;
}
