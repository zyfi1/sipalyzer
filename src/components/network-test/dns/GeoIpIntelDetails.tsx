import type { GeoIpResult, GeoIpRdapInfo } from "@/types/dns";
import { cn } from "@/lib/utils";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.25rem_1fr] items-start gap-x-1.5 gap-y-0 text-2xs leading-snug sm:grid-cols-[6rem_1fr]">
      <span className="text-right text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-mono text-foreground/90">{value}</span>
    </div>
  );
}

function RdapBlock({ rdap }: { rdap: GeoIpRdapInfo }) {
  const rows: { label: string; value: string | null | undefined }[] = [
    { label: "Registry", value: rdap.registry },
    { label: "Inetnum", value: rdap.net_range },
    { label: "Handle", value: rdap.net_handle },
    { label: "RDAP name", value: rdap.net_name },
    { label: "Allocation", value: rdap.allocation_type },
    { label: "Status", value: rdap.status },
    { label: "Registrant", value: rdap.registrant },
    { label: "Address", value: rdap.org_address },
    { label: "Abuse", value: rdap.abuse_email },
    { label: "WHOIS", value: rdap.whois_server },
  ];

  const visibleRows = rows.filter((r) => r.value != null && String(r.value).trim().length > 0);
  const remarks = rdap.remarks?.trim() ?? "";

  if (visibleRows.length === 0 && remarks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 rounded-md border border-border/30 bg-background/30 p-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Registry (RDAP)
      </p>
      <div className="space-y-0.5">
        {visibleRows.map((r) => (
          <Row key={r.label} label={r.label} value={String(r.value)} />
        ))}
      </div>
      {remarks.length > 0 && (
        <p
          className={cn(
            "max-h-24 overflow-y-auto text-2xs leading-snug text-muted-foreground overscroll-contain",
            visibleRows.length > 0 && "mt-1.5 border-t border-border/25 pt-1.5",
          )}
        >
          {rdap.remarks}
        </p>
      )}
    </div>
  );
}

/**
 * Extra provider + RDAP rows for a GeoIP result (datacenter / hosting hints, postal, registry).
 */
export function GeoIpIntelDetails({ result }: { result: GeoIpResult }) {
  const continentLabel =
    result.continent && result.continent_code
      ? `${result.continent} (${result.continent_code})`
      : result.continent ?? result.continent_code ?? null;

  const providerRows: { label: string; value: string | null | undefined }[] = [
    { label: "Continent", value: continentLabel },
    { label: "Postal", value: result.postal },
    { label: "Reg. code", value: result.region_code },
    { label: "IP type", value: result.ip_kind },
    { label: "Net domain", value: result.connection_domain },
    { label: "Link type", value: result.connection_class },
  ];

  const hasProvider = providerRows.some((r) => r.value != null && String(r.value).trim().length > 0);
  const rdap = result.rdap;
  const rdapEmpty =
    rdap == null ||
    Object.values(rdap).every((v) => v == null || String(v).trim() === "");

  if (!hasProvider && rdapEmpty) {
    return null;
  }

  const twoColumn = hasProvider && !rdapEmpty;

  return (
    <div
      className={
        twoColumn
          ? "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-x-2 sm:gap-y-0"
          : "flex flex-col gap-2"
      }
    >
      {hasProvider && (
        <div className="space-y-1 rounded-md border border-border/30 bg-background/25 p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Provider
          </p>
          <div className="space-y-0.5">
            {providerRows
              .filter((r) => r.value != null && String(r.value).trim().length > 0)
              .map((r) => (
                <Row key={r.label} label={r.label} value={String(r.value)} />
              ))}
          </div>
        </div>
      )}
      {rdap != null ? <RdapBlock rdap={rdap} /> : null}
    </div>
  );
}
