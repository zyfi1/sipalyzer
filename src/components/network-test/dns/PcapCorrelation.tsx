import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { DnsCorrelation } from "@/types/dns";

interface PcapCorrelationProps {
  correlation: DnsCorrelation | null;
}

export default function PcapCorrelation({ correlation }: PcapCorrelationProps) {
  if (!correlation) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <span>Domain: <span className="font-mono text-foreground">{correlation.query_domain}</span></span>
        {correlation.query_type && <span>· Type: <span className="font-mono">{correlation.query_type}</span></span>}
        <span>· {correlation.packets_scanned} packets scanned</span>
        <span>· {correlation.matched_packets.length} matched</span>
      </div>

      {correlation.discrepancies.length > 0 && (
        <div className="space-y-1">
          {correlation.discrepancies.map((d, i) => (
            <div key={i} className="flex items-start gap-1.5 text-2xs">
              <Badge
                variant={d.severity === "error" ? "destructive" : "secondary"}
                className="text-3xs px-1 py-0 h-3.5 mt-0.5 shrink-0"
              >
                {d.severity}
              </Badge>
              <span className="text-muted-foreground">{d.description}</span>
            </div>
          ))}
        </div>
      )}

      {correlation.matched_packets.length > 0 && (
        <div className="ui-hero-surface divide-y divide-border/20 overflow-hidden max-h-60 overflow-y-auto">
          {correlation.matched_packets.map((pkt, i) => (
            <div key={i} className="px-3 py-1.5 text-2xs font-mono flex items-center gap-2">
              <span className="text-muted-foreground/60 w-6 text-right">#{pkt.packet_index}</span>
              <Badge
                variant={pkt.is_response ? "secondary" : "outline"}
                className="text-3xs px-1 py-0 h-3.5 shrink-0"
              >
                {pkt.is_response ? "RESP" : "QUERY"}
              </Badge>
              <span className="text-muted-foreground">
                {pkt.src_ip}:{pkt.src_port} → {pkt.dst_ip}:{pkt.dst_port}
              </span>
              <span className="text-muted-foreground/60">ID: 0x{pkt.transaction_id.toString(16).padStart(4, "0")}</span>
              {pkt.response_code != null && pkt.response_code !== 0 && (
                <Badge variant="destructive" className="text-3xs px-1 py-0 h-3.5 shrink-0">
                  RCODE {pkt.response_code}
                </Badge>
              )}
              {pkt.answers.length > 0 && (
                <span className="text-muted-foreground/60">{pkt.answers.length} ans</span>
              )}
            </div>
          ))}
        </div>
      )}

      {correlation.matched_packets.length === 0 && (
        <EmptyState
          variant="inline"
          title="No matching DNS packets"
          description="No DNS packets found in this capture."
          className="h-full min-h-0 p-6"
        />
      )}
    </div>
  );
}
