/**
 * Speech recognition API — typed wrappers for Vosk transcription backend commands.
 */

import { invokeTauri } from "./invoke";

export interface ModelStatus {
  downloaded: boolean;
  path: string | null;
  size_mb: number | null;
  model_name: string;
}

/** Check if the speech model is downloaded. */
export async function speechModelStatus(): Promise<ModelStatus> {
  return invokeTauri<ModelStatus>("speech_model_status");
}

/** Ensure the speech model is downloaded. Returns the model path. */
export async function speechEnsureModel(): Promise<string> {
  return invokeTauri<string>("speech_ensure_model");
}

/** Start live transcription for a call. */
export async function speechStartTranscription(
  callId: string,
  sampleRate: number
): Promise<void> {
  return invokeTauri<void>("speech_start_transcription", {
    call_id: callId,
    sample_rate: sampleRate,
  });
}

/** Stop live transcription for a call. */
export async function speechStopTranscription(callId: string): Promise<void> {
  return invokeTauri<void>("speech_stop_transcription", { call_id: callId });
}

/** Transcribe a saved recording. Results stream via speech:recording_transcript events. */
export async function speechTranscribeRecording(
  filename: string,
  requestId: string
): Promise<string> {
  return invokeTauri<string>("speech_transcribe_recording", {
    filename,
    request_id: requestId,
  });
}
