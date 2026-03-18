import { useState, useEffect } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Play, 
  Square, 
  Settings, 
  Network, 
  RefreshCw, 
  Wifi, 
  HardDrive, 
  Radio,
} from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterDialog } from "./FilterDialog";

import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";
import { LiveIndicator } from "@/components/ui/live-indicator";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import type { FilterConfig, NetworkInterface } from "@/types/packetCapture";

export function CaptureControl() {
  const interfaces = usePacketCaptureStore((s) => s.interfaces);
  const loadingInterfaces = usePacketCaptureStore((s) => s.loadingInterfaces);
  const fetchInterfaces = usePacketCaptureStore((s) => s.fetchInterfaces);
  const startCapture = usePacketCaptureStore((s) => s.startCapture);
  const stopCapture = usePacketCaptureStore((s) => s.stopCapture);
  const activeSessionId = usePacketCaptureStore((s) => s.activeSessionId);
  const isCapturing = usePacketCaptureStore((s) => s.isCapturing);
  const { notify } = useNotifications();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedInterface, setSelectedInterface] = useState<string>("");
  const [filterConfig, setFilterConfig] = useState<FilterConfig>({
    protocols: ["SIP", "RTP", "RTCP", "FAX"],
    srcIpRanges: [],
    dstIpRanges: [],
    srcPorts: [],
    dstPorts: [],
    portRanges: [],
  });
  const [showFilterDialog, setShowFilterDialog] = useState(false);

  useEffect(() => {
    fetchInterfaces();
  }, [fetchInterfaces]);

  // Find the active/default interface (only one should be recommended)
  const getActiveInterface = () => {
    if (interfaces.length === 0) return null;

    // Filter out loopback and virtual interfaces
    const candidateInterfaces = interfaces.filter(i => {
      const isLoopback = i.name.includes("lo") || 
                        i.name.includes("Loopback") || 
                        i.name.includes("loopback");
      const isVirtual = i.name.includes("veth") || 
                       i.name.includes("docker") ||
                       i.name.includes("br-") ||
                       i.name.includes("virbr");
      return !isLoopback && !isVirtual && i.addresses.length > 0;
    });

    if (candidateInterfaces.length === 0) return null;

    // Prefer common primary interface names (OS-specific)
    // macOS: en0, en1 (Ethernet/WiFi)
    // Linux: eth0, wlan0
    // Windows: varies
    const primaryNames = ["en0", "en1", "eth0", "wlan0", "Wi-Fi", "Ethernet"];
    const primary = candidateInterfaces.find(i => 
      primaryNames.some(name => i.name.toLowerCase().includes(name.toLowerCase()))
    );

    // Return primary if found, otherwise first candidate
    return primary || candidateInterfaces[0];
  };

  useEffect(() => {
    if (interfaces.length > 0 && !selectedInterface) {
      const active = getActiveInterface();
      if (active) {
        setSelectedInterface(active.name);
      } else {
        // Fallback to first non-loopback
        const nonLoopback = interfaces.find(i => 
          !i.name.includes("lo") && 
          !i.name.includes("Loopback") && 
          !i.name.includes("loopback")
        );
        if (nonLoopback) {
          setSelectedInterface(nonLoopback.name);
        } else {
          const first = interfaces[0];
          if (first) setSelectedInterface(first.name);
        }
      }
    }
  }, [interfaces, selectedInterface]);

  const handleStart = async () => {
    if (!name.trim()) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Error",
        description: "Please enter a session name",
      });
      return;
    }

    if (!selectedInterface) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Error",
        description: "Please select a network interface",
      });
      return;
    }

    try {
      const ctx = useExecutionContextStore.getState().resolvedContext("packetCapture");
      await startCapture(name, description || null, selectedInterface, filterConfig, ctx);
      notify({ source: "packet-capture",
        type: "success",
        title: "Capture Started",
        description: `Started capturing on ${selectedInterface}`,
      });
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed to Start Capture",
        description: error.message || "Unknown error",
      });
    }
  };

  const handleStop = async () => {
    if (!activeSessionId) return;

    try {
      await stopCapture(activeSessionId);
      notify({ source: "packet-capture",
        type: "success",
        title: "Capture Stopped",
        description: "Packet capture has been stopped",
      });
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed to Stop Capture",
        description: error.message || "Unknown error",
      });
    }
  };

  const getInterfaceIcon = (iface: NetworkInterface) => {
    const isLoopback = iface.name.includes("lo") || 
                      iface.name.includes("Loopback") || 
                      iface.name.includes("loopback");
    const isVirtual = iface.name.includes("veth") || 
                     iface.name.includes("docker") ||
                     iface.name.includes("br-") ||
                     iface.name.includes("virbr");
    
    if (isLoopback) return <Radio className="h-4 w-4" />;
    if (isVirtual) return <HardDrive className="h-4 w-4" />;
    if (iface.name.includes("wlan") || iface.name.includes("Wi-Fi") || iface.name.includes("en0")) {
      return <Wifi className="h-4 w-4" />;
    }
    return <Network className="h-4 w-4" />;
  };

  const getInterfaceType = (iface: NetworkInterface) => {
    const isLoopback = iface.name.includes("lo") || 
                      iface.name.includes("Loopback") || 
                      iface.name.includes("loopback");
    const isVirtual = iface.name.includes("veth") || 
                     iface.name.includes("docker") ||
                     iface.name.includes("br-") ||
                     iface.name.includes("virbr");
    
    // Only mark the active interface as recommended (not all non-loopback interfaces)
    const activeInterface = getActiveInterface();
    const isRecommended = activeInterface && activeInterface.name === iface.name;
    
    if (isRecommended) return { label: "Recommended", variant: "default" as const };
    if (isLoopback) return { label: "Loopback", variant: "secondary" as const };
    if (isVirtual) return { label: "Virtual", variant: "secondary" as const };
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Session Configuration */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="session-name" className="text-sm font-medium">
                Session Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="session-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., SIP Registration Test"
                disabled={isCapturing}
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description
              </Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                disabled={isCapturing}
                className="h-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Network Interface Selection */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <TooltipWrapper entry={tooltips.ifaceNetworkInterface}>
              <Label className="text-sm font-medium cursor-help">
                Network Interface <span className="text-destructive">*</span>
              </Label>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.captureRefreshInterfaces}>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchInterfaces}
                disabled={loadingInterfaces}
                className="h-7 gap-1.5 px-2"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loadingInterfaces && "animate-spin")} />
                <span className="text-xs">Refresh</span>
              </Button>
            </TooltipWrapper>
          </div>

          {loadingInterfaces ? (
            <div className="text-center py-6">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Loading interfaces...</p>
            </div>
          ) : interfaces.length === 0 ? (
            <EmptyState compact variant="inline" title="No interfaces found" />
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {interfaces.map((iface) => {
                const isSelected = selectedInterface === iface.name;
                const typeInfo = getInterfaceType(iface);
                const primaryAddress = iface.addresses.find(addr => !addr.includes("::")) || iface.addresses[0];

                return (
                  <button
                    key={iface.name}
                    type="button"
                    onClick={() => !isCapturing && setSelectedInterface(iface.name)}
                    disabled={isCapturing}
                    className={cn(
                      "w-full text-left p-2.5 rounded-md border transition-smooth",
                      "hover:bg-accent/50 hover:border-accent-foreground/30",
                      isSelected 
                        ? "bg-accent border-foreground/30 ring-1 ring-foreground/20" 
                        : "border-border bg-card",
                      isCapturing && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "flex-shrink-0",
                        isSelected ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {getInterfaceIcon(iface)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={cn(
                            "text-sm font-medium truncate",
                            isSelected && "text-foreground"
                          )}>
                            {iface.description || iface.name}
                          </span>
                          {typeInfo && (
                            <TooltipWrapper entry={
                              typeInfo.label === "Recommended" ? tooltips.ifaceRecommended :
                              typeInfo.label === "Loopback" ? tooltips.ifaceLoopback :
                              tooltips.ifaceVirtual
                            }>
                              <Badge variant={typeInfo.variant} className="text-2xs h-4 px-1 py-0 cursor-help">
                                {typeInfo.label}
                              </Badge>
                            </TooltipWrapper>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{iface.name}</span>
                          {primaryAddress && (
                            <>
                              <span>•</span>
                              <span className="font-mono truncate">{primaryAddress}</span>
                              {iface.addresses.length > 1 && (
                                <span className="text-2xs">+{iface.addresses.length - 1}</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="flex-shrink-0">
                          <div className="h-2 w-2 rounded-full bg-foreground/60" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capture Controls */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <TooltipWrapper entry={tooltips.captureConfigureFilters}>
                <Button
                  variant="outline"
                  onClick={() => setShowFilterDialog(true)}
                  disabled={isCapturing}
                  className="gap-2"
                >
                  <Settings className="h-4 w-4" />
                  Configure Filters
                </Button>
              </TooltipWrapper>
            </div>

            <div className="flex items-center gap-3">
              {isCapturing && (
                <LiveIndicator variant="badge" label="REC" size="sm" />
              )}
              {isCapturing ? (
                <TooltipWrapper entry={tooltips.captureStop}>
                  <Button 
                    onClick={handleStop} 
                    variant="destructive" 
                    size="lg"
                    className="gap-2 min-w-[140px]"
                  >
                    <Square className="h-4 w-4" />
                    Stop Capture
                  </Button>
                </TooltipWrapper>
              ) : (
                <TooltipWrapper entry={tooltips.captureStart}>
                  <Button 
                    onClick={handleStart} 
                    size="lg"
                    className="gap-2 min-w-[140px]"
                    disabled={!name.trim() || !selectedInterface}
                  >
                    <Play className="h-4 w-4" />
                    Start Capture
                  </Button>
                </TooltipWrapper>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {showFilterDialog && (
        <FilterDialog
          filterConfig={filterConfig}
          onSave={(config) => {
            setFilterConfig(config);
            setShowFilterDialog(false);
          }}
          onCancel={() => setShowFilterDialog(false)}
        />
      )}
    </div>
  );
}
