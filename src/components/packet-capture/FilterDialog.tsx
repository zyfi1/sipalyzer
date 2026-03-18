import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { tooltips } from "@/lib/tooltips";
import { HelpCircle, Plus, X } from "@/lib/icons";
import type { FilterConfig } from "@/types/packetCapture";

interface FilterDialogProps {
  filterConfig: FilterConfig;
  onSave: (config: FilterConfig) => void;
  onCancel: () => void;
  onSaveAsFilter?: (name: string, config: FilterConfig) => void;
}

export function FilterDialog({ filterConfig, onSave, onCancel }: FilterDialogProps) {
  const [config, setConfig] = useState<FilterConfig>({ ...filterConfig });
  const activeFilterCount =
    config.protocols.length +
    config.srcIpRanges.length +
    config.dstIpRanges.length +
    config.srcPorts.length +
    config.dstPorts.length +
    config.portRanges.length +
    (config.rtpPortRange ? 1 : 0);
  const cidrRows = Array.from({ length: 33 }, (_, index) => {
    const prefix = 32 - index;
    const hostCount = 2 ** (32 - prefix);
    return {
      prefix,
      hostCountLabel: hostCount.toLocaleString(),
    };
  });

  const cidrTooltipContent = (
    <div className="w-[360px] max-w-[calc(100vw-24px)]">
      <p className="text-xs font-semibold text-foreground">CIDR Notation Reference (IPv4)</p>
      <p className="mt-1 text-2xs text-muted-foreground">
        Expand the dropdown below, then copy any prefix (for example <span className="font-mono">/24</span>).
      </p>
      <details className="mt-2.5 rounded-md border border-border/45 bg-card/70 group">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-2.5 py-2 text-2xs font-medium text-foreground hover:bg-muted/20 transition-smooth">
          <span>CIDR Prefix Table</span>
          <span className="text-muted-foreground text-3xs group-open:hidden">Expand</span>
          <span className="text-muted-foreground text-3xs hidden group-open:inline">Collapse</span>
        </summary>
        <div
          className="max-h-[220px] overflow-y-auto overscroll-contain border-t border-border/35 pr-0.5"
          onWheel={(e) => e.stopPropagation()}
        >
          {cidrRows.map((row) => (
            <div
              key={row.prefix}
              className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/35 last:border-b-0"
            >
              <span className="w-12 shrink-0 font-mono text-xs text-foreground">/{row.prefix}</span>
              <span className="min-w-0 flex-1 text-2xs text-muted-foreground">
                {row.hostCountLabel} address{row.hostCountLabel === "1" ? "" : "es"}
              </span>
              <CopyTextButton
                text={`/${row.prefix}`}
                label={`Copy /${row.prefix}`}
                className="h-6 w-6"
                size="icon"
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );

  const toggleProtocol = (protocol: string) => {
    setConfig((prev) => ({
      ...prev,
      protocols: prev.protocols.includes(protocol)
        ? prev.protocols.filter((p) => p !== protocol)
        : [...prev.protocols, protocol],
    }));
  };

  const addIpRange = (type: "src" | "dst", range: string) => {
    if (!range.trim()) return;
    setConfig((prev) => ({
      ...prev,
      srcIpRanges: type === "src" ? [...prev.srcIpRanges, range] : prev.srcIpRanges,
      dstIpRanges: type === "dst" ? [...prev.dstIpRanges, range] : prev.dstIpRanges,
    }));
  };

  const removeIpRange = (type: "src" | "dst", index: number) => {
    setConfig((prev) => ({
      ...prev,
      srcIpRanges: type === "src" ? prev.srcIpRanges.filter((_, i) => i !== index) : prev.srcIpRanges,
      dstIpRanges: type === "dst" ? prev.dstIpRanges.filter((_, i) => i !== index) : prev.dstIpRanges,
    }));
  };

  const addPort = (type: "src" | "dst", port: number) => {
    setConfig((prev) => ({
      ...prev,
      srcPorts: type === "src" && !prev.srcPorts.includes(port) ? [...prev.srcPorts, port] : prev.srcPorts,
      dstPorts: type === "dst" && !prev.dstPorts.includes(port) ? [...prev.dstPorts, port] : prev.dstPorts,
    }));
  };

  const removePort = (type: "src" | "dst", index: number) => {
    setConfig((prev) => ({
      ...prev,
      srcPorts: type === "src" ? prev.srcPorts.filter((_, i) => i !== index) : prev.srcPorts,
      dstPorts: type === "dst" ? prev.dstPorts.filter((_, i) => i !== index) : prev.dstPorts,
    }));
  };

  const addPortRange = (min: number, max: number) => {
    if (min > max) return;
    setConfig((prev) => ({
      ...prev,
      portRanges: [...prev.portRanges, [min, max]],
    }));
  };

  const removePortRange = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      portRanges: prev.portRanges.filter((_, i) => i !== index),
    }));
  };

  const setRtpPortRange = (min: number | undefined, max: number | undefined) => {
    setConfig((prev) => ({
      ...prev,
      rtpPortRange: min !== undefined && max !== undefined && min <= max ? [min, max] : undefined,
    }));
  };

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="w-[min(98vw,1320px)] max-w-[min(98vw,1320px)] sm:max-w-[min(98vw,1320px)] max-h-[calc(min(100vh,100dvh)-2rem)] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="ui-section-header-md px-6 py-4 pr-14">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-base">Capture Rules</DialogTitle>
              <DialogDescription className="mt-1">
                Define exactly what traffic is ingested before capture starts. Use protocol, IP, and port rules to keep captures focused and lighter.
              </DialogDescription>
            </div>
            <div className="h-6 px-2 rounded-md border border-border/45 bg-card/70 text-xs font-medium tabular-nums flex items-center">
              {activeFilterCount} active
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
          <div className="rounded-md border border-border/40 bg-muted/10 p-4">
            <div className="mb-3">
              <Label className="flex items-center gap-2 text-sm font-semibold">
                Protocol rules
                <TooltipWrapper content="Select protocol families to ingest. Leaving all unchecked captures all protocols.">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipWrapper>
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Narrow capture volume quickly by limiting the protocol families that enter the capture pipeline.
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="rounded-md border border-border/35 bg-card/60 p-3">
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">VoIP</Label>
                <div className="grid grid-cols-2 gap-2">
                  {["SIP", "RTP", "RTCP", "FAX"].map((protocol) => {
                    const tooltipMap: Record<string, { title: string; description?: string }> = {
                      SIP: tooltips.protoSip,
                      RTP: tooltips.protoRtp,
                      RTCP: tooltips.protoRtcp,
                      FAX: tooltips.protoFax,
                    };
                    return (
                      <div key={protocol} className="flex items-center space-x-2">
                        <Checkbox
                          id={`protocol-${protocol}`}
                          checked={config.protocols.includes(protocol)}
                          onCheckedChange={() => toggleProtocol(protocol)}
                        />
                        <TooltipWrapper entry={tooltipMap[protocol]}>
                          <Label htmlFor={`protocol-${protocol}`} className="text-sm font-normal cursor-help">
                            {protocol}
                          </Label>
                        </TooltipWrapper>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-md border border-border/35 bg-card/60 p-3">
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">Troubleshooting</Label>
                <div className="grid grid-cols-2 gap-2">
                  {["DNS", "HTTP", "HTTPS"].map((protocol) => {
                    const tooltipMap: Record<string, { title: string; description?: string }> = {
                      DNS: tooltips.protoDns,
                      HTTP: tooltips.protoHttp,
                      HTTPS: tooltips.protoHttps,
                    };
                    return (
                      <div key={protocol} className="flex items-center space-x-2">
                        <Checkbox
                          id={`protocol-${protocol}`}
                          checked={config.protocols.includes(protocol)}
                          onCheckedChange={() => toggleProtocol(protocol)}
                        />
                        <TooltipWrapper entry={tooltipMap[protocol]}>
                          <Label htmlFor={`protocol-${protocol}`} className="text-sm font-normal cursor-help">
                            {protocol}
                          </Label>
                        </TooltipWrapper>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-md border border-border/35 bg-card/60 p-3">
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">Transport</Label>
                <div className="grid grid-cols-2 gap-2">
                  {["TCP", "UDP", "ICMP", "OTHER"].map((protocol) => {
                    const tooltipMap: Record<string, { title: string; description?: string }> = {
                      TCP: tooltips.protoTcp,
                      UDP: tooltips.protoUdp,
                      ICMP: tooltips.protoIcmp,
                      OTHER: tooltips.protoOther,
                    };
                    const displayName = protocol === "OTHER" ? "Other" : protocol;
                    return (
                      <div key={protocol} className="flex items-center space-x-2">
                        <Checkbox
                          id={`protocol-${protocol}`}
                          checked={config.protocols.includes(protocol)}
                          onCheckedChange={() => toggleProtocol(protocol)}
                        />
                        <TooltipWrapper entry={tooltipMap[protocol]}>
                          <Label htmlFor={`protocol-${protocol}`} className="text-sm font-normal cursor-help">
                            {displayName}
                          </Label>
                        </TooltipWrapper>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="min-w-0 space-y-2 rounded-md border border-border/40 bg-muted/10 p-4">
              <div>
                <Label className="flex items-center gap-1.5">
                  <TooltipWrapper entry={tooltips.filterSrcIpRange}>
                    <span className="cursor-help">Source IP ranges</span>
                  </TooltipWrapper>
                  <TooltipWrapper content={cidrTooltipContent} interactive followCursor={false}>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-muted-foreground cursor-help" />
                  </TooltipWrapper>
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Match packets by sender subnet/host (examples: <span className="font-mono">10.0.0.0/24</span>, <span className="font-mono">192.168.1.5/32</span>).
                </p>
              </div>
              <div className="space-y-2">
                {config.srcIpRanges.map((range, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={range} readOnly className="h-9 min-w-0" />
                    <TooltipWrapper entry={tooltips.captureFilterRemoveEntry}>
                      <Button variant="ghost" size="icon" onClick={() => removeIpRange("src", i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipWrapper>
                  </div>
                ))}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                  <Input
                    placeholder="Add source CIDR/host"
                    className="h-9 min-w-0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addIpRange("src", e.currentTarget.value);
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                  <TooltipWrapper entry={tooltips.captureFilterAddEntry}>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        if (input) {
                          addIpRange("src", input.value);
                          input.value = "";
                        }
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-2 rounded-md border border-border/40 bg-muted/10 p-4">
              <div>
                <Label className="flex items-center gap-1.5">
                  <TooltipWrapper entry={tooltips.filterDstIpRange}>
                    <span className="cursor-help">Destination IP ranges</span>
                  </TooltipWrapper>
                  <TooltipWrapper content={cidrTooltipContent} interactive followCursor={false}>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-muted-foreground cursor-help" />
                  </TooltipWrapper>
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Match packets by receiver subnet/host (examples: <span className="font-mono">172.16.0.0/16</span>, <span className="font-mono">203.0.113.10/32</span>).
                </p>
              </div>
              <div className="space-y-2">
                {config.dstIpRanges.map((range, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={range} readOnly className="h-9 min-w-0" />
                    <TooltipWrapper entry={tooltips.captureFilterRemoveEntry}>
                      <Button variant="ghost" size="icon" onClick={() => removeIpRange("dst", i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipWrapper>
                  </div>
                ))}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                  <Input
                    placeholder="Add destination CIDR/host"
                    className="h-9 min-w-0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addIpRange("dst", e.currentTarget.value);
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                  <TooltipWrapper entry={tooltips.captureFilterAddEntry}>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        if (input) {
                          addIpRange("dst", input.value);
                          input.value = "";
                        }
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="min-w-0 space-y-2 rounded-md border border-border/40 bg-muted/10 p-4">
              <div>
                <TooltipWrapper entry={tooltips.filterSrcPorts}>
                  <Label className="cursor-help">Source ports</Label>
                </TooltipWrapper>
                <p className="text-xs text-muted-foreground mt-1">Capture only traffic sent from these port values.</p>
              </div>
              <div className="space-y-2">
                {config.srcPorts.map((port, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={port} readOnly className="h-9 min-w-0" />
                    <TooltipWrapper entry={tooltips.captureFilterRemoveEntry}>
                      <Button variant="ghost" size="icon" onClick={() => removePort("src", i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipWrapper>
                  </div>
                ))}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                  <Input
                    type="number"
                    placeholder="Add source port"
                    className="h-9 min-w-0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const port = parseInt(e.currentTarget.value);
                        if (!isNaN(port)) {
                          addPort("src", port);
                          e.currentTarget.value = "";
                        }
                      }
                    }}
                  />
                  <TooltipWrapper entry={tooltips.captureFilterAddEntry}>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        const port = parseInt(input.value);
                        if (!isNaN(port)) {
                          addPort("src", port);
                          input.value = "";
                        }
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-2 rounded-md border border-border/40 bg-muted/10 p-4">
              <div>
                <TooltipWrapper entry={tooltips.filterDstPorts}>
                  <Label className="cursor-help">Destination ports</Label>
                </TooltipWrapper>
                <p className="text-xs text-muted-foreground mt-1">Capture only traffic targeting these destination ports.</p>
              </div>
              <div className="space-y-2">
                {config.dstPorts.map((port, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={port} readOnly className="h-9 min-w-0" />
                    <TooltipWrapper entry={tooltips.captureFilterRemoveEntry}>
                      <Button variant="ghost" size="icon" onClick={() => removePort("dst", i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipWrapper>
                  </div>
                ))}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                  <Input
                    type="number"
                    placeholder="Add destination port"
                    className="h-9 min-w-0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const port = parseInt(e.currentTarget.value);
                        if (!isNaN(port)) {
                          addPort("dst", port);
                          e.currentTarget.value = "";
                        }
                      }
                    }}
                  />
                  <TooltipWrapper entry={tooltips.captureFilterAddEntry}>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        const port = parseInt(input.value);
                        if (!isNaN(port)) {
                          addPort("dst", port);
                          input.value = "";
                        }
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="min-w-0 space-y-2 rounded-md border border-border/40 bg-muted/10 p-4">
              <div>
                <Label className="flex items-center gap-1.5">
                  <TooltipWrapper entry={tooltips.filterPortRange}>
                    <span className="cursor-help">Port ranges</span>
                  </TooltipWrapper>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/70" />
                </Label>
                <p className="text-xs text-muted-foreground mt-1">Add inclusive ranges like <span className="font-mono">10000-20000</span> for media-heavy flows.</p>
              </div>
              <div className="space-y-2">
                {config.portRanges.map(([min, max], i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={`${min}-${max}`} readOnly className="h-9 min-w-0" />
                    <TooltipWrapper entry={tooltips.captureFilterRemoveEntry}>
                      <Button variant="ghost" size="icon" onClick={() => removePortRange(i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipWrapper>
                  </div>
                ))}
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
                  <Input type="number" placeholder="Min port" className="h-9 min-w-0" id="port-range-min" />
                  <Input
                    type="number"
                    placeholder="Max port"
                    className="h-9 min-w-0"
                    id="port-range-max"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const minInput = document.getElementById("port-range-min") as HTMLInputElement;
                        const maxInput = e.currentTarget;
                        const min = parseInt(minInput.value);
                        const max = parseInt(maxInput.value);
                        if (!isNaN(min) && !isNaN(max)) {
                          addPortRange(min, max);
                          minInput.value = "";
                          maxInput.value = "";
                        }
                      }
                    }}
                  />
                  <TooltipWrapper entry={tooltips.captureFilterAddEntry}>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const minInput = document.getElementById("port-range-min") as HTMLInputElement;
                        const maxInput = document.getElementById("port-range-max") as HTMLInputElement;
                        const min = parseInt(minInput.value);
                        const max = parseInt(maxInput.value);
                        if (!isNaN(min) && !isNaN(max)) {
                          addPortRange(min, max);
                          minInput.value = "";
                          maxInput.value = "";
                        }
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-2 rounded-md border border-border/40 bg-muted/10 p-4">
              <div>
                <Label className="flex items-center gap-2">
                  RTP detection range
                  <TooltipWrapper content="Optional: tune the RTP candidate range used by detection heuristics. Default is 10000-60000.">
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipWrapper>
                </Label>
                <p className="text-xs text-muted-foreground mt-1">Adjust only if your environment uses non-standard RTP port windows.</p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] gap-2 items-center">
                <Input
                  type="number"
                  placeholder="Min (default: 10000)"
                  className="h-9 min-w-0"
                  id="rtp-port-range-min"
                  value={config.rtpPortRange?.[0] ?? ""}
                  onChange={(e) => {
                    const min = e.target.value ? parseInt(e.target.value) : undefined;
                    const max = config.rtpPortRange?.[1];
                    setRtpPortRange(min, max);
                  }}
                />
                <span className="text-muted-foreground text-center">-</span>
                <Input
                  type="number"
                  placeholder="Max (default: 60000)"
                  className="h-9 min-w-0"
                  id="rtp-port-range-max"
                  value={config.rtpPortRange?.[1] ?? ""}
                  onChange={(e) => {
                    const min = config.rtpPortRange?.[0];
                    const max = e.target.value ? parseInt(e.target.value) : undefined;
                    setRtpPortRange(min, max);
                  }}
                />
                {config.rtpPortRange && (
                  <TooltipWrapper entry={tooltips.captureFilterClearRtpRange}>
                    <Button variant="ghost" size="icon" onClick={() => setRtpPortRange(undefined, undefined)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </TooltipWrapper>
                )}
              </div>
              {config.rtpPortRange ? (
                <p className="text-xs text-muted-foreground">
                  Active custom RTP range: <span className="font-mono">{config.rtpPortRange[0]}-{config.rtpPortRange[1]}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Using default RTP range: <span className="font-mono">10000-60000</span></p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="surface-subtle sticky bottom-0 z-10 px-6 py-4 border-t border-border/50">
          <TooltipWrapper entry={tooltips.captureFilterCancel}>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </TooltipWrapper>
          <TooltipWrapper entry={tooltips.captureFilterSave}>
            <Button onClick={() => onSave(config)}>Save Rules</Button>
          </TooltipWrapper>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
