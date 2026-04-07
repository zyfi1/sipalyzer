//! Tauri commands for SpanDSP-based fax operations.
//!
//! These commands provide the frontend API for sending and receiving faxes.
//! The implementation integrates with the softphone module for SIP call handling
//! and will use SpanDSP for actual T.30 protocol processing when native bindings are enabled.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{command, AppHandle, Emitter};
use tokio::sync::mpsc as tokio_mpsc;
use uuid::Uuid;

use crate::softphone::port_allocator;

use super::session::{FaxMode, FaxResolutionOption, FaxSendOptions};

/// Info passed from the keepalive thread when the SBC sends a T.38 re-INVITE during G.711 fax.
/// The keepalive thread accepts the re-INVITE and stores this so the main fax thread can
/// switch from G.711 RTP to T.38 UDPTL mid-stream.
#[derive(Debug, Clone)]
struct T38SwitchInfo {
    remote_udptl_addr: std::net::SocketAddr,
}

// ====== Fax Error Type ======

/// Structured fax error with error codes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FaxError {
    FileNotFound(String),
    InvalidFile(String),
    CallSetupFailed(String),
    T38Rejected(String),
    TransmissionFailed(String),
    Timeout(String),
    PortAllocationFailed(String),
    SpanDspError(String),
    Cancelled,
}

impl std::fmt::Display for FaxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FaxError::FileNotFound(s) => write!(f, "File not found: {}", s),
            FaxError::InvalidFile(s) => write!(f, "Invalid file: {}", s),
            FaxError::CallSetupFailed(s) => write!(f, "Call setup failed: {}", s),
            FaxError::T38Rejected(s) => write!(f, "T.38 rejected: {}", s),
            FaxError::TransmissionFailed(s) => write!(f, "Transmission failed: {}", s),
            FaxError::Timeout(s) => write!(f, "Timeout: {}", s),
            FaxError::PortAllocationFailed(s) => write!(f, "Port allocation failed: {}", s),
            FaxError::SpanDspError(s) => write!(f, "SpanDSP error: {}", s),
            FaxError::Cancelled => write!(f, "Fax cancelled"),
        }
    }
}

// ====== Dynamic Port Pool ======

/// Allocate a UDPTL port via the central port allocator.
fn allocate_udptl_port(label: &str) -> Result<u16, String> {
    port_allocator::allocate(label)
}

// ====== Active Job Tracking ======

/// Active fax jobs for cancellation support
static ACTIVE_JOBS: Lazy<
    Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>,
> = Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

/// Register an active job for cancellation
fn register_active_job(job_id: &str) -> std::sync::Arc<std::sync::atomic::AtomicBool> {
    let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut jobs) = ACTIVE_JOBS.lock() {
        jobs.insert(job_id.to_string(), shutdown.clone());
    }
    shutdown
}

/// Unregister an active job
fn unregister_active_job(job_id: &str) {
    if let Ok(mut jobs) = ACTIVE_JOBS.lock() {
        jobs.remove(job_id);
    }
}

/// Fax audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaxAuditEntry {
    pub id: String,
    pub timestamp_iso: String,
    pub action: String,
    pub job_id: Option<String>,
    pub target: Option<String>,
    pub registrar_id: Option<String>,
    pub sip_call_id: Option<String>,
    pub status_code: Option<u16>,
    pub status_text: Option<String>,
    pub duration_ms: Option<u64>,
    pub success: bool,
    pub error_message: Option<String>,
    pub pages_sent: Option<u32>,
    pub negotiated_baud_rate: Option<u32>,
    pub ecm_used: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_station_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_session_id: Option<String>,
    /// Transport used: "T.38" or "G.711" or "G.711 (T.38 fallback)"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    /// Whether T.38 was rejected and we fell back to G.711
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t38_fallback: Option<bool>,
    /// Reason for T.38 rejection if any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t38_rejection_reason: Option<String>,
    // Legacy fields for backward compatibility with existing frontend
    /// Alias for pages_sent (for backward compatibility)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_count: Option<u32>,
    /// Alias for negotiated_baud_rate (for backward compatibility)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baud_rate: Option<u32>,
    /// Alias for ecm_used (for backward compatibility)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ecm: Option<bool>,
    /// Audio codec used (e.g. "PCMU", "PCMA")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
    /// SIP request snippet for display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_snippet: Option<String>,
    /// SIP response snippet for display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_snippet: Option<String>,
}

/// In-memory audit log
static AUDIT_LOG: Lazy<Mutex<Vec<FaxAuditEntry>>> = Lazy::new(|| Mutex::new(Vec::new()));
const MAX_AUDIT_ENTRIES: usize = 500;

fn append_audit(entry: FaxAuditEntry) {
    if let Ok(mut log) = AUDIT_LOG.lock() {
        log.push(entry);
        let len = log.len();
        if len > MAX_AUDIT_ENTRIES {
            log.drain(0..(len - MAX_AUDIT_ENTRIES));
        }
    }
}

use super::session::{G711Variant, ModemType};

/// Options for fax_send command (frontend-facing)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SendFaxOptions {
    /// Fax mode: "t38", "g711", "g711u", "g711a", or "auto"
    #[serde(default)]
    pub mode: Option<String>,

    /// Enable ECM (Error Correction Mode)
    #[serde(default)]
    pub ecm: Option<bool>,

    /// Maximum baud rate: 2400, 4800, 7200, 9600, 12000, 14400, 33600
    #[serde(default)]
    pub baud_rate: Option<u32>,

    /// Modem type: "v27ter", "v29", "v17", "v34"
    #[serde(default)]
    pub modem_type: Option<String>,

    /// Transmitting Station ID (max 20 chars)
    #[serde(default)]
    pub station_id: Option<String>,

    /// Header info for pages
    #[serde(default)]
    pub header_info: Option<String>,

    /// Number of retries on failure
    #[serde(default)]
    pub retries: Option<u32>,

    /// Timeout in seconds
    #[serde(default)]
    pub timeout_secs: Option<u32>,

    /// Force T.38 only (fail if rejected)
    #[serde(default)]
    pub force_t38: Option<bool>,

    /// Force G.711 only (skip T.38 attempt)
    #[serde(default)]
    pub force_g711: Option<bool>,

    /// Image resolution: "standard" or "fine" (default: fine)
    #[serde(default)]
    pub resolution: Option<String>,
}

impl From<SendFaxOptions> for FaxSendOptions {
    fn from(opts: SendFaxOptions) -> Self {
        let mode = match opts.mode.as_deref() {
            Some("g711") | Some("g711u") | Some("g711a") => FaxMode::AudioPassthrough,
            Some("t38") => FaxMode::T38Udptl,
            _ => FaxMode::T38Udptl, // Default to T.38
        };

        let g711_variant = match opts.mode.as_deref() {
            Some("g711a") => G711Variant::ALaw,
            _ => G711Variant::MuLaw, // Default to µ-law (PCMU)
        };

        let modem_type = match opts.modem_type.as_deref() {
            Some("v27ter") | Some("V27ter") => ModemType::V27ter,
            Some("v29") | Some("V29") => ModemType::V29,
            Some("v34") | Some("V34") => ModemType::V34,
            _ => ModemType::V17, // Default to V.17 (standard)
        };

        let resolution = match opts.resolution.as_deref() {
            Some("standard") => FaxResolutionOption::Standard,
            _ => FaxResolutionOption::Fine, // Default to fine
        };

        let mut options = Self {
            mode,
            ecm: opts.ecm.unwrap_or(true),
            baud_rate: opts.baud_rate.unwrap_or(14400),
            modem_type,
            g711_variant,
            station_id: opts.station_id,
            header_info: opts.header_info,
            retries: opts.retries.unwrap_or(2),
            timeout_secs: opts.timeout_secs.unwrap_or(300),
            force_t38: opts.force_t38.unwrap_or(false),
            force_g711: opts.force_g711.unwrap_or(false),
            resolution,
        };

        // Validate options
        options.validate();
        options
    }
}

/// Result of fax send operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendFaxResult {
    pub job_id: String,
    pub ok: bool,
    pub sip_call_id: Option<String>,
    pub error_message: Option<String>,
    pub pages_sent: Option<u32>,
    pub duration_ms: Option<u64>,
    pub remote_station_id: Option<String>,
    pub audit_entry_id: Option<String>,
    pub capture_session_id: Option<String>,
    pub transport_used: Option<String>,
    pub t38_fallback: Option<bool>,
}

/// Send a fax from a TIFF file.
///
/// This is the main fax sending command. It:
/// 1. Places a SIP call with G.711 audio (PCMU/PCMA)
/// 2. Sends T.38 re-INVITE to switch to T.38 mode (if supported)
/// 3. Uses SpanDSP to handle T.30 protocol and page transmission
/// 4. Falls back to G.711 passthrough if T.38 is rejected
#[command]
pub async fn fax_send(
    app: AppHandle,
    registrar_id: String,
    target: String,
    tiff_path: String,
    options: Option<SendFaxOptions>,
    job_id: Option<String>,
) -> Result<SendFaxResult, String> {
    let job_id = job_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let start_time = Instant::now();
    let opts: FaxSendOptions = options.unwrap_or_default().into();

    // Emit progress: starting
    let _ = app.emit(
        "fax:send_progress",
        serde_json::json!({
            "jobId": job_id,
            "phase": "starting",
            "target": target,
        }),
    );

    // Validate TIFF file
    if !std::path::Path::new(&tiff_path).exists() {
        let error = format!("TIFF file not found: {}", tiff_path);
        append_audit(FaxAuditEntry {
            id: Uuid::new_v4().to_string(),
            timestamp_iso: chrono::Utc::now().to_rfc3339(),
            action: "send_failed".to_string(),
            job_id: Some(job_id.clone()),
            target: Some(target.clone()),
            registrar_id: Some(registrar_id.clone()),
            sip_call_id: None,
            status_code: None,
            status_text: None,
            duration_ms: Some(start_time.elapsed().as_millis() as u64),
            success: false,
            error_message: Some(error.clone()),
            pages_sent: None,
            negotiated_baud_rate: None,
            ecm_used: None,
            remote_station_id: None,
            capture_session_id: None,
            transport: None,
            t38_fallback: None,
            t38_rejection_reason: None,
            page_count: None,
            baud_rate: None,
            ecm: None,
            codec: None,
            request_snippet: None,
            response_snippet: None,
        });
        return Err(error);
    }

    // Create progress channel for SIP responses
    let (progress_tx, mut progress_rx) = tokio_mpsc::unbounded_channel::<(u16, String)>();

    // Clone values for the blocking task
    let registrar_id_clone = registrar_id.clone();
    let target_clone = target.clone();
    let job_id_clone = job_id.clone();
    let app_clone = app.clone();
    let tiff_path_clone = tiff_path.clone();
    let mode = opts.mode;
    let opts_clone = opts.clone();

    // Spawn task to forward progress events
    let progress_job_id = job_id.clone();
    let progress_app = app.clone();
    tokio::spawn(async move {
        while let Some((status_code, status_text)) = progress_rx.recv().await {
            let (phase, direction) = match status_code {
                100 => ("trying", "inbound"),
                180 | 183 => ("ringing", "inbound"),
                200..=299 => ("connected", "inbound"),
                401 | 407 => ("sip_response", "inbound"),
                _ => ("progress", "inbound"),
            };
            let sip_message = format!("{} {}", status_code, status_text);
            let is_auth_challenge = status_code == 401 || status_code == 407;
            let mut payload = serde_json::json!({
                "jobId": progress_job_id,
                "phase": phase,
                "sipMessage": sip_message,
                "messageDirection": direction,
            });
            if is_auth_challenge {
                if let Some(obj) = payload.as_object_mut() {
                    obj.insert(
                        "detail".to_string(),
                        serde_json::Value::String("Retrying with credentials...".to_string()),
                    );
                }
            }
            let _ = progress_app.emit("fax:send_progress", payload);
        }
    });

    // Register active job for cancellation support
    let shutdown = register_active_job(&job_id);
    let shutdown_clone = shutdown.clone();
    let job_id_for_cleanup = job_id.clone();
    let retries = opts.retries;

    // Run the fax call in a blocking task with retry logic
    let result = tokio::task::spawn_blocking(move || {
        let mut last_error = None;

        for attempt in 0..=retries {
            if shutdown_clone.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Fax cancelled".to_string());
            }

            if attempt > 0 {
                // Exponential backoff: 5s, 15s, 30s, 60s, ...
                let backoff_secs = match attempt {
                    1 => 5,
                    2 => 15,
                    3 => 30,
                    _ => 60,
                };
                tracing::warn!(
                    "Retry attempt {} of {} (backoff {}s)",
                    attempt,
                    retries,
                    backoff_secs
                );
                std::thread::sleep(Duration::from_secs(backoff_secs));
            }

            match run_fax_send_blocking(
                registrar_id_clone.clone(),
                target_clone.clone(),
                tiff_path_clone.clone(),
                mode,
                opts_clone.clone(),
                Some(progress_tx.clone()),
                app_clone.clone(),
                job_id_clone.clone(),
                shutdown_clone.clone(),
            ) {
                Ok(result) if result.ok => return Ok(result),
                Ok(result) => {
                    last_error = Some(
                        result
                            .error_message
                            .unwrap_or_else(|| "Unknown error".to_string()),
                    );
                    // Don't retry certain errors
                    if result.sip_call_id.is_none() {
                        break; // Call setup failed, retrying won't help
                    }
                }
                Err(e) => {
                    last_error = Some(e);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "Fax failed after all retries".to_string()))
    })
    .await
    .map_err(|e| format!("Fax task panicked: {}", e))?;

    unregister_active_job(&job_id_for_cleanup);

    let duration_ms = start_time.elapsed().as_millis() as u64;

    match result {
        Ok(fax_result) => {
            let audit_id = Uuid::new_v4().to_string();
            let transport = if fax_result.t38_fallback.unwrap_or(false) {
                "G.711 (T.38 fallback)".to_string()
            } else if fax_result.transport_used == Some("T.38".to_string()) {
                "T.38".to_string()
            } else if fax_result.transport_used == Some("T.38 (SBC-initiated)".to_string()) {
                "T.38 (SBC-initiated)".to_string()
            } else {
                // Preserve the actual transport label (e.g. "G.711u", "G.711 µ-law")
                fax_result
                    .transport_used
                    .clone()
                    .unwrap_or_else(|| "G.711u".to_string())
            };

            append_audit(FaxAuditEntry {
                id: audit_id.clone(),
                timestamp_iso: chrono::Utc::now().to_rfc3339(),
                action: if fax_result.ok {
                    "send_completed"
                } else {
                    "send_failed"
                }
                .to_string(),
                job_id: Some(job_id.clone()),
                target: Some(target.clone()),
                registrar_id: Some(registrar_id),
                sip_call_id: fax_result.sip_call_id.clone(),
                status_code: Some(200),
                status_text: Some("OK".to_string()),
                duration_ms: Some(duration_ms),
                success: fax_result.ok,
                error_message: fax_result.error_message.clone(),
                pages_sent: fax_result.pages_sent,
                negotiated_baud_rate: None,
                ecm_used: Some(opts.ecm),
                remote_station_id: fax_result.remote_station_id.clone(),
                capture_session_id: fax_result.capture_session_id.clone(),
                transport: Some(transport.clone()),
                t38_fallback: fax_result.t38_fallback,
                t38_rejection_reason: None,
                // Legacy fields for backward compatibility
                page_count: fax_result.pages_sent,
                baud_rate: Some(opts.baud_rate),
                ecm: Some(opts.ecm),
                codec: if transport.contains("G.711") {
                    Some("PCMU".to_string())
                } else {
                    None
                },
                request_snippet: None,
                response_snippet: None,
            });

            let _ = app.emit(
                "fax:send_progress",
                serde_json::json!({
                    "jobId": job_id,
                    "phase": "complete",
                    "success": fax_result.ok,
                    "pagesSent": fax_result.pages_sent.unwrap_or(0),
                    "durationMs": duration_ms,
                    "transport": transport,
                }),
            );

            Ok(SendFaxResult {
                job_id,
                ok: fax_result.ok,
                sip_call_id: fax_result.sip_call_id,
                error_message: fax_result.error_message,
                pages_sent: fax_result.pages_sent,
                duration_ms: Some(duration_ms),
                remote_station_id: fax_result.remote_station_id,
                audit_entry_id: Some(audit_id),
                capture_session_id: fax_result.capture_session_id,
                transport_used: Some(transport),
                t38_fallback: fax_result.t38_fallback,
            })
        }
        Err(error) => {
            let audit_id = Uuid::new_v4().to_string();
            append_audit(FaxAuditEntry {
                id: audit_id.clone(),
                timestamp_iso: chrono::Utc::now().to_rfc3339(),
                action: "send_failed".to_string(),
                job_id: Some(job_id.clone()),
                target: Some(target.clone()),
                registrar_id: Some(registrar_id),
                sip_call_id: None,
                status_code: None,
                status_text: None,
                duration_ms: Some(duration_ms),
                success: false,
                error_message: Some(error.clone()),
                pages_sent: None,
                negotiated_baud_rate: None,
                ecm_used: None,
                remote_station_id: None,
                capture_session_id: None,
                transport: None,
                t38_fallback: None,
                t38_rejection_reason: None,
                page_count: None,
                baud_rate: None,
                ecm: None,
                codec: None,
                request_snippet: None,
                response_snippet: None,
            });

            let _ = app.emit(
                "fax:send_progress",
                serde_json::json!({
                    "jobId": job_id,
                    "phase": "error",
                    "error": error,
                }),
            );

            Err(error)
        }
    }
}

/// Internal struct for fax result from blocking task
struct InternalFaxResult {
    ok: bool,
    sip_call_id: Option<String>,
    error_message: Option<String>,
    pages_sent: Option<u32>,
    remote_station_id: Option<String>,
    capture_session_id: Option<String>,
    transport_used: Option<String>,
    t38_fallback: Option<bool>,
}

/// Run the fax send operation in a blocking context.
/// This function handles the SIP call setup, T.38 negotiation, and fax transmission.
fn emit_fax_phase(app: &AppHandle, job_id: &str, phase: &str) {
    let _ = app.emit(
        "fax:send_progress",
        serde_json::json!({
            "jobId": job_id,
            "phase": phase,
        }),
    );
}

/// Emit a rich fax progress event with optional SIP/NAT diagnostic info for the activity UI.
fn emit_fax_event(app: &AppHandle, job_id: &str, phase: &str, extra: serde_json::Value) {
    let mut payload = serde_json::json!({
        "jobId": job_id,
        "phase": phase,
    });
    if let (Some(base), Some(ext)) = (payload.as_object_mut(), extra.as_object()) {
        for (k, v) in ext {
            base.insert(k.clone(), v.clone());
        }
    }
    let _ = app.emit("fax:send_progress", payload);
}

/// Lightweight SIP dialog keepalive for fax calls.
///
/// Keeps the SIP dialog alive by responding to OPTIONS/keepalive with 200 OK
/// and handling BYE from the remote. Without this, the call server detects a
/// dead endpoint and tears down the call within seconds.
///
/// Sets `shutdown` to true when BYE is received so the fax media loop can exit cleanly.
fn run_fax_dialog_keepalive(
    socket: std::net::UdpSocket,
    call_id: &str,
    from_tag: &str,
    to_tag: &str,
    shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
    local_udptl_port: u16,
    local_ip: String,
    t38_switch: std::sync::Arc<Mutex<Option<T38SwitchInfo>>>,
    media_shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
    allow_t38_switch: bool,
) {
    use crate::core::user_agent;
    use crate::sip::stack::SipMessage;

    // Short read timeout so we check the shutdown flag regularly
    let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
    let mut buf = vec![0u8; 4096];
    let call_id_owned = call_id.to_string();
    let _from_tag_owned = from_tag.to_string();
    let _to_tag_owned = to_tag.to_string();

    // RFC 3261 §13.2.1: 200 OK to INVITE MUST include Contact header.
    // Derive our Contact URI from the socket's local port and the public STUN IP.
    let local_sip_port = socket.local_addr().map(|a| a.port()).unwrap_or(5060);
    let contact_uri = format!("<sip:sipalyzer@{}:{}>", local_ip, local_sip_port);

    // The dialog socket may have been connect()'d to the SBC during call setup.
    // On macOS, send_to() fails with EISCONN (os error 56) on a connected UDP socket.
    // Detect this and use send() (to the connected peer) instead.
    let socket_is_connected = socket.peer_addr().is_ok();
    let connected_peer = socket.peer_addr().ok();
    if socket_is_connected {
        tracing::info!(
            "[FaxDialog:{}] Socket is connect()'d to {} — will use send() instead of send_to()",
            &call_id[..8.min(call_id.len())],
            connected_peer
                .map(|a| a.to_string())
                .unwrap_or_else(|| "?".to_string())
        );
    }

    // Helper: send bytes on the dialog socket, handling connected vs unconnected.
    // On macOS, send_to() on a connected UDP socket returns EISCONN (os error 56).
    let send_sip = |data: &[u8], dest: std::net::SocketAddr| -> std::io::Result<usize> {
        if socket_is_connected {
            socket.send(data)
        } else {
            socket.send_to(data, dest)
        }
    };

    tracing::info!(
        "[FaxDialog:{}] SIP keepalive thread started",
        &call_id_owned[..8.min(call_id_owned.len())]
    );

    // Track whether we've already accepted a T.38 re-INVITE. The SBC retransmits until ACK,
    // so we must respond 200 OK each time but only signal the G.711→T.38 switch ONCE.
    let mut t38_already_accepted = false;

    while !shutdown.load(std::sync::atomic::Ordering::Relaxed) {
        match socket.recv_from(&mut buf) {
            Ok((len, peer)) => {
                if len < 10 {
                    continue;
                }
                let bytes = &buf[..len];
                if let Ok(msg) = SipMessage::from_bytes(bytes) {
                    // Check if this message is for our dialog
                    let msg_call_id = msg
                        .get_header("Call-ID")
                        .map(|s| s.trim().to_string())
                        .unwrap_or_default();

                    if msg.status_code.is_some() {
                        // It's a response — ignore (we're not sending requests)
                        continue;
                    }

                    let method = msg.method.to_uppercase();
                    match method.as_str() {
                        "BYE" => {
                            tracing::info!(
                                "Received BYE for call {}",
                                &call_id_owned[..8.min(call_id_owned.len())]
                            );
                            // Respond with 200 OK
                            let via = msg.get_header("Via").unwrap_or(&String::new()).clone();
                            let from = msg.get_header("From").unwrap_or(&String::new()).clone();
                            let to = msg.get_header("To").unwrap_or(&String::new()).clone();
                            let cseq = msg.get_header("CSeq").unwrap_or(&String::new()).clone();
                            let mut ok = SipMessage::new_response(200, "OK");
                            ok.add_header("Via", &via);
                            ok.add_header("From", &from);
                            ok.add_header("To", &to);
                            ok.add_header("Call-ID", &msg_call_id);
                            ok.add_header("CSeq", &cseq);
                            ok.add_header("User-Agent", &user_agent::get_effective_user_agent());
                            if let Ok(ok_bytes) = ok.to_bytes() {
                                let _ = send_sip(&ok_bytes, peer);
                            }
                            // Signal the fax media loop to stop AND the keepalive to exit
                            media_shutdown.store(true, std::sync::atomic::Ordering::SeqCst);
                            shutdown.store(true, std::sync::atomic::Ordering::SeqCst);
                            break;
                        }
                        "OPTIONS" => {
                            // Respond with 200 OK to keepalive
                            let via = msg.get_header("Via").unwrap_or(&String::new()).clone();
                            let from = msg.get_header("From").unwrap_or(&String::new()).clone();
                            let to = msg.get_header("To").unwrap_or(&String::new()).clone();
                            let cseq = msg.get_header("CSeq").unwrap_or(&String::new()).clone();
                            let mut ok = SipMessage::new_response(200, "OK");
                            ok.add_header("Via", &via);
                            ok.add_header("From", &from);
                            ok.add_header("To", &to);
                            ok.add_header("Call-ID", &msg_call_id);
                            ok.add_header("CSeq", &cseq);
                            ok.add_header("User-Agent", &user_agent::get_effective_user_agent());
                            if let Ok(ok_bytes) = ok.to_bytes() {
                                let _ = send_sip(&ok_bytes, peer);
                            }
                        }
                        "INVITE" => {
                            // re-INVITE from SBC. Check if it's requesting T.38 switchover.
                            let _content_type = msg
                                .get_header("Content-Type")
                                .map(|s| s.to_string())
                                .unwrap_or_default();
                            let body_str = msg.body.as_ref().map(|b| b.clone()).unwrap_or_default();
                            let is_t38 = crate::softphone::sdp::is_t38_invite(&body_str);

                            let via = msg.get_header("Via").unwrap_or(&String::new()).clone();
                            let from_hdr = msg.get_header("From").unwrap_or(&String::new()).clone();
                            let to_hdr = msg.get_header("To").unwrap_or(&String::new()).clone();
                            let cseq = msg.get_header("CSeq").unwrap_or(&String::new()).clone();

                            // Diagnostic: log the raw re-INVITE on first receipt
                            if !t38_already_accepted {
                                let raw_invite = String::from_utf8_lossy(&buf[..len]);
                                tracing::info!(
                                    "[FaxDialog:{}] ← re-INVITE from {} ({} bytes):\n{}",
                                    &call_id_owned[..8.min(call_id_owned.len())],
                                    peer,
                                    len,
                                    &raw_invite[..raw_invite.len().min(1500)]
                                );
                            }

                            if is_t38 && allow_t38_switch {
                                // Send 100 Trying immediately to stop SBC retransmissions
                                // while we prepare the 200 OK (RFC 3261 §13.3.1.1)
                                {
                                    let mut trying = SipMessage::new_response(100, "Trying");
                                    trying.add_header("Via", &via);
                                    trying.add_header("From", &from_hdr);
                                    trying.add_header("To", &to_hdr);
                                    trying.add_header("Call-ID", &msg_call_id);
                                    trying.add_header("CSeq", &cseq);
                                    if let Ok(trying_bytes) = trying.to_bytes() {
                                        match send_sip(&trying_bytes, peer) {
                                            Ok(n) => {
                                                if !t38_already_accepted {
                                                    tracing::info!("[FaxDialog:{}] → 100 Trying sent ({} bytes) to {}",
                                                        &call_id_owned[..8.min(call_id_owned.len())], n, peer);
                                                }
                                            }
                                            Err(e) => {
                                                tracing::error!(
                                                    "[FaxDialog:{}] ✗ 100 Trying send failed: {}",
                                                    &call_id_owned[..8.min(call_id_owned.len())],
                                                    e
                                                );
                                            }
                                        }
                                    }
                                }

                                // Build our T.38 SDP answer (always respond with 200 OK for T.38 re-INVITE,
                                // including retransmissions — the SBC expects a response every time).
                                let t38_sdp = crate::softphone::sdp::build_t38_offer(
                                    &local_ip,
                                    local_udptl_port,
                                );

                                let mut ok = SipMessage::new_response(200, "OK");
                                ok.add_header("Via", &via);
                                ok.add_header("From", &from_hdr);
                                ok.add_header("To", &to_hdr);
                                ok.add_header("Call-ID", &msg_call_id);
                                ok.add_header("CSeq", &cseq);
                                // RFC 3261 §13.2.1: Contact is REQUIRED in 200 OK to INVITE.
                                ok.add_header("Contact", &contact_uri);
                                ok.add_header("Content-Type", "application/sdp");
                                ok.add_header(
                                    "User-Agent",
                                    &user_agent::get_effective_user_agent(),
                                );
                                ok.body = Some(t38_sdp.clone());
                                if let Ok(ok_bytes) = ok.to_bytes() {
                                    if !t38_already_accepted {
                                        // Log the FULL raw 200 OK so we can diagnose SIP issues
                                        let raw_response = String::from_utf8_lossy(&ok_bytes);
                                        tracing::info!(
                                            "[FaxDialog:{}] → 200 OK ({} bytes) to {}:\n{}",
                                            &call_id_owned[..8.min(call_id_owned.len())],
                                            ok_bytes.len(),
                                            peer,
                                            &raw_response[..raw_response.len().min(1500)]
                                        );
                                    }
                                    match send_sip(&ok_bytes, peer) {
                                        Ok(n) => {
                                            if !t38_already_accepted {
                                                tracing::info!(
                                                    "[FaxDialog:{}] → 200 OK sent Ok({} bytes)",
                                                    &call_id_owned[..8.min(call_id_owned.len())],
                                                    n
                                                );
                                            }
                                        }
                                        Err(e) => {
                                            tracing::error!(
                                                "[FaxDialog:{}] ✗ 200 OK send failed: {}",
                                                &call_id_owned[..8.min(call_id_owned.len())],
                                                e
                                            );
                                        }
                                    }
                                }

                                // Only trigger the media switch ONCE. SBC retransmits the re-INVITE
                                // until it gets an ACK — we must respond each time but only signal
                                // the G.711→T.38 switch on the FIRST re-INVITE.
                                if !t38_already_accepted {
                                    t38_already_accepted = true;
                                    let remote_udptl_port =
                                        crate::softphone::sdp::parse_t38_media(&body_str)
                                            .unwrap_or(0);
                                    let remote_udptl_ip =
                                        crate::softphone::sdp::parse_connection_for_image(
                                            &body_str,
                                        )
                                        .unwrap_or_else(
                                            || {
                                                crate::softphone::sdp::parse_connection(&body_str)
                                                    .unwrap_or_default()
                                            },
                                        );

                                    tracing::info!("[FaxDialog:{}] Accepting T.38 re-INVITE: remote UDPTL {}:{}, our UDPTL port {}",
                                        &call_id_owned[..8.min(call_id_owned.len())], remote_udptl_ip, remote_udptl_port, local_udptl_port);

                                    if remote_udptl_port > 0 && !remote_udptl_ip.is_empty() {
                                        if let Ok(addr) =
                                            format!("{}:{}", remote_udptl_ip, remote_udptl_port)
                                                .parse()
                                        {
                                            if let Ok(mut guard) = t38_switch.lock() {
                                                *guard = Some(T38SwitchInfo {
                                                    remote_udptl_addr: addr,
                                                });
                                            }
                                            // Signal the G.711 media loop to stop — we're switching to T.38.
                                            media_shutdown
                                                .store(true, std::sync::atomic::Ordering::SeqCst);
                                            tracing::info!("[FaxDialog:{}] T.38 switch accepted — signaling G.711 loop to stop", &call_id_owned[..8.min(call_id_owned.len())]);
                                        }
                                    }
                                } else {
                                    tracing::info!("[FaxDialog:{}] T.38 re-INVITE retransmission — responded 200 OK (switch already accepted)", &call_id_owned[..8.min(call_id_owned.len())]);
                                }
                            } else {
                                // Reject re-INVITE per Grandstream/OBiHAI ATA behavior:
                                // - T.38 re-INVITE when user chose G.711 mode → 415 Unsupported Media Type
                                //   (stronger signal than 488; tells SBC "don't try T.38 again")
                                // - Non-T.38 re-INVITE → 488 Not Acceptable Here
                                let (code, text, reason) = if is_t38 {
                                    (
                                        415,
                                        "Unsupported Media Type",
                                        "T.38 not supported (G.711 passthrough mode)",
                                    )
                                } else {
                                    (488, "Not Acceptable Here", "re-INVITE not acceptable")
                                };
                                tracing::info!(
                                    "[FaxDialog:{}] {} — responding {} {}",
                                    &call_id_owned[..8.min(call_id_owned.len())],
                                    reason,
                                    code,
                                    text
                                );
                                let mut reject = SipMessage::new_response(code, text);
                                reject.add_header("Via", &via);
                                reject.add_header("From", &from_hdr);
                                reject.add_header("To", &to_hdr);
                                reject.add_header("Call-ID", &msg_call_id);
                                reject.add_header("CSeq", &cseq);
                                reject.add_header(
                                    "User-Agent",
                                    &user_agent::get_effective_user_agent(),
                                );
                                // RFC 3261 §20.3: Accept header tells SBC which content types we support
                                if is_t38 {
                                    reject.add_header("Accept", "application/sdp");
                                }
                                if let Ok(reject_bytes) = reject.to_bytes() {
                                    let _ = send_sip(&reject_bytes, peer);
                                }
                            }
                        }
                        _ => {
                            // Unknown method — ignore
                        }
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // Timeout — check shutdown flag and loop
                continue;
            }
            Err(_) => {
                // Socket error — exit
                break;
            }
        }
    }

    tracing::info!(
        "[FaxDialog:{}] SIP keepalive thread exiting",
        &call_id_owned[..8.min(call_id_owned.len())]
    );
}

fn run_fax_send_blocking(
    registrar_id: String,
    target: String,
    tiff_path: String,
    mode: FaxMode,
    opts: super::session::FaxSendOptions,
    progress_tx: Option<tokio_mpsc::UnboundedSender<(u16, String)>>,
    app: AppHandle,
    job_id: String,
    shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<InternalFaxResult, String> {
    use super::fax_media::{self};
    use super::session::FaxSession;
    use crate::core::database::Database;
    use crate::softphone::call_controller::{end_call, place_call, send_t38_reinvite};
    use crate::softphone::media_engine;

    // Normalize the target number to E.164 format before any SIP operations.
    // This ensures the INVITE Request-URI and To header always use proper E.164.
    let target = normalize_to_e164(&target);
    tracing::info!("Target normalized to E.164: {}", target);

    // Per-attempt keepalive shutdown flag — stops the SIP keepalive thread when this
    // attempt finishes (success or failure) so it doesn't leak across retries.
    let keepalive_shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    // ── Step 0: Match the softphone's proven approach exactly ─────────────
    // The softphone has working bidirectional RTP. The key to its success:
    //   1. It does NOT pre-bind the RTP socket before the INVITE
    //   2. It discovers public IP via STUN on an ephemeral socket (port 0)
    //   3. SDP uses public_ip + local_rtp_port (e.g. 10000)
    //   4. After 200 OK, it binds the RTP socket FRESH and starts sending immediately
    //
    // We were pre-binding port 10000 before place_call(), which meant the socket
    // sat idle during the entire SIP handshake. Some NATs track UDP bindings and
    // the idle socket could create stale state that interfered with real RTP.
    let (rtp_port, registrar_domain) = {
        let regs = Database::load_registrars().map_err(|e| e.to_string())?;
        let reg = regs
            .iter()
            .find(|r| r.id == registrar_id)
            .ok_or_else(|| format!("Registrar '{}' not found", registrar_id))?;
        (reg.rtp_port.unwrap_or(10000), reg.domain.clone())
    };

    // NO pre-bind here! The socket will be created fresh AFTER 200 OK,
    // inside run_fax_over_rtp() — exactly like the softphone does.

    // SDP media address: let place_call() handle STUN discovery itself (sdp_media_override = None).
    // This is EXACTLY what the softphone does — place_call() calls stun_discover_public_ip()
    // on an ephemeral socket and uses that IP + local_rtp_port for the SDP.
    let sdp_media_override: Option<(String, u16)> = None;
    tracing::info!(
        "Using softphone-identical SDP strategy: place_call() will STUN + use local port {}",
        rtp_port
    );

    // Emit discovery info for the activity UI
    emit_fax_event(
        &app,
        &job_id,
        "nat_discovery",
        serde_json::json!({
            "natInfo": format!("Using softphone SDP strategy (port {})", rtp_port),
            "messageDirection": "info",
        }),
    );

    // Step 1: Place the initial G.711 call (SDP uses the STUN-discovered media address)
    emit_fax_event(
        &app,
        &job_id,
        "sip_invite",
        serde_json::json!({
            "sipMessage": format!("INVITE sip:{}@{}", target, registrar_domain),
            "messageDirection": "outbound",
        }),
    );

    // use_t38: Only hint T.38 support in the initial INVITE when the user selected T.38 mode.
    // For G.711u passthrough, we start and stay on G.711 (unless the SBC forces T.38 via
    // re-INVITE, which the keepalive thread handles separately).
    let hint_t38 = mode == FaxMode::T38Udptl;

    let (call_result, dialog_socket, _tcp_stream) = place_call(
        registrar_id.clone(),
        target.clone(),
        Some(vec!["PCMU".to_string(), "PCMA".to_string()]),
        progress_tx,
        None, // on_before_invite callback for packet capture
        hint_t38,
        sdp_media_override.clone(),
    )?;

    // Emit SIP response event
    {
        let sdp_info = match (&call_result.remote_rtp_address, call_result.remote_rtp_port) {
            (Some(addr), Some(port)) => format!(
                "SDP: {}:{} {}",
                addr,
                port,
                call_result.negotiated_codec.as_deref().unwrap_or("unknown")
            ),
            _ => "No media in response".to_string(),
        };
        let nat_detail = match (&call_result.sbc_received_ip, call_result.sbc_rport) {
            (Some(ip), Some(port)) => format!("SBC sees us at {}:{}", ip, port),
            (Some(ip), None) => format!("SBC sees us at {} (no rport)", ip),
            _ => String::new(),
        };
        emit_fax_event(
            &app,
            &job_id,
            "sip_response",
            serde_json::json!({
                "sipMessage": format!("{} {}", call_result.status_code, call_result.status_text),
                "sdpInfo": sdp_info,
                "natInfo": if nat_detail.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(nat_detail) },
                "remoteRtp": match (&call_result.remote_rtp_address, call_result.remote_rtp_port) {
                    (Some(addr), Some(port)) => serde_json::Value::String(format!("{}:{}", addr, port)),
                    _ => serde_json::Value::Null,
                },
                "messageDirection": "inbound",
            }),
        );
    }

    if !call_result.ok {
        emit_fax_event(
            &app,
            &job_id,
            "sip_error",
            serde_json::json!({
                "sipMessage": format!("Call failed: {} {}", call_result.status_code, call_result.status_text),
                "messageDirection": "info",
                "warning": format!("INVITE rejected: {} {}", call_result.status_code, call_result.status_text),
            }),
        );
        return Ok(InternalFaxResult {
            ok: false,
            sip_call_id: Some(call_result.call_id),
            error_message: Some(format!(
                "Call failed: {} {}",
                call_result.status_code, call_result.status_text
            )),
            pages_sent: None,
            remote_station_id: None,
            capture_session_id: call_result.capture_session_id,
            transport_used: None,
            t38_fallback: None,
        });
    }

    // Emit ACK
    emit_fax_event(
        &app,
        &job_id,
        "sip_ack",
        serde_json::json!({
            "sipMessage": "ACK",
            "messageDirection": "outbound",
        }),
    );

    // Check for cancellation right after call setup
    if shutdown.load(std::sync::atomic::Ordering::Relaxed) {
        let _ = end_call(
            registrar_id.clone(),
            call_result.call_id.clone(),
            call_result.from_tag.clone(),
            call_result.to_tag.clone().unwrap_or_default(),
            call_result.target_uri.clone(),
            call_result.remote_contact_uri.clone(),
            call_result.response_to_header.clone(),
            call_result.dialog_cseq + 1,
        );
        let _ = media_engine::stop_media(&call_result.call_id);
        port_allocator::release(call_result.local_rtp_port);
        return Err("Fax cancelled".to_string());
    }

    let call_id = call_result.call_id.clone();
    let from_tag = call_result.from_tag.clone();
    let to_tag = call_result.to_tag.clone().unwrap_or_default();
    let target_uri = call_result.target_uri.clone();
    let remote_contact = call_result.remote_contact_uri.clone();
    let response_to_header = call_result.response_to_header.clone();
    let dialog_cseq = call_result.dialog_cseq;
    let local_ip = call_result
        .local_ip
        .clone()
        .unwrap_or_else(|| "0.0.0.0".to_string());
    let local_rtp_port = call_result.local_rtp_port;

    // Get remote RTP address for G.711 fallback
    let remote_rtp_addr: Option<std::net::SocketAddr> =
        match (&call_result.remote_rtp_address, call_result.remote_rtp_port) {
            (Some(addr), Some(port)) => format!("{}:{}", addr, port)
                .parse::<std::net::SocketAddr>()
                .ok(),
            _ => None,
        };

    // Determine codec from negotiated payload type
    let codec = call_result
        .negotiated_pt
        .and_then(fax_media::G711Codec::from_pt)
        .unwrap_or(fax_media::G711Codec::PCMU);

    // Step 2: Attempt T.38 re-INVITE if T.38 mode is requested
    // Otherwise use G.711 passthrough mode
    //
    // IMPORTANT: The UDPTL port allocated here is the one advertised in the SDP to the remote.
    // The same port MUST be used for the actual UDPTL session in Step 3. Allocating a different
    // port for transmission would cause a mismatch — remote sends to port A, we listen on port B.
    let local_udptl_port =
        allocate_udptl_port(&format!("fax-udptl:{}", job_id)).unwrap_or(local_rtp_port + 2);

    // UDPTL: Don't pre-bind. Use call's local_ip (STUN-discovered public IP from place_call)
    // + local UDPTL port for the re-INVITE SDP. Socket will bind fresh when T.38 session starts.
    let udptl_sdp_ip = local_ip.clone();
    let udptl_sdp_port = local_udptl_port;
    tracing::info!(
        "UDPTL SDP will use {}:{} (same strategy as RTP)",
        udptl_sdp_ip,
        udptl_sdp_port
    );

    // Shared state for mid-stream G.711→T.38 switchover (SBC sends re-INVITE during G.711 fax).
    // The keepalive thread populates this when it accepts a T.38 re-INVITE.
    let t38_switch_state: std::sync::Arc<Mutex<Option<T38SwitchInfo>>> =
        std::sync::Arc::new(Mutex::new(None));

    // CRITICAL: Separate flag for the keepalive thread to signal the G.711 media loop to stop
    // on T.38 switchover or BYE, WITHOUT killing the keepalive thread itself.
    //
    // Previously, media_shutdown was shutdown.clone() (the global cancel flag). When the
    // keepalive set media_shutdown=true for a T.38 switch, it also triggered its OWN exit
    // via the combined_shutdown watcher (which watched the global flag). This meant:
    //   1. Keepalive sends 200 OK for T.38 re-INVITE
    //   2. Keepalive sets media_shutdown (= global shutdown) → true
    //   3. Combined watcher sees global=true → sets combined=true → keepalive exits
    //   4. Nobody alive to receive SBC's ACK
    //   5. SBC never completes T.38 switch → keeps sending RTP comfort noise to UDPTL port
    //   6. udptl_rx_packet fails on every packet (they're RTP, not UDPTL)
    //
    // Fix: media_stop is a SEPARATE Arc. It signals the G.711 loop to exit but does NOT
    // affect the keepalive's combined_shutdown (which only watches global shutdown + keepalive_shutdown).
    let media_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    // fax_loop_shutdown = user_cancel || media_stop (passed to run_fax_over_rtp)
    let fax_loop_shutdown = {
        let cancel = shutdown.clone();
        let stop = media_stop.clone();
        let done = keepalive_shutdown.clone();
        let combined = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let combined2 = combined.clone();
        std::thread::spawn(move || {
            while !combined2.load(std::sync::atomic::Ordering::Relaxed) {
                if cancel.load(std::sync::atomic::Ordering::Relaxed)
                    || stop.load(std::sync::atomic::Ordering::Relaxed)
                    || done.load(std::sync::atomic::Ordering::Relaxed)
                {
                    combined2.store(true, std::sync::atomic::Ordering::SeqCst);
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        });
        combined
    };

    let (final_transport, t38_fallback, remote_udptl_addr, use_t38) = if mode == FaxMode::T38Udptl {
        emit_fax_phase(&app, &job_id, "t38_switch");
        emit_fax_event(
            &app,
            &job_id,
            "sip_reinvite",
            serde_json::json!({
                "sipMessage": format!("re-INVITE (T.38) UDPTL {}:{}", udptl_sdp_ip, udptl_sdp_port),
                "sdpInfo": format!("SDP: m=image {} udptl t38", udptl_sdp_port),
                "messageDirection": "outbound",
            }),
        );
        tracing::info!(
            "T.38 re-INVITE: advertising UDPTL at {}:{} (SDP c= address)",
            udptl_sdp_ip,
            udptl_sdp_port
        );
        // Wait for call to stabilize before re-INVITE
        std::thread::sleep(Duration::from_millis(300));

        let reinvite_result = send_t38_reinvite(
            registrar_id.clone(),
            call_id.clone(),
            from_tag.clone(),
            to_tag.clone(),
            target_uri.clone(),
            remote_contact.clone(),
            response_to_header.clone(),
            dialog_cseq,
            udptl_sdp_ip.clone(),
            udptl_sdp_port,
            dialog_socket,
        );

        match reinvite_result {
            Ok((t38_result, returned_socket)) => {
                if t38_result.ok && t38_result.remote_udptl_port.is_some() {
                    // T.38 accepted - stop RTP audio, switch to UDPTL
                    let _ = media_engine::stop_media(&call_id);

                    // Build remote UDPTL address
                    let remote_udptl: Option<std::net::SocketAddr> = t38_result
                        .remote_udptl_address
                        .as_ref()
                        .and_then(|addr| {
                            t38_result
                                .remote_udptl_port
                                .map(|port| format!("{}:{}", addr, port).parse().ok())
                        })
                        .flatten();

                    tracing::info!("T.38 re-INVITE accepted, remote UDPTL: {:?}", remote_udptl);
                    emit_fax_event(
                        &app,
                        &job_id,
                        "sip_response",
                        serde_json::json!({
                            "sipMessage": format!("{} {} (T.38 accepted)", t38_result.status_code, t38_result.status_text),
                            "sdpInfo": format!("UDPTL: {:?}", remote_udptl),
                            "messageDirection": "inbound",
                        }),
                    );
                    emit_fax_phase(&app, &job_id, "t38_wait_dis");
                    ("T.38".to_string(), false, remote_udptl, true)
                } else {
                    // T.38 rejected - use G.711 passthrough
                    emit_fax_phase(&app, &job_id, "g711_fax");
                    let rejection_reason = match t38_result.status_code {
                        488 => {
                            "488 Not Acceptable Here (gateway does not support T.38)".to_string()
                        }
                        606 => "606 Not Acceptable".to_string(),
                        415 => "415 Unsupported Media Type".to_string(),
                        c if c >= 400 => format!("{} {}", c, t38_result.status_text),
                        _ => "200 OK without m=image (gateway kept audio mode)".to_string(),
                    };
                    tracing::info!(
                        "T.38 re-INVITE rejected: {} — falling back to G.711 passthrough",
                        rejection_reason
                    );
                    emit_fax_event(
                        &app,
                        &job_id,
                        "sip_response",
                        serde_json::json!({
                            "sipMessage": format!("{} {} (T.38 rejected)", t38_result.status_code, t38_result.status_text),
                            "warning": format!("T.38 rejected: {}", rejection_reason),
                            "detail": "Falling back to G.711 passthrough",
                            "messageDirection": "inbound",
                        }),
                    );
                    // Start dialog keepalive with the returned socket (combined flag)
                    if let Some(sock) = returned_socket {
                        let bye_call_id = call_id.clone();
                        let bye_from_tag = from_tag.clone();
                        let bye_to_tag = to_tag.clone();
                        let keepalive_udptl_port = local_udptl_port;
                        let keepalive_local_ip = local_ip.clone();
                        let combined_shutdown = {
                            let global = shutdown.clone();
                            let local = keepalive_shutdown.clone();
                            let combined =
                                std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                            let combined2 = combined.clone();
                            std::thread::spawn(move || {
                                while !combined2.load(std::sync::atomic::Ordering::Relaxed) {
                                    if global.load(std::sync::atomic::Ordering::Relaxed)
                                        || local.load(std::sync::atomic::Ordering::Relaxed)
                                    {
                                        combined2.store(true, std::sync::atomic::Ordering::SeqCst);
                                        break;
                                    }
                                    std::thread::sleep(Duration::from_millis(200));
                                }
                            });
                            combined
                        };
                        let t38_switch_for_keepalive = t38_switch_state.clone();
                        let media_shutdown_for_keepalive = media_stop.clone(); // SEPARATE flag — does NOT kill keepalive
                        std::thread::spawn(move || {
                            run_fax_dialog_keepalive(
                                sock,
                                &bye_call_id,
                                &bye_from_tag,
                                &bye_to_tag,
                                combined_shutdown,
                                keepalive_udptl_port,
                                keepalive_local_ip,
                                t38_switch_for_keepalive,
                                media_shutdown_for_keepalive,
                                true,
                            ); // allow_t38_switch: user originally chose T.38, SBC may retry later
                        });
                    }
                    ("G.711".to_string(), true, None, false)
                }
            }
            Err(e) => {
                // T.38 re-INVITE failed - use G.711 passthrough
                emit_fax_phase(&app, &job_id, "g711_fax");
                tracing::error!("T.38 re-INVITE failed: {}, using G.711 passthrough", e);
                emit_fax_event(
                    &app,
                    &job_id,
                    "sip_error",
                    serde_json::json!({
                        "sipMessage": "re-INVITE failed",
                        "warning": format!("T.38 re-INVITE error: {}", e),
                        "detail": "Falling back to G.711 passthrough",
                        "messageDirection": "info",
                    }),
                );
                // Dialog socket was consumed by send_t38_reinvite — can't start keepalive.
                // The call is still alive via SIP signaling so media should still work.
                ("G.711".to_string(), true, None, false)
            }
        }
    } else {
        // G.711 passthrough mode requested directly
        emit_fax_phase(&app, &job_id, "g711_fax");
        tracing::info!("Using G.711u passthrough mode");
        // IMPORTANT: Do NOT drop the dialog socket! We need it to stay alive so the
        // call server can reach us with SIP keepalives / OPTIONS / BYE. Dropping it
        // causes the call server to detect a dead endpoint and tear down the call
        // within seconds (observed: 4s timeout on many providers).
        // Instead, spawn a lightweight SIP dialog keepalive thread.
        // Use a combined shutdown flag that triggers on EITHER user cancel OR attempt end.
        if let Some(sock) = dialog_socket {
            let bye_call_id = call_id.clone();
            let bye_from_tag = from_tag.clone();
            let bye_to_tag = to_tag.clone();
            let keepalive_udptl_port = local_udptl_port;
            let keepalive_local_ip = local_ip.clone();
            let combined_shutdown = {
                let global = shutdown.clone();
                let local = keepalive_shutdown.clone();
                let combined = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let combined2 = combined.clone();
                std::thread::spawn(move || {
                    while !combined2.load(std::sync::atomic::Ordering::Relaxed) {
                        if global.load(std::sync::atomic::Ordering::Relaxed)
                            || local.load(std::sync::atomic::Ordering::Relaxed)
                        {
                            combined2.store(true, std::sync::atomic::Ordering::SeqCst);
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(200));
                    }
                });
                combined
            };
            let t38_switch_for_keepalive = t38_switch_state.clone();
            let media_shutdown_for_keepalive = media_stop.clone(); // SEPARATE flag — does NOT kill keepalive
            std::thread::spawn(move || {
                // G.711u mode: ACCEPT T.38 re-INVITEs from the SBC.
                //
                // Modern cloud SBCs (Telnyx, Twilio, Bandwidth, etc.) detect fax CNG tones
                // and forcefully switch to T.38 by sending re-INVITEs. When we reject with 415,
                // the SBC STOPS RELAYING G.711 AUDIO — causing one-way RTP. The SBC literally
                // won't pass fax audio after it decides T.38 is needed.
                //
                // The only way to make fax work on these SBCs is to accept their T.38 re-INVITE.
                // This matches real ATA behavior (Grandstream, OBiHAI): they "prefer" G.711 but
                // gracefully accept T.38 when the SBC insists.
                //
                // The result will be labeled "T.38 (SBC-initiated)" in the audit log.
                run_fax_dialog_keepalive(
                    sock,
                    &bye_call_id,
                    &bye_from_tag,
                    &bye_to_tag,
                    combined_shutdown,
                    keepalive_udptl_port,
                    keepalive_local_ip,
                    t38_switch_for_keepalive,
                    media_shutdown_for_keepalive,
                    true,
                ); // allow_t38_switch: true — accept SBC T.38 re-INVITEs so fax can complete
            });
        }
        ("G.711u".to_string(), false, None, false)
    };

    // Check for cancellation before starting fax transmission
    if shutdown.load(std::sync::atomic::Ordering::Relaxed) {
        let _ = end_call(
            registrar_id.clone(),
            call_id.clone(),
            from_tag.clone(),
            to_tag.clone(),
            target_uri.clone(),
            remote_contact.clone(),
            response_to_header.clone(),
            dialog_cseq + 1,
        );
        let _ = media_engine::stop_media(&call_id);
        port_allocator::release(local_rtp_port);
        port_allocator::release(local_udptl_port);
        return Err("Fax cancelled".to_string());
    }

    // Step 3: Transmit fax using SpanDSP
    // Uses the same local_udptl_port that was advertised in the re-INVITE SDP.
    let fax_result = if use_t38 {
        // T.38 UDPTL mode - use t38_terminal
        match remote_udptl_addr {
            Some(remote_udptl) => {
                emit_fax_phase(&app, &job_id, "t38_page");
                tracing::info!(
                    "Starting T.38 UDPTL transmission: local port {}, remote {}",
                    local_udptl_port,
                    remote_udptl
                );

                let t38_start = std::time::Instant::now();
                let progress_app = app.clone();
                let progress_job_id = job_id.clone();
                let on_progress: super::t38_session::T38ProgressCallback =
                    Box::new(move |tx, rx, elapsed| {
                        let _ = progress_app.emit(
                            "fax:send_progress",
                            serde_json::json!({
                                "jobId": progress_job_id,
                                "phase": "t38_page",
                                "udptlPacketsSent": tx,
                                "udptlPacketsReceived": rx,
                                "elapsedSecs": elapsed,
                            }),
                        );
                    });
                // Build T.38 config from user settings (baud rate, ECM, modem type, station ID)
                let t38_config = super::t38_session::T38Config::from_options(&opts);
                tracing::info!(
                    "T.38 config: max_rate={}, ecm={}, modems=0x{:02x}, station={}",
                    t38_config.max_bit_rate,
                    t38_config.ecm_enabled,
                    t38_config.modem_flags,
                    t38_config.station_id
                );

                match super::t38_session::run_t38_fax_with_config(
                    &tiff_path,
                    local_udptl_port,
                    remote_udptl,
                    shutdown.clone(),
                    Some(t38_config),
                    Some(on_progress),
                    None, // Bind fresh — same pattern as RTP
                ) {
                    Ok(result) => {
                        emit_fax_phase(
                            &app,
                            &job_id,
                            if result.success {
                                "t38_done"
                            } else {
                                "t38_dcn"
                            },
                        );
                        tracing::info!(
                            "T.38 transmission complete: success={}, pages={}",
                            result.success,
                            result.pages_sent
                        );
                        Some(super::session::FaxResult {
                            success: result.success,
                            pages_sent: result.pages_sent,
                            duration_ms: t38_start.elapsed().as_millis() as u64,
                            error: result.error.clone(),
                            t30_error_code: result.t30_error_code,
                            t30_error_description: result.error,
                            remote_station_id: result.remote_station_id,
                            negotiated_baud_rate: result.negotiated_baud_rate.or(Some(14400)),
                            ecm_used: result.ecm_used.or(Some(false)),
                            transport: Some("T.38".to_string()),
                            resolution: None,
                            bytes_transmitted: None,
                            ecm_retransmissions: None,
                        })
                    }
                    Err(e) => {
                        tracing::error!("T.38 transmission failed: {}", e);
                        None
                    }
                }
            }
            None => {
                tracing::info!("No remote UDPTL address available");
                None
            }
        }
    } else {
        // G.711 passthrough mode - use fax_state for audio modulation
        //
        // ARCHITECTURE NOTE:
        // Fax uses its own direct RTP path (run_fax_over_rtp) instead of the media engine.
        // The media engine's jitter buffer, audio device setup, and multi-threaded playout
        // add latency that interferes with T.30 fax negotiation timing. The direct path
        // binds its own socket and does send/receive in one tight loop — matching what fax
        // modems expect.
        //
        // This also ensures complete isolation from the softphone:
        //   - Fax calls don't start the media engine
        //   - Fax calls don't stop any running media engines
        //   - Other softphone calls are completely unaffected
        //
        // Safety check: Try to stop media just in case (won't affect anything if not running)
        let _ = media_engine::stop_media(&call_id);

        tracing::info!("Using G.711 passthrough mode (call_id: {})", call_id);

        if let Some(remote_addr) = remote_rtp_addr {
            // Create SpanDSP fax session with user settings (baud rate, ECM, modem type)
            tracing::info!(
                "G.711 config: baud_rate={}, ecm={}, modem={:?}, station={:?}",
                opts.baud_rate,
                opts.ecm,
                opts.modem_type,
                opts.station_id
            );

            match FaxSession::new_send(&tiff_path, &opts) {
                Ok(mut session) => {
                    emit_fax_phase(&app, &job_id, "g711_page");
                    tracing::info!("Starting G.711 fax transmission via SpanDSP");

                    let g711_start = std::time::Instant::now();

                    // Run fax over RTP directly (own socket, no media engine).
                    // The media engine pipeline (jitter buffer, audio devices, multi-threaded
                    // playout) adds latency and complexity that breaks fax T.30 negotiation.
                    // The direct path binds its own socket, sends/receives in one loop, and
                    // feeds SpanDSP immediately — matching fax timing requirements.
                    let g711_result = fax_media::run_fax_over_rtp(
                        &mut session,
                        local_rtp_port,
                        remote_addr,
                        codec,
                        fax_loop_shutdown.clone(), // exits on user cancel OR media_stop (T.38 switch / BYE)
                        Some(app.clone()),
                        Some(job_id.clone()),
                        None, // bind fresh socket
                    );

                    // Check if the G.711 loop was stopped for a T.38 switchover
                    let t38_switch_info = t38_switch_state.lock().ok().and_then(|g| g.clone());

                    if let Some(switch_info) = t38_switch_info {
                        // SBC requested T.38 mid-stream — switch to T.38 UDPTL
                        tracing::info!(
                            "G.711→T.38 switchover: SBC requested T.38, remote UDPTL: {}",
                            switch_info.remote_udptl_addr
                        );
                        emit_fax_phase(&app, &job_id, "t38_switch");
                        emit_fax_event(
                            &app,
                            &job_id,
                            "sip_response",
                            serde_json::json!({
                                "sipMessage": "T.38 re-INVITE accepted (SBC-initiated)",
                                "sdpInfo": format!("UDPTL: remote={}, local={}", switch_info.remote_udptl_addr, local_udptl_port),
                                "messageDirection": "inbound",
                            }),
                        );

                        // Reset shutdown flag for the T.38 session
                        shutdown.store(false, std::sync::atomic::Ordering::SeqCst);

                        // Build T.38 config from user settings
                        let t38_config = super::t38_session::T38Config::from_options(&opts);
                        emit_fax_phase(&app, &job_id, "t38_page");
                        let t38_start = std::time::Instant::now();
                        let progress_app = app.clone();
                        let progress_job_id = job_id.clone();
                        let on_progress: super::t38_session::T38ProgressCallback =
                            Box::new(move |tx, rx, elapsed| {
                                let _ = progress_app.emit(
                                    "fax:send_progress",
                                    serde_json::json!({
                                        "jobId": progress_job_id,
                                        "phase": "t38_page",
                                        "udptlPacketsSent": tx,
                                        "udptlPacketsReceived": rx,
                                        "elapsedSecs": elapsed,
                                    }),
                                );
                            });
                        match super::t38_session::run_t38_fax_with_config(
                            &tiff_path,
                            local_udptl_port,
                            switch_info.remote_udptl_addr,
                            shutdown.clone(),
                            Some(t38_config),
                            Some(on_progress),
                            None,
                        ) {
                            Ok(result) => {
                                emit_fax_phase(
                                    &app,
                                    &job_id,
                                    if result.success {
                                        "t38_done"
                                    } else {
                                        "t38_dcn"
                                    },
                                );
                                tracing::info!(
                                    "T.38 (SBC-initiated switch) complete: success={}, pages={}",
                                    result.success,
                                    result.pages_sent
                                );
                                Some(super::session::FaxResult {
                                    success: result.success,
                                    pages_sent: result.pages_sent,
                                    duration_ms: t38_start.elapsed().as_millis() as u64,
                                    error: result.error.clone(),
                                    t30_error_code: result.t30_error_code,
                                    t30_error_description: result.error,
                                    remote_station_id: result.remote_station_id,
                                    negotiated_baud_rate: result
                                        .negotiated_baud_rate
                                        .or(Some(14400)),
                                    ecm_used: result.ecm_used.or(Some(false)),
                                    transport: Some("T.38 (SBC-initiated)".to_string()),
                                    resolution: None,
                                    bytes_transmitted: None,
                                    ecm_retransmissions: None,
                                })
                            }
                            Err(e) => {
                                tracing::error!("T.38 switchover transmission failed: {}", e);
                                None
                            }
                        }
                    } else {
                        // Normal G.711 result (no T.38 switchover)
                        match g711_result {
                            Ok(result) => {
                                emit_fax_phase(
                                    &app,
                                    &job_id,
                                    if result.success {
                                        "g711_dcn"
                                    } else {
                                        "g711_dcn"
                                    },
                                );
                                tracing::info!(
                                    "Transmission complete: success={}, pages={}",
                                    result.success,
                                    result.pages_sent
                                );
                                Some(super::session::FaxResult {
                                    success: result.success,
                                    pages_sent: result.pages_sent,
                                    duration_ms: g711_start.elapsed().as_millis() as u64,
                                    error: result.error.clone(),
                                    t30_error_code: None,
                                    t30_error_description: result.error,
                                    remote_station_id: result.remote_station_id,
                                    negotiated_baud_rate: result.negotiated_baud_rate,
                                    ecm_used: result.ecm_used,
                                    transport: Some("G.711 µ-law".to_string()),
                                    resolution: None,
                                    bytes_transmitted: None,
                                    ecm_retransmissions: None,
                                })
                            }
                            Err(e) => {
                                tracing::error!("Transmission failed: {}", e);
                                None
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to create fax session: {}", e);
                    None
                }
            }
        } else {
            tracing::info!("No remote RTP address available");
            None
        }
    };

    // Step 4: End the call
    // CSeq must be correct: if T.38 re-INVITE happened, it used dialog_cseq + 1,
    // so BYE needs dialog_cseq + 2. Otherwise BYE uses dialog_cseq + 1.
    let bye_cseq = if use_t38 {
        dialog_cseq + 2
    } else {
        dialog_cseq + 1
    };
    let _ = end_call(
        registrar_id,
        call_id.clone(),
        from_tag,
        to_tag,
        target_uri,
        remote_contact,
        response_to_header,
        bye_cseq,
    );

    // Stop any remaining media
    let _ = media_engine::stop_media(&call_id);
    // Release BOTH allocated ports back to the central pool.
    // For fax, stop_media is a no-op (media engine was never started), so we must
    // explicitly release the RTP port here. Releasing an already-released port is safe.
    port_allocator::release(local_rtp_port);
    port_allocator::release(local_udptl_port);

    // Signal the per-attempt keepalive thread to exit so it doesn't leak across retries
    keepalive_shutdown.store(true, std::sync::atomic::Ordering::SeqCst);
    // Give the thread a moment to see the flag and exit
    std::thread::sleep(Duration::from_millis(100));

    // Build result from fax transmission
    let (ok, pages_sent, error_msg, remote_station_id) = if let Some(ref result) = fax_result {
        (
            result.success,
            Some(result.pages_sent),
            result.error.clone(),
            result.remote_station_id.clone(),
        )
    } else {
        (
            false,
            None,
            Some("Fax transmission failed".to_string()),
            None,
        )
    };

    Ok(InternalFaxResult {
        ok,
        sip_call_id: Some(call_id),
        error_message: error_msg,
        pages_sent,
        remote_station_id,
        capture_session_id: call_result.capture_session_id,
        transport_used: Some(final_transport),
        t38_fallback: Some(t38_fallback),
    })
}

/// Send a test page fax.
/// Best-effort E.164 normalization for the TO field on test pages.
///
/// Strips non-digit chars (except leading +), adds `+` prefix if missing,
/// and assumes NANP (+1) for 10-digit numbers.
fn normalize_to_e164(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.to_ascii_lowercase().starts_with("sip:") {
        return trimmed.to_string();
    }
    let has_plus = trimmed.starts_with('+');
    let digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return trimmed.to_string();
    }
    if has_plus {
        return format!("+{}", digits);
    }
    // 10 digits → assume NANP (+1)
    if digits.len() == 10 {
        return format!("+1{}", digits);
    }
    // 11 digits starting with 1 → NANP
    if digits.len() == 11 && digits.starts_with('1') {
        return format!("+{}", digits);
    }
    // Otherwise just prefix with +
    format!("+{}", digits)
}

///
/// Generates a standard fax test page and sends it to the target.
#[command]
pub async fn fax_send_test_page(
    app: AppHandle,
    registrar_id: String,
    target: String,
    test_page_id: String,
    options: Option<SendFaxOptions>,
    job_id: Option<String>,
) -> Result<SendFaxResult, String> {
    use super::tiff::{self, TestPageSettings};

    // Derive resolution from the user's options (default: fine)
    let res_option = match options.as_ref().and_then(|o| o.resolution.as_deref()) {
        Some("standard") => FaxResolutionOption::Standard,
        _ => FaxResolutionOption::Fine,
    };
    let resolution = res_option.to_tiff_resolution();

    // Build TestPageSettings from the SendFaxOptions so the TIFF content
    // accurately reflects the actual protocol / ECM / baud rate being used.
    let page_settings = {
        let mode_str = options
            .as_ref()
            .and_then(|o| o.mode.as_deref())
            .unwrap_or("t38");
        let protocol = match mode_str {
            "g711" | "g711u" | "g711a" => "G.711 u-law".to_string(),
            _ => "T.38".to_string(),
        };
        let ecm = options.as_ref().and_then(|o| o.ecm).unwrap_or(true);
        let baud_rate = options.as_ref().and_then(|o| o.baud_rate).unwrap_or(14400);
        let to = if target.is_empty() {
            None
        } else {
            Some(normalize_to_e164(&target))
        };
        TestPageSettings {
            protocol,
            ecm,
            baud_rate,
            to,
        }
    };

    let temp_dir = std::env::temp_dir();

    match test_page_id.as_str() {
        "itu_test_page" => {
            let temp_path = temp_dir.join(format!("fax_test_{}.tiff", Uuid::new_v4()));
            let temp_str = temp_path.to_string_lossy().to_string();
            tiff::create_test_page(
                &temp_str,
                Some("SIPALYZER VIRTUAL FAX TEST"),
                resolution,
                Some(&page_settings),
            )?;
            let _guard = TempFileGuard(temp_path);
            fax_send(app, registrar_id, target, temp_str, options, job_id).await
        }
        "full_diagnostic" => {
            let p1_path = temp_dir.join(format!("fax_diag_p1_{}.tiff", Uuid::new_v4()));
            let p1_str = p1_path.to_string_lossy().to_string();
            tiff::create_test_page(
                &p1_str,
                Some("SIPALYZER DIAGNOSTIC"),
                resolution,
                Some(&page_settings),
            )?;

            let p2_path = temp_dir.join(format!("fax_diag_p2_{}.tiff", Uuid::new_v4()));
            let p2_str = p2_path.to_string_lossy().to_string();
            tiff::create_diagnostic_page(&p2_str, resolution)?;

            let p1_data =
                std::fs::read(&p1_path).map_err(|e| format!("Failed to read page 1: {}", e))?;
            let p2_data =
                std::fs::read(&p2_path).map_err(|e| format!("Failed to read page 2: {}", e))?;
            let _ = std::fs::remove_file(&p1_path);
            let _ = std::fs::remove_file(&p2_path);

            let combined = tiff::combine_single_page_tiffs(&[&p1_data, &p2_data])?;
            let temp_path = temp_dir.join(format!("fax_test_{}.tiff", Uuid::new_v4()));
            let temp_str = temp_path.to_string_lossy().to_string();
            std::fs::write(&temp_path, &combined)
                .map_err(|e| format!("Failed to write combined TIFF: {}", e))?;
            let _guard = TempFileGuard(temp_path);
            fax_send(app, registrar_id, target, temp_str, options, job_id).await
        }
        _ => Err(format!("Unknown test document: {}", test_page_id)),
    }
}

/// RAII guard that removes a temp file when dropped (even on panic).
struct TempFileGuard(std::path::PathBuf);
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Get fax audit log entries
#[command]
pub fn fax_get_audit_log(limit: Option<u32>) -> Result<Vec<FaxAuditEntry>, String> {
    let n = limit.unwrap_or(100).min(500) as usize;
    if let Ok(log) = AUDIT_LOG.lock() {
        let len = log.len();
        let start = if len > n { len - n } else { 0 };
        Ok(log[start..].to_vec())
    } else {
        Err("Failed to access audit log".to_string())
    }
}

/// Send a fax from uploaded image data (base64-encoded).
///
/// Writes the base64 data to a temp TIFF file and delegates to `fax_send`.
/// Supports PNG, JPEG, TIFF input — converts to TIFF-F for fax transmission.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedFaxPage {
    pub kind: String,
    pub label: Option<String>,
    pub template_preset_id: Option<String>,
    pub template_brand: Option<String>,
    pub compose_html: Option<String>,
    pub compose_markdown: Option<String>,
    pub upload_base64: Option<String>,
    pub upload_file_name: Option<String>,
}

#[command]
pub async fn fax_send_queued(
    app: AppHandle,
    registrar_id: String,
    target: String,
    pages: Vec<QueuedFaxPage>,
    options: Option<SendFaxOptions>,
    job_id: Option<String>,
) -> Result<SendFaxResult, String> {
    use super::tiff::{self, TestPageSettings};
    use base64::Engine;

    if pages.is_empty() {
        return Err("No queued pages provided".to_string());
    }

    let res_option = match options.as_ref().and_then(|o| o.resolution.as_deref()) {
        Some("standard") => FaxResolutionOption::Standard,
        _ => FaxResolutionOption::Fine,
    };
    let resolution = res_option.to_tiff_resolution();
    let mode_str = options
        .as_ref()
        .and_then(|o| o.mode.as_deref())
        .unwrap_or("t38");
    let protocol = match mode_str {
        "g711" | "g711u" | "g711a" => "G.711 u-law".to_string(),
        _ => "T.38".to_string(),
    };
    let ecm = options.as_ref().and_then(|o| o.ecm).unwrap_or(true);
    let baud_rate = options.as_ref().and_then(|o| o.baud_rate).unwrap_or(14400);
    let to = if target.is_empty() {
        None
    } else {
        Some(normalize_to_e164(&target))
    };
    let page_settings = TestPageSettings {
        protocol,
        ecm,
        baud_rate,
        to,
    };

    let temp_dir = std::env::temp_dir();
    let mut guards: Vec<TempFileGuard> = Vec::new();
    let mut page_bytes: Vec<Vec<u8>> = Vec::new();

    for page in &pages {
        match page.kind.as_str() {
            "template" => {
                let preset_id = page
                    .template_preset_id
                    .clone()
                    .ok_or_else(|| "Template page is missing preset id".to_string())?;
                let brand = page.template_brand.clone().unwrap_or_default();
                let title = if brand.trim().is_empty() {
                    None
                } else {
                    Some(brand.trim().to_string())
                };

                match preset_id.as_str() {
                    "itu_test_page" => {
                        let p_path = temp_dir.join(format!("fax_q_tpl_q_{}.tiff", Uuid::new_v4()));
                        let p_str = p_path.to_string_lossy().to_string();
                        tiff::create_test_page(
                            &p_str,
                            Some("SIPALYZER VIRTUAL FAX TEST"),
                            resolution,
                            Some(&page_settings),
                        )?;
                        let bytes = std::fs::read(&p_path)
                            .map_err(|e| format!("Failed to read queued test page: {}", e))?;
                        page_bytes.push(bytes);
                        guards.push(TempFileGuard(p_path));
                    }
                    "full_diagnostic" => {
                        let p1_path =
                            temp_dir.join(format!("fax_q_tpl_fd1_{}.tiff", Uuid::new_v4()));
                        let p1_str = p1_path.to_string_lossy().to_string();
                        tiff::create_test_page(
                            &p1_str,
                            Some("SIPALYZER DIAGNOSTIC"),
                            resolution,
                            Some(&page_settings),
                        )?;
                        let p1 = std::fs::read(&p1_path).map_err(|e| {
                            format!("Failed to read queued full diagnostic page 1: {}", e)
                        })?;
                        page_bytes.push(p1);
                        guards.push(TempFileGuard(p1_path));

                        let p2_path =
                            temp_dir.join(format!("fax_q_tpl_fd2_{}.tiff", Uuid::new_v4()));
                        let p2_str = p2_path.to_string_lossy().to_string();
                        tiff::create_diagnostic_page(&p2_str, resolution)?;
                        let p2 = std::fs::read(&p2_path).map_err(|e| {
                            format!("Failed to read queued full diagnostic page 2: {}", e)
                        })?;
                        page_bytes.push(p2);
                        guards.push(TempFileGuard(p2_path));
                    }
                    "quick_unbranded" => {
                        let p_path = temp_dir.join(format!("fax_q_tpl_uq_{}.tiff", Uuid::new_v4()));
                        let p_str = p_path.to_string_lossy().to_string();
                        tiff::create_test_page(
                            &p_str,
                            title.as_deref().or(Some("VIRTUAL FAX TEST PAGE")),
                            resolution,
                            Some(&page_settings),
                        )?;
                        let bytes = std::fs::read(&p_path).map_err(|e| {
                            format!("Failed to read queued unbranded test page: {}", e)
                        })?;
                        page_bytes.push(bytes);
                        guards.push(TempFileGuard(p_path));
                    }
                    "full_unbranded" => {
                        let p1_path =
                            temp_dir.join(format!("fax_q_tpl_uf1_{}.tiff", Uuid::new_v4()));
                        let p1_str = p1_path.to_string_lossy().to_string();
                        tiff::create_test_page(
                            &p1_str,
                            title.as_deref().or(Some("VIRTUAL FAX DIAGNOSTIC")),
                            resolution,
                            Some(&page_settings),
                        )?;
                        let p1 = std::fs::read(&p1_path).map_err(|e| {
                            format!("Failed to read queued unbranded diagnostic page 1: {}", e)
                        })?;
                        page_bytes.push(p1);
                        guards.push(TempFileGuard(p1_path));

                        let p2_path =
                            temp_dir.join(format!("fax_q_tpl_uf2_{}.tiff", Uuid::new_v4()));
                        let p2_str = p2_path.to_string_lossy().to_string();
                        tiff::create_diagnostic_page(&p2_str, resolution)?;
                        let p2 = std::fs::read(&p2_path).map_err(|e| {
                            format!("Failed to read queued unbranded diagnostic page 2: {}", e)
                        })?;
                        page_bytes.push(p2);
                        guards.push(TempFileGuard(p2_path));
                    }
                    _ => return Err(format!("Unknown template preset: {}", preset_id)),
                }
            }
            "compose" => {
                let compose_source = page
                    .compose_html
                    .clone()
                    .or_else(|| page.compose_markdown.clone())
                    .unwrap_or_default();
                if compose_source.trim().is_empty() {
                    return Err("Composed queue page is empty".to_string());
                }
                let plain_text = compose_source
                    .replace("<br>", "\n")
                    .replace("<br/>", "\n")
                    .replace("<br />", "\n")
                    .replace("<p>", "")
                    .replace("</p>", "\n")
                    .replace("<strong>", "")
                    .replace("</strong>", "")
                    .replace("<em>", "")
                    .replace("</em>", "")
                    .replace("<h1>", "")
                    .replace("</h1>", "\n")
                    .replace("<h2>", "")
                    .replace("</h2>", "\n")
                    .replace("<h3>", "")
                    .replace("</h3>", "\n");
                let re_clean = plain_text
                    .chars()
                    .fold((String::new(), false), |(mut s, in_tag), c| {
                        if c == '<' {
                            (s, true)
                        } else if c == '>' {
                            (s, false)
                        } else if !in_tag {
                            s.push(c);
                            (s, false)
                        } else {
                            (s, true)
                        }
                    })
                    .0;
                let p_path = temp_dir.join(format!("fax_q_comp_{}.tiff", Uuid::new_v4()));
                let p_str = p_path.to_string_lossy().to_string();
                tiff::create_text_page(&p_str, &re_clean, resolution)?;
                let bytes = std::fs::read(&p_path)
                    .map_err(|e| format!("Failed to read queued compose page: {}", e))?;
                page_bytes.push(bytes);
                guards.push(TempFileGuard(p_path));
            }
            "upload" => {
                let upload_base64 = page
                    .upload_base64
                    .clone()
                    .ok_or_else(|| "Upload queue page is missing base64 content".to_string())?;
                let upload_name = page
                    .upload_file_name
                    .clone()
                    .unwrap_or_else(|| format!("upload_{}.png", Uuid::new_v4()));

                let data = base64::engine::general_purpose::STANDARD
                    .decode(&upload_base64)
                    .map_err(|e| format!("Invalid upload base64 data: {}", e))?;

                let ext = std::path::Path::new(&upload_name)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("png");
                let raw_path = temp_dir.join(format!("fax_q_raw_{}.{}", Uuid::new_v4(), ext));
                std::fs::write(&raw_path, &data)
                    .map_err(|e| format!("Failed to write queued upload temp file: {}", e))?;
                guards.push(TempFileGuard(raw_path.clone()));

                let fax_path = temp_dir.join(format!("fax_q_img_{}.tiff", Uuid::new_v4()));
                let raw_str = raw_path.to_string_lossy().to_string();
                let fax_str = fax_path.to_string_lossy().to_string();
                tiff::convert_to_fax_tiff(&raw_str, &fax_str, resolution)?;
                let bytes = std::fs::read(&fax_path)
                    .map_err(|e| format!("Failed to read converted queued upload TIFF: {}", e))?;
                page_bytes.push(bytes);
                guards.push(TempFileGuard(fax_path));
            }
            other => {
                return Err(format!("Unsupported queued page type: {}", other));
            }
        }
    }

    if page_bytes.is_empty() {
        return Err("No renderable queued pages were produced".to_string());
    }
    let page_refs: Vec<&[u8]> = page_bytes.iter().map(|b| b.as_slice()).collect();
    let combined = tiff::combine_single_page_tiffs(&page_refs)?;
    let combined_path = temp_dir.join(format!("fax_queued_{}.tiff", Uuid::new_v4()));
    std::fs::write(&combined_path, &combined)
        .map_err(|e| format!("Failed to write combined queued TIFF: {}", e))?;
    let combined_str = combined_path.to_string_lossy().to_string();
    guards.push(TempFileGuard(combined_path));

    fax_send(app, registrar_id, target, combined_str, options, job_id).await
}

#[command]
pub async fn fax_send_uploaded(
    app: AppHandle,
    registrar_id: String,
    target: String,
    image_base64: String,
    file_name: String,
    options: Option<SendFaxOptions>,
    job_id: Option<String>,
) -> Result<SendFaxResult, String> {
    use base64::Engine;
    let data = base64::engine::general_purpose::STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    let temp_dir = std::env::temp_dir();
    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("tiff");
    let temp_path = temp_dir.join(format!("fax_upload_{}.{}", Uuid::new_v4(), ext));
    let temp_path_str = temp_path.to_string_lossy().to_string();

    std::fs::write(&temp_path, &data).map_err(|e| format!("Failed to write temp file: {}", e))?;
    let _guard = TempFileGuard(temp_path);

    fax_send(app, registrar_id, target, temp_path_str, options, job_id).await
}

/// Send a composed fax (HTML content rendered to TIFF by backend).
///
/// Converts HTML content to a fax-compatible TIFF and delegates to `fax_send`.
#[command]
pub async fn fax_send_composed(
    app: AppHandle,
    registrar_id: String,
    target: String,
    html_content: String,
    options: Option<SendFaxOptions>,
    job_id: Option<String>,
) -> Result<SendFaxResult, String> {
    use super::tiff;

    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("fax_composed_{}.tiff", Uuid::new_v4()));
    let temp_path_str = temp_path.to_string_lossy().to_string();

    // Render HTML to a fax-compatible TIFF — use the text content for now
    // Strip HTML tags to get plain text, then generate a TIFF page
    let plain_text = html_content
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("<p>", "")
        .replace("</p>", "\n")
        .replace("<strong>", "")
        .replace("</strong>", "")
        .replace("<em>", "")
        .replace("</em>", "")
        .replace("<h1>", "")
        .replace("</h1>", "\n")
        .replace("<h2>", "")
        .replace("</h2>", "\n")
        .replace("<h3>", "")
        .replace("</h3>", "\n");
    // Remove remaining HTML tags
    let re_clean = plain_text
        .chars()
        .fold((String::new(), false), |(mut s, in_tag), c| {
            if c == '<' {
                (s, true)
            } else if c == '>' {
                (s, false)
            } else if !in_tag {
                s.push(c);
                (s, false)
            } else {
                (s, true)
            }
        })
        .0;

    let res_option = match options.as_ref().and_then(|o| o.resolution.as_deref()) {
        Some("standard") => FaxResolutionOption::Standard,
        _ => FaxResolutionOption::Fine,
    };
    tiff::create_text_page(&temp_path_str, &re_clean, res_option.to_tiff_resolution())?;
    let _guard = TempFileGuard(temp_path);

    fax_send(
        app,
        registrar_id,
        target,
        temp_path_str.clone(),
        options,
        job_id,
    )
    .await
}

/// Cancel an active fax job.
#[command]
pub fn fax_cancel(app: AppHandle, job_id: String) -> Result<bool, String> {
    if let Ok(jobs) = ACTIVE_JOBS.lock() {
        if let Some(shutdown) = jobs.get(&job_id) {
            shutdown.store(true, std::sync::atomic::Ordering::SeqCst);
            tracing::info!("Cancelled job {}", &job_id[..8.min(job_id.len())]);
            // Emit error phase so the frontend knows immediately
            emit_fax_phase(&app, &job_id, "error");
            return Ok(true);
        }
    }
    Ok(false) // Job not found or already completed
}

/// Prebuilt test document info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrebuiltDocInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub pages: u32,
}

/// List available prebuilt test documents
#[command]
pub fn fax_list_prebuilt_docs() -> Result<Vec<PrebuiltDocInfo>, String> {
    Ok(vec![
        PrebuiltDocInfo {
            id: "itu_test_page".to_string(),
            name: "Quick Test".to_string(),
            description: "Single page to verify your fax line works".to_string(),
            pages: 1,
        },
        PrebuiltDocInfo {
            id: "full_diagnostic".to_string(),
            name: "Full Diagnostic".to_string(),
            description: "Multi-page test with fill patterns and line quality checks".to_string(),
            pages: 2,
        },
    ])
}

/// Fax document response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaxDocumentResponse {
    pub format: String,
    pub data_base64: Option<String>,
    pub file_path: Option<String>,
}

/// Get a prebuilt test document
#[command]
pub fn fax_get_prebuilt_test_doc(doc_id: String) -> Result<FaxDocumentResponse, String> {
    get_prebuilt_test_doc_internal(&doc_id)
}

fn get_prebuilt_test_doc_internal(doc_id: &str) -> Result<FaxDocumentResponse, String> {
    use super::tiff;

    let temp_dir = std::env::temp_dir();
    let resolution = tiff::FaxResolution::Fine;

    match doc_id {
        "itu_test_page" => {
            let temp_path = temp_dir.join("sipalyzer_test_quick.tiff");
            let temp_str = temp_path.to_string_lossy().to_string();
            tiff::create_test_page(
                &temp_str,
                Some("SIPALYZER VIRTUAL FAX TEST"),
                resolution,
                None,
            )?;

            let tiff_data = std::fs::read(&temp_path)
                .map_err(|e| format!("Failed to read test page: {}", e))?;
            let _ = std::fs::remove_file(&temp_path);

            use base64::Engine;
            Ok(FaxDocumentResponse {
                format: "tiff".to_string(),
                data_base64: Some(base64::engine::general_purpose::STANDARD.encode(&tiff_data)),
                file_path: None,
            })
        }
        "full_diagnostic" => {
            // Page 1: Quick test
            let p1_path = temp_dir.join("sipalyzer_diag_p1.tiff");
            let p1_str = p1_path.to_string_lossy().to_string();
            tiff::create_test_page(&p1_str, Some("SIPALYZER DIAGNOSTIC"), resolution, None)?;

            // Page 2: Line quality
            let p2_path = temp_dir.join("sipalyzer_diag_p2.tiff");
            let p2_str = p2_path.to_string_lossy().to_string();
            tiff::create_diagnostic_page(&p2_str, resolution)?;

            // Combine into multi-page TIFF
            let p1_data =
                std::fs::read(&p1_path).map_err(|e| format!("Failed to read page 1: {}", e))?;
            let p2_data =
                std::fs::read(&p2_path).map_err(|e| format!("Failed to read page 2: {}", e))?;
            let _ = std::fs::remove_file(&p1_path);
            let _ = std::fs::remove_file(&p2_path);

            // Build multi-page TIFF by chaining IFDs
            let combined = tiff::combine_single_page_tiffs(&[&p1_data, &p2_data])?;

            use base64::Engine;
            Ok(FaxDocumentResponse {
                format: "tiff".to_string(),
                data_base64: Some(base64::engine::general_purpose::STANDARD.encode(&combined)),
                file_path: None,
            })
        }
        _ => Err(format!("Unknown test document: {}", doc_id)),
    }
}

/// Generate a minimal test TIFF file
///
/// This creates a valid 1-bit TIFF that can be used for testing.
fn generate_minimal_test_tiff() -> Vec<u8> {
    // Minimal TIFF header for a 1728x100 1-bit image (A4 width at 204 DPI)
    let width: u32 = 1728;
    let height: u32 = 100;
    let rows_per_strip: u32 = height;
    let bits_per_sample: u16 = 1;
    let compression: u16 = 1; // No compression
    let photometric: u16 = 0; // WhiteIsZero (fax standard)

    let bytes_per_row = (width + 7) / 8;
    let image_data_size = bytes_per_row * height;

    // Create image data with a simple test pattern
    let mut image_data = vec![0u8; image_data_size as usize];
    // Add some horizontal lines for visual verification
    for row in (0..height as usize).step_by(10) {
        let start = row * bytes_per_row as usize;
        let end = start + bytes_per_row as usize;
        if end <= image_data.len() {
            for byte in &mut image_data[start..end] {
                *byte = 0xFF; // Black line
            }
        }
    }

    let mut tiff = Vec::new();

    // TIFF Header
    tiff.extend_from_slice(b"II"); // Little-endian
    tiff.extend_from_slice(&42u16.to_le_bytes()); // Magic number
    tiff.extend_from_slice(&8u32.to_le_bytes()); // Offset to first IFD

    // IFD at offset 8
    let num_entries: u16 = 12;
    tiff.extend_from_slice(&num_entries.to_le_bytes());

    let ifd_start = 8u32;
    let ifd_size = 2 + num_entries as u32 * 12 + 4;
    let values_offset = ifd_start + ifd_size;
    let strip_offset = values_offset + 24;

    // IFD Entries (12 bytes each)
    write_ifd_entry(&mut tiff, 256, 3, 1, width); // ImageWidth
    write_ifd_entry(&mut tiff, 257, 3, 1, height); // ImageLength
    write_ifd_entry(&mut tiff, 258, 3, 1, bits_per_sample as u32); // BitsPerSample
    write_ifd_entry(&mut tiff, 259, 3, 1, compression as u32); // Compression
    write_ifd_entry(&mut tiff, 262, 3, 1, photometric as u32); // PhotometricInterpretation
    write_ifd_entry(&mut tiff, 273, 4, 1, strip_offset); // StripOffsets
    write_ifd_entry(&mut tiff, 277, 3, 1, 1); // SamplesPerPixel
    write_ifd_entry(&mut tiff, 278, 3, 1, rows_per_strip); // RowsPerStrip
    write_ifd_entry(&mut tiff, 279, 4, 1, image_data_size); // StripByteCounts
    write_ifd_entry(&mut tiff, 282, 5, 1, values_offset); // XResolution
    write_ifd_entry(&mut tiff, 283, 5, 1, values_offset + 8); // YResolution
    write_ifd_entry(&mut tiff, 296, 3, 1, 2); // ResolutionUnit (inches)

    // Next IFD offset (0 = no more IFDs)
    tiff.extend_from_slice(&0u32.to_le_bytes());

    // Rational values for resolution
    tiff.extend_from_slice(&204u32.to_le_bytes()); // XResolution numerator
    tiff.extend_from_slice(&1u32.to_le_bytes()); // XResolution denominator
    tiff.extend_from_slice(&196u32.to_le_bytes()); // YResolution numerator (fine resolution)
    tiff.extend_from_slice(&1u32.to_le_bytes()); // YResolution denominator

    // Padding to strip_offset
    while tiff.len() < strip_offset as usize {
        tiff.push(0);
    }

    // Image data
    tiff.extend_from_slice(&image_data);

    tiff
}

/// Write an IFD entry
fn write_ifd_entry(tiff: &mut Vec<u8>, tag: u16, typ: u16, count: u32, value: u32) {
    tiff.extend_from_slice(&tag.to_le_bytes());
    tiff.extend_from_slice(&typ.to_le_bytes());
    tiff.extend_from_slice(&count.to_le_bytes());
    tiff.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_minimal_tiff() {
        let tiff = generate_minimal_test_tiff();
        // Check TIFF header
        assert_eq!(&tiff[0..2], b"II"); // Little-endian
        assert_eq!(u16::from_le_bytes([tiff[2], tiff[3]]), 42); // Magic
    }

    #[test]
    fn test_list_prebuilt_docs() {
        let docs = fax_list_prebuilt_docs().unwrap();
        assert!(!docs.is_empty());
        assert!(docs.iter().any(|d| d.id == "itu_test_page"));
    }
}
