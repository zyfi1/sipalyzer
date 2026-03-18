/**
 * PerformanceBar — Unified bottom status bar for the packet monitor.
 * Shows capture state, performance metrics, selection info, and keyboard hints.
 */

import { LiveIndicator } from "@/components/ui/live-indicator";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import {
  Activity,
  AlertTriangle,
  Zap,
  Monitor,
  HardDrive,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { PipelineStats } from "@/api/packetCapture";

interface PerformanceBarProps {
  fps: number;
  packetRate: number;
  dropRate: number;
  packetCount: number;
  isCapturing: boolean;
  isPipelineMode: boolean;
  pipelineStats: PipelineStats | null;
  autoScroll?: boolean;
  selectedIndex?: number | null;
  windowOffset?: number;
}

function formatRate(rate: number): string {
  if (rate >= 1000000) return `${(rate / 1000000).toFixed(1)}M`;
  if (rate >= 1000) return `${(rate / 1000).toFixed(1)}K`;
  return rate.toFixed(0);
}

function getDropRateColor(rate: number): string {
  if (rate >= 5) return "text-destructive";
  if (rate >= 1) return "text-warning";
  return "text-success";
}

function getFpsColor(fps: number): string {
  if (fps >= 50) return "text-success";
  if (fps >= 30) return "text-warning";
  return "text-destructive";
}

export function PerformanceBar({
  fps,
  packetRate,
  dropRate,
  packetCount,
  isCapturing,
  isPipelineMode,
  pipelineStats,
  autoScroll,
  selectedIndex,
  windowOffset = 0,
}: PerformanceBarProps) {
  const queueFill = pipelineStats
    ? Math.max(
        (pipelineStats.rawQueueSize ?? 0) / 65536,
        (pipelineStats.parsedQueueSize ?? 0) / 32768
      ) * 100
    : 0;

  return (
    <div className="flex-none flex flex-col border-t border-border/45 bg-card/50">
      {/* Existing status bar */}
      <div className="h-7 px-3 flex items-center gap-3 text-xs select-none bg-muted/20">
      {/* Capture state */}
      {isCapturing ? (
        <LiveIndicator variant="badge" label="REC" size="xs" />
      ) : (
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
          <span className="text-muted-foreground">Idle</span>
        </div>
      )}

      <div className="w-px h-3.5 bg-border/40" />

      {/* FPS */}
      <TooltipWrapper entry={tooltips.captureFps}>
        <div className="flex items-center gap-1 cursor-help">
          <Monitor className="h-3 w-3 text-muted-foreground/60" />
          <span className={cn("font-mono tabular-nums text-2xs", getFpsColor(fps))}>
            {fps}
          </span>
          <span className="text-muted-foreground/60 text-2xs">fps</span>
        </div>
      </TooltipWrapper>

      {/* Packet rate */}
      {isCapturing && (
        <TooltipWrapper entry={tooltips.capturePacketRate}>
          <div className="flex items-center gap-1 cursor-help">
            <Activity className="h-3 w-3 text-muted-foreground/60" />
            <span className="font-mono tabular-nums text-2xs">{formatRate(packetRate)}</span>
            <span className="text-muted-foreground/60 text-2xs">pkt/s</span>
          </div>
        </TooltipWrapper>
      )}

      {/* Drop rate (pipeline only) */}
      {isPipelineMode && isCapturing && (
        <TooltipWrapper entry={tooltips.captureDropRate}>
          <div className="flex items-center gap-1 cursor-help">
            <AlertTriangle className={cn("h-3 w-3", getDropRateColor(dropRate))} />
            <span className={cn("font-mono tabular-nums text-2xs", getDropRateColor(dropRate))}>
              {dropRate.toFixed(1)}%
            </span>
            <span className="text-muted-foreground/60 text-2xs">drop</span>
          </div>
        </TooltipWrapper>
      )}

      {/* Queue fill (pipeline only) */}
      {isPipelineMode && isCapturing && pipelineStats && (
        <TooltipWrapper entry={tooltips.captureQueueStatus}>
          <div className="flex items-center gap-1.5 cursor-help">
            <Zap className="h-3 w-3 text-muted-foreground/60" />
            <div className="w-10 h-1.5 bg-muted/30 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-smooth",
                  queueFill < 50 ? "bg-success" :
                  queueFill < 80 ? "bg-warning" : "bg-destructive"
                )}
                style={{ width: `${Math.min(100, queueFill)}%` }}
              />
            </div>
          </div>
        </TooltipWrapper>
      )}

      {/* Auto-scroll badge */}
      {autoScroll && (
        <>
          <div className="w-px h-3.5 bg-border/40" />
          <span className="text-success/80 text-2xs font-medium">Auto-scroll</span>
        </>
      )}

      {/* Selected packet */}
      {selectedIndex != null && selectedIndex >= 0 && (
        <span className="text-muted-foreground/60 tabular-nums text-2xs">
          #{(windowOffset + selectedIndex + 1).toLocaleString()}
        </span>
      )}

      <div className="flex-1" />

      {/* Keyboard hints */}
      <span className="text-muted-foreground/60 text-2xs hidden md:flex items-center gap-1.5">
        <kbd className="px-1 py-px rounded-md border border-border/45 bg-card/70 text-muted-foreground/70 text-3xs font-mono">↑↓</kbd>
        <span>Navigate</span>
        <kbd className="px-1 py-px rounded-md border border-border/45 bg-card/70 text-muted-foreground/70 text-3xs font-mono ml-1">Space</kbd>
        <span>Scroll lock</span>
      </span>

      <div className="w-px h-3.5 bg-border/40" />

      {/* Packet count */}
      <TooltipWrapper entry={tooltips.perfPacketCount}>
        <div className="flex items-center gap-1 cursor-help">
          <HardDrive className="h-3 w-3 text-muted-foreground/60" />
          <span className="font-mono tabular-nums text-2xs font-medium">
            {packetCount.toLocaleString()}
          </span>
          <span className="text-muted-foreground/60 text-2xs">
            {packetCount === 1 ? "packet" : "packets"}
          </span>
        </div>
      </TooltipWrapper>

      {/* Capture mode badge */}
      {isPipelineMode && (
        <TooltipWrapper entry={tooltips.captureMode(isPipelineMode)}>
          <div className="flex items-center gap-1 cursor-help text-2xs">
            <Zap className="h-3 w-3 text-success/60" />
            <span className="text-success/60 font-medium">Pipeline</span>
          </div>
        </TooltipWrapper>
      )}
      </div>
    </div>
  );
}

export default PerformanceBar;
