//! Global SIP message log emitter.
//!
//! Stores an `AppHandle` once at startup and provides `emit_sip_log()` which
//! any thread can call to push a SIP message event to the frontend.

use once_cell::sync::OnceCell;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

/// Store the app handle on startup. Called once from the Tauri setup hook.
pub fn init(app_handle: AppHandle) {
    let _ = APP_HANDLE.set(app_handle);
}

/// Get a reference to the global AppHandle (if initialised).
pub fn app_handle() -> Option<&'static AppHandle> {
    APP_HANDLE.get()
}

#[derive(Debug, Clone, Serialize)]
pub struct SipLogEvent {
    /// SIP Call-ID header value (may be empty for pre-dialog messages).
    pub call_id: String,
    /// "send" or "recv"
    pub direction: &'static str,
    /// SIP method (INVITE, ACK, BYE, CANCEL, REFER, …) or empty for responses.
    pub method: String,
    /// SIP status code (0 for requests).
    pub status_code: u16,
    /// First line of the SIP message (e.g. "INVITE sip:…" or "SIP/2.0 200 OK").
    pub summary: String,
    /// Full raw SIP message text.
    pub raw: String,
    /// ISO-8601 timestamp.
    pub timestamp: String,
}

/// Emit a SIP log event to the frontend.  Best-effort — silently dropped if
/// the AppHandle was never initialised (e.g. in CLI / test mode).
pub fn emit(evt: SipLogEvent) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("softphone:sip_message", &evt);
    }
}

/// Convenience: build and emit a SIP log entry from raw bytes.
pub fn log_bytes(call_id: &str, direction: &'static str, bytes: &[u8]) {
    let raw = String::from_utf8_lossy(bytes).to_string();
    let first_line = raw.lines().next().unwrap_or("").to_string();

    let (method, status_code) = if first_line.starts_with("SIP/") {
        // Response: "SIP/2.0 200 OK"
        let code = first_line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(0);
        (String::new(), code)
    } else {
        // Request: "INVITE sip:… SIP/2.0"
        let m = first_line
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_string();
        (m, 0)
    };

    emit(SipLogEvent {
        call_id: call_id.to_string(),
        direction,
        method,
        status_code,
        summary: first_line,
        raw,
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    });
}
