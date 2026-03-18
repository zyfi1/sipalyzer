import { useState } from "react";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useNotifications } from "@/hooks/useNotifications";
import { navigateTo } from "@/lib/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, CheckCircle2, XCircle, Clock, FileText } from "@/lib/icons";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";

interface RegistrationTestPanelProps {
  registrarId: string;
}

const REGISTRATION_TOOL_ID = "registration";

export function RegistrationTestPanel({ registrarId }: RegistrationTestPanelProps) {
  const registrars = useRegistrationStore((s) => s.registrars);
  const testRegistration = useRegistrationStore((s) => s.testRegistration);
  const testResults = useRegistrationStore((s) => s.testResults);
  const lastSource = useRegistrationStore((s) => s.lastSource);
  const loading = useRegistrationStore((s) => s.loading);
  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const { error: notifyError, success: notifySuccess } = useNotifications();
  const [isTesting, setIsTesting] = useState(false);

  const registrar = registrars.find((r) => r.id === registrarId);
  const result = testResults[registrarId];
  const ctx = resolvedContext(REGISTRATION_TOOL_ID);
  const source = lastSource[registrarId];
  const sourceBadgeLabel = (() => {
    if (!source) return null;
    if (source.source === "remote") {
      return `via ${resolvedAgentName(REGISTRATION_TOOL_ID) ?? "agent"}`;
    }
    return "via local";
  })();

  if (!registrar || !registrar.id) {
    return <div className="text-destructive p-4">Registrar not found or invalid</div>;
  }

  const handleTest = async () => {
    if (!registrarId || !registrar?.id) {
      console.error("handleTest called with invalid registrarId:", registrarId);
      notifyError("Test Failed", "Invalid registrar ID", { source: "registration" });
      return;
    }
    setIsTesting(true);
    try {
      console.log("Starting test for registrar:", registrar.id);
      await testRegistration(registrar.id, ctx);
      const result = testResults[registrar.id];
      if (result) {
        if (result.success) {
          notifySuccess("Registration Test Successful", `Status: ${result.status_code} ${result.status_text}`, { source: "registration" });
        } else {
          notifyError("Registration Test Failed", result.error || `${result.status_code} ${result.status_text}`, { source: "registration" });
        }
      }
    } catch (error) {
      console.error("Test registration error:", error);
      notifyError("Test Failed", error instanceof Error ? error.message : "Unknown error occurred", { source: "registration" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{registrar.name}</CardTitle>
              <CardDescription>
                {registrar.username}@{registrar.domain}:{registrar.remote_port}
                {registrar.local_port && ` (local: ${registrar.local_port})`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <TooltipWrapper title="Test Registration" description="Run a single registration test for this registrar.">
              <Button onClick={handleTest} disabled={isTesting || loading}>
                {isTesting ? (
                  <>
                    <Clock className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Test Registration
                  </>
                )}
              </Button>
            </TooltipWrapper>
            </div>
          </div>
        </CardHeader>
        {result && (
          <CardContent>
            <div className="space-y-4">
              {sourceBadgeLabel && (
                <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4">{sourceBadgeLabel}</Badge>
              )}
              <div className="flex items-center gap-4">
                {result.success ? (
                  <CheckCircle2 className="h-6 w-6 text-success" />
                ) : (
                  <XCircle className="h-6 w-6 text-destructive" />
                )}
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    <span>{result.status_code} {result.status_text}</span>
                    {typeof result.status_code === "number" && result.status_code > 0 && (
                      <TroubleshootLink sipCode={result.status_code} compact />
                    )}
                    {typeof result.status_code === "string" && !Number.isNaN(parseInt(result.status_code, 10)) && (
                      <TroubleshootLink sipCode={parseInt(result.status_code, 10)} compact />
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Response time: {result.response_time_ms}ms
                  </div>
                </div>
                <Badge variant={result.success ? "success" : "destructive"}>
                  {result.success ? "Success" : "Failed"}
                </Badge>
              </div>

              {result.error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {result.error}
                </div>
              )}

              {result.expires && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Registration expires in: </span>
                  <span className="font-medium">{result.expires} seconds</span>
                </div>
              )}

              {result.capture_session_id && (
                <div className="flex items-center gap-2">
                  <TooltipWrapper title="View capture" description="Open this test's packet capture in the Packet Monitor.">
                    <Button
                      variant="neutral"
                      size="sm"
                      onClick={() => {
                        (window as any).loadCaptureSession?.(result.capture_session_id);
                        navigateTo("packet-capture", "viewer", {
                          packetCaptureSessionId: result.capture_session_id!,
                        });
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      View capture
                    </Button>
                  </TooltipWrapper>
                </div>
              )}

              <Tabs defaultValue="request" className="w-full">
                <TabsList className="subview-tabs-compact">
                  <TabsTrigger value="request" className="subview-tab-compact">Request</TabsTrigger>
                  <TabsTrigger value="response" className="subview-tab-compact">Response</TabsTrigger>
                </TabsList>
                <TabsContent value="request" className="mt-4 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    <p className="mb-1">Raw SIP REGISTER request message. Angle brackets <code className="text-xs bg-muted px-1 py-0.5 rounded">&lt; &gt;</code> wrap URIs in headers (To, From, Contact) per RFC 3261.</p>
                    <p className="text-xs">Headers: <code className="text-xs bg-muted px-1 py-0.5 rounded">To</code> = Address of Record, <code className="text-xs bg-muted px-1 py-0.5 rounded">From</code> = Sender identity, <code className="text-xs bg-muted px-1 py-0.5 rounded">Contact</code> = Where to reach this client</p>
                  </div>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-end gap-2 mb-2">
                        <CopyTextButton text={result.request_message} label="Copy request" showLabel />
                      </div>
                      <pre className="text-xs font-mono overflow-x-auto bg-muted p-4 rounded-lg">
                        {result.request_message}
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="response" className="mt-4 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    <p className="mb-1">Raw SIP response message from the server. Status code indicates success (2xx) or error (4xx/5xx).</p>
                    <p className="text-xs">Common codes: <code className="text-xs bg-muted px-1 py-0.5 rounded">200</code> = Success, <code className="text-xs bg-muted px-1 py-0.5 rounded">401</code> = Authentication required, <code className="text-xs bg-muted px-1 py-0.5 rounded">403</code> = Forbidden, <code className="text-xs bg-muted px-1 py-0.5 rounded">404</code> = Not found</p>
                  </div>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-end gap-2 mb-2">
                        <CopyTextButton text={result.response_message} label="Copy response" showLabel />
                      </div>
                      <pre className="text-xs font-mono overflow-x-auto bg-muted p-4 rounded-lg">
                        {result.response_message}
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
