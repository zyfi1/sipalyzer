/**
 * Packet capture API — typed wrappers for all packet capture backend commands.
 */

import { invokeTauri } from "./invoke";
import { validateIpcPayload } from "@/lib/ipcValidation";
import type {
  NetworkInterface,
  CaptureSession,
  CaptureFolder,
  CaptureStatistics,
  CaptureCapabilityReport,
  FilterConfig,
  ScheduledCapture,
  RtpStreamInfo,
  RtpStreamHistory,
  PacketInfo,
  ExpertFinding,
} from "@/types/packetCapture";
import type {
  SipDialog,
  ReconstructedCallSession,
  CallBehaviorDiffCategory,
  CallBehaviorDiffImpact,
  CallBehaviorDiffItem,
  CallBehaviorDiffResponse,
} from "@/types/forensics";

export async function listInterfaces(): Promise<NetworkInterface[]> {
  return invokeTauri<NetworkInterface[]>("list_interfaces", {});
}

export async function getInterfaceForIp(ip: string): Promise<{ name: string } | null> {
  return invokeTauri<{ name: string } | null>("get_interface_for_ip", { ip });
}

export async function startCapture(
  name: string,
  description: string | null,
  interfaceName: string,
  filterConfig: FilterConfig
): Promise<string> {
  return invokeTauri<string>("start_capture", {
    name,
    description: description ?? null,
    interface: interfaceName,
    filterConfig,
  });
}

/**
 * Start a capture session with multi-threaded pipeline mode for high-performance capture.
 * This mode can handle 100k+ packets per second with minimal drop.
 */
export async function startCapturePipeline(
  name: string,
  description: string | null,
  interfaceName: string,
  filterConfig: FilterConfig
): Promise<string> {
  return invokeTauri<string>("start_capture_pipeline", {
    name,
    description: description ?? null,
    interface: interfaceName,
    filterConfig,
  });
}

/** Pipeline statistics for high-performance capture mode */
export interface PipelineStats {
  packetsCaptured: number;
  packetsParsed: number;
  packetsWritten: number;
  packetsDroppedCapture: number;
  packetsDroppedParser: number;
  parseErrors: number;
  writeErrors: number;
  // Computed fields for display
  rawQueueSize?: number;
  parsedQueueSize?: number;
}

/**
 * Get pipeline statistics for a running capture session.
 * Returns null if the session is not using pipeline mode.
 */
export async function getPipelineStats(sessionId: string): Promise<PipelineStats | null> {
  return invokeTauri<PipelineStats | null>("get_pipeline_stats", { sessionId });
}

export async function stopCapture(sessionId: string): Promise<void> {
  return invokeTauri<void>("stop_capture", { sessionId });
}

/** High-performance live statistics snapshot */
export interface LiveStatsSnapshot {
  totalPackets: number;
  totalBytes: number;
  packetRate: number;
  byteRate: number;
  protocolCounts: Array<{
    protocol: string;
    count: number;
    bytes: number;
    percentage: number;
  }>;
  topSrcIps: Array<{ ip: string; count: number; percentage: number }>;
  topDstIps: Array<{ ip: string; count: number; percentage: number }>;
  topSrcPorts: Array<{ port: number; count: number; percentage: number }>;
  topDstPorts: Array<{ port: number; count: number; percentage: number }>;
  topIpPairs: Array<{ src: string; dst: string; count: number; percentage: number }>;
  durationSeconds: number;
  firstPacketTime: number | null;
  lastPacketTime: number | null;
}

/**
 * Get high-performance live statistics for a capture session.
 * Uses lock-free DashMap - suitable for high-throughput captures (100k+ pps).
 */
export async function getLiveStatistics(sessionId: string): Promise<LiveStatsSnapshot> {
  return invokeTauri<LiveStatsSnapshot>("get_live_statistics", { sessionId });
}

export async function getCaptureStatistics(sessionId: string): Promise<CaptureStatistics> {
  return invokeTauri<CaptureStatistics>("get_capture_statistics", { sessionId });
}

export async function listCaptureSessions(): Promise<CaptureSession[]> {
  return invokeTauri<CaptureSession[]>("list_capture_sessions", {});
}

export async function getCaptureSession(sessionId: string): Promise<CaptureSession> {
  return invokeTauri<CaptureSession>("get_capture_session", { sessionId });
}

export async function getCaptureCapabilities(): Promise<CaptureCapabilityReport> {
  return invokeTauri<CaptureCapabilityReport>("get_capture_capabilities", {});
}

/** Convenience helper for UI checks in strict-mode aware flows. */
export async function isLocalCaptureEnabled(): Promise<boolean> {
  const capabilities = await getCaptureCapabilities();
  if (capabilities.localCaptureEnabled !== undefined) {
    return capabilities.localCaptureEnabled;
  }
  return capabilities.localCaptureSupported;
}

/** Default packet limit when fetching; backend ring buffer holds up to 500k. */
const DEFAULT_PACKET_LIMIT = 50_000;

/** Max packets to request in one range call (backend cap). */
export const PACKET_RANGE_LIMIT = 50_000;

export async function getCapturePacketCount(sessionId: string): Promise<number> {
  return invokeTauri<number>("get_capture_packet_count", { sessionId });
}

export async function getCapturePacketsRange(
  sessionId: string,
  offset: number,
  limit: number
): Promise<PacketInfo[]> {
  return invokeTauri<PacketInfo[]>("get_capture_packets_range", {
    sessionId,
    offset,
    limit,
  });
}

export async function getCapturePackets(
  sessionId: string,
  limit?: number
): Promise<PacketInfo[]> {
  return invokeTauri<PacketInfo[]>("get_capture_packets", { sessionId, limit: limit ?? DEFAULT_PACKET_LIMIT });
}

export async function loadCaptureSession(
  sessionId: string,
  limit?: number
): Promise<PacketInfo[]> {
  return invokeTauri<PacketInfo[]>("load_capture_session", {
    sessionId,
    limit: limit ?? DEFAULT_PACKET_LIMIT,
  });
}

/** Result from filtered packet query with pagination info */
export interface FilteredPacketsResult {
  packets: PacketInfo[];
  totalCount: number;
  offset: number;
  limit: number;
}

/** Default page size for filtered packet queries */
export const FILTERED_PAGE_SIZE = 1000;

/**
 * Get filtered and sorted packets with server-side pagination.
 * This is the high-performance alternative to loading all packets and filtering in JS.
 */
export async function getFilteredPackets(
  sessionId: string,
  options: {
    filterExpression?: string;
    sortColumn?: string;
    sortAscending?: boolean;
    offset?: number;
    limit?: number;
  } = {}
): Promise<FilteredPacketsResult> {
  return invokeTauri<FilteredPacketsResult>("get_filtered_packets", {
    sessionId,
    filterExpression: options.filterExpression ?? null,
    sortColumn: options.sortColumn ?? null,
    sortAscending: options.sortAscending ?? null,
    offset: options.offset ?? 0,
    limit: options.limit ?? FILTERED_PAGE_SIZE,
  });
}

/**
 * Get count of packets matching a filter (for pagination UI).
 */
export async function getFilteredPacketCount(
  sessionId: string,
  filterExpression?: string
): Promise<number> {
  return invokeTauri<number>("get_filtered_packet_count", {
    sessionId,
    filterExpression: filterExpression ?? null,
  });
}

export async function deleteCaptureSession(sessionId: string): Promise<void> {
  return invokeTauri<void>("delete_capture_session", { sessionId });
}

/** Session cleanup result */
export interface SessionCleanupResult {
  evictedCount: number;
  evictedSessionIds: string[];
  sessionsBefore: number;
  sessionsAfter: number;
  runningSessions: number;
  stoppedSessions: number;
}

/** Cleanup stopped sessions from memory to free resources */
export async function cleanupSessions(): Promise<SessionCleanupResult> {
  return invokeTauri<SessionCleanupResult>("cleanup_sessions");
}

/** Session memory entry */
export interface SessionMemoryEntry {
  id: string;
  name: string;
  status: string;
  packetCount: number;
  stoppedSeconds: number | null;
}

/** Session memory info */
export interface SessionMemoryInfo {
  totalSessions: number;
  maxSessions: number;
  timeoutSeconds: number;
  sessions: SessionMemoryEntry[];
}

/** Get info about sessions currently in memory */
export async function getSessionMemoryInfo(): Promise<SessionMemoryInfo> {
  return invokeTauri<SessionMemoryInfo>("get_session_memory_info");
}

export async function updateCaptureSession(
  sessionId: string,
  updates: { name?: string; description?: string; folderId?: string | null; tags?: string[] }
): Promise<void> {
  // Build params — only include fields that were explicitly provided.
  // For folderId: null means "remove from folder" → send empty string → Rust maps to SQL NULL.
  // For folderId: undefined means "don't change" → send null → Rust skips update.
  const params: Record<string, unknown> = {
    sessionId,
    name: updates.name ?? null,
    description: updates.description ?? null,
    tags: updates.tags ?? null,
  };
  if (updates.folderId !== undefined) {
    params.folderId = updates.folderId ?? "";  // null → "" → Rust sets SQL NULL
  } else {
    params.folderId = null;  // undefined → null → Rust skips
  }
  return invokeTauri<void>("update_capture_session", params);
}

// ── Capture Folder CRUD ──

export async function listCaptureFolders(): Promise<CaptureFolder[]> {
  return invokeTauri<CaptureFolder[]>("list_capture_folders", {});
}

export async function createCaptureFolder(name: string): Promise<CaptureFolder> {
  return invokeTauri<CaptureFolder>("create_capture_folder", { name });
}

export async function renameCaptureFolder(id: string, name: string): Promise<void> {
  return invokeTauri<void>("rename_capture_folder", { id, name });
}

export async function deleteCaptureFolder(id: string): Promise<void> {
  return invokeTauri<void>("delete_capture_folder", { id });
}

export async function reorderCaptureFolders(ids: string[]): Promise<void> {
  return invokeTauri<void>("reorder_capture_folders", { ids });
}

export async function exportPcap(
  sessionId: string,
  outputPath?: string | null
): Promise<string> {
  return invokeTauri<string>("export_pcap", {
    sessionId,
    outputPath: outputPath ?? null,
  });
}

/** Import an external PCAP file. Opens a native file picker, copies into app storage, returns session ID. */
export async function importPcap(name?: string): Promise<string> {
  return invokeTauri<string>("import_pcap", { name: name ?? null });
}

/** Import a PCAP file from a specific file path (used for file association / drag-drop). */
export async function importPcapFromPath(filePath: string): Promise<string> {
  return invokeTauri<string>("import_pcap_from_path", { filePath });
}

/** Import a PCAP from base64-encoded data (used by remote agent tools). Returns session ID. */
export async function importPcapFromBase64(base64Data: string, name: string): Promise<string> {
  return invokeTauri<string>("import_pcap_from_base64", { base64Data, name });
}

/** Check if the app was opened with a file association. Returns and clears pending file paths. */
export async function getPendingFileOpen(): Promise<string[]> {
  return invokeTauri<string[]>("get_pending_file_open", {});
}

export async function getRtpStreams(sessionId: string): Promise<RtpStreamInfo[]> {
  return invokeTauri<RtpStreamInfo[]>("get_rtp_streams", { sessionId });
}

/** Get time-series quality history for a specific RTP stream. */
export async function getRtpStreamHistory(
  sessionId: string,
  ssrc: number
): Promise<RtpStreamHistory | null> {
  return invokeTauri<RtpStreamHistory | null>("get_rtp_stream_history", {
    sessionId,
    ssrc,
  });
}

/** Get time-series quality history for all RTP streams in a session. */
export async function getAllRtpStreamHistories(
  sessionId: string
): Promise<RtpStreamHistory[]> {
  return invokeTauri<RtpStreamHistory[]>("get_all_rtp_stream_histories", {
    sessionId,
  });
}

export async function getSipDialogs(sessionId: string): Promise<SipDialog[]> {
  return invokeTauri<SipDialog[]>("get_sip_dialogs", { sessionId });
}

export async function getCallSessions(sessionId: string): Promise<ReconstructedCallSession[]> {
  return invokeTauri<ReconstructedCallSession[]>("get_call_sessions", { sessionId });
}

function toDiffImpact(value: unknown): CallBehaviorDiffImpact {
  switch (value) {
    case "regression":
    case "improvement":
    case "change":
      return value;
    default:
      return "change";
  }
}

function toDiffCategory(value: unknown): CallBehaviorDiffCategory {
  switch (value) {
    case "headers":
    case "timers":
    case "codecs":
    case "response_codes":
    case "added_calls":
    case "removed_calls":
      return value;
    default:
      return "headers";
  }
}

function toDiffScalar(value: unknown): string | number | boolean | null | undefined {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function responseClass(code: number | null | undefined): number | null {
  if (typeof code !== "number" || !Number.isFinite(code)) return null;
  return Math.floor(code / 100);
}

function impactForResponseChange(beforeCode: number | null, afterCode: number | null, isRegression: boolean): CallBehaviorDiffImpact {
  if (isRegression) return "regression";
  const beforeClass = responseClass(beforeCode);
  const afterClass = responseClass(afterCode);
  if (beforeClass === null || afterClass === null) return "change";
  if (afterClass < beforeClass) return "improvement";
  return "change";
}

function normalizeDiffItems(
  input: unknown,
  fallbackCategory: CallBehaviorDiffCategory
): CallBehaviorDiffItem[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry, index) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const label = row.label ?? row.name ?? row.key ?? row.header ?? row.timer ?? row.codec ?? row.code;
    return {
      id: String(row.id ?? `${fallbackCategory}-${index}`),
      category: toDiffCategory(row.category ?? fallbackCategory),
      impact: toDiffImpact(row.impact ?? row.classification ?? row.kind),
      label: String(label ?? `${fallbackCategory} ${index + 1}`),
      callId: row.callId ? String(row.callId) : row.call_id ? String(row.call_id) : undefined,
      detail: row.detail ? String(row.detail) : row.description ? String(row.description) : undefined,
      beforeValue: toDiffScalar(row.beforeValue ?? row.before_value ?? row.before),
      afterValue: toDiffScalar(row.afterValue ?? row.after_value ?? row.after),
    };
  });
}

function toStringMap(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  const rows = value as Array<Record<string, unknown>>;
  const map: Record<string, string> = {};
  for (const row of rows) {
    const matchId = row.matchId ?? row.match_id;
    const beforeCall = row.beforeCall ?? row.before_call;
    const afterCall = row.afterCall ?? row.after_call;
    const beforeCallObj = beforeCall && typeof beforeCall === "object" ? (beforeCall as Record<string, unknown>) : {};
    const afterCallObj = afterCall && typeof afterCall === "object" ? (afterCall as Record<string, unknown>) : {};
    const beforeCallId = beforeCallObj.callId ?? beforeCallObj.call_id;
    const afterCallId = afterCallObj.callId ?? afterCallObj.call_id;
    if (matchId !== undefined && beforeCallId !== undefined) {
      map[String(matchId)] = String(beforeCallId);
    }
    if (matchId !== undefined && afterCallId !== undefined) {
      map[`after:${String(matchId)}`] = String(afterCallId);
    }
  }
  return map;
}

function normalizeDiffResponse(
  raw: unknown,
  beforeSessionId: string,
  afterSessionId: string
): CallBehaviorDiffResponse {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const summaryObj =
    obj.summary && typeof obj.summary === "object"
      ? (obj.summary as Record<string, unknown>)
      : {};
  const headerChanges = normalizeDiffItems(obj.headerChanges ?? obj.header_changes, "headers");
  const timerChanges = normalizeDiffItems(obj.timerChanges ?? obj.timer_changes, "timers");
  const codecChanges = normalizeDiffItems(
    obj.codecNegotiationChanges ?? obj.codec_negotiation_changes,
    "codecs"
  );
  const responseCodeChanges = normalizeDiffItems(
    obj.responseCodeChanges ?? obj.response_code_changes,
    "response_codes"
  );
  const matchedCallMap = toStringMap(obj.matchedCalls ?? obj.matched_calls);
  const addedCalls = normalizeDiffItems(obj.addedCalls ?? obj.added_calls, "added_calls").map((item) => ({
    ...item,
    afterCallId: item.afterCallId ?? item.callId,
  }));
  const removedCalls = normalizeDiffItems(obj.removedCalls ?? obj.removed_calls, "removed_calls").map((item) => ({
    ...item,
    beforeCallId: item.beforeCallId ?? item.callId,
  }));

  // Backend payload shape: structured change arrays plus aggregate counters.
  const normalizedHeaderChanges = headerChanges.map((item, index) => {
    const row = (obj.headerChanges as Array<Record<string, unknown>> | undefined)?.[index]
      ?? (obj.header_changes as Array<Record<string, unknown>> | undefined)?.[index]
      ?? {};
    const beforeValues = Array.isArray(row.beforeValues) ? row.beforeValues : Array.isArray(row.before_values) ? row.before_values : [];
    const afterValues = Array.isArray(row.afterValues) ? row.afterValues : Array.isArray(row.after_values) ? row.after_values : [];
    const isRegression = Boolean(row.isRegression ?? row.is_regression);
    const matchId = String(row.matchId ?? row.match_id ?? item.id);
    return {
      ...item,
      id: matchId,
      impact: isRegression ? "regression" : "change",
      label: String(row.header ?? item.label),
      beforeCallId: matchedCallMap[matchId],
      afterCallId: matchedCallMap[`after:${matchId}`],
      beforeValue: beforeValues.length > 0 ? beforeValues.join(", ") : item.beforeValue,
      afterValue: afterValues.length > 0 ? afterValues.join(", ") : item.afterValue,
    } satisfies CallBehaviorDiffItem;
  });

  const normalizedTimerChanges = timerChanges.map((item, index) => {
    const row = (obj.timerChanges as Array<Record<string, unknown>> | undefined)?.[index]
      ?? (obj.timer_changes as Array<Record<string, unknown>> | undefined)?.[index]
      ?? {};
    const setupBefore = Number(row.setupDelayBeforeMs ?? row.setup_delay_before_ms);
    const setupAfter = Number(row.setupDelayAfterMs ?? row.setup_delay_after_ms);
    const durationBefore = Number(row.totalDurationBeforeMs ?? row.total_duration_before_ms);
    const durationAfter = Number(row.totalDurationAfterMs ?? row.total_duration_after_ms);
    const isRegression = Boolean(row.isRegression ?? row.is_regression);
    const matchId = String(row.matchId ?? row.match_id ?? item.id);
    const looksImprovement =
      !isRegression
      && (
        (Number.isFinite(setupBefore) && Number.isFinite(setupAfter) && setupAfter < setupBefore)
        || (Number.isFinite(durationBefore) && Number.isFinite(durationAfter) && durationAfter > durationBefore)
      );
    return {
      ...item,
      id: matchId,
      impact: isRegression ? "regression" : looksImprovement ? "improvement" : "change",
      label: "Call timing",
      beforeCallId: matchedCallMap[matchId],
      afterCallId: matchedCallMap[`after:${matchId}`],
      beforeValue: `setup=${Number.isFinite(setupBefore) ? `${setupBefore}ms` : "—"}, duration=${Number.isFinite(durationBefore) ? `${durationBefore}ms` : "—"}`,
      afterValue: `setup=${Number.isFinite(setupAfter) ? `${setupAfter}ms` : "—"}, duration=${Number.isFinite(durationAfter) ? `${durationAfter}ms` : "—"}`,
    } satisfies CallBehaviorDiffItem;
  });

  const normalizedCodecChanges = codecChanges.map((item, index) => {
    const row = (obj.codecNegotiationChanges as Array<Record<string, unknown>> | undefined)?.[index]
      ?? (obj.codec_negotiation_changes as Array<Record<string, unknown>> | undefined)?.[index]
      ?? {};
    const beforeAnswer = Array.isArray(row.answerCodecsBefore) ? row.answerCodecsBefore : Array.isArray(row.answer_codecs_before) ? row.answer_codecs_before : [];
    const afterAnswer = Array.isArray(row.answerCodecsAfter) ? row.answerCodecsAfter : Array.isArray(row.answer_codecs_after) ? row.answer_codecs_after : [];
    const removed = Array.isArray(row.removedCodecs) ? row.removedCodecs : Array.isArray(row.removed_codecs) ? row.removed_codecs : [];
    const added = Array.isArray(row.addedCodecs) ? row.addedCodecs : Array.isArray(row.added_codecs) ? row.added_codecs : [];
    const isRegression = Boolean(row.isRegression ?? row.is_regression);
    const matchId = String(row.matchId ?? row.match_id ?? item.id);
    const looksImprovement = !isRegression && removed.length === 0 && added.length > 0;
    return {
      ...item,
      id: matchId,
      impact: isRegression ? "regression" : looksImprovement ? "improvement" : "change",
      label: "Negotiated codecs",
      beforeCallId: matchedCallMap[matchId],
      afterCallId: matchedCallMap[`after:${matchId}`],
      beforeValue: beforeAnswer.length > 0 ? beforeAnswer.join(", ") : "—",
      afterValue: afterAnswer.length > 0 ? afterAnswer.join(", ") : "—",
      detail: [
        removed.length > 0 ? `Removed: ${removed.join(", ")}` : null,
        added.length > 0 ? `Added: ${added.join(", ")}` : null,
      ].filter(Boolean).join(" · ") || item.detail,
    } satisfies CallBehaviorDiffItem;
  });

  const normalizedResponseCodeChanges = responseCodeChanges.map((item, index) => {
    const row = (obj.responseCodeChanges as Array<Record<string, unknown>> | undefined)?.[index]
      ?? (obj.response_code_changes as Array<Record<string, unknown>> | undefined)?.[index]
      ?? {};
    const beforeCodeRaw = row.beforeCode ?? row.before_code;
    const afterCodeRaw = row.afterCode ?? row.after_code;
    const beforeCode = typeof beforeCodeRaw === "number" ? beforeCodeRaw : null;
    const afterCode = typeof afterCodeRaw === "number" ? afterCodeRaw : null;
    const isRegression = Boolean(row.isRegression ?? row.is_regression);
    const matchId = String(row.matchId ?? row.match_id ?? item.id);
    return {
      ...item,
      id: matchId,
      impact: impactForResponseChange(beforeCode, afterCode, isRegression),
      label: "Final response code",
      beforeCallId: matchedCallMap[matchId],
      afterCallId: matchedCallMap[`after:${matchId}`],
      beforeValue: beforeCode,
      afterValue: afterCode,
    } satisfies CallBehaviorDiffItem;
  });

  const allNormalizedItems = [
    ...normalizedHeaderChanges,
    ...normalizedTimerChanges,
    ...normalizedCodecChanges,
    ...normalizedResponseCodeChanges,
    ...addedCalls,
    ...removedCalls,
  ];
  const improvementCount = allNormalizedItems.filter((item) => item.impact === "improvement").length;

  return {
    beforeSessionId,
    afterSessionId,
    summary: {
      regressions: Number(summaryObj.regressionCount ?? summaryObj.regression_count ?? 0),
      improvements: improvementCount,
      changes:
        Number(summaryObj.headerChangeCount ?? summaryObj.header_change_count ?? 0)
        + Number(summaryObj.timerChangeCount ?? summaryObj.timer_change_count ?? 0)
        + Number(summaryObj.codecChangeCount ?? summaryObj.codec_change_count ?? 0)
        + Number(summaryObj.responseCodeChangeCount ?? summaryObj.response_code_change_count ?? 0)
        + Number(summaryObj.addedCallCount ?? summaryObj.added_call_count ?? 0)
        + Number(summaryObj.removedCallCount ?? summaryObj.removed_call_count ?? 0),
      isComparable: Boolean(summaryObj.isComparable ?? summaryObj.is_comparable ?? true),
      comparableCallRatio: Number(summaryObj.comparableCallRatio ?? summaryObj.comparable_call_ratio ?? 1),
      comparabilityNote: typeof (summaryObj.comparabilityNote ?? summaryObj.comparability_note) === "string"
        ? String(summaryObj.comparabilityNote ?? summaryObj.comparability_note)
        : null,
    },
    headers: normalizedHeaderChanges,
    timers: normalizedTimerChanges,
    codecs: normalizedCodecChanges,
    responseCodes: normalizedResponseCodeChanges,
    addedCalls,
    removedCalls,
  };
}

export async function diffCallBehavior(
  beforeSessionId: string,
  afterSessionId: string
): Promise<CallBehaviorDiffResponse> {
  const raw = await invokeTauri<unknown>("diff_call_behavior", {
    beforeSessionId,
    afterSessionId,
  });
  return normalizeDiffResponse(raw, beforeSessionId, afterSessionId);
}

export async function getSipMessageRaw(
  sessionId: string,
  packetIndex: number
): Promise<string> {
  return invokeTauri<string>("get_sip_message_raw", { sessionId, packetIndex });
}

export async function getPacketRawBytes(
  sessionId: string,
  packetIndex: number
): Promise<number[]> {
  return invokeTauri<number[]>("get_packet_raw_bytes", { sessionId, packetIndex });
}

export async function exportDialogPcapBase64(
  sessionId: string,
  dialogIndex: number
): Promise<{ filename: string; base64: string }> {
  return invokeTauri<{ filename: string; base64: string }>("export_dialog_pcap_base64", {
    sessionId,
    dialogIndex,
  });
}

/** Export dialog PCAP via system save dialog; returns chosen path. */
export async function exportDialogPcapSave(
  sessionId: string,
  dialogIndex: number
): Promise<string> {
  return invokeTauri<string>("export_dialog_pcap_save", {
    sessionId,
    dialogIndex,
  });
}

/** Encode a UTF-8 string as a base64 string (for saveExportFile). */
export function textToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== undefined) binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Show system save dialog and write content (base64) to chosen path. */
export async function saveExportFile(
  defaultName: string,
  contentBase64: string,
  filterName: string,
  extension: string
): Promise<string> {
  return invokeTauri<string>("save_export_file", {
    defaultName,
    contentBase64,
    filterName,
    extension,
  });
}

export async function listScheduledCaptures(): Promise<ScheduledCapture[]> {
  return invokeTauri<ScheduledCapture[]>("list_scheduled_captures", {});
}

export async function createScheduledCapture(
  name: string,
  description: string | null,
  interfaceName: string,
  filterConfig: FilterConfig,
  scheduleType: "one_time" | "recurring",
  scheduledTime: string,
  durationSeconds?: number | null
): Promise<string> {
  return invokeTauri<string>("create_scheduled_capture", {
    name,
    description: description ?? null,
    interface: interfaceName,
    filterConfig,
    scheduleType,
    scheduledTime,
    durationSeconds: durationSeconds ?? null,
  });
}

export async function updateScheduledCapture(
  id: string,
  updates: Partial<ScheduledCapture>
): Promise<void> {
  return invokeTauri<void>("update_scheduled_capture", {
    id,
    name: updates.name ?? null,
    description: updates.description !== undefined ? updates.description : null,
    interface: updates.interface ?? null,
    filterConfig: updates.filterConfig ?? null,
    scheduleType: updates.scheduleType ?? null,
    scheduledTime: updates.scheduledTime ?? null,
    durationSeconds: updates.durationSeconds ?? null,
    enabled: updates.enabled !== undefined ? updates.enabled : null,
  });
}

export async function deleteScheduledCapture(id: string): Promise<void> {
  return invokeTauri<void>("delete_scheduled_capture", { id });
}

export async function reverseDnsLookup(ip: string): Promise<string | null> {
  return invokeTauri<string | null>("reverse_dns_lookup", { ip });
}

export async function createSupportPackage(
  sessionId: string,
  summary: string,
  callId?: string | null
): Promise<string> {
  return invokeTauri<string>("create_support_package", {
    sessionId,
    summary,
    callId: callId ?? null,
  });
}

export async function deletePacketBookmark(bookmarkId: string): Promise<void> {
  return invokeTauri<void>("delete_packet_bookmark", { bookmarkId });
}

export async function deleteSavedFilter(filterId: string): Promise<void> {
  return invokeTauri<void>("delete_saved_filter", { filterId });
}

export interface CallQualityReportResult {
  filename: string;
  contentBase64: string;
  format: string;
}

export async function generateCallQualityReport(
  sessionId: string,
  dialogIndex: number,
  format: "html" = "html"
): Promise<CallQualityReportResult> {
  return invokeTauri<CallQualityReportResult>("generate_call_quality_report", {
    sessionId,
    dialogIndex,
    format,
  });
}

// ============================================================================
// Remote SSH capture
// ============================================================================

import type { RemoteCaptureConfig, SshAuthMethod } from "@/types/packetCapture";

export async function testSshConnection(
  host: string,
  port: number,
  username: string,
  authMethod: SshAuthMethod,
  password?: string,
  keyPath?: string
): Promise<boolean> {
  return invokeTauri<boolean>("test_ssh_connection", {
    host,
    port,
    username,
    authMethod,
    password: password ?? null,
    keyPath: keyPath ?? null,
  });
}

export async function listRemoteInterfaces(
  host: string,
  port: number,
  username: string,
  authMethod: SshAuthMethod,
  password?: string,
  keyPath?: string
): Promise<string[]> {
  return invokeTauri<string[]>("list_remote_interfaces", {
    host,
    port,
    username,
    authMethod,
    password: password ?? null,
    keyPath: keyPath ?? null,
  });
}

export async function startRemoteCapture(
  config: RemoteCaptureConfig
): Promise<string> {
  return invokeTauri<string>("start_remote_capture", { config });
}

export async function stopRemoteCapture(sessionId: string): Promise<void> {
  return invokeTauri<void>("stop_remote_capture", { sessionId });
}

export async function getActiveRemoteSessions(): Promise<string[]> {
  return invokeTauri<string[]>("get_active_remote_sessions", {});
}

// ── Agent capture session management ──

export async function createAgentCaptureSession(
  sessionId: string,
  name: string,
  interfaceName: string
): Promise<void> {
  const payload = {
    sessionId,
    name,
    interfaceName,
  };
  validateIpcPayload("create_agent_capture_session", payload);
  return invokeTauri<void>("create_agent_capture_session", payload);
}

export async function injectAgentRawFrames(
  sessionId: string,
  frames: string[]
): Promise<number> {
  const payload = {
    sessionId,
    frames,
  };
  validateIpcPayload("inject_agent_raw_frames", payload);
  return invokeTauri<number>("inject_agent_raw_frames", payload);
}

export async function injectAgentPacketInfos(
  sessionId: string,
  packets: Record<string, unknown>[]
): Promise<number> {
  const payload = {
    sessionId,
    packets,
  };
  validateIpcPayload("inject_agent_packet_infos", payload);
  return invokeTauri<number>("inject_agent_packet_infos", payload);
}

export async function stopAgentCaptureSession(
  sessionId: string
): Promise<void> {
  const payload = { sessionId };
  validateIpcPayload("stop_agent_capture_session", payload);
  return invokeTauri<void>("stop_agent_capture_session", payload);
}

export async function getExpertFindings(sessionId: string): Promise<ExpertFinding[]> {
  return invokeTauri<ExpertFinding[]>("get_expert_findings", { sessionId });
}
