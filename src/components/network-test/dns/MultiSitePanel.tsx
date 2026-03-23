import { useState } from "react";
import { useDnsTestStore } from "@/stores/dnsTestStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Loader2, Play, Network, Check, X } from "@/lib/icons";
import type { MultiSiteConfig } from "@/types/dns";

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

export default function MultiSitePanel() {
  const { multiSite, runMultiSite } = useDnsTestStore();
  const [target, setTarget] = useState("");
  const [testType, setTestType] = useState<"lookup" | "sip_resolve" | "reverse" | "dig">("lookup");
  const [recordType, setRecordType] = useState("A");
  const [server, setServer] = useState("");
  const [includeLocal, setIncludeLocal] = useState(true);

  const running = multiSite.status === "running";
  const result = multiSite.result;

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
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-info" />
        <div>
          <h3 className="text-sm font-medium">Multi-Site DNS Comparison</h3>
          <p className="text-2xs text-muted-foreground">Run DNS tests across connected remote agents and local</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <AppDropdown
          value={testType}
          onValueChange={(v) => setTestType(v as any)}
          options={[...MULTI_SITE_TEST_OPTIONS]}
          className="h-8 w-[120px] text-xs"
          itemClassName="text-xs"
        />
        <Input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={testType === "reverse" ? "IP address" : "Domain"}
          className="h-8 text-xs flex-1 min-w-[120px]"
          disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && handleRun()}
        />
        {(testType === "lookup" || testType === "dig") && (
          <AppDropdown
            value={recordType}
            onValueChange={setRecordType}
            options={MULTI_SITE_RECORD_OPTIONS}
            className="h-8 w-[70px] text-xs"
            itemClassName="text-xs"
          />
        )}
        <Input
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder="DNS server"
          className="h-8 text-xs w-[130px]"
          disabled={running}
        />
        <div className="flex items-center gap-1">
          <Switch checked={includeLocal} onCheckedChange={setIncludeLocal} className="scale-[0.65]" />
          <span className="text-2xs text-muted-foreground">Local</span>
        </div>
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={handleRun} disabled={running || !target.trim()}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Compare
        </Button>
      </div>

      {multiSite.error && !result && (
        <p className="text-xs text-destructive">{multiSite.error}</p>
      )}

      {result && (
        <div className="space-y-2">
          <div className="text-2xs text-muted-foreground tabular-nums">
            {result.results.length} site{result.results.length !== 1 ? "s" : ""} · {result.total_ms.toFixed(0)}ms
          </div>

          <div className="ui-hero-surface divide-y divide-border/20 overflow-hidden">
            {result.results.map((site, i) => (
              <div key={i} className="px-3 py-2 flex items-center gap-3">
                <div className="w-32 shrink-0">
                  <div className="text-xs font-medium">{site.source}</div>
                  {site.agent_id && (
                    <div className="text-3xs text-muted-foreground font-mono truncate">{site.agent_id.slice(0, 8)}</div>
                  )}
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
                  <span className="text-2xs text-muted-foreground tabular-nums shrink-0">
                    {site.latency_ms.toFixed(0)}ms
                  </span>
                )}
                {site.command_id && !site.result && (
                  <span className="text-3xs text-muted-foreground/60 italic">pending response</span>
                )}
              </div>
            ))}
          </div>

          {result.discrepancies.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-2xs font-medium text-warning uppercase">Discrepancies</h4>
              {result.discrepancies.map((d, i) => (
                <div key={i} className="text-2xs text-muted-foreground">
                  <Badge variant={d.severity === "error" ? "destructive" : "secondary"} className="text-3xs px-1 py-0 h-3.5 mr-1">
                    {d.severity}
                  </Badge>
                  {d.description}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
