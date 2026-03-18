import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Play, Loader2, Square, ChevronRight } from "@/lib/icons";

interface ToolSectionProps {
  icon: React.ReactNode;
  title: string;
  /** Target input default value */
  defaultTarget?: string;
  /** Placeholder for target input */
  targetPlaceholder?: string;
  /** Label shown above input (optional, not rendered to keep compact) */
  targetLabel?: string;
  /** Whether to show target input */
  showTarget?: boolean;
  /** Currently running */
  running?: boolean;
  /** Custom run label */
  runLabel?: string;
  /** Stoppable tool (e.g. monitor) */
  stoppable?: boolean;
  stopLabel?: string;
  onRun: (target: string) => void;
  onStop?: () => void;
  /** Extra controls rendered between input and button */
  extraControls?: React.ReactNode;
  /** Whether results are present (controls chevron state) */
  hasResults?: boolean;
  /** Result content */
  children?: React.ReactNode;
}

export function ToolSection({
  icon,
  title,
  defaultTarget = "",
  targetPlaceholder = "e.g. 8.8.8.8",
  showTarget = true,
  running = false,
  runLabel = "Run",
  stoppable = false,
  stopLabel = "Stop",
  onRun,
  onStop,
  extraControls,
  hasResults = false,
  children,
}: ToolSectionProps) {
  const [target, setTarget] = useState(defaultTarget);
  const [expanded, setExpanded] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const canRun = showTarget ? target.trim().length > 0 : true;

  // Auto-expand when results arrive
  useEffect(() => {
    if (hasResults) setExpanded(true);
  }, [hasResults]);

  // Auto-expand when running starts (for monitor live view)
  useEffect(() => {
    if (running) setExpanded(true);
  }, [running]);

  return (
    <div className="border-b border-border/50 last:border-b-0">
      {/* Compact tool row */}
      <div className="flex items-center gap-3 py-3 px-1">
        {/* Expand chevron (only when there are results) */}
        <TooltipWrapper
          title={expanded && hasResults ? "Collapse results" : "Expand results"}
          description={hasResults ? (expanded ? "Hide the results area." : "Show the results area.") : "Run the tool to see results."}
        >
          <button
            onClick={() => hasResults && setExpanded(!expanded)}
            className={cn(
              "h-5 w-5 flex items-center justify-center rounded transition-smooth shrink-0",
              hasResults ? "text-muted-foreground hover:text-foreground cursor-pointer" : "text-muted-foreground/60 cursor-default"
            )}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]", expanded && hasResults && "rotate-90")} />
          </button>
        </TooltipWrapper>

        {/* Icon */}
        <div className="h-8 w-8 rounded-lg bg-muted/20 flex items-center justify-center shrink-0">
          {icon}
        </div>

        {/* Title */}
        <span className="text-sm font-medium w-28 shrink-0">{title}</span>

        {/* Target input */}
        {showTarget && (
          <TooltipWrapper title="Target" description={`Host or domain for ${title}.`}>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={targetPlaceholder}
              className="h-8 text-xs flex-1 min-w-[120px] max-w-xs"
              disabled={running}
              onKeyDown={(e) => e.key === "Enter" && canRun && !running && onRun(target)}
            />
          </TooltipWrapper>
        )}

        {/* Extra controls */}
        {extraControls}

        {/* Spacer to push button right when no input */}
        {!showTarget && !extraControls && <div className="flex-1" />}

        {/* Run / Stop button */}
        {stoppable && running ? (
          <TooltipWrapper title={stopLabel} description="Stop the current run.">
            <Button
              variant="destructive"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs shrink-0"
              onClick={onStop}
            >
              <Square className="h-3 w-3" />
              {stopLabel}
            </Button>
          </TooltipWrapper>
        ) : (
          <TooltipWrapper title={runLabel} description={`Run ${title} for the target.`}>
            <Button
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs shrink-0"
              onClick={() => onRun(target)}
              disabled={running || !canRun}
            >
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {running ? "Running..." : runLabel}
            </Button>
          </TooltipWrapper>
        )}
      </div>

      {/* Collapsible results area */}
      <div
        ref={resultRef}
        className={cn(
          "overflow-hidden transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
          expanded && hasResults ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="pb-4 pl-16 pr-1">
          {children}
        </div>
      </div>
    </div>
  );
}
