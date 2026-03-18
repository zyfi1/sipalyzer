/**
 * PipelineToggle - UI toggle to switch between standard and pipeline capture modes.
 * 
 * Pipeline mode uses multi-threaded capture for high-performance (100k+ pps).
 * Standard mode uses single-threaded capture for compatibility.
 */

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Zap } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface PipelineToggleProps {
  /** Whether pipeline mode is enabled */
  enabled: boolean;
  /** Callback when toggle changes */
  onChange: (enabled: boolean) => void;
  /** Whether the toggle is disabled (e.g., during capture) */
  disabled?: boolean;
  /** Optional class name */
  className?: string;
}

export function PipelineToggle({
  enabled,
  onChange,
  disabled,
  className,
}: PipelineToggleProps) {
  return (
    <TooltipWrapper
      content={
        <div className="max-w-xs">
          <p className="font-medium mb-1">
            {enabled ? "High Performance Mode" : "Standard Mode"}
          </p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "Multi-threaded pipeline capture optimized for 100k+ packets/second. Uses separate threads for capture, parsing, and storage."
              : "Single-threaded capture suitable for normal traffic volumes. Lower resource usage but may drop packets at high rates."}
          </p>
          {disabled && (
            <p className="text-xs text-warning mt-1">
              Stop capture to change mode
            </p>
          )}
        </div>
      }
    >
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-smooth",
          enabled
            ? "border-success/40 bg-success/10"
            : "border-border bg-muted/30",
          disabled && "opacity-60 cursor-not-allowed",
          className
        )}
      >
        <Zap
          className={cn(
            "h-3.5 w-3.5 transition-smooth",
            enabled ? "text-success" : "text-muted-foreground"
          )}
        />
        <span className="text-xs font-medium">
          {enabled ? "Pipeline" : "Standard"}
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={onChange}
          disabled={disabled}
          className="scale-75"
        />
        {enabled && (
          <Badge
            variant="secondary"
            className="text-3xs px-1.5 py-0 bg-success/20 text-success border-0 font-medium"
          >
            100k+ pps
          </Badge>
        )}
      </div>
    </TooltipWrapper>
  );
}

export default PipelineToggle;
