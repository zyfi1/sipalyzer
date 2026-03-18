import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Phone } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import type { PacketInfo } from "@/types/packetCapture";
import { EmptyState } from "@/components/ui/empty-state";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";

interface SipCallFlowProps {
  packets: PacketInfo[];
}

interface SipTransaction {
  callId: string;
  method: string;
  from: string;
  to: string;
  requests: Array<{ packet: PacketInfo; direction: "request" | "response"; code?: number }>;
}

/** Get tooltip entry for SIP method or status code */
function getSipMethodTooltip(method: string): { title: string; description?: string } {
  const upperMethod = method.toUpperCase();
  
  // Check for SIP method tooltips
  const methodKey = `sipMethod${upperMethod.charAt(0) + upperMethod.slice(1).toLowerCase()}` as keyof typeof tooltips;
  const entry = tooltips[methodKey];
  if (entry && typeof entry === "object" && "title" in entry) {
    return entry as { title: string; description?: string };
  }
  
  // Check for status code ranges
  if (/^\d{3}$/.test(method)) {
    const firstDigit = method[0];
    const rangeKey = `sipResponse${firstDigit}xx` as keyof typeof tooltips;
    const rangeEntry = tooltips[rangeKey];
    if (rangeEntry && typeof rangeEntry === "object" && "title" in rangeEntry) {
      return rangeEntry as { title: string; description?: string };
    }
  }
  
  // Fallback
  return { title: method, description: `SIP ${method}` };
}

export function SipCallFlow({ packets }: SipCallFlowProps) {
  const transactions = useMemo(() => {
    const sipPackets = packets.filter(
      (p) => p.protocol === "SIP" && p.decoded?.application?.type === "Sip"
    );

    const transactionMap = new Map<string, SipTransaction>();

    for (const packet of sipPackets) {
      const app = packet.decoded?.application;
      if (app?.type !== "Sip") continue;

      const callId = app.data.callId || "unknown";
      const method = app.data.method || (app.data.responseCode ? `${app.data.responseCode}` : "UNKNOWN");
      const from = app.data.from || packet.srcIp;
      const to = app.data.to || packet.dstIp;

      if (!transactionMap.has(callId)) {
        transactionMap.set(callId, {
          callId,
          method,
          from,
          to,
          requests: [],
        });
      }

      const transaction = transactionMap.get(callId)!;
      const isRequest = app.data.method !== undefined;
      transaction.requests.push({
        packet,
        direction: isRequest ? "request" : "response",
        code: app.data.responseCode,
      });
    }

    return Array.from(transactionMap.values()).slice(0, 10); // Show top 10
  }, [packets]);

  if (transactions.length === 0) {
    return (
      <Card className="rounded-md border-border/45 bg-card/40 shadow-none">
        <CardContent className="p-4">
          <EmptyState compact variant="inline" title="No SIP transactions found" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-md border-border/45 bg-card/40 shadow-none">
      <CardHeader className="ui-section-header-sm px-3 py-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Phone className="h-4 w-4" />
          SIP Call Flows
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <div className="space-y-2">
          {transactions.map((tx) => (
            <div
              key={tx.callId}
              className="space-y-2 rounded-md border border-border/40 bg-card/50 p-2.5 transition-smooth hover:border-border/55 hover:bg-muted/25"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TooltipWrapper entry={getSipMethodTooltip(tx.method)}>
                    <Badge variant="outline" className="cursor-help border-border/45 bg-muted/25 text-xs">
                      {tx.method}
                    </Badge>
                  </TooltipWrapper>
                  <span className="text-xs text-muted-foreground font-mono">{tx.callId.slice(0, 16)}...</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {tx.requests.length} message{tx.requests.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono">{tx.from}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono">{tx.to}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {tx.requests.map((req, idx) => {
                  const methodOrCode = req.direction === "request"
                    ? req.packet.decoded?.application?.type === "Sip"
                      ? req.packet.decoded.application.data.method || "REQ"
                      : "REQ"
                    : req.code?.toString() || "RSP";
                  const sipCode = req.direction === "response" && req.code != null
                    ? (typeof req.code === "number" ? req.code : parseInt(String(req.code), 10))
                    : null;
                  return (
                    <span key={idx} className="inline-flex items-center gap-1">
                      <TooltipWrapper entry={getSipMethodTooltip(methodOrCode)}>
                        <Badge
                          variant={req.direction === "request" ? "default" : "secondary"}
                          className="cursor-help border border-border/35 text-2xs"
                        >
                          {methodOrCode}
                        </Badge>
                      </TooltipWrapper>
                      {sipCode != null && !Number.isNaN(sipCode) && (
                        <TroubleshootLink sipCode={sipCode} compact />
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
