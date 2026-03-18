import { useRegistrationStore } from "@/stores/registrationStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import {
  LinkConnect, LinkDisconnect, Clock, Settings, Trash2,
  Phone, Printer, Folder, FolderOpen, TestTube, CheckCircle2, XCircle,
  Network, Globe, AlertTriangle, RefreshCw, Shield, Play, Loader2, ChevronDown, Info,
} from "@/lib/icons";
import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineNoteWidget } from "@/components/notes/widgets/InlineNoteWidget";
import { createRegistrarContext } from "@/lib/noteContext";
import { unregisterRegistrar } from "@/api/registration";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTime } from "@/lib/dateTime";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import type { TestType, TestResult } from "@/types/registration";

const USE_CASE_OPTIONS: { value: string; label: string; icon: typeof Phone }[] = [
  { value: "calling", label: "Soft Phone", icon: Phone },
  { value: "faxing", label: "Fax Center", icon: Printer },
];

function parseUseCases(useCase: string | null | undefined): string[] {
  if (!useCase) return [];
  return useCase.split(",").map((s) => s.trim()).filter(Boolean);
}

function serializeUseCases(cases: string[]): string | null {
  return cases.length > 0 ? cases.join(",") : null;
}

interface CuratedTest {
  id: TestType;
  label: string;
  description: string;
  explanation: string;
  icon: typeof CheckCircle2;
  color: string;
  category: "essential" | "diagnostic";
}

const CURATED_TESTS: CuratedTest[] = [
  {
    id: "basic_registration", label: "Registration", description: "Standard REGISTER with authentication",
    explanation: "Sends a SIP REGISTER request to the registrar server and completes the full digest-authentication handshake (401 challenge → authenticated retry). Validates that your credentials are accepted, the server is reachable, and a 200 OK with a valid Contact binding is returned. This is the fundamental test every SIP endpoint must pass.",
    icon: CheckCircle2, color: "text-chart-blue bg-chart-blue/10 border-chart-blue/20", category: "essential",
  },
  {
    id: "deregistration", label: "Deregistration", description: "Graceful unregister (Expires: 0)",
    explanation: "Sends a REGISTER with Expires: 0 to tell the registrar to immediately remove your Contact binding. Verifies the server responds with 200 OK and that subsequent lookups no longer resolve to your endpoint. Essential for clean disconnect behavior and preventing ghost registrations.",
    icon: XCircle, color: "text-chart-orange bg-chart-orange/10 border-chart-orange/20", category: "essential",
  },
  {
    id: "network_connectivity", label: "Connectivity", description: "DNS resolution & port reachability",
    explanation: "Performs DNS resolution (A/AAAA records) for the registrar hostname, then attempts a TCP/UDP connection to the resolved IP on the configured SIP port. Reports DNS lookup time, connection latency, and any failures. Helps isolate whether issues are at the network layer before attempting SIP-level registration.",
    icon: Network, color: "text-chart-green bg-chart-green/10 border-chart-green/20", category: "essential",
  },
  {
    id: "error_handling", label: "Error Handling", description: "Invalid credentials response",
    explanation: "Intentionally sends a REGISTER with incorrect credentials to verify the server properly returns 401/403 responses. Checks that error codes and reason phrases are standards-compliant, and that your client can parse and report them correctly. Validates graceful failure behavior rather than hangs or crashes.",
    icon: AlertTriangle, color: "text-warning bg-warning/10 border-warning/20", category: "essential",
  },
  {
    id: "expires_header", label: "Expires Negotiation", description: "Expiration value handling",
    explanation: "Sends REGISTER requests with varying Expires values (e.g. 60s, 600s, 3600s) and checks what the registrar actually grants. Many servers cap or adjust the requested interval — this test reveals the negotiated expiration so you can set optimal re-registration timers and avoid premature binding expiry.",
    icon: Clock, color: "text-chart-cyan bg-chart-cyan/10 border-chart-cyan/20", category: "diagnostic",
  },
  {
    id: "nat_traversal", label: "NAT Detection", description: "NAT presence & Contact header validation",
    explanation: "Detects whether the client is behind NAT by comparing the local IP (from the OS interface) with the public IP seen by the registrar (from the Via received= parameter). Checks the Contact header for correctness and identifies scenarios where a SIP ALG, STUN, or outbound-proxy is needed for media connectivity.",
    icon: Shield, color: "text-chart-purple bg-chart-purple/10 border-chart-purple/20", category: "diagnostic",
  },
  {
    id: "registration_stability", label: "Stability", description: "Multiple registrations over time",
    explanation: "Performs a series of consecutive REGISTER requests (including initial registration and periodic re-registrations) to verify the binding remains stable over time. Detects intermittent failures, authentication token expiry, or server-side rate limiting that would cause dropped registrations in production.",
    icon: RefreshCw, color: "text-success bg-success/10 border-success/20", category: "diagnostic",
  },
  {
    id: "multi_transport", label: "Transport Fallback", description: "Cross-transport registration",
    explanation: "Attempts registration over multiple transports (UDP → TCP → TLS) to verify fallback behavior. Checks whether the registrar accepts connections on alternate transports and whether your client can automatically switch when the primary transport fails. Critical for environments with strict firewall rules or transport restrictions.",
    icon: Globe, color: "text-primary bg-primary/10 border-primary/20", category: "diagnostic",
  },
];

interface RegistrarDetailPanelProps {
  registrarId: string;
  onEdit: (id: string) => void;
}

export function RegistrarDetailPanel({ registrarId, onEdit }: RegistrarDetailPanelProps) {
  const registrar = useRegistrationStore((s) => s.registrars.find((r) => r.id === registrarId));
  const folders = useRegistrationStore((s) => s.folders);
  const testResults = useRegistrationStore((s) => s.testResults);
  const testSuites = useRegistrationStore((s) => s.testSuites);
  const updateRegistrar = useRegistrationStore((s) => s.updateRegistrar);
  const deleteRegistrar = useRegistrationStore((s) => s.deleteRegistrar);
  const runTestSuite = useRegistrationStore((s) => s.runTestSuite);
  const testRegistration = useRegistrationStore((s) => s.testRegistration);
  const lastSource = useRegistrationStore((s) => s.lastSource);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ecGlobalCtx = useExecutionContextStore((s) => s.context);
  const ecOverrides = useExecutionContextStore((s) => s.toolOverrides);
  const registrationCtx = useMemo(() => {
    return useExecutionContextStore.getState().resolvedContext("registration");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecGlobalCtx, ecOverrides]);

  const { error: notifyError, success: notifySuccess } = useNotifications();
  const [isRegistering, setIsRegistering] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rawSipOpen, setRawSipOpen] = useState(false);
  const [runningTests, setRunningTests] = useState<Set<string>>(new Set());
  const [expandedTest, setExpandedTest] = useState<string | null>(null);

  const deriveStatus = useCallback((id: string): string => {
    const result = testResults[id];
    if (result) {
      if ((result as any)?.unregistered === true) return "unregistered";
      return result.success ? "registered" : "failed";
    }
    const suite = testSuites[id];
    if (suite) {
      const basicTest = suite.tests.find((t: any) => t.test_type === "basic_registration");
      if (basicTest) {
        if ((basicTest.result as any)?.unregistered === true) return "unregistered";
        return basicTest.result.success ? "registered" : "failed";
      }
      return suite.overall_success ? "registered" : "failed";
    }
    return "unknown";
  }, [testResults, testSuites]);

  if (!registrar) return null;

  const id = registrar.id!;
  const result = testResults[id];
  const suiteResult = testSuites[id];
  const status = deriveStatus(id);
  const currentFolder = registrar.group ? folders.find((f) => f.id === registrar.group) : null;
  const cases = parseUseCases(registrar.use_case);
  const source = lastSource[id];
  const sourceBadgeLabel = useMemo(() => {
    if (!source) return null;
    if (source.source === "remote") {
      return `via ${resolvedAgentName("registration") ?? "agent"}`;
    }
    return "via local";
  }, [source, resolvedAgentName]);
  const activeExecutionLabel = useMemo(() => {
    if (registrationCtx.type === "local") return "Execution target: Local device";
    return `Execution target: ${resolvedAgentName("registration") ?? "Remote agent"}`;
  }, [registrationCtx, resolvedAgentName]);

  const statusConfig = {
    registered: { label: "Active", dotClass: "bg-success shadow-sm shadow-success/40 status-online", pillClass: "bg-success/12 text-success", borderClass: "border-success" },
    failed: { label: "Failed", dotClass: "bg-destructive shadow-sm shadow-destructive/40", pillClass: "bg-destructive/12 text-destructive", borderClass: "border-destructive" },
    unregistered: { label: "Idle", dotClass: "bg-warning status-warning", pillClass: "bg-warning/12 text-warning", borderClass: "border-warning" },
    unknown: { label: "Unknown", dotClass: "bg-muted-foreground/30", pillClass: "bg-muted/40 text-muted-foreground", borderClass: "border-muted-foreground/30" },
  }[status] ?? { label: "Unknown", dotClass: "bg-muted-foreground/30", pillClass: "bg-muted/40 text-muted-foreground", borderClass: "border-muted-foreground/30" };

  // ── Handlers ──

  const handleRegister = async () => {
    setIsRegistering(true);
    try {
      const ctxArg = registrationCtx.type === "local" ? undefined : registrationCtx;
      await testRegistration(id, ctxArg);
      const freshResult = useRegistrationStore.getState().testResults[id];
      if (freshResult?.success) {
        const via = registrationCtx.type === "local" ? "" : " via agent";
        notifySuccess("Registration Successful", `Registered to ${registrar.domain}${via}`, { source: "registration" });
      } else {
        notifyError("Registration Failed", freshResult?.error || "Registration failed", { source: "registration" });
      }
    } catch (error) {
      notifyError("Registration Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" });
    } finally { setIsRegistering(false); }
  };

  const handleUnregister = async () => {
    setIsRegistering(true);
    try {
      if (registrationCtx.type !== "local") {
        await testRegistration(id, registrationCtx, { unregister: true });
        const freshResult = useRegistrationStore.getState().testResults[id];
        useRegistrationStore.setState((state) => ({
          testResults: { ...state.testResults, [id]: { ...(freshResult ?? { success: true, status_code: 200, status_text: "Unregistered", response_time_ms: 0, request_message: "", response_message: "" }), timestamp: new Date().toISOString(), unregistered: true } as any },
        }));
        if (freshResult?.success) {
          const via = "via agent";
          notifySuccess("Unregistered", `Unregistered from ${registrar.domain} ${via}`, { source: "registration" });
        }
        else notifyError("Unregistration Failed", freshResult?.error || "Unregistration failed", { source: "registration" });
      } else {
        const res = await unregisterRegistrar(id);
        if (res.success) {
          useRegistrationStore.setState((state) => ({
            testSuites: { ...state.testSuites, [id]: { registrar_id: id, overall_success: true, total_tests: 1, passed_tests: 1, failed_tests: 0, tests: [{ test_type: "basic_registration" as const, success: true, result: { success: true, status_code: res.status_code || 200, status_text: res.status_text || "Unregistered", response_time_ms: 0, request_message: "", response_message: "", unregistered: true } }] } },
            testResults: { ...state.testResults, [id]: { success: true, status_code: res.status_code || 200, status_text: res.status_text || "Unregistered", response_time_ms: 0, request_message: "", response_message: "", timestamp: new Date().toISOString(), unregistered: true } as any },
          }));
          notifySuccess("Unregistered", `Unregistered from ${registrar.domain}`, { source: "registration" });
        } else {
          notifyError("Unregistration Failed", res.error || res.status_text || "Failed", { source: "registration" });
        }
      }
    } catch (error) {
      notifyError("Unregistration Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" });
    } finally { setIsRegistering(false); }
  };

  const handleDelete = async () => {
    try { await deleteRegistrar(id); notifySuccess("Deleted", `Deleted ${registrar.name}`, { source: "registration" }); }
    catch (error) { notifyError("Delete Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" }); }
    setDeleteConfirmOpen(false);
  };

  const handleMoveToFolder = async (folderId: string | null) => {
    try { await updateRegistrar(id, { ...registrar, group: folderId }); }
    catch { notifyError("Move failed", "Could not move registrar to folder.", { source: "registration" }); }
  };

  const handleToggleUseCase = async (toggleValue: string) => {
    const current = parseUseCases(registrar.use_case);
    const updated = current.includes(toggleValue) ? current.filter((c) => c !== toggleValue) : [...current, toggleValue];
    try { await updateRegistrar(id, { ...registrar, use_case: serializeUseCases(updated) ?? undefined }); }
    catch { notifyError("Update failed", "Could not update use case.", { source: "registration" }); }
  };

  const handleRunTest = async (testId: TestType) => {
    setRunningTests((prev) => new Set(prev).add(testId));
    try { await runTestSuite(id, [testId]); }
    catch (error) { notifyError("Test Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" }); }
    finally { setRunningTests((prev) => { const next = new Set(prev); next.delete(testId); return next; }); }
  };

  const handleRunCategory = async (category: "essential" | "diagnostic") => {
    const tests = CURATED_TESTS.filter((t) => t.category === category);
    const testIds = tests.map((t) => t.id);
    setRunningTests(new Set(testIds));
    try { await runTestSuite(id, testIds); }
    catch (error) { notifyError("Tests Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" }); }
    finally { setRunningTests(new Set()); }
  };

  const handleRunAll = async () => {
    const testIds = CURATED_TESTS.map((t) => t.id);
    setRunningTests(new Set(testIds));
    try { await runTestSuite(id, testIds); }
    catch (error) { notifyError("Tests Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" }); }
    finally { setRunningTests(new Set()); }
  };

  const getTestResult = (testType: string): TestResult | null => {
    if (!suiteResult) return null;
    return suiteResult.tests.find((t) => t.test_type === testType) ?? null;
  };

  // Test summary stats
  const testStats = useMemo(() => {
    if (!suiteResult) return { total: 0, passed: 0, failed: 0, pending: CURATED_TESTS.length };
    let passed = 0, failed = 0;
    for (const test of CURATED_TESTS) {
      const r = suiteResult.tests.find((t) => t.test_type === test.id);
      if (r) { if (r.success) passed++; else failed++; }
    }
    return { total: passed + failed, passed, failed, pending: CURATED_TESTS.length - passed - failed };
  }, [suiteResult]);

  const isAnyRunning = runningTests.size > 0;
  const focusedTest = useMemo(() => CURATED_TESTS.find((t) => t.id === expandedTest) ?? null, [expandedTest]);
  const focusedTestResult = focusedTest ? getTestResult(focusedTest.id) : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div className={cn("h-13 px-5 border-b border-border/40 border-l-2 bg-card/50 flex items-center gap-2.5", statusConfig.borderClass)}>
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", statusConfig.dotClass)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-[15px] font-semibold text-foreground truncate flex-1">{registrar.name}</h2>
              <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-sm shrink-0", statusConfig.pillClass)}>
                {statusConfig.label}
              </span>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/65 truncate">
              {registrar.username}@{registrar.domain}
              {sourceBadgeLabel ? ` • ${sourceBadgeLabel}` : ""}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-card/50">
          {isRegistering ? (
            <Button disabled size="sm" variant="neutral" className="h-8 gap-1.5 px-3 text-xs"><Clock className="h-3.5 w-3.5 animate-spin" />Working...</Button>
          ) : status === "registered" ? (
            <Button size="sm" variant="neutral" onClick={handleUnregister} className="h-8 gap-1.5 px-3 text-xs"><LinkDisconnect className="h-3.5 w-3.5" />Unregister</Button>
          ) : (
            <Button size="sm" onClick={handleRegister} className="h-8 gap-1.5 px-3 text-xs"><LinkConnect className="h-3.5 w-3.5" />Register</Button>
          )}
          <Button
            size="sm"
            variant="neutral"
            onClick={() => onEdit(id)}
            className="h-8 gap-1.5 px-3 text-xs border border-border/45 bg-card/80 hover:bg-accent/35"
          >
            <Settings className="h-3.5 w-3.5" />
            Edit
          </Button>
          <div className="h-6 w-px bg-border/35 mx-0.5" />
          <div className="inline-flex items-center gap-1 rounded-md border border-border/45 bg-muted/18 p-1">
            <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/75">
              Assign
            </span>
            {USE_CASE_OPTIONS.map((opt) => {
              const active = cases.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleToggleUseCase(opt.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-smooth border",
                    active
                      ? "bg-primary/14 border-primary/45 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                      : "bg-card/70 border-border/35 text-muted-foreground/80 hover:text-foreground hover:border-border/60 hover:bg-accent/30",
                  )}
                >
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          <Button size="sm" variant="destructive" onClick={() => setDeleteConfirmOpen(true)} className="h-8 px-2.5"><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
        {/* Connection */}
        <div className="px-5 py-3 border-b border-border/30 bg-background/10">
          <p className="section-label-sm mb-3">Connection</p>
          <div className="surface-subtle rounded-md border border-border/30 p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div className="ui-data-row flex items-center justify-between gap-3 py-1.5">
                <span className="text-muted-foreground/75">Domain</span>
                <span className="font-mono text-foreground/90 text-right truncate max-w-[70%]">{registrar.domain}</span>
              </div>
              <div className="ui-data-row flex items-center justify-between gap-3 py-1.5">
                <span className="text-muted-foreground/75">Username</span>
                <span className="font-mono text-foreground/90 text-right truncate max-w-[70%]">{registrar.username}</span>
              </div>
              <div className="ui-data-row flex items-center justify-between gap-3 py-1.5">
                <span className="text-muted-foreground/75">Transport</span>
                <span className="font-medium text-foreground/90 text-right truncate max-w-[70%]">{(registrar.transport || "udp").toUpperCase()} · Port {registrar.remote_port}</span>
              </div>
              <div className="ui-data-row flex items-center justify-between gap-3 py-1.5">
                <span className="text-muted-foreground/75">Local Port</span>
                <span className="font-mono text-foreground/90">{registrar.local_port ? String(registrar.local_port) : "Auto"}</span>
              </div>
              <div className="ui-data-row flex items-center justify-between gap-3 py-1.5">
                <span className="text-muted-foreground/75">Expires</span>
                <span className="font-mono text-foreground/90">{registrar.register_interval_seconds ?? "server default"}s</span>
              </div>
              <div className="ui-data-row flex items-center justify-between gap-3 py-1.5 md:col-span-2">
                <span className="text-muted-foreground/75">Timeout</span>
                <span className="font-mono text-foreground/90">{registrar.timeout_seconds}s</span>
              </div>
            </div>

            <div className="mt-3 border-t border-border/25 pt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5 items-center">
              <span className="inline-flex items-center rounded-md border border-primary/25 bg-primary/[0.08] px-2.5 py-1 text-xs font-medium text-primary w-fit">
                {activeExecutionLabel}
              </span>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="ui-control-shell h-7 inline-flex items-center gap-2 px-2.5 min-w-[13rem] text-xs md:justify-self-end"
                  >
                    {currentFolder ? <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className="text-muted-foreground/85 shrink-0">Folder</span>
                    <span className={cn("truncate", currentFolder ? "text-primary" : "text-muted-foreground/70")}>
                      {currentFolder?.name ?? "None"}
                    </span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0 ml-auto" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[12rem]">
                  {registrar.group && (
                    <>
                      <DropdownMenuItem onSelect={() => handleMoveToFolder(null)} className="gap-2 text-muted-foreground text-xs">Remove from folder</DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {folders.map((f) => (
                    <DropdownMenuItem key={f.id} onSelect={() => handleMoveToFolder(f.id)} className={cn("gap-2 text-xs", registrar.group === f.id && "text-primary font-medium")}>
                      <Folder className="h-3.5 w-3.5" />{f.name}{registrar.group === f.id && <span className="ml-auto text-2xs">✓</span>}
                    </DropdownMenuItem>
                  ))}
                  {folders.length === 0 && (
                    <DropdownMenuItem disabled className="text-xs text-muted-foreground">No folders created yet</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Last Response */}
        {result && result.status_code > 0 && !(result as any).unregistered && (
          <div className="px-5 py-4 border-b border-border/30">
            <p className="section-label-sm mb-2.5">Last Response</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-sm font-mono font-semibold", status === "registered" ? "text-success" : status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {result.status_code} {result.status_text}
              </span>
              {result.response_time_ms > 0 && <span className="text-[10px] text-muted-foreground/50 tabular-nums">{result.response_time_ms}ms</span>}
              {result.timestamp && <span className="text-[10px] text-muted-foreground/40">{formatTime(result.timestamp)}</span>}
              {(() => {
                const code = typeof result.status_code === "number" ? result.status_code : parseInt(String(result.status_code), 10);
                return !Number.isNaN(code) && code > 0 ? <TroubleshootLink sipCode={code} compact /> : null;
              })()}
            </div>
            {(result.request_message || result.response_message) && (
              <button type="button" onClick={() => setRawSipOpen(!rawSipOpen)} className="text-[10px] text-primary hover:underline mt-1.5">
                {rawSipOpen ? "Hide" : "Show"} raw SIP messages
              </button>
            )}
            {rawSipOpen && (
              <div className="mt-2 space-y-2">
                {result.request_message && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="section-label-sm">Request</span>
                      <CopyTextButton text={result.request_message} label="Copy" className="h-5 w-5" />
                    </div>
                    <pre className="text-[10px] bg-muted/50 rounded-md p-2 overflow-auto max-h-36 whitespace-pre-wrap font-mono text-muted-foreground">{result.request_message}</pre>
                  </div>
                )}
                {result.response_message && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="section-label-sm">Response</span>
                      <CopyTextButton text={result.response_message} label="Copy" className="h-5 w-5" />
                    </div>
                    <pre className="text-[10px] bg-muted/50 rounded-md p-2 overflow-auto max-h-36 whitespace-pre-wrap font-mono text-muted-foreground">{result.response_message}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ TESTS ═══════════════ */}
        <div className="px-5 py-4 border-b border-border/30">
          {/* Test header bar */}
          <div className="mb-2.5 rounded-md border border-border/40 bg-muted/20 p-2.5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
                <TestTube className="h-3.5 w-3.5 text-primary" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Registration Tests</p>
                <p className="text-[11px] text-muted-foreground">All 8 validations visible in one unified view.</p>
              </div>
              <span className="flex-1" />
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-md border border-success/30 bg-success/[0.08] px-2 py-1 text-center">
                  <p className="text-[10px] text-success/80">Passed</p>
                  <p className="text-xs font-semibold tabular-nums text-success">{testStats.passed}</p>
                </div>
                <div className="rounded-md border border-destructive/30 bg-destructive/[0.08] px-2 py-1 text-center">
                  <p className="text-[10px] text-destructive/80">Failed</p>
                  <p className="text-xs font-semibold tabular-nums text-destructive">{testStats.failed}</p>
                </div>
              </div>
            </div>
            <div className="mt-2 ml-9 flex items-center gap-2">
              <Button size="sm" variant="neutral" onClick={() => handleRunCategory("essential")} disabled={isAnyRunning} className="h-7 gap-1.5 text-xs">
                {isAnyRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Run Essential
              </Button>
              <Button size="sm" variant="neutral" onClick={() => handleRunCategory("diagnostic")} disabled={isAnyRunning} className="h-7 gap-1.5 text-xs">
                {isAnyRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Run Diagnostic
              </Button>
              <Button size="sm" onClick={handleRunAll} disabled={isAnyRunning} className="h-7 gap-1.5 text-xs">
                {isAnyRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Run All
              </Button>
            </div>
          </div>

          {/* Test cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {CURATED_TESTS.map((test) => {
              const testResult = getTestResult(test.id);
              const isRunning = runningTests.has(test.id);
              const isExpanded = expandedTest === test.id;
              const Icon = test.icon;

              return (
                <div key={test.id} className={cn(
                  "rounded-md border transition-smooth",
                  testResult?.success ? "border-success/30 bg-success/[0.07]" :
                  testResult && !testResult.success ? "border-destructive/30 bg-destructive/[0.06]" :
                  "border-border/40 bg-card/50",
                  isRunning && "border-primary/35 bg-primary/[0.07]",
                )}>
                  {/* Card header */}
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3 py-2">
                    {/* Icon */}
                    <div className={cn("p-1.5 rounded-md border shrink-0", test.color, isRunning && "status-online")}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>

                    {/* Label + description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <span className="text-[12px] font-semibold truncate min-w-0">{test.label}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={cn(
                            "inline-flex h-4 items-center rounded-md px-1.5 text-[9px] font-semibold uppercase tracking-wide border",
                            test.category === "essential"
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-success/30 bg-success/10 text-success"
                          )}>
                            {test.category === "essential" ? "Essential" : "Diagnostic"}
                          </span>
                          <TooltipWrapper
                            title={test.label}
                            description={test.explanation}
                            side="top"
                            delayDuration={200}
                          >
                            <button
                              type="button"
                              className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground/35 hover:text-muted-foreground transition-smooth"
                              tabIndex={-1}
                            >
                              <Info className="h-3 w-3" />
                            </button>
                          </TooltipWrapper>
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                        <p className="text-[10px] text-muted-foreground/65 truncate flex-1 min-w-0">{test.description}</p>
                        {isRunning && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-primary/35 bg-primary/[0.08] px-1.5 py-0.5 text-[9px] font-medium text-primary">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />Running
                          </span>
                        )}
                        {testResult && !isRunning && (
                          <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold",
                            testResult.success ? "border-success/35 bg-success/[0.08] text-success" : "border-destructive/35 bg-destructive/[0.08] text-destructive"
                          )}>
                            {testResult.success ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                            {testResult.success ? "Passed" : "Failed"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Result summary */}
                    {testResult && !isRunning && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {testResult.result.status_code > 0 && (
                          <span className={cn(
                            "rounded-md border px-1.5 py-0.5 text-[10px] font-mono font-semibold tabular-nums",
                            testResult.success ? "border-success/30 bg-success/[0.08] text-success/90" : "border-destructive/30 bg-destructive/[0.08] text-destructive/90"
                          )}>
                            {testResult.result.status_code}
                          </span>
                        )}
                        {testResult.result.response_time_ms > 0 && (
                          <span className="rounded-md border border-border/40 bg-card/50 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-muted-foreground/70">
                            {testResult.result.response_time_ms}ms
                          </span>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {testResult && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpandedTest(test.id)}
                          className={cn(
                            "h-7 px-2 text-[10px] border",
                            isExpanded ? "border-primary/35 bg-primary/[0.1] text-primary" : "border-border/35 text-muted-foreground hover:text-foreground hover:bg-accent/35",
                          )}
                        >
                          Details
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRunTest(test.id)}
                        disabled={isRunning}
                        className="h-7 w-7 rounded-md flex items-center justify-center border border-border/35 bg-card/50 text-muted-foreground/50 hover:text-primary hover:border-primary/35 hover:bg-primary/[0.08] transition-smooth disabled:opacity-30"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </div>

        <Dialog open={!!expandedTest} onOpenChange={(open) => { if (!open) setExpandedTest(null); }}>
          <DialogContent className="max-w-3xl max-h-[calc(min(100vh,100dvh)-2rem)] overflow-hidden p-0 gap-0">
            <DialogHeader className="px-5 py-3 border-b border-border/40 bg-muted/20">
              <DialogTitle className="text-sm">{focusedTest?.label ?? "Test Details"}</DialogTitle>
              <p className="text-xs text-muted-foreground">{focusedTest?.description ?? "Detailed result breakdown."}</p>
            </DialogHeader>
            <div className="p-4 overflow-auto space-y-2">
              {focusedTestResult ? (
                <div className="rounded-md border border-border/35 bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-muted-foreground/60 w-16 shrink-0">Status</span>
                    <span className={cn("font-mono font-semibold", focusedTestResult.success ? "text-success" : "text-destructive")}>
                      {focusedTestResult.result.status_code} {focusedTestResult.result.status_text}
                    </span>
                    {(() => {
                      const code = focusedTestResult.result.status_code;
                      return code > 0 ? <TroubleshootLink sipCode={code} compact /> : null;
                    })()}
                  </div>
                  {focusedTestResult.result.response_time_ms > 0 && (
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-muted-foreground/60 w-16 shrink-0">Latency</span>
                      <span className="font-mono tabular-nums">{focusedTestResult.result.response_time_ms}ms</span>
                      <span className={cn("text-[9px] px-1.5 py-0.5 rounded",
                        focusedTestResult.result.response_time_ms < 100 ? "bg-success/10 text-success" :
                        focusedTestResult.result.response_time_ms < 300 ? "bg-warning/10 text-warning" :
                        "bg-destructive/10 text-destructive"
                      )}>
                        {focusedTestResult.result.response_time_ms < 100 ? "Excellent" : focusedTestResult.result.response_time_ms < 300 ? "Good" : "Slow"}
                      </span>
                    </div>
                  )}
                  {focusedTestResult.result.expires != null && (
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-muted-foreground/60 w-16 shrink-0">Expires</span>
                      <span className="font-mono tabular-nums">{focusedTestResult.result.expires}s</span>
                    </div>
                  )}
                  {focusedTestResult.result.error && (
                    <div className="flex items-start gap-3 text-[11px]">
                      <span className="text-muted-foreground/60 w-16 shrink-0">Error</span>
                      <span className="text-destructive">{focusedTestResult.result.error}</span>
                    </div>
                  )}

                  {focusedTestResult.diagnostics && Object.keys(focusedTestResult.diagnostics).length > 0 && (
                    <div className="pt-1.5 mt-1.5 border-t border-border/20">
                      <p className="section-label-sm mb-1.5">Diagnostics</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(focusedTestResult.diagnostics).map(([key, value]) => (
                          <div key={key} className="text-[10px]">
                            <span className="text-muted-foreground/50">{key.replace(/_/g, " ")}:</span>{" "}
                            <span className="font-mono">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(focusedTestResult.result.request_message || focusedTestResult.result.response_message) && (
                    <div className="pt-1.5 mt-1.5 border-t border-border/20">
                      {focusedTestResult.result.request_message && (
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="section-label-sm">Request</span>
                            <CopyTextButton text={focusedTestResult.result.request_message} label="Copy" className="h-4 w-4" />
                          </div>
                          <pre className="text-[9px] bg-background/50 rounded p-1.5 overflow-auto max-h-24 whitespace-pre-wrap font-mono text-muted-foreground/70">{focusedTestResult.result.request_message}</pre>
                        </div>
                      )}
                      {focusedTestResult.result.response_message && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="section-label-sm">Response</span>
                            <CopyTextButton text={focusedTestResult.result.response_message} label="Copy" className="h-4 w-4" />
                          </div>
                          <pre className="text-[9px] bg-background/50 rounded p-1.5 overflow-auto max-h-24 whitespace-pre-wrap font-mono text-muted-foreground/70">{focusedTestResult.result.response_message}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full min-h-[180px] flex items-center justify-center text-center px-4">
                  <EmptyState
                    compact
                    variant="inline"
                    title="No result yet"
                    description="Run this test to populate detailed diagnostics."
                    className="p-0"
                  />
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Notes */}
        <InlineNoteWidget
          context={createRegistrarContext(id, registrar.name)}
          className="mx-5 mb-4"
          defaultCollapsed={false}
          visualVariant="registration"
        />

      </div>

      {/* Modals */}
      <ConfirmDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen} title="Delete Registrar" description={`Are you sure you want to delete "${registrar.name}"? This action cannot be undone.`} confirmText="Delete" cancelText="Cancel" variant="destructive" onConfirm={handleDelete} />
    </div>
  );
}


