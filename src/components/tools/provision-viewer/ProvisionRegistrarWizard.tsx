/**
 * Provision-to-Registrar Import Wizard
 *
 * Extracts SIP account data from pulled provision configs and lets the user
 * select which accounts to import, review/edit the pre-filled fields, and
 * create registrar entries in one flow.
 */

import { useState, useMemo } from "react";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useToastContext } from "@/contexts/ToastContext";
import { logError } from "@/lib/errorUtils";
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
import { Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { KeyValue } from "@/types/provision";

// ============================================================================
// PROVISION ACCOUNT EXTRACTION
// ============================================================================

export interface ProvisionAccount {
  index: number;
  username: string;
  authName: string;
  displayName: string;
  label: string;
  server: string;
  port: number;
  transport: string;
  password: string;
  realm: string;
  expires: number | null;
  listeningPort: number | null;
  enabled: boolean;
  // Pre-computed registrar-ready fields
  registrarName: string;
  registrarDomain: string;
  registrarPort: number;
  registrarTransport: string;
  registrarUsername: string;
}

/** Map Yealink transport_type numeric value to transport string */
function mapTransport(value: string): string {
  switch (value.trim()) {
    case "0": return "udp";
    case "1": return "tcp";
    case "2": return "tls";
    case "3": return "udp"; // DNS-NAPTR — default to UDP
    default:
      // Might already be a string like "udp", "tcp", etc.
      if (["udp", "tcp", "tls", "wss"].includes(value.toLowerCase().trim())) {
        return value.toLowerCase().trim();
      }
      return "udp";
  }
}

/**
 * Scan provision KeyValue entries for SIP account configs and extract
 * registrar-ready account objects.
 */
export function extractRegistrarAccounts(entries: KeyValue[]): ProvisionAccount[] {
  // Build a lowercase key → value map
  const map: Record<string, string> = {};
  for (const e of entries) {
    map[e.key.toLowerCase().trim()] = e.value?.trim() ?? "";
  }

  const get = (key: string): string => map[key.toLowerCase()] ?? "";

  const accounts: ProvisionAccount[] = [];

  // Global SIP listen port (sip.listen_port) — shared across all accounts
  const globalListenPortStr = get("sip.listen_port");
  const globalListenPort = globalListenPortStr ? parseInt(globalListenPortStr, 10) : null;

  for (let i = 1; i <= 16; i++) {
    const prefix = `account.${i}`;

    // Server address — try multiple key patterns
    const server =
      get(`${prefix}.sip_server.1.address`) ||
      get(`${prefix}.sip_server_host`) ||
      get(`${prefix}.sip_server.1.host`) ||
      "";

    const username = get(`${prefix}.user_name`);

    // Skip accounts with no server or no username
    if (!server || !username) continue;

    const enabled = get(`${prefix}.enable`) !== "0"; // default enabled if key missing
    const authName = get(`${prefix}.auth_name`) || username;
    const displayName = get(`${prefix}.display_name`);
    const label = get(`${prefix}.label`);
    const password = get(`${prefix}.password`);
    const realm = get(`${prefix}.realm`);

    // Port
    const portStr =
      get(`${prefix}.sip_server.1.port`) ||
      get(`${prefix}.sip_server_port`) ||
      "";
    const port = portStr ? parseInt(portStr, 10) : 5060;

    // Transport
    const transportStr =
      get(`${prefix}.sip_server.1.transport_type`) ||
      get(`${prefix}.transport`) ||
      get(`${prefix}.transport_type`) ||
      "";
    const transport = transportStr ? mapTransport(transportStr) : "udp";

    // Expires / register interval
    const expiresStr = get(`${prefix}.sip_server.1.expires`);
    const expires = expiresStr ? parseInt(expiresStr, 10) : null;

    // Listening port (inbound SIP) — per-account override or global sip.listen_port
    const acctListenStr =
      get(`${prefix}.sip_listen_port`) ||
      get(`${prefix}.listen_port`) ||
      "";
    const rawListeningPort = acctListenStr ? parseInt(acctListenStr, 10) : globalListenPort;
    const listeningPort = rawListeningPort && !Number.isNaN(rawListeningPort) ? rawListeningPort : null;

    // Build a human-readable name
    const nameBase = displayName || label || username;
    const registrarName = `${nameBase} (${username}@${server})`;

    accounts.push({
      index: i,
      username,
      authName,
      displayName,
      label,
      server,
      port: Number.isNaN(port) ? 5060 : port,
      transport,
      password,
      realm,
      expires: expires && !Number.isNaN(expires) ? expires : null,
      listeningPort,
      enabled,
      registrarName,
      registrarDomain: server,
      registrarPort: Number.isNaN(port) ? 5060 : port,
      registrarTransport: transport,
      registrarUsername: username,
    });
  }

  return accounts;
}

// ============================================================================
// WIZARD COMPONENT
// ============================================================================

interface ProvisionRegistrarWizardProps {
  open: boolean;
  onClose: () => void;
  entries: KeyValue[];
}

interface AccountFormData {
  name: string;
  domain: string;
  remote_port: number;
  listening_port: number | undefined;
  transport: string;
  username: string;
  password: string;
  realm: string;
  register_interval_seconds: number | undefined;
}

type WizardStep = "select" | "review";
type CreateStatus = "idle" | "creating" | "success" | "error";

export function ProvisionRegistrarWizard({ open, onClose, entries }: ProvisionRegistrarWizardProps) {
  const accounts = useMemo(() => extractRegistrarAccounts(entries), [entries]);
  const createRegistrar = useRegistrationStore((s) => s.createRegistrar);
  const { toast } = useToastContext();

  // Step management
  const [step, setStep] = useState<WizardStep>("select");

  // Step 1 — selection
  const [selected, setSelected] = useState<Set<number>>(() => {
    // Pre-select all enabled accounts
    return new Set(accounts.filter(a => a.enabled).map(a => a.index));
  });

  // Step 2 — editable form data per account, keyed by index
  const [formDataMap, setFormDataMap] = useState<Record<number, AccountFormData>>({});
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  const [showPasswords, setShowPasswords] = useState<Set<number>>(new Set());
  const [createStatuses, setCreateStatuses] = useState<Record<number, CreateStatus>>({});
  const [isCreating, setIsCreating] = useState(false);

  // Initialize form data for selected accounts when moving to review step
  const initFormData = () => {
    const map: Record<number, AccountFormData> = {};
    for (const acc of accounts) {
      if (selected.has(acc.index)) {
        map[acc.index] = {
          name: acc.registrarName,
          domain: acc.registrarDomain,
          remote_port: acc.registrarPort,
          listening_port: acc.listeningPort ?? undefined,
          transport: acc.registrarTransport,
          username: acc.registrarUsername,
          password: acc.password,
          realm: acc.realm,
          register_interval_seconds: acc.expires ?? undefined,
        };
      }
    }
    setFormDataMap(map);
    // Expand all cards by default
    setExpandedCards(new Set(Object.keys(map).map(Number)));
    setCreateStatuses({});
  };

  const toggleSelect = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(accounts.map(a => a.index)));
  const deselectAll = () => setSelected(new Set());

  const updateFormField = (index: number, field: keyof AccountFormData, value: string | number | undefined) => {
    setFormDataMap(prev => ({
      ...prev,
      [index]: { ...prev[index]!, [field]: value },
    }));
  };

  const toggleCard = (index: number) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const togglePassword = (index: number) => {
    setShowPasswords(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const goToReview = () => {
    if (selected.size === 0) return;
    initFormData();
    setStep("review");
  };

  const goBack = () => {
    setStep("select");
  };

  const handleClose = () => {
    setStep("select");
    setSelected(new Set(accounts.filter(a => a.enabled).map(a => a.index)));
    setFormDataMap({});
    setCreateStatuses({});
    setIsCreating(false);
    onClose();
  };

  // ── Create registrars ──
  const handleCreateAll = async () => {
    setIsCreating(true);
    let successCount = 0;
    let failCount = 0;

    const indices = Object.keys(formDataMap).map(Number);

    for (const idx of indices) {
      const form = formDataMap[idx];
      if (!form) continue;

      // Skip already created
      if (createStatuses[idx] === "success") {
        successCount++;
        continue;
      }

      setCreateStatuses(prev => ({ ...prev, [idx]: "creating" }));

      try {
        await createRegistrar(
          {
            name: form.name.trim(),
            domain: form.domain.trim(),
            remote_port: form.remote_port,
            local_port: undefined,
            rtp_port: undefined,
            listening_port: form.listening_port || undefined,
            transport: form.transport,
            username: form.username.trim(),
            realm: form.realm?.trim() || undefined,
            timeout_seconds: 30,
            retry_count: 3,
            register_interval_seconds: form.register_interval_seconds || undefined,
            tags: ["provision-import"],
            group: undefined,
            use_case: undefined,
          },
          form.password
        );
        setCreateStatuses(prev => ({ ...prev, [idx]: "success" }));
        successCount++;
      } catch (error) {
        logError("ProvisionRegistrarWizard.create", error);
        setCreateStatuses(prev => ({ ...prev, [idx]: "error" }));
        failCount++;
      }
    }

    setIsCreating(false);

    if (failCount === 0) {
      toast({
        type: "success",
        title: "Registrars Created",
        description: `Successfully created ${successCount} registrar${successCount !== 1 ? "s" : ""} from provision data.`,
        source: "provision-viewer",
      });
      handleClose();
    } else {
      toast({
        type: "error",
        title: "Partial Failure",
        description: `${successCount} created, ${failCount} failed. Review errors and retry.`,
        source: "provision-viewer",
      });
    }
  };

  const allDone = Object.values(createStatuses).length > 0 &&
    Object.values(createStatuses).every(s => s === "success");

  // ── No accounts found ──
  if (accounts.length === 0) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Registrars from Provision</DialogTitle>
            <DialogDescription>No SIP accounts found in the provision data.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 py-4 px-1 text-muted-foreground">
            <AlertCircle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              The provision file does not contain any <code className="text-xs bg-muted px-1 py-0.5 rounded">account.X.*</code> entries
              with a valid SIP server address and username.
            </p>
          </div>
          <DialogFooter>
            <Button variant="neutral" onClick={handleClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[calc(min(100vh,100dvh)-2rem)] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Registrars from Provision</DialogTitle>
          <DialogDescription>
            {step === "select"
              ? `Found ${accounts.length} SIP account${accounts.length !== 1 ? "s" : ""}. Select which to import as registrar entries.`
              : `Review and edit the registrar details before creating.`}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-3 px-1 pb-1">
          <TooltipWrapper title="Select" description="Step 1: Choose which accounts to import.">
            <button
              type="button"
              onClick={() => step === "review" && !isCreating ? goBack() : undefined}
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium transition-smooth",
                step === "select" ? "text-foreground" : "text-muted-foreground hover:text-foreground cursor-pointer"
              )}
            >
            <span className={cn(
              "w-5 h-5 rounded-full text-2xs font-bold flex items-center justify-center",
              step === "select" ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"
            )}>1</span>
            Select
          </button>
          </TooltipWrapper>
          <span className="w-8 border-t border-border" />
          <span className={cn(
            "flex items-center gap-1.5 text-xs font-medium",
            step === "review" ? "text-foreground" : "text-muted-foreground"
          )}>
            <span className={cn(
              "w-5 h-5 rounded-full text-2xs font-bold flex items-center justify-center",
              step === "review" ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"
            )}>2</span>
            Review & Create
          </span>
        </div>

        {/* ════════ STEP 1: SELECT ACCOUNTS ════════ */}
        {step === "select" && (
          <div className="flex-1 overflow-auto min-h-0 space-y-3">
            {/* Select all / deselect all */}
            <div className="flex items-center gap-2 px-1">
              <TooltipWrapper title="Select all" description="Select all accounts for import.">
                <Button variant="neutral" size="sm" className="h-7 text-xs" onClick={selectAll}>Select all</Button>
              </TooltipWrapper>
              <TooltipWrapper title="Deselect all" description="Clear selection.">
                <Button variant="neutral" size="sm" className="h-7 text-xs" onClick={deselectAll}>Deselect all</Button>
              </TooltipWrapper>
              <span className="ml-auto text-xs text-muted-foreground">
                {selected.size} of {accounts.length} selected
              </span>
            </div>

            {/* Account list */}
            <div className="space-y-1.5">
              {accounts.map(acc => {
                const isSelected = selected.has(acc.index);
                return (
                  <button
                    key={acc.index}
                    type="button"
                    onClick={() => toggleSelect(acc.index)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-smooth",
                      isSelected
                        ? "rounded-lg border border-foreground/20 bg-muted/20 hover:bg-muted/40"
                        : "rounded-md surface hover:bg-muted/30",
                      !acc.enabled && "opacity-60"
                    )}
                  >
                    {/* Checkbox */}
                    <div className={cn(
                      "shrink-0 w-4.5 h-4.5 rounded border-2 flex items-center justify-center transition-smooth",
                      isSelected ? "border-foreground/30 bg-accent" : "border-muted-foreground/40"
                    )}>
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>

                    {/* Account info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">Acct {acc.index}</span>
                        <span className="font-mono font-semibold text-sm truncate">{acc.username}</span>
                        {!acc.enabled && (
                          <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-warning/15 text-warning dark:text-warning">
                            Disabled
                          </span>
                        )}
                      </div>
                      <div className="text-2xs text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate">
                        <span>{acc.server}:{acc.port}</span>
                        <span className="text-border">·</span>
                        <span className="uppercase">{acc.transport}</span>
                        {acc.listeningPort && (
                          <>
                            <span className="text-border">·</span>
                            <span>listen:{acc.listeningPort}</span>
                          </>
                        )}
                        {acc.displayName && (
                          <>
                            <span className="text-border">·</span>
                            <span className="truncate">{acc.displayName}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Password status */}
                    <div className="shrink-0">
                      {acc.password ? (
                        <span className="text-2xs px-1.5 py-0.5 rounded-full bg-success/15 text-success dark:text-success">
                          Has password
                        </span>
                      ) : (
                        <span className="text-2xs px-1.5 py-0.5 rounded-full bg-warning/15 text-warning dark:text-warning">
                          No password
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ════════ STEP 2: REVIEW & CREATE ════════ */}
        {step === "review" && (
          <div className="flex-1 overflow-auto min-h-0 space-y-3">
            {Object.entries(formDataMap).map(([idxStr, form]) => {
              const idx = Number(idxStr);
              const acc = accounts.find(a => a.index === idx);
              if (!acc || !form) return null;

              const isExpanded = expandedCards.has(idx);
              const status = createStatuses[idx] ?? "idle";
              const pwVisible = showPasswords.has(idx);

              return (
                <div
                  key={idx}
                  className={cn(
                    "overflow-hidden transition-smooth",
                    status === "success" ? "rounded-lg border border-success/40 bg-success/5"
                    : status === "error" ? "rounded-lg border border-destructive/40 bg-destructive/5"
                    : "rounded-md surface"
                  )}
                >
                  {/* Card header */}
                  <button
                    type="button"
                    onClick={() => toggleCard(idx)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/20 transition-smooth"
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    }
                    <span className="text-xs font-mono text-muted-foreground">Acct {idx}</span>
                    <span className="font-semibold text-sm truncate flex-1">{form.name}</span>

                    {/* Status badge */}
                    {status === "creating" && <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground shrink-0" />}
                    {status === "success" && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
                    {status === "error" && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}

                    {!form.password && status === "idle" && (
                      <span className="text-2xs px-1.5 py-0.5 rounded-full bg-warning/15 text-warning dark:text-warning shrink-0">
                        Password required
                      </span>
                    )}
                  </button>

                  {/* Card body — editable fields */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-border/30 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {/* Name */}
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs text-muted-foreground">Name</Label>
                          <Input
                            value={form.name}
                            onChange={e => updateFormField(idx, "name", e.target.value)}
                            className="h-8 text-sm"
                            disabled={status === "success" || status === "creating"}
                          />
                        </div>

                        {/* Domain */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Domain / SIP Server</Label>
                          <Input
                            value={form.domain}
                            onChange={e => updateFormField(idx, "domain", e.target.value)}
                            className="h-8 text-sm font-mono"
                            disabled={status === "success" || status === "creating"}
                          />
                        </div>

                        {/* Remote Port */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Remote Port</Label>
                          <Input
                            type="number"
                            value={form.remote_port}
                            onChange={e => updateFormField(idx, "remote_port", parseInt(e.target.value, 10) || 5060)}
                            className="h-8 text-sm font-mono"
                            disabled={status === "success" || status === "creating"}
                          />
                        </div>

                        {/* Listening Port (inbound SIP) */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                            Listening Port
                            {form.listening_port && (
                              <span className="text-success text-2xs font-normal">from sip.listen_port</span>
                            )}
                          </Label>
                          <Input
                            type="number"
                            value={form.listening_port ?? ""}
                            onChange={e => updateFormField(idx, "listening_port", e.target.value ? parseInt(e.target.value, 10) : undefined)}
                            className="h-8 text-sm font-mono"
                            placeholder="Auto"
                            disabled={status === "success" || status === "creating"}
                          />
                        </div>

                        {/* Transport */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Transport</Label>
                          <Select
                            value={form.transport}
                            onValueChange={v => updateFormField(idx, "transport", v)}
                            disabled={status === "success" || status === "creating"}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="udp">UDP</SelectItem>
                              <SelectItem value="tcp">TCP</SelectItem>
                              <SelectItem value="tls">TLS</SelectItem>
                              <SelectItem value="wss">WSS</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Username */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Username</Label>
                          <Input
                            value={form.username}
                            onChange={e => updateFormField(idx, "username", e.target.value)}
                            className="h-8 text-sm font-mono"
                            disabled={status === "success" || status === "creating"}
                          />
                        </div>

                        {/* Password */}
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                            Password
                            {!form.password && (
                              <span className="text-warning text-2xs font-normal flex items-center gap-0.5">
                                <AlertCircle className="h-3 w-3" />
                                Required — not found in provision
                              </span>
                            )}
                          </Label>
                          <div className="relative">
                            <Input
                              type={pwVisible ? "text" : "password"}
                              value={form.password}
                              onChange={e => updateFormField(idx, "password", e.target.value)}
                              placeholder={form.password ? "" : "Enter SIP password..."}
                              className="h-8 text-sm font-mono pr-9"
                              disabled={status === "success" || status === "creating"}
                            />
                            <TooltipWrapper title={pwVisible ? "Hide password" : "Show password"} description={pwVisible ? "Hide password in this field." : "Reveal password in this field."}>
                              <button
                                type="button"
                                onClick={() => togglePassword(idx)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                tabIndex={-1}
                              >
                                {pwVisible
                                  ? <EyeOff className="h-3.5 w-3.5" />
                                  : <Eye className="h-3.5 w-3.5" />
                                }
                              </button>
                            </TooltipWrapper>
                          </div>
                        </div>

                        {/* Realm */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Realm (optional)</Label>
                          <Input
                            value={form.realm}
                            onChange={e => updateFormField(idx, "realm", e.target.value)}
                            className="h-8 text-sm font-mono"
                            placeholder="Auto-detect"
                            disabled={status === "success" || status === "creating"}
                          />
                        </div>

                        {/* Register Interval */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Register Interval (s)</Label>
                          <Input
                            type="number"
                            value={form.register_interval_seconds ?? ""}
                            onChange={e => updateFormField(idx, "register_interval_seconds", e.target.value ? parseInt(e.target.value, 10) : undefined)}
                            className="h-8 text-sm font-mono"
                            placeholder="Default"
                            disabled={status === "success" || status === "creating"}
                          />
                        </div>
                      </div>

                      {/* Auth name info (read-only) */}
                      {acc.authName && acc.authName !== acc.username && (
                        <p className="text-2xs text-muted-foreground px-0.5">
                          Auth name from provision: <code className="bg-muted px-1 py-0.5 rounded text-2xs">{acc.authName}</code>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter className="surface-subtle sticky bottom-0 z-10 gap-2 sm:gap-2 border-t border-border/50 px-5 py-4">
          {step === "select" && (
            <>
              <Button variant="neutral" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={goToReview}
                disabled={selected.size === 0}
              >
                Review {selected.size} Account{selected.size !== 1 ? "s" : ""}
              </Button>
            </>
          )}
          {step === "review" && (
            <>
              <Button variant="neutral" onClick={goBack} disabled={isCreating}>Back</Button>
              {allDone ? (
                <Button onClick={handleClose}>Done</Button>
              ) : (
                <Button
                  onClick={handleCreateAll}
                  disabled={isCreating || Object.values(formDataMap).some(f => !f.password?.trim())}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    `Create ${Object.keys(formDataMap).length} Registrar${Object.keys(formDataMap).length !== 1 ? "s" : ""}`
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
