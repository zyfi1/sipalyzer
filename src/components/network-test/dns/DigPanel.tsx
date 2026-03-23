import { useDnsTestStore } from "@/stores/dnsTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Loader2, Search, Terminal, Info, Copy, Check } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { useState } from "react";

// ── Record type metadata ────────────────────────────────────────

interface RecordTypeMeta { value: string; label: string; desc: string; category: "common" | "mail" | "security" | "infra" | "advanced"; }

const RECORD_TYPES: RecordTypeMeta[] = [
  { value: "A",     label: "A",     desc: "IPv4 address records",                          category: "common" },
  { value: "AAAA",  label: "AAAA",  desc: "IPv6 address records",                          category: "common" },
  { value: "CNAME", label: "CNAME", desc: "Canonical name (alias) records",                category: "common" },
  { value: "MX",    label: "MX",    desc: "Mail exchange records",                         category: "mail" },
  { value: "TXT",   label: "TXT",   desc: "Text records (SPF, DKIM, verification)",        category: "mail" },
  { value: "NS",    label: "NS",    desc: "Authoritative nameserver records",              category: "infra" },
  { value: "SOA",   label: "SOA",   desc: "Start of Authority — zone metadata",            category: "infra" },
  { value: "SRV",   label: "SRV",   desc: "Service locator records (SIP, XMPP, etc.)",    category: "infra" },
  { value: "NAPTR", label: "NAPTR", desc: "Naming Authority Pointer (SIP routing, ENUM)",  category: "infra" },
  { value: "PTR",   label: "PTR",   desc: "Pointer records (reverse DNS)",                 category: "advanced" },
  { value: "CAA",   label: "CAA",   desc: "Certificate Authority Authorization",           category: "security" },
  { value: "ANY",   label: "ANY",   desc: "Request all record types (may be restricted)",  category: "advanced" },
];

const DIG_RECORD_TYPE_OPTIONS = RECORD_TYPES.map((rt) => ({
  value: rt.value,
  label: rt.label,
}));

// ── Flag definitions ────────────────────────────────────────────

const FLAGS = [
  { key: "tcp",  label: "TCP",  desc: "Use TCP instead of UDP. Required for large responses (>512B)." },
  { key: "rd",   label: "RD",   desc: "Recursion Desired — ask the server to resolve recursively. Almost always on." },
  { key: "cd",   label: "CD",   desc: "Checking Disabled — skip DNSSEC validation on the resolver." },
  { key: "ad",   label: "AD",   desc: "Authenticated Data — request DNSSEC-validated answers from the resolver." },
] as const;

// ── DNS server presets ──────────────────────────────────────────

const SERVER_PRESETS = [
  { ip: "8.8.8.8",         label: "Google",          desc: "Google Public DNS" },
  { ip: "1.1.1.1",         label: "Cloudflare",      desc: "Cloudflare DNS" },
  { ip: "9.9.9.9",         label: "Quad9",           desc: "Quad9 (malware filtering)" },
  { ip: "208.67.222.222",  label: "OpenDNS",         desc: "Cisco OpenDNS" },
];

// ── Response flag badge ─────────────────────────────────────────

function FlagBadge({ flag, active, tip }: { flag: string; active: boolean; tip: string }) {
  return (
    <TooltipWrapper title={flag} description={tip} side="bottom">
      <span className={cn(
        "inline-flex items-center justify-center px-1.5 py-0.5 rounded section-label-sm cursor-help transition-smooth",
        active
          ? "bg-success/15 text-success border border-success/20"
          : "bg-muted/10 text-muted-foreground/60 border border-transparent",
      )}>{flag}</span>
    </TooltipWrapper>
  );
}

// ═══════════════════════════════════════════════════════════════════

export default function DigPanel() {
  const {
    dig, digDomain, digRecordType, digServer, digUseTcp, digRd, digCd, digAd,
    setDigDomain, setDigRecordType, setDigServer, setDigUseTcp, setDigRd, setDigCd, setDigAd, runDig,
  } = useDnsTestStore();

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext("dns");

  const running = dig.status === "running";
  const result = dig.result;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!result?.dig_output) return;
    navigator.clipboard.writeText(result.dig_output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const flagGetters: Record<string, boolean> = { tcp: digUseTcp, rd: digRd, cd: digCd, ad: digAd };
  const flagSetters: Record<string, (v: boolean) => void> = { tcp: setDigUseTcp, rd: setDigRd, cd: setDigCd, ad: setDigAd };

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-success/[0.08] flex items-center justify-center shrink-0">
          <Terminal className="h-4 w-4 text-success" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Dig — Raw DNS Query</h3>
          <p className="text-2xs text-muted-foreground/60 leading-relaxed mt-0.5">
            Full diagnostic DNS query with header flags, all response sections, and timing — equivalent to the <code className="px-1 py-0.5 rounded bg-muted/20 text-2xs font-mono">dig</code> command.
          </p>
        </div>
        <TooltipWrapper title="About Dig" description="Dig performs a raw DNS query and returns the complete response including question, answer, authority, and additional sections with all flags and metadata. Useful for debugging DNS propagation, verifying records, and testing resolver behavior." side="left">
          <Info className="h-4 w-4 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0 mt-1" />
        </TooltipWrapper>
      </div>

      {/* ── Query bar ───────────────────────────────────── */}
      <div className="ui-hero-surface p-3 space-y-3">
        <div className="flex items-center gap-2">
          {/* Domain input */}
          <TooltipWrapper title="Domain Name" description="The domain or hostname to query. Examples: example.com, _sip._tcp.example.com" side="bottom">
            <div className="flex-1 min-w-0">
              <Input
                value={digDomain}
                onChange={(e) => setDigDomain(e.target.value)}
                placeholder="example.com"
                className="h-9 text-xs"
                disabled={running}
                onKeyDown={(e) => e.key === "Enter" && !running && digDomain.trim() && runDig(ctx)}
              />
            </div>
          </TooltipWrapper>

          {/* Record type select */}
          <TooltipWrapper title="Record Type" description="DNS record type to query. Common types: A (IPv4), AAAA (IPv6), CNAME (alias), MX (mail), TXT (text), NS (nameserver)." side="bottom">
            <div>
              <AppDropdown
                value={digRecordType}
                onValueChange={setDigRecordType}
                options={DIG_RECORD_TYPE_OPTIONS}
                className="h-9 w-[90px] text-xs font-mono"
                itemClassName="text-xs font-mono"
              />
            </div>
          </TooltipWrapper>

          {/* Server input */}
          <TooltipWrapper title="DNS Server" description="The resolver to query. Leave blank for system default (8.8.8.8). You can use any public or private DNS server IP." side="bottom">
            <div className="w-[180px] shrink-0">
              <Input
                value={digServer}
                onChange={(e) => setDigServer(e.target.value)}
                placeholder="@8.8.8.8"
                className="h-9 text-xs font-mono"
                disabled={running}
              />
            </div>
          </TooltipWrapper>

          {/* Run button */}
          <Button className="h-9 gap-1.5 px-4 text-xs shrink-0" onClick={() => runDig(ctx)} disabled={running || !digDomain.trim()}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Dig
          </Button>
        </div>

        {/* Flags + server presets row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Flags */}
          <div className="flex items-center gap-2.5">
            <span className="section-label-sm">Flags</span>
            {FLAGS.map((f) => (
              <TooltipWrapper key={f.key} title={f.label} description={f.desc} side="bottom">
                <button
                  type="button"
                  onClick={() => flagSetters[f.key]?.(!flagGetters[f.key])}
                  disabled={running}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg text-2xs font-medium transition-smooth",
                    flagGetters[f.key]
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-muted/10 text-muted-foreground/60 border border-transparent hover:bg-muted/20 hover:text-muted-foreground/60",
                    running && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full transition-smooth", flagGetters[f.key] ? "bg-primary" : "bg-muted-foreground/20")} />
                  {f.label}
                </button>
              </TooltipWrapper>
            ))}
          </div>

          <AppDivider orientation="vertical" size="md" className="mx-0" />

          {/* Server presets */}
          <div className="flex items-center gap-1.5">
            <span className="section-label-sm">Servers</span>
            {SERVER_PRESETS.map((s) => (
              <TooltipWrapper key={s.ip} title={s.desc} description={s.ip} side="bottom">
                <button
                  type="button"
                  onClick={() => setDigServer(s.ip)}
                  disabled={running}
                  className={cn(
                    "px-2 py-0.5 rounded text-2xs font-medium transition-smooth",
                    digServer === s.ip
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground/60 hover:bg-muted/20 hover:text-muted-foreground/60",
                    running && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {s.label}
                </button>
              </TooltipWrapper>
            ))}
          </div>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────── */}
      {dig.error && !result && (
        <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-4 py-3 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{dig.error}</p>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────── */}
      {result && (
        <div className="space-y-3">
          {/* Response header bar */}
          <div className="ui-hero-surface px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* rcode */}
              <TooltipWrapper title="Response Code" description={result.header.rcode_description || result.header.rcode} side="bottom">
                <Badge variant="secondary" className={cn(
                  "text-2xs px-2 py-0.5 font-semibold cursor-help",
                  result.header.rcode === "NoError" ? "bg-success/10 text-success border-success/20" :
                  result.header.rcode === "NXDomain" ? "bg-warning/10 text-warning border-warning/20" :
                  "bg-destructive/10 text-destructive border-destructive/20",
                )}>
                  {result.header.rcode}
                </Badge>
              </TooltipWrapper>

              {/* Truncated / TCP retry badges */}
              {result.truncated && (
                <TooltipWrapper title="Truncated" description="Response was truncated (TC flag set). The answer may be incomplete — consider using TCP." side="bottom">
                  <Badge variant="destructive" className="text-3xs px-1.5 py-0 cursor-help">TC</Badge>
                </TooltipWrapper>
              )}
              {result.tcp_retry && (
                <TooltipWrapper title="TCP Retry" description="Response was initially truncated over UDP, so the query was retried over TCP automatically." side="bottom">
                  <Badge variant="secondary" className="text-3xs px-1.5 py-0 cursor-help">TCP retry</Badge>
                </TooltipWrapper>
              )}

              <AppDivider orientation="vertical" size="sm" className="mx-0" />

              {/* Response flags */}
              <FlagBadge flag="AA" active={result.header.aa} tip="Authoritative Answer — the responding server is authoritative for this zone." />
              <FlagBadge flag="RD" active={result.header.rd} tip="Recursion Desired — you asked the server to resolve recursively." />
              <FlagBadge flag="RA" active={result.header.ra} tip="Recursion Available — the server supports recursive queries." />
              <FlagBadge flag="AD" active={result.header.ad} tip="Authenticated Data — the response has been DNSSEC-validated by the resolver." />
              <FlagBadge flag="CD" active={result.header.cd} tip="Checking Disabled — DNSSEC validation was skipped at your request." />

              {/* Stats — pushed right */}
              <div className="ml-auto flex items-center gap-3 text-2xs">
                <TooltipWrapper title="Query Time" description="Round-trip time for the DNS query to complete." side="bottom">
                  <span className="text-muted-foreground/60 tabular-nums cursor-help">{result.query_time_ms.toFixed(0)} ms</span>
                </TooltipWrapper>
                <TooltipWrapper title="Transport" description={`Query was sent over ${result.transport.toUpperCase()}.`} side="bottom">
                  <span className="text-muted-foreground/60 uppercase cursor-help">{result.transport}</span>
                </TooltipWrapper>
                <TooltipWrapper title="Response Size" description="Total size of the DNS response in bytes." side="bottom">
                  <span className="text-muted-foreground/60 tabular-nums cursor-help">{result.response_size} B</span>
                </TooltipWrapper>
              </div>
            </div>

            {/* Section counts */}
            <div className="flex items-center gap-4 mt-2 text-2xs">
              <TooltipWrapper title="Question Section" description="The query that was sent to the DNS server." side="bottom">
                <span className="text-muted-foreground/60 cursor-help">Q: <span className="text-foreground/80 font-semibold tabular-nums">{result.header.qdcount}</span></span>
              </TooltipWrapper>
              <TooltipWrapper title="Answer Section" description="Direct answers to the query (the records you asked for)." side="bottom">
                <span className="text-muted-foreground/60 cursor-help">AN: <span className={cn("font-semibold tabular-nums", result.header.ancount > 0 ? "text-success" : "text-muted-foreground/60")}>{result.header.ancount}</span></span>
              </TooltipWrapper>
              <TooltipWrapper title="Authority Section" description="Nameserver records (NS) that are authoritative for this zone." side="bottom">
                <span className="text-muted-foreground/60 cursor-help">NS: <span className="text-foreground/80 font-semibold tabular-nums">{result.header.nscount}</span></span>
              </TooltipWrapper>
              <TooltipWrapper title="Additional Section" description="Extra records (usually glue A/AAAA records for nameservers, or OPT for EDNS)." side="bottom">
                <span className="text-muted-foreground/60 cursor-help">AR: <span className="text-foreground/80 font-semibold tabular-nums">{result.header.arcount}</span></span>
              </TooltipWrapper>

              {result.edns && (
                <>
                  <AppDivider orientation="vertical" size="xs" className="mx-0 opacity-90" />
                  <TooltipWrapper title="EDNS" description={`Extension Mechanisms for DNS v${result.edns.version}. UDP payload ${result.edns.udp_payload_size} bytes.${result.edns.dnssec_ok ? " DNSSEC OK (DO) flag set." : ""}`} side="bottom">
                    <span className="text-muted-foreground/60 cursor-help">
                      EDNS{result.edns.version} · {result.edns.udp_payload_size}B
                      {result.edns.dnssec_ok && <span className="text-success/60 ml-1">DO</span>}
                    </span>
                  </TooltipWrapper>
                </>
              )}
            </div>
          </div>

          {/* Structured record tables */}
          {result.answer.length > 0 && (
            <RecordSection title="Answer" records={result.answer} color="emerald" />
          )}
          {result.authority.length > 0 && (
            <RecordSection title="Authority" records={result.authority} color="blue" />
          )}
          {result.additional.length > 0 && (
            <RecordSection title="Additional" records={result.additional} color="muted" />
          )}

          {/* Raw dig output */}
          <div className="rounded-lg overflow-hidden shadow-card">
            <div className="flex items-center gap-2 px-4 py-2 bg-muted/10 border-b border-border/20">
              <Terminal className="h-3 w-3 text-muted-foreground/60" />
              <span className="section-label-sm">Raw Output</span>
              <TooltipWrapper title="Raw Dig Output" description="Complete dig-style output including all sections, TTLs, and the query footer — identical to what the dig command would show." side="right">
                <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help" />
              </TooltipWrapper>
              <button type="button" onClick={handleCopy} className="ml-auto flex items-center gap-1 text-2xs text-muted-foreground/60 hover:text-muted-foreground transition-smooth">
                {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="px-4 py-3 text-2xs font-mono leading-relaxed overflow-x-auto max-h-[320px] overflow-y-auto text-muted-foreground/70 bg-background/30">
              {result.dig_output}
            </pre>
          </div>
        </div>
      )}

      {/* ── Idle state ──────────────────────────────────── */}
      {!result && !running && !dig.error && (
        <EmptyState
          variant="inline"
          icon={<Terminal />}
          title="Ready to run Dig"
          description="Enter a domain and record type above, then run Dig for full raw DNS diagnostics."
          className="h-full min-h-0 p-6"
        />
      )}
    </div>
  );
}

// ── Record section table ────────────────────────────────────────

function RecordSection({ title, records, color }: {
  title: string;
  records: { name: string; ttl: number; class: string; record_type: string; data: string }[];
  color: "emerald" | "blue" | "muted";
}) {
  const dotColor = color === "emerald" ? "bg-success" : color === "blue" ? "bg-primary" : "bg-muted-foreground/30";
  const headerColor = color === "emerald" ? "text-success/60" : color === "blue" ? "text-primary/70" : "text-muted-foreground/60";

  return (
    <div className="rounded-lg overflow-hidden shadow-card">
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/10 border-b border-border/20">
        <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
        <span className={cn("section-label-sm", headerColor)}>{title} Section</span>
        <span className="text-3xs text-muted-foreground/60 tabular-nums">{records.length} record{records.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="divide-y divide-border/20">
        {records.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_1fr] gap-x-4 items-baseline px-4 py-1.5 hover:bg-muted/10 transition-smooth">
            <span className="text-xs font-mono text-muted-foreground/60 truncate">{r.name}</span>
            <TooltipWrapper title="TTL" description={`Time to live: ${r.ttl} seconds (${formatTtl(r.ttl)}). Caching resolvers will store this record for this duration.`} side="bottom">
              <span className="text-2xs font-mono tabular-nums text-muted-foreground/60 cursor-help">{r.ttl}</span>
            </TooltipWrapper>
            <Badge variant="secondary" className="text-3xs px-1 py-0 h-4 font-mono">{r.record_type}</Badge>
            <span className="text-xs font-mono text-foreground/80 truncate">{r.data}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
