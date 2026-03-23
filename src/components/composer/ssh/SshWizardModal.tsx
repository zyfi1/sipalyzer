/**
 * SSH Wizard Modal — 4-step guided SSH connection setup using composerStore.
 *
 * Steps: Connection → Port Forwarding → Advanced → Review
 *
 * Adapted from the legacy SshWizardModal but targeting the unified composer store.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AppDropdown } from "@/components/ui/app-dropdown";
import {
  ArrowRight,
  ArrowLeft,
  Play,
  Copy,
  Save,
  Check,
  Globe,
  Settings,
  Zap,
  Eye,
  EyeOff,
} from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { cn } from "@/lib/utils";
import { PortForwardingEditor } from "@/components/ssh-helper/PortForwardingEditor";
import { useComposerStore, newItemId } from "@/stores/composerStore";
import { useToastContext } from "@/contexts/ToastContext";
import type {
  ComposerItem,
  SshConnectionData,
  PortForwardRule,
  SshAdvancedOptions,
} from "@/types/composer";
import { DEFAULT_SSH_ADVANCED } from "@/types/composer";
import {
  deleteSshConnectionPassword,
  getSshConnectionPassword,
  setSshConnectionPassword,
} from "@/api/sshPasswords";

const STEPS = [
  { id: "connection", label: "Connection", icon: Globe },
  { id: "forwarding", label: "Port Forwarding", icon: Zap },
  { id: "advanced", label: "Advanced", icon: Settings },
  { id: "review", label: "Review", icon: Play },
] as const;

type StepId = (typeof STEPS)[number]["id"];

interface SshWizardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editItem?: ComposerItem | null;
}

export function SshWizardModal({ open, onOpenChange, editItem }: SshWizardModalProps) {
  const [step, setStep] = useState<StepId>("connection");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<SshConnectionData["authMethod"]>("agent");
  const [keyFilePath, setKeyFilePath] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [portForwards, setPortForwards] = useState<PortForwardRule[]>([]);
  const [advanced, setAdvanced] = useState<SshAdvancedOptions>({ ...DEFAULT_SSH_ADVANCED });

  const addItem = useComposerStore((s) => s.addItem);
  const updateItem = useComposerStore((s) => s.updateItem);
  const latestEditItem = useComposerStore((s) =>
    editItem ? s.collections.items.find((i) => i.id === editItem.id) ?? null : null
  );
  const toast = useToastContext();
  const existingSshItems = useComposerStore((s) =>
    s.collections.items.filter((i) => i.protocol === "ssh")
  );

  useEffect(() => {
    let cancelled = false;
    if (!open) return;
    const sourceItem = latestEditItem ?? editItem ?? null;
    if (sourceItem?.sshData) {
      const d = sourceItem.sshData;
      setName(sourceItem.name);
      setHost(d.host);
      setPort(d.port);
      setUsername(d.username);
      setAuthMethod(d.authMethod);
      setKeyFilePath(d.keyFilePath);
      setPassword("");
      setRememberPassword(true);
      setShowPassword(false);
      setPortForwards([...d.portForwards]);
      setAdvanced({ ...d.advancedOptions });
      if (d.authMethod === "password") {
        void (async () => {
          try {
            const saved = await getSshConnectionPassword(sourceItem.id);
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
      }
    } else {
      setName("");
      setHost("");
      setPort(22);
      setUsername("");
      setAuthMethod("agent");
      setKeyFilePath("");
      setPassword("");
      setRememberPassword(true);
      setShowPassword(false);
      setPortForwards([]);
      setAdvanced({ ...DEFAULT_SSH_ADVANCED });
    }
    setStep("connection");
    setCopied(false);
    return () => {
      cancelled = true;
    };
  }, [open, editItem, latestEditItem]);

  const sshData = useMemo((): SshConnectionData => ({
    host,
    port,
    username,
    authMethod,
    keyFilePath,
    portForwards,
    advancedOptions: advanced,
    lastConnected: (latestEditItem ?? editItem)?.sshData?.lastConnected ?? null,
  }), [host, port, username, authMethod, keyFilePath, portForwards, advanced, editItem, latestEditItem]);

  const connectionName = name || `${username || "user"}@${host || "host"}`;

  const command = useMemo(() => {
    const parts: string[] = ["ssh"];
    if (port !== 22) parts.push(`-p ${port}`);
    if (authMethod === "key" && keyFilePath) parts.push(`-i ${keyFilePath}`);
    if (advanced.compression) parts.push("-C");
    for (const rule of portForwards) {
      switch (rule.type) {
        case "local":
          parts.push(`-L ${rule.localPort}:${rule.remoteHost}:${rule.remotePort}`);
          break;
        case "remote":
          parts.push(`-R ${rule.remotePort}:${rule.remoteHost}:${rule.localPort}`);
          break;
        case "dynamic":
          parts.push(`-D ${rule.localPort}`);
          break;
      }
    }
    if (advanced.keepAliveInterval > 0) {
      parts.push(`-o ServerAliveInterval=${advanced.keepAliveInterval}`);
      parts.push(`-o ServerAliveCountMax=${advanced.keepAliveCountMax}`);
    }
    if (advanced.strictHostKeyChecking !== "ask") {
      parts.push(`-o StrictHostKeyChecking=${advanced.strictHostKeyChecking}`);
    }
    if (advanced.connectionTimeout > 0 && advanced.connectionTimeout !== 30) {
      parts.push(`-o ConnectTimeout=${advanced.connectionTimeout}`);
    }
    if (advanced.jumpHost) parts.push(`-J ${advanced.jumpHost}`);
    if (advanced.customFlags.trim()) parts.push(advanced.customFlags.trim());
    parts.push(`${username || "root"}@${host || "host"}`);
    return parts.join(" ");
  }, [host, port, username, authMethod, keyFilePath, portForwards, advanced]);

  const canProceedFromConnection = host.trim().length > 0 && (authMethod !== "password" || password.length > 0);
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const isEditMode = Boolean(latestEditItem ?? editItem);

  const goNext = useCallback(() => {
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.id);
  }, [stepIndex]);

  const goPrev = useCallback(() => {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev.id);
  }, [stepIndex]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    const id = (latestEditItem ?? editItem)?.id ?? newItemId();
    try {
      let passwordWarning: string | null = null;
      try {
        if (authMethod === "password" && rememberPassword && password) {
          await setSshConnectionPassword(id, password);
        } else {
          await deleteSshConnectionPassword(id);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Could not store SSH password securely.";
        passwordWarning = msg;
      }

      if (latestEditItem ?? editItem) {
        updateItem(id, { name: connectionName, sshData });
      } else {
        const now = Date.now();
        const item: ComposerItem = {
          id,
          protocol: "ssh",
          name: connectionName,
          folderId: null,
          notes: "",
          color: "",
          createdAt: now,
          updatedAt: now,
          sshData,
        };
        addItem(item);
      }

      const isEdit = Boolean(latestEditItem ?? editItem);
      toast.success(isEdit ? "Updated" : "Saved", `SSH connection ${isEdit ? "updated" : "saved"} successfully.`, {
        source: "composer",
      });
      if (passwordWarning) {
        toast.warning("Password not saved", passwordWarning, { source: "composer" });
      }
      onOpenChange(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save SSH connection.";
      toast.error("Save Failed", message, { source: "composer" });
    } finally {
      setSaving(false);
    }
  }, [saving, latestEditItem, editItem, connectionName, sshData, addItem, updateItem, onOpenChange, authMethod, rememberPassword, password, toast]);

  const handleAuthMethodChange = useCallback((next: SshConnectionData["authMethod"]) => {
    setAuthMethod(next);
    setShowPassword(false);
    if (next !== "password") {
      setPassword("");
      setRememberPassword(true);
    }
  }, []);

  const handleLoadExistingConnection = useCallback(async (item: ComposerItem) => {
    if (!item.sshData) return;
    setName(item.name);
    setHost(item.sshData.host);
    setPort(item.sshData.port);
    setUsername(item.sshData.username);
    setAuthMethod(item.sshData.authMethod);
    setKeyFilePath(item.sshData.keyFilePath);

    if (item.sshData.authMethod === "password") {
      try {
        const saved = await getSshConnectionPassword(item.id);
        setPassword(saved ?? "");
        // Keep remember enabled by default so new password entries persist.
        setRememberPassword(true);
      } catch {
        setPassword("");
        setRememberPassword(true);
      }
    } else {
      setPassword("");
      setRememberPassword(true);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-lg">
            {isEditMode ? "Edit Connection" : "SSH Quick Connect"}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update your saved SSH connection."
              : "Configure and save an SSH connection."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="px-6 pb-4">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isCurrent = s.id === step;
              const isPast = i < stepIndex;
              return (
                <div key={s.id} className="flex items-center flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditMode || i <= stepIndex || canProceedFromConnection) setStep(s.id);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-smooth w-full",
                      isCurrent
                        ? "bg-accent text-foreground shadow-sm"
                        : isPast
                          ? "bg-accent text-foreground hover:bg-muted/40"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate hidden sm:inline">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div
                      className={cn(
                        "h-px w-4 mx-1 flex-shrink-0 transition-smooth",
                        isPast ? "bg-foreground/30" : "bg-border"
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
          {step === "connection" && (
            <StepConnection
              isEditing={Boolean(latestEditItem ?? editItem)}
              name={name}
              setName={setName}
              host={host}
              setHost={setHost}
              port={port}
              setPort={setPort}
              username={username}
              setUsername={setUsername}
              authMethod={authMethod}
              setAuthMethod={handleAuthMethodChange}
              keyFilePath={keyFilePath}
              setKeyFilePath={setKeyFilePath}
              password={password}
              setPassword={setPassword}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              rememberPassword={rememberPassword}
              setRememberPassword={setRememberPassword}
              onLoadConnection={handleLoadExistingConnection}
              existingItems={existingSshItems}
            />
          )}
          {step === "forwarding" && (
            <div className="animate-in fade-in-0 slide-in-from-right-2 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
              <PortForwardingEditor rules={portForwards} onChange={setPortForwards} />
            </div>
          )}
          {step === "advanced" && (
            <StepAdvanced options={advanced} onChange={setAdvanced} />
          )}
          {step === "review" && (
            <StepReview command={command} copied={copied} onCopy={handleCopy} />
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="surface-subtle sticky bottom-0 z-10 px-6 py-4 border-t border-border/50 flex-row justify-between sm:justify-between">
          <div>
            {!isEditMode && stepIndex > 0 && (
              <Button variant="ghost" size="sm" onClick={goPrev} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isEditMode ? (
              <Button size="sm" onClick={handleSave} className="gap-1.5" disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                {saving ? "Updating..." : "Update"}
              </Button>
            ) : step === "review" ? (
              <Button size="sm" onClick={handleSave} className="gap-1.5" disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save Connection"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={goNext}
                disabled={saving || (step === "connection" && !canProceedFromConnection)}
                className="gap-1.5"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Step 1: Connection ───────────────────────────────────────────────────────

function StepConnection({
  isEditing,
  name,
  setName,
  host,
  setHost,
  port,
  setPort,
  username,
  setUsername,
  authMethod,
  setAuthMethod,
  keyFilePath,
  setKeyFilePath,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  rememberPassword,
  setRememberPassword,
  onLoadConnection,
  existingItems,
}: {
  isEditing: boolean;
  name: string;
  setName: (v: string) => void;
  host: string;
  setHost: (v: string) => void;
  port: number;
  setPort: (v: number) => void;
  username: string;
  setUsername: (v: string) => void;
  authMethod: SshConnectionData["authMethod"];
  setAuthMethod: (v: SshConnectionData["authMethod"]) => void;
  keyFilePath: string;
  setKeyFilePath: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  rememberPassword: boolean;
  setRememberPassword: (v: boolean) => void;
  onLoadConnection: (item: ComposerItem) => void | Promise<void>;
  existingItems: ComposerItem[];
}) {
  const [loadSavedPickerValue, setLoadSavedPickerValue] = useState("");

  return (
    <div className="space-y-4 animate-in fade-in-0 slide-in-from-right-2 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
      {!isEditing && existingItems.length > 0 && (
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5">Load from saved connection</Label>
          <AppDropdown
            value={loadSavedPickerValue}
            onValueChange={(id) => {
              const item = existingItems.find((c) => c.id === id);
              if (item) void onLoadConnection(item);
              setLoadSavedPickerValue("");
            }}
            options={existingItems.map((c) => ({
              value: c.id,
              label: `${c.name} (${c.sshData?.username}@${c.sshData?.host})`,
            }))}
            placeholder="Select a saved connection..."
            className="h-8 text-xs w-full"
            size="sm"
          />
        </div>
      )}

      <div>
        <Label htmlFor="ssh-name" className="text-xs text-muted-foreground mb-1.5">
          Connection Name
        </Label>
        <Input
          id="ssh-name"
          placeholder="My Server"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9"
        />
      </div>

      <div className="grid grid-cols-[1fr_100px] gap-3">
        <div>
          <Label htmlFor="ssh-host" className="text-xs text-muted-foreground mb-1.5">
            Host / IP Address <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ssh-host"
            placeholder="192.168.1.100 or host.example.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="h-9"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="ssh-port" className="text-xs text-muted-foreground mb-1.5">Port</Label>
          <Input
            id="ssh-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value) || 22)}
            className="h-9"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="ssh-user" className="text-xs text-muted-foreground mb-1.5">Username</Label>
        <Input
          id="ssh-user"
          placeholder="root"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="h-9"
        />
      </div>

      <div>
        <Label className="text-xs text-muted-foreground mb-1.5">Authentication Method</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["agent", "key", "password"] as const).map((method) => {
            const labels = {
              agent: { title: "SSH Agent", desc: "Use system SSH agent" },
              key: { title: "Key File", desc: "Specify private key path" },
              password: { title: "Password", desc: "Enter password on connect" },
            };
            const isActive = authMethod === method;
            return (
              <button
                key={method}
                type="button"
                onClick={() => setAuthMethod(method)}
                className={cn(
                  "rounded-lg p-3 text-left text-xs transition-smooth border",
                  isActive
                    ? "border-foreground/30 bg-accent text-foreground"
                    : "border-border/50 bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                )}
              >
                <div className="font-medium">{labels[method].title}</div>
                <div className="text-2xs mt-0.5 opacity-70">{labels[method].desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {authMethod === "key" && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]">
          <Label htmlFor="ssh-key" className="text-xs text-muted-foreground mb-1.5">
            Private Key Path
          </Label>
          <Input
            id="ssh-key"
            placeholder="~/.ssh/id_rsa"
            value={keyFilePath}
            onChange={(e) => setKeyFilePath(e.target.value)}
            className="h-9"
          />
        </div>
      )}
      {authMethod === "password" && (
        <div className="space-y-3 animate-in fade-in-0 slide-in-from-top-1 duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]">
          <div>
            <Label htmlFor="ssh-password" className="text-xs text-muted-foreground mb-1.5">
              Password
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="ssh-password"
                type={showPassword ? "text" : "password"}
                placeholder="SSH password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9"
              />
              <Button
                type="button"
                variant="neutral"
                size="sm"
                className="h-9 px-2"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
            <Label className="text-xs text-muted-foreground">Remember password securely</Label>
            <Switch checked={rememberPassword} onCheckedChange={setRememberPassword} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Advanced ─────────────────────────────────────────────────────────

function StepAdvanced({
  options,
  onChange,
}: {
  options: SshAdvancedOptions;
  onChange: (opts: SshAdvancedOptions) => void;
}) {
  const update = (patch: Partial<SshAdvancedOptions>) => onChange({ ...options, ...patch });

  return (
    <div className="space-y-5 animate-in fade-in-0 slide-in-from-right-2 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">Compression</Label>
          <p className="text-2xs text-muted-foreground">Enable SSH compression (-C)</p>
        </div>
        <Switch
          checked={options.compression}
          onCheckedChange={(v) => update({ compression: v })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5">Keep-Alive Interval (s)</Label>
          <Input
            type="number"
            min={0}
            value={options.keepAliveInterval}
            onChange={(e) => update({ keepAliveInterval: parseInt(e.target.value) || 0 })}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5">Keep-Alive Max Count</Label>
          <Input
            type="number"
            min={0}
            value={options.keepAliveCountMax}
            onChange={(e) => update({ keepAliveCountMax: parseInt(e.target.value) || 0 })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground mb-1.5">Strict Host Key Checking</Label>
        <AppDropdown
          value={options.strictHostKeyChecking}
          onValueChange={(v) =>
            update({ strictHostKeyChecking: v as SshAdvancedOptions["strictHostKeyChecking"] })
          }
          options={[
            { value: "ask", label: "Ask (default)" },
            { value: "yes", label: "Yes (strict)" },
            { value: "no", label: "No (skip verification)" },
          ]}
          className="h-8 text-xs w-full"
          size="sm"
        />
      </div>

      <div>
        <Label className="text-xs text-muted-foreground mb-1.5">Connection Timeout (s)</Label>
        <Input
          type="number"
          min={0}
          value={options.connectionTimeout}
          onChange={(e) => update({ connectionTimeout: parseInt(e.target.value) || 0 })}
          className="h-8 text-xs"
        />
      </div>

      <div>
        <Label className="text-xs text-muted-foreground mb-1.5">Jump Host (ProxyJump -J)</Label>
        <Input
          placeholder="user@bastion.example.com"
          value={options.jumpHost}
          onChange={(e) => update({ jumpHost: e.target.value })}
          className="h-8 text-xs"
        />
      </div>

      <div>
        <Label className="text-xs text-muted-foreground mb-1.5">Custom SSH Flags</Label>
        <Input
          placeholder="-v -X"
          value={options.customFlags}
          onChange={(e) => update({ customFlags: e.target.value })}
          className="h-8 text-xs"
        />
        <p className="text-2xs text-muted-foreground mt-1">
          Additional flags appended to the command.
        </p>
      </div>
    </div>
  );
}

// ── Step 4: Review ───────────────────────────────────────────────────────────

function StepReview({
  command,
  copied,
  onCopy,
}: {
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-4 animate-in fade-in-0 slide-in-from-right-2 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
      <div>
        <Label className="text-xs text-muted-foreground mb-2">Generated SSH Command</Label>
        <div className="relative group/cmd">
          <pre className="rounded-lg bg-secondary p-4 text-sm font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {command}
          </pre>
          <TooltipWrapper title="Copy" description="Copy the SSH command to clipboard.">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCopy}
              className={cn(
                "absolute top-2 right-2 h-7 text-xs gap-1.5 transition-smooth",
                "opacity-0 group-hover/cmd:opacity-100",
                copied && "opacity-100 text-success"
              )}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copy
                </>
              )}
            </Button>
          </TooltipWrapper>
        </div>
      </div>

      <div className="rounded-lg bg-muted/20 shadow-card p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">Connection will be saved to your composer.</p>
        <p className="text-2xs">
          You can connect to it later from the SSH tab or use the generated command in your terminal.
        </p>
      </div>
    </div>
  );
}
