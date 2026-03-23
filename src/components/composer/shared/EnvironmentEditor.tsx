/**
 * Environment Editor — single-view, tool-first workflow.
 *
 * Goals:
 * - Fast variable editing
 * - Minimal but clear guidance
 * - Stable UI hierarchy in one workspace
 */

import { useCallback, useMemo, useState } from "react";
import { useComposerStore, interpolateVariables, newEnvId } from "@/stores/composerStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Globe, Info, Plus, Settings, Trash2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { EnvironmentVariable } from "@/types/composer";

interface EnvironmentEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface VariableDiagnostic {
  id: string;
  message: string;
  index?: number;
}

const VARIABLE_KEY_RE = /^[A-Za-z_]\w*(?:\.\w+)*$/;
const PLACEHOLDER_RE = /\{\{(\w+(?:\.\w+)*)\}\}/g;

function toToken(key: string): string {
  return `{{${key}}}`;
}

function buildScopeDiagnostics(
  scopeVariables: EnvironmentVariable[],
  globalVariables: EnvironmentVariable[],
  isEnvironmentScope: boolean
): VariableDiagnostic[] {
  const diagnostics: VariableDiagnostic[] = [];
  const seen = new Map<string, number[]>();
  const globalKeys = new Set(
    globalVariables.filter((v) => v.enabled && v.key.trim()).map((v) => v.key.trim())
  );

  scopeVariables.forEach((v, index) => {
    if (!v.enabled) return;
    const key = v.key.trim();

    if (!key) {
      diagnostics.push({
        id: `empty-${index}`,
        message: "Enabled variable has an empty key.",
        index,
      });
      return;
    }

    if (!VARIABLE_KEY_RE.test(key)) {
      diagnostics.push({
        id: `invalid-${index}`,
        message: `Key "${key}" may not interpolate.`,
        index,
      });
    }

    const list = seen.get(key) ?? [];
    list.push(index);
    seen.set(key, list);

    if (isEnvironmentScope && globalKeys.has(key)) {
      diagnostics.push({
        id: `override-${index}-${key}`,
        message: `"${key}" overrides the global value in this environment.`,
        index,
      });
    }
  });

  for (const [key, indexes] of seen.entries()) {
    if (indexes.length <= 1) continue;
    indexes.forEach((index) => {
      diagnostics.push({
        id: `dup-${index}-${key}`,
        message: `Duplicate key "${key}" in this scope.`,
        index,
      });
    });
  }

  return diagnostics;
}

export function EnvironmentEditor({ open, onOpenChange }: EnvironmentEditorProps) {
  const environments = useComposerStore((s) => s.environments);
  const activeEnvironmentId = useComposerStore((s) => s.activeEnvironmentId);
  const globalVariables = useComposerStore((s) => s.globalVariables);
  const addEnvironment = useComposerStore((s) => s.addEnvironment);
  const updateEnvironment = useComposerStore((s) => s.updateEnvironment);
  const deleteEnvironment = useComposerStore((s) => s.deleteEnvironment);
  const setActiveEnvironment = useComposerStore((s) => s.setActiveEnvironment);
  const setGlobalVariables = useComposerStore((s) => s.setGlobalVariables);

  const [selectedEnvId, setSelectedEnvId] = useState<string | "globals">("globals");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmVariableDelete, setConfirmVariableDelete] = useState<{
    index: number;
    key: string;
    scopeId: string | "globals";
  } | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState(
    "https://{{API_BASE_URL}}/v1/users/{{USER_ID}}"
  );

  const selectedEnv = environments.find((e) => e.id === selectedEnvId);
  const isGlobalScope = selectedEnvId === "globals";
  const scopeTitle = isGlobalScope ? "Global Variables" : selectedEnv?.name ?? "Environment";
  const scopeVariables = isGlobalScope ? globalVariables : selectedEnv?.variables ?? [];

  const setScopeVariables = useCallback(
    (variables: EnvironmentVariable[]) => {
      if (isGlobalScope) {
        setGlobalVariables(variables);
        return;
      }
      if (!selectedEnv) return;
      updateEnvironment(selectedEnv.id, { variables });
    },
    [isGlobalScope, selectedEnv, setGlobalVariables, updateEnvironment]
  );

  const diagnostics = useMemo(
    () => buildScopeDiagnostics(scopeVariables, globalVariables, !isGlobalScope),
    [scopeVariables, globalVariables, isGlobalScope]
  );

  const diagnosticsByIndex = useMemo(() => {
    const map = new Map<number, string[]>();
    diagnostics.forEach((d) => {
      if (d.index == null) return;
      const list = map.get(d.index) ?? [];
      list.push(d.message);
      map.set(d.index, list);
    });
    return map;
  }, [diagnostics]);

  const variableMap = useMemo(() => {
    const map = new Map<string, string>();
    globalVariables.forEach((v) => {
      if (v.enabled && v.key.trim()) map.set(v.key.trim(), v.value);
    });
    if (!isGlobalScope && selectedEnv) {
      selectedEnv.variables.forEach((v) => {
        if (v.enabled && v.key.trim()) map.set(v.key.trim(), v.value);
      });
    }
    return map;
  }, [globalVariables, isGlobalScope, selectedEnv]);

  const unresolvedPlaceholders = useMemo(() => {
    const keys = new Set<string>();
    let match: RegExpExecArray | null;
    const regex = new RegExp(PLACEHOLDER_RE);
    while ((match = regex.exec(previewTemplate)) !== null) {
      const key = match[1];
      if (!key) continue;
      if (!variableMap.has(key)) keys.add(key);
    }
    return Array.from(keys);
  }, [previewTemplate, variableMap]);

  const previewResolved = useMemo(
    () =>
      interpolateVariables(previewTemplate, {
        environments,
        activeEnvironmentId: isGlobalScope ? null : selectedEnv?.id ?? null,
        globalVariables,
      }),
    [previewTemplate, environments, isGlobalScope, selectedEnv, globalVariables]
  );

  const handleCreateEnv = useCallback(() => {
    const id = newEnvId();
    addEnvironment({
      id,
      name: "New Environment",
      variables: [{ key: "", value: "", enabled: true }],
      createdAt: Date.now(),
    });
    setSelectedEnvId(id);
  }, [addEnvironment]);

  const handleAddVariable = useCallback(() => {
    setScopeVariables([...scopeVariables, { key: "", value: "", enabled: true }]);
  }, [scopeVariables, setScopeVariables]);

  const handleUpdateVariable = useCallback(
    (index: number, updates: Partial<EnvironmentVariable>) => {
      const next = scopeVariables.map((v, i) =>
        i === index
          ? {
              key: updates.key ?? v.key,
              value: updates.value ?? v.value,
              enabled: updates.enabled ?? v.enabled,
            }
          : v
      );
      setScopeVariables(next);
    },
    [scopeVariables, setScopeVariables]
  );

  const handleRemoveVariable = useCallback(
    (index: number) => {
      const key = scopeVariables[index]?.key?.trim() || `row ${index + 1}`;
      setConfirmVariableDelete({
        index,
        key,
        scopeId: selectedEnvId,
      });
    },
    [scopeVariables, selectedEnvId]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-5xl max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/30">
            <DialogTitle>Environments</DialogTitle>
            <DialogDescription>
              Edit variables fast. Use <code className="font-mono text-xs bg-muted/30 px-1 rounded-lg">{`{{KEY}}`}</code> in requests.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Navigator */}
            <aside className="w-56 border-r border-border/30 flex flex-col min-h-0">
              <div className="p-3">
                <Button variant="primary" size="sm" className="w-full h-8 gap-1.5" onClick={handleCreateEnv}>
                  <Plus className="h-3.5 w-3.5" />
                  New Environment
                </Button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-1">
                <button
                  type="button"
                  onClick={() => setSelectedEnvId("globals")}
                  className={cn(
                    "w-full h-9 px-3 rounded-lg flex items-center gap-2 text-sm transition-smooth",
                    isGlobalScope
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  )}
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Global Variables</span>
                </button>

                {environments.map((env) => (
                  <button
                    key={env.id}
                    type="button"
                    onClick={() => setSelectedEnvId(env.id)}
                    className={cn(
                      "w-full h-9 px-3 rounded-lg flex items-center gap-2 text-sm transition-smooth",
                      selectedEnvId === env.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    )}
                  >
                    {activeEnvironmentId === env.id ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate flex-1 text-left">{env.name}</span>
                    <span className="text-xs text-muted-foreground/70">{env.variables.length}</span>
                  </button>
                ))}
              </div>
            </aside>

            {/* Main workspace */}
            <section className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {!isGlobalScope && !selectedEnv ? (
                <EmptyState
                  variant="inline"
                  icon={<Settings />}
                  title="Select an environment"
                  description="Choose an environment from the left or create a new one."
                />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="section-title truncate">{scopeTitle}</p>
                      <p className="caption-text-sm">
                        One rule: environment keys override matching globals when active.
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isGlobalScope && selectedEnv ? (
                        <>
                          <Button
                            variant={activeEnvironmentId === selectedEnv.id ? "primary" : "neutral"}
                            size="sm"
                            className="h-8"
                            onClick={() =>
                              setActiveEnvironment(activeEnvironmentId === selectedEnv.id ? null : selectedEnv.id)
                            }
                          >
                            {activeEnvironmentId === selectedEnv.id ? "Active" : "Set Active"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete environment ${selectedEnv.name}`}
                            onClick={() => setConfirmDelete(selectedEnv.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : null}
                      <Button variant="primary" size="sm" className="h-8 gap-1.5" onClick={handleAddVariable}>
                        <Plus className="h-3.5 w-3.5" />
                        Add Row
                      </Button>
                    </div>
                  </div>

                  {!isGlobalScope && selectedEnv ? (
                    <Input
                      value={selectedEnv.name}
                      onChange={(e) => updateEnvironment(selectedEnv.id, { name: e.target.value })}
                      placeholder="Environment name"
                      className="h-8 text-sm"
                    />
                  ) : null}

                  {diagnostics.length > 0 ? (
                    <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <AlertTriangle className="h-3.5 w-3.5 text-warning/80" />
                          Variable guidance
                        </div>
                        <Badge variant="secondary" className="rounded-lg text-muted-foreground">
                          {diagnostics.length}
                        </Badge>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {diagnostics.slice(0, 5).map((d) => (
                          <li key={d.id} className="caption-text-sm">
                            {d.message}
                          </li>
                        ))}
                        {diagnostics.length > 5 ? (
                          <li className="caption-text-sm">+{diagnostics.length - 5} more</li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}

                  {scopeVariables.length === 0 ? (
                    <EmptyState
                      compact
                      variant="inline"
                      title={`No ${isGlobalScope ? "global " : ""}variables`}
                      description="Add key-value rows to start interpolation."
                    />
                  ) : (
                    <VariableTable
                      variables={scopeVariables}
                      diagnosticsByIndex={diagnosticsByIndex}
                      onUpdate={handleUpdateVariable}
                      onRemove={handleRemoveVariable}
                    />
                  )}

                  <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 section-label-sm">
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      Variable Preview
                    </div>
                    <Input
                      value={previewTemplate}
                      onChange={(e) => setPreviewTemplate(e.target.value)}
                      className="h-8 text-sm font-mono"
                      placeholder="https://{{API_BASE_URL}}/v1/users/{{USER_ID}}"
                    />
                    {unresolvedPlaceholders.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="caption-text-sm">Missing values:</span>
                        {unresolvedPlaceholders.map((k) => (
                          <Badge
                            key={k}
                            variant="secondary"
                            className="rounded-lg text-muted-foreground border-border/30 bg-muted/30"
                          >
                            {toToken(k)}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="caption-text-sm text-success">All placeholders resolved.</p>
                    )}
                    <pre className="rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                      {previewResolved || "Resolved output appears here"}
                    </pre>
                  </div>
                </>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(nextOpen) => !nextOpen && setConfirmDelete(null)}
        title="Delete Environment"
        description="This will permanently remove this environment and all variables."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (confirmDelete) {
            deleteEnvironment(confirmDelete);
            setSelectedEnvId("globals");
          }
          setConfirmDelete(null);
        }}
      />

      <ConfirmDialog
        open={confirmVariableDelete !== null}
        onOpenChange={(nextOpen) => !nextOpen && setConfirmVariableDelete(null)}
        title="Delete Variable"
        description={
          confirmVariableDelete
            ? `Delete "${confirmVariableDelete.key}" from this ${
                confirmVariableDelete.scopeId === "globals" ? "global scope" : "environment"
              }?`
            : "Delete this variable?"
        }
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (
            confirmVariableDelete &&
            confirmVariableDelete.scopeId === selectedEnvId
          ) {
            setScopeVariables(
              scopeVariables.filter((_, i) => i !== confirmVariableDelete.index)
            );
          }
          setConfirmVariableDelete(null);
        }}
      />
    </>
  );
}

function VariableTable({
  variables,
  diagnosticsByIndex,
  onUpdate,
  onRemove,
}: {
  variables: EnvironmentVariable[];
  diagnosticsByIndex: Map<number, string[]>;
  onUpdate: (index: number, updates: Partial<EnvironmentVariable>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 overflow-hidden">
      <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-2 px-3 py-2 border-b border-border/20">
        <span className="section-label-sm">Use</span>
        <span className="section-label-sm">Key</span>
        <span className="section-label-sm">Value</span>
        <span />
        <span />
      </div>

      <div className="divide-y divide-border/20">
        {variables.map((v, i) => {
          const hasWarning = diagnosticsByIndex.has(i);
          return (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-2 px-3 py-2 items-center">
              <Switch
                checked={v.enabled}
                onCheckedChange={(checked) => onUpdate(i, { enabled: checked })}
                className="scale-75"
              />
              <Input
                value={v.key}
                onChange={(e) => onUpdate(i, { key: e.target.value })}
                placeholder="KEY"
                className={cn(
                  "h-8 text-sm font-mono",
                  hasWarning ? "border-warning/30 focus-visible:ring-warning/20" : undefined
                )}
              />
              <Input
                value={v.value}
                onChange={(e) => onUpdate(i, { value: e.target.value })}
                placeholder="value"
                className="h-8 text-sm font-mono"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove variable ${v.key || i + 1}`}
                onClick={() => onRemove(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              {hasWarning ? (
                <span className="text-warning/80" aria-hidden>
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
              ) : (
                <span className="h-3.5 w-3.5" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
