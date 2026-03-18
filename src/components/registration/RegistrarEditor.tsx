import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, HelpCircle, Calculator } from "@/lib/icons";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useToastContext } from "@/contexts/ToastContext";
import { extractErrorMessage, logError } from "@/lib/errorUtils";
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
import { Loader2 } from "@/lib/icons";
import { Switch } from "@/components/ui/switch";
import { getRegistrarPassword } from "@/api/registration";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

function RegistrarEditorSubmitButton({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <Button type="submit" disabled={isSubmitting}>
      {isSubmitting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Saving...
        </>
      ) : (
        "Save"
      )}
    </Button>
  );
}

/**
 * Parse a server URL / SIP URI that a provider might give.
 * Handles:  sip.provider.com:6070  |  sip:user@host:port  |  sips:host  |  [ipv6]:port
 * Returns the parsed parts, or null if the input is just a plain hostname with nothing to split.
 */
function parseServerInput(raw: string): {
  domain: string;
  port?: number;
  username?: string;
  transport?: string;
} | null {
  let value = raw.trim();
  if (!value) return null;

  // Detect scheme → transport hint
  let transport: string | undefined;
  const schemeMatch = value.match(/^(sips?|wss?):\/?\/?/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase();
    if (scheme === "sips") transport = "tls";
    else if (scheme === "wss") transport = "wss";
    value = value.slice(schemeMatch[0].length);
  }

  // Strip trailing slash / whitespace
  value = value.replace(/\/+$/, "").trim();

  // user@host
  let username: string | undefined;
  const atIdx = value.indexOf("@");
  if (atIdx > 0) {
    username = value.substring(0, atIdx);
    value = value.substring(atIdx + 1);
  }

  // Strip ;transport=xxx parameters and extract transport
  const paramMatch = value.match(/;transport=(udp|tcp|tls|wss)/i);
  if (paramMatch) {
    transport = paramMatch[1]!.toLowerCase();
    value = value.replace(/;transport=[^;]*/i, "").trim();
  }

  // IPv6 bracket notation: [::1]:port
  let host: string;
  let port: number | undefined;
  const ipv6Match = value.match(/^\[([^\]]+)](?::(\d+))?$/);
  if (ipv6Match) {
    host = ipv6Match[1]!;
    port = ipv6Match[2] ? parseInt(ipv6Match[2], 10) : undefined;
  } else {
    // host:port — use last colon (safe for IPv4 / hostnames)
    const lastColon = value.lastIndexOf(":");
    if (lastColon > 0) {
      const tail = value.substring(lastColon + 1);
      if (/^\d{1,5}$/.test(tail)) {
        const p = parseInt(tail, 10);
        if (p >= 1 && p <= 65535) {
          host = value.substring(0, lastColon);
          port = p;
        } else {
          host = value;
        }
      } else {
        host = value;
      }
    } else {
      host = value;
    }
  }

  if (!host) return null;

  // Only return a result if we actually extracted something beyond a bare hostname
  if (!port && !username && !transport) return null;

  return { domain: host, port, username, transport };
}

interface RegistrarEditorProps {
  registrarId: string | null;
  onClose: () => void;
}

const TRANSPORT_OPTIONS = ["udp", "tcp", "tls", "wss"] as const;

function createRegistrarSchema(isEditing: boolean) {
  return z.object({
    name: z.string().trim().min(1, "Name is required"),
    domain: z.string().trim().min(1, "Domain/IP is required"),
    remote_port: z.number().int().min(1, "Remote port must be between 1 and 65535").max(65535, "Remote port must be between 1 and 65535"),
    local_port: z.number().int().min(1, "Local port must be between 1 and 65535").max(65535, "Local port must be between 1 and 65535").optional(),
    rtp_port: z.number().int().optional(),
    listening_port: z.number().int().optional(),
    transport: z.enum(TRANSPORT_OPTIONS),
    username: z.string().trim().min(1, "Username is required"),
    password: isEditing ? z.string() : z.string().trim().min(1, "Password is required"),
    realm: z.string(),
    timeout_seconds: z.number().int().min(1),
    retry_count: z.number().int().min(0),
    register_interval_seconds: z.number().int().min(1).optional(),
    voicemail_number: z.string(),
    mwi_enabled: z.boolean(),
    auto_register: z.boolean(),
    group: z.string().optional(),
  });
}

type RegistrarFormValues = z.infer<ReturnType<typeof createRegistrarSchema>>;
const REGISTRAR_FORM_DEFAULTS: RegistrarFormValues = {
  name: "",
  domain: "",
  remote_port: 5060,
  local_port: undefined,
  rtp_port: undefined,
  listening_port: undefined,
  transport: "udp",
  username: "",
  password: "",
  realm: "",
  timeout_seconds: 30,
  retry_count: 3,
  register_interval_seconds: undefined,
  voicemail_number: "",
  mwi_enabled: false,
  auto_register: false,
  group: undefined,
};

export function RegistrarEditor({ registrarId, onClose }: RegistrarEditorProps) {
  const registrars = useRegistrationStore((s) => s.registrars);
  const createRegistrar = useRegistrationStore((s) => s.createRegistrar);
  const updateRegistrar = useRegistrationStore((s) => s.updateRegistrar);
  const checkLocalPort = useRegistrationStore((s) => s.checkLocalPort);
  const getDefaultLocalPort = useRegistrationStore((s) => s.getDefaultLocalPort);
  const { toast } = useToastContext();

  const editing = registrars.find((r) => r.id === registrarId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const {
    watch,
    getValues,
    setValue,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<RegistrarFormValues>({
    resolver: zodResolver(createRegistrarSchema(Boolean(editing))),
    defaultValues: REGISTRAR_FORM_DEFAULTS,
  });
  const formData = watch();
  const setFormData = (next: RegistrarFormValues | ((prev: RegistrarFormValues) => RegistrarFormValues)) => {
    const prev = getValues();
    const resolved = typeof next === "function" ? next(prev) : next;
    for (const [key, value] of Object.entries(resolved) as Array<[keyof RegistrarFormValues, RegistrarFormValues[keyof RegistrarFormValues]]>) {
      setValue(key, value, { shouldDirty: true });
    }
  };

  const [showAdvanced, setShowAdvanced] = useState(false);

  const [localPortAvailable, setLocalPortAvailable] = useState<boolean | null>(null);
  const [checkingPort, setCheckingPort] = useState(false);
  const [extensionHelperOpen, setExtensionHelperOpen] = useState(false);
  const [extensionInput, setExtensionInput] = useState("");
  const BASE_LOCAL_PORT = 5060;
  /** Brief hint shown after auto-parsing a pasted URL. Clears after a timeout. */
  const [parsedHint, setParsedHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getFirstErrorMessage = () => {
    const list = Object.values(errors);
    for (const item of list) {
      if (!item) continue;
      if ("message" in item && typeof item.message === "string") {
        return item.message;
      }
    }
    return "Please check the highlighted fields.";
  };

  const runSubmit = async (data: RegistrarFormValues) => {
    if (localPortAvailable === false) {
      toast({
        type: "error",
        title: "Validation Error",
        description: "Selected local port is not available",
        source: "registration",
      });
      return;
    }

    setIsSubmitting(true);

    const registrarData = {
      name: data.name.trim(),
      domain: data.domain.trim(),
      remote_port: data.remote_port,
      local_port: data.local_port,
      rtp_port: data.rtp_port,
      listening_port: data.listening_port,
      transport: data.transport,
      username: data.username.trim(),
      realm: data.realm?.trim() || undefined,
      timeout_seconds: data.timeout_seconds,
      retry_count: data.retry_count,
      register_interval_seconds: data.register_interval_seconds || undefined,
      tags: [],
      group: data.group || undefined,
      use_case: editing?.use_case ?? undefined,
      voicemail_number: data.voicemail_number || null,
      mwi_enabled: data.mwi_enabled,
      auto_register: data.auto_register,
    };

    try {
      if (editing) {
        if (editing.id) {
          await updateRegistrar(editing.id, registrarData, data.password || undefined);
        }
        toast({
          type: "success",
          title: "Registrar Updated",
          description: `${data.name} has been updated successfully.`,
          source: "registration",
        });
      } else {
        await createRegistrar(registrarData, data.password);
        toast({
          type: "success",
          title: "Registrar Created",
          description: `${data.name} has been created successfully.`,
          source: "registration",
        });
      }
      onClose();
    } catch (error: unknown) {
      logError("RegistrarEditor.save", error);
      const errorMessage = extractErrorMessage(error);
      toast({
        type: "error",
        title: "Save Failed",
        description: errorMessage,
        source: "registration",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onInvalidSubmit = () => {
    toast({
      type: "error",
      title: "Validation Error",
      description: getFirstErrorMessage(),
      source: "registration",
    });
  };

  const handleFormSubmit = handleSubmit(runSubmit, onInvalidSubmit);

  /** Try to parse the domain field value and auto-fill port / username / transport. */
  const applySmartParse = (rawValue: string) => {
    const parsed = parseServerInput(rawValue);
    if (!parsed) return;

    const parts: string[] = [];
    setFormData((prev) => {
      const next = { ...prev, domain: parsed.domain };
      if (parsed.port != null) {
        next.remote_port = parsed.port;
        parts.push(`port ${parsed.port}`);
      }
      if (parsed.username && !prev.username) {
        next.username = parsed.username;
        parts.push(`user "${parsed.username}"`);
      }
      if (parsed.transport) {
        next.transport = parsed.transport as RegistrarFormValues["transport"];
        parts.push(`transport ${parsed.transport.toUpperCase()}`);
      }
      return next;
    });

    if (parts.length > 0) {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      setParsedHint(`Auto-detected ${parts.join(", ")}`);
      hintTimer.current = setTimeout(() => setParsedHint(null), 4000);
    }
  };

  useEffect(() => {
    if (editing && registrarId) {
      // Load the current password from the backend
      const loadPassword = async () => {
        try {
          const password = await getRegistrarPassword(registrarId);
          reset({
            name: editing.name,
            domain: editing.domain,
            remote_port: editing.remote_port,
            local_port: editing.local_port,
            rtp_port: editing.rtp_port,
            listening_port: editing.listening_port ?? undefined,
            transport: (editing.transport ?? "udp") as RegistrarFormValues["transport"],
            username: editing.username,
            password: password, // Populate with current password
            realm: editing.realm || "",
            timeout_seconds: editing.timeout_seconds,
            retry_count: editing.retry_count,
            register_interval_seconds: editing.register_interval_seconds,
            voicemail_number: editing.voicemail_number ?? "",
            mwi_enabled: editing.mwi_enabled ?? false,
            auto_register: editing.auto_register ?? false,
            group: editing.group ?? undefined,
          });
        } catch (error) {
          console.error("Failed to load password:", error);
          // If password loading fails, still populate other fields
          reset({
            name: editing.name,
            domain: editing.domain,
            remote_port: editing.remote_port,
            local_port: editing.local_port,
            rtp_port: editing.rtp_port,
            listening_port: editing.listening_port ?? undefined,
            transport: (editing.transport ?? "udp") as RegistrarFormValues["transport"],
            username: editing.username,
            password: "", // Fallback to empty if decryption fails
            realm: editing.realm || "",
            timeout_seconds: editing.timeout_seconds,
            retry_count: editing.retry_count,
            register_interval_seconds: editing.register_interval_seconds,
            voicemail_number: editing.voicemail_number ?? "",
            mwi_enabled: editing.mwi_enabled ?? false,
            auto_register: editing.auto_register ?? false,
            group: editing.group ?? undefined,
          });
        }
      };
      loadPassword();
    } else {
      // Set default local port for new registrar
      reset(REGISTRAR_FORM_DEFAULTS);
      getDefaultLocalPort().then((port) => {
        setValue("local_port", port);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, registrarId, reset, setValue]);

  useEffect(() => {
    if (formData.local_port) {
      setCheckingPort(true);
      checkLocalPort(formData.local_port).then((available) => {
        setLocalPortAvailable(available);
        setCheckingPort(false);
      });
    }
  }, [formData.local_port, checkLocalPort]);

  const applyExtensionAsLocalPort = () => {
    const ext = extensionInput.trim() ? parseInt(extensionInput, 10) : NaN;
    if (!Number.isNaN(ext) && ext >= 0 && ext <= 65535 - BASE_LOCAL_PORT) {
      setFormData((prev) => ({ ...prev, local_port: BASE_LOCAL_PORT + ext }));
      setExtensionHelperOpen(false);
      setExtensionInput("");
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-[min(72rem,calc(100vw-2rem))] max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Registrar" : "Add New Registrar"}</DialogTitle>
          <DialogDescription>
            Paste a full URL like <span className="font-mono text-foreground/80">sip.provider.com:6070</span> into Server URL and port / transport / username auto-fill.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">

          {/* ── Section: Server ── */}
          <div className="space-y-4">
            <h3 className="section-label">Server</h3>
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="name">Name</Label>
                  <TooltipWrapper entry={tooltips.regEditorName}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipWrapper>
                </div>
                <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required placeholder="My Registrar" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="domain">Server URL</Label>
                  <TooltipWrapper entry={tooltips.regEditorDomain}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipWrapper>
                </div>
                <Input
                  id="domain"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text");
                    if (pasted) { e.preventDefault(); applySmartParse(pasted); if (!parseServerInput(pasted)) setFormData((prev) => ({ ...prev, domain: pasted.trim() })); }
                  }}
                  onBlur={() => applySmartParse(formData.domain)}
                  required
                  placeholder="sip.provider.com  or  sip.provider.com:6070"
                />
                {parsedHint && <p className="text-xs text-success animate-in fade-in slide-in-from-top-1 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">{parsedHint}</p>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="transport">Transport</Label>
                  <TooltipWrapper entry={tooltips.regEditorTransport}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" /></TooltipWrapper>
                </div>
                <Select value={formData.transport} onValueChange={(value) => setFormData({ ...formData, transport: value as RegistrarFormValues["transport"] })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="tls">TLS</SelectItem>
                    <SelectItem value="wss">WSS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="remote_port">Remote Port</Label>
                  <TooltipWrapper entry={tooltips.regEditorRemotePort}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" /></TooltipWrapper>
                </div>
                <Input id="remote_port" type="number" min="1" max="65535" value={formData.remote_port} onChange={(e) => setFormData({ ...formData, remote_port: parseInt(e.target.value) || 5060 })} required />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="realm">Realm</Label>
                  <TooltipWrapper entry={tooltips.regEditorRealm}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipWrapper>
                </div>
                <Input id="realm" value={formData.realm} onChange={(e) => setFormData({ ...formData, realm: e.target.value })} placeholder="optional" />
              </div>
            </div>
          </div>

          <hr className="border-border/50" />

          {/* ── Section: Authentication ── */}
          <div className="space-y-4">
            <h3 className="section-label">Authentication</h3>
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="username">Username</Label>
                  <TooltipWrapper entry={tooltips.regEditorUsername}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipWrapper>
                </div>
                <Input id="username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required placeholder="user123" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="password">Password</Label>
                  <TooltipWrapper entry={tooltips.regEditorPassword}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipWrapper>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required={!editing}
                    placeholder={editing ? "••••••" : ""}
                    className="pr-9"
                  />
                  <TooltipWrapper title={showPassword ? "Hide password" : "Show password"} description={showPassword ? "Mask the password field." : "Reveal the password in plain text."}>
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-smooth" tabIndex={-1}>
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </TooltipWrapper>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="voicemail_number">Voicemail Number</Label>
                <Input
                  id="voicemail_number"
                  value={formData.voicemail_number}
                  onChange={(e) => setFormData({ ...formData, voicemail_number: e.target.value })}
                  placeholder="*97 (optional)"
                />
              </div>
            </div>
          </div>

          <hr className="border-border/50" />

          {/* ── Section: Network ── */}
          <div className="space-y-4">
            <h3 className="section-label">Network</h3>
            <div className="grid grid-cols-4 gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="local_port">
                    Local Port
                    {checkingPort && <span className="text-muted-foreground ml-1 text-2xs">(checking…)</span>}
                    {!checkingPort && localPortAvailable === false && <span className="text-destructive ml-1 text-2xs">(in use)</span>}
                    {!checkingPort && localPortAvailable === true && <span className="text-success ml-1 text-2xs">(ok)</span>}
                  </Label>
                  <TooltipWrapper entry={tooltips.regEditorLocalPort}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" /></TooltipWrapper>
                </div>
                <div className="flex gap-1.5">
                  <Input
                    id="local_port" type="number" min="1" max="65535"
                    value={formData.local_port || ""}
                    onChange={(e) => setFormData({ ...formData, local_port: e.target.value ? parseInt(e.target.value) : undefined })}
                    placeholder="Auto" className="flex-1 min-w-0"
                  />
                  <TooltipWrapper title="Calculate from extension" description="Set local port as 5060 + extension number (e.g. ext 10 = 5070).">
                    <Button type="button" variant="neutral" size="icon" className="h-9 w-9 shrink-0" onClick={() => {
                      setExtensionHelperOpen((o) => !o);
                      if (formData.local_port != null && formData.local_port >= BASE_LOCAL_PORT) setExtensionInput(String(formData.local_port - BASE_LOCAL_PORT));
                      else setExtensionInput("");
                    }} aria-expanded={extensionHelperOpen}><Calculator className="h-4 w-4" /></Button>
                  </TooltipWrapper>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="listening_port">Listen Port</Label>
                  <TooltipWrapper title="Listen Port" description="Inbound SIP listen port (Contact header). Leave blank to use the same as local port."><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" /></TooltipWrapper>
                </div>
                <Input id="listening_port" type="number" min="1" max="65535" value={formData.listening_port ?? ""} onChange={(e) => setFormData({ ...formData, listening_port: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="= local" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="rtp_port">RTP Port</Label>
                  <TooltipWrapper entry={tooltips.regEditorRtpPort}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" /></TooltipWrapper>
                </div>
                <Input id="rtp_port" type="number" min="1024" max="65535" value={formData.rtp_port ?? ""} onChange={(e) => setFormData({ ...formData, rtp_port: e.target.value ? parseInt(e.target.value, 10) : undefined })} placeholder="Auto (from pool)" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="register_interval">Re-register interval</Label>
                  <TooltipWrapper entry={tooltips.regEditorRegisterInterval}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipWrapper>
                </div>
                <Input id="register_interval" type="number" min="1" value={formData.register_interval_seconds || ""} onChange={(e) => setFormData({ ...formData, register_interval_seconds: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="3600s" />
              </div>
            </div>

            {/* Extension helper (inline bar, sits below ports when open) */}
            {extensionHelperOpen && (
              <div className="rounded-lg bg-muted/30 px-4 py-2.5 flex items-center gap-3">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{BASE_LOCAL_PORT} +</span>
                <Input type="number" min={0} max={65535 - BASE_LOCAL_PORT} placeholder="Ext" value={extensionInput} onChange={(e) => setExtensionInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyExtensionAsLocalPort()} className="h-8 w-24 text-xs" autoFocus />
                <span className="text-xs text-muted-foreground">=</span>
                <span className="text-xs font-semibold tabular-nums min-w-[3rem]">{extensionInput && !Number.isNaN(parseInt(extensionInput, 10)) ? BASE_LOCAL_PORT + parseInt(extensionInput, 10) : "—"}</span>
                <TooltipWrapper title="Apply" description="Set the local port to 5060 + the entered extension number.">
                  <Button type="button" size="sm" variant="primary" className="h-7 text-xs px-3" onClick={applyExtensionAsLocalPort}>Apply</Button>
                </TooltipWrapper>
              </div>
            )}
          </div>

          <hr className="border-border/50" />

          {/* ── Options row ── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <TooltipWrapper title="Auto-register on startup" description="When enabled, this registrar will automatically send a REGISTER request when the app starts. Otherwise you must manually register.">
                <label htmlFor="auto_register" className="flex items-center gap-2 cursor-pointer select-none">
                  <Switch
                    id="auto_register"
                    checked={formData.auto_register}
                    onCheckedChange={(checked) => setFormData({ ...formData, auto_register: checked })}
                  />
                  <span className="text-sm text-foreground">Auto-register on startup</span>
                </label>
              </TooltipWrapper>
            </div>

            <TooltipWrapper title={showAdvanced ? "Hide advanced settings" : "Show advanced settings"} description="Timeout, retries, and other advanced options.">
              <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-smooth">
                <span className="text-2xs">{showAdvanced ? "▼" : "▶"}</span>
                <span>Advanced</span>
              </button>
            </TooltipWrapper>
          </div>
          {showAdvanced && (
            <div className="grid grid-cols-4 gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="timeout">Timeout (s)</Label>
                  <TooltipWrapper entry={tooltips.regEditorTimeout}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipWrapper>
                </div>
                <Input id="timeout" type="number" min="1" value={formData.timeout_seconds} onChange={(e) => setFormData({ ...formData, timeout_seconds: parseInt(e.target.value) || 30 })} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="retry">Retries</Label>
                  <TooltipWrapper entry={tooltips.regEditorRetry}><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipWrapper>
                </div>
                <Input id="retry" type="number" min="0" value={formData.retry_count} onChange={(e) => setFormData({ ...formData, retry_count: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
          )}

          </div>
          <DialogFooter className="surface-subtle sticky bottom-0 z-10 border-t border-border/50 px-6 py-4">
            <TooltipWrapper title="Cancel" description="Close without saving changes.">
              <Button type="button" variant="neutral" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            </TooltipWrapper>
            <TooltipWrapper title="Save" description="Save registrar configuration and close.">
              <RegistrarEditorSubmitButton isSubmitting={isSubmitting} />
            </TooltipWrapper>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
