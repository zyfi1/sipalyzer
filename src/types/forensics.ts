/**
 * Forensics: registration health, call quality, root-cause findings.
 * Data from get_registration_health, softphone calls, and packet captures.
 */

/** Per-registrar health from get_registration_health. */
export interface RegistrarHealth {
  registrar_id: string;
  registered: boolean;
  health_score: number | null;
  last_test_time: string | null;
  response_time_ms: number | null;
  uptime_percentage: number | null;
  test_pass_rate: number | null;
  network_quality: "excellent" | "good" | "fair" | "poor" | "unknown";
}

/** Aggregate metrics from get_registration_health. */
export interface RegistrationMetrics {
  average_response_time: number | null;
  test_success_rate: number | null;
  last_successful_registration: string | null;
  network_quality: string;
}

/** Full registration health API response. */
export interface RegistrationHealthResponse {
  registrars: RegistrarHealth[];
  metrics: RegistrationMetrics;
  test_history: Array<{
    timestamp: string;
    success: boolean;
    response_time_ms: number;
    test_type: string;
    registrar_id: string;
  }>;
  recent_results?: Array<{
    timestamp: string;
    registrar_id: string;
    registrar_name: string;
    test_type: string;
    status: "pass" | "fail";
    response_time_ms: number;
  }>;
  time_series_data?: Array<{
    period: string;
    success_rate: number;
    avg_response_time: number;
  }>;
}

/** Call quality summary for forensics (from softphone call + optional RTP from capture). */
export interface CallQualitySummary {
  callId: string;
  target: string;
  startTime: string;
  endTime?: string;
  state: string;
  statusCode?: number;
  statusText?: string;
  errorMessage?: string;
  /** From savedMetrics or RTP stream. */
  mos: number | null;
  jitterMs: number | null;
  lossPercent: number | null;
  /** good | fair | poor */
  qualityTier: "good" | "fair" | "poor" | "unknown";
  captureSessionId?: string | null;
  /** Registrar used for this call (for correlation). */
  registrarId?: string | null;
}

/** Severity of a forensic finding. */
export type FindingSeverity = "critical" | "warning" | "info";

/** How strong the evidence is for a finding or hint. */
export type DiagnosticConfidenceLevel = "high" | "medium" | "low";

/** Why confidence is reduced for a finding or hint. */
export type DiagnosticUncertaintyReasonCode =
  | "insufficient-evidence"
  | "competing-hypotheses"
  | "missing-dialog"
  | "missing-rtp";

export interface DiagnosticUncertaintyReason {
  code: DiagnosticUncertaintyReasonCode;
  message: string;
}

/** Single root-cause or health finding. */
export interface ForensicFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  /** Confidence metadata for user-facing wording. */
  confidenceLevel?: DiagnosticConfidenceLevel;
  /** Normalized 0..1 score behind confidenceLevel. */
  confidenceScore?: number;
  /** Whether uncertainty caveats apply. */
  uncertaintyState?: "certain" | "uncertain";
  /** Human-readable reasons that reduce confidence. */
  uncertaintyReasons?: DiagnosticUncertaintyReason[];
  /** When the issue occurred (ISO). */
  timestamp?: string;
  /** Link: registrar_id, call_id, or capture session_id. */
  link?: {
    type: "registrar" | "call" | "capture" | "fax" | "network";
    id: string;
    label?: string;
  };
}

/** One entry in the combined forensics timeline. */
export interface ForensicsTimelineEntry {
  id: string;
  timestamp: string;
  kind: "registration" | "call" | "call_quality" | "fax_sent" | "fax_received" | "network_test";
  label: string;
  detail?: string;
  success?: boolean;
  /** For registration: registrar_id; for call: call id; for fax: fax job or received fax id. */
  refId?: string;
  /** Call quality tier when kind is call_quality. */
  qualityTier?: "good" | "fair" | "poor" | "unknown";
}

/** Media (RTP) event for call-flow timeline: one segment per stream overlapping the dialog. */
export interface CallFlowMediaEvent {
  startTime: string;
  endTime: string;
  codecName: string;
  mosScore: number;
  streamLabel?: string;
  /** Optional for display in RTP streams section. */
  lossPercent?: number;
  jitterMs?: number;
  packetCount?: number;
  /** Optional for timeline: show direction (e.g. "192.168.1.1:5000 → 192.168.1.2:5002"). */
  srcLabel?: string;
  dstLabel?: string;
}

/** Legacy: SIP dialog from capture (used when drilling into a capture). */
export interface SipDialogMessage {
  methodOrCode: string;
  cseq?: string;
  timestamp: string;
  packetIndex: number;
  /** Index into dialog participants for multi-party ladder. */
  fromParticipantIndex?: number;
  toParticipantIndex?: number;
}

export interface SipDialog {
  callId: string;
  fromTag?: string;
  toTag?: string;
  messages: SipDialogMessage[];
  startTime: string;
  endTime?: string;
  /** Ordered participant identities (From/To) for multi-party ladder. */
  participants?: string[];
}

/** Root-cause hint with evidence and optional KB article link. */
export interface RootCauseHint {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  confidenceLevel: DiagnosticConfidenceLevel;
  /** Normalized 0..1 score used to map confidenceLevel. */
  confidenceScore: number;
  uncertaintyState: "certain" | "uncertain";
  uncertaintyReasons?: DiagnosticUncertaintyReason[];
  evidence?: { type: "packet" | "call" | "time"; value: string; label?: string }[];
  /** ID of the linked KB article for "Learn more" functionality. */
  articleId?: string;
}

// ── CDR Record (Feature 9) ──

/** Call Detail Record generated from SIP dialogs + RTP streams. */
export interface CdrRecord {
  callId: string;
  caller: string; // From URI
  callee: string; // To URI
  startTime: string;
  ringTime?: string;
  connectTime?: string;
  endTime?: string;
  durationSec: number;
  disposition: "answered" | "busy" | "failed" | "cancelled" | "no-answer";
  finalStatusCode: number;
  codec?: string;
  mos?: number;
  jitter?: number;
  packetLoss?: number;
  packetsSent?: number;
  packetsReceived?: number;
  captureSessionId: string;
}

export type ReconstructedCallDisposition =
  | "answered"
  | "busy"
  | "failed"
  | "cancelled"
  | "no-answer"
  | "terminated"
  | "in-progress"
  | "unknown";

export type ReconstructedCallAnomalySeverity = "critical" | "warning" | "info";

export interface ReconstructedCallAnomaly {
  id: string;
  code: string;
  label: string;
  severity: ReconstructedCallAnomalySeverity;
}

export interface ReconstructedCallLegRef {
  id: string;
  dialogIndex?: number;
  callId?: string;
  from?: string;
  to?: string;
}

export interface ReconstructedCallMediaRef {
  id: string;
  ssrc?: number;
  codec?: string;
  srcLabel?: string;
  dstLabel?: string;
}

export interface ReconstructedCallSessionEvent {
  id: string;
  timestamp: string;
  type: string;
  eventType?: string;
  label: string;
  detail?: string;
  callId?: string;
  packetIndex?: number;
  packetIndices?: number[];
  dialogIndex?: number;
  messageIndex?: number;
  mediaSsrc?: number;
}

export interface ReconstructedCallSession {
  id: string;
  captureSessionId: string;
  parties: string[];
  startTime: string;
  endTime?: string | null;
  durationSec?: number | null;
  disposition: ReconstructedCallDisposition;
  anomalies: ReconstructedCallAnomaly[];
  events: ReconstructedCallSessionEvent[];
  legs: ReconstructedCallLegRef[];
  mediaRefs: ReconstructedCallMediaRef[];
}

// ── Audio Quality Issues (Feature 8) ──

export type AudioIssueSeverity = "warning" | "error";
export type AudioIssueType = "silence" | "clipping" | "one-way";

/** An audio quality issue detected in an RTP stream. */
export interface AudioIssue {
  type: AudioIssueType;
  startTimeSec: number;
  durationMs: number;
  severity: AudioIssueSeverity;
  description: string;
}

/** Call trace context when user drills into a specific call (dialog + RTP + registration at call time). */
export interface CallTraceContext {
  source: "softphone" | "capture";
  callId: string;
  sessionId?: string;
  dialog?: SipDialog;
  rtpStreams?: Array<{
    ssrc: number;
    srcIp: string;
    srcPort: number;
    dstIp: string;
    dstPort: number;
    codecName: string;
    packetCount: number;
    lossPercentage: number;
    jitter: number;
    mosScore: number;
    firstPacketTime: string;
    lastPacketTime: string;
  }>;
  registrationAtCall?: {
    registrarId: string;
    registrarName: string;
    success: boolean;
    statusCode: number;
    statusText: string;
    expires?: number;
    timestamp: string;
  };
  softphoneCall?: {
    target: string;
    state: string;
    startTime: string;
    endTime?: string;
    statusCode?: number;
    statusText?: string;
    errorMessage?: string;
    /** Raw SIP INVITE message. */
    requestMessage?: string;
    /** Raw SIP response (e.g. 200 OK). */
    responseMessage?: string;
    /** Negotiated audio codec. */
    negotiatedCodec?: string;
  };
}

// ── Call behavior regression diff ──

export type CallBehaviorDiffCategory =
  | "headers"
  | "timers"
  | "codecs"
  | "response_codes"
  | "added_calls"
  | "removed_calls";

export type CallBehaviorDiffImpact = "regression" | "improvement" | "change";

export interface CallBehaviorDiffItem {
  id: string;
  category: CallBehaviorDiffCategory;
  impact: CallBehaviorDiffImpact;
  /**
   * Human-readable label shown in diff sections.
   * Examples: "P-Asserted-Identity", "INVITE->180", "Call setup timer".
   */
  label: string;
  /**
   * Optional call identifier associated with this change.
   * Useful for added/removed call entries.
   */
  callId?: string;
  /** Optional matched call-id from "before" capture for row-level drill-down. */
  beforeCallId?: string;
  /** Optional matched call-id from "after" capture for row-level drill-down. */
  afterCallId?: string;
  /**
   * Optional detail text from backend; can include normalized context.
   */
  detail?: string;
  /**
   * Value in "before" capture, if available.
   */
  beforeValue?: string | number | boolean | null;
  /**
   * Value in "after" capture, if available.
   */
  afterValue?: string | number | boolean | null;
}

export interface CallBehaviorDiffSummary {
  regressions: number;
  improvements: number;
  changes: number;
  isComparable?: boolean;
  comparableCallRatio?: number;
  comparabilityNote?: string | null;
}

export interface CallBehaviorDiffResponse {
  beforeSessionId: string;
  afterSessionId: string;
  summary: CallBehaviorDiffSummary;
  headers: CallBehaviorDiffItem[];
  timers: CallBehaviorDiffItem[];
  codecs: CallBehaviorDiffItem[];
  responseCodes: CallBehaviorDiffItem[];
  addedCalls: CallBehaviorDiffItem[];
  removedCalls: CallBehaviorDiffItem[];
}

