import { useDnsTestStore } from "@/stores/dnsTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Globe } from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import type { DnsRecordType } from "@/types/dns";

const RECORD_TYPES: DnsRecordType[] = [
  "A", "AAAA", "SRV", "NAPTR", "MX", "TXT", "CNAME", "NS", "SOA", "PTR", "CAA", "TLSA", "SSHFP", "HTTPS", "ANY",
];

export default function DnsLookupPanel() {
  const {
    lookup, lookupDomain, lookupRecordType, lookupServer, lookupTransport,
    setLookupDomain, setLookupRecordType, setLookupServer, setLookupTransport, runLookup,
    lastSource,
  } = useDnsTestStore();
  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("dns");
  const viaAgent = lastSource.lookup?.source === "remote" ? resolvedAgentName("dns") : null;

  const running = lookup.status === "running";

  const handleLookup = () => runLookup(ctx);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-info" />
          <div>
            <h3 className="text-sm font-medium">DNS Lookup</h3>
            <p className="text-2xs text-muted-foreground">Query any DNS record type with optional custom server</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={lookupDomain}
          onChange={(e) => setLookupDomain(e.target.value)}
          placeholder="example.com"
          className="h-8 text-xs flex-1 min-w-[140px]"
          disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && handleLookup()}
        />
        <Select value={lookupRecordType} onValueChange={(v) => setLookupRecordType(v as DnsRecordType)}>
          <SelectTrigger className="h-8 w-[90px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECORD_TYPES.map((rt) => (
              <SelectItem key={rt} value={rt} className="text-xs">{rt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={lookupServer}
          onChange={(e) => setLookupServer(e.target.value)}
          placeholder="DNS server (optional)"
          className="h-8 text-xs w-[160px]"
          disabled={running}
        />
        <Select value={lookupTransport} onValueChange={(v) => setLookupTransport(v as "udp" | "tcp")}>
          <SelectTrigger className="h-8 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="udp" className="text-xs">UDP</SelectItem>
            <SelectItem value="tcp" className="text-xs">TCP</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={handleLookup} disabled={running || !lookupDomain.trim()}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Lookup
        </Button>
      </div>

      {lookup.error && !lookup.result && (
        <p className="text-xs text-destructive">{lookup.error}</p>
      )}

      {lookup.result && (
        <div className="space-y-2">
          {viaAgent && (
            <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4">via {viaAgent}</Badge>
          )}
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span>{lookup.result.records.length} record{lookup.result.records.length !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span className="tabular-nums">{lookup.result.resolution_ms.toFixed(0)}ms</span>
            {lookup.result.server && <><span>·</span><span>via {lookup.result.server}</span></>}
          </div>

          {lookup.result.records.length > 0 && (
            <div className="ui-hero-surface divide-y divide-border/20 overflow-hidden">
              {lookup.result.records.map((r, i) => (
                <div key={i} className="px-3 py-1.5 text-xs font-mono flex items-center gap-2">
                  <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 font-mono shrink-0">
                    {r.record_type}
                  </Badge>
                  <span className="text-foreground flex-1 min-w-0 truncate">
                    {formatRecordData(r.data)}
                  </span>
                  <span className="text-muted-foreground/60 text-2xs shrink-0 tabular-nums">
                    TTL {r.ttl}
                  </span>
                </div>
              ))}
            </div>
          )}

          {lookup.result.records.length === 0 && lookup.result.success && (
            <EmptyState
              variant="inline"
              title="No records found"
              description="Try another record type or DNS server."
              className="h-full min-h-0 p-6"
            />
          )}
        </div>
      )}
    </div>
  );
}

function formatRecordData(data: any): string {
  if (!data) return "";
  switch (data.type) {
    case "A":
    case "AAAA":
    case "CNAME":
    case "NS":
    case "PTR":
    case "HTTPS":
    case "Raw":
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
      return `usage=${data.value.cert_usage} sel=${data.value.selector} match=${data.value.matching_type} ${data.value.cert_data.slice(0, 32)}...`;
    case "SSHFP":
      return `algo=${data.value.algorithm} type=${data.value.fingerprint_type} ${data.value.fingerprint.slice(0, 32)}...`;
    default:
      return JSON.stringify(data.value);
  }
}
