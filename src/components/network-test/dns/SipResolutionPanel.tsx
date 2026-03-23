import { useDnsTestStore } from "@/stores/dnsTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Phone, ChevronRight, Check, X } from "@/lib/icons";

export default function SipResolutionPanel() {
  const {
    sipResolve, sipResolveDomain, sipResolveServer,
    setSipResolveDomain, setSipResolveServer, runSipResolve,
  } = useDnsTestStore();

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext("dns");

  const running = sipResolve.status === "running";
  const result = sipResolve.result;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-medium">SIP Resolution (RFC 3263)</h3>
          <p className="text-2xs text-muted-foreground">Full NAPTR → SRV → A/AAAA resolution chain</p>
        </div>
        <TroubleshootLink articleId="dns-config-for-sip" compact />
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={sipResolveDomain}
          onChange={(e) => setSipResolveDomain(e.target.value)}
          placeholder="sip.example.com"
          className="h-8 text-xs flex-1 min-w-[140px]"
          disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && runSipResolve(ctx)}
        />
        <Input
          value={sipResolveServer}
          onChange={(e) => setSipResolveServer(e.target.value)}
          placeholder="DNS server (optional)"
          className="h-8 text-xs w-[160px]"
          disabled={running}
        />
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runSipResolve(ctx)} disabled={running || !sipResolveDomain.trim()}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Resolve
        </Button>
      </div>

      {sipResolve.error && !result && (
        <p className="text-xs text-destructive">{sipResolve.error}</p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            {result.success ? (
              <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-success/10 text-success">
                <Check className="h-2.5 w-2.5 mr-0.5" /> {result.targets.length} target{result.targets.length !== 1 ? "s" : ""}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-destructive/10 text-destructive">
                <X className="h-2.5 w-2.5 mr-0.5" /> No targets
              </Badge>
            )}
            <span className="tabular-nums">{result.total_ms.toFixed(0)}ms total</span>
          </div>

          {/* Resolution steps */}
          <div className="space-y-1">
            {result.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 shrink-0 mt-0.5">
                  {step.step_type}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-muted-foreground truncate">{step.query}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    <span className="tabular-nums text-muted-foreground/60">{step.records_found} rec</span>
                    <span className="tabular-nums text-muted-foreground/60">{step.resolution_ms.toFixed(0)}ms</span>
                  </div>
                  {step.details.length > 0 && (
                    <div className="mt-0.5 pl-1 space-y-0.5">
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

          {/* Final targets */}
          {result.targets.length > 0 && (
            <div>
              <h4 className="text-2xs font-medium text-muted-foreground uppercase mb-1">Resolved Targets (priority order)</h4>
              <div className="ui-hero-surface divide-y divide-border/20 overflow-hidden">
                {result.targets.map((t, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs font-mono flex items-center gap-2">
                    <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 shrink-0">{t.transport}</Badge>
                    <span className="text-foreground">{t.host}:{t.port}</span>
                    <span className="text-muted-foreground/60 ml-auto text-2xs">
                      pri={t.priority} w={t.weight}
                    </span>
                    {t.ip_addresses.length > 0 && (
                      <span className="text-muted-foreground/60 text-2xs">
                        [{t.ip_addresses.join(", ")}]
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
