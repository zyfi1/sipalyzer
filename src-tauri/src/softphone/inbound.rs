//! Inbound SIP: listen for INVITE on a UDP port (e.g. 5062), send 100/180, emit incoming_call;
//! answer_call sends 200 OK, receives ACK, starts media; BYE is handled on the same socket.

use std::collections::{HashMap, HashSet};
use std::net::{SocketAddr, UdpSocket};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use tauri::Emitter;

use crate::core::database::Database;
use crate::sip::stack::{generate_tag, SipMessage};
use crate::sip::transport::Transport;
use crate::sip::uri::escape_user;
use crate::core::user_agent;
use super::call_controller::{push_remote_ended_call, unregister_dialog_sender};
use super::media_engine;
use super::sip_log;
use super::port_allocator;
use super::sdp;
const INBOUND_READ_TIMEOUT_MS: u64 = 100;

/// Extract a header value from raw SIP text by name (case-insensitive).
fn extract_header_value<'a>(text: &'a str, header_name: &str) -> Option<String> {
    let lower_name = header_name.to_lowercase();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(colon_pos) = trimmed.find(':') {
            let name = trimmed[..colon_pos].trim().to_lowercase();
            if name == lower_name {
                return Some(trimmed[colon_pos + 1..].trim().to_string());
            }
        }
    }
    None
}

/// Normalize Call-ID for consistent lookup (trim + lowercase). Cellphones/proxies may echo
/// Call-ID with different casing in BYE; we key pending/active by normalized form so BYE matches.
fn normalize_call_id(s: &str) -> String {
    s.trim()
        .trim_matches(|c: char| c == '<' || c == '>' || c.is_whitespace())
        .to_lowercase()
}

fn normalize_identity(value: &str) -> String {
    value.trim().trim_matches('"').to_ascii_lowercase()
}

fn parse_header_uri(header_value: &str) -> String {
    let trimmed = header_value.trim();
    if let (Some(start), Some(end)) = (trimmed.find('<'), trimmed.find('>')) {
        return trimmed[start + 1..end].trim().to_string();
    }
    trimmed.split(';').next().unwrap_or(trimmed).trim().to_string()
}

fn parse_sip_user_domain(value: &str) -> (Option<String>, Option<String>) {
    let mut raw = value.trim();
    if let Some(v) = raw.strip_prefix("sip:") {
        raw = v;
    } else if let Some(v) = raw.strip_prefix("sips:") {
        raw = v;
    } else if let Some(v) = raw.strip_prefix("tel:") {
        let user = v
            .split([';', '>', ' '])
            .next()
            .unwrap_or(v)
            .trim();
        return if user.is_empty() {
            (None, None)
        } else {
            (Some(normalize_identity(user)), None)
        };
    }
    let base = raw.split(';').next().unwrap_or(raw).trim();
    let mut parts = base.split('@');
    let user = parts.next().unwrap_or("").trim();
    let domain_part = parts.next().unwrap_or("").trim();
    let user_out = if user.is_empty() {
        None
    } else {
        Some(normalize_identity(user))
    };
    let domain_no_port = domain_part.split(':').next().unwrap_or(domain_part).trim();
    let domain_out = if domain_no_port.is_empty() {
        None
    } else {
        Some(normalize_identity(domain_no_port))
    };
    (user_out, domain_out)
}

fn parse_via_transport(via: &str) -> Option<String> {
    let token = via.split_whitespace().next()?;
    let mut segs = token.split('/');
    let _sip = segs.next()?;
    let _version = segs.next()?;
    let transport = segs.next()?.trim();
    if transport.is_empty() {
        None
    } else {
        Some(transport.to_ascii_lowercase())
    }
}

fn registrar_domain_identity(registrar_domain: &str) -> Option<String> {
    let value = registrar_domain
        .trim()
        .strip_prefix("sip:")
        .or_else(|| registrar_domain.trim().strip_prefix("sips:"))
        .unwrap_or(registrar_domain.trim());
    let no_port = value.split(':').next().unwrap_or(value).trim();
    if no_port.is_empty() {
        None
    } else {
        Some(normalize_identity(no_port))
    }
}

/// Pending inbound INVITE (ringing); keyed by Call-ID.
struct PendingInvite {
    peer_addr: SocketAddr,
    from_header: String,
    from_tag: String,
    to_header: String,
    via: String,
    cseq: String,
    body: Option<String>,
    registrar_id: String,
    /// True when this INVITE should be handled by fax pipeline (fax endpoint or T.38 INVITE).
    route_to_fax: bool,
    /// True when inbound SDP offers T.38 media (m=image/udptl).
    t38_offered: bool,
    /// Remote party's Contact header from the INVITE (for BYE routing).
    remote_contact: Option<String>,
}

/// Active inbound call (after ACK); for BYE handling. From/To tags used for dialog matching on BYE.
#[allow(dead_code)]
struct ActiveInbound {
    peer_addr: SocketAddr,
    from_tag: String,
    to_tag: String,
    to_header: String,
    /// True when this was a T.38 fax call (no RTP; don't call stop_media on BYE).
    is_fax: bool,
    /// True when the call was explicitly routed to fax endpoint handling.
    route_to_fax: bool,
    /// Allocated RTP port (released on call end).
    local_rtp_port: u16,
    /// Allocated UDPTL port for fax, if any (released on call end).
    udptl_port: Option<u16>,
}

/// Command to the receiver thread.
enum InboundCommand {
    AnswerCall {
        call_id: String,
        ack_tx: mpsc::Sender<()>,
    },
    RejectCall {
        call_id: String,
        status_code: u16,
    },
    /// Shut down this listener thread so a new one can start on a different port.
    Shutdown,
}

struct InboundHandle {
    tx: mpsc::Sender<InboundCommand>,
}

static INBOUND_HANDLES: Lazy<Mutex<HashMap<u16, InboundHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
/// call_id -> inbound listener port index so answer/reject routes to the right socket.
static CALL_PORT_INDEX: Lazy<Mutex<HashMap<String, u16>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
#[derive(Clone, Debug)]
struct RegistrationBinding {
    registrar_id: String,
    listening_port: u16,
    username: String,
    auth_username: Option<String>,
    domain: Option<String>,
    realm: Option<String>,
    transport: String,
    updated_at: Instant,
}

/// Runtime map of successfully registered identities.
/// Used to disambiguate inbound INVITE routing when multiple registrars share a listener port.
static REGISTERED_BINDINGS: Lazy<Mutex<HashMap<String, RegistrationBinding>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn set_registration_binding(config: &crate::core::config::RegistrarConfig) {
    let Some(listening_port) = config.listening_port.or(config.local_port) else {
        return;
    };
    let binding = RegistrationBinding {
        registrar_id: config.id.clone(),
        listening_port,
        username: normalize_identity(&config.username),
        auth_username: config.auth_username.as_ref().map(|v| normalize_identity(v)),
        domain: registrar_domain_identity(&config.domain),
        realm: config.realm.as_ref().map(|v| normalize_identity(v)),
        transport: match config.transport {
            crate::core::config::TransportType::Udp => "udp".to_string(),
            crate::core::config::TransportType::Tcp => "tcp".to_string(),
            crate::core::config::TransportType::Tls => "tls".to_string(),
            crate::core::config::TransportType::Wss => "wss".to_string(),
        },
        updated_at: Instant::now(),
    };
    let _ = REGISTERED_BINDINGS
        .lock()
        .map(|mut map| map.insert(config.id.clone(), binding));
}

pub fn clear_registration_binding(registrar_id: &str) {
    let _ = REGISTERED_BINDINGS
        .lock()
        .map(|mut map| map.remove(registrar_id));
}

fn index_call_port(call_id: &str, port: u16) {
    if port == 0 {
        return;
    }
    let _ = CALL_PORT_INDEX.lock().map(|mut m| {
        m.insert(normalize_call_id(call_id), port);
    });
}

fn remove_call_port(call_id: &str) {
    let _ = CALL_PORT_INDEX.lock().map(|mut m| {
        m.remove(&normalize_call_id(call_id));
    });
}

fn remove_call_ports_for_listener(port: u16) {
    let _ = CALL_PORT_INDEX.lock().map(|mut m| {
        m.retain(|_, p| *p != port);
    });
}
/// Start the inbound listener on the given port (UDP).
/// If a listener is already running on this port, this is a no-op.
pub fn start_inbound_listener(port: u16, app_handle: tauri::AppHandle) -> Result<(), String> {
    {
        let g = INBOUND_HANDLES
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;
        if g.contains_key(&port) {
            return Ok(());
        }
    }

    // Bind the socket upfront so we can report bind failures to the caller.
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let socket = crate::sip::transport::bind_udp_reuse(addr)
        .map_err(|e| format!("Failed to bind UDP port {}: {}", port, e))?;

    let (tx, rx) = mpsc::channel::<InboundCommand>();
    {
        let mut g = INBOUND_HANDLES
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;
        if g.contains_key(&port) {
            return Ok(());
        }
        g.insert(port, InboundHandle { tx: tx.clone() });
    }

    thread::spawn(move || {
        run_inbound_receiver_with_socket(port, rx, app_handle, socket);
    });
    Ok(())
}

/// Stop the inbound listener for a specific port if one is running.
pub fn stop_inbound_listener_port(port: u16) {
    let _ = INBOUND_HANDLES.lock().map(|mut g| {
        if let Some(handle) = g.remove(&port) {
            let _ = handle.tx.send(InboundCommand::Shutdown);
        }
    });
    remove_call_ports_for_listener(port);
}

/// Stop all inbound listeners.
pub fn stop_inbound_listener() {
    let _ = INBOUND_HANDLES.lock().map(|mut g| {
        let handles: Vec<InboundHandle> = g.drain().map(|(_, h)| h).collect();
        for handle in handles {
            let _ = handle.tx.send(InboundCommand::Shutdown);
        }
    });
    let _ = CALL_PORT_INDEX.lock().map(|mut m| m.clear());
}

/// Reconcile active inbound listeners to exactly match the provided port set.
/// Starts missing listeners and stops listeners on ports that are no longer desired.
pub fn sync_inbound_listeners(ports: Vec<u16>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let desired: HashSet<u16> = ports.into_iter().filter(|p| *p > 0).collect();
    let existing: HashSet<u16> = INBOUND_HANDLES
        .lock()
        .map_err(|e| format!("Mutex lock failed: {}", e))?
        .keys()
        .copied()
        .collect();

    for port in existing.difference(&desired) {
        stop_inbound_listener_port(*port);
    }
    for port in desired.difference(&existing) {
        start_inbound_listener(*port, app_handle.clone())?;
    }
    Ok(())
}

fn run_inbound_receiver_with_socket(
    port: u16,
    rx: mpsc::Receiver<InboundCommand>,
    app_handle: tauri::AppHandle,
    socket: UdpSocket,
) {
    let _ = socket.set_read_timeout(Some(Duration::from_millis(INBOUND_READ_TIMEOUT_MS)));

    let mut pending: HashMap<String, PendingInvite> = HashMap::new();
    let mut active: HashMap<String, ActiveInbound> = HashMap::new();
    let mut buf = [0u8; 8192];

    loop {
        let mut should_shutdown = false;
        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                InboundCommand::AnswerCall { call_id, ack_tx } => {
                    let normalized_call_id = normalize_call_id(&call_id);
                    if let Some(p) = pending.remove(&normalized_call_id) {
                        if let Err(e) = send_200_ok_and_wait_ack(
                            &socket,
                            &p,
                            &normalized_call_id,
                            &mut buf,
                            &mut active,
                            &ack_tx,
                            &app_handle,
                        ) {
                            tracing::error!("answer failed: {}", e);
                            remove_call_port(&normalized_call_id);
                            let _ = ack_tx.send(());
                        }
                    } else {
                        let _ = ack_tx.send(());
                    }
                }
                InboundCommand::RejectCall { call_id, status_code } => {
                    let normalized_call_id = normalize_call_id(&call_id);
                    if let Some(p) = pending.remove(&normalized_call_id) {
                        send_reject(&socket, &p, &normalized_call_id, status_code);
                        remove_call_port(&normalized_call_id);
                    }
                }
                InboundCommand::Shutdown => {
                    should_shutdown = true;
                }
            }
        }
        if should_shutdown {
            tracing::info!("[Inbound:{}] Shutting down listener", port);
            remove_call_ports_for_listener(port);
            // Clear the global handle so a new one can start
            let _ = INBOUND_HANDLES.lock().map(|mut g| {
                g.remove(&port);
            });
            break;
        }

        match socket.recv_from(&mut buf) {
            Ok((len, peer)) => {
                let bytes = &buf[..len];
                // Log first line of every SIP message received
                let first_line = std::str::from_utf8(bytes)
                    .unwrap_or("<non-utf8>")
                    .lines()
                    .next()
                    .unwrap_or("<empty>");
                tracing::info!("[Inbound:{}] Received from {}: {}", port, peer, first_line);

                // Log the inbound SIP message. Extract Call-ID for correlation.
                {
                    let cid = SipMessage::from_bytes(bytes)
                        .ok()
                        .and_then(|m| m.get_header("Call-ID").cloned())
                        .unwrap_or_default();
                    sip_log::log_bytes(&cid, "recv", bytes);
                }

                if let Ok(msg) = SipMessage::from_bytes(bytes) {
                    if msg.status_code.is_none() {
                        let method = msg.method.to_uppercase();
                        tracing::info!("[Inbound:{}] Parsed request: method={}", port, method);
                        if method == "INVITE" {
                            let cid = msg.get_header("Call-ID").map(|s| normalize_call_id(s)).unwrap_or_default();
                            if active.contains_key(&cid) {
                                handle_reinvite(&msg, &active[&cid], &socket, peer, &app_handle);
                            } else {
                                handle_invite(&msg, &socket, peer, &mut pending, &app_handle, port);
                            }
                        } else if method == "ACK" {
                            // ACK is handled inside send_200_ok_and_wait_ack
                        } else if method == "NOTIFY" {
                            if !super::mwi::handle_mwi_notify(&msg, &socket, peer, &app_handle)
                                && !super::blf::handle_dialog_notify(&msg, &socket, peer, &app_handle)
                            {
                                tracing::info!("[Inbound:{}] Unhandled NOTIFY, ignoring", port);
                            }
                        } else if method == "MESSAGE" {
                            super::sip_message::handle_incoming_message(&msg, &socket, peer, &app_handle);
                        } else if method == "BYE" {
                            handle_bye(&msg, &mut active, &socket, &app_handle, peer);
                        } else if method == "CANCEL" {
                            // Handle CANCEL for pending calls
                            if let Some(cid) = msg.get_header("Call-ID").map(|s| normalize_call_id(s)) {
                                if pending.remove(&cid).is_some() {
                                    remove_call_port(&cid);
                                    tracing::info!("[Inbound:{}] CANCEL received for pending call_id={}", port, cid);
                                    let mut ok = SipMessage::new_response(200, "OK");
                                    if let Some(v) = msg.get_header("Via") { ok.add_header("Via", v); }
                                    if let Some(v) = msg.get_header("From") { ok.add_header("From", v); }
                                    if let Some(v) = msg.get_header("To") { ok.add_header("To", v); }
                                    if let Some(v) = msg.get_header("Call-ID") { ok.add_header("Call-ID", v); }
                                    if let Some(v) = msg.get_header("CSeq") { ok.add_header("CSeq", v); }
                                    if let Ok(b) = ok.to_bytes() { let _ = socket.send_to(&b, peer); }
                                }
                            }
                        }
                    } else {
                        tracing::info!("[Inbound:{}] Parsed response: {} {}", port, 
                            msg.status_code.unwrap_or(0),
                            msg.status_text.as_deref().unwrap_or(""));
                    }
                } else {
                    // Raw fallback: parser failed but message might still be a BYE we must handle.
                    // Extract first line to check method.
                    let text = String::from_utf8_lossy(bytes);
                    let first_line = text.lines().next().unwrap_or("");
                    tracing::error!("[Inbound:{}] Parse failed, raw first line: {}", port, first_line);
                    
                    if first_line.to_uppercase().starts_with("BYE ") {
                        tracing::info!("[Inbound:{}] Raw BYE detected, attempting manual handling", port);
                        // Extract Call-ID from raw bytes
                        if let Some(raw_call_id) = extract_header_value(&text, "Call-ID")
                            .or_else(|| extract_header_value(&text, "i"))
                        {
                            let call_id = normalize_call_id(&raw_call_id);
                            tracing::info!("[Inbound:{}] Raw BYE call_id={}", port, call_id);
                            
                            // Build 200 OK from raw headers
                            if let Some((via, from, to_hdr, cid, cseq)) = crate::softphone::call_controller::extract_headers_for_200_ok(bytes) {
                                let mut ok = SipMessage::new_response(200, "OK");
                                ok.add_header("Via", &via);
                                ok.add_header("From", &from);
                                ok.add_header("To", &to_hdr);
                                ok.add_header("Call-ID", &cid);
                                ok.add_header("CSeq", &cseq);
                                if let Ok(b) = ok.to_bytes() { let _ = socket.send_to(&b, peer); }
                            }
                            
                            // Try to end active inbound call
                            if let Some(a) = active.remove(&call_id) {
                                if !a.is_fax { let _ = media_engine::stop_media(&call_id); }
                                // Release allocated ports (RTP port released by stop_media for voice; fax needs explicit release)
                                if a.is_fax { port_allocator::release(a.local_rtp_port); }
                                if let Some(up) = a.udptl_port { port_allocator::release(up); }
                            } else {
                                let _ = media_engine::stop_media(&call_id);
                            }
                            
                            push_remote_ended_call(call_id.clone());
                            let payload = serde_json::json!({ "call_id": call_id, "callId": call_id });
                            tracing::info!("[Inbound:{}] Emitting softphone:call_ended_by_remote (raw) for call_id={}", port, call_id);
                            let _ = app_handle.emit("softphone:call_ended_by_remote", payload);
                        }
                    }
                }
            }
            Err(e) => {
                // Only log non-timeout errors
                if e.kind() != std::io::ErrorKind::WouldBlock && e.kind() != std::io::ErrorKind::TimedOut {
                    tracing::error!("[Inbound:{}] recv_from error: {}", port, e);
                }
            }
        }
    }
}

fn send_invite_response(
    socket: &UdpSocket,
    peer: SocketAddr,
    msg: &SipMessage,
    status_code: u16,
    status_text: &str,
) {
    let mut resp = SipMessage::new_response(status_code, status_text);
    if let Some(v) = msg.get_header("Via") {
        resp.add_header("Via", v);
    }
    if let Some(v) = msg.get_header("From") {
        resp.add_header("From", v);
    }
    if let Some(v) = msg.get_header("To") {
        resp.add_header("To", v);
    }
    if let Some(v) = msg.get_header("Call-ID") {
        resp.add_header("Call-ID", v);
    }
    if let Some(v) = msg.get_header("CSeq") {
        resp.add_header("CSeq", v);
    }
    if let Ok(bytes) = resp.to_bytes() {
        let _ = socket.send_to(&bytes, peer);
        let cid = msg.get_header("Call-ID").cloned().unwrap_or_default();
        sip_log::log_bytes(&cid, "send", &bytes);
    }
}

fn send_reject(socket: &UdpSocket, p: &PendingInvite, call_id: &str, status_code: u16) {
    let status_text = match status_code {
        486 => "Busy Here",
        603 => "Decline",
        _ => "Busy Here",
    };
    let mut resp = SipMessage::new_response(status_code, status_text);
    resp.add_header("Via", &p.via);
    resp.add_header("From", &p.from_header);
    resp.add_header("To", &p.to_header);
    resp.add_header("Call-ID", call_id);
    resp.add_header("CSeq", &p.cseq);
    if let Ok(bytes) = resp.to_bytes() {
        let _ = socket.send_to(&bytes, p.peer_addr);
        sip_log::log_bytes(call_id, "send", &bytes);
    }
}

fn handle_invite(
    msg: &SipMessage,
    socket: &UdpSocket,
    peer: SocketAddr,
    pending: &mut HashMap<String, PendingInvite>,
    app_handle: &tauri::AppHandle,
    listener_port: u16,
) {
    let call_id = match msg.get_header("Call-ID") {
        Some(s) => normalize_call_id(s),
        None => return,
    };

    // ── INVITE retransmission deduplication ──
    // If this Call-ID is already pending (ringing), re-send 180 Ringing to keep the
    // dialog alive but do NOT emit another frontend event (which would create duplicate
    // call entries and potentially cause the PBX to think we're unresponsive).
    if pending.contains_key(&call_id) {
        tracing::info!("INVITE retransmit for already-pending call_id={}, re-sending 180", call_id);
        send_invite_response(socket, peer, msg, 180, "Ringing");
        return;
    }

    let to_header = msg.get_header("To").map(|s| s.to_string()).unwrap_or_default();
    let from_header = msg.get_header("From").map(|s| s.to_string()).unwrap_or_default();
    let from_tag = parse_tag(&from_header).unwrap_or_else(generate_tag);
    let via = msg.get_header("Via").map(|s| s.to_string()).unwrap_or_default();
    let cseq = msg.get_header("CSeq").map(|s| s.to_string()).unwrap_or_default();
    // Extract the SIP URI from the Contact header, stripping display names and parameters
    // outside the angle brackets.  Raw Contact may look like:
    //   "Proxy" <sip:proxy@10.0.0.1:5060>;expires=3600
    // We want just: sip:proxy@10.0.0.1:5060
    let remote_contact = msg.get_header("Contact").map(|s| {
        let s = s.trim();
        if let (Some(start), Some(end)) = (s.find('<'), s.find('>')) {
            s[start + 1..end].to_string()
        } else {
            s.to_string()
        }
    });

    let to_uri = parse_header_uri(&to_header);
    let (to_user, to_domain) = parse_sip_user_domain(&to_uri);
    let (req_user, req_domain) = parse_sip_user_domain(&msg.uri);
    let via_transport = msg
        .get_header("Via")
        .and_then(|h| parse_via_transport(h))
        .unwrap_or_else(|| "udp".to_string());
    tracing::info!(
        "INVITE identities: request={:?}@{:?}, to={:?}@{:?}, listener_port={}, via_transport={}",
        req_user, req_domain, to_user, to_domain, listener_port, via_transport
    );

    let registrars = Database::load_registrars().unwrap_or_default();
    let with_ports: Vec<&crate::core::config::RegistrarConfig> = registrars
        .iter()
        .filter(|r| r.listening_port.is_some() || r.local_port.is_some())
        .collect();
    if with_ports.is_empty() {
        tracing::warn!("No registrars configured with listening/local port; dropping inbound INVITE");
        return;
    }
    let mut candidates: Vec<&crate::core::config::RegistrarConfig> = with_ports
        .iter()
        .copied()
        .filter(|r| r.listening_port.or(r.local_port) == Some(listener_port))
        .collect();
    if candidates.is_empty() {
        // Keep compatibility: if no registrar is pinned to this listener port, evaluate all configured ports.
        tracing::warn!(
            "No registrar explicitly mapped to listener port {}; evaluating all inbound-capable registrars",
            listener_port
        );
        candidates = with_ports;
    }

    let mut best_score: i32 = i32::MIN;
    let mut best_match: Option<&crate::core::config::RegistrarConfig> = None;
    let mut tie_count = 0usize;
    let binding_map = REGISTERED_BINDINGS
        .lock()
        .map(|m| m.clone())
        .unwrap_or_default();
    for r in &candidates {
        let mut score: i32 = 0;
        if r.listening_port.or(r.local_port) == Some(listener_port) {
            score += 40;
        }
        let reg_user = normalize_identity(&r.username);
        let reg_auth_user = r.auth_username.as_ref().map(|v| normalize_identity(v));
        let reg_domain = registrar_domain_identity(&r.domain);
        let reg_realm = r.realm.as_ref().map(|v| normalize_identity(v));
        let reg_transport = match r.transport {
            crate::core::config::TransportType::Udp => "udp",
            crate::core::config::TransportType::Tcp => "tcp",
            crate::core::config::TransportType::Tls => "tls",
            crate::core::config::TransportType::Wss => "wss",
        };

        let user_matches = |u: &str| reg_user == u || reg_auth_user.as_deref() == Some(u);
        if let Some(u) = req_user.as_deref() {
            if user_matches(u) {
                score += 30;
            }
        }
        if let Some(u) = to_user.as_deref() {
            if user_matches(u) {
                score += 25;
            }
        }
        if let Some(d) = req_domain.as_deref() {
            if reg_domain.as_deref() == Some(d) || reg_realm.as_deref() == Some(d) {
                score += 22;
            }
        }
        if let Some(d) = to_domain.as_deref() {
            if reg_domain.as_deref() == Some(d) || reg_realm.as_deref() == Some(d) {
                score += 18;
            }
        }
        if reg_transport == via_transport {
            score += 12;
        }
        if let Some(binding) = binding_map.get(&r.id) {
            if binding.listening_port == listener_port {
                score += 120;
            }
            let binding_user_matches = |u: &str| {
                binding.username == u || binding.auth_username.as_deref() == Some(u)
            };
            if let Some(u) = req_user.as_deref() {
                if binding_user_matches(u) {
                    score += 35;
                }
            }
            if let Some(u) = to_user.as_deref() {
                if binding_user_matches(u) {
                    score += 28;
                }
            }
            if let Some(d) = req_domain.as_deref() {
                if binding.domain.as_deref() == Some(d) || binding.realm.as_deref() == Some(d) {
                    score += 24;
                }
            }
            if let Some(d) = to_domain.as_deref() {
                if binding.domain.as_deref() == Some(d) || binding.realm.as_deref() == Some(d) {
                    score += 20;
                }
            }
            if binding.transport == via_transport {
                score += 24;
            }
            if binding.updated_at.elapsed() <= Duration::from_secs(3600) {
                score += 6;
            }
        }

        tracing::debug!(
            "Inbound registrar candidate id={} name={} score={} listener={:?}/{:?} user={} auth_user={:?} domain={:?} realm={:?} transport={} has_binding={}",
            r.id, r.name, score, r.listening_port, r.local_port, r.username, r.auth_username, reg_domain, reg_realm, reg_transport, binding_map.contains_key(&r.id)
        );
        if score > best_score {
            best_score = score;
            best_match = Some(*r);
            tie_count = 1;
        } else if score == best_score {
            tie_count += 1;
        }
    }

    let registrar = match best_match {
        Some(r) if best_score >= 30 => {
            if tie_count > 1 {
                tracing::warn!(
                    "Ambiguous inbound registrar match for call_id={} (score={}, ties={}); selecting first by sort order: id={} name={}",
                    call_id, best_score, tie_count, r.id, r.name
                );
            } else {
                tracing::info!(
                    "Matched inbound registrar id={} name={} score={} for call_id={}",
                    r.id, r.name, best_score, call_id
                );
            }
            r
        }
        Some(r) => {
            tracing::warn!(
                "Low-confidence inbound registrar match score={} for call_id={} (best id={} name={}); dropping INVITE to avoid misrouting",
                best_score, call_id, r.id, r.name
            );
            return;
        }
        None => {
            tracing::warn!(
                "No inbound registrar candidate for call_id={} request_uri={} to={}",
                call_id, msg.uri, to_header
            );
            return;
        }
    };

    let endpoint_routes_to_fax = registrar
        .use_case
        .as_deref()
        .map(|v| v.to_ascii_lowercase().contains("faxing"))
        .unwrap_or(false);
    let registrar_id = registrar.id.clone();

    send_invite_response(socket, peer, msg, 100, "Trying");
    send_invite_response(socket, peer, msg, 180, "Ringing");

    let from_display = from_header
        .trim();
    let from_display = if let Some(i) = from_display.find('<') {
        from_display[..i].trim().trim_matches('"').to_string()
    } else {
        String::new()
    };

    let t38_offered = msg
        .body
        .as_deref()
        .map(sdp::is_t38_invite)
        .unwrap_or(false);
    let route_to_fax = endpoint_routes_to_fax || t38_offered;

    pending.insert(
        call_id.clone(),
        PendingInvite {
            peer_addr: peer,
            from_header: from_header.clone(),
            from_tag,
            to_header: to_header.clone(),
            via,
            cseq,
            body: msg.body.clone(),
            registrar_id: registrar_id.clone(),
            route_to_fax,
            t38_offered,
            remote_contact: remote_contact.clone(),
        },
    );
    index_call_port(&call_id, listener_port);

    // Detect auto-answer / intercom headers (Call-Info: answer-after=0, Alert-Info with auto-answer)
    let auto_answer = {
        let call_info = msg.get_header("Call-Info").unwrap_or(&String::new()).to_lowercase();
        let alert_info = msg.get_header("Alert-Info").unwrap_or(&String::new()).to_lowercase();
        call_info.contains("answer-after=0")
            || alert_info.contains("auto-answer")
            || alert_info.contains("intercom")
            || alert_info.contains("autoanswer")
    };

    if route_to_fax {
        let payload = serde_json::json!({
            "registrarId": registrar_id,
            "callId": call_id,
            "from": from_header,
            "fromDisplay": from_display,
            "to": to_header,
            "requestUri": msg.uri,
        });
        let _ = app_handle.emit("fax:incoming_call", payload);
    } else {
        let payload = serde_json::json!({
            "registrarId": registrar_id,
            "callId": call_id,
            "from": from_header,
            "fromDisplay": from_display,
            "to": to_header,
            "requestUri": msg.uri,
            "isFax": false,
            "autoAnswer": auto_answer,
        });
        let _ = app_handle.emit("softphone:incoming_call", payload);
    }
}

/// Handle a mid-dialog re-INVITE (remote hold/resume/codec change).
/// Responds with 200 OK containing our SDP; emits hold/resume events.
fn handle_reinvite(
    msg: &SipMessage,
    active_call: &ActiveInbound,
    socket: &UdpSocket,
    peer: SocketAddr,
    app_handle: &tauri::AppHandle,
) {
    let call_id = msg.get_header("Call-ID").cloned().unwrap_or_default();
    tracing::info!("re-INVITE for active call_id={}", call_id);

    let body = msg.body.as_deref().unwrap_or("");
    let remote_hold = body.contains("a=sendonly") || body.contains("a=inactive");

    let local_ip = Transport::get_local_ip_for_remote(&peer)
        .ok()
        .flatten()
        .unwrap_or_else(|| "0.0.0.0".to_string());
    let our_dir = if remote_hold { "recvonly" } else { "sendrecv" };
    let rtp_port = active_call.local_rtp_port;
    let sdp = format!(
"v=0\r\n\
o=- 0 0 IN IP4 {ip}\r\n\
s=-\r\n\
c=IN IP4 {ip}\r\n\
t=0 0\r\n\
m=audio {port} RTP/AVP 0 8 9 101\r\n\
a=rtpmap:0 PCMU/8000\r\n\
a=rtpmap:8 PCMA/8000\r\n\
a=rtpmap:9 G722/8000\r\n\
a=rtpmap:101 telephone-event/8000\r\n\
a=fmtp:101 0-16\r\n\
a={dir}\r\n",
        ip = local_ip,
        port = rtp_port,
        dir = our_dir,
    );

    let mut resp = SipMessage::new_response(200, "OK");
    if let Some(v) = msg.get_header("Via") { resp.add_header("Via", v); }
    if let Some(v) = msg.get_header("From") { resp.add_header("From", v); }
    let to = msg.get_header("To").cloned().unwrap_or_default();
    if to.contains("tag=") {
        resp.add_header("To", &to);
    } else {
        resp.add_header("To", &format!("{};tag={}", to, &active_call.to_tag));
    }
    if let Some(v) = msg.get_header("Call-ID") { resp.add_header("Call-ID", v); }
    if let Some(v) = msg.get_header("CSeq") { resp.add_header("CSeq", v); }
    resp.add_header("Contact", &format!("<sip:sipalyzer@{}>", local_ip));
    resp.add_header("Content-Type", "application/sdp");
    resp.body = Some(sdp);

    if let Ok(bytes) = resp.to_bytes() {
        let _ = socket.send_to(&bytes, peer);
        sip_log::log_bytes(&call_id, "send", &bytes);
    }

    let event_type = if remote_hold { "held_by_remote" } else { "resumed_by_remote" };
    let payload = serde_json::json!({
        "callId": call_id,
        "event": event_type,
    });
    let _ = app_handle.emit("softphone:call_state_change", payload);
    tracing::info!("re-INVITE: {} for call_id={}", event_type, call_id);
}

fn handle_bye(
    msg: &SipMessage,
    active: &mut HashMap<String, ActiveInbound>,
    socket: &UdpSocket,
    app_handle: &tauri::AppHandle,
    peer: SocketAddr,
) {
    let call_id = match msg.get_header("Call-ID") {
        Some(s) => normalize_call_id(s),
        None => return,
    };

    tracing::info!("BYE received for call_id={}, active_calls={:?}", call_id, active.keys().collect::<Vec<_>>());

    // BYE for an outbound call can arrive on the inbound port (proxy sends to REGISTER Contact).
    // If call_id is not in active, treat as outbound: send 200 OK, notify frontend, stop media.
    if active.get(&call_id).is_none() {
        tracing::info!("BYE call_id not in active, treating as outbound call");
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
            sip_log::log_bytes(&call_id, "send", &bytes);
        }
        let _ = media_engine::stop_media(&call_id);
        // Also unregister the dialog sender so the BYE listener thread for this outbound call
        // stops cleanly instead of waiting for SESSION_TIMEOUT_SECS.
        unregister_dialog_sender(&call_id);
        // Stop any associated packet capture
        crate::commands::softphone::stop_capture_for_call(&call_id);
        push_remote_ended_call(call_id.clone());
        let payload = serde_json::json!({ "call_id": call_id, "callId": call_id });
        tracing::info!("Emitting softphone:call_ended_by_remote for call_id={}", call_id);
        let _ = app_handle.emit("softphone:call_ended_by_remote", payload);
        remove_call_port(&call_id);
        return;
    }

    tracing::info!("BYE call_id found in active, handling as inbound call");
    let bye_from_tag = msg.get_header("From").and_then(|s| parse_tag(s));
    let bye_to_tag = msg.get_header("To").and_then(|s| parse_tag(s));
    let a = active.get(&call_id).unwrap();
    let tags_match = match (bye_from_tag.as_ref(), bye_to_tag.as_ref()) {
        (Some(bf), Some(bt)) => a.from_tag == *bf && a.to_tag == *bt,
        _ => true, // BYE without tags: accept by Call-ID only (lenient)
    };
    tracing::info!("BYE tags_match={} bye_from={:?} bye_to={:?} active_from={} active_to={}", tags_match, bye_from_tag, bye_to_tag, a.from_tag, a.to_tag);
    if !tags_match {
        tracing::info!("BYE tags don't match, ignoring");
        return;
    }
    let Some(a) = active.remove(&call_id) else {
        return;
    };
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
        let _ = socket.send_to(&bytes, a.peer_addr);
    }
    if !a.is_fax {
        let _ = media_engine::stop_media(&call_id);
    }
    // Release allocated ports (RTP port released by stop_media for voice; fax needs explicit release)
    if a.is_fax { port_allocator::release(a.local_rtp_port); }
    if let Some(up) = a.udptl_port { port_allocator::release(up); }
    push_remote_ended_call(call_id.clone());
    let payload = serde_json::json!({ "call_id": call_id, "callId": call_id });
    tracing::info!("Emitting softphone:call_ended_by_remote for active call_id={}", call_id);
    let _ = app_handle.emit("softphone:call_ended_by_remote", payload);
    remove_call_port(&call_id);
}

/// Dynamically allocate a UDPTL port for inbound fax receive via central pool.
fn allocate_udptl_receive_port(call_id: &str) -> Result<u16, String> {
    port_allocator::allocate(&format!("inbound-udptl:{}", call_id))
}

fn send_200_ok_and_wait_ack(
    socket: &UdpSocket,
    p: &PendingInvite,
    call_id: &str,
    buf: &mut [u8],
    active: &mut HashMap<String, ActiveInbound>,
    ack_tx: &mpsc::Sender<()>,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let registrars = Database::load_registrars().map_err(|e| e.to_string())?;
    let config = registrars
        .into_iter()
        .find(|r| r.id == p.registrar_id)
        .ok_or_else(|| format!("Registrar {} not found", p.registrar_id))?;
    let local_ip = Transport::get_local_ip_for_remote(&p.peer_addr)
        .ok()
        .flatten()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    // Allocate RTP port from central pool (or use pinned port if configured).
    let local_rtp_port = if let Some(pinned) = config.rtp_port {
        port_allocator::allocate_specific(pinned, &format!("inbound:{}", call_id))
            .unwrap_or_else(|_| port_allocator::allocate(&format!("inbound:{}", call_id)).unwrap_or(10000))
    } else {
        port_allocator::allocate(&format!("inbound:{}", call_id)).unwrap_or(10000)
    };
    // Contact header must use listening_port (where inbound SIP arrives), not local_port (outbound).
    // Per RFC 3261 §12.1.1, the Contact identifies where to send subsequent requests in the dialog.
    let local_sip_port = config.listening_port.unwrap_or(config.local_port.unwrap_or(5060));
    let is_fax = p.route_to_fax;
    let udptl_rx_port = if p.t38_offered {
        Some(allocate_udptl_receive_port(call_id).unwrap_or(4002))
    } else {
        None
    };
    let sdp_body = if let Some(port) = udptl_rx_port {
        sdp::build_t38_offer(&local_ip, port)
    } else {
        let pts: Vec<u8> = vec![0, 8, 9];
        sdp::build_offer(&local_ip, local_rtp_port, &pts)
    };

    let to_tag = generate_tag();
    let to_header_with_tag = if p.to_header.contains("tag=") {
        p.to_header.clone()
    } else {
        format!("{};tag={}", p.to_header.trim().trim_matches(';'), to_tag)
    };

    let contact_header = format!(
        "<sip:{}@{}:{}>",
        escape_user(&config.username),
        local_ip,
        local_sip_port
    );
    tracing::info!("200 OK for call_id={}, Contact={}", call_id, contact_header);
    
    let mut ok = SipMessage::new_response(200, "OK");
    ok.add_header("Via", &p.via);
    ok.add_header("From", &p.from_header);
    ok.add_header("To", &to_header_with_tag);
    ok.add_header("Call-ID", call_id);
    ok.add_header("CSeq", &p.cseq);
    ok.add_header("Contact", &contact_header);
    ok.add_header("Content-Type", "application/sdp");
    ok.add_header("User-Agent", &user_agent::get_effective_user_agent());
    ok.body = Some(sdp_body);

    let ok_bytes = ok.to_bytes().map_err(|e| e.to_string())?;
    socket.send_to(&ok_bytes, p.peer_addr).map_err(|e| e.to_string())?;
    sip_log::log_bytes(call_id, "send", &ok_bytes);

    let _ = socket.set_read_timeout(Some(Duration::from_secs(15)));
    loop {
        match socket.recv_from(buf) {
            Ok((len, peer)) => {
                let bytes = &buf[..len];
                sip_log::log_bytes(call_id, "recv", bytes);
                if let Ok(msg) = SipMessage::from_bytes(bytes) {
                    if msg.status_code.is_none() && msg.method.eq_ignore_ascii_case("ACK") {
                        let msg_call_id = msg
                            .get_header("Call-ID")
                            .map(|s| normalize_call_id(s));
                        if msg_call_id.as_deref() == Some(call_id) {
                            let _ = socket.set_read_timeout(Some(Duration::from_millis(INBOUND_READ_TIMEOUT_MS)));

                            if !is_fax {
                                let (remote_rtp_addr, remote_rtp_port, pt) = if let Some(ref body) = p.body {
                                    let conn =
                                        sdp::parse_connection(body).unwrap_or_else(|| "0.0.0.0".to_string());
                                    let (port, pts) = sdp::parse_media(body).unwrap_or((0, vec![0]));
                                    let pt = pts.first().copied().unwrap_or(0);
                                    (conn, port, pt)
                                } else {
                                    ("0.0.0.0".to_string(), 0u16, 0u8)
                                };
                                match media_engine::start_media(
                                    call_id.to_string(),
                                    local_rtp_port,
                                    &remote_rtp_addr,
                                    remote_rtp_port,
                                    None,
                                    None,
                                    40,
                                    200,
                                    None,
                                    Some(pt),
                                    None,
                                    1.0,
                                ) {
                                    Ok(()) => tracing::info!("Media started for call_id={}", call_id),
                                    Err(e) => tracing::error!("Starting media for call_id={}: {}", call_id, e),
                                }
                            } else {
                                // Fax endpoint handling: use T.38 when remote SDP includes UDPTL m=image,
                                // otherwise fallback to G.711 fax receive.
                                tracing::info!("Fax-routed call detected — starting fax receive session");
                                
                                // Parse remote UDPTL address from INVITE SDP
                                let (remote_udptl_addr, remote_udptl_port) = if let Some(ref body) = p.body {
                                    let conn = sdp::parse_connection(body).unwrap_or_else(|| "0.0.0.0".to_string());
                                    let port = sdp::parse_t38_media(body).unwrap_or(0);
                                    (conn, port)
                                } else {
                                    ("0.0.0.0".to_string(), 0u16)
                                };
                                
                                if remote_udptl_port > 0 {
                                    let remote_udptl: std::net::SocketAddr = format!("{}:{}", remote_udptl_addr, remote_udptl_port)
                                        .parse()
                                        .unwrap_or_else(|_| format!("0.0.0.0:{}", remote_udptl_port).parse().unwrap());
                                    
                                    if let Some(local_udptl_port) = udptl_rx_port {
                                        let app_for_fax = app_handle.clone();
                                        let call_id_for_fax = call_id.to_string();
                                        let from_header_for_fax = p.from_header.clone();
                                        let registrar_id_for_fax = p.registrar_id.clone();

                                        // Spawn blocking task for T.38 receive
                                        std::thread::spawn(move || {
                                            start_fax_receive_t38(
                                                app_for_fax,
                                                call_id_for_fax,
                                                from_header_for_fax,
                                                registrar_id_for_fax,
                                                local_udptl_port,
                                                remote_udptl,
                                            );
                                        });
                                    } else {
                                        tracing::warn!("Remote UDPTL present but local UDPTL port not allocated; falling back to G.711 receive");
                                    }
                                } else {
                                    tracing::info!("No UDPTL port in incoming fax INVITE");
                                    
                                    // Try G.711 fax receive as fallback
                                    let (remote_rtp_addr, remote_rtp_port, pt) = if let Some(ref body) = p.body {
                                        let conn = sdp::parse_connection(body).unwrap_or_else(|| "0.0.0.0".to_string());
                                        let (port, pts) = sdp::parse_media(body).unwrap_or((0, vec![0]));
                                        let pt = pts.first().copied().unwrap_or(0);
                                        (conn, port, pt)
                                    } else {
                                        ("0.0.0.0".to_string(), 0u16, 0u8)
                                    };
                                    
                                    if remote_rtp_port > 0 {
                                        let remote_rtp: std::net::SocketAddr = format!("{}:{}", remote_rtp_addr, remote_rtp_port)
                                            .parse()
                                            .unwrap_or_else(|_| format!("0.0.0.0:{}", remote_rtp_port).parse().unwrap());
                                        
                                        let app_for_fax = app_handle.clone();
                                        let call_id_for_fax = call_id.to_string();
                                        let from_header_for_fax = p.from_header.clone();
                                        let registrar_id_for_fax = p.registrar_id.clone();
                                        let codec = crate::softphone::codecs::G711Codec::from_pt(pt)
                                            .unwrap_or(crate::softphone::codecs::G711Codec::PCMU);
                                        
                                        std::thread::spawn(move || {
                                            start_fax_receive_g711(
                                                app_for_fax,
                                                call_id_for_fax,
                                                from_header_for_fax,
                                                registrar_id_for_fax,
                                                local_rtp_port,
                                                remote_rtp,
                                                codec,
                                            );
                                        });
                                    }
                                }
                            }

                            active.insert(
                                call_id.to_string(),
                                ActiveInbound {
                                    peer_addr: peer,
                                    from_tag: p.from_tag.clone(),
                                    to_tag: to_tag.clone(),
                                    to_header: to_header_with_tag.clone(),
                                    is_fax,
                                    route_to_fax: p.route_to_fax,
                                    local_rtp_port,
                                    udptl_port: udptl_rx_port,
                                },
                            );

                            // Emit dialog info so the frontend can send BYE later.
                            // IMPORTANT: Tags and URIs are emitted from end_call's perspective
                            // (the BYE sender), NOT the INVITE's perspective:
                            //   fromTag = OUR tag (we send BYE)
                            //   toTag   = REMOTE tag (they receive BYE)
                            //   targetUri = remote party URI (for BYE Request-URI / To)
                            //   remoteContactUri = INVITE Contact (for BYE routing)
                            //   responseToHeader = INVITE From header (becomes BYE To header)

                            // Extract remote URI from INVITE's From header for targetUri
                            let remote_uri = {
                                let fh = p.from_header.trim();
                                if let (Some(s), Some(e)) = (fh.find('<'), fh.find('>')) {
                                    fh[s + 1..e].to_string()
                                } else {
                                    fh.split(';').next().unwrap_or(fh).to_string()
                                }
                            };

                            let dialog_payload = serde_json::json!({
                                "callId": call_id,
                                "fromTag": to_tag,
                                "toTag": p.from_tag,
                                "targetUri": remote_uri,
                                "remoteContactUri": p.remote_contact.as_deref().map(|s| serde_json::Value::String(s.to_string())).unwrap_or(serde_json::Value::Null),
                                "responseToHeader": p.from_header,
                                "peerAddr": p.peer_addr.to_string(),
                            });
                            tracing::info!("Emitting softphone:inbound_dialog_info for call_id={}: fromTag(ours)={}, toTag(remote)={}, targetUri={}, remoteContact={:?}", call_id, to_tag, p.from_tag, remote_uri, p.remote_contact);
                            let _ = app_handle.emit("softphone:inbound_dialog_info", dialog_payload);

                            let _ = ack_tx.send(());
                            return Ok(());
                        }
                    }
                }
            }
            Err(_) => break,
        }
    }
    Err("Timeout waiting for ACK".to_string())
}

fn parse_tag(header: &str) -> Option<String> {
    let i = header.find("tag=")?;
    let rest = header[i + 4..].trim();
    let end = rest
        .find(|c: char| c == ';' || c == ' ' || c == '>')
        .unwrap_or(rest.len());
    Some(rest[..end].trim_matches('"').to_string())
}

/// Answer an inbound call: send 200 OK, wait for ACK, start media.
pub fn answer_inbound_call(_registrar_id: String, call_id: String) -> Result<(), String> {
    let normalized_call_id = normalize_call_id(&call_id);
    let listener_port = CALL_PORT_INDEX
        .lock()
        .map_err(|e| e.to_string())?
        .get(&normalized_call_id)
        .copied()
        .ok_or_else(|| "Inbound call not found in listener index".to_string())?;
    let tx = INBOUND_HANDLES
        .lock()
        .map_err(|e| e.to_string())?
        .get(&listener_port)
        .map(|h| h.tx.clone())
        .ok_or_else(|| format!("Inbound listener not running on port {}", listener_port))?;
    let (ack_tx, ack_rx) = mpsc::channel::<()>();
    tx.send(InboundCommand::AnswerCall {
        call_id: normalized_call_id,
        ack_tx,
    })
    .map_err(|e| e.to_string())?;
    ack_rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "Timeout waiting for ACK".to_string())?;
    Ok(())
}

/// Reject an inbound call (e.g. 486 Busy Here).
pub fn reject_inbound_call(call_id: String, status_code: u16) -> Result<(), String> {
    let normalized_call_id = normalize_call_id(&call_id);
    let listener_port = CALL_PORT_INDEX
        .lock()
        .map_err(|e| e.to_string())?
        .get(&normalized_call_id)
        .copied()
        .ok_or_else(|| "Inbound call not found in listener index".to_string())?;
    let tx = INBOUND_HANDLES
        .lock()
        .map_err(|e| e.to_string())?
        .get(&listener_port)
        .map(|h| h.tx.clone())
        .ok_or_else(|| format!("Inbound listener not running on port {}", listener_port))?;
    tx.send(InboundCommand::RejectCall {
        call_id: normalized_call_id.clone(),
        status_code,
    })
    .map_err(|e| e.to_string())?;
    remove_call_port(&normalized_call_id);
    Ok(())
}

// ───── Fax Receive Helpers ─────────────────────────────────────────────

/// Extract sender number from SIP From header
fn extract_sender(from_header: &str) -> String {
    // Try to extract the user part from sip:user@host
    if let Some(start) = from_header.find("sip:") {
        let rest = &from_header[start + 4..];
        if let Some(end) = rest.find('@') {
            return rest[..end].to_string();
        }
    }
    // Try tel: URI
    if let Some(start) = from_header.find("tel:") {
        let rest = &from_header[start + 4..];
        let end = rest.find(|c: char| c == '>' || c == ';' || c == ' ').unwrap_or(rest.len());
        return rest[..end].to_string();
    }
    from_header.to_string()
}

/// Start T.38 fax receive session
fn start_fax_receive_t38(
    app: tauri::AppHandle,
    call_id: String,
    from_header: String,
    registrar_id: String,
    local_udptl_port: u16,
    remote_udptl: std::net::SocketAddr,
) {
    use crate::spandsp::t38_session;
    
    let receive_id = uuid::Uuid::new_v4().to_string();
    let sender = extract_sender(&from_header);
    
    tracing::info!("Starting T.38 receive: id={}, from={}, remote={}", receive_id, sender, remote_udptl);
    
    // Emit receive started event
    let _ = app.emit("fax:receive_progress", serde_json::json!({
        "receiveId": receive_id,
        "callId": call_id,
        "sender": sender,
        "registrarId": registrar_id,
        "phase": "receiving",
        "transport": "T.38",
    }));
    
    // Create temp file for received TIFF
    let temp_dir = std::env::temp_dir();
    let tiff_path = temp_dir.join(format!("fax_rx_{}.tiff", &receive_id));
    let tiff_path_str = tiff_path.to_string_lossy().to_string();
    
    let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    
    let progress_app = app.clone();
    let progress_id = receive_id.clone();
    let on_progress: t38_session::T38ProgressCallback = Box::new(move |tx, rx, elapsed| {
        let _ = progress_app.emit("fax:receive_progress", serde_json::json!({
            "receiveId": progress_id,
            "phase": "receiving",
            "udptlPacketsSent": tx,
            "udptlPacketsReceived": rx,
            "elapsedSecs": elapsed,
        }));
    });
    
    let result = t38_session::run_t38_fax_receive(
        &tiff_path_str,
        local_udptl_port,
        remote_udptl,
        shutdown,
        None,
        Some(on_progress),
    );
    
    match result {
        Ok(fax_result) => {
            tracing::info!("T.38 receive complete: success={}, pages={}", fax_result.success, fax_result.pages_sent);
            
            // Read TIFF and encode as base64 for frontend
            let tiff_b64 = std::fs::read(&tiff_path)
                .ok()
                .map(|data| {
                    use base64::Engine;
                    base64::engine::general_purpose::STANDARD.encode(&data)
                });
            
            let _ = app.emit("fax:receive_complete", serde_json::json!({
                "receiveId": receive_id,
                "callId": call_id,
                "sender": sender,
                "registrarId": registrar_id,
                "success": fax_result.success,
                "pageCount": fax_result.pages_sent,
                "transport": "T.38",
                "remoteStationId": fax_result.remote_station_id,
                "tiffBase64": tiff_b64,
                "error": fax_result.error,
            }));
            
            let _ = std::fs::remove_file(&tiff_path);
        }
        Err(e) => {
            tracing::error!("T.38 receive failed: {}", e);
            let _ = app.emit("fax:receive_complete", serde_json::json!({
                "receiveId": receive_id,
                "callId": call_id,
                "sender": sender,
                "registrarId": registrar_id,
                "success": false,
                "error": e,
                "transport": "T.38",
            }));
            let _ = std::fs::remove_file(&tiff_path);
        }
    }
}

/// Start G.711 fax receive session
fn start_fax_receive_g711(
    app: tauri::AppHandle,
    call_id: String,
    from_header: String,
    registrar_id: String,
    local_rtp_port: u16,
    remote_rtp: std::net::SocketAddr,
    codec: crate::softphone::codecs::G711Codec,
) {
    use crate::spandsp::session::{FaxSession, FaxSendOptions};
    use crate::spandsp::fax_media;
    
    let receive_id = uuid::Uuid::new_v4().to_string();
    let sender = extract_sender(&from_header);
    
    tracing::info!("Starting G.711 receive: id={}, from={}, remote={}", receive_id, sender, remote_rtp);
    
    let _ = app.emit("fax:receive_progress", serde_json::json!({
        "receiveId": receive_id,
        "callId": call_id,
        "sender": sender,
        "registrarId": registrar_id,
        "phase": "receiving",
        "transport": "G.711",
    }));
    
    let temp_dir = std::env::temp_dir();
    let tiff_path = temp_dir.join(format!("fax_rx_{}.tiff", &receive_id));
    let tiff_path_str = tiff_path.to_string_lossy().to_string();
    
    let options = FaxSendOptions::default();
    let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    
    match FaxSession::new_receive(&tiff_path_str, &options) {
        Ok(mut session) => {
            let result = fax_media::run_fax_receive_over_rtp(
                &mut session,
                local_rtp_port,
                remote_rtp,
                codec,
                shutdown,
                Some(app.clone()),
                Some(receive_id.clone()),
            );
            
            match result {
                Ok(fax_result) => {
                    tracing::info!("G.711 receive complete: success={}, pages={}", fax_result.success, fax_result.pages_sent);
                    
                    let tiff_b64 = std::fs::read(&tiff_path)
                        .ok()
                        .map(|data| {
                            use base64::Engine;
                            base64::engine::general_purpose::STANDARD.encode(&data)
                        });
                    
                    let _ = app.emit("fax:receive_complete", serde_json::json!({
                        "receiveId": receive_id,
                        "callId": call_id,
                        "sender": sender,
                        "registrarId": registrar_id,
                        "success": fax_result.success,
                        "pageCount": fax_result.pages_sent,
                        "transport": "G.711",
                        "remoteStationId": fax_result.remote_station_id,
                        "tiffBase64": tiff_b64,
                        "error": fax_result.error,
                    }));
                    let _ = std::fs::remove_file(&tiff_path);
                }
                Err(e) => {
                    tracing::error!("G.711 receive failed: {}", e);
                    let _ = app.emit("fax:receive_complete", serde_json::json!({
                        "receiveId": receive_id,
                        "callId": call_id,
                        "sender": sender,
                        "registrarId": registrar_id,
                        "success": false,
                        "error": e,
                        "transport": "G.711",
                    }));
                    let _ = std::fs::remove_file(&tiff_path);
                }
            }
        }
        Err(e) => {
            tracing::error!("Failed to create G.711 receive session: {}", e);
            let _ = app.emit("fax:receive_complete", serde_json::json!({
                "receiveId": receive_id,
                "callId": call_id,
                "sender": sender,
                "registrarId": registrar_id,
                "success": false,
                "error": e,
                "transport": "G.711",
            }));
        }
    }
}
