/**
 * Fax Center types — sent/received fax jobs and session metadata.
 * Stored in the central troubleshooting store; timeline entries can reference these.
 */

/** Session info shared by sent and received faxes (SIP Call-ID, duration, registrar). */
export interface FaxSessionInfo {
  sipCallId: string;
  /** Packet capture session id when a capture is associated with the fax session. */
  captureSessionId?: string;
  durationSeconds?: number;
  registrarId: string;
  registrarName?: string;
  success: boolean;
  /** When the session started (ISO). */
  startedAt: string;
  endedAt?: string;
}

/** A received fax document in the central store. */
export interface ReceivedFax {
  id: string;
  /** Sender number or SIP URI. */
  sender: string;
  /** When the fax was received (ISO). */
  receivedAt: string;
  pageCount: number;
  /** Document: base64 image/PDF or TIFF-F; or path if stored on backend. */
  documentUrl?: string;
  documentFormat?: "image" | "pdf" | "tiff";
  /** Session info for timeline/forensics and Packet Monitor link. */
  session: FaxSessionInfo;
  /** Error message when receive session failed. */
  errorMessage?: string;
  /** Optional thumbnail (base64 or URL). */
  thumbnailUrl?: string;
}

/** Source of a sent fax: uploaded file(s) or prebuilt test. */
export type SentFaxSource = "upload" | "prebuilt_test";

/** Status of a sent fax job. */
export type SentFaxStatus = "pending" | "sending" | "sent" | "failed";

/** A sent fax job in the central store. */
export interface SentFaxPacketMetrics {
  streamCount: number;
  totalPackets: number;
  weightedLoss: number;
  weightedJitter: number;
  weightedMos: number;
  worstLoss: number;
  worstJitter: number;
  capturedAt: string;
}

export interface FaxFolder {
  id: string;
  name: string;
}

/** A sent fax job in the central store. */
export interface SentFaxJob {
  id: string;
  source: SentFaxSource;
  /** Target E.164 or SIP URI. */
  target: string;
  registrarId: string;
  registrarName?: string;
  status: SentFaxStatus;
  pageCount: number;
  /** SIP Call-ID when session is established. */
  sipCallId?: string;
  /** Packet capture session id for this fax call (link to Packet Monitor / troubleshooting). */
  captureSessionId?: string;
  durationSeconds?: number;
  /** When the job was created (ISO). */
  createdAt: string;
  /** When the send completed (ISO). */
  completedAt?: string;
  /** Error message when status is failed. */
  errorMessage?: string;
  /** Prebuilt test doc id when source is prebuilt_test. */
  prebuiltDocId?: string;
  /** Agent name when sent via remote execution (for "via {agentName}" badge). */
  agentName?: string;
  /** File paths when source is upload (for retry). */
  filePaths?: string[];
  /** Data URLs for preview of pages (upload or prebuilt) shown in "Page(s) being sent". */
  previewPages?: string[];
  /** Selected test preset id when source is test-page workflow. */
  sentTestPresetId?: string;
  /** Optional custom brand label used for unbranded test presets. */
  sentBrandLabel?: string;
  /** Transport mode used when send started. */
  sentMode?: "t38" | "g711u";
  /** ECM setting used when send started. */
  sentEcm?: boolean;
  /** Baud rate used when send started. */
  sentBaudRate?: number;
  /** Cached packet quality stats snapshot for persistence and history view fallback. */
  packetMetrics?: SentFaxPacketMetrics;
}

/** Prebuilt test document identifiers for "Send test fax". */
export type PrebuiltTestDocId =
  | "sipalyzer-t38-test"
  | "sipalyzer-gray-scale"
  | "sipalyzer-fine-lines"
  | "sipalyzer-resolution-chart";
