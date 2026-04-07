//! MWI (Message Waiting Indicator) — SIP SUBSCRIBE/NOTIFY for message-summary (RFC 3842).
//!
//! After registration, the client sends SUBSCRIBE Event: message-summary to the registrar.
//! The server sends NOTIFY messages with the current voicemail state.

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::Emitter;

use crate::core::config::RegistrarConfig;
use crate::core::database::Database;
use crate::core::user_agent;
use crate::sip::auth;
use crate::sip::stack::{generate_call_id, generate_tag, SipMessage};
use crate::sip::transport::Transport;
use crate::sip::uri::SipUri;

/// Current MWI state for a registrar.
#[derive(Debug, Clone, Serialize)]
pub struct MwiState {
    pub registrar_id: String,
    pub messages_waiting: bool,
    pub new_count: u32,
    pub old_count: u32,
    pub urgent_new: u32,
    pub urgent_old: u32,
    pub voicemail_uri: Option<String>,
}

/// Global MWI state per registrar.
static MWI_STATES: Lazy<Mutex<HashMap<String, MwiState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Background subscription threads; key = registrar_id, value = stop flag.
static MWI_THREADS: Lazy<Mutex<HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Parse RFC 3842 message-summary body.
///
/// Example body:
/// ```text
/// Messages-Waiting: yes
/// Message-Account: sip:*97@example.com
/// Voice-Message: 2/8 (0/0)
/// ```
pub fn parse_message_summary(body: &str) -> MwiState {
    let mut waiting = false;
    let mut new_count = 0u32;
    let mut old_count = 0u32;
    let mut urgent_new = 0u32;
    let mut urgent_old = 0u32;
    let mut account: Option<String> = None;

    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(pos) = line.find(':') {
            let key = line[..pos].trim().to_lowercase();
            let val = line[pos + 1..].trim();
            match key.as_str() {
                "messages-waiting" => {
                    waiting = val.eq_ignore_ascii_case("yes");
                }
                "message-account" => {
                    account = Some(val.to_string());
                }
                "voice-message" => {
                    // Format: new/old or new/old (urgent_new/urgent_old)
                    let (counts_part, urgent_part): (&str, Option<&str>) =
                        if let Some(paren_start) = val.find('(') {
                            let paren_end = val.find(')').unwrap_or(val.len());
                            (
                                val[..paren_start].trim(),
                                Some(&val[paren_start + 1..paren_end]),
                            )
                        } else {
                            (val, None)
                        };
                    let parts: Vec<&str> = counts_part.split('/').collect();
                    if parts.len() >= 2 {
                        new_count = parts[0].trim().parse().unwrap_or(0);
                        old_count = parts[1].trim().parse().unwrap_or(0);
                    }
                    if let Some(urgent) = urgent_part {
                        let uparts: Vec<&str> = urgent.split('/').collect();
                        if uparts.len() >= 2 {
                            urgent_new = uparts[0].trim().parse().unwrap_or(0);
                            urgent_old = uparts[1].trim().parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    MwiState {
        registrar_id: String::new(),
        messages_waiting: waiting,
        new_count,
        old_count,
        urgent_new,
        urgent_old,
        voicemail_uri: account,
    }
}

/// Handle an incoming NOTIFY with Event: message-summary on the inbound listener.
/// Returns true if it was an MWI NOTIFY (handled), false otherwise.
pub fn handle_mwi_notify(
    msg: &SipMessage,
    socket: &UdpSocket,
    peer: std::net::SocketAddr,
    app_handle: &tauri::AppHandle,
) -> bool {
    // Check if this is a message-summary NOTIFY
    let event_header = msg.get_header("Event").map(|s| s.to_lowercase());
    let is_mwi = event_header
        .as_deref()
        .map(|e| e.starts_with("message-summary"))
        .unwrap_or(false);
    if !is_mwi {
        return false;
    }

    tracing::info!("Received NOTIFY message-summary");

    // Send 200 OK response
    let mut ok = SipMessage::new_response(200, "OK");
    if let Some(v) = msg.get_header("Via") {
        ok.add_header("Via", v);
    }
    if let Some(v) = msg.get_header("From") {
        ok.add_header("From", v);
    }
    if let Some(v) = msg.get_header("To") {
        ok.add_header("To", v);
    }
    if let Some(v) = msg.get_header("Call-ID") {
        ok.add_header("Call-ID", v);
    }
    if let Some(v) = msg.get_header("CSeq") {
        ok.add_header("CSeq", v);
    }
    if let Ok(bytes) = ok.to_bytes() {
        let _ = socket.send_to(&bytes, peer);
    }

    // Parse the body
    let body = msg.body.as_deref().unwrap_or("");
    let mut state = parse_message_summary(body);

    // Try to find the registrar from the To header (our AOR)
    let to_header = msg
        .get_header("To")
        .map(|s| s.to_string())
        .unwrap_or_default();
    let to_aor = to_header.trim().trim_matches('"').trim_start_matches('<');
    let to_clean = to_aor.split('>').next().unwrap_or(to_aor);
    let to_user_domain: Vec<&str> = to_clean
        .strip_prefix("sip:")
        .unwrap_or(to_clean)
        .split('@')
        .collect();

    if to_user_domain.len() == 2 {
        let (to_user, to_domain) = (to_user_domain[0], to_user_domain[1]);
        let registrars = Database::load_registrars().unwrap_or_default();
        if let Some(r) = registrars
            .iter()
            .find(|r| r.username == to_user && r.domain == to_domain)
        {
            state.registrar_id = r.id.clone();
        }
    }

    tracing::info!(
        "[MWI] State: waiting={}, new={}, old={}, registrar={}",
        state.messages_waiting,
        state.new_count,
        state.old_count,
        state.registrar_id
    );

    // Store and emit
    if !state.registrar_id.is_empty() {
        if let Ok(mut map) = MWI_STATES.lock() {
            map.insert(state.registrar_id.clone(), state.clone());
        }
        let payload = serde_json::json!({
            "registrarId": state.registrar_id,
            "messagesWaiting": state.messages_waiting,
            "newCount": state.new_count,
            "oldCount": state.old_count,
            "urgentNew": state.urgent_new,
            "urgentOld": state.urgent_old,
            "voicemailUri": state.voicemail_uri,
        });
        let _ = app_handle.emit("softphone:mwi_update", payload);
    }

    true
}

/// Send a SUBSCRIBE request for message-summary to the registrar.
pub fn subscribe_mwi(registrar_id: &str, app_handle: tauri::AppHandle) -> Result<(), String> {
    let registrars = Database::load_registrars().map_err(|e| e.to_string())?;
    let config = registrars
        .iter()
        .find(|r| r.id == registrar_id)
        .ok_or_else(|| "Registrar not found".to_string())?
        .clone();

    // Stop any existing subscription thread for this registrar
    unsubscribe_mwi(registrar_id);

    let rid = registrar_id.to_string();
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_clone = stop.clone();

    if let Ok(mut threads) = MWI_THREADS.lock() {
        threads.insert(rid.clone(), stop.clone());
    }

    std::thread::spawn(move || {
        mwi_subscription_loop(&config, &rid, &stop_clone, &app_handle);
    });

    Ok(())
}

/// Unsubscribe from MWI for a registrar.
pub fn unsubscribe_mwi(registrar_id: &str) {
    if let Ok(mut threads) = MWI_THREADS.lock() {
        if let Some(stop) = threads.remove(registrar_id) {
            stop.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    if let Ok(mut states) = MWI_STATES.lock() {
        states.remove(registrar_id);
    }
}

/// Get the current MWI state for a registrar.
pub fn get_mwi_state(registrar_id: &str) -> Option<MwiState> {
    MWI_STATES
        .lock()
        .ok()
        .and_then(|map| map.get(registrar_id).cloned())
}

/// Background loop: SUBSCRIBE, wait, re-SUBSCRIBE before expiry.
fn mwi_subscription_loop(
    config: &RegistrarConfig,
    registrar_id: &str,
    stop: &std::sync::atomic::AtomicBool,
    app_handle: &tauri::AppHandle,
) {
    let subscribe_interval = Duration::from_secs(3600);
    let retry_delay = Duration::from_secs(30);

    loop {
        if stop.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }

        match send_subscribe(config, 3600) {
            Ok(state) => {
                tracing::info!(
                    "[MWI] SUBSCRIBE OK for {}: waiting={}, new={}, old={}",
                    registrar_id,
                    state.messages_waiting,
                    state.new_count,
                    state.old_count
                );
                let mut full_state = state;
                full_state.registrar_id = registrar_id.to_string();

                if let Ok(mut map) = MWI_STATES.lock() {
                    map.insert(registrar_id.to_string(), full_state.clone());
                }

                let payload = serde_json::json!({
                    "registrarId": registrar_id,
                    "messagesWaiting": full_state.messages_waiting,
                    "newCount": full_state.new_count,
                    "oldCount": full_state.old_count,
                    "urgentNew": full_state.urgent_new,
                    "urgentOld": full_state.urgent_old,
                    "voicemailUri": full_state.voicemail_uri,
                });
                let _ = app_handle.emit("softphone:mwi_update", payload);

                // Wait for re-subscribe (refresh a bit before expiry)
                let wait = subscribe_interval
                    .checked_sub(Duration::from_secs(60))
                    .unwrap_or(subscribe_interval);
                let start = Instant::now();
                while start.elapsed() < wait {
                    if stop.load(std::sync::atomic::Ordering::SeqCst) {
                        // Send unsubscribe (Expires: 0)
                        let _ = send_subscribe(config, 0);
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(5));
                }
            }
            Err(e) => {
                tracing::error!("SUBSCRIBE failed for {}: {}", registrar_id, e);
                // Retry after delay
                let start = Instant::now();
                while start.elapsed() < retry_delay {
                    if stop.load(std::sync::atomic::Ordering::SeqCst) {
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
    }
}

/// Send a SIP SUBSCRIBE for message-summary and parse the initial NOTIFY if piggybacked.
fn send_subscribe(config: &RegistrarConfig, expires: u32) -> Result<MwiState, String> {
    let local_port = config.local_port.unwrap_or(5060);
    let registrar_uri = SipUri::parse(&config.domain).map_err(|e| format!("Bad domain: {}", e))?;
    let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
    let registrar_host = registrar_uri.host_for_resolution();

    let mut transport = Transport::new(
        config.transport.clone(),
        local_port,
        registrar_host,
        registrar_port,
    )
    .map_err(|e| e.to_string())?;

    transport.update_local_ip().map_err(|e| e.to_string())?;
    let local_ip = transport.get_local_ip_address();

    let call_id = generate_call_id();
    let from_tag = generate_tag();
    let branch = format!("z9hG4bK{}", generate_tag());

    let aor_domain = registrar_uri.host.clone();
    let request_uri = format!("sip:{}@{}", config.username, aor_domain);

    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        crate::core::config::TransportType::Tcp => "TCP",
        crate::core::config::TransportType::Tls => "TLS",
        crate::core::config::TransportType::Wss => "WSS",
    };

    let contact_port = config.listening_port.unwrap_or(local_port);

    let mut request = SipMessage::new_request("SUBSCRIBE", &request_uri);
    request.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch={}",
            via_transport, local_ip, contact_port, branch
        ),
    );
    request.add_header("Max-Forwards", "70");
    request.add_header("To", &format!("<sip:{}@{}>", config.username, aor_domain));
    request.add_header(
        "From",
        &format!("<sip:{}@{}>;tag={}", config.username, aor_domain, from_tag),
    );
    request.add_header("Call-ID", &call_id);
    request.add_header("CSeq", "1 SUBSCRIBE");
    request.add_header(
        "Contact",
        &format!("<sip:{}@{}:{}>", config.username, local_ip, contact_port),
    );
    request.add_header("Event", "message-summary");
    request.add_header("Accept", "application/simple-message-summary");
    request.add_header("Expires", &expires.to_string());
    request.add_header("User-Agent", &user_agent::get_effective_user_agent());

    let request_bytes = request.to_bytes().map_err(|e| e.to_string())?;

    transport.send(&request_bytes).map_err(|e| e.to_string())?;

    let timeout = Duration::from_secs(config.timeout_seconds);
    let response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
    let response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;

    let status_code = response.status_code.unwrap_or(0);

    // Handle auth challenge
    if status_code == 401 || status_code == 407 {
        return handle_subscribe_auth(
            &transport, &request, &response, config, &call_id, &from_tag, timeout,
        );
    }

    if status_code < 200 || status_code >= 300 {
        return Err(format!(
            "SUBSCRIBE failed: {} {}",
            status_code,
            response.status_text.as_deref().unwrap_or("")
        ));
    }

    // After 200 OK, server may send a NOTIFY immediately. Try to receive it.
    let mut state = MwiState {
        registrar_id: String::new(),
        messages_waiting: false,
        new_count: 0,
        old_count: 0,
        urgent_new: 0,
        urgent_old: 0,
        voicemail_uri: None,
    };

    // Try to receive NOTIFY (short timeout)
    if let Ok(notify_bytes) = transport.receive(Duration::from_secs(3)) {
        if let Ok(notify) = SipMessage::from_bytes(&notify_bytes) {
            if notify.method.eq_ignore_ascii_case("NOTIFY") {
                if let Some(body) = &notify.body {
                    state = parse_message_summary(body);
                }
                // Send 200 OK for NOTIFY
                let mut ok = SipMessage::new_response(200, "OK");
                if let Some(v) = notify.get_header("Via") {
                    ok.add_header("Via", v);
                }
                if let Some(v) = notify.get_header("From") {
                    ok.add_header("From", v);
                }
                if let Some(v) = notify.get_header("To") {
                    ok.add_header("To", v);
                }
                if let Some(v) = notify.get_header("Call-ID") {
                    ok.add_header("Call-ID", v);
                }
                if let Some(v) = notify.get_header("CSeq") {
                    ok.add_header("CSeq", v);
                }
                if let Ok(bytes) = ok.to_bytes() {
                    let _ = transport.send(&bytes);
                }
            }
        }
    }

    Ok(state)
}

/// Handle 401/407 auth challenge for SUBSCRIBE.
fn handle_subscribe_auth(
    transport: &Transport,
    original_request: &SipMessage,
    challenge: &SipMessage,
    config: &RegistrarConfig,
    _call_id: &str,
    _from_tag: &str,
    timeout: Duration,
) -> Result<MwiState, String> {
    let auth_header = if challenge.status_code == Some(401) {
        challenge.get_header("WWW-Authenticate")
    } else {
        challenge.get_header("Proxy-Authenticate")
    };
    let auth_header = auth_header.ok_or("Missing auth challenge header")?;

    let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
    let auth_challenge =
        auth::parse_auth_challenge(auth_header, default_realm).map_err(|e| e.to_string())?;

    let username = config.auth_username.as_ref().unwrap_or(&config.username);
    let password = &config.password;

    let registrar_uri = SipUri::parse(&config.domain).map_err(|e| format!("Bad domain: {}", e))?;
    let aor_domain = registrar_uri.host.clone();
    let request_uri = format!("sip:{}@{}", config.username, aor_domain);

    let mut auth_request = SipMessage::new_request("SUBSCRIBE", &request_uri);

    // Copy headers from original (except CSeq)
    for (name, value) in &original_request.headers {
        if name.to_lowercase() != "cseq" {
            auth_request.add_header(name, value);
        }
    }
    auth_request.add_header("CSeq", "2 SUBSCRIBE");

    let auth_value = auth::build_digest_authorization(
        "SUBSCRIBE",
        &request_uri,
        username,
        password,
        &auth_challenge,
    );

    if challenge.status_code == Some(401) {
        auth_request.add_header("Authorization", &auth_value);
    } else {
        auth_request.add_header("Proxy-Authorization", &auth_value);
    }

    let request_bytes = auth_request.to_bytes().map_err(|e| e.to_string())?;
    transport.send(&request_bytes).map_err(|e| e.to_string())?;

    let response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
    let response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    let status_code = response.status_code.unwrap_or(0);

    if status_code < 200 || status_code >= 300 {
        return Err(format!(
            "SUBSCRIBE auth failed: {} {}",
            status_code,
            response.status_text.as_deref().unwrap_or("")
        ));
    }

    // Try to receive NOTIFY
    let mut state = MwiState {
        registrar_id: String::new(),
        messages_waiting: false,
        new_count: 0,
        old_count: 0,
        urgent_new: 0,
        urgent_old: 0,
        voicemail_uri: None,
    };

    if let Ok(notify_bytes) = transport.receive(Duration::from_secs(3)) {
        if let Ok(notify) = SipMessage::from_bytes(&notify_bytes) {
            if notify.method.eq_ignore_ascii_case("NOTIFY") {
                if let Some(body) = &notify.body {
                    state = parse_message_summary(body);
                }
                let mut ok = SipMessage::new_response(200, "OK");
                if let Some(v) = notify.get_header("Via") {
                    ok.add_header("Via", v);
                }
                if let Some(v) = notify.get_header("From") {
                    ok.add_header("From", v);
                }
                if let Some(v) = notify.get_header("To") {
                    ok.add_header("To", v);
                }
                if let Some(v) = notify.get_header("Call-ID") {
                    ok.add_header("Call-ID", v);
                }
                if let Some(v) = notify.get_header("CSeq") {
                    ok.add_header("CSeq", v);
                }
                if let Ok(bytes) = ok.to_bytes() {
                    let _ = transport.send(&bytes);
                }
            }
        }
    }

    Ok(state)
}
