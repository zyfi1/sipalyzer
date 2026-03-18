/**
 * Fax Center API — Tauri commands for fax operations using SpanDSP.
 *
 * Supports:
 * - T.38 fax over UDPTL (preferred for VoIP)
 * - G.711 passthrough fallback when T.38 is rejected
 * - Automatic retry with configurable attempts
 * - Job cancellation
 */

import { invokeTauri } from "./invoke";

/** Allowed T.30 baud rates. */
export const FAX_BAUD_RATES = [2400, 4800, 7200, 9600, 12000, 14400, 33600] as const;
export type FaxBaudRate = (typeof FAX_BAUD_RATES)[number];

/** Fax transmission mode */
export type FaxMode = "t38" | "g711" | "g711u" | "g711a" | "auto";

/** Modem type selection (ITU-T standards) */
export type ModemType = "v27ter" | "v29" | "v17" | "v34";

/** Options for sending a fax */
export interface SendFaxOptions {
  mode?: FaxMode;
  ecm?: boolean;
  baud_rate?: FaxBaudRate;
  modem_type?: ModemType;
  station_id?: string;
  header_info?: string;
  retries?: number;
  timeout_secs?: number;
  force_t38?: boolean;
  force_g711?: boolean;
  /** Image resolution: "standard" (204×98 DPI) or "fine" (204×196 DPI). Default: "fine" */
  resolution?: "standard" | "fine";
}

/** Preset configurations for common scenarios */
export const FaxPresets = {
  default: {
    mode: "t38" as FaxMode,
    ecm: true,
    baud_rate: 14400 as FaxBaudRate,
    modem_type: "v17" as ModemType,
  },
  maxCompatibility: {
    mode: "auto" as FaxMode,
    ecm: false,
    baud_rate: 4800 as FaxBaudRate,
    modem_type: "v27ter" as ModemType,
  },
  g711Fallback: {
    mode: "g711u" as FaxMode,
    ecm: true,
    baud_rate: 14400 as FaxBaudRate,
    modem_type: "v17" as ModemType,
    force_g711: true,
  },
  superG3: {
    mode: "t38" as FaxMode,
    ecm: true,
    baud_rate: 33600 as FaxBaudRate,
    modem_type: "v34" as ModemType,
  },
};

/** Result of fax send operation */
export interface SendFaxResult {
  job_id: string;
  ok: boolean;
  sip_call_id?: string;
  error_message?: string;
  pages_sent?: number;
  duration_ms?: number;
  remote_station_id?: string;
  negotiated_baud_rate?: number;
  ecm_used?: boolean;
  audit_entry_id?: string;
  capture_session_id?: string;
  transport_used?: string;
  t38_fallback?: boolean;
}

/** Fax audit log entry */
export interface FaxAuditEntry {
  id: string;
  timestamp_iso: string;
  action: string;
  job_id?: string;
  target?: string;
  registrar_id?: string;
  sip_call_id?: string;
  status_code?: number;
  status_text?: string;
  duration_ms?: number;
  success: boolean;
  error_message?: string;
  pages_sent?: number;
  negotiated_baud_rate?: number;
  ecm_used?: boolean;
  remote_station_id?: string;
  capture_session_id?: string;
  transport?: string;
  t38_fallback?: boolean;
  t38_rejection_reason?: string;
  page_count?: number;
  baud_rate?: number;
  ecm?: boolean;
  codec?: string;
  request_snippet?: string;
  response_snippet?: string;
}

/** Prebuilt test document info */
export interface PrebuiltDocInfo {
  id: string;
  name: string;
  description: string;
  pages: number;
}

/** Fax document response */
export interface FaxDocumentResponse {
  format: string;
  data_base64?: string;
  file_path?: string;
}

/** Fax progress event payload */
export interface FaxProgressEvent {
  jobId: string;
  phase: string;
  statusCode?: number;
  statusText?: string;
  success?: boolean;
  pagesSent?: number;
  durationMs?: number;
  transport?: string;
  error?: string;
  udptlPacketsSent?: number;
  captureSessionId?: string;
}

// ====== API Functions ======

/**
 * Send a fax from a TIFF file.
 */
export async function sendFax(
  registrarId: string,
  target: string,
  tiffPath: string,
  options?: SendFaxOptions,
  jobId?: string
): Promise<SendFaxResult> {
  return invokeTauri<SendFaxResult>("fax_send", {
    registrarId,
    target,
    tiffPath,
    options: options ?? null,
    jobId: jobId ?? null,
  });
}

/**
 * Send a composed fax page (HTML content rendered to TIFF by backend).
 */
export async function sendComposedFax(
  registrarId: string,
  target: string,
  htmlContent: string,
  options?: SendFaxOptions,
  jobId?: string
): Promise<SendFaxResult> {
  return invokeTauri<SendFaxResult>("fax_send_composed", {
    registrarId,
    target,
    htmlContent,
    options: options ?? null,
    jobId: jobId ?? null,
  });
}

/**
 * Send a fax from uploaded image data (base64-encoded).
 * Supports PNG, JPEG, TIFF. Backend converts to fax-compatible TIFF.
 */
export async function sendUploadedFax(
  registrarId: string,
  target: string,
  imageBase64: string,
  fileName: string,
  options?: SendFaxOptions,
  jobId?: string
): Promise<SendFaxResult> {
  return invokeTauri<SendFaxResult>("fax_send_uploaded", {
    registrarId,
    target,
    imageBase64,
    fileName,
    options: options ?? null,
    jobId: jobId ?? null,
  });
}

/**
 * Send a test page fax.
 */
export async function sendTestPageFax(
  registrarId: string,
  target: string,
  testPageId: string,
  options?: SendFaxOptions,
  jobId?: string
): Promise<SendFaxResult> {
  return invokeTauri<SendFaxResult>("fax_send_test_page", {
    registrarId,
    target,
    testPageId,
    options: options ?? null,
    jobId: jobId ?? null,
  });
}

export interface QueuedFaxPage {
  kind: "template" | "compose" | "upload";
  label?: string;
  templatePresetId?: string;
  templateBrand?: string;
  composeHtml?: string;
  composeMarkdown?: string;
  uploadBase64?: string;
  uploadFileName?: string;
}

/**
 * Send a fax built from a mixed queue of template, composed, and uploaded pages.
 */
export async function sendQueuedFax(
  registrarId: string,
  target: string,
  pages: QueuedFaxPage[],
  options?: SendFaxOptions,
  jobId?: string
): Promise<SendFaxResult> {
  return invokeTauri<SendFaxResult>("fax_send_queued", {
    registrarId,
    target,
    pages,
    options: options ?? null,
    jobId: jobId ?? null,
  });
}

/**
 * Cancel an active fax job.
 */
export async function cancelFax(jobId: string): Promise<boolean> {
  return invokeTauri<boolean>("fax_cancel", { jobId });
}

/**
 * Get the fax audit log.
 */
export async function getFaxAuditLog(limit?: number): Promise<FaxAuditEntry[]> {
  return invokeTauri<FaxAuditEntry[]>("fax_get_audit_log", {
    limit: limit ?? 100,
  });
}

/**
 * List available prebuilt test documents.
 */
export async function listPrebuiltDocs(): Promise<PrebuiltDocInfo[]> {
  return invokeTauri<PrebuiltDocInfo[]>("fax_list_prebuilt_docs", {});
}

/**
 * Get a prebuilt test document.
 */
export async function getPrebuiltTestDoc(
  docId: string
): Promise<FaxDocumentResponse> {
  return invokeTauri<FaxDocumentResponse>("fax_get_prebuilt_test_doc", {
    docId,
  });
}

// ====== Inbound Fax ======

/**
 * Answer an inbound fax call — fully independent of softphone commands.
 * Sends 200 OK with T.38 SDP, waits for ACK, starts receive session.
 */
export async function faxAnswerInboundCall(
  registrarId: string,
  callId: string
): Promise<void> {
  return invokeTauri<void>("fax_answer_inbound_call", { registrarId, callId });
}

/**
 * Reject an inbound fax call (e.g. 486 Busy Here).
 */
export async function faxRejectInboundCall(
  callId: string,
  statusCode?: number
): Promise<void> {
  return invokeTauri<void>("fax_reject_inbound_call", {
    callId,
    statusCode: statusCode ?? 486,
  });
}

// Legacy API - kept for backward compatibility but delegates to new API

/** @deprecated Use sendFax or sendTestPageFax instead */
export interface LegacySendFaxOptions {
  registrar_id: string;
  target: string;
  source: "upload" | "prebuilt_test";
  file_paths?: string[];
  pages_base64?: string[];
  prebuilt_doc_id?: string;
  job_id?: string;
  ecm?: boolean;
  baud_rate?: number;
  g711_only?: boolean;
}

/** @deprecated Use sendFax or sendTestPageFax instead */
export async function legacySendFax(
  options: LegacySendFaxOptions
): Promise<SendFaxResult> {
  const faxOptions: SendFaxOptions = {
    mode: options.g711_only ? "g711" : "t38",
    ecm: options.ecm,
    baud_rate: options.baud_rate as FaxBaudRate,
  };

  if (options.source === "prebuilt_test" && options.prebuilt_doc_id) {
    return sendTestPageFax(
      options.registrar_id,
      options.target,
      options.prebuilt_doc_id,
      faxOptions
    );
  }

  if (options.file_paths && options.file_paths.length > 0) {
    const tiffPath = options.file_paths[0];
    if (tiffPath) {
      return sendFax(options.registrar_id, options.target, tiffPath, faxOptions);
    }
  }

  throw new Error("No fax document specified");
}
