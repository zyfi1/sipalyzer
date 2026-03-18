import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { clearTestResults } from "@/api/registration";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useNotifications } from "@/hooks/useNotifications";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Network,
  RefreshCw,
  Shield,
  Trash2,
  XCircle,
  Info,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/dateTime";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import type { TestResult, TestType } from "@/types/registration";
import { TEST_TYPES } from "@/types/registration";
import { ReportExportDialog } from "./ReportExportDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";

interface RegistrationHealth {
  registrar_id: string;
  registered: boolean;
  health_score?: number;
  last_test_time?: string;
  response_time_ms?: number;
  uptime_percentage?: number;
  test_pass_rate?: number;
  network_quality?: "excellent" | "good" | "fair" | "poor" | "unknown";
}

interface HealthData {
  registrars: RegistrationHealth[];
  metrics: {
    average_response_time?: number;
    test_success_rate?: number;
    last_successful_registration?: string;
    network_quality?: "excellent" | "good" | "fair" | "poor";
  };
  test_history?: Array<{
    timestamp: string;
    success: boolean;
    response_time_ms: number;
    test_type: string;
    registrar_id: string;
  }>;
}

interface RegistrarStatusViewProps {
  registrarId: string;
}

interface TestSuiteRun {
  registrar_id: string;
  tests: TestResult[];
  overall_success: boolean;
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
  _timestamp: string;
}

export function RegistrarStatusView({ registrarId }: RegistrarStatusViewProps) {
  const registrars = useRegistrationStore((s) => s.registrars);
  const testSuites = useRegistrationStore((s) => s.testSuites);
  const bulkResults = useRegistrationStore((s) => s.bulkResults);
  const getTestSuiteResults = useRegistrationStore((s) => s.getTestSuiteResults);
  const { success: notifySuccess, error: notifyError } = useNotifications();
  const registrationHealth = useTroubleshootingStore((s) => s.registrationHealth);
  const refresh = useTroubleshootingStore((s) => s.refresh);
  const loadingHealth = useTroubleshootingStore((s) => s.loadingHealth);

  const healthData = useMemo<HealthData | null>(() => {
    if (!registrationHealth) return null;
    const filtered = registrationHealth.registrars.filter((r) => r.registrar_id === registrarId);
    if (filtered.length === 0) return null;
    return {
      ...registrationHealth,
      registrars: filtered,
      metrics: registrationHealth.metrics,
    } as HealthData;
  }, [registrationHealth, registrarId]);

  const [refreshing, setRefreshing] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [testRuns, setTestRuns] = useState<TestSuiteRun[]>([]);
  const [expandedRunIndex, setExpandedRunIndex] = useState<number | null>(null);
  const [selectedTestDetail, setSelectedTestDetail] = useState<{
    test: any;
    testResult: any;
    runTimestamp: string;
    isFail: boolean;
    isWarn: boolean;
  } | null>(null);

  const prevTestSuitesRef = useRef<unknown>(null);
  const prevBulkResultsRef = useRef<unknown[]>([]);

  const registrar = registrars.find((r) => r.id === registrarId);

  // --- data loading ----------------------------------------------------------
  // Health comes from troubleshooting store (single source of truth). Refresh is triggered by user or after test runs.

  // Refresh health when this registrar's suite or bulk results change (so new test results appear).
  useEffect(() => {
    if (!registrarId) return;
    const suite = testSuites[registrarId];
    const changed = JSON.stringify(suite) !== JSON.stringify(prevTestSuitesRef.current);
    if (changed && suite) {
      prevTestSuitesRef.current = suite;
      const t = setTimeout(() => useTroubleshootingStore.getState().refresh(), 400);
      return () => clearTimeout(t);
    }
  }, [testSuites, registrarId]);

  useEffect(() => {
    const changed = JSON.stringify(bulkResults) !== JSON.stringify(prevBulkResultsRef.current);
    if (!changed || bulkResults.length === 0) return;
    const relevant = bulkResults.some((r: any) => r && r.registrar_id === registrarId);
    if (!relevant) return;
    prevBulkResultsRef.current = bulkResults;
    const t = setTimeout(() => useTroubleshootingStore.getState().refresh(), 800);
    return () => clearTimeout(t);
  }, [bulkResults, registrarId]);

  const loadTestRuns = async () => {
    try {
      const runs = await getTestSuiteResults(registrarId, 50);
      if (runs && Array.isArray(runs) && runs.length > 0) {
        setTestRuns(runs as TestSuiteRun[]);
      } else {
        setTestRuns([]);
      }
    } catch (e) {
      console.error("Failed to load test suite results:", e);
      setTestRuns([]);
    }
  };

  useEffect(() => {
    if (healthData) void loadTestRuns();
  }, [registrarId, healthData != null]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      await loadTestRuns();
    } finally {
      setRefreshing(false);
    }
  };

  const handleClearResults = async () => {
    try {
      const count = await clearTestResults(registrarId);
      notifySuccess(
        "Test Results Cleared",
        `Cleared ${count} test result${count === 1 ? "" : "s"} for this registrar.`,
        { source: "registration" },
      );
      await refresh();
      await loadTestRuns();
    } catch (e) {
      notifyError(
        "Failed to clear results",
        e instanceof Error ? e.message : "Unknown error occurred",
        { source: "registration" },
      );
    }
  };

  // --- guards ----------------------------------------------------------------

  if (loadingHealth) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-10 text-center text-muted-foreground text-sm">
          Loading registration status…
        </CardContent>
      </Card>
    );
  }

  if (!healthData || !registrar) {
    return (
      <EmptyState variant="inline" title="No status data available for this registrar" />
    );
  }

  const h = healthData.registrars[0];

  if (!h) {
    return (
      <EmptyState variant="inline" title="No health data found for this registrar" />
    );
  }

  const formatDate = (value?: string) =>
    value ? formatDateTime(value, { dateStyle: "short", timeStyle: "medium" }) : "Never";

  const testLabel = (id: TestType | string) =>
    TEST_TYPES.find((t) => t.id === id)?.label || id;

  // --- layout: brand‑new unified page ---------------------------------------

  return (
    <div className="space-y-10">
      <header className="tool-header -mx-0 rounded-none">
        <div className="tool-header-inner">
          <h2 className="tool-header-title flex items-center gap-2 min-w-0 truncate">
            <Shield className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="truncate">{registrar.name}</span>
          </h2>
        <div className="flex items-center gap-2">
          <TooltipWrapper entry={tooltips.regRefreshStatus}>
            <Button
              size="sm"
              variant="neutral"
              className="h-8"
              disabled={refreshing}
              onClick={handleRefresh}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </TooltipWrapper>
          <TooltipWrapper entry={tooltips.regClearResults}>
            <Button
              size="sm"
              variant="neutral"
              className="h-8 text-destructive hover:text-destructive"
              onClick={() => setClearConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Clear
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Export" description="Export a detailed status report for this registrar.">
            <Button
              size="sm"
              className="h-8"
              onClick={() => setExportDialogOpen(true)}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export
            </Button>
          </TooltipWrapper>
        </div>
          </div>
      </header>

      {/* Top summary strip */}
      <Card className="shadow-card">
        <CardContent className="py-4 px-4 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "h-16 w-16 rounded-full flex items-center justify-center border-4 text-lg font-bold shadow-card",
                h.health_score != null && h.health_score >= 80
                  ? "border-success text-success"
                  : h.health_score != null && h.health_score >= 60
                  ? "border-warning text-warning"
                  : "border-destructive text-destructive",
              )}
            >
              {h.health_score ?? "–"}
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Registration</span>
                <Badge
                  variant={h.registered ? "success" : "destructive"}
                  className={cn(
                    "px-2 py-0.5 text-xs font-semibold",
                    h.registered
                      ? "bg-success/10 text-success border-success/30"
                      : "",
                  )}
                >
                  {h.registered ? "Registered" : "Not Registered"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Last test: <span className="font-mono">{formatDate(h.last_test_time)}</span>
                </span>
                <span>
                  Avg response:{" "}
                  <span className="font-mono">
                    {h.response_time_ms != null ? `${h.response_time_ms}ms` : "n/a"}
                  </span>
                </span>
                {h.test_pass_rate != null && (
                  <span>
                    Pass rate:{" "}
                    <span className="font-mono">
                      {(h.test_pass_rate * 100).toFixed(0)}%
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <StatusPill
              label="Network quality"
              icon={Network}
              value={
                h.network_quality && h.network_quality !== "unknown"
                  ? h.network_quality.charAt(0).toUpperCase() + h.network_quality.slice(1)
                  : "Unknown"
              }
            />
            {h.uptime_percentage != null && (
              <StatusPill
                label="Uptime"
                icon={CheckCircle2}
                value={`${h.uptime_percentage.toFixed(1)}%`}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Latest Test Run Summary */}
      {testRuns.length > 0 && (() => {
        const latestRun = testRuns[0];
        if (!latestRun) return null;
        const latestTests = latestRun.tests || [];
        const latestFailed = latestTests.filter((t: any) => {
          const testResult = t.result || {};
          return !t.success || !testResult.success || (testResult.status_code >= 400);
        });
        const latestWarnings = latestTests.filter((t: any) => {
          const testResult = t.result || {};
          const isFail = !t.success || !testResult.success || (testResult.status_code >= 400);
          return !isFail && (testResult.error || (testResult.status_code >= 300 && testResult.status_code < 400));
        });
        const latestPassed = latestTests.filter((t: any) => {
          const testResult = t.result || {};
          const isFail = !t.success || !testResult.success || (testResult.status_code >= 400);
          const isWarn = !isFail && (testResult.error || (testResult.status_code >= 300 && testResult.status_code < 400));
          return !isFail && !isWarn;
        });

        return (
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  Latest Test Run
                </CardTitle>
                <span className="text-xs text-muted-foreground font-mono">
                  {formatDate(latestRun._timestamp)}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-lg font-bold">{latestRun.total_tests || latestTests.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Total Tests</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-success/10">
                  <div className="text-lg font-bold text-success">{latestPassed.length}</div>
                  <div className="text-xs text-success mt-1">Passed</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-warning/10">
                  <div className="text-lg font-bold text-warning">{latestWarnings.length}</div>
                  <div className="text-xs text-warning mt-1">Warnings</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-destructive/10">
                  <div className="text-lg font-bold text-destructive">{latestFailed.length}</div>
                  <div className="text-xs text-destructive mt-1">Failed</div>
                </div>
              </div>

              {/* Issues Section - Only show if there are failures or warnings */}
              {(latestFailed.length > 0 || latestWarnings.length > 0) && (
                <div className="space-y-3 pt-2 border-t border-border">
                  {latestFailed.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-destructive" />
                        <span className="text-sm font-semibold text-destructive">
                          Failed Tests ({latestFailed.length})
                        </span>
                      </div>
                      <div className="space-y-1.5 pl-6">
                        {latestFailed.map((t: any, idx: number) => {
                          const testResult = t.result || {};
                          return (
                            <div key={`fail-${idx}`} className="text-xs">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="destructive" className="text-2xs px-1.5 py-0.5">
                                  {testLabel(t.test_type || "unknown")}
                                </Badge>
                                <span className="font-mono">
                                  {testResult.status_code || "—"} {testResult.status_text || ""}
                                </span>
                                {typeof testResult.status_code === "number" && testResult.status_code > 0 && (
                                  <TroubleshootLink sipCode={testResult.status_code} compact />
                                )}
                                {typeof testResult.status_code === "string" && !Number.isNaN(parseInt(testResult.status_code, 10)) && (
                                  <TroubleshootLink sipCode={parseInt(testResult.status_code, 10)} compact />
                                )}
                              </div>
                              {testResult.error && (
                                <div className="mt-1 text-2xs text-muted-foreground pl-0.5">
                                  {testResult.error}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {latestWarnings.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        <span className="text-sm font-semibold text-warning-foreground">
                          Warnings ({latestWarnings.length})
                        </span>
                      </div>
                      <div className="space-y-1.5 pl-6">
                        {latestWarnings.map((t: any, idx: number) => {
                          const testResult = t.result || {};
                          return (
                            <div key={`warn-${idx}`} className="text-xs">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge
                                  variant="outline"
                                  className="text-2xs px-1.5 py-0.5 border-warning/50 text-warning-foreground"
                                >
                                  {testLabel(t.test_type || "unknown")}
                                </Badge>
                                <span className="font-mono">
                                  {testResult.status_code || "—"} {testResult.status_text || ""}
                                </span>
                                {typeof testResult.status_code === "number" && testResult.status_code > 0 && (
                                  <TroubleshootLink sipCode={testResult.status_code} compact />
                                )}
                                {typeof testResult.status_code === "string" && !Number.isNaN(parseInt(testResult.status_code, 10)) && (
                                  <TroubleshootLink sipCode={parseInt(testResult.status_code, 10)} compact />
                                )}
                              </div>
                              {testResult.error && (
                                <div className="mt-1 text-2xs text-muted-foreground pl-0.5">
                                  {testResult.error}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Success Message */}
              {latestFailed.length === 0 && latestWarnings.length === 0 && (
                <div className="flex items-start gap-2 pt-2 border-t border-border">
                  <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-success">All tests passed</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      All {latestPassed.length} test{latestPassed.length !== 1 ? "s" : ""} completed successfully with no issues.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Empty State - No test runs */}
      {testRuns.length === 0 && (
        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Test Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState variant="inline" icon={<Shield />} title="No test runs yet" description="Run a test suite from the Test Tools to see results here." />
          </CardContent>
        </Card>
      )}

      {/* Unified Test Runs - each run is a single entry */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Test Runs
            </CardTitle>
            {testRuns.length > 0 && (
              <TooltipWrapper entry={tooltips.regClearResultsShort}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setClearConfirmOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Clear All
                </Button>
              </TooltipWrapper>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {testRuns.length === 0 ? (
            <EmptyState compact variant="inline" title="No test runs recorded yet" description="Run a test suite to see results here." />
          ) : (
            <div className="space-y-3">
              {testRuns.map((run: any, idx) => {
                const isExpanded = expandedRunIndex === idx;
                const totalTests = run.total_tests || (run.tests?.length || 0);
                const passedTests = run.passed_tests || 0;
                const failedTests = run.failed_tests || 0;
                const overallSuccess = run.overall_success ?? false;
                const tests = run.tests || [];
                const timestamp = run._timestamp || "";
                
                const passRate = totalTests > 0 
                  ? (passedTests / totalTests) * 100 
                  : 0;
                const avgResponseTime = tests.length > 0
                  ? tests.reduce((sum: number, t: any) => sum + ((t.result?.response_time_ms) || 0), 0) / tests.length
                  : 0;
                
                return (
                  <div
                    key={`${timestamp}-${idx}`}
                    className={cn(
                      "rounded-lg bg-card shadow-card overflow-hidden transition-smooth",
                      !overallSuccess && "bg-destructive/5",
                      isExpanded && "ring-2 ring-foreground/20"
                    )}
                  >
                    <TooltipWrapper title={isExpanded ? "Collapse run" : "Expand run"} description={isExpanded ? "Hide test details for this run." : "Show test details for this run."}>
                    <button
                      type="button"
                      onClick={() => setExpandedRunIndex(isExpanded ? null : idx)}
                      className="w-full text-left"
                    >
                      <div className="px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-smooth rounded-lg">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <TooltipWrapper entry={overallSuccess ? tooltips.regAllPassed : tooltips.regSomeFailed(failedTests)}>
                            <div className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center border-2 flex-shrink-0",
                              overallSuccess
                                ? "border-success text-success bg-success/10"
                                : "border-destructive text-destructive bg-destructive/10"
                            )}>
                              {overallSuccess ? (
                                <CheckCircle2 className="h-5 w-5" />
                              ) : (
                                <XCircle className="h-5 w-5" />
                              )}
                            </div>
                          </TooltipWrapper>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <TooltipWrapper title="Test run timestamp" description="When this test run was executed.">
                                <span className="font-mono text-xs text-muted-foreground">
                                  {formatDate(timestamp)}
                                </span>
                              </TooltipWrapper>
                              <TooltipWrapper entry={overallSuccess ? tooltips.regAllPassed : tooltips.regSomeFailed(failedTests)}>
                                <Badge
                                  variant={overallSuccess ? "success" : "destructive"}
                                  className={cn(
                                    "text-2xs px-1.5 py-0.5",
                                    overallSuccess
                                      ? "bg-success/10 text-success border-success/30"
                                      : ""
                                  )}
                                >
                                  {overallSuccess ? "All Passed" : `${failedTests} Failed`}
                                </Badge>
                              </TooltipWrapper>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <TooltipWrapper entry={{ title: "Total tests", description: "Number of tests in this run" }}>
                                <span>
                                  <span className="font-semibold text-foreground">{totalTests}</span> tests
                                </span>
                              </TooltipWrapper>
                              <TooltipWrapper entry={{ title: "Passed tests", description: "Tests that completed successfully" }}>
                                <span>
                                  <span className="font-semibold text-success">{passedTests}</span> passed
                                </span>
                              </TooltipWrapper>
                              {failedTests > 0 && (
                                <TooltipWrapper entry={{ title: "Failed tests", description: "Tests that did not pass" }}>
                                  <span>
                                    <span className="font-semibold text-destructive">{failedTests}</span> failed
                                  </span>
                                </TooltipWrapper>
                              )}
                              {avgResponseTime > 0 && (
                                <TooltipWrapper entry={tooltips.regTestResponseTime}>
                                  <span>
                                    Avg: <span className="font-mono">{Math.round(avgResponseTime)}ms</span>
                                  </span>
                                </TooltipWrapper>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <TooltipWrapper entry={tooltips.regPassRate}>
                            <div className="text-xs text-muted-foreground">
                              {passRate.toFixed(0)}%
                            </div>
                          </TooltipWrapper>
                          <TooltipWrapper entry={tooltips.regPassRate} title={`${passRate.toFixed(1)}% pass rate`}>
                            <div className={cn(
                              "h-2 w-16 rounded-full bg-muted overflow-hidden",
                              overallSuccess && "bg-success/20"
                            )}>
                              <div
                                className={cn(
                                  "h-full transition-smooth",
                                  overallSuccess ? "bg-success" : "bg-destructive"
                                )}
                                style={{ width: `${passRate}%` }}
                              />
                            </div>
                          </TooltipWrapper>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </button>
                    </TooltipWrapper>
                    
                    {isExpanded && (
                      <div className="surface-subtle border-t border-border px-4 py-3">
                        <div className="space-y-3">
                          <div className="grid grid-cols-5 bg-muted/40 px-3 py-2 text-2xs font-semibold text-muted-foreground rounded-lg">
                            <TooltipWrapper entry={tooltips.regTestType}>
                              <div>Test</div>
                            </TooltipWrapper>
                            <TooltipWrapper entry={tooltips.commonClickForDetails}>
                              <div>Status</div>
                            </TooltipWrapper>
                            <TooltipWrapper entry={tooltips.regTestCode}>
                              <div>Code</div>
                            </TooltipWrapper>
                            <TooltipWrapper entry={tooltips.regTestResponseTime}>
                              <div>Response</div>
                            </TooltipWrapper>
                            <TooltipWrapper entry={tooltips.regTestNotes}>
                              <div>Notes</div>
                            </TooltipWrapper>
                          </div>
                          <div className="space-y-1">
                            {tests.map((t: any, testIdx: number) => {
                              const testResult = t.result || {};
                              const isFail =
                                !t.success || !testResult.success || (testResult.status_code >= 400);
                              const isWarn =
                                !isFail &&
                                (testResult.error ||
                                  (testResult.status_code >= 300 && testResult.status_code < 400));
                              return (
                                <div
                                  key={`${t.test_type || testIdx}-${testIdx}`}
                                  className={cn(
                                    "grid grid-cols-5 px-3 py-2 text-2xs items-center rounded-lg",
                                    isFail && "bg-destructive/5",
                                    isWarn && "bg-warning/5",
                                  )}
                                >
                                  <TooltipWrapper entry={tooltips.regTestType}>
                                    <div className="pr-2 truncate">{testLabel(t.test_type || "unknown")}</div>
                                  </TooltipWrapper>
                                  <TooltipWrapper
                                    title={isFail ? "Failed" : isWarn ? "Warning" : "Passed"}
                                    description="Click to view full test result details."
                                  >
                                    <button
                                      type="button"
                                      onClick={() => setSelectedTestDetail({
                                        test: t,
                                        testResult,
                                        runTimestamp: timestamp,
                                        isFail,
                                        isWarn,
                                      })}
                                      className="pr-2 flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                                    >
                                      {isFail ? (
                                        <>
                                          <XCircle className="h-3 w-3 text-destructive" />
                                          <span className="text-destructive font-medium">Failed</span>
                                        </>
                                      ) : isWarn ? (
                                        <>
                                          <AlertTriangle className="h-3 w-3 text-warning" />
                                          <span className="text-warning-foreground font-medium">Warning</span>
                                        </>
                                      ) : (
                                        <>
                                          <CheckCircle2 className="h-3 w-3 text-success" />
                                          <span className="text-success font-medium">Passed</span>
                                        </>
                                      )}
                                    </button>
                                  </TooltipWrapper>
                                  <TooltipWrapper entry={{ ...tooltips.regTestCode, title: "HTTP/SIP status code" }}>
                                    <div className="pr-2 flex items-center gap-1.5 font-mono text-xs">
                                      <span>{testResult.status_code || "—"} {testResult.status_text || ""}</span>
                                      {typeof testResult.status_code === "number" && testResult.status_code > 0 && (
                                        <TroubleshootLink sipCode={testResult.status_code} compact />
                                      )}
                                      {typeof testResult.status_code === "string" && !Number.isNaN(parseInt(testResult.status_code, 10)) && (
                                        <TroubleshootLink sipCode={parseInt(testResult.status_code, 10)} compact />
                                      )}
                                    </div>
                                  </TooltipWrapper>
                                  <TooltipWrapper entry={tooltips.regTestResponseTime}>
                                    <div className="pr-2 font-mono text-xs">
                                      {testResult.response_time_ms != null
                                        ? `${testResult.response_time_ms}ms`
                                        : "—"}
                                    </div>
                                  </TooltipWrapper>
                                  <TooltipWrapper entry={tooltips.commonClickForDetails}>
                                    <div className="pr-2 truncate text-2xs text-muted-foreground">
                                      {testResult.error
                                      ? testResult.error
                                      : isFail
                                      ? "Server returned error status"
                                      : isWarn
                                      ? "Non‑ideal but acceptable response"
                                      : "OK"}
                                    </div>
                                  </TooltipWrapper>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export + clear dialogs */}
      <ReportExportDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        registrarIds={[registrarId]}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="Clear Test Results"
        description={`This will remove all stored test results and history for "${registrar.name}". This cannot be undone.`}
        confirmText="Clear all results"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleClearResults}
      />
      
      {/* Test Result Detail Modal */}
      <Dialog open={selectedTestDetail !== null} onOpenChange={(open) => !open && setSelectedTestDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[calc(min(100vh,100dvh)-2rem)] overflow-y-auto">
          {selectedTestDetail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedTestDetail.isFail ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : selectedTestDetail.isWarn ? (
                    <AlertTriangle className="h-5 w-5 text-warning" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  )}
                  <span>{testLabel(selectedTestDetail.test.test_type || "unknown")} Test Result</span>
                </DialogTitle>
                <DialogDescription>
                  Test run at {formatDateTime(selectedTestDetail.runTimestamp)}
                </DialogDescription>
              </DialogHeader>
              
              
              <div className="space-y-4 mt-4">
                {/* Status Explanation */}
                <div className={cn(
                  "p-4 rounded-lg border",
                  selectedTestDetail.isFail && "bg-destructive/10 border-destructive/30",
                  selectedTestDetail.isWarn && "bg-warning/10 border-warning/30",
                  !selectedTestDetail.isFail && !selectedTestDetail.isWarn && "bg-success/10 border-success/30"
                )}>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    What does this status mean?
                  </h3>
                  {selectedTestDetail.isFail ? (
                    <div className="space-y-2 text-sm">
                      <p className="font-medium text-destructive">Failed</p>
                      <p className="text-muted-foreground">
                        This test failed, indicating a problem with the registration or server response. 
                        Common causes include:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                        <li>Server returned an error status code (4xx or 5xx)</li>
                        <li>Request was rejected or timed out</li>
                        <li>Authentication or authorization failed</li>
                        <li>Server configuration issues</li>
                        <li>Network connectivity problems</li>
                      </ul>
                      <p className="text-muted-foreground mt-2">
                        Check the status code, error message, and response details below to diagnose the issue.
                      </p>
                    </div>
                  ) : selectedTestDetail.isWarn ? (
                    <div className="space-y-2 text-sm">
                      <p className="font-medium text-warning-foreground">Warning</p>
                      <p className="text-muted-foreground">
                        This test passed but with warnings, indicating non-critical issues that may need attention:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                        <li>Server returned a redirect or non-standard success code (3xx)</li>
                        <li>Response was successful but slower than expected</li>
                        <li>Non-critical errors or warnings in the response</li>
                        <li>Unexpected but acceptable behavior</li>
                      </ul>
                      <p className="text-muted-foreground mt-2">
                        While the test technically passed, review the details below to ensure everything is configured correctly.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <p className="font-medium text-success">Passed</p>
                      <p className="text-muted-foreground">
                        This test passed successfully, indicating:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                        <li>Server responded with a success status code (typically 200)</li>
                        <li>Request was processed correctly</li>
                        <li>No errors or warnings detected</li>
                        <li>Response time was within acceptable limits</li>
                      </ul>
                      <p className="text-muted-foreground mt-2">
                        The registration test completed as expected. See details below for response information.
                      </p>
                    </div>
                  )}
                </div>

                {/* Test Details */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm">Test Details</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Test Type</p>
                      <p className="text-sm font-medium">{testLabel(selectedTestDetail.test.test_type || "unknown")}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Test Type ID</p>
                      <p className="text-sm font-mono text-xs">{selectedTestDetail.test.test_type || "unknown"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Status Code</p>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-mono">
                          {selectedTestDetail.testResult.status_code || "—"} {selectedTestDetail.testResult.status_text || ""}
                        </p>
                        {typeof selectedTestDetail.testResult.status_code === "number" && selectedTestDetail.testResult.status_code > 0 && (
                          <TroubleshootLink sipCode={selectedTestDetail.testResult.status_code} compact />
                        )}
                        {typeof selectedTestDetail.testResult.status_code === "string" && !Number.isNaN(parseInt(selectedTestDetail.testResult.status_code, 10)) && (
                          <TroubleshootLink sipCode={parseInt(selectedTestDetail.testResult.status_code, 10)} compact />
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Response Time</p>
                      <p className="text-sm font-mono">
                        {selectedTestDetail.testResult.response_time_ms != null
                          ? `${selectedTestDetail.testResult.response_time_ms}ms`
                          : "Not available"}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Test Success</p>
                      <p className="text-sm">
                        {selectedTestDetail.test.success ? "Yes" : "No"}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Result Success</p>
                      <p className="text-sm">
                        {selectedTestDetail.testResult.success ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>

                  {(selectedTestDetail.testResult.error || selectedTestDetail.testResult.message) && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Error / Message</p>
                      <div className={cn(
                        "p-3 rounded-lg text-sm font-mono",
                        selectedTestDetail.testResult.error
                          ? "bg-destructive/10 text-destructive border border-destructive/30"
                          : "bg-muted"
                      )}>
                        {selectedTestDetail.testResult.error || selectedTestDetail.testResult.message}
                      </div>
                    </div>
                  )}

                  {selectedTestDetail.testResult.status_code && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Status Code Explanation</p>
                      <div className="p-3 rounded-lg bg-muted text-sm">
                        {selectedTestDetail.testResult.status_code >= 200 && selectedTestDetail.testResult.status_code < 300 && (
                          <p>2xx status codes indicate success. The request was processed successfully.</p>
                        )}
                        {selectedTestDetail.testResult.status_code >= 300 && selectedTestDetail.testResult.status_code < 400 && (
                          <p>3xx status codes indicate redirection. The request was redirected to another location.</p>
                        )}
                        {selectedTestDetail.testResult.status_code >= 400 && selectedTestDetail.testResult.status_code < 500 && (
                          <p>4xx status codes indicate client errors. The request was invalid or unauthorized.</p>
                        )}
                        {selectedTestDetail.testResult.status_code >= 500 && (
                          <p>5xx status codes indicate server errors. The server encountered an error processing the request.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedTestDetail.testResult.expires != null && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Expires Header</p>
                      <p className="text-sm font-mono">
                        {selectedTestDetail.testResult.expires} seconds
                      </p>
                    </div>
                  )}
                </div>

                {/* Request/Response Messages */}
                {(selectedTestDetail.testResult.request_message || selectedTestDetail.testResult.response_message) && (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm">Request & Response Messages</h3>
                    
                    {selectedTestDetail.testResult.request_message && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">Request Message (Sent)</p>
                          <CopyTextButton text={selectedTestDetail.testResult.request_message} label="Copy request" />
                        </div>
                        <div className="surface-subtle p-3">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-60 overflow-y-auto">
                            {selectedTestDetail.testResult.request_message}
                          </pre>
                        </div>
                      </div>
                    )}

                    {selectedTestDetail.testResult.response_message && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">Response Message (Received)</p>
                          <CopyTextButton text={selectedTestDetail.testResult.response_message} label="Copy response" />
                        </div>
                        <div className={cn(
                          "p-3 rounded-lg border font-mono text-xs whitespace-pre-wrap break-words overflow-x-auto max-h-60 overflow-y-auto",
                          selectedTestDetail.isFail
                            ? "bg-destructive/5 border-destructive/30"
                            : selectedTestDetail.isWarn
                            ? "bg-warning/5 border-warning/30"
                            : "bg-success/5 border-success/30"
                        )}>
                          {selectedTestDetail.testResult.response_message}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Diagnostics */}
                {selectedTestDetail.test.diagnostics && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm">Diagnostics</h3>
                      <CopyTextButton
                        text={JSON.stringify(selectedTestDetail.test.diagnostics, null, 2)}
                        label="Copy diagnostics JSON"
                      />
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-60 overflow-y-auto">
                        {JSON.stringify(selectedTestDetail.test.diagnostics, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* All Backing Data */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm">Complete Backing Data</h3>
                  
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth mb-2 flex items-center justify-between gap-2">
                      View Test Result Object (JSON)
                      <CopyTextButton
                        text={JSON.stringify(selectedTestDetail.testResult, null, 2)}
                        label="Copy test result JSON"
                        className="opacity-0 group-open:opacity-100"
                      />
                    </summary>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <pre className="text-2xs font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-96 overflow-y-auto">
                        {JSON.stringify(selectedTestDetail.testResult, null, 2)}
                      </pre>
                    </div>
                  </details>

                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth mb-2 flex items-center justify-between gap-2">
                      View Complete Test Object (JSON)
                      <CopyTextButton
                        text={JSON.stringify(selectedTestDetail.test, null, 2)}
                        label="Copy test object JSON"
                        className="opacity-0 group-open:opacity-100"
                      />
                    </summary>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <pre className="text-2xs font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-96 overflow-y-auto">
                        {JSON.stringify(selectedTestDetail.test, null, 2)}
                      </pre>
                    </div>
                  </details>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface StatusPillProps {
  label: string;
  value: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

function StatusPill({ label, value, icon: Icon }: StatusPillProps) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-muted/40 border border-border/30 shadow-card text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground truncate max-w-[120px]">{value}</span>
    </div>
  );
}
