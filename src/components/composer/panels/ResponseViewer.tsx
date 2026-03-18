/**
 * Unified response viewer — shared between HTTP and SIP editors.
 * Tabbed display: Body | Headers | Timing.
 * Pretty-prints JSON, shows status badges, copy button, raw toggle.
 */

import { useState, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { cn } from "@/lib/utils";
import {
  Send,
  Loader2,
  Copy,
  CheckCircle,
} from "@/lib/icons";
import { Button } from "@/components/ui/button";
import type { SipResponsePart } from "@/types/crafter";

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusBadgeClass(code: number): string {
  if (code >= 200 && code < 300) return "bg-success/15 text-success border-success/30";
  if (code >= 300 && code < 400) return "bg-warning/15 text-warning border-warning/30";
  if (code >= 400) return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-primary/15 text-primary border-primary/30";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── HTTP Response ───────────────────────────────────────────────────────────

export interface HttpResponseData {
  status_code: number;
  status_text: string;
  headers: Array<{ key: string; value: string }>;
  body: string;
  timing_ms: number;
  size_bytes: number;
}

interface HttpResponseViewerProps {
  response: HttpResponseData | null;
  sending: boolean;
}

export function HttpResponseViewer({ response, sending }: HttpResponseViewerProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");

  const prettyBody = useMemo(() => {
    if (!response?.body) return "";
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  }, [response?.body]);

  const handleCopy = useCallback(() => {
    if (!response) return;
    const headers = response.headers.map((h) => `${h.key}: ${h.value}`).join("\n");
    const text = `${response.status_code} ${response.status_text}\n${headers}\n\n${response.body}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [response]);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden bg-muted/10 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2 text-xs min-w-0 flex-1">
          <span className="text-xs font-medium text-muted-foreground shrink-0">Response</span>
          {response && (
            <>
              <span className={cn("font-mono font-semibold px-2 py-0.5 rounded border text-xs whitespace-nowrap", statusBadgeClass(response.status_code))}>
                {response.status_code} {response.status_text}
              </span>
              <span className="text-muted-foreground whitespace-nowrap">
                {response.timing_ms}ms · {formatBytes(response.size_bytes)}
              </span>
            </>
          )}
          {sending && (
            <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap">
              <Loader2 className="size-3 animate-spin" />
              Sending…
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {response && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={handleCopy} className="h-7 gap-1.5 px-2 text-xs">
                {copied ? <CheckCircle className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <ViewModeToggle mode={viewMode} onChange={setViewMode} />
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!response && !sending && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted/30 mb-3">
              <Send className="size-5 text-muted-foreground/60" />
            </div>
            <p className="text-xs font-medium text-muted-foreground/60">Send a request to see the response</p>
          </div>
        )}
        {sending && !response && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 mb-3">
              <Loader2 className="size-5 animate-spin text-primary/70" />
            </div>
            <p className="text-xs font-medium text-muted-foreground/60">Waiting for response...</p>
          </div>
        )}
        {response && (
          <Tabs defaultValue="body" className="flex flex-col h-full min-h-0">
            <TabsList className="subview-tabs-compact mx-3 mt-2 shrink-0">
              <TabsTrigger value="body" className="subview-tab-compact">Body</TabsTrigger>
              <TabsTrigger value="headers" className="subview-tab-compact">
                Headers
                <span className="ml-1 text-3xs text-muted-foreground">({response.headers.length})</span>
              </TabsTrigger>
              <TabsTrigger value="timing" className="subview-tab-compact">Timing</TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 pt-2">
              <TabsContent value="body" className="mt-0">
                {viewMode === "pretty" ? (
                  <pre className="font-mono text-xs whitespace-pre-wrap break-words bg-muted/30 p-3 rounded-lg">{prettyBody}</pre>
                ) : (
                  <pre className="font-mono text-xs whitespace-pre-wrap break-words">{response.body}</pre>
                )}
              </TabsContent>
              <TabsContent value="headers" className="mt-0">
                <div className="text-xs font-mono space-y-0.5">
                  {response.headers.map((h, i) => (
                    <div key={i}>
                      <span className="text-muted-foreground">{h.key}:</span> {h.value}
                    </div>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="timing" className="mt-0">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total time</span>
                    <span className="font-mono">{response.timing_ms} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Response size</span>
                    <span className="font-mono">{formatBytes(response.size_bytes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-mono">{response.status_code} {response.status_text}</span>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        )}
      </div>
    </div>
  );
}

// ── SIP Response ────────────────────────────────────────────────────────────

interface SipResponseViewerProps {
  responses: SipResponsePart[];
  sending: boolean;
}

export function SipResponseViewer({ responses, sending }: SipResponseViewerProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");

  const lastResp = responses[responses.length - 1];

  const handleCopy = useCallback(() => {
    const text = responses.map((r) => r.raw).join("\n\n");
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [responses]);

  const hasResponse = responses.length > 0;

  return (
    <div className="flex flex-col min-h-0 overflow-hidden bg-muted/10 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2 text-xs min-w-0 flex-1">
          <span className="text-xs font-medium text-muted-foreground shrink-0">Response</span>
          {hasResponse && lastResp?.statusCode != null && (
            <>
              <span className={cn("font-mono font-semibold px-2 py-0.5 rounded border text-xs whitespace-nowrap", statusBadgeClass(lastResp.statusCode))}>
                {lastResp.statusCode} {lastResp.statusText ?? ""}
              </span>
              <TroubleshootLink sipCode={typeof lastResp.statusCode === "string" ? parseInt(lastResp.statusCode, 10) : lastResp.statusCode} compact />
              {lastResp.roundTripMs != null && (
                <span className="text-muted-foreground">{lastResp.roundTripMs}ms</span>
              )}
              {responses.length > 1 && (
                <span className="text-muted-foreground">({responses.length} responses)</span>
              )}
            </>
          )}
          {sending && (
            <span className="text-muted-foreground flex items-center gap-1.5 whitespace-nowrap">
              <Loader2 className="size-3 animate-spin" />
              Sending…
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasResponse && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={handleCopy} className="h-7 gap-1.5 px-2 text-xs">
                {copied ? <CheckCircle className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <ViewModeToggle mode={viewMode} onChange={setViewMode} />
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {!hasResponse && !sending && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted/30 mb-3">
              <Send className="size-5 text-muted-foreground/60" />
            </div>
            <p className="text-xs font-medium text-muted-foreground/60">Send a request to see the response</p>
          </div>
        )}
        {sending && !hasResponse && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 mb-3">
              <Loader2 className="size-5 animate-spin text-primary/70" />
            </div>
            <p className="text-xs font-medium text-muted-foreground/60">Waiting for response...</p>
          </div>
        )}

        {/* Pretty view */}
        {hasResponse && viewMode === "pretty" && (
          <div className="space-y-3">
            {responses.map((r, i) => (
              <div key={i} className="relative">
                {responses.length > 1 && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn("font-mono text-xs font-semibold px-2 py-0.5 rounded border", r.statusCode ? statusBadgeClass(r.statusCode) : "border-border text-muted-foreground")}>
                      {r.statusCode ?? "?"} {r.statusText ?? ""}
                    </span>
                    {r.roundTripMs != null && (
                      <span className="text-2xs text-muted-foreground">{r.roundTripMs}ms</span>
                    )}
                    {i < responses.length - 1 && (
                      <span className="text-2xs text-muted-foreground/60">→</span>
                    )}
                  </div>
                )}
                <div className="text-xs font-mono space-y-0.5">
                  {r.headers.map((h, j) => (
                    <div key={j}>
                      <span className="text-muted-foreground">{h.key}:</span> {h.value}
                    </div>
                  ))}
                </div>
                {r.body && (
                  <pre className="font-mono text-xs whitespace-pre-wrap break-words bg-muted/30 p-3 rounded-lg mt-2">{r.body}</pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Raw view */}
        {hasResponse && viewMode === "raw" && (
          <div className="space-y-4">
            {responses.map((r, i) => (
              <pre key={i} className="font-mono text-xs whitespace-pre-wrap break-words">{r.raw}</pre>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared view mode toggle ─────────────────────────────────────────────────

function ViewModeToggle({ mode, onChange }: { mode: "pretty" | "raw"; onChange: (m: "pretty" | "raw") => void }) {
  return (
    <div className="flex rounded-lg bg-muted/30 p-0.5 ml-1">
      <Button
        type="button"
        variant={mode === "pretty" ? "neutral" : "ghost"}
        size="sm"
        onClick={() => onChange("pretty")}
        className="h-6 px-2.5 text-2xs font-medium"
      >
        Pretty
      </Button>
      <Button
        type="button"
        variant={mode === "raw" ? "neutral" : "ghost"}
        size="sm"
        onClick={() => onChange("raw")}
        className="h-6 px-2.5 text-2xs font-medium"
      >
        Raw
      </Button>
    </div>
  );
}
