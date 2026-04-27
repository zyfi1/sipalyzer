import { cn } from "@/lib/utils";

/**
 * Approximate location map for GeoIP coordinates (OpenStreetMap embed).
 * Requires `frame-src https://www.openstreetmap.org` in Tauri CSP.
 */
export function geoIpOsmEmbedUrl(lat: number, lon: number, spanDeg = 0.06): string {
  const half = spanDeg / 2;
  const minLon = lon - half;
  const minLat = lat - half * 0.72;
  const maxLon = lon + half;
  const maxLat = lat + half * 0.72;
  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
  const params = new URLSearchParams({
    bbox,
    layer: "mapnik",
    marker: `${lat},${lon}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

export function geoIpOsmExternalUrl(lat: number, lon: number, zoom = 12): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

export function GeoIpLocationMap({
  lat,
  lon,
  label,
  className,
  /** Grow the map to fill remaining flex space (DNS Toolbox results column). */
  fillHeight = false,
}: {
  lat: number;
  lon: number;
  /** Shown above the map for screen readers / context */
  label?: string;
  className?: string;
  fillHeight?: boolean;
}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const embed = geoIpOsmEmbedUrl(lat, lon);
  const external = geoIpOsmExternalUrl(lat, lon);

  return (
    <div className={cn(fillHeight && "flex min-h-0 flex-1 flex-col", className)}>
      {label ? (
        <p className="mb-1.5 shrink-0 text-2xs text-muted-foreground">{label}</p>
      ) : null}
      <div
        className={cn(
          "overflow-hidden rounded-md border border-border/40 bg-muted/20 shadow-inner",
          fillHeight &&
            "relative flex-1 [min-height:max(17rem,min(52dvh,34rem))]",
        )}
      >
        <iframe
          title={label ?? `Map near ${lat.toFixed(4)}, ${lon.toFixed(4)}`}
          src={embed}
          className={cn(
            "w-full border-0 bg-background",
            fillHeight ? "absolute inset-0 h-full w-full" : "min-h-[260px] h-[min(420px,58dvh)]",
          )}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <p className="mt-1 shrink-0 text-[10px] leading-snug text-muted-foreground">
        <a
          href={external}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-2 hover:underline"
        >
          Open full map
        </a>
        <span className="text-muted-foreground/80"> · </span>
        <span className="text-muted-foreground/85">Provider geolocation; map is approximate.</span>
      </p>
    </div>
  );
}
