/**
 * Softphone API — typed wrappers for all softphone backend commands.
 */

import { invokeTauri } from "./invoke";

export interface PlaceCallResult {
  ok: boolean;
  call_id: string;
  from_tag: string;
  to_tag: string | null;
  response_to_header: string | null;
  target_uri: string;
  remote_contact_uri: string | null;
  status_code: number;
  status_text: string;
  response_time_ms: number;
  request_message: string;
  response_message: string;
  local_rtp_port: number;
  local_ip: string | null;
  remote_rtp_address: string | null;
  remote_rtp_port: number | null;
  negotiated_codec: string | null;
  negotiated_pt: number | null;
  dialog_cseq: number;
  capture_session_id?: string | null;
}

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export async function placeCall(
  registrarId: string,
  target: string,
  preferredCodecs?: string[],
  pendingCallId?: string | null
): Promise<PlaceCallResult> {
  return invokeTauri<PlaceCallResult>("softphone_place_call", {
    registrarId,
    target,
    preferredCodecs: preferredCodecs ?? undefined,
    pendingCallId: pendingCallId ?? undefined,
  });
}

export async function endCall(
  registrarId: string,
  callId: string,
  fromTag: string,
  toTag: string,
  targetUri: string,
  remoteContactUri: string | null,
  responseToHeader: string | null,
  cseq: number
): Promise<void> {
  return invokeTauri<void>("softphone_end_call", {
    registrarId,
    callId,
    fromTag,
    toTag,
    targetUri,
    remoteContactUri: remoteContactUri ?? null,
    responseToHeader: responseToHeader ?? null,
    cseq,
  });
}

export async function cancelCall(
  registrarId: string,
  callId: string,
  fromTag: string,
  targetUri: string
): Promise<void> {
  return invokeTauri<void>("softphone_cancel_call", {
    registrarId,
    callId,
    fromTag,
    targetUri,
  });
}

export async function holdCall(
  registrarId: string,
  callId: string,
  fromTag: string,
  toTag: string,
  targetUri: string,
  remoteContactUri: string | null,
  onHold: boolean,
  cseq: number,
  callLocalRtpPort?: number | null,
  callLocalIp?: string | null
): Promise<number> {
  return invokeTauri<number>("softphone_hold_call", {
    registrarId,
    callId,
    fromTag,
    toTag,
    targetUri,
    remoteContactUri: remoteContactUri ?? null,
    onHold,
    cseq,
    callLocalRtpPort: callLocalRtpPort ?? undefined,
    callLocalIp: callLocalIp ?? undefined,
  });
}

export async function startMedia(
  callId: string,
  localRtpPort: number,
  remoteRtpAddress: string,
  remoteRtpPort: number,
  inputDeviceId: string | null,
  outputDeviceId: string | null,
  jitterBufferMinMs: number,
  jitterBufferMaxMs: number,
  negotiatedCodec?: string,
  negotiatedPt?: number,
  mohPreset?: string,
  inputGain?: number
): Promise<void> {
  return invokeTauri<void>("softphone_start_media", {
    callId,
    localRtpPort,
    remoteRtpAddress,
    remoteRtpPort,
    inputDeviceId,
    outputDeviceId,
    jitterBufferMinMs,
    jitterBufferMaxMs,
    negotiatedCodec: negotiatedCodec ?? null,
    negotiatedPt: negotiatedPt ?? null,
    mohPreset: mohPreset ?? null,
    inputGain: inputGain ?? null,
  });
}

export async function setInputGain(callId: string, inputGain: number): Promise<void> {
  return invokeTauri<void>("softphone_set_input_gain", { callId, inputGain });
}

export async function stopMedia(callId: string): Promise<void> {
  return invokeTauri<void>("softphone_stop_media", { callId });
}

export async function getRemoteEndedCalls(): Promise<string[]> {
  return invokeTauri<string[]>("softphone_get_remote_ended_calls", {});
}

export async function startInboundListener(port: number): Promise<void> {
  return invokeTauri<void>("softphone_start_inbound_listener", { port });
}

export async function stopInboundListener(): Promise<void> {
  return invokeTauri<void>("softphone_stop_inbound_listener", {});
}

export async function syncInboundListeners(ports: number[]): Promise<void> {
  return invokeTauri<void>("softphone_sync_inbound_listeners", { ports });
}

export async function answerInboundCall(
  registrarId: string,
  callId: string
): Promise<string | null> {
  return invokeTauri<string | null>("softphone_answer_inbound_call", { registrarId, callId });
}

export async function rejectInboundCall(
  callId: string,
  statusCode?: number
): Promise<void> {
  return invokeTauri<void>("softphone_reject_inbound_call", {
    callId,
    statusCode: statusCode ?? 486,
  });
}

export async function setMuted(callId: string, muted: boolean): Promise<void> {
  return invokeTauri<void>("softphone_set_muted", { callId, muted });
}

export async function setAudioDevices(
  callId: string,
  inputDeviceId: string | null,
  outputDeviceId: string | null
): Promise<void> {
  return invokeTauri<void>("softphone_set_audio_devices", {
    callId,
    inputDeviceId,
    outputDeviceId,
  });
}

export async function getCallMetrics(callId: string): Promise<{
  mos: number;
  jitter_ms: number;
  send_peak: number;
  recv_peak: number;
  loss_percent: number;
  lost_packets: number;
}> {
  return invokeTauri("softphone_get_call_metrics", { callId });
}

export async function listAudioInputDevices(): Promise<AudioDevice[]> {
  return invokeTauri<AudioDevice[]>("list_audio_input_devices", {});
}

export async function listAudioOutputDevices(): Promise<AudioDevice[]> {
  return invokeTauri<AudioDevice[]>("list_audio_output_devices", {});
}

export async function getCallJitterHistory(
  callId: string
): Promise<{ timestamps_sec: number[]; jitter_ms: number[] }> {
  return invokeTauri("softphone_get_call_jitter_history", { callId });
}

export async function getCallWaveform(
  callId: string
): Promise<{ send: number[]; recv: number[] }> {
  return invokeTauri("softphone_get_call_waveform", { callId });
}

export async function sendDtmf(
  callId: string,
  digit: string,
  dtmfPt?: number
): Promise<void> {
  return invokeTauri<void>("softphone_send_dtmf", { callId, digit, dtmfPt: dtmfPt ?? 101 });
}

// ── REFER Transfer ──

export async function sendRefer(
  registrarId: string,
  callId: string,
  fromTag: string,
  toTag: string,
  targetUri: string,
  remoteContactUri: string | null,
  responseToHeader: string | null,
  cseq: number,
  referTo: string,
): Promise<number> {
  return invokeTauri<number>("softphone_send_refer", {
    registrarId,
    callId,
    fromTag,
    toTag,
    targetUri,
    remoteContactUri: remoteContactUri ?? null,
    responseToHeader: responseToHeader ?? null,
    cseq,
    referTo,
  });
}

export async function sendAttendedRefer(
  registrarId: string,
  callIdA: string,
  fromTagA: string,
  toTagA: string,
  targetUriA: string,
  remoteContactUriA: string | null,
  responseToHeaderA: string | null,
  cseqA: number,
  callIdB: string,
  fromTagB: string,
  toTagB: string,
  targetB: string,
): Promise<number> {
  return invokeTauri<number>("softphone_send_attended_refer", {
    registrarId,
    callIdA,
    fromTagA,
    toTagA,
    targetUriA,
    remoteContactUriA: remoteContactUriA ?? null,
    responseToHeaderA: responseToHeaderA ?? null,
    cseqA,
    callIdB,
    fromTagB,
    toTagB,
    targetB,
  });
}

// ── Recording ──

export interface RecordingInfo {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: string;
  call_id_prefix: string;
}

export async function startRecording(callId: string): Promise<string> {
  return invokeTauri<string>("softphone_start_recording", { callId });
}

export async function stopRecording(callId: string): Promise<string> {
  return invokeTauri<string>("softphone_stop_recording", { callId });
}

export async function isRecording(callId: string): Promise<boolean> {
  return invokeTauri<boolean>("softphone_is_recording", { callId });
}

export async function listRecordings(): Promise<RecordingInfo[]> {
  return invokeTauri<RecordingInfo[]>("softphone_list_recordings", {});
}

export async function deleteRecording(filename: string): Promise<void> {
  return invokeTauri<void>("softphone_delete_recording", { filename });
}

/** Read raw WAV data for a recording, returned as base64. */
export async function readRecordingData(filename: string): Promise<string> {
  return invokeTauri<string>("softphone_read_recording", { filename });
}

// ── MWI (Message Waiting Indicator) ──

export interface MwiState {
  registrar_id: string;
  messages_waiting: boolean;
  new_count: number;
  old_count: number;
  urgent_new: number;
  urgent_old: number;
  voicemail_uri: string | null;
}

export async function subscribeMwi(registrarId: string): Promise<void> {
  return invokeTauri<void>("softphone_subscribe_mwi", { registrarId });
}

export async function unsubscribeMwi(registrarId: string): Promise<void> {
  return invokeTauri<void>("softphone_unsubscribe_mwi", { registrarId });
}

export async function getMwiState(registrarId: string): Promise<MwiState | null> {
  return invokeTauri<MwiState | null>("softphone_get_mwi_state", { registrarId });
}

// ── Media Port Allocator ──

export interface PortAllocatorStatus {
  range_low: number;
  range_high: number;
  in_use_count: number;
  /** Each entry: [port, label]. */
  ports_in_use: [number, string][];
}

/** Get the current port allocator status (range, ports in use). */
export async function getMediaPortStatus(): Promise<PortAllocatorStatus> {
  return invokeTauri<PortAllocatorStatus>("get_media_port_status");
}

// ── BLF ──

export interface BlfState {
  extension: string;
  registrar_id: string;
  state: string;
  direction: string | null;
  remote_party: string | null;
}

export async function subscribeBLF(registrarId: string, extension: string): Promise<void> {
  return invokeTauri<void>("subscribe_blf", { registrarId, extension });
}

export async function unsubscribeBLF(registrarId: string, extension: string): Promise<void> {
  return invokeTauri<void>("unsubscribe_blf", { registrarId, extension });
}

export async function getBlfState(registrarId: string, extension: string): Promise<BlfState | null> {
  return invokeTauri<BlfState | null>("get_blf_state", { registrarId, extension });
}

// ── SIP MESSAGE ──

export async function sendSipMessage(registrarId: string, target: string, body: string, contentType?: string): Promise<void> {
  return invokeTauri<void>("send_sip_message", { registrarId, target, body, contentType: contentType ?? null });
}

// ── Presence PUBLISH ──

export async function publishPresence(registrarId: string, state: string, sipIfMatch?: string): Promise<string | null> {
  return invokeTauri<string | null>("publish_presence", { registrarId, state, sipIfMatch: sipIfMatch ?? null });
}

export async function unpublishPresence(registrarId: string, sipIfMatch: string): Promise<void> {
  return invokeTauri<void>("unpublish_presence", { registrarId, sipIfMatch });
}

// ── Conference Mixing ──

export async function joinConference(callId: string, conferenceId: string): Promise<void> {
  return invokeTauri<void>("join_conference", { callId, conferenceId });
}

export async function leaveConference(callId: string): Promise<void> {
  return invokeTauri<void>("leave_conference", { callId });
}

// ── OPTIONS Keepalive ──

export async function startOptionsKeepalive(registrarId: string): Promise<void> {
  return invokeTauri<void>("start_options_keepalive", { registrarId });
}

export async function stopOptionsKeepalive(registrarId: string): Promise<void> {
  return invokeTauri<void>("stop_options_keepalive", { registrarId });
}
