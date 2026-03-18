/**
 * UnifiedControlBar — Primary capture control strip.
 *
 * Layout: [ Start/Stop ] [ Interface ▼ ] │ [ ──── Filter Bar ──── ]
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Network,
  Wifi,
  HardDrive,
  Radio,
  ChevronDown,
  RefreshCw,
  Play,
  Square,
  MapPin,
  Zap,
} from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { WiresharkFilterBar } from "./WiresharkFilterBar";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { NetworkInterface } from "@/types/packetCapture";
import type { ExecutionContext } from "@/stores/executionContextStore";
import { useNetworkStore } from "@/stores/networkStore";
import { cleanAddress, isVpnInterface } from "@/lib/networkUtils";

interface UnifiedControlBarProps {
  interfaces: NetworkInterface[];
  onRefreshInterfaces: () => void;
  executionContext: ExecutionContext;
  isCapturing: boolean;
  onStart: (interfaceName: string) => void;
  onStop: () => void;
  onOpenCaptureFilters: () => void;
  activeCaptureFilterCount: number;
  captureFilterSummary: string;
  wiresharkFilter: string;
  onWiresharkFilterChange: (filter: string) => void;
  filteredCount: number;
}

export function UnifiedControlBar({
  interfaces,
  onRefreshInterfaces,
  executionContext,
  isCapturing,
  onStart,
  onStop,
  onOpenCaptureFilters,
  activeCaptureFilterCount,
  captureFilterSummary,
  wiresharkFilter,
  onWiresharkFilterChange,
  filteredCount,
}: UnifiedControlBarProps) {
  const [showPopover, setShowPopover] = useState(false);
  const localIp = useNetworkStore((s) => s.localIp);
  const isRemote = executionContext.type === "remote";

  const autoInterface = useMemo(() => {
    if (isRemote) return null;
    if (localIp) {
      const match = interfaces.find((iface) =>
        iface.addresses.some((addr) => cleanAddress(addr) === localIp),
      );
      if (match) return match;
    }
    const nonLoopback = interfaces.find(
      (iface) => !iface.name.toLowerCase().includes("lo"),
    );
    return nonLoopback ?? interfaces[0] ?? null;
  }, [interfaces, localIp, isRemote]);

  const [manualOverride, setManualOverride] = useState<string | null>(null);

  useEffect(() => {
    if (manualOverride && !interfaces.find((i) => i.name === manualOverride)) {
      setManualOverride(null);
    }
  }, [interfaces, manualOverride]);

  const isAutoMode = manualOverride === null;
  const resolvedName = isRemote
    ? (manualOverride ?? "")
    : (manualOverride ?? autoInterface?.name ?? "");
  const resolvedData = interfaces.find((i) => i.name === resolvedName);

  const handleSelect = useCallback((name: string | null) => {
    setManualOverride(name);
    setShowPopover(false);
  }, []);

  const handleStart = useCallback(() => {
    onStart(resolvedName);
  }, [onStart, resolvedName]);

  const getInterfaceIcon = (iface: NetworkInterface) => {
    const name = iface.name.toLowerCase();
    if (name.includes("wifi") || name.includes("wlan") || name.includes("en0")) return <Wifi className="h-3 w-3" />;
    if (name.includes("eth") || name.includes("en")) return <Network className="h-3 w-3" />;
    if (name.includes("lo") || name.includes("loopback")) return <HardDrive className="h-3 w-3" />;
    return <Radio className="h-3 w-3" />;
  };

  const getInterfaceType = (iface: NetworkInterface) => {
    if (isVpnInterface(iface)) return { label: "VPN", variant: "default" as const };
    if (iface.name.toLowerCase().includes("lo") || iface.name.toLowerCase().includes("loopback")) return { label: "Loopback", variant: "secondary" as const };
    return null;
  };

  const chipLabel = isRemote
    ? (resolvedName ? resolvedName : "Auto")
    : (resolvedData?.description || resolvedData?.name || "No interface");

  const canStart = isRemote ? true : !!resolvedName;

  return (
    <div className="flex w-full items-center gap-2">
      {/* ── Start / Stop ── */}
      {isCapturing ? (
        <Button onClick={onStop} variant="destructive" size="sm" className="shrink-0 gap-1.5 px-2.5 text-xs">
          <Square className="h-3 w-3 fill-current" />
          Stop
        </Button>
      ) : (
        <Button onClick={handleStart} variant="success" size="sm" className="shrink-0 gap-1.5 px-2.5 text-xs" disabled={!canStart}>
          <Play className="h-3 w-3 fill-current" />
          Start
        </Button>
      )}

      {/* ── Interface selector chip ── */}
      <Popover open={showPopover} onOpenChange={setShowPopover}>
        <PopoverTrigger asChild>
          <Button
            asChild
            variant="neutral"
            size="sm"
            disabled={isCapturing}
            className={cn(
              "max-w-[220px] shrink-0 justify-start gap-1.5 px-2.5 text-xs",
              isAutoMode ? "text-muted-foreground" : "text-foreground",
            )}
          >
            <button type="button">
              {resolvedData && getInterfaceIcon(resolvedData)}
              {!resolvedData && isRemote && <Network className="h-3 w-3 text-muted-foreground/60" />}
              <span className="truncate font-medium">{chipLabel}</span>
              {isAutoMode && <span className="text-muted-foreground/60 text-2xs">(auto)</span>}
              <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform", showPopover && "rotate-180")} />
            </button>
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" sideOffset={6} className="ui-floating-surface w-[340px] overflow-hidden p-0">
          <div className="ui-section-header-sm px-3.5 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Network Interface</p>
              {!isRemote && localIp && (
                <p className="text-2xs text-muted-foreground mt-0.5">
                  Auto-detected via <span className="font-mono text-warning">{localIp}</span>
                </p>
              )}
              {isRemote && (
                <p className="text-2xs text-muted-foreground mt-0.5">Remote agent interface</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!isRemote && autoInterface && manualOverride !== null && (
                <TooltipWrapper title="Reset to auto" description={`Auto-select ${autoInterface.description || autoInterface.name}`}>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleSelect(null)} className="text-warning">
                    <Zap className="h-3.5 w-3.5" />
                  </Button>
                </TooltipWrapper>
              )}
              {!isRemote && (
                <TooltipWrapper content="Refresh interface list">
                  <Button variant="ghost" size="icon-sm" onClick={(e) => { e.preventDefault(); onRefreshInterfaces(); }}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipWrapper>
              )}
            </div>
          </div>

          {isRemote && (
            <div className="p-1">
              <button type="button" onClick={() => handleSelect(null)}
                className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-smooth", isAutoMode ? "bg-primary/10" : "hover:bg-muted/30")}>
                <Zap className={cn("h-3.5 w-3.5 shrink-0", isAutoMode ? "text-primary" : "text-muted-foreground/60")} />
                <div className="flex-1 min-w-0">
                  <span className={cn("text-xs font-medium", isAutoMode ? "text-primary" : "text-foreground")}>Auto-detect</span>
                  <p className="text-2xs text-muted-foreground mt-0.5">Let the agent choose the best interface</p>
                </div>
                {isAutoMode && <div className="shrink-0 h-2 w-2 rounded-full bg-primary" />}
              </button>
            </div>
          )}

          <div className={cn("max-h-[320px] overflow-y-auto py-1", isRemote && "border-t border-border/20")}>
            {interfaces.length === 0 ? (
              <EmptyState compact variant="inline" title="No interfaces found" />
            ) : (
              [...interfaces]
                .sort((a, b) => {
                  if (!localIp || isRemote) return 0;
                  const aMatch = a.addresses.some((addr) => cleanAddress(addr) === localIp);
                  const bMatch = b.addresses.some((addr) => cleanAddress(addr) === localIp);
                  if (aMatch && !bMatch) return -1;
                  if (!aMatch && bMatch) return 1;
                  return 0;
                })
                .map((iface) => {
                  const hasLocalIp = !isRemote && localIp && iface.addresses.some((addr) => cleanAddress(addr) === localIp);
                  const isSelected = resolvedName === iface.name && !isAutoMode;
                  const isAutoSelected = isAutoMode && !isRemote && autoInterface?.name === iface.name;
                  const typeInfo = getInterfaceType(iface);
                  const primaryAddress = iface.addresses.find((addr) => !addr.includes("::")) || iface.addresses[0];

                  return (
                    <button key={iface.name} type="button" onClick={() => handleSelect(iface.name)}
                      className={cn("w-full flex items-center gap-3 px-3.5 py-2 text-left transition-smooth",
                        isSelected || isAutoSelected ? "bg-primary/10" : hasLocalIp ? "bg-warning/[0.04] hover:bg-warning/[0.08]" : "hover:bg-muted/50")}>
                      <div className={cn("shrink-0", isSelected || isAutoSelected ? "text-primary" : hasLocalIp ? "text-warning" : "text-muted-foreground/60")}>
                        {getInterfaceIcon(iface)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-medium truncate", isSelected || isAutoSelected ? "text-primary" : hasLocalIp ? "text-warning" : "text-foreground")}>
                            {iface.description || iface.name}
                          </span>
                          {hasLocalIp && (
                            <Badge variant="default" className="text-3xs h-4 px-1.5 py-0 bg-warning text-warning-foreground font-semibold">
                              <MapPin className="h-2.5 w-2.5 mr-0.5" />Local IP
                            </Badge>
                          )}
                          {typeInfo && !hasLocalIp && (
                            <Badge variant={typeInfo.variant} className="text-3xs h-4 px-1.5 py-0">{typeInfo.label}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-2xs text-muted-foreground">
                          <span className="font-mono">{iface.name}</span>
                          {primaryAddress && (
                            <>
                              <span className="text-muted-foreground/60">·</span>
                              <span className="font-mono truncate">{primaryAddress.includes(":") ? primaryAddress.split("%")[0] : primaryAddress}</span>
                              {iface.addresses.length > 1 && <span className="text-3xs text-muted-foreground/60">+{iface.addresses.length - 1}</span>}
                            </>
                          )}
                        </div>
                      </div>
                      {(isSelected || isAutoSelected) && <div className="shrink-0 h-2 w-2 rounded-full bg-primary" />}
                    </button>
                  );
                })
            )}
          </div>
        </PopoverContent>
      </Popover>

      <TooltipWrapper
        title="Capture rules"
        description={captureFilterSummary}
      >
        <Button
          type="button"
          variant="neutral"
          size="sm"
          className="shrink-0 gap-1.5 px-2.5 text-xs"
          onClick={onOpenCaptureFilters}
          disabled={isCapturing}
        >
          <Zap className="h-3.5 w-3.5" />
          Rules
          {activeCaptureFilterCount > 0 && (
            <Badge
              variant="secondary"
              className="h-4 px-1 text-3xs tabular-nums border border-border/35 bg-muted/40"
            >
              {activeCaptureFilterCount}
            </Badge>
          )}
        </Button>
      </TooltipWrapper>

      <div className="h-4 w-px shrink-0 bg-border/35" />

      {/* ── Wireshark display filter ── */}
      <div className="flex-1 min-w-0">
        <WiresharkFilterBar filter={wiresharkFilter} onFilterChange={onWiresharkFilterChange} filteredCount={filteredCount} />
      </div>
    </div>
  );
}

export default React.memo(UnifiedControlBar);
