import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Activity, Zap, Clock } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

export interface StatusSummaryData {
  overallHealthScore: number;
  registeredCount: number;
  totalRegistrars: number;
  averageResponseTime?: number;
  networkQuality?: "excellent" | "good" | "fair" | "poor";
  lastSuccessfulRegistration?: string;
}

interface StatusSummaryProps {
  data: StatusSummaryData;
}

export function StatusSummary({ data }: StatusSummaryProps) {
  const {
    registeredCount,
    totalRegistrars,
    averageResponseTime,
    networkQuality,
    lastSuccessfulRegistration,
  } = data;

  const getNetworkQualityColor = (quality?: string) => {
    switch (quality) {
      case "excellent": return "text-success";
      case "good": return "text-success";
      case "fair": return "text-warning";
      case "poor": return "text-destructive";
      default: return "text-muted-foreground";
    }
  };

  const registrationPercentage = totalRegistrars > 0
    ? (registeredCount / totalRegistrars) * 100
    : 0;

  const formatTimeAgo = (timestamp?: string) => {
    if (!timestamp) return "Never";
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return `${diffDays}d ago`;
    } catch {
      return "Unknown";
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-success/5 transition-smooth hover:shadow-card-hover overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold">System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2.5">
                <TooltipWrapper entry={tooltips.regRegistrationStatus}>
                  <span className="text-sm font-semibold cursor-help">Registration</span>
                </TooltipWrapper>
                <div className="flex items-center gap-2">
                  {registeredCount === totalRegistrars ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm font-bold tabular-nums">{registeredCount} / {totalRegistrars}</span>
                </div>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden border border-border/50">
                <div
                  className={cn(
                    "h-full transition-all duration-[var(--motion-duration-attention)] [transition-timing-function:var(--motion-ease-overlay)] rounded-full",
                    registrationPercentage >= 80 ? "bg-success" :
                    registrationPercentage >= 50 ? "bg-warning" : "bg-destructive"
                  )}
                  style={{ width: `${registrationPercentage}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {averageResponseTime !== undefined && averageResponseTime !== null && (
          <Card className="transition-smooth hover:shadow-card-hover overflow-hidden">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <TooltipWrapper entry={tooltips.regAvgResponseTime}>
                    <p className="text-sm text-muted-foreground font-medium cursor-help">Response Time</p>
                  </TooltipWrapper>
                  <p className="text-2xl font-bold mt-1.5 tabular-nums">{averageResponseTime}ms</p>
                </div>
                <Zap
                  className={cn(
                    "h-8 w-8",
                    averageResponseTime < 100 ? "text-success" : averageResponseTime < 300 ? "text-warning" : "text-destructive"
                  )}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {networkQuality && (
          <Card className="transition-smooth hover:shadow-card-hover overflow-hidden">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <TooltipWrapper entry={tooltips.regNetworkQuality}>
                    <p className="text-sm text-muted-foreground font-medium cursor-help">Network Quality</p>
                  </TooltipWrapper>
                  <Badge
                    className={cn(
                      "text-sm font-semibold mt-1.5 px-3 py-1 border",
                      networkQuality === "excellent" ? "bg-success/20 text-success border-success/30" :
                      networkQuality === "good" ? "bg-success/10 text-success border-success/20" :
                      networkQuality === "fair" ? "bg-warning/20 text-warning border-warning/30" :
                      "bg-destructive/20 text-destructive border-destructive/30"
                    )}
                  >
                    {networkQuality.charAt(0).toUpperCase() + networkQuality.slice(1)}
                  </Badge>
                </div>
                <Activity className={cn("h-8 w-8", getNetworkQualityColor(networkQuality))} />
              </div>
            </CardContent>
          </Card>
        )}

        {lastSuccessfulRegistration && (
          <Card className="transition-smooth hover:shadow-card-hover overflow-hidden">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <TooltipWrapper entry={tooltips.regLastSuccess}>
                    <p className="text-sm text-muted-foreground font-medium cursor-help">Last Success</p>
                  </TooltipWrapper>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm font-semibold">{formatTimeAgo(lastSuccessfulRegistration)}</p>
                  </div>
                </div>
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
