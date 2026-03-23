import { cn } from "@/lib/utils";
import { X } from "@/lib/icons";
import type { TextForgeRule } from "@/components/tools/text-forge/textForgeEngine";

export interface ChainRuleRow {
  id: string;
  enabled: boolean;
  rule: TextForgeRule;
}

function SlashSeparator() {
  return (
    <span className="mx-0.5 select-none text-[11px] font-light text-muted-foreground/50" aria-hidden>
      /
    </span>
  );
}

/**
 * Pipeline chain using the same segment chrome as header breadcrumbs (PathSegment-style).
 */
export function TextForgeChainBar({
  rows,
  getLabel,
  onRemove,
  onToggleEnabled,
}: {
  rows: ChainRuleRow[];
  getLabel: (row: ChainRuleRow) => string;
  onRemove: (id: string) => void;
  onToggleEnabled: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/35 bg-muted/5 px-2 py-1.5 text-2xs text-muted-foreground">
        No transforms in chain — pick a function from the catalog or search above.
      </div>
    );
  }

  return (
    <div className="flex min-h-8 items-center gap-0.5 overflow-x-auto rounded-md border border-border/25 bg-background/20 px-1 py-1">
      <span className="shrink-0 px-1.5 text-2xs font-medium text-muted-foreground">Chain</span>
      <SlashSeparator />
      {rows.map((row, index) => {
        const label = getLabel(row);
        const isDeepest = index === rows.length - 1;
        return (
          <div key={row.id} className="flex shrink-0 items-center">
            {index > 0 && <SlashSeparator />}
            <div
              className={cn(
                "inline-flex h-8 max-w-[min(220px,40vw)] items-center gap-0.5 rounded-[var(--radius-sm)] pl-2 pr-0.5 transition-smooth",
                row.enabled
                  ? isDeepest
                    ? "bg-primary/10 text-foreground ring-1 ring-primary/25"
                    : "text-foreground hover:bg-muted/20"
                  : "text-muted-foreground/70 line-through opacity-80 hover:bg-muted/15",
              )}
            >
              <button
                type="button"
                className="min-w-0 truncate text-left text-xs font-medium select-none"
                onClick={() => onToggleEnabled(row.id)}
                title={row.enabled ? "Disable step" : "Enable step"}
              >
                {label}
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-smooth"
                aria-label={`Remove ${label}`}
                onClick={() => onRemove(row.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
