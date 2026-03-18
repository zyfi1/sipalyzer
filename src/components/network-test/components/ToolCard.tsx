import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Play, Loader2, Square } from "@/lib/icons";
import { TOOLKIT_CARD_SHELL, TOOLKIT_ICON_SHELL } from "./surfaceClasses";

interface ToolCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Default target host/domain pre-filled in the input */
  defaultTarget?: string;
  /** Label for the target input */
  targetLabel?: string;
  /** Placeholder text for the input */
  targetPlaceholder?: string;
  /** Whether to show a target input at all */
  showTarget?: boolean;
  /** Whether the tool is currently running */
  running?: boolean;
  /** Custom run label */
  runLabel?: string;
  /** Custom stop label for stoppable tools */
  stopLabel?: string;
  /** Whether the tool can be stopped */
  stoppable?: boolean;
  /** Called when the Run button is clicked, receives current target */
  onRun: (target: string) => void;
  /** Called when the Stop button is clicked */
  onStop?: () => void;
  /** Extra controls to render next to the target input (e.g., count, codec select) */
  extraControls?: React.ReactNode;
  /** Hide the controls row (target input + run button) entirely */
  hideControls?: boolean;
  /** Result content rendered below when available */
  children?: React.ReactNode;
  className?: string;
}

export function ToolCard({
  icon,
  title,
  description,
  defaultTarget = "",
  targetLabel = "Target",
  targetPlaceholder = "e.g. google.com",
  showTarget = true,
  running = false,
  runLabel = "Run",
  stopLabel = "Stop",
  stoppable = false,
  onRun,
  onStop,
  extraControls,
  hideControls = false,
  children,
  className,
}: ToolCardProps) {
  const [target, setTarget] = useState(defaultTarget);

  const canRun = showTarget ? target.trim().length > 0 : true;

  return (
    <div className={cn(TOOLKIT_CARD_SHELL, "overflow-hidden", className)}>
      {/* Header */}
      <div className="p-5 pb-4">
        <div className="flex items-start gap-3 mb-3">
          <div className={cn(TOOLKIT_ICON_SHELL, "mt-0.5")}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold leading-tight">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>

        {/* Controls row */}
        {!hideControls && (
          <div className="flex items-end gap-2 flex-wrap">
            {showTarget && (
              <div className="flex-1 min-w-[160px]">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{targetLabel}</label>
                <TooltipWrapper title={targetLabel} description={`Host or domain to run ${title} against.`}>
                  <Input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder={targetPlaceholder}
                    className="h-10"
                    disabled={running}
                    onKeyDown={(e) => e.key === "Enter" && canRun && !running && onRun(target)}
                  />
                </TooltipWrapper>
              </div>
            )}
            {extraControls}
            {stoppable && running ? (
              <TooltipWrapper title={stopLabel} description="Stop the current run.">
                <Button
                  variant="destructive"
                  className="h-10 gap-1.5 px-5"
                  onClick={onStop}
                >
                  <Square className="h-4 w-4" />
                  {stopLabel}
                </Button>
              </TooltipWrapper>
            ) : (
              <TooltipWrapper title={runLabel} description={`Run ${title} for the target.`}>
                <Button
                  className="h-10 gap-1.5 px-5"
                  onClick={() => onRun(target)}
                  disabled={running || !canRun}
                >
                  {running ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {running ? "Running..." : runLabel}
                </Button>
              </TooltipWrapper>
            )}
          </div>
        )}
      </div>

      {/* Results area */}
      {children && (
        <div className="border-t bg-muted/10 p-5 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}
