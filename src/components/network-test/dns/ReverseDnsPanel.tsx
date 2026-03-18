import { useDnsTestStore } from "@/stores/dnsTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Search, ArrowLeft, Check, X } from "@/lib/icons";

export default function ReverseDnsPanel() {
  const {
    reverse, reverseIp, reverseServer, reverseFcrdns,
    setReverseIp, setReverseServer, setReverseFcrdns, runReverse,
  } = useDnsTestStore();

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext("dns");

  const running = reverse.status === "running";
  const result = reverse.result;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ArrowLeft className="h-4 w-4 text-warning" />
        <div>
          <h3 className="text-sm font-medium">Reverse DNS + FCrDNS</h3>
          <p className="text-2xs text-muted-foreground">PTR lookup with forward-confirmed verification</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={reverseIp}
          onChange={(e) => setReverseIp(e.target.value)}
          placeholder="8.8.8.8"
          className="h-8 text-xs flex-1 min-w-[120px]"
          disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && runReverse(ctx)}
        />
        <Input
          value={reverseServer}
          onChange={(e) => setReverseServer(e.target.value)}
          placeholder="DNS server (optional)"
          className="h-8 text-xs w-[160px]"
          disabled={running}
        />
        <div className="flex items-center gap-1.5">
          <Switch checked={reverseFcrdns} onCheckedChange={setReverseFcrdns} className="scale-75" />
          <span className="text-2xs text-muted-foreground">FCrDNS</span>
        </div>
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runReverse(ctx)} disabled={running || !reverseIp.trim()}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Lookup
        </Button>
      </div>

      {reverse.error && !result && (
        <p className="text-xs text-destructive">{reverse.error}</p>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-2xs text-muted-foreground tabular-nums">
            <span>{result.resolution_ms.toFixed(0)}ms</span>
          </div>

          <div className="ui-hero-surface p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-16 shrink-0">IP</span>
              <span className="font-mono">{result.ip}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-16 shrink-0">PTR</span>
              {result.ptr_hostname ? (
                <span className="font-mono text-foreground">{result.ptr_hostname}</span>
              ) : (
                <span className="text-muted-foreground/60 italic">No PTR record</span>
              )}
            </div>

            {result.fcrdns && (
              <>
                <div className="border-t border-border/20 my-1" />
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-16 shrink-0">FCrDNS</span>
                  {result.fcrdns.confirmed ? (
                    <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-success/10 text-success">
                      <Check className="h-2.5 w-2.5 mr-0.5" /> Confirmed
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-destructive/10 text-destructive">
                      <X className="h-2.5 w-2.5 mr-0.5" /> Mismatch
                    </Badge>
                  )}
                </div>
                {result.fcrdns.forward_ips.length > 0 && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground w-16 shrink-0">Fwd IPs</span>
                    <div className="flex flex-wrap gap-1">
                      {result.fcrdns.forward_ips.map((ip, i) => (
                        <span
                          key={i}
                          className={`font-mono text-2xs px-1.5 py-0.5 rounded ${
                            ip === result.ip
                              ? "bg-success/10 text-success"
                              : "bg-muted/20 text-muted-foreground"
                          }`}
                        >
                          {ip}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {result.fcrdns.mismatch_details && (
                  <p className="text-2xs text-warning/80 pl-18">{result.fcrdns.mismatch_details}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
