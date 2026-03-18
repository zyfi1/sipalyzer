import { Fragment } from "react";
import { useToolStore } from "@/stores/toolStore";
import { useBreadcrumbStore } from "@/stores/breadcrumbStore";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Tick } from "@/lib/icons";

/**
 * Breadcrumb segment for the active level.
 * Click to navigate back to that level.
 */
function PathSegment({
  label,
  value,
  items,
  onChange,
  isDeepest,
}: {
  label: string;
  value: string;
  items: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
  isDeepest: boolean;
}) {
  const hasChoices = items.length > 1;

  if (!hasChoices) {
    return (
      <button
        type="button"
        onClick={() => onChange(value)}
        className={cn(
          "inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-[var(--radius-sm)] transition-smooth select-none whitespace-nowrap",
          isDeepest
            ? "text-foreground hover:bg-muted/20"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/20",
        )}
        aria-current={isDeepest ? "page" : undefined}
      >
        {label}
      </button>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-[var(--radius-sm)] transition-smooth select-none whitespace-nowrap",
            isDeepest
              ? "text-foreground hover:bg-muted/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/20",
          )}
          aria-current={isDeepest ? "page" : undefined}
        >
          <span className="max-w-[18ch] truncate">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-56">
        {items.map((item) => {
          const isActive = item.id === value;
          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => onChange(item.id)}
              className={cn(isActive && "bg-accent/35")}
            >
              <span className="flex-1 truncate">{item.label}</span>
              {isActive && <Tick className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SlashSeparator() {
  return (
    <span className="text-muted-foreground/50 text-[10px] font-light select-none mx-0.5" aria-hidden>
      /
    </span>
  );
}

/**
 * Breadcrumb path rendered in the header.
 * Each segment is directly clickable to jump back to that level.
 */
export function BreadcrumbNav() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const segments = useBreadcrumbStore((s) =>
    activeToolId ? s.segments[activeToolId] : undefined,
  );

  const levels = segments
    ? Object.keys(segments)
        .map(Number)
        .sort((a, b) => a - b)
    : [];
  const hasSegments = levels.length > 0;

  if (!hasSegments) return null;

  const lastLevel = levels[levels.length - 1];
  return (
    <nav
      className="flex items-center min-w-0 app-chrome-content-swap"
      aria-label="breadcrumb"
    >
      {levels.map((level) => {
        const seg = segments?.[level];
        if (!seg) return null;
        return (
          <Fragment key={level}>
            <SlashSeparator />
            <PathSegment
              label={seg.items.find((i) => i.id === seg.value)?.label ?? seg.value}
              value={seg.value}
              items={seg.items}
              onChange={seg.onChange}
              isDeepest={level === lastLevel}
            />
          </Fragment>
        );
      })}

    </nav>
  );
}
