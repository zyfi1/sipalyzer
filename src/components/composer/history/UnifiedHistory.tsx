/**
 * Unified History — shows all composer activity (SSH, HTTP, SIP, WS, GraphQL).
 * Phase 1 stub with basic list. Full implementation in Phase 2b.
 */

import { useState } from "react";
import { useComposerStore } from "@/stores/composerStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  History,
  Search,
  Trash2,
  Globe,
  Smartphone,
  SshKey,
  Zap,
  Code,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { ComposerProtocol } from "@/types/composer";

const PROTOCOL_FILTERS: Array<{ value: "all" | ComposerProtocol; label: string }> = [
  { value: "all", label: "All" },
  { value: "ssh", label: "SSH" },
  { value: "http", label: "HTTP" },
  { value: "sip", label: "SIP" },
  { value: "websocket", label: "WS" },
  { value: "graphql", label: "GraphQL" },
];

function protocolIcon(protocol: ComposerProtocol) {
  switch (protocol) {
    case "http":
      return <Globe className="size-4 text-info" />;
    case "sip":
      return <Smartphone className="size-4 text-info" />;
    case "ssh":
      return <SshKey className="size-4 text-primary" />;
    case "websocket":
      return <Zap className="size-4 text-warning" />;
    case "graphql":
      return <Code className="size-4 text-destructive" />;
  }
}

export function UnifiedHistory() {
  const history = useComposerStore((s) => s.history);
  const clearHistory = useComposerStore((s) => s.clearHistory);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | ComposerProtocol>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = history.filter((h) => {
    const matchSearch =
      !search ||
      h.method.toLowerCase().includes(search.toLowerCase()) ||
      h.target.toLowerCase().includes(search.toLowerCase());
    const matchProtocol = filter === "all" || h.protocol === filter;
    return matchSearch && matchProtocol;
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-4">
      <div className="flex items-center gap-3 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search history..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <div className="flex rounded-lg bg-muted/30 p-0.5">
          {PROTOCOL_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "px-2.5 py-1 text-2xs font-medium rounded-lg transition-smooth",
                filter === f.value
                  ? "bg-card shadow-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmClear(true)}
          className="gap-1.5 h-8 text-xs"
        >
          <Trash2 className="size-3" />
          Clear
        </Button>
      </div>

      {history.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<History />}
          title="No history yet"
          description="Activity from SSH connections, requests, and WebSocket sessions will appear here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState compact variant="inline" title="No matching history entries" />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pb-4">
          <div className="surface overflow-hidden divide-y divide-border/20">
            {filtered.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3.5 px-4 py-3 transition-smooth hover:bg-muted/20"
              >
                <div className="shrink-0">{protocolIcon(h.protocol)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{h.method}</span>
                    {h.statusCode != null && (
                      <span
                        className={cn(
                          "text-2xs font-mono font-semibold tabular-nums",
                          h.statusCode >= 200 && h.statusCode < 300
                            ? "text-success"
                            : h.statusCode >= 400
                              ? "text-destructive"
                              : "text-muted-foreground"
                        )}
                      >
                        {h.statusCode}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {h.target}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xs text-muted-foreground/60 tabular-nums">
                    {new Date(h.timestamp).toLocaleString()}
                  </p>
                  {h.roundTripMs != null && (
                    <p className="text-2xs text-muted-foreground/60 tabular-nums">
                      {h.roundTripMs} ms
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear History"
        description="This will remove all history entries. This action cannot be undone."
        confirmText="Clear All"
        variant="destructive"
        onConfirm={() => {
          clearHistory();
          setConfirmClear(false);
        }}
      />
    </div>
  );
}
