import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AutocompleteInput } from "./AutocompleteInput";
import type { Suggestion } from "./crafterSuggestions";

export interface KeyValuePair {
  key: string;
  value: string;
}

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = "Header",
  valuePlaceholder = "Value",
  className,
  keySuggestions,
  valueSuggestionsMap,
}: {
  items: KeyValuePair[];
  onChange: (items: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  className?: string;
  /** Autocomplete suggestions for key field (e.g. header names) */
  keySuggestions?: Suggestion[];
  /** Map from lowercase key → autocomplete suggestions for the value field */
  valueSuggestionsMap?: (key: string) => Suggestion[];
}) {
  const update = useCallback(
    (idx: number, field: "key" | "value", val: string) => {
      const next = items.map((item, i) =>
        i === idx ? { ...item, [field]: val } : item
      );
      onChange(next);
    },
    [items, onChange]
  );

  const add = useCallback(() => {
    onChange([...items, { key: "", value: "" }]);
  }, [items, onChange]);

  const remove = useCallback(
    (idx: number) => {
      onChange(items.filter((_, i) => i !== idx));
    },
    [items, onChange]
  );

  return (
    <div className={cn("space-y-2", className)}>
      {items.map((item, idx) => (
        <KeyValueRow
          key={idx}
          item={item}
          idx={idx}
          keyPlaceholder={keyPlaceholder}
          valuePlaceholder={valuePlaceholder}
          keySuggestions={keySuggestions}
          valueSuggestionsMap={valueSuggestionsMap}
          onUpdate={update}
          onRemove={remove}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={add}
        className="gap-1.5 h-8 text-xs"
      >
        <Plus className="size-3.5" />
        Add
      </Button>
    </div>
  );
}

/** Individual row — extracted to avoid re-rendering all rows on every keystroke */
function KeyValueRow({
  item,
  idx,
  keyPlaceholder,
  valuePlaceholder,
  keySuggestions,
  valueSuggestionsMap,
  onUpdate,
  onRemove,
}: {
  item: KeyValuePair;
  idx: number;
  keyPlaceholder: string;
  valuePlaceholder: string;
  keySuggestions?: Suggestion[];
  valueSuggestionsMap?: (key: string) => Suggestion[];
  onUpdate: (idx: number, field: "key" | "value", val: string) => void;
  onRemove: (idx: number) => void;
}) {
  const valueSuggestions = useMemo(
    () => (valueSuggestionsMap ? valueSuggestionsMap(item.key) : []),
    [valueSuggestionsMap, item.key]
  );

  const hasKeySuggestions = keySuggestions && keySuggestions.length > 0;
  const hasValueSuggestions = valueSuggestions.length > 0;

  return (
    <div className="flex gap-2 items-center">
      {hasKeySuggestions ? (
        <div className="flex-1 min-w-0">
          <AutocompleteInput
            value={item.key}
            onChange={(v) => onUpdate(idx, "key", v)}
            suggestions={keySuggestions}
            placeholder={keyPlaceholder}
            className="font-mono text-sm"
          />
        </div>
      ) : (
        <Input
          placeholder={keyPlaceholder}
          value={item.key}
          onChange={(e) => onUpdate(idx, "key", e.target.value)}
          className="font-mono text-sm flex-1 min-w-0"
        />
      )}
      {hasValueSuggestions ? (
        <div className="flex-[2] min-w-0">
          <AutocompleteInput
            value={item.value}
            onChange={(v) => onUpdate(idx, "value", v)}
            suggestions={valueSuggestions}
            placeholder={valuePlaceholder}
            className="font-mono text-sm"
          />
        </div>
      ) : (
        <Input
          placeholder={valuePlaceholder}
          value={item.value}
          onChange={(e) => onUpdate(idx, "value", e.target.value)}
          className="font-mono text-sm flex-[2] min-w-0"
        />
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onRemove(idx)}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
