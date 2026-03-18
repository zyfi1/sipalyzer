//! Live call transcription and recording transcription using Vosk offline speech recognition.
//!
//! Architecture:
//! - A single Vosk `Model` is loaded lazily and shared across all calls.
//! - Per-call: two `Recognizer`s (send + recv), each fed from an mpsc channel.
//! - A dedicated thread per call drains both channels, feeds Vosk, and emits
//!   Tauri events with partial/final transcript lines.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::Emitter;
use vosk::{CompleteResult, DecodingState, Model, Recognizer};

// ── Statics ──────────────────────────────────────────────────────────────────

/// Loaded Vosk model (lazy, shared across all calls).
static VOSK_MODEL: Lazy<Mutex<Option<Arc<Model>>>> = Lazy::new(|| Mutex::new(None));

/// Per-call transcription state, keyed by SIP Call-ID.
static TRANSCRIBERS: Lazy<Mutex<HashMap<String, TranscriberHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ── Types ────────────────────────────────────────────────────────────────────

struct TranscriberHandle {
    shutdown: Arc<AtomicBool>,
    send_tx: mpsc::SyncSender<Vec<i16>>,
    recv_tx: mpsc::SyncSender<Vec<i16>>,
}

#[derive(Clone, Serialize)]
pub struct TranscriptEvent {
    #[serde(rename = "callId")]
    pub call_id: String,
    /// "local" (our mic) or "remote" (far end)
    pub speaker: String,
    pub text: String,
    #[serde(rename = "isFinal")]
    pub is_final: bool,
    pub timestamp: String,
}

#[derive(Clone, Serialize)]
pub struct RecordingTranscriptEvent {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub text: String,
    #[serde(rename = "isFinal")]
    pub is_final: bool,
    /// 0.0 - 1.0
    pub progress: f64,
}

#[derive(Clone, Serialize)]
pub struct ModelStatus {
    pub downloaded: bool,
    pub path: Option<String>,
    pub size_mb: Option<f64>,
    pub model_name: String,
}

// ── Model Management ─────────────────────────────────────────────────────────

const MODEL_NAME: &str = "vosk-model-small-en-us-0.15";

fn model_looks_valid(path: &std::path::Path) -> bool {
    path.exists() && path.join("conf").join("model.conf").exists()
}

/// Build likely model locations for both dev and bundled runtime layouts.
fn model_candidates(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;

    let mut candidates: Vec<PathBuf> = Vec::new();

    // Production/runtime: Tauri bundle resources are generally under resource_dir.
    if let Ok(rd) = app_handle.path().resource_dir() {
        candidates.push(rd.join(MODEL_NAME));
        candidates.push(rd.join("resources").join(MODEL_NAME));
    }

    // Build/dev layouts: handle nested toolchain and workspace variants.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut cursor: Option<&std::path::Path> = Some(manifest_dir.as_path());
    for _ in 0..=3 {
        if let Some(dir) = cursor {
            candidates.push(dir.join("resources").join(MODEL_NAME));
            candidates.push(dir.join("src-tauri").join("resources").join(MODEL_NAME));
            cursor = dir.parent();
        } else {
            break;
        }
    }

    // Runtime fallback from executable path.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("resources").join(MODEL_NAME));
            candidates.push(exe_dir.join(MODEL_NAME));
            candidates.push(exe_dir.join("../Resources").join(MODEL_NAME));
            candidates.push(exe_dir.join("../../Resources").join(MODEL_NAME));
        }
    }

    // Keep ordering stable but remove duplicates.
    let mut deduped = Vec::new();
    for path in candidates {
        if !deduped.iter().any(|p: &PathBuf| p == &path) {
            deduped.push(path);
        }
    }
    deduped
}

/// Resolve the bundled Vosk model directory.
fn resolve_model_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let candidates = model_candidates(app_handle);
    for path in &candidates {
        if model_looks_valid(path) {
            tracing::info!("Found bundled model at {}", path.display());
            return Ok(path.clone());
        }
    }
    Err(format!("Vosk model not found in candidate paths: {:?}", candidates))
}

/// Check model status using the same resolver used by transcription startup.
pub fn model_status(app_handle: &tauri::AppHandle) -> ModelStatus {
    let resolved = resolve_model_path(app_handle).ok();
    let found = resolved
        .as_ref()
        .map(|p| model_looks_valid(p))
        .unwrap_or(false);
    ModelStatus {
        downloaded: found,
        path: resolved.as_ref().map(|p| p.to_string_lossy().to_string()),
        size_mb: resolved
            .as_ref()
            .and_then(|p| dir_size(p).map(|b| b as f64 / (1024.0 * 1024.0)).ok()),
        model_name: MODEL_NAME.to_string(),
    }
}

fn dir_size(path: &std::path::Path) -> std::io::Result<u64> {
    let mut total = 0u64;
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if meta.is_dir() {
                total += dir_size(&entry.path())?;
            } else {
                total += meta.len();
            }
        }
    }
    Ok(total)
}

/// Ensure the model is available. Since it's bundled, this just resolves the path.
pub fn ensure_model(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let model_path = resolve_model_path(app_handle)?;
    Ok(model_path.to_string_lossy().to_string())
}

/// Load the Vosk model into memory (or return cached).
fn get_or_load_model(app_handle: &tauri::AppHandle) -> Result<Arc<Model>, String> {
    let mut guard = VOSK_MODEL.lock().map_err(|e| e.to_string())?;
    if let Some(ref m) = *guard {
        return Ok(Arc::clone(m));
    }

    let model_path = resolve_model_path(app_handle)?;
    let model_path = model_path.to_string_lossy().to_string();
    tracing::info!("Loading Vosk model from {}", model_path);

    // Suppress Vosk's verbose logging
    vosk::set_log_level(vosk::LogLevel::Error);

    let model = Model::new(&model_path)
        .ok_or_else(|| format!("Failed to load Vosk model from {}", model_path))?;
    let arc = Arc::new(model);
    *guard = Some(Arc::clone(&arc));
    tracing::info!("Model loaded successfully");
    Ok(arc)
}

fn remove_transcriber(call_id: &str) {
    if let Ok(mut map) = TRANSCRIBERS.lock() {
        map.remove(call_id);
    }
}

// ── Live Call Transcription ──────────────────────────────────────────────────

/// Start live transcription for a call. Creates two Vosk recognizers (send + recv)
/// and spawns a thread to process audio and emit events.
pub fn start_transcription(
    call_id: String,
    sample_rate: u32,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let model = get_or_load_model(&app_handle)?;

    // Prefer the media engine's active codec rate when available. This avoids
    // recognizer mismatch if frontend codec labels are stale or non-standard.
    let media_sample_rate = super::media_engine::get_call_codec_sample_rate(&call_id);
    if media_sample_rate.is_none() {
        return Err(format!(
            "No active media stream for call_id={} (start media before transcription)",
            call_id
        ));
    }
    let effective_sample_rate = media_sample_rate.unwrap_or(sample_rate).clamp(8000, 48000);

    let mut map = TRANSCRIBERS.lock().map_err(|e| e.to_string())?;
    // Recover from stale entries by replacing an existing handle for this call.
    if let Some(existing) = map.remove(&call_id) {
        existing.shutdown.store(true, Ordering::Relaxed);
    }

    // Bounded channels — if transcription falls behind, audio frames are dropped
    let (send_tx, send_rx) = mpsc::sync_channel::<Vec<i16>>(50);
    let (recv_tx, recv_rx) = mpsc::sync_channel::<Vec<i16>>(50);
    let shutdown = Arc::new(AtomicBool::new(false));

    let handle = TranscriberHandle {
        shutdown: Arc::clone(&shutdown),
        send_tx,
        recv_tx,
    };
    map.insert(call_id.clone(), handle);
    drop(map);

    let call_id_thread = call_id.clone();
    let sr = effective_sample_rate as f32;
    let (startup_tx, startup_rx) = mpsc::sync_channel::<Result<(), String>>(1);

    thread::spawn(move || {
        run_transcription_loop(
            call_id_thread,
            sr,
            &model,
            send_rx,
            recv_rx,
            shutdown,
            app_handle,
            startup_tx,
        );
    });

    match startup_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            remove_transcriber(&call_id);
            return Err(e);
        }
        Err(_) => {
            remove_transcriber(&call_id);
            return Err("Transcription engine startup timed out".to_string());
        }
    }

    tracing::info!(
        "Started for call_id={} at {}Hz (requested {}Hz)",
        call_id,
        effective_sample_rate,
        sample_rate
    );
    Ok(())
}

fn run_transcription_loop(
    call_id: String,
    sample_rate: f32,
    model: &Model,
    send_rx: mpsc::Receiver<Vec<i16>>,
    recv_rx: mpsc::Receiver<Vec<i16>>,
    shutdown: Arc<AtomicBool>,
    app_handle: tauri::AppHandle,
    startup_tx: mpsc::SyncSender<Result<(), String>>,
) {
    let mut send_rec = match Recognizer::new(model, sample_rate) {
        Some(r) => r,
        None => {
            let msg = format!("Failed to create send recognizer at {}Hz", sample_rate);
            tracing::error!("{}", msg);
            let _ = startup_tx.send(Err(msg));
            remove_transcriber(&call_id);
            return;
        }
    };
    let mut recv_rec = match Recognizer::new(model, sample_rate) {
        Some(r) => r,
        None => {
            let msg = format!("Failed to create recv recognizer at {}Hz", sample_rate);
            tracing::error!("{}", msg);
            let _ = startup_tx.send(Err(msg));
            remove_transcriber(&call_id);
            return;
        }
    };
    let _ = startup_tx.send(Ok(()));

    // Vosk needs meaningful audio chunks -- accumulate small 20ms frames into
    // ~400ms buffers before feeding the recognizer for reliable partial results.
    let chunk_threshold = (sample_rate as usize * 2) / 5; // 400ms worth of samples
    let mut send_buf: Vec<i16> = Vec::with_capacity(chunk_threshold * 2);
    let mut recv_buf: Vec<i16> = Vec::with_capacity(chunk_threshold * 2);

    // Track last emitted partial to avoid spamming identical events
    let mut last_send_partial = String::new();
    let mut last_recv_partial = String::new();

    let mut send_frames = 0u64;
    let mut recv_frames = 0u64;
    let mut send_feeds = 0u64;
    let mut recv_feeds = 0u64;
    let mut prev_send_frames = 0u64;
    let mut prev_recv_frames = 0u64;
    let mut last_log = std::time::Instant::now();

    while !shutdown.load(Ordering::Relaxed) {
        let mut did_work = false;

        while let Ok(samples) = send_rx.try_recv() {
            send_buf.extend_from_slice(&samples);
            send_frames += 1;
            did_work = true;
        }

        while let Ok(samples) = recv_rx.try_recv() {
            recv_buf.extend_from_slice(&samples);
            recv_frames += 1;
            did_work = true;
        }

        if send_frames == 1 && prev_send_frames == 0 {
            tracing::info!("First send audio for call_id={}", call_id);
        }
        if recv_frames == 1 && prev_recv_frames == 0 {
            tracing::info!("First recv audio for call_id={}", call_id);
        }

        // Periodic health log every 5 seconds
        if last_log.elapsed() >= Duration::from_secs(5) {
            tracing::info!(
                "[Transcription] call_id={} send_frames={} recv_frames={} send_feeds={} recv_feeds={} send_buf={} recv_buf={}",
                call_id, send_frames, recv_frames, send_feeds, recv_feeds, send_buf.len(), recv_buf.len());
            prev_send_frames = send_frames;
            prev_recv_frames = recv_frames;
            last_log = std::time::Instant::now();
        }

        if send_buf.len() >= chunk_threshold {
            send_feeds += 1;
            let state = send_rec.accept_waveform(&send_buf);
            send_buf.clear();
            match state {
                DecodingState::Finalized => {
                    let text = extract_result_text(&mut send_rec);
                    if !text.is_empty() {
                        tracing::info!("SEND FINAL: {:?}", text);
                        emit_transcript(&app_handle, &call_id, "local", &text, true);
                    }
                    last_send_partial.clear();
                }
                DecodingState::Running => {
                    let partial = send_rec.partial_result().partial.to_string();
                    if !partial.is_empty() && partial != last_send_partial {
                        tracing::info!("SEND PARTIAL: {:?}", partial);
                        emit_transcript(&app_handle, &call_id, "local", &partial, false);
                        last_send_partial = partial;
                    }
                }
                DecodingState::Failed => {
                    tracing::error!("SEND DECODE FAILED for call_id={}", call_id);
                }
            }
        }

        if recv_buf.len() >= chunk_threshold {
            recv_feeds += 1;
            let state = recv_rec.accept_waveform(&recv_buf);
            recv_buf.clear();
            match state {
                DecodingState::Finalized => {
                    let text = extract_result_text(&mut recv_rec);
                    if !text.is_empty() {
                        tracing::info!("RECV FINAL: {:?}", text);
                        emit_transcript(&app_handle, &call_id, "remote", &text, true);
                    }
                    last_recv_partial.clear();
                }
                DecodingState::Running => {
                    let partial = recv_rec.partial_result().partial.to_string();
                    if !partial.is_empty() && partial != last_recv_partial {
                        tracing::info!("RECV PARTIAL: {:?}", partial);
                        emit_transcript(&app_handle, &call_id, "remote", &partial, false);
                        last_recv_partial = partial;
                    }
                }
                DecodingState::Failed => {
                    tracing::error!("RECV DECODE FAILED for call_id={}", call_id);
                }
            }
        }

        if !did_work {
            thread::sleep(Duration::from_millis(30));
        }
    }

    // Flush remaining buffered audio before final results
    if !send_buf.is_empty() {
        send_rec.accept_waveform(&send_buf);
    }
    if !recv_buf.is_empty() {
        recv_rec.accept_waveform(&recv_buf);
    }

    // Flush final results
    let send_final = extract_final_text(&mut send_rec);
    if !send_final.is_empty() {
        emit_transcript(&app_handle, &call_id, "local", &send_final, true);
    }
    let recv_final = extract_final_text(&mut recv_rec);
    if !recv_final.is_empty() {
        emit_transcript(&app_handle, &call_id, "remote", &recv_final, true);
    }

    tracing::info!("Stopped for call_id={}", call_id);
    remove_transcriber(&call_id);
}

/// Stop live transcription for a call.
pub fn stop_transcription(call_id: &str) {
    if let Ok(mut map) = TRANSCRIBERS.lock() {
        if let Some(handle) = map.remove(call_id) {
            handle.shutdown.store(true, Ordering::Relaxed);
            tracing::info!("Signaled stop for call_id={}", call_id);
        }
    }
}

/// Feed local (microphone) PCM samples to the transcription engine. Non-blocking.
pub fn feed_send_pcm(call_id: &str, samples: &[i16]) {
    if let Ok(map) = TRANSCRIBERS.lock() {
        if let Some(handle) = map.get(call_id) {
            let _ = handle.send_tx.try_send(samples.to_vec());
        }
    }
}

/// Feed remote (far-end) PCM samples to the transcription engine. Non-blocking.
pub fn feed_recv_pcm(call_id: &str, samples: &[i16]) {
    if let Ok(map) = TRANSCRIBERS.lock() {
        if let Some(handle) = map.get(call_id) {
            let _ = handle.recv_tx.try_send(samples.to_vec());
        }
    }
}

/// Check if transcription is active for a call.
pub fn is_transcribing(call_id: &str) -> bool {
    TRANSCRIBERS
        .lock()
        .map(|m| m.contains_key(call_id))
        .unwrap_or(false)
}

// ── Recording Transcription ──────────────────────────────────────────────────

/// Transcribe a saved WAV recording. Runs synchronously (call from a spawned thread).
/// Emits `speech:recording_transcript` events with progress.
pub fn transcribe_wav(
    wav_data: &[u8],
    app_handle: &tauri::AppHandle,
    request_id: &str,
) -> Result<String, String> {
    let model = get_or_load_model(app_handle)?;

    // Parse WAV header for sample rate
    let sample_rate = parse_wav_sample_rate(wav_data)?;
    let pcm = decode_wav_pcm(wav_data)?;

    let mut recognizer = Recognizer::new(&model, sample_rate as f32)
        .ok_or("Failed to create recognizer")?;

    let total_samples = pcm.len();
    let chunk_size = (sample_rate as usize) / 5; // 200ms chunks
    let mut full_text = String::new();
    let mut processed = 0usize;

    for chunk in pcm.chunks(chunk_size) {
        let state = recognizer.accept_waveform(chunk);
        processed += chunk.len();
        let progress = processed as f64 / total_samples as f64;

        if state == DecodingState::Finalized {
            let text = extract_result_text(&mut recognizer);
            if !text.is_empty() {
                if !full_text.is_empty() {
                    full_text.push(' ');
                }
                full_text.push_str(&text);
                let _ = app_handle.emit("speech:recording_transcript", RecordingTranscriptEvent {
                    request_id: request_id.to_string(),
                    text: full_text.clone(),
                    is_final: false,
                    progress,
                });
            }
        } else {
            // Emit partial progress periodically
            let partial = recognizer.partial_result().partial.to_string();
            let display = if partial.is_empty() {
                full_text.clone()
            } else if full_text.is_empty() {
                partial
            } else {
                format!("{} {}", full_text, partial)
            };
            if !display.is_empty() && processed % (chunk_size * 5) < chunk_size {
                let _ = app_handle.emit("speech:recording_transcript", RecordingTranscriptEvent {
                    request_id: request_id.to_string(),
                    text: display,
                    is_final: false,
                    progress,
                });
            }
        }
    }

    // Flush final
    let final_text = extract_final_text(&mut recognizer);
    if !final_text.is_empty() {
        if !full_text.is_empty() {
            full_text.push(' ');
        }
        full_text.push_str(&final_text);
    }

    let _ = app_handle.emit("speech:recording_transcript", RecordingTranscriptEvent {
        request_id: request_id.to_string(),
        text: full_text.clone(),
        is_final: true,
        progress: 1.0,
    });

    Ok(full_text)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn emit_transcript(
    app_handle: &tauri::AppHandle,
    call_id: &str,
    speaker: &str,
    text: &str,
    is_final: bool,
) {
    let evt = TranscriptEvent {
        call_id: call_id.to_string(),
        speaker: speaker.to_string(),
        text: text.to_string(),
        is_final,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app_handle.emit("speech:transcript", evt);
}

fn extract_result_text(recognizer: &mut Recognizer) -> String {
    match recognizer.result() {
        CompleteResult::Single(s) => s.text.trim().to_string(),
        CompleteResult::Multiple(m) => {
            m.alternatives.first().map(|a| a.text.trim().to_string()).unwrap_or_default()
        }
    }
}

fn extract_final_text(recognizer: &mut Recognizer) -> String {
    match recognizer.final_result() {
        CompleteResult::Single(s) => s.text.trim().to_string(),
        CompleteResult::Multiple(m) => {
            m.alternatives.first().map(|a| a.text.trim().to_string()).unwrap_or_default()
        }
    }
}

fn parse_wav_sample_rate(data: &[u8]) -> Result<u32, String> {
    if data.len() < 28 {
        return Err("WAV data too short".to_string());
    }
    // Bytes 24-27: sample rate (little-endian u32)
    let sr = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);
    if sr == 0 || sr > 96000 {
        return Err(format!("Invalid WAV sample rate: {}", sr));
    }
    Ok(sr)
}

fn decode_wav_pcm(data: &[u8]) -> Result<Vec<i16>, String> {
    if data.len() < 44 {
        return Err("WAV data too short".to_string());
    }

    let num_channels = u16::from_le_bytes([data[22], data[23]]) as usize;
    let bits_per_sample = u16::from_le_bytes([data[34], data[35]]) as usize;
    let bytes_per_sample = bits_per_sample / 8;
    let block_align = num_channels * bytes_per_sample;

    // Find "data" chunk
    let mut data_offset = 44usize;
    let mut data_size = data.len() - 44;
    for i in 12..data.len().saturating_sub(8).min(200) {
        if &data[i..i + 4] == b"data" {
            data_size = u32::from_le_bytes([data[i + 4], data[i + 5], data[i + 6], data[i + 7]]) as usize;
            data_offset = i + 8;
            break;
        }
    }

    let pcm_data = &data[data_offset..data_offset + data_size.min(data.len() - data_offset)];
    let total_samples = pcm_data.len() / block_align;

    // Decode to mono i16
    let mut samples = Vec::with_capacity(total_samples);
    for s in 0..total_samples {
        let pos = s * block_align;
        if pos + bytes_per_sample > pcm_data.len() {
            break;
        }
        let sample = if bytes_per_sample == 2 {
            i16::from_le_bytes([pcm_data[pos], pcm_data[pos + 1]])
        } else {
            ((pcm_data[pos] as i16) - 128) * 256
        };
        samples.push(sample);
    }

    Ok(samples)
}
