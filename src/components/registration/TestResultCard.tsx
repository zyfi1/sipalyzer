import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, ChevronDown, ChevronUp, Code } from "@/lib/icons";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiagnosticsDisplay } from "./DiagnosticsDisplay";
import type { TestResult } from "@/types/registration";
import { TEST_TYPES } from "@/types/registration";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

interface TestResultCardProps {
  testResult: TestResult;
}

export function TestResultCard({ testResult }: TestResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const testTypeInfo = TEST_TYPES.find((t) => t.id === testResult.test_type);

  return (
    <Card className="transition-smooth hover:shadow-card-hover hover-lift">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {testResult.success ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            )}
            <div>
              <span className="text-base font-medium">
                {testTypeInfo?.label || testResult.test_type}
              </span>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={testResult.success ? "success" : "destructive"}>
                  {testResult.success ? "Passed" : "Failed"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {testResult.result.response_time_ms}ms
                </span>
                {testResult.result.status_code > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {testResult.result.status_code} {testResult.result.status_text}
                  </span>
                )}
              </div>
            </div>
          </div>
          <TooltipWrapper title={isExpanded ? "Hide details" : "Show details"} description={isExpanded ? "Collapse diagnostics and raw messages." : "Expand to view diagnostics and raw SIP messages."}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 px-2.5 gap-1.5"
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
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent className="space-y-4">
          {testResult.result.error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {testResult.result.error}
            </div>
          )}

          {testResult.diagnostics && (
            <DiagnosticsDisplay 
              diagnostics={testResult.diagnostics} 
              testType={testResult.test_type}
            />
          )}

          {testResult.result.request_message || testResult.result.response_message ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Raw SIP Messages</span>
              </div>
              <Tabs defaultValue="request" className="w-full">
              <TabsList className="subview-tabs-compact">
                <TabsTrigger value="request" className="subview-tab-compact" disabled={!testResult.result.request_message}>
                  Request
                </TabsTrigger>
                <TabsTrigger value="response" className="subview-tab-compact" disabled={!testResult.result.response_message}>
                  Response
                </TabsTrigger>
              </TabsList>
              <TabsContent value="request" className="mt-4 space-y-2">
                {testResult.result.request_message ? (
                  <>
                    <div className="flex items-center justify-end mb-2">
                      <CopyTextButton text={testResult.result.request_message} label="Copy request" showLabel />
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      <p className="mb-1">Raw SIP REGISTER request message. Angle brackets <code className="text-xs bg-muted px-1 py-0.5 rounded">&lt; &gt;</code> wrap URIs in headers (To, From, Contact) per RFC 3261.</p>
                      <p className="text-xs">Headers: <code className="text-xs bg-muted px-1 py-0.5 rounded">To</code> = Address of Record, <code className="text-xs bg-muted px-1 py-0.5 rounded">From</code> = Sender identity, <code className="text-xs bg-muted px-1 py-0.5 rounded">Contact</code> = Where to reach this client</p>
                    </div>
                    <div className="bg-muted rounded-lg p-4 max-h-96 overflow-auto">
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                        {testResult.result.request_message}
                      </pre>
                    </div>
                  </>
                ) : (
                  <EmptyState compact variant="inline" title="No request message available for this test type" />
                )}
              </TabsContent>
              <TabsContent value="response" className="mt-4 space-y-2">
                {testResult.result.response_message ? (
                  <>
                    <div className="flex items-center justify-end mb-2">
                      <CopyTextButton text={testResult.result.response_message} label="Copy response" showLabel />
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      <p className="mb-1">Raw SIP response message from the server. Status code indicates success (2xx) or error (4xx/5xx).</p>
                      <p className="text-xs">Common codes: <code className="text-xs bg-muted px-1 py-0.5 rounded">200</code> = Success, <code className="text-xs bg-muted px-1 py-0.5 rounded">401</code> = Authentication required, <code className="text-xs bg-muted px-1 py-0.5 rounded">403</code> = Forbidden, <code className="text-xs bg-muted px-1 py-0.5 rounded">404</code> = Not found</p>
                    </div>
                    <div className="bg-muted rounded-lg p-4 max-h-96 overflow-auto">
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                        {testResult.result.response_message}
                      </pre>
                    </div>
                  </>
                ) : (
                  <EmptyState compact variant="inline" title="No response message available for this test type" />
                )}
              </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}
