import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";
import { VoipView } from "@/components/network-test/VoipView";
import { PortTestPanel } from "../components/PortTestPanel";
import { useDnsTestStore } from "@/stores/dnsTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Globe, Play, Loader2, Square } from "@/lib/icons";
import type { DnsRecordType } from "@/types/dns";
import { tooltips } from "@/lib/tooltips";
import { CoordinateValue } from "../dns/CoordinateValue";
import { GeoIpLocationMap } from "../dns/GeoIpLocationMap";
import { GeoIpIntelDetails } from "../dns/GeoIpIntelDetails";

const NatAlgPanel = lazy(() => import("./NatAlgPanel"));

const ACCESS_TABS = [
  { id: "dns", label: "DNS", tip: "DNS Console", tipDesc: "All DNS lookup and resolution tooling in one place." },
  { id: "voip", label: "VoIP", tip: "VoIP Assessment", tipDesc: "Run end-to-end VoIP quality diagnostics." },
  { id: "nat-alg", label: "NAT/ALG", tip: "NAT & ALG", tipDesc: "Detect NAT class and SIP ALG side effects." },
  { id: "port-scan", label: "Ports", tip: "Port Testing", tipDesc: "Validate TCP/UDP reachability for target services." },
] as const;

type AccessTabId = (typeof ACCESS_TABS)[number]["id"];
type DnsStatus = "idle" | "running" | "done" | "error";
type DnsToolId = "lookup" | "sip" | "reverse" | "dig" | "geoip" | "asn";

const RECORD_TYPES: DnsRecordType[] = [
  "A", "AAAA", "SRV", "NAPTR", "MX", "TXT", "CNAME", "NS", "SOA", "PTR", "CAA", "TLSA", "SSHFP", "HTTPS", "ANY",
];

const DNS_TOOL_ORDER: DnsToolId[] = ["lookup", "sip", "reverse", "dig", "geoip", "asn"];
const DNS_TOOL_OPTIONS: { value: DnsToolId; label: string }[] = [
  { value: "lookup", label: "Lookup" },
  { value: "sip", label: "SIP Resolve" },
  { value: "reverse", label: "Reverse DNS" },
  { value: "dig", label: "Dig" },
  { value: "geoip", label: "GeoIP" },
  { value: "asn", label: "ASN" },
];

const RECORD_TYPE_OPTIONS = RECORD_TYPES.map((type) => ({ value: type, label: type }));

const RECORD_TYPE_DESCRIPTIONS: Partial<Record<DnsRecordType, string>> = {
  A: tooltips.dnsTypeA.description,
  AAAA: tooltips.dnsTypeAAAA.description,
  NS: tooltips.dnsTypeNs.description,
  CNAME: tooltips.dnsTypeCname.description,
  MX: tooltips.dnsTypeMx.description,
  TXT: tooltips.dnsTypeTxt.description,
  SRV: tooltips.dnsTypeSrv.description,
  PTR: tooltips.dnsTypePtr.description,
  SOA: tooltips.dnsTypeSoa.description,
  NAPTR: tooltips.dnsTypeNaptr.description,
};

function DnsStatusPill({ label, status }: { label: string; status: DnsStatus }) {
  const tone =
    status === "running"
      ? "text-primary border-primary/35 bg-primary/10"
      : status === "done"
        ? "text-success border-success/35 bg-success/10"
        : status === "error"
          ? "text-destructive border-destructive/35 bg-destructive/10"
          : "text-muted-foreground border-border/40 bg-muted/20";

  const text = status === "running" ? "RUN" : status === "done" ? "OK" : status === "error" ? "ERR" : "IDLE";

  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-2xs font-medium ${tone}`}>
      <span>{label}</span>
      <span className="tabular-nums">{text}</span>
    </span>
  );
}

function isLikelyIp(value: string) {
  return /^(\d{1,3}\.){3}\d{1,3}$|:/.test(value.trim());
}

function UnifiedDnsToolbox() {
  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext("dns");

  const {
    lookup, sipResolve, reverse, dig, geoip, asn,
    setLookupDomain, setLookupRecordType, setLookupServer, setLookupTransport, runLookup,
    setSipResolveDomain, setSipResolveServer, runSipResolve,
    setReverseIp, setReverseServer, setReverseFcrdns, runReverse,
    setDigDomain, setDigRecordType, setDigServer, setDigUseTcp, setDigRd, setDigCd, setDigAd, runDig,
    setGeoipIp, runGeoip, runAsnLookup,
    dismissAllDnsOperations,
  } = useDnsTestStore();

  const [target, setTarget] = useState("");
  const [dnsServer, setDnsServer] = useState("");
  const [recordType, setRecordType] = useState<DnsRecordType>("A");
  const [transport, setTransport] = useState<"udp" | "tcp">("udp");
  const [reverseFcrdns, setReverseFcrdnsLocal] = useState(true);
  const [digRd, setDigRdLocal] = useState(true);
  const [digCd, setDigCdLocal] = useState(false);
  const [digAd, setDigAdLocal] = useState(false);
  const [activeTool, setActiveTool] = useState<DnsToolId>("lookup");

  const anyRunning = [
    lookup.status, sipResolve.status, reverse.status, dig.status, geoip.status, asn.status,
  ].some((s) => s === "running");

  const hasTarget = target.trim().length > 0;

  const syncSharedInputs = () => {
    const t = target.trim();
    setLookupDomain(t);
    setLookupRecordType(recordType);
    setLookupServer(dnsServer);
    setLookupTransport(transport);

    setSipResolveDomain(t);
    setSipResolveServer(dnsServer);

    setReverseIp(t);
    setReverseServer(dnsServer);
    setReverseFcrdns(reverseFcrdns);

    setDigDomain(t);
    setDigRecordType(recordType);
    setDigServer(dnsServer);
    setDigUseTcp(transport === "tcp");
    setDigRd(digRd);
    setDigCd(digCd);
    setDigAd(digAd);

    setGeoipIp(t);
  };

  const runTool = async (tool: DnsToolId) => {
    if (!hasTarget) return;
    syncSharedInputs();

    if (tool === "lookup") return runLookup(ctx);
    if (tool === "sip") return runSipResolve(ctx);
    if (tool === "reverse") return runReverse(ctx);
    if (tool === "dig") return runDig(ctx);
    if (tool === "geoip") return runGeoip(ctx);
    return runAsnLookup(target.trim());
  };

  const runActiveTool = () => runTool(activeTool);

  const toolStatus: Record<DnsToolId, DnsStatus> = {
    lookup: lookup.status,
    sip: sipResolve.status,
    reverse: reverse.status,
    dig: dig.status,
    geoip: geoip.status,
    asn: asn.status,
  };

  const toolLabels: Record<DnsToolId, string> = {
    lookup: "Lookup",
    sip: "SIP Resolve",
    reverse: "Reverse DNS",
    dig: "Dig",
    geoip: "GeoIP",
    asn: "ASN",
  };

  const toolHints: Record<DnsToolId, string> = {
    lookup: "Standard DNS records for a domain/host target.",
    sip: "RFC 3263 SIP chain resolution for a domain/host target.",
    reverse: "PTR and forward-confirmed DNS. Requires IP target.",
    dig: "Raw diagnostics output with query flags.",
    geoip: "Location, ISP, ASN, and registry (RDAP) metadata. Requires IP target.",
    asn: "Autonomous system details. Requires IP target.",
  };

  const requiresIp = (tool: DnsToolId) =>
    tool === "reverse" || tool === "geoip" || tool === "asn";

  const canRunTool = (tool: DnsToolId) =>
    hasTarget && (!requiresIp(tool) || isLikelyIp(target));

  const activeStatus = toolStatus[activeTool];
  const activeLabel = toolLabels[activeTool];

  const runAll = async () => {
    if (!hasTarget || anyRunning) return;
    await Promise.all(DNS_TOOL_ORDER
      .filter((tool) => canRunTool(tool))
      .map((tool) => runTool(tool)));
  };

  const selectedRecordDescription = RECORD_TYPE_DESCRIPTIONS[recordType];

  const geoipHasMap =
    activeTool === "geoip" &&
    geoip.result != null &&
    geoip.result.lat != null &&
    geoip.result.lon != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <section className="ui-hero-surface app-view-surface-pad shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/35 pb-3">
          <div>
            <TooltipWrapper
              title="DNS Toolbox"
              description="Unified DNS operations: lookup, SIP resolution, reverse DNS, dig diagnostics, GeoIP, and ASN intelligence."
            >
              <h2 className="text-sm font-semibold text-foreground cursor-help">DNS Toolbox</h2>
            </TooltipWrapper>
            <p className="text-2xs text-muted-foreground/75">Choose a tool, set target/options, run, inspect results.</p>
          </div>
          <div className="flex items-center gap-2">
            <TooltipWrapper
              title="DNS Tool Selector"
              description="Switch between standard lookup, SIP DNS chain, reverse lookup, raw dig output, geolocation metadata, and ASN ownership."
            >
              <span className="inline-flex">
                <AppDropdown
                  value={activeTool}
                  onValueChange={(v) => setActiveTool(v as DnsToolId)}
                  options={DNS_TOOL_OPTIONS}
                  className="h-8 w-[170px] text-xs"
                  itemClassName="text-xs"
                />
              </span>
            </TooltipWrapper>
            <DnsStatusPill label={activeLabel} status={activeStatus} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <TooltipWrapper
              title="Target"
              description="Domain or IP depending on the selected tool. Reverse DNS, GeoIP, and ASN require an IP target."
            >
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Domain or IP target"
                className="h-9 pl-8 text-xs"
                onKeyDown={(e) => e.key === "Enter" && runActiveTool()}
              />
            </TooltipWrapper>
          </div>

          {anyRunning && (
            <TooltipWrapper title="Stop DNS operations" description="Clear running states for all DNS toolbox actions. In-flight requests may still complete in the background.">
              <Button type="button" size="sm" variant="destructive" className="h-9 gap-1.5 px-3 text-xs" onClick={dismissAllDnsOperations}>
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            </TooltipWrapper>
          )}
          <TooltipWrapper
            title={`Run ${activeLabel}`}
            description={`Execute ${activeLabel} against the current target with current options.`}
          >
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 px-3 text-xs"
              onClick={runActiveTool}
              disabled={!canRunTool(activeTool) || anyRunning}
            >
              {activeStatus === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run {activeLabel}
            </Button>
          </TooltipWrapper>

          <TooltipWrapper
            title="Run All DNS Tools"
            description="Run every compatible DNS operation for the current target in parallel."
          >
            <Button
              size="sm"
              className="h-9 gap-1.5 px-3 text-xs"
              onClick={runAll}
              disabled={!hasTarget || anyRunning}
            >
              {anyRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run All
            </Button>
          </TooltipWrapper>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/35 bg-muted/10 p-2">
          <TooltipWrapper
            title="DNS Resolver Server"
            description="Optional custom resolver host/IP (example: 1.1.1.1). Leave blank to use system DNS."
          >
            <Input
              value={dnsServer}
              onChange={(e) => setDnsServer(e.target.value)}
              placeholder="DNS server (optional)"
              className="h-8 w-[210px] text-xs"
            />
          </TooltipWrapper>

          {(activeTool === "lookup" || activeTool === "dig") && (
            <TooltipWrapper
              title="DNS Record Type"
              description={selectedRecordDescription ?? "Choose which DNS record type to query."}
            >
              <span className="inline-flex">
                <AppDropdown
                  value={recordType}
                  onValueChange={(v) => setRecordType(v as DnsRecordType)}
                  options={RECORD_TYPE_OPTIONS}
                  className="h-8 w-[96px] text-xs"
                  itemClassName="text-xs"
                />
              </span>
            </TooltipWrapper>
          )}

          {(activeTool === "lookup" || activeTool === "dig") && (
            <div className="subview-tabs-compact">
              <TooltipWrapper entry={tooltips.protoUdp}>
                <button type="button" data-state={transport === "udp" ? "active" : "inactive"} onClick={() => setTransport("udp")} className="subview-tab-compact !h-8 !px-3 text-xs">UDP</button>
              </TooltipWrapper>
              <TooltipWrapper entry={tooltips.protoTcp}>
                <button type="button" data-state={transport === "tcp" ? "active" : "inactive"} onClick={() => setTransport("tcp")} className="subview-tab-compact !h-8 !px-3 text-xs">TCP</button>
              </TooltipWrapper>
            </div>
          )}

          {activeTool === "reverse" && (
            <div className="inline-flex h-8 items-center gap-2 rounded-md border border-border/40 bg-muted/10 px-2">
              <TooltipWrapper
                title="FCrDNS"
                description="Forward-confirmed reverse DNS: verifies PTR hostname resolves back to the same source IP."
              >
                <span className="text-2xs text-muted-foreground cursor-help">FCrDNS</span>
              </TooltipWrapper>
              <Switch checked={reverseFcrdns} onCheckedChange={setReverseFcrdnsLocal} className="scale-75" />
            </div>
          )}

          {activeTool === "dig" && (
            <div className="inline-flex h-8 items-center gap-2 rounded-md border border-border/40 bg-muted/10 px-2">
              <TooltipWrapper
                title="RD (Recursion Desired)"
                description="Request recursive resolution from the DNS server."
              >
                <span className="text-2xs text-muted-foreground cursor-help">RD</span>
              </TooltipWrapper>
              <Switch checked={digRd} onCheckedChange={setDigRdLocal} className="scale-75" />
              <TooltipWrapper
                title="CD (Checking Disabled)"
                description="Disable DNSSEC validation checks by the resolver."
              >
                <span className="text-2xs text-muted-foreground cursor-help">CD</span>
              </TooltipWrapper>
              <Switch checked={digCd} onCheckedChange={setDigCdLocal} className="scale-75" />
              <TooltipWrapper
                title="AD (Authenticated Data)"
                description="Requests authenticated-data handling for DNSSEC-capable responses."
              >
                <span className="text-2xs text-muted-foreground cursor-help">AD</span>
              </TooltipWrapper>
              <Switch checked={digAd} onCheckedChange={setDigAdLocal} className="scale-75" />
            </div>
          )}

          {!canRunTool(activeTool) && hasTarget && (
            <span className="text-2xs text-warning">Current tool expects an IP target.</span>
          )}
        </div>

        <p className="text-2xs text-muted-foreground/75">{toolHints[activeTool]}</p>
      </section>

      <section
        className={cn(
          "ui-hero-surface flex min-h-0 flex-col overflow-hidden",
          geoipHasMap && "min-h-0 flex-1",
        )}
      >
        <div className="ui-section-header-sm shrink-0 border-b border-border/35">
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">{activeLabel} Results</span>
            <DnsStatusPill label={activeLabel} status={activeStatus} />
          </div>
        </div>

        <div
          className={cn(
            "app-view-surface-pad",
            geoipHasMap && "flex min-h-0 flex-1 flex-col overflow-hidden",
          )}
        >
          {activeTool === "lookup" && (
            lookup.result ? (
              <div className="space-y-2">
                <div className="text-2xs text-muted-foreground">
                  {lookup.result.records.length} record{lookup.result.records.length !== 1 ? "s" : ""} · {lookup.result.resolution_ms.toFixed(0)}ms
                </div>
                <div className="ui-hero-surface divide-y divide-border/20 overflow-hidden">
                  {lookup.result.records.slice(0, 24).map((record, index) => (
                    <div key={`${record.name}-${index}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <Badge variant="secondary" className="h-4 px-1.5 py-0 text-3xs">{record.record_type}</Badge>
                      <span className="min-w-0 flex-1 truncate font-mono text-foreground/90">{String((record.data as { value?: unknown })?.value ?? "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <EmptyState variant="inline" title="No lookup results yet" description="Run Lookup for this target." className="h-full min-h-0 p-6" />
          )}

          {activeTool === "sip" && (
            sipResolve.result ? (
              <div className="space-y-2">
                <div className="text-2xs text-muted-foreground">
                  {sipResolve.result.targets.length} target{sipResolve.result.targets.length !== 1 ? "s" : ""} · {sipResolve.result.total_ms.toFixed(0)}ms
                </div>
                <div className="ui-hero-surface divide-y divide-border/20 overflow-hidden">
                  {sipResolve.result.targets.map((targetRow, index) => (
                    <div key={`${targetRow.host}-${index}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <Badge variant="secondary" className="h-4 px-1.5 py-0 text-3xs">{targetRow.transport}</Badge>
                      <span className="font-mono">{targetRow.host}:{targetRow.port}</span>
                      <span className="ml-auto text-2xs text-muted-foreground">pri {targetRow.priority} · w {targetRow.weight}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <EmptyState variant="inline" title="No SIP results yet" description="Run SIP resolve for this target." className="h-full min-h-0 p-6" />
          )}

          {activeTool === "reverse" && (
            reverse.result ? (
              <div className="space-y-2 text-xs">
                <div className="text-2xs text-muted-foreground">{reverse.result.resolution_ms.toFixed(0)}ms</div>
                <div className="ui-hero-surface p-3">
                  <div className="flex items-center gap-2"><span className="w-16 text-muted-foreground">IP</span><span className="font-mono">{reverse.result.ip}</span></div>
                  <div className="flex items-center gap-2"><span className="w-16 text-muted-foreground">PTR</span><span className="font-mono">{reverse.result.ptr_hostname ?? "No PTR"}</span></div>
                  {reverse.result.fcrdns && (
                    <div className="flex items-center gap-2"><span className="w-16 text-muted-foreground">FCrDNS</span><span>{reverse.result.fcrdns.confirmed ? "Confirmed" : "Mismatch"}</span></div>
                  )}
                </div>
              </div>
            ) : <EmptyState variant="inline" title="No reverse results yet" description="Run Reverse for this target." className="h-full min-h-0 p-6" />
          )}

          {activeTool === "dig" && (
            dig.result ? (
              <div className="space-y-2">
                <div className="text-2xs text-muted-foreground">
                  {dig.result.header.rcode} · {dig.result.query_time_ms.toFixed(0)}ms · {dig.result.transport.toUpperCase()}
                </div>
                <pre className="max-h-[360px] overflow-auto rounded-md border border-border/35 bg-background/45 p-3 text-2xs text-muted-foreground">
                  {dig.result.dig_output}
                </pre>
              </div>
            ) : <EmptyState variant="inline" title="No dig output yet" description="Run Dig for this target." className="h-full min-h-0 p-6" />
          )}

          {activeTool === "geoip" && (
            geoip.result ? (
              <div
                className={cn(
                  "gap-2 text-xs",
                  geoipHasMap ? "flex min-h-0 flex-1 flex-col" : "space-y-2",
                )}
              >
                <div className="shrink-0 text-2xs text-muted-foreground">{geoip.result.source}</div>
                <div
                  className={cn(
                    "ui-hero-surface p-2 sm:p-3",
                    geoipHasMap ? "flex min-h-0 flex-1 flex-col gap-0 overflow-hidden" : "space-y-2",
                  )}
                >
                  <div
                    className={cn(
                      "space-y-1.5 text-xs",
                      geoipHasMap &&
                        "max-h-[min(40vh,300px)] min-h-0 shrink-0 overflow-y-auto overscroll-contain border-b border-border/25 pb-2 pr-0.5",
                    )}
                  >
                    <div className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-2 gap-y-1 sm:grid-cols-[5.5rem_1fr]">
                      <span className="text-2xs text-muted-foreground">IP</span>
                      <span className="min-w-0 font-mono text-2xs text-foreground sm:text-xs">{geoip.result.ip}</span>
                      {geoip.result.country && (
                        <>
                          <span className="text-2xs text-muted-foreground">Country</span>
                          <span className="min-w-0 text-2xs sm:text-xs">{geoip.result.country}</span>
                        </>
                      )}
                      {geoip.result.region && (
                        <>
                          <span className="text-2xs text-muted-foreground">Region</span>
                          <span className="min-w-0 text-2xs sm:text-xs">{geoip.result.region}</span>
                        </>
                      )}
                      {geoip.result.city && (
                        <>
                          <span className="text-2xs text-muted-foreground">City</span>
                          <span className="min-w-0 text-2xs sm:text-xs">{geoip.result.city}</span>
                        </>
                      )}
                      {geoip.result.lat != null && geoip.result.lon != null && (
                        <>
                          <span className="text-2xs text-muted-foreground">Coords</span>
                          <span className="font-mono text-2xs sm:text-xs">
                            <CoordinateValue lat={geoip.result.lat} lon={geoip.result.lon} />
                          </span>
                        </>
                      )}
                      {geoip.result.isp && (
                        <>
                          <span className="text-2xs text-muted-foreground">ISP</span>
                          <span className="min-w-0 break-words text-2xs sm:text-xs">{geoip.result.isp}</span>
                        </>
                      )}
                      {geoip.result.org && (
                        <>
                          <span className="text-2xs text-muted-foreground">Org</span>
                          <span className="min-w-0 break-words text-2xs sm:text-xs">{geoip.result.org}</span>
                        </>
                      )}
                      {geoip.result.asn && (
                        <>
                          <TooltipWrapper
                            title="ASN (Autonomous System Number)"
                            description="The internet routing network that announces this IP prefix via BGP, typically mapped to an ISP or organization."
                          >
                            <span className="cursor-help text-2xs text-muted-foreground">ASN</span>
                          </TooltipWrapper>
                          <span className="min-w-0 text-2xs sm:text-xs">{geoip.result.asn}</span>
                        </>
                      )}
                      {geoip.result.timezone && (
                        <>
                          <span className="text-2xs text-muted-foreground">TZ</span>
                          <span className="min-w-0 font-mono text-2xs sm:text-xs">{geoip.result.timezone}</span>
                        </>
                      )}
                    </div>
                    <div className="pt-1.5">
                      <GeoIpIntelDetails result={geoip.result} />
                    </div>
                  </div>
                  {geoip.result.lat != null && geoip.result.lon != null && (
                    <div className="flex min-h-0 flex-1 flex-col pt-2">
                      <GeoIpLocationMap
                        fillHeight
                        lat={geoip.result.lat}
                        lon={geoip.result.lon}
                        label="Approximate location"
                        className="min-h-0 flex-1"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : <EmptyState variant="inline" title="No geoIP results yet" description="Run GeoIP (IP target required)." className="h-full min-h-0 p-6" />
          )}

          {activeTool === "asn" && (
            asn.result ? (
              <div className="space-y-2 text-xs">
                <div className="text-2xs text-muted-foreground">Autonomous System lookup</div>
                <div className="ui-hero-surface p-3">
                  <div className="flex items-center gap-2"><span className="w-20 text-muted-foreground">IP</span><span className="font-mono">{asn.result.ip}</span></div>
                  <div className="flex items-center gap-2">
                    <TooltipWrapper
                      title="ASN (Autonomous System Number)"
                      description="Unique identifier for a routing domain on the internet. It tells you which network operator owns/announces the IP block."
                    >
                      <span className="w-20 text-muted-foreground cursor-help">ASN</span>
                    </TooltipWrapper>
                    <span>{asn.result.asn ?? "Unknown"}</span>
                  </div>
                  {asn.result.org_name && <div className="flex items-center gap-2"><span className="w-20 text-muted-foreground">Org</span><span>{asn.result.org_name}</span></div>}
                  {asn.result.cidr && <div className="flex items-center gap-2"><span className="w-20 text-muted-foreground">CIDR</span><span>{asn.result.cidr}</span></div>}
                </div>
              </div>
            ) : <EmptyState variant="inline" title="No ASN results yet" description="Run ASN (IP target required)." className="h-full min-h-0 p-6" />
          )}
        </div>
      </section>
    </div>
  );
}

export function DnsToolView({ toolId, onExecToolIdChange }: { toolId?: string; onExecToolIdChange?: (id: string) => void }) {
  const [activeTab, setActiveTab] = useState<AccessTabId>("dns");

  useEffect(() => {
    const execToolId = activeTab === "dns"
      ? "dns"
      : activeTab === "voip"
        ? "voip"
        : activeTab === "nat-alg"
          ? "natDetect"
          : "portScan";
    onExecToolIdChange?.(execToolId);
  }, [activeTab, onExecToolIdChange]);

  const renderActivePanel = useMemo(() => {
    if (activeTab === "nat-alg") {
      return (
        <div className="surface-flat app-view-surface-pad">
          <Suspense fallback={<div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>}>
            <NatAlgPanel />
          </Suspense>
        </div>
      );
    }
    if (activeTab === "port-scan") return <PortTestPanel borderless />;
    if (activeTab === "voip") return <VoipView />;
    return <UnifiedDnsToolbox />;
  }, [activeTab]);

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        activeTab === "dns" && "min-h-0 flex-1 overflow-hidden",
      )}
    >
      <ToolSubTabs
        tabs={ACCESS_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        toolId={toolId}
      />
      {activeTab === "dns" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{renderActivePanel}</div>
      ) : (
        renderActivePanel
      )}
    </div>
  );
}
