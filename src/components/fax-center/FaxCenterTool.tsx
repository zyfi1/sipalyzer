/**
 * Fax Center — Main tool shell.
 *
 * Two-tab layout:
 *   1. Send  — Compose and send faxes (inline progress during send)
 *   2. Faxes — Unified sent/received list + detail/preview panel
 */
import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { listen } from "@/lib/tauriEvents";
import { useToolStore } from "@/stores/toolStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useIncomingFaxStore } from "@/stores/incomingFaxStore";
import { faxAnswerInboundCall, faxRejectInboundCall } from "@/api/fax";
import { Tabs, TabsContent, AnimatedTabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import { RegistrarContextSelector } from "@/components/ui/registrar-context-selector";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Phone, PhoneOff } from "@/lib/icons";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { FaxSendView } from "./FaxSendView";
import { FaxesView } from "./FaxesView";
import type { FaxSendProgress, FaxReceiveProgress } from "./FaxShared";
import type { ReceivedFax } from "@/types/fax";

type FaxView = "send" | "faxes";

export function FaxCenterTool() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);

  // ── Registrar state (lifted from FaxSendView) ──
  const registrars = useRegistrationStore((s) => s.registrars);
  const fetchRegistrars = useRegistrationStore((s) => s.fetchRegistrars);
  const [registrarId, setRegistrarId] = useState("");

  useEffect(() => { fetchRegistrars(); }, [fetchRegistrars]);

  const registrarNameById = useMemo(
    () =>
      new Map(
        registrars
          .filter((r): r is typeof r & { id: string } => Boolean(r.id))
          .map((r) => [r.id, r.name]),
      ),
    [registrars],
  );

  const [view, setView] = useState<FaxView>("send");
  const [faxActionLoading, setFaxActionLoading] = useState(false);
  const [faxActionError, setFaxActionError] = useState<string | null>(null);
  const [sendingProgress, setSendingProgress] = useState<Record<string, FaxSendProgress>>({});
  const [receivingProgress, setReceivingProgress] = useState<Record<string, FaxReceiveProgress>>({});
  const receiveStartedAtRef = useRef<Record<string, string>>({});

  const incomingFaxCall = useIncomingFaxStore((s) => s.activeIncomingFaxCall);
  const resolveActiveIncomingFaxCall = useIncomingFaxStore((s) => s.resolveActiveIncomingFaxCall);

  const updateSentFaxJob = useTroubleshootingStore((s) => s.updateSentFaxJob);
  const addReceivedFax = useTroubleshootingStore((s) => s.addReceivedFax);

  // Listen for fax send progress events from backend
  useEffect(() => {
    const unlistenPromise = listen<{
      jobId: string;
      phase: string;
      udptlPacketsSent?: number;
      udptlPacketsReceived?: number;
      elapsedSecs?: number;
      captureSessionId?: string;
      success?: boolean;
      error?: string;
      pagesSent?: number;
      durationMs?: number;
      transport?: string;
      sipMessage?: string;
      sdpInfo?: string;
      natInfo?: string;
      remoteRtp?: string;
      warning?: string;
      detail?: string;
      messageDirection?: "outbound" | "inbound" | "info";
      isSymmetricNat?: boolean;
    }>("fax:send_progress", (event) => {
      const p = event.payload;
      const { jobId, phase } = p;
      setSendingProgress((prev) => {
        const existing = prev[jobId];
        const next: FaxSendProgress = {
          phase,
          udptlPacketsSent: p.udptlPacketsSent ?? existing?.udptlPacketsSent ?? 0,
          udptlPacketsReceived: p.udptlPacketsReceived ?? existing?.udptlPacketsReceived,
          elapsedSecs: p.elapsedSecs ?? existing?.elapsedSecs,
          captureSessionId: p.captureSessionId ?? existing?.captureSessionId,
          sipMessage: p.sipMessage,
          sdpInfo: p.sdpInfo,
          natInfo: p.natInfo,
          remoteRtp: p.remoteRtp,
          warning: p.warning,
          detail: p.detail,
          messageDirection: p.messageDirection,
          isSymmetricNat: p.isSymmetricNat,
        };
        // Skip update if nothing meaningful changed (avoids cascading re-renders)
        if (existing
          && existing.phase === next.phase
          && existing.udptlPacketsSent === next.udptlPacketsSent
          && existing.udptlPacketsReceived === next.udptlPacketsReceived
          && existing.elapsedSecs === next.elapsedSecs
          && existing.sipMessage === next.sipMessage
          && existing.warning === next.warning
          && existing.natInfo === next.natInfo
        ) {
          return prev; // Same reference → no re-render
        }
        return { ...prev, [jobId]: next };
      });

      if (phase === "complete") {
        updateSentFaxJob(jobId, {
          status: p.success ? "sent" : "failed",
          captureSessionId: p.captureSessionId ?? undefined,
          completedAt: new Date().toISOString(),
          ...(p.success ? {} : { errorMessage: "Fax transmission failed" }),
        });
      } else if (phase === "error") {
        updateSentFaxJob(jobId, {
          status: "failed",
          errorMessage: p.error ?? "Unknown error",
          completedAt: new Date().toISOString(),
        });
      }
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, [updateSentFaxJob]);

  // Listen for fax receive progress + completion events
  useEffect(() => {
    const unlistenProgress = listen<FaxReceiveProgress>("fax:receive_progress", (event) => {
      const p = event.payload;
      if (!receiveStartedAtRef.current[p.receiveId]) {
        receiveStartedAtRef.current[p.receiveId] = new Date().toISOString();
      }
      setReceivingProgress((prev) => ({
        ...prev,
        [p.receiveId]: { ...prev[p.receiveId], ...p },
      }));
    });

    const unlistenComplete = listen<{
      receiveId: string;
      callId?: string;
      sender?: string;
      registrarId?: string;
      captureSessionId?: string;
      capture_session_id?: string;
      success: boolean;
      pageCount?: number;
      transport?: string;
      remoteStationId?: string;
      tiffBase64?: string;
      error?: string;
    }>("fax:receive_complete", (event) => {
      const { receiveId, callId, sender, registrarId, success, pageCount, tiffBase64, captureSessionId, capture_session_id, error } = event.payload;
      const resolvedCaptureSessionId = captureSessionId ?? capture_session_id;
      const endedAt = new Date().toISOString();
      const startedAt = receiveStartedAtRef.current[receiveId] ?? endedAt;
      const durationSeconds = Math.max(
        0,
        Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
      );
      delete receiveStartedAtRef.current[receiveId];

      setReceivingProgress((prev) => {
        const next = { ...prev };
        delete next[receiveId];
        return next;
      });

      const receivedFax: ReceivedFax = {
        id: receiveId,
        sender: sender ?? "Unknown",
        receivedAt: new Date().toISOString(),
        pageCount: pageCount ?? 0,
        documentUrl: tiffBase64 ? `data:image/tiff;base64,${tiffBase64}` : undefined,
        documentFormat: "tiff",
        session: {
          sipCallId: callId ?? "",
          captureSessionId: resolvedCaptureSessionId,
          registrarId: registrarId ?? "",
          registrarName: registrarId ? registrarNameById.get(registrarId) : undefined,
          durationSeconds,
          success,
          startedAt,
          endedAt,
        },
        errorMessage: success ? undefined : (error ?? "Fax receive failed"),
      };

      // Persist both success and failure outcomes for troubleshooting history.
      addReceivedFax(receivedFax);
    });

    return () => {
      unlistenProgress.then((u) => u());
      unlistenComplete.then((u) => u());
    };
  }, [addReceivedFax, registrarNameById]);

  // Handle deep linking from sidebar
  useEffect(() => {
    if (activeToolId !== "fax-center") return;
    if (
      activeSubviewId === "send" ||
      activeSubviewId === "compose" ||
      activeSubviewId === "activity" ||
      activeSubviewId === "dashboard" ||
      activeSubviewId === "history" ||
      activeSubviewId === "settings" ||
      activeSubviewId === "inbox" ||
      activeSubviewId === "in_progress" ||
      activeSubviewId === "received" ||
      activeSubviewId === "faxes"
    ) {
      const newView: FaxView =
        activeSubviewId === "send" || activeSubviewId === "compose"
          ? "send"
          : "faxes";
      setView(newView);
      setLastViewedSubview("fax-center", newView);
      setActiveSubview(null);
    }
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview]);

  useEffect(() => {
    setLastViewedSubview("fax-center", view);
  }, [view, setLastViewedSubview]);

  const isActive = activeToolId === "fax-center";
  const [headerPortal, setHeaderPortal] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderPortal(document.getElementById("header-tool-widget-custom"));
  }, []);

  const headerRegistrarPicker = (
    <RegistrarContextSelector
      selectedRegistrarId={registrarId || null}
      onSelectRegistrar={(nextRegistrarId) => setRegistrarId(nextRegistrarId ?? "")}
      useCase="faxing"
      title="Select Fax Registrar"
      emptyTitle="No fax registrars"
      noSelectionLabel="Select registrar"
      noRegistrarLabel="No fax registrar"
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <ToolHeader
        toolId="fax-center"
        execToolId="fax-center"
        items={[
          { id: "send", label: "Send" },
          { id: "faxes", label: "Faxes" },
        ]}
        value={view}
        onValueChange={(v) => setView(v as FaxView)}
      />

      {/* Portal registrar picker into header */}
      {isActive && headerPortal && createPortal(
        <>
          {headerRegistrarPicker}
        </>,
        headerPortal,
      )}

      <Tabs
        value={view}
        onValueChange={(v) => setView(v as FaxView)}
        className="flex-1 flex flex-col gap-0 min-h-0"
      >

        <div className="flex-1 flex flex-col min-h-0 app-view-gutter gap-3">
        {/* Incoming fax call banner — uses fax-specific API, no softphone dependency */}
        {incomingFaxCall && (
          <IncomingFaxBanner
            call={incomingFaxCall}
            loading={faxActionLoading}
            error={faxActionError}
            onAnswer={async () => {
              setFaxActionLoading(true);
              setFaxActionError(null);
              try {
                await faxAnswerInboundCall(incomingFaxCall.registrarId, incomingFaxCall.callId);
                resolveActiveIncomingFaxCall(incomingFaxCall.callId);
              } catch (e) {
                setFaxActionError(e instanceof Error ? e.message : String(e));
              } finally {
                setFaxActionLoading(false);
              }
            }}
            onDecline={async () => {
              setFaxActionLoading(true);
              setFaxActionError(null);
              try {
                await faxRejectInboundCall(incomingFaxCall.callId);
              } catch (e) {
                setFaxActionError(e instanceof Error ? e.message : String(e));
              } finally {
                resolveActiveIncomingFaxCall(incomingFaxCall.callId);
                setFaxActionLoading(false);
              }
            }}
          />
        )}

        <AnimatedTabsContent className="flex-1 min-h-0">
          <TabsContent value="send" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full overflow-hidden">
              <FaxSendView sendingProgress={sendingProgress} registrarId={registrarId} setRegistrarId={setRegistrarId} onSendStarted={() => setView("faxes")} />
            </div>
          </TabsContent>
          <TabsContent value="faxes" className={TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS}>
            <div className="h-full overflow-hidden">
              <FaxesView
                sendingProgress={sendingProgress}
                receivingProgress={receivingProgress}
              />
            </div>
          </TabsContent>
        </AnimatedTabsContent>

        </div>
      </Tabs>
    </div>
  );
}

/* ── Incoming Fax Call Banner ── */

function IncomingFaxBanner({
  call,
  loading,
  error,
  onAnswer,
  onDecline,
}: {
  call: { callId: string; from: string; fromDisplay: string };
  loading: boolean;
  error: string | null;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="ui-panel-shell rounded-md overflow-hidden">
      <div className="ui-section-header-md flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-foreground opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-foreground" />
        </span>
        <span className="section-title text-foreground">Incoming Fax</span>
      </div>
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            {call.fromDisplay?.trim() || call.from?.trim() || "Unknown"}
          </p>
          <p className="text-xs text-muted-foreground">Incoming fax transmission</p>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-destructive">{error}</span>}
          <TooltipWrapper title="Decline" description="Reject the incoming fax call.">
            <Button size="sm" variant="destructive" className="gap-1.5" disabled={loading} onClick={onDecline}>
              <PhoneOff className="h-4 w-4" />
              Decline
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Answer" description="Accept the incoming fax and start receiving.">
            <Button
              size="sm"
              variant="positive"
              className="gap-1.5"
              disabled={loading}
              onClick={onAnswer}
            >
              <Phone className="h-4 w-4" />
              Answer
            </Button>
          </TooltipWrapper>
        </div>
      </div>
    </div>
  );
}
