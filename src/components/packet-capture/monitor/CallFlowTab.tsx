/**
 * CallFlowTab - Wrapper component for SIP call flow visualization.
 * 
 * Filters packets to SIP only, groups by Call-ID, and displays
 * call flow diagrams with selection callbacks.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Phone, Search, AlertTriangle, XCircle, ExternalLink } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { IpAddress } from "@/components/ui/IpAddress";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { PanelResizeHandle } from "@/components/ui/panel-chrome";
import type { PacketInfo, ExpertFinding } from "@/types/packetCapture";

/** Extract SIP info from a packet's decoded application layer */
function getSipInfo(packet: PacketInfo): { callId: string; method?: string; statusCode?: number; fromUri?: string; toUri?: string } | null {
  if (packet.protocol !== "SIP") return null;
  
  const app = packet.decoded?.application;
  if (!app) return null;
  
  // Handle both "Sip" and "SipOverWs" types
  let sipData: any = null;
  if (app.type === "Sip") {
    sipData = app.data;
  } else if (app.type === "SipOverWs") {
    sipData = (app.data as any)?.sip;
  }
  
  if (!sipData) return null;
  
  // Extract info from ParsedSipMessage structure
  const callId = sipData.callId || sipData.headers?.["call-id"]?.[0] || null;
  if (!callId) return null;
  
  const method = sipData.method || sipData.requestLine?.method;
  const statusCode = sipData.statusCode || sipData.statusLine?.statusCode;
  const fromUri = sipData.from || sipData.headers?.from?.[0];
  const toUri = sipData.to || sipData.headers?.to?.[0];
  
  return { callId, method, statusCode, fromUri, toUri };
}

/** Get color for SIP method (bg + text-*-foreground for contrast) */
function getSipMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "INVITE":
      return "bg-success text-success-foreground";
    case "BYE":
    case "CANCEL":
      return "bg-destructive text-destructive-foreground";
    case "ACK":
      return "bg-info text-info-foreground";
    case "200":
      return "bg-success text-success-foreground";
    case "180":
    case "183":
      return "bg-info text-info-foreground";
    case "100":
      return "bg-muted text-muted-foreground";
    case "486":
    case "487":
    case "488":
      return "bg-warning text-warning-foreground";
    default:
      if (method.startsWith("1")) return "bg-muted text-muted-foreground";
      if (method.startsWith("2")) return "bg-success text-success-foreground";
      if (method.startsWith("3")) return "bg-warning text-warning-foreground";
      if (method.startsWith("4")) return "bg-warning text-warning-foreground";
      if (method.startsWith("5")) return "bg-destructive text-destructive-foreground";
      if (method.startsWith("6")) return "bg-destructive text-destructive-foreground";
      return "bg-info text-info-foreground";
  }
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

interface SipCall {
  callId: string;
  packets: PacketInfo[];
  fromUri: string;
  toUri: string;
  startTime: string;
  endTime: string;
  status: "active" | "completed" | "failed";
}

interface CallFlowTabProps {
  packets: PacketInfo[];
  onSelectPacket: (packet: PacketInfo) => void;
  findings?: ExpertFinding[];
  /** Open the parent tabbed popout (Details/Stats/Flows/RTP/Diagnostics) when available. */
  onOpenTabbedPopout?: () => void;
}

export function CallFlowTab({ packets, onSelectPacket, findings, onOpenTabbedPopout }: CallFlowTabProps) {
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [splitPercent, setSplitPercent] = useState(42);
  const [resizing, setResizing] = useState(false);
  const [popoutOpen, setPopoutOpen] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  
  // Group SIP packets by Call-ID
  const sipCalls = useMemo(() => {
    const callMap = new Map<string, SipCall>();
    
    for (const packet of packets) {
      const sipInfo = getSipInfo(packet);
      if (!sipInfo) continue;
      
      const { callId, method, statusCode, fromUri, toUri } = sipInfo;
      
      const existing = callMap.get(callId);
      if (existing) {
        existing.packets.push(packet);
        existing.endTime = packet.timestamp;
        
        // Update status based on methods
        const upperMethod = method?.toUpperCase();
        
        if (upperMethod === "BYE" || (statusCode === 200 && existing.packets.some(p => getSipInfo(p)?.method === "BYE"))) {
          existing.status = "completed";
        } else if (statusCode && statusCode >= 400) {
          existing.status = "failed";
        }
      } else {
        callMap.set(callId, {
          callId,
          packets: [packet],
          fromUri: fromUri || packet.srcIp,
          toUri: toUri || packet.dstIp,
          startTime: packet.timestamp,
          endTime: packet.timestamp,
          status: "active",
        });
      }
    }
    
    // Sort by start time (most recent first)
    return Array.from(callMap.values()).sort((a, b) => 
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }, [packets]);
  
  // Filter calls by search
  const filteredCalls = useMemo(() => {
    if (!searchFilter.trim()) return sipCalls;
    
    const search = searchFilter.toLowerCase();
    return sipCalls.filter(call =>
      call.callId.toLowerCase().includes(search) ||
      call.fromUri.toLowerCase().includes(search) ||
      call.toUri.toLowerCase().includes(search)
    );
  }, [sipCalls, searchFilter]);
  
  // Get selected call
  const selectedCall = useMemo(() => {
    if (!selectedCallId) return null;
    return sipCalls.find(c => c.callId === selectedCallId) || null;
  }, [sipCalls, selectedCallId]);
  
  // Handle packet click in ladder
  const handlePacketClick = useCallback((packet: PacketInfo) => {
    onSelectPacket(packet);
  }, [onSelectPacket]);

  const handleOpenPopout = useCallback(() => {
    if (onOpenTabbedPopout) {
      onOpenTabbedPopout();
      return;
    }
    setPopoutOpen(true);
  }, [onOpenTabbedPopout]);

  useEffect(() => {
    if (!resizing) return;

    const handlePointerMove = (e: PointerEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(72, Math.max(28, pct));
      setSplitPercent(clamped);
    };

    const handlePointerUp = () => setResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizing]);
  
  if (sipCalls.length === 0) {
    return (
      <EmptyState
        variant="inline"
        title="No SIP signaling detected"
        description="INVITE, REGISTER, and other SIP dialogs will appear here when present in the capture."
        className="h-full p-6"
      />
    );
  }
  
  return (
    <div className="surface-flat flex h-full flex-col">
      {/* Header / Controls */}
      <div className="ui-section-header-sm flex items-center gap-2">
        <TooltipWrapper entry={tooltips.captureCallFlowSearch}>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search SIP dialogs by Call-ID, party, method…"
              className="ui-control-shell h-8 pl-8 text-xs"
            />
          </div>
        </TooltipWrapper>
        <Badge variant="secondary" className="h-5 px-1.5 text-2xs text-muted-foreground">
          {filteredCalls.length} {filteredCalls.length === 1 ? "dialog" : "dialogs"}
        </Badge>
        <TooltipWrapper content="Open selected call flow in a popout panel">
          <button
            type="button"
            className="ui-control-shell inline-flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-xs text-foreground"
            onClick={handleOpenPopout}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Pop Out
          </button>
        </TooltipWrapper>
      </div>
      
      {/* Two-panel view: Call list + Ladder */}
      <div ref={splitContainerRef} className={cn("flex min-h-0 flex-1", resizing && "cursor-col-resize select-none")}>
        {/* Call List */}
        <div className="overflow-auto" style={{ width: `${splitPercent}%` }}>
          <div className="space-y-1 p-2">
            {filteredCalls.map((call) => (
              <button
                key={call.callId}
                onClick={() => setSelectedCallId(call.callId)}
                className={cn(
                  "w-full rounded-md border px-2 py-1.5 text-left text-xs transition-smooth",
                  selectedCallId === call.callId
                    ? "border-border/65 surface-subtle text-foreground"
                    : "border-border/35 surface-flat text-muted-foreground hover:border-border/55 hover:bg-muted/30 hover:text-foreground"
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <Phone className="h-3 w-3 flex-none" />
                  <span className="font-mono truncate flex-1">{call.callId.slice(0, 20)}...</span>
                  <Badge
                    variant={
                      call.status === "completed" ? "secondary" :
                      call.status === "failed" ? "destructive" :
                      "default"
                    }
                    className="h-4 px-1 text-3xs"
                  >
                    {call.status}
                  </Badge>
                </div>
                <div className="text-muted-foreground truncate">
                  {call.fromUri} → {call.toUri}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  {call.packets.length} messages
                </div>
              </button>
            ))}
          </div>
        </div>

        <TooltipWrapper content="Drag this divider to resize panes">
          <PanelResizeHandle
            orientation="vertical"
            density="compact"
            appearance="rail"
            decor="dots"
            label="Resize call list and flow panes"
            className="surface-subtle shrink-0 rounded-none"
            onPointerDown={(e) => {
              e.preventDefault();
              setResizing(true);
            }}
            onDoubleClick={() => setSplitPercent(42)}
          />
        </TooltipWrapper>

        {/* Ladder Diagram */}
        <div className="min-w-0 flex-1 overflow-auto">
          {selectedCall ? (
            <div className="p-2.5">
              <div className="mb-2 flex items-center justify-between border-b border-border/40 pb-1.5 text-xs font-medium">
                <span>Call Flow</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">
                    {selectedCall.packets.length} msgs
                  </span>
                  <button
                    type="button"
                    className="ui-control-shell inline-flex h-6 items-center gap-1 px-2 text-2xs"
                    onClick={handleOpenPopout}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Pop Out
                  </button>
                </div>
              </div>
              
              {/* Endpoints header */}
              <div className="flex justify-between mb-2 text-xs text-muted-foreground px-4">
                <IpAddress ip={selectedCall.packets[0]?.srcIp || ""} size="sm" variant="mono" showCopyOnHover={false} />
                <IpAddress ip={selectedCall.packets[0]?.dstIp || ""} size="sm" variant="mono" showCopyOnHover={false} />
              </div>
              
              {/* Vertical lines */}
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                <div className="absolute right-4 top-0 bottom-0 w-px bg-border" />
                
                {/* Messages */}
                <div className="space-y-1.5 py-2">
                  {selectedCall.packets.map((packet, idx) => {
                    const sipInfo = getSipInfo(packet);
                    const method = sipInfo?.method || (sipInfo?.statusCode?.toString() ?? "SIP");
                    const srcIp = packet.srcIp;
                    const firstPacketSrc = selectedCall.packets[0]?.srcIp;
                    const isLeftToRight = srcIp === firstPacketSrc;

                    const packetGlobalIdx = packets.indexOf(packet);
                    const findingsForPacket = (findings ?? []).filter((f) =>
                      f.evidence.some((e) => e.packetIndices.includes(packetGlobalIdx))
                    );

                    const findingIcon = findingsForPacket.length > 0 && (
                      <TooltipWrapper content={findingsForPacket.map((f) => f.title).join(", ")}>
                        <span className="flex-none mx-0.5">
                          {findingsForPacket.some((f) => f.severity === "critical")
                            ? <XCircle className="h-3 w-3 text-destructive" />
                            : <AlertTriangle className="h-3 w-3 text-warning" />
                          }
                        </span>
                      </TooltipWrapper>
                    );

                    return (
                      <button
                        key={idx}
                        onClick={() => handlePacketClick(packet)}
                        className="w-full rounded-md border border-transparent px-4 py-1.5 transition-smooth hover:border-border/35 hover:bg-muted/30"
                      >
                        {isLeftToRight ? (
                          <>
                            <div className="w-2 h-2 rounded-full bg-border flex-none" />
                            <div className="flex-1 flex items-center">
                              <div className="flex-1 h-px bg-border relative">
                                <div
                                  className="absolute right-0 top-1/2 -translate-y-1/2 -translate-x-1 border-t-4 border-t-transparent border-b-4 border-b-transparent border-l-[6px] border-l-muted-foreground"
                                />
                              </div>
                              <TooltipWrapper entry={getSipMethodTooltip(method)}>
                                <Badge
                                  className={cn(
                                    "text-2xs px-1.5 py-0 mx-2 cursor-help",
                                    getSipMethodColor(method)
                                  )}
                                >
                                  {method}
                                </Badge>
                              </TooltipWrapper>
                              {findingIcon}
                            </div>
                            <div className="w-2 h-2 rounded-full bg-foreground flex-none" />
                          </>
                        ) : (
                          <>
                            <div className="w-2 h-2 rounded-full bg-foreground flex-none" />
                            <div className="flex-1 flex items-center">
                              {findingIcon}
                              <TooltipWrapper entry={getSipMethodTooltip(method)}>
                                <Badge
                                  className={cn(
                                    "text-2xs px-1.5 py-0 mx-2 cursor-help",
                                    getSipMethodColor(method)
                                  )}
                                >
                                  {method}
                                </Badge>
                              </TooltipWrapper>
                              <div className="flex-1 h-px bg-border relative">
                                <div
                                  className="absolute left-0 top-1/2 -translate-y-1/2 translate-x-1 border-t-4 border-t-transparent border-b-4 border-b-transparent border-r-[6px] border-r-muted-foreground"
                                />
                              </div>
                            </div>
                            <div className="w-2 h-2 rounded-full bg-border flex-none" />
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Related findings summary */}
              {(() => {
                const relatedFindings = (findings ?? []).filter(
                  (f) => f.relatedCallId === selectedCall.callId
                );
                if (relatedFindings.length === 0) return null;
                return (
                    <div className="surface-subtle mt-3 space-y-1 rounded-md border border-border/45 p-2">
                    <div className="text-2xs font-medium text-muted-foreground">Related Findings</div>
                    {relatedFindings.map((f) => {
                      const Icon = f.severity === "critical" ? XCircle : AlertTriangle;
                      const color = f.severity === "critical" ? "text-destructive" : "text-warning";
                      return (
                        <div key={f.id} className="flex items-center gap-1.5 text-xs">
                          <Icon className={cn("h-3 w-3 shrink-0", color)} />
                          <span className="truncate">{f.title}</span>
                          {f.count > 1 && (
                            <Badge variant="secondary" className="text-3xs ml-auto shrink-0">{f.count}</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          ) : (
            <EmptyState
              variant="inline"
              title="Select a SIP dialog to view flow"
              className="h-full p-6"
            />
          )}
        </div>
      </div>
      <div className="surface-subtle flex items-center justify-between border-t border-border/40 px-2.5 py-1.5">
        <span className="text-2xs text-muted-foreground">Tip: drag the center divider to resize panes.</span>
        <Button
          type="button"
          size="sm"
          variant="neutral"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={handleOpenPopout}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Pop Out
        </Button>
      </div>

      {!onOpenTabbedPopout && (
      <Dialog open={popoutOpen} onOpenChange={setPopoutOpen}>
        <DialogContent className="graphite-modal-content w-[min(95vw,1360px)] max-w-[min(95vw,1360px)] h-[85vh] max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="ui-section-header-md flex-shrink-0">
            <DialogTitle className="text-sm font-semibold">
              {selectedCall ? `Call Flow · ${selectedCall.callId}` : "Call Flow"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {selectedCall ? (
              <div className="mx-auto w-full max-w-[1100px]">
                {/* Endpoints header */}
                <div className="mb-2 flex justify-between px-4 text-xs text-muted-foreground">
                  <IpAddress ip={selectedCall.packets[0]?.srcIp || ""} size="sm" variant="mono" showCopyOnHover={false} />
                  <IpAddress ip={selectedCall.packets[0]?.dstIp || ""} size="sm" variant="mono" showCopyOnHover={false} />
                </div>
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                  <div className="absolute right-4 top-0 bottom-0 w-px bg-border" />
                  <div className="space-y-1.5 py-2">
                    {selectedCall.packets.map((packet, idx) => {
                      const sipInfo = getSipInfo(packet);
                      const method = sipInfo?.method || (sipInfo?.statusCode?.toString() ?? "SIP");
                      const srcIp = packet.srcIp;
                      const firstPacketSrc = selectedCall.packets[0]?.srcIp;
                      const isLeftToRight = srcIp === firstPacketSrc;
                      const packetGlobalIdx = packets.indexOf(packet);
                      const findingsForPacket = (findings ?? []).filter((f) =>
                        f.evidence.some((e) => e.packetIndices.includes(packetGlobalIdx))
                      );
                      const findingIcon = findingsForPacket.length > 0 && (
                        <TooltipWrapper content={findingsForPacket.map((f) => f.title).join(", ")}>
                          <span className="flex-none mx-0.5">
                            {findingsForPacket.some((f) => f.severity === "critical")
                              ? <XCircle className="h-3 w-3 text-destructive" />
                              : <AlertTriangle className="h-3 w-3 text-warning" />
                            }
                          </span>
                        </TooltipWrapper>
                      );

                      return (
                        <button
                          key={idx}
                          onClick={() => handlePacketClick(packet)}
                          className="w-full rounded-md border border-transparent px-4 py-1.5 transition-smooth hover:border-border/35 hover:bg-muted/30"
                        >
                          {isLeftToRight ? (
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-border flex-none" />
                              <div className="flex-1 flex items-center">
                                <div className="flex-1 h-px bg-border relative">
                                  <div className="absolute right-0 top-1/2 -translate-y-1/2 -translate-x-1 border-t-4 border-t-transparent border-b-4 border-b-transparent border-l-[6px] border-l-muted-foreground" />
                                </div>
                                <TooltipWrapper entry={getSipMethodTooltip(method)}>
                                  <Badge className={cn("text-2xs px-1.5 py-0 mx-2 cursor-help", getSipMethodColor(method))}>
                                    {method}
                                  </Badge>
                                </TooltipWrapper>
                                {findingIcon}
                              </div>
                              <div className="w-2 h-2 rounded-full bg-foreground flex-none" />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-foreground flex-none" />
                              <div className="flex-1 flex items-center">
                                {findingIcon}
                                <TooltipWrapper entry={getSipMethodTooltip(method)}>
                                  <Badge className={cn("text-2xs px-1.5 py-0 mx-2 cursor-help", getSipMethodColor(method))}>
                                    {method}
                                  </Badge>
                                </TooltipWrapper>
                                <div className="flex-1 h-px bg-border relative">
                                  <div className="absolute left-0 top-1/2 -translate-y-1/2 translate-x-1 border-t-4 border-t-transparent border-b-4 border-b-transparent border-r-[6px] border-r-muted-foreground" />
                                </div>
                              </div>
                              <div className="w-2 h-2 rounded-full bg-border flex-none" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                variant="inline"
                title="Select a dialog in the list"
                description="Then pop out to expand it."
                className="h-full p-6"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      )}
    </div>
  );
}

export default CallFlowTab;
