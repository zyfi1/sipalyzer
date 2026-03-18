import { useState } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { StandardEditMenuItems } from "@/components/context-menu";
import {
  Filter,
  Copy,
  Link2,
  Network,
  ArrowRightLeft,
  Download,
  BarChart3,
  Palette,
  Search,
  X,
  Hash,
  Globe,
  Server,
  User,
  Phone,
  FileText,
  Layers,
  GitBranch,
} from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import type { PacketInfo } from "@/types/packetCapture";

interface PacketContextMenuProps {
  packet: PacketInfo;
  packetIndex: number;
  children: React.ReactNode;
  onApplyFilter?: (filter: string) => void;
  onPrepareFilter?: (filter: string) => void;
  onCopy?: (text: string) => void;
  onFollowStream?: (packet: PacketInfo) => void;
  onFollowConversation?: (packet: PacketInfo) => void;
  onColorize?: (packetIndex: number, color: string) => void;
  onShowStatistics?: (packet: PacketInfo) => void;
  onExport?: (packet: PacketInfo) => void;
  /** When set and packet is SIP, opens this capture in Forensics SIP Ladder view. */
  onOpenInSipLadder?: () => void;
}

export function PacketContextMenu({
  packet,
  packetIndex,
  children,
  onApplyFilter,
  onPrepareFilter,
  onCopy,
  onFollowStream,
  onFollowConversation,
  onColorize,
  onShowStatistics,
  onExport,
  onOpenInSipLadder,
}: PacketContextMenuProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, field: string) => {
    if (onCopy) {
      onCopy(text);
    } else {
      navigator.clipboard.writeText(text);
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const buildFilter = (type: string, value: string, operator: "==" | "!=" = "=="): string => {
    switch (type) {
      case "ip.addr":
        return `ip.addr ${operator} ${value}`;
      case "ip.src":
        return `ip.src ${operator} ${value}`;
      case "ip.dst":
        return `ip.dst ${operator} ${value}`;
      case "tcp.port":
        return `tcp.port ${operator} ${value}`;
      case "udp.port":
        return `udp.port ${operator} ${value}`;
      case "tcp.srcport":
        return `tcp.srcport ${operator} ${value}`;
      case "tcp.dstport":
        return `tcp.dstport ${operator} ${value}`;
      case "udp.srcport":
        return `udp.srcport ${operator} ${value}`;
      case "udp.dstport":
        return `udp.dstport ${operator} ${value}`;
      case "protocol":
        return value.toLowerCase();
      case "frame.len":
        return `frame.len ${operator} ${packet.size}`;
      default:
        return value;
    }
  };

  const handleApplyFilter = (filter: string) => {
    if (onApplyFilter) {
      onApplyFilter(filter);
    }
  };

  const handlePrepareFilter = (filter: string) => {
    if (onPrepareFilter) {
      onPrepareFilter(filter);
    }
  };

  const hasTcp = packet.protocol === "TCP" || packet.decoded?.tcp;
  const hasUdp = packet.protocol === "UDP" || packet.decoded?.udp;
  const hasSip = packet.protocol === "SIP" || packet.decoded?.application?.type === "Sip";
  const hasPorts = packet.srcPort > 0 && packet.dstPort > 0;
  
  // Type guard for SIP data
  const getSipData = () => {
    if (packet.decoded?.application?.type === "Sip") {
      return packet.decoded.application.data;
    }
    return null;
  };
  
  const sipData = getSipData();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <StandardEditMenuItems />
        {/* Apply as Filter */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Filter className="h-4 w-4 mr-2" />
            Apply as Filter
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("ip.addr", packet.srcIp))}>
              <Network className="h-3.5 w-3.5 mr-2" />
              Source IP (ip.addr)
              <ContextMenuShortcut>ip.addr</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("ip.addr", packet.dstIp))}>
              <Network className="h-3.5 w-3.5 mr-2" />
              Destination IP (ip.addr)
              <ContextMenuShortcut>ip.addr</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => {
              // Conversation filter: packets between these two IPs
              const filter = `(ip.src == ${packet.srcIp} && ip.dst == ${packet.dstIp}) || (ip.src == ${packet.dstIp} && ip.dst == ${packet.srcIp})`;
              handleApplyFilter(filter);
            }}>
              <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
              <TooltipWrapper entry={tooltips.filterConversation} side="left"><span className="cursor-help">Conversation (Both IPs)</span></TooltipWrapper>
              <ContextMenuShortcut>conversation</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("ip.src", packet.srcIp))}>
              <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
              Source IP Only
              <ContextMenuShortcut>ip.src</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("ip.dst", packet.dstIp))}>
              <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
              Destination IP Only
              <ContextMenuShortcut>ip.dst</ContextMenuShortcut>
            </ContextMenuItem>
            {hasPorts && (
              <>
                <ContextMenuSeparator />
                {hasTcp && (
                  <>
                    <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("tcp.srcport", packet.srcPort.toString()))}>
                      <Hash className="h-3.5 w-3.5 mr-2" />
                      TCP Source Port
                      <ContextMenuShortcut>tcp.srcport</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("tcp.dstport", packet.dstPort.toString()))}>
                      <Hash className="h-3.5 w-3.5 mr-2" />
                      TCP Destination Port
                      <ContextMenuShortcut>tcp.dstport</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      // Stream filter: packets in this TCP stream (includes IPs and ports)
                      const filter = `tcp && ((ip.src == ${packet.srcIp} && ip.dst == ${packet.dstIp} && tcp.srcport == ${packet.srcPort} && tcp.dstport == ${packet.dstPort}) || (ip.src == ${packet.dstIp} && ip.dst == ${packet.srcIp} && tcp.srcport == ${packet.dstPort} && tcp.dstport == ${packet.srcPort}))`;
                      handleApplyFilter(filter);
                    }}>
                      <Link2 className="h-3.5 w-3.5 mr-2" />
                      <TooltipWrapper entry={tooltips.filterTcpStream} side="left"><span className="cursor-help">TCP Stream</span></TooltipWrapper>
                      <ContextMenuShortcut>stream</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleApplyFilter(`tcp.port == ${packet.srcPort} || tcp.port == ${packet.dstPort}`)}>
                      <Hash className="h-3.5 w-3.5 mr-2" />
                      TCP Port (Either)
                      <ContextMenuShortcut>tcp.port</ContextMenuShortcut>
                    </ContextMenuItem>
                  </>
                )}
                {hasUdp && (
                  <>
                    <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("udp.srcport", packet.srcPort.toString()))}>
                      <Hash className="h-3.5 w-3.5 mr-2" />
                      UDP Source Port
                      <ContextMenuShortcut>udp.srcport</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("udp.dstport", packet.dstPort.toString()))}>
                      <Hash className="h-3.5 w-3.5 mr-2" />
                      UDP Destination Port
                      <ContextMenuShortcut>udp.dstport</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      // Stream filter: packets in this UDP stream (includes IPs and ports)
                      const filter = `udp && ((ip.src == ${packet.srcIp} && ip.dst == ${packet.dstIp} && udp.srcport == ${packet.srcPort} && udp.dstport == ${packet.dstPort}) || (ip.src == ${packet.dstIp} && ip.dst == ${packet.srcIp} && udp.srcport == ${packet.dstPort} && udp.dstport == ${packet.srcPort}))`;
                      handleApplyFilter(filter);
                    }}>
                      <Link2 className="h-3.5 w-3.5 mr-2" />
                      <TooltipWrapper entry={tooltips.filterUdpStream} side="left"><span className="cursor-help">UDP Stream</span></TooltipWrapper>
                      <ContextMenuShortcut>stream</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleApplyFilter(`udp.port == ${packet.srcPort} || udp.port == ${packet.dstPort}`)}>
                      <Hash className="h-3.5 w-3.5 mr-2" />
                      UDP Port (Either)
                      <ContextMenuShortcut>udp.port</ContextMenuShortcut>
                    </ContextMenuItem>
                  </>
                )}
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleApplyFilter(buildFilter("protocol", packet.protocol))}>
              <Layers className="h-3.5 w-3.5 mr-2" />
              Protocol
              <ContextMenuShortcut>{packet.protocol}</ContextMenuShortcut>
            </ContextMenuItem>
            {hasSip && sipData && (
              <>
                <ContextMenuSeparator />
                {sipData.callId && (
                  <ContextMenuItem onClick={() => {
                    handleApplyFilter(`sip.Call-ID == "${sipData.callId}"`);
                  }}>
                    <Phone className="h-3.5 w-3.5 mr-2" />
                    <TooltipWrapper entry={tooltips.filterBySipCallId} side="left"><span className="cursor-help">SIP Call-ID</span></TooltipWrapper>
                  </ContextMenuItem>
                )}
                {sipData.from && (
                  <ContextMenuItem onClick={() => {
                    const fromVal = sipData.from ?? "";
                    const fromValue = (fromVal.split('>')[0] ?? fromVal).replace('<', '').trim();
                    handleApplyFilter(`sip.From contains "${fromValue}"`);
                  }}>
                    <User className="h-3.5 w-3.5 mr-2" />
                    <TooltipWrapper entry={tooltips.filterBySipFrom} side="left"><span className="cursor-help">SIP From</span></TooltipWrapper>
                  </ContextMenuItem>
                )}
                {sipData.to && (
                  <ContextMenuItem onClick={() => {
                    const toVal = sipData.to ?? "";
                    const toValue = (toVal.split('>')[0] ?? toVal).replace('<', '').trim();
                    handleApplyFilter(`sip.To contains "${toValue}"`);
                  }}>
                    <User className="h-3.5 w-3.5 mr-2" />
                    <TooltipWrapper entry={tooltips.filterBySipTo} side="left"><span className="cursor-help">SIP To</span></TooltipWrapper>
                  </ContextMenuItem>
                )}
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Prepare as Filter */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Search className="h-4 w-4 mr-2" />
            Prepare as Filter
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("ip.addr", packet.srcIp))}>
              <Network className="h-3.5 w-3.5 mr-2" />
              Selected
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("ip.addr", packet.dstIp))}>
              <Network className="h-3.5 w-3.5 mr-2" />
              Not Selected
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("ip.src", packet.srcIp))}>
              Source IP
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("ip.dst", packet.dstIp))}>
              Destination IP
            </ContextMenuItem>
            {hasPorts && (
              <>
                <ContextMenuSeparator />
                {hasTcp && (
                  <>
                    <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("tcp.srcport", packet.srcPort.toString()))}>
                      TCP Source Port
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("tcp.dstport", packet.dstPort.toString()))}>
                      TCP Destination Port
                    </ContextMenuItem>
                  </>
                )}
                {hasUdp && (
                  <>
                    <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("udp.srcport", packet.srcPort.toString()))}>
                      UDP Source Port
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("udp.dstport", packet.dstPort.toString()))}>
                      UDP Destination Port
                    </ContextMenuItem>
                  </>
                )}
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handlePrepareFilter(buildFilter("protocol", packet.protocol))}>
              Protocol
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {/* Open in SIP Ladder View (SIP packets only) */}
        {hasSip && onOpenInSipLadder && (
          <ContextMenuItem onClick={onOpenInSipLadder}>
            <GitBranch className="h-4 w-4 mr-2" />
            Open in SIP Ladder View
          </ContextMenuItem>
        )}
        {hasSip && onOpenInSipLadder && <ContextMenuSeparator />}

        {/* Follow Stream/Conversation */}
        {(hasTcp || hasUdp) && (
          <>
            {onFollowStream && (
              <ContextMenuItem onClick={() => onFollowStream(packet)}>
                <Link2 className="h-4 w-4 mr-2" />
                <TooltipWrapper entry={hasTcp ? tooltips.filterTcpStream : tooltips.filterUdpStream} side="left">
                  <span className="cursor-help">Follow Stream</span>
                </TooltipWrapper>
                <ContextMenuShortcut>Ctrl+Shift+Alt+S</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {onFollowConversation && (
              <ContextMenuItem onClick={() => onFollowConversation(packet)}>
                <Network className="h-4 w-4 mr-2" />
                <TooltipWrapper entry={tooltips.filterConversation} side="left">
                  <span className="cursor-help">Follow Conversation</span>
                </TooltipWrapper>
                <ContextMenuShortcut>Ctrl+Shift+Alt+C</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}

        {/* Copy */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuItem onClick={() => handleCopy(packet.srcIp, "srcIp")}>
              <Globe className="h-3.5 w-3.5 mr-2" />
              Source IP
              {copiedField === "srcIp" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopy(packet.dstIp, "dstIp")}>
              <Globe className="h-3.5 w-3.5 mr-2" />
              Destination IP
              {copiedField === "dstIp" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
            </ContextMenuItem>
            {hasPorts && (
              <>
                <ContextMenuItem onClick={() => handleCopy(packet.srcPort.toString(), "srcPort")}>
                  <Hash className="h-3.5 w-3.5 mr-2" />
                  Source Port
                  {copiedField === "srcPort" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopy(packet.dstPort.toString(), "dstPort")}>
                  <Hash className="h-3.5 w-3.5 mr-2" />
                  Destination Port
                  {copiedField === "dstPort" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopy(`${packet.srcIp}:${packet.srcPort}`, "srcAddr")}>
                  <Server className="h-3.5 w-3.5 mr-2" />
                  Source Address:Port
                  {copiedField === "srcAddr" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopy(`${packet.dstIp}:${packet.dstPort}`, "dstAddr")}>
                  <Server className="h-3.5 w-3.5 mr-2" />
                  Destination Address:Port
                  {copiedField === "dstAddr" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleCopy(packet.protocol, "protocol")}>
              <Layers className="h-3.5 w-3.5 mr-2" />
              Protocol
              {copiedField === "protocol" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopy(packet.summary, "summary")}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              Summary
              {copiedField === "summary" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
            </ContextMenuItem>
            {hasSip && sipData && (
              <>
                <ContextMenuSeparator />
                {sipData.callId && (
                  <ContextMenuItem onClick={() => handleCopy(sipData.callId!, "callId")}>
                    <Phone className="h-3.5 w-3.5 mr-2" />
                    SIP Call-ID
                    {copiedField === "callId" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                  </ContextMenuItem>
                )}
                {sipData.from && (
                  <ContextMenuItem onClick={() => handleCopy(sipData.from!, "sipFrom")}>
                    <User className="h-3.5 w-3.5 mr-2" />
                    SIP From
                    {copiedField === "sipFrom" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                  </ContextMenuItem>
                )}
                {sipData.to && (
                  <ContextMenuItem onClick={() => handleCopy(sipData.to!, "sipTo")}>
                    <User className="h-3.5 w-3.5 mr-2" />
                    SIP To
                    {copiedField === "sipTo" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                  </ContextMenuItem>
                )}
              </>
            )}
            {packet.decoded?.ethernet && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => handleCopy(packet.decoded!.ethernet!.srcMac, "srcMac")}>
                  <Network className="h-3.5 w-3.5 mr-2" />
                  Source MAC
                  {copiedField === "srcMac" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopy(packet.decoded!.ethernet!.dstMac, "dstMac")}>
                  <Network className="h-3.5 w-3.5 mr-2" />
                  Destination MAC
                  {copiedField === "dstMac" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleCopy(JSON.stringify(packet, null, 2), "json")}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              Packet as JSON
              {copiedField === "json" && <ContextMenuShortcut>✓</ContextMenuShortcut>}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {/* Colorize */}
        {onColorize && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Palette className="h-4 w-4 mr-2" />
              Colorize
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem onClick={() => onColorize(packetIndex, "red")}>
                <div className="h-3 w-3 rounded mr-2 bg-destructive" />
                Red
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onColorize(packetIndex, "orange")}>
                <div className="h-3 w-3 rounded mr-2 bg-warning" />
                Orange
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onColorize(packetIndex, "yellow")}>
                <div className="h-3 w-3 rounded mr-2 bg-warning" />
                Yellow
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onColorize(packetIndex, "green")}>
                <div className="h-3 w-3 rounded mr-2 bg-success" />
                Green
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onColorize(packetIndex, "blue")}>
                <div className="h-3 w-3 rounded mr-2 bg-info" />
                Blue
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onColorize(packetIndex, "teal")}>
                <div className="h-3 w-3 rounded mr-2 bg-success" />
                Purple
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onColorize(packetIndex, "none")}>
                <X className="h-3.5 w-3.5 mr-2" />
                Remove Color
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        <ContextMenuSeparator />

        {/* Statistics */}
        {onShowStatistics && (
          <ContextMenuItem onClick={() => onShowStatistics(packet)}>
            <BarChart3 className="h-4 w-4 mr-2" />
            Statistics
            <ContextMenuShortcut>Ctrl+Shift+S</ContextMenuShortcut>
          </ContextMenuItem>
        )}

        {/* Export */}
        {onExport && (
          <ContextMenuItem onClick={() => onExport(packet)}>
            <Download className="h-4 w-4 mr-2" />
            Export Packet
            <ContextMenuShortcut>Ctrl+E</ContextMenuShortcut>
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
