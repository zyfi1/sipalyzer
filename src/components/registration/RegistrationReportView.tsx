import { useState, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HealthDashboard } from "./HealthDashboard";
import { type RegistrarHealth } from "./RegistrarHealthCard";
import { type HealthMetricsData } from "./HealthMetrics";
import { type TestHistoryDataPoint } from "./TestHistoryChart";
import { RegistrarHealthCard } from "./RegistrarHealthCard";
import { ReportExportDialog } from "./ReportExportDialog";
import { TestHistoryChart } from "./TestHistoryChart";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { EmptyState } from "@/components/ui/empty-state";

export function RegistrationReportView() {
  const registrars = useRegistrationStore((s) => s.registrars);
  const testSuites = useRegistrationStore((s) => s.testSuites);
  const bulkResults = useRegistrationStore((s) => s.bulkResults);
  const registrationHealth = useTroubleshootingStore((s) => s.registrationHealth);
  const refresh = useTroubleshootingStore((s) => s.refresh);
  const loadingHealth = useTroubleshootingStore((s) => s.loadingHealth);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRegistrarId, setSelectedRegistrarId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
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

  if (loadingHealth && !healthData) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading health data...
        </CardContent>
      </Card>
    );
  }

  if (!healthData) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-12">
          <EmptyState compact variant="inline" title="No health data available" />
        </CardContent>
      </Card>
    );
  }

  // Map health data to component format
  const registrarHealths: RegistrarHealth[] = healthData.registrars
    .map((h) => {
      const registrar = registrars.find((r) => r.id === h.registrar_id);
      if (!registrar) {
        return null;
      }
      const health: RegistrarHealth = {
        registrar,
        registered: h.registered,
        healthScore: h.health_score ?? 0,
        lastTestTime: h.last_test_time ?? undefined,
        responseTimeMs: h.response_time_ms ?? undefined,
        uptimePercentage: h.uptime_percentage ?? undefined,
        testPassRate: h.test_pass_rate ?? undefined,
        networkQuality: h.network_quality === "unknown" ? undefined : h.network_quality,
      };
      return health;
    })
    .filter((h): h is RegistrarHealth => h !== null);

  const metrics: HealthMetricsData = {
    averageResponseTime: healthData.metrics?.average_response_time ?? undefined,
    testSuccessRate: healthData.metrics?.test_success_rate ?? undefined,
    lastSuccessfulRegistration: healthData.metrics?.last_successful_registration ?? undefined,
    networkQuality: healthData.metrics?.network_quality === "unknown" ? undefined : (healthData.metrics?.network_quality as HealthMetricsData["networkQuality"]),
  };

  const testHistory: TestHistoryDataPoint[] = (healthData.test_history ?? []).map((h) => ({
    timestamp: h.timestamp,
    success: h.success,
    responseTimeMs: h.response_time_ms,
    testType: h.test_type,
  }));

  const selectedHealth = selectedRegistrarId
    ? registrarHealths.find((h) => h.registrar.id === selectedRegistrarId)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Registration Reports</h2>
          <p className="text-xs text-muted-foreground mt-1">Monitor and analyze registration health across all registrars</p>
        </div>
        <div className="flex items-center gap-2">
          <TooltipWrapper title="Refresh health data" description="Re-load registration health from stored results">
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
          <TooltipWrapper entry={tooltips.regExportHealth}>
            <Button onClick={() => setExportDialogOpen(true)} size="sm" className="h-9">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </TooltipWrapper>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="subview-tabs-compact">
          <TabsTrigger value="overview" className="subview-tab-compact">Overview</TabsTrigger>
          <TabsTrigger value="single" className="subview-tab-compact">Single Registrar</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <HealthDashboard
            registrarHealths={registrarHealths}
            metrics={metrics}
            testHistory={testHistory}
          />
        </TabsContent>

        <TabsContent value="single" className="space-y-6">
          <div>
            <label className="section-label-sm mb-2.5 block">Select Registrar</label>
            <select
              value={selectedRegistrarId || ""}
              onChange={(e) => setSelectedRegistrarId(e.target.value || null)}
              className="w-full max-w-md px-4 py-2.5 bg-background border-2 border-input rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-transparent transition-smooth"
            >
              <option value="">-- Select a registrar --</option>
              {registrars.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.domain})
                </option>
              ))}
            </select>
          </div>

          {selectedHealth ? (
            <div className="space-y-4">
              <RegistrarHealthCard health={selectedHealth} />
              {testHistory.filter(() => {
                const registrar = registrars.find((r) => r.id === selectedRegistrarId);
                return registrar; // Filter by registrar if needed
              }).length > 0 && (
                <TestHistoryChart
                  data={testHistory.filter(() => {
                    // Filter test history for selected registrar
                    return true; // For now, show all
                  })}
                  title={`Test History - ${selectedHealth.registrar.name}`}
                />
              )}
            </div>
          ) : (
            <EmptyState variant="inline" title="Select a registrar to view detailed health information" />
          )}
        </TabsContent>
      </Tabs>

      <ReportExportDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        registrarIds={selectedRegistrarId ? [selectedRegistrarId] : undefined}
      />
    </div>
  );
}
