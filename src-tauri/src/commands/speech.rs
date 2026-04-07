//! Tauri commands for speech recognition (Vosk-based transcription).

use crate::softphone::transcription;
use tauri::command;

/// Check if the speech model is downloaded and return its status.
#[command]
#[tracing::instrument(skip_all)]
pub async fn speech_model_status(
    app_handle: tauri::AppHandle,
) -> Result<transcription::ModelStatus, String> {
    Ok(transcription::model_status(&app_handle))
}

/// Ensure the speech model is downloaded. Downloads from CDN if not present.
/// Returns the path to the model directory.
#[command]
#[tracing::instrument(skip_all)]
pub async fn speech_ensure_model(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Run in blocking thread since the download can take a while
    tokio::task::spawn_blocking(move || transcription::ensure_model(&app_handle))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Start live transcription for an active call.
/// The call must already have media running. Results are streamed via `speech:transcript` events.
#[command]
#[tracing::instrument(skip_all)]
pub async fn speech_start_transcription(
    call_id: String,
    sample_rate: u32,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Load model and start transcription in a blocking thread (model loading can be slow)
    let app = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        transcription::start_transcription(call_id, sample_rate, app)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Stop live transcription for a call.
#[command]
#[tracing::instrument(skip_all)]
pub async fn speech_stop_transcription(call_id: String) -> Result<(), String> {
    transcription::stop_transcription(&call_id);
    Ok(())
}

/// Transcribe a saved recording file. Results are streamed via `speech:recording_transcript` events.
/// The request_id is used to correlate events with the request.
#[command]
#[tracing::instrument(skip_all)]
pub async fn speech_transcribe_recording(
    filename: String,
    request_id: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Read the recording WAV data
    let wav_data = crate::softphone::read_recording_data(&filename)
        .map_err(|e| format!("Failed to read recording: {}", e))?;

    let app = app_handle.clone();
    tokio::task::spawn_blocking(move || transcription::transcribe_wav(&wav_data, &app, &request_id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}
