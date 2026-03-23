/**
 * SSH Subview — comprehensive SSH management.
 *
 * Layout:
 *   - Quick Connect bar
 *   - Tabbed views: Connections | Tunnels | Port Profiles
 *   - Connections: clean card grid with direct inline actions
 *   - Tunnels: tunnel manager with service presets
 *   - Port Profiles: reusable port forwarding templates
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useComposerStore, newItemId } from "@/stores/composerStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { PortForwardingEditor } from "@/components/ssh-helper/PortForwardingEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Search,
  SshKey,
  Clock,
  Play,
  Edit,
  Copy,
  Trash2,
  Layers,
  Download,
  Zap,
  ArrowRightLeft,
  Check,
  ArrowLeft,
  ArrowRight,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { dispatchSshExecuteWithAck } from "@/lib/sshExecute";
import { SshConfigImport } from "../shared/SshConfigImport";
import { SshWizardModal } from "./SshWizardModal";
import type {
  ComposerItem,
  SshConnectionData,
  PortForwardRule,
} from "@/types/composer";
import { DEFAULT_SSH_ADVANCED } from "@/types/composer";
import { nextRuleId } from "@/stores/sshStore";
import { deleteSshConnectionPassword, getSshConnectionPassword } from "@/api/sshPasswords";

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function buildSshCommand(data: SshConnectionData, tunnelOnly?: boolean): string {
  const parts: string[] = ["ssh"];
  if (tunnelOnly) parts.push("-N");
  if (data.port !== 22) parts.push(`-p ${data.port}`);
  if (data.authMethod === "key" && data.keyFilePath) {
    const path = /\s/.test(data.keyFilePath) ? `"${data.keyFilePath}"` : data.keyFilePath;
    parts.push(`-i ${path}`);
  }
  for (const fwd of data.portForwards) {
    switch (fwd.type) {
      case "local":
        parts.push(`-L ${fwd.localPort}:${fwd.remoteHost || "localhost"}:${fwd.remotePort}`);
        break;
      case "remote":
        parts.push(`-R ${fwd.localPort}:${fwd.remoteHost || "localhost"}:${fwd.remotePort}`);
        break;
      case "dynamic":
        parts.push(`-D ${fwd.localPort}`);
        break;
    }
  }
  const opts = data.advancedOptions;
  if (opts.compression) parts.push("-C");
  if (opts.keepAliveInterval > 0) parts.push(`-o ServerAliveInterval=${opts.keepAliveInterval}`);
  if (opts.keepAliveCountMax > 0 && opts.keepAliveCountMax !== 3) parts.push(`-o ServerAliveCountMax=${opts.keepAliveCountMax}`);
  if (opts.strictHostKeyChecking !== "ask") parts.push(`-o StrictHostKeyChecking=${opts.strictHostKeyChecking}`);
  if (opts.connectionTimeout > 0 && opts.connectionTimeout !== 30) parts.push(`-o ConnectTimeout=${opts.connectionTimeout}`);
  if (opts.jumpHost.trim()) parts.push(`-J ${opts.jumpHost.trim()}`);
  if (opts.customFlags.trim()) parts.push(opts.customFlags.trim());
  const dest = data.username ? `${data.username}@${data.host}` : data.host;
  parts.push(dest);
  return parts.join(" ");
}

function parseQuickConnect(input: string): { username: string; host: string; port: number } {
  let cleaned = input.trim();
  if (cleaned.startsWith("ssh ")) cleaned = cleaned.replace(/^ssh\s+/, "");
  const parts = cleaned.split("@");
  let username = "";
  let hostPort = cleaned;
  if (parts.length === 2) {
    username = parts[0]!;
    hostPort = parts[1]!;
  }
  const colonIdx = hostPort.lastIndexOf(":");
  let host = hostPort;
  let port = 22;
  if (colonIdx > 0) {
    const maybePort = parseInt(hostPort.slice(colonIdx + 1), 10);
    if (!isNaN(maybePort) && maybePort > 0 && maybePort <= 65535) {
      host = hostPort.slice(0, colonIdx);
      port = maybePort;
    }
  }
  return { username, host, port };
}

// ── SSH Subview ─────────────────────────────────────────────────────────────

type SshTab = "connections" | "profiles";

const SSH_TABS: Array<{ id: SshTab; label: string }> = [
  { id: "connections", label: "Connections" },
  { id: "profiles", label: "Port Profiles" },
];

export function SshSubview({
  /** When true, register Connections / Port Profiles in the app header breadcrumb (must match Composer SSH tab). */
  registerHeaderBreadcrumbTabs = false,
}: {
  registerHeaderBreadcrumbTabs?: boolean;
} = {}) {
  const [tab, setTab] = useState<SshTab>("connections");

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <ToolSubTabs
        tabs={SSH_TABS}
        activeTab={tab}
        onTabChange={setTab}
        toolId={registerHeaderBreadcrumbTabs ? "composer" : undefined}
      />

      {/* Quick Connect */}
      <QuickConnectBar />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 py-4">
          {tab === "connections" && <ConnectionsGrid />}
          {tab === "profiles" && <PortProfilesView />}
        </div>
      </div>
    </div>
  );
}

// ── Quick Connect Bar ────────────────────────────────────────────────────────

function QuickConnectBar() {
  const [value, setValue] = useState("");
  const setTerminalOpen = useLayoutStore((s) => s.setTerminalOpen);
  const terminalOpen = useLayoutStore((s) => s.terminalOpen);
  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleConnect = useCallback(() => {
    const run = async () => {
      if (!value.trim()) return;
      const parsed = parseQuickConnect(value);
      if (!parsed.host) return;

      const command = `ssh ${parsed.username ? `${parsed.username}@` : ""}${parsed.host}${parsed.port !== 22 ? ` -p ${parsed.port}` : ""}`;

      addHistoryEntry({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: "ssh",
        method: "SSH connect",
        target: `${parsed.username || "root"}@${parsed.host}`,
        timestamp: Date.now(),
      });

      if (!terminalOpen) {
        setTerminalOpen(true);
      }
      await dispatchSshExecuteWithAck({ detail: { command } });
      setValue("");
    };

    void run();
  }, [value, terminalOpen, setTerminalOpen, addHistoryEntry]);

  return (
    <div className="px-5 pt-4 pb-2 shrink-0">
      <div className="flex items-center gap-2 rounded-md surface px-3 h-10 focus-within:ring-1 focus-within:ring-primary/20 transition-smooth">
        <div className="flex items-center gap-1.5 text-muted-foreground/60 shrink-0">
          <Zap className="h-3.5 w-3.5" />
          <span className="text-2xs font-mono select-none">ssh</span>
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          placeholder="user@hostname:port"
          className="flex-1 min-w-0 bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/60 outline-none"
        />
        <Button
          size="sm"
          variant="primary"
          onClick={handleConnect}
          disabled={!value.trim()}
          className="h-7 text-xs gap-1.5 px-3 shrink-0"
        >
          <Play className="h-3 w-3" />
          Connect
        </Button>
      </div>
    </div>
  );
}

// ── Connections Grid ────────────────────────────────────────────────────────

function ConnectionsGrid() {
  const allItems = useComposerStore((s) => s.collections.items);
  const deleteItem = useComposerStore((s) => s.deleteItem);
  const duplicateItem = useComposerStore((s) => s.duplicateItem);
  const touchSshConnection = useComposerStore((s) => s.touchSshConnection);
  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const setTerminalOpen = useLayoutStore((s) => s.setTerminalOpen);
  const terminalOpen = useLayoutStore((s) => s.terminalOpen);

  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sshImportOpen, setSshImportOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardEditItem, setWizardEditItem] = useState<ComposerItem | null>(null);
  const [sortMode, setSortMode] = useState<"recent" | "name" | "tunnels">("recent");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const sshItems = useMemo(
    () => allItems.filter((i) => i.protocol === "ssh"),
    [allItems]
  );

  const filtered = useMemo(() => {
    if (!search) return sshItems;
    const lower = search.toLowerCase();
    return sshItems.filter(
      (i) =>
        i.name.toLowerCase().includes(lower) ||
        (i.sshData?.host ?? "").toLowerCase().includes(lower) ||
        (i.sshData?.username ?? "").toLowerCase().includes(lower)
    );
  }, [sshItems, search]);

  const filteredSorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      if (sortMode === "tunnels") {
        const delta = (b.sshData?.portForwards.length ?? 0) - (a.sshData?.portForwards.length ?? 0);
        if (delta !== 0) return delta;
        return a.name.localeCompare(b.name);
      }
      return (b.sshData?.lastConnected ?? 0) - (a.sshData?.lastConnected ?? 0);
    });
    return list;
  }, [filtered, sortMode]);

  const selectedItem = filteredSorted[selectedIndex] ?? null;

  const executeCommand = useCallback(
    async (command: string, password?: string) => {
      if (!terminalOpen) {
        setTerminalOpen(true);
      }
      await dispatchSshExecuteWithAck({ detail: { command, password } });
    },
    [terminalOpen, setTerminalOpen]
  );

  const handleConnect = useCallback(
    async (item: ComposerItem) => {
      if (!item.sshData) return;
      const command = buildSshCommand(item.sshData);
      const password =
        item.sshData.authMethod === "password"
          ? await getSshConnectionPassword(item.id).catch(() => null)
          : null;
      touchSshConnection(item.id);
      addHistoryEntry({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: "ssh",
        method: "SSH connect",
        target: `${item.sshData.username}@${item.sshData.host}`,
        timestamp: Date.now(),
        itemId: item.id,
      });
      void executeCommand(command, password ?? undefined);
    },
    [touchSshConnection, addHistoryEntry, executeCommand]
  );

  const handleEdit = useCallback((item: ComposerItem) => {
    setWizardEditItem(item);
    setWizardOpen(true);
  }, []);

  const handleNewConnection = useCallback(() => {
    setWizardEditItem(null);
    setWizardOpen(true);
  }, []);

  useEffect(() => {
    setSelectedIndex((idx) => {
      if (filteredSorted.length === 0) return 0;
      return Math.min(idx, filteredSorted.length - 1);
    });
  }, [filteredSorted.length]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("input, textarea, select, [contenteditable]"));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (isEditable(e.target)) return;
      if (filteredSorted.length === 0) return;
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredSorted.length);
        return;
      }
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filteredSorted.length) % filteredSorted.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filteredSorted[selectedIndex];
        if (!item) return;
        handleConnect(item);
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [filteredSorted, selectedIndex, handleConnect]);

  if (sshItems.length === 0) {
    return (
      <>
        <EmptyState
          variant="inline"
          icon={<SshKey />}
          title="No saved connections"
          description="Create your first SSH connection or import from your SSH config."
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="neutral" className="gap-1.5" onClick={handleNewConnection}>
                <Plus className="h-3.5 w-3.5" />
                New Connection
              </Button>
              <Button size="sm" variant="neutral" className="gap-1.5" onClick={() => setSshImportOpen(true)}>
                <Download className="h-3.5 w-3.5" />
                Import Config
              </Button>
            </div>
          }
        />
        <SshConfigImport open={sshImportOpen} onOpenChange={setSshImportOpen} />
        <SshWizardModal
          open={wizardOpen}
          onOpenChange={(nextOpen) => {
            setWizardOpen(nextOpen);
            if (!nextOpen) setWizardEditItem(null);
          }}
          editItem={wizardEditItem}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Workspace Controls */}
        <div className="rounded-md surface shadow-card px-3.5 py-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <p className="section-label">SSH Workspace</p>
            <div className="flex-1" />
            <TunnelsView showSavedConnections={false} compactLauncher />
            <Button variant="primary" size="sm" onClick={handleNewConnection} className="gap-1.5 h-8 text-xs shrink-0">
              <Plus className="h-3 w-3" />
              New Connection
            </Button>
            <Button variant="neutral" size="sm" onClick={() => setSshImportOpen(true)} className="gap-1.5 h-8 text-xs shrink-0">
              <Download className="h-3 w-3" />
              Import
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
              <Input
                ref={searchRef}
                placeholder="Filter connections..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <AppDropdown
              value={sortMode}
              onValueChange={(v) => setSortMode(v as typeof sortMode)}
              options={[
                { value: "recent", label: "Sort: Recent" },
                { value: "name", label: "Sort: Name" },
                { value: "tunnels", label: "Sort: Tunnels" },
              ]}
              placeholder="Sort"
              className="h-8 w-[130px] text-xs shrink-0"
              size="sm"
            />
            <p className="text-2xs text-muted-foreground shrink-0">
              {filteredSorted.length} result{filteredSorted.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <p className="text-2xs text-muted-foreground">
          <code className="font-mono">/</code> search, <code className="font-mono">j/k</code> navigate,{" "}
          <code className="font-mono">Enter</code> connect
          {selectedItem ? (
            <>
              {" "}
              • Selected: <span className="text-foreground">{selectedItem.name}</span>
            </>
          ) : null}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredSorted.map((item, idx) => (
            <SshCard
              key={item.id}
              item={item}
              isSelected={idx === selectedIndex}
              onHover={() => setSelectedIndex(idx)}
              onConnect={() => handleConnect(item)}
              onEdit={() => handleEdit(item)}
              onDuplicate={() => duplicateItem(item.id)}
              onDelete={() => setDeleteId(item.id)}
            />
          ))}
        </div>

        {filteredSorted.length === 0 && sshItems.length > 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No connections match &ldquo;{search}&rdquo;
          </p>
        )}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete Connection"
        description="This will permanently remove this SSH connection and all its saved tunnels. This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteId) {
            void deleteSshConnectionPassword(deleteId).catch(() => undefined);
            deleteItem(deleteId);
          }
          setDeleteId(null);
        }}
      />

      <SshConfigImport open={sshImportOpen} onOpenChange={setSshImportOpen} />
      <SshWizardModal
        open={wizardOpen}
        onOpenChange={(nextOpen) => {
          setWizardOpen(nextOpen);
          if (!nextOpen) setWizardEditItem(null);
        }}
        editItem={wizardEditItem}
      />
    </>
  );
}

// ── SSH Connection Card ──────────────────────────────────────────────────────
// Uses direct inline action buttons — no dropdown menu.

function SshCard({
  item,
  isSelected,
  onHover,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: ComposerItem;
  isSelected?: boolean;
  onHover?: () => void;
  onConnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const ssh = item.sshData!;
  const fwdCount = ssh.portForwards.length;
  const hasJumpHost = !!ssh.advancedOptions.jumpHost.trim();

  return (
    <div
      className={cn(
        "group rounded-md surface shadow-card hover:bg-card hover-lift transition-smooth h-full flex flex-col",
        isSelected ? "ring-1 ring-primary/30 bg-card" : ""
      )}
      onMouseEnter={onHover}
    >
      {/* Top section: name, host, action icons */}
      <div className="px-3.5 pt-3.5 pb-2.5">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
            <SshKey className="h-4 w-4" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-foreground truncate leading-tight">
              {item.name}
            </h3>
            <p className="text-2xs text-muted-foreground font-mono mt-0.5 truncate">
              {ssh.username ? `${ssh.username}@` : ""}{ssh.host}
              {ssh.port !== 22 && `:${ssh.port}`}
            </p>
          </div>

          {/* Inline icon actions: edit, duplicate, delete */}
          <div className="flex items-center gap-0.5 shrink-0 -mr-1">
            <TooltipWrapper title="Edit" description="Edit this connection">
              <button
                type="button"
                onClick={onEdit}
                className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth"
              >
                <Edit className="h-3.5 w-3.5" />
              </button>
            </TooltipWrapper>
            <TooltipWrapper title="Duplicate" description="Create a copy">
              <button
                type="button"
                onClick={onDuplicate}
                className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </TooltipWrapper>
            <TooltipWrapper title="Delete" description="Remove this connection">
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-smooth"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipWrapper>
          </div>
        </div>

        {/* Meta badges */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground/60 bg-muted/20 rounded px-1.5 py-0.5">
            {ssh.authMethod === "key" ? "Key" : ssh.authMethod === "agent" ? "Agent" : "Password"}
          </span>
          {hasJumpHost && (
            <span className="inline-flex items-center gap-1 text-2xs text-warning/80 bg-warning/10 rounded px-1.5 py-0.5">
              Jump Host
            </span>
          )}
          {fwdCount > 0 && (
            <span className="inline-flex items-center gap-1 text-2xs text-primary/70 bg-primary/10 rounded px-1.5 py-0.5">
              <ArrowRightLeft className="h-2.5 w-2.5" />
              {fwdCount} tunnel{fwdCount !== 1 ? "s" : ""}
            </span>
          )}
          {ssh.lastConnected && (
            <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground/60 ml-auto">
              <Clock className="h-2.5 w-2.5" />
              {timeAgo(ssh.lastConnected)}
            </span>
          )}
        </div>
      </div>

      {/* Tunnel summary if present */}
      <div className="mx-3.5 mb-2.5 rounded-lg bg-muted/20 px-2.5 py-1.5 min-h-[56px]">
        {fwdCount > 0 ? (
          <>
            {ssh.portForwards.slice(0, 2).map((fwd) => (
              <div key={fwd.id} className="flex items-center gap-1.5 text-2xs font-mono text-muted-foreground/60 leading-relaxed">
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-5 text-3xs font-bold rounded",
                    fwd.type === "local" ? "text-success" : fwd.type === "remote" ? "text-primary" : "text-warning"
                  )}
                >
                  {fwd.type === "local" ? "-L" : fwd.type === "remote" ? "-R" : "-D"}
                </span>
                {fwd.type === "dynamic" ? (
                  <span>:{fwd.localPort} SOCKS</span>
                ) : (
                  <span>
                    :{fwd.localPort} &rarr; {fwd.remoteHost}:{fwd.remotePort}
                  </span>
                )}
              </div>
            ))}
            {fwdCount > 2 && (
              <span className="text-2xs text-muted-foreground/60 pl-7">+{fwdCount - 2} more</span>
            )}
          </>
        ) : (
          <div className="h-full flex items-center text-2xs text-muted-foreground/60">
            No tunnels configured
          </div>
        )}
      </div>

      {/* Actions footer */}
      <div className="mt-auto px-3.5 py-2.5 border-t border-border/20">
        <Button
          variant="primary"
          size="sm"
          className="gap-1.5 text-xs h-7 w-full"
          onClick={onConnect}
        >
          <Play className="h-3 w-3" />
          Connect
        </Button>
      </div>

    </div>
  );
}

// ── Tunnels View ────────────────────────────────────────────────────────────

const TUNNEL_PRESETS: Array<{
  name: string;
  description: string;
  localPort: number;
  remotePort: number;
  remoteHost: string;
  type: PortForwardRule["type"];
}> = [
  { name: "MySQL", description: "Database access via tunnel", localPort: 3306, remotePort: 3306, remoteHost: "localhost", type: "local" },
  { name: "PostgreSQL", description: "Database access via tunnel", localPort: 5432, remotePort: 5432, remoteHost: "localhost", type: "local" },
  { name: "Redis", description: "In-memory store access", localPort: 6379, remotePort: 6379, remoteHost: "localhost", type: "local" },
  { name: "MongoDB", description: "NoSQL database access", localPort: 27017, remotePort: 27017, remoteHost: "localhost", type: "local" },
  { name: "HTTP (8080)", description: "Web service on remote", localPort: 8080, remotePort: 8080, remoteHost: "localhost", type: "local" },
  { name: "HTTPS (443)", description: "Secure web service", localPort: 8443, remotePort: 443, remoteHost: "localhost", type: "local" },
  { name: "VNC", description: "Remote desktop access", localPort: 5900, remotePort: 5900, remoteHost: "localhost", type: "local" },
  { name: "RDP", description: "Windows Remote Desktop", localPort: 3389, remotePort: 3389, remoteHost: "localhost", type: "local" },
  { name: "SOCKS Proxy", description: "Dynamic proxy via -D", localPort: 1080, remotePort: 0, remoteHost: "", type: "dynamic" },
  { name: "Jupyter", description: "Notebook server access", localPort: 8888, remotePort: 8888, remoteHost: "localhost", type: "local" },
  { name: "Elasticsearch", description: "Search engine access", localPort: 9200, remotePort: 9200, remoteHost: "localhost", type: "local" },
  { name: "Kafka", description: "Message broker access", localPort: 9092, remotePort: 9092, remoteHost: "localhost", type: "local" },
];

function TunnelsView({
  showSavedConnections = true,
  compactLauncher = false,
}: {
  showSavedConnections?: boolean;
  compactLauncher?: boolean;
}) {
  const allItems = useComposerStore((s) => s.collections.items);
  const sshItems = useMemo(() => allItems.filter((i) => i.protocol === "ssh"), [allItems]);
  const addItem = useComposerStore((s) => s.addItem);
  const updateItem = useComposerStore((s) => s.updateItem);
  const setTerminalOpen = useLayoutStore((s) => s.setTerminalOpen);
  const terminalOpen = useLayoutStore((s) => s.terminalOpen);
  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const touchSshConnection = useComposerStore((s) => s.touchSshConnection);

  const [quickHost, setQuickHost] = useState("");
  const [quickUser, setQuickUser] = useState("");
  const [quickPort, setQuickPort] = useState("22");
  const [quickConnectionId, setQuickConnectionId] = useState("");
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [guidedStep, setGuidedStep] = useState(0);
  const [tunnelMode, setTunnelMode] = useState<"forward" | "socks">("socks");
  const [socksLocalPort, setSocksLocalPort] = useState("3000");
  const [savedSearch, setSavedSearch] = useState("");
  const [savedSort, setSavedSort] = useState<"recent" | "name" | "tunnels">("recent");
  const [savedSelectedIndex, setSavedSelectedIndex] = useState(0);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [customRules, setCustomRules] = useState<PortForwardRule[]>([]);
  const [presetSearch, setPresetSearch] = useState("");
  const savedSearchRef = useRef<HTMLInputElement | null>(null);

  const togglePreset = (name: string) => {
    setSelectedPresets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allSelectedRules: PortForwardRule[] = useMemo(() => {
    if (tunnelMode === "socks") {
      const socksPort = Number.parseInt(socksLocalPort, 10);
      if (!Number.isFinite(socksPort) || socksPort <= 0) return [];
      return [
        {
          id: nextRuleId(),
          type: "dynamic",
          localPort: socksPort,
          remoteHost: "",
          remotePort: 0,
          description: "SOCKS Proxy",
        },
      ];
    }
    const presetRules = TUNNEL_PRESETS
      .filter((p) => selectedPresets.has(p.name))
      .map((p) => ({
        id: nextRuleId(),
        type: p.type,
        localPort: p.localPort,
        remoteHost: p.remoteHost,
        remotePort: p.remotePort,
        description: p.name,
      }));
    return [...presetRules, ...customRules];
  }, [tunnelMode, socksLocalPort, selectedPresets, customRules]);

  const visiblePresets = useMemo(() => {
    const lower = presetSearch.trim().toLowerCase();
    if (!lower) return TUNNEL_PRESETS;
    return TUNNEL_PRESETS.filter(
      (preset) =>
        preset.name.toLowerCase().includes(lower) ||
        preset.description.toLowerCase().includes(lower) ||
        String(preset.localPort).includes(lower) ||
        String(preset.remotePort).includes(lower)
    );
  }, [presetSearch]);

  const parsedQuickPort = Number.parseInt(quickPort, 10);
  const hasValidPort = Number.isFinite(parsedQuickPort) && parsedQuickPort > 0;
  const effectiveQuickPort = hasValidPort ? parsedQuickPort : 22;
  const hasTarget = quickHost.trim().length > 0;
  const hasRules = allSelectedRules.length > 0;
  const hasInvalidRule = allSelectedRules.some((rule) => {
    if (rule.localPort <= 0) return true;
    if (rule.type === "dynamic") return false;
    return rule.remotePort <= 0 || !rule.remoteHost?.trim();
  });
  const canRunTunnel = hasTarget && hasValidPort && hasRules && !hasInvalidRule;

  const executeCommand = useCallback(
    async (command: string, password?: string) => {
      if (!terminalOpen) {
        setTerminalOpen(true);
      }
      await dispatchSshExecuteWithAck({ detail: { command, password } });
    },
    [terminalOpen, setTerminalOpen]
  );

  const handleStartTunnel = useCallback(async () => {
    if (!quickHost.trim() || allSelectedRules.length === 0) return;

    const base = quickConnectionId
      ? sshItems.find((item) => item.id === quickConnectionId)?.sshData
      : null;

    const sshData: SshConnectionData = {
      host: quickHost,
      port: effectiveQuickPort,
      username: quickUser || "root",
      authMethod: base?.authMethod ?? "agent",
      keyFilePath: base?.keyFilePath ?? "",
      portForwards: allSelectedRules,
      advancedOptions: base ? { ...base.advancedOptions } : { ...DEFAULT_SSH_ADVANCED },
      lastConnected: Date.now(),
    };

    const command = buildSshCommand(sshData, true);
    const password =
      quickConnectionId && sshData.authMethod === "password"
        ? await getSshConnectionPassword(quickConnectionId).catch(() => null)
        : null;

    addHistoryEntry({
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      protocol: "ssh",
      method: tunnelMode === "socks" ? "SOCKS tunnel" : "SSH tunnel",
      target:
        tunnelMode === "socks"
          ? `${sshData.username}@${sshData.host} (SOCKS :${allSelectedRules[0]?.localPort ?? "?"})`
          : `${sshData.username}@${sshData.host} (${allSelectedRules.length} tunnels)`,
      timestamp: Date.now(),
    });

    await executeCommand(command, password ?? undefined);
  }, [
    quickHost,
    quickUser,
    effectiveQuickPort,
    tunnelMode,
    allSelectedRules,
    quickConnectionId,
    sshItems,
    addHistoryEntry,
    executeCommand,
  ]);

  const handleStartFromConnection = useCallback(
    async (item: ComposerItem) => {
      if (!item.sshData) return;
      const mergedForwards = [...item.sshData.portForwards];
      for (const rule of allSelectedRules) {
        if (!mergedForwards.some((r) => r.localPort === rule.localPort && r.type === rule.type)) {
          mergedForwards.push(rule);
        }
      }
      const data: SshConnectionData = { ...item.sshData, portForwards: mergedForwards };
      const command = buildSshCommand(data, true);
      const password =
        data.authMethod === "password"
          ? await getSshConnectionPassword(item.id).catch(() => null)
          : null;
      touchSshConnection(item.id);
      addHistoryEntry({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: "ssh",
        method: "SSH tunnel",
        target: `${data.username}@${data.host} (${mergedForwards.length} tunnels)`,
        timestamp: Date.now(),
        itemId: item.id,
      });
      await executeCommand(command, password ?? undefined);
    },
    [allSelectedRules, touchSshConnection, addHistoryEntry, executeCommand]
  );

  const handleSaveAsConnection = useCallback(() => {
    if (!quickHost.trim() || allSelectedRules.length === 0) return;
    const existing = quickConnectionId
      ? sshItems.find((item) => item.id === quickConnectionId && item.protocol === "ssh" && item.sshData)
      : null;

    if (existing?.sshData) {
      updateItem(existing.id, {
        name:
          tunnelMode === "socks"
            ? `SOCKS — ${quickUser || "root"}@${quickHost}:${allSelectedRules[0]?.localPort ?? 1080}`
            : existing.name,
        sshData: {
          ...existing.sshData,
          host: quickHost,
          port: effectiveQuickPort,
          username: quickUser || "root",
          portForwards: allSelectedRules,
        },
      });
      return;
    }

    const now = Date.now();
    const item: ComposerItem = {
      id: newItemId(),
      protocol: "ssh",
      name:
        tunnelMode === "socks"
          ? `SOCKS — ${quickUser || "root"}@${quickHost}:${allSelectedRules[0]?.localPort ?? 1080}`
          : `Tunnel — ${quickUser || "root"}@${quickHost}`,
      folderId: null,
      notes: "",
      color: "",
      createdAt: now,
      updatedAt: now,
      sshData: {
        host: quickHost,
        port: effectiveQuickPort,
        username: quickUser || "root",
        authMethod: "agent",
        keyFilePath: "",
        portForwards: allSelectedRules,
        advancedOptions: { ...DEFAULT_SSH_ADVANCED },
        lastConnected: null,
      },
    };
    addItem(item);
  }, [
    quickHost,
    quickUser,
    effectiveQuickPort,
    tunnelMode,
    allSelectedRules,
    quickConnectionId,
    sshItems,
    addItem,
    updateItem,
  ]);

  const connectionsWithTunnels = sshItems.filter((i) => (i.sshData?.portForwards.length ?? 0) > 0);
  const filteredSavedConnections = useMemo(() => {
    const lower = savedSearch.trim().toLowerCase();
    const filtered = connectionsWithTunnels.filter((item) => {
      const ssh = item.sshData!;
      if (!lower) return true;
      return (
        item.name.toLowerCase().includes(lower) ||
        ssh.host.toLowerCase().includes(lower) ||
        ssh.username.toLowerCase().includes(lower) ||
        String(ssh.port).includes(lower) ||
        ssh.portForwards.some((fwd) => String(fwd.localPort).includes(lower))
      );
    });

    return [...filtered].sort((a, b) => {
      if (savedSort === "name") return a.name.localeCompare(b.name);
      if (savedSort === "tunnels") {
        const delta = (b.sshData?.portForwards.length ?? 0) - (a.sshData?.portForwards.length ?? 0);
        if (delta !== 0) return delta;
      }
      return (b.sshData?.lastConnected ?? 0) - (a.sshData?.lastConnected ?? 0);
    });
  }, [connectionsWithTunnels, savedSearch, savedSort]);
  const targetConnections = useMemo(
    () => sshItems.filter((i) => i.sshData && i.sshData.host.trim().length > 0),
    [sshItems]
  );
  const quickPreviewCommand = useMemo(() => {
    if (!canRunTunnel) return "";
    const previewData: SshConnectionData = {
      host: quickHost.trim(),
      port: effectiveQuickPort,
      username: quickUser.trim() || "root",
      authMethod: "agent",
      keyFilePath: "",
      portForwards: allSelectedRules,
      advancedOptions: { ...DEFAULT_SSH_ADVANCED },
      lastConnected: null,
    };
    return buildSshCommand(previewData, true);
  }, [canRunTunnel, quickHost, quickUser, effectiveQuickPort, allSelectedRules]);

  const openGuidedSetup = useCallback(() => {
    setGuidedStep(0);
    setGuidedOpen(true);
  }, []);

  useEffect(() => {
    if (!showSavedConnections) return;
    setSavedSelectedIndex((idx) => {
      if (filteredSavedConnections.length === 0) return 0;
      return Math.min(idx, filteredSavedConnections.length - 1);
    });
  }, [showSavedConnections, filteredSavedConnections.length]);

  useEffect(() => {
    if (!showSavedConnections) return;
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("input, textarea, select, [contenteditable]"));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        savedSearchRef.current?.focus();
        savedSearchRef.current?.select();
        return;
      }
      if (isEditable(e.target)) return;
      if (filteredSavedConnections.length === 0) return;
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSavedSelectedIndex((i) => (i + 1) % filteredSavedConnections.length);
        return;
      }
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSavedSelectedIndex((i) => (i - 1 + filteredSavedConnections.length) % filteredSavedConnections.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const current = filteredSavedConnections[savedSelectedIndex];
        if (!current) return;
        handleStartFromConnection(current);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSavedConnections, filteredSavedConnections, savedSelectedIndex, handleStartFromConnection]);

  return (
    <div className={compactLauncher ? "" : "space-y-6"}>
      {compactLauncher ? (
        <Button size="sm" className="h-8 text-xs gap-1.5 shrink-0" onClick={openGuidedSetup}>
          <ArrowRightLeft className="h-3 w-3" />
          Smart Tunnel
        </Button>
      ) : (
        <Card className="border-border/30 bg-muted/10 shadow-card">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <ArrowRightLeft className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm">Smart Tunnel Creator</CardTitle>
                <CardDescription className="text-xs mt-1">
                  Create SOCKS and forwarding tunnels from the same guided flow.
                </CardDescription>
              </div>
              <Button size="sm" className="h-8 text-xs gap-1.5 shrink-0" onClick={openGuidedSetup}>
                <Play className="h-3 w-3" />
                Open Setup
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      <Dialog
        open={guidedOpen}
        onOpenChange={(open) => {
          setGuidedOpen(open);
          if (!open) setGuidedStep(0);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Guided Tunnel Setup</DialogTitle>
            <DialogDescription>Step {guidedStep + 1} of 3: target, rules, then review and run.</DialogDescription>
          </DialogHeader>

          <div className="px-6 pb-4">
            <div className="subview-tabs-compact">
              <button
                type="button"
                data-state={guidedStep === 0 ? "active" : "inactive"}
                onClick={() => setGuidedStep(0)}
                className="subview-tab-compact"
              >
                Target
              </button>
              <button
                type="button"
                data-state={guidedStep === 1 ? "active" : "inactive"}
                onClick={() => {
                  if (hasTarget && hasValidPort) setGuidedStep(1);
                }}
                className="subview-tab-compact"
              >
                Mode & Rules
              </button>
              <button
                type="button"
                data-state={guidedStep === 2 ? "active" : "inactive"}
                onClick={() => {
                  if (hasTarget && hasValidPort && hasRules) setGuidedStep(2);
                }}
                className="subview-tab-compact"
              >
                Review
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
          {guidedStep === 0 ? (
            <div className="space-y-2.5">
              <p className="text-2xs text-muted-foreground">Choose a target host and SSH identity.</p>
              <div className="grid grid-cols-[1fr_140px_110px] gap-2">
                <Input
                  placeholder="hostname or IP"
                  value={quickHost}
                  onChange={(e) => {
                    setQuickHost(e.target.value);
                  }}
                  className="h-9 text-sm font-mono"
                />
                <Input
                  placeholder="username (default root)"
                  value={quickUser}
                  onChange={(e) => {
                    setQuickUser(e.target.value);
                  }}
                  className="h-9 text-sm"
                />
                <Input
                  placeholder="port"
                  value={quickPort}
                  onChange={(e) => {
                    setQuickPort(e.target.value);
                  }}
                  className="h-9 text-sm font-mono"
                />
              </div>
              {targetConnections.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-3xs text-muted-foreground">Use saved target</p>
                  <AppDropdown
                    value={quickConnectionId}
                    onValueChange={(id) => {
                      setQuickConnectionId(id);
                      if (!id) return;
                      const match = targetConnections.find((item) => item.id === id);
                      if (!match?.sshData) return;
                      setQuickHost(match.sshData.host);
                      setQuickUser(match.sshData.username ?? "");
                      setQuickPort(String(match.sshData.port ?? 22));
                    }}
                    options={targetConnections.map((item) => ({
                      value: item.id,
                      label: `${item.name} (${item.sshData?.username}@${item.sshData?.host}:${item.sshData?.port ?? 22})`,
                    }))}
                    placeholder="Select a saved SSH connection..."
                    className="h-8 text-xs w-full"
                    size="sm"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {guidedStep === 1 ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTunnelMode("socks")}
                  className={cn(
                    "text-left rounded-lg border px-3 py-2 transition-smooth",
                    tunnelMode === "socks"
                      ? "border-primary/40 bg-primary/10"
                      : "border-border/30 bg-muted/15 hover:bg-muted/25"
                  )}
                >
                  <p className="text-xs font-medium text-foreground">SOCKS Proxy</p>
                  <p className="text-3xs text-muted-foreground mt-0.5">Primary flow: true dynamic tunnel (`ssh -N -D`).</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTunnelMode("forward")}
                  className={cn(
                    "text-left rounded-lg border px-3 py-2 transition-smooth",
                    tunnelMode === "forward"
                      ? "border-primary/40 bg-primary/10"
                      : "border-border/30 bg-muted/15 hover:bg-muted/25"
                  )}
                >
                  <p className="text-xs font-medium text-foreground">Port Forwarding</p>
                  <p className="text-3xs text-muted-foreground mt-0.5">Classic `-L` / `-R` forwarding rules.</p>
                </button>
              </div>

              {tunnelMode === "socks" ? (
                <div className="space-y-2">
                  <p className="text-2xs text-muted-foreground">
                    Choose the local SOCKS listen port. Applications should use `127.0.0.1:PORT` as SOCKS5 proxy.
                  </p>
                  <div className="max-w-[220px]">
                    <Input
                      value={socksLocalPort}
                      onChange={(e) => setSocksLocalPort(e.target.value)}
                      placeholder="SOCKS local port"
                      className="h-9 text-sm font-mono"
                    />
                  </div>
                </div>
              ) : null}

              {tunnelMode === "forward" ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-2xs text-muted-foreground">Select preset rules or add custom forwards.</p>
                    <div className="relative w-64">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
                      <Input
                        value={presetSearch}
                        onChange={(e) => setPresetSearch(e.target.value)}
                        placeholder="Filter presets..."
                        className="h-7 pl-8 text-2xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {visiblePresets.map((preset) => {
                      const selected = selectedPresets.has(preset.name);
                      return (
                        <button
                          key={preset.name}
                          type="button"
                          onClick={() => togglePreset(preset.name)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-smooth",
                            selected
                              ? "bg-primary/10 shadow-card text-primary"
                              : "bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                          )}
                        >
                          {selected && <Check className="h-3 w-3" />}
                          {preset.name}
                          <span className="text-2xs opacity-60">:{preset.localPort}</span>
                        </button>
                      );
                    })}
                  </div>

                  {customRules.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-2xs font-medium text-muted-foreground">Custom Rules</p>
                      <PortForwardingEditor rules={customRules} onChange={setCustomRules} />
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="neutral"
                      size="sm"
                      onClick={() =>
                        setCustomRules((r) => [
                          ...r,
                          {
                            id: nextRuleId(),
                            type: "local",
                            localPort: 0,
                            remoteHost: "localhost",
                            remotePort: 0,
                            description: "",
                          },
                        ])
                      }
                      className="gap-1.5 text-xs h-8"
                    >
                      <Plus className="h-3 w-3" />
                      Custom Rule
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedPresets(new Set());
                        setCustomRules([]);
                      }}
                      className="text-xs h-8"
                    >
                      Clear Selection
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {guidedStep === 2 ? (
            <div className="space-y-2.5">
              <div className="rounded-lg border border-border/30 bg-muted/20 px-2.5 py-2 space-y-1">
                <p className="text-2xs text-muted-foreground">
                  {tunnelMode === "socks"
                    ? `SOCKS proxy on local :${allSelectedRules[0]?.localPort ?? "?"}.`
                    : `${allSelectedRules.length} selected rule${allSelectedRules.length !== 1 ? "s" : ""}.`}
                  {!hasTarget ? " Add a host." : ""}
                  {!hasValidPort ? " Enter a valid port." : ""}
                  {!hasRules ? (tunnelMode === "socks" ? " Enter a valid SOCKS local port." : " Select at least one rule.") : ""}
                  {hasInvalidRule ? " Fix invalid ports/hosts in selected rules." : ""}
                </p>
                {quickPreviewCommand ? (
                  <code className="block text-3xs font-mono text-foreground/80 break-all">{quickPreviewCommand}</code>
                ) : null}
              </div>
            </div>
          ) : null}
          </div>

          <DialogFooter className="surface-subtle sticky bottom-0 z-10 px-6 py-4 border-t border-border/50 flex-row justify-between sm:justify-between">
            <div className="mr-auto">
              {guidedStep > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setGuidedStep((s) => Math.max(0, s - 1))} className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {guidedStep < 2 ? (
                <Button
                  size="sm"
                  onClick={() => setGuidedStep((s) => Math.min(2, s + 1))}
                  disabled={(guidedStep === 0 && (!hasTarget || !hasValidPort)) || (guidedStep === 1 && !hasRules)}
                  className="gap-1.5"
                >
                  Next
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <>
                  <Button variant="neutral" size="sm" onClick={handleSaveAsConnection} disabled={!canRunTunnel}>
                    {quickConnectionId ? "Update Connection" : "Save as Connection"}
                  </Button>
                  <Button
                    size="sm"
                    variant="positive"
                    onClick={() => {
                      handleStartTunnel();
                      setGuidedOpen(false);
                    }}
                    disabled={!canRunTunnel}
                    className="disabled:opacity-50"
                  >
                    {tunnelMode === "socks" ? "Start SOCKS Proxy" : "Start Tunnel"}
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Saved connections with tunnels */}
      {showSavedConnections && connectionsWithTunnels.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-border/20">
          <div className="flex items-center gap-2">
            <h3 className="section-label">Saved Tunnel Connections</h3>
            <div className="flex-1" />
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
              <Input
                ref={savedSearchRef}
                value={savedSearch}
                onChange={(e) => setSavedSearch(e.target.value)}
                placeholder="Filter saved tunnels..."
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border/30 bg-muted/20 p-0.5">
              <button
                type="button"
                onClick={() => setSavedSort("recent")}
                className={cn(
                  "h-7 px-2.5 rounded text-2xs transition-smooth",
                  savedSort === "recent" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Recent
              </button>
              <button
                type="button"
                onClick={() => setSavedSort("name")}
                className={cn(
                  "h-7 px-2.5 rounded text-2xs transition-smooth",
                  savedSort === "name" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Name
              </button>
              <button
                type="button"
                onClick={() => setSavedSort("tunnels")}
                className={cn(
                  "h-7 px-2.5 rounded text-2xs transition-smooth",
                  savedSort === "tunnels" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Tunnels
              </button>
            </div>
          </div>

          <p className="text-2xs text-muted-foreground">
            {filteredSavedConnections.length} result{filteredSavedConnections.length !== 1 ? "s" : ""} •{" "}
            <code className="font-mono">/</code> search, <code className="font-mono">j/k</code> navigate,{" "}
            <code className="font-mono">Enter</code> start
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredSavedConnections.map((item, idx) => {
              const ssh = item.sshData!;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-md surface shadow-card px-3.5 py-3 hover:bg-card hover-lift transition-smooth",
                    idx === savedSelectedIndex ? "ring-1 ring-primary/30 bg-card" : ""
                  )}
                  onMouseEnter={() => setSavedSelectedIndex(idx)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary shrink-0">
                      <ArrowRightLeft className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground truncate">{item.name}</p>
                      <p className="text-2xs text-muted-foreground font-mono truncate">
                        {ssh.username}@{ssh.host}
                        {ssh.port !== 22 ? `:${ssh.port}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2.5">
                    <Badge variant="secondary" className="text-3xs px-1.5 py-0">
                      {ssh.portForwards.length} tunnel{ssh.portForwards.length !== 1 ? "s" : ""}
                    </Badge>
                    {ssh.lastConnected ? (
                      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground/60 ml-auto">
                        <Clock className="h-2.5 w-2.5" />
                        {timeAgo(ssh.lastConnected)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1 mt-2">
                    <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                      {ssh.portForwards.slice(0, 2).map((fwd) => (
                        <Badge key={fwd.id} variant="secondary" className="text-3xs px-1 py-0">
                          {fwd.type === "dynamic" ? `-D :${fwd.localPort}` : `:${fwd.localPort}`}
                        </Badge>
                      ))}
                      {ssh.portForwards.length > 2 ? (
                        <Badge variant="secondary" className="text-3xs px-1 py-0">
                          +{ssh.portForwards.length - 2}
                        </Badge>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="neutral"
                      onClick={() => handleStartFromConnection(item)}
                      className="h-7 text-xs gap-1.5"
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                      Start
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredSavedConnections.length === 0 ? (
            <EmptyState compact variant="inline" title="No saved tunnel connections" description={`No connection matches "${savedSearch}".`} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Port Profiles View ──────────────────────────────────────────────────────

function PortProfilesView() {
  const profiles = useComposerStore((s) => s.portProfiles);
  const addPortProfile = useComposerStore((s) => s.addPortProfile);
  const updatePortProfile = useComposerStore((s) => s.updatePortProfile);
  const deletePortProfile = useComposerStore((s) => s.deletePortProfile);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const filteredProfiles = useMemo(() => {
    const lower = search.trim().toLowerCase();
    if (!lower) return profiles;
    return profiles.filter(
      (profile) =>
        profile.name.toLowerCase().includes(lower) ||
        profile.description.toLowerCase().includes(lower) ||
        profile.rules.some((rule) => `${rule.localPort}:${rule.remotePort}`.includes(lower))
    );
  }, [profiles, search]);

  const handleCreate = () => {
    const id = `profile-${Date.now()}`;
    addPortProfile({
      id,
      name: "New Profile",
      description: "",
      rules: [],
      createdAt: Date.now(),
    });
    setEditingId(id);
  };

  useEffect(() => {
    setSelectedIndex((idx) => {
      if (filteredProfiles.length === 0) return 0;
      return Math.min(idx, filteredProfiles.length - 1);
    });
  }, [filteredProfiles.length]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("input, textarea, select, [contenteditable]"));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (isEditable(e.target)) return;
      if (filteredProfiles.length === 0) return;
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredProfiles.length);
        return;
      }
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filteredProfiles.length) % filteredProfiles.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const current = filteredProfiles[selectedIndex];
        if (!current) return;
        setEditingId((id) => (id === current.id ? null : current.id));
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [filteredProfiles, selectedIndex]);

  if (profiles.length === 0) {
    return (
      <EmptyState
        variant="inline"
        icon={<Layers />}
        title="No port profiles"
        description="Create reusable port forwarding templates for quick setup."
        action={
          <Button size="sm" variant="neutral" className="gap-1.5" onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5" />
            New Profile
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter profiles..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {filteredProfiles.length} profile{filteredProfiles.length !== 1 ? "s" : ""}
        </p>
        <Button variant="neutral" size="sm" onClick={handleCreate} className="gap-1.5 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" />
          New Profile
        </Button>
      </div>

      <p className="text-2xs text-muted-foreground">
        <code className="font-mono">/</code> search, <code className="font-mono">j/k</code> navigate,{" "}
        <code className="font-mono">Enter</code> toggle edit.
      </p>

      <div className="space-y-3">
        {filteredProfiles.map((profile, idx) => {
          const isEditing = editingId === profile.id;
          return (
            <Card key={profile.id} className={cn("overflow-hidden", idx === selectedIndex ? "ring-1 ring-primary/30" : "")}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  {isEditing ? (
                    <Input
                      value={profile.name}
                      onChange={(e) => updatePortProfile(profile.id, { name: e.target.value })}
                      className="h-7 text-sm font-semibold w-48"
                      autoFocus
                    />
                  ) : (
                    <CardTitle className="text-sm">{profile.name}</CardTitle>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-2xs">
                      {profile.rules.length} rule{profile.rules.length !== 1 ? "s" : ""}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(isEditing ? null : profile.id)}
                      className="h-7 text-xs"
                    >
                      {isEditing ? "Done" : "Edit"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(profile.id)}
                      className="h-7 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isEditing && (
                  <Input
                    placeholder="Description (optional)"
                    value={profile.description}
                    onChange={(e) => updatePortProfile(profile.id, { description: e.target.value })}
                    className="h-7 text-xs mt-1"
                  />
                )}
                {!isEditing && profile.description && (
                  <CardDescription className="text-xs">{profile.description}</CardDescription>
                )}
              </CardHeader>
              {isEditing && (
                <CardContent>
                  <PortForwardingEditor
                    rules={profile.rules}
                    onChange={(rules) => updatePortProfile(profile.id, { rules })}
                  />
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {filteredProfiles.length === 0 ? (
        <EmptyState
          compact
          variant="inline"
          title="No profiles found"
          description={`No profile matches "${search}".`}
        />
      ) : null}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete Profile"
        description="This will permanently remove this port profile."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteId) deletePortProfile(deleteId);
          setDeleteId(null);
        }}
      />
    </div>
  );
}
