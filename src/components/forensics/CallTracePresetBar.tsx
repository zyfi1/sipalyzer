import { Button } from "@/components/ui/button";
import { Filter } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { CALL_TRACE_PRESET_OPTIONS, type CallTraceListPreset } from "./callTraceListFilter";

export function CallTracePresetBar({
  value,
  onChange,
  className,
}: {
  value: CallTraceListPreset;
  onChange: (next: CallTraceListPreset) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 px-2.5 py-1.5 border-b border-border/30 bg-muted/[0.08]",
        className,
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="flex items-center gap-1 text-3xs font-medium text-muted-foreground shrink-0 mr-0.5">
        <Filter className="h-3 w-3 opacity-80" aria-hidden />
        Quick filters
      </span>
      {CALL_TRACE_PRESET_OPTIONS.map((p) => (
        <Button
          key={p.id}
          type="button"
          variant={value === p.id ? "secondary" : "ghost"}
          size="sm"
          className={cn(
            "h-6 px-2 text-3xs rounded-md font-medium",
            value === p.id && "shadow-sm border border-border/40",
          )}
          title={p.title}
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
