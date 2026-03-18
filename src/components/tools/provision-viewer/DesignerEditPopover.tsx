/**
 * DesignerEditPopover — floating edit card for the visual Provision Designer.
 *
 * Appears when clicking an element on the phone mockup.
 * Shows editable fields for the clicked element type (line key, softkey, account, etc.).
 * Changes are written back to the editor in real-time via onFieldChange(key, value).
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { X, ChevronDown, Search } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { DSS_KEY_TYPES, type KeyValue } from "./deviceViewData";
import { EmptyState } from "@/components/ui/empty-state";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DesignerEditTarget {
  type: "linekey" | "softkey" | "account" | "programmablekey" | "wallpaper" | "time";
  index: number;
  configPrefix: string;
}

interface DesignerEditPopoverProps {
  target: DesignerEditTarget;
  anchor: { top: number; left: number };
  parsedEntries: KeyValue[];
  onFieldChange: (key: string, value: string) => void;
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getVal(entries: KeyValue[], key: string): string {
  const lk = key.toLowerCase();
  const found = entries.find((e) => e.key.toLowerCase() === lk);
  return found?.value ?? "";
}

// Common DSS key types for the dropdown
const DSS_TYPE_OPTIONS = Object.entries(DSS_KEY_TYPES)
  .filter(([id]) => Number(id) <= 150)
  .map(([id, info]) => ({ id: Number(id), label: `${id} — ${info.name}` }));

// ── Field Renderers ─────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="section-label-sm w-16 shrink-0 text-right">
        {label}
      </Label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function TextField({
  configKey,
  value,
  placeholder,
  onChange,
}: {
  configKey: string;
  value: string;
  placeholder?: string;
  onChange: (key: string, value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sync external value only if the input isn't focused (avoids fighting the user)
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setLocal(value);
    }
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChangeRef.current(configKey, v);
    }, 300);
  }, [configKey]);

  // Flush on blur so the editor always gets the final value
  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onChangeRef.current(configKey, local);
  }, [configKey, local]);

  return (
    <Input
      ref={inputRef}
      value={local}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      className="h-7 text-2xs font-mono ui-control-shell"
    />
  );
}

function TypeSelect({
  configKey,
  value,
  onChange,
}: {
  configKey: string;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <select
      value={local}
      onChange={(e) => { setLocal(e.target.value); onChange(configKey, e.target.value); }}
      className="h-7 text-2xs w-full rounded-lg px-1.5 outline-none ui-control-shell"
    >
      {DSS_TYPE_OPTIONS.map((opt) => (
        <option key={opt.id} value={String(opt.id)}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function EnableToggle({
  configKey,
  value,
  onChange,
}: {
  configKey: string;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Switch
      checked={value === "1"}
      onCheckedChange={(checked) => onChange(configKey, checked ? "1" : "0")}
    />
  );
}

// ── Presets ─────────────────────────────────────────────────────────────────

interface Preset {
  name: string;
  desc: string;
  category: string;
  fields: Record<string, string>;
}

const LINE_KEY_PRESETS: Preset[] = [
  // Registration
  { name: "Line", desc: "Register a SIP line", category: "Registration", fields: { type: "15", label: "", value: "", line: "1", extension: "" } },
  // Monitoring
  { name: "BLF", desc: "Busy Lamp Field — monitor extension status", category: "Monitoring", fields: { type: "16", label: "", value: "", line: "1", extension: "" } },
  { name: "BLF List", desc: "Server-managed BLF list", category: "Monitoring", fields: { type: "39", label: "", value: "", line: "1", extension: "" } },
  // Dialing
  { name: "Speed Dial", desc: "One-touch speed dial", category: "Dialing", fields: { type: "13", label: "", value: "", line: "1", extension: "" } },
  { name: "Intercom", desc: "Auto-answer intercom call", category: "Dialing", fields: { type: "14", label: "", value: "", line: "1", extension: "" } },
  { name: "DTMF", desc: "Send DTMF tones", category: "Dialing", fields: { type: "11", label: "", value: "", line: "0", extension: "" } },
  { name: "Paging", desc: "Multicast / group paging", category: "Dialing", fields: { type: "24", label: "Page", value: "", line: "1", extension: "" } },
  // Call Control
  { name: "Transfer", desc: "Transfer active call", category: "Call Control", fields: { type: "3", label: "Xfer", value: "", line: "1", extension: "" } },
  { name: "Hold", desc: "Hold / resume call", category: "Call Control", fields: { type: "4", label: "Hold", value: "", line: "0", extension: "" } },
  { name: "Pickup", desc: "Directed call pickup", category: "Call Control", fields: { type: "9", label: "Pickup", value: "", line: "1", extension: "" } },
  { name: "Park", desc: "Park call on slot", category: "Call Control", fields: { type: "10", label: "Park", value: "", line: "1", extension: "" } },
  { name: "DND", desc: "Do Not Disturb toggle", category: "Call Control", fields: { type: "5", label: "DND", value: "", line: "0", extension: "" } },
  // Utility
  { name: "Voice Mail", desc: "Check voicemail", category: "Utility", fields: { type: "12", label: "VM", value: "", line: "1", extension: "" } },
  { name: "XML Browser", desc: "Open XML application", category: "Utility", fields: { type: "27", label: "", value: "", line: "0", extension: "" } },
  { name: "URL Record", desc: "Server-side call recording", category: "Utility", fields: { type: "35", label: "Record", value: "", line: "0", extension: "" } },
  // Reset
  { name: "Clear", desc: "Reset key to N/A", category: "Reset", fields: { type: "0", label: "", value: "", line: "0", extension: "" } },
];

const SOFTKEY_PRESETS: Preset[] = [
  // Call Handling
  { name: "Hold", desc: "Hold / resume the active call", category: "Call Handling", fields: { enable: "1", label: "Hold", action: "", position: "", softkey_id: "hold", "use.on_talk": "1" } },
  { name: "Conference", desc: "Start a 3-way conference", category: "Call Handling", fields: { enable: "1", label: "Conf", action: "", position: "", softkey_id: "conference", "use.on_talk": "1" } },
  { name: "New Call", desc: "Dial a new call while on a call", category: "Call Handling", fields: { enable: "1", label: "New Call", action: "", position: "", softkey_id: "newcall", "use.on_talk": "1" } },
  { name: "End Call", desc: "Hang up the active call", category: "Call Handling", fields: { enable: "1", label: "End Call", action: "", position: "", softkey_id: "endcall", "use.on_talk": "1" } },
  { name: "Mute", desc: "Mute / unmute microphone", category: "Call Handling", fields: { enable: "1", label: "Mute", action: "", position: "", softkey_id: "mute", "use.on_talk": "1" } },
  // Transfer
  { name: "Blind Xfer", desc: "Unattended (blind) transfer", category: "Transfer", fields: { enable: "1", label: "Blind Xfer", action: "#3$Calltransfer$", position: "", softkey_id: "", "use.on_talk": "1" } },
  { name: "Att. Xfer", desc: "Attended (consultative) transfer", category: "Transfer", fields: { enable: "1", label: "Att Xfer", action: "", position: "", softkey_id: "transfer", "use.on_talk": "1" } },
  { name: "Xfer VM", desc: "Transfer to voicemail (EDK macro)", category: "Transfer", fields: { enable: "1", label: "Xfer VM", action: "#3$P1N4$$Tdtmf$", position: "", softkey_id: "xfer_vm", "use.on_talk": "1" } },
  // Features
  { name: "Park", desc: "Park call via star-code (EDK)", category: "Features", fields: { enable: "1", label: "Park", action: "#3*1$P1$$Tdtmf$", position: "", softkey_id: "park", "use.on_talk": "1" } },
  { name: "Pickup", desc: "Pick up ringing call", category: "Features", fields: { enable: "1", label: "Pickup", action: "", position: "", softkey_id: "pickup", "use.on_talk": "0" } },
  { name: "Record", desc: "Start / stop call recording", category: "Features", fields: { enable: "1", label: "Record", action: "", position: "", softkey_id: "record", "use.on_talk": "1" } },
  { name: "DND", desc: "Do Not Disturb toggle", category: "Features", fields: { enable: "1", label: "DND", action: "", position: "", softkey_id: "dnd", "use.on_talk": "0" } },
  { name: "Forward", desc: "Call forwarding settings", category: "Features", fields: { enable: "1", label: "Forward", action: "", position: "", softkey_id: "forward", "use.on_talk": "0" } },
  // Navigation
  { name: "Redial", desc: "Redial last dialled number", category: "Navigation", fields: { enable: "1", label: "Redial", action: "", position: "", softkey_id: "redial", "use.on_talk": "0" } },
  { name: "History", desc: "Open call history / logs", category: "Navigation", fields: { enable: "1", label: "History", action: "", position: "", softkey_id: "history", "use.on_talk": "0" } },
  { name: "Directory", desc: "Open the phone directory", category: "Navigation", fields: { enable: "1", label: "Dir", action: "", position: "", softkey_id: "directory", "use.on_talk": "0" } },
  // Reset
  { name: "Clear", desc: "Disable and reset softkey", category: "Reset", fields: { enable: "0", label: "", action: "", position: "", softkey_id: "" } },
];

const PROG_KEY_PRESETS: Preset[] = [
  { name: "Forward", desc: "Call forwarding settings", category: "Features", fields: { type: "2", label: "Fwd", value: "", line: "0" } },
  { name: "DND", desc: "Do Not Disturb toggle", category: "Features", fields: { type: "5", label: "DND", value: "", line: "0" } },
  { name: "Paging", desc: "Multicast / group paging", category: "Features", fields: { type: "24", label: "Page", value: "", line: "0" } },
  { name: "History", desc: "Call history / logs", category: "Navigation", fields: { type: "28", label: "History", value: "", line: "0" } },
  { name: "Menu", desc: "Open phone menu", category: "Navigation", fields: { type: "30", label: "Menu", value: "", line: "0" } },
  { name: "Directory", desc: "Local phone directory", category: "Navigation", fields: { type: "61", label: "Dir", value: "", line: "0" } },
  { name: "LDAP", desc: "LDAP directory lookup", category: "Navigation", fields: { type: "38", label: "LDAP", value: "", line: "0" } },
  { name: "Clear", desc: "Reset key to N/A", category: "Reset", fields: { type: "0", label: "", value: "", line: "0" } },
];

/** Group presets by category, preserving insertion order. */
function groupByCategory(presets: Preset[]): { category: string; items: Preset[] }[] {
  const map = new Map<string, Preset[]>();
  for (const p of presets) {
    const list = map.get(p.category);
    if (list) list.push(p);
    else map.set(p.category, [p]);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

function PresetPicker({
  presets,
  prefix,
  idx,
  onFieldChange,
}: {
  presets: Preset[];
  prefix: string;
  idx: number;
  onFieldChange: (key: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => groupByCategory(presets), [presets]);

  const applyPreset = useCallback((preset: Preset) => {
    for (const [suffix, val] of Object.entries(preset.fields)) {
      onFieldChange(`${prefix}.${idx}.${suffix}`, val);
    }
    setOpen(false);
  }, [prefix, idx, onFieldChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="neutral"
          size="sm"
          className="h-7 text-2xs gap-1 w-full justify-between font-medium"
        >
          Apply preset...
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start" sideOffset={4}>
        <Command>
          <CommandInput placeholder="Search presets..." className="h-8 text-xs ui-control-shell" />
          <CommandList className="max-h-52">
            <CommandEmpty>
              <EmptyState
                compact
                variant="inline"
                icon={<Search />}
                title="No presets found"
                description="Try a broader preset search term."
                className="py-4"
              />
            </CommandEmpty>
            {grouped.map((group) => (
              <CommandGroup key={group.category} heading={group.category}>
                {group.items.map((preset) => (
                  <CommandItem
                    key={preset.name}
                    onSelect={() => applyPreset(preset)}
                    className={cn(
                      "flex flex-col items-start gap-0 py-1.5 cursor-pointer",
                      preset.name === "Clear" && "text-destructive"
                    )}
                  >
                    <span className="text-xs font-medium">{preset.name}</span>
                    <span className="text-2xs text-muted-foreground leading-tight">{preset.desc}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export function DesignerEditPopover({
  target,
  anchor,
  parsedEntries,
  onFieldChange,
  onClose,
}: DesignerEditPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid the same click that opened it
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const prefix = target.configPrefix;
  const idx = target.index;

  // Title for the popover
  const title = useMemo(() => {
    switch (target.type) {
      case "linekey": return `Line Key ${idx}`;
      case "softkey": return `Softkey ${idx}`;
      case "account": return `Account ${idx}`;
      case "programmablekey": return `Programmable Key ${idx}`;
      case "wallpaper": return "Wallpaper";
      case "time": return "Time / Date Format";
      default: return "Edit";
    }
  }, [target.type, idx]);

  return (
    <div
      ref={popoverRef}
      className={cn(
        "absolute z-50 ui-floating-surface border border-border/55 rounded-md p-3 space-y-2.5",
        "w-64 animate-in fade-in-0 zoom-in-95"
      )}
      style={{
        top: anchor.top,
        left: Math.max(8, anchor.left - 128),
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-1 border-b border-border/50">
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Line Key fields */}
      {target.type === "linekey" && (
        <>
          <PresetPicker presets={LINE_KEY_PRESETS} prefix="linekey" idx={idx} onFieldChange={onFieldChange} />
          <FieldRow label="Type">
            <TypeSelect
              configKey={`linekey.${idx}.type`}
              value={getVal(parsedEntries, `linekey.${idx}.type`) || "0"}
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Label">
            <TextField
              configKey={`linekey.${idx}.label`}
              value={getVal(parsedEntries, `linekey.${idx}.label`)}
              placeholder="Button label"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Value">
            <TextField
              configKey={`linekey.${idx}.value`}
              value={getVal(parsedEntries, `linekey.${idx}.value`)}
              placeholder="e.g. extension or number"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Line">
            <TextField
              configKey={`linekey.${idx}.line`}
              value={getVal(parsedEntries, `linekey.${idx}.line`) || "1"}
              placeholder="Account line (1-16)"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Ext.">
            <TextField
              configKey={`linekey.${idx}.extension`}
              value={getVal(parsedEntries, `linekey.${idx}.extension`)}
              placeholder="Extension"
              onChange={onFieldChange}
            />
          </FieldRow>
        </>
      )}

      {/* Softkey fields */}
      {target.type === "softkey" && (
        <>
          <PresetPicker presets={SOFTKEY_PRESETS} prefix="softkey" idx={idx} onFieldChange={onFieldChange} />
          <FieldRow label="Enable">
            <EnableToggle
              configKey={`softkey.${idx}.enable`}
              value={getVal(parsedEntries, `softkey.${idx}.enable`) || "0"}
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Label">
            <TextField
              configKey={`softkey.${idx}.label`}
              value={getVal(parsedEntries, `softkey.${idx}.label`)}
              placeholder="Softkey label"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Action">
            <TextField
              configKey={`softkey.${idx}.action`}
              value={getVal(parsedEntries, `softkey.${idx}.action`)}
              placeholder="EDK action string"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Position">
            <TextField
              configKey={`softkey.${idx}.position`}
              value={getVal(parsedEntries, `softkey.${idx}.position`)}
              placeholder="Position number"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="ID">
            <TextField
              configKey={`softkey.${idx}.softkey_id`}
              value={getVal(parsedEntries, `softkey.${idx}.softkey_id`)}
              placeholder="e.g. xfer_vm, park"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="On Talk">
            <EnableToggle
              configKey={`softkey.${idx}.use.on_talk`}
              value={getVal(parsedEntries, `softkey.${idx}.use.on_talk`) || "0"}
              onChange={onFieldChange}
            />
          </FieldRow>
        </>
      )}

      {/* Account fields */}
      {target.type === "account" && (
        <>
          <FieldRow label="Enable">
            <EnableToggle
              configKey={`account.${idx}.enable`}
              value={getVal(parsedEntries, `account.${idx}.enable`) || "0"}
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Name">
            <TextField
              configKey={`account.${idx}.display_name`}
              value={getVal(parsedEntries, `account.${idx}.display_name`)}
              placeholder="Display name"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="User">
            <TextField
              configKey={`account.${idx}.user_name`}
              value={getVal(parsedEntries, `account.${idx}.user_name`)}
              placeholder="SIP user name"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Auth">
            <TextField
              configKey={`account.${idx}.auth_name`}
              value={getVal(parsedEntries, `account.${idx}.auth_name`)}
              placeholder="Auth name"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Server">
            <TextField
              configKey={`account.${idx}.sip_server.1.address`}
              value={getVal(parsedEntries, `account.${idx}.sip_server.1.address`)}
              placeholder="SIP server address"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Label">
            <TextField
              configKey={`account.${idx}.label`}
              value={getVal(parsedEntries, `account.${idx}.label`)}
              placeholder="Account label"
              onChange={onFieldChange}
            />
          </FieldRow>
        </>
      )}

      {/* Programmable Key fields */}
      {target.type === "programmablekey" && (
        <>
          <PresetPicker presets={PROG_KEY_PRESETS} prefix="programablekey" idx={idx} onFieldChange={onFieldChange} />
          <FieldRow label="Type">
            <TypeSelect
              configKey={`programablekey.${idx}.type`}
              value={getVal(parsedEntries, `programablekey.${idx}.type`) || "0"}
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Label">
            <TextField
              configKey={`programablekey.${idx}.label`}
              value={getVal(parsedEntries, `programablekey.${idx}.label`)}
              placeholder="Key label"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Value">
            <TextField
              configKey={`programablekey.${idx}.value`}
              value={getVal(parsedEntries, `programablekey.${idx}.value`)}
              placeholder="Value"
              onChange={onFieldChange}
            />
          </FieldRow>
          <FieldRow label="Line">
            <TextField
              configKey={`programablekey.${idx}.line`}
              value={getVal(parsedEntries, `programablekey.${idx}.line`) || "0"}
              placeholder="Account line"
              onChange={onFieldChange}
            />
          </FieldRow>
        </>
      )}

      {/* Wallpaper */}
      {target.type === "wallpaper" && (
        <FieldRow label="URL">
          <TextField
            configKey="wallpaper_upload.url"
            value={getVal(parsedEntries, "wallpaper_upload.url")}
            placeholder="https://example.com/wallpaper.jpg"
            onChange={onFieldChange}
          />
        </FieldRow>
      )}

      {/* Time / Date */}
      {target.type === "time" && (
        <>
          <FieldRow label="Time">
            <select
              value={getVal(parsedEntries, "local_time.time_format") || "1"}
              onChange={(e) => onFieldChange("local_time.time_format", e.target.value)}
              className="h-7 text-2xs w-full rounded-lg px-1.5 outline-none ui-control-shell"
            >
              <option value="0">12 Hour</option>
              <option value="1">24 Hour</option>
            </select>
          </FieldRow>
          <FieldRow label="Date">
            <select
              value={getVal(parsedEntries, "phone_setting.date_format") || "0"}
              onChange={(e) => onFieldChange("phone_setting.date_format", e.target.value)}
              className="h-7 text-2xs w-full rounded-lg px-1.5 outline-none ui-control-shell"
            >
              <option value="0">WWW MMM DD</option>
              <option value="1">DD-MMM-YY</option>
              <option value="2">YYYY-MM-DD</option>
              <option value="3">DD/MM/YYYY</option>
              <option value="4">MM/DD/YY</option>
              <option value="5">DD MMM YYYY</option>
              <option value="6">WWW DD MMM</option>
            </select>
          </FieldRow>
        </>
      )}

      {/* Config prefix hint */}
      <div className="pt-1 border-t border-border/30">
        <span className="font-mono text-3xs text-muted-foreground/60">{prefix}.*</span>
      </div>
    </div>
  );
}
