/**
 * LiveIndicator — A clean, design-aligned live/recording state indicator.
 *
 * System:
 *   `liveRingClass`  — Ripple rings emanating outward from any element, using
 *                       the theme's primary color. Apply to sidebar buttons,
 *                       session cards, tabs, etc.
 *   "badge" variant  — Pill with breathing dot + label (for headers/footers).
 *   "dot"   variant  — Tiny breathing dot (tight spaces).
 */

import { cn } from "@/lib/utils";

// ── Class helper: ripple rings emanating outward ───────────────────────
// Apply to any element. Uses --primary so it matches the sidebar/theme.
export const liveRingClass =
  "ring-1 ring-primary/40 bg-transparent animate-live-ripple";

// ── Props ──────────────────────────────────────────────────────────────
interface LiveIndicatorProps {
  /** Visual variant */
  variant?: "dot" | "badge";
  /** Label text shown in badge variant (default "LIVE") */
  label?: string;
  /** Size — "xs" for tab bars, "sm" for inline, "md" for headers */
  size?: "xs" | "sm" | "md";
  className?: string;
}

export function LiveIndicator({
  variant = "dot",
  label = "LIVE",
  size = "sm",
  className,
}: LiveIndicatorProps) {
  if (variant === "badge") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-mono font-medium uppercase tracking-wider select-none",
          "rounded-full border",
          "bg-primary/10 text-primary border-primary/25",
          size === "xs" && "text-3xs px-1.5 py-px gap-1",
          size === "sm" && "text-2xs px-2 py-0.5",
          size === "md" && "text-2xs px-2.5 py-0.5",
          className,
        )}
      >
        <span
          className={cn(
            "rounded-full bg-primary animate-live-breathe motion-reduce:animate-none",
            size === "xs" && "h-1 w-1",
            size === "sm" && "h-1.5 w-1.5",
            size === "md" && "h-1.5 w-1.5",
          )}
        />
        {label}
      </span>
    );
  }

  // Dot variant — a small breathing circle
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0",
        size === "xs" && "h-1.5 w-1.5",
        size === "sm" && "h-2 w-2",
        size === "md" && "h-2.5 w-2.5",
        className,
      )}
    >
      {/* Soft glow ring */}
      <span className="absolute inset-0 rounded-full bg-primary/40 animate-live-breathe motion-reduce:animate-none" />
      {/* Solid core */}
      <span className="relative inline-flex h-full w-full rounded-full bg-primary" />
    </span>
  );
}
