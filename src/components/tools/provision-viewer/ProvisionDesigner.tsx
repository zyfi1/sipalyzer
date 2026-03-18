/**
 * Provision Designer — feature-rich .cfg editor with parameter wiki panel
 *
 * Layout: Monaco single editor (left, flex-1) + collapsible parameter panel (right, w-80)
 * Toolbar: Load Provision, Import File, Paste, New Blank, Insert, Copy All, Download .cfg
 *
 * Same ref-based state pattern as the Diff view — Monaco owns the text,
 * React state only tracks UI metadata (line count, cursor info).
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import Editor, { OnMount } from "@monaco-editor/react";
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
import { Input } from "@/components/ui/input";
import {
  FileSearch, Upload, ClipboardList, Plus, Copy, Check,
  Download, Loader2, ChevronRight, ChevronDown, Search, Info,
  PanelRight, Code, Eye,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { FetchProvisionResult } from "@/types/provision";
import {
  type FieldReferenceEntry,
  YEALINK_FIELD_REFERENCE,
  getAllCategories,
  getFieldInfoWithFallback,
  keyToInsertString,
} from "./yealinkFieldReference";
import { ParameterInsertDialog } from "./ParameterInsertDialog";
import {
  type IndexedParamGroup,
  detectGroup,
  scanEditorForGroup,
  buildLineForField,
  buildKeyForField,
} from "./indexedParameterGroups";
import { IndexedParameterWidget } from "./IndexedParameterWidget";
import { EmptyState } from "@/components/ui/empty-state";
import { type KeyValue, useSidecarData } from "./deviceViewData";
import { getDeviceLayout, modelSupportsSidecar } from "./deviceLayouts";
import { DesignerPhoneMockup } from "./DesignerPhoneMockup";
import { DesignerEditPopover, type DesignerEditTarget } from "./DesignerEditPopover";
import { SidecarMockup } from "./SidecarMockup";
import { DeviceModelPicker } from "./DeviceModelPicker";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize provision config text for clean editing (same logic as diff view):
 *  - Strip \r
 *  - key=value → key = value
 *  - ##  Title  ## → ## Title ##
 *  - ###...### borders → fixed-width 48-char border
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
      if (/^#{3,}$/.test(t)) return BORDER;
      const titleMatch = t.match(/^##\s+(.+?)\s+##$/);
      if (titleMatch) return `## ${titleMatch[1]} ##`;
      if (t.startsWith("#")) return t;
      const eq = t.indexOf("=");
      if (eq <= 0) return t;
      return `${t.slice(0, eq).trimEnd()} = ${t.slice(eq + 1).trimStart()}`;
    })
    .join("\n");
}

/** Parse editor text into KeyValue[] for live mockup rendering. */
function parseEditorToKV(text: string): KeyValue[] {
  if (!text) return [];
  const result: KeyValue[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    result.push({ key: t.slice(0, eq).trimEnd(), value: t.slice(eq + 1).trimStart() });
  }
  return result;
}

/** Extract the key from a single config line (before the =). */
function extractKeyFromLine(line: string): string {
  const t = line.trim();
  if (!t || t.startsWith("#")) return "";
  const eq = t.indexOf("=");
  if (eq <= 0) return "";
  return t.slice(0, eq).trimEnd();
}

/**
 * Smart parsing for option strings. Returns array of individual options.
 * Handles: pipe-separated, numbered, semicolon-separated, comma-separated, free text.
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

// ── Paste Dialog ────────────────────────────────────────────────────────────

function PasteDialog({ open, onClose, onApply }: {
  open: boolean;
  onClose: () => void;
  onApply: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setText(""); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Paste Configuration</DialogTitle>
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

// ── Parameter Panel ─────────────────────────────────────────────────────────

function ParameterPanel({
  cursorKey,
  panelFilter,
  onPanelFilterChange,
  onInsertKey,
}: {
  cursorKey: string;
  panelFilter: string;
  onPanelFilterChange: (v: string) => void;
  onInsertKey: (line: string) => void;
}) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const categories = useMemo(() => getAllCategories(), []);
  const fieldInfo = useMemo(() => cursorKey ? getFieldInfoWithFallback(cursorKey) : null, [cursorKey]);
  const known = fieldInfo ? !!fieldInfo.source : false;

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

  // Filter by search
  const filteredGrouped = useMemo(() => {
    if (!panelFilter.trim()) return grouped;
    const terms = panelFilter.toLowerCase().split(/\s+/).filter(Boolean);
    const result = new Map<string, FieldReferenceEntry[]>();
    for (const [cat, entries] of grouped) {
      const filtered = entries.filter((e) => {
        const keyStr = typeof e.key === "string" ? e.key : (e.key as RegExp).source;
        const sv = `${keyStr} ${e.label} ${cat} ${e.description}`.toLowerCase();
        return terms.every((t) => sv.includes(t));
      });
      if (filtered.length > 0) result.set(cat, filtered);
    }
    return result;
  }, [panelFilter, grouped]);

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Current line info */}
      <div className="border-b border-border/50 p-3 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="section-label-sm">Current Parameter</span>
        </div>
        {cursorKey && fieldInfo ? (
          <div className="space-y-1.5">
            <p className="font-mono text-xs text-foreground font-medium break-all">{cursorKey}</p>
            <p className="text-xs font-medium text-foreground">{fieldInfo.label}</p>
            <p className="text-2xs text-muted-foreground leading-relaxed">{fieldInfo.description}</p>
            {fieldInfo.options && (
              <div className="space-y-1 mt-1.5">
                <p className="section-label-sm">Possible Values</p>
                <div className="flex flex-col gap-0.5">
                  {parseOptionsString(fieldInfo.options).map((opt, i) => (
                    <span key={i} className="font-mono text-2xs text-foreground/80">{opt}</span>
                  ))}
                </div>
              </div>
            )}
            {fieldInfo.source && (
              <div className="mt-1.5">
                <span className="text-2xs text-muted-foreground/70">{fieldInfo.source.name}</span>
              </div>
            )}
            {!known && (
              <span className="text-2xs font-medium text-warning">Unknown parameter</span>
            )}
          </div>
        ) : (
          <p className="text-2xs text-muted-foreground/60 italic">
            {cursorKey ? "Unknown parameter" : "Move cursor to a config line to see details"}
          </p>
        )}
      </div>

      {/* Category browser search */}
      <div className="border-b border-border/50 px-3 py-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter parameters..."
            value={panelFilter}
            onChange={(e) => onPanelFilterChange(e.target.value)}
            className="h-7 text-2xs pl-7 ui-control-shell"
          />
        </div>
      </div>

      {/* Category browser */}
      <div className="flex-1 min-h-0 overflow-auto">
        {Array.from(filteredGrouped).map(([cat, entries]) => {
          const isExpanded = expandedCats.has(cat);
          return (
            <div key={cat} className="border-b border-border/30">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-smooth"
                onClick={() => toggleCat(cat)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="text-2xs font-semibold text-foreground">{cat}</span>
                <span className="text-2xs text-muted-foreground/60 tabular-nums ml-auto">{entries.length}</span>
              </button>
              {isExpanded && (
                <div className="pb-1">
                  {entries.map((entry, idx) => {
                    const keyStr = typeof entry.key === "string" ? entry.key : keyToInsertString(entry);
                    return (
                      <Tooltip key={`${cat}-${idx}`} delayDuration={300}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-1 hover:bg-accent transition-smooth group flex items-start gap-2"
                            onClick={() => onInsertKey(`${keyStr} = `)}
                          >
                            <Plus className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/60 group-hover:text-foreground transition-smooth" />
                            <div className="min-w-0">
                              <span className="font-mono text-2xs text-foreground/80 group-hover:text-foreground break-all block">{keyStr}</span>
                              <span className="text-2xs text-muted-foreground/60 block truncate">{entry.label}</span>
                            </div>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" align="start" className="max-w-xs p-3 space-y-2">
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
                </div>
              )}
            </div>
          );
        })}
        {filteredGrouped.size === 0 && (
          <EmptyState
            compact
            variant="inline"
            icon={<Search />}
            title="No parameters match your search"
            description="Try a broader key, category, or label term."
            className="p-6"
          />
        )}
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function ProvisionDesigner({
  result,
  initialModel,
  onModelChange,
}: {
  result: FetchProvisionResult | null;
  initialModel?: string;
  onModelChange?: (model: string) => void;
}) {
  // UI state
  const [lineCount, setLineCount] = useState(0);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorKey, setCursorKey] = useState("");
  const [showPanel, setShowPanel] = useState(true);
  const [panelFilter, setPanelFilter] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Visual mode state
  const [viewMode, setViewMode] = useState<"text" | "visual">("text");
  const [designerModel, setDesignerModel] = useState(initialModel || "T46G");
  const [parsedEntries, setParsedEntries] = useState<KeyValue[]>([]);
  const [editTarget, setEditTarget] = useState<DesignerEditTarget | null>(null);
  const [editAnchor, setEditAnchor] = useState<{ top: number; left: number } | null>(null);
  const [mockupPanelWidth, setMockupPanelWidth] = useState(480);
  const [sidecarVisible, setSidecarVisible] = useState(false);
  const [sidecarUserToggled, setSidecarUserToggled] = useState(false);

  // Sidecar data
  const designerLayout = getDeviceLayout(designerModel);
  const sidecarData = useSidecarData(parsedEntries, designerModel, designerLayout);
  const supportsSidecar = modelSupportsSidecar(designerModel);

  // Auto-show/hide sidecar when config changes (only if user hasn't manually toggled)
  useEffect(() => {
    if (sidecarUserToggled) return;
    setSidecarVisible(sidecarData.autoDetected);
  }, [sidecarData.autoDetected, sidecarUserToggled]);

  const parseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mockupContainerRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (!initialModel || initialModel === designerModel) return;
    setDesignerModel(initialModel);
  }, [initialModel, designerModel]);

  const handleDesignerModelChange = useCallback((nextModel: string) => {
    setDesignerModel(nextModel);
    onModelChange?.(nextModel);
  }, [onModelChange]);

  // Widget state for indexed parameter groups
  const [activeGroup, setActiveGroup] = useState<IndexedParamGroup | null>(null);
  const [groupInstances, setGroupInstances] = useState<Map<number, Record<string, string>>>(new Map());
  const [widgetAnchor, setWidgetAnchor] = useState<{ top: number; left: number } | null>(null);
  const widgetDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs — Monaco owns the text
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasProvision = !!result?.raw;

  // ── Update UI state from editor ──
  const updateUiState = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const text = ed.getValue();
    setLineCount(text ? text.split("\n").length : 0);
  }, []);

  const updateCursorInfo = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const pos = ed.getPosition();
    if (!pos) return;
    setCursorLine(pos.lineNumber);
    const model = ed.getModel();
    if (!model) return;

    const lineContent = model.getLineContent(pos.lineNumber);
    const key = extractKeyFromLine(lineContent);
    setCursorKey(key);

    // Debounced widget detection to avoid flicker during rapid cursor movement
    if (widgetDebounceRef.current) clearTimeout(widgetDebounceRef.current);
    widgetDebounceRef.current = setTimeout(() => {
      const detected = detectGroup(key);
      if (detected) {
        const text = ed.getValue();
        const instances = scanEditorForGroup(text, detected.group);
        setActiveGroup(detected.group);
        setGroupInstances(instances);

        // Compute anchor position from cursor
        const scrolledPos = ed.getScrolledVisiblePosition(pos);
        if (scrolledPos && editorContainerRef.current) {
          const containerRect = editorContainerRef.current.getBoundingClientRect();
          setWidgetAnchor({
            top: containerRect.top + scrolledPos.top + 20,
            left: containerRect.left + scrolledPos.left + 40,
          });
        }
      } else {
        setActiveGroup(null);
        setGroupInstances(new Map());
        setWidgetAnchor(null);
      }
    }, 150);
  }, []);

  // ── Auto-normalize on paste ──
  const autoNormalizeOnPaste = useCallback((ed: editor.IStandaloneCodeEditor) => {
    ed.onDidPaste(() => {
      const raw = ed.getValue();
      const clean = normalizeConfig(raw);
      if (raw !== clean) {
        const pos = ed.getPosition();
        ed.setValue(clean);
        if (pos) ed.setPosition(pos);
      }
    });
  }, []);

  // ── Debounced KV parsing for visual mode ──
  const debouncedParse = useCallback(() => {
    if (parseDebounceRef.current) clearTimeout(parseDebounceRef.current);
    parseDebounceRef.current = setTimeout(() => {
      const ed = editorRef.current;
      if (!ed) return;
      setParsedEntries(parseEditorToKV(ed.getValue()));
    }, 400);
  }, []);

  // ── Editor mount ──
  const handleMount: OnMount = useCallback((ed) => {
    editorRef.current = ed;
    ed.onDidChangeModelContent(() => {
      updateUiState();
      debouncedParse();
    });
    ed.onDidChangeCursorPosition(updateCursorInfo);
    autoNormalizeOnPaste(ed);
    updateUiState();
    updateCursorInfo();
    debouncedParse();
  }, [updateUiState, updateCursorInfo, autoNormalizeOnPaste, debouncedParse]);

  // ── Imperative setters ──
  const setEditorText = useCallback((text: string) => {
    editorRef.current?.setValue(text);
  }, []);

  // ── Actions ──

  const loadProvision = useCallback(() => {
    if (!result?.raw) return;
    setEditorText(normalizeConfig(result.raw));
    setSidecarUserToggled(false);
  }, [result?.raw, setEditorText]);

  const onFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEditorText(normalizeConfig(reader.result as string));
      setSidecarUserToggled(false);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [setEditorText]);

  const newBlank = useCallback(() => {
    setEditorText("#!version:1.0.0.1\n\n");
    setSidecarUserToggled(false);
    // Focus editor and place cursor at end
    setTimeout(() => {
      const ed = editorRef.current;
      if (ed) {
        const model = ed.getModel();
        if (model) {
          const lastLine = model.getLineCount();
          ed.setPosition({ lineNumber: lastLine, column: 1 });
          ed.focus();
        }
      }
    }, 50);
  }, [setEditorText]);

  const insertAtCursor = useCallback((line: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const pos = ed.getPosition();
    if (!pos) return;
    const model = ed.getModel();
    if (!model) return;

    // Insert on a new line after the cursor line
    const lineCount = model.getLineCount();
    const insertLineNumber = Math.min(pos.lineNumber + 1, lineCount + 1);
    const endOfCurrentLine = model.getLineMaxColumn(pos.lineNumber);

    ed.executeEdits("designer-insert", [{
      range: {
        startLineNumber: pos.lineNumber,
        startColumn: endOfCurrentLine,
        endLineNumber: pos.lineNumber,
        endColumn: endOfCurrentLine,
      },
      text: `\n${line}`,
    }]);

    // Move cursor to end of inserted line (after the "= ")
    ed.setPosition({ lineNumber: insertLineNumber, column: line.length + 1 });
    ed.focus();
  }, []);

  const copyAll = useCallback(async () => {
    const text = editorRef.current?.getValue() ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  }, []);

  const downloadCfg = useCallback(() => {
    const text = editorRef.current?.getValue() ?? "";
    if (!text) return;
    saveExportFile("config.cfg", textToBase64(text), "Config files", "cfg").catch(() => {});
  }, []);

  // ── Widget live-sync callbacks ──

  /** Refresh the widget instances from the current editor text. */
  const refreshGroupInstances = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || !activeGroup) return;
    const text = ed.getValue();
    const instances = scanEditorForGroup(text, activeGroup);
    setGroupInstances(instances);
  }, [activeGroup]);

  /** Live update a single field value in the editor. */
  const handleWidgetFieldChange = useCallback((index: number, suffix: string, value: string) => {
    const ed = editorRef.current;
    if (!ed || !activeGroup) return;
    const model = ed.getModel();
    if (!model) return;

    const targetKey = buildKeyForField(activeGroup, index, suffix).toLowerCase();

    // Find the line in the editor
    for (let ln = 1; ln <= model.getLineCount(); ln++) {
      const lineText = model.getLineContent(ln);
      const t = lineText.trim();
      if (!t || t.startsWith("#")) continue;
      const eqIdx = t.indexOf("=");
      if (eqIdx <= 0) continue;
      const lineKey = t.slice(0, eqIdx).trimEnd().toLowerCase();

      if (lineKey === targetKey) {
        const newLine = buildLineForField(activeGroup, index, suffix, value);
        ed.executeEdits("widget-sync", [{
          range: {
            startLineNumber: ln,
            startColumn: 1,
            endLineNumber: ln,
            endColumn: lineText.length + 1,
          },
          text: newLine,
        }]);
        // Update local instances state immediately (don't wait for debounce)
        setGroupInstances((prev) => {
          const next = new Map(prev);
          const rec = { ...(next.get(index) ?? {}) };
          rec[suffix] = value;
          next.set(index, rec);
          return next;
        });
        return;
      }
    }

    // Line not found — insert it near other lines of the same index
    const text = ed.getValue();
    const lines = text.split("\n");
    const prefix = activeGroup.basePrefix.toLowerCase();
    let lastLineOfIndex = -1;
    let lastLineOfGroup = -1;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === undefined) continue;
      const t = raw.trim();
      if (!t || t.startsWith("#")) continue;
      const eqIdx = t.indexOf("=");
      if (eqIdx <= 0) continue;
      const k = t.slice(0, eqIdx).trimEnd().toLowerCase();
      if (k.startsWith(prefix + ".")) {
        lastLineOfGroup = i;
        // Check if this is the same index
        const afterPrefix = k.slice(prefix.length + 1);
        const dotIdx = afterPrefix.indexOf(".");
        const idxStr = dotIdx === -1 ? afterPrefix : afterPrefix.slice(0, dotIdx);
        if (parseInt(idxStr, 10) === index) {
          lastLineOfIndex = i;
        }
      }
    }

    const insertAfter = lastLineOfIndex >= 0 ? lastLineOfIndex : lastLineOfGroup >= 0 ? lastLineOfGroup : model.getLineCount() - 1;
    const insertLineNumber = insertAfter + 1; // 0-based → 1-based
    const newLine = buildLineForField(activeGroup, index, suffix, value);
    const endCol = model.getLineMaxColumn(insertLineNumber);

    ed.executeEdits("widget-insert", [{
      range: {
        startLineNumber: insertLineNumber,
        startColumn: endCol,
        endLineNumber: insertLineNumber,
        endColumn: endCol,
      },
      text: `\n${newLine}`,
    }]);
    refreshGroupInstances();
  }, [activeGroup, refreshGroupInstances]);

  /** Add a new instance with the next available index. */
  const handleWidgetAddInstance = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || !activeGroup) return;
    const model = ed.getModel();
    if (!model) return;

    // Determine next index
    const existingIndices = Array.from(groupInstances.keys());
    const maxExisting = existingIndices.length > 0 ? Math.max(...existingIndices) : 0;
    const nextIndex = maxExisting + 1;

    if (activeGroup.maxIndex && nextIndex > activeGroup.maxIndex) return;

    // Build the block of new lines
    const newLines = activeGroup.fields.map((f) =>
      buildLineForField(activeGroup, nextIndex, f.suffix, "")
    );

    // Find insertion point: after the last line of this group
    const text = ed.getValue();
    const lines = text.split("\n");
    const prefix = activeGroup.basePrefix.toLowerCase();
    let lastGroupLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === undefined) continue;
      const t = raw.trim();
      if (!t || t.startsWith("#")) continue;
      const eqIdx = t.indexOf("=");
      if (eqIdx <= 0) continue;
      const k = t.slice(0, eqIdx).trimEnd().toLowerCase();
      if (k.startsWith(prefix + ".")) {
        lastGroupLine = i;
      }
    }

    const insertLineNumber = lastGroupLine >= 0 ? lastGroupLine + 1 : model.getLineCount();
    const endCol = model.getLineMaxColumn(insertLineNumber);

    ed.executeEdits("widget-add", [{
      range: {
        startLineNumber: insertLineNumber,
        startColumn: endCol,
        endLineNumber: insertLineNumber,
        endColumn: endCol,
      },
      text: "\n" + newLines.join("\n"),
    }]);

    refreshGroupInstances();
  }, [activeGroup, groupInstances, refreshGroupInstances]);

  /** Remove all lines for a specific index. */
  const handleWidgetRemoveInstance = useCallback((index: number) => {
    const ed = editorRef.current;
    if (!ed || !activeGroup) return;
    const model = ed.getModel();
    if (!model) return;

    const prefix = activeGroup.basePrefix.toLowerCase();
    const linesToDelete: number[] = [];

    for (let ln = 1; ln <= model.getLineCount(); ln++) {
      const lineText = model.getLineContent(ln);
      const t = lineText.trim();
      if (!t || t.startsWith("#")) continue;
      const eqIdx = t.indexOf("=");
      if (eqIdx <= 0) continue;
      const k = t.slice(0, eqIdx).trimEnd().toLowerCase();

      if (k.startsWith(prefix + ".")) {
        const afterPrefix = k.slice(prefix.length + 1);
        const dotIdx = afterPrefix.indexOf(".");
        const idxStr = dotIdx === -1 ? afterPrefix : afterPrefix.slice(0, dotIdx);
        if (parseInt(idxStr, 10) === index) {
          linesToDelete.push(ln);
        }
      }
    }

    if (linesToDelete.length === 0) return;

    // Delete lines from bottom to top so line numbers stay valid
    const edits = linesToDelete
      .sort((a, b) => b - a)
      .map((ln) => ({
        range: {
          startLineNumber: ln,
          startColumn: 1,
          endLineNumber: ln + 1,
          endColumn: 1,
        },
        text: "",
      }));

    ed.executeEdits("widget-remove", edits);
    refreshGroupInstances();
  }, [activeGroup, refreshGroupInstances]);

  const closeWidget = useCallback(() => {
    setActiveGroup(null);
    setGroupInstances(new Map());
    setWidgetAnchor(null);
  }, []);

  // ── Visual mode: handle element click on mockup ──
  const handleMockupElementClick = useCallback((target: DesignerEditTarget, anchorRect: DOMRect) => {
    const containerRect = mockupContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setEditTarget(target);
    setEditAnchor({
      top: anchorRect.bottom - containerRect.top + 4,
      left: anchorRect.left - containerRect.left + anchorRect.width / 2,
    });

    // Scroll editor to first matching line
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;
    const prefix = target.configPrefix.toLowerCase();
    for (let ln = 1; ln <= model.getLineCount(); ln++) {
      const lineKey = extractKeyFromLine(model.getLineContent(ln)).toLowerCase();
      if (lineKey.startsWith(prefix)) {
        ed.revealLineInCenter(ln);
        ed.setPosition({ lineNumber: ln, column: 1 });
        break;
      }
    }
  }, []);

  /** Write a key=value into the editor; update existing line or insert new. */
  const handlePopoverFieldChange = useCallback((key: string, value: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;
    const lowerKey = key.toLowerCase();

    // Try to find and replace existing line
    for (let ln = 1; ln <= model.getLineCount(); ln++) {
      const lineText = model.getLineContent(ln);
      const lineKey = extractKeyFromLine(lineText).toLowerCase();
      if (lineKey === lowerKey) {
        const newLine = `${key} = ${value}`;
        ed.executeEdits("designer-visual-edit", [{
          range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: lineText.length + 1 },
          text: newLine,
        }]);
        return;
      }
    }

    // Not found — insert at end
    const lastLine = model.getLineCount();
    const endCol = model.getLineMaxColumn(lastLine);
    ed.executeEdits("designer-visual-insert", [{
      range: { startLineNumber: lastLine, startColumn: endCol, endLineNumber: lastLine, endColumn: endCol },
      text: `\n${key} = ${value}`,
    }]);
  }, []);

  const closeEditPopover = useCallback(() => {
    setEditTarget(null);
    setEditAnchor(null);
  }, []);

  // ── Resize handle drag logic ──
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth = mockupPanelWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const container = splitContainerRef.current;
      if (!container) return;
      const containerWidth = container.getBoundingClientRect().width;
      const wikiWidth = showPanel ? 320 : 0;
      const availableWidth = containerWidth - wikiWidth;
      const minMockup = 260;
      const minEditor = 220;
      const maxMockup = availableWidth - minEditor;
      const delta = ev.clientX - startX;
      const newWidth = Math.max(minMockup, Math.min(maxMockup, startWidth + delta));
      setMockupPanelWidth(newWidth);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [mockupPanelWidth, showPanel]);

  // ── Monaco options ──
  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(() => ({
    readOnly: false,
    minimap: { enabled: true },
    fontSize: 12,
    fontFamily: "\"Geist Mono Variable\", monospace",
    lineHeight: 18,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: "off",
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    padding: { top: 8 },
    suggest: { showWords: false },
    quickSuggestions: false,
    lineNumbers: "on",
    glyphMargin: false,
    folding: true,
    renderLineHighlight: "line",
    contextmenu: false,
  }), []);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept=".cfg,.txt,.conf,.ini" className="hidden" onChange={onFileImport} />

      {/* ── Toolbar ── */}
      <div className="ui-section-header-sm flex shrink-0 items-center gap-2 flex-wrap">
        {/* Source actions */}
        <div className="flex items-center gap-1">
          <TooltipWrapper title="Load from provision" description="Load the fetched provision into the editor.">
            <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" disabled={!hasProvision} onClick={loadProvision}>
              <FileSearch className="h-3 w-3" />Provision
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Import file" description="Import a .cfg file from disk.">
            <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3 w-3" />Import
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Paste config" description="Paste .cfg content from clipboard.">
            <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" onClick={() => setPasteOpen(true)}>
              <ClipboardList className="h-3 w-3" />Paste
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="New" description="Start with a blank config.">
            <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" onClick={newBlank}>
              <Code className="h-3 w-3" />New
            </Button>
          </TooltipWrapper>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Insert */}
        <TooltipWrapper title="Insert parameter" description="Search and insert a parameter at cursor (Ctrl+I).">
          <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" onClick={() => setInsertOpen(true)}>
            <Plus className="h-3 w-3" />Insert
          </Button>
        </TooltipWrapper>

        <div className="h-4 w-px bg-border" />

        {/* Export */}
        <div className="flex items-center gap-1">
          <TooltipWrapper title="Copy" description="Copy all editor content to clipboard.">
            <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" onClick={copyAll}>
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Download .cfg" description="Download the config as a .cfg file.">
            <Button variant="neutral" size="sm" className="h-7 px-2 text-2xs gap-1.5" onClick={downloadCfg}>
              <Download className="h-3 w-3" />.cfg
            </Button>
          </TooltipWrapper>
        </div>

        {/* Spacer + meta */}
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-2xs text-muted-foreground/70 tabular-nums">
          {lineCount > 0 && <span>{lineCount} lines</span>}
          <span>Ln {cursorLine}</span>
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="w-[220px]">
          <DeviceModelPicker
            value={designerModel}
            onChange={handleDesignerModelChange}
            compact
            id="designer-model"
          />
        </div>

        {/* View mode toggle */}
        <div className="subview-tabs-compact">
          <button
            type="button"
            data-state={viewMode === "text" ? "active" : "inactive"}
            onClick={() => setViewMode("text")}
            className="subview-tab-compact"
          >
            <Code />
            Text
          </button>
          <button
            type="button"
            data-state={viewMode === "visual" ? "active" : "inactive"}
            onClick={() => { setViewMode("visual"); debouncedParse(); }}
            className="subview-tab-compact"
          >
            <Eye />
            Visual
          </button>
        </div>

        {/* Panel toggle */}
        <TooltipWrapper
          title={showPanel ? "Hide parameter panel" : "Show parameter panel"}
          description="Toggle the parameter reference panel (wiki) on the right."
        >
          <button
            type="button"
            onClick={() => setShowPanel((v) => !v)}
            className={cn(
              "ui-control-shell flex h-7 items-center gap-1.5 rounded-lg px-2 text-2xs font-medium transition-smooth",
              showPanel
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <PanelRight className="h-3 w-3" />
            Wiki
          </button>
        </TooltipWrapper>
      </div>

      {/* ── Editor + Mockup + Panel ── */}
      <div ref={splitContainerRef} className="flex-1 flex min-h-0">
        {/* Phone mockup panel (visual mode) */}
        {viewMode === "visual" && (
          <>
            <div
              ref={mockupContainerRef}
              className="surface-flat relative flex shrink-0 flex-col overflow-auto"
              style={{ width: mockupPanelWidth }}
            >
              <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
                {/* Model name + sidecar toggle row */}
                <div className="flex items-center justify-center gap-3 w-full">
                  <div className="section-label-sm">
                    {getDeviceLayout(designerModel).name}
                  </div>
                  {supportsSidecar && (
                    <button
                      type="button"
                      onClick={() => {
                        setSidecarUserToggled(true);
                        setSidecarVisible((v) => !v);
                      }}
                      className={cn(
                        "ui-control-shell flex h-7 items-center gap-1.5 rounded-full px-2.5 text-2xs font-medium transition-smooth",
                        sidecarVisible
                          ? "bg-info/12 text-info border-info/30 hover:bg-info/20"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                        <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9zM3.5 3a.5.5 0 00-.5.5v9a.5.5 0 00.5.5H6V3H3.5zM7 3v10h5.5a.5.5 0 00.5-.5v-9a.5.5 0 00-.5-.5H7z" />
                      </svg>
                      {sidecarVisible ? "Hide Sidecar" : "Show Sidecar"}
                      {sidecarData.totalConfiguredKeys > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-info/20 text-3xs font-semibold text-info">
                          {sidecarData.totalConfiguredKeys} keys
                        </span>
                      )}
                    </button>
                  )}
                </div>
                {/* Phone + optional sidecar side by side */}
                <div className="w-full flex justify-center gap-4">
                  <div className={cn(
                    sidecarVisible && sidecarData.units.length > 0
                      ? "flex-[3] min-w-0"
                      : "w-full"
                  )} style={{ maxWidth: Math.min(mockupPanelWidth - 48, 600) }}>
                    <DesignerPhoneMockup
                      modelId={designerModel}
                      parsedEntries={parsedEntries}
                      onElementClick={handleMockupElementClick}
                    />
                  </div>
                  {sidecarVisible && sidecarData.units.length > 0 && (
                    <div className={cn(
                      "min-w-0",
                      sidecarData.units.length === 1 ? "flex-[1.2]" : "flex-[2]"
                    )}>
                      <SidecarMockup units={sidecarData.units} />
                    </div>
                  )}
                </div>
              </div>

              {/* Edit popover (positioned inside the mockup container) */}
              {editTarget && editAnchor && (
                <DesignerEditPopover
                  target={editTarget}
                  anchor={editAnchor}
                  parsedEntries={parsedEntries}
                  onFieldChange={handlePopoverFieldChange}
                  onClose={closeEditPopover}
                />
              )}
            </div>

            {/* Drag handle */}
            <div
              className="group relative w-1.5 shrink-0 cursor-col-resize hover:bg-accent/30 active:bg-accent/40 transition-smooth"
              onMouseDown={handleResizeStart}
            >
              <div className="absolute inset-y-0 left-0 w-px bg-border" />
              <div className="absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/20 group-hover:bg-foreground/30 transition-smooth" />
            </div>
          </>
        )}

        {/* Monaco Editor */}
        <div ref={editorContainerRef} className="flex-1 min-h-0 min-w-0 relative">
          <Editor
            height="100%"
            language="ini"
            theme={MONACO_THEME_NAME}
            beforeMount={defineSipalyzerTheme}
            defaultValue=""
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

        {/* Parameter Panel (collapsible) */}
        {showPanel && (
          <div className="surface-flat flex w-80 shrink-0 flex-col rounded-md border-l border-border/60 min-h-0">
            <ParameterPanel
              cursorKey={cursorKey}
              panelFilter={panelFilter}
              onPanelFilterChange={setPanelFilter}
              onInsertKey={insertAtCursor}
            />
          </div>
        )}
      </div>

      {/* ── Paste Dialog ── */}
      {pasteOpen && (
        <PasteDialog
          open={true}
          onClose={() => setPasteOpen(false)}
          onApply={(text) => {
            setEditorText(text);
            setSidecarUserToggled(false);
          }}
        />
      )}

      {/* ── Insert Dialog ── */}
      {insertOpen && (
        <ParameterInsertDialog
          open={true}
          onClose={() => setInsertOpen(false)}
          onInsert={(line) => {
            insertAtCursor(line);
          }}
        />
      )}

      {/* ── Indexed Parameter Widget ── */}
      {activeGroup && widgetAnchor && (
        <IndexedParameterWidget
          group={activeGroup}
          instances={groupInstances}
          anchorPosition={widgetAnchor}
          onFieldChange={handleWidgetFieldChange}
          onAddInstance={handleWidgetAddInstance}
          onRemoveInstance={handleWidgetRemoveInstance}
          onClose={closeWidget}
        />
      )}
    </div>
  );
}
