/**
 * Parameter Insert Dialog
 *
 * Command-palette-style modal for searching and inserting Yealink provision
 * parameters. Results are grouped by category. Selecting an item inserts the
 * key at the caller's cursor position.
 */

import { useState, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Search } from "@/lib/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  type FieldReferenceEntry,
  YEALINK_FIELD_REFERENCE,
  getAllCategories,
  keyToInsertString,
} from "./yealinkFieldReference";

// ── Types ───────────────────────────────────────────────────────────────────

interface ParameterInsertDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the full line to insert, e.g. "account.1.enable = " */
  onInsert: (line: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a searchable string from a reference entry. */
function buildSearchValue(entry: FieldReferenceEntry): string {
  const keyStr = typeof entry.key === "string"
    ? entry.key
    : (entry.key as RegExp).source.replace(/[\\^$()[\]{}|+?.*]/g, " ");
  return `${keyStr} ${entry.label} ${entry.category ?? ""} ${entry.description}`.toLowerCase();
}

/**
 * Smart parsing for option strings. Returns array of individual options.
 */
function parseOptionsString(options: string): string[] {
  if (!options || !options.trim()) return [];
  const trimmed = options.trim();
  if (trimmed.includes(" | ")) return trimmed.split(" | ").map(s => s.trim()).filter(Boolean);
  const numberedPattern = /,\s+(?=\d+\s*=)/;
  if (numberedPattern.test(trimmed)) return trimmed.split(numberedPattern).map(s => s.trim()).filter(Boolean);
  if (trimmed.includes(";")) {
    const parts = trimmed.split(/;\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
  }
  const hasEquals = trimmed.includes("=");
  const commaCount = (trimmed.match(/,/g) || []).length;
  if (!hasEquals && commaCount > 0 && commaCount <= 10) return trimmed.split(/,\s*/).map(s => s.trim()).filter(Boolean);
  return [trimmed];
}

/** Check if entry key is a regex pattern that contains a numeric placeholder. */
function hasIndexPlaceholder(entry: FieldReferenceEntry): boolean {
  if (typeof entry.key === "string") return false;
  const src = (entry.key as RegExp).source;
  return /\\d\+|\[0-9\]/.test(src);
}

// ── Component ───────────────────────────────────────────────────────────────

export function ParameterInsertDialog({ open, onClose, onInsert }: ParameterInsertDialogProps) {
  const [search, setSearch] = useState("");
  const [indexPrompt, setIndexPrompt] = useState<{ entry: FieldReferenceEntry; value: string } | null>(null);

  const categories = useMemo(() => getAllCategories(), []);

  // Group entries by category
  const grouped = useMemo(() => {
    const map = new Map<string, FieldReferenceEntry[]>();
    for (const cat of categories) map.set(cat, []);
    for (const entry of YEALINK_FIELD_REFERENCE) {
      const cat = entry.category ?? "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(entry);
    }
    return map;
  }, [categories]);

  // Filter entries by search term
  const filteredGrouped = useMemo(() => {
    if (!search.trim()) return grouped;
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    const result = new Map<string, FieldReferenceEntry[]>();
    for (const [cat, entries] of grouped) {
      const filtered = entries.filter((e) => {
        const sv = buildSearchValue(e);
        return terms.every((t) => sv.includes(t));
      });
      if (filtered.length > 0) result.set(cat, filtered);
    }
    return result;
  }, [search, grouped]);

  const handleSelect = useCallback((entry: FieldReferenceEntry) => {
    if (hasIndexPlaceholder(entry)) {
      // Show index prompt
      setIndexPrompt({ entry, value: "1" });
    } else {
      const key = keyToInsertString(entry);
      onInsert(`${key} = `);
      setSearch("");
      onClose();
    }
  }, [onInsert, onClose]);

  const handleIndexConfirm = useCallback(() => {
    if (!indexPrompt) return;
    const idx = parseInt(indexPrompt.value, 10);
    const key = keyToInsertString(indexPrompt.entry, isNaN(idx) ? 1 : idx);
    onInsert(`${key} = `);
    setIndexPrompt(null);
    setSearch("");
    onClose();
  }, [indexPrompt, onInsert, onClose]);

  const handleClose = useCallback(() => {
    setSearch("");
    setIndexPrompt(null);
    onClose();
  }, [onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        {/* Index prompt overlay */}
        {indexPrompt ? (
          <div className="p-5 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-sm">
                Set index for: {indexPrompt.entry.label}
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This parameter requires a numeric index (e.g. account <strong>1</strong>, linekey <strong>3</strong>).
            </p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={99}
                value={indexPrompt.value}
                onChange={(e) => setIndexPrompt({ ...indexPrompt, value: e.target.value })}
                className="w-20 h-8 text-sm"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleIndexConfirm(); }}
              />
              <span className="text-xs text-muted-foreground font-mono">
                {keyToInsertString(indexPrompt.entry, parseInt(indexPrompt.value, 10) || 1)} = ...
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <TooltipWrapper title="Back" description="Return to parameter search without inserting.">
                <Button variant="neutral" size="sm" onClick={() => setIndexPrompt(null)}>Back</Button>
              </TooltipWrapper>
              <TooltipWrapper title="Insert" description="Insert the parameter with the chosen index at cursor.">
                <Button size="sm" onClick={handleIndexConfirm}>Insert</Button>
              </TooltipWrapper>
            </div>
          </div>
        ) : (
          /* Main search + results */
          <Command shouldFilter={false} className="rounded-none">
            <div className="border-b border-border/50 px-1">
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search parameters by name, category, or description..."
                className="h-8 ui-control-shell"
              />
            </div>
            <CommandList className="max-h-[min(60vh,480px)]">
              <CommandEmpty>
                <EmptyState
                  compact
                  variant="inline"
                  icon={<Search />}
                  title="No parameters match your search"
                  description="Try a broader key, label, or category."
                  className="py-6"
                />
              </CommandEmpty>
              {Array.from(filteredGrouped).map(([category, entries]) => (
                <CommandGroup key={category} heading={category}>
                  {entries.map((entry, idx) => {
                    const keyStr = typeof entry.key === "string"
                      ? entry.key
                      : keyToInsertString(entry);
                    return (
                      <Tooltip key={`${category}-${idx}`} delayDuration={400}>
                        <TooltipTrigger asChild>
                          <CommandItem
                            value={buildSearchValue(entry)}
                            onSelect={() => handleSelect(entry)}
                            className="flex flex-col items-start gap-0.5 py-2 px-3 cursor-pointer"
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className="font-mono text-xs text-foreground font-medium truncate">{keyStr}</span>
                              <span className="text-2xs text-foreground/70 truncate ml-auto">{entry.label}</span>
                            </div>
                            <span className="text-2xs text-muted-foreground/60 line-clamp-1 leading-relaxed">
                              {entry.description}
                            </span>
                          </CommandItem>
                        </TooltipTrigger>
                        <TooltipContent side="right" align="start" className="max-w-xs p-3 space-y-2">
                          <p className="font-mono text-xs text-foreground font-medium">{keyStr}</p>
                          <p className="text-2xs text-foreground/90 leading-relaxed">{entry.description}</p>
                          {entry.options && (
                            <div className="space-y-1 pt-1 border-t border-border/50">
                              <p className="section-label-sm">Values</p>
                              <div className="flex flex-col gap-0.5">
                                {parseOptionsString(entry.options).map((opt, i) => (
                                  <span key={i} className="font-mono text-2xs text-foreground/80">{opt}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}
