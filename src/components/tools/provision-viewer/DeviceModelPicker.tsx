import React, { useEffect, useRef, useState } from "react";
import { Phone, ChevronDown } from "@/lib/icons";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { YEALINK_PICKER_META, YEALINK_PICKER_SERIES } from "./deviceLayouts";

// ============================================================================
// DEVICE MODEL DATABASE
// ============================================================================

export interface ModelInfo {
  screen: string;
  keys: string;
  tier: string;
  search: string;
}

export interface ModelSeries {
  key: string;
  label: string;
  ids: string[];
}

export interface DeviceBrand {
  key: string;
  name: string;
  series: ModelSeries[];
  models: Record<string, ModelInfo>;
}

export const DEVICE_BRANDS: DeviceBrand[] = [
  {
    key: "yealink",
    name: "Yealink",
    series: YEALINK_PICKER_SERIES,
    models: YEALINK_PICKER_META,
  },
  {
    key: "poly",
    name: "Poly",
    series: [
      { key: "vvx-x50", label: "VVX x50 Series — Current", ids: ["VVX150", "VVX250", "VVX350", "VVX450"] },
      { key: "vvx-x01", label: "VVX x01 Series", ids: ["VVX101", "VVX201", "VVX301", "VVX311", "VVX401", "VVX411", "VVX501", "VVX601"] },
      { key: "vvx-x00", label: "VVX x00 Series — Legacy", ids: ["VVX300", "VVX310", "VVX400", "VVX410", "VVX500", "VVX600", "VVX1500"] },
      { key: "spip", label: "SoundPoint IP — Legacy", ids: ["SPIP335", "SPIP450", "SPIP550", "SPIP560", "SPIP650", "SPIP670"] },
    ],
    models: {
      VVX150: { screen: "2.5\" 320×240 color", keys: "2 line keys", tier: "Entry", search: "entry basic color" },
      VVX250: { screen: "2.8\" 320×240 color", keys: "4 line keys", tier: "Entry", search: "entry color" },
      VVX350: { screen: "3.5\" 480×320 color", keys: "6 line keys", tier: "Mid-range", search: "midrange color" },
      VVX450: { screen: "4.3\" 480×272 color", keys: "12 line keys", tier: "Business", search: "business color sidecar" },
      VVX101: { screen: "2.5\" 132×64 grayscale", keys: "2 line keys", tier: "Entry", search: "entry grayscale basic" },
      VVX201: { screen: "2.5\" 132×64 grayscale", keys: "2 line keys", tier: "Entry", search: "entry grayscale poe" },
      VVX301: { screen: "3.2\" 208×104 grayscale", keys: "6 line keys", tier: "Mid-range", search: "midrange grayscale" },
      VVX311: { screen: "3.2\" 208×104 grayscale", keys: "6 line keys", tier: "Mid-range", search: "midrange grayscale gigabit" },
      VVX401: { screen: "3.5\" 320×240 color", keys: "12 line keys", tier: "Business", search: "business color" },
      VVX411: { screen: "3.5\" 320×240 color", keys: "12 line keys", tier: "Business", search: "business color gigabit" },
      VVX501: { screen: "3.5\" 320×240 color touch", keys: "12 touch line keys", tier: "Executive", search: "executive touchscreen color" },
      VVX601: { screen: "4.3\" 480×272 color touch", keys: "16 touch line keys", tier: "Executive", search: "executive touchscreen color large" },
      VVX300: { screen: "3.2\" 208×104 grayscale", keys: "6 line keys", tier: "Mid-range", search: "midrange grayscale legacy" },
      VVX310: { screen: "3.2\" 208×104 grayscale", keys: "6 line keys", tier: "Mid-range", search: "midrange grayscale gigabit legacy" },
      VVX400: { screen: "3.5\" 320×240 color", keys: "12 line keys", tier: "Business", search: "business color legacy" },
      VVX410: { screen: "3.5\" 320×240 color", keys: "12 line keys", tier: "Business", search: "business color gigabit legacy" },
      VVX500: { screen: "3.5\" 320×240 color touch", keys: "12 touch line keys", tier: "Executive", search: "executive touchscreen legacy" },
      VVX600: { screen: "4.3\" 480×272 color touch", keys: "16 touch line keys", tier: "Executive", search: "executive touchscreen large legacy" },
      VVX1500: { screen: "7\" 800×480 color touch", keys: "Touch line keys", tier: "Video", search: "video phone camera touchscreen legacy" },
      SPIP335: { screen: "2.2\" 132×64 grayscale", keys: "2 line keys", tier: "Entry", search: "legacy entry grayscale soundpoint" },
      SPIP450: { screen: "2.2\" 132×64 grayscale", keys: "2 line keys", tier: "Entry", search: "legacy entry grayscale soundpoint" },
      SPIP550: { screen: "3.2\" 320×160 grayscale", keys: "4 line keys", tier: "Mid-range", search: "legacy midrange grayscale soundpoint" },
      SPIP560: { screen: "3.5\" 320×240 color", keys: "4 line keys", tier: "Mid-range", search: "legacy midrange color soundpoint" },
      SPIP650: { screen: "3.5\" 320×240 color", keys: "6 line keys", tier: "Business", search: "legacy business color soundpoint" },
      SPIP670: { screen: "4.3\" 480×272 color", keys: "6 line keys", tier: "Business", search: "legacy business color soundpoint gigabit" },
    },
  },
];

// Flattened lookups
export const ALL_MODEL_IDS = DEVICE_BRANDS.flatMap((b) => b.series.flatMap((s) => s.ids));

export const MODEL_META: Record<string, ModelInfo> = {};
export const MODEL_BRAND: Record<string, string> = {};
export const MODEL_VENDOR: Record<string, string> = {};
for (const brand of DEVICE_BRANDS) {
  for (const [id, meta] of Object.entries(brand.models)) {
    MODEL_META[id] = meta;
    MODEL_BRAND[id] = brand.name;
    MODEL_VENDOR[id] = brand.key;
  }
}

const TIER_COLORS: Record<string, string> = {
  Premium: "bg-warning/15 text-warning dark:text-warning",
  Business: "bg-info/15 text-info dark:text-info",
  Executive: "bg-info/15 text-info dark:text-info",
  Entry: "bg-success/15 text-success dark:text-success",
  Standard: "bg-muted text-muted-foreground/70 dark:text-muted-foreground",
  Basic: "bg-muted text-muted-foreground/70 dark:text-muted-foreground",
  "Mid-range": "bg-primary/15 text-primary dark:text-primary",
  Conference: "bg-success/15 text-success dark:text-success",
  Video: "bg-destructive/15 text-destructive dark:text-destructive",
};

function buildSearchValue(id: string, brand: DeviceBrand, seriesLabel: string, meta: ModelInfo | undefined): string {
  const parts = [brand.name, id, seriesLabel, meta?.tier ?? "", meta?.screen ?? "", meta?.keys ?? "", meta?.search ?? ""];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function modelSearchFilter(value: string, search: string): number {
  const v = value.toLowerCase();
  const s = search.toLowerCase().trim();
  if (!s) return 1;

  const words = s.split(/\s+/).filter(Boolean);
  const allMatch = words.every((w) => v.includes(w));
  if (!allMatch) return 0;

  const tokens = v.split(/\s+/);
  const modelId = tokens[1] ?? "";
  if (modelId === s) return 2;
  if (words.some((w) => modelId === w)) return 1.5;
  return 1;
}

// ============================================================================
// COMPONENT
// ============================================================================

interface DeviceModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  /** Filter to a single vendor (shows only that vendor's models). */
  vendor?: "yealink" | "poly";
  /** Smaller trigger for inline edit forms (h-8 instead of default). */
  compact?: boolean;
  id?: string;
}

export function DeviceModelPicker({ value, onChange, vendor, compact, id: inputId }: DeviceModelPickerProps) {
  const [open, setOpen] = useState(false);
  const popoverContentRef = useRef<HTMLDivElement | null>(null);

  const brands = vendor ? DEVICE_BRANDS.filter((b) => b.key === vendor) : DEVICE_BRANDS;

  const brandName = MODEL_BRAND[value] ?? "";
  const displayValue = ALL_MODEL_IDS.includes(value)
    ? `${brandName ? brandName + " " : ""}${value}`
    : value || "Select model";

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.requestAnimationFrame(() => {
      const input = popoverContentRef.current?.querySelector<HTMLInputElement>('input[data-slot="command-input"]');
      input?.focus();
      input?.select();
    });
    return () => window.cancelAnimationFrame(focusTimer);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={inputId}
          className={cn(
            "ui-control-shell flex w-full items-center justify-between px-3 text-sm",
            "disabled:cursor-not-allowed disabled:opacity-50",
            compact ? "h-8 py-1" : "h-8 py-1.5",
            open && "ring-2 ring-ring/80 ring-offset-0 border-foreground/35"
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className={cn("truncate font-mono font-semibold", compact ? "text-xs" : "text-sm")}>{displayValue}</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={popoverContentRef}
        align="start"
        side="bottom"
        sideOffset={6}
        onEscapeKeyDown={() => setOpen(false)}
        className={cn(
          "ui-panel-shell ui-floating-content z-[10050] min-w-[var(--radix-popover-trigger-width)] w-[min(42rem,calc(100vw-1rem))] max-h-[min(30rem,calc(100vh-4rem))] overflow-hidden p-0",
          compact && "w-[min(38rem,calc(100vw-1rem))]"
        )}
      >
        <Command className="bg-transparent" shouldFilter={true} filter={modelSearchFilter}>
          <CommandInput
            autoFocus
            placeholder="Search by model, brand, screen type, tier..."
            className="h-9 rounded-none border-0 border-b border-border/40 bg-transparent px-3"
          />
          <CommandList className="max-h-[min(28rem,calc(100vh-12rem))]">
            <CommandEmpty>
              <EmptyState
                compact
                variant="inline"
                title="No matching models"
                description='Try searching by name, series, or feature (e.g. "touch", "wifi", "color").'
                className="py-4"
              />
            </CommandEmpty>
            {brands.map((brand) => (
              <React.Fragment key={brand.key}>
                {brands.length > 1 && (
                  <div className="flex items-center gap-2 px-3 pb-1 pt-3">
                    <span className="text-xs font-bold uppercase tracking-wide text-foreground">{brand.name}</span>
                    <span className="flex-1 border-b border-border/40" />
                  </div>
                )}
                {brand.series.map((series) => (
                  <CommandGroup key={`${brand.key}-${series.key}`} heading={series.label}>
                    {series.ids.map((id) => {
                      const meta = brand.models[id];
                      const isSelected = value === id;
                      const searchValue = buildSearchValue(id, brand, series.label, meta);
                      return (
                        <CommandItem
                          key={id}
                          value={searchValue}
                          onSelect={() => {
                            onChange(id);
                            setOpen(false);
                          }}
                          className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2", isSelected && "bg-accent/40")}
                        >
                          <div
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-smooth",
                              isSelected ? "border-foreground/30 bg-accent/55" : "border-muted-foreground/40"
                            )}
                          >
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-semibold">{id}</span>
                              {meta?.tier && (
                                <span className={cn("text-2xs rounded-full px-1.5 py-0.5 font-medium leading-none", TIER_COLORS[meta.tier] ?? "bg-muted text-muted-foreground")}>
                                  {meta.tier}
                                </span>
                              )}
                            </div>
                            {meta && (
                              <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                                <span>{meta.screen}</span>
                                <span className="text-border">·</span>
                                <span>{meta.keys}</span>
                              </div>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </React.Fragment>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
