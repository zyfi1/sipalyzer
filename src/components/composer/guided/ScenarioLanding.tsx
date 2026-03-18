/**
 * Scenario Landing Page — the guided entry point for the Composer.
 *
 * Clean, purposeful layout:
 *   - Hero SIP card (primary action)
 *   - Secondary HTTP + SSH cards
 *   - Recent activity (clickable, re-opens the scenario)
 *   - Advanced mode link
 */

import { useState } from "react";
import { useComposerStore } from "@/stores/composerStore";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Smartphone,
  Globe,
  SshKey,
  Clock,
  ChevronRight,
  Send,
  Code,
  Trash2,
} from "@/lib/icons";
import type { ComposerProtocol, ComposerHistoryEntry } from "@/types/composer";
import { cn } from "@/lib/utils";

type GuidedMode = "landing" | "sip-wizard" | "http-wizard" | null;

interface ScenarioLandingProps {
  onStartWizard: (mode: GuidedMode) => void;
  onOpenSsh: () => void;
  onToggleAdvanced: () => void;
}

function protocolIcon(protocol: ComposerProtocol) {
  switch (protocol) {
    case "sip":
      return <Smartphone className="h-3.5 w-3.5 text-primary" />;
    case "http":
      return <Globe className="h-3.5 w-3.5 text-info" />;
    case "ssh":
      return <SshKey className="h-3.5 w-3.5 text-primary" />;
    default:
      return <Globe className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

export function ScenarioLanding({
  onStartWizard,
  onOpenSsh,
  onToggleAdvanced,
}: ScenarioLandingProps) {
  const history = useComposerStore((s) => s.history);
  const clearHistory = useComposerStore((s) => s.clearHistory);
  const items = useComposerStore((s) => s.collections.items);
  const recentHistory = history.slice(0, 5);
  const [confirmClear, setConfirmClear] = useState(false);
  const sipCount = items.filter((i) => i.protocol === "sip").length;
  const httpCount = items.filter((i) => i.protocol === "http").length;
  const sshCount = items.filter((i) => i.protocol === "ssh").length;

  const handleHistoryClick = (entry: ComposerHistoryEntry) => {
    if (entry.protocol === "sip") {
      onStartWizard("sip-wizard");
    } else if (entry.protocol === "http") {
      onStartWizard("http-wizard");
    } else if (entry.protocol === "ssh") {
      onOpenSsh();
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[640px] mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-1.5">
          <h1 className="text-base font-semibold text-foreground">
            What would you like to do?
          </h1>
          <p className="text-xs text-muted-foreground">
            Pick a task to get started with guided setup, or use the advanced editor for full control.
          </p>
        </div>

        {/* ── Hero: SIP Message Builder ─────────────────────────── */}
        <button
          type="button"
          onClick={() => onStartWizard("sip-wizard")}
          className={cn(
            "group w-full text-left rounded-lg overflow-hidden transition-smooth",
            "ui-hero-surface"
          )}
        >
          <div className="p-5 flex items-start gap-4">
            <div className="flex items-center justify-center h-11 w-11 rounded-lg bg-primary/15 text-primary shrink-0 group-hover:scale-105 transition-transform">
              <Smartphone className="h-5.5 w-5.5" />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  SIP Message Builder
                </h2>
                <div className="flex items-center gap-1.5">
                  {sipCount > 0 && (
                    <span className="text-2xs text-muted-foreground/60 tabular-nums">
                      {sipCount} saved
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary group-hover:translate-x-0.5 transition-smooth" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Craft and send SIP messages — test connectivity, register with a
                PBX, start calls, send presence, and more. Headers are generated
                automatically.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-primary">
                  <Send className="h-3 w-3" />
                  Get Started
                </span>
                <span className="text-2xs text-muted-foreground/60">
                  13 scenarios available
                </span>
              </div>
            </div>
          </div>
        </button>

        {/* ── Secondary cards: HTTP + SSH + Advanced ────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {/* HTTP */}
          <button
            type="button"
            onClick={() => onStartWizard("http-wizard")}
            className={cn(
              "group text-left rounded-lg overflow-hidden transition-smooth",
              "ui-hero-metric"
            )}
          >
            <div className="p-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-info/15 text-info shrink-0">
                  <Globe className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-medium text-foreground">
                    HTTP Request
                  </h3>
                </div>
              </div>
              <p className="text-2xs text-muted-foreground leading-relaxed">
                GET, POST, PUT, DELETE with auth, headers, and body.
              </p>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-2xs font-medium text-info">
                  Get Started
                </span>
                {httpCount > 0 && (
                  <span className="text-2xs text-muted-foreground/60">
                    · {httpCount} saved
                  </span>
                )}
              </div>
            </div>
          </button>

          {/* SSH */}
          <button
            type="button"
            onClick={onOpenSsh}
            className={cn(
              "group text-left rounded-lg overflow-hidden transition-smooth",
              "ui-hero-metric"
            )}
          >
            <div className="p-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/15 text-primary shrink-0">
                  <SshKey className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-medium text-foreground">
                    SSH Connection
                  </h3>
                </div>
              </div>
              <p className="text-2xs text-muted-foreground leading-relaxed">
                Connect with tunnels, key auth, and config import.
              </p>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-2xs font-medium text-primary">
                  Connect
                </span>
                {sshCount > 0 && (
                  <span className="text-2xs text-muted-foreground/60">
                    · {sshCount} saved
                  </span>
                )}
              </div>
            </div>
          </button>

          {/* Advanced Editor */}
          <button
            type="button"
            onClick={onToggleAdvanced}
            className={cn(
              "group text-left rounded-lg overflow-hidden transition-smooth",
              "ui-hero-metric"
            )}
          >
            <div className="p-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted/30 text-foreground/70 shrink-0">
                  <Code className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-medium text-foreground">
                    Advanced Editor
                  </h3>
                </div>
              </div>
              <p className="text-2xs text-muted-foreground leading-relaxed">
                Full IDE with collections, tabs, environments, and WebSocket/GraphQL.
              </p>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-2xs font-medium text-foreground/70">
                  Open Editor
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* ── Recent Activity ─────────────────────────────────────── */}
        {recentHistory.length > 0 && (
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center gap-2">
              <Clock className="h-3 w-3 text-muted-foreground/60" />
              <h3 className="text-xs font-medium text-muted-foreground flex-1">
                Recent Activity
              </h3>
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1 text-2xs text-muted-foreground/60 hover:text-destructive transition-smooth"
              >
                <Trash2 className="h-2.5 w-2.5" />
                Clear
              </button>
            </div>
            <ConfirmDialog
              open={confirmClear}
              onOpenChange={setConfirmClear}
              title="Clear History"
              description="This will permanently delete all request and connection history. This action cannot be undone."
              confirmText="Clear All"
              variant="destructive"
              onConfirm={clearHistory}
            />
            <div className="ui-hero-surface divide-y divide-border/20">
              {recentHistory.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleHistoryClick(entry)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-muted/20 transition-smooth"
                >
                  {protocolIcon(entry.protocol)}
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-lg text-2xs font-bold tracking-wider bg-muted/30 text-muted-foreground uppercase min-w-[44px] text-center">
                    {entry.method}
                  </span>
                  <span className="flex-1 min-w-0 text-xs text-foreground/80 truncate font-mono">
                    {entry.target}
                  </span>
                  {entry.statusCode != null && (
                    <span
                      className={cn(
                        "text-2xs font-semibold tabular-nums",
                        entry.statusCode < 300
                          ? "text-success"
                          : entry.statusCode < 400
                            ? "text-warning"
                            : "text-destructive"
                      )}
                    >
                      {entry.statusCode}
                    </span>
                  )}
                  <span className="text-2xs text-muted-foreground/60 tabular-nums shrink-0">
                    {formatTimeAgo(entry.timestamp)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* bottom spacer */}
        <div className="h-2" />
      </div>
    </div>
  );
}
