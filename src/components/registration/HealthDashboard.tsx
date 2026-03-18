import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RegistrarHealthCard, type RegistrarHealth } from "./RegistrarHealthCard";
import { HealthMetrics, type HealthMetricsData } from "./HealthMetrics";
import { TestHistoryChart, type TestHistoryDataPoint } from "./TestHistoryChart";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { EmptyState } from "@/components/ui/empty-state";

interface HealthDashboardProps {
  registrarHealths: RegistrarHealth[];
  metrics: HealthMetricsData;
  testHistory?: TestHistoryDataPoint[];
}

export function HealthDashboard({ registrarHealths, metrics, testHistory = [] }: HealthDashboardProps) {
  const sortedHealths = useMemo(() => {
    return [...registrarHealths].sort((a, b) => b.healthScore - a.healthScore);
  }, [registrarHealths]);

  const overallHealthScore = useMemo(() => {
    if (registrarHealths.length === 0) return 0;
    const sum = registrarHealths.reduce((acc, h) => acc + h.healthScore, 0);
    return Math.round(sum / registrarHealths.length);
  }, [registrarHealths]);

  const registeredCount = useMemo(() => {
    return registrarHealths.filter((h) => h.registered).length;
  }, [registrarHealths]);

  const aggregatedMetrics: HealthMetricsData = {
    ...metrics,
    totalRegistrars: registrarHealths.length,
    registeredCount,
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-warning";
    return "text-destructive";
  };

  const getHealthBgColor = (score: number) => {
    if (score >= 80) return "bg-success/10 border-success/20";
    if (score >= 60) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const registrationPercentage = registrarHealths.length > 0 
    ? (registeredCount / registrarHealths.length) * 100 
    : 0;

  return (
    <div className="space-y-6">
      {/* Overall Health Score - Redesigned */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Overall System Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-8">
            <div className={cn(
              "text-center p-6 rounded-lg border-2",
              getHealthBgColor(overallHealthScore)
            )}>
              <TooltipWrapper entry={tooltips.regHealthScore}>
                <div className={cn("text-6xl font-bold cursor-help", getHealthColor(overallHealthScore))}>
                  {overallHealthScore}
                </div>
              </TooltipWrapper>
              <TooltipWrapper entry={tooltips.regHealthScore}>
                <p className="text-sm font-semibold text-muted-foreground mt-2 cursor-help">Health Score</p>
              </TooltipWrapper>
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <TooltipWrapper entry={tooltips.regRegistrationStatus}>
                    <span className="text-sm font-semibold cursor-help">Registration Status</span>
                  </TooltipWrapper>
                  <span className="text-sm font-bold">{registeredCount} / {registrarHealths.length}</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden border">
                  <div
                    className={cn(
                      "h-full transition-all duration-[var(--motion-duration-attention)] [transition-timing-function:var(--motion-ease-overlay)]",
                      registrationPercentage >= 80 ? "bg-success" :
                      registrationPercentage >= 50 ? "bg-warning" : "bg-destructive"
                    )}
                    style={{ width: `${registrationPercentage}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {registrationPercentage.toFixed(1)}% of registrars are registered
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <HealthMetrics metrics={aggregatedMetrics} />

      {/* Registrar Health Cards */}
      <div>
        <h3 className="text-base font-semibold mb-4">Registrar Health</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {sortedHealths.map((health) => (
            <RegistrarHealthCard key={health.registrar.id} health={health} />
          ))}
        </div>
        {sortedHealths.length === 0 && (
          <EmptyState variant="inline" title="No registrars available" description="Add a registrar to start monitoring" />
        )}
      </div>

      {/* Test History Chart */}
      {testHistory.length > 0 && (
        <div>
          <h3 className="text-base font-semibold mb-4">Test History</h3>
          <TestHistoryChart data={testHistory} />
        </div>
      )}
    </div>
  );
}
