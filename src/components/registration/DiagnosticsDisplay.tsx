import { useState, type ReactElement } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Network, Globe, Clock, Server, Code, ChevronDown, ChevronUp } from "@/lib/icons";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";

interface DiagnosticsDisplayProps {
  diagnostics: Record<string, unknown>;
  testType?: string;
}

export function DiagnosticsDisplay({ diagnostics }: DiagnosticsDisplayProps) {
  const [showRaw, setShowRaw] = useState(false);

  const renderParsedDiagnostics = () => {
    const items: ReactElement[] = [];

    // Network Connectivity specific
    if (diagnostics.dns_resolution !== undefined || diagnostics.tcp_connectivity !== undefined) {
      items.push(
        <div key="network" className="space-y-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2 pl-6">
            {diagnostics.dns_resolution !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">DNS Resolution</span>
                <Badge variant={diagnostics.dns_resolution ? "success" : "destructive"}>
                  {diagnostics.dns_resolution ? "Resolved" : "Failed"}
                </Badge>
              </div>
            )}
            {diagnostics.tcp_connectivity !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">TCP Connectivity</span>
                <Badge variant={diagnostics.tcp_connectivity ? "success" : "destructive"}>
                  {diagnostics.tcp_connectivity ? "Connected" : "Failed"}
                </Badge>
              </div>
            )}
            {diagnostics.host !== undefined && diagnostics.host !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Host</span>
                <span className="text-sm font-mono">{String(diagnostics.host)}</span>
              </div>
            )}
            {diagnostics.port !== undefined && diagnostics.port !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Port</span>
                <span className="text-sm font-mono">{String(diagnostics.port)}</span>
              </div>
            )}
            {diagnostics.resolved_address !== undefined && diagnostics.resolved_address !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Resolved Address</span>
                <span className="text-sm font-mono">{String(diagnostics.resolved_address)}</span>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Registration/Test specific
    if (diagnostics.first_registration || diagnostics.second_registration || diagnostics.initial_registration) {
      items.push(
        <div key="registration" className="space-y-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2 pl-6">
            {diagnostics.first_registration !== undefined && diagnostics.first_registration !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">First Registration</span>
                <Badge variant="secondary">{String(diagnostics.first_registration)}</Badge>
              </div>
            )}
            {diagnostics.second_registration !== undefined && diagnostics.second_registration !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Second Registration</span>
                <Badge variant="secondary">{String(diagnostics.second_registration)}</Badge>
              </div>
            )}
            {diagnostics.initial_registration !== undefined && diagnostics.initial_registration !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Initial Registration</span>
                <Badge variant="secondary">{String(diagnostics.initial_registration)}</Badge>
              </div>
            )}
            {diagnostics.delay_ms !== undefined && diagnostics.delay_ms !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Delay</span>
                <span className="text-sm">{String(diagnostics.delay_ms)}ms</span>
              </div>
            )}
            {diagnostics.reason !== undefined && diagnostics.reason !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Reason</span>
                <span className="text-sm text-muted-foreground">{String(diagnostics.reason)}</span>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Expires header tests
    if (diagnostics.expires_tests || diagnostics.tested_values || diagnostics.expires !== undefined) {
      items.push(
        <div key="expires" className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2 pl-6">
            {diagnostics.expires !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Expires</span>
                <Badge variant="secondary">{String(diagnostics.expires)}s</Badge>
              </div>
            )}
            {diagnostics.tested_values !== undefined && Array.isArray(diagnostics.tested_values) && (
              <div>
                <span className="text-sm text-muted-foreground">Tested Values: </span>
                <span className="text-sm font-mono">
                  {(diagnostics.tested_values as number[]).join(", ")} seconds
                </span>
              </div>
            )}
            {diagnostics.expires_tests !== undefined && Array.isArray(diagnostics.expires_tests) && (
              <div className="space-y-2">
                {(diagnostics.expires_tests as Array<Record<string, unknown>>).map((test, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Expires {String(test.requested_expires ?? "")}s
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Status {String(test.response_status ?? "")}</Badge>
                      {test.actual_expires !== undefined && test.actual_expires !== null && (
                        <span className="text-muted-foreground">
                          (actual: {String(test.actual_expires)}s)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }


    // Transport information
    if (diagnostics.transport) {
      items.push(
        <div key="transport" className="space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="pl-6">
            <Badge variant="secondary">{String(diagnostics.transport)}</Badge>
          </div>
        </div>
      );
    }

    // Error handling
    if (diagnostics.error_code || diagnostics.error_response_received !== undefined) {
      items.push(
        <div key="error" className="space-y-3">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2 pl-6">
            {diagnostics.error_code !== undefined && diagnostics.error_code !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Error Code</span>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{String(diagnostics.error_code)}</Badge>
                  {(() => {
                    const code = typeof diagnostics.error_code === "number" ? diagnostics.error_code : parseInt(String(diagnostics.error_code), 10);
                    return !Number.isNaN(code) && code > 0 ? <TroubleshootLink sipCode={code} compact /> : null;
                  })()}
                </div>
              </div>
            )}
            {diagnostics.error_response_received !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Error Response</span>
                <Badge variant={diagnostics.error_response_received ? "success" : "secondary"}>
                  {diagnostics.error_response_received ? "Received" : "Not Received"}
                </Badge>
              </div>
            )}
            {diagnostics.used_invalid_credentials !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Used Invalid Credentials</span>
                <Badge variant={diagnostics.used_invalid_credentials ? "destructive" : "secondary"}>
                  {diagnostics.used_invalid_credentials ? "Yes" : "No"}
                </Badge>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Authentication info
    if (diagnostics.auth_required !== undefined || diagnostics.auth_successful !== undefined) {
      items.push(
        <div key="auth" className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2 pl-6">
            {diagnostics.auth_required !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Auth Required</span>
                <Badge variant={diagnostics.auth_required ? "secondary" : "secondary"}>
                  {diagnostics.auth_required ? "Yes" : "No"}
                </Badge>
              </div>
            )}
            {diagnostics.auth_successful !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Auth Successful</span>
                <Badge variant={diagnostics.auth_successful ? "success" : "destructive"}>
                  {diagnostics.auth_successful ? "Yes" : "No"}
                </Badge>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Contact header validation
    if (diagnostics.contact_header_validated !== undefined || diagnostics.contact_header_present !== undefined) {
      items.push(
        <div key="contact" className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Contact Header</span>
          </div>
          <div className="space-y-2 pl-6">
            {diagnostics.contact_header_validated !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Validation</span>
                <Badge variant={diagnostics.contact_header_validated ? "success" : "destructive"}>
                  {diagnostics.contact_header_validated ? "Validated" : "Not Validated"}
                </Badge>
              </div>
            )}
            {diagnostics.contact_header_present !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Header Present</span>
                <Badge variant={diagnostics.contact_header_present ? "success" : "secondary"}>
                  {diagnostics.contact_header_present ? "Yes" : "No"}
                </Badge>
              </div>
            )}
            {diagnostics.local_ip_in_contact !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Local IP in Contact</span>
                <Badge variant={diagnostics.local_ip_in_contact ? "success" : "destructive"}>
                  {diagnostics.local_ip_in_contact ? "Yes" : "No"}
                </Badge>
              </div>
            )}
            {diagnostics.local_ip !== undefined && diagnostics.local_ip !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Local IP</span>
                <span className="text-sm font-mono">{String(diagnostics.local_ip)}</span>
              </div>
            )}
            {diagnostics.local_port !== undefined && diagnostics.local_port !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Local Port</span>
                <span className="text-sm font-mono">{String(diagnostics.local_port)}</span>
              </div>
            )}
            {diagnostics.contact_format !== undefined && diagnostics.contact_format !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Format</span>
                <span className="text-sm">{String(diagnostics.contact_format)}</span>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Basic registration info (status, response time, expires, auth, transport, registrar)
    if (diagnostics.status_code !== undefined || diagnostics.response_time_ms !== undefined || diagnostics.registrar !== undefined) {
      items.push(
        <div key="basic" className="space-y-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Registration Details</span>
          </div>
          <div className="space-y-2 pl-6">
            {diagnostics.status_code !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status Code</span>
                <div className="flex items-center gap-2">
                  <Badge variant={Number(diagnostics.status_code) >= 200 && Number(diagnostics.status_code) < 300 ? "success" : "destructive"}>
                    {String(diagnostics.status_code)}
                  </Badge>
                  {(() => {
                    const code = typeof diagnostics.status_code === "number" ? diagnostics.status_code : parseInt(String(diagnostics.status_code), 10);
                    return !Number.isNaN(code) && code > 0 ? <TroubleshootLink sipCode={code} compact /> : null;
                  })()}
                </div>
              </div>
            )}
            {diagnostics.status_text !== undefined && diagnostics.status_text !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <span className="text-sm">{String(diagnostics.status_text)}</span>
              </div>
            )}
            {diagnostics.response_time_ms !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Response Time</span>
                <span className="text-sm">{String(diagnostics.response_time_ms)}ms</span>
              </div>
            )}
            {diagnostics.expires !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Expires</span>
                <Badge variant="secondary">{String(diagnostics.expires)}s</Badge>
              </div>
            )}
            {diagnostics.auth_required !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Authentication Required</span>
                <Badge variant={diagnostics.auth_required ? "secondary" : "secondary"}>
                  {diagnostics.auth_required ? "Yes" : "No"}
                </Badge>
              </div>
            )}
            {diagnostics.auth_successful !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Authentication Successful</span>
                <Badge variant={diagnostics.auth_successful ? "success" : "destructive"}>
                  {diagnostics.auth_successful ? "Yes" : "No"}
                </Badge>
              </div>
            )}
            {diagnostics.transport !== undefined && diagnostics.transport !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Transport</span>
                <Badge variant="secondary">{String(diagnostics.transport)}</Badge>
              </div>
            )}
            {diagnostics.registrar !== undefined && diagnostics.registrar !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Registrar</span>
                <span className="text-sm font-mono">{String(diagnostics.registrar)}</span>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Generic fields that don't fit above categories
    const parsedKeys = new Set([
      'dns_resolution', 'tcp_connectivity', 'host', 'port', 'resolved_address',
      'first_registration', 'second_registration', 'initial_registration', 'delay_ms', 'reason',
      'expires', 'expires_tests', 'tested_values',
      'concurrent_tests', 'results',
      'transport',
      'error_code', 'error_response_received', 'used_invalid_credentials',
      'auth_required', 'auth_successful',
      'contact_header_validated', 'contact_header_present', 'local_ip_in_contact', 'local_ip', 'local_port', 'contact_format',
      'status_code', 'status_text', 'response_time_ms', 'registrar'
    ]);

    const remainingKeys = Object.keys(diagnostics).filter(k => !parsedKeys.has(k));
    if (remainingKeys.length > 0) {
      items.push(
        <div key="other" className="space-y-3">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-2 pl-6">
            {remainingKeys.map((key) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground capitalize">
                  {key.replace(/_/g, ' ')}
                </span>
                <span className="text-sm font-mono">
                  {typeof diagnostics[key] === 'object' 
                    ? JSON.stringify(diagnostics[key])
                    : String(diagnostics[key])}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return items.length > 0 ? items : null;
  };

  const parsedContent = renderParsedDiagnostics();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Test Diagnostics</span>
        </div>
        <TooltipWrapper title={showRaw ? "Hide Raw" : "Show Raw"} description={showRaw ? "Hide the raw JSON diagnostics output." : "Show the raw JSON diagnostics output."}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowRaw(!showRaw)}
          className="h-7 text-xs"
        >
          {showRaw ? (
            <>
              <ChevronUp className="mr-1 h-3 w-3" />
              Hide Raw
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3 w-3" />
              Show Raw
            </>
          )}
        </Button>
        </TooltipWrapper>
      </div>

      {parsedContent ? (
        <>
          <Card className="bg-muted/30">
            <CardContent className="pt-4 space-y-4">
              {parsedContent}
            </CardContent>
          </Card>
          {showRaw && (
            <div className="mt-3">
              <div className="flex items-center justify-end mb-2">
                <CopyTextButton text={JSON.stringify(diagnostics, null, 2)} label="Copy JSON" showLabel />
              </div>
              <pre className="text-xs font-mono overflow-x-auto bg-muted p-3 rounded-lg max-h-96 overflow-y-auto">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
            </div>
          )}
        </>
      ) : (
        // If no parsed content, show raw JSON by default
        <div>
          <div className="flex items-center justify-end mb-2">
            <CopyTextButton text={JSON.stringify(diagnostics, null, 2)} label="Copy JSON" showLabel />
          </div>
          <pre className="text-xs font-mono overflow-x-auto bg-muted p-3 rounded-lg max-h-96 overflow-y-auto">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
