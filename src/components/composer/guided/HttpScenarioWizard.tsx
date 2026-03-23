/**
 * HTTP Scenario Wizard — guided HTTP request builder.
 *
 * Simplified version of SipScenarioWizard with 3 steps:
 *   1. Pick request type
 *   2. Configure (two-panel: form on left, live HTTP preview on right)
 *   3. Send + see response
 */

import { useState, useCallback, useMemo } from "react";
import { useComposerStore, interpolateVariables } from "@/stores/composerStore";
import { crafterSendHttp } from "@/api/crafter";
import { ContextualHelp } from "./ContextualHelp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { useToastContext } from "@/contexts/ToastContext";
import {
  ChevronLeft,
  ChevronRight,
  Send,
  Loader2,
  Download,
  Upload,
  Trash2,
  Shield,
  Activity,
  Code,
  Plus,
  Save,
  ExternalLink,
  Copy,
  CheckCircle2,
  AlertCircle,
} from "@/lib/icons";
import type { HttpMethod, HttpAuth, HttpAuthType, HttpBodyType } from "@/types/crafter";
import { HttpResponseViewer, type HttpResponseData } from "../panels/ResponseViewer";

// ── Scenario definitions ─────────────────────────────────────────────────────

interface HttpScenario {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  method: HttpMethod;
  url: string;
  headers: Array<{ key: string; value: string }>;
  bodyType: HttpBodyType;
  bodyJson: string;
  auth: HttpAuth;
  hintText: string;
}

const SCENARIOS: HttpScenario[] = [
  {
    id: "fetch-data",
    name: "Fetch Data (GET)",
    description: "Retrieve JSON data from an API endpoint",
    icon: <Download className="h-4 w-4" />,
    method: "GET",
    url: "",
    headers: [{ key: "Accept", value: "application/json" }],
    bodyType: "none",
    bodyJson: "{}",
    auth: { type: "none" },
    hintText: "Expect a 200 OK with JSON response body containing the requested data.",
  },
  {
    id: "create-resource",
    name: "Create Resource (POST)",
    description: "Send JSON data to create a new resource",
    icon: <Upload className="h-4 w-4" />,
    method: "POST",
    url: "",
    headers: [{ key: "Content-Type", value: "application/json" }],
    bodyType: "json",
    bodyJson: '{\n  "name": "",\n  "value": ""\n}',
    auth: { type: "none" },
    hintText: "Expect a 201 Created with the new resource in the response body, or 400 for validation errors.",
  },
  {
    id: "update-resource",
    name: "Update Resource (PUT)",
    description: "Replace an existing resource with new data",
    icon: <Upload className="h-4 w-4" />,
    method: "PUT",
    url: "",
    headers: [{ key: "Content-Type", value: "application/json" }],
    bodyType: "json",
    bodyJson: '{\n  "name": "",\n  "value": ""\n}',
    auth: { type: "none" },
    hintText: "Expect a 200 OK with the updated resource, or 404 if the resource doesn't exist.",
  },
  {
    id: "delete-resource",
    name: "Delete Resource (DELETE)",
    description: "Remove an existing resource",
    icon: <Trash2 className="h-4 w-4" />,
    method: "DELETE",
    url: "",
    headers: [],
    bodyType: "none",
    bodyJson: "{}",
    auth: { type: "none" },
    hintText: "Expect a 204 No Content or 200 OK. A 404 means the resource wasn't found.",
  },
  {
    id: "authenticated",
    name: "Authenticated Request",
    description: "GET with Bearer token authentication",
    icon: <Shield className="h-4 w-4" />,
    method: "GET",
    url: "",
    headers: [{ key: "Accept", value: "application/json" }],
    bodyType: "none",
    bodyJson: "{}",
    auth: { type: "bearer", bearerToken: "" },
    hintText: "Expect a 200 OK if the token is valid, or 401 Unauthorized if it's expired or invalid.",
  },
  {
    id: "health-check",
    name: "Health Check",
    description: "Quick endpoint health verification",
    icon: <Activity className="h-4 w-4" />,
    method: "GET",
    url: "/health",
    headers: [],
    bodyType: "none",
    bodyJson: "{}",
    auth: { type: "none" },
    hintText: "Expect a 200 OK with status information. Any other status may indicate issues.",
  },
  {
    id: "scratch",
    name: "Start from Scratch",
    description: "Empty request — configure everything yourself",
    icon: <Code className="h-4 w-4" />,
    method: "GET",
    url: "",
    headers: [],
    bodyType: "none",
    bodyJson: "{}",
    auth: { type: "none" },
    hintText: "",
  },
];

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// ── Wizard component ─────────────────────────────────────────────────────────

interface HttpScenarioWizardProps {
  onBack: () => void;
  onSkipToEditor: (itemId: string) => void;
}

interface DraftState {
  method: HttpMethod;
  url: string;
  headers: Array<{ key: string; value: string }>;
  bodyType: HttpBodyType;
  bodyJson: string;
  auth: HttpAuth;
}

export function HttpScenarioWizard({ onBack, onSkipToEditor }: HttpScenarioWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedScenario, setSelectedScenario] = useState<HttpScenario | null>(null);
  const [draft, setDraft] = useState<DraftState>({
    method: "GET",
    url: "",
    headers: [],
    bodyType: "none",
    bodyJson: "{}",
    auth: { type: "none" },
  });

  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<HttpResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const createItemFromTemplate = useComposerStore((s) => s.createItemFromTemplate);
  const uiPrefs = useComposerStore((s) => s.uiPrefs);
  const toast = useToastContext();

  const [showAuth, setShowAuth] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSelectScenario = useCallback((scenario: HttpScenario) => {
    setSelectedScenario(scenario);
    setDraft({
      method: scenario.method,
      url: scenario.url,
      headers: [...scenario.headers],
      bodyType: scenario.bodyType,
      bodyJson: scenario.bodyJson,
      auth: { ...scenario.auth },
    });
    setShowAuth(scenario.auth.type !== "none");
    setShowAdvanced(false);
    setResponse(null);
    setError(null);
    setStep(2);
  }, []);

  const updateDraft = useCallback((updates: Partial<DraftState>) => {
    setDraft((d) => ({ ...d, ...updates }));
  }, []);

  const handleSend = useCallback(async () => {
    if (!draft.url.trim()) {
      setError("URL is required.");
      toast.warning("Validation Error", "URL is required.");
      return;
    }

    setError(null);
    setSending(true);
    setStep(3);

    try {
      let bodyStr: string | undefined;
      if (draft.bodyType === "json" && draft.bodyJson.trim()) {
        bodyStr = interpolateVariables(draft.bodyJson);
      }

      const authPayload = draft.auth.type !== "none"
        ? {
            type: draft.auth.type,
            username: draft.auth.username,
            password: draft.auth.password,
            bearer_token: draft.auth.bearerToken,
            custom_header: draft.auth.customHeader,
            custom_value: draft.auth.customValue,
          }
        : undefined;

      const result = await crafterSendHttp({
        method: draft.method,
        url: interpolateVariables(draft.url),
        headers: draft.headers.map((h) => ({ key: h.key, value: interpolateVariables(h.value) })),
        body: bodyStr,
        auth: authPayload,
        follow_redirects: true,
        timeout_ms: uiPrefs.responseTimeoutSec * 1000,
      });

      const responseData: HttpResponseData = {
        status_code: result.status_code,
        status_text: result.status_text,
        headers: result.headers,
        body: result.body,
        timing_ms: result.timing_ms,
        size_bytes: result.size_bytes,
      };

      setResponse(responseData);

      addHistoryEntry({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: "http",
        method: draft.method,
        target: draft.url,
        statusCode: result.status_code,
        roundTripMs: result.timing_ms,
        timestamp: Date.now(),
      });

      const timing = ` — ${result.timing_ms}ms`;
      if (result.status_code >= 200 && result.status_code < 300) {
        toast.success("HTTP Response", `${result.status_code} ${result.status_text}${timing}`, { source: "composer" });
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
  }, [draft, uiPrefs.responseTimeoutSec, addHistoryEntry, toast]);

  const handleSaveToCollection = useCallback(() => {
    const id = createItemFromTemplate("http", selectedScenario?.name ?? "HTTP Request", {
      httpData: {
        method: draft.method,
        url: draft.url,
        params: [],
        headers: draft.headers,
        bodyType: draft.bodyType,
        bodyJson: draft.bodyJson,
        bodyForm: [],
        bodyRaw: "",
        bodyRawContentType: "application/json",
        auth: draft.auth,
      },
    });
    toast.success("Saved", "Request saved to collection", { source: "composer" });
    onSkipToEditor(id);
  }, [createItemFromTemplate, draft, selectedScenario, toast, onSkipToEditor]);

  const handleSkipToEditor = useCallback(() => {
    const id = createItemFromTemplate("http", selectedScenario?.name ?? "HTTP Request", {
      httpData: {
        method: draft.method,
        url: draft.url,
        params: [],
        headers: draft.headers,
        bodyType: draft.bodyType,
        bodyJson: draft.bodyJson,
        bodyForm: [],
        bodyRaw: "",
        bodyRawContentType: "application/json",
        auth: draft.auth,
      },
    });
    onSkipToEditor(id);
  }, [createItemFromTemplate, draft, selectedScenario, onSkipToEditor]);

  const STEP_LABELS = ["Choose Scenario", "Configure", "Results"];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Top bar: back + labeled steps + skip ──────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 bg-muted/10 shrink-0">
        <button
          type="button"
          onClick={step === 1 ? onBack : () => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-smooth shrink-0"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {step === 1 ? "Home" : "Back"}
        </button>

        <div className="flex items-center gap-0.5 flex-1 justify-center">
          {STEP_LABELS.map((label, idx) => {
            const stepNum = (idx + 1) as 1 | 2 | 3;
            const isCurrent = stepNum === step;
            const isPast = stepNum < step;
            const canClick = isPast || (stepNum === 2 && selectedScenario != null);
            return (
              <div key={label} className="flex items-center">
                <button
                  type="button"
                  disabled={!canClick && !isCurrent}
                  onClick={() => canClick && setStep(stepNum)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-2xs font-medium transition-smooth",
                    isCurrent
                      ? "bg-primary/10 text-primary"
                      : isPast
                        ? "text-muted-foreground hover:text-foreground cursor-pointer"
                        : "text-muted-foreground/60 cursor-default"
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center h-4 w-4 rounded-full text-3xs font-bold",
                      isCurrent
                        ? "bg-primary text-primary-foreground"
                        : isPast
                          ? "bg-muted-foreground/20 text-muted-foreground"
                          : "bg-muted-foreground/10 text-muted-foreground/60"
                    )}
                  >
                    {stepNum}
                  </span>
                  {label}
                </button>
                {idx < 2 && (
                  <div className={cn(
                    "w-4 h-px mx-0.5",
                    isPast ? "bg-primary/30" : "bg-muted-foreground/10"
                  )} />
                )}
              </div>
            );
          })}
        </div>

        {selectedScenario && step !== 1 && (
          <button
            type="button"
            onClick={handleSkipToEditor}
            className="inline-flex items-center gap-1 text-2xs text-muted-foreground/60 hover:text-muted-foreground transition-smooth shrink-0"
          >
            <ExternalLink className="h-3 w-3" />
            Open in editor
          </button>
        )}
      </div>

      {/* ── Step content ──────────────────────────────────────── */}
      {step === 1 && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <HttpPickerStep onSelect={handleSelectScenario} />
        </div>
      )}
      {step === 2 && selectedScenario && (
        <HttpConfigureStep
          scenario={selectedScenario}
          draft={draft}
          updateDraft={updateDraft}
          showAuth={showAuth}
          setShowAuth={setShowAuth}
          showAdvanced={showAdvanced}
          setShowAdvanced={setShowAdvanced}
          onSend={handleSend}
          sending={sending}
          error={error}
        />
      )}
      {step === 3 && (
        <HttpSendStep
          draft={draft}
          response={response}
          sending={sending}
          error={error}
          onNewRequest={() => { setStep(1); setSelectedScenario(null); setResponse(null); setError(null); }}
          onSaveToCollection={handleSaveToCollection}
          onSendAgain={handleSend}
        />
      )}
    </div>
  );
}

// ── Step 1: Scenario Picker ──────────────────────────────────────────────────

function HttpPickerStep({ onSelect }: { onSelect: (s: HttpScenario) => void }) {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">What kind of request?</h2>
        <p className="text-sm text-muted-foreground">Pick a scenario and we'll set up everything for you.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            onClick={() => onSelect(scenario)}
            className="group text-left ui-control-shell p-3 space-y-1"
          >
            <div className="flex items-center gap-2">
              <span className="text-info/70 group-hover:text-info transition-smooth">
                {scenario.icon}
              </span>
              <span className="text-sm font-medium text-foreground">{scenario.name}</span>
            </div>
            <p className="text-2xs text-muted-foreground leading-relaxed pl-6">{scenario.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: Configure ────────────────────────────────────────────────────────

interface HttpConfigureStepProps {
  scenario: HttpScenario;
  draft: DraftState;
  updateDraft: (updates: Partial<DraftState>) => void;
  showAuth: boolean;
  setShowAuth: (v: boolean) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
}

function HttpConfigureStep({
  scenario,
  draft,
  updateDraft,
  showAuth,
  setShowAuth,
  showAdvanced,
  setShowAdvanced,
  onSend,
  sending,
  error,
}: HttpConfigureStepProps) {
  const updateHeader = useCallback(
    (index: number, field: "key" | "value", val: string) => {
      const updated = draft.headers.map((h, i) =>
        i === index ? { key: field === "key" ? val : h.key, value: field === "value" ? val : h.value } : h
      );
      updateDraft({ headers: updated });
    },
    [draft.headers, updateDraft]
  );

  const addHeader = useCallback(() => {
    updateDraft({ headers: [...draft.headers, { key: "", value: "" }] });
  }, [draft.headers, updateDraft]);

  const removeHeader = useCallback(
    (index: number) => {
      updateDraft({ headers: draft.headers.filter((_, i) => i !== index) });
    },
    [draft.headers, updateDraft]
  );

  // Live HTTP preview text
  const previewText = useMemo(() => {
    const method = draft.method;
    const url = draft.url || "https://api.example.com/";
    const lines: string[] = [`${method} ${url} HTTP/1.1`];

    try {
      const parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
      lines.push(`Host: ${parsedUrl.host}`);
    } catch {
      lines.push("Host: ...");
    }

    for (const h of draft.headers) {
      if (h.key.trim()) lines.push(`${h.key}: ${h.value}`);
    }

    if (draft.auth.type === "bearer" && draft.auth.bearerToken) {
      lines.push(`Authorization: Bearer ${draft.auth.bearerToken}`);
    } else if (draft.auth.type === "basic") {
      lines.push(`Authorization: Basic <encoded>`);
    }

    lines.push("");

    if (draft.bodyType === "json" && draft.bodyJson.trim()) {
      lines.push(draft.bodyJson);
    }

    return lines.join("\r\n");
  }, [draft]);

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(previewText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [previewText]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* Left: form */}
        <div className="w-[55%] min-w-0 overflow-y-auto p-5 space-y-5 border-r border-border/20">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="text-info">{scenario.icon}</span>
            {scenario.name}
          </div>

          {/* Method + URL */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Essentials</h3>
            <div className="flex items-center gap-2">
              <AppDropdown
                value={draft.method}
                onValueChange={(v) => updateDraft({ method: v as HttpMethod })}
                options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
                className="w-28 h-8 text-xs"
                size="sm"
                itemClassName="text-xs"
              />

              <div className="flex-1 relative">
                <Input
                  value={draft.url}
                  onChange={(e) => updateDraft({ url: e.target.value })}
                  placeholder="https://api.example.com/endpoint"
                  className="h-8 text-xs font-mono pr-8"
                />
                <ContextualHelp
                  text="The full URL to send the request to. Include the protocol (https://)."
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                />
              </div>
            </div>
          </div>

          {/* Body (for POST/PUT/PATCH) */}
          {(draft.method === "POST" || draft.method === "PUT" || draft.method === "PATCH") && draft.bodyType !== "none" && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Body (JSON)</label>
              <Textarea
                value={draft.bodyJson}
                onChange={(e) => updateDraft({ bodyJson: e.target.value })}
                placeholder='{"key": "value"}'
                className="min-h-[100px] text-xs font-mono resize-y"
              />
            </div>
          )}

          {/* Auth (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowAuth(!showAuth)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", showAuth && "rotate-90")} />
              Authentication
              {draft.auth.type !== "none" && (
                <span className="text-2xs text-primary/70 ml-1">{draft.auth.type}</span>
              )}
            </button>

            {showAuth && (
              <div className="pl-4 space-y-2 animate-in slide-in-from-top-1 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-16 shrink-0">Type</label>
                  <AppDropdown
                    value={draft.auth.type}
                    onValueChange={(v) => updateDraft({ auth: { ...draft.auth, type: v as HttpAuthType } })}
                    options={[
                      { value: "none", label: "None" },
                      { value: "bearer", label: "Bearer Token" },
                      { value: "basic", label: "Basic Auth" },
                      { value: "custom", label: "Custom Header" },
                    ]}
                    className="w-32 h-7 text-xs"
                    size="sm"
                    itemClassName="text-xs"
                  />
                </div>

                {draft.auth.type === "bearer" && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground w-16 shrink-0">Token</label>
                    <Input
                      value={draft.auth.bearerToken ?? ""}
                      onChange={(e) => updateDraft({ auth: { ...draft.auth, bearerToken: e.target.value } })}
                      placeholder="Your bearer token"
                      className="h-7 text-xs flex-1 font-mono"
                    />
                  </div>
                )}

                {draft.auth.type === "basic" && (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground w-16 shrink-0">Username</label>
                      <Input
                        value={draft.auth.username ?? ""}
                        onChange={(e) => updateDraft({ auth: { ...draft.auth, username: e.target.value } })}
                        className="h-7 text-xs flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground w-16 shrink-0">Password</label>
                      <Input
                        type="password"
                        value={draft.auth.password ?? ""}
                        onChange={(e) => updateDraft({ auth: { ...draft.auth, password: e.target.value } })}
                        className="h-7 text-xs flex-1"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Headers (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-90")} />
              Headers
              {draft.headers.length > 0 && (
                <span className="text-2xs text-primary/70 ml-1">{draft.headers.length}</span>
              )}
            </button>

            {showAdvanced && (
              <div className="pl-4 space-y-1.5 animate-in slide-in-from-top-1 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={addHeader}
                    className="inline-flex items-center gap-1 text-2xs text-primary/70 hover:text-primary transition-smooth"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    Add
                  </button>
                </div>
                {draft.headers.map((h, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <Input
                      value={h.key}
                      onChange={(e) => updateHeader(idx, "key", e.target.value)}
                      placeholder="Header"
                      className="h-7 text-xs w-32"
                    />
                    <Input
                      value={h.value}
                      onChange={(e) => updateHeader(idx, "value", e.target.value)}
                      placeholder="Value"
                      className="h-7 text-xs flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removeHeader(idx)}
                      className="text-muted-foreground/60 hover:text-destructive transition-smooth p-0.5"
                    >
                      <span className="text-xs">×</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg shadow-card bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        {/* Right: live preview */}
        <div className="w-[45%] min-w-0 overflow-y-auto p-4 bg-muted/10">
          <div className="flex flex-col surface overflow-hidden h-full">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/20 bg-muted/10">
              <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                HTTP Request Preview
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-smooth"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-2xs leading-relaxed select-text whitespace-pre-wrap">
              {previewText.split("\r\n").map((line, idx) => {
                if (idx === 0) {
                  const parts = line.split(" ");
                  return (
                    <div key={idx}>
                      <span className="text-primary font-semibold">{parts[0]}</span>
                      <span className="text-foreground"> {parts.slice(1).join(" ")}</span>
                    </div>
                  );
                }
                if (line.includes(":")) {
                  const colonIdx = line.indexOf(":");
                  return (
                    <div key={idx}>
                      <span className="text-muted-foreground">{line.slice(0, colonIdx)}:</span>
                      <span className="text-foreground/80">{line.slice(colonIdx + 1)}</span>
                    </div>
                  );
                }
                return <div key={idx} className="text-foreground/80">{line}</div>;
              })}
            </div>

            {scenario.hintText && (
              <div className="px-3 py-2 border-t border-border/20 bg-muted/10">
                <p className="text-2xs text-muted-foreground/70 leading-relaxed">
                  <span className="font-medium text-muted-foreground">What to expect:</span>{" "}
                  {scenario.hintText}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom send bar */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border/30 bg-muted/10 shrink-0">
        <span className="text-2xs text-muted-foreground">
          {draft.method} {draft.url || "..."}
        </span>
        <Button
          size="sm"
          variant="positive"
          onClick={onSend}
          disabled={sending}
          className="gap-1.5"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Send + Response ──────────────────────────────────────────────────

interface HttpSendStepProps {
  draft: DraftState;
  response: HttpResponseData | null;
  sending: boolean;
  error: string | null;
  onNewRequest: () => void;
  onSaveToCollection: () => void;
  onSendAgain: () => void;
}

function HttpSendStep({ draft, response, sending, error, onNewRequest, onSaveToCollection, onSendAgain }: HttpSendStepProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-4">
          {/* Summary line */}
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded bg-info/15 text-info font-bold text-2xs">
              {draft.method}
            </span>
            <span className="font-mono text-foreground/70 truncate">{draft.url}</span>
          </div>

          <HttpResponseViewer response={response} sending={sending} />

          {error && !sending && (
            <div className="flex items-start gap-2.5 rounded-lg shadow-card bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-5 py-3 border-t border-border/30 bg-muted/10 shrink-0">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="neutral"
            onClick={onSaveToCollection}
            className="gap-1.5 text-xs"
          >
            <Save className="h-3.5 w-3.5" />
            Save to Collection
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onSendAgain}
            disabled={sending}
            className="gap-1.5 text-xs"
          >
            <Send className="h-3.5 w-3.5" />
            Send Again
          </Button>
        </div>
        <Button
          size="sm"
          variant="neutral"
          onClick={onNewRequest}
          className="gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          New Request
        </Button>
      </div>
    </div>
  );
}
