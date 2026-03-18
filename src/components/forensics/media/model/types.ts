import type { SipDialog } from "@/types/forensics";
import type { ExpertFinding, RtpStreamInfo } from "@/types/packetCapture";

export interface MediaSummary {
  avgMos: number | null;
  avgLoss: number | null;
  avgJitter: number | null;
  degradedStreams: number;
}

export interface MediaHealth {
  label: string;
  tone: string;
}

export interface MediaInvestigationModel {
  streamsForTable: RtpStreamInfo[];
  prioritizedStreams: RtpStreamInfo[];
  consolidatedStreams: RtpStreamInfo[];
  findingsByStream: Map<string, ExpertFinding[]>;
  mediaSummary: MediaSummary;
  mediaHealth: MediaHealth;
  selectedDialogSupportsMedia: boolean;
  hasMediaForSelectedCall: boolean;
}

export interface UseMediaInvestigationModelInput {
  selectedDialog: SipDialog | null;
  rtpStreams: RtpStreamInfo[];
  expertFindings: ExpertFinding[];
}

export function getRtpStreamKey(stream: RtpStreamInfo): string {
  return `${stream.ssrc}|${stream.srcIp}:${stream.srcPort}->${stream.dstIp}:${stream.dstPort}`;
}
