//! OPTIONS keepalive: periodically sends SIP OPTIONS to the registrar to keep NAT bindings
//! alive between re-registrations (RFC 3261 §11). Typically sent every 30 seconds.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use once_cell::sync::Lazy;

use crate::core::config::RegistrarConfig;
use crate::core::database::Database;
use crate::core::user_agent;
use crate::sip::stack::{generate_call_id, generate_tag, SipMessage};
use crate::sip::transport::Transport;

const KEEPALIVE_INTERVAL_SECS: u64 = 30;

static KEEPALIVE_THREADS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Start sending OPTIONS keepalives for a registrar. Idempotent — restarts if already running.
pub fn start_keepalive(registrar_id: &str) {
    stop_keepalive(registrar_id);

    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = KEEPALIVE_THREADS.lock() {
        map.insert(registrar_id.to_string(), stop.clone());
    }

    let reg_id = registrar_id.to_string();
    std::thread::spawn(move || run_keepalive_loop(&reg_id, stop));
}

/// Stop OPTIONS keepalive for a registrar.
pub fn stop_keepalive(registrar_id: &str) {
    if let Ok(mut map) = KEEPALIVE_THREADS.lock() {
        if let Some(stop) = map.remove(registrar_id) {
            stop.store(true, Ordering::SeqCst);
        }
    }
}

/// Stop all keepalive threads (app shutdown).
pub fn stop_all() {
    if let Ok(mut map) = KEEPALIVE_THREADS.lock() {
        for (_, stop) in map.drain() {
            stop.store(true, Ordering::SeqCst);
        }
    }
}

fn run_keepalive_loop(registrar_id: &str, stop: Arc<AtomicBool>) {
    let config = match load_config(registrar_id) {
        Some(c) => c,
        None => return,
    };

    let domain = &config.domain;
    let request_uri = format!("sip:{}", domain);
    let remote_addr = match resolve_registrar(&config) {
        Some(a) => a,
        None => {
            tracing::info!("[OptionsKeepalive:{}] Could not resolve registrar address", registrar_id);
            return;
        }
    };

    let local_port = config.local_port.unwrap_or(5060);
    let bind_addr: std::net::SocketAddr = format!("0.0.0.0:{}", local_port).parse().unwrap();
    let socket = match crate::sip::transport::bind_udp_reuse(bind_addr) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("[OptionsKeepalive:{}] Failed to bind socket: {}", registrar_id, e);
            return;
        }
    };
    let _ = socket.set_read_timeout(Some(Duration::from_secs(5)));

    let local_ip = Transport::get_local_ip_for_remote(&remote_addr)
        .ok()
        .flatten()
        .unwrap_or_else(|| "0.0.0.0".to_string());

    tracing::info!("[OptionsKeepalive:{}] Started (interval={}s, remote={})", registrar_id, KEEPALIVE_INTERVAL_SECS, remote_addr);

    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_secs(KEEPALIVE_INTERVAL_SECS));
        if stop.load(Ordering::SeqCst) {
            break;
        }

        let branch = format!("z9hG4bK{}", generate_tag());
        let call_id = generate_call_id();
        let from_tag = generate_tag();

        let mut req = SipMessage::new_request("OPTIONS", &request_uri);
        req.add_header("Via", &format!("SIP/2.0/UDP {}:{};rport;branch={}", local_ip, local_port, branch));
        req.add_header("Max-Forwards", "70");
        req.add_header("From", &format!("<sip:{}@{}>;tag={}", config.username, domain, from_tag));
        req.add_header("To", &format!("<sip:{}>", domain));
        req.add_header("Call-ID", &call_id);
        req.add_header("CSeq", "1 OPTIONS");
        req.add_header("Contact", &format!("<sip:{}@{}:{}>", config.username, local_ip, local_port));
        req.add_header("Accept", "application/sdp");
        req.add_header("User-Agent", &user_agent::get_effective_user_agent());

        if let Ok(bytes) = req.to_bytes() {
            match socket.send_to(&bytes, remote_addr) {
                Ok(_) => {
                    // Read response (best-effort, we don't care about content)
                    let mut buf = [0u8; 4096];
                    let _ = socket.recv_from(&mut buf);
                }
                Err(e) => {
                    tracing::error!("[OptionsKeepalive:{}] Send failed: {}", registrar_id, e);
                }
            }
        }
    }

    tracing::info!("[OptionsKeepalive:{}] Stopped", registrar_id);
}

fn load_config(registrar_id: &str) -> Option<RegistrarConfig> {
    let registrars = Database::load_registrars().ok()?;
    registrars.into_iter().find(|r| r.id == registrar_id)
}

fn resolve_registrar(config: &RegistrarConfig) -> Option<std::net::SocketAddr> {
    let port = config.remote_port;
    let addr_str = format!("{}:{}", config.domain, port);
    addr_str.parse().ok().or_else(|| {
        use std::net::ToSocketAddrs;
        addr_str.to_socket_addrs().ok()?.next()
    })
}
