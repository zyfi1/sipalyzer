/**
 * Provision Diff View — Monaco DiffEditor
 *
 * Full VS-Code-style editable diff editor. Both sides are editable with
 * real-time diff highlighting, word-level changes, minimap.
 *
 * State management: Monaco owns the text. React state only tracks line counts
 * and stats for the toolbar UI. No prop↔editor conflicts.
 */

import { useState, useRef, useCallback, useMemo } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { defineSipalyzerTheme, MONACO_THEME_NAME } from "@/lib/monacoTheme";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FileSearch, Upload, Trash2, ArrowRightLeft, ClipboardList,
  Eye, EyeOff, Loader2,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { FetchProvisionResult } from "@/types/provision";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize provision config text for clean diffing:
 *  - Strip \r
 *  - key=value → key = value  (consistent spacing)
 *  - ##  Title  ## → ## Title ##  (collapse internal padding)
 *  - ###...### borders → fixed-width 48-char border
 *  - Preserve comments, blanks, version lines as-is
 */
function normalizeConfig(raw: string): string {
  const BORDER = "#".repeat(48);
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return t;

      // Border lines: ####...  → standardize width
      if (/^#{3,}$/.test(t)) return BORDER;

      // Section title: ##  Title  ## → ## Title ##
      const titleMatch = t.match(/^##\s+(.+?)\s+##$/);
      if (titleMatch) return `## ${titleMatch[1]} ##`;

      // Other comment / version lines — keep as-is
      if (t.startsWith("#")) return t;

      // key=value → key = value
      const eq = t.indexOf("=");
      if (eq <= 0) return t;
      return `${t.slice(0, eq).trimEnd()} = ${t.slice(eq + 1).trimStart()}`;
    })
    .join("\n");
}

function computeStats(a: string, b: string) {
  if (!a && !b) return { added: 0, removed: 0, unchanged: 0 };
  const lA = a.split("\n"), lB = b.split("\n");
  let unch = 0;
  const freq = new Map<string, number>();
  for (const l of lA) freq.set(l, (freq.get(l) ?? 0) + 1);
  const used = new Map<string, number>();
  for (const l of lB) {
    if ((freq.get(l) ?? 0) - (used.get(l) ?? 0) > 0) {
      unch++;
      used.set(l, (used.get(l) ?? 0) + 1);
    }
  }
  return { added: lB.length - unch, removed: lA.length - unch, unchanged: unch };
}

// ── Paste Dialog ────────────────────────────────────────────────────────────

function PasteDialog({ open, side, onClose, onApply }: {
  open: boolean;
  side: "original" | "modified";
  onClose: () => void;
  onApply: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setText(""); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Paste into {side === "original" ? "Original" : "Modified"}
          </DialogTitle>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste .cfg content here..."
          className={cn(
            "w-full h-72 rounded-lg ui-panel-shell",
            "font-mono text-xs leading-relaxed p-3 outline-none resize-none",
            "placeholder:text-muted-foreground/60 text-foreground/85",
            "focus:border-foreground/20 transition-smooth"
          )}
          spellCheck={false}
          autoFocus
        />
        <DialogFooter>
          <Button variant="neutral" size="sm" onClick={() => { setText(""); onClose(); }}>Cancel</Button>
          <Button size="sm" variant="positive" disabled={!text.trim()} onClick={() => { onApply(normalizeConfig(text)); setText(""); onClose(); }}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Source chip ──────────────────────────────────────────────────────────────

function SourceActions({ label, accent, lineCount, hasProvision, onProvision, onFile, onPaste, onClear }: {
  label: string; accent: string; lineCount: number; hasProvision: boolean;
  onProvision: () => void; onFile: () => void; onPaste: () => void; onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", accent)} />
        <span className="text-xs font-semibold text-foreground">{label}</span>
        {lineCount > 0 && (
          <span className="text-2xs text-muted-foreground tabular-nums ml-0.5">{lineCount} lines</span>
        )}
      </div>
      <AppDivider orientation="vertical" size="md" className="mx-0" />
      <div className="flex items-center gap-1">
        <TooltipWrapper title="Load provision" description="Use the current provision file as this diff source.">
          <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" disabled={!hasProvision} onClick={onProvision}>
            <FileSearch className="h-3 w-3" />Provision
          </Button>
        </TooltipWrapper>
        <TooltipWrapper title="Import file" description="Open a local config file as this diff source.">
          <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" onClick={onFile}>
            <Upload className="h-3 w-3" />File
          </Button>
        </TooltipWrapper>
        <TooltipWrapper title="Paste" description="Paste config text for comparison.">
          <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" onClick={onPaste}>
            <ClipboardList className="h-3 w-3" />Paste
          </Button>
        </TooltipWrapper>
        {lineCount > 0 && (
          <TooltipWrapper title="Clear" description="Remove this source from the diff.">
            <Button variant="destructive" size="sm" className="h-7 px-1.5" onClick={onClear}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipWrapper>
        )}
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function ProvisionDiffView({ result }: { result: FetchProvisionResult | null }) {
  // UI-only state (not fed back into the editor)
  const [lineCountA, setLineCountA] = useState(0);
  const [lineCountB, setLineCountB] = useState(0);
  const [statsKey, setStatsKey] = useState(0); // bump to recalc stats
  const [changesOnly, setChangesOnly] = useState(false);
  const [pasteTarget, setPasteTarget] = useState<"original" | "modified" | null>(null);

  // Refs — Monaco owns the text, we read from these
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const origRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const modRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const textsRef = useRef({ a: "", b: "" });
  const fileRefA = useRef<HTMLInputElement>(null);
  const fileRefB = useRef<HTMLInputElement>(null);

  const hasProvision = !!result?.raw;

  // ── Read current text from the editor (source of truth) ──

  const readTexts = useCallback(() => {
    const a = origRef.current?.getValue() ?? "";
    const b = modRef.current?.getValue() ?? "";
    textsRef.current = { a, b };
    return { a, b };
  }, []);

  const updateUiState = useCallback(() => {
    const { a, b } = readTexts();
    setLineCountA(a ? a.split("\n").length : 0);
    setLineCountB(b ? b.split("\n").length : 0);
    setStatsKey((k) => k + 1);
  }, [readTexts]);

  // ── Auto-normalize on paste ──
  // When users paste raw cfg text directly into the editor (Ctrl+V), it
  // bypasses our normalizeConfig. Intercept paste events and normalize so
  // both sides always use consistent `key = value` formatting.

  const autoNormalizeOnPaste = useCallback((ed: editor.IStandaloneCodeEditor) => {
    ed.onDidPaste(() => {
      const raw = ed.getValue();
      const clean = normalizeConfig(raw);
      if (raw !== clean) {
        // Preserve cursor position as best we can
        const pos = ed.getPosition();
        ed.setValue(clean);
        if (pos) ed.setPosition(pos);
      }
    });
  }, []);

  // ── Editor mount — wire up listeners ──

  const handleMount = useCallback((ed: editor.IStandaloneDiffEditor) => {
    diffRef.current = ed;
    const orig = ed.getOriginalEditor();
    const mod = ed.getModifiedEditor();
    origRef.current = orig;
    modRef.current = mod;

    orig.onDidChangeModelContent(updateUiState);
    mod.onDidChangeModelContent(updateUiState);

    // Normalize pasted content on both sides
    autoNormalizeOnPaste(orig);
    autoNormalizeOnPaste(mod);
  }, [updateUiState, autoNormalizeOnPaste]);

  // ── Imperative setters (the only way we change text) ──

  const setOriginalText = useCallback((text: string) => {
    origRef.current?.setValue(text);
    // updateUiState will fire from onDidChangeModelContent
  }, []);

  const setModifiedText = useCallback((text: string) => {
    modRef.current?.setValue(text);
  }, []);

  // ── Actions ──

  const loadProvision = useCallback((side: "original" | "modified") => {
    if (!result?.raw) return;
    const cleaned = normalizeConfig(result.raw);
    if (side === "original") setOriginalText(cleaned);
    else setModifiedText(cleaned);
  }, [result?.raw, setOriginalText, setModifiedText]);

  const onFileImport = useCallback((side: "original" | "modified", e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = normalizeConfig(reader.result as string);
      if (side === "original") setOriginalText(text);
      else setModifiedText(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [setOriginalText, setModifiedText]);

  const doSwap = useCallback(() => {
    const { a, b } = readTexts();
    setOriginalText(b);
    setModifiedText(a);
  }, [readTexts, setOriginalText, setModifiedText]);

  // ── Stats (derived from ref on demand) ──

  const stats = useMemo(() => {
    void statsKey; // dependency to recalc
    return computeStats(textsRef.current.a, textsRef.current.b);
  }, [statsKey]);

  const hasBoth = lineCountA > 0 && lineCountB > 0;

  // ── Monaco options (recreated when toggles change) ──

  const editorOptions = useMemo<editor.IDiffEditorConstructionOptions>(() => ({
    readOnly: false,
    originalEditable: true,
    renderSideBySide: true,
    enableSplitViewResizing: true,
    minimap: { enabled: true },
    fontSize: 12,
    fontFamily: "\"Geist Mono Variable\", monospace",
    lineHeight: 18,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: "off",
    renderIndicators: true,
    ignoreTrimWhitespace: false,
    renderOverviewRuler: true,
    hideUnchangedRegions: { enabled: changesOnly },
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    padding: { top: 8 },
    contextmenu: false,
  }), [changesOnly]);

  // ── Render ──

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Hidden file inputs */}
      <input ref={fileRefA} type="file" accept=".cfg,.txt,.conf,.ini" className="hidden" onChange={(e) => onFileImport("original", e)} />
      <input ref={fileRefB} type="file" accept=".cfg,.txt,.conf,.ini" className="hidden" onChange={(e) => onFileImport("modified", e)} />

      {/* ── Toolbar ── */}
      <div className="ui-section-header-sm px-4 flex shrink-0 items-center gap-3">
        {/* Left: Original source */}
        <SourceActions
          label="Original" accent="bg-destructive" lineCount={lineCountA} hasProvision={hasProvision}
          onProvision={() => loadProvision("original")}
          onFile={() => fileRefA.current?.click()}
          onPaste={() => setPasteTarget("original")}
          onClear={() => setOriginalText("")}
        />

        {/* Center: View controls */}
        <div className="flex items-center gap-2 mx-auto">
          <TooltipWrapper title="Swap sides" description="Swap original and modified configs.">
            <button
              type="button"
              onClick={doSwap}
              className="ui-control-shell flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground transition-smooth"
            >
              <ArrowRightLeft className="h-3 w-3" />
            </button>
          </TooltipWrapper>
          <AppDivider orientation="vertical" size="md" className="mx-0" />
          <TooltipWrapper title={changesOnly ? "Show all lines" : "Hide unchanged"} description={changesOnly ? "Show all lines including unchanged ones." : "Collapse unchanged regions to focus on changes."}>
            <button type="button" onClick={() => setChangesOnly(v => !v)}
              className={cn(
                "ui-control-shell flex h-7 items-center gap-1.5 rounded-md px-2 text-2xs font-medium transition-smooth",
                changesOnly
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}>
              {changesOnly ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              Changes
            </button>
          </TooltipWrapper>
          {hasBoth && (
            <>
              <AppDivider orientation="vertical" size="md" className="mx-0" />
              <div className="flex items-center gap-2.5 text-2xs font-medium tabular-nums">
                <span className="text-success">+{stats.added}</span>
                <span className="text-destructive">-{stats.removed}</span>
                <span className="text-muted-foreground">{stats.unchanged} unchanged</span>
              </div>
            </>
          )}
        </div>

        {/* Right: Modified source */}
        <SourceActions
          label="Modified" accent="bg-success" lineCount={lineCountB} hasProvision={hasProvision}
          onProvision={() => loadProvision("modified")}
          onFile={() => fileRefB.current?.click()}
          onPaste={() => setPasteTarget("modified")}
          onClear={() => setModifiedText("")}
        />
      </div>

      {/* ── Monaco DiffEditor (fills all remaining space) ── */}
      <div className="flex-1 min-h-0">
        <DiffEditor
          height="100%"
          language="ini"
          theme={MONACO_THEME_NAME}
          beforeMount={defineSipalyzerTheme}
          original=""
          modified=""
          options={editorOptions}
          onMount={handleMount}
          loading={
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Loading editor...</span>
            </div>
          }
        />
      </div>

      {/* ── Paste Dialog ── */}
      {pasteTarget && (
        <PasteDialog
          open={true}
          side={pasteTarget}
          onClose={() => setPasteTarget(null)}
          onApply={(text) => {
            if (pasteTarget === "original") setOriginalText(text);
            else setModifiedText(text);
          }}
        />
      )}
    </div>
  );
}
