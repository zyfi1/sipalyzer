import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Filter,
  X,
  Search,
  Network,
  Server,
  Hash,
  FileText,
  ChevronDown,
  ChevronUp,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

export interface PacketFilter {
  search: string;
  protocols: string[];
  srcIp: string;
  dstIp: string;
  srcPort: string;
  dstPort: string;
  minSize: string;
  maxSize: string;
}

interface PacketFilterPanelProps {
  filter: PacketFilter;
  onFilterChange: (filter: PacketFilter) => void;
  packetCount: number;
  filteredCount: number;
}

export function PacketFilterPanel({
  filter,
  onFilterChange,
  packetCount,
  filteredCount,
}: PacketFilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const protocols = ["SIP", "RTP", "RTCP", "FAX", "OTHER"];

  const updateFilter = (updates: Partial<PacketFilter>) => {
    onFilterChange({ ...filter, ...updates });
  };

  const toggleProtocol = (protocol: string) => {
    const newProtocols = filter.protocols.includes(protocol)
      ? filter.protocols.filter((p) => p !== protocol)
      : [...filter.protocols, protocol];
    updateFilter({ protocols: newProtocols });
  };

  const clearFilter = (field?: keyof PacketFilter) => {
    if (field) {
      if (field === "protocols") {
        updateFilter({ protocols: [] });
      } else {
        updateFilter({ [field]: "" });
      }
    } else {
      // Clear all
      onFilterChange({
        search: "",
        protocols: [],
        srcIp: "",
        dstIp: "",
        srcPort: "",
        dstPort: "",
        minSize: "",
        maxSize: "",
      });
    }
  };

  const hasActiveFilters =
    filter.search ||
    filter.protocols.length > 0 ||
    filter.srcIp ||
    filter.dstIp ||
    filter.srcPort ||
    filter.dstPort ||
    filter.minSize ||
    filter.maxSize;

  return (
    <Card>
      <CardHeader className="pb-3 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Filters</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {filteredCount.toLocaleString()} / {packetCount.toLocaleString()}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <TooltipWrapper entry={tooltips.captureFilterClearAll}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => clearFilter()}
                  className="h-7 gap-1.5 px-2 text-xs"
                >
                  <X className="h-3 w-3" />
                  Clear All
                </Button>
              </TooltipWrapper>
            )}
            <TooltipWrapper entry={tooltips.captureFilterExpand}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-7 w-7 p-0"
              >
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipWrapper>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-4">
        {/* Search */}
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search packets..."
              value={filter.search}
              onChange={(e) => updateFilter({ search: e.target.value })}
              className="ui-control-shell h-8 pl-8 text-sm"
            />
            {filter.search && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearFilter("search")}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Protocols */}
        <div className="flex flex-wrap gap-1.5">
          {protocols.map((protocol) => {
            const protocolTooltipMap: Record<string, { title: string; description?: string }> = {
              SIP: tooltips.captureProtocolSip,
              RTP: tooltips.captureProtocolRtp,
              RTCP: tooltips.captureProtocolRtcp,
              FAX: tooltips.captureProtocolFax,
              OTHER: { title: "Other", description: "All non-VoIP protocols (HTTP, DNS, ICMP, etc.)." },
            };
            return (
              <TooltipWrapper key={protocol} entry={protocolTooltipMap[protocol]}>
                <button
                  type="button"
                  onClick={() => toggleProtocol(protocol)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-smooth",
                    filter.protocols.includes(protocol)
                      ? "bg-accent text-foreground border-foreground/30"
                      : "bg-card border-border hover:bg-accent"
                  )}
                >
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      filter.protocols.includes(protocol) ? "bg-foreground" : "bg-muted-foreground"
                    )}
                  />
                  {protocol}
                </button>
              </TooltipWrapper>
            );
          })}
        </div>

        {/* Expanded Filters */}
        {isExpanded && (
          <div className="space-y-3 pt-3 border-t border-border/20">
            <div className="grid grid-cols-2 gap-3">
              {/* Source IP */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Network className="h-3 w-3" />
                  Source
                </Label>
                <div className="relative">
                  <Input
                    placeholder="192.168.1.1"
                    value={filter.srcIp}
                    onChange={(e) => updateFilter({ srcIp: e.target.value })}
                    className="h-8 text-sm font-mono"
                  />
                  {filter.srcIp && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearFilter("srcIp")}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Destination IP */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Server className="h-3 w-3" />
                  Destination
                </Label>
                <div className="relative">
                  <Input
                    placeholder="192.168.1.1"
                    value={filter.dstIp}
                    onChange={(e) => updateFilter({ dstIp: e.target.value })}
                    className="h-8 text-sm font-mono"
                  />
                  {filter.dstIp && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearFilter("dstIp")}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Source Port */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Hash className="h-3 w-3" />
                  Source Port
                </Label>
                <div className="relative">
                  <Input
                    placeholder="5060"
                    value={filter.srcPort}
                    onChange={(e) => updateFilter({ srcPort: e.target.value.replace(/\D/g, "") })}
                    className="h-8 text-sm font-mono"
                  />
                  {filter.srcPort && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearFilter("srcPort")}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Destination Port */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Hash className="h-3 w-3" />
                  Destination Port
                </Label>
                <div className="relative">
                  <Input
                    placeholder="5060"
                    value={filter.dstPort}
                    onChange={(e) => updateFilter({ dstPort: e.target.value.replace(/\D/g, "") })}
                    className="h-8 text-sm font-mono"
                  />
                  {filter.dstPort && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearFilter("dstPort")}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Packet Size Range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  Min Size (bytes)
                </Label>
                <div className="relative">
                  <Input
                    placeholder="0"
                    value={filter.minSize}
                    onChange={(e) => updateFilter({ minSize: e.target.value.replace(/\D/g, "") })}
                    className="h-8 text-sm font-mono"
                  />
                  {filter.minSize && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearFilter("minSize")}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  Max Size (bytes)
                </Label>
                <div className="relative">
                  <Input
                    placeholder="65535"
                    value={filter.maxSize}
                    onChange={(e) => updateFilter({ maxSize: e.target.value.replace(/\D/g, "") })}
                    className="h-8 text-sm font-mono"
                  />
                  {filter.maxSize && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearFilter("maxSize")}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
