import { useState, useMemo, useEffect } from "react";
import { useNetworkStore } from "@/stores/networkStore";
import { cleanAddress, isVpnInterface } from "@/lib/networkUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Network,
  Wifi,
  Radio,
  MapPin,
  RefreshCw,
  Check,
  Zap,
} from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import type { NetworkInterface } from "@/types/packetCapture";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface InterfacePickerProps {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  className?: string;
}

function getIcon(iface: NetworkInterface) {
  const name = iface.name.toLowerCase();
  if (name.includes("wifi") || name.includes("wlan") || name.includes("en0"))
    return <Wifi className="h-3 w-3" />;
  if (name.includes("eth") || name.includes("en"))
    return <Network className="h-3 w-3" />;
  if (isVpnInterface(iface))
    return <Radio className="h-3 w-3" />;
  return <Network className="h-3 w-3" />;
}

function getType(iface: NetworkInterface) {
  if (isVpnInterface(iface)) return { label: "VPN", className: "bg-primary/15 text-primary" };
  if (iface.name.toLowerCase().includes("lo") || iface.name.toLowerCase().includes("loopback"))
    return { label: "Loopback", className: "bg-muted/30 text-muted-foreground" };
  return null;
}

export function InterfacePicker({ value, onChange, disabled, className }: InterfacePickerProps) {
  const interfaces = useNetworkStore((s) => s.interfaces);
  const localIp = useNetworkStore((s) => s.localIp);
  const refresh = useNetworkStore((s) => s.refresh);
  const loading = useNetworkStore((s) => s.loading);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (interfaces.length === 0) refresh();
  }, [interfaces.length, refresh]);

  const selected = useMemo(
    () => interfaces.find((i) => i.name === value) ?? null,
    [interfaces, value],
  );

  const isAuto = !value;

  const sorted = useMemo(() => {
    return [...interfaces]
      .filter((i) => {
        const name = i.name.toLowerCase();
        return !name.includes("lo") && !name.includes("loopback");
      })
      .sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        if (!localIp) return 0;
        const aMatch = a.addresses.some((addr) => cleanAddress(addr) === localIp);
        const bMatch = b.addresses.some((addr) => cleanAddress(addr) === localIp);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
  }, [interfaces, localIp]);

  const chipLabel = selected
    ? (selected.description || selected.name)
    : "Auto (default route)";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipWrapper entry={tooltips.netIfacePicker} disabled={open}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "inline-flex items-center gap-2 h-10 px-3 rounded-lg",
              "bg-background/60 border border-border/50 transition-smooth",
              "hover:bg-accent text-sm font-medium",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              className,
            )}
          >
            {selected ? getIcon(selected) : <Network className="h-3.5 w-3.5 text-muted-foreground/60" />}
            <span className={cn("truncate max-w-[180px]", !selected && "text-muted-foreground/70")}>
              {chipLabel}
            </span>
            <ChevronDown className={cn("h-3 w-3 text-muted-foreground/60 transition-transform", open && "rotate-180")} />
          </button>
        </PopoverTrigger>
      </TooltipWrapper>
      <PopoverContent
        align="start"
        className="w-[340px] p-0"
      >
        {/* Auto option */}
        <button
          type="button"
          onClick={() => { onChange(""); setOpen(false); }}
          className={cn(
            "w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-smooth border-b border-border/20",
            isAuto ? "bg-primary/10" : "hover:bg-muted/20",
          )}
        >
          <Zap className={cn("h-3.5 w-3.5 shrink-0", isAuto ? "text-primary" : "text-muted-foreground/60")} />
          <div className="flex-1 min-w-0">
            <span className={cn("text-xs font-medium", isAuto ? "text-primary" : "text-foreground")}>
              Auto (default route)
            </span>
            <p className="text-2xs text-muted-foreground/70 mt-0.5">
              Use the system's default network interface
            </p>
          </div>
          {isAuto && <div className="shrink-0 h-2 w-2 rounded-full bg-primary" />}
        </button>

        {/* Refresh row */}
        <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-border/20">
          <span className="text-2xs text-muted-foreground/60">
            {interfaces.length} interface{interfaces.length !== 1 ? "s" : ""}
          </span>
          <TooltipWrapper entry={tooltips.netIfaceRefresh}>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              onClick={(e) => { e.preventDefault(); refresh(); }}
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </Button>
          </TooltipWrapper>
        </div>

        {/* Interface list */}
        <div className="max-h-[280px] overflow-y-auto py-1">
          {sorted.length === 0 ? (
            <EmptyState
              variant="inline"
              title="No interfaces found"
              description="Refresh interfaces or check network adapters."
              className="h-full min-h-0 p-6"
            />
          ) : (
            sorted.map((iface) => {
              const isSelected = value === iface.name;
              const hasLocalIp = localIp && iface.addresses.some((addr) => cleanAddress(addr) === localIp);
              const typeInfo = getType(iface);
              const primaryAddr = iface.addresses.find((a) => !a.includes("::")) || iface.addresses[0];

              return (
                <button
                  key={iface.name}
                  type="button"
                  onClick={() => { onChange(iface.name); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3.5 py-2 text-left transition-smooth",
                    isSelected
                      ? "bg-primary/10"
                      : hasLocalIp
                        ? "bg-warning/[0.04] hover:bg-warning/[0.08]"
                        : "hover:bg-muted/20",
                  )}
                >
                  <div className={cn(
                    "shrink-0",
                    isSelected ? "text-primary" : hasLocalIp ? "text-warning" : "text-muted-foreground/60",
                  )}>
                    {getIcon(iface)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "text-xs font-medium truncate",
                        isSelected ? "text-primary" : hasLocalIp ? "text-warning" : "text-foreground",
                      )}>
                        {iface.description || iface.name}
                      </span>
                      {iface.isDefault && (
                        <TooltipWrapper entry={tooltips.netIfaceDefault}>
                          <Badge variant="secondary" className="text-3xs h-4 px-1.5 py-0 bg-success/10 text-success border-success/30 cursor-help">
                            Default
                          </Badge>
                        </TooltipWrapper>
                      )}
                      {hasLocalIp && !iface.isDefault && (
                        <TooltipWrapper entry={tooltips.netIfaceLocal}>
                          <Badge variant="default" className="text-3xs h-4 px-1.5 py-0 bg-warning text-warning-foreground font-semibold cursor-help">
                            <MapPin className="h-2.5 w-2.5 mr-0.5" />Local
                          </Badge>
                        </TooltipWrapper>
                      )}
                      {typeInfo && !hasLocalIp && (
                        <Badge variant="secondary" className={cn("text-3xs h-4 px-1.5 py-0", typeInfo.className)}>
                          {typeInfo.label}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-2xs text-muted-foreground">
                      <span className="font-mono">{iface.name}</span>
                      {primaryAddr && (
                        <>
                          <span className="text-muted-foreground/60">·</span>
                          <span className="font-mono truncate">
                            {primaryAddr.includes(":") ? primaryAddr.split("%")[0] : primaryAddr}
                          </span>
                          {iface.addresses.length > 1 && (
                            <span className="text-3xs text-muted-foreground/60">+{iface.addresses.length - 1}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
