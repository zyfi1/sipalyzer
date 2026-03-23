import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Circle, Network, Globe, Phone, AlertTriangle, Shield, RefreshCw, Clock } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TEST_TYPES, type TestType } from "@/types/registration";
import { EmptyState } from "@/components/ui/empty-state";

// Import test icons (duplicated to avoid circular dependency)
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

export interface TestTypeStatus {
  test_type: string;
  status: "pass" | "fail" | "not_tested" | "warning";
  last_run?: string;
}

interface TestTypeBreakdownGraphProps {
  testTypeStatuses: TestTypeStatus[];
  title?: string;
}

export function TestTypeBreakdownGraph({ testTypeStatuses, title = "Test Type Status" }: TestTypeBreakdownGraphProps) {
  const getStatusForTestType = (testTypeId: string): TestTypeStatus | null => {
    return testTypeStatuses.find(ts => ts.test_type === testTypeId) || null;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pass":
        return "bg-success";
      case "fail":
        return "bg-destructive";
      case "warning":
        return "bg-warning";
      default:
        return "bg-muted";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pass":
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "fail":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "warning":
        return <XCircle className="h-4 w-4 text-warning" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pass":
        return "Pass";
      case "fail":
        return "Fail";
      case "warning":
        return "Warning";
      default:
        return "Not Tested";
    }
  };

  if (testTypeStatuses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState variant="inline" title="No test type data available" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {TEST_TYPES.map((testType) => {
            const statusData = getStatusForTestType(testType.id);
            const status = statusData?.status || "not_tested";
            const Icon = testIcons[testType.id] || Circle;

            return (
              <div
                key={testType.id}
                className="flex items-center gap-4 p-3 rounded-lg border-2 transition-smooth shadow-card hover:bg-accent/5"
              >
                <div className="flex-shrink-0">
                  {getStatusIcon(status)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">{testType.label}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-[var(--motion-duration-attention)] [transition-timing-function:var(--motion-ease-overlay)] rounded-full",
                        getStatusColor(status)
                      )}
                      style={{
                        width: status === "pass" ? "100%" :
                               status === "fail" ? "100%" :
                               status === "warning" ? "50%" : "0%"
                      }}
                    />
                  </div>
                </div>

                <Badge
                  variant="secondary"
                  className={cn(
                    "text-xs font-semibold px-2.5 py-1",
                    status === "pass" ? "bg-success/20 text-success border-success/30" :
                    status === "fail" ? "bg-destructive/20 text-destructive border-destructive/30" :
                    status === "warning" ? "bg-warning/20 text-warning border-warning/30" :
                    "bg-muted text-muted-foreground border-border"
                  )}
                >
                  {getStatusLabel(status)}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
