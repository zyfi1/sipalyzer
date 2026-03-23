import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Circle, Clock, Network, Globe, Phone, AlertTriangle, Shield, RefreshCw } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { TEST_TYPES, type TestType } from "@/types/registration";

// Import test icons and colors (duplicated to avoid circular dependency)
const testIcons: Record<TestType, typeof CheckCircle2> = {
  basic_registration: CheckCircle2,
  reregistration: RefreshCw,
  deregistration: XCircle,
  network_connectivity: Network,
  transport_validation: Globe,
  expires_header: Clock,
  contact_header: Phone,
  error_handling: AlertTriangle,
  nat_traversal: Network,
  firewall_test: Shield,
  dns_srv_test: Globe,
  registration_stability: RefreshCw,
  network_conditions: AlertTriangle,
  multi_transport: Globe,
};

const testColors: Record<TestType, string> = {
  basic_registration: "text-info bg-info/10 border-info/20",
  reregistration: "text-info bg-info/10 border-info/20",
  deregistration: "text-destructive bg-destructive/10 border-destructive/20",
  network_connectivity: "text-success bg-success/10 border-success/20",
  transport_validation: "text-success bg-success/10 border-success/20",
  expires_header: "text-warning bg-warning/10 border-warning/20",
  contact_header: "text-warning bg-warning/10 border-warning/20",
  error_handling: "text-warning bg-warning/10 border-warning/20",
  nat_traversal: "text-info bg-info/10 border-info/20",
  firewall_test: "text-destructive bg-destructive/10 border-destructive/20",
  dns_srv_test: "text-primary bg-primary/10 border-primary/20",
  registration_stability: "text-success bg-success/10 border-success/20",
  network_conditions: "text-warning bg-warning/10 border-warning/20",
  multi_transport: "text-success bg-success/10 border-success/20",
};

export interface TestTypeStatus {
  test_type: string;
  status: "pass" | "fail" | "not_tested" | "warning";
  last_run?: string;
  registrar_statuses?: Array<{
    registrar_id: string;
    status: "pass" | "fail";
    last_run?: string;
  }>;
}

interface TestStatusGridProps {
  testTypeStatuses: TestTypeStatus[];
  onTestTypeClick?: (testType: string) => void;
}

export function TestStatusGrid({ testTypeStatuses, onTestTypeClick }: TestStatusGridProps) {
  const getStatusForTestType = (testTypeId: string): TestTypeStatus | null => {
    return testTypeStatuses.find(ts => ts.test_type === testTypeId) || null;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pass":
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case "fail":
        return <XCircle className="h-5 w-5 text-destructive" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-warning" />;
      default:
        return <Circle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pass":
        return "bg-success/10 border-success/30 text-success";
      case "fail":
        return "bg-destructive/10 border-destructive/30 text-destructive";
      case "warning":
        return "bg-warning/10 border-warning/30 text-warning";
      default:
        return "bg-muted border-border text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pass":
        return "All Checks Passed";
      case "fail":
        return "Failures Detected";
      case "warning":
        return "Warnings / Mixed";
      default:
        return "Not Tested";
    }
  };

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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {TEST_TYPES.map((testType) => {
        const statusData = getStatusForTestType(testType.id);
        const status = statusData?.status || "not_tested";
        const Icon = testIcons[testType.id] || Circle;
        const colorClass = testColors[testType.id] || "text-muted-foreground bg-muted border-border";

        const registrarStatuses = statusData?.registrar_statuses || [];
        const passedCount = registrarStatuses.filter(rs => rs.status === "pass").length;
        const failedCount = registrarStatuses.filter(rs => rs.status === "fail").length;

        return (
          <Card
            key={testType.id}
            className={cn(
              "transition-smooth hover:shadow-card-hover cursor-pointer",
              status === "pass" ? "hover:bg-success/5" :
              status === "fail" ? "hover:bg-destructive/5" :
              status === "warning" ? "hover:bg-warning/5" :
              ""
            )}
            onClick={() => onTestTypeClick?.(testType.id)}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <TooltipWrapper entry={tooltips.regTestType}>
                    <div className={cn("p-2 rounded-lg border", colorClass)}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </TooltipWrapper>
                  <div>
                    <p className="text-sm font-semibold leading-tight">{testType.label}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(status)}
                    <TooltipWrapper entry={tooltips.regTestStatus}>
                      <Badge 
                        variant="secondary"
                        className={cn("text-2xs font-semibold px-2.5 py-1", getStatusColor(status))}
                      >
                        {getStatusLabel(status)}
                      </Badge>
                    </TooltipWrapper>
                  </div>
                  {statusData?.last_run && (
                    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{formatTimeAgo(statusData.last_run)}</span>
                    </div>
                  )}
                </div>

                {/* Clear textual explanation so it's obvious what passed/failed/warned */}
                <div className="text-2xs text-muted-foreground leading-snug">
                  {status === "pass" && (
                    passedCount > 0
                      ? <>Last run: all {passedCount} registrar{passedCount !== 1 ? "s" : ""} passed this test.</>
                      : <>Last run of this test completed successfully for all checked registrars.</>
                  )}
                  {status === "fail" && (
                    <>
                      Last run: {failedCount} registrar{failedCount !== 1 ? "s" : ""} failed
                      {passedCount > 0 && <>; {passedCount} passed</>}. Click to see detailed results.
                    </>
                  )}
                  {status === "warning" && (
                    <>
                      Mixed or stale results for this test (for example, some registrars passed while
                      others failed, or data is incomplete). Click to drill into the exact failures.
                    </>
                  )}
                  {status === "not_tested" && (
                    <>This test has not been executed yet for any registrar.</>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
