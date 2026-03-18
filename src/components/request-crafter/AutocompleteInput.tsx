import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Suggestion } from "./crafterSuggestions";

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: Suggestion[];
  placeholder?: string;
  className?: string;
}

export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = value
    ? suggestions.filter(
        (s) =>
          s.text.toLowerCase().includes(value.toLowerCase()) ||
          s.description.toLowerCase().includes(value.toLowerCase()),
      )
    : suggestions;

  const show = open && filtered.length > 0;

  useEffect(() => {
    setHighlightIdx(-1);
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const select = useCallback(
    (text: string) => {
      onChange(text);
      setOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!show) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && highlightIdx >= 0) {
        e.preventDefault();
        const item = filtered[highlightIdx];
        if (item) select(item.text);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [show, filtered, highlightIdx, select],
  );

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />
      {show && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-auto rounded-md border border-border/55 bg-card shadow-card">
          {filtered.map((s, i) => (
            <button
              key={s.text}
              type="button"
              className={cn(
                "flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-accent/50 transition-colors",
                i === highlightIdx && "bg-accent/50",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                select(s.text);
              }}
            >
              <span className="text-xs font-medium">{s.text}</span>
              <span className="text-2xs text-muted-foreground/60 line-clamp-1">
                {s.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
