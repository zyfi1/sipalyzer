/**
 * HTTP Request Editor — Postman-style request builder within the composer.
 * Method selector, URL bar, params/headers/body/auth tabs, resizable response pane.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useComposerStore, interpolateVariables } from "@/stores/composerStore";
import { crafterSendHttp } from "@/api/crafter";
import { KeyValueEditor } from "@/components/request-crafter/KeyValueEditor";
import { HttpResponseViewer } from "../panels/ResponseViewer";
import type { HttpResponseData } from "../panels/ResponseViewer";
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
import { Loader2, Send, AlertCircle, X, GripVertical, RefreshCw } from "@/lib/icons";
import { getHeaderSuggestions, getValueSuggestions } from "@/components/request-crafter/crafterSuggestions";
import type { ComposerItem, HttpRequestDraft } from "@/types/composer";
import {
  hasHeader,
  removeHeader,
  upsertHeader,
  useComposerSplitPane,
  useComposerUserAgent,
  type HeaderEntry,
} from "./editorShared";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
function buildUrl(base: string, params: Array<{ key: string; value: string }>): string {
  const filtered = params.filter((p) => p.key.trim());
  if (filtered.length === 0) return base;
  const search = new URLSearchParams();
  filtered.forEach((p) => search.set(p.key, p.value));
  const sep = base.includes("?") ? "&" : "?";
  return base + sep + search.toString();
}

const httpRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL is required.")
    .regex(/^https?:\/\//i, "URL must start with http:// or https://."),
  bodyType: z.string(),
  bodyJson: z.string(),
}).superRefine((value, ctx) => {
  if (value.bodyType === "json" && value.bodyJson.trim()) {
    try {
      JSON.parse(value.bodyJson);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bodyJson"],
        message: "JSON body is not valid JSON.",
      });
    }
  }
});

type HttpRequestFormValues = z.infer<typeof httpRequestSchema>;

function normalizeHttpHeaders(draft: HttpRequestDraft, defaultUserAgent: string): HeaderEntry[] {
  const headers = draft.headers.filter((h) => h.key.trim());
  const add = (key: string, value: string) => {
    if (!hasHeader(headers, key)) headers.push({ key, value });
  };

  add("Accept", "*/*");
  add("User-Agent", defaultUserAgent);

  if (draft.bodyType === "json" && draft.bodyJson.trim()) {
    add("Content-Type", "application/json");
  } else if (draft.bodyType === "raw" && draft.bodyRaw.trim()) {
    add("Content-Type", draft.bodyRawContentType || "text/plain");
  } else if ((draft.bodyType === "form" || draft.bodyType === "x-www-form-urlencoded") && draft.bodyForm.some((p) => p.key.trim())) {
    // Body is URLSearchParams encoded in send path, so content-type should match.
    add("Content-Type", "application/x-www-form-urlencoded");
  }

  return headers;
}

interface Props {
  item: ComposerItem;
}

export function HttpRequestEditor({ item }: Props) {
  const updateItem = useComposerStore((s) => s.updateItem);
  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const markTabDirty = useComposerStore((s) => s.markTabDirty);
  const uiPrefs = useComposerStore((s) => s.uiPrefs);
  const setUiPrefs = useComposerStore((s) => s.setUiPrefs);
  const toast = useToastContext();

  const draft = item.httpData!;
  const setDraft = useCallback(
    (updates: Partial<HttpRequestDraft>) => {
      updateItem(item.id, { httpData: { ...draft, ...updates } });
      markTabDirty(item.id, true);
    },
    [updateItem, item.id, draft, markTabDirty]
  );

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<HttpResponseData | null>(null);
  const defaultUserAgent = useComposerUserAgent("composerHttp");
  const {
    setValue,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<HttpRequestFormValues>({
    resolver: zodResolver(httpRequestSchema),
    defaultValues: {
      url: draft.url,
      bodyType: draft.bodyType,
      bodyJson: draft.bodyJson,
    },
  });

  useEffect(() => {
    reset({
      url: draft.url,
      bodyType: draft.bodyType,
      bodyJson: draft.bodyJson,
    });
  }, [draft.url, draft.bodyType, draft.bodyJson, reset]);

  const refreshHttpHeaders = useCallback(() => {
    const headers = [...draft.headers.filter((h) => h.key.trim())];
    const method = draft.method.toUpperCase();
    const hasBody =
      (draft.bodyType === "json" && draft.bodyJson.trim().length > 0) ||
      (draft.bodyType === "raw" && draft.bodyRaw.trim().length > 0) ||
      ((draft.bodyType === "form" || draft.bodyType === "x-www-form-urlencoded") &&
        draft.bodyForm.some((p) => p.key.trim()));

    upsertHeader(headers, "User-Agent", defaultUserAgent);
    upsertHeader(
      headers,
      "Accept",
      method === "GET" || method === "HEAD"
        ? "application/json, */*;q=0.8"
        : "*/*"
    );

    if (hasBody) {
      if (draft.bodyType === "json") upsertHeader(headers, "Content-Type", "application/json");
      else if (draft.bodyType === "raw") upsertHeader(headers, "Content-Type", draft.bodyRawContentType || "text/plain");
      else upsertHeader(headers, "Content-Type", "application/x-www-form-urlencoded");
    } else {
      removeHeader(headers, "Content-Type");
    }

    setDraft({ headers });
    toast.info("Headers Refreshed", `HTTP headers refreshed for ${method}.`);
  }, [draft, setDraft, toast, defaultUserAgent]);

  const { splitRef, splitPercent, handleDragStart } = useComposerSplitPane(
    uiPrefs.splitPercent,
    (splitPercentValue) => setUiPrefs({ splitPercent: splitPercentValue }),
  );

  // ── Send ─────────────────────────────────────────────────────────────────
  const onInvalidSend = () => {
    const msg =
      errors.url?.message ??
      errors.bodyJson?.message ??
      "Please correct the request before sending.";
    setError(msg);
    toast.warning("Validation Error", msg);
  };

  const runSend = async () => {
    setError(null);
    setSending(true);
    setResponse(null);
    try {
      const resolvedUrl = interpolateVariables(buildUrl(draft.url, draft.params));
      let body: string | undefined;
      if (draft.bodyType === "json") body = draft.bodyJson;
      else if (draft.bodyType === "raw") body = draft.bodyRaw;
      else if (draft.bodyType === "x-www-form-urlencoded" || draft.bodyType === "form") {
        const search = new URLSearchParams();
        draft.bodyForm.filter((p) => p.key.trim()).forEach((p) => search.set(p.key, p.value));
        body = search.toString();
      }
      if (body) body = interpolateVariables(body);
      const auth =
        draft.auth.type === "none"
          ? undefined
          : {
              type: draft.auth.type,
              username: draft.auth.username,
              password: draft.auth.password,
              bearer_token: draft.auth.bearerToken,
              custom_header: draft.auth.customHeader ?? undefined,
              custom_value: draft.auth.customValue ?? undefined,
            };
      const result = await crafterSendHttp({
        method: draft.method,
        url: resolvedUrl,
        headers: normalizeHttpHeaders(draft, defaultUserAgent).map((h) => ({
          key: interpolateVariables(h.key),
          value: interpolateVariables(h.value),
        })),
        body: body || undefined,
        auth,
        follow_redirects: true,
        timeout_ms: 30000,
      });
      setResponse(result as HttpResponseData);
      addHistoryEntry({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: "http",
        method: draft.method,
        target: resolvedUrl,
        statusCode: result.status_code,
        roundTripMs: result.timing_ms,
        timestamp: Date.now(),
        itemId: item.id,
      });
      const fmt = (b: number) => b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
      const timing = result.timing_ms != null ? ` — ${result.timing_ms}ms` : "";
      const size = result.size_bytes != null ? `, ${fmt(result.size_bytes)}` : "";
      if (result.status_code >= 200 && result.status_code < 300) {
        toast.success("HTTP Response", `${result.status_code} ${result.status_text}${timing}${size}`, { source: "composer" });
      } else if (result.status_code >= 400) {
        toast.error("HTTP Response", `${result.status_code} ${result.status_text}${timing}`, { source: "composer" });
      } else {
        toast.info("HTTP Response", `${result.status_code} ${result.status_text}${timing}`, { source: "composer" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setResponse(null);
      toast.error("Request Failed", msg, { source: "composer" });
    } finally {
      setSending(false);
    }
  };
  const handleSend = handleSubmit(runSend, onInvalidSend);

  // ── Autocomplete ─────────────────────────────────────────────────────────
  const headerKeySuggestions = useMemo(() => getHeaderSuggestions("http"), []);
  const headerValueSuggestionsMap = useCallback(
    (key: string) => getValueSuggestions("http", key),
    []
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Error banner */}
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
        <TooltipWrapper entry={tooltips.crafterHttpMethod}>
          <Select value={draft.method} onValueChange={(v) => setDraft({ method: v })}>
            <SelectTrigger className="w-32 h-9 font-mono text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.crafterHttpUrl}>
          <Input
            value={draft.url}
            onChange={(e) => {
              const next = e.target.value;
              setDraft({ url: next });
              setValue("url", next, { shouldDirty: true });
            }}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void handleSend()}
            placeholder="https://api.example.com/..."
            className="font-mono flex-1 h-9 min-w-0"
          />
        </TooltipWrapper>
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
          <Tabs defaultValue="params" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="subview-tabs-compact mx-4 mt-3 mb-0 shrink-0">
              <TabsTrigger value="params" className="subview-tab-compact">Params</TabsTrigger>
              <TabsTrigger value="headers" className="subview-tab-compact">Headers</TabsTrigger>
              <TabsTrigger value="body" className="subview-tab-compact">Body</TabsTrigger>
              <TabsTrigger value="auth" className="subview-tab-compact">Auth</TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              <TabsContent value="params" className="mt-3">
                <KeyValueEditor
                  items={draft.params}
                  onChange={(params) => setDraft({ params })}
                  keyPlaceholder="Key"
                  valuePlaceholder="Value"
                />
              </TabsContent>
              <TabsContent value="headers" className="mt-3">
                <KeyValueEditor
                  items={draft.headers}
                  onChange={(headers) => setDraft({ headers })}
                  keyPlaceholder="Header"
                  valuePlaceholder="Value"
                  keySuggestions={headerKeySuggestions}
                  valueSuggestionsMap={headerValueSuggestionsMap}
                />
                <div className="mt-3">
                  <Button variant="neutral" size="sm" onClick={refreshHttpHeaders} className="gap-1.5 h-8 text-xs">
                    <RefreshCw className="size-3" />
                    Refresh required headers
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="body" className="mt-3 space-y-2">
                <Select value={draft.bodyType} onValueChange={(v) => {
                  setDraft({ bodyType: v as typeof draft.bodyType });
                  setValue("bodyType", v, { shouldDirty: true });
                }}>
                  <SelectTrigger className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="form">Form Data</SelectItem>
                    <SelectItem value="x-www-form-urlencoded">x-www-form-urlencoded</SelectItem>
                    <SelectItem value="raw">Raw</SelectItem>
                  </SelectContent>
                </Select>
                {draft.bodyType === "json" && (
                  <Textarea
                    value={draft.bodyJson}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDraft({ bodyJson: next });
                      setValue("bodyJson", next, { shouldDirty: true });
                    }}
                    className="font-mono min-h-[120px] text-sm"
                    placeholder='{"key": "value"}'
                  />
                )}
                {(draft.bodyType === "form" || draft.bodyType === "x-www-form-urlencoded") && (
                  <KeyValueEditor
                    items={draft.bodyForm}
                    onChange={(bodyForm) => setDraft({ bodyForm })}
                    keyPlaceholder="Key"
                    valuePlaceholder="Value"
                  />
                )}
                {draft.bodyType === "raw" && (
                  <Textarea
                    value={draft.bodyRaw}
                    onChange={(e) => setDraft({ bodyRaw: e.target.value })}
                    className="font-mono min-h-[120px] text-sm"
                  />
                )}
              </TabsContent>
              <TabsContent value="auth" className="mt-3 space-y-2">
                <TooltipWrapper entry={tooltips.crafterHttpAuth}>
                  <Select
                    value={draft.auth.type}
                    onValueChange={(v) => setDraft({ auth: { ...draft.auth, type: v as typeof draft.auth.type } })}
                  >
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="basic">Basic</SelectItem>
                      <SelectItem value="bearer">Bearer Token</SelectItem>
                      <SelectItem value="custom">Custom Header</SelectItem>
                    </SelectContent>
                  </Select>
                </TooltipWrapper>
                {draft.auth.type === "basic" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Username" value={draft.auth.username ?? ""} onChange={(e) => setDraft({ auth: { ...draft.auth, username: e.target.value } })} className="h-8" />
                    <Input type="password" placeholder="Password" value={draft.auth.password ?? ""} onChange={(e) => setDraft({ auth: { ...draft.auth, password: e.target.value } })} className="h-8" />
                  </div>
                )}
                {draft.auth.type === "bearer" && (
                  <Input placeholder="Token" value={draft.auth.bearerToken ?? ""} onChange={(e) => setDraft({ auth: { ...draft.auth, bearerToken: e.target.value } })} className="h-8 font-mono" />
                )}
                {draft.auth.type === "custom" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Header name" value={draft.auth.customHeader ?? ""} onChange={(e) => setDraft({ auth: { ...draft.auth, customHeader: e.target.value } })} className="h-8" />
                    <Input placeholder="Value" value={draft.auth.customValue ?? ""} onChange={(e) => setDraft({ auth: { ...draft.auth, customValue: e.target.value } })} className="h-8" />
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
          <HttpResponseViewer response={response} sending={sending} />
        </div>
      </div>
    </div>
  );
}
