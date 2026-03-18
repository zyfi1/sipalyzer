import { useState, useCallback } from "react";
import { networkDevicesOuiLookup, networkDevicesOuiLookupBatch, type OuiLookupResult } from "@/api/networkDevices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Loader2, Search, Tag, Trash2 } from "@/lib/icons";
import { cn } from "@/lib/utils";

export default function OuiLookupPanel() {
  const [mac, setMac] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<OuiLookupResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async () => {
    const input = mac.trim();
    if (!input) return;

    setRunning(true);
    setError(null);

    try {
      const lines = input
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      let newResults: OuiLookupResult[];
      if (lines.length === 1) {
        const r = await networkDevicesOuiLookup(lines[0]!);
        newResults = [r];
      } else {
        newResults = await networkDevicesOuiLookupBatch(lines);
      }

      setResults((prev) => [...newResults, ...prev]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [mac]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-medium">OUI / Vendor Lookup</h3>
          <p className="text-2xs text-muted-foreground">
            Identify the manufacturer from a MAC address using the IEEE OUI database (39k+ entries)
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TooltipWrapper
          title="MAC Address"
          description="Enter one or more MAC addresses (comma or newline separated). Supports AA:BB:CC:DD:EE:FF, AA-BB-CC, or AABB.CCDD.EEFF formats. Only the first 3 octets (OUI prefix) are needed."
          side="bottom"
        >
          <Input
            value={mac}
            onChange={(e) => setMac(e.target.value)}
            placeholder="AA:BB:CC:DD:EE:FF — enter MAC address(es)"
            className="h-8 text-xs flex-1 min-w-[200px] font-mono"
            disabled={running}
            onKeyDown={(e) => e.key === "Enter" && !running && mac.trim() && lookup()}
          />
        </TooltipWrapper>
        <TooltipWrapper title="Look Up Vendor" description="Query the IEEE OUI database for the vendor associated with this MAC prefix." side="bottom">
          <Button
            size="sm"
            className="h-8 gap-1.5 px-4 text-xs"
            onClick={lookup}
            disabled={running || !mac.trim()}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Lookup
          </Button>
        </TooltipWrapper>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">
              Results ({results.length})
            </span>
            <button
              onClick={() => setResults([])}
              className="text-2xs text-muted-foreground/60 hover:text-destructive transition-smooth flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>

          <div className="ui-hero-surface border border-border/20 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/20 text-muted-foreground/70">
                  <th className="text-left py-2 px-3 font-medium">MAC Address</th>
                  <th className="text-left py-2 px-3 font-medium">OUI Prefix</th>
                  <th className="text-left py-2 px-3 font-medium">Vendor / Manufacturer</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={`${r.mac}-${i}`}
                    className={cn(
                      "border-b border-border/20 last:border-b-0",
                      i === 0 && "bg-primary/[0.02]",
                    )}
                  >
                    <td className="py-2.5 px-3 font-mono text-foreground/90">{r.mac}</td>
                    <td className="py-2.5 px-3 font-mono text-muted-foreground">{r.prefix || "—"}</td>
                    <td className="py-2.5 px-3">
                      {r.vendor ? (
                        <span className="text-foreground font-medium">{r.vendor}</span>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="text-3xs px-1.5 py-0 h-4 bg-muted/20 text-muted-foreground/60"
                        >
                          Unknown
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results.length === 0 && !error && !running && (
        <div className="py-6 text-center space-y-1">
          <Tag className="h-5 w-5 text-muted-foreground/60 mx-auto" />
          <p className="text-xs text-muted-foreground/60">
            Enter a MAC address to identify its manufacturer
          </p>
          <p className="text-2xs text-muted-foreground/60">
            Supports batch lookup — separate multiple MACs with commas
          </p>
        </div>
      )}
    </div>
  );
}
