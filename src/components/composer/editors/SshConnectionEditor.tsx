/**
 * SSH Connection Editor — inline form replacing the old wizard modal.
 * Collapsible sections: Connection · Port Forwarding · Advanced · Command Preview.
 * Connect button dispatches `ssh:execute` custom event.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useComposerStore } from "@/stores/composerStore";
import { useLayoutStore } from "@/stores/layoutStore";
import {
  deleteSshConnectionPassword,
  getSshConnectionPassword,
  setSshConnectionPassword,
} from "@/api/sshPasswords";
import { dispatchSshExecuteWithAck } from "@/lib/sshExecute";
import { PortForwardingEditor } from "@/components/ssh-helper/PortForwardingEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Settings,
  Zap,
  SshKey,
  Eye,
  EyeOff,
} from "@/lib/icons";
import type {
  ComposerItem,
  SshConnectionData,
  SshAdvancedOptions,
} from "@/types/composer";

// ── Build SSH command ───────────────────────────────────────────────────────

function buildSshCommand(data: SshConnectionData): string {
  const parts: string[] = ["ssh"];
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

// ── Component ───────────────────────────────────────────────────────────────

interface Props {
  item: ComposerItem;
}

export function SshConnectionEditor({ item }: Props) {
  const updateItem = useComposerStore((s) => s.updateItem);
  const markTabDirty = useComposerStore((s) => s.markTabDirty);
  const touchSshConnection = useComposerStore((s) => s.touchSshConnection);
  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const terminalOpen = useLayoutStore((s) => s.terminalOpen);
  const setTerminalOpen = useLayoutStore((s) => s.setTerminalOpen);

  const ssh = item.sshData!;
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  // Collapsible sections
  const [openSections, setOpenSections] = useState({
    connection: true,
    forwarding: false,
    advanced: false,
    preview: true,
  });

  const toggle = useCallback((section: keyof typeof openSections) => {
    setOpenSections((s) => ({ ...s, [section]: !s[section] }));
  }, []);

  const setData = useCallback(
    (updates: Partial<SshConnectionData>) => {
      updateItem(item.id, { sshData: { ...ssh, ...updates } });
      markTabDirty(item.id, true);
    },
    [updateItem, item.id, ssh, markTabDirty]
  );

  const setAdvanced = useCallback(
    (updates: Partial<SshAdvancedOptions>) => {
      setData({ advancedOptions: { ...ssh.advancedOptions, ...updates } });
    },
    [setData, ssh.advancedOptions]
  );

  const command = useMemo(() => buildSshCommand(ssh), [ssh]);

  useEffect(() => {
    let cancelled = false;

    if (ssh.authMethod !== "password") {
      setPassword("");
      setRememberPassword(true);
      return;
    }

    void (async () => {
      try {
        const saved = await getSshConnectionPassword(item.id);
        if (cancelled) return;
        setPassword(saved ?? "");
        // Keep remember enabled by default so new password entries persist.
        setRememberPassword(true);
      } catch {
        if (cancelled) return;
        setPassword("");
        setRememberPassword(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item.id, ssh.authMethod]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  const handleConnect = useCallback(async () => {
    if (ssh.authMethod === "password") {
      if (rememberPassword && password) {
        await setSshConnectionPassword(item.id, password);
      } else {
        await deleteSshConnectionPassword(item.id);
      }
    }

    if (!terminalOpen) {
      setTerminalOpen(true);
    }
    await dispatchSshExecuteWithAck({
      detail: {
        command,
        ...(ssh.authMethod === "password" ? { password } : {}),
      },
    });
    touchSshConnection(item.id);
    addHistoryEntry({
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      protocol: "ssh",
      method: "SSH connect",
      target: `${ssh.username}@${ssh.host}`,
      timestamp: Date.now(),
      itemId: item.id,
    });
  }, [command, touchSshConnection, item.id, addHistoryEntry, ssh.username, ssh.host, ssh.authMethod, password, rememberPassword, terminalOpen, setTerminalOpen]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-4 space-y-3">
        {/* ── Action bar ─────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pb-3 border-b border-border/40">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <SshKey className="h-5 w-5 text-primary shrink-0" />
            <input
              value={item.name}
              onChange={(e) => {
                updateItem(item.id, { name: e.target.value });
                markTabDirty(item.id, true);
              }}
              className="bg-transparent border-none outline-none text-sm font-medium text-foreground flex-1 min-w-0"
              placeholder="Connection name"
            />
          </div>
          <Button variant="neutral" size="sm" onClick={handleCopy} className="gap-1.5 h-8 text-xs shrink-0">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy Command"}
          </Button>
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={!ssh.host.trim() || (ssh.authMethod === "password" && !password)}
            className="gap-1.5 h-8"
          >
            <Play className="h-3.5 w-3.5" />
            Connect
          </Button>
        </div>

        {/* ── Connection section ──────────────────────────────────── */}
        <CollapsibleSection
          title="Connection"
          icon={<Globe className="h-3.5 w-3.5" />}
          open={openSections.connection}
          onToggle={() => toggle("connection")}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs text-muted-foreground mb-1">Host</Label>
              <Input
                value={ssh.host}
                onChange={(e) => setData({ host: e.target.value })}
                placeholder="192.168.1.1 or hostname"
                className="h-8 text-sm font-mono"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1">Port</Label>
              <Input
                type="number"
                value={ssh.port}
                onChange={(e) => setData({ port: parseInt(e.target.value) || 22 })}
                className="h-8 text-sm font-mono"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1">Username</Label>
              <Input
                value={ssh.username}
                onChange={(e) => setData({ username: e.target.value })}
                placeholder="root"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1">Auth Method</Label>
              <Select
                value={ssh.authMethod}
                onValueChange={(v) => {
                  const next = v as SshConnectionData["authMethod"];
                  setData({ authMethod: next });
                  if (next !== "password") {
                    setPassword("");
                    setRememberPassword(true);
                    setShowPassword(false);
                    void deleteSshConnectionPassword(item.id);
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">SSH Agent</SelectItem>
                  <SelectItem value="key">Key File</SelectItem>
                  <SelectItem value="password">Password</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ssh.authMethod === "key" && (
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground mb-1">Key File Path</Label>
                <Input
                  value={ssh.keyFilePath}
                  onChange={(e) => setData({ keyFilePath: e.target.value })}
                  placeholder="~/.ssh/id_rsa"
                  className="h-8 text-sm font-mono"
                />
              </div>
            )}
            {ssh.authMethod === "password" && (
              <>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground mb-1">Password</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => {
                        if (!rememberPassword) return;
                        if (!password) {
                          void deleteSshConnectionPassword(item.id);
                          return;
                        }
                        void setSshConnectionPassword(item.id, password);
                      }}
                      placeholder="SSH password"
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      variant="neutral"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <Label className="text-xs text-muted-foreground">Remember password securely</Label>
                  <Switch
                    checked={rememberPassword}
                    onCheckedChange={(checked) => {
                      setRememberPassword(checked);
                      if (!checked) {
                        void deleteSshConnectionPassword(item.id);
                      } else if (password) {
                        void setSshConnectionPassword(item.id, password);
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </CollapsibleSection>

        {/* ── Port Forwarding section ────────────────────────────── */}
        <CollapsibleSection
          title="Port Forwarding"
          icon={<Zap className="h-3.5 w-3.5" />}
          open={openSections.forwarding}
          onToggle={() => toggle("forwarding")}
          badge={ssh.portForwards.length > 0 ? String(ssh.portForwards.length) : undefined}
        >
          <PortForwardingEditor
            rules={ssh.portForwards}
            onChange={(rules) => setData({ portForwards: rules })}
          />
        </CollapsibleSection>

        {/* ── Advanced section ────────────────────────────────────── */}
        <CollapsibleSection
          title="Advanced Options"
          icon={<Settings className="h-3.5 w-3.5" />}
          open={openSections.advanced}
          onToggle={() => toggle("advanced")}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Compression</Label>
              <Switch
                checked={ssh.advancedOptions.compression}
                onCheckedChange={(v) => setAdvanced({ compression: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1">Keep Alive Interval (s)</Label>
                <Input
                  type="number"
                  value={ssh.advancedOptions.keepAliveInterval}
                  onChange={(e) => setAdvanced({ keepAliveInterval: parseInt(e.target.value) || 0 })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">Keep Alive Max Count</Label>
                <Input
                  type="number"
                  value={ssh.advancedOptions.keepAliveCountMax}
                  onChange={(e) => setAdvanced({ keepAliveCountMax: parseInt(e.target.value) || 3 })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">Connection Timeout (s)</Label>
                <Input
                  type="number"
                  value={ssh.advancedOptions.connectionTimeout}
                  onChange={(e) => setAdvanced({ connectionTimeout: parseInt(e.target.value) || 30 })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">StrictHostKeyChecking</Label>
                <Select
                  value={ssh.advancedOptions.strictHostKeyChecking}
                  onValueChange={(v) => setAdvanced({ strictHostKeyChecking: v as "yes" | "no" | "ask" })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">Ask</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1">Jump Host</Label>
              <Input
                value={ssh.advancedOptions.jumpHost}
                onChange={(e) => setAdvanced({ jumpHost: e.target.value })}
                placeholder="user@jump.example.com"
                className="h-8 text-sm font-mono"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1">Custom Flags</Label>
              <Input
                value={ssh.advancedOptions.customFlags}
                onChange={(e) => setAdvanced({ customFlags: e.target.value })}
                placeholder="-v -o ForwardAgent=yes"
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Command Preview section ────────────────────────────── */}
        <CollapsibleSection
          title="Command Preview"
          icon={<Play className="h-3.5 w-3.5" />}
          open={openSections.preview}
          onToggle={() => toggle("preview")}
        >
          <pre className="font-mono text-xs bg-muted/30 p-3 rounded-lg whitespace-pre-wrap break-all select-all">
            {command}
          </pre>
        </CollapsibleSection>
      </div>
    </div>
  );
}

// ── Collapsible section ─────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  icon,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-muted/30 transition-smooth"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="text-muted-foreground">{icon}</span>
        <span>{title}</span>
        {badge && (
          <span className="ml-auto text-2xs font-mono text-muted-foreground bg-muted/50 rounded-full px-1.5 py-0.5">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 animate-in fade-in-0 slide-in-from-top-1 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
          {children}
        </div>
      )}
    </div>
  );
}
