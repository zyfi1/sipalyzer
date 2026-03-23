/**
 * SIP Scenario Wizard — the centerpiece guided experience for building SIP messages.
 *
 * 3 steps:
 *   1. Pick a scenario (what do you want to accomplish?)
 *   2. Configure (two-panel: form on left, live preview on right)
 *   3. Send + see response
 */

import { useState, useCallback } from "react";
import { useComposerStore, interpolateVariables } from "@/stores/composerStore";
import { crafterSendSip } from "@/api/crafter";
import { LiveSipPreview } from "./LiveSipPreview";
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
  Smartphone,
  Radio,
  PhoneCall,
  StickyNote,
  Bell,
  ArrowRightLeft,
  Zap,
  Code,
  Save,
  Plus,
  ExternalLink,
  AlertCircle,
} from "@/lib/icons";
import type { SipTransport, SipMethod, SipDigestAuth, SipResponsePart } from "@/types/crafter";
import { SIP_METHODS } from "@/types/crafter";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { SipResponseViewer } from "../panels/ResponseViewer";

// ── Scenario definitions ─────────────────────────────────────────────────────

interface SipScenario {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  method: SipMethod;
  headers: Array<{ key: string; value: string }>;
  body: string;
  bodyContentType: string;
  needsAuth: boolean;
  transport: SipTransport;
  hintText: string;
}

const SCENARIOS: SipScenario[] = [
  {
    id: "test-reachability",
    name: "Test Endpoint Reachability",
    description: "Send OPTIONS to check if a SIP device is alive",
    icon: <Radio className="h-4 w-4" />,
    category: "Testing & Discovery",
    method: "OPTIONS",
    headers: [],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "You should receive a 200 OK if the endpoint is reachable, or a timeout if it's not.",
  },
  {
    id: "query-capabilities",
    name: "Query Capabilities",
    description: "Discover what methods and codecs a device supports",
    icon: <Radio className="h-4 w-4" />,
    category: "Testing & Discovery",
    method: "OPTIONS",
    headers: [{ key: "Accept", value: "application/sdp" }],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect a 200 OK with Allow header listing supported methods and possibly an SDP body.",
  },
  {
    id: "register",
    name: "Register with a PBX/Registrar",
    description: "Standard REGISTER flow with digest auth support",
    icon: <Smartphone className="h-4 w-4" />,
    category: "Registration",
    method: "REGISTER",
    headers: [
      { key: "Expires", value: "3600" },
      { key: "Contact", value: "<sip:user@localhost:5062;transport=udp>" },
    ],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: true,
    transport: "UDP",
    hintText: "Expect a 401/407 challenge first, then a 200 OK after authentication. The auth will be handled automatically.",
  },
  {
    id: "audio-call",
    name: "Start an Audio Call",
    description: "INVITE with PCMU/PCMA SDP for audio calling",
    icon: <PhoneCall className="h-4 w-4" />,
    category: "Calling",
    method: "INVITE",
    headers: [{ key: "Content-Type", value: "application/sdp" }],
    body: "v=0\r\no=sipalyzer 0 0 IN IP4 0.0.0.0\r\ns=SIPalyzer Call\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=audio 49170 RTP/AVP 0 8\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=sendrecv",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect 100 Trying, then 180 Ringing, then 200 OK with SDP answer if the call is accepted.",
  },
  {
    id: "video-call",
    name: "Start a Video Call",
    description: "INVITE with H.264 + audio SDP",
    icon: <PhoneCall className="h-4 w-4" />,
    category: "Calling",
    method: "INVITE",
    headers: [{ key: "Content-Type", value: "application/sdp" }],
    body: "v=0\r\no=sipalyzer 0 0 IN IP4 0.0.0.0\r\ns=SIPalyzer Call\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=audio 49170 RTP/AVP 0 8\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=sendrecv\r\nm=video 49172 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=sendrecv",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect 100 Trying, then 180 Ringing, then 200 OK with audio+video SDP answer.",
  },
  {
    id: "end-call",
    name: "End a Call",
    description: "BYE to terminate an active dialog",
    icon: <PhoneCall className="h-4 w-4" />,
    category: "Calling",
    method: "BYE",
    headers: [],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect a 200 OK confirming the call has been terminated.",
  },
  {
    id: "instant-message",
    name: "Send an Instant Message",
    description: "MESSAGE with text/plain body",
    icon: <StickyNote className="h-4 w-4" />,
    category: "Messaging & Events",
    method: "MESSAGE",
    headers: [{ key: "Content-Type", value: "text/plain" }],
    body: "Hello from SIPalyzer!",
    bodyContentType: "text/plain",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect a 200 OK if the message was delivered, or 404 if the recipient is not found.",
  },
  {
    id: "subscribe-presence",
    name: "Subscribe to Presence",
    description: "SUBSCRIBE with Event: presence",
    icon: <Bell className="h-4 w-4" />,
    category: "Messaging & Events",
    method: "SUBSCRIBE",
    headers: [
      { key: "Event", value: "presence" },
      { key: "Expires", value: "3600" },
    ],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect a 200 OK followed by NOTIFY with presence information.",
  },
  {
    id: "subscribe-mwi",
    name: "Subscribe to Voicemail (MWI)",
    description: "SUBSCRIBE with Event: message-summary",
    icon: <Bell className="h-4 w-4" />,
    category: "Messaging & Events",
    method: "SUBSCRIBE",
    headers: [
      { key: "Event", value: "message-summary" },
      { key: "Expires", value: "3600" },
    ],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect a 200 OK followed by NOTIFY with message waiting indicators.",
  },
  {
    id: "send-notify",
    name: "Send a NOTIFY",
    description: "NOTIFY with event payload",
    icon: <Bell className="h-4 w-4" />,
    category: "Messaging & Events",
    method: "NOTIFY",
    headers: [{ key: "Event", value: "presence" }],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect a 200 OK confirming the notification was received.",
  },
  {
    id: "send-dtmf",
    name: "Send DTMF Digits",
    description: "INFO with application/dtmf-relay body",
    icon: <Zap className="h-4 w-4" />,
    category: "Messaging & Events",
    method: "INFO",
    headers: [{ key: "Content-Type", value: "application/dtmf-relay" }],
    body: "Signal=5\r\nDuration=160",
    bodyContentType: "application/dtmf-relay",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect a 200 OK confirming the DTMF digit was relayed.",
  },
  {
    id: "transfer-call",
    name: "Transfer a Call",
    description: "REFER with Refer-To header for call transfer",
    icon: <ArrowRightLeft className="h-4 w-4" />,
    category: "Advanced",
    method: "REFER",
    headers: [{ key: "Refer-To", value: "sip:target@example.com" }],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "Expect 202 Accepted, then NOTIFY messages indicating transfer progress.",
  },
  {
    id: "scratch",
    name: "Start from Scratch",
    description: "Empty message — build everything yourself",
    icon: <Code className="h-4 w-4" />,
    category: "Advanced",
    method: "OPTIONS",
    headers: [],
    body: "",
    bodyContentType: "application/sdp",
    needsAuth: false,
    transport: "UDP",
    hintText: "",
  },
];

const CATEGORIES = ["Testing & Discovery", "Registration", "Calling", "Messaging & Events", "Advanced"];

// ── Wizard component ─────────────────────────────────────────────────────────

interface SipScenarioWizardProps {
  onBack: () => void;
  onSkipToEditor: (itemId: string) => void;
}

interface DraftState {
  method: SipMethod;
  uri: string;
  transport: SipTransport;
  headers: Array<{ key: string; value: string }>;
  body: string;
  bodyContentType: string;
  auth: SipDigestAuth | null;
}

export function SipScenarioWizard({ onBack, onSkipToEditor }: SipScenarioWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedScenario, setSelectedScenario] = useState<SipScenario | null>(null);
  const [draft, setDraft] = useState<DraftState>({
    method: "OPTIONS",
    uri: "sip:192.168.1.1:5060",
    transport: "UDP",
    headers: [],
    body: "",
    bodyContentType: "application/sdp",
    auth: null,
  });

  const [sending, setSending] = useState(false);
  const [responses, setResponses] = useState<SipResponsePart[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const createItemFromTemplate = useComposerStore((s) => s.createItemFromTemplate);
  const uiPrefs = useComposerStore((s) => s.uiPrefs);
  const toast = useToastContext();

  // Collapsible sections
  const [showAuth, setShowAuth] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSelectScenario = useCallback((scenario: SipScenario) => {
    setSelectedScenario(scenario);
    setDraft({
      method: scenario.method,
      uri: "sip:192.168.1.1:5060",
      transport: scenario.transport,
      headers: [...scenario.headers],
      body: scenario.body,
      bodyContentType: scenario.bodyContentType,
      auth: scenario.needsAuth ? { username: "", password: "", realm: "" } : null,
    });
    setShowAuth(scenario.needsAuth);
    setShowAdvanced(false);
    setResponses([]);
    setError(null);
    setStep(2);
  }, []);

  const updateDraft = useCallback((updates: Partial<DraftState>) => {
    setDraft((d) => ({ ...d, ...updates }));
  }, []);

  const handleSend = useCallback(async () => {
    if (!draft.uri.trim()) {
      setError("Target URI is required.");
      toast.warning("Validation Error", "Target URI is required.");
      return;
    }
    if (!/^sips?:/i.test(draft.uri)) {
      setError("URI must start with sip: or sips:");
      toast.warning("Validation Error", "URI must start with sip: or sips:");
      return;
    }

    setError(null);
    setSending(true);
    setStep(3);

    try {
      const hostMatch = draft.uri.match(/sips?:(?:[^@]+@)?([^:;?\s]+)(?::(\d+))?/);
      const host = hostMatch?.[1] ?? draft.uri;
      const port = hostMatch?.[2] ? parseInt(hostMatch[2], 10) : undefined;

      const result = await crafterSendSip({
        method: draft.method,
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

      addHistoryEntry({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: "sip",
        method: draft.method,
        target: draft.uri,
        statusCode: parsed[parsed.length - 1]?.statusCode,
        roundTripMs: parsed[parsed.length - 1]?.roundTripMs,
        timestamp: Date.now(),
      });

      const last = parsed[parsed.length - 1];
      if (last?.statusCode) {
        const timing = last.roundTripMs != null ? ` — ${last.roundTripMs}ms` : "";
        if (last.statusCode >= 200 && last.statusCode < 300)
          toast.success("SIP Response", `${last.statusCode} ${last.statusText ?? ""}${timing}`, { source: "composer" });
        else if (last.statusCode >= 400)
          toast.error("SIP Response", `${last.statusCode} ${last.statusText ?? ""}${timing}`, { source: "composer" });
        else
          toast.info("SIP Response", `${last.statusCode} ${last.statusText ?? ""}${timing}`, { source: "composer" });
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
  }, [draft, uiPrefs.responseTimeoutSec, addHistoryEntry, toast]);

  const handleSaveToCollection = useCallback(() => {
    const id = createItemFromTemplate("sip", selectedScenario?.name ?? "SIP Request", {
      sipData: {
        method: draft.method,
        uri: draft.uri,
        transport: draft.transport,
        headers: draft.headers,
        body: draft.body,
        bodyContentType: draft.bodyContentType,
        auth: draft.auth,
      },
    });
    toast.success("Saved", "Request saved to collection", { source: "composer" });
    onSkipToEditor(id);
  }, [createItemFromTemplate, draft, selectedScenario, toast, onSkipToEditor]);

  const handleSkipToEditor = useCallback(() => {
    const id = createItemFromTemplate("sip", selectedScenario?.name ?? "SIP Request", {
      sipData: {
        method: draft.method,
        uri: draft.uri,
        transport: draft.transport,
        headers: draft.headers,
        body: draft.body,
        bodyContentType: draft.bodyContentType,
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

        {/* Labeled step indicator */}
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
          <ScenarioPickerStep onSelect={handleSelectScenario} />
        </div>
      )}
      {step === 2 && selectedScenario && (
        <ConfigureStep
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
        <SendStep
          draft={draft}
          responses={responses}
          sending={sending}
          error={error}
          onNewRequest={() => { setStep(1); setSelectedScenario(null); setResponses([]); setError(null); }}
          onSaveToCollection={handleSaveToCollection}
          onSendAgain={handleSend}
        />
      )}
    </div>
  );
}

// ── Step 1: Scenario Picker ──────────────────────────────────────────────────

function ScenarioPickerStep({ onSelect }: { onSelect: (s: SipScenario) => void }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">What do you want to accomplish?</h2>
        <p className="text-sm text-muted-foreground">Pick a scenario and we'll pre-fill everything for you.</p>
      </div>

      {CATEGORIES.map((cat) => {
        const scenarios = SCENARIOS.filter((s) => s.category === cat);
        if (scenarios.length === 0) return null;
        return (
          <div key={cat} className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{cat}</h3>
            <div className="grid grid-cols-2 gap-2">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => onSelect(scenario)}
                  className="group text-left ui-control-shell p-3 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-primary/70 group-hover:text-primary transition-smooth">
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
      })}
    </div>
  );
}

// ── Step 2: Configure (two-panel) ────────────────────────────────────────────

interface ConfigureStepProps {
  scenario: SipScenario;
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

function ConfigureStep({
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
}: ConfigureStepProps) {
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

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* Left panel: form (~55%) */}
        <div className="w-[55%] min-w-0 overflow-y-auto p-5 space-y-5 border-r border-border/20">
          {/* Scenario name */}
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="text-primary">{scenario.icon}</span>
            {scenario.name}
          </div>

          {/* Essentials */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Essentials</h3>
            </div>

            {/* Method + URI */}
            <div className="flex items-center gap-2">
              <AppDropdown
                value={draft.method}
                onValueChange={(v) => updateDraft({ method: v })}
                options={SIP_METHODS.map((m) => ({ value: m, label: m }))}
                className="w-32 h-8 text-xs"
                size="sm"
                itemClassName="text-xs"
              />

              <div className="flex-1 relative">
                <Input
                  value={draft.uri}
                  onChange={(e) => updateDraft({ uri: e.target.value })}
                  placeholder="sip:pbx.example.com"
                  className="h-8 text-xs font-mono pr-8"
                />
                <ContextualHelp
                  text="The SIP Request-URI — the address of the device you're sending to. Format: sip:user@host:port"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                />
              </div>
            </div>

            {/* Transport */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-20 shrink-0">Transport</label>
              <AppDropdown
                value={draft.transport}
                onValueChange={(v) => updateDraft({ transport: v as SipTransport })}
                options={[
                  { value: "UDP", label: "UDP" },
                  { value: "TCP", label: "TCP" },
                  { value: "TLS", label: "TLS" },
                ]}
                className="w-24 h-8 text-xs"
                size="sm"
                itemClassName="text-xs"
              />
              <ContextualHelp text="UDP is most common for SIP. Use TCP for large messages (>MTU) or TLS for encrypted transport." />
            </div>
          </div>

          {/* Authentication (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setShowAuth(!showAuth);
                if (!showAuth && !draft.auth) {
                  updateDraft({ auth: { username: "", password: "", realm: "" } });
                }
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", showAuth && "rotate-90")} />
              Authentication
              {draft.auth?.username && (
                <span className="text-2xs text-primary/70 ml-1">configured</span>
              )}
            </button>

            {showAuth && (
              <div className="pl-4 space-y-2 animate-in slide-in-from-top-1 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-20 shrink-0">Username</label>
                  <Input
                    value={draft.auth?.username ?? ""}
                    onChange={(e) => updateDraft({ auth: { ...draft.auth!, username: e.target.value } })}
                    placeholder="SIP username"
                    className="h-7 text-xs flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-20 shrink-0">Password</label>
                  <Input
                    type="password"
                    value={draft.auth?.password ?? ""}
                    onChange={(e) => updateDraft({ auth: { ...draft.auth!, password: e.target.value } })}
                    placeholder="SIP password"
                    className="h-7 text-xs flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-20 shrink-0">Realm</label>
                  <Input
                    value={draft.auth?.realm ?? ""}
                    onChange={(e) => updateDraft({ auth: { ...draft.auth!, realm: e.target.value } })}
                    placeholder="Optional — auto-detected from 401/407"
                    className="h-7 text-xs flex-1"
                  />
                  <ContextualHelp text="The realm is usually auto-detected from the 401/407 challenge. Leave blank unless you know the specific realm." />
                </div>
              </div>
            )}
          </div>

          {/* Advanced: Headers + Body (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-90")} />
              Advanced
              {(draft.headers.length > 0 || draft.body) && (
                <span className="text-2xs text-primary/70 ml-1">
                  {draft.headers.length} header{draft.headers.length !== 1 ? "s" : ""}
                  {draft.body ? " + body" : ""}
                </span>
              )}
            </button>

            {showAdvanced && (
              <div className="pl-4 space-y-3 animate-in slide-in-from-top-1 duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
                {/* Headers */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">Custom Headers</label>
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

                {/* Body */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Body</label>
                  <Textarea
                    value={draft.body}
                    onChange={(e) => updateDraft({ body: e.target.value })}
                    placeholder="Message body (SDP, text, etc.)"
                    className="min-h-[80px] text-xs font-mono resize-y"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg shadow-card bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        {/* Right panel: live preview (~45%) */}
        <div className="w-[45%] min-w-0 overflow-y-auto p-4 bg-muted/10">
          <LiveSipPreview
            method={draft.method}
            uri={draft.uri}
            transport={draft.transport}
            headers={draft.headers}
            body={draft.body}
            auth={draft.auth}
            hintText={scenario.hintText}
            className="h-full"
          />
        </div>
      </div>

      {/* Bottom send bar */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border/30 bg-muted/10 shrink-0">
        <span className="text-2xs text-muted-foreground">
          {draft.method || "SIP"} → {draft.uri || "..."}
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

interface SendStepProps {
  draft: DraftState;
  responses: SipResponsePart[];
  sending: boolean;
  error: string | null;
  onNewRequest: () => void;
  onSaveToCollection: () => void;
  onSendAgain: () => void;
}

function SendStep({ draft, responses, sending, error, onNewRequest, onSaveToCollection, onSendAgain }: SendStepProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-4">
          {/* Summary line */}
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded bg-primary/15 text-primary font-bold text-2xs">
              {draft.method}
            </span>
            <span className="font-mono text-foreground/70 truncate">{draft.uri}</span>
            <span className="text-muted-foreground/60">via {draft.transport}</span>
            {responses.length > 0 && (() => {
              const last = responses[responses.length - 1];
              const code = last?.statusCode != null ? (typeof last.statusCode === "string" ? parseInt(last.statusCode, 10) : last.statusCode) : null;
              return code != null && !Number.isNaN(code) ? <TroubleshootLink sipCode={code} compact /> : null;
            })()}
          </div>

          {/* Response viewer */}
          <SipResponseViewer responses={responses} sending={sending} />

          {error && !sending && (
            <div className="flex items-start gap-2.5 rounded-lg shadow-card bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Sent message (collapsed by default) */}
          {!sending && responses.length > 0 && (
            <details className="group">
              <summary className="text-2xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-smooth">
                Show sent message
              </summary>
              <div className="mt-2">
                <LiveSipPreview
                  method={draft.method}
                  uri={draft.uri}
                  transport={draft.transport}
                  headers={draft.headers}
                  body={draft.body}
                  auth={draft.auth}
                />
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Bottom actions */}
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
