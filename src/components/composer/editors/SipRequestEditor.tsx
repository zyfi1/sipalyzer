/**
 * SIP Request Editor — SIP message builder with digest auth, auto-header fill,
 * registrar import, and full response timeline.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useComposerStore, interpolateVariables, generateCallId, generateBranch, generateFromTag } from "@/stores/composerStore";
import { crafterSendSip } from "@/api/crafter";
import { KeyValueEditor } from "@/components/request-crafter/KeyValueEditor";
import { SipResponseViewer } from "../panels/ResponseViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { useToastContext } from "@/contexts/ToastContext";
import { Loader2, Send, RefreshCw, AlertCircle, X, GripVertical, Download } from "@/lib/icons";
import { SIP_METHODS } from "@/types/crafter";
import type { SipResponsePart, SipRequestDraft } from "@/types/crafter";
import { getHeaderSuggestions, getValueSuggestions } from "@/components/request-crafter/crafterSuggestions";
import { useRegistrationStore, type Registrar } from "@/stores/registrationStore";
import type { ComposerItem } from "@/types/composer";
import { useComposerSplitPane, useComposerUserAgent } from "./editorShared";

function extractHostPort(uri: string): { host: string; port?: number } {
  try {
    const m = uri.match(/sip:(?:[^@]+@)?([^:;?\s]+)(?::(\d+))?/);
    if (m) return { host: m[1] ?? uri, port: m[2] ? parseInt(m[2], 10) : undefined };
  } catch { /* ignore */ }
  return { host: uri, port: undefined };
}

const sipRequestSchema = z.object({
  method: z.string().trim().min(1, "SIP method is required."),
  uri: z
    .string()
    .trim()
    .min(1, "Request-URI is required.")
    .regex(/^sips?:/i, "URI must start with sip: or sips:."),
}).superRefine((value, ctx) => {
  const hostMatch = value.uri.match(/sips?:(?:[^@]+@)?([^:;?\s]+)/);
  if (!hostMatch || !hostMatch[1]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["uri"],
      message: "URI must include a host.",
    });
  }
});

type SipRequestFormValues = z.infer<typeof sipRequestSchema>;

interface Props {
  item: ComposerItem;
}

const DEFAULT_LOCAL_SIP_HOST = "localhost";
const DEFAULT_LOCAL_SIP_PORT = 5062;

function sipContentLength(body: string): string {
  return String(new TextEncoder().encode(body).length);
}

function extractSipUserHost(uri: string): { user: string | null; host: string } {
  const m = uri.match(/^sips?:([^@]+)@([^:;?\s]+)|^sips?:([^:;?\s]+)/i);
  if (!m) return { user: null, host: "example.com" };
  if (m[1] && m[2]) return { user: m[1], host: m[2] };
  return { user: null, host: m[3] ?? "example.com" };
}

export function SipRequestEditor({ item }: Props) {
  const updateItem = useComposerStore((s) => s.updateItem);
  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const markTabDirty = useComposerStore((s) => s.markTabDirty);
  const uiPrefs = useComposerStore((s) => s.uiPrefs);
  const setUiPrefs = useComposerStore((s) => s.setUiPrefs);
  const toast = useToastContext();

  const draft = item.sipData!;
  const setDraft = useCallback(
    (updates: Partial<SipRequestDraft>) => {
      updateItem(item.id, { sipData: { ...draft, ...updates } });
      markTabDirty(item.id, true);
    },
    [updateItem, item.id, draft, markTabDirty]
  );

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<SipResponsePart[]>([]);
  const defaultUserAgent = useComposerUserAgent("composerSip");
  const {
    setValue,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<SipRequestFormValues>({
    resolver: zodResolver(sipRequestSchema),
    defaultValues: {
      method: draft.method,
      uri: draft.uri,
    },
  });

  useEffect(() => {
    reset({
      method: draft.method,
      uri: draft.uri,
    });
  }, [draft.method, draft.uri, reset]);

  const { splitRef, splitPercent, handleDragStart } = useComposerSplitPane(
    uiPrefs.splitPercent,
    (splitPercentValue) => setUiPrefs({ splitPercent: splitPercentValue }),
  );

  // ── Auto-sync: auth username → From/To/Contact headers ───────────────────
  const prevAuthUsername = useRef(draft.auth?.username ?? "");
  useEffect(() => {
    const username = draft.auth?.username ?? "";
    const prev = prevAuthUsername.current;
    prevAuthUsername.current = username;
    if (!username || username === prev) return;
    const isRegister = draft.method === "REGISTER";
    let changed = false;
    const newHeaders = draft.headers.map((h) => {
      const lower = h.key.toLowerCase();
      if (lower === "from" || lower === "contact") {
        const updated = h.value.replace(/<sip:[^@>]*@/, `<sip:${username}@`);
        if (updated !== h.value) { changed = true; return { ...h, value: updated }; }
      }
      if (isRegister && lower === "to") {
        const updated = h.value.replace(/<sip:[^@>]*@/, `<sip:${username}@`);
        if (updated !== h.value) { changed = true; return { ...h, value: updated }; }
      }
      return h;
    });
    if (changed) setDraft({ headers: newHeaders });
  }, [draft.auth?.username, draft.method, draft.headers, setDraft]);

  // ── Auto-sync: URI → To header + domain ──────────────────────────────────
  const prevUri = useRef(draft.uri);
  useEffect(() => {
    const uri = draft.uri;
    const prev = prevUri.current;
    prevUri.current = uri;
    if (!uri || uri === prev) return;
    const m = uri.match(/^sip:(?:([^@]+)@)?([^:;?\s]+)/);
    if (!m) return;
    const uriUser = m[1];
    const uriHost = m[2];
    if (!uriHost) return;
    const isRegister = draft.method === "REGISTER";
    let changed = false;
    const newHeaders = draft.headers.map((h) => {
      const lower = h.key.toLowerCase();
      if (isRegister) {
        if (lower === "from" || lower === "to") {
          const updated = h.value.replace(/@[^>;]+/, `@${uriHost}`);
          if (updated !== h.value) { changed = true; return { ...h, value: updated }; }
        }
      } else {
        if (lower === "to") {
          const newTo = uriUser ? `<sip:${uriUser}@${uriHost}>` : `<sip:${uriHost}>`;
          if (h.value !== newTo) { changed = true; return { ...h, value: newTo }; }
        }
      }
      return h;
    });
    if (changed) setDraft({ headers: newHeaders });
  }, [draft.uri, draft.method, draft.headers, setDraft]);

  // ── Auto-fill headers ────────────────────────────────────────────────────
  const applySipHeaders = useCallback(() => {
    const { host } = extractHostPort(draft.uri);
    const normalizedMethod = (draft.method?.trim() || "OPTIONS").toUpperCase();
    const uriValue = draft.uri.trim() || `sip:${host || "example.com"}`;
    const { user: uriUser, host: uriHost } = extractSipUserHost(uriValue);
    const fromUser = draft.auth?.username?.trim() || uriUser || "sipalyzer";
    const localHost = DEFAULT_LOCAL_SIP_HOST;
    const localPort = DEFAULT_LOCAL_SIP_PORT;
    const branch = generateBranch();
    const tag = generateFromTag();
    const callId = generateCallId();
    const headers = [...draft.headers];
    const upsert = (name: string, value: string) => {
      const idx = headers.findIndex((h) => h.key.toLowerCase() === name.toLowerCase());
      if (idx === -1) headers.push({ key: name, value });
      else headers[idx] = { key: headers[idx]?.key ?? name, value };
    };
    const remove = (name: string) => {
      const idx = headers.findIndex((h) => h.key.toLowerCase() === name.toLowerCase());
      if (idx !== -1) headers.splice(idx, 1);
    };
    const proto = draft.transport;
    const toValue = normalizedMethod === "REGISTER"
      ? `<sip:${fromUser}@${uriHost}>`
      : `<${uriValue}>`;

    upsert("Via", `SIP/2.0/${proto} ${localHost}:${localPort};branch=${branch};rport`);
    upsert("From", `<sip:${fromUser}@${host || uriHost}>;tag=${tag}`);
    upsert("To", toValue);
    upsert("Call-ID", callId);
    upsert("CSeq", `1 ${normalizedMethod}`);
    upsert("Max-Forwards", "70");
    upsert("Contact", `<sip:${fromUser}@${localHost}:${localPort};transport=${proto.toLowerCase()}>`);
    upsert("User-Agent", defaultUserAgent);
    if (draft.body.trim()) upsert("Content-Type", draft.bodyContentType || "application/sdp");
    else remove("Content-Type");
    upsert("Content-Length", draft.body ? sipContentLength(draft.body) : "0");
    setDraft({ headers });
    toast.info("Headers Refreshed", `SIP headers refreshed for ${normalizedMethod}.`);
  }, [draft, setDraft, toast, defaultUserAgent]);

  // ── Send ─────────────────────────────────────────────────────────────────
  const onInvalidSend = () => {
    const msg =
      errors.method?.message ??
      errors.uri?.message ??
      "Please correct the request before sending.";
    setError(msg);
    toast.warning("Validation Error", msg);
  };

  const runSend = async () => {
    setError(null);
    setSending(true);
    try {
      const { host, port } = extractHostPort(interpolateVariables(draft.uri));
      const method = draft.method?.trim() || "OPTIONS";
      const result = await crafterSendSip({
        method,
        uri: interpolateVariables(draft.uri),
        headers: draft.headers.map((h) => ({ key: h.key, value: interpolateVariables(h.value) })),
        body: draft.body ? interpolateVariables(draft.body) : undefined,
        transport: draft.transport,
        target_host: host,
        target_port: port,
        auth: draft.auth
          ? { username: draft.auth.username, password: draft.auth.password, realm: draft.auth.realm }
          : undefined,
        timeout_sec: uiPrefs.responseTimeoutSec,
      });
      const parsed: SipResponsePart[] = result.responses.map((r) => ({
        raw: r.raw,
        statusCode: r.status_code,
        statusText: r.status_text,
        headers: r.headers.map((h) => ({ key: h.key, value: h.value })),
        body: r.body,
        timestamp: r.timestamp,
        roundTripMs: r.round_trip_ms,
      }));
      setResponses(parsed);
      const last = parsed[parsed.length - 1];
      addHistoryEntry({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: "sip",
        method,
        target: draft.uri,
        statusCode: last?.statusCode,
        roundTripMs: last?.roundTripMs,
        timestamp: Date.now(),
        itemId: item.id,
      });
      if (last?.statusCode) {
        const timing = last.roundTripMs != null ? ` — ${last.roundTripMs}ms` : "";
        if (last.statusCode >= 200 && last.statusCode < 300) toast.success("SIP Response", `${last.statusCode} ${last.statusText ?? ""}${timing}`, { source: "composer" });
        else if (last.statusCode >= 400) toast.error("SIP Response", `${last.statusCode} ${last.statusText ?? ""}${timing}`, { source: "composer" });
        else toast.info("SIP Response", `${last.statusCode} ${last.statusText ?? ""}${timing}`, { source: "composer" });
      } else if (parsed.length === 0) {
        toast.warning("No Response", `No SIP response received within ${uiPrefs.responseTimeoutSec}s.`, { source: "composer" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setResponses([]);
      toast.error("Request Failed", msg, { source: "composer" });
    } finally {
      setSending(false);
    }
  };
  const handleSend = handleSubmit(runSend, onInvalidSend);

  // ── Import from registrar ────────────────────────────────────────────────
  const registrars = useRegistrationStore((s) => s.registrars);
  const fetchRegistrars = useRegistrationStore((s) => s.fetchRegistrars);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const importRef = useRef<HTMLDivElement>(null);

  const handleImportOpen = useCallback(() => {
    fetchRegistrars();
    setShowImportMenu((v) => !v);
  }, [fetchRegistrars]);

  useEffect(() => {
    if (!showImportMenu) return;
    const handler = (e: MouseEvent) => {
      if (importRef.current && !importRef.current.contains(e.target as Node)) setShowImportMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showImportMenu]);

  const handleImportRegistrar = useCallback((reg: Registrar) => {
    const domain = reg.domain;
    const port = reg.remote_port !== 5060 ? `:${reg.remote_port}` : "";
    const uri = `sip:${domain}${port}`;
    const transport = (reg.transport || "UDP").toUpperCase() as "UDP" | "TCP" | "TLS";
    const user = reg.username || "user";
    const localPort = reg.local_port ?? DEFAULT_LOCAL_SIP_PORT;
    const localHost = DEFAULT_LOCAL_SIP_HOST;
    const branch = generateBranch();
    const tag = generateFromTag();
    const callId = generateCallId();
    setDraft({
      method: "REGISTER",
      uri,
      transport,
      headers: [
        { key: "Via", value: `SIP/2.0/${transport} ${localHost}:${localPort};branch=${branch};rport` },
        { key: "Max-Forwards", value: "70" },
        { key: "From", value: `<sip:${user}@${domain}>;tag=${tag}` },
        { key: "To", value: `<sip:${user}@${domain}>` },
        { key: "Call-ID", value: callId },
        { key: "CSeq", value: "1 REGISTER" },
        { key: "Contact", value: `<sip:${user}@${localHost}:${localPort};transport=${transport.toLowerCase()}>` },
        { key: "Expires", value: "3600" },
        { key: "Allow", value: "INVITE, ACK, BYE, CANCEL, OPTIONS, NOTIFY, REFER, SUBSCRIBE, INFO, MESSAGE" },
        { key: "User-Agent", value: defaultUserAgent },
        { key: "Content-Length", value: "0" },
      ],
      body: "",
      bodyContentType: "",
      auth: { username: user, password: "", realm: reg.realm || undefined },
    });
    setShowImportMenu(false);
    toast.success("Imported", `Loaded registration "${reg.name || domain}" into builder`, { source: "composer" });
  }, [setDraft, toast, defaultUserAgent]);

  // ── Autocomplete ─────────────────────────────────────────────────────────
  const headerKeySuggestions = useMemo(() => getHeaderSuggestions("sip"), []);
  const headerValueSuggestionsMap = useCallback(
    (key: string) => getValueSuggestions("sip", key),
    []
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {error && (
        <div className="flex-shrink-0 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 flex items-center gap-3 mx-4 mt-2">
          <AlertCircle className="size-4 text-destructive shrink-0" />
          <span className="text-sm text-destructive flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0">
            <X className="size-4 text-destructive/60 hover:text-destructive transition-smooth" />
          </button>
        </div>
      )}

      {/* URL bar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border/50">
        <TooltipWrapper entry={tooltips.crafterSipMethod}>
          <Select value={draft.method} onValueChange={(v) => {
            setDraft({ method: v });
            setValue("method", v, { shouldDirty: true });
          }}>
            <SelectTrigger className="w-36 h-9 font-mono text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIP_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.crafterSipTransport}>
          <Select
            value={draft.transport}
            onValueChange={(v) => setDraft({ transport: v as "UDP" | "TCP" | "TLS" })}
          >
            <SelectTrigger className="w-20 h-9 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UDP">UDP</SelectItem>
              <SelectItem value="TCP">TCP</SelectItem>
              <SelectItem value="TLS">TLS</SelectItem>
            </SelectContent>
          </Select>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.crafterSipUri}>
          <Input
            value={draft.uri}
            onChange={(e) => {
              const next = e.target.value;
              setDraft({ uri: next });
              setValue("uri", next, { shouldDirty: true });
            }}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void handleSend()}
            placeholder="sip:user@host:5060"
            className="font-mono flex-1 h-9 min-w-0"
          />
        </TooltipWrapper>

        {/* Import from Registrar */}
        <div ref={importRef} className="relative shrink-0">
          <TooltipWrapper title="Import Registrar" description="Fill fields from an existing registration">
            <Button variant="neutral" size="sm" className="h-9 px-3 gap-1.5 text-xs" onClick={handleImportOpen}>
              <Download className="size-3.5" />
              Import
            </Button>
          </TooltipWrapper>
          {showImportMenu && (
            <div className="ui-panel-shell absolute right-0 top-full mt-1 z-50 min-w-[280px] max-h-[320px] overflow-y-auto p-1">
              {registrars.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No registrations found.<br />
                  <span className="text-xs">Create registrations in the Registration tool first.</span>
                </div>
              ) : (
                <div className="py-1">
                  <div className="px-3 py-1.5 text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                    Import from registration
                  </div>
                  {registrars.map((reg) => (
                    <button
                      key={reg.id}
                      type="button"
                      onClick={() => handleImportRegistrar(reg)}
                      className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-smooth"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{reg.name || reg.domain}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {reg.username}@{reg.domain}:{reg.remote_port} ({reg.transport?.toUpperCase() || "UDP"})
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <TooltipWrapper entry={tooltips.crafterSendButton}>
          <Button onClick={() => void handleSend()} disabled={sending} className="h-9 px-5 gap-2 shrink-0">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send
          </Button>
        </TooltipWrapper>
      </div>

      {/* Request + Response split */}
      <div ref={splitRef} className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* Request pane */}
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: `${splitPercent}%` }}>
          <Tabs defaultValue="headers" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="subview-tabs-compact mx-4 mt-3 mb-0 shrink-0">
              <TabsTrigger value="headers" className="subview-tab-compact">Headers</TabsTrigger>
              <TabsTrigger value="body" className="subview-tab-compact">Body</TabsTrigger>
              <TabsTrigger value="auth" className="subview-tab-compact">Auth</TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              <TabsContent value="headers" className="mt-3 space-y-3">
                <KeyValueEditor
                  items={draft.headers}
                  onChange={(headers) => setDraft({ headers })}
                  keyPlaceholder="Header"
                  valuePlaceholder="Value"
                  keySuggestions={headerKeySuggestions}
                  valueSuggestionsMap={headerValueSuggestionsMap}
                />
                <TooltipWrapper entry={tooltips.crafterAutoFillHeaders}>
                  <Button variant="neutral" size="sm" onClick={applySipHeaders} className="gap-1.5 h-8 text-xs">
                    <RefreshCw className="size-3" />
                    Refresh required headers
                  </Button>
                </TooltipWrapper>
              </TabsContent>
              <TabsContent value="body" className="mt-3 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground">Content-Type:</span>
                  <Input
                    value={draft.bodyContentType}
                    onChange={(e) => setDraft({ bodyContentType: e.target.value })}
                    placeholder="application/sdp"
                    className="h-7 text-xs w-48"
                  />
                </div>
                <Textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ body: e.target.value })}
                  placeholder="SDP or body content..."
                  className="font-mono min-h-[120px] text-sm"
                />
              </TabsContent>
              <TabsContent value="auth" className="mt-3 space-y-2">
                <TooltipWrapper entry={tooltips.crafterSipAuth}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Digest Auth (for 401/407)</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraft({ auth: draft.auth ? null : { username: "", password: "" } })}
                      className="h-7 text-xs"
                    >
                      {draft.auth ? "Remove" : "Add"}
                    </Button>
                  </div>
                </TooltipWrapper>
                {draft.auth && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Username" value={draft.auth.username} onChange={(e) => setDraft({ auth: draft.auth ? { ...draft.auth, username: e.target.value } : null })} className="h-8" />
                    <Input type="password" placeholder="Password" value={draft.auth.password} onChange={(e) => setDraft({ auth: draft.auth ? { ...draft.auth, password: e.target.value } : null })} className="h-8" />
                    <Input placeholder="Realm (optional)" value={draft.auth.realm ?? ""} onChange={(e) => setDraft({ auth: draft.auth ? { ...draft.auth, realm: e.target.value || undefined } : null })} className="h-8 col-span-2" />
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Drag handle */}
        <div
          className="shrink-0 flex items-center justify-center w-2 cursor-col-resize group hover:bg-primary/10 active:bg-primary/15 transition-smooth border-x border-border/40 select-none"
          onMouseDown={handleDragStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize request and response panels"
        >
          <GripVertical className="size-4 text-muted-foreground/60 group-hover:text-muted-foreground/70 transition-smooth" />
        </div>

        {/* Response pane */}
        <div className="min-h-0 overflow-hidden" style={{ width: `${100 - splitPercent}%` }}>
          <SipResponseViewer responses={responses} sending={sending} />
        </div>
      </div>
    </div>
  );
}
