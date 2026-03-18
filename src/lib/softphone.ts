/**
 * Softphone API: place call, end call, cancel, hold; start/stop media.
 * Re-exports from central API layer; frontend-only types (Call, CallSavedMetrics) stay here.
 */

import * as softphoneApi from "@/api/softphone";
import { playRecordingOnAnnouncement } from "@/lib/recordingAnnouncement";

export type { PlaceCallResult, AudioDevice, RecordingInfo } from "@/api/softphone";

/** A single line of live transcription output. */
export interface TranscriptLine {
  speaker: "local" | "remote";
  text: string;
  timestamp: string;
  isFinal: boolean;
}

/** A single SIP message log entry emitted by the backend. */
export interface SipLogEntry {
  call_id: string;
  direction: "send" | "recv";
  method: string;
  status_code: number;
  summary: string;
  raw: string;
  timestamp: string;
}

/** Final RTP metrics snapshot saved when a call ends, for display in call history. */
export interface CallSavedMetrics {
  mos: number;
  jitter_ms: number;
  send_peak: number;
  recv_peak: number;
  loss_percent: number;
  lost_packets: number;
}

export interface Call {
  id: string;
  target: string;
  state: "connecting" | "ringing" | "active" | "on-hold" | "ended" | "failed";
  startTime: string;
  endTime?: string;
  muted?: boolean;
  sipCallId?: string;
  fromTag?: string;
  toTag?: string | null;
  responseToHeader?: string | null;
  targetUri?: string;
  remoteContactUri?: string | null;
  negotiatedCodec?: string;
  negotiatedPt?: number;
  remoteRtpAddress?: string;
  remoteRtpPort?: number;
  statusCode?: number;
  statusText?: string;
  responseTimeMs?: number;
  requestMessage?: string;
  responseMessage?: string;
  errorMessage?: string;
  localRtpPort?: number;
  localIp?: string | null;
  audioError?: string;
  dialogCSeq?: number;
  savedMetrics?: CallSavedMetrics;
  savedJitterHistory?: { t: number[]; j: number[] };
  savedMetricsHistory?: { t: number; mos: number; jitter_ms: number; loss_percent: number }[];
  holdEvents?: { at: string; type: "hold" | "resume" }[];
  muteEvents?: { at: string; type: "mute" | "unmute" }[];
  transferredTo?: string;
  captureSessionId?: string | null;
  isInbound?: boolean;
  registrarId?: string | null;
  transcriptionEnabled?: boolean;
  transcription?: TranscriptLine[];
  sipLog?: SipLogEntry[];
  dtmfDigits?: { digit: string; direction: "send" | "recv"; timestamp: string }[];
  /** Conference ID if this call is part of a local conference. */
  conferenceId?: string | null;
  /** Remote agent call context -- set when call is placed via agent. */
  remoteAgentId?: string;
  /** Remote agent command ID -- for tracking progress and hangup. */
  remoteCommandId?: string;
  /** Remote agent call PCAP data (base64). */
  remotePcapBase64?: string | null;
  /** Remote agent name for display. */
  remoteAgentName?: string;
}

export const JITTER_BUFFER_DEFAULT_MIN_MS = 40;
export const JITTER_BUFFER_DEFAULT_MAX_MS = 200;
export const JITTER_BUFFER_MIN_MS = 20;
export const JITTER_BUFFER_MAX_MS = 500;

export const placeCall = softphoneApi.placeCall;
export const endCall = softphoneApi.endCall;
export const cancelCall = softphoneApi.cancelCall;
export const holdCall = softphoneApi.holdCall;
export const startMedia = softphoneApi.startMedia;
export const stopMedia = softphoneApi.stopMedia;
export const getRemoteEndedCalls = softphoneApi.getRemoteEndedCalls;
export const startInboundListener = softphoneApi.startInboundListener;
export const stopInboundListener = softphoneApi.stopInboundListener;
export const syncInboundListeners = softphoneApi.syncInboundListeners;
export const answerInboundCall = softphoneApi.answerInboundCall;
export const rejectInboundCall = softphoneApi.rejectInboundCall;
export const setMuted = softphoneApi.setMuted;
export const setAudioDevices = softphoneApi.setAudioDevices;
export const setInputGain = softphoneApi.setInputGain;
export const getCallMetrics = softphoneApi.getCallMetrics;
export const listAudioInputDevices = softphoneApi.listAudioInputDevices;
export const listAudioOutputDevices = softphoneApi.listAudioOutputDevices;
export const getCallJitterHistory = softphoneApi.getCallJitterHistory;
export const getCallWaveform = softphoneApi.getCallWaveform;
export const sendDtmf = softphoneApi.sendDtmf;
export const sendRefer = softphoneApi.sendRefer;
export const sendAttendedRefer = softphoneApi.sendAttendedRefer;

export async function startRecording(callId: string): Promise<string> {
  playRecordingOnAnnouncement();
  return softphoneApi.startRecording(callId);
}

export const stopRecording = softphoneApi.stopRecording;
export const isRecording = softphoneApi.isRecording;
export const listRecordings = softphoneApi.listRecordings;
export const deleteRecording = softphoneApi.deleteRecording;
export const readRecordingData = softphoneApi.readRecordingData;
export const subscribeMwi = softphoneApi.subscribeMwi;
export const unsubscribeMwi = softphoneApi.unsubscribeMwi;
export const getMwiState = softphoneApi.getMwiState;
export type { MwiState, BlfState } from "@/api/softphone";
export const subscribeBLF = softphoneApi.subscribeBLF;
export const unsubscribeBLF = softphoneApi.unsubscribeBLF;
export const getBlfState = softphoneApi.getBlfState;
export const sendSipMessage = softphoneApi.sendSipMessage;
export const publishPresence = softphoneApi.publishPresence;
export const unpublishPresence = softphoneApi.unpublishPresence;
export const joinConference = softphoneApi.joinConference;
export const leaveConference = softphoneApi.leaveConference;
export const startOptionsKeepalive = softphoneApi.startOptionsKeepalive;
export const stopOptionsKeepalive = softphoneApi.stopOptionsKeepalive;
