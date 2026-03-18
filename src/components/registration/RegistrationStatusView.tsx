import { useState, useEffect, useRef } from "react";
import { StatusSummary, type StatusSummaryData } from "./StatusSummary";
import { TestStatusGrid, type TestTypeStatus } from "./TestStatusGrid";
import { RecentTestResults, type RecentTestResult } from "./RecentTestResults";
import { TestHistoryGraph } from "./TestHistoryGraph";
import { TestTypeBreakdownGraph } from "./TestTypeBreakdownGraph";
import { ReportExportDialog } from "./ReportExportDialog";
import { TEST_TYPES } from "@/types/registration";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { navigateTo } from "@/lib/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { EmptyState } from "@/components/ui/empty-state";

export function RegistrationStatusView() {
  const testSuites = useRegistrationStore((s) => s.testSuites);
  const bulkResults = useRegistrationStore((s) => s.bulkResults);
  const setSelectedRegistrar = useRegistrationStore((s) => s.setSelectedRegistrar);
  const registrationHealth = useTroubleshootingStore((s) => s.registrationHealth);
  const refresh = useTroubleshootingStore((s) => s.refresh);
  const loadingHealth = useTroubleshootingStore((s) => s.loadingHealth);
  const [refreshing, setRefreshing] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedTestType, setSelectedTestType] = useState<string | null>(null);
  const prevTestSuitesRef = useRef<Record<string, unknown>>({});
  const prevBulkResultsRef = useRef<unknown[]>([]);

  // Auto-refresh health when test suites or bulk results change (single source: store refresh).
  useEffect(() => {
    const testSuitesChanged = JSON.stringify(testSuites) !== JSON.stringify(prevTestSuitesRef.current);
    if (testSuitesChanged && Object.keys(testSuites).length > 0) {
      prevTestSuitesRef.current = testSuites;
      const timeoutId = setTimeout(() => useTroubleshootingStore.getState().refresh(), 500);
      return () => clearTimeout(timeoutId);
    }
  }, [testSuites]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const bulkResultsChanged = JSON.stringify(bulkResults) !== JSON.stringify(prevBulkResultsRef.current);
    if (bulkResultsChanged && bulkResults.length > 0) {
      prevBulkResultsRef.current = bulkResults;
      const timeoutId = setTimeout(() => useTroubleshootingStore.getState().refresh(), 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [bulkResults]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const healthData = registrationHealth;

  const handleTestTypeClick = (testType: string) => {
    setSelectedTestType(testType === selectedTestType ? null : testType);
  };

  const handleResultClick = (result: RecentTestResult) => {
    // Apply test-type filter and jump directly to the selected registrar detail view.
    setSelectedTestType(result.test_type);
    setSelectedRegistrar(result.registrar_id);
    navigateTo("registration");
  };

  if (loadingHealth && !healthData) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p className="text-sm">Loading status data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!healthData) {
    return (
      <EmptyState variant="inline" title="No status data available" />
    );
  }

  // Calculate summary data
  const registeredCount = healthData.registrars.filter((r) => r.registered).length;
  const overallHealthScore = healthData.registrars.length > 0
    ? Math.round(healthData.registrars.reduce((sum, r) => sum + (r.health_score ?? 0), 0) / healthData.registrars.length)
    : 0;

  const summaryData: StatusSummaryData = {
    overallHealthScore,
    registeredCount,
    totalRegistrars: healthData.registrars.length,
    averageResponseTime: healthData.metrics.average_response_time ?? undefined,
    networkQuality: healthData.metrics.network_quality === "unknown" ? undefined : (healthData.metrics.network_quality as StatusSummaryData["networkQuality"]),
    lastSuccessfulRegistration: healthData.metrics.last_successful_registration ?? undefined,
  };

  // Filter recent results by selected test type
  const filteredRecentResults = selectedTestType
    ? (healthData.recent_results || []).filter(r => r.test_type === selectedTestType)
    : (healthData.recent_results || []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Status</h2>
          <p className="text-sm text-muted-foreground mt-1">Test status and health overview</p>
        </div>
        <div className="flex items-center gap-2">
          <TooltipWrapper entry={tooltips.regRefreshStatus}>
            <Button 
              onClick={handleRefresh} 
              disabled={refreshing || loadingHealth}
              variant="neutral"
              size="sm" 
              className="h-9"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </TooltipWrapper>
          <TooltipWrapper entry={tooltips.regExportReport}>
            <Button onClick={() => setExportDialogOpen(true)} size="sm" className="h-9">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </TooltipWrapper>
        </div>
      </div>

      {/* Status Summary */}
      <StatusSummary data={summaryData} />

      {/* Test Status Grid */}
      <div>
        <h3 className="text-xl font-bold mb-4">Test Status</h3>
        <TestStatusGrid
          testTypeStatuses={(healthData as { test_type_status?: TestTypeStatus[] }).test_type_status ?? []}
          onTestTypeClick={handleTestTypeClick}
        />
        {selectedTestType && (
          <div className="mt-4 text-sm text-muted-foreground">
            Showing results for: <span className="font-semibold text-foreground">
              {TEST_TYPES.find(t => t.id === selectedTestType)?.label || selectedTestType}
            </span>
          </div>
        )}
      </div>

      {/* Recent Results and Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentTestResults
          results={filteredRecentResults}
          onResultClick={handleResultClick}
          maxResults={15}
        />
        <TestTypeBreakdownGraph
          testTypeStatuses={(healthData as { test_type_status?: TestTypeStatus[] }).test_type_status ?? []}
        />
      </div>

      {/* Test History Graph */}
      {healthData.time_series_data && healthData.time_series_data.length > 0 && (
        <TestHistoryGraph
          data={healthData.time_series_data}
          title="Test History"
        />
      )}

      {/* Export Dialog */}
      <ReportExportDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
      />
    </div>
  );
}
