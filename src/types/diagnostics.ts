import type { SipDialog } from "@/types/forensics";
import type { CaptureSession, RtpStreamInfo } from "@/types/packetCapture";

export type DiagnosticsDomain =
  | "ucaas"
  | "sip"
  | "rtp"
  | "fax"
  | "network"
  | "cross_domain";

export type DiagnosticsSeverity = "critical" | "warning" | "info";

export type DiagnosticsCategory =
  | "signaling"
  | "media"
  | "network"
  | "security"
  | "performance"
  | "fax";

export interface DiagnosticsEvidence {
  id: string;
  type: "packet" | "sip_dialog" | "rtp_stream" | "metric" | "session" | "timestamp";
  label: string;
  value: string;
  packetIndices?: number[];
}

export interface DiagnosticsRemediationReference {
  id: string;
  title: string;
}

export interface DiagnosticsFinding {
  id: string;
  ruleId: string;
  domain: DiagnosticsDomain;
  category: DiagnosticsCategory;
  severity: DiagnosticsSeverity;
  confidenceScore: number;
  title: string;
  description: string;
  relatedCallId?: string;
  firstSeen: string;
  lastSeen: string;
  evidence: DiagnosticsEvidence[];
  remediation?: DiagnosticsRemediationReference;
}

export interface DiagnosticsExplanation {
  summary: string;
  impact: string;
  why: string;
  furtherChecks?: string[];
}

export interface DiagnosticsReport {
  sessionId: string;
  generatedAt: string;
  findings: DiagnosticsFinding[];
}

export interface DiagnosticsInput {
  session: CaptureSession;
  dialogs: SipDialog[];
  rtpStreams: RtpStreamInfo[];
}

