//! Tauri commands for softphone: place call, end call, cancel call, hold call.

use crate::commands::packet_capture::{
    get_interface_for_ip, list_interfaces, start_capture_session, stop_capture,
};
use crate::packet_capture::FilterConfig;
use crate::softphone;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::command;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::mpsc;

#[derive(Clone, serde::Serialize)]
pub struct CallProgressPayload {
    pub pending_call_id: String,
    pub status_code: u16,
    pub status_text: String,
}

#[derive(Clone, serde::Serialize)]
pub struct CallEndedByRemotePayload {
    /// snake_case — used by frontend: event.payload.call_id
    pub call_id: String,
    /// camelCase — used by frontend fallback: event.payload.callId
    #[serde(rename = "callId")]
    pub call_id_camel: String,
}

/// call_id -> capture_session_id for per-call captures; stop when call ends.
static CALL_CAPTURES: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Register a capture session for a call so it can be stopped when the call ends (used by softphone and fax).
pub(crate) fn register_call_capture(call_id: String, session_id: String) {
    if let Ok(mut map) = CALL_CAPTURES.lock() {
        map.insert(call_id, session_id);
    }
}

/// Stop the packet capture associated with a call (used when call ends from softphone or fax BYE listener).
pub(crate) fn stop_capture_for_call(call_id: &str) {
    if let Ok(mut map) = CALL_CAPTURES.lock() {
        if let Some(session_id) = map.remove(call_id) {
            let _ = stop_capture(session_id);
        }
    }
}

#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_place_call(
    window: tauri::Window,
    registrar_id: String,
    target: String,
    preferred_codecs: Option<Vec<String>>,
    pending_call_id: Option<String>,
) -> Result<softphone::PlaceCallResult, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "softphone",
        "place_call",
        "user",
        Some(&target),
        Some(&format!("registrar={}", registrar_id)),
    );
    let pending_id = pending_call_id.unwrap_or_default();
    let registrar_id_for_bye = registrar_id.clone();
    let target_for_capture = target.clone();
    let (tx, mut rx) = mpsc::unbounded_channel::<(u16, String)>();

    let on_before_invite: softphone::OnBeforeInvite =
        Some(Box::new(move |local_ip: &str, _call_id: &str| {
            let interface = get_interface_for_ip(local_ip.to_string())
                .ok()
                .flatten()
                .unwrap_or_else(|| {
                    list_interfaces()
                        .ok()
                        .and_then(|list| {
                            list.into_iter()
                                .find(|i| {
                                    !i.addresses.is_empty() && !i.name.to_lowercase().contains("lo")
                                })
                                .map(|i| i.name)
                        })
                        .unwrap_or_else(|| "any".to_string())
                });
            tracing::info!(
                "Starting call capture on interface '{}' (local_ip={})",
                interface,
                local_ip
            );
            let name = format!(
                "Call to {} - {}",
                target_for_capture,
                chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")
            );
            // Per-call capture: no filter so we capture all packets for the call duration.
            match start_capture_session(name, None, interface.clone(), FilterConfig::default()) {
                Ok(id) => {
                    tracing::info!("Capture started: session_id={}", id);
                    Some(id)
                }
                Err(e) => {
                    tracing::error!(
                        "⚠ CAPTURE FAILED to start on interface '{}': {}",
                        interface,
                        e
                    );
                    None
                }
            }
        }));

    let join_handle = tokio::task::spawn_blocking(move || {
        softphone::place_call(
            registrar_id,
            target,
            preferred_codecs,
            Some(tx),
            on_before_invite,
            false,
            None,
        )
    });

    let mut join_handle = join_handle;
    let mut opt_result: Option<
        Result<
            (
                softphone::PlaceCallResult,
                Option<std::net::UdpSocket>,
                Option<std::net::TcpStream>,
            ),
            String,
        >,
    > = None;
    loop {
        tokio::select! {
            res = &mut join_handle => {
                opt_result = Some(res.map_err(|e| e.to_string())?);
                break;
            }
            msg = rx.recv() => {
                if let Some((status_code, status_text)) = msg {
                    let _ = window.emit("softphone:call_progress", CallProgressPayload {
                        pending_call_id: pending_id.clone(),
                        status_code,
                        status_text,
                    });
                } else {
                    break;
                }
            }
        }
    }

    let (result, dialog_socket, dialog_tcp_stream) = match opt_result {
        Some(r) => r?,
        None => {
            let inner = join_handle.await.map_err(|e| e.to_string())?;
            inner.map_err(|e| e.to_string())?
        }
    };

    if let Some(ref sid) = result.capture_session_id {
        if let Ok(mut map) = CALL_CAPTURES.lock() {
            map.insert(result.call_id.clone(), sid.clone());
        }
    }

    if result.ok {
        let app_handle = window.app_handle().clone();
        let window_for_bye = window.clone();
        let call_id = result.call_id.clone();
        let from_tag = result.from_tag.clone();
        let to_tag = result.to_tag.clone().unwrap_or_default();
        let target_uri = result.target_uri.clone();
        let remote_contact_uri = result.remote_contact_uri.clone();
        let response_to_header = result.response_to_header.clone();
        let cseq = result.dialog_cseq;
        let local_ip = result
            .local_ip
            .clone()
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let local_rtp_port = result.local_rtp_port;
        let reg_id = registrar_id_for_bye;
        let session_expires_secs = result.session_expires_secs;
        let session_refresher = result.session_refresher.clone();
        let (bye_tx, bye_rx) = std::sync::mpsc::channel::<u32>();
        softphone::register_dialog_sender(call_id.clone(), bye_tx);
        let call_id_for_callback = call_id.clone();
        let on_remote_bye = move || {
            let payload = CallEndedByRemotePayload {
                call_id: call_id_for_callback.clone(),
                call_id_camel: call_id_for_callback.clone(),
            };
            let _ = window_for_bye.emit("softphone:call_ended_by_remote", &payload);
            let _ = app_handle.emit("softphone:call_ended_by_remote", &payload);
            if let Some(main_win) = app_handle.get_webview_window("main") {
                let _ = main_win.emit("softphone:call_ended_by_remote", &payload);
            }
            stop_capture_for_call(&call_id_for_callback);
        };
        // BYE listener: receives remote BYE on the same port that sent the INVITE.
        //
        // IMPORTANT: On macOS (and possibly other platforms), the dialog UDP socket
        // from the INVITE exchange can become "deaf" after being moved across threads
        // via Tokio spawn_blocking → std::thread::spawn. The socket is bound and the
        // OS delivers packets to the port, but recv_from never returns them.
        //
        // Fix: drop the dialog socket to free the port, then let run_bye_listener
        // bind a FRESH socket on the same port. The proxy retransmits BYE (RFC 3261
        // §17.1.1.2), so we won't miss it during the brief rebind window.
        drop(dialog_socket);
        if dialog_tcp_stream.is_none() {
            std::thread::spawn(move || {
                softphone::run_bye_listener(
                    None, // fresh socket — see comment above
                    reg_id,
                    call_id,
                    from_tag,
                    to_tag,
                    target_uri,
                    remote_contact_uri,
                    response_to_header,
                    cseq,
                    local_ip,
                    local_rtp_port,
                    bye_rx,
                    Box::new(on_remote_bye),
                    None,
                    session_expires_secs,
                    session_refresher,
                );
            });
        } else if let Some(stream) = dialog_tcp_stream {
            std::thread::spawn(move || {
                softphone::run_tcp_bye_listener(
                    stream,
                    reg_id,
                    call_id,
                    from_tag,
                    to_tag,
                    target_uri,
                    remote_contact_uri,
                    response_to_header,
                    cseq,
                    local_ip,
                    local_rtp_port,
                    bye_rx,
                    Box::new(on_remote_bye),
                    None,
                );
            });
        }
    }

    Ok(result)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_end_call(
    registrar_id: String,
    call_id: String,
    from_tag: String,
    to_tag: String,
    target_uri: String,
    remote_contact_uri: Option<String>,
    response_to_header: Option<String>,
    cseq: u32,
) -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "softphone",
        "end_call",
        "user",
        Some(&call_id),
        None,
    );
    let result = softphone::end_call(
        registrar_id,
        call_id.clone(),
        from_tag,
        to_tag,
        target_uri,
        remote_contact_uri,
        response_to_header,
        cseq,
    );
    // Stop capture in background so it doesn't block the command return.
    // The capture thread join can take time; we don't need to wait for it.
    let cid = call_id;
    std::thread::spawn(move || {
        stop_capture_for_call(&cid);
    });
    result
}

#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_cancel_call(
    registrar_id: String,
    call_id: String,
    from_tag: String,
    target_uri: String,
) -> Result<(), String> {
    let result = softphone::cancel_call(registrar_id, call_id.clone(), from_tag, target_uri).await;
    let cid = call_id;
    std::thread::spawn(move || {
        stop_capture_for_call(&cid);
    });
    result
}

#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_hold_call(
    registrar_id: String,
    call_id: String,
    from_tag: String,
    to_tag: String,
    target_uri: String,
    remote_contact_uri: Option<String>,
    on_hold: bool,
    cseq: u32,
    call_local_rtp_port: Option<u16>,
    call_local_ip: Option<String>,
) -> Result<u32, String> {
    softphone::hold_call(
        registrar_id,
        call_id,
        from_tag,
        to_tag,
        target_uri,
        remote_contact_uri,
        on_hold,
        cseq,
        call_local_rtp_port,
        call_local_ip,
    )
    .await
}

/// Poll for call IDs that the backend detected as ended by remote (BYE or TCP EOF).
/// Returns and clears the list. Frontend should poll every ~1.5s while there is an active call.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_get_remote_ended_calls() -> Result<Vec<String>, String> {
    Ok(softphone::take_remote_ended_calls())
}

/// Start listening for inbound SIP INVITEs on the given port (UDP).
/// If already listening on the same port, this is a no-op.
/// If the port changed, the old listener is shut down and a new one starts.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_start_inbound_listener(
    port: u16,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    softphone::start_inbound_listener(port, app_handle)
}

/// Stop the inbound SIP listener if one is running.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_stop_inbound_listener() -> Result<(), String> {
    softphone::stop_inbound_listener();
    Ok(())
}

/// Reconcile inbound SIP listeners to the exact set of provided ports.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_sync_inbound_listeners(
    ports: Vec<u16>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    softphone::sync_inbound_listeners(ports, app_handle)
}

/// Answer an inbound call: send 200 OK, wait for ACK, start media.
/// Returns the capture session ID (if packet capture was started) so the frontend can track it.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_answer_inbound_call(
    registrar_id: String,
    call_id: String,
) -> Result<Option<String>, String> {
    // Start a packet capture for the inbound call (same approach as outbound calls)
    let capture_session_id = {
        let interface = list_interfaces()
            .ok()
            .and_then(|list| {
                list.into_iter()
                    .find(|i| !i.addresses.is_empty() && !i.name.to_lowercase().contains("lo"))
                    .map(|i| i.name)
            })
            .unwrap_or_else(|| "any".to_string());
        tracing::info!("Starting inbound call capture on interface '{}'", interface);
        let name = format!(
            "Inbound call - {}",
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")
        );
        match start_capture_session(name, None, interface.clone(), FilterConfig::default()) {
            Ok(id) => {
                tracing::info!("Inbound capture started: session_id={}", id);
                Some(id)
            }
            Err(e) => {
                tracing::error!(
                    "⚠ INBOUND CAPTURE FAILED on interface '{}': {}",
                    interface,
                    e
                );
                None
            }
        }
    };

    if let Some(ref sid) = capture_session_id {
        register_call_capture(call_id.clone(), sid.clone());
    }

    softphone::answer_inbound_call(registrar_id, call_id)?;
    Ok(capture_session_id)
}

/// Reject an inbound call (e.g. 486 Busy Here).
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_reject_inbound_call(
    call_id: String,
    status_code: Option<u16>,
) -> Result<(), String> {
    softphone::reject_inbound_call(call_id, status_code.unwrap_or(486))
}

/// Send a DTMF digit via RFC 2833 telephone-event on an active call's RTP stream.
/// `digit` is one of: 0-9, *, #, A-D.
/// `dtmf_pt` is the negotiated telephone-event payload type (default 101).
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_send_dtmf(
    call_id: String,
    digit: String,
    dtmf_pt: Option<u8>,
) -> Result<(), String> {
    let ch = digit.chars().next().ok_or("Empty digit")?;
    softphone::send_dtmf(&call_id, ch, dtmf_pt.unwrap_or(101))
}

/// SIP REFER transfer: ask the far end to transfer the call to `refer_to`.
/// Returns the CSeq used (for tracking dialog state).
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_send_refer(
    registrar_id: String,
    call_id: String,
    from_tag: String,
    to_tag: String,
    target_uri: String,
    remote_contact_uri: Option<String>,
    response_to_header: Option<String>,
    cseq: u32,
    refer_to: String,
) -> Result<u32, String> {
    softphone::send_refer(
        registrar_id,
        call_id,
        from_tag,
        to_tag,
        target_uri,
        remote_contact_uri,
        response_to_header,
        cseq,
        refer_to,
    )
}

/// Attended (consultative) transfer: sends REFER on call A with Replaces for call B.
/// After the PBX processes the REFER, A and B are connected directly.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_send_attended_refer(
    registrar_id: String,
    call_id_a: String,
    from_tag_a: String,
    to_tag_a: String,
    target_uri_a: String,
    remote_contact_uri_a: Option<String>,
    response_to_header_a: Option<String>,
    cseq_a: u32,
    call_id_b: String,
    from_tag_b: String,
    to_tag_b: String,
    target_b: String,
) -> Result<u32, String> {
    softphone::send_attended_refer(
        registrar_id,
        call_id_a,
        from_tag_a,
        to_tag_a,
        target_uri_a,
        remote_contact_uri_a,
        response_to_header_a,
        cseq_a,
        call_id_b,
        from_tag_b,
        to_tag_b,
        target_b,
    )
}

/// Start recording an active call to a stereo WAV file.
/// Returns the file path of the recording.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_start_recording(call_id: String) -> Result<String, String> {
    softphone::start_recording(&call_id)
}

/// Stop recording an active call. Finalizes the WAV file.
/// Returns the file path of the completed recording.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_stop_recording(call_id: String) -> Result<String, String> {
    softphone::stop_recording(&call_id)
}

/// Check if a call is currently being recorded.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_is_recording(call_id: String) -> Result<bool, String> {
    Ok(softphone::is_recording(&call_id))
}

/// List all recordings.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_list_recordings() -> Result<Vec<softphone::RecordingInfo>, String> {
    softphone::list_recordings()
}

/// Delete a recording file by filename.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_delete_recording(filename: String) -> Result<(), String> {
    softphone::delete_recording(&filename)
}

/// Read raw WAV bytes for a recording. Returns base64-encoded data for efficient browser playback.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_read_recording(filename: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let data = softphone::read_recording_data(&filename)?;
    Ok(STANDARD.encode(&data))
}

/// Subscribe to MWI (Message Waiting Indicator) for a registrar.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_subscribe_mwi(
    registrar_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    softphone::subscribe_mwi(&registrar_id, app_handle)
}

/// Unsubscribe from MWI for a registrar.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_unsubscribe_mwi(registrar_id: String) -> Result<(), String> {
    softphone::unsubscribe_mwi(&registrar_id);
    Ok(())
}

/// Get the current MWI state for a registrar.
#[command]
#[tracing::instrument(skip_all)]
pub async fn softphone_get_mwi_state(
    registrar_id: String,
) -> Result<Option<softphone::MwiState>, String> {
    Ok(softphone::get_mwi_state(&registrar_id))
}

/// Update the RTP / UDPTL port allocation range for the central port allocator.
#[command]
#[tracing::instrument(skip_all)]
pub fn set_media_port_range(range_low: u16, range_high: u16) -> Result<(), String> {
    if range_low >= range_high {
        return Err("range_low must be less than range_high".to_string());
    }
    if range_low < 1024 {
        return Err("range_low must be >= 1024 (privileged ports)".to_string());
    }
    softphone::port_allocator::set_range(range_low, range_high);
    Ok(())
}

/// Get the current port allocator status (range, ports in use).
#[command]
#[tracing::instrument(skip_all)]
pub fn get_media_port_status() -> softphone::port_allocator::PortAllocatorStatus {
    softphone::port_allocator::status()
}

// ── BLF commands ───────────────────────────────────────────────────

#[command]
#[tracing::instrument(skip_all)]
pub async fn subscribe_blf(
    window: tauri::Window,
    registrar_id: String,
    extension: String,
) -> Result<(), String> {
    let app_handle = window.app_handle().clone();
    softphone::blf::subscribe_blf(&registrar_id, &extension, app_handle)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn unsubscribe_blf(registrar_id: String, extension: String) {
    softphone::blf::unsubscribe_blf(&registrar_id, &extension);
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_blf_state(registrar_id: String, extension: String) -> Option<softphone::blf::BlfState> {
    softphone::blf::get_blf_state(&registrar_id, &extension)
}

// ── SIP MESSAGE commands ───────────────────────────────────────────

#[command]
#[tracing::instrument(skip_all)]
pub fn send_sip_message(
    registrar_id: String,
    target: String,
    body: String,
    content_type: Option<String>,
) -> Result<(), String> {
    softphone::sip_message::send_message(&registrar_id, &target, &body, content_type.as_deref())
}

// ── Presence PUBLISH commands ──────────────────────────────────────

#[command]
#[tracing::instrument(skip_all)]
pub fn publish_presence(
    registrar_id: String,
    state: String,
    sip_if_match: Option<String>,
) -> Result<Option<String>, String> {
    let presence_state = match state.to_lowercase().as_str() {
        "open" | "available" => softphone::presence::PresenceState::Open,
        "closed" | "offline" | "dnd" => softphone::presence::PresenceState::Closed,
        "busy" => softphone::presence::PresenceState::Busy,
        "away" => softphone::presence::PresenceState::Away,
        _ => return Err(format!("Unknown presence state: {}", state)),
    };
    softphone::presence::publish_presence(
        &registrar_id,
        presence_state,
        sip_if_match.as_deref(),
        3600,
    )
}

#[command]
#[tracing::instrument(skip_all)]
pub fn unpublish_presence(registrar_id: String, sip_if_match: String) -> Result<(), String> {
    softphone::presence::unpublish_presence(&registrar_id, &sip_if_match)
}

// ── Conference mixing commands ─────────────────────────────────────

#[command]
#[tracing::instrument(skip_all)]
pub fn join_conference(call_id: String, conference_id: String) {
    softphone::media_engine::join_conference(&call_id, &conference_id);
}

#[command]
#[tracing::instrument(skip_all)]
pub fn leave_conference(call_id: String) {
    softphone::media_engine::leave_conference(&call_id);
}

// ── OPTIONS keepalive commands ─────────────────────────────────────

#[command]
#[tracing::instrument(skip_all)]
pub fn start_options_keepalive(registrar_id: String) {
    softphone::options_keepalive::start_keepalive(&registrar_id);
}

#[command]
#[tracing::instrument(skip_all)]
pub fn stop_options_keepalive(registrar_id: String) {
    softphone::options_keepalive::stop_keepalive(&registrar_id);
}
