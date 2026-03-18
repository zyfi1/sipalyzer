import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  RefreshCw, 
  XCircle, 
  Network, 
  Globe, 
  Shield, 
  Clock, 
  Phone, 
  AlertTriangle,
  Play,
  Info,
  Loader2,
  ChevronDown,
  ChevronUp,
  Settings
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { TestType } from "@/types/registration";
import { TEST_TYPES } from "@/types/registration";
import { TestResultCard } from "./TestResultCard";
import { TestConfigDialog, type TestConfig } from "./TestConfigDialog";
import type { TestResult } from "@/types/registration";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

interface TestToolPanelProps {
  testType: TestType;
  registrarId: string;
  onRun: (testType: TestType, config?: TestConfig) => Promise<void>;
  isRunning: boolean;
  result?: TestResult;
  config?: TestConfig;
  onConfigChange?: (testType: TestType, config: TestConfig) => void;
  isSelected?: boolean;
}

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

export function TestToolPanel({ 
  testType, 
  registrarId: _registrarId, 
  onRun, 
  isRunning, 
  result,
  config,
  onConfigChange,
  isSelected = false
}: TestToolPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const testInfo = TEST_TYPES.find((t) => t.id === testType);
  const Icon = testIcons[testType];
  const colorClass = testColors[testType];

  if (!testInfo) return null;

  const handleRun = async () => {
    await onRun(testType, config);
  };

  const handleConfigSave = (newConfig: TestConfig) => {
    if (onConfigChange) {
      onConfigChange(testType, newConfig);
    }
  };

  return (
    <Card 
      className={cn(
        "transition-smooth hover:shadow-card-hover",
        isExpanded && "shadow-card-hover",
        result && result.success && "bg-success/5",
        result && !result.success && "bg-destructive/5",
        isSelected && "ring-1 ring-foreground/10"
      )}
      onClick={(e) => {
        // Don't trigger selection if clicking buttons or interactive elements
        if ((e.target as HTMLElement).closest('button')) {
          return;
        }
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={cn(
              "p-2.5 rounded-lg border transition-smooth shadow-card flex-shrink-0",
              colorClass,
              isRunning && "animate-live-breathe motion-reduce:animate-none"
            )}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">{testInfo.label}</span>
                {result && (
                  <Badge variant={result.success ? "success" : "destructive"} className="text-xs h-5">
                    {result.success ? "Passed" : "Failed"}
                  </Badge>
                )}
                {isRunning && (
                  <Badge variant="outline" className="animate-live-breathe motion-reduce:animate-none text-xs h-5">
                    Running
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {testInfo.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TooltipWrapper title="Run Test" description="Execute this test for the current registrar.">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRun();
                }}
                disabled={isRunning}
                size="sm"
                className="min-w-[100px]"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Run Test
                  </>
                )}
              </Button>
            </TooltipWrapper>
            <TooltipWrapper title={isExpanded ? "Hide details" : "Show details"} description={isExpanded ? "Collapse test explanation and results." : "Expand to see what this test does and view results."}>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="h-8 px-2.5 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    <span className="text-xs">Hide</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    <span className="text-xs">Details</span>
                  </>
                )}
              </Button>
            </TooltipWrapper>
            <TooltipWrapper title="Configure test" description="Open test-specific options (timeout, transport, etc.).">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsConfigOpen(true);
                }}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipWrapper>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 space-y-4">
          <div className="p-4 rounded-lg bg-muted/50 shadow-card animate-panel-enter">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              What This Test Does
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {getTestExplanation(testType)}
            </p>
          </div>

          {result && (
            <div className="animate-in fade-in duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
              <TestResultCard testResult={result} />
            </div>
          )}

          {isRunning && !result && (
            <div className="flex items-center justify-center py-8 animate-in fade-in duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
              <div className="text-center space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Running {testInfo.label}...
                </p>
              </div>
            </div>
          )}
        </CardContent>
      )}

      <TestConfigDialog
        testType={testType}
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        onSave={handleConfigSave}
        currentConfig={config}
      />
    </Card>
  );
}

function getTestExplanation(testType: TestType): string {
  const explanations: Record<TestType, string> = {
    basic_registration: "Performs a standard SIP REGISTER request to the registrar. This test validates that your credentials are correct, the registrar is reachable, and authentication (if required) works properly. This is the fundamental registration test that all SIP clients perform.",
    reregistration: "Tests periodic re-registration behavior by performing two consecutive registrations. This validates that the registrar accepts refresh registrations and that your client can maintain its registration before expiration. Essential for long-running SIP sessions.",
    deregistration: "Tests graceful unregistration by sending a REGISTER request with Expires: 0. This tells the registrar to immediately remove your registration. Useful for testing cleanup behavior and ensuring you can properly disconnect from the registrar.",
    network_connectivity: "Validates basic network connectivity to the registrar. This test performs DNS resolution and attempts a TCP connection to verify the registrar host and port are reachable. Helps diagnose network-level issues before attempting SIP registration.",
    transport_validation: "Tests the configured transport protocol (UDP, TCP, TLS, or WSS) to ensure it's working correctly. This validates that the transport layer can establish connections and handle SIP messages over the specified protocol.",
    expires_header: "Tests how the registrar handles different expiration values. This test sends multiple REGISTER requests with varying Expires header values to validate the registrar's expiration handling and determine optimal refresh intervals.",
    contact_header: "Validates Contact header formatting and parsing. This ensures your Contact header is properly formatted according to RFC 3261 and that the registrar correctly interprets your contact information.",
    error_handling: "Tests error response handling by intentionally sending invalid credentials. This validates that your client properly handles various error responses (400, 403, 404, 500, etc.) and can extract meaningful error information from the registrar.",
    nat_traversal: "Tests registration behind NAT/firewall by detecting if your local IP is private (RFC 1918). This test validates that the Contact header contains the correct IP address and helps identify NAT traversal issues that could prevent successful registration in production environments.",
    firewall_test: "Comprehensive firewall testing suite that validates firewall rules, port accessibility, and network security policies. Tests multiple ports (5060, 5061, 80, 443, 3478), port ranges, packet sizes, rate limiting, stateful firewall behavior, and SIP-aware deep packet inspection. Essential for diagnosing connectivity issues in enterprise or restricted network environments and identifying firewall configurations that may interfere with SIP traffic.",
    dns_srv_test: "Tests DNS SRV and NAPTR record resolution for SIP. This validates failover registrar discovery and ensures your registrar can be found via DNS-based service discovery. Essential for production deployments using DNS-based failover mechanisms.",
    registration_stability: "Tests registration maintained over an extended period by performing multiple consecutive registrations. This validates that your registration remains stable and doesn't experience unexpected de-registrations, which is critical for production reliability.",
    network_conditions: "Tests registration under poor network conditions including packet loss, latency, and jitter. This validates that your registration can handle real-world network conditions and helps identify potential issues before production deployment.",
    multi_transport: "Tests registration across different transports (UDP, TCP, TLS) and validates transport fallback behavior. This ensures your system can adapt to different network conditions and transport requirements, improving compatibility and reliability.",
  };
  return explanations[testType] || "Test description not available.";
}
