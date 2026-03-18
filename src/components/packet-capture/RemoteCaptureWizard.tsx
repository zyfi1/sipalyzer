/**
 * Remote Capture Wizard — 3-step guided dialog for configuring and starting
 * an SSH remote packet capture session (similar to Wireshark sshdump).
 *
 * Steps:
 *   1. Connection — SSH host, credentials, test connection
 *   2. Capture Settings — remote interface, BPF filter, sudo, limits
 *   3. Review & Start — summary of all settings
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Globe,
  Shield,
  Play,
  Wifi,
  Terminal,
  HelpCircle,
} from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { testSshConnection, listRemoteInterfaces } from "@/api/packetCapture";
import type { SshAuthMethod, RemoteCaptureConfig } from "@/types/packetCapture";

interface RemoteCaptureWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (config: RemoteCaptureConfig) => Promise<void>;
}

type WizardStep = 1 | 2 | 3;

export function RemoteCaptureWizard({
  open,
  onOpenChange,
  onStart,
}: RemoteCaptureWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);

  // Step 1 — Connection
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>("password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "fail" | null>(null);
  const [testError, setTestError] = useState("");

  // Step 2 — Capture settings
  const [remoteInterfaces, setRemoteInterfaces] = useState<string[]>([]);
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const [remoteInterface, setRemoteInterface] = useState("any");
  const [captureFilter, setCaptureFilter] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [useSudo, setUseSudo] = useState(false);
  const [sudoPassword, setSudoPassword] = useState("");
  const [packetLimit, setPacketLimit] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");

  // Step 3
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const resetWizard = useCallback(() => {
    setStep(1);
    setHost("");
    setPort("22");
    setUsername("");
    setAuthMethod("password");
    setPassword("");
    setKeyPath("");
    setShowPassword(false);
    setTesting(false);
    setTestResult(null);
    setTestError("");
    setRemoteInterfaces([]);
    setLoadingInterfaces(false);
    setRemoteInterface("any");
    setCaptureFilter("");
    setSessionName("");
    setUseSudo(false);
    setSudoPassword("");
    setPacketLimit("");
    setDurationSeconds("");
    setStarting(false);
    setStartError("");
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resetWizard();
      onOpenChange(open);
    },
    [onOpenChange, resetWizard]
  );

  // ---- Step 1 actions ----

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      const ok = await testSshConnection(
        host,
        parseInt(port, 10) || 22,
        username,
        authMethod,
        authMethod === "password" ? password : undefined,
        authMethod === "keyFile" ? keyPath : undefined
      );
      setTestResult(ok ? "success" : "fail");
      if (!ok) setTestError("Authentication failed");
    } catch (e) {
      setTestResult("fail");
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }, [host, port, username, authMethod, password, keyPath]);

  const canProceedStep1 = host.trim() !== "" && username.trim() !== "" && testResult === "success";

  const handleGoToStep2 = useCallback(async () => {
    setStep(2);
    // Fetch remote interfaces in background
    setLoadingInterfaces(true);
    try {
      const ifaces = await listRemoteInterfaces(
        host,
        parseInt(port, 10) || 22,
        username,
        authMethod,
        authMethod === "password" ? password : undefined,
        authMethod === "keyFile" ? keyPath : undefined
      );
      setRemoteInterfaces(ifaces);
      if (ifaces.length > 0 && !ifaces.includes(remoteInterface)) {
        setRemoteInterface(ifaces[0] ?? "any");
      }
    } catch {
      setRemoteInterfaces(["any"]);
    } finally {
      setLoadingInterfaces(false);
    }
  }, [host, port, username, authMethod, password, keyPath, remoteInterface]);

  // ---- Step 3 actions ----

  const handleStart = useCallback(async () => {
    setStarting(true);
    setStartError("");
    try {
      const config: RemoteCaptureConfig = {
        host,
        port: parseInt(port, 10) || 22,
        username,
        authMethod,
        password: authMethod === "password" ? password : undefined,
        keyPath: authMethod === "keyFile" ? keyPath : undefined,
        remoteInterface,
        captureFilter: captureFilter.trim() || undefined,
        useSudo,
        sudoPassword: useSudo ? sudoPassword : undefined,
        sessionName: sessionName.trim() || undefined,
        packetLimit: packetLimit ? parseInt(packetLimit, 10) : undefined,
        durationSeconds: durationSeconds ? parseInt(durationSeconds, 10) : undefined,
      };
      await onStart(config);
      handleOpenChange(false);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [
    host,
    port,
    username,
    authMethod,
    password,
    keyPath,
    remoteInterface,
    captureFilter,
    useSudo,
    sudoPassword,
    sessionName,
    packetLimit,
    durationSeconds,
    onStart,
    handleOpenChange,
  ]);

  // ---- Step indicators ----

  const steps = [
    { num: 1 as WizardStep, label: "Connection" },
    { num: 2 as WizardStep, label: "Capture" },
    { num: 3 as WizardStep, label: "Review" },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Remote SSH Capture
          </DialogTitle>
          <DialogDescription>
            Connect to a remote host via SSH and capture packets with tcpdump.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {steps.map(({ num, label }, i) => (
            <div key={num} className="flex items-center gap-1">
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              )}
              <button
                type="button"
                disabled={num > step}
                onClick={() => num < step && setStep(num)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-smooth",
                  num === step
                    ? "bg-accent text-foreground"
                    : num < step
                    ? "text-muted-foreground hover:text-foreground cursor-pointer"
                    : "text-muted-foreground/60 cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center h-5 w-5 rounded-full text-2xs font-bold",
                    num === step
                      ? "bg-accent text-foreground"
                      : num < step
                      ? "bg-muted text-muted-foreground"
                      : "bg-muted/50 text-muted-foreground/60"
                  )}
                >
                  {num < step ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    num
                  )}
                </span>
                {label}
              </button>
            </div>
          ))}
        </div>

        {/* Step 1 — Connection */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="rc-host">Host / IP Address</Label>
                <Input
                  id="rc-host"
                  placeholder="192.168.1.1 or server.example.com"
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value);
                    setTestResult(null);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-port">Port</Label>
                <Input
                  id="rc-port"
                  placeholder="22"
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value);
                    setTestResult(null);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rc-username">Username</Label>
              <Input
                id="rc-username"
                placeholder="root"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setTestResult(null);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Authentication Method</Label>
              <Select
                value={authMethod}
                onValueChange={(v) => {
                  setAuthMethod(v as SshAuthMethod);
                  setTestResult(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">
                    <span className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5" /> Password
                    </span>
                  </SelectItem>
                  <SelectItem value="keyFile">
                    <span className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5" /> SSH Key File
                    </span>
                  </SelectItem>
                  <SelectItem value="agent">
                    <span className="flex items-center gap-2">
                      <Terminal className="h-3.5 w-3.5" /> SSH Agent
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {authMethod === "password" && (
              <div className="space-y-1.5">
                <Label htmlFor="rc-password">Password</Label>
                <div className="relative">
                  <Input
                    id="rc-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setTestResult(null);
                    }}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            )}

            {authMethod === "keyFile" && (
              <div className="space-y-1.5">
                <Label htmlFor="rc-keypath">Key File Path</Label>
                <Input
                  id="rc-keypath"
                  placeholder="~/.ssh/id_rsa"
                  value={keyPath}
                  onChange={(e) => {
                    setKeyPath(e.target.value);
                    setTestResult(null);
                  }}
                />
              </div>
            )}

            {/* Test connection */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing || !host.trim() || !username.trim()}
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Wifi className="h-3.5 w-3.5 mr-1.5" />
                )}
                Test Connection
              </Button>
              {testResult === "success" && (
                <span className="flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected
                </span>
              )}
              {testResult === "fail" && (
                <span className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {testError || "Connection failed"}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Step 2 — Capture Settings */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="rc-iface">Remote Interface</Label>
                <TooltipWrapper entry={tooltips.statInterface}>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
              {loadingInterfaces ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Detecting interfaces...
                </div>
              ) : (
                <Select
                  value={remoteInterface}
                  onValueChange={setRemoteInterface}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">any (all interfaces)</SelectItem>
                    {remoteInterfaces.map((iface) => (
                      <SelectItem key={iface} value={iface}>
                        {iface}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="rc-filter">Capture Filter (BPF)</Label>
                <TooltipWrapper entry={tooltips.filterBpf}>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
              <Input
                id="rc-filter"
                placeholder="e.g. port 5060 or udp portrange 10000-20000"
                value={captureFilter}
                onChange={(e) => setCaptureFilter(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Standard tcpdump / BPF filter expression. Leave empty to capture all traffic.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rc-name">Session Name</Label>
              <Input
                id="rc-name"
                placeholder={`Remote: ${username}@${host}`}
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSudo}
                  onChange={(e) => setUseSudo(e.target.checked)}
                  className="rounded border-input"
                />
                <span className="text-sm">Use sudo for tcpdump</span>
              </label>
            </div>

            {useSudo && (
              <div className="space-y-1.5">
                <Label htmlFor="rc-sudo-pw">Sudo Password</Label>
                <Input
                  id="rc-sudo-pw"
                  type="password"
                  placeholder="Leave empty if NOPASSWD configured"
                  value={sudoPassword}
                  onChange={(e) => setSudoPassword(e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="rc-pkt-limit">Packet Limit</Label>
                  <TooltipWrapper entry={tooltips.filterPacketLimit}>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipWrapper>
                </div>
                <Input
                  id="rc-pkt-limit"
                  type="number"
                  placeholder="Unlimited"
                  value={packetLimit}
                  onChange={(e) => setPacketLimit(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="rc-duration">Duration (seconds)</Label>
                  <TooltipWrapper entry={tooltips.filterDuration}>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipWrapper>
                </div>
                <Input
                  id="rc-duration"
                  type="number"
                  placeholder="Unlimited"
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3 — Review & Start */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="rounded-md border border-border/40 bg-muted/10 p-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Host</span>
                <span className="font-mono">
                  {username}@{host}:{port}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Auth</span>
                <Badge variant="secondary" className="text-xs">
                  {authMethod === "password"
                    ? "Password"
                    : authMethod === "keyFile"
                    ? "SSH Key"
                    : "SSH Agent"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Interface</span>
                <span className="font-mono">{remoteInterface}</span>
              </div>
              {captureFilter && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Filter</span>
                  <span className="font-mono text-xs max-w-[260px] truncate">
                    {captureFilter}
                  </span>
                </div>
              )}
              {useSudo && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sudo</span>
                  <Badge variant="outline" className="text-xs">
                    Enabled
                  </Badge>
                </div>
              )}
              {sessionName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span>{sessionName}</span>
                </div>
              )}
              {packetLimit && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Packet Limit</span>
                  <span>{packetLimit}</span>
                </div>
              )}
              {durationSeconds && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span>{durationSeconds}s</span>
                </div>
              )}
            </div>

            <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/10 p-3">
              <p className="text-xs text-muted-foreground">
                <strong>Remote command:</strong>{" "}
                <code className="text-2xs">
                  {useSudo ? "sudo " : ""}tcpdump -i {remoteInterface} -U -w -
                  {packetLimit ? ` -c ${packetLimit}` : ""}
                  {captureFilter ? ` ${captureFilter}` : ""}
                </code>
              </p>
            </div>

            {startError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {startError}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between">
          <div>
            {step > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep((step - 1) as WizardStep)}
                disabled={starting}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={starting}
            >
              Cancel
            </Button>
            {step === 1 && (
              <Button
                size="sm"
                onClick={handleGoToStep2}
                disabled={!canProceedStep1}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
            {step === 2 && (
              <Button size="sm" onClick={() => setStep(3)}>
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
            {step === 3 && (
              <Button size="sm" onClick={handleStart} disabled={starting}>
                {starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                )}
                Start Capture
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
