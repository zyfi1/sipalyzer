import type { ReactNode } from "react";
import { useDnsTestStore } from "@/stores/dnsTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, MapPin } from "@/lib/icons";
import { CoordinateValue } from "./CoordinateValue";

export default function GeoIpPanel() {
  const { geoip, geoipIp, setGeoipIp, runGeoip } = useDnsTestStore();

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext("dns");

  const running = geoip.status === "running";
  const result = geoip.result;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-destructive" />
        <div>
          <h3 className="text-sm font-medium">GeoIP Lookup</h3>
          <p className="text-2xs text-muted-foreground">Geolocation, ISP, ASN, and organization for an IP address</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={geoipIp}
          onChange={(e) => setGeoipIp(e.target.value)}
          placeholder="8.8.8.8"
          className="h-8 text-xs flex-1 min-w-[120px]"
          disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && runGeoip(ctx)}
        />
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runGeoip(ctx)} disabled={running || !geoipIp.trim()}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Lookup
        </Button>
      </div>

      {geoip.error && !result && (
        <p className="text-xs text-destructive">{geoip.error}</p>
      )}

      {result && (
        <div className="ui-hero-surface p-3 space-y-1.5">
          <div className="flex items-center gap-2 mb-2">
            {result.success ? (
              <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-success/10 text-success">
                {result.source}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-destructive/10 text-destructive">
                Failed
              </Badge>
            )}
          </div>

          <GeoRow label="IP" value={result.ip} />
          {result.country && (
            <GeoRow label="Country" value={`${result.country_code ? countryFlag(result.country_code) + " " : ""}${result.country}${result.country_code ? ` (${result.country_code})` : ""}`} />
          )}
          {result.region && <GeoRow label="Region" value={result.region} />}
          {result.city && <GeoRow label="City" value={result.city} />}
          {(result.lat != null && result.lon != null) && (
            <GeoRow label="Coords" value={<CoordinateValue lat={result.lat} lon={result.lon} />} />
          )}
          {result.isp && <GeoRow label="ISP" value={result.isp} />}
          {result.org && <GeoRow label="Org" value={result.org} />}
          {result.asn && <GeoRow label="ASN" value={result.asn} />}
          {result.timezone && <GeoRow label="TZ" value={result.timezone} />}
        </div>
      )}
    </div>
  );
}

function GeoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-16 shrink-0 text-right">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function countryFlag(code: string): string {
  if (code.length !== 2) return "";
  const offset = 0x1f1e6;
  const a = code.charCodeAt(0) - 65 + offset;
  const b = code.charCodeAt(1) - 65 + offset;
  return String.fromCodePoint(a, b);
}
