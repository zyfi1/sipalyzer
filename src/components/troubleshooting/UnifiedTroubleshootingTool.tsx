/**
 * Home tool shell — renders the home landing page.
 * Call details panel appears below when a call trace is selected.
 */

import { useState } from "react";
import { createSupportPackage } from "@/api/packetCapture";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { navigateTo } from "@/lib/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Loader2, ExternalLink, Download } from "@/lib/icons";
import { useNotifications } from "@/hooks/useNotifications";
import { useTroubleshootingSyncMount } from "@/hooks/useTroubleshootingSync";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import type { RootCauseHint } from "@/types/forensics";
import { HomeView } from "@/components/home/HomeView";

function getHintConfidenceLabel(hint: RootCauseHint): string {
  switch (hint.confidenceLevel) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
    default: {
      const _exhaustive: never = hint.confidenceLevel;
      return _exhaustive;
    }
  }
}

export function UnifiedTroubleshootingTool() {
  useTroubleshootingSyncMount();
  const { notify } = useNotifications();
  const loadCaptureSession = (window as any).loadCaptureSession as ((id: string) => Promise<void>) | undefined;

  const loadingTrace = useTroubleshootingStore((s) => s.loadingTrace);
  const selectedTrace = useTroubleshootingStore((s) => s.selectedTrace);
  const traceError = useTroubleshootingStore((s) => s.traceError);
  const rootCauseHints = useTroubleshootingStore((s) => s.rootCauseHints);
  const clearTrace = useTroubleshootingStore((s) => s.clearTrace);

  const [supportSummary, setSupportSummary] = useState("");
  const [exporting, setExporting] = useState(false);

  const handleViewCapture = (sessionId: string) => {
    loadCaptureSession?.(sessionId)?.catch(() => {});
    navigateTo("packet-capture", "analysis", { packetCaptureSessionId: sessionId });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <HomeView />

      {selectedTrace && (
        <div className="shrink-0 border-t border-border bg-muted/10">
          <Card className="rounded-none border-0 border-t">
            <CardHeader className="py-3 flex flex-row items-center justify-between">
              <CardTitle>Call details</CardTitle>
              <TooltipWrapper title="Close" description="Close the call details panel.">
                <Button variant="neutral" size="sm" onClick={clearTrace}>Close</Button>
              </TooltipWrapper>
            </CardHeader>
            <CardContent className="space-y-4 pb-4">
              {loadingTrace && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </p>
              )}
              {traceError && <p className="text-sm text-destructive rounded-lg bg-destructive/10 px-3 py-2">{traceError}</p>}
              {selectedTrace.softphoneCall && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Call</h4>
                  <p className="text-sm text-muted-foreground">
                    {selectedTrace.softphoneCall.target} — {selectedTrace.softphoneCall.state}
                    {selectedTrace.softphoneCall.statusCode != null && <> ({selectedTrace.softphoneCall.statusCode} {selectedTrace.softphoneCall.statusText})</>}
                  </p>
                  {selectedTrace.softphoneCall.errorMessage && <p className="text-sm text-destructive mt-1">{selectedTrace.softphoneCall.errorMessage}</p>}
                </div>
              )}
              {selectedTrace.registrationAtCall && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Registration at call time</h4>
                  <p className="text-sm">
                    {selectedTrace.registrationAtCall.registrarName}:{" "}
                    {selectedTrace.registrationAtCall.success ? (
                      <span className="text-success">{selectedTrace.registrationAtCall.statusCode} {selectedTrace.registrationAtCall.statusText}</span>
                    ) : (
                      <span className="text-destructive">{selectedTrace.registrationAtCall.statusCode} {selectedTrace.registrationAtCall.statusText}</span>
                    )}
                  </p>
                </div>
              )}
              {selectedTrace.rtpStreams && selectedTrace.rtpStreams.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">RTP streams</h4>
                  <ul className="text-xs space-y-1">
                    {selectedTrace.rtpStreams.map((s, i) => (
                      <li key={i}>
                        {s.srcIp}:{s.srcPort} → {s.dstIp}:{s.dstPort} — {s.codecName}, MOS {s.mosScore.toFixed(2)}, loss {s.lossPercentage.toFixed(1)}%, jitter {s.jitter.toFixed(0)}ms
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rootCauseHints.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Root-cause hints</h4>
                  <ul className="space-y-2">
                    {rootCauseHints.map((h) => (
                      <li key={h.id} className={`rounded-lg p-2 text-sm flex items-start gap-2 ${h.severity === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning-foreground"}`}>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{h.title}</span> — {h.description}
                          <p className="text-xs mt-1 opacity-90">
                            {getHintConfidenceLabel(h)}
                            {h.uncertaintyState === "uncertain" ? " (not definitive)" : ""}
                          </p>
                          {h.uncertaintyReasons && h.uncertaintyReasons.length > 0 && (
                            <p className="text-xs mt-0.5 opacity-80">
                              {h.uncertaintyReasons.map((reason) => reason.message).join(" ")}
                            </p>
                          )}
                        </div>
                        {h.articleId && (
                          <TroubleshootLink articleId={h.articleId} className="shrink-0 mt-0.5" />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedTrace.sessionId && (
                <div className="flex flex-wrap gap-2 items-start">
                  <TooltipWrapper title="Open in Viewer" description="Open this capture in the packet capture viewer.">
                    <Button variant="neutral" size="sm" className="gap-2" onClick={() => handleViewCapture(selectedTrace.sessionId!)}>
                      <ExternalLink className="h-4 w-4" /> Open in Viewer
                    </Button>
                  </TooltipWrapper>
                  <div className="flex flex-col gap-2 min-w-[200px]">
                    <textarea
                      className="w-full min-h-[60px] rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Optional summary for support package…"
                      value={supportSummary}
                      onChange={(e) => setSupportSummary(e.target.value)}
                    />
                    <TooltipWrapper title="Create support package" description="Export a support package (capture + summary) for this call.">
                      <Button
                        size="sm"
                        className="gap-2 w-fit"
                        disabled={exporting}
                        onClick={async () => {
                          setExporting(true);
                          try {
                            const path = await createSupportPackage(selectedTrace.sessionId!, supportSummary || "Support package", selectedTrace.callId ?? null);
                            notify({ type: "success", title: "Support package created", description: path, source: "troubleshooting" });
                          } catch (e) {
                            notify({ type: "error", title: "Export failed", description: e instanceof Error ? e.message : String(e), source: "troubleshooting" });
                          } finally {
                            setExporting(false);
                          }
                        }}
                      >
                        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        Create support package
                      </Button>
                    </TooltipWrapper>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
