import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useToastContext } from "@/contexts/ToastContext";
import { ArrowDown, ArrowRightLeft, ArrowUp, Clock, Copy, Download, Plus, RefreshCw, RotateCcw, Search, Sparkles, Trash2, X } from "@/lib/icons";
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

interface Workspace {
  id: string;
  name: string;
  input: string;
  output: string;
  rules: RuleRow[];
  metrics: TextForgeMetrics;
  autoRun: boolean;
  category: RuleCategory;
  catalogQuery: string;
  history: ExecutionEntry[];
  lastRunAt: number | null;
  lastRunMs: number | null;
}

const DEFAULT_INPUT = "alpha-22\ncharlie-8\nbeta-100\nzeta-1";
const MAX_HISTORY = 12;

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

function createWorkspace(index: number): Workspace {
  return {
    id: crypto.randomUUID(),
    name: `Workspace ${index}`,
    input: DEFAULT_INPUT,
    output: "",
    rules: [
      { id: crypto.randomUUID(), enabled: true, rule: defaultRule("trimExtraSpaces") },
      { id: crypto.randomUUID(), enabled: true, rule: defaultRule("sortAlpha") },
    ],
    metrics: runTextForge(DEFAULT_INPUT, []).metrics,
    autoRun: true,
    category: "popular",
    catalogQuery: "",
    history: [],
    lastRunAt: null,
    lastRunMs: null,
  };
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

export function TextForgeView() {
  const toast = useToastContext();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([createWorkspace(1)]);
  const [activeId, setActiveId] = useState<string>("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    setActiveId((current) => current || workspaces[0]?.id || "");
  }, [workspaces]);

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
          return auto && next.autoRun ? runWorkspace(next, "auto") : next;
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
    setActiveId((current) => {
      if (current !== id) return current;
      const remaining = workspaces.filter((item) => item.id !== id);
      return remaining[0]?.id ?? "";
    });
  }, [workspaces]);

  const runNow = useCallback(() => {
    if (!active) return;
    updateActive((w) => runWorkspace(w, "manual"));
    const count = active.rules.filter((r) => r.enabled).length;
    toast.success("Pipeline applied", `${count} active rule${count === 1 ? "" : "s"} executed.`);
  }, [active, updateActive, toast]);

  const addRule = useCallback((type: RuleType) => {
    updateActive((w) => ({
      ...w,
      rules: [...w.rules, { id: crypto.randomUUID(), enabled: true, rule: defaultRule(type) }],
    }), true);
  }, [updateActive]);

  const flipPanes = useCallback(() => {
    updateActive((w) => ({ ...w, input: w.output, output: w.input }), true);
  }, [updateActive]);

  const copyOutput = useCallback(() => {
    if (!active?.output.trim()) {
      toast.warning("Nothing to copy", "Run the pipeline first.");
      return;
    }
    navigator.clipboard.writeText(active.output);
    toast.info("Copied", "Output copied to clipboard.");
  }, [active, toast]);

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
      updateActive((w) => ({
        ...w,
        rules: w.rules.map((item) =>
          item.id === ruleId ? { ...item, rule: updater(item.rule) } : item,
        ),
      }), true);
    },
    [updateActive],
  );

  if (!active) return null;

  const catalog = RULES.filter(
    (r) =>
      r.category === active.category &&
      (!active.catalogQuery.trim() ||
        r.label.toLowerCase().includes(active.catalogQuery.toLowerCase()) ||
        r.type.toLowerCase().includes(active.catalogQuery.toLowerCase())),
  );

  const activeRuleCount = active.rules.filter((r) => r.enabled).length;
  const ruleOptions = useMemo(
    () => Array.from(new Map(RULES.map((entry) => [entry.type, entry.label])).entries()),
    [],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-lg bg-muted/[0.08]">
      <div className="px-1.5 pt-1.5">
        <div className="ui-surface-card p-2">
          <div className="flex items-center justify-between gap-2 px-1 pb-2 border-b border-border/25">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Text Forge</span>
              <span className="text-2xs text-muted-foreground">Text Manipulation Workbench</span>
            </div>
            <Badge variant="outline" className="h-5 text-2xs">{workspaces.length} workspaces</Badge>
          </div>

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
              return (
                <div className="flex items-center">
                  {isRenaming ? (
                    <Input
                      value={renameDraft}
                      className="h-[1.88rem] w-[180px] ui-control-shell text-xs mr-1"
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => {
                        const name = renameDraft.trim();
                        if (name) {
                          setWorkspaces((prev) => prev.map((item) => (item.id === w.id ? { ...item, name } : item)));
                        }
                        setRenameId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={cn(
                        CAPTURE_TAB_PILL_BASE_CLASS,
                        isActive ? CAPTURE_TAB_PILL_ACTIVE_CLASS : CAPTURE_TAB_PILL_INACTIVE_CLASS,
                      )}
                      onClick={() => setActiveId(w.id)}
                      onDoubleClick={() => {
                        setRenameId(w.id);
                        setRenameDraft(w.name);
                      }}
                    >
                      <span className="min-w-0 flex-1 max-w-[150px] truncate">{w.name}</span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          closeWorkspace(w.id);
                        }}
                        className={cn(
                          CAPTURE_TAB_PILL_CLOSE_CLASS,
                          isActive ? CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS : CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS,
                        )}
                      >
                        <X className="h-2.5 w-2.5" />
                      </span>
                    </button>
                  )}
                </div>
              );
            }}
          />

          <div className="px-1 pt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-8 gap-1.5" onClick={runNow}>
              <RefreshCw className="h-3.5 w-3.5" />
              Run
            </Button>
            <label className="flex items-center gap-2 rounded-md border border-border/30 bg-background/25 px-2 py-1.5">
              <span className="text-2xs text-muted-foreground">Auto-run</span>
              <Switch size="sm" checked={active.autoRun} onCheckedChange={(checked) => updateActive((w) => ({ ...w, autoRun: checked }))} />
            </label>
            <Button variant="neutral" size="sm" className="h-8 gap-1.5" onClick={copyOutput}>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            <Button variant="neutral" size="sm" className="h-8 gap-1.5" onClick={exportOutput}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
            <Button
              variant="neutral"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => updateActive((w) => ({ ...w, input: DEFAULT_INPUT, output: "", rules: w.rules.slice(0, 2) }))}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            <div className="ml-auto flex items-center gap-2 min-w-[260px]">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={active.catalogQuery}
                onChange={(e) => updateActive((w) => ({ ...w, catalogQuery: e.target.value }))}
                className="ui-control-shell h-8 text-xs"
                placeholder="Search tools..."
              />
            </div>
          </div>

          <div className="px-1 pt-2">
            <div className="subview-tabs-compact flex-wrap">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className="subview-tab-compact text-2xs"
                  data-state={active.category === cat.id ? "active" : "inactive"}
                  onClick={() => updateActive((w) => ({ ...w, category: cat.id }))}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-1 pt-2">
            <div className="rounded-md border border-border/25 bg-background/20 p-1.5">
              <div className="flex flex-wrap gap-1">
                {catalog.map((rule) => (
                  <TooltipWrapper key={`${rule.type}-${rule.label}`} content={rule.description}>
                    <button
                      type="button"
                      className="subview-tab-compact text-2xs"
                      onClick={() => addRule(rule.type)}
                    >
                      {rule.label}
                    </button>
                  </TooltipWrapper>
                ))}
              </div>
            </div>
          </div>

          <div className="px-1 pt-2">
            <div className="rounded-md border border-border/25 bg-background/20 p-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-2xs text-muted-foreground">Pipeline</span>
                <Badge variant="outline" className="h-5 text-2xs">{activeRuleCount}/{active.rules.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {active.rules.map((row, idx) => {
                  const canUp = idx > 0;
                  const canDown = idx < active.rules.length - 1;
                  const label = RULES.find((r) => r.type === row.rule.type)?.label ?? row.rule.type;
                  const findReplaceRule = row.rule.type === "findReplace" ? row.rule : null;
                  const sortRule = row.rule.type === "sortAlpha" || row.rule.type === "sortNumeric" || row.rule.type === "sortByLength"
                    ? row.rule
                    : null;
                  const lineNumberingRule = row.rule.type === "lineNumbering" ? row.rule : null;
                  const prefixSuffixRule = row.rule.type === "addPrefixSuffixLines" || row.rule.type === "wrapLines"
                    ? row.rule
                    : null;
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
                          onCheckedChange={(checked) =>
                            updateActive((w) => ({
                              ...w,
                              rules: w.rules.map((item) => (item.id === row.id ? { ...item, enabled: checked } : item)),
                            }), true)
                          }
                        />
                        <span className="text-xs font-medium truncate">{label}</span>
                      </div>

                      <div className="mt-1.5">
                        <select
                          value={row.rule.type}
                          onChange={(e) => {
                            const next = e.target.value as RuleType;
                            updateActive((w) => ({
                              ...w,
                              rules: w.rules.map((item) => (item.id === row.id ? { ...item, rule: defaultRule(next) } : item)),
                            }), true);
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
                            onChange={(e) => updateRule(row.id, (rule) => (
                              rule.type === "findReplace" ? { ...rule, find: e.target.value } : rule
                            ))}
                            className="ui-control-shell h-6 text-2xs"
                            placeholder="Find text..."
                          />
                          <Input
                            value={findReplaceRule.replaceWith}
                            onChange={(e) => updateRule(row.id, (rule) => (
                              rule.type === "findReplace" ? { ...rule, replaceWith: e.target.value } : rule
                            ))}
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
                                onClick={() => updateRule(row.id, (rule) => (
                                  rule.type === "findReplace" ? { ...rule, caseSensitive: mode.value } : rule
                                ))}
                              >
                                {mode.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {sortRule ? (
                        <div className="mt-1.5 flex gap-1">
                          <select
                            value={sortRule.by}
                            onChange={(e) => updateRule(row.id, (rule) => (
                              rule.type === "sortAlpha" || rule.type === "sortNumeric" || rule.type === "sortByLength"
                                ? { ...rule, by: e.target.value as "lines" | "tokens" }
                                : rule
                            ))}
                            className="ui-control-shell h-6 text-2xs"
                          >
                            <option value="lines">lines</option>
                            <option value="tokens">tokens</option>
                          </select>
                          <select
                            value={sortRule.order}
                            onChange={(e) => updateRule(row.id, (rule) => (
                              rule.type === "sortAlpha" || rule.type === "sortNumeric" || rule.type === "sortByLength"
                                ? { ...rule, order: e.target.value as "asc" | "desc" }
                                : rule
                            ))}
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
                              updateRule(row.id, (rule) => (
                                rule.type === "lineNumbering" ? { ...rule, startAt: Number.isFinite(parsed) ? parsed : 1 } : rule
                              ));
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
                            onChange={(e) => updateRule(row.id, (rule) => (
                              rule.type === "addPrefixSuffixLines" || rule.type === "wrapLines"
                                ? { ...rule, prefix: e.target.value }
                                : rule
                            ))}
                            className="ui-control-shell h-6 text-2xs"
                            placeholder="Prefix..."
                          />
                          <Input
                            value={prefixSuffixRule.suffix}
                            onChange={(e) => updateRule(row.id, (rule) => (
                              rule.type === "addPrefixSuffixLines" || rule.type === "wrapLines"
                                ? { ...rule, suffix: e.target.value }
                                : rule
                            ))}
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
                              updateRule(row.id, (rule) => (
                                rule.type === "collapseBlankLines"
                                  ? { ...rule, maxConsecutive: Number.isFinite(parsed) ? Math.max(0, parsed) : 1 }
                                  : rule
                              ));
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
                            onChange={(e) => updateRule(row.id, (rule) => (
                              rule.type === "sortIpAddresses" ? { ...rule, order: e.target.value as "asc" | "desc" } : rule
                            ))}
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
                              onChange={(e) => updateRule(row.id, (rule) => (
                                rule.type === "padLines"
                                  ? { ...rule, direction: e.target.value as "left" | "right" }
                                  : rule
                              ))}
                              className="ui-control-shell h-6 text-2xs"
                            >
                              <option value="left">left</option>
                              <option value="right">right</option>
                            </select>
                            <Input
                              value={padLinesRule.width}
                              onChange={(e) => {
                                const parsed = Number.parseInt(e.target.value, 10);
                                updateRule(row.id, (rule) => (
                                  rule.type === "padLines"
                                    ? { ...rule, width: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 }
                                    : rule
                                ));
                              }}
                              className="ui-control-shell h-6 text-2xs w-16"
                              placeholder="w"
                            />
                          </div>
                          <Input
                            value={padLinesRule.char ?? " "}
                            onChange={(e) => updateRule(row.id, (rule) => (
                              rule.type === "padLines"
                                ? { ...rule, char: e.target.value.slice(0, 1) }
                                : rule
                            ))}
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
                            updateActive((w) => {
                              if (!canUp) return w;
                              const next = [...w.rules];
                              const current = next[idx];
                              const previous = next[idx - 1];
                              if (!current || !previous) return w;
                              next[idx - 1] = current;
                              next[idx] = previous;
                              return { ...w, rules: next };
                            }, true)
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
                            updateActive((w) => {
                              if (!canDown) return w;
                              const next = [...w.rules];
                              const current = next[idx];
                              const following = next[idx + 1];
                              if (!current || !following) return w;
                              next[idx] = following;
                              next[idx + 1] = current;
                              return { ...w, rules: next };
                            }, true)
                          }
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() =>
                            updateActive((w) => ({
                              ...w,
                              rules: w.rules.filter((item) => item.id !== row.id),
                            }), true)
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
        </div>
      </div>

      <div className="flex-1 min-h-0 p-1.5">
        <div className="h-full ui-surface-card p-2">
          <div className="h-full grid grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] gap-2">
            <div className="rounded-lg border border-border/30 bg-background/20 p-2 min-h-0">
              <div className="mb-2 flex items-center justify-between">
                <span className="section-label-sm">Input</span>
                <Badge variant="outline" className="h-5 text-2xs">{active.input.length} chars</Badge>
              </div>
              <Textarea
                value={active.input}
                onChange={(e) => updateActive((w) => ({ ...w, input: e.target.value }), true)}
                className="min-h-[560px] font-mono text-xs leading-5"
              />
            </div>
            <div className="flex items-center justify-center">
              <button
                type="button"
                className="h-10 w-10 rounded-full border border-primary/40 bg-primary/10 hover:bg-primary/20 transition-smooth flex items-center justify-center"
                onClick={flipPanes}
              >
                <ArrowRightLeft className="h-4 w-4 text-primary" />
              </button>
            </div>
            <div className="rounded-lg border border-border/30 bg-background/20 p-2 min-h-0">
              <div className="mb-2 flex items-center justify-between">
                <span className="section-label-sm">Output</span>
                <Badge variant="outline" className="h-5 text-2xs">{activeRuleCount} active</Badge>
              </div>
              <Textarea value={active.output} readOnly className="min-h-[560px] font-mono text-xs leading-5" />
            </div>
          </div>
        </div>
      </div>

      <div className="px-1.5 pb-1.5">
        <div className="ui-surface-card px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-5 text-2xs">Words {active.metrics.words}</Badge>
            <Badge variant="outline" className="h-5 text-2xs">Chars {active.metrics.chars}</Badge>
            <Badge variant="outline" className="h-5 text-2xs">Lines {active.metrics.lines}</Badge>
            <Badge variant="outline" className="h-5 text-2xs">Numbers {active.metrics.numbers}</Badge>
            <span className="ml-auto text-2xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Last run: {fmtTime(active.lastRunAt)} ({active.lastRunMs ? `${active.lastRunMs}ms` : "--"})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
