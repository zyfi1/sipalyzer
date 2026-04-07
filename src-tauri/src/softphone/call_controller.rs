//! Call controller: INVITE, 200 OK → start_media, BYE/CANCEL, re-INVITE (hold/resume).
//!
//! In-dialog: **re-INVITE** (hold_call) for hold = a=sendonly, resume = a=sendrecv (RFC 3264 §8.4).
//! Transfer is done in the UI by re-INVITE (hold), then BYE, then new INVITE to target. No REFER.

use anyhow::Result;
use std::collections::HashMap;
use std::io::Write;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::mpsc as tokio_mpsc;

use super::sip_log;
use once_cell::sync::Lazy;

/// Send data on a UDP socket, handling both connected and unconnected sockets.
///
/// On macOS, `send_to()` on a connected UDP socket fails with EISCONN (os error 56).
/// The transport layer connect()s dialog sockets for SO_REUSEPORT priority, so ALL
/// SIP responses sent on dialog sockets must use `send()` instead of `send_to()`.
fn udp_send(socket: &UdpSocket, data: &[u8], dest: SocketAddr) -> std::io::Result<usize> {
    if socket.peer_addr().is_ok() {
        socket.send(data)
    } else {
        socket.send_to(data, dest)
    }
}

use crate::core::config::RegistrarConfig;
use crate::core::credentials::CredentialStore;
use crate::core::database::Database;
use crate::core::user_agent;
use crate::sip::auth;
use crate::sip::stack::{generate_call_id, generate_tag, SipMessage};
use crate::sip::transport::{read_one_sip_message, Transport};
use crate::sip::uri::{escape_user, normalize_dial_target, SipUri};

use super::media_engine::{self, set_hold};
use super::port_allocator;
use super::sdp;
/// No SIP activity for this long: treat call as disconnected (session timeout).
/// During a normal voice call, RTP goes to the RTP port — NO SIP traffic arrives on the dialog
/// socket. The only SIP traffic is session-refresh re-INVITEs (if the proxy sends them) and BYE.
/// So this timeout must be generous enough to outlast the longest possible phone call.
/// Set to 2 hours; the BYE listener thread is very lightweight (blocked on recv_from).
const SESSION_TIMEOUT_SECS: u64 = 7200;

/// Extract Via, From, To, Call-ID, CSeq from raw request bytes (for 200 OK to BYE when full parse fails).
/// Supports both full-form and compact headers per RFC 3261 §7.3.3.
pub fn extract_headers_for_200_ok(
    bytes: &[u8],
) -> Option<(String, String, String, String, String)> {
    let mut via = None;
    let mut from = None;
    let mut to = None;
    let mut call_id = None;
    let mut cseq = None;
    let mut i = 0;
    while i < bytes.len() {
        let line_start = i;
        while i < bytes.len() && bytes[i] != b'\n' {
            i += 1;
        }
        let line = &bytes[line_start..i];
        if i < bytes.len() {
            i += 1;
        }
        let line = std::str::from_utf8(line).ok()?;
        let line = line.trim_end_matches('\r').trim();
        if line.is_empty() {
            break;
        }
        if let Some(colon) = line.find(':') {
            let name = line[..colon].trim().to_lowercase();
            let value = line[colon + 1..].trim().to_string();
            match name.as_str() {
                "via" | "v" => {
                    if via.is_none() {
                        via = Some(value);
                    }
                }
                "from" | "f" => {
                    from = Some(value);
                }
                "to" | "t" => {
                    to = Some(value);
                }
                "call-id" | "i" => {
                    call_id = Some(value);
                }
                "cseq" => {
                    cseq = Some(value);
                }
                _ => {}
            }
        }
    }
    let via = via?;
    let from = from?;
    let to = to?;
    let call_id = call_id?;
    let cseq = cseq?;
    Some((via, from, to, call_id, cseq))
}

/// Senders to signal the dialog thread to send BYE (so we don't bind the same port twice).
/// The sent value is the CSeq to use for the BYE request (in-dialog CSeq).
static DIALOG_SENDERS: Lazy<Mutex<HashMap<String, mpsc::Sender<u32>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Per-call metadata for the pending INVITE transaction so CANCEL can reuse the
/// correct Via branch and CSeq (RFC 3261 §9.1).
struct InviteTxn {
    branch: String,
    cseq: u32,
}
static INVITE_TXNS: Lazy<Mutex<HashMap<String, InviteTxn>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Call IDs that the backend detected as ended by remote (BYE or TCP EOF). Frontend polls this
/// so far-end hangup is never missed even if Tauri events are lost.
static REMOTE_ENDED_CALLS: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Push a call_id when we receive BYE or connection drop from far end. Frontend polls take_remote_ended_calls().
pub fn push_remote_ended_call(sip_call_id: String) {
    if let Ok(mut g) = REMOTE_ENDED_CALLS.lock() {
        g.push(sip_call_id);
    }
}

/// Take and clear all remote-ended call IDs. Called by frontend every ~1.5s while there is an active call.
pub fn take_remote_ended_calls() -> Vec<String> {
    if let Ok(mut g) = REMOTE_ENDED_CALLS.lock() {
        std::mem::take(g.as_mut())
    } else {
        Vec::new()
    }
}

/// Register a sender so end_call can signal this call's dialog thread to send BYE.
pub fn register_dialog_sender(call_id: String, tx: mpsc::Sender<u32>) {
    if let Ok(mut g) = DIALOG_SENDERS.lock() {
        g.insert(call_id, tx);
    }
}

/// Remove the dialog sender when the dialog thread exits (BYE sent, remote BYE, or timeout).
pub fn unregister_dialog_sender(call_id: &str) {
    if let Ok(mut g) = DIALOG_SENDERS.lock() {
        g.remove(call_id);
    }
}

/// End all active calls (e.g. on app exit). Signals each dialog thread to send BYE and stops media.
pub fn end_all_active_calls() {
    let to_end: Vec<(String, mpsc::Sender<u32>)> = {
        if let Ok(mut g) = DIALOG_SENDERS.lock() {
            g.drain().collect()
        } else {
            return;
        }
    };
    for (call_id, tx) in to_end {
        let _ = tx.send(1);
        let _ = media_engine::stop_media(&call_id);
    }
}

/// Extract a clean SIP URI from a header value that may contain angle brackets,
/// display names, or URI parameters (e.g. `"Bob" <sip:bob@host>;expires=3600` → `sip:bob@host`).
fn extract_sip_uri(s: &str) -> String {
    let s = s.trim();
    if let (Some(start), Some(end)) = (s.find('<'), s.find('>')) {
        s[start + 1..end].to_string()
    } else {
        s.to_string()
    }
}

fn resolve_remote_addr(remote_contact_uri: Option<&str>, target_uri: &str) -> Option<SocketAddr> {
    let uri_str = remote_contact_uri
        .or(Some(target_uri))
        .map(|s| extract_sip_uri(s))?;
    let uri = SipUri::parse(&uri_str).ok()?;
    let host = uri.host_for_resolution();
    let port = uri.port.unwrap_or(5060);
    format!("{}:{}", host, port).parse().ok()
}

/// Parse RFC 4028 Session-Expires header: "1800;refresher=uac" → (Some(1800), Some("uac"))
fn parse_session_expires(value: &str) -> (Option<u32>, Option<String>) {
    let parts: Vec<&str> = value.split(';').collect();
    let secs = parts.first().and_then(|s| s.trim().parse::<u32>().ok());
    let refresher = parts.iter().find_map(|p| {
        let p = p.trim();
        if p.starts_with("refresher=") {
            Some(p[10..].trim().to_lowercase())
        } else {
            None
        }
    });
    (secs, refresher)
}

/// Parse tag= from a From or To header value (RFC 3261 dialog matching).
fn parse_tag_from_header(header_value: &str) -> Option<String> {
    let i = header_value.find("tag=")?;
    let rest = header_value[i + 4..].trim();
    let end = rest
        .find(|c: char| c == ';' || c == ' ' || c == '>')
        .unwrap_or(rest.len());
    Some(rest[..end].trim_matches('"').to_string())
}

/// Result of place_call: call identifiers and RTP info for start_media.
#[derive(Debug, serde::Serialize)]
pub struct PlaceCallResult {
    pub ok: bool,
    pub call_id: String,
    pub from_tag: String,
    pub to_tag: Option<String>,
    /// Full To header from 200 OK (required for BYE so far end matches dialog).
    pub response_to_header: Option<String>,
    pub target_uri: String,
    pub remote_contact_uri: Option<String>,
    pub status_code: u16,
    pub status_text: String,
    pub response_time_ms: u64,
    pub request_message: String,
    pub response_message: String,
    pub local_rtp_port: u16,
    /// Local IP used in SDP (so hold/resume re-INVITE can use same c=).
    pub local_ip: Option<String>,
    pub remote_rtp_address: Option<String>,
    pub remote_rtp_port: Option<u16>,
    pub negotiated_codec: Option<String>,
    pub negotiated_pt: Option<u8>,
    /// CSeq of the INVITE that established the dialog (1 or 2 after 401). Use (dialog_cseq + 1) for next in-dialog request (hold, BYE).
    pub dialog_cseq: u32,
    /// Per-call packet capture session (if started before INVITE); stop when call ends.
    pub capture_session_id: Option<String>,
    /// IP the SBC observed us at (from `received=` in Via of response). Useful for NAT diagnostics.
    pub sbc_received_ip: Option<String>,
    /// Port the SBC observed us at (from `rport=` in Via of response). Useful for NAT diagnostics.
    pub sbc_rport: Option<u16>,
    /// Negotiated Session-Expires interval in seconds (RFC 4028). None means no session timer.
    pub session_expires_secs: Option<u32>,
    /// Who refreshes: "uac" or "uas". Defaults to "uac" when we requested it.
    pub session_refresher: Option<String>,
}

/// Quick STUN binding to discover our public IP for SDP.
///
/// Uses Google's public STUN server with a 2-second timeout.
/// Cached STUN result: (public_ip, timestamp). Reused for 5 minutes.
static STUN_CACHE: Lazy<Mutex<Option<(String, std::time::Instant)>>> =
    Lazy::new(|| Mutex::new(None));

/// Returns `Some(public_ip)` if successful, `None` on any error.
/// Results are cached for 5 minutes to avoid repeated lookups per call.
fn stun_discover_public_ip() -> Option<String> {
    if let Ok(cache) = STUN_CACHE.lock() {
        if let Some((ref ip, at)) = *cache {
            if at.elapsed() < Duration::from_secs(300) {
                return Some(ip.clone());
            }
        }
    }

    let result = stun_discover_public_ip_uncached();
    if let Some(ref ip) = result {
        if let Ok(mut cache) = STUN_CACHE.lock() {
            *cache = Some((ip.clone(), std::time::Instant::now()));
        }
    }
    result
}

fn stun_discover_public_ip_uncached() -> Option<String> {
    let stun_servers = [
        "stun.l.google.com:19302",
        "stun1.l.google.com:19302",
        "stun.cloudflare.com:3478",
    ];

    for server in &stun_servers {
        let dest: SocketAddr = match server.parse().or_else(|_| {
            use std::net::ToSocketAddrs;
            server.to_socket_addrs().map_err(|_| ())?.next().ok_or(())
        }) {
            Ok(a) => a,
            Err(_) => continue,
        };

        let socket = match UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(_) => continue,
        };
        let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));

        // Build minimal STUN Binding Request (RFC 5389)
        let mut request = Vec::with_capacity(20);
        request.extend_from_slice(&0x0001u16.to_be_bytes()); // Binding Request
        request.extend_from_slice(&0x0000u16.to_be_bytes()); // Length: 0
        request.extend_from_slice(&0x2112A442u32.to_be_bytes()); // Magic Cookie
                                                                 // Transaction ID (12 bytes)
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        for i in 0..12 {
            request.push(((seed >> (i * 7)) & 0xFF) as u8);
        }

        if socket.send_to(&request, dest).is_err() {
            continue;
        }

        let mut buf = [0u8; 256];
        let len = match socket.recv_from(&mut buf) {
            Ok((len, _)) => len,
            Err(_) => continue,
        };

        if len < 20 {
            continue;
        }
        let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
        if msg_type != 0x0101 {
            continue;
        } // Not Binding Success Response
        let msg_len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
        let magic = 0x2112A442u32;

        let mut offset = 20;
        while offset + 4 <= 20 + msg_len && offset + 4 <= len {
            let attr_type = u16::from_be_bytes([buf[offset], buf[offset + 1]]);
            let attr_len = u16::from_be_bytes([buf[offset + 2], buf[offset + 3]]) as usize;
            if offset + 4 + attr_len > len {
                break;
            }
            let attr_data = &buf[offset + 4..offset + 4 + attr_len];

            match attr_type {
                0x0020 if attr_len >= 8 => {
                    // XOR-MAPPED-ADDRESS (IPv4)
                    let family = u16::from_be_bytes([attr_data[0], attr_data[1]]);
                    if family == 0x01 {
                        // IPv4
                        let port_xor = u16::from_be_bytes([attr_data[2], attr_data[3]]);
                        let _port = port_xor ^ (magic >> 16) as u16;
                        let ip_xor = u32::from_be_bytes([
                            attr_data[4],
                            attr_data[5],
                            attr_data[6],
                            attr_data[7],
                        ]);
                        let ip = ip_xor ^ magic;
                        let public_ip = format!(
                            "{}.{}.{}.{}",
                            (ip >> 24) & 0xFF,
                            (ip >> 16) & 0xFF,
                            (ip >> 8) & 0xFF,
                            ip & 0xFF
                        );
                        tracing::info!("Public IP discovered: {} (via {})", public_ip, server);
                        return Some(public_ip);
                    }
                }
                0x0001 if attr_len >= 8 => {
                    // MAPPED-ADDRESS (fallback)
                    let family = u16::from_be_bytes([attr_data[0], attr_data[1]]);
                    if family == 0x01 {
                        let ip = u32::from_be_bytes([
                            attr_data[4],
                            attr_data[5],
                            attr_data[6],
                            attr_data[7],
                        ]);
                        let public_ip = format!(
                            "{}.{}.{}.{}",
                            (ip >> 24) & 0xFF,
                            (ip >> 16) & 0xFF,
                            (ip >> 8) & 0xFF,
                            ip & 0xFF
                        );
                        tracing::info!(
                            "Public IP discovered (MAPPED): {} (via {})",
                            public_ip,
                            server
                        );
                        return Some(public_ip);
                    }
                }
                _ => {}
            }

            offset += 4 + ((attr_len + 3) & !3); // Align to 4 bytes
        }
    }

    tracing::info!("Could not discover public IP from any STUN server");
    None
}

/// STUN probe from an EXISTING bound socket to discover its public IP:port mapping.
///
/// Unlike `stun_discover_public_ip` (which binds a random ephemeral port), this probes
/// the NAT mapping for the **specific socket** that will carry media. This is critical
/// because NAT may assign different external ports to different internal ports.
///
/// Returns `Some((public_ip, public_port))` on success, `None` on any failure.
/// Temporarily overrides the socket's read timeout; restores it before returning.
/// Result of a STUN probe: public IP, port, and whether symmetric NAT was detected.
pub struct StunProbeResult {
    pub ip: String,
    pub port: u16,
    pub is_symmetric: bool,
}

/// Send a single STUN Binding Request to `dest` on `socket` and parse the response.
/// Returns `Some((ip, port))` on success, `None` on any failure.
fn stun_single_probe(socket: &UdpSocket, dest: SocketAddr) -> Option<(String, u16)> {
    // Build minimal STUN Binding Request (RFC 5389)
    let mut request = Vec::with_capacity(20);
    request.extend_from_slice(&0x0001u16.to_be_bytes()); // Binding Request
    request.extend_from_slice(&0x0000u16.to_be_bytes()); // Length: 0
    request.extend_from_slice(&0x2112A442u32.to_be_bytes()); // Magic Cookie
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    for i in 0..12 {
        request.push(((seed >> (i * 7)) & 0xFF) as u8);
    }

    if socket.send_to(&request, dest).is_err() {
        return None;
    }

    let mut buf = [0u8; 256];
    let len = match socket.recv_from(&mut buf) {
        Ok((len, _)) => len,
        Err(_) => return None,
    };

    if len < 20 {
        return None;
    }
    let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
    if msg_type != 0x0101 {
        return None;
    } // Not Binding Success Response
    let msg_len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
    let magic = 0x2112A442u32;

    let mut offset = 20;
    while offset + 4 <= 20 + msg_len && offset + 4 <= len {
        let attr_type = u16::from_be_bytes([buf[offset], buf[offset + 1]]);
        let attr_len = u16::from_be_bytes([buf[offset + 2], buf[offset + 3]]) as usize;
        if offset + 4 + attr_len > len {
            break;
        }
        let attr_data = &buf[offset + 4..offset + 4 + attr_len];

        match attr_type {
            0x0020 if attr_len >= 8 => {
                // XOR-MAPPED-ADDRESS (IPv4)
                let family = u16::from_be_bytes([attr_data[0], attr_data[1]]);
                if family == 0x01 {
                    let port_xor = u16::from_be_bytes([attr_data[2], attr_data[3]]);
                    let port = port_xor ^ (magic >> 16) as u16;
                    let ip_xor = u32::from_be_bytes([
                        attr_data[4],
                        attr_data[5],
                        attr_data[6],
                        attr_data[7],
                    ]);
                    let ip = ip_xor ^ magic;
                    let public_ip = format!(
                        "{}.{}.{}.{}",
                        (ip >> 24) & 0xFF,
                        (ip >> 16) & 0xFF,
                        (ip >> 8) & 0xFF,
                        ip & 0xFF
                    );
                    return Some((public_ip, port));
                }
            }
            0x0001 if attr_len >= 8 => {
                // MAPPED-ADDRESS (fallback)
                let family = u16::from_be_bytes([attr_data[0], attr_data[1]]);
                if family == 0x01 {
                    let port = u16::from_be_bytes([attr_data[2], attr_data[3]]);
                    let ip = u32::from_be_bytes([
                        attr_data[4],
                        attr_data[5],
                        attr_data[6],
                        attr_data[7],
                    ]);
                    let public_ip = format!(
                        "{}.{}.{}.{}",
                        (ip >> 24) & 0xFF,
                        (ip >> 16) & 0xFF,
                        (ip >> 8) & 0xFF,
                        ip & 0xFF
                    );
                    return Some((public_ip, port));
                }
            }
            _ => {}
        }

        offset += 4 + ((attr_len + 3) & !3); // Align to 4 bytes
    }
    None
}

/// STUN-probe an existing socket against multiple servers to discover public IP:port
/// and detect symmetric NAT (different external ports per destination = symmetric).
pub fn stun_probe_socket(socket: &UdpSocket) -> Option<StunProbeResult> {
    // We probe two different STUN servers. If the external port differs between them,
    // the NAT is symmetric and the port discovered here won't match what the SBC sees.
    let stun_servers = [
        "stun.l.google.com:19302",
        "stun.cloudflare.com:3478",
        "stun1.l.google.com:19302",
    ];

    // Save and override read timeout
    let orig_timeout = socket.read_timeout().ok().flatten();
    let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));

    let mut results: Vec<(String, u16, &str)> = Vec::new();

    for server in &stun_servers {
        let dest: SocketAddr = match server.parse().or_else(|_| {
            use std::net::ToSocketAddrs;
            server.to_socket_addrs().map_err(|_| ())?.next().ok_or(())
        }) {
            Ok(a) => a,
            Err(_) => continue,
        };

        if let Some((ip, port)) = stun_single_probe(socket, dest) {
            tracing::info!("Probe via {}: {}:{}", server, ip, port);
            results.push((ip, port, server));
            // We need at least 2 results to detect symmetric NAT
            if results.len() >= 2 {
                break;
            }
        }
    }

    // Restore original timeout
    let _ = socket.set_read_timeout(orig_timeout);

    if results.is_empty() {
        tracing::error!("Socket probe failed — could not discover public mapping");
        return None;
    }

    let (ip, port, _) = results[0].clone();

    let is_symmetric = if results.len() >= 2 {
        let port_a = results[0].1;
        let port_b = results[1].1;
        if port_a != port_b {
            tracing::info!(
                "Symmetric NAT detected: {} port {} vs {} port {}",
                results[0].2,
                port_a,
                results[1].2,
                port_b
            );
            true
        } else {
            tracing::info!("Consistent NAT: port {} across servers", port_a);
            false
        }
    } else {
        tracing::error!(
            "Only one server responded — cannot determine NAT type, assuming non-symmetric"
        );
        false
    };

    Some(StunProbeResult {
        ip,
        port,
        is_symmetric,
    })
}

/// STUN-probe the remote RTP address from our RTP socket to discover our exact external
/// port for that specific destination. This is the only reliable way to learn our NATted
/// port for the SBC's media proxy when behind symmetric NAT.
///
/// Tries: 1) STUN to the exact media port (RFC 7983 multiplexing — many SBCs support this),
///         2) STUN to the same IP on port 3478 (standard STUN port).
///
/// The socket's read timeout is saved, overridden (500ms per attempt), and restored.
#[allow(dead_code)]
pub fn stun_probe_remote_rtp(
    socket: &UdpSocket,
    remote_rtp_addr: SocketAddr,
) -> Option<(String, u16)> {
    let orig_timeout = socket.read_timeout().ok().flatten();
    let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));

    // Attempt 1: STUN binding request to the exact RTP address
    // Many modern media proxies handle STUN on their media ports (RFC 7983 demuxing).
    tracing::info!(
        "Probing SBC media address {} for external port discovery...",
        remote_rtp_addr
    );
    if let Some((ip, port)) = stun_single_probe(socket, remote_rtp_addr) {
        tracing::info!(
            "SBC media port responded: our external address is {}:{}",
            ip,
            port
        );
        let _ = socket.set_read_timeout(orig_timeout);
        return Some((ip, port));
    }

    // Attempt 2: STUN to the same IP on port 3478 (standard STUN).
    // With address-dependent NAT, the external port for same IP is identical regardless
    // of remote port, so this gives us the correct port for RTP too.
    let stun_addr = SocketAddr::new(remote_rtp_addr.ip(), 3478);
    tracing::info!("Trying standard STUN port at {}...", stun_addr);
    if let Some((ip, port)) = stun_single_probe(socket, stun_addr) {
        tracing::info!(
            "STUN port 3478 responded: our external address is {}:{}",
            ip,
            port
        );
        let _ = socket.set_read_timeout(orig_timeout);
        return Some((ip, port));
    }

    tracing::error!(
        "SBC does not respond to STUN on media or 3478 port — cannot discover external port"
    );
    let _ = socket.set_read_timeout(orig_timeout);
    None
}

fn get_registrar_config(registrar_id: &str) -> Result<RegistrarConfig, String> {
    let registrars = Database::load_registrars().map_err(|e| e.to_string())?;
    registrars
        .into_iter()
        .find(|r| r.id == registrar_id)
        .ok_or_else(|| "Registrar not found".to_string())
}

fn get_password(config: &RegistrarConfig) -> Result<String, String> {
    CredentialStore::decrypt_password(&config.password).map_err(|e| e.to_string())
}

fn create_transport(config: &RegistrarConfig) -> Result<Transport, String> {
    let uri = SipUri::parse(&config.domain).map_err(|e| e.to_string())?;
    let host = uri.host_for_resolution();
    let port = uri.port.unwrap_or(config.remote_port);
    let local_port = config.local_port.unwrap_or(5060);
    let transport = Transport::new(config.transport.clone(), local_port, &host, port)
        .map_err(|e| e.to_string())?;
    Ok(transport)
}

/// Optional callback (local_ip, call_id) -> capture_session_id. Called before sending INVITE so per-call capture runs for the whole call.
pub type OnBeforeInvite = Option<Box<dyn FnOnce(&str, &str) -> Option<String> + Send>>;

/// Place outbound call: REGISTER (optional), INVITE with SDP, on 200 OK start media.
/// If `use_t38` is true, build T.38 fax SDP (m=image udptl t38) instead of audio; otherwise build audio SDP from preferred_codecs.
/// If `progress_tx` is Some, each SIP response (100, 180, 183, 200, etc.) is sent as (status_code, status_text).
/// If `on_before_invite` is Some, it is called with (local_ip, call_id) before sending INVITE; return value is stored in result.capture_session_id.
/// If `sdp_media_override` is Some, uses the provided (ip, port) for the SDP media address
/// instead of discovering via STUN. This is used by fax to ensure the SDP exactly matches
/// the NAT mapping of the pre-bound RTP socket.
/// Returns (result, dialog_udp_socket, dialog_tcp_stream). For UDP the socket receives BYE; for TCP the stream receives BYE/EOF.
pub fn place_call(
    registrar_id: String,
    target: String,
    preferred_codecs: Option<Vec<String>>,
    progress_tx: Option<tokio_mpsc::UnboundedSender<(u16, String)>>,
    on_before_invite: OnBeforeInvite,
    use_t38: bool,
    sdp_media_override: Option<(String, u16)>,
) -> Result<
    (
        PlaceCallResult,
        Option<std::net::UdpSocket>,
        Option<std::net::TcpStream>,
    ),
    String,
> {
    let _span = tracing::info_span!("softphone.place_call", target = %target).entered();
    let config = get_registrar_config(&registrar_id)?;
    let password = get_password(&config)?;

    let aor_uri = SipUri::parse(&config.domain).map_err(|e| e.to_string())?;
    let domain_host = aor_uri.host.clone();
    let (request_uri, to_header_value) = normalize_dial_target(&target, &domain_host)?;

    // Kick off STUN discovery on a background thread so it runs in parallel
    // with transport creation + local IP detection. STUN results are cached
    // for 5 min, so subsequent calls return instantly from cache.
    let stun_needed = sdp_media_override.is_none();
    let stun_handle = if stun_needed {
        Some(std::thread::spawn(stun_discover_public_ip))
    } else {
        None
    };

    let mut transport = create_transport(&config)?;
    transport.update_local_ip().map_err(|e| e.to_string())?;
    let local_ip_lan = transport.get_local_ip_address();
    let local_rtp_port = if let Some(pinned) = config.rtp_port {
        port_allocator::allocate_specific(pinned, &format!("call:{}", target))
            .map_err(|e| format!("Pinned RTP port {}: {}", pinned, e))?
    } else {
        port_allocator::allocate(&format!("call:{}", target))?
    };

    let (sdp_ip, sdp_port) = if let Some((ref override_ip, override_port)) = sdp_media_override {
        tracing::info!(
            "Using pre-probed media address: {}:{}",
            override_ip,
            override_port
        );
        (override_ip.clone(), override_port)
    } else {
        let ip = stun_handle
            .unwrap()
            .join()
            .ok()
            .flatten()
            .unwrap_or_else(|| {
                tracing::error!(
                    "STUN discovery failed, using LAN IP {} in SDP",
                    local_ip_lan
                );
                local_ip_lan.clone()
            });
        (ip, local_rtp_port)
    };
    // local_ip is used for Via/Contact headers — use SDP IP (public) for consistency.
    let local_ip = sdp_ip.clone();
    tracing::info!(
        "SDP media address: {}:{} (LAN: {})",
        sdp_ip,
        sdp_port,
        local_ip_lan
    );

    // Fax over VoIP: initial INVITE is always m=audio G.711 (PCMU first for US carriers).
    // We never offer T.38 in the first INVITE; we re-INVITE to T.38 after call is up (see fax_send_fax).
    let (sdp_body, pts): (String, Vec<u8>) = if use_t38 {
        let pts = sdp::FAX_INITIAL_CODECS.to_vec(); // PCMU (0), PCMA (8), G.722 (9)
        (sdp::build_offer(&sdp_ip, sdp_port, &pts), pts)
    } else {
        let preferred_pts: Vec<u8> = preferred_codecs
            .unwrap_or_else(|| vec!["PCMU".to_string(), "PCMA".to_string(), "G722".to_string()])
            .iter()
            .filter_map(|c| match c.to_uppercase().as_str() {
                "PCMU" => Some(0u8),
                "PCMA" => Some(8u8),
                "G722" => Some(9u8),
                _ => None,
            })
            .collect();
        let pts = if preferred_pts.is_empty() {
            vec![0u8, 8u8, 9u8]
        } else {
            preferred_pts
        };
        (sdp::build_offer(&sdp_ip, sdp_port, &pts), pts)
    };

    // Ensure INVITE is never sent without media/codecs (avoids 488 / "no codec" on wire).
    if !sdp_body.contains("m=audio") || !sdp_body.contains("RTP/AVP") {
        return Err("SDP offer missing m=audio/RTP/AVP (internal error)".to_string());
    }

    let call_id = generate_call_id();
    let from_tag = generate_tag();
    let branch = format!("z9hG4bK{}", generate_tag());
    let cseq = 1u32;

    if let Ok(mut g) = INVITE_TXNS.lock() {
        g.insert(
            call_id.clone(),
            InviteTxn {
                branch: branch.clone(),
                cseq,
            },
        );
    }

    // Pass LAN IP (not STUN/public IP) so the capture picks the correct local interface
    let capture_session_id = on_before_invite
        .map(|cb| cb(&local_ip_lan, &call_id))
        .flatten();
    if capture_session_id.is_some() {
        std::thread::sleep(Duration::from_millis(30));
    }

    let aor_domain = domain_host.clone();
    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        crate::core::config::TransportType::Tcp => "TCP",
        crate::core::config::TransportType::Tls => "TLS",
        crate::core::config::TransportType::Wss => "WSS",
    };
    let local_port = config.local_port.unwrap_or(5060);

    let mut req = SipMessage::new_request("INVITE", &request_uri);
    req.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch={}",
            via_transport, local_ip, local_port, branch
        ),
    );
    req.add_header("Max-Forwards", "70");
    let from_user = escape_user(&config.username);
    req.add_header(
        "From",
        &format!("<sip:{}@{}>;tag={}", from_user, aor_domain, from_tag),
    );
    req.add_header("To", &to_header_value);
    req.add_header("Call-ID", &call_id);
    req.add_header("CSeq", &format!("{} INVITE", cseq));
    let contact_user = escape_user(&config.username);
    req.add_header(
        "Contact",
        &format!("<sip:{}@{}:{}>", contact_user, local_ip, local_port),
    );
    req.add_header("Content-Type", "application/sdp");
    req.add_header("User-Agent", &user_agent::get_effective_user_agent());
    req.add_header("Supported", "timer, 100rel");
    req.add_header("Session-Expires", "1800;refresher=uac");
    req.add_header("Min-SE", "90");
    req.body = Some(sdp_body.clone());

    let req_bytes = req.to_bytes().map_err(|e| e.to_string())?;
    // RFC 3261: body starts after \r\n\r\n; verify serialized message contains full SDP.
    let body_start = req_bytes
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|p| p + 4)
        .unwrap_or(0);
    let body_slice = &req_bytes[body_start..];
    if !body_slice.windows(7).any(|w| w == b"m=audio") {
        return Err(format!(
            "INVITE serialized without m=audio (body_len={}, SDP must include media)",
            body_slice.len()
        ));
    }
    if body_slice.len() < 80 {
        return Err(format!(
            "INVITE body too short ({} bytes); SDP must include m=audio and codecs",
            body_slice.len()
        ));
    }
    let mut req_text = String::from_utf8_lossy(&req_bytes).to_string();

    let start = std::time::Instant::now();
    transport.send(&req_bytes).map_err(|e| e.to_string())?;
    sip_log::log_bytes(&call_id, "send", &req_bytes);

    // Wait for final response (2xx/4xx/5xx/6xx). Don't stop at 100 Trying or 180/183 Ringing.
    // Report all provisional responses (100, 180, 183) via progress_tx so the UI can show them.
    let timeout_secs = config.timeout_seconds.max(32);
    let timeout = Duration::from_secs(timeout_secs);
    let mut response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
    sip_log::log_bytes(&call_id, "recv", &response_bytes);
    let mut response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    let mut response_text = String::from_utf8_lossy(&response_bytes).to_string();
    let mut prack_cseq = cseq + 10; // Use a separate CSeq range for PRACK
    while response.status_code.map(|c| c < 200).unwrap_or(true) {
        if let Some(ref tx) = progress_tx {
            let _ = tx.send((
                response.status_code.unwrap_or(0),
                response.status_text.clone().unwrap_or_default(),
            ));
        }
        // RFC 3262: send PRACK for reliable provisional responses
        if super::prack::needs_prack(&response) {
            let from_hdr = format!(
                "<sip:{}@{}>;tag={}",
                escape_user(&config.username),
                aor_domain,
                from_tag
            );
            let to_hdr = response
                .get_header("To")
                .cloned()
                .unwrap_or_else(|| to_header_value.clone());
            let _ = super::prack::send_prack(
                &transport,
                &response,
                &request_uri,
                &from_hdr,
                &to_hdr,
                &call_id,
                &local_ip,
                local_port,
                prack_cseq,
                via_transport,
            );
            prack_cseq += 1;
        }
        response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
        sip_log::log_bytes(&call_id, "recv", &response_bytes);
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        response_text = String::from_utf8_lossy(&response_bytes).to_string();
    }

    let mut code = response.status_code.unwrap_or(0);
    let mut status_text = response.status_text.clone().unwrap_or_default();
    let response_time_ms = start.elapsed().as_millis() as u64;
    let mut cseq_used = cseq;
    // RFC 3261: ACK for 2xx must use same Via branch as the request that got 2xx
    let mut via_branch_ack = branch.clone();

    if code == 401 || code == 407 {
        // Report the 401/407 challenge response to progress_tx before retrying with credentials
        if let Some(ref tx) = progress_tx {
            let _ = tx.send((code, status_text.clone()));
        }
        tracing::warn!(
            "Received {} {} — retrying INVITE with credentials",
            code,
            status_text
        );
        let auth_header = if code == 401 {
            response.get_header("WWW-Authenticate")
        } else {
            response.get_header("Proxy-Authenticate")
        }
        .ok_or_else(|| "Missing authentication challenge header".to_string())?;

        let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
        let challenge = auth::parse_auth_challenge(auth_header, default_realm)?;
        let username = config.auth_username.as_ref().unwrap_or(&config.username);
        let auth_value = auth::build_digest_authorization(
            "INVITE",
            &request_uri,
            username,
            &password,
            &challenge,
        );

        let mut auth_req = SipMessage::new_request("INVITE", &request_uri);
        for (name, value) in &req.headers {
            let lname = name.to_lowercase();
            if lname == "via"
                || lname == "cseq"
                || lname == "authorization"
                || lname == "proxy-authorization"
            {
                continue;
            }
            auth_req.add_header(name, value);
        }
        let auth_branch = format!("z9hG4bK{}", generate_tag());
        via_branch_ack = auth_branch.clone();
        auth_req.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch={}",
                via_transport, local_ip, local_port, auth_branch
            ),
        );
        cseq_used = cseq + 1;
        if let Ok(mut g) = INVITE_TXNS.lock() {
            g.insert(
                call_id.clone(),
                InviteTxn {
                    branch: auth_branch.clone(),
                    cseq: cseq_used,
                },
            );
        }
        auth_req.add_header("CSeq", &format!("{} INVITE", cseq_used));
        if code == 401 {
            auth_req.add_header("Authorization", &auth_value);
        } else {
            auth_req.add_header("Proxy-Authorization", &auth_value);
        }
        auth_req.body = req.body.clone();

        let auth_bytes = auth_req.to_bytes().map_err(|e| e.to_string())?;
        let auth_body_start = auth_bytes
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|p| p + 4)
            .unwrap_or(0);
        let auth_body = &auth_bytes[auth_body_start..];
        if !auth_body.windows(7).any(|w| w == b"m=audio") || auth_body.len() < 80 {
            return Err(
                "INVITE retry body missing m=audio or too short (SDP must include media)"
                    .to_string(),
            );
        }
        req_text = String::from_utf8_lossy(&auth_bytes).to_string();
        transport.send(&auth_bytes).map_err(|e| e.to_string())?;
        sip_log::log_bytes(&call_id, "send", &auth_bytes);

        response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
        sip_log::log_bytes(&call_id, "recv", &response_bytes);
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        response_text = String::from_utf8_lossy(&response_bytes).to_string();
        if let Some(ref tx) = progress_tx {
            let _ = tx.send((
                response.status_code.unwrap_or(0),
                response.status_text.clone().unwrap_or_default(),
            ));
        }
        while response.status_code.map(|c| c < 200).unwrap_or(true) {
            response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
            sip_log::log_bytes(&call_id, "recv", &response_bytes);
            response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
            response_text = String::from_utf8_lossy(&response_bytes).to_string();
            if let Some(ref tx) = progress_tx {
                let _ = tx.send((
                    response.status_code.unwrap_or(0),
                    response.status_text.clone().unwrap_or_default(),
                ));
            }
        }

        code = response.status_code.unwrap_or(0);
        status_text = response.status_text.clone().unwrap_or_default();
    }

    let to_tag = response.get_header("To").and_then(|t| {
        let t_lower = t.to_lowercase();
        t_lower.find("tag=").map(|i| {
            let rest = &t[i + 4..];
            let end = rest.find(';').unwrap_or(rest.len());
            rest[..end].trim().trim_matches('"').to_string()
        })
    });

    // Extract received= and rport= from Via header in the response (RFC 3581).
    // The SBC fills these to tell us our actual observed IP:port — invaluable for NAT diagnostics.
    let (sbc_received_ip, sbc_rport) = {
        let via = response
            .get_header("Via")
            .unwrap_or(&String::new())
            .to_lowercase();
        let received = via.split(';').find_map(|part| {
            part.trim()
                .strip_prefix("received=")
                .map(|v| v.trim().to_string())
        });
        let rport = via.split(';').find_map(|part| {
            part.trim()
                .strip_prefix("rport=")
                .and_then(|v| v.trim().parse::<u16>().ok())
        });
        if received.is_some() || rport.is_some() {
            tracing::info!("SBC sees us at received={:?} rport={:?}", received, rport);
        }
        (received, rport)
    };

    let remote_contact = response.get_header("Contact").map(|c| extract_sip_uri(c));

    let (remote_rtp_address, remote_rtp_port, negotiated_pt) =
        if code >= 200 && code < 300 && !pts.is_empty() {
            let body = response.body.as_deref().unwrap_or("");
            let conn = sdp::parse_connection(body);
            let media = sdp::parse_media(body);
            if let (Some(addr), Some((port, answer_pts))) = (conn, media) {
                let pt = pts.iter().find(|p| answer_pts.contains(p)).copied();
                (Some(addr), Some(port), pt)
            } else {
                (None, None, None)
            }
        } else {
            (None, None, None)
        };

    let negotiated_codec = negotiated_pt.map(|p| match p {
        0 => "PCMU".to_string(),
        8 => "PCMA".to_string(),
        9 => "G722".to_string(),
        _ => format!("PT{}", p),
    });

    // Send ACK on 2xx
    if code >= 200 && code < 300 {
        let ack_uri = remote_contact
            .as_deref()
            .map(|c| extract_sip_uri(c))
            .unwrap_or_else(|| extract_sip_uri(&request_uri));
        let mut ack = SipMessage::new_request("ACK", &ack_uri);
        ack.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch={}",
                via_transport, local_ip, local_port, via_branch_ack
            ),
        );
        ack.add_header(
            "From",
            &format!(
                "<sip:{}@{}>;tag={}",
                escape_user(&config.username),
                aor_domain,
                from_tag
            ),
        );
        ack.add_header("To", response.get_header("To").unwrap_or(&String::new()));
        ack.add_header("Call-ID", &call_id);
        ack.add_header("CSeq", &format!("{} ACK", cseq_used));
        ack.add_header("Max-Forwards", "70");
        ack.add_header("User-Agent", &user_agent::get_effective_user_agent());
        let ack_bytes = ack.to_bytes().map_err(|e| e.to_string())?;
        transport.send(&ack_bytes).map_err(|e| e.to_string())?;
        sip_log::log_bytes(&call_id, "send", &ack_bytes);
    }

    let response_to_header = response.get_header("To").map(|s| s.to_string());

    // Parse RFC 4028 Session-Expires from 2xx response
    let (session_expires_secs, session_refresher) = response
        .get_header("Session-Expires")
        .map(|se| parse_session_expires(se))
        .unwrap_or((None, None));

    // RFC 3261: same transport (socket/stream) must be used for the dialog so BYE from far end arrives on it.
    let dialog_socket = transport.take_udp_socket();
    let dialog_tcp = (config.transport == crate::core::config::TransportType::Tcp)
        .then(|| transport.take_tcp_stream())
        .flatten();

    let call_ok = code >= 200 && code < 300;

    // INVITE transaction is complete — remove pending txn metadata used by CANCEL.
    if let Ok(mut g) = INVITE_TXNS.lock() {
        g.remove(&call_id);
    }

    Ok((
        PlaceCallResult {
            ok: call_ok,
            call_id: call_id.clone(),
            from_tag,
            to_tag,
            response_to_header,
            target_uri: request_uri,
            remote_contact_uri: remote_contact,
            status_code: code,
            status_text,
            response_time_ms,
            request_message: req_text,
            response_message: response_text,
            local_rtp_port,
            local_ip: Some(local_ip.clone()),
            remote_rtp_address,
            remote_rtp_port,
            negotiated_codec,
            negotiated_pt,
            dialog_cseq: cseq_used,
            capture_session_id,
            sbc_received_ip,
            sbc_rport,
            session_expires_secs,
            session_refresher,
        },
        dialog_socket,
        dialog_tcp,
    ))
}

/// Run a background listener that owns the dialog's UDP socket: receives BYE from remote,
/// or a signal from end_call to send BYE, or times out after no SIP activity.
/// If `dialog_socket` is Some, that socket is used (RFC 3261: same socket as INVITE/ACK receives BYE).
/// If None (e.g. TCP or fallback), binds a new socket to the configured local port.
/// When we send BYE (local hang-up), `on_bye_sent` is invoked so callers can wait for call teardown.
pub fn run_bye_listener(
    dialog_socket: Option<UdpSocket>,
    registrar_id: String,
    call_id: String,
    from_tag: String,
    to_tag: String,
    target_uri: String,
    remote_contact_uri: Option<String>,
    response_to_header: Option<String>,
    _cseq: u32,
    local_ip: String,
    local_rtp_port: u16,
    bye_rx: mpsc::Receiver<u32>,
    on_remote_bye: Box<dyn FnOnce() + Send>,
    on_bye_sent: Option<Box<dyn FnOnce() + Send>>,
    session_expires_secs: Option<u32>,
    session_refresher: Option<String>,
) {
    let config = match get_registrar_config(&registrar_id) {
        Ok(c) => c,
        Err(_) => return,
    };
    let local_port = config.local_port.unwrap_or(5060);
    let (socket, socket_source) = match dialog_socket {
        Some(s) => (s, "dialog"),
        None => {
            // The dialog socket was intentionally dropped so we can bind a clean one.
            // Retry a few times in case the OS hasn't released the port yet.
            let mut sock = None;
            for attempt in 0..10 {
                match crate::sip::transport::bind_udp_reuse(std::net::SocketAddr::from((
                    [0, 0, 0, 0],
                    local_port,
                ))) {
                    Ok(s) => {
                        sock = Some(s);
                        if attempt > 0 {
                            tracing::info!(
                                "[ByeListener:{}] Bound fresh socket on port {} after {} retries",
                                call_id,
                                local_port,
                                attempt
                            );
                        }
                        break;
                    }
                    Err(e) => {
                        if attempt < 9 {
                            tracing::error!("[ByeListener:{}] Bind attempt {} failed (port {}): {} — retrying in 100ms", call_id, attempt + 1, local_port, e);
                            std::thread::sleep(Duration::from_millis(100));
                        } else {
                            tracing::error!("[ByeListener:{}] FATAL: failed to bind fresh socket on port {} after 10 attempts: {}", call_id, local_port, e);
                        }
                    }
                }
            }
            match sock {
                Some(s) => (s, "fresh-bind"),
                None => {
                    unregister_dialog_sender(&call_id);
                    return;
                }
            }
        }
    };
    let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
    let local_addr = socket
        .local_addr()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    tracing::info!(
        "[ByeListener:{}] Started listening on {} (socket={})",
        call_id,
        local_addr,
        socket_source
    );
    let mut last_activity = Instant::now();
    let mut last_heartbeat = Instant::now();
    // RFC 4028: refresh at half the Session-Expires interval
    let we_refresh = session_refresher.as_deref() != Some("uas");
    let refresh_interval = session_expires_secs
        .filter(|_| we_refresh)
        .map(|s| Duration::from_secs((s as u64) / 2));
    let mut next_refresh = refresh_interval.map(|d| Instant::now() + d);
    let mut refresh_cseq = _cseq + 1;
    // 8K buffer so we don't truncate large SIP messages (BYE is usually small; INVITE can be large)
    let mut buf = [0u8; 8192];
    let bye_uri = remote_contact_uri
        .as_deref()
        .map(|s| extract_sip_uri(s))
        .unwrap_or_else(|| extract_sip_uri(&target_uri));
    let remote_addr = match resolve_remote_addr(remote_contact_uri.as_deref(), &target_uri) {
        Some(a) => a,
        None => {
            tracing::warn!(
                "[ByeListener:{}] resolve_remote_addr failed; stopping media and exiting",
                call_id
            );
            let _ = media_engine::stop_media(&call_id);
            unregister_dialog_sender(&call_id);
            return;
        }
    };
    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        _ => "UDP",
    };

    loop {
        // Local user requested end call: send BYE on this socket and exit.
        if let Ok(bye_cseq) = bye_rx.try_recv() {
            let mut bye = SipMessage::new_request("BYE", &bye_uri);
            bye.add_header(
                "Via",
                &format!(
                    "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                    via_transport,
                    local_ip,
                    local_port,
                    generate_tag()
                ),
            );
            bye.add_header(
                "From",
                &format!(
                    "<sip:{}@{}>;tag={}",
                    escape_user(&config.username),
                    config.domain,
                    from_tag
                ),
            );
            if let Some(ref to_hdr) = response_to_header {
                bye.add_header("To", to_hdr);
            } else {
                let to_uri = extract_sip_uri(&target_uri);
                bye.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
            }
            bye.add_header("Call-ID", &call_id);
            bye.add_header("CSeq", &format!("{} BYE", bye_cseq));
            bye.add_header("User-Agent", &user_agent::get_effective_user_agent());
            if let Ok(bye_bytes) = bye.to_bytes() {
                let _ = udp_send(&socket, &bye_bytes, remote_addr);
                sip_log::log_bytes(&call_id, "send", &bye_bytes);
            }
            if let Some(cb) = on_bye_sent {
                cb();
            }
            let _ = media_engine::stop_media(&call_id);
            unregister_dialog_sender(&call_id);
            return;
        }

        match socket.recv_from(&mut buf) {
            Ok((size, peer)) => {
                last_activity = Instant::now();
                let bytes = &buf[..size];
                // Log first line of every SIP message received
                let first_line = std::str::from_utf8(bytes)
                    .unwrap_or("<non-utf8>")
                    .lines()
                    .next()
                    .unwrap_or("<empty>");
                tracing::info!(
                    "[ByeListener:{}] Received from {}: {}",
                    call_id,
                    peer,
                    first_line
                );
                sip_log::log_bytes(&call_id, "recv", bytes);

                // Normalize Call-ID so BYE from cell/proxy (any casing/whitespace) matches this dialog.
                let normalize_call_id = |s: &str| -> String {
                    s.trim()
                        .trim_matches(|c| c == '<' || c == '>')
                        .trim_matches(|c: char| c.is_whitespace())
                        .to_lowercase()
                };
                let our_call_id = normalize_call_id(&call_id);

                // Try parsed message: handle re-INVITE (answer with 200 OK) or BYE.
                if let Ok(msg) = SipMessage::from_bytes(bytes) {
                    if msg.status_code.is_none() {
                        let msg_call_id = msg
                            .get_header("Call-ID")
                            .map(|s| normalize_call_id(s.as_str()));
                        let msg_from_tag = msg
                            .get_header("From")
                            .and_then(|s| parse_tag_from_header(s));
                        let msg_to_tag =
                            msg.get_header("To").and_then(|s| parse_tag_from_header(s));
                        let call_id_ok = msg_call_id.as_deref() == Some(our_call_id.as_str());
                        // Incoming re-INVITE: From = remote (their tag = our to_tag), To = us (our tag = our from_tag).
                        let from_tag_ok = msg_from_tag.as_deref() == Some(to_tag.as_str());
                        let to_tag_ok = msg_to_tag.as_deref() == Some(from_tag.as_str());
                        let dialog_match = call_id_ok && from_tag_ok && to_tag_ok;

                        if msg.method.eq_ignore_ascii_case("INVITE") && dialog_match {
                            let mut trying = SipMessage::new_response(100, "Trying");
                            for (name, value) in &msg.headers {
                                if name.eq_ignore_ascii_case("Via")
                                    || name.eq_ignore_ascii_case("From")
                                    || name.eq_ignore_ascii_case("To")
                                    || name.eq_ignore_ascii_case("Call-ID")
                                    || name.eq_ignore_ascii_case("CSeq")
                                {
                                    trying.add_header(name, value);
                                }
                            }
                            if let Ok(b) = trying.to_bytes() {
                                let _ = udp_send(&socket, &b, peer);
                                sip_log::log_bytes(&call_id, "send", &b);
                            }
                            let sdp = sdp::build_offer(
                                &local_ip,
                                local_rtp_port,
                                sdp::FAX_INITIAL_CODECS,
                            );
                            let mut ok = SipMessage::new_response(200, "OK");
                            for (name, value) in &msg.headers {
                                if name.eq_ignore_ascii_case("Via")
                                    || name.eq_ignore_ascii_case("From")
                                    || name.eq_ignore_ascii_case("To")
                                    || name.eq_ignore_ascii_case("Call-ID")
                                    || name.eq_ignore_ascii_case("CSeq")
                                {
                                    ok.add_header(name, value);
                                }
                            }
                            ok.add_header("Content-Type", "application/sdp");
                            ok.body = Some(sdp);
                            if let Ok(ok_bytes) = ok.to_bytes() {
                                let _ = udp_send(&socket, &ok_bytes, peer);
                                sip_log::log_bytes(&call_id, "send", &ok_bytes);
                            }
                            continue;
                        }

                        // NOTIFY: transfer status updates (RFC 3515 §2.4.5).
                        // During REFER-based transfer, the remote sends NOTIFY with sipfrag body.
                        // We respond 200 OK to acknowledge and log the transfer progress.
                        if msg.method.eq_ignore_ascii_case("NOTIFY") && (dialog_match || call_id_ok)
                        {
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
                            if let Ok(ok_bytes) = ok.to_bytes() {
                                let _ = udp_send(&socket, &ok_bytes, peer);
                            }
                            // Log sipfrag body for diagnostics
                            if let Some(ref body) = msg.body {
                                tracing::info!(
                                    "[ByeListener:{}] NOTIFY sipfrag: {}",
                                    call_id,
                                    body.lines().next().unwrap_or("")
                                );
                            }
                            continue;
                        }

                        if msg.method.eq_ignore_ascii_case("BYE") && (dialog_match || call_id_ok) {
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
                            if let Ok(ok_bytes) = ok.to_bytes() {
                                let _ = udp_send(&socket, &ok_bytes, peer);
                                sip_log::log_bytes(&call_id, "send", &ok_bytes);
                            }
                            push_remote_ended_call(call_id.clone());
                            let _ = media_engine::stop_media(&call_id);
                            on_remote_bye();
                            unregister_dialog_sender(&call_id);
                            return;
                        }
                    }
                } else {
                    // Raw fallback: parser failed (malformed headers, etc.) but packet may still be BYE for this call.
                    // SIP is primarily UDP; don't miss BYE due to parsing quirks. We must respond with 200 OK.
                    let bytes_upper = bytes
                        .iter()
                        .take(1024)
                        .map(|&b| if b >= b'a' && b <= b'z' { b - 32 } else { b })
                        .collect::<Vec<u8>>();
                    let has_bye = bytes_upper.starts_with(b"BYE ")
                        || bytes_upper.windows(4).any(|w| w == b"BYE ");
                    let body_lower = String::from_utf8_lossy(bytes).to_lowercase();
                    let has_our_call_id = body_lower.contains(our_call_id.as_str());
                    if has_bye && has_our_call_id {
                        if let Some((via, from, to_hdr, cid, cseq)) =
                            extract_headers_for_200_ok(bytes)
                        {
                            let mut ok = SipMessage::new_response(200, "OK");
                            ok.add_header("Via", &via);
                            ok.add_header("From", &from);
                            ok.add_header("To", &to_hdr);
                            ok.add_header("Call-ID", &cid);
                            ok.add_header("CSeq", &cseq);
                            if let Ok(ok_bytes) = ok.to_bytes() {
                                let _ = udp_send(&socket, &ok_bytes, peer);
                            }
                        }
                        push_remote_ended_call(call_id.clone());
                        let _ = media_engine::stop_media(&call_id);
                        on_remote_bye();
                        unregister_dialog_sender(&call_id);
                        return;
                    }
                }
            }
            Err(_) => {
                if last_heartbeat.elapsed() >= Duration::from_secs(30) {
                    tracing::info!(
                        "[ByeListener:{}] heartbeat — alive, waiting for BYE on {} (socket={})",
                        call_id,
                        local_addr,
                        socket_source
                    );
                    last_heartbeat = Instant::now();
                }
                if last_activity.elapsed() >= Duration::from_secs(SESSION_TIMEOUT_SECS) {
                    push_remote_ended_call(call_id.clone());
                    let _ = media_engine::stop_media(&call_id);
                    on_remote_bye();
                    unregister_dialog_sender(&call_id);
                    return;
                }
                // RFC 4028 session timer refresh: send re-INVITE at half the Session-Expires interval
                if let Some(deadline) = next_refresh {
                    if Instant::now() >= deadline {
                        tracing::info!(
                            "[ByeListener:{}] Sending session refresh re-INVITE (cseq={})",
                            call_id,
                            refresh_cseq
                        );
                        let sdp_body = sdp::build_reinvite_sdp(&local_ip, local_rtp_port, false);
                        let mut reinvite = SipMessage::new_request("INVITE", &bye_uri);
                        reinvite.add_header(
                            "Via",
                            &format!(
                                "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                                via_transport,
                                local_ip,
                                local_port,
                                generate_tag()
                            ),
                        );
                        reinvite.add_header("Max-Forwards", "70");
                        reinvite.add_header(
                            "From",
                            &format!(
                                "<sip:{}@{}>;tag={}",
                                escape_user(&config.username),
                                config.domain,
                                from_tag
                            ),
                        );
                        let to_uri = extract_sip_uri(&target_uri);
                        reinvite.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
                        reinvite.add_header("Call-ID", &call_id);
                        reinvite.add_header("CSeq", &format!("{} INVITE", refresh_cseq));
                        reinvite.add_header(
                            "Contact",
                            &format!(
                                "<sip:{}@{}:{}>",
                                escape_user(&config.username),
                                local_ip,
                                local_port
                            ),
                        );
                        reinvite.add_header("Supported", "timer");
                        if let Some(se) = session_expires_secs {
                            reinvite
                                .add_header("Session-Expires", &format!("{};refresher=uac", se));
                        }
                        reinvite.add_header("Content-Type", "application/sdp");
                        reinvite.add_header("User-Agent", &user_agent::get_effective_user_agent());
                        reinvite.body = Some(sdp_body);
                        if let Ok(bytes) = reinvite.to_bytes() {
                            let _ = udp_send(&socket, &bytes, remote_addr);
                            sip_log::log_bytes(&call_id, "send", &bytes);
                        }
                        refresh_cseq += 1;
                        if let Some(ref interval) = refresh_interval {
                            next_refresh = Some(Instant::now() + *interval);
                        }
                    }
                }
            }
        }
    }
}

/// Run a background listener that owns the dialog's TCP stream: receives BYE from remote or EOF (far end disconnect),
/// or a signal from end_call to send BYE on the same stream.
/// When we send BYE (local hang-up), `on_bye_sent` is invoked so callers can wait for call teardown.
pub fn run_tcp_bye_listener(
    mut stream: TcpStream,
    registrar_id: String,
    call_id: String,
    from_tag: String,
    to_tag: String,
    target_uri: String,
    remote_contact_uri: Option<String>,
    response_to_header: Option<String>,
    _cseq: u32,
    local_ip: String,
    local_rtp_port: u16,
    bye_rx: mpsc::Receiver<u32>,
    on_remote_bye: Box<dyn FnOnce() + Send>,
    on_bye_sent: Option<Box<dyn FnOnce() + Send>>,
) {
    let config = match get_registrar_config(&registrar_id) {
        Ok(c) => c,
        Err(_) => return,
    };
    let local_port = config.local_port.unwrap_or(5060);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let bye_uri = remote_contact_uri
        .as_deref()
        .map(|s| extract_sip_uri(s))
        .unwrap_or_else(|| extract_sip_uri(&target_uri));
    let via_transport = "TCP";
    let normalize_call_id = |s: &str| -> String {
        s.trim()
            .trim_matches(|c| c == '<' || c == '>')
            .trim_matches(|c: char| c.is_whitespace())
            .to_lowercase()
    };
    let our_call_id = normalize_call_id(&call_id);

    loop {
        if let Ok(bye_cseq) = bye_rx.try_recv() {
            let mut bye = SipMessage::new_request("BYE", &bye_uri);
            bye.add_header(
                "Via",
                &format!(
                    "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                    via_transport,
                    local_ip,
                    local_port,
                    generate_tag()
                ),
            );
            bye.add_header(
                "From",
                &format!(
                    "<sip:{}@{}>;tag={}",
                    escape_user(&config.username),
                    config.domain,
                    from_tag
                ),
            );
            if let Some(ref to_hdr) = response_to_header {
                bye.add_header("To", to_hdr);
            } else {
                let to_uri = extract_sip_uri(&target_uri);
                bye.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
            }
            bye.add_header("Call-ID", &call_id);
            bye.add_header("CSeq", &format!("{} BYE", bye_cseq));
            bye.add_header("User-Agent", &user_agent::get_effective_user_agent());
            if let Ok(bye_bytes) = bye.to_bytes() {
                let _ = stream.write_all(&bye_bytes);
            }
            if let Some(cb) = on_bye_sent {
                cb();
            }
            let _ = media_engine::stop_media(&call_id);
            unregister_dialog_sender(&call_id);
            return;
        }

        match read_one_sip_message(&mut stream) {
            Ok(bytes) => {
                if bytes.is_empty() {
                    push_remote_ended_call(call_id.clone());
                    let _ = media_engine::stop_media(&call_id);
                    on_remote_bye();
                    unregister_dialog_sender(&call_id);
                    return;
                }
                let msg = match SipMessage::from_bytes(&bytes) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if msg.status_code.is_none() {
                    let msg_call_id = msg
                        .get_header("Call-ID")
                        .map(|s| normalize_call_id(s.as_str()));
                    let msg_from_tag = msg
                        .get_header("From")
                        .and_then(|s| parse_tag_from_header(s));
                    let msg_to_tag = msg.get_header("To").and_then(|s| parse_tag_from_header(s));
                    let call_id_ok = msg_call_id.as_deref() == Some(our_call_id.as_str());
                    // Incoming re-INVITE/BYE from remote: From = their tag (our to_tag), To = our tag (our from_tag).
                    let from_tag_ok = msg_from_tag.as_deref() == Some(to_tag.as_str());
                    let to_tag_ok = msg_to_tag.as_deref() == Some(from_tag.as_str());
                    let dialog_match = call_id_ok && from_tag_ok && to_tag_ok;

                    if msg.method.eq_ignore_ascii_case("INVITE") && dialog_match {
                        let mut trying = SipMessage::new_response(100, "Trying");
                        for (name, value) in &msg.headers {
                            if name.eq_ignore_ascii_case("Via")
                                || name.eq_ignore_ascii_case("From")
                                || name.eq_ignore_ascii_case("To")
                                || name.eq_ignore_ascii_case("Call-ID")
                                || name.eq_ignore_ascii_case("CSeq")
                            {
                                trying.add_header(name, value);
                            }
                        }
                        if let Ok(b) = trying.to_bytes() {
                            let _ = stream.write_all(&b);
                        }
                        let sdp =
                            sdp::build_offer(&local_ip, local_rtp_port, sdp::FAX_INITIAL_CODECS);
                        let mut ok = SipMessage::new_response(200, "OK");
                        for (name, value) in &msg.headers {
                            if name.eq_ignore_ascii_case("Via")
                                || name.eq_ignore_ascii_case("From")
                                || name.eq_ignore_ascii_case("To")
                                || name.eq_ignore_ascii_case("Call-ID")
                                || name.eq_ignore_ascii_case("CSeq")
                            {
                                ok.add_header(name, value);
                            }
                        }
                        ok.add_header("Content-Type", "application/sdp");
                        ok.body = Some(sdp);
                        if let Ok(ok_bytes) = ok.to_bytes() {
                            let _ = stream.write_all(&ok_bytes);
                        }
                        continue;
                    }

                    // BYE: match by Call-ID (and tags when present). Lenient so we always end the call on BYE.
                    if msg.method.eq_ignore_ascii_case("BYE") && (dialog_match || call_id_ok) {
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
                        if let Ok(ok_bytes) = ok.to_bytes() {
                            let _ = stream.write_all(&ok_bytes);
                        }
                        push_remote_ended_call(call_id.clone());
                        let _ = media_engine::stop_media(&call_id);
                        on_remote_bye();
                        unregister_dialog_sender(&call_id);
                        return;
                    }
                }
            }
            Err(_) => {
                push_remote_ended_call(call_id.clone());
                let _ = media_engine::stop_media(&call_id);
                on_remote_bye();
                unregister_dialog_sender(&call_id);
                return;
            }
        }
    }
}

/// End call: send BYE, stop media. If a dialog thread owns the socket, signal it to send BYE
/// so we avoid binding the same port twice; otherwise send BYE ourselves.
///
/// NOTE: This function is intentionally synchronous (not async) because it performs no
/// async I/O. This allows it to be called from both async Tauri commands and synchronous
/// contexts like `spawn_blocking` fax tasks.
pub fn end_call(
    registrar_id: String,
    call_id: String,
    from_tag: String,
    to_tag: String,
    target_uri: String,
    remote_contact_uri: Option<String>,
    response_to_header: Option<String>,
    cseq: u32,
) -> Result<(), String> {
    let _span = tracing::info_span!("softphone.end_call", call_id = %call_id).entered();
    if let Ok(mut g) = DIALOG_SENDERS.lock() {
        if let Some(tx) = g.remove(&call_id) {
            drop(g);
            match tx.send(cseq) {
                Ok(()) => {
                    tracing::info!("Signaled dialog thread to send BYE for call_id={}", call_id);
                    return Ok(());
                }
                Err(_) => {
                    tracing::info!(
                        "Dialog thread channel closed for call_id={}, falling back to direct BYE",
                        call_id
                    );
                    // Fall through to direct BYE below
                }
            }
        }
    }
    media_engine::stop_media(&call_id)?;
    let config = get_registrar_config(&registrar_id)?;
    let local_port = config.local_port.unwrap_or(5060);
    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        _ => "UDP",
    };

    tracing::info!("Direct BYE: call_id={} from_tag={} to_tag={} target_uri={} remote_contact={:?} response_to={:?} cseq={}", call_id, from_tag, to_tag, target_uri, remote_contact_uri, response_to_header, cseq);

    // Extract clean SIP URI from remote_contact_uri or target_uri.
    // remote_contact_uri should already be a clean SIP URI (extracted from angle brackets
    // at the source), but handle residual angle brackets/display names defensively.
    let bye_uri = remote_contact_uri
        .as_deref()
        .map(|s| extract_sip_uri(s))
        .unwrap_or_else(|| extract_sip_uri(&target_uri));

    // Send BYE to the Contact (far end) so the cell/proxy receives it; fallback to registrar.
    let mut transport = if let Some(ref contact) = remote_contact_uri {
        let contact_clean = extract_sip_uri(contact);
        let uri = SipUri::parse(&contact_clean).map_err(|e| {
            tracing::error!(
                "Failed to parse remote contact URI '{}': {}",
                contact_clean,
                e
            );
            e.to_string()
        })?;
        let host = uri.host_for_resolution().to_string();
        let port = uri.port.unwrap_or(5060);
        Transport::new(config.transport.clone(), local_port, &host, port)
            .map_err(|e| e.to_string())?
    } else {
        create_transport(&config)?
    };
    transport.update_local_ip().map_err(|e| e.to_string())?;
    let local_ip = transport.get_local_ip_address();

    let mut bye = SipMessage::new_request("BYE", &bye_uri);
    bye.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
            via_transport,
            local_ip,
            local_port,
            generate_tag()
        ),
    );
    bye.add_header(
        "From",
        &format!(
            "<sip:{}@{}>;tag={}",
            escape_user(&config.username),
            config.domain,
            from_tag
        ),
    );
    if let Some(ref to_hdr) = response_to_header {
        bye.add_header("To", to_hdr);
    } else {
        let to_uri = extract_sip_uri(&target_uri);
        bye.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
    }
    bye.add_header("Call-ID", &call_id);
    bye.add_header("CSeq", &format!("{} BYE", cseq));
    bye.add_header("User-Agent", &user_agent::get_effective_user_agent());
    let bye_bytes = bye.to_bytes().map_err(|e| e.to_string())?;
    tracing::info!("Sending BYE to {} ({} bytes)", bye_uri, bye_bytes.len());
    transport.send(&bye_bytes).map_err(|e| {
        tracing::error!("Failed to send BYE: {}", e);
        e.to_string()
    })?;
    sip_log::log_bytes(&call_id, "send", &bye_bytes);
    tracing::info!("BYE sent successfully for call_id={}", call_id);
    Ok(())
}

/// Cancel call: send CANCEL matching the pending INVITE's Via branch and CSeq (RFC 3261 §9.1).
pub async fn cancel_call(
    registrar_id: String,
    call_id: String,
    from_tag: String,
    target_uri: String,
) -> Result<(), String> {
    media_engine::stop_media(&call_id)?;

    let txn = INVITE_TXNS.lock().ok().and_then(|mut g| g.remove(&call_id));
    let (invite_branch, invite_cseq) = match txn {
        Some(t) => (t.branch, t.cseq),
        None => {
            tracing::warn!(
                "cancel_call: no pending INVITE txn for call_id={}; using defaults",
                call_id
            );
            (format!("z9hG4bK{}", generate_tag()), 1)
        }
    };

    let config = get_registrar_config(&registrar_id)?;
    let mut transport = create_transport(&config)?;
    transport.update_local_ip().map_err(|e| e.to_string())?;
    let local_ip = transport.get_local_ip_address();
    let local_port = config.local_port.unwrap_or(5060);
    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        _ => "UDP",
    };
    let cancel_uri = extract_sip_uri(&target_uri);
    let mut cancel = SipMessage::new_request("CANCEL", &cancel_uri);
    cancel.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch={}",
            via_transport, local_ip, local_port, invite_branch
        ),
    );
    cancel.add_header(
        "From",
        &format!(
            "<sip:{}@{}>;tag={}",
            escape_user(&config.username),
            config.domain,
            from_tag
        ),
    );
    cancel.add_header("To", &format!("<{}>", cancel_uri));
    cancel.add_header("Call-ID", &call_id);
    cancel.add_header("CSeq", &format!("{} CANCEL", invite_cseq));
    cancel.add_header("User-Agent", &user_agent::get_effective_user_agent());
    let cancel_bytes = cancel.to_bytes().map_err(|e| e.to_string())?;
    transport.send(&cancel_bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// SIP REFER-based transfer (RFC 3515).
/// Sends REFER to the far end with `Refer-To: <sip:target>`. The far end should
/// establish a new call to `target` and BYE the original call.
/// Returns the new CSeq used for the REFER.
///
/// Sequence:
///   1. We send REFER (with Refer-To header)
///   2. Far end replies 202 Accepted (or 100 Trying then 202)
///   3. Far end sends NOTIFY with sipfrag body showing transfer progress
///   4. Far end BYEs us when transfer completes
///
/// The BYE listener already handles the remote BYE that arrives after a successful transfer.
pub fn send_refer(
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
    let config = get_registrar_config(&registrar_id)?;
    let password = get_password(&config)?;
    let local_port = config.local_port.unwrap_or(5060);
    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        _ => "UDP",
    };

    // Send REFER to the Contact (far end), same as BYE and re-INVITE routing.
    let refer_uri = remote_contact_uri
        .as_deref()
        .map(|s| extract_sip_uri(s))
        .unwrap_or_else(|| extract_sip_uri(target_uri.as_str()));

    let mut transport = if let Some(ref contact) = remote_contact_uri {
        let contact_trimmed = extract_sip_uri(contact);
        let uri = SipUri::parse(&contact_trimmed).map_err(|e| e.to_string())?;
        let host = uri.host_for_resolution().to_string();
        let port = uri.port.unwrap_or(5060);
        Transport::new(config.transport.clone(), local_port, &host, port)
            .map_err(|e| e.to_string())?
    } else {
        create_transport(&config)?
    };
    transport.update_local_ip().map_err(|e| e.to_string())?;
    let local_ip = transport.get_local_ip_address();

    // Normalize the transfer target into a SIP URI
    let refer_to_uri = if refer_to.starts_with("sip:") || refer_to.starts_with("sips:") {
        refer_to.clone()
    } else {
        format!("sip:{}@{}", escape_user(&refer_to), config.domain)
    };

    let mut req = SipMessage::new_request("REFER", &refer_uri);
    req.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
            via_transport,
            local_ip,
            local_port,
            generate_tag()
        ),
    );
    req.add_header("Max-Forwards", "70");
    req.add_header(
        "From",
        &format!(
            "<sip:{}@{}>;tag={}",
            escape_user(&config.username),
            config.domain,
            from_tag
        ),
    );
    if let Some(ref to_hdr) = response_to_header {
        req.add_header("To", to_hdr);
    } else {
        let to_uri = extract_sip_uri(&target_uri);
        req.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
    }
    req.add_header("Call-ID", &call_id);
    req.add_header("CSeq", &format!("{} REFER", cseq));
    req.add_header(
        "Contact",
        &format!(
            "<sip:{}@{}:{}>",
            escape_user(&config.username),
            local_ip,
            local_port
        ),
    );
    req.add_header("Refer-To", &format!("<{}>", refer_to_uri));
    // Referred-By (RFC 3892): tells the transfer target who initiated the transfer.
    req.add_header(
        "Referred-By",
        &format!("<sip:{}@{}>", escape_user(&config.username), config.domain),
    );
    req.add_header("User-Agent", &user_agent::get_effective_user_agent());

    let req_bytes = req.to_bytes().map_err(|e| e.to_string())?;
    transport.send(&req_bytes).map_err(|e| e.to_string())?;

    let timeout = Duration::from_secs(config.timeout_seconds.max(16));
    let mut response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
    let mut response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    // Skip provisional responses (100 Trying)
    while response.status_code.map(|c| c < 200).unwrap_or(true) {
        response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    }
    let mut code = response.status_code.unwrap_or(0);
    let mut cseq_used = cseq;

    // Handle 401/407 authentication challenge
    if code == 401 || code == 407 {
        let auth_header = if code == 401 {
            response.get_header("WWW-Authenticate")
        } else {
            response.get_header("Proxy-Authenticate")
        }
        .ok_or_else(|| "Missing authentication challenge header".to_string())?;

        let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
        let challenge = auth::parse_auth_challenge(auth_header, default_realm)?;
        let username = config.auth_username.as_ref().unwrap_or(&config.username);
        let auth_value =
            auth::build_digest_authorization("REFER", &refer_uri, username, &password, &challenge);

        let mut auth_req = SipMessage::new_request("REFER", &refer_uri);
        for (name, value) in &req.headers {
            let lname = name.to_lowercase();
            if lname == "via"
                || lname == "cseq"
                || lname == "authorization"
                || lname == "proxy-authorization"
            {
                continue;
            }
            auth_req.add_header(name, value);
        }
        auth_req.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                via_transport,
                local_ip,
                local_port,
                generate_tag()
            ),
        );
        cseq_used = cseq + 1;
        auth_req.add_header("CSeq", &format!("{} REFER", cseq_used));
        if code == 401 {
            auth_req.add_header("Authorization", &auth_value);
        } else {
            auth_req.add_header("Proxy-Authorization", &auth_value);
        }
        let auth_bytes = auth_req.to_bytes().map_err(|e| e.to_string())?;
        transport.send(&auth_bytes).map_err(|e| e.to_string())?;

        response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        while response.status_code.map(|c| c < 200).unwrap_or(true) {
            response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
            response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        }
        code = response.status_code.unwrap_or(0);
    }

    if code == 202 || (code >= 200 && code < 300) {
        // REFER accepted. The far end will establish the new call and send us NOTIFYs
        // with sipfrag status updates, then BYE us when the transfer completes.
        // The BYE listener handles the remote BYE.
        tracing::info!(
            "[REFER:{}] Transfer accepted: {} {}",
            call_id,
            code,
            response.status_text.as_deref().unwrap_or("")
        );
        Ok(cseq_used)
    } else {
        let status = response.status_code.unwrap_or(0);
        let reason = response.status_text.as_deref().unwrap_or("").trim();
        Err(format!("REFER failed: {} {}", status, reason))
    }
}

/// Attended (consultative) transfer using REFER with Replaces (RFC 3891).
///
/// Flow: User has call A on hold and consult call B active. This function sends REFER
/// to call A, telling A to replace our dialog with a direct connection to B.
///
/// The Refer-To URI includes `?Replaces=<B-Call-ID>%3Bfrom-tag%3D<B-from>%3Bto-tag%3D<B-to>`.
/// After A's PBX processes the REFER, A and B are connected directly, and both our legs get BYE'd.
pub fn send_attended_refer(
    // Call A (the held call being transferred)
    registrar_id: String,
    call_id_a: String,
    from_tag_a: String,
    to_tag_a: String,
    target_uri_a: String,
    remote_contact_uri_a: Option<String>,
    response_to_header_a: Option<String>,
    cseq_a: u32,
    // Call B details (the consult call)
    call_id_b: String,
    from_tag_b: String,
    to_tag_b: String,
    target_b: String,
) -> Result<u32, String> {
    let config = get_registrar_config(&registrar_id)?;

    // Build the Refer-To URI for call B with Replaces header.
    // Format: <sip:target@domain?Replaces=call-id%3Bfrom-tag%3Dxxx%3Bto-tag%3Dyyy>
    let b_target = if target_b.starts_with("sip:") || target_b.starts_with("sips:") {
        target_b.clone()
    } else {
        format!("sip:{}@{}", escape_user(&target_b), config.domain)
    };

    // URL-encode the Replaces value: Call-ID;from-tag=X;to-tag=Y
    // In the Replaces header, from-tag is the originator's tag and to-tag is the recipient's.
    // Since we originated call B: from-tag = our from_tag_b, to-tag = their to_tag_b.
    let replaces_value = format!(
        "{}%3Bfrom-tag%3D{}%3Bto-tag%3D{}",
        urlencoding::encode(&call_id_b),
        urlencoding::encode(&from_tag_b),
        urlencoding::encode(&to_tag_b),
    );
    let refer_to = format!("{}?Replaces={}", b_target, replaces_value);

    // Send REFER on call A's dialog
    send_refer(
        registrar_id,
        call_id_a,
        from_tag_a,
        to_tag_a,
        target_uri_a,
        remote_contact_uri_a,
        response_to_header_a,
        cseq_a,
        refer_to,
    )
}

/// Hold: re-INVITE with a=sendonly per RFC 3264 §8.4.
/// Resume: re-INVITE with a=sendrecv; after 200 OK we unmute and flush jitter.
/// cseq must be the next in-dialog CSeq (dialog_cseq + 1 from place_call; then increment after each hold/resume).
pub async fn hold_call(
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
    let config = get_registrar_config(&registrar_id)?;
    let password = get_password(&config)?;
    let mut transport = create_transport(&config)?;
    transport.update_local_ip().map_err(|e| e.to_string())?;
    let local_ip = call_local_ip.unwrap_or_else(|| transport.get_local_ip_address());
    // Use the port passed by the caller (already allocated); fall back to config or dynamic alloc.
    let local_rtp_port = call_local_rtp_port.unwrap_or_else(|| config.rtp_port.unwrap_or(0));
    let local_port = config.local_port.unwrap_or(5060);
    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        _ => "UDP",
    };
    // Send re-INVITE to the Contact (far end that answered) so the server accepts it; many return 404 if sent to target_uri.
    let reinvite_uri = remote_contact_uri
        .as_deref()
        .map(|s| extract_sip_uri(s))
        .unwrap_or_else(|| extract_sip_uri(target_uri.as_str()));
    let sdp_body = sdp::build_reinvite_sdp(&local_ip, local_rtp_port, on_hold);

    let mut req = SipMessage::new_request("INVITE", &reinvite_uri);
    req.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
            via_transport,
            local_ip,
            local_port,
            generate_tag()
        ),
    );
    req.add_header("Max-Forwards", "70");
    req.add_header(
        "From",
        &format!(
            "<sip:{}@{}>;tag={}",
            escape_user(&config.username),
            config.domain,
            from_tag
        ),
    );
    let to_uri = extract_sip_uri(&target_uri);
    req.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
    req.add_header("Call-ID", &call_id);
    req.add_header("CSeq", &format!("{} INVITE", cseq));
    req.add_header(
        "Contact",
        &format!(
            "<sip:{}@{}:{}>",
            escape_user(&config.username),
            local_ip,
            local_port
        ),
    );
    req.add_header("Content-Type", "application/sdp");
    req.add_header("User-Agent", &user_agent::get_effective_user_agent());
    req.body = Some(sdp_body);

    let req_bytes = req.to_bytes().map_err(|e| e.to_string())?;
    transport.send(&req_bytes).map_err(|e| e.to_string())?;

    let timeout_secs = config.timeout_seconds.max(16);
    let timeout = Duration::from_secs(timeout_secs);
    let mut response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
    let mut response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    while response.status_code.map(|c| c < 200).unwrap_or(true) {
        response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    }
    let mut code = response.status_code.unwrap_or(0);
    let mut cseq_used = cseq;

    if code == 401 || code == 407 {
        let auth_header = if code == 401 {
            response.get_header("WWW-Authenticate")
        } else {
            response.get_header("Proxy-Authenticate")
        }
        .ok_or_else(|| "Missing authentication challenge header".to_string())?;

        let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
        let challenge = auth::parse_auth_challenge(auth_header, default_realm)?;
        let username = config.auth_username.as_ref().unwrap_or(&config.username);
        let auth_value = auth::build_digest_authorization(
            "INVITE",
            &reinvite_uri,
            username,
            &password,
            &challenge,
        );

        let mut auth_req = SipMessage::new_request("INVITE", &reinvite_uri);
        for (name, value) in &req.headers {
            let lname = name.to_lowercase();
            if lname == "via"
                || lname == "cseq"
                || lname == "authorization"
                || lname == "proxy-authorization"
            {
                continue;
            }
            auth_req.add_header(name, value);
        }
        auth_req.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                via_transport,
                local_ip,
                local_port,
                generate_tag()
            ),
        );
        cseq_used = cseq + 1;
        auth_req.add_header("CSeq", &format!("{} INVITE", cseq_used));
        if code == 401 {
            auth_req.add_header("Authorization", &auth_value);
        } else {
            auth_req.add_header("Proxy-Authorization", &auth_value);
        }
        auth_req.body = req.body.clone();

        let auth_bytes = auth_req.to_bytes().map_err(|e| e.to_string())?;
        transport.send(&auth_bytes).map_err(|e| e.to_string())?;
        response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        while response.status_code.map(|c| c < 200).unwrap_or(true) {
            response_bytes = transport.receive(timeout).map_err(|e| e.to_string())?;
            response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        }
        code = response.status_code.unwrap_or(0);
    }
    if code >= 200 && code < 300 {
        let ack_uri = response
            .get_header("Contact")
            .map(|c| extract_sip_uri(c))
            .unwrap_or(reinvite_uri.clone());
        let mut ack = SipMessage::new_request("ACK", &ack_uri);
        ack.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                via_transport,
                local_ip,
                local_port,
                generate_tag()
            ),
        );
        ack.add_header(
            "From",
            &format!(
                "<sip:{}@{}>;tag={}",
                escape_user(&config.username),
                config.domain,
                from_tag
            ),
        );
        ack.add_header("To", response.get_header("To").unwrap_or(&String::new()));
        ack.add_header("Call-ID", &call_id);
        ack.add_header("CSeq", &format!("{} ACK", cseq_used));
        ack.add_header("Max-Forwards", "70");
        ack.add_header("User-Agent", &user_agent::get_effective_user_agent());
        let ack_bytes = ack.to_bytes().map_err(|e| e.to_string())?;
        transport.send(&ack_bytes).map_err(|e| e.to_string())?;
        // Apply media state only after remote agreed (resume audio after they send RTP again).
        // Don't call set_muted here — hold/resume should not overwrite the user's mute state.
        // The send path checks both on_hold and muted independently.
        set_hold(&call_id, on_hold)?;
        return Ok(cseq_used);
    }
    let status = response.status_code.unwrap_or(0);
    let reason = response.status_text.as_deref().unwrap_or("").trim();
    Err(format!("Hold/resume failed: {} {}", status, reason))
}

/// Result of T.38 re-INVITE: success, new CSeq, remote UDPTL addr/port for payload, and message snippets.
#[derive(Debug)]
#[allow(dead_code)]
pub struct T38ReinviteResult {
    pub ok: bool,
    pub status_code: u16,
    pub status_text: String,
    pub new_cseq: u32,
    pub request_message: String,
    pub response_message: String,
    /// Remote UDPTL address (from 200 OK SDP c=). None if not 2xx or no c=.
    pub remote_udptl_address: Option<String>,
    /// Remote UDPTL port (from 200 OK SDP m=image). None if not 2xx or no m=image.
    pub remote_udptl_port: Option<u16>,
}

/// Resolve reinvite URI (Contact or target) to SocketAddr for send_to.
fn resolve_reinvite_uri(uri: &str) -> Result<SocketAddr, String> {
    let uri = SipUri::parse(uri).map_err(|e| e.to_string())?;
    let host = uri.host_for_resolution();
    let port = uri.port.unwrap_or(5060);
    format!("{}:{}", host, port)
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or_else(|| "No address for reinvite URI".to_string())
}

/// VoIP fax scenario: after call is established with G.711, send re-INVITE with T.38 SDP (RFC 3362)
/// so the session can switch to T.38. Caller must use next in-dialog CSeq (dialog_cseq + 1).
/// When existing_dialog_socket is Some, use that socket for send/recv (same port as initial INVITE)
/// instead of binding a new port, which would fail with "Failed to bind UDP socket for dialog".
/// Returns (result, socket_to_return): when existing_dialog_socket was Some, returns it for BYE listener.
/// Blocking; use from spawn_blocking.
pub fn send_t38_reinvite(
    registrar_id: String,
    call_id: String,
    from_tag: String,
    to_tag: String,
    target_uri: String,
    remote_contact_uri: Option<String>,
    _response_to_header: Option<String>,
    dialog_cseq: u32,
    local_ip: String,
    udptl_port: u16,
    existing_dialog_socket: Option<UdpSocket>,
) -> Result<(T38ReinviteResult, Option<UdpSocket>), String> {
    let config = get_registrar_config(&registrar_id)?;
    let password = get_password(&config)?;
    let via_transport = "UDP";
    let reinvite_cseq = dialog_cseq + 1;

    let reinvite_uri = remote_contact_uri
        .as_deref()
        .map(|s| extract_sip_uri(s))
        .unwrap_or_else(|| extract_sip_uri(target_uri.as_str()));

    let remote_addr = resolve_reinvite_uri(&reinvite_uri)?;
    let timeout_secs = config.timeout_seconds.max(16);
    let timeout = Duration::from_secs(timeout_secs);

    let (local_port, transport_or_socket): (u16, ReinviteTransport) =
        if let Some(socket) = existing_dialog_socket {
            let local_port = socket.local_addr().map_err(|e| e.to_string())?.port();
            socket
                .set_read_timeout(Some(timeout))
                .map_err(|e| format!("set_read_timeout: {}", e))?;
            (
                local_port,
                ReinviteTransport::Socket {
                    socket,
                    remote_addr,
                },
            )
        } else {
            let mut transport = create_transport(&config)?;
            transport.update_local_ip().map_err(|e| e.to_string())?;
            let local_port = config.local_port.unwrap_or(5060);
            (local_port, ReinviteTransport::Transport(transport))
        };

    let sdp_body = sdp::build_t38_offer(&local_ip, udptl_port);

    let mut req = SipMessage::new_request("INVITE", &reinvite_uri);
    req.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
            via_transport,
            local_ip,
            local_port,
            generate_tag()
        ),
    );
    req.add_header("Max-Forwards", "70");
    req.add_header(
        "From",
        &format!(
            "<sip:{}@{}>;tag={}",
            escape_user(&config.username),
            config.domain,
            from_tag
        ),
    );
    let to_uri = extract_sip_uri(&target_uri);
    req.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
    req.add_header("Call-ID", &call_id);
    req.add_header("CSeq", &format!("{} INVITE", reinvite_cseq));
    req.add_header(
        "Contact",
        &format!(
            "<sip:{}@{}:{}>",
            escape_user(&config.username),
            local_ip,
            local_port
        ),
    );
    req.add_header("Content-Type", "application/sdp");
    req.add_header("User-Agent", &user_agent::get_effective_user_agent());
    req.body = Some(sdp_body);

    let req_bytes = req.to_bytes().map_err(|e| e.to_string())?;
    let req_text = String::from_utf8_lossy(&req_bytes).to_string();
    transport_or_socket.send(&req_bytes)?;

    let mut response_bytes = transport_or_socket.receive(timeout)?;
    let mut response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    while response.status_code.map(|c| c < 200).unwrap_or(true) {
        response_bytes = transport_or_socket.receive(timeout)?;
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    }
    let mut code = response.status_code.unwrap_or(0);
    let mut cseq_used = reinvite_cseq;

    if code == 401 || code == 407 {
        let auth_header = if code == 401 {
            response.get_header("WWW-Authenticate")
        } else {
            response.get_header("Proxy-Authenticate")
        }
        .ok_or_else(|| "Missing authentication challenge header".to_string())?;

        let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
        let challenge = auth::parse_auth_challenge(auth_header, default_realm)?;
        let username = config.auth_username.as_ref().unwrap_or(&config.username);
        let auth_value = auth::build_digest_authorization(
            "INVITE",
            &reinvite_uri,
            username,
            &password,
            &challenge,
        );

        let mut auth_req = SipMessage::new_request("INVITE", &reinvite_uri);
        for (name, value) in &req.headers {
            let lname = name.to_lowercase();
            if lname == "via"
                || lname == "cseq"
                || lname == "authorization"
                || lname == "proxy-authorization"
            {
                continue;
            }
            auth_req.add_header(name, value);
        }
        auth_req.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                via_transport,
                local_ip,
                local_port,
                generate_tag()
            ),
        );
        cseq_used = reinvite_cseq + 1;
        auth_req.add_header("CSeq", &format!("{} INVITE", cseq_used));
        if code == 401 {
            auth_req.add_header("Authorization", &auth_value);
        } else {
            auth_req.add_header("Proxy-Authorization", &auth_value);
        }
        auth_req.body = req.body.clone();

        let auth_bytes = auth_req.to_bytes().map_err(|e| e.to_string())?;
        transport_or_socket.send(&auth_bytes)?;
        response_bytes = transport_or_socket.receive(timeout)?;
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        while response.status_code.map(|c| c < 200).unwrap_or(true) {
            response_bytes = transport_or_socket.receive(timeout)?;
            response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        }
        code = response.status_code.unwrap_or(0);
    }

    let response_message = String::from_utf8_lossy(&response_bytes).to_string();

    if code >= 200 && code < 300 {
        let ack_uri = response
            .get_header("Contact")
            .map(|c| extract_sip_uri(c))
            .unwrap_or(reinvite_uri);
        let mut ack = SipMessage::new_request("ACK", &ack_uri);
        ack.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                via_transport,
                local_ip,
                local_port,
                generate_tag()
            ),
        );
        ack.add_header(
            "From",
            &format!(
                "<sip:{}@{}>;tag={}",
                escape_user(&config.username),
                config.domain,
                from_tag
            ),
        );
        ack.add_header("To", response.get_header("To").unwrap_or(&String::new()));
        ack.add_header("Call-ID", &call_id);
        ack.add_header("CSeq", &format!("{} ACK", cseq_used));
        ack.add_header("Max-Forwards", "70");
        ack.add_header("User-Agent", &user_agent::get_effective_user_agent());
        let ack_bytes = ack.to_bytes().map_err(|e| e.to_string())?;
        transport_or_socket.send(&ack_bytes)?;
    }

    let (remote_udptl_address, remote_udptl_port) = if code >= 200 && code < 300 {
        let body = response.body.as_deref().unwrap_or("");
        let addr = sdp::parse_connection_for_image(body).or_else(|| sdp::parse_connection(body));
        let port = sdp::parse_t38_media(body);
        (addr, port)
    } else {
        (None, None)
    };

    // T.38 is accepted ONLY if:
    // 1. Status code is 2xx (success)
    // 2. Response SDP contains m=image (T.38 media) with a valid port
    // A 200 OK with only m=audio means the gateway rejected T.38 and kept audio mode.
    let t38_accepted = code >= 200 && code < 300 && remote_udptl_port.is_some();

    let socket_to_return = transport_or_socket.take_socket();
    Ok((
        T38ReinviteResult {
            ok: t38_accepted,
            status_code: code,
            status_text: response.status_text.clone().unwrap_or_default(),
            new_cseq: cseq_used,
            request_message: req_text,
            response_message,
            remote_udptl_address,
            remote_udptl_port,
        },
        socket_to_return,
    ))
}

/// Result of an audio SDP-correction re-INVITE.
#[allow(dead_code)]
pub struct AudioReinviteResult {
    pub ok: bool,
    pub status_code: u16,
    pub status_text: String,
    pub new_cseq: u32,
}

/// Send a mid-call re-INVITE with corrected audio SDP (same codecs, corrected media address).
/// Used after discovering our actual external port via STUN probe to the SBC's media address.
/// This fixes symmetric NAT by telling the SBC our correct NATted RTP port.
#[allow(dead_code)]
pub fn send_audio_reinvite(
    registrar_id: String,
    call_id: String,
    from_tag: String,
    to_tag: String,
    target_uri: String,
    remote_contact_uri: Option<String>,
    dialog_cseq: u32,
    sdp_ip: String,
    sdp_port: u16,
    existing_dialog_socket: Option<UdpSocket>,
) -> Result<(AudioReinviteResult, Option<UdpSocket>), String> {
    let config = get_registrar_config(&registrar_id)?;
    let password = get_password(&config)?;
    let via_transport = "UDP";
    let reinvite_cseq = dialog_cseq + 1;

    let reinvite_uri = remote_contact_uri
        .as_deref()
        .map(|s| extract_sip_uri(s))
        .unwrap_or_else(|| extract_sip_uri(target_uri.as_str()));

    let remote_addr = resolve_reinvite_uri(&reinvite_uri)?;
    let timeout_secs = config.timeout_seconds.max(16);
    let timeout = Duration::from_secs(timeout_secs);

    let (local_port, transport_or_socket): (u16, ReinviteTransport) =
        if let Some(socket) = existing_dialog_socket {
            let local_port = socket.local_addr().map_err(|e| e.to_string())?.port();
            socket
                .set_read_timeout(Some(timeout))
                .map_err(|e| format!("set_read_timeout: {}", e))?;
            (
                local_port,
                ReinviteTransport::Socket {
                    socket,
                    remote_addr,
                },
            )
        } else {
            let mut transport = create_transport(&config)?;
            transport.update_local_ip().map_err(|e| e.to_string())?;
            let local_port = config.local_port.unwrap_or(5060);
            (local_port, ReinviteTransport::Transport(transport))
        };

    // Build corrected audio SDP with the discovered port
    let sdp_body = sdp::build_offer(&sdp_ip, sdp_port, sdp::FAX_INITIAL_CODECS);

    let local_ip = sdp_ip.clone();
    let mut req = SipMessage::new_request("INVITE", &reinvite_uri);
    req.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
            via_transport,
            local_ip,
            local_port,
            generate_tag()
        ),
    );
    req.add_header("Max-Forwards", "70");
    req.add_header(
        "From",
        &format!(
            "<sip:{}@{}>;tag={}",
            escape_user(&config.username),
            config.domain,
            from_tag
        ),
    );
    let to_uri = extract_sip_uri(&target_uri);
    req.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
    req.add_header("Call-ID", &call_id);
    req.add_header("CSeq", &format!("{} INVITE", reinvite_cseq));
    req.add_header(
        "Contact",
        &format!(
            "<sip:{}@{}:{}>",
            escape_user(&config.username),
            local_ip,
            local_port
        ),
    );
    req.add_header("Content-Type", "application/sdp");
    req.add_header("User-Agent", &user_agent::get_effective_user_agent());
    req.body = Some(sdp_body);

    let req_bytes = req.to_bytes().map_err(|e| e.to_string())?;
    transport_or_socket.send(&req_bytes)?;

    let mut response_bytes = transport_or_socket.receive(timeout)?;
    let mut response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    while response.status_code.map(|c| c < 200).unwrap_or(true) {
        response_bytes = transport_or_socket.receive(timeout)?;
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    }
    let mut code = response.status_code.unwrap_or(0);
    let mut cseq_used = reinvite_cseq;

    // Handle auth challenge
    if code == 401 || code == 407 {
        let auth_header = if code == 401 {
            response.get_header("WWW-Authenticate")
        } else {
            response.get_header("Proxy-Authenticate")
        }
        .ok_or_else(|| "Missing authentication challenge header".to_string())?;

        let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
        let challenge = auth::parse_auth_challenge(auth_header, default_realm)?;
        let username = config.auth_username.as_ref().unwrap_or(&config.username);
        let auth_value = auth::build_digest_authorization(
            "INVITE",
            &reinvite_uri,
            username,
            &password,
            &challenge,
        );

        cseq_used = reinvite_cseq + 1;
        let mut retry = SipMessage::new_request("INVITE", &reinvite_uri);
        retry.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                via_transport,
                local_ip,
                local_port,
                generate_tag()
            ),
        );
        retry.add_header("Max-Forwards", "70");
        retry.add_header(
            "From",
            &format!(
                "<sip:{}@{}>;tag={}",
                escape_user(&config.username),
                config.domain,
                from_tag
            ),
        );
        retry.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
        retry.add_header("Call-ID", &call_id);
        retry.add_header("CSeq", &format!("{} INVITE", cseq_used));
        retry.add_header(
            "Contact",
            &format!(
                "<sip:{}@{}:{}>",
                escape_user(&config.username),
                local_ip,
                local_port
            ),
        );
        if code == 401 {
            retry.add_header("Authorization", &auth_value);
        } else {
            retry.add_header("Proxy-Authorization", &auth_value);
        }
        retry.add_header("Content-Type", "application/sdp");
        retry.add_header("User-Agent", &user_agent::get_effective_user_agent());
        retry.body = Some(sdp::build_offer(&sdp_ip, sdp_port, sdp::FAX_INITIAL_CODECS));

        let retry_bytes = retry.to_bytes().map_err(|e| e.to_string())?;
        transport_or_socket.send(&retry_bytes)?;

        response_bytes = transport_or_socket.receive(timeout)?;
        response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        while response.status_code.map(|c| c < 200).unwrap_or(true) {
            response_bytes = transport_or_socket.receive(timeout)?;
            response = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
        }
        code = response.status_code.unwrap_or(0);
    }

    // Send ACK for 2xx
    if code >= 200 && code < 300 {
        let mut ack = SipMessage::new_request("ACK", &reinvite_uri);
        ack.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch=z9hG4bK{}",
                via_transport,
                local_ip,
                local_port,
                generate_tag()
            ),
        );
        ack.add_header("Max-Forwards", "70");
        ack.add_header(
            "From",
            &format!(
                "<sip:{}@{}>;tag={}",
                escape_user(&config.username),
                config.domain,
                from_tag
            ),
        );
        ack.add_header("To", &format!("<{}>;tag={}", to_uri, to_tag));
        ack.add_header("Call-ID", &call_id);
        ack.add_header("CSeq", &format!("{} ACK", cseq_used));
        ack.add_header("User-Agent", &user_agent::get_effective_user_agent());
        let ack_bytes = ack.to_bytes().map_err(|e| e.to_string())?;
        transport_or_socket.send(&ack_bytes)?;
    }

    let socket_to_return = transport_or_socket.take_socket();
    Ok((
        AudioReinviteResult {
            ok: code >= 200 && code < 300,
            status_code: code,
            status_text: response.status_text.clone().unwrap_or_default(),
            new_cseq: cseq_used,
        },
        socket_to_return,
    ))
}

/// Either a new Transport (binds a port) or the existing dialog UDP socket (no new bind).
enum ReinviteTransport {
    Socket {
        socket: UdpSocket,
        remote_addr: SocketAddr,
    },
    Transport(Transport),
}

impl ReinviteTransport {
    fn send(&self, data: &[u8]) -> Result<(), String> {
        match self {
            ReinviteTransport::Socket {
                socket,
                remote_addr,
            } => {
                udp_send(socket, data, *remote_addr).map_err(|e| e.to_string())?;
                Ok(())
            }
            ReinviteTransport::Transport(t) => {
                t.send(data).map_err(|e| e.to_string())?;
                Ok(())
            }
        }
    }

    fn receive(&self, timeout: Duration) -> Result<Vec<u8>, String> {
        match self {
            ReinviteTransport::Socket { socket, .. } => {
                let mut buf = vec![0u8; 4096];
                let (n, _) = socket.recv_from(&mut buf).map_err(|e| e.to_string())?;
                buf.truncate(n);
                Ok(buf)
            }
            ReinviteTransport::Transport(t) => t.receive(timeout).map_err(|e| e.to_string()),
        }
    }

    fn take_socket(self) -> Option<UdpSocket> {
        match self {
            ReinviteTransport::Socket { socket, .. } => Some(socket),
            ReinviteTransport::Transport(_) => None,
        }
    }
}
