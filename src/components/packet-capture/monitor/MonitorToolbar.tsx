import { Button } from "@/components/ui/button";
import {
  Download,
  Eye,
  EyeOff,
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelBottom,
  X,
  RefreshCw,
  Trash2,
} from "@/lib/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface MonitorToolbarProps {
  autoScroll: boolean;
  onAutoScrollToggle: () => void;
  packetCount: number;
  totalPacketCount?: number; // Total packets before filtering
  onExport?: () => void;
  onRefresh?: () => void;
  onClear?: () => void;
  panelPosition: "left" | "right" | "bottom" | "top" | "hidden";
  onPanelPositionChange: (position: "left" | "right" | "bottom" | "top" | "hidden") => void;
}

export function MonitorToolbar({
  autoScroll,
  onAutoScrollToggle,
  packetCount,
  totalPacketCount,
  onExport,
  onRefresh,
  onClear,
  panelPosition,
  onPanelPositionChange,
}: MonitorToolbarProps) {
  const getPositionIcon = () => {
    switch (panelPosition) {
      case "left":
        return <PanelLeft className="h-3.5 w-3.5" />;
      case "right":
        return <PanelRight className="h-3.5 w-3.5" />;
      case "bottom":
        return <PanelBottom className="h-3.5 w-3.5" />;
      case "top":
        return <PanelTop className="h-3.5 w-3.5" />;
      case "hidden":
        return <X className="h-3.5 w-3.5" />;
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 bg-muted/30 px-2.5 py-1.5">
      <TooltipWrapper entry={tooltips.capturePacketCount(packetCount, totalPacketCount)}>
        <span className="text-xs text-muted-foreground cursor-help">
          {packetCount.toLocaleString()} packets
          {totalPacketCount !== undefined && totalPacketCount !== packetCount && (
            <span className="text-xs text-muted-foreground/70 ml-1">
              (of {totalPacketCount.toLocaleString()} total)
            </span>
          )}
        </span>
      </TooltipWrapper>

      <div className="flex items-center gap-2">
        <TooltipWrapper entry={autoScroll ? tooltips.captureAutoScrollOn : tooltips.captureAutoScrollOff}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onAutoScrollToggle}
            className={cn("h-8 gap-1.5 px-2 text-xs border border-border/40 bg-background/40 hover:bg-accent/25", autoScroll && "bg-accent/30 text-foreground")}
          >
            {autoScroll ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            <span className="text-xs">
              Auto-scroll {autoScroll ? "(ON)" : "(OFF)"}
            </span>
          </Button>
        </TooltipWrapper>

        <DropdownMenu>
          <TooltipWrapper entry={tooltips.capturePanelLayout}>
            <DropdownMenuTrigger asChild>
              <Button variant="neutral" size="sm" className="h-8 gap-1.5 px-2 text-xs">
                {getPositionIcon()}
                <span className="text-xs">Panel</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipWrapper>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onPanelPositionChange("right")}
              className={cn(panelPosition === "right" && "bg-accent")}
            >
              <PanelRight className="h-4 w-4 mr-2" />
              Right
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onPanelPositionChange("left")}
              className={cn(panelPosition === "left" && "bg-accent")}
            >
              <PanelLeft className="h-4 w-4 mr-2" />
              Left
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onPanelPositionChange("bottom")}
              className={cn(panelPosition === "bottom" && "bg-accent")}
            >
              <PanelBottom className="h-4 w-4 mr-2" />
              Bottom
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onPanelPositionChange("top")}
              className={cn(panelPosition === "top" && "bg-accent")}
            >
              <PanelTop className="h-4 w-4 mr-2" />
              Top
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onPanelPositionChange("hidden")}
              className={cn(panelPosition === "hidden" && "bg-accent")}
            >
              <X className="h-4 w-4 mr-2" />
              Hidden
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>


        {onRefresh && (
          <TooltipWrapper entry={tooltips.captureRefresh}>
            <Button 
              variant="neutral" 
              size="sm" 
              onClick={onRefresh} 
              className="h-8 gap-1.5 px-2 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="text-xs">Refresh</span>
            </Button>
          </TooltipWrapper>
        )}

        {onClear && (
          <TooltipWrapper entry={tooltips.captureClear}>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={onClear} 
              className="h-8 gap-1.5 px-2 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="text-xs">Clear</span>
            </Button>
          </TooltipWrapper>
        )}

        {onExport && (
          <TooltipWrapper entry={tooltips.captureExport}>
            <Button variant="neutral" size="sm" onClick={onExport} className="h-8 gap-1.5 px-2 text-xs">
              <Download className="h-3.5 w-3.5" />
              <span className="text-xs">Export</span>
            </Button>
          </TooltipWrapper>
        )}
      </div>
    </div>
  );
}
