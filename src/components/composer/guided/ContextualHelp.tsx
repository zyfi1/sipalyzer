/**
 * Contextual help — a small "?" icon that expands inline help text.
 * Used next to form field labels in the guided wizards.
 */

import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface ContextualHelpProps {
  text: string;
  className?: string;
}

export function ContextualHelp({ text, className }: ContextualHelpProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center justify-center h-4 w-4 rounded-full transition-smooth",
          open
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground/60 hover:text-muted-foreground/70 hover:bg-muted/30"
        )}
        aria-label="Help"
      >
        <HelpCircle className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute z-50 left-6 top-0 w-56 p-2.5 bg-card border border-border/55 rounded-md shadow-card animate-in fade-in-0 zoom-in-95 duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]">
          <p className="text-2xs text-muted-foreground leading-relaxed">{text}</p>
        </div>
      )}
    </div>
  );
}
