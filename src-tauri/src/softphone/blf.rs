//! BLF (Busy Lamp Field) — SIP SUBSCRIBE to dialog event package (RFC 4235).
//!
//! Monitors the presence/call state of extensions on the PBX. Each monitored extension
//! gets a SUBSCRIBE with Event: dialog, and the PBX sends NOTIFY with the current state.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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

#[derive(Debug, Clone, Serialize)]
pub struct BlfState {
    pub extension: String,
    pub registrar_id: String,
    pub state: String, // "idle", "ringing", "busy", "offline"
    pub direction: Option<String>,
    pub remote_party: Option<String>,
}

static BLF_STATES: Lazy<Mutex<HashMap<String, BlfState>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Key = "registrar_id:extension", value = stop flag
static BLF_THREADS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Start monitoring an extension's BLF state via SIP SUBSCRIBE dialog.
pub fn subscribe_blf(
    registrar_id: &str,
    extension: &str,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let registrars = Database::load_registrars().map_err(|e| e.to_string())?;
    let config = registrars
        .iter()
        .find(|r| r.id == registrar_id)
        .ok_or_else(|| "Registrar not found".to_string())?
        .clone();

    let key = format!("{}:{}", registrar_id, extension);
    unsubscribe_blf_key(&key);

    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut threads) = BLF_THREADS.lock() {
        threads.insert(key.clone(), stop.clone());
    }

    let ext = extension.to_string();
    let rid = registrar_id.to_string();
    std::thread::spawn(move || {
        blf_subscription_loop(&config, &rid, &ext, &stop, &app_handle);
    });

    Ok(())
}

/// Stop monitoring an extension.
pub fn unsubscribe_blf(registrar_id: &str, extension: &str) {
    let key = format!("{}:{}", registrar_id, extension);
    unsubscribe_blf_key(&key);
}

fn unsubscribe_blf_key(key: &str) {
    if let Ok(mut threads) = BLF_THREADS.lock() {
        if let Some(stop) = threads.remove(key) {
            stop.store(true, Ordering::SeqCst);
        }
    }
    if let Ok(mut states) = BLF_STATES.lock() {
        states.remove(key);
    }
}

/// Stop all BLF subscriptions.
pub fn unsubscribe_all() {
    if let Ok(mut threads) = BLF_THREADS.lock() {
        for (_, stop) in threads.drain() {
            stop.store(true, Ordering::SeqCst);
        }
    }
    if let Ok(mut states) = BLF_STATES.lock() {
        states.clear();
    }
}

/// Get the current BLF state for an extension.
pub fn get_blf_state(registrar_id: &str, extension: &str) -> Option<BlfState> {
    let key = format!("{}:{}", registrar_id, extension);
    BLF_STATES.lock().ok().and_then(|map| map.get(&key).cloned())
}

/// Handle an incoming NOTIFY with Event: dialog on the inbound listener.
/// Returns true if it was a dialog NOTIFY (handled), false otherwise.
pub fn handle_dialog_notify(
    msg: &SipMessage,
    socket: &std::net::UdpSocket,
    peer: SocketAddr,
    app_handle: &tauri::AppHandle,
) -> bool {
    let event_header = msg.get_header("Event").map(|s| s.to_lowercase());
    let is_dialog = event_header.as_deref().map(|e| e.starts_with("dialog")).unwrap_or(false);
    if !is_dialog {
        return false;
    }

    // Send 200 OK
    let mut ok = SipMessage::new_response(200, "OK");
    if let Some(v) = msg.get_header("Via") { ok.add_header("Via", v); }
    if let Some(v) = msg.get_header("From") { ok.add_header("From", v); }
    if let Some(v) = msg.get_header("To") { ok.add_header("To", v); }
    if let Some(v) = msg.get_header("Call-ID") { ok.add_header("Call-ID", v); }
    if let Some(v) = msg.get_header("CSeq") { ok.add_header("CSeq", v); }
    if let Ok(bytes) = ok.to_bytes() {
        let _ = socket.send_to(&bytes, peer);
    }

    // Parse dialog-info XML body to determine state
    let body = msg.body.as_deref().unwrap_or("");
    let (state, direction, remote_party) = parse_dialog_info(body);

    // The monitored extension is in the From header (the notifier) per RFC 3265 §3.2.2.
    // Also try the dialog-info entity attribute in the XML body.
    let from_header = msg.get_header("From").cloned().unwrap_or_default();
    let extension = extract_entity_from_dialog_info(body)
        .unwrap_or_else(|| extract_user_from_header(&from_header));

    // Find registrar: the To header is us (subscriber), its domain identifies our registrar
    let to_header = msg.get_header("To").cloned().unwrap_or_default();
    let to_domain = extract_domain_from_header(&to_header);
    let from_domain = extract_domain_from_header(&from_header);
    let registrar_id = find_registrar_by_domain(&to_domain)
        .or_else(|| find_registrar_by_domain(&from_domain));

    if let Some(ref rid) = registrar_id {
        let key = format!("{}:{}", rid, extension);
        let blf_state = BlfState {
            extension: extension.clone(),
            registrar_id: rid.clone(),
            state: state.clone(),
            direction: direction.clone(),
            remote_party: remote_party.clone(),
        };
        if let Ok(mut map) = BLF_STATES.lock() {
            map.insert(key, blf_state.clone());
        }
        let payload = serde_json::json!({
            "registrarId": rid,
            "extension": extension,
            "state": state,
            "direction": direction,
            "remoteParty": remote_party,
        });
        let _ = app_handle.emit("softphone:blf_update", payload);
    }

    true
}

/// Parse dialog-info XML (RFC 4235) to extract call state.
fn parse_dialog_info(xml: &str) -> (String, Option<String>, Option<String>) {
    // Per RFC 4235, <dialog> elements contain <state> with values:
    //   trying, proceeding, early, confirmed, terminated
    //
    // A full state document with no <dialog> elements means idle.
    // If there's a <dialog> with state=confirmed → busy (on a call)
    // If there's a <dialog> with state=early or proceeding or trying → ringing
    // If all dialogs are terminated → idle

    let has_dialog = xml.contains("<dialog ");
    let state = if !has_dialog {
        "idle"
    } else if xml.contains("<state>confirmed</state>") {
        "busy"
    } else if xml.contains("<state>early</state>")
        || xml.contains("<state>trying</state>")
        || xml.contains("<state>proceeding</state>")
    {
        "ringing"
    } else if xml.contains("<state>terminated</state>") {
        "idle"
    } else {
        "unknown"
    };

    let direction = if xml.contains("direction=\"initiator\"") {
        Some("outbound".to_string())
    } else if xml.contains("direction=\"recipient\"") {
        Some("inbound".to_string())
    } else {
        None
    };

    // Try to extract remote identity from <remote><identity> or standalone <identity>
    let remote_party = extract_xml_value(xml, "<remote><identity>", "</identity></remote>")
        .or_else(|| extract_xml_value(xml, "<remote><identity>", "</identity>"))
        .or_else(|| extract_xml_value(xml, "<identity>", "</identity>"));

    (state.to_string(), direction, remote_party)
}

/// Extract the monitored extension from dialog-info entity="sip:ext@domain"
fn extract_entity_from_dialog_info(xml: &str) -> Option<String> {
    let marker = "entity=\"";
    let start = xml.find(marker)? + marker.len();
    let end = xml[start..].find('"')? + start;
    let entity = &xml[start..end];
    // entity is typically "sip:1001@domain" — extract the user part
    let cleaned = entity.strip_prefix("sip:").unwrap_or(entity);
    Some(cleaned.split('@').next()?.to_string())
}

fn extract_xml_value(xml: &str, start_tag: &str, end_tag: &str) -> Option<String> {
    let start = xml.find(start_tag)? + start_tag.len();
    let end = xml[start..].find(end_tag)? + start;
    Some(xml[start..end].trim().to_string())
}

fn extract_user_from_header(header: &str) -> String {
    let cleaned = header.trim().trim_start_matches('<').trim_start_matches("sip:");
    cleaned.split('@').next().unwrap_or("").split('>').next().unwrap_or("").to_string()
}

fn extract_domain_from_header(header: &str) -> String {
    if let Some(at_pos) = header.find('@') {
        let rest = &header[at_pos + 1..];
        rest.split(|c: char| c == '>' || c == ';' || c == ':' || c.is_whitespace())
            .next()
            .unwrap_or("")
            .to_string()
    } else {
        String::new()
    }
}

fn find_registrar_by_domain(domain: &str) -> Option<String> {
    if domain.is_empty() { return None; }
    let registrars = Database::load_registrars().ok()?;
    registrars.iter().find(|r| r.domain == domain).map(|r| r.id.clone())
}

fn blf_subscription_loop(
    config: &RegistrarConfig,
    registrar_id: &str,
    extension: &str,
    stop: &AtomicBool,
    app_handle: &tauri::AppHandle,
) {
    let subscribe_interval = Duration::from_secs(3600);
    let retry_delay = Duration::from_secs(30);

    loop {
        if stop.load(Ordering::SeqCst) { break; }

        match send_blf_subscribe(config, extension, 3600) {
            Ok(initial_state) => {
                tracing::info!("SUBSCRIBE OK for {}@{}: state={}", extension, registrar_id, initial_state);
                let key = format!("{}:{}", registrar_id, extension);
                let blf_state = BlfState {
                    extension: extension.to_string(),
                    registrar_id: registrar_id.to_string(),
                    state: initial_state.clone(),
                    direction: None,
                    remote_party: None,
                };
                if let Ok(mut map) = BLF_STATES.lock() {
                    map.insert(key, blf_state.clone());
                }
                let payload = serde_json::json!({
                    "registrarId": registrar_id,
                    "extension": extension,
                    "state": initial_state,
                });
                let _ = app_handle.emit("softphone:blf_update", payload);

                let wait = subscribe_interval.checked_sub(Duration::from_secs(60)).unwrap_or(subscribe_interval);
                let start = Instant::now();
                while start.elapsed() < wait {
                    if stop.load(Ordering::SeqCst) {
                        let _ = send_blf_subscribe(config, extension, 0);
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(5));
                }
            }
            Err(e) => {
                tracing::error!("SUBSCRIBE failed for {}@{}: {}", extension, registrar_id, e);
                let start = Instant::now();
                while start.elapsed() < retry_delay {
                    if stop.load(Ordering::SeqCst) { return; }
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
    }
}

fn send_blf_subscribe(config: &RegistrarConfig, extension: &str, expires: u32) -> Result<String, String> {
    let local_port = config.local_port.unwrap_or(5060);
    let registrar_uri = SipUri::parse(&config.domain).map_err(|e| format!("Bad domain: {}", e))?;
    let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
    let registrar_host = registrar_uri.host_for_resolution();

    let mut transport = Transport::new(config.transport.clone(), local_port, registrar_host, registrar_port)
        .map_err(|e| e.to_string())?;
    transport.update_local_ip().map_err(|e| e.to_string())?;
    let local_ip = transport.get_local_ip_address();

    // Contact port must be the inbound listener port so NOTIFYs reach the right socket
    let contact_port = config.listening_port.unwrap_or(config.local_port.unwrap_or(5060));

    let call_id = generate_call_id();
    let from_tag = generate_tag();
    let branch = format!("z9hG4bK{}", generate_tag());

    let aor_domain = registrar_uri.host.clone();
    let request_uri = format!("sip:{}@{}", extension, aor_domain);

    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        crate::core::config::TransportType::Tcp => "TCP",
        crate::core::config::TransportType::Tls => "TLS",
        crate::core::config::TransportType::Wss => "WSS",
    };

    let mut req = SipMessage::new_request("SUBSCRIBE", &request_uri);
    req.add_header("Via", &format!("SIP/2.0/{} {}:{};rport;branch={}", via_transport, local_ip, contact_port, branch));
    req.add_header("Max-Forwards", "70");
    req.add_header("From", &format!("<sip:{}@{}>;tag={}", config.username, aor_domain, from_tag));
    req.add_header("To", &format!("<sip:{}@{}>", extension, aor_domain));
    req.add_header("Call-ID", &call_id);
    req.add_header("CSeq", "1 SUBSCRIBE");
    req.add_header("Contact", &format!("<sip:{}@{}:{}>", config.username, local_ip, contact_port));
    req.add_header("Event", "dialog");
    req.add_header("Accept", "application/dialog-info+xml");
    req.add_header("Expires", &expires.to_string());
    req.add_header("User-Agent", &user_agent::get_effective_user_agent());

    let req_bytes = req.to_bytes().map_err(|e| e.to_string())?;
    transport.send(&req_bytes).map_err(|e| e.to_string())?;

    // Read response
    let mut response = transport.receive(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    let mut resp_msg = SipMessage::from_bytes(&response).map_err(|e| e.to_string())?;
    let code = resp_msg.status_code.unwrap_or(0);

    // Handle 401/407 auth challenge
    if code == 401 || code == 407 {
        let auth_header_name = if code == 401 { "WWW-Authenticate" } else { "Proxy-Authenticate" };
        let challenge_str = resp_msg.get_header(auth_header_name)
            .cloned()
            .ok_or("No auth challenge header")?;
        let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
        let auth_challenge = auth::parse_auth_challenge(&challenge_str, default_realm)
            .map_err(|e| e.to_string())?;
        let username = config.auth_username.as_ref().unwrap_or(&config.username);
        let password = &config.password;
        let auth_value = auth::build_digest_authorization("SUBSCRIBE", &request_uri, username, password, &auth_challenge);

        let branch2 = format!("z9hG4bK{}", generate_tag());
        let mut auth_req = SipMessage::new_request("SUBSCRIBE", &request_uri);
        auth_req.add_header("Via", &format!("SIP/2.0/{} {}:{};rport;branch={}", via_transport, local_ip, contact_port, branch2));
        auth_req.add_header("Max-Forwards", "70");
        auth_req.add_header("From", &format!("<sip:{}@{}>;tag={}", config.username, aor_domain, from_tag));
        auth_req.add_header("To", &format!("<sip:{}@{}>", extension, aor_domain));
        auth_req.add_header("Call-ID", &call_id);
        auth_req.add_header("CSeq", "2 SUBSCRIBE");
        auth_req.add_header("Contact", &format!("<sip:{}@{}:{}>", config.username, local_ip, contact_port));
        auth_req.add_header("Event", "dialog");
        auth_req.add_header("Accept", "application/dialog-info+xml");
        auth_req.add_header("Expires", &expires.to_string());
        auth_req.add_header("User-Agent", &user_agent::get_effective_user_agent());
        if code == 401 {
            auth_req.add_header("Authorization", &auth_value);
        } else {
            auth_req.add_header("Proxy-Authorization", &auth_value);
        }

        let auth_bytes = auth_req.to_bytes().map_err(|e| e.to_string())?;
        transport.send(&auth_bytes).map_err(|e| e.to_string())?;
        response = transport.receive(Duration::from_secs(5)).map_err(|e| e.to_string())?;
        resp_msg = SipMessage::from_bytes(&response).map_err(|e| e.to_string())?;
    }

    let final_code = resp_msg.status_code.unwrap_or(0);
    if final_code < 200 || final_code >= 300 {
        return Err(format!("SUBSCRIBE failed: {} {}", final_code, resp_msg.status_text.as_deref().unwrap_or("")));
    }

    // Try to read an immediate NOTIFY (some servers piggyback it)
    if let Ok(notify_bytes) = transport.receive(Duration::from_secs(2)) {
        if let Ok(notify) = SipMessage::from_bytes(&notify_bytes) {
            if notify.method.eq_ignore_ascii_case("NOTIFY") {
                let body = notify.body.as_deref().unwrap_or("");
                let (state, _, _) = parse_dialog_info(body);
                return Ok(state);
            }
        }
    }

    Ok("idle".to_string())
}
