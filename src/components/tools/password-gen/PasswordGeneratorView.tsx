import { useCallback, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Copy, Info, RefreshCw, Shield, Trash2, X } from "@/lib/icons";
import { cn } from "@/lib/utils";

type PresetId = "balanced" | "max-secure" | "sip-auth";

interface Preset {
  id: PresetId;
  label: string;
  hint: string;
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  customChars: string;
  excludeAmbiguous: boolean;
}

interface HistoryEntry {
  id: string;
  time: string;
  preset: string;
  password: string;
}

interface StrengthInfo {
  label: string;
  tone: string;
  barTone: string;
  pct: number;
  crackTime: string;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?/~`";
const AMBIGUOUS = "0O1lI";

const SIP_SAFE_SYMBOLS = "!#$%^*()-_+=[]{}|;,.?";

const PRESETS: Preset[] = [
  {
    id: "balanced",
    label: "Normal",
    hint: "Recommended for most accounts",
    length: 20,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    customChars: "",
    excludeAmbiguous: true,
  },
  {
    id: "max-secure",
    label: "High Security",
    hint: "Maximum entropy configuration",
    length: 32,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    customChars: "",
    excludeAmbiguous: false,
  },
  {
    id: "sip-auth",
    label: "SIP Credential",
    hint: "SIP-safe symbols",
    length: 16,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    customChars: SIP_SAFE_SYMBOLS,
    excludeAmbiguous: false,
  },
];

function dedupe(input: string): string {
  return [...new Set(input.split(""))].join("");
}

function removeChars(input: string, excludes: string): string {
  if (!excludes) return input;
  const blocked = new Set(excludes.split(""));
  return input
    .split("")
    .filter((c) => !blocked.has(c))
    .join("");
}

function secureRandomInt(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  const maxUint32 = 0x100000000;
  const bucket = maxUint32 - (maxUint32 % max);
  const arr = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(arr);
    const value = arr[0] ?? 0;
    if (value < bucket) return value % max;
  }
}

function pickChar(chars: string): string {
  return chars.charAt(secureRandomInt(chars.length));
}

function shuffle(list: string[]): string[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    const atI = out[i]!;
    const atJ = out[j]!;
    out[i] = atJ;
    out[j] = atI;
  }
  return out;
}

function hasAdjacentDuplicates(chars: string[]): boolean {
  for (let i = 1; i < chars.length; i += 1) {
    if (chars[i] === chars[i - 1]) return true;
  }
  return false;
}

function getStrength(entropy: number): StrengthInfo {
  const seconds = Math.pow(2, entropy) / 1e10;
  let crackTime = "heat death of universe";
  if (seconds < 60) crackTime = "< 1 minute";
  else if (seconds < 3600) crackTime = `${Math.round(seconds / 60)} min`;
  else if (seconds < 86400) crackTime = `${Math.round(seconds / 3600)} hrs`;
  else if (seconds < 31536000) crackTime = `${Math.round(seconds / 86400)} days`;
  else if (seconds < 31536000 * 100) crackTime = `${Math.round(seconds / 31536000)} yrs`;
  else if (seconds < 31536000 * 1e6) crackTime = `${(seconds / (31536000 * 100)).toFixed(0)} centuries`;

  const pct = Math.min((entropy / 128) * 100, 100);
  if (entropy < 30) return { label: "Very Weak", tone: "text-destructive", barTone: "bg-destructive", pct, crackTime };
  if (entropy < 45) return { label: "Weak", tone: "text-warning", barTone: "bg-warning", pct, crackTime };
  if (entropy < 70) return { label: "Good", tone: "text-warning", barTone: "bg-warning", pct, crackTime };
  if (entropy < 110) return { label: "Strong", tone: "text-success", barTone: "bg-success", pct, crackTime };
  return { label: "Excellent", tone: "text-info", barTone: "bg-info", pct: 100, crackTime };
}

export function PasswordGeneratorView() {
  const [activePreset, setActivePreset] = useState<PresetId | "custom">("balanced");
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [customChars, setCustomChars] = useState("");
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true);
  const [excludeChars, setExcludeChars] = useState("");
  const [noAdjacentRepeat, setNoAdjacentRepeat] = useState(false);
  const [noReuseChars, setNoReuseChars] = useState(false);

  const [password, setPassword] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);

  const pools = useMemo(() => {
    const p: string[] = [];
    if (uppercase) p.push(removeChars(UPPER, excludeChars));
    if (lowercase) p.push(removeChars(LOWER, excludeChars));
    if (digits) p.push(removeChars(DIGITS, excludeChars));
    if (symbols) {
      let symbolPool = customChars || SYMBOLS;
      if (excludeAmbiguous) symbolPool = removeChars(symbolPool, AMBIGUOUS);
      p.push(removeChars(symbolPool, excludeChars));
    }
    return p.filter(Boolean).map(dedupe);
  }, [uppercase, lowercase, digits, symbols, customChars, excludeAmbiguous, excludeChars]);

  const charset = useMemo(() => {
    let cs = "";
    if (uppercase) cs += UPPER;
    if (lowercase) cs += LOWER;
    if (digits) cs += DIGITS;
    if (symbols) cs += customChars || SYMBOLS;
    if (excludeAmbiguous) cs = removeChars(cs, AMBIGUOUS);
    cs = removeChars(cs, excludeChars);
    return dedupe(cs);
  }, [uppercase, lowercase, digits, symbols, customChars, excludeAmbiguous, excludeChars]);

  const entropy = useMemo(() => (charset.length <= 1 ? 0 : length * Math.log2(charset.length)), [charset.length, length]);
  const strength = useMemo(() => getStrength(entropy), [entropy]);

  const addToHistory = useCallback((pw: string, presetLabel: string) => {
    setHistory((prev) => [
      {
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        preset: presetLabel,
        password: pw,
      },
      ...prev,
    ].slice(0, 60));
  }, []);

  const applyPreset = useCallback((id: PresetId) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setActivePreset(id);
    setLength(p.length);
    setUppercase(p.uppercase);
    setLowercase(p.lowercase);
    setDigits(p.digits);
    setSymbols(p.symbols);
    setCustomChars(p.customChars);
    setExcludeAmbiguous(p.excludeAmbiguous);
    setExcludeChars("");
    setNoAdjacentRepeat(false);
    setNoReuseChars(false);
  }, []);

  const generate = useCallback(() => {
    const required = pools.length;
    if (!charset.length) {
      setErrorText("No valid characters left. Enable more sets or reduce exclusions.");
      return;
    }
    if (required > length) {
      setErrorText(`Length ${length} is too short for ${required} required sets.`);
      return;
    }
    if (noReuseChars && length > charset.length) {
      setErrorText(`Cannot create ${length} unique characters from charset size ${charset.length}.`);
      return;
    }
    setErrorText(null);

    for (let attempt = 0; attempt < 56; attempt += 1) {
      const chars: string[] = [];
      const used = new Set<string>();

      for (const pool of pools) {
        const c = pickChar(pool);
        chars.push(c);
        if (noReuseChars) used.add(c);
      }

      while (chars.length < length) {
        const c = pickChar(charset);
        if (noReuseChars && used.has(c)) continue;
        if (noAdjacentRepeat && chars.length > 0 && chars[chars.length - 1] === c) continue;
        chars.push(c);
        if (noReuseChars) used.add(c);
      }

      const out = shuffle(chars);
      if (noAdjacentRepeat && hasAdjacentDuplicates(out)) continue;
      if (!pools.every((pool) => out.some((c) => pool.includes(c)))) continue;

      const pw = out.join("");
      setPassword(pw);
      const presetLabel = activePreset === "custom" ? "Custom" : PRESETS.find((p) => p.id === activePreset)?.label ?? "Custom";
      addToHistory(pw, presetLabel);
      return;
    }

    setErrorText("Could not satisfy all constraints. Relax one rule and try again.");
  }, [pools, charset, length, noReuseChars, noAdjacentRepeat, activePreset, addToHistory]);

  const strengthSegments = Math.max(1, Math.ceil(strength.pct / 20));

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-6 min-h-full">
      <div className="ui-surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md border border-primary/35 bg-primary/10 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Password Generator</p>
              <p className="text-2xs text-muted-foreground">Create strong passwords quickly with clear controls.</p>
            </div>
          </div>
          <Button onClick={generate} className="h-8 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Generate
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-4 min-w-0">
          <div className="rounded-xl border border-border/30 bg-background/25 p-4 space-y-3 min-w-0">
            <div className="flex items-center justify-between">
              <span className="section-label-sm">Generated Password</span>
              <div className="flex items-center gap-1.5">
                {password ? <CopyTextButton text={password} size="sm" className="h-7 text-2xs px-2 gap-1" /> : null}
                <Button variant="neutral" size="sm" className="h-7 w-7 p-0" onClick={() => setPassword("")} disabled={!password}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <Input
              ref={passwordRef}
              value={password}
              readOnly
              placeholder="Click Generate to create a password"
              className="ui-control-shell h-12 font-mono text-base tracking-wide"
              onClick={() => passwordRef.current?.select()}
            />

            <div className="flex items-center gap-2">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className={cn("h-1.5 rounded-full flex-1", idx < strengthSegments ? strength.barTone : "bg-muted/20")} />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={cn("h-5 text-2xs border-current/20", strength.tone)}>
                {strength.label}
              </Badge>
              <span className="text-2xs text-muted-foreground">{entropy.toFixed(0)} bits entropy</span>
              <span className="text-2xs text-muted-foreground/40">•</span>
              <span className="text-2xs text-muted-foreground">Est. crack: {strength.crackTime}</span>
            </div>

            {errorText ? (
              <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorText}</div>
            ) : null}
          </div>

          <div className="rounded-xl border border-border/30 bg-background/15 p-4 space-y-3 min-w-0">
            <div className="flex items-center justify-between">
              <span className="section-label-sm">Quick Presets</span>
              <Badge variant="secondary" className="h-5 text-2xs">3 options</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 min-w-0">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={cn(
                    "text-left rounded-md border px-3 py-2.5 transition-smooth min-h-[72px] flex flex-col justify-center",
                    activePreset === preset.id
                      ? "border-primary/45 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.18)]"
                      : "border-border/30 bg-background/25 hover:border-border/55 hover:bg-background/35",
                  )}
                  onClick={() => applyPreset(preset.id)}
                >
                  <p className="text-xs font-medium text-foreground">{preset.label}</p>
                  <p className="text-2xs text-muted-foreground/75 mt-1 leading-snug">{preset.hint}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ui-surface-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="section-label-sm">Rules</span>
          <Badge variant="secondary" className="h-5 text-2xs">Charset {charset.length}</Badge>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-14 shrink-0">Length</span>
          <input
            type="range"
            min={4}
            max={128}
            value={length}
            onChange={(e) => {
              setLength(parseInt(e.target.value, 10));
              setActivePreset("custom");
            }}
            className="flex-1 h-1.5 accent-primary cursor-pointer"
          />
          <Input
            value={length}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 4 && v <= 256) {
                setLength(v);
                setActivePreset("custom");
              }
            }}
            className="ui-control-shell h-8 w-16 text-xs text-center font-mono"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3 min-w-0">
          <label className="rounded-lg border border-border/25 bg-muted/10 px-3 py-2 flex items-center justify-between gap-3 cursor-pointer min-w-0">
            <span className="text-xs text-muted-foreground/85 truncate">Uppercase (A-Z)</span>
            <Switch size="sm" checked={uppercase} onCheckedChange={(v) => { setUppercase(v); setActivePreset("custom"); }} />
          </label>
          <label className="rounded-lg border border-border/25 bg-muted/10 px-3 py-2 flex items-center justify-between gap-3 cursor-pointer min-w-0">
            <span className="text-xs text-muted-foreground/85 truncate">Lowercase (a-z)</span>
            <Switch size="sm" checked={lowercase} onCheckedChange={(v) => { setLowercase(v); setActivePreset("custom"); }} />
          </label>
          <label className="rounded-lg border border-border/25 bg-muted/10 px-3 py-2 flex items-center justify-between gap-3 cursor-pointer min-w-0">
            <span className="text-xs text-muted-foreground/85 truncate">Digits (0-9)</span>
            <Switch size="sm" checked={digits} onCheckedChange={(v) => { setDigits(v); setActivePreset("custom"); }} />
          </label>
          <label className="rounded-lg border border-border/25 bg-muted/10 px-3 py-2 flex items-center justify-between gap-3 cursor-pointer min-w-0">
            <span className="text-xs text-muted-foreground/85 truncate">Symbols</span>
            <Switch size="sm" checked={symbols} onCheckedChange={(v) => { setSymbols(v); setActivePreset("custom"); }} />
          </label>
          <label className="rounded-lg border border-border/25 bg-muted/10 px-3 py-2 flex items-center justify-between gap-3 cursor-pointer min-w-0">
            <span className="flex items-center gap-1 text-xs text-muted-foreground/85 min-w-0">
              Exclude ambiguous
              <TooltipWrapper title="Exclude ambiguous characters" description="Removes look-alike characters such as 0/O and 1/l/I to avoid mistakes during manual entry.">
                <button type="button" className="text-muted-foreground/60 hover:text-foreground" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipWrapper>
            </span>
            <Switch size="sm" checked={excludeAmbiguous} onCheckedChange={(v) => { setExcludeAmbiguous(v); setActivePreset("custom"); }} />
          </label>
          <label className="rounded-lg border border-border/25 bg-muted/10 px-3 py-2 flex items-center justify-between gap-3 cursor-pointer min-w-0">
            <span className="flex items-center gap-1 text-xs text-muted-foreground/85 min-w-0">
              No adjacent repeats
              <TooltipWrapper title="No adjacent repeats" description="Prevents repeated neighbors like AA or 77 for cleaner, less-patterned output.">
                <button type="button" className="text-muted-foreground/60 hover:text-foreground" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipWrapper>
            </span>
            <Switch size="sm" checked={noAdjacentRepeat} onCheckedChange={setNoAdjacentRepeat} />
          </label>
          <label className="rounded-lg border border-border/25 bg-muted/10 px-3 py-2 flex items-center justify-between gap-3 cursor-pointer min-w-0">
            <span className="flex items-center gap-1 text-xs text-muted-foreground/85 min-w-0">
              No character reuse
              <TooltipWrapper title="No character reuse" description="Each character can appear only once. Requires a sufficiently large charset for your selected length.">
                <button type="button" className="text-muted-foreground/60 hover:text-foreground" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipWrapper>
            </span>
            <Switch size="sm" checked={noReuseChars} onCheckedChange={setNoReuseChars} />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
              Custom symbol set (optional)
              <TooltipWrapper
                title="Custom symbol set"
                description="Use this to limit symbols to an approved set (for example only !#$%^*_-). Leave it blank to use the default symbol list."
              >
                <button
                  type="button"
                  className="text-muted-foreground/60 hover:text-foreground"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipWrapper>
            </span>
            <Input
              value={customChars}
              onChange={(e) => { setCustomChars(e.target.value); setActivePreset("custom"); }}
              placeholder='Default symbols or e.g. "!#$%^*_"'
              className="ui-control-shell h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
              Exclude specific characters
              <TooltipWrapper
                title="Exclude specific characters"
                description="Any characters typed here are removed from generation (for example O0Il1). Helpful when credentials are read aloud or typed manually."
              >
                <button
                  type="button"
                  className="text-muted-foreground/60 hover:text-foreground"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipWrapper>
            </span>
            <Input
              value={excludeChars}
              onChange={(e) => { setExcludeChars(e.target.value); setActivePreset("custom"); }}
              placeholder="e.g. O0Il1`"
              className="ui-control-shell h-8 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="ui-surface-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/25">
            <span className="section-label-sm">Recent ({history.length})</span>
            <div className="flex items-center gap-1.5">
              {history.length > 1 && (
                <Button
                  size="sm"
                  variant="neutral"
                  className="h-6 text-2xs gap-1 px-2 text-muted-foreground/75"
                  onClick={() => navigator.clipboard.writeText(history.map((h) => h.password).join("\n"))}
                >
                  <Copy className="h-3 w-3" />
                  Copy All
                </Button>
              )}
              <Button size="sm" variant="destructive" className="h-6 text-2xs gap-1 px-2" onClick={() => setShowClearConfirm(true)}>
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            </div>
          </div>
          <div className="max-h-[220px] overflow-y-auto divide-y divide-border/25">
            {history.map((entry) => (
              <div key={entry.id} className="ui-data-row flex items-center gap-2 px-5 py-1.5">
                <span className="w-14 shrink-0 text-2xs font-mono text-muted-foreground/60">{entry.time}</span>
                <Badge variant="secondary" className="h-[18px] px-1.5 text-3xs shrink-0">{entry.preset}</Badge>
                <span className="flex-1 min-w-0 truncate text-xs font-mono text-foreground/70">{entry.password}</span>
                <CopyTextButton text={entry.password} size="icon" className="h-5 w-5 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear password history?"
        description={`This will permanently remove ${history.length} password${history.length !== 1 ? "s" : ""} from the session history.`}
        confirmText="Clear All"
        variant="destructive"
        onConfirm={() => setHistory([])}
      />
    </div>
  );
}
