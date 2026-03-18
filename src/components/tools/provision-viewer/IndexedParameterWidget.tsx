/**
 * Indexed Parameter Widget — floating popover for editing grouped parameters
 *
 * Appears near the cursor when on an indexed parameter line (e.g.
 * multicast.paging_address.1.ip_address). Shows all instances of that
 * parameter group as editable form fields with add/remove controls.
 * Every keystroke syncs live back to the Monaco editor.
 */

import { useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Trash2, Search } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { IndexedParamGroup } from "./indexedParameterGroups";
import { EmptyState } from "@/components/ui/empty-state";

// ── Types ───────────────────────────────────────────────────────────────────

export interface IndexedParameterWidgetProps {
  group: IndexedParamGroup;
  instances: Map<number, Record<string, string>>;
  /** Pixel position relative to viewport for anchoring the popover */
  anchorPosition: { top: number; left: number };
  onFieldChange: (index: number, suffix: string, value: string) => void;
  onAddInstance: () => void;
  onRemoveInstance: (index: number) => void;
  onClose: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function IndexedParameterWidget({
  group,
  instances,
  anchorPosition,
  onFieldChange,
  onAddInstance,
  onRemoveInstance,
  onClose,
}: IndexedParameterWidgetProps) {
  const widgetRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Sorted indices
  const sortedIndices = Array.from(instances.keys()).sort((a, b) => a - b);
  const instanceCount = sortedIndices.length;

  // Position calculation: place the widget to the right of cursor,
  // or flip left if not enough space
  const computeStyle = useCallback((): React.CSSProperties => {
    const DESKTOP_WIDGET_WIDTH = 360;
    const DESKTOP_WIDGET_MAX_HEIGHT = 460;
    const OFFSET_X = 20;
    const OFFSET_Y = -10;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 16;
    const width = Math.min(DESKTOP_WIDGET_WIDTH, Math.max(280, vw - margin * 2));
    const maxHeight = Math.min(DESKTOP_WIDGET_MAX_HEIGHT, vh - margin * 2);

    let top = anchorPosition.top + OFFSET_Y;
    let left = anchorPosition.left + OFFSET_X;

    // Flip to the left when there isn't enough room on the right.
    if (left + width > vw - margin) {
      left = anchorPosition.left - width - OFFSET_X;
    }
    if (left < margin) left = margin;
    if (top + maxHeight > vh - margin) {
      top = vh - maxHeight - margin;
    }
    if (top < margin) top = margin;

    return {
      position: "fixed",
      top,
      left,
      width,
      maxHeight,
      zIndex: 9997,
    };
  }, [anchorPosition]);

  const content = (
    <div
      ref={widgetRef}
      style={computeStyle()}
      className={cn(
        "ui-floating-surface rounded-md border border-border/55 text-popover-foreground",
        "flex flex-col overflow-hidden",
        "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]"
      )}
      // Prevent clicks inside the widget from stealing editor focus
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="ui-section-header-sm flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-foreground truncate">
            {group.label}
          </span>
          <span className="text-2xs text-muted-foreground/60 tabular-nums shrink-0">
            {instanceCount} {instanceCount === 1 ? "entry" : "entries"}
          </span>
        </div>
        <TooltipWrapper title="Close" description="Close the parameter widget.">
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth"
          >
            <X className="h-3 w-3" />
          </button>
        </TooltipWrapper>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto min-h-0">
        {sortedIndices.length === 0 ? (
          <EmptyState
            compact
            variant="inline"
            icon={<Search />}
            title="No instances found in the editor"
            description="Place your cursor on an indexed key to load editable entries."
            className="p-6"
          />
        ) : (
          <div className="divide-y divide-border/30">
            {sortedIndices.map((index) => {
              const values = instances.get(index) ?? {};
              return (
                <div key={index} className="px-3 py-2.5 space-y-1.5">
                  {/* Index header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-accent text-foreground text-2xs font-bold tabular-nums">
                        {index}
                      </span>
                      <span className="text-2xs text-muted-foreground/60 font-mono">
                        {group.basePrefix}.{index}
                      </span>
                    </div>
                    <TooltipWrapper title={`Remove index ${index}`} description="Remove this entry from the editor.">
                      <button
                        type="button"
                        onClick={() => onRemoveInstance(index)}
                        className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-smooth"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </TooltipWrapper>
                  </div>

                  {/* Fields */}
                  <div className="space-y-1">
                    {group.fields.map((field) => {
                      const currentValue = values[field.suffix] ?? "";
                      return (
                        <div
                          key={field.suffix}
                          className="flex items-center gap-2"
                        >
                          <label className="text-2xs text-muted-foreground font-medium w-20 shrink-0 text-right truncate">
                            {field.label}
                          </label>
                          <Input
                            value={currentValue}
                            onChange={(e) =>
                              onFieldChange(index, field.suffix, e.target.value)
                            }
                            placeholder={field.placeholder}
                            className="h-7 text-2xs font-mono flex-1 min-w-0 px-2 ui-control-shell"
                            spellCheck={false}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="surface-subtle shrink-0 border-t border-border/50 px-3 py-2">
        <TooltipWrapper title="Add Entry" description="Add a new indexed entry to the config.">
          <Button
            variant="ghost"
            size="sm"
            className="ui-control-shell w-full h-7 text-2xs gap-1.5 text-foreground hover:text-foreground"
            onClick={onAddInstance}
          >
            <Plus className="h-3 w-3" />
            Add Entry
          {group.maxIndex && (
            <span className="text-muted-foreground/60 ml-1">
              (max {group.maxIndex})
            </span>
          )}
        </Button>
        </TooltipWrapper>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
