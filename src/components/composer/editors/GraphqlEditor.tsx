/**
 * GraphQL Editor — query builder with variables panel, headers, auth, and response viewer.
 * Sends queries via HTTP POST to the GraphQL endpoint.
 */

import { useState, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useComposerStore, interpolateVariables } from "@/stores/composerStore";
import { crafterSendHttp } from "@/api/crafter";
import { HttpResponseViewer } from "../panels/ResponseViewer";
import type { HttpResponseData } from "../panels/ResponseViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { KeyValueEditor } from "@/components/request-crafter/KeyValueEditor";
import { useToastContext } from "@/contexts/ToastContext";
import { Loader2, Send, AlertCircle, X, Code, RefreshCw } from "@/lib/icons";
import { PanelResizeHandle } from "@/components/ui/panel-chrome";
import type { ComposerItem, GraphqlData } from "@/types/composer";
import {
  useComposerSplitPane,
  useComposerUserAgent,
  upsertHeader,
  hasHeader,
  type HeaderEntry,
} from "./editorShared";

interface Props {
  item: ComposerItem;
}

const graphqlRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL is required.")
    .regex(/^https?:\/\//i, "GraphQL endpoint must start with http:// or https://."),
  query: z.string().trim().min(1, "Query is required."),
  variables: z.string(),
}).superRefine((value, ctx) => {
  if (value.variables.trim()) {
    try {
      JSON.parse(value.variables);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variables"],
        message: "Variables must be valid JSON.",
      });
    }
  }
});

type GraphqlRequestFormValues = z.infer<typeof graphqlRequestSchema>;

function normalizeGraphqlHeaders(headersIn: HeaderEntry[], defaultUserAgent: string): HeaderEntry[] {
  const headers = headersIn.filter((h) => h.key.trim());
  const add = (key: string, value: string) => {
    if (!hasHeader(headers, key)) headers.push({ key, value });
  };
  add("Content-Type", "application/json");
  add("Accept", "application/graphql-response+json, application/json");
  add("User-Agent", defaultUserAgent);
  return headers;
}

export function GraphqlEditor({ item }: Props) {
  const updateItem = useComposerStore((s) => s.updateItem);
  const markTabDirty = useComposerStore((s) => s.markTabDirty);
  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const uiPrefs = useComposerStore((s) => s.uiPrefs);
  const setUiPrefs = useComposerStore((s) => s.setUiPrefs);
  const toast = useToastContext();

  const gql = item.graphqlData!;
  const setData = useCallback(
    (updates: Partial<GraphqlData>) => {
      updateItem(item.id, { graphqlData: { ...gql, ...updates } });
      markTabDirty(item.id, true);
    },
    [updateItem, item.id, gql, markTabDirty]
  );

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<HttpResponseData | null>(null);
  const defaultUserAgent = useComposerUserAgent("composerGraphql");
  const {
    setValue,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<GraphqlRequestFormValues>({
    resolver: zodResolver(graphqlRequestSchema),
    defaultValues: {
      url: gql.url,
      query: gql.query,
      variables: gql.variables,
    },
  });

  useEffect(() => {
    reset({
      url: gql.url,
      query: gql.query,
      variables: gql.variables,
    });
  }, [gql.url, gql.query, gql.variables, reset]);

  const refreshGraphqlHeaders = useCallback(() => {
    const headers = [...gql.headers.filter((h) => h.key.trim())];
    upsertHeader(headers, "Content-Type", "application/json");
    upsertHeader(headers, "Accept", "application/graphql-response+json, application/json");
    upsertHeader(headers, "User-Agent", defaultUserAgent);
    setData({ headers });
    toast.info("Headers Refreshed", "GraphQL headers refreshed.");
  }, [gql.headers, setData, toast, defaultUserAgent]);

  const { splitRef, splitPercent, handleDragStart } = useComposerSplitPane(
    uiPrefs.splitPercent,
    (splitPercentValue) => setUiPrefs({ splitPercent: splitPercentValue }),
  );

  // ── Send ─────────────────────────────────────────────────────────────────
  const onInvalidSend = () => {
    const msg =
      errors.url?.message ??
      errors.query?.message ??
      errors.variables?.message ??
      "Please correct the request before sending.";
    setError(msg);
  };

  const runSend = async () => {
    setError(null);
    setSending(true);
    setResponse(null);

    try {
      const resolvedUrl = interpolateVariables(gql.url);

      const variables = gql.variables.trim()
        ? JSON.parse(interpolateVariables(gql.variables))
        : {};

      const body = JSON.stringify({
        query: gql.query,
        variables,
      });

      const headers = normalizeGraphqlHeaders(gql.headers, defaultUserAgent).map((h) => ({
          key: interpolateVariables(h.key),
          value: interpolateVariables(h.value),
        }));

      const auth =
        gql.auth.type === "none"
          ? undefined
          : {
              type: gql.auth.type,
              username: gql.auth.username,
              password: gql.auth.password,
              bearer_token: gql.auth.bearerToken,
              custom_header: gql.auth.customHeader ?? undefined,
              custom_value: gql.auth.customValue ?? undefined,
            };

      const result = await crafterSendHttp({
        method: "POST",
        url: resolvedUrl,
        headers,
        body,
        auth,
        follow_redirects: true,
        timeout_ms: 30000,
      });

      setResponse(result as HttpResponseData);

      addHistoryEntry({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: "graphql",
        method: "POST",
        target: resolvedUrl,
        statusCode: result.status_code,
        roundTripMs: result.timing_ms,
        timestamp: Date.now(),
        itemId: item.id,
      });

      if (result.status_code >= 200 && result.status_code < 300) {
        toast.success("GraphQL Response", `${result.status_code} — ${result.timing_ms}ms`, { source: "composer" });
      } else {
        toast.error("GraphQL Error", `${result.status_code} ${result.status_text}`, { source: "composer" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request Failed", msg, { source: "composer" });
    } finally {
      setSending(false);
    }
  };
  const handleSend = handleSubmit(runSend, onInvalidSend);

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
        <div className="shrink-0 flex items-center gap-1.5 px-3 h-9 bg-primary/10 text-primary border border-primary/20 rounded-l-lg text-xs font-mono font-medium">
          <Code className="size-3.5" />
          GQL
        </div>
        <Input
          value={gql.url}
          onChange={(e) => {
            const next = e.target.value;
            setData({ url: next });
            setValue("url", next, { shouldDirty: true });
          }}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void handleSend()}
          placeholder="https://api.example.com/graphql"
          className="font-mono flex-1 h-9 border-l-0 rounded-l-none min-w-0"
        />
        <Button onClick={() => void handleSend()} disabled={sending} className="h-9 px-5 gap-2 shrink-0">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send
        </Button>
      </div>

      {/* Query + Response split */}
      <div ref={splitRef} className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* Query pane */}
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: `${splitPercent}%` }}>
          <Tabs defaultValue="query" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="subview-tabs-compact mx-4 mt-3 mb-0 shrink-0">
              <TabsTrigger value="query" className="subview-tab-compact">Query</TabsTrigger>
              <TabsTrigger value="variables" className="subview-tab-compact">Variables</TabsTrigger>
              <TabsTrigger value="headers" className="subview-tab-compact">Headers</TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              <TabsContent value="query" className="mt-3">
                <Textarea
                  value={gql.query}
                  onChange={(e) => {
                    const next = e.target.value;
                    setData({ query: next });
                    setValue("query", next, { shouldDirty: true });
                  }}
                  placeholder="{\n  users {\n    id\n    name\n  }\n}"
                  className="font-mono text-sm min-h-[200px]"
                />
              </TabsContent>
              <TabsContent value="variables" className="mt-3">
                <Textarea
                  value={gql.variables}
                  onChange={(e) => {
                    const next = e.target.value;
                    setData({ variables: next });
                    setValue("variables", next, { shouldDirty: true });
                  }}
                  placeholder='{"userId": "123"}'
                  className="font-mono text-sm min-h-[120px]"
                />
              </TabsContent>
              <TabsContent value="headers" className="mt-3">
                <KeyValueEditor
                  items={gql.headers}
                  onChange={(headers) => setData({ headers })}
                  keyPlaceholder="Header"
                  valuePlaceholder="Value"
                />
                <div className="mt-3">
                  <Button variant="neutral" size="sm" onClick={refreshGraphqlHeaders} className="gap-1.5 h-8 text-xs">
                    <RefreshCw className="size-3" />
                    Refresh required headers
                  </Button>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <PanelResizeHandle
          orientation="vertical"
          density="comfortable"
          appearance="grip"
          label="Resize GraphQL query and response panels"
          onMouseDown={handleDragStart}
        />

        {/* Response pane */}
        <div className="min-h-0 overflow-hidden" style={{ width: `${100 - splitPercent}%` }}>
          <HttpResponseViewer response={response} sending={sending} />
        </div>
      </div>
    </div>
  );
}
