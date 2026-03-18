import { useCallback, useMemo, useState } from "react";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

const reverseGeocodeCache = new Map<string, string>();

function formatLocationName(entry: any): string | null {
  if (!entry || typeof entry !== "object") return null;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const admin1 = typeof entry.admin1 === "string" ? entry.admin1.trim() : "";
  const country = typeof entry.country === "string" ? entry.country.trim() : "";
  const parts = [name, admin1, country].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

export function CoordinateValue({
  lat,
  lon,
  decimals = 4,
}: {
  lat: number;
  lon: number;
  decimals?: number;
}) {
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const key = useMemo(() => `${lat.toFixed(6)},${lon.toFixed(6)}`, [lat, lon]);

  const resolveLocation = useCallback(async () => {
    if (resolvedLocation || resolving) return;
    const cached = reverseGeocodeCache.get(key);
    if (cached) {
      setResolvedLocation(cached);
      return;
    }
    setResolving(true);
    try {
      const url =
        `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(lat)}` +
        `&longitude=${encodeURIComponent(lon)}&count=1&language=en&format=json`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const json = await resp.json();
      const location = formatLocationName(json?.results?.[0]);
      if (location) {
        reverseGeocodeCache.set(key, location);
        setResolvedLocation(location);
      }
    } catch {
      // Swallow network errors; coordinates remain visible as fallback.
    } finally {
      setResolving(false);
    }
  }, [key, lat, lon, resolvedLocation, resolving]);

  const coordsLabel = `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`;
  const tooltipTitle = resolvedLocation ?? (resolving ? "Resolving location..." : "Hover to reveal location");
  const tooltipDescription = resolvedLocation
    ? "Approximate place name for these coordinates."
    : "Reverse geocoding from coordinates.";

  return (
    <TooltipWrapper title={tooltipTitle} description={tooltipDescription}>
      <span className="font-mono text-foreground" onMouseEnter={() => void resolveLocation()}>
        {coordsLabel}
      </span>
    </TooltipWrapper>
  );
}

