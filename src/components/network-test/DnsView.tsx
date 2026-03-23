import { useState, useCallback, type ReactNode } from "react";
import { useDnsTestStore } from "@/stores/dnsTestStore";
import { TestGroup } from "./components/TestGroup";
import { TestTile } from "./components/TestTile";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import {
  Globe, Search, Phone, ArrowLeft, Terminal, MapPin, Network,
  ChevronRight, Check, X,
} from "@/lib/icons";
import { CoordinateValue } from "./dns/CoordinateValue";
import type { DnsRecordType, MultiSiteConfig } from "@/types/dns";

// ═══════════════════════════════════════════════════════════════════
//  DnsView — unified DNS testing view
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_EXPANDED = new Set(["lookup", "sip", "reverse", "dig", "geoip", "multisite"]);

export function DnsView() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(DEFAULT_EXPANDED));

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-4 pb-10">
        {/* ── Primary tools — 2-col grid ──────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TestGroup title="Record Lookup" icon={Search} gridCols="2">
            <LookupTile expanded={isExpanded("lookup")} onToggle={() => toggle("lookup")} />
            <GeoIpTile expanded={isExpanded("geoip")} onToggle={() => toggle("geoip")} />
          </TestGroup>

          <TestGroup title="VoIP DNS" icon={Phone} gridCols="2">
            <SipResolveTile expanded={isExpanded("sip")} onToggle={() => toggle("sip")} />
            <ReverseDnsTile expanded={isExpanded("reverse")} onToggle={() => toggle("reverse")} />
          </TestGroup>
        </div>

        {/* ── Advanced tools — full width ──────────────────────── */}
        <TestGroup title="Advanced" icon={Terminal}>
          <DigTile expanded={isExpanded("dig")} onToggle={() => toggle("dig")} />
          <MultiSiteTile expanded={isExpanded("multisite")} onToggle={() => toggle("multisite")} />
        </TestGroup>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  DNS Lookup Tile
// ═══════════════════════════════════════════════════════════════════

const RECORD_TYPES: DnsRecordType[] = [
  "A", "AAAA", "SRV", "NAPTR", "MX", "TXT", "CNAME", "NS", "SOA", "PTR", "CAA", "TLSA", "SSHFP", "HTTPS", "ANY",
];

const LOOKUP_RECORD_OPTIONS = RECORD_TYPES.map((rt) => ({ value: rt, label: rt }));
const LOOKUP_TRANSPORT_OPTIONS = [
  { value: "udp", label: "UDP" },
  { value: "tcp", label: "TCP" },
] as const;

function LookupTile({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const {
    lookup, lookupDomain, lookupRecordType, lookupServer, lookupTransport,
    setLookupDomain, setLookupRecordType, setLookupServer, setLookupTransport, runLookup,
  } = useDnsTestStore();

  const r = lookup.result;

  return (
    <TestTile
      icon={Globe} tint="text-info" title="DNS Lookup"
      subtitle="Query any record type"
      status={lookup.status} onRun={runLookup}
      summary={r ? `${r.records.length} rec · ${r.resolution_ms.toFixed(0)}ms` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      {/* Config */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={lookupDomain} onChange={(e) => setLookupDomain(e.target.value)}
          placeholder="example.com" className="h-7 text-xs flex-1 min-w-[120px]"
          disabled={lookup.status === "running"}
          onKeyDown={(e) => e.key === "Enter" && lookup.status !== "running" && runLookup()}
        />
        <AppDropdown
          value={lookupRecordType}
          onValueChange={(v) => setLookupRecordType(v as DnsRecordType)}
          options={LOOKUP_RECORD_OPTIONS}
          className="h-7 w-[80px] text-xs"
          itemClassName="text-xs"
        />
        <Input
          value={lookupServer} onChange={(e) => setLookupServer(e.target.value)}
          placeholder="Server (optional)" className="h-7 text-xs w-[130px]"
          disabled={lookup.status === "running"}
        />
        <AppDropdown
          value={lookupTransport}
          onValueChange={(v) => setLookupTransport(v as "udp" | "tcp")}
          options={[...LOOKUP_TRANSPORT_OPTIONS]}
          className="h-7 w-[65px] text-xs"
          itemClassName="text-xs"
        />
      </div>

      {/* Results */}
      {r && (
        <div className="space-y-2.5">
          {/* Stats row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xs text-muted-foreground/60 tabular-nums">
              {r.records.length} record{r.records.length !== 1 ? "s" : ""}
            </span>
            <AppDivider orientation="vertical" size="xs" className="mx-0" />
            <span className="text-2xs text-muted-foreground/60 tabular-nums">{r.resolution_ms.toFixed(0)}ms</span>
            {r.server && (
              <>
                <AppDivider orientation="vertical" size="xs" className="mx-0" />
                <span className="text-2xs text-muted-foreground/60">via <span className="font-mono">{r.server}</span></span>
              </>
            )}
          </div>

          {/* Record list */}
          {r.records.length > 0 && (
            <div className="ui-hero-surface overflow-hidden max-h-[220px] overflow-y-auto">
              <div className="divide-y divide-border/20">
                {r.records.map((rec, i) => (
                  <div key={i} className="px-3 py-2 text-xs font-mono flex items-center gap-2.5 hover:bg-muted/10 transition-smooth">
                    <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 font-mono shrink-0 bg-muted/20 text-muted-foreground">
                      {rec.record_type}
                    </Badge>
                    <span className="text-foreground/90 flex-1 min-w-0 truncate">{formatRecordData(rec.data)}</span>
                    <span className="text-muted-foreground/60 text-2xs shrink-0 tabular-nums">TTL {rec.ttl}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {lookup.error && <p className="text-xs text-destructive">{lookup.error}</p>}
    </TestTile>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SIP Resolution Tile
// ═══════════════════════════════════════════════════════════════════

function SipResolveTile({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const {
    sipResolve, sipResolveDomain, sipResolveServer,
    setSipResolveDomain, setSipResolveServer, runSipResolve,
  } = useDnsTestStore();

  const r = sipResolve.result;

  return (
    <TestTile
      icon={Phone} tint="text-primary" title="SIP Resolution"
      subtitle="RFC 3263 NAPTR → SRV → A/AAAA"
      status={sipResolve.status} onRun={runSipResolve}
      summary={r ? `${r.targets.length} target${r.targets.length !== 1 ? "s" : ""} · ${r.total_ms.toFixed(0)}ms` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      {/* Config */}
      <div className="flex items-center gap-2">
        <Input
          value={sipResolveDomain} onChange={(e) => setSipResolveDomain(e.target.value)}
          placeholder="sip.example.com" className="h-7 text-xs flex-1 min-w-[120px]"
          disabled={sipResolve.status === "running"}
          onKeyDown={(e) => e.key === "Enter" && sipResolve.status !== "running" && runSipResolve()}
        />
        <Input
          value={sipResolveServer} onChange={(e) => setSipResolveServer(e.target.value)}
          placeholder="DNS server (optional)" className="h-7 text-xs w-[140px]"
          disabled={sipResolve.status === "running"}
        />
      </div>

      {/* Results */}
      {r && (
        <div className="space-y-3">
          {/* Resolution steps */}
          <div className="space-y-1.5">
            {r.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs">
                <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 shrink-0 mt-0.5 bg-muted/10">{step.step_type}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-muted-foreground/70 truncate">{step.query}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    <span className="tabular-nums text-muted-foreground/60 text-2xs">{step.records_found} rec</span>
                    <span className="tabular-nums text-muted-foreground/60 text-2xs">{step.resolution_ms.toFixed(0)}ms</span>
                  </div>
                  {step.details.length > 0 && (
                    <div className="mt-1 pl-1 space-y-0.5">
                      {step.details.map((d, j) => (
                        <div key={j} className="text-2xs text-muted-foreground/60 font-mono">
                          <span className="text-muted-foreground/60">{d.label}:</span> {d.value}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Resolved targets */}
          {r.targets.length > 0 && (
            <div>
              <h4 className="section-label-sm mb-1.5">Resolved Targets</h4>
              <div className="ui-hero-surface overflow-hidden">
                <div className="divide-y divide-border/20">
                  {r.targets.map((t, i) => (
                    <div key={i} className="px-3 py-2 text-xs font-mono flex items-center gap-2.5 hover:bg-muted/10 transition-smooth">
                      <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 shrink-0 bg-muted/20 text-muted-foreground">{t.transport}</Badge>
                      <span className="text-foreground/90">{t.host}:{t.port}</span>
                      <span className="text-muted-foreground/60 ml-auto text-2xs tabular-nums">pri={t.priority} w={t.weight}</span>
                      {t.ip_addresses.length > 0 && (
                        <span className="text-muted-foreground/60 text-2xs">[{t.ip_addresses.join(", ")}]</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {sipResolve.error && <p className="text-xs text-destructive">{sipResolve.error}</p>}
    </TestTile>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Reverse DNS Tile
// ═══════════════════════════════════════════════════════════════════

function ReverseDnsTile({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const {
    reverse, reverseIp, reverseServer, reverseFcrdns,
    setReverseIp, setReverseServer, setReverseFcrdns, runReverse,
  } = useDnsTestStore();

  const r = reverse.result;

  return (
    <TestTile
      icon={ArrowLeft} tint="text-warning" title="Reverse DNS"
      subtitle="PTR + FCrDNS verification"
      status={reverse.status} onRun={runReverse}
      summary={r?.ptr_hostname ? r.ptr_hostname.slice(0, 24) : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      {/* Config */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={reverseIp} onChange={(e) => setReverseIp(e.target.value)}
          placeholder="8.8.8.8" className="h-7 text-xs flex-1 min-w-[100px]"
          disabled={reverse.status === "running"}
          onKeyDown={(e) => e.key === "Enter" && reverse.status !== "running" && runReverse()}
        />
        <Input
          value={reverseServer} onChange={(e) => setReverseServer(e.target.value)}
          placeholder="Server (optional)" className="h-7 text-xs w-[130px]"
          disabled={reverse.status === "running"}
        />
        <div className="flex items-center gap-1.5">
          <Switch checked={reverseFcrdns} onCheckedChange={setReverseFcrdns} className="scale-75" />
          <span className="text-2xs text-muted-foreground/60">FCrDNS</span>
        </div>
      </div>

      {/* Results */}
      {r && (
        <div className="ui-hero-surface p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="section-label-sm w-12 shrink-0">IP</span>
            <span className="font-mono text-foreground/90">{r.ip}</span>
            <span className="text-2xs text-muted-foreground/60 ml-auto tabular-nums">{r.resolution_ms.toFixed(0)}ms</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="section-label-sm w-12 shrink-0">PTR</span>
            {r.ptr_hostname
              ? <span className="font-mono text-foreground/90">{r.ptr_hostname}</span>
              : <span className="text-muted-foreground/60 italic text-2xs">No PTR record</span>}
          </div>
          {r.fcrdns && (
            <>
              <div className="border-t border-border/20 my-1" />
              <div className="flex items-center gap-2 text-xs">
                <span className="section-label-sm w-12 shrink-0">FCrDNS</span>
                {r.fcrdns.confirmed ? (
                  <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-success/10 text-success">
                    <Check className="h-2.5 w-2.5 mr-0.5" /> Confirmed
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-destructive/10 text-destructive">
                    <X className="h-2.5 w-2.5 mr-0.5" /> Mismatch
                  </Badge>
                )}
              </div>
              {r.fcrdns.forward_ips.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="section-label-sm w-12 shrink-0 pt-0.5">Fwd</span>
                  <div className="flex flex-wrap gap-1">
                    {r.fcrdns.forward_ips.map((ip, i) => (
                      <span key={i} className={cn(
                        "font-mono text-2xs px-1.5 py-0.5 rounded-lg",
                        ip === r.ip ? "bg-success/10 text-success" : "bg-muted/20 text-muted-foreground/60"
                      )}>{ip}</span>
                    ))}
                  </div>
                </div>
              )}
              {r.fcrdns.mismatch_details && (
                <p className="text-2xs text-warning/70 pl-14">{r.fcrdns.mismatch_details}</p>
              )}
            </>
          )}
        </div>
      )}
      {reverse.error && <p className="text-xs text-destructive">{reverse.error}</p>}
    </TestTile>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  GeoIP Tile
// ═══════════════════════════════════════════════════════════════════

function GeoIpTile({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { geoip, geoipIp, setGeoipIp, runGeoip } = useDnsTestStore();
  const r = geoip.result;

  const summaryText = r?.success && r.country_code
    ? `${countryFlag(r.country_code)} ${r.country}`
    : undefined;

  return (
    <TestTile
      icon={MapPin} tint="text-destructive" title="GeoIP Lookup"
      subtitle="Location, ISP, ASN"
      status={geoip.status} onRun={runGeoip}
      summary={summaryText}
      expanded={expanded} onToggle={onToggle}
    >
      {/* Config */}
      <div className="flex items-center gap-2">
        <Input
          value={geoipIp} onChange={(e) => setGeoipIp(e.target.value)}
          placeholder="8.8.8.8" className="h-7 text-xs flex-1 min-w-[100px]"
          disabled={geoip.status === "running"}
          onKeyDown={(e) => e.key === "Enter" && geoip.status !== "running" && runGeoip()}
        />
      </div>

      {/* Results */}
      {r?.success && (
        <div className="ui-hero-surface p-3 space-y-1.5">
          <GeoRow label="IP" value={r.ip} />
          {r.country && (
            <GeoRow label="Country" value={`${r.country_code ? countryFlag(r.country_code) + " " : ""}${r.country}${r.country_code ? ` (${r.country_code})` : ""}`} />
          )}
          {r.region && <GeoRow label="Region" value={r.region} />}
          {r.city && <GeoRow label="City" value={r.city} />}
          {(r.lat != null && r.lon != null) && <GeoRow label="Coords" value={<CoordinateValue lat={r.lat} lon={r.lon} />} />}
          {r.isp && <GeoRow label="ISP" value={r.isp} />}
          {r.org && <GeoRow label="Org" value={r.org} />}
          {r.asn && <GeoRow label="ASN" value={r.asn} />}
          {r.timezone && <GeoRow label="TZ" value={r.timezone} />}
          <div className="pt-1.5">
            <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-success/8 text-success/80">{r.source}</Badge>
          </div>
        </div>
      )}
      {geoip.error && <p className="text-xs text-destructive">{geoip.error}</p>}
    </TestTile>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Dig Tile
// ═══════════════════════════════════════════════════════════════════

const DIG_RECORD_TYPES = ["A", "AAAA", "SRV", "NAPTR", "MX", "TXT", "CNAME", "NS", "SOA", "PTR", "CAA", "ANY"];

const DIG_RECORD_OPTIONS = DIG_RECORD_TYPES.map((rt) => ({ value: rt, label: rt }));

const MULTI_SITE_TEST_OPTIONS = [
  { value: "lookup", label: "DNS Lookup" },
  { value: "sip_resolve", label: "SIP Resolve" },
  { value: "reverse", label: "Reverse DNS" },
  { value: "dig", label: "Dig" },
] as const;

const MULTI_SITE_RECORD_OPTIONS = ["A", "AAAA", "MX", "TXT", "NS", "SOA", "SRV", "NAPTR"].map((rt) => ({
  value: rt,
  label: rt,
}));

function DigTile({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const {
    dig, digDomain, digRecordType, digServer, digUseTcp, digRd, digCd, digAd,
    setDigDomain, setDigRecordType, setDigServer, setDigUseTcp, setDigRd, setDigCd, setDigAd, runDig,
  } = useDnsTestStore();

  const r = dig.result;

  return (
    <TestTile
      icon={Terminal} tint="text-success" title="Dig"
      subtitle="Raw DNS query with full diagnostics"
      status={dig.status} onRun={runDig}
      summary={r ? `${r.header.rcode} · ${r.query_time_ms.toFixed(0)}ms` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      {/* Config row 1 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={digDomain} onChange={(e) => setDigDomain(e.target.value)}
          placeholder="example.com" className="h-7 text-xs flex-1 min-w-[120px]"
          disabled={dig.status === "running"}
          onKeyDown={(e) => e.key === "Enter" && dig.status !== "running" && runDig()}
        />
        <AppDropdown
          value={digRecordType}
          onValueChange={setDigRecordType}
          options={DIG_RECORD_OPTIONS}
          className="h-7 w-[75px] text-xs"
          itemClassName="text-xs"
        />
        <Input
          value={digServer} onChange={(e) => setDigServer(e.target.value)}
          placeholder="@server (default: 8.8.8.8)" className="h-7 text-xs w-[170px]"
          disabled={dig.status === "running"}
        />
      </div>

      {/* Config row 2 — flags */}
      <div className="flex items-center gap-4 flex-wrap">
        {[
          { label: "TCP", checked: digUseTcp, onChange: setDigUseTcp },
          { label: "RD", checked: digRd, onChange: setDigRd },
          { label: "CD", checked: digCd, onChange: setDigCd },
          { label: "AD", checked: digAd, onChange: setDigAd },
        ].map((flag) => (
          <label key={flag.label} className="flex items-center gap-1.5 cursor-pointer">
            <Switch checked={flag.checked} onCheckedChange={flag.onChange} className="scale-[0.65]" />
            <span className="text-2xs text-muted-foreground/60 font-medium">{flag.label}</span>
          </label>
        ))}
      </div>

      {/* Results */}
      {r && (
        <div className="space-y-2.5">
          {/* Response meta */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className={cn("text-3xs px-1.5 py-0 h-4",
              r.header.rcode === "NoError" ? "bg-success/10 text-success" :
              r.header.rcode === "NXDomain" ? "bg-warning/10 text-warning" :
              "bg-destructive/10 text-destructive"
            )}>{r.header.rcode}</Badge>
            <span className="text-2xs text-muted-foreground/60 tabular-nums">{r.query_time_ms.toFixed(0)}ms</span>
            <span className="text-2xs text-muted-foreground/60">{r.transport}</span>
            <span className="text-2xs text-muted-foreground/60 tabular-nums">{r.response_size}B</span>
            {r.truncated && <Badge variant="destructive" className="text-3xs px-1.5 py-0 h-4">TC</Badge>}
            {r.tcp_retry && <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-muted/20">TCP retry</Badge>}
            <div className="flex gap-1 ml-1">
              {r.header.aa && <FlagPill>AA</FlagPill>}
              {r.header.rd && <FlagPill>RD</FlagPill>}
              {r.header.ra && <FlagPill>RA</FlagPill>}
              {r.header.ad && <FlagPill>AD</FlagPill>}
              {r.header.cd && <FlagPill>CD</FlagPill>}
            </div>
          </div>

          {r.edns && (
            <div className="text-2xs text-muted-foreground/60">
              EDNS v{r.edns.version}, UDP {r.edns.udp_payload_size}B{r.edns.dnssec_ok && ", DO"}
            </div>
          )}

          {/* Dig output */}
          <pre className="bg-muted/10 rounded-lg p-3.5 text-2xs font-mono leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto text-muted-foreground/70 selection:bg-primary/20">
            {r.dig_output}
          </pre>
        </div>
      )}
      {dig.error && <p className="text-xs text-destructive">{dig.error}</p>}
    </TestTile>
  );
}

/** Tiny pill for DNS header flags */
function FlagPill({ children }: { children: string }) {
  return (
    <span className="text-3xs px-1 py-0 h-3.5 inline-flex items-center rounded-lg border border-border/20 text-muted-foreground/60 font-medium">
      {children}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Multi-Site Tile
// ═══════════════════════════════════════════════════════════════════

function MultiSiteTile({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { multiSite, runMultiSite } = useDnsTestStore();
  const [target, setTarget] = useState("");
  const [testType, setTestType] = useState<"lookup" | "sip_resolve" | "reverse" | "dig">("lookup");
  const [recordType, setRecordType] = useState("A");
  const [server, setServer] = useState("");
  const [includeLocal, setIncludeLocal] = useState(true);

  const r = multiSite.result;

  const handleRun = () => {
    if (!target.trim()) return;
    const config: MultiSiteConfig = {
      test_type: testType,
      target: target.trim(),
      record_type: (testType === "lookup" || testType === "dig") ? recordType : undefined,
      server: server.trim() || undefined,
      agent_ids: ["all"],
      include_local: includeLocal,
    };
    runMultiSite(config);
  };

  return (
    <TestTile
      icon={Network} tint="text-info" title="Multi-Site Comparison"
      subtitle="Compare results across remote agents"
      status={multiSite.status} onRun={handleRun}
      summary={r ? `${r.results.length} site${r.results.length !== 1 ? "s" : ""}` : undefined}
      expanded={expanded} onToggle={onToggle} fullWidth
    >
      {/* Config */}
      <div className="flex items-center gap-2 flex-wrap">
        <AppDropdown
          value={testType}
          onValueChange={(v) => setTestType(v as typeof testType)}
          options={[...MULTI_SITE_TEST_OPTIONS]}
          className="h-7 w-[110px] text-xs"
          itemClassName="text-xs"
        />
        <Input
          value={target} onChange={(e) => setTarget(e.target.value)}
          placeholder={testType === "reverse" ? "IP address" : "Domain"}
          className="h-7 text-xs flex-1 min-w-[120px]"
          disabled={multiSite.status === "running"}
          onKeyDown={(e) => e.key === "Enter" && multiSite.status !== "running" && handleRun()}
        />
        {(testType === "lookup" || testType === "dig") && (
          <AppDropdown
            value={recordType}
            onValueChange={setRecordType}
            options={MULTI_SITE_RECORD_OPTIONS}
            className="h-7 w-[65px] text-xs"
            itemClassName="text-xs"
          />
        )}
        <Input
          value={server} onChange={(e) => setServer(e.target.value)}
          placeholder="DNS server" className="h-7 text-xs w-[110px]"
          disabled={multiSite.status === "running"}
        />
        <div className="flex items-center gap-1.5">
          <Switch checked={includeLocal} onCheckedChange={setIncludeLocal} className="scale-75" />
          <span className="text-2xs text-muted-foreground/60">Local</span>
        </div>
      </div>

      {/* Results */}
      {r && (
        <div className="space-y-2.5">
          <div className="text-2xs text-muted-foreground/60 tabular-nums">
            {r.results.length} site{r.results.length !== 1 ? "s" : ""} · {r.total_ms.toFixed(0)}ms
          </div>

          {/* Site results */}
          <div className="ui-hero-surface overflow-hidden">
            <div className="divide-y divide-border/20">
              {r.results.map((site, i) => (
                <div key={i} className="px-3 py-2.5 flex items-center gap-3 hover:bg-muted/10 transition-smooth">
                  <div className="w-28 shrink-0">
                    <div className="text-xs font-medium text-foreground/90">{site.source}</div>
                    {site.agent_id && <div className="text-3xs text-muted-foreground/60 font-mono truncate">{site.agent_id.slice(0, 8)}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    {site.success ? (
                      <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-success/10 text-success">
                        <Check className="h-2.5 w-2.5 mr-0.5" /> OK
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-destructive/10 text-destructive">
                        <X className="h-2.5 w-2.5 mr-0.5" /> {site.error || "Failed"}
                      </Badge>
                    )}
                  </div>
                  {site.latency_ms != null && (
                    <span className="text-2xs text-muted-foreground/60 tabular-nums shrink-0">{site.latency_ms.toFixed(0)}ms</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Discrepancies */}
          {r.discrepancies.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="section-label-sm text-warning/80">Discrepancies</h4>
              {r.discrepancies.map((d, i) => (
                <div key={i} className="text-2xs text-muted-foreground/60 flex items-start gap-1.5">
                  <Badge variant={d.severity === "error" ? "destructive" : "secondary"} className="text-3xs px-1 py-0 h-3.5 shrink-0 mt-px">{d.severity}</Badge>
                  <span>{d.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {multiSite.error && <p className="text-xs text-destructive">{multiSite.error}</p>}
    </TestTile>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

function GeoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="section-label-sm w-14 shrink-0 text-right">{label}</span>
      <span className="font-mono text-foreground/90">{value}</span>
    </div>
  );
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return "";
  const offset = 0x1f1e6;
  const a = code.toUpperCase().charCodeAt(0) - 65 + offset;
  const b = code.toUpperCase().charCodeAt(1) - 65 + offset;
  return String.fromCodePoint(a, b);
}

function formatRecordData(data: any): string {
  if (!data) return "";
  switch (data.type) {
    case "A": case "AAAA": case "CNAME": case "NS": case "PTR": case "HTTPS": case "Raw":
      return data.value;
    case "SRV":
      return `${data.value.target}:${data.value.port} (pri=${data.value.priority} w=${data.value.weight})`;
    case "NAPTR":
      return `${data.value.service} → ${data.value.replacement} (order=${data.value.order} pref=${data.value.preference} flags="${data.value.flags}")`;
    case "MX":
      return `${data.value.exchange} (pref=${data.value.preference})`;
    case "TXT":
      return `"${data.value.text}"`;
    case "SOA":
      return `${data.value.mname} ${data.value.rname} serial=${data.value.serial}`;
    case "CAA":
      return `${data.value.tag} "${data.value.value}"${data.value.issuer_critical ? " [critical]" : ""}`;
    case "TLSA":
      return `usage=${data.value.cert_usage} sel=${data.value.selector} match=${data.value.matching_type} ${data.value.cert_data.slice(0, 32)}…`;
    case "SSHFP":
      return `algo=${data.value.algorithm} type=${data.value.fingerprint_type} ${data.value.fingerprint.slice(0, 32)}…`;
    default:
      return JSON.stringify(data.value);
  }
}
