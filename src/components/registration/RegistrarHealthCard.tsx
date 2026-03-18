import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Activity, TrendingUp, Zap, Shield } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { formatDateTime } from "@/lib/dateTime";
import type { Registrar } from "@/stores/registrationStore";

export interface RegistrarHealth {
  registrar: Registrar;
  registered: boolean;
  healthScore: number;
  lastTestTime?: string;
  responseTimeMs?: number;
  uptimePercentage?: number;
  testPassRate?: number;
  networkQuality?: "excellent" | "good" | "fair" | "poor";
}

interface RegistrarHealthCardProps {
  health: RegistrarHealth;
}

export function RegistrarHealthCard({ health }: RegistrarHealthCardProps) {
  const { registrar, registered, healthScore, lastTestTime, responseTimeMs, uptimePercentage, testPassRate, networkQuality } = health;

  const getStatusIcon = () => {
    if (registered) {
      return <CheckCircle2 className="h-6 w-6 text-success" />;
    }
    return <XCircle className="h-6 w-6 text-destructive" />;
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-warning";
    return "text-destructive";
  };

  const getNetworkQualityColor = (quality?: string) => {
    switch (quality) {
      case "excellent": return "bg-success/20 text-success border-success/30";
      case "good": return "bg-success/10 text-success border-success/20";
      case "fair": return "bg-warning/20 text-warning border-warning/30";
      case "poor": return "bg-destructive/20 text-destructive border-destructive/30";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const responseTimeColor =
    responseTimeMs != null
      ? responseTimeMs < 100
        ? "text-success"
        : responseTimeMs < 300
          ? "text-warning"
          : "text-destructive"
      : "text-muted-foreground";

  const cardGradient = registered
    ? "linear-gradient(to right, hsl(var(--success) / 0.10) 0%, hsl(var(--success) / 0.03) 40%, transparent 100%)"
    : "linear-gradient(to right, hsl(var(--destructive) / 0.10) 0%, hsl(var(--destructive) / 0.03) 40%, transparent 100%)";

  return (
    <Card
      className={cn(
        "transition-smooth overflow-hidden hover-lift",
        "hover:shadow-card-hover"
      )}
      style={{ background: cardGradient }}
    >
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 flex-shrink-0 rounded-lg bg-muted/50 p-1.5">
              {getStatusIcon()}
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg font-semibold mb-0.5">{registrar.name}</CardTitle>
              <p className="text-xs text-muted-foreground truncate font-mono">{registrar.domain}</p>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <TooltipWrapper entry={tooltips.regHealthScore}>
              <div className={cn("text-3xl font-bold tabular-nums cursor-help", getHealthColor(healthScore))}>
                {healthScore}
              </div>
            </TooltipWrapper>
            <p className="text-xs text-muted-foreground font-medium">Health</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 shadow-card">
          <div className="flex items-center gap-2">
            <Shield className={cn("h-4 w-4", registered ? "text-success" : "text-destructive")} />
            <span className="text-sm font-medium">Registration</span>
          </div>
          <TooltipWrapper entry={tooltips.regRegistrationStatus}>
            <Badge
              variant={registered ? "success" : "destructive"}
              className={cn(
                "text-sm font-semibold px-3 py-1 cursor-help",
                registered && "bg-success/20 text-success border-success/30"
              )}
            >
              {registered ? "Registered" : "Not Registered"}
            </Badge>
          </TooltipWrapper>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {responseTimeMs !== undefined && responseTimeMs !== null ? (
            <div className="p-3 rounded-lg bg-muted/20 shadow-card">
              <TooltipWrapper entry={tooltips.regResponseTime}>
                <div className="flex items-center gap-2 mb-1.5 cursor-help">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground font-medium">Response</p>
                </div>
              </TooltipWrapper>
              <p className={cn("text-lg font-bold tabular-nums", responseTimeColor)}>{responseTimeMs}ms</p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-muted/20 shadow-card">
              <TooltipWrapper entry={tooltips.regResponseTime}>
                <div className="flex items-center gap-2 mb-1.5 cursor-help">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground font-medium">Response</p>
                </div>
              </TooltipWrapper>
              <p className="text-sm text-muted-foreground">—</p>
            </div>
          )}

          {uptimePercentage !== undefined && uptimePercentage !== null && typeof uptimePercentage === "number" ? (
            <div className="p-3 rounded-lg bg-muted/20 shadow-card">
              <TooltipWrapper entry={tooltips.regUptimePercent}>
                <div className="flex items-center gap-2 mb-1.5 cursor-help">
                  <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground font-medium">Uptime</p>
                </div>
              </TooltipWrapper>
              <p className="text-lg font-bold tabular-nums">{uptimePercentage.toFixed(1)}%</p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-muted/20 shadow-card">
              <TooltipWrapper entry={tooltips.regUptimePercent}>
                <div className="flex items-center gap-2 mb-1.5 cursor-help">
                  <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground font-medium">Uptime</p>
                </div>
              </TooltipWrapper>
              <p className="text-sm text-muted-foreground">—</p>
            </div>
          )}

          {testPassRate !== undefined && testPassRate !== null && typeof testPassRate === "number" ? (
            <div className="p-3 rounded-lg bg-muted/20 shadow-card">
              <TooltipWrapper entry={tooltips.regPassRate}>
                <div className="flex items-center gap-2 mb-1.5 cursor-help">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground font-medium">Pass Rate</p>
                </div>
              </TooltipWrapper>
              <p className="text-lg font-bold tabular-nums">{(testPassRate * 100).toFixed(0)}%</p>
            </div>
          ) : null}
        </div>

        {networkQuality && (
          <div className="p-3 rounded-lg bg-muted/20 shadow-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground font-medium">Network</p>
              </div>
              <TooltipWrapper entry={tooltips.regNetworkQuality}>
                <Badge className={cn("text-xs font-semibold border cursor-help", getNetworkQualityColor(networkQuality))}>
                  {networkQuality.charAt(0).toUpperCase() + networkQuality.slice(1)}
                </Badge>
              </TooltipWrapper>
            </div>
          </div>
        )}

        {lastTestTime && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-3 border-t border-border/50">
            <Clock className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Last test: {formatDateTime(lastTestTime)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
