import { Card, CardContent } from "@/components/ui/card";
import { Activity, Clock, CheckCircle2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { formatDateTime } from "@/lib/dateTime";

export interface HealthMetricsData {
  averageResponseTime?: number;
  testSuccessRate?: number;
  lastSuccessfulRegistration?: string;
  networkQuality?: "excellent" | "good" | "fair" | "poor";
  totalRegistrars?: number;
  registeredCount?: number;
}

interface HealthMetricsProps {
  metrics: HealthMetricsData;
}

export function HealthMetrics({ metrics }: HealthMetricsProps) {
  const {
    averageResponseTime,
    testSuccessRate,
    lastSuccessfulRegistration,
    networkQuality,
    totalRegistrars,
    registeredCount,
  } = metrics;

  const getNetworkQualityColor = (quality?: string) => {
    switch (quality) {
      case "excellent": return "text-success";
      case "good": return "text-foreground";
      case "fair": return "text-warning";
      case "poor": return "text-destructive";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {averageResponseTime !== undefined && (
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <TooltipWrapper entry={tooltips.regAvgResponseTime}>
                  <p className="section-label-sm cursor-help">Avg Response Time</p>
                </TooltipWrapper>
                <p className="text-2xl font-bold mt-1">{averageResponseTime}ms</p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      )}

      {testSuccessRate !== undefined && (
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <TooltipWrapper entry={tooltips.regPassRate}>
                  <p className="section-label-sm cursor-help">Test Success Rate</p>
                </TooltipWrapper>
                <p className="text-2xl font-bold mt-1">{(testSuccessRate * 100).toFixed(1)}%</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
      )}

      {networkQuality && (
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <TooltipWrapper entry={tooltips.regNetworkQuality}>
                  <p className="section-label-sm cursor-help">Network Quality</p>
                </TooltipWrapper>
                <p className={cn("text-2xl font-bold mt-1 capitalize", getNetworkQualityColor(networkQuality))}>
                  {networkQuality}
                </p>
              </div>
              <Activity className={cn("h-8 w-8", getNetworkQualityColor(networkQuality))} />
            </div>
          </CardContent>
        </Card>
      )}


      {totalRegistrars !== undefined && registeredCount !== undefined && (
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <TooltipWrapper entry={tooltips.regRegistrationStatus}>
                  <p className="section-label-sm cursor-help">Registration Status</p>
                </TooltipWrapper>
                <p className="text-2xl font-bold mt-1">
                  {registeredCount}/{totalRegistrars}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {((registeredCount / totalRegistrars) * 100).toFixed(0)}% registered
                </p>
              </div>
              <Activity className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      )}

      {lastSuccessfulRegistration && (
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <TooltipWrapper entry={tooltips.regLastSuccess}>
                  <p className="section-label-sm cursor-help">Last Success</p>
                </TooltipWrapper>
                <p className="text-sm font-medium mt-1">
                  {formatDateTime(lastSuccessfulRegistration)}
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
