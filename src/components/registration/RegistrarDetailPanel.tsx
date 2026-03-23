import { useRegistrationStore } from "@/stores/registrationStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LinkConnect,
  LinkDisconnect,
  Settings,
  Trash2,
  Phone,
  Printer,
  Play,
  Loader2,
  ChevronDown,
  ChevronRight,
  Info,
  X,
  CaretUpDown,
} from "@/lib/icons";
import { useState, useMemo, useCallback, useId } from "react";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineNoteWidget } from "@/components/notes/widgets/InlineNoteWidget";
import { createRegistrarContext } from "@/lib/noteContext";
import { unregisterRegistrar } from "@/api/registration";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTime } from "@/lib/dateTime";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import type { TestType, TestResult } from "@/types/registration";

const USE_CASE_OPTIONS: { value: string; label: string; Icon: typeof Phone }[] = [
  { value: "calling", label: "Phone", Icon: Phone },
  { value: "faxing", label: "Fax", Icon: Printer },
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
}

const CURATED_TESTS: CuratedTest[] = [
  {
    id: "basic_registration",
    label: "REGISTER / auth",
    description: "Standard REGISTER with digest",
    explanation:
      "SIP REGISTER with full digest handshake (401 → authenticated retry). Confirms credentials, reachability, 200 OK + Contact.",
  },
  {
    id: "deregistration",
    label: "REGISTER Expires:0",
    description: "Remove binding",
    explanation: "REGISTER Expires:0; expect 200 OK and binding removed.",
  },
  {
    id: "network_connectivity",
    label: "DNS + socket",
    description: "Resolve host, open port",
    explanation: "DNS A/AAAA then TCP/UDP connect to SIP port; reports latency / failures.",
  },
  {
    id: "error_handling",
    label: "401/403 path",
    description: "Bad creds → proper error",
    explanation: "REGISTER with wrong secret; expect 401/403, parseable reason.",
  },
  {
    id: "expires_header",
    label: "Expires cap",
    description: "Server-granted expiry",
    explanation: "Vary Expires; observe registrar-negotiated value.",
  },
  {
    id: "nat_traversal",
    label: "NAT / Contact",
    description: "Via received, Contact check",
    explanation: "Compare local vs public; Contact sanity for NAT scenarios.",
  },
  {
    id: "registration_stability",
    label: "Re-REGISTER",
    description: "Series over time",
    explanation: "Multiple REGISTERs; detect drops / rate limits.",
  },
  {
    id: "multi_transport",
    label: "UDP/TCP/TLS",
    description: "Transport matrix",
    explanation: "Attempts across transports; fallback behavior.",
  },
];

interface RegistrarDetailPanelProps {
  registrarId: string;
  onEdit: (id: string) => void;
}

/** Labeled row: Phone / Fax chips + neutral icon menu. */
function ExecutionTargetsField({
  cases,
  onToggle,
}: {
  cases: string[];
  onToggle: (value: string) => void;
}) {
  const selected = USE_CASE_OPTIONS.filter((o) => cases.includes(o.value));
  const available = USE_CASE_OPTIONS.filter((o) => !cases.includes(o.value));
  const titleId = useId();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <span
        id={titleId}
        className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/90"
      >
        Execution targets
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-labelledby={titleId}>
        {selected.map((opt) => {
          const Icon = opt.Icon;
          return (
            <span
              key={opt.value}
              className="inline-flex h-[var(--ui-control-height-sm)] max-w-full min-h-[var(--ui-control-height-sm)] shrink-0 items-center gap-1 rounded-md bg-primary px-1.5 text-primary-foreground"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-primary-foreground/18" aria-hidden>
                <Icon className="h-3.5 w-3.5 opacity-95" strokeWidth={2} />
              </span>
              <span className="max-w-[5rem] truncate pr-0.5 text-[11px] font-semibold sm:max-w-[6.5rem]">{opt.label}</span>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-primary-foreground/90 transition-colors hover:bg-primary-foreground/18"
                aria-label={`Remove ${opt.label}`}
                onClick={(e) => {
                  e.preventDefault();
                  onToggle(opt.value);
                }}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.25} />
              </button>
            </span>
          );
        })}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="neutral" size="icon-sm" className="shrink-0" aria-label="Add execution target">
              <CaretUpDown className="h-3.5 w-3.5" strokeWidth={2} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[11rem] text-xs">
            {available.map((opt) => {
              const Icon = opt.Icon;
              return (
                <DropdownMenuItem key={opt.value} className="gap-2 py-2 text-xs" onSelect={() => onToggle(opt.value)}>
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                  <span className="font-semibold">{opt.label}</span>
                </DropdownMenuItem>
              );
            })}
            {available.length === 0 ? (
              <DropdownMenuItem disabled className="text-xs opacity-70">
                All targets are active
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function sipCodeTileClass(code: number) {
  return cn(
    "font-mono text-lg font-bold tabular-nums leading-none tracking-tight",
    code >= 100 && code < 200 && "text-sky-400",
    code >= 200 && code < 300 && "text-success",
    code >= 300 && code < 400 && "text-amber-400/95",
    code >= 400 && code < 500 && "text-destructive",
    code >= 500 && code < 600 && "text-orange-400",
    code >= 600 && code < 700 && "text-muted-foreground",
  );
}

function sipCodeTileShellClass(code: number) {
  return cn(
    "mt-0.5 flex h-10 min-w-10 shrink-0 items-center justify-center rounded-xl border bg-black/22 px-1.5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)]",
    code >= 100 && code < 200 && "border-sky-500/35 bg-sky-500/8",
    code >= 200 && code < 300 && "border-success/40 bg-success/10",
    code >= 300 && code < 400 && "border-amber-500/35 bg-amber-500/8",
    code >= 400 && code < 500 && "border-destructive/40 bg-destructive/10",
    code >= 500 && code < 600 && "border-orange-500/40 bg-orange-500/10",
    code >= 600 && code < 700 && "border-border/50",
  );
}

export function RegistrarDetailPanel({ registrarId, onEdit }: RegistrarDetailPanelProps) {
  const registrar = useRegistrationStore((s) => s.registrars.find((r) => r.id === registrarId));
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

  const deriveStatus = useCallback(
    (rid: string): string => {
      const result = testResults[rid];
      if (result) {
        if ((result as any)?.unregistered === true) return "unregistered";
        return result.success ? "registered" : "failed";
      }
      const suite = testSuites[rid];
      if (suite) {
        const basicTest = suite.tests.find((t: any) => t.test_type === "basic_registration");
        if (basicTest) {
          if ((basicTest.result as any)?.unregistered === true) return "unregistered";
          return basicTest.result.success ? "registered" : "failed";
        }
        return suite.overall_success ? "registered" : "failed";
      }
      return "unknown";
    },
    [testResults, testSuites],
  );

  if (!registrar) return null;

  const id = registrar.id!;
  const result = testResults[id];
  const suiteResult = testSuites[id];
  const status = deriveStatus(id);
  const cases = parseUseCases(registrar.use_case);
  const source = lastSource[id];
  const sourceLine = useMemo(() => {
    if (!source) return null;
    if (source.source === "remote") return `src=remote agent=${resolvedAgentName("registration") ?? "?"}`;
    return "src=local";
  }, [source, resolvedAgentName]);
  const execLine = useMemo(() => {
    if (registrationCtx.type === "local") return "exec_ctx=local";
    return `exec_ctx=remote:${resolvedAgentName("registration") ?? "?"}`;
  }, [registrationCtx, resolvedAgentName]);

  /** Last meaningful SIP response for header tile (registration result or basic_registration from suite). */
  const headerSipCode = useMemo(() => {
    const coerce = (v: unknown): number | null => {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return !Number.isNaN(n) && n >= 100 && n <= 699 ? n : null;
    };
    if (result) {
      const c = coerce((result as { status_code?: unknown }).status_code);
      if (c != null) return c;
    }
    if (suiteResult) {
      const basic = suiteResult.tests.find((t) => t.test_type === "basic_registration");
      const c = coerce(basic?.result?.status_code);
      if (c != null) return c;
    }
    return null;
  }, [result, suiteResult]);

  const handleRegister = async () => {
    setIsRegistering(true);
    try {
      const ctxArg = registrationCtx.type === "local" ? undefined : registrationCtx;
      await testRegistration(id, ctxArg);
      const freshResult = useRegistrationStore.getState().testResults[id];
      if (freshResult?.success) {
        notifySuccess("Registration Successful", `Registered to ${registrar.domain}`, { source: "registration" });
      } else {
        notifyError("Registration Failed", freshResult?.error || "Registration failed", { source: "registration" });
      }
    } catch (error) {
      notifyError("Registration Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleUnregister = async () => {
    setIsRegistering(true);
    try {
      if (registrationCtx.type !== "local") {
        await testRegistration(id, registrationCtx, { unregister: true });
        const freshResult = useRegistrationStore.getState().testResults[id];
        useRegistrationStore.setState((state) => ({
          testResults: {
            ...state.testResults,
            [id]: {
              ...(freshResult ?? {
                success: true,
                status_code: 200,
                status_text: "Unregistered",
                response_time_ms: 0,
                request_message: "",
                response_message: "",
              }),
              timestamp: new Date().toISOString(),
              unregistered: true,
            } as any,
          },
        }));
        if (freshResult?.success) {
          notifySuccess("Unregistered", registrar.domain, { source: "registration" });
        } else {
          notifyError("Unregistration Failed", freshResult?.error || "Failed", { source: "registration" });
        }
      } else {
        const res = await unregisterRegistrar(id);
        if (res.success) {
          useRegistrationStore.setState((state) => ({
            testSuites: {
              ...state.testSuites,
              [id]: {
                registrar_id: id,
                overall_success: true,
                total_tests: 1,
                passed_tests: 1,
                failed_tests: 0,
                tests: [
                  {
                    test_type: "basic_registration" as const,
                    success: true,
                    result: {
                      success: true,
                      status_code: res.status_code || 200,
                      status_text: res.status_text || "Unregistered",
                      response_time_ms: 0,
                      request_message: "",
                      response_message: "",
                      unregistered: true,
                    },
                  },
                ],
              },
            },
            testResults: {
              ...state.testResults,
              [id]: {
                success: true,
                status_code: res.status_code || 200,
                status_text: res.status_text || "Unregistered",
                response_time_ms: 0,
                request_message: "",
                response_message: "",
                timestamp: new Date().toISOString(),
                unregistered: true,
              } as any,
            },
          }));
          notifySuccess("Unregistered", registrar.domain, { source: "registration" });
        } else {
          notifyError("Unregistration Failed", res.error || res.status_text || "Failed", { source: "registration" });
        }
      }
    } catch (error) {
      notifyError("Unregistration Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteRegistrar(id);
      notifySuccess("Deleted", registrar.name, { source: "registration" });
    } catch (error) {
      notifyError("Delete Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" });
    }
    setDeleteConfirmOpen(false);
  };

  const handleToggleUseCase = async (toggleValue: string) => {
    const current = parseUseCases(registrar.use_case);
    const updated = current.includes(toggleValue) ? current.filter((c) => c !== toggleValue) : [...current, toggleValue];
    try {
      await updateRegistrar(id, { ...registrar, use_case: serializeUseCases(updated) ?? undefined });
    } catch {
      notifyError("Update failed", "Could not update use case.", { source: "registration" });
    }
  };

  const handleRunTest = async (testId: TestType) => {
    setRunningTests((prev) => new Set(prev).add(testId));
    try {
      await runTestSuite(id, [testId]);
    } catch (error) {
      notifyError("Test Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" });
    } finally {
      setRunningTests((prev) => {
        const next = new Set(prev);
        next.delete(testId);
        return next;
      });
    }
  };

  const handleRunAll = async () => {
    const testIds = CURATED_TESTS.map((t) => t.id);
    setRunningTests(new Set(testIds));
    try {
      await runTestSuite(id, testIds);
    } catch (error) {
      notifyError("Tests Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" });
    } finally {
      setRunningTests(new Set());
    }
  };

  const getTestResult = (testType: string): TestResult | null => {
    if (!suiteResult) return null;
    return suiteResult.tests.find((t) => t.test_type === testType) ?? null;
  };

  const testStats = useMemo(() => {
    if (!suiteResult) return { passed: 0, failed: 0 };
    let passed = 0;
    let failed = 0;
    for (const test of CURATED_TESTS) {
      const r = suiteResult.tests.find((t) => t.test_type === test.id);
      if (r) {
        if (r.success) passed++;
        else failed++;
      }
    }
    return { passed, failed };
  }, [suiteResult]);

  const isAnyRunning = runningTests.size > 0;
  const focusedTest = useMemo(() => CURATED_TESTS.find((t) => t.id === expandedTest) ?? null, [expandedTest]);
  const focusedTestResult = focusedTest ? getTestResult(focusedTest.id) : null;

  const kv = (k: string, v: string) => (
    <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-x-3 border-b border-border/20 py-2 text-[12px] last:border-b-0 sm:grid-cols-[minmax(0,9rem)_1fr]">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/85">{k}</span>
      <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-foreground/92" title={v}>
        {v}
      </span>
    </div>
  );

  const statusBadge =
    status === "registered" ? (
      <Badge variant="success" className="h-6 gap-1.5 rounded-md px-2.5 text-[11px] font-semibold shadow-sm">
        <span
          className="size-1.5 rounded-full bg-white/90 shadow-[0_0_8px_hsl(var(--success)/0.5)] dark:bg-emerald-950/40"
          aria-hidden
        />
        Registered
      </Badge>
    ) : status === "failed" ? (
      <Badge variant="destructive" className="h-6 gap-1.5 rounded-md px-2.5 text-[11px] font-semibold shadow-sm">
        <span className="size-1.5 rounded-full bg-white/85 dark:bg-red-950/50" aria-hidden />
        Failed
      </Badge>
    ) : status === "unregistered" ? (
      <Badge variant="secondary" className="h-6 gap-1.5 rounded-md border border-warning/35 bg-warning/12 px-2.5 text-[11px] font-semibold text-warning shadow-none">
        <span className="size-1.5 rounded-full bg-warning/80" aria-hidden />
        Idle
      </Badge>
    ) : (
      <Badge variant="secondary" className="h-6 gap-1.5 rounded-md px-2.5 text-[11px] font-semibold">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
        Unknown
      </Badge>
    );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ops-panel-bg)] text-xs">
      {/* Premium command header — pro console, not campaign landing */}
      <header className="relative shrink-0 overflow-hidden border-b border-[var(--ops-panel-border-subtle)] bg-[linear-gradient(165deg,hsl(var(--card)/0.42)_0%,transparent_55%),var(--ops-panel-bg-elevated)] px-3 py-3 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" aria-hidden />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div
              className={headerSipCode != null ? sipCodeTileShellClass(headerSipCode) : "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-black/22 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)]"}
              title={headerSipCode != null ? `SIP ${headerSipCode}` : "No SIP response yet"}
              aria-label={headerSipCode != null ? `Last SIP response code ${headerSipCode}` : "No SIP response code yet"}
            >
              {headerSipCode != null ? (
                <span className={sipCodeTileClass(headerSipCode)}>{headerSipCode}</span>
              ) : (
                <span className="select-none font-mono text-xl font-semibold leading-none text-muted-foreground/40" aria-hidden>
                  —
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">{registrar.name}</h2>
                {statusBadge}
              </div>
              <p className="truncate font-mono text-[11px] leading-snug text-muted-foreground/80">
                <span className="text-foreground/70">{registrar.username}</span>
                <span className="text-muted-foreground/55"> @ </span>
                <span className="text-foreground/75">{registrar.domain}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {sourceLine && (
                  <span className="rounded-md border border-border/40 bg-black/18 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/80">
                    {sourceLine}
                  </span>
                )}
                <span className="rounded-md border border-border/35 bg-black/14 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/75">
                  <span className="text-muted-foreground/50">Run context · </span>
                  {execLine.replace("exec_ctx=", "")}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:pt-0.5">
            {/*
              Heights: Button size sm / icon-sm (--ui-control-height-sm). Widths stay natural.
            */}
            <div className="flex flex-wrap items-center gap-1.5">
              {isRegistering ? (
                <Button disabled variant="neutral" size="sm" className="gap-1.5 text-xs font-medium">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  Working…
                </Button>
              ) : status === "registered" ? (
                <Button variant="neutral" size="sm" className="gap-1.5 text-xs font-medium shadow-sm" onClick={handleUnregister}>
                  <LinkDisconnect className="h-3.5 w-3.5 shrink-0" />
                  Unregister
                </Button>
              ) : (
                <Button size="sm" className="gap-1.5 text-xs font-medium shadow-sm" onClick={handleRegister}>
                  <LinkConnect className="h-3.5 w-3.5 shrink-0" />
                  Register
                </Button>
              )}
              <Button variant="neutral" size="sm" className="gap-1.5 text-xs font-medium" onClick={() => onEdit(id)}>
                <Settings className="h-3.5 w-3.5 shrink-0" />
                Edit
              </Button>
            </div>

            <AppDivider orientation="vertical" size="md" className="hidden h-[var(--ui-control-height-sm)] self-center sm:block" />

            <ExecutionTargetsField cases={cases} onToggle={(v) => void handleToggleUseCase(v)} />

            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              className="shrink-0"
              aria-label="Delete registrar"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
            </Button>
          </div>
        </div>
      </header>

      {/* Single scroll surface — layered panels */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        <section className="ui-panel-shell rounded-xl border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.14)_0%,transparent_42%)] p-0 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]">
          <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">Endpoint</span>
            <span className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" aria-hidden />
          </div>
          <div className="px-3 pb-1 pt-0.5">
            {kv("Domain", registrar.domain)}
            {kv("User", registrar.username)}
            {kv("Transport", `${(registrar.transport || "udp").toUpperCase()}`)}
            {kv("Remote port", String(registrar.remote_port))}
            {kv("Local port", registrar.local_port ? String(registrar.local_port) : "Auto")}
            {kv("Expires (s)", String(registrar.register_interval_seconds ?? "Default"))}
            {kv("Timeout (s)", String(registrar.timeout_seconds))}
          </div>
        </section>

        {result && result.status_code > 0 && !(result as any).unregistered && (
          <section className="ui-panel-shell rounded-xl border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.12)_0%,transparent_40%)] p-0 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 px-3 py-2.5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">Last REGISTER</div>
                <p className="text-[10px] text-muted-foreground/65">Most recent transaction on this registrar</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <span
                  className={cn(
                    "rounded-md border px-2 py-1 font-semibold tabular-nums",
                    status === "registered" && "border-success/35 bg-success/10 text-success",
                    status === "failed" && "border-destructive/35 bg-destructive/10 text-destructive",
                    status !== "registered" && status !== "failed" && "border-border/40 bg-black/15 text-foreground/80",
                  )}
                >
                  {result.status_code} {result.status_text}
                </span>
                {result.response_time_ms > 0 && (
                  <span className="rounded-md border border-border/35 bg-black/14 px-2 py-1 tabular-nums text-muted-foreground">
                    {result.response_time_ms} ms
                  </span>
                )}
                {result.timestamp && (
                  <span className="text-[10px] text-muted-foreground/55">{formatTime(result.timestamp)}</span>
                )}
                {(() => {
                  const code = typeof result.status_code === "number" ? result.status_code : parseInt(String(result.status_code), 10);
                  return !Number.isNaN(code) && code > 0 ? <TroubleshootLink sipCode={code} compact /> : null;
                })()}
              </div>
            </div>
            {(result.request_message || result.response_message) && (
              <div className="border-t border-border/25 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setRawSipOpen(!rawSipOpen)}
                  className="group flex w-full items-center gap-2 rounded-lg border border-border/35 bg-black/12 px-2.5 py-2 text-left transition-[background,border-color] hover:border-border/55 hover:bg-black/18"
                >
                  {rawSipOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-foreground">Raw SIP messages</div>
                    <div className="truncate text-[10px] text-muted-foreground/70">SIP request and response for this transaction</div>
                  </div>
                </button>
                {rawSipOpen && (
                  <div className="mt-3 space-y-3">
                    {result.request_message && (
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Outbound request</span>
                          <CopyTextButton text={result.request_message} label="Copy" className="h-7 text-[10px]" />
                        </div>
                        <pre className="max-h-36 overflow-auto rounded-lg border border-border/40 bg-black/35 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground shadow-inner">
                          {result.request_message}
                        </pre>
                      </div>
                    )}
                    {result.response_message && (
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Response</span>
                          <CopyTextButton text={result.response_message} label="Copy" className="h-7 text-[10px]" />
                        </div>
                        <pre className="max-h-36 overflow-auto rounded-lg border border-border/40 bg-black/35 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground shadow-inner">
                          {result.response_message}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="ui-panel-shell min-w-0 rounded-xl border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.12)_0%,transparent_38%)] p-0 pb-2 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]">
          <div className="flex flex-col gap-3 border-b border-border/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">Testing suite</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="success" className="h-5 rounded-md px-2 text-[10px] font-semibold tabular-nums">
                  {testStats.passed} passed
                </Badge>
                <Badge variant="destructive" className="h-5 rounded-md px-2 text-[10px] font-semibold tabular-nums">
                  {testStats.failed} failed
                </Badge>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 px-4 text-xs font-semibold shadow-sm sm:self-center"
              disabled={isAnyRunning}
              onClick={handleRunAll}
            >
              {isAnyRunning ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Run all
            </Button>
          </div>
          <div className="px-2 pb-1 pt-2 sm:px-3">
            <div className="overflow-x-auto rounded-lg border border-border/40 bg-black/[0.08] shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)]">
              <table className="w-full min-w-[480px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border/40 bg-[var(--ops-panel-bg-elevated)]/95 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground backdrop-blur-sm">
                    <th className="w-9 px-2 py-2.5 pl-3">#</th>
                    <th className="min-w-[10rem] px-2 py-2.5">Check</th>
                    <th className="min-w-[7rem] px-2 py-2.5">Result</th>
                    <th className="w-14 px-2 py-2.5">Code</th>
                    <th className="w-14 px-2 py-2.5">RTT</th>
                    <th className="w-[5.5rem] px-2 py-2.5 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[11px]">
                  {CURATED_TESTS.map((test, i) => {
                    const tr = getTestResult(test.id);
                    const running = runningTests.has(test.id);
                    return (
                      <tr
                        key={test.id}
                        className="border-b border-border/15 transition-colors hover:bg-white/[0.035] last:border-b-0"
                      >
                        <td className="px-2 py-2.5 pl-3 tabular-nums text-muted-foreground/80">{i + 1}</td>
                        <td className="px-2 py-2.5 align-top">
                          <div className="flex items-start gap-1.5">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1">
                                <span className="font-sans text-[12px] font-medium text-foreground/95">{test.label}</span>
                                <TooltipWrapper title={test.label} description={test.explanation} side="right" delayDuration={180}>
                                  <button
                                    type="button"
                                    className="rounded p-0.5 text-muted-foreground/45 transition-colors hover:bg-white/5 hover:text-muted-foreground"
                                    aria-label="About this check"
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipWrapper>
                              </div>
                              <p className="mt-0.5 font-sans text-[10px] leading-snug text-muted-foreground/72">{test.description}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 align-middle">
                          {running ? (
                            <span className="inline-flex items-center gap-1.5 text-primary">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span className="text-[11px] font-semibold">Running</span>
                            </span>
                          ) : tr ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 text-[11px] font-semibold",
                                tr.success ? "text-success" : "text-destructive",
                              )}
                            >
                              <span
                                className={cn(
                                  "size-1.5 rounded-full",
                                  tr.success ? "bg-success shadow-[0_0_8px_hsl(var(--success)/0.45)]" : "bg-destructive",
                                )}
                                aria-hidden
                              />
                              {tr.success ? "Pass" : "Fail"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/45">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 tabular-nums text-muted-foreground/85">
                          {tr && tr.result.status_code > 0 ? tr.result.status_code : "—"}
                        </td>
                        <td className="px-2 py-2.5 tabular-nums text-muted-foreground/85">
                          {tr && tr.result.response_time_ms > 0 ? `${tr.result.response_time_ms}` : "—"}
                        </td>
                        <td className="px-2 py-2.5 pr-3 text-right align-middle">
                          <div className="flex justify-end gap-1">
                            {tr && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px] font-medium"
                                onClick={() => setExpandedTest(test.id)}
                              >
                                Details
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="neutral"
                              size="icon-sm"
                              className="h-7 w-7 shadow-sm"
                              disabled={running}
                              aria-label={`Run ${test.label}`}
                              onClick={() => handleRunTest(test.id)}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div className="shrink-0 border-t border-[var(--ops-panel-border-subtle)] bg-[var(--ops-panel-bg-subtle)]/90 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]">
        <InlineNoteWidget
          context={createRegistrarContext(id, registrar.name)}
          defaultCollapsed
          className="rounded-none border-0 border-t-0 bg-transparent"
          visualVariant="registration"
        />
      </div>

      <Dialog open={!!expandedTest} onOpenChange={(open) => { if (!open) setExpandedTest(null); }}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden border-border/50 p-0 shadow-2xl">
          <DialogHeader className="space-y-1 border-b border-border/40 bg-[linear-gradient(180deg,hsl(var(--card)/0.55)_0%,transparent_100%)] px-4 py-3">
            <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
              {focusedTest?.label ?? "Check result"}
            </DialogTitle>
            <p className="text-[13px] leading-snug text-muted-foreground">{focusedTest?.description}</p>
          </DialogHeader>
          <div className="max-h-[min(70dvh,520px)] space-y-3 overflow-y-auto p-4 text-xs">
            {focusedTestResult ? (
              <div className="space-y-3 rounded-xl border border-border/45 bg-black/[0.14] p-3 shadow-inner">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">SIP status</span>
                  <span className={cn("font-mono text-sm font-semibold tabular-nums", focusedTestResult.success ? "text-success" : "text-destructive")}>
                    {focusedTestResult.result.status_code} {focusedTestResult.result.status_text}
                  </span>
                  {focusedTestResult.result.status_code > 0 ? <TroubleshootLink sipCode={focusedTestResult.result.status_code} compact /> : null}
                </div>
                {focusedTestResult.result.response_time_ms > 0 && (
                  <div className="flex flex-wrap gap-4 font-mono text-[11px] text-muted-foreground">
                    <span>
                      <span className="text-muted-foreground/60">RTT · </span>
                      {focusedTestResult.result.response_time_ms} ms
                    </span>
                  </div>
                )}
                {focusedTestResult.result.expires != null && (
                  <div className="font-mono text-[11px] text-muted-foreground">
                    <span className="text-muted-foreground/60">Expires · </span>
                    {focusedTestResult.result.expires}s
                  </div>
                )}
                {focusedTestResult.result.error && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">{focusedTestResult.result.error}</p>
                )}
                {focusedTestResult.diagnostics && Object.keys(focusedTestResult.diagnostics).length > 0 && (
                  <div className="border-t border-border/30 pt-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Diagnostics</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {Object.entries(focusedTestResult.diagnostics).map(([key, value]) => (
                        <div key={key} className="rounded-md border border-border/25 bg-black/20 px-2 py-1.5 font-mono text-[10px]">
                          <span className="text-muted-foreground/70">{key}</span>
                          <span className="ml-1 text-foreground/90">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(focusedTestResult.result.request_message || focusedTestResult.result.response_message) && (
                  <div className="space-y-3 border-t border-border/30 pt-3">
                    {focusedTestResult.result.request_message && (
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Request</div>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border/40 bg-black/35 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                          {focusedTestResult.result.request_message}
                        </pre>
                      </div>
                    )}
                    {focusedTestResult.result.response_message && (
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Response</div>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border/40 bg-black/35 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                          {focusedTestResult.result.response_message}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState compact variant="inline" title="No capture yet" description="Run this check to populate results." className="border-0 bg-transparent py-8" />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete registrar"
        description={`Drop “${registrar.name}” permanently?`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
