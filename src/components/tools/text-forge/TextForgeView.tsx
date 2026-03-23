import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { AppDivider, PanelResizeHandle } from "@/components/ui/panel-chrome";
import { useToastContext } from "@/contexts/ToastContext";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Edit,
  Eraser,
  GitCompareArrows,
  Plus,
  Redo,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Undo,
  X,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { runTextForge, type TextForgeMetrics, type TextForgeRule } from "@/components/tools/text-forge/textForgeEngine";
import { CaptureTabRail } from "@/components/packet-capture/shared/CaptureTabRail";
import {
  CAPTURE_TAB_PILL_ACTIVE_CLASS,
  CAPTURE_TAB_PILL_BASE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS,
  CAPTURE_TAB_PILL_INACTIVE_CLASS,
} from "@/components/packet-capture/shared/tabPillStyles";
import { TextForgeChainBar } from "@/components/tools/text-forge/TextForgeChainBar";
import { TextForgeDiffScroll } from "@/components/tools/text-forge/textForgeLineDiff";
import { TextForgeRegexWikiModal } from "@/components/tools/text-forge/TextForgeRegexWikiModal";

type RuleType = TextForgeRule["type"];
type RuleCategory = "popular" | "case" | "sort" | "cleanup" | "numbers" | "advanced";
type RunMode = "manual" | "auto";

interface RuleDefinition {
  type: RuleType;
  label: string;
  description: string;
  category: RuleCategory;
}

interface RuleRow {
  id: string;
  enabled: boolean;
  rule: TextForgeRule;
}

interface ExecutionEntry {
  id: string;
  at: number;
  mode: RunMode;
  ms: number;
  activeRules: number;
}

interface UndoSnapshot {
  input: string;
  rules: RuleRow[];
}

interface Workspace {
  id: string;
  name: string;
  input: string;
  output: string;
  rules: RuleRow[];
  metrics: TextForgeMetrics;
  autoRun: boolean;
  catalogQuery: string;
  history: ExecutionEntry[];
  lastRunAt: number | null;
  lastRunMs: number | null;
  undoPast: UndoSnapshot[];
  undoFuture: UndoSnapshot[];
}

const DEFAULT_INPUT = "alpha-22\ncharlie-8\nbeta-100\nzeta-1";
const MAX_HISTORY = 12;
const MAX_UNDO = 40;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 300;
const CATALOG_PANEL_MIN = 100;
const PIPELINE_PANEL_MIN = 100;
const CATALOG_HANDLE_RESERVE = 10;
const CATALOG_PANEL_DEFAULT = 260;

const CATEGORIES: Array<{ id: RuleCategory; label: string }> = [
  { id: "popular", label: "Popular" },
  { id: "case", label: "Case" },
  { id: "sort", label: "Sort" },
  { id: "cleanup", label: "Cleanup" },
  { id: "numbers", label: "Numbers" },
  { id: "advanced", label: "Advanced" },
];

const RULES: RuleDefinition[] = [
  { type: "trimExtraSpaces", label: "Trim Spaces", description: "Normalize spaces per line.", category: "popular" },
  { type: "findReplace", label: "Find + Replace", description: "Replace text with case control.", category: "popular" },
  { type: "sortAlpha", label: "Sort A-Z", description: "Sort lines or tokens alphabetically.", category: "popular" },
  { type: "toUppercase", label: "Uppercase", description: "Convert all letters to uppercase.", category: "case" },
  { type: "toLowercase", label: "Lowercase", description: "Convert all letters to lowercase.", category: "case" },
  { type: "toTitleCase", label: "Title Case", description: "Capitalize words.", category: "case" },
  { type: "sortNumeric", label: "Sort Numeric", description: "Sort by numeric value.", category: "sort" },
  { type: "sortByLength", label: "Sort by Length", description: "Sort by token or line length.", category: "sort" },
  { type: "sortIpAddresses", label: "Sort IPs", description: "Sort IPv4 lines numerically.", category: "sort" },
  { type: "groupByFirstCharacter", label: "Group First", description: "Group lines by first character.", category: "sort" },
  { type: "groupByLastCharacter", label: "Group Last", description: "Group lines by last character.", category: "sort" },
  { type: "removeEmptyLines", label: "Remove Empty Lines", description: "Drop blank lines.", category: "cleanup" },
  { type: "dedupeLines", label: "Dedupe Lines", description: "Keep first unique line.", category: "cleanup" },
  { type: "dedupeTokens", label: "Dedupe Tokens", description: "Keep first unique token.", category: "cleanup" },
  { type: "trimLines", label: "Trim Lines", description: "Trim each line.", category: "cleanup" },
  { type: "removePunctuation", label: "Remove Punctuation", description: "Remove punctuation symbols.", category: "cleanup" },
  { type: "removeNonAscii", label: "Remove Non-ASCII", description: "Keep ASCII only.", category: "cleanup" },
  { type: "removeDiacritics", label: "Remove Diacritics", description: "Normalize accented chars.", category: "cleanup" },
  { type: "keepOnlyNumbers", label: "Keep Numbers", description: "Retain only digits.", category: "numbers" },
  { type: "extractNumbers", label: "Extract Numbers", description: "Extract numbers to lines.", category: "numbers" },
  { type: "keepOnlyLetters", label: "Keep Letters", description: "Retain only letters.", category: "numbers" },
  { type: "keepAlphaNumeric", label: "Keep Alphanumeric", description: "Retain letters+digits.", category: "numbers" },
  { type: "moveNumbersToStart", label: "Numbers First", description: "Move numbers before letters in token.", category: "numbers" },
  { type: "moveLettersToStart", label: "Letters First", description: "Move letters before numbers in token.", category: "numbers" },
  { type: "slugify", label: "Slugify", description: "Create URL-safe slug.", category: "advanced" },
  { type: "extractEmails", label: "Extract Emails", description: "Extract unique emails.", category: "advanced" },
  { type: "extractUrls", label: "Extract URLs", description: "Extract unique URLs.", category: "advanced" },
  { type: "urlEncode", label: "URL Encode", description: "Encode URI component.", category: "advanced" },
  { type: "urlDecode", label: "URL Decode", description: "Decode URI component.", category: "advanced" },
  { type: "base64Encode", label: "Base64 Encode", description: "Encode text as base64.", category: "advanced" },
  { type: "base64Decode", label: "Base64 Decode", description: "Decode base64 text.", category: "advanced" },
  { type: "htmlEscape", label: "HTML Escape", description: "Escape HTML entities.", category: "advanced" },
  { type: "htmlUnescape", label: "HTML Unescape", description: "Decode HTML entities.", category: "advanced" },
  { type: "csvToLines", label: "CSV to Lines", description: "Convert CSV row to lines.", category: "advanced" },
  { type: "linesToCsv", label: "Lines to CSV", description: "Convert lines to CSV row.", category: "advanced" },
  { type: "lineNumbering", label: "Line Numbering", description: "Add line numbers.", category: "advanced" },
  {
    type: "regexReplace",
    label: "Regex replace",
    description: "Replace using a JavaScript regular expression and replacement string.",
    category: "advanced",
  },
];

function defaultRule(type: RuleType): TextForgeRule {
  switch (type) {
    case "sortAlpha":
    case "sortNumeric":
    case "sortByLength":
      return { type, by: "lines", order: "asc" };
    case "sortIpAddresses":
      return { type, order: "asc" };
    case "findReplace":
      return { type, find: "", replaceWith: "", caseSensitive: false };
    case "regexReplace":
      return { type, pattern: "", replacement: "", flags: "g" };
    case "lineNumbering":
      return { type, startAt: 1 };
    case "collapseBlankLines":
      return { type, maxConsecutive: 1 };
    case "addPrefixSuffixLines":
    case "wrapLines":
      return { type, prefix: "", suffix: "" };
    case "padLines":
      return { type, direction: "right", width: 12, char: " " };
    default:
      return { type } as TextForgeRule;
  }
}

function snapRules(rules: RuleRow[]): RuleRow[] {
  return structuredClone(rules);
}

function pushUndo(w: Workspace): Workspace {
  const shot: UndoSnapshot = { input: w.input, rules: snapRules(w.rules) };
  return {
    ...w,
    undoPast: [...w.undoPast, shot].slice(-MAX_UNDO),
    undoFuture: [],
  };
}

function applyUndo(w: Workspace): Workspace | null {
  if (w.undoPast.length === 0) return null;
  const prev = w.undoPast[w.undoPast.length - 1]!;
  const tail = w.undoPast.slice(0, -1);
  const currentShot: UndoSnapshot = { input: w.input, rules: snapRules(w.rules) };
  const next: Workspace = {
    ...w,
    input: prev.input,
    rules: prev.rules,
    undoPast: tail,
    undoFuture: [currentShot, ...w.undoFuture].slice(0, MAX_UNDO),
  };
  return runWorkspace(next, next.autoRun ? "auto" : "manual");
}

function applyRedo(w: Workspace): Workspace | null {
  if (w.undoFuture.length === 0) return null;
  const nxt = w.undoFuture[0]!;
  const rest = w.undoFuture.slice(1);
  const currentShot: UndoSnapshot = { input: w.input, rules: snapRules(w.rules) };
  const next: Workspace = {
    ...w,
    input: nxt.input,
    rules: nxt.rules,
    undoPast: [...w.undoPast, currentShot].slice(-MAX_UNDO),
    undoFuture: rest,
  };
  return runWorkspace(next, next.autoRun ? "auto" : "manual");
}

function createWorkspace(index: number): Workspace {
  const base: Workspace = {
    id: crypto.randomUUID(),
    name: `Workspace ${index}`,
    input: "",
    output: "",
    rules: [
      { id: crypto.randomUUID(), enabled: true, rule: defaultRule("trimExtraSpaces") },
      { id: crypto.randomUUID(), enabled: true, rule: defaultRule("sortAlpha") },
    ],
    metrics: runTextForge("", []).metrics,
    autoRun: true,
    catalogQuery: "",
    history: [],
    lastRunAt: null,
    lastRunMs: null,
    undoPast: [],
    undoFuture: [],
  };
  return runWorkspace(base, "auto");
}

function fmtTime(ts: number | null): string {
  if (!ts) return "Never";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(ts);
}

function runWorkspace(workspace: Workspace, mode: RunMode): Workspace {
  const activeRules = workspace.rules.filter((item) => item.enabled).map((item) => item.rule);
  const start = performance.now();
  const result = runTextForge(workspace.input, activeRules);
  const ms = Math.max(1, Math.round(performance.now() - start));
  const entry: ExecutionEntry = {
    id: crypto.randomUUID(),
    at: Date.now(),
    mode,
    ms,
    activeRules: activeRules.length,
  };
  return {
    ...workspace,
    output: result.text,
    metrics: result.metrics,
    lastRunAt: entry.at,
    lastRunMs: ms,
    history: [entry, ...workspace.history].slice(0, MAX_HISTORY),
  };
}

function ruleSummaryLabel(row: RuleRow): string {
  const base = RULES.find((r) => r.type === row.rule.type)?.label ?? row.rule.type;
  if (row.rule.type === "sortAlpha" || row.rule.type === "sortNumeric" || row.rule.type === "sortByLength") {
    return `${base} (${row.rule.by})`;
  }
  if (row.rule.type === "sortIpAddresses") {
    return `${base} (${row.rule.order})`;
  }
  if (row.rule.type === "regexReplace") {
    const p = row.rule.pattern.trim() || "—";
    const short = p.length > 20 ? `${p.slice(0, 18)}…` : p;
    return `${base} (${short})`;
  }
  return base;
}

export function TextForgeView() {
  const toast = useToastContext();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([createWorkspace(1)]);
  const [activeId, setActiveId] = useState<string>("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const ignoreRenameBlurRef = useRef(false);
  const [diffMode, setDiffMode] = useState(false);
  const [sidebarPx, setSidebarPx] = useState(SIDEBAR_DEFAULT);
  const [catalogPanelPx, setCatalogPanelPx] = useState(CATALOG_PANEL_DEFAULT);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const catalogDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const asideRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const [regexWikiOpen, setRegexWikiOpen] = useState(false);
  const [collapsedCatalogCategories, setCollapsedCatalogCategories] = useState<Set<RuleCategory>>(
    () => new Set(CATEGORIES.map((c) => c.id)),
  );

  const toggleCatalogCategoryCollapse = useCallback((id: RuleCategory) => {
    setCollapsedCatalogCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    setActiveId((current) => current || workspaces[0]?.id || "");
  }, [workspaces]);

  useEffect(() => {
    if (activeId && !workspaces.some((w) => w.id === activeId)) {
      setActiveId(workspaces[0]?.id ?? "");
    }
  }, [workspaces, activeId]);

  const active = useMemo(
    () => workspaces.find((item) => item.id === activeId) ?? workspaces[0] ?? null,
    [workspaces, activeId],
  );

  const updateActive = useCallback(
    (updater: (w: Workspace) => Workspace, auto = false) => {
      setWorkspaces((prev) =>
        prev.map((w) => {
          if (w.id !== activeId) return w;
          const next = updater(w);
          if (!auto || !next.autoRun) return next;
          return runWorkspace(next, "auto");
        }),
      );
    },
    [activeId],
  );

  const mutateWithUndo = useCallback(
    (mutator: (w: Workspace) => Workspace, runAfter = true) => {
      setWorkspaces((prev) =>
        prev.map((w) => {
          if (w.id !== activeId) return w;
          const stamped = pushUndo(w);
          let next = mutator(stamped);
          if (runAfter) {
            next = runWorkspace(next, next.autoRun ? "auto" : "manual");
          }
          return next;
        }),
      );
    },
    [activeId],
  );

  const addWorkspace = useCallback(() => {
    const w = createWorkspace(workspaces.length + 1);
    setWorkspaces((prev) => [...prev, w]);
    setActiveId(w.id);
  }, [workspaces.length]);

  const closeWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const runNow = useCallback(() => {
    if (!active) return;
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== activeId) return w;
        const next = runWorkspace(w, "manual");
        return next;
      }),
    );
    const count = active.rules.filter((r) => r.enabled).length;
    toast.success("Pipeline applied", `${count} active rule${count === 1 ? "" : "s"} executed.`);
  }, [active, activeId, toast]);

  const addRule = useCallback(
    (type: RuleType) => {
      mutateWithUndo((w) => ({
        ...w,
        rules: [...w.rules, { id: crypto.randomUUID(), enabled: true, rule: defaultRule(type) }],
      }));
    },
    [mutateWithUndo],
  );

  const flipPanes = useCallback(() => {
    mutateWithUndo((w) => ({ ...w, input: w.output }));
  }, [mutateWithUndo]);

  const copyOutput = useCallback(() => {
    if (!active?.output.trim()) {
      toast.warning("Nothing to copy", "Run the pipeline first.");
      return;
    }
    void navigator.clipboard.writeText(active.output);
    toast.info("Copied", "Output copied to clipboard.");
  }, [active, toast]);

  const clearInput = useCallback(() => {
    mutateWithUndo((w) => ({ ...w, input: "" }));
  }, [mutateWithUndo]);

  const exportOutput = useCallback(() => {
    if (!active) return;
    const blob = new Blob([active.output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "text-forge-output.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [active]);

  const updateRule = useCallback(
    (ruleId: string, updater: (rule: TextForgeRule) => TextForgeRule) => {
      mutateWithUndo((w) => ({
        ...w,
        rules: w.rules.map((item) =>
          item.id === ruleId ? { ...item, rule: updater(item.rule) } : item,
        ),
      }));
    },
    [mutateWithUndo],
  );

  const doUndo = useCallback(() => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== activeId) return w;
        return applyUndo(w) ?? w;
      }),
    );
  }, [activeId]);

  const doRedo = useCallback(() => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== activeId) return w;
        return applyRedo(w) ?? w;
      }),
    );
  }, [activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        commandInputRef.current?.focus();
        commandInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragRef.current.startW + dx));
      setSidebarPx(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!catalogDragRef.current || !asideRef.current) return;
      const dy = e.clientY - catalogDragRef.current.startY;
      const rect = asideRef.current.getBoundingClientRect();
      const innerMax = Math.max(0, rect.height - CATALOG_HANDLE_RESERVE - PIPELINE_PANEL_MIN);
      const lo = Math.min(CATALOG_PANEL_MIN, innerMax);
      const next = Math.min(innerMax, Math.max(lo, catalogDragRef.current.startH + dy));
      setCatalogPanelPx(next);
    };
    const onUp = () => {
      catalogDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const clamp = () => {
      const rect = el.getBoundingClientRect();
      const innerMax = Math.max(0, rect.height - CATALOG_HANDLE_RESERVE - PIPELINE_PANEL_MIN);
      const lo = Math.min(CATALOG_PANEL_MIN, innerMax);
      setCatalogPanelPx((h) => Math.min(innerMax, Math.max(lo, h)));
    };
    const ro = new ResizeObserver(() => clamp());
    ro.observe(el);
    clamp();
    return () => ro.disconnect();
  }, []);

  const q = active ? active.catalogQuery.trim().toLowerCase() : "";
  const searchMatches = useMemo(() => {
    if (!q) return [] as RuleDefinition[];
    return RULES.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q),
    );
  }, [q]);

  if (!active) return null;

  const activeRuleCount = active.rules.filter((r) => r.enabled).length;
  const ruleOptions = useMemo(
    () => Array.from(new Map(RULES.map((entry) => [entry.type, entry.label])).entries()),
    [],
  );

  const canUndo = active.undoPast.length > 0;
  const canRedo = active.undoFuture.length > 0;

  const gutterBtn =
    "h-9 w-9 shrink-0 rounded-md border border-border/35 bg-background/30 hover:bg-muted/25 transition-smooth flex items-center justify-center text-muted-foreground hover:text-foreground";

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-lg bg-muted/[0.08]">
      <div className="shrink-0 px-1.5 pt-1.5">
        <div className="ui-surface-card p-2">
          <CaptureTabRail
            items={workspaces}
            getKey={(w) => w.id}
            beforeRightArrow={
              <Button variant="neutral" size="sm" className="h-[1.88rem] px-2 mr-[2px] shrink-0 text-xs" onClick={addWorkspace}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                New
              </Button>
            }
            renderItem={(w) => {
              const isActive = w.id === active.id;
              const isRenaming = renameId === w.id;

              const commitRename = () => {
                const name = renameDraft.trim();
                if (name) {
                  setWorkspaces((prev) => prev.map((item) => (item.id === w.id ? { ...item, name } : item)));
                }
                setRenameId(null);
              };

              return (
                <div className="flex items-center">
                  {isRenaming ? (
                    <Input
                      value={renameDraft}
                      className="h-[1.88rem] w-[min(240px,55vw)] ui-control-shell text-xs mr-1"
                      autoFocus
                      aria-label="Workspace name"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => {
                        if (ignoreRenameBlurRef.current) {
                          ignoreRenameBlurRef.current = false;
                          return;
                        }
                        commitRename();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          ignoreRenameBlurRef.current = true;
                          setRenameId(null);
                        }
                      }}
                    />
                  ) : (
                    <div
                      className={cn(
                        CAPTURE_TAB_PILL_BASE_CLASS,
                        isActive ? CAPTURE_TAB_PILL_ACTIVE_CLASS : CAPTURE_TAB_PILL_INACTIVE_CLASS,
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 max-w-[min(120px,28vw)] truncate text-left font-semibold bg-transparent border-0 p-0 text-inherit cursor-pointer rounded-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                        onClick={() => setActiveId(w.id)}
                        onDoubleClick={() => {
                          setRenameId(w.id);
                          setRenameDraft(w.name);
                        }}
                        title="Switch workspace · Double-click to rename"
                      >
                        {w.name}
                      </button>
                      <TooltipWrapper content="Rename workspace">
                        <button
                          type="button"
                          className={cn(
                            CAPTURE_TAB_PILL_CLOSE_CLASS,
                            isActive ? CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS : CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS,
                          )}
                          aria-label={`Rename “${w.name}”`}
                          onClick={() => {
                            setRenameId(w.id);
                            setRenameDraft(w.name);
                          }}
                        >
                          <Edit className="h-2.5 w-2.5" />
                        </button>
                      </TooltipWrapper>
                      <TooltipWrapper content="Close workspace">
                        <button
                          type="button"
                          className={cn(
                            CAPTURE_TAB_PILL_CLOSE_CLASS,
                            isActive ? CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS : CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS,
                          )}
                          aria-label={`Close “${w.name}”`}
                          onClick={() => closeWorkspace(w.id)}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </TooltipWrapper>
                    </div>
                  )}
                </div>
              );
            }}
          />

          <div className="px-1 pt-2 flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
            <div className="flex min-h-8 min-w-0 flex-1 basis-[min(100%,14rem)] items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                ref={commandInputRef}
                value={active.catalogQuery}
                onChange={(e) => updateActive((w) => ({ ...w, catalogQuery: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !searchMatches[0]) return;
                  e.preventDefault();
                  addRule(searchMatches[0].type);
                }}
                className="ui-control-shell h-8 min-w-0 flex-1 text-xs sm:max-w-md"
                placeholder="Search transforms… (⌘K)"
              />
              <label className="flex items-center gap-2 rounded-md border border-border/30 bg-background/25 px-2 py-1.5 shrink-0">
                <span className="text-2xs text-muted-foreground whitespace-nowrap">Auto-update</span>
                <Switch
                  size="sm"
                  checked={active.autoRun}
                  onCheckedChange={(checked) =>
                    setWorkspaces((prev) =>
                      prev.map((w) => {
                        if (w.id !== activeId) return w;
                        const next = { ...w, autoRun: checked };
                        return checked ? runWorkspace(next, "auto") : next;
                      }),
                    )
                  }
                />
              </label>
            </div>
            <div className="flex min-h-8 shrink-0 items-center justify-end gap-2">
              {!active.autoRun ? (
                <Button size="sm" className="h-8 gap-1.5 shrink-0" onClick={runNow}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Run
                </Button>
              ) : null}
              <Button variant="neutral" size="sm" className="h-8 gap-1.5 shrink-0" onClick={exportOutput}>
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
              <Button
                variant="neutral"
                size="sm"
                className="h-8 gap-1.5 shrink-0"
                onClick={() => mutateWithUndo((w) => ({ ...w, input: DEFAULT_INPUT, rules: w.rules.slice(0, 2) }))}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex px-1.5 pb-0 pt-1.5 gap-0">
        <aside
          ref={asideRef}
          className="shrink-0 flex flex-col min-h-0 min-w-0 border border-border/25 rounded-lg bg-background/15 overflow-hidden"
          style={{ width: sidebarPx }}
        >
          <div
            className="shrink-0 flex flex-col min-h-0 px-2 pt-2"
            style={{ height: catalogPanelPx }}
          >
            <div className="text-2xs text-muted-foreground mb-1.5 shrink-0">Catalog</div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/50 bg-card/50 shadow-card">
              {q ? (
                <div>
                  <div className="border-b border-border bg-muted/30 px-3 py-2">
                    <span className="text-xs font-medium">All matches</span>
                    <span className="text-2xs text-muted-foreground tabular-nums ml-2">
                      {searchMatches.length}
                    </span>
                  </div>
                  <div className="divide-y divide-border/30">
                    {searchMatches.map((rule) => (
                      <TooltipWrapper key={`${rule.type}-${rule.label}`} content={rule.description}>
                        <button
                          type="button"
                          onClick={() => addRule(rule.type)}
                          className="flex w-full items-start px-3 py-2 text-left transition-smooth hover:bg-muted/30"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="text-xs font-medium text-foreground">{rule.label}</span>
                            <p className="text-2xs text-muted-foreground mt-0.5 leading-snug">{rule.description}</p>
                          </span>
                        </button>
                      </TooltipWrapper>
                    ))}
                  </div>
                </div>
              ) : (
                CATEGORIES.map((cat) => {
                  const rulesInCat = RULES.filter((r) => r.category === cat.id);
                  if (rulesInCat.length === 0) return null;
                  const isCollapsed = collapsedCatalogCategories.has(cat.id);
                  return (
                    <div key={cat.id}>
                      <TooltipWrapper
                        title={isCollapsed ? "Expand category" : "Collapse category"}
                        description={
                          isCollapsed ? "Show transforms in this category." : "Hide the list of transforms."
                        }
                      >
                        <button
                          type="button"
                          onClick={() => toggleCatalogCategoryCollapse(cat.id)}
                          className="flex w-full items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50 transition-smooth"
                        >
                          <span className="text-xs font-medium truncate">{cat.label}</span>
                          <span className="text-2xs tabular-nums text-muted-foreground shrink-0">
                            {rulesInCat.length}
                          </span>
                          <span className="min-w-0 flex-1" />
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                      </TooltipWrapper>
                      {!isCollapsed ? (
                        <div className="divide-y divide-border/30">
                          {rulesInCat.map((rule) => (
                            <TooltipWrapper key={`${rule.type}-${rule.label}`} content={rule.description}>
                              <button
                                type="button"
                                onClick={() => addRule(rule.type)}
                                className="flex w-full items-start px-3 py-2 text-left transition-smooth hover:bg-muted/30"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="text-xs font-medium text-foreground">{rule.label}</span>
                                  <p className="text-2xs text-muted-foreground mt-0.5 leading-snug">
                                    {rule.description}
                                  </p>
                                </span>
                              </button>
                            </TooltipWrapper>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <PanelResizeHandle
            as="div"
            orientation="horizontal"
            density="compact"
            appearance="rail"
            decor="none"
            label="Resize catalog and pipeline editor"
            className="w-full shrink-0 cursor-row-resize rounded-none"
            onMouseDown={(e) => {
              e.preventDefault();
              catalogDragRef.current = { startY: e.clientY, startH: catalogPanelPx };
              document.body.style.cursor = "row-resize";
              document.body.style.userSelect = "none";
            }}
          />

          <div className="flex-1 min-h-0 px-2 pb-2 pt-0 flex flex-col min-w-0">
            <div className="rounded-md border border-border/25 bg-background/20 p-1.5 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-1 shrink-0">
                <span className="text-2xs text-muted-foreground">Pipeline editor</span>
                <Badge variant="secondary" className="h-5 text-2xs">
                  {activeRuleCount}/{active.rules.length}
                </Badge>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-2">
                {active.rules.map((row, idx) => {
                  const canUp = idx > 0;
                  const canDown = idx < active.rules.length - 1;
                  const label = RULES.find((r) => r.type === row.rule.type)?.label ?? row.rule.type;
                  const findReplaceRule = row.rule.type === "findReplace" ? row.rule : null;
                  const regexReplaceRule = row.rule.type === "regexReplace" ? row.rule : null;
                  const sortRule =
                    row.rule.type === "sortAlpha" || row.rule.type === "sortNumeric" || row.rule.type === "sortByLength"
                      ? row.rule
                      : null;
                  const lineNumberingRule = row.rule.type === "lineNumbering" ? row.rule : null;
                  const prefixSuffixRule =
                    row.rule.type === "addPrefixSuffixLines" || row.rule.type === "wrapLines" ? row.rule : null;
                  const collapseBlankLinesRule = row.rule.type === "collapseBlankLines" ? row.rule : null;
                  const sortIpRule = row.rule.type === "sortIpAddresses" ? row.rule : null;
                  const padLinesRule = row.rule.type === "padLines" ? row.rule : null;
                  return (
                    <div
                      key={row.id}
                      className={cn(
                        "rounded-md border p-2 min-w-0",
                        row.enabled ? "border-primary/30 bg-primary/5" : "border-border/25 bg-muted/10",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Switch
                          size="sm"
                          checked={row.enabled}
                          onCheckedChange={() =>
                            mutateWithUndo((w) => ({
                              ...w,
                              rules: w.rules.map((item) =>
                                item.id === row.id ? { ...item, enabled: !item.enabled } : item,
                              ),
                            }))
                          }
                        />
                        <span className="text-xs font-medium truncate">{label}</span>
                      </div>

                      <div className="mt-1.5">
                        <select
                          value={row.rule.type}
                          onChange={(e) => {
                            const next = e.target.value as RuleType;
                            mutateWithUndo((w) => ({
                              ...w,
                              rules: w.rules.map((item) =>
                                item.id === row.id ? { ...item, rule: defaultRule(next) } : item,
                              ),
                            }));
                          }}
                          className="ui-control-shell h-7 text-2xs w-full"
                        >
                          {ruleOptions.map(([type, optionLabel]) => (
                            <option key={type} value={type}>
                              {optionLabel}
                            </option>
                          ))}
                        </select>
                      </div>

                      {findReplaceRule ? (
                        <div className="mt-1.5 space-y-1">
                          <Input
                            value={findReplaceRule.find}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "findReplace" ? { ...rule, find: e.target.value } : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs"
                            placeholder="Find text..."
                          />
                          <Input
                            value={findReplaceRule.replaceWith}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "findReplace" ? { ...rule, replaceWith: e.target.value } : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs"
                            placeholder="Replace with..."
                          />
                          <div className="subview-tabs-compact p-0.5">
                            {[
                              { id: "insensitive", label: "Aa", value: false },
                              { id: "sensitive", label: "aA", value: true },
                            ].map((mode) => (
                              <button
                                key={mode.id}
                                type="button"
                                className="subview-tab-compact text-3xs h-5 px-1.5"
                                data-state={findReplaceRule.caseSensitive === mode.value ? "active" : "inactive"}
                                onClick={() =>
                                  updateRule(row.id, (rule) =>
                                    rule.type === "findReplace" ? { ...rule, caseSensitive: mode.value } : rule,
                                  )
                                }
                              >
                                {mode.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {regexReplaceRule ? (
                        <div className="mt-1.5 space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-2xs text-muted-foreground">Pattern</span>
                            <TooltipWrapper content="Open regex reference (flags, groups, replacements)">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 gap-1 text-2xs text-muted-foreground hover:text-foreground"
                                onClick={() => setRegexWikiOpen(true)}
                              >
                                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                                Wiki
                              </Button>
                            </TooltipWrapper>
                          </div>
                          <Input
                            value={regexReplaceRule.pattern}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "regexReplace" ? { ...rule, pattern: e.target.value } : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs font-mono"
                            placeholder="Pattern (e.g. \\d+)"
                            spellCheck={false}
                          />
                          <Input
                            value={regexReplaceRule.replacement}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "regexReplace" ? { ...rule, replacement: e.target.value } : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs font-mono"
                            placeholder="Replacement (e.g. #$&)"
                            spellCheck={false}
                          />
                          <div className="flex items-center gap-1.5">
                            <span className="text-2xs text-muted-foreground shrink-0">Flags</span>
                            <Input
                              value={regexReplaceRule.flags}
                              onChange={(e) =>
                                updateRule(row.id, (rule) =>
                                  rule.type === "regexReplace" ? { ...rule, flags: e.target.value } : rule,
                                )
                              }
                              className="ui-control-shell h-6 text-2xs font-mono w-24"
                              placeholder="g, gi, …"
                              spellCheck={false}
                            />
                          </div>
                        </div>
                      ) : null}

                      {sortRule ? (
                        <div className="mt-1.5 flex gap-1">
                          <select
                            value={sortRule.by}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "sortAlpha" || rule.type === "sortNumeric" || rule.type === "sortByLength"
                                  ? { ...rule, by: e.target.value as "lines" | "tokens" }
                                  : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs"
                          >
                            <option value="lines">lines</option>
                            <option value="tokens">tokens</option>
                          </select>
                          <select
                            value={sortRule.order}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "sortAlpha" || rule.type === "sortNumeric" || rule.type === "sortByLength"
                                  ? { ...rule, order: e.target.value as "asc" | "desc" }
                                  : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs"
                          >
                            <option value="asc">asc</option>
                            <option value="desc">desc</option>
                          </select>
                        </div>
                      ) : null}

                      {lineNumberingRule ? (
                        <div className="mt-1.5">
                          <Input
                            value={lineNumberingRule.startAt}
                            onChange={(e) => {
                              const parsed = Number.parseInt(e.target.value, 10);
                              updateRule(row.id, (rule) =>
                                rule.type === "lineNumbering"
                                  ? { ...rule, startAt: Number.isFinite(parsed) ? parsed : 1 }
                                  : rule,
                              );
                            }}
                            className="ui-control-shell h-6 text-2xs w-20"
                            placeholder="Start #"
                          />
                        </div>
                      ) : null}

                      {prefixSuffixRule ? (
                        <div className="mt-1.5 space-y-1">
                          <Input
                            value={prefixSuffixRule.prefix}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "addPrefixSuffixLines" || rule.type === "wrapLines"
                                  ? { ...rule, prefix: e.target.value }
                                  : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs"
                            placeholder="Prefix..."
                          />
                          <Input
                            value={prefixSuffixRule.suffix}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "addPrefixSuffixLines" || rule.type === "wrapLines"
                                  ? { ...rule, suffix: e.target.value }
                                  : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs"
                            placeholder="Suffix..."
                          />
                        </div>
                      ) : null}

                      {collapseBlankLinesRule ? (
                        <div className="mt-1.5">
                          <Input
                            value={collapseBlankLinesRule.maxConsecutive ?? 1}
                            onChange={(e) => {
                              const parsed = Number.parseInt(e.target.value, 10);
                              updateRule(row.id, (rule) =>
                                rule.type === "collapseBlankLines"
                                  ? { ...rule, maxConsecutive: Number.isFinite(parsed) ? Math.max(0, parsed) : 1 }
                                  : rule,
                              );
                            }}
                            className="ui-control-shell h-6 text-2xs w-24"
                            placeholder="Max blanks"
                          />
                        </div>
                      ) : null}

                      {sortIpRule ? (
                        <div className="mt-1.5">
                          <select
                            value={sortIpRule.order}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "sortIpAddresses"
                                  ? { ...rule, order: e.target.value as "asc" | "desc" }
                                  : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs"
                          >
                            <option value="asc">asc</option>
                            <option value="desc">desc</option>
                          </select>
                        </div>
                      ) : null}

                      {padLinesRule ? (
                        <div className="mt-1.5 space-y-1">
                          <div className="flex gap-1">
                            <select
                              value={padLinesRule.direction}
                              onChange={(e) =>
                                updateRule(row.id, (rule) =>
                                  rule.type === "padLines"
                                    ? { ...rule, direction: e.target.value as "left" | "right" }
                                    : rule,
                                )
                              }
                              className="ui-control-shell h-6 text-2xs"
                            >
                              <option value="left">left</option>
                              <option value="right">right</option>
                            </select>
                            <Input
                              value={padLinesRule.width}
                              onChange={(e) => {
                                const parsed = Number.parseInt(e.target.value, 10);
                                updateRule(row.id, (rule) =>
                                  rule.type === "padLines"
                                    ? { ...rule, width: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 }
                                    : rule,
                                );
                              }}
                              className="ui-control-shell h-6 text-2xs w-16"
                              placeholder="w"
                            />
                          </div>
                          <Input
                            value={padLinesRule.char ?? " "}
                            onChange={(e) =>
                              updateRule(row.id, (rule) =>
                                rule.type === "padLines" ? { ...rule, char: e.target.value.slice(0, 1) } : rule,
                              )
                            }
                            className="ui-control-shell h-6 text-2xs w-16"
                            placeholder="char"
                          />
                        </div>
                      ) : null}

                      <div className="mt-2 flex items-center justify-end gap-1.5">
                        <Button
                          variant="neutral"
                          size="sm"
                          className="h-6 w-6 p-0"
                          disabled={!canUp}
                          onClick={() =>
                            mutateWithUndo((w) => {
                              if (!canUp) return w;
                              const next = [...w.rules];
                              const current = next[idx];
                              const previous = next[idx - 1];
                              if (!current || !previous) return w;
                              next[idx - 1] = current;
                              next[idx] = previous;
                              return { ...w, rules: next };
                            })
                          }
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="neutral"
                          size="sm"
                          className="h-6 w-6 p-0"
                          disabled={!canDown}
                          onClick={() =>
                            mutateWithUndo((w) => {
                              if (!canDown) return w;
                              const next = [...w.rules];
                              const current = next[idx];
                              const following = next[idx + 1];
                              if (!current || !following) return w;
                              next[idx] = following;
                              next[idx + 1] = current;
                              return { ...w, rules: next };
                            })
                          }
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() =>
                            mutateWithUndo((w) => ({
                              ...w,
                              rules: w.rules.filter((item) => item.id !== row.id),
                            }))
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <div className="flex flex-col items-center justify-stretch py-1 px-0.5 shrink-0">
          <PanelResizeHandle
            as="div"
            orientation="vertical"
            density="compact"
            appearance="rail"
            decor="none"
            label="Resize Text Forge sidebar"
            className="h-full min-h-[120px] cursor-col-resize"
            onMouseDown={(e) => {
              e.preventDefault();
              dragRef.current = { startX: e.clientX, startW: sidebarPx };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />
        </div>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 pr-1.5">
          <div className="shrink-0">
            <TextForgeChainBar
              rows={active.rules}
              getLabel={ruleSummaryLabel}
              onRemove={(id) =>
                mutateWithUndo((w) => ({
                  ...w,
                  rules: w.rules.filter((item) => item.id !== id),
                }))
              }
              onToggleEnabled={(id) =>
                mutateWithUndo((w) => ({
                  ...w,
                  rules: w.rules.map((item) =>
                    item.id === id ? { ...item, enabled: !item.enabled } : item,
                  ),
                }))
              }
            />
          </div>

          <div className="flex-1 min-h-0 ui-surface-card p-2">
            <div className="h-full grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] gap-2 min-h-0">
              <div className="rounded-lg border border-border/30 bg-background/20 p-2 min-h-0 flex flex-col">
                <div className="mb-2 flex items-center justify-between shrink-0">
                  <span className="section-label-sm">Input</span>
                  <Badge variant="secondary" className="h-5 text-2xs">
                    {active.input.length} chars
                  </Badge>
                </div>
                <Textarea
                  value={active.input}
                  onChange={(e) =>
                    updateActive((w) => ({ ...w, input: e.target.value }), active.autoRun)
                  }
                  className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                  spellCheck={false}
                />
              </div>

              <div className="flex flex-col items-center justify-center gap-1 py-2 min-h-0">
                <TooltipWrapper content="Swap: move output into input">
                  <button
                    type="button"
                    className="h-11 w-11 rounded-full border border-primary/40 bg-primary/10 hover:bg-primary/20 transition-smooth flex items-center justify-center shrink-0"
                    onClick={flipPanes}
                  >
                    <ArrowRightLeft className="h-4 w-4 text-primary" />
                  </button>
                </TooltipWrapper>
                <AppDivider orientation="horizontal" className="w-8" />
                <TooltipWrapper content="Diff: line changes vs input">
                  <button
                    type="button"
                    className={cn(gutterBtn, diffMode && "border-primary/50 bg-primary/15 text-primary")}
                    onClick={() => setDiffMode((d) => !d)}
                    aria-pressed={diffMode}
                  >
                    <GitCompareArrows className="h-4 w-4" />
                  </button>
                </TooltipWrapper>
                <TooltipWrapper content="Copy output">
                  <button type="button" className={gutterBtn} onClick={copyOutput}>
                    <Copy className="h-4 w-4" />
                  </button>
                </TooltipWrapper>
                <TooltipWrapper content="Clear input">
                  <button type="button" className={gutterBtn} onClick={clearInput}>
                    <Eraser className="h-4 w-4" />
                  </button>
                </TooltipWrapper>
                <AppDivider orientation="horizontal" className="w-8" />
                <TooltipWrapper content="Undo pipeline / pane actions">
                  <button type="button" className={gutterBtn} disabled={!canUndo} onClick={doUndo}>
                    <Undo className="h-4 w-4" />
                  </button>
                </TooltipWrapper>
                <TooltipWrapper content="Redo">
                  <button type="button" className={gutterBtn} disabled={!canRedo} onClick={doRedo}>
                    <Redo className="h-4 w-4" />
                  </button>
                </TooltipWrapper>
              </div>

              <div
                className={cn(
                  "rounded-lg border border-border/30 bg-background/20 p-2 min-h-0 flex flex-col",
                  diffMode && "ring-1 ring-primary/25",
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2 shrink-0">
                  <span className="section-label-sm">{diffMode ? "Diff" : "Output"}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="h-5 text-2xs">
                      {activeRuleCount} active
                    </Badge>
                  </div>
                </div>
                {diffMode ? (
                  <TextForgeDiffScroll before={active.input} after={active.output} className="min-h-0 flex-1" />
                ) : (
                  <Textarea value={active.output} readOnly className="min-h-0 flex-1 resize-none font-mono text-xs leading-5" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-1.5 pb-1.5 pt-1">
        <div className="ui-surface-card px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="h-5 text-2xs">
              Words {active.metrics.words}
            </Badge>
            <Badge variant="secondary" className="h-5 text-2xs">
              Chars {active.metrics.chars}
            </Badge>
            <Badge variant="secondary" className="h-5 text-2xs">
              Lines {active.metrics.lines}
            </Badge>
            <Badge variant="secondary" className="h-5 text-2xs">
              Numbers {active.metrics.numbers}
            </Badge>
            <span className="ml-auto text-2xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Last run: {fmtTime(active.lastRunAt)} ({active.lastRunMs ? `${active.lastRunMs}ms` : "--"})
            </span>
          </div>
        </div>
      </div>

      <TextForgeRegexWikiModal open={regexWikiOpen} onOpenChange={setRegexWikiOpen} />
    </div>
  );
}
