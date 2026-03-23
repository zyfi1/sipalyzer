/**
 * FaxSendView — Two-column send interface.
 *
 * Left  (40%): Destination, content source, settings, send button
 * Right (60%): Document preview — or live diagnostics when actively sending
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

import { useRegistrationStore } from "@/stores/registrationStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore"; // still used for addSentFaxJob / updateSentFaxJob
import { useSettingsStore } from "@/stores/settingsStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useGlobalFileDropStore } from "@/stores/globalFileDropStore";
import { sendQueuedFax, cancelFax } from "@/api/fax";
import { getRegistrarPassword } from "@/api/registration";
import { dispatchFaxSend } from "@/lib/executionDispatch";
import type { FaxBaudRate, SendFaxOptions, QueuedFaxPage } from "@/api/fax";
import { useToastContext } from "@/contexts/ToastContext";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { AppDropdown } from "@/components/ui/app-dropdown";
import {
  Send,
  Loader2,
  Zap,
  Upload,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
  Edit,
} from "@/lib/icons";
import type { SentFaxJob } from "@/types/fax";
import type { FaxSendProgress } from "./FaxShared";
import { extractErrorMessage } from "@/lib/errorUtils";
import {
  TEST_PAGES,
  FAX_MODES,
  FAX_BAUD_RATES,
  formatBaud,
} from "./FaxShared";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { TipTapEditor } from "@/components/notes/editor/TipTapEditor";
import { markdownToHtml } from "@/components/notes/editor/markdownUtils";
import { FaxLiveDiagnostics } from "./FaxLiveDiagnostics";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";

type ContentSource = "test_page" | "upload" | "compose";

interface UploadedFile {
  name: string;
  dataUrl: string;
  base64: string;
  mimeType: string;
}

interface OutboundPageItem {
  id: string;
  kind: "template" | "compose" | "upload";
  label: string;
  pageCount: number;
  templatePresetId?: string;
  templateBrand?: string;
  composeMarkdown?: string;
  composeHtml?: string;
  uploadFile?: UploadedFile;
}

interface FaxSendViewProps {
  sendingProgress: Record<string, FaxSendProgress>;
  registrarId: string;
  setRegistrarId?: (id: string) => void;
  onSendStarted?: () => void;
}

export function FaxSendView({ sendingProgress, registrarId, onSendStarted }: FaxSendViewProps) {
  const registrars = useRegistrationStore((s) => s.registrars);
  const addSentFaxJob = useTroubleshootingStore((s) => s.addSentFaxJob);
  const updateSentFaxJob = useTroubleshootingStore((s) => s.updateSentFaxJob);
  const { toast } = useToastContext();
  const faxSettings = useSettingsStore((s) => s.fax);
  const setFax = useSettingsStore((s) => s.setFax);
  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);

  const ctx = resolvedContext("fax-center");
  const isDispatched = ctx.type !== "local";
  const agentName = resolvedAgentName("fax-center");

  const [target, setTarget] = useState("");
  const [source, setSource] = useState<ContentSource>("test_page");
  const [testPageId, setTestPageId] = useState("itu_test_page");
  const [customBrand, setCustomBrand] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [outboundPages, setOutboundPages] = useState<OutboundPageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [composeContent, setComposeContent] = useState("");
  const [composePreviewHtml, setComposePreviewHtml] = useState("");
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeMode = faxSettings.useG711Only ? "g711u" : "t38";
  const selectedRegistrar = registrars.find((r) => r.id === registrarId);
  useEffect(() => { setPreviewPage(0); }, [source, testPageId, uploadedFiles.length]);
  useEffect(() => {
    const dropped = useGlobalFileDropStore.getState().consumeFaxFiles();
    if (!dropped.length) return;
    const normalized = dropped.map((f) => ({
      ...f,
      mimeType: f.dataUrl.startsWith("data:application/pdf") ? "application/pdf" : "image/png",
    }));
    setSource("upload");
    setUploadedFiles((prev) => [...prev, ...normalized]);
    setOutboundPages((prev) => [
      ...prev,
      ...normalized.map((file) => ({
        id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "upload" as const,
        label: file.name,
        pageCount: 1,
        uploadFile: file,
      })),
    ]);
  }, []);
  const handleComposeChange = useCallback((nextMarkdown: string) => {
    setComposeContent(nextMarkdown);
  }, []);
  const handleComposeHtmlChange = useCallback((nextHtml: string) => {
    setComposePreviewHtml(nextHtml);
  }, []);

  const applyMode = useCallback((modeId: string) => {
    const m = FAX_MODES.find((fm) => fm.id === modeId);
    if (!m) return;
    setFax({ useG711Only: m.g711Only });
  }, [setFax]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const accepted = ["image/png", "image/jpeg", "image/jpg", "image/tiff", "application/pdf"];
    const list: UploadedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file === undefined || !accepted.includes(file.type)) continue;
      try {
        const dataUrl = await new Promise<string>((res, rej) => { const reader = new FileReader(); reader.onload = () => res(reader.result as string); reader.onerror = () => rej(new Error("Read failed")); reader.readAsDataURL(file); });
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] ?? "" : "";
        list.push({ name: file.name, dataUrl, base64, mimeType: file.type });
      } catch { /* skip */ }
    }
    setUploadedFiles((prev) => [...prev, ...list]);
    setOutboundPages((prev) => [
      ...prev,
      ...list.map((file) => ({
        id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "upload" as const,
        label: file.name,
        pageCount: 1,
        uploadFile: file,
      })),
    ]);
    e.target.value = "";
  };

  const addSelectedTemplateToQueue = useCallback(() => {
    const page = TEST_PAGES.find((p) => p.id === testPageId) ?? TEST_PAGES[0];
    if (!page) return;
    setOutboundPages((prev) => [
      ...prev,
      {
        id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "template",
        label: page.name,
        pageCount: page.pages,
        templatePresetId: page.id,
        templateBrand: page.brandable ? customBrand.trim() : undefined,
      },
    ]);
  }, [customBrand, testPageId]);

  const addComposedPageToQueue = useCallback(() => {
    if (!composeContent.trim()) return;
    const composedHtml = composePreviewHtml.trim() ? composePreviewHtml : markdownToHtml(composeContent);
    setOutboundPages((prev) => [
      ...prev,
      {
        id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "compose",
        label: "Composed page",
        pageCount: 1,
        composeMarkdown: composeContent,
        composeHtml: composedHtml,
      },
    ]);
  }, [composeContent, composePreviewHtml]);

  const removeQueueItem = useCallback((id: string) => {
    setOutboundPages((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const hasContent = outboundPages.length > 0;
  /** Strip formatting chars and validate a fax number looks like E.164 or SIP URI */
  const normalizeTarget = (raw: string): string => raw.replace(/[\s\-().]/g, "");
  const isValidTarget = (raw: string): boolean => {
    const n = normalizeTarget(raw);
    // E.164 (+1234567890), plain digits, or sip: URI
    return /^\+?\d{7,15}$/.test(n) || /^sip:/i.test(n);
  };
  /** Best-effort E.164 formatting for display: strip formatting, add + prefix if missing, assume +1 (NANP) for 10-digit numbers. */
  const toE164Display = (raw: string): string => {
    const n = normalizeTarget(raw);
    if (!n || /^sip:/i.test(n)) return n; // pass SIP URIs through
    const digits = n.replace(/\D/g, "");
    if (!digits) return n;
    if (n.startsWith("+")) return `+${digits}`;
    // 10 digits → assume NANP (+1)
    if (digits.length === 10) return `+1${digits}`;
    // 11 digits starting with 1 → already NANP
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    // Otherwise prefix with +
    return `+${digits}`;
  };
  const canSend = !!registrarId && !!target.trim() && isValidTarget(target) && hasContent && !sending;

  const handleCancel = async () => {
    if (!activeJobId) return;
    const jobId = activeJobId;
    setCancelling(true);
    cancelledRef.current = true;
    try { await cancelFax(jobId); } catch { /* backend may already be done */ }
    updateSentFaxJob(jobId, { status: "failed", errorMessage: "Cancelled by user", completedAt: new Date().toISOString() });
    setSending(false);
    setActiveJobId(null);
    setCancelling(false);
    toast({ type: "info", title: "Fax cancelled", description: "Transmission aborted", source: "fax-center" });
  };

  const handleSend = async () => {
    if (!canSend) { setError("Enter a fax number and select content to send."); return; }
    setError(null);
    setSending(true);
    cancelledRef.current = false;
    const jobId = `fax-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setActiveJobId(jobId);
    const registrar = registrars.find((r) => r.id === registrarId);
    const targetVal = normalizeTarget(target);
    const mode = FAX_MODES.find((m) => m.id === activeMode) ?? FAX_MODES[0];
    const faxOpts: SendFaxOptions = {
      ecm: faxSettings.ecm,
      baud_rate: faxSettings.baudRate as FaxBaudRate,
      mode: mode.g711Only ? "g711u" : "t38",
      retries: faxSettings.sendRetries,
      timeout_secs: faxSettings.receiveTimeoutSecs,
      resolution: faxSettings.resolution,
    };
    try {
      const queue = outboundPages;
      if (!queue.length) {
        throw new Error("Add at least one page to send.");
      }
      const totalPages = queue.reduce((sum, item) => sum + item.pageCount, 0);
      const firstTemplate = queue.find((item) => item.kind === "template");

      const job: SentFaxJob = {
        id: jobId,
        source: firstTemplate && queue.length === 1 ? "prebuilt_test" : "upload",
        target: targetVal,
        registrarId,
        registrarName: registrar?.name,
        status: "pending",
        pageCount: totalPages,
        createdAt: new Date().toISOString(),
        filePaths: [],
        previewPages: queue
          .filter((item) => item.kind === "upload" && item.uploadFile?.dataUrl)
          .map((item) => item.uploadFile?.dataUrl ?? ""),
        sentTestPresetId: firstTemplate && queue.length === 1 ? firstTemplate.templatePresetId : undefined,
        sentBrandLabel: firstTemplate && queue.length === 1 ? firstTemplate.templateBrand : undefined,
        sentMode: mode.g711Only ? "g711u" : "t38",
        sentEcm: faxSettings.ecm,
        sentBaudRate: faxSettings.baudRate,
      };

      addSentFaxJob(job);
      updateSentFaxJob(jobId, { status: "sending" });
      onSendStarted?.();

      const sendQueuedFaxNow = async () => {
        const pagesPayload: QueuedFaxPage[] = queue.map((item) => ({
          kind: item.kind,
          label: item.label,
          templatePresetId: item.templatePresetId,
          templateBrand: item.templateBrand,
          composeHtml: item.composeHtml,
          composeMarkdown: item.composeMarkdown,
          uploadBase64: item.uploadFile?.base64,
          uploadFileName: item.uploadFile?.name,
        }));
        return sendQueuedFax(registrarId, targetVal, pagesPayload, faxOpts, jobId);
      };

      if (isDispatched && registrar) {
        const password = await getRegistrarPassword(registrarId);
        if (ctx.type === "remote" && agentName) {
          updateSentFaxJob(jobId, { agentName });
        }
        const { result: remoteResult, source: dispatchSource } = await dispatchFaxSend(
          ctx,
          sendQueuedFaxNow,
          {
            target: targetVal,
            fax_number: targetVal,
            port: registrar.remote_port ?? 5060,
            caller_id: undefined,
            domain: registrar.domain,
            username: registrar.username,
            password,
            transport: registrar.transport,
            timeout_secs: registrar.timeout_seconds,
            baud_rate: faxSettings.baudRate,
            ecm: faxSettings.ecm,
            resolution: faxSettings.resolution,
            header_line: undefined,
          },
        );
        handleResult(
          { ok: remoteResult.success, error_message: remoteResult.error },
          jobId,
          targetVal,
          dispatchSource === "local" ? null : agentName,
        );
      } else {
        const result = await sendQueuedFaxNow();
        handleResult(result, jobId, targetVal);
      }
    } catch (e) {
      if (cancelledRef.current) return;
      const msg = extractErrorMessage(e);
      updateSentFaxJob(jobId, { status: "failed", errorMessage: msg, completedAt: new Date().toISOString() });
      setError(msg); toast({ type: "error", title: "Send failed", description: msg, source: "fax-center" });
    } finally {
      if (!cancelledRef.current) { setSending(false); setActiveJobId(null); }
    }
  };

  const handleResult = (
    result: { ok: boolean; error_message?: string | null; sip_call_id?: string | null; capture_session_id?: string | null },
    jobId: string,
    targetVal: string,
    viaAgent?: string | null,
  ) => {
    if (cancelledRef.current) return;
    const base = {
      completedAt: new Date().toISOString(),
      sipCallId: result.sip_call_id ?? undefined,
      captureSessionId: result.capture_session_id ?? undefined,
      ...(viaAgent ? { agentName: viaAgent } : {}),
    };
    if (result.ok) {
      updateSentFaxJob(jobId, { ...base, status: "sent" });
      setOutboundPages([]);
      setUploadedFiles([]);
      toast({ type: "success", title: "Fax sent", description: `Sent to ${targetVal}`, source: "fax-center" });
    } else {
      const errMsg = result.error_message ?? "Send failed";
      updateSentFaxJob(jobId, { ...base, status: "failed", errorMessage: errMsg });
      setError(errMsg); toast({ type: "error", title: "Send failed", description: errMsg, source: "fax-center" });
    }
  };

  const selectedPage = TEST_PAGES.find((p) => p.id === testPageId);
  const activeProgress = activeJobId ? sendingProgress[activeJobId] : undefined;
  const showLiveDiag = sending && activeJobId;
  const flatPanelClass = "surface-flat";
  const fieldClass = "flex h-9 w-full rounded-md border border-border/50 bg-background/60 px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="h-full flex gap-3 min-h-0">

      {/* ═══ LEFT — Send Workflow (46%) ═══ */}
      <div className="w-[46%] flex flex-col gap-3 min-h-0">
        {/* Error banner */}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2.5 flex items-center gap-3 shrink-0">
            <span className="text-sm text-destructive flex-1">{error}</span>
            <TroubleshootLink articleId="t38-vs-passthrough" compact />
            <TooltipWrapper title="Dismiss" description="Clear this error message.">
              <Button variant="destructive" size="icon-xs" onClick={() => setError(null)}><X className="h-4 w-4" /></Button>
            </TooltipWrapper>
          </div>
        )}

        <div className={cn(flatPanelClass, "flex-1 min-h-0 overflow-hidden rounded-xl border border-border/40 bg-background")}>
          <div className="h-full min-h-0 flex flex-col">
            {/* Recipient bar */}
            <div className="shrink-0 border-b border-border/35 px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">To</p>
                {selectedRegistrar && (
                  <p className="text-2xs text-muted-foreground">
                    {(selectedRegistrar.transport || "udp").toUpperCase()} {selectedRegistrar.domain}:{selectedRegistrar.remote_port}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  className={cn(fieldClass, "h-9 flex-1 bg-background")}
                  placeholder="+1 (555) 123-4567"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
                {sending ? (
                  <Button onClick={handleCancel} disabled={cancelling} variant="destructive" className="h-9 shrink-0 gap-1.5 px-2.5 text-xs">
                    {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    Cancel
                  </Button>
                ) : (
                  <Button onClick={handleSend} disabled={!canSend} className="h-9 shrink-0 gap-1.5 px-2.5 text-xs">
                    <Send className="h-3.5 w-3.5" />
                    Send Fax
                  </Button>
                )}
              </div>
            </div>

            {/* Content mode buttons */}
            <div className="shrink-0 border-b border-border/35 px-4 py-3">
              <p className="mb-2 text-xs font-semibold text-foreground">Pages</p>
              <div className="subview-tabs-compact" role="tablist" aria-label="Page source selector">
                {([
                  { key: "upload" as const, icon: Upload, label: "Add files" },
                  { key: "compose" as const, icon: Edit, label: "Compose page" },
                  { key: "test_page" as const, icon: Zap, label: "Use template" },
                ]).map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSource(key)}
                    role="tab"
                    aria-selected={source === key}
                    data-state={source === key ? "active" : "inactive"}
                    className="subview-tab-compact"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="shrink-0 border-b border-border/35 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">Outbound queue</p>
                <span className="text-2xs text-muted-foreground tabular-nums">
                  {outboundPages.reduce((sum, item) => sum + item.pageCount, 0)} page{outboundPages.reduce((sum, item) => sum + item.pageCount, 0) === 1 ? "" : "s"}
                </span>
              </div>
              <div className="max-h-[120px] overflow-auto rounded-md border border-border/35 bg-background/60 p-1.5">
                {outboundPages.length === 0 ? (
                  <div className="px-2 py-3 text-center text-2xs text-muted-foreground">
                    Add files, composed pages, or templates to build the fax.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {outboundPages.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-2 rounded border border-border/30 bg-background px-2 py-1.5">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-muted/40 text-2xs text-muted-foreground tabular-nums">{idx + 1}</span>
                        <span className="text-xs text-foreground flex-1 truncate">{item.label}</span>
                        <span className="text-2xs text-muted-foreground tabular-nums">{item.pageCount}pg</span>
                        <button type="button" onClick={() => removeQueueItem(item.id)}>
                          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Page workspace */}
            <div className="flex-1 min-h-0 overflow-auto p-3">
              {source === "upload" && (
                <div className="h-full min-h-0 flex flex-col gap-2">
                  <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.tiff,.tif,.pdf,image/png,image/jpeg,image/tiff,application/pdf" multiple className="hidden" onChange={handleFileSelect} />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-dashed border-border/55 bg-muted/10 px-4 py-5 text-left transition-smooth hover:bg-muted/20"
                  >
                    <p className="text-sm font-semibold text-foreground">{uploadedFiles.length > 0 ? "Add more pages" : "Drop files here or click to upload"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">PDF, PNG, JPEG, TIFF supported</p>
                  </button>

                  <div className="flex-1 min-h-0 rounded-lg border border-border/35 bg-background/60 p-2 overflow-auto">
                    {uploadedFiles.length === 0 ? (
                      <div className="h-full min-h-[120px] flex items-center justify-center">
                        <EmptyState
                          variant="inline"
                          compact
                          description="No pages selected yet"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {uploadedFiles.map((f, i) => (
                          <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border border-border/30 bg-background px-2.5 py-2 group">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-muted/40 text-2xs text-muted-foreground tabular-nums">{i + 1}</span>
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-sm text-foreground flex-1 truncate">{f.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setUploadedFiles((prev) => prev.filter((_, idx) => idx !== i));
                                setOutboundPages((prev) => {
                                  const matchIndex = prev.findIndex((item) => item.kind === "upload" && item.uploadFile?.dataUrl === f.dataUrl);
                                  if (matchIndex < 0) return prev;
                                  return prev.filter((_, idx) => idx !== matchIndex);
                                });
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {source === "compose" && (
                <div className="h-full min-h-0 flex flex-col">
                  <div className="mb-2 rounded-md border border-border/35 bg-muted/10 px-3 py-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Compose a page to include in this fax.</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-2xs"
                      onClick={addComposedPageToQueue}
                      disabled={!composeContent.trim()}
                    >
                      Add to queue
                    </Button>
                  </div>
                  <TipTapEditor
                    content={composeContent}
                    onChange={handleComposeChange}
                    onHtmlChange={handleComposeHtmlChange}
                    placeholder="Type your fax content here..."
                    autoFocus
                    toolbarPreset="simple"
                    className="!surface-flat flex-1 min-h-0 !rounded-md"
                  />
                  <div className="shrink-0 mt-2 text-2xs text-muted-foreground text-right tabular-nums">
                    {composeContent.trim().length} chars
                  </div>
                </div>
              )}

              {source === "test_page" && selectedPage && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Select template and add it to the queue.</p>
                    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-2xs" onClick={addSelectedTemplateToQueue}>
                      Add template
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border/35 overflow-hidden bg-background/60">
                    {TEST_PAGES.map((page, idx) => (
                      <button
                        key={page.id}
                        type="button"
                        onClick={() => setTestPageId(page.id)}
                        className={cn(
                          "w-full px-3 py-2.5 text-left transition-smooth",
                          idx !== TEST_PAGES.length - 1 && "border-b border-border/30",
                          testPageId === page.id ? "bg-primary/10" : "hover:bg-muted/20",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{page.name}</span>
                          <span className="ml-auto text-2xs text-muted-foreground tabular-nums">{page.pages} page{page.pages > 1 ? "s" : ""}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{page.description}</p>
                      </button>
                    ))}
                  </div>

                  {selectedPage.brandable && (
                    <div className="rounded-md border border-border/35 bg-background/70 px-3 py-2.5">
                      <label className="mb-1 block text-3xs font-semibold uppercase tracking-wide text-foreground/85">
                        Custom brand label
                      </label>
                      <input
                        className={cn(fieldClass, "h-9 bg-background")}
                        placeholder="Your brand name"
                        value={customBrand}
                        onChange={(e) => setCustomBrand(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Transport options footer */}
            <div className="shrink-0 border-t border-border/35 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  {FAX_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => applyMode(m.id)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs font-semibold transition-smooth",
                        activeMode === m.id
                          ? `${m.bg} ${m.color} border-border/70`
                          : "border-border/45 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/35",
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFax({ ecm: !faxSettings.ecm })}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-semibold transition-smooth",
                      faxSettings.ecm
                        ? "bg-warning/10 border-warning/50 text-warning"
                        : "border-border/45 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/35",
                    )}
                  >
                    ECM
                  </button>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <AppDropdown
                    value={faxSettings.resolution}
                    onValueChange={(v) => setFax({ resolution: v as "standard" | "fine" })}
                    className="ui-control-shell h-8 w-[158px] px-2 text-xs"
                    options={[
                      { value: "standard", label: "Standard (204×98 lpi)" },
                      { value: "fine", label: "Fine (204×196 lpi)" },
                    ]}
                  />
                  <AppDropdown
                    value={String(faxSettings.baudRate)}
                    onValueChange={(v) => setFax({ baudRate: Number(v) })}
                    className="ui-control-shell h-8 w-[104px] px-2 text-xs"
                    options={FAX_BAUD_RATES.map((b) => ({
                      value: String(b),
                      label: `${formatBaud(b)} bps`,
                    }))}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ RIGHT — Preview / Live Diagnostics (54%) ═══ */}
      <div className="w-[54%] flex flex-col min-h-0">
        <Card className={cn(flatPanelClass, "flex-1 min-h-0 flex flex-col overflow-hidden")}>
          {showLiveDiag && activeJobId ? (
            /* ── Live diagnostics during send ── */
            <>
              <div className="ui-section-header-md flex items-center gap-2 shrink-0">
                <span className="relative flex h-2 w-2">
                <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-foreground opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-foreground" />
                </span>
                <span className="text-xs font-medium text-foreground">Sending to {target}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-5">
                <FaxLiveDiagnostics
                  jobId={activeJobId}
                  target={target}
                  progress={activeProgress}
                  onCancel={handleCancel}
                  cancelling={cancelling}
                />
              </div>
            </>
          ) : (
            /* ── Document preview ── */
            <>
              {(() => {
                const totalPages = source === "test_page" ? (selectedPage?.pages ?? 1) : source === "upload" ? uploadedFiles.length : 1;
                const currentFile = source === "upload" && uploadedFiles.length > 0 ? uploadedFiles[Math.min(previewPage, uploadedFiles.length - 1)] : null;
                const safePage = Math.min(previewPage, Math.max(0, totalPages - 1));

                return (
                  <>
                    <div className="ui-section-header-md flex items-center gap-2 shrink-0">
                      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Preview</span>
                      <span className="flex-1" />
                      {totalPages > 1 && (
                        <div className="flex items-center gap-1.5">
                          <TooltipWrapper title="Previous page" description="View the previous page in the preview.">
                            <button type="button" onClick={() => setPreviewPage(Math.max(0, safePage - 1))} disabled={safePage === 0}
                              className="rounded-lg bg-muted/10 p-1 text-muted-foreground hover:text-foreground hover:bg-muted/30 disabled:opacity-30 disabled:cursor-not-allowed transition-smooth">
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                          </TooltipWrapper>
                          <span className="text-xs tabular-nums text-foreground font-medium min-w-[3rem] text-center">{safePage + 1} / {totalPages}</span>
                          <TooltipWrapper title="Next page" description="View the next page in the preview.">
                            <button type="button" onClick={() => setPreviewPage(Math.min(totalPages - 1, safePage + 1))} disabled={safePage >= totalPages - 1}
                              className="rounded-lg bg-muted/10 p-1 text-muted-foreground hover:text-foreground hover:bg-muted/30 disabled:opacity-30 disabled:cursor-not-allowed transition-smooth">
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </TooltipWrapper>
                        </div>
                      )}
                      {totalPages <= 1 && source === "test_page" && selectedPage && (
                        <span className="text-xs text-muted-foreground">{selectedPage.name}</span>
                      )}
                      {currentFile && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{currentFile.name}</span>}
                      {source === "compose" && <span className="text-xs text-muted-foreground">Composed page</span>}
                    </div>

                    <div className="flex-1 min-h-0 overflow-auto">
                      {source === "test_page" && (
                        <TestPagePreviewPanel
                          page={safePage}
                          mode={activeMode}
                          ecm={faxSettings.ecm}
                          baudRate={faxSettings.baudRate}
                          toNumber={toE164Display(target.trim())}
                          variant={selectedPage?.variant ?? "quick"}
                          brandLabel={selectedPage?.brandable ? customBrand.trim() : undefined}
                          showSipalyzerBrand={!selectedPage?.brandable}
                        />
                      )}
                      {source === "upload" && uploadedFiles.length > 0 && (() => {
                        const file = uploadedFiles[Math.min(safePage, uploadedFiles.length - 1)];
                        if (!file) return null;
                        return (
                          <div className="h-full flex flex-col">
                            <div className="flex-1 flex items-center justify-center p-4 bg-foreground min-h-0">
                              {file.dataUrl.startsWith("data:image") ? (
                                <img src={file.dataUrl} alt={file.name} className="max-w-full max-h-full object-contain" />
                              ) : (
                                <div className="flex flex-col items-center gap-3 text-center">
                                  <FileText className="h-12 w-12 text-muted-foreground/60" />
                                  <div>
                                    <p className="text-sm font-medium text-muted-foreground">{file.name}</p>
                                    <p className="text-xs text-muted-foreground/60 mt-0.5">PDF preview not available</p>
                                  </div>
                                </div>
                              )}
                            </div>
                            {uploadedFiles.length > 1 && (
                              <div className="shrink-0 border-t border-border/50 bg-card px-3 py-2 flex gap-1.5 overflow-x-auto">
                                {uploadedFiles.map((f, i) => (
                                  <TooltipWrapper key={`thumb-${f.name}-${i}`} title={`Page ${i + 1}`} description={`View ${f.name} in preview.`}>
                                    <button type="button" onClick={() => setPreviewPage(i)}
                                      className={cn("shrink-0 w-10 h-12 rounded border overflow-hidden transition-smooth",
                                        i === safePage ? "border-foreground/30 ring-1 ring-foreground/20" : "border-border/50 opacity-60 hover:opacity-100")}>
                                      {f.dataUrl.startsWith("data:image") ? (
                                        <img src={f.dataUrl} alt="" className="w-full h-full object-cover bg-foreground" />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-muted/10"><FileText className="h-3 w-3 text-muted-foreground/60" /></div>
                                      )}
                                    </button>
                                  </TooltipWrapper>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {source === "upload" && uploadedFiles.length === 0 && (
                        <EmptyState
                          variant="inline"
                          icon={<Upload />}
                          title="No files uploaded"
                          description="Upload files to see a preview."
                        />
                      )}
                      {source === "compose" && (
                        <ComposePreview
                          content={composeContent}
                          previewHtml={composePreviewHtml}
                          mode={activeMode}
                          resolution={faxSettings.resolution}
                          baudRate={faxSettings.baudRate}
                        />
                      )}
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   Test Page Preview — Scaled to real fax page proportions
   ═══════════════════════════════════════════════════════════════════ */

const PAGE_W = 680; // Virtual page width (px) — content is authored at this size
const PAGE_H = 880; // Virtual page height — US Letter aspect ratio (8.5 × 11)

interface TestPageProps {
  page: number;
  mode: string;
  ecm: boolean;
  baudRate: number;
  toNumber: string;
  generatedAt?: string;
  variant?: "quick" | "full";
  brandLabel?: string;
  showSipalyzerBrand?: boolean;
}

export function TestPagePreviewPanel({
  page,
  mode,
  ecm,
  baudRate,
  toNumber,
  generatedAt,
  variant = "quick",
  brandLabel,
  showSipalyzerBrand = true,
}: TestPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const calc = () => {
      const { width, height } = el.getBoundingClientRect();
      const pad = 32;
      const s = Math.min((width - pad) / PAGE_W, (height - pad) / PAGE_H, 1);
      setScale(Math.max(0.15, s));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full flex items-center justify-center bg-background overflow-hidden">
      <div
        className="bg-foreground shadow-elevated rounded-lg"
        style={{
          width: PAGE_W,
          height: PAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          flexShrink: 0,
        }}
      >
        {(variant === "full" && page > 0) ? (
          <DiagnosticPage generatedAt={generatedAt} brandLabel={brandLabel} showSipalyzerBrand={showSipalyzerBrand} />
        ) : (
          <QuickTestPage mode={mode} ecm={ecm} baudRate={baudRate} toNumber={toNumber} generatedAt={generatedAt} brandLabel={brandLabel} showSipalyzerBrand={showSipalyzerBrand} />
        )}
      </div>
    </div>
  );
}

/* ── Page 1: Quick Test ── */

function QuickTestPage({ mode, ecm, baudRate, toNumber, generatedAt, brandLabel, showSipalyzerBrand }: {
  mode: string;
  ecm: boolean;
  baudRate: number;
  toNumber: string;
  generatedAt?: string;
  brandLabel?: string;
  showSipalyzerBrand: boolean;
}) {
  const now = generatedAt ? new Date(generatedAt) : new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const protocolLabel = mode === "g711u" ? "G.711 μ-law" : "T.38";
  const baudLabel = baudRate >= 1000 ? `${(baudRate / 1000).toFixed(1)}k` : String(baudRate);

  return (
    <div className="h-full flex flex-col text-black font-[ui-monospace,SFMono-Regular,Menlo,monospace] select-none overflow-hidden" style={{ padding: "40px 44px 32px" }}>
      {/* ── Header ── */}
      <div className="flex items-start gap-4 pb-3 mb-5 border-b-[3px] border-black shrink-0">
        <div className="w-[38px] h-[38px] bg-black shrink-0 mt-px" />
        <div className="flex-1 min-w-0">
          {showSipalyzerBrand && (
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "0.22em", lineHeight: 1 }}>SIPALYZER</div>
          )}
          {!showSipalyzerBrand && (
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.16em", lineHeight: 1 }}>FAX TEST</div>
          )}
          {brandLabel && (
            <div style={{ fontSize: 11, letterSpacing: "0.14em", lineHeight: 1, marginTop: 4, color: "rgba(0,0,0,0.62)" }}>
              {brandLabel}
            </div>
          )}
          <div style={{ fontSize: 11, letterSpacing: "0.18em", lineHeight: 1, marginTop: 5, color: "rgba(0,0,0,0.5)" }}>VIRTUAL FAX — TRANSMISSION TEST</div>
        </div>
        <span className="border border-black/30 px-1.5 py-0.5 font-bold mt-1 shrink-0" style={{ fontSize: 9 }}>{protocolLabel}</span>
      </div>

      {/* ── Transmission Info ── */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-[3px] mb-5 shrink-0" style={{ fontSize: 11 }}>
        {([
          ["DATE:", ts],
          ["TO:", toNumber || "—"],
          ["PAGES:", "1 of 1"],
          ["MODE:", protocolLabel],
          ["ECM:", ecm ? "Enabled" : "Disabled"],
          ["BAUD:", `${baudLabel} bps`],
          ["CODEC:", mode === "g711u" ? "PCMU (μ-law)" : "UDPTL / IFP"],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-2">
            <span className="font-bold text-black/60 shrink-0" style={{ width: 52 }}>{label}</span>
            <span className="text-black/80">{value}</span>
          </div>
        ))}
      </div>

      {/* ── Resolution Bars ── */}
      <SectionHeader>RESOLUTION</SectionHeader>
      <div className="space-y-1.5 mb-5 shrink-0" style={{ fontSize: 10 }}>
        {[
          { lp: "3.85 lp/mm", label: "FINE", barW: 1 },
          { lp: "1.93 lp/mm", label: "STANDARD", barW: 2 },
          { lp: "0.96 lp/mm", label: "COARSE", barW: 4 },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="text-black/40 text-right shrink-0" style={{ width: 72, fontSize: 9 }}>{r.lp}</span>
            <div className="flex-1 flex h-[14px] border border-black/10 bg-foreground overflow-hidden">
              {Array.from({ length: Math.floor(300 / (r.barW * 2)) }).map((_, j) => (
                <div key={j} className="shrink-0" style={{ width: r.barW, height: "100%", backgroundColor: j % 2 === 0 ? "black" : "white" }} />
              ))}
            </div>
            <span className="text-black/40 shrink-0" style={{ width: 60, fontSize: 9 }}>{r.label}</span>
          </div>
        ))}
      </div>

      {/* ── Character Clarity ── */}
      <SectionHeader>CHARACTER CLARITY</SectionHeader>
      <div className="mb-5 space-y-1 shrink-0">
        <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.18em", lineHeight: 1.1 }}>ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", lineHeight: 1.1 }}>abcdefghijklmnopqrstuvwxyz</div>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", lineHeight: 1.1 }}>0123456789 !@#$%&amp;()-+=.,:;/?</div>
        <div style={{ fontSize: 11.5, color: "rgba(0,0,0,0.7)", lineHeight: 1.3, marginTop: 3 }}>The quick brown fox jumps over the lazy dog.</div>
        <div style={{ fontSize: 9, color: "rgba(0,0,0,0.45)", lineHeight: 1.2, marginTop: 2 }}>MINIMUM LEGIBILITY — IF YOU CAN READ THIS LINE, FINE DETAIL IS INTACT.</div>
      </div>

      {/* ── Grayscale Wedge ── */}
      <SectionHeader>GRAYSCALE</SectionHeader>
      <div className="mb-5 shrink-0">
        <div className="flex">
          {[0, 28, 56, 84, 112, 140, 168, 196, 224, 255].map((v, i) => (
            <div key={i} className="flex-1 text-center">
              <div className="h-[28px] border-x border-black/5" style={{ backgroundColor: `rgb(${v},${v},${v})` }} />
              <div className="mt-0.5" style={{ fontSize: 7.5, color: "rgba(0,0,0,0.35)" }}>{Math.round((v / 255) * 100)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Pattern Tests ── */}
      <SectionHeader>PATTERN TESTS</SectionHeader>
      <div className="flex gap-5 mb-5 shrink-0">
        {([
          { label: "2×2", cellSize: 2, cols: 20 },
          { label: "4×4", cellSize: 4, cols: 10 },
          { label: "8×8", cellSize: 8, cols: 5 },
        ] as const).map((p) => (
          <div key={p.label}>
            <div style={{ fontSize: 8, color: "rgba(0,0,0,0.35)", marginBottom: 2 }}>{p.label}</div>
            <svg width={p.cellSize * p.cols} height={p.cellSize * p.cols} className="border border-black/15">
              {Array.from({ length: p.cols * p.cols }).map((_, i) => {
                const r = Math.floor(i / p.cols), c = i % p.cols;
                return (r + c) % 2 === 0 ? <rect key={i} x={c * p.cellSize} y={r * p.cellSize} width={p.cellSize} height={p.cellSize} fill="black" /> : null;
              })}
            </svg>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 8, color: "rgba(0,0,0,0.35)", marginBottom: 2 }}>DIAGONAL</div>
          <svg width={40} height={40} className="border border-black/15">
            <line x1="0" y1="0" x2="40" y2="40" stroke="black" strokeWidth="1.5" />
            <line x1="40" y1="0" x2="0" y2="40" stroke="black" strokeWidth="1.5" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 8, color: "rgba(0,0,0,0.35)", marginBottom: 2 }}>RADIAL</div>
          <svg width={40} height={40} className="border border-black/15">
            {[18, 14, 10, 6, 2].map((r) => <circle key={r} cx={20} cy={20} r={r} fill="none" stroke="black" strokeWidth="1" />)}
            <line x1="0" y1="20" x2="40" y2="20" stroke="black" strokeWidth="0.5" />
            <line x1="20" y1="0" x2="20" y2="40" stroke="black" strokeWidth="0.5" />
          </svg>
        </div>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Modem Reference ── */}
      <div className="border-t border-black/20 pt-2 mb-2.5 flex items-center gap-5 shrink-0" style={{ fontSize: 9 }}>
        {[
          { v: "V.27ter", s: "4,800" },
          { v: "V.29", s: "9,600" },
          { v: "V.17", s: "14,400" },
          { v: "V.34", s: "33,600" },
        ].map((m) => (
          <span key={m.v} className="text-black/40"><span className="font-bold text-black/60">{m.v}</span> {m.s} bps</span>
        ))}
      </div>

      {/* ── Footer ── */}
      <div className="border-t-[2px] border-black pt-1.5 flex items-center justify-between shrink-0" style={{ fontSize: 8.5 }}>
        <span className="text-black/40">T.4 MH/MR · T.6 MMR · ITU-T T.30 · 204×196 DPI</span>
        <span className="font-bold text-black/50 tracking-[0.15em]">
          {showSipalyzerBrand ? "SIPALYZER VIRTUAL FAX" : "VIRTUAL FAX TEST PAGE"}
        </span>
      </div>
    </div>
  );
}

/* ── Page 2: Diagnostic ── */

function DiagnosticPage({ generatedAt, brandLabel, showSipalyzerBrand }: {
  generatedAt?: string;
  brandLabel?: string;
  showSipalyzerBrand: boolean;
}) {
  const now = generatedAt ? new Date(generatedAt) : new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  return (
    <div className="h-full flex flex-col text-black font-[ui-monospace,SFMono-Regular,Menlo,monospace] select-none overflow-hidden" style={{ padding: "40px 44px 32px" }}>
      {/* ── Header ── */}
      <div className="flex items-start gap-4 pb-3 mb-5 border-b-[3px] border-black shrink-0">
        <div className="w-[38px] h-[38px] bg-black shrink-0 mt-px" />
        <div className="flex-1 min-w-0">
          {showSipalyzerBrand && (
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "0.22em", lineHeight: 1 }}>SIPALYZER</div>
          )}
          {!showSipalyzerBrand && (
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.16em", lineHeight: 1 }}>FAX DIAGNOSTIC</div>
          )}
          {brandLabel && (
            <div style={{ fontSize: 11, letterSpacing: "0.14em", lineHeight: 1, marginTop: 4, color: "rgba(0,0,0,0.62)" }}>
              {brandLabel}
            </div>
          )}
          <div style={{ fontSize: 11, letterSpacing: "0.18em", lineHeight: 1, marginTop: 5, color: "rgba(0,0,0,0.5)" }}>LINE QUALITY DIAGNOSTIC</div>
        </div>
        <div style={{ fontSize: 9, color: "rgba(0,0,0,0.4)" }}>PAGE 2 · {ts}</div>
      </div>

      {/* ── Fill Density ── */}
      <SectionHeader>FILL DENSITY</SectionHeader>
      <div className="flex gap-0.5 mb-5 shrink-0">
        {[5, 12, 25, 40, 55, 70, 85, 98].map((d) => (
          <div key={d} className="flex-1 text-center">
            <div className="h-[36px] border border-black/10" style={{ backgroundColor: `rgba(0,0,0,${d / 100})` }} />
            <div style={{ fontSize: 8, color: "rgba(0,0,0,0.35)", marginTop: 2 }}>{d}%</div>
          </div>
        ))}
      </div>

      {/* ── Scanline Fidelity ── */}
      <SectionHeader>SCANLINE FIDELITY</SectionHeader>
      <div className="space-y-1.5 mb-5 shrink-0">
        {[1, 2, 3, 4].map((w) => (
          <div key={w} className="flex items-center gap-3">
            <span style={{ fontSize: 9, color: "rgba(0,0,0,0.4)", width: 36, textAlign: "right" }}>{w}px</span>
            <div className="flex-1 overflow-hidden" style={{ height: w * 8 }}>
              {Array.from({ length: Math.ceil(16 / w) }).map((_, i) => (
                <div key={i} style={{ height: w, backgroundColor: i % 2 === 0 ? "black" : "white" }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Checkerboard ── */}
      <SectionHeader>CHECKERBOARD</SectionHeader>
      <div className="flex gap-6 mb-5 shrink-0">
        {([
          { label: "4×4", cellSize: 5, cols: 12 },
          { label: "8×8", cellSize: 8, cols: 8 },
          { label: "16×16", cellSize: 12, cols: 5 },
        ] as const).map((p) => (
          <div key={p.label}>
            <div style={{ fontSize: 8, color: "rgba(0,0,0,0.35)", marginBottom: 3 }}>{p.label}</div>
            <svg width={p.cellSize * p.cols} height={p.cellSize * p.cols} className="border border-black/15">
              {Array.from({ length: p.cols * p.cols }).map((_, i) => {
                const r = Math.floor(i / p.cols), c = i % p.cols;
                return (r + c) % 2 === 0 ? <rect key={i} x={c * p.cellSize} y={r * p.cellSize} width={p.cellSize} height={p.cellSize} fill="black" /> : null;
              })}
            </svg>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 8, color: "rgba(0,0,0,0.35)", marginBottom: 3 }}>RADIAL</div>
          <svg width={64} height={64} className="border border-black/15">
            {[30, 24, 18, 12, 6, 2].map((r) => <circle key={r} cx={32} cy={32} r={r} fill="none" stroke="black" strokeWidth="1" />)}
            <line x1="0" y1="32" x2="64" y2="32" stroke="black" strokeWidth="0.5" />
            <line x1="32" y1="0" x2="32" y2="64" stroke="black" strokeWidth="0.5" />
            <line x1="0" y1="0" x2="64" y2="64" stroke="black" strokeWidth="0.5" />
            <line x1="64" y1="0" x2="0" y2="64" stroke="black" strokeWidth="0.5" />
          </svg>
        </div>
      </div>

      {/* ── Vertical Resolution ── */}
      <SectionHeader>VERTICAL RESOLUTION</SectionHeader>
      <div className="flex gap-4 mb-5 shrink-0">
        {[1, 2, 3, 4, 6, 8].map((w) => (
          <div key={w}>
            <div style={{ fontSize: 8, color: "rgba(0,0,0,0.35)", marginBottom: 2 }}>{w}px</div>
            <svg width={w * 12} height={48} className="border border-black/10">
              {Array.from({ length: 12 }).map((_, i) => (
                i % 2 === 0 ? <rect key={i} x={i * w} y={0} width={w} height={48} fill="black" /> : null
              ))}
            </svg>
          </div>
        ))}
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Footer ── */}
      <div className="border-t-[2px] border-black pt-1.5 flex items-center justify-between shrink-0" style={{ fontSize: 8.5 }}>
        <span className="text-black/40">T.4 MH/MR · T.6 MMR · ITU-T T.30 · 204×196 DPI</span>
        <span className="font-bold text-black/50 tracking-[0.15em]">
          {showSipalyzerBrand ? "SIPALYZER VIRTUAL FAX" : "VIRTUAL FAX DIAGNOSTIC"}
        </span>
      </div>
    </div>
  );
}

/* ── Shared: Section Header ── */

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2 shrink-0">
      <div className="font-bold text-black/50 tracking-[0.2em] uppercase shrink-0" style={{ fontSize: 9 }}>{children}</div>
      <div className="flex-1 h-px bg-black/15" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Compose Preview
   ═══════════════════════════════════════════════════════════════════ */

function ComposePreview({
  content,
  previewHtml,
  mode,
  resolution,
  baudRate,
}: {
  content: string;
  previewHtml?: string;
  mode: "t38" | "g711u";
  resolution: "standard" | "fine";
  baudRate: number;
}) {
  const trimmed = content.trim();
  const fallbackHtml = useMemo(() => markdownToHtml(trimmed), [trimmed]);
  const renderedHtml = previewHtml && previewHtml.trim().length > 0 ? previewHtml : fallbackHtml;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const modeLabel = mode === "g711u" ? "G.711u" : "T.38";
  const dpiLabel = resolution === "fine" ? "204x196 DPI (Fine)" : "204x98 DPI (Standard)";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const calc = () => {
      const { width, height } = el.getBoundingClientRect();
      const pad = 12;
      const fitScale = Math.min((width - pad) / PAGE_W, (height - pad) / PAGE_H);
      // Always fit in viewport (no scroll), but never upscale above 100%.
      setScale(Math.max(0.35, Math.min(1, fitScale)));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!content.trim()) {
    return (
      <EmptyState
        variant="inline"
        icon={<Edit />}
        title="Nothing to preview"
        description="Start typing to see a preview."
      />
    );
  }
  return (
    <div
      ref={containerRef}
      className="h-full flex items-center justify-center overflow-hidden p-3 bg-gradient-to-b from-muted/70 to-muted/40"
    >
      <div
        className="mx-auto bg-white text-black rounded-md border border-black/20 shadow-[0_10px_30px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden"
        style={{
          width: PAGE_W,
          height: PAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          flexShrink: 0,
        }}
      >
        <div className="shrink-0 px-8 pt-7 pb-3 border-b border-black/15">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-black/60 uppercase tracking-[0.18em]">Fax Compose Preview</div>
            <div className="text-[10px] text-black/50 font-mono">
              {modeLabel} · {dpiLabel}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 px-8 py-6 overflow-hidden">
          <article
            className="h-full overflow-auto text-[13px] text-black leading-relaxed space-y-2 font-[ui-sans-serif,system-ui] [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_blockquote]:border-l-2 [&_blockquote]:border-black/25 [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-black/75 [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-black/5 [&_pre]:rounded [&_pre]:p-2 [&_pre]:overflow-auto [&_table]:w-full [&_table]:border-collapse [&_th]:text-left [&_th]:border [&_th]:border-black/30 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-black/20 [&_td]:px-2 [&_td]:py-1"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </div>
        <div className="shrink-0 px-8 py-3 border-t border-black/15 flex items-center justify-between">
          <span className="text-[10px] text-black/50">
            US Letter (8.5×11) &middot; {dpiLabel} &middot; {formatBaud(baudRate)} bps
          </span>
          <span className="text-[10px] text-black/50 font-mono">Page 1</span>
        </div>
      </div>
    </div>
  );
}
