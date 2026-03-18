import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Plus, Trash2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { nextRuleId, type PortForwardRule } from "@/stores/sshStore";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface PortForwardingEditorProps {
  rules: PortForwardRule[];
  onChange: (rules: PortForwardRule[]) => void;
}

const TYPE_META: Record<
  PortForwardRule["type"],
  { label: string; flag: string; variant: "default" | "secondary" | "outline"; desc: string }
> = {
  local: {
    label: "Local",
    flag: "-L",
    variant: "default",
    desc: "Forward a local port to a remote destination",
  },
  remote: {
    label: "Remote",
    flag: "-R",
    variant: "secondary",
    desc: "Forward a remote port back to a local destination",
  },
  dynamic: {
    label: "Dynamic",
    flag: "-D",
    variant: "outline",
    desc: "SOCKS proxy via the SSH tunnel",
  },
};

export function PortForwardingEditor({ rules, onChange }: PortForwardingEditorProps) {
  const [confirmRemoveRuleId, setConfirmRemoveRuleId] = useState<string | null>(null);
  const ruleToRemove = rules.find((rule) => rule.id === confirmRemoveRuleId) ?? null;

  const addRule = useCallback(() => {
    onChange([
      ...rules,
      {
        id: nextRuleId(),
        type: "local",
        localPort: 0,
        remoteHost: "localhost",
        remotePort: 0,
        description: "",
      },
    ]);
  }, [rules, onChange]);

  const updateRule = useCallback(
    (id: string, updates: Partial<PortForwardRule>) => {
      onChange(rules.map((r) => (r.id === id ? { ...r, ...updates } : r)));
    },
    [rules, onChange]
  );

  const removeRule = useCallback(
    (id: string) => {
      onChange(rules.filter((r) => r.id !== id));
    },
    [rules, onChange]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-foreground">Port Forwarding Rules</Label>
        <TooltipWrapper title="Add Rule" description="Add a new port forwarding rule (local, remote, or dynamic).">
          <Button variant="outline" size="sm" onClick={addRule} className="h-7 text-xs gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add Rule
          </Button>
        </TooltipWrapper>
      </div>

      {rules.length === 0 && (
        <EmptyState compact variant="inline" title="No port forwarding rules" description='Click "Add Rule" to create one.' />
      )}

      <div className="space-y-2">
        {rules.map((rule, index) => {
          const meta = TYPE_META[rule.type];
          const isDynamic = rule.type === "dynamic";
          return (
            <div
              key={rule.id}
              className={cn(
                "group relative rounded-lg bg-secondary/40 p-3 transition-smooth",
                "hover:bg-secondary/60",
                "animate-in fade-in-0 slide-in-from-top-1 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]"
              )}
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <div className="flex items-start gap-3">
                {/* Type selector */}
                <div className="w-[120px] flex-shrink-0">
                  <Select
                    value={rule.type}
                    onValueChange={(v) =>
                      updateRule(rule.id, { type: v as PortForwardRule["type"] })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TYPE_META) as PortForwardRule["type"][]).map((t) => (
                        <SelectItem key={t} value={t}>
                          <span className="flex items-center gap-2">
                            <Badge variant={TYPE_META[t].variant} className="text-2xs px-1.5 py-0">
                              {TYPE_META[t].flag}
                            </Badge>
                            {TYPE_META[t].label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-2xs text-muted-foreground leading-tight">
                    {meta.desc}
                  </p>
                </div>

                {/* Port fields */}
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-2xs text-muted-foreground mb-1">
                      {isDynamic ? "SOCKS Port" : "Local Port"}
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      placeholder="8080"
                      value={rule.localPort || ""}
                      onChange={(e) =>
                        updateRule(rule.id, {
                          localPort: parseInt(e.target.value) || 0,
                        })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  {!isDynamic && (
                    <>
                      <div>
                        <Label className="text-2xs text-muted-foreground mb-1">
                          Remote Host
                        </Label>
                        <Input
                          placeholder="localhost"
                          value={rule.remoteHost}
                          onChange={(e) =>
                            updateRule(rule.id, { remoteHost: e.target.value })
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-2xs text-muted-foreground mb-1">
                          Remote Port
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          placeholder="80"
                          value={rule.remotePort || ""}
                          onChange={(e) =>
                            updateRule(rule.id, {
                              remotePort: parseInt(e.target.value) || 0,
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Delete */}
                <TooltipWrapper title="Remove rule" description="Delete this port forwarding rule.">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setConfirmRemoveRuleId(rule.id)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipWrapper>
              </div>

              {/* Optional description */}
              <div className="mt-2">
                <Input
                  placeholder="Description (optional)"
                  value={rule.description}
                  onChange={(e) =>
                    updateRule(rule.id, { description: e.target.value })
                  }
                  className="h-7 text-2xs bg-transparent"
                />
              </div>
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={confirmRemoveRuleId != null}
        onOpenChange={(open) => {
          if (!open) setConfirmRemoveRuleId(null);
        }}
        title="Remove forwarding rule?"
        description={
          ruleToRemove
            ? `Remove ${TYPE_META[ruleToRemove.type].label.toLowerCase()} rule ${TYPE_META[ruleToRemove.type].flag}? This cannot be undone.`
            : "Remove this forwarding rule? This cannot be undone."
        }
        confirmText="Remove"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (!confirmRemoveRuleId) return;
          removeRule(confirmRemoveRuleId);
          setConfirmRemoveRuleId(null);
        }}
      />
    </div>
  );
}
