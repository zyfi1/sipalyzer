//! VoIP server probe — multiple methods for measuring server responsiveness.
//!
//! Not every server responds to every method. This module supports:
//!
//! - **SIP OPTIONS** (UDP) — Standard SIP ping; most servers respond with 200 OK.
//! - **SIP REGISTER** (UDP) — Sends an unauthorized REGISTER; expect 401/407.
//!   Works against servers that ignore OPTIONS but always respond to REGISTER.
//! - **TCP Connect** — Measures TCP handshake time to SIP port. Works even if
//!   the SIP stack ignores UDP probes. Gives latency but no SIP-level info.
//! - **Auto** — Tries OPTIONS first (3 probes). If no response, tries REGISTER.
//!   If still nothing, falls back to TCP. Then runs the full count with whatever
//!   method worked.
//!
//! Each packet is streamed to the frontend via `sip-probe-packet` events
//! so the user can watch them arrive in real time.

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::net::{TcpStream, UdpSocket};
use crate::core::user_agent;

// ── Probe method enum ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProbeMethod {
    Options,
    Register,
    Tcp,
    Auto,
}

impl Default for ProbeMethod {
    fn default() -> Self {
        Self::Auto
    }
}

// ── Config / Result types ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipProbeConfig {
    pub host: String,
    pub port: u16,
    pub count: u32,
    pub interval_ms: u32,
    pub timeout_ms: u64,
    pub method: ProbeMethod,
}

impl Default for SipProbeConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 5060,
            count: 20,
            interval_ms: 200,
            timeout_ms: 2000,
            method: ProbeMethod::Auto,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipProbeResult {
    pub host: String,
    pub resolved_ip: String,
    pub port: u16,
    /// Which method was actually used (important for auto-detect)
    pub method_used: String,

    // Latency
    pub avg_latency_ms: f64,
    pub min_latency_ms: f64,
    pub max_latency_ms: f64,
    pub stddev_latency_ms: f64,
    pub probe_rtts: Vec<Option<f64>>,

    // Jitter (RFC 3550 style — variation in consecutive RTTs)
    pub avg_jitter_ms: f64,
    pub max_jitter_ms: f64,

    // Packet loss
    pub packets_sent: u32,
    pub packets_received: u32,
    pub packet_loss_pct: f64,

    // SIP-specific (empty for TCP method)
    pub sip_responses: Vec<SipResponseInfo>,

    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipResponseInfo {
    pub seq: u32,
    pub status_code: Option<u16>,
    pub rtt_ms: Option<f64>,
}

/// Streamed per-packet event payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipProbePacketEvent {
    pub seq: u32,
    pub total: u32,
    pub method: String,
    pub status_code: Option<u16>,
    pub rtt_ms: Option<f64>,
    pub running_sent: u32,
    pub running_received: u32,
    pub running_loss_pct: f64,
    pub running_avg_rtt_ms: f64,
    pub running_jitter_ms: f64,
}

// ── SIP message builders ─────────────────────────────────────────

fn build_sip_options(
    target_host: &str, target_port: u16,
    local_ip: &str, local_port: u16,
    call_id: &str, cseq: u32, branch: &str,
) -> String {
    let effective_user_agent = user_agent::get_effective_user_agent();
    format!(
        "OPTIONS sip:{}:{} SIP/2.0\r\n\
         Via: SIP/2.0/UDP {}:{};branch={};rport\r\n\
         From: <sip:sipcheck@{}>;tag={}\r\n\
         To: <sip:{}:{}>\r\n\
         Call-ID: {}\r\n\
         CSeq: {} OPTIONS\r\n\
         Max-Forwards: 70\r\n\
         User-Agent: {}\r\n\
         Accept: application/sdp\r\n\
         Content-Length: 0\r\n\
         \r\n",
        target_host, target_port,
        local_ip, local_port, branch,
        local_ip, generate_tag(),
        target_host, target_port,
        call_id, cseq, effective_user_agent,
    )
}

fn build_sip_register(
    target_host: &str, _target_port: u16,
    local_ip: &str, local_port: u16,
    call_id: &str, cseq: u32, branch: &str,
) -> String {
    let effective_user_agent = user_agent::get_effective_user_agent();
    format!(
        "REGISTER sip:{} SIP/2.0\r\n\
         Via: SIP/2.0/UDP {}:{};branch={};rport\r\n\
         From: <sip:probe@{}>;tag={}\r\n\
         To: <sip:probe@{}>\r\n\
         Call-ID: {}\r\n\
         CSeq: {} REGISTER\r\n\
         Contact: <sip:probe@{}:{}>\r\n\
         Max-Forwards: 70\r\n\
         User-Agent: {}\r\n\
         Expires: 0\r\n\
         Content-Length: 0\r\n\
         \r\n",
        target_host,
        local_ip, local_port, branch,
        target_host, generate_tag(),
        target_host,
        call_id, cseq,
        local_ip, local_port, effective_user_agent,
    )
}

// ── Helpers ──────────────────────────────────────────────────────

fn pseudo_random() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos() as u64;
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut x = t.wrapping_add(c).wrapping_mul(6364136223846793005);
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x
}

fn generate_branch() -> String { format!("z9hG4bK{:08x}", pseudo_random() as u32) }
fn generate_tag() -> String { format!("{:08x}", pseudo_random() as u32) }
fn generate_call_id() -> String {
    format!("{:08x}{:08x}@sipalyzer", pseudo_random() as u32, pseudo_random() as u32)
}

fn parse_sip_status(response: &[u8]) -> Option<u16> {
    let text = std::str::from_utf8(response).ok()?;
    if text.starts_with("SIP/2.0 ") {
        let rest = &text[8..];
        let code_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        code_str.parse().ok()
    } else {
        None
    }
}

fn make_error_result(host: String, ip_str: String, port: u16, method: &str, err: String) -> SipProbeResult {
    SipProbeResult {
        host, resolved_ip: ip_str, port,
        method_used: method.to_string(),
        avg_latency_ms: 0.0, min_latency_ms: 0.0, max_latency_ms: 0.0, stddev_latency_ms: 0.0,
        probe_rtts: vec![], avg_jitter_ms: 0.0, max_jitter_ms: 0.0,
        packets_sent: 0, packets_received: 0, packet_loss_pct: 100.0,
        sip_responses: vec![],
        success: false, error: Some(err),
    }
}

fn compute_stats(probe_rtts: &[Option<f64>], sent: u32, received: u32) -> (f64, f64, f64, f64, f64, f64, f64) {
    let rtts: Vec<f64> = probe_rtts.iter().filter_map(|r| *r).collect();

    let (avg, min, max, stddev) = if !rtts.is_empty() {
        let sum: f64 = rtts.iter().sum();
        let avg = sum / rtts.len() as f64;
        let min = rtts.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = rtts.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let var = rtts.iter().map(|v| (v - avg).powi(2)).sum::<f64>() / rtts.len() as f64;
        (avg, min, max, var.sqrt())
    } else {
        (0.0, 0.0, 0.0, 0.0)
    };

    let (avg_jitter, max_jitter) = if rtts.len() >= 2 {
        let mut jsamples: Vec<f64> = Vec::new();
        for i in 1..rtts.len() { jsamples.push((rtts[i] - rtts[i - 1]).abs()); }
        let sum: f64 = jsamples.iter().sum();
        (sum / jsamples.len() as f64, jsamples.iter().cloned().fold(0.0f64, f64::max))
    } else {
        (0.0, 0.0)
    };

    let loss = if sent > 0 { ((sent - received) as f64 / sent as f64) * 100.0 } else { 100.0 };

    (avg, min, max, stddev, avg_jitter, max_jitter, loss)
}

// ── Auto-detect: try a method for N probes, return true if any responded ──

async fn try_method_udp(
    socket: &UdpSocket, dest: SocketAddr,
    host: &str, port: u16, local_ip: &str, local_port: u16,
    method: &ProbeMethod, timeout: Duration, attempts: u32,
) -> bool {
    let call_id = generate_call_id();
    for seq in 0..attempts {
        let branch = generate_branch();
        let request = match method {
            ProbeMethod::Options => build_sip_options(host, port, local_ip, local_port, &call_id, seq + 1, &branch),
            ProbeMethod::Register => build_sip_register(host, port, local_ip, local_port, &call_id, seq + 1, &branch),
            _ => unreachable!(),
        };
        if socket.send_to(request.as_bytes(), dest).await.is_ok() {
            let mut buf = [0u8; 4096];
            if tokio::time::timeout(timeout, socket.recv_from(&mut buf)).await.is_ok() {
                return true;
            }
        }
    }
    false
}

async fn try_method_tcp(dest: SocketAddr, timeout: Duration) -> bool {
    tokio::time::timeout(timeout, TcpStream::connect(dest)).await.is_ok()
}

// ── Single-probe executors ───────────────────────────────────────

/// Send one SIP UDP probe and return (status_code, rtt_ms).
async fn probe_sip_udp(
    socket: &UdpSocket, dest: SocketAddr,
    host: &str, port: u16, local_ip: &str, local_port: u16,
    method: &ProbeMethod, call_id: &str, cseq: u32, timeout: Duration,
) -> (Option<u16>, Option<f64>) {
    let branch = generate_branch();
    let request = match method {
        ProbeMethod::Options => build_sip_options(host, port, local_ip, local_port, call_id, cseq, &branch),
        ProbeMethod::Register => build_sip_register(host, port, local_ip, local_port, call_id, cseq, &branch),
        _ => unreachable!(),
    };

    let start = Instant::now();
    if socket.send_to(request.as_bytes(), dest).await.is_err() {
        return (None, None);
    }

    let mut buf = [0u8; 4096];
    match tokio::time::timeout(timeout, socket.recv_from(&mut buf)).await {
        Ok(Ok((len, _))) => {
            let rtt = start.elapsed().as_secs_f64() * 1000.0;
            let status = parse_sip_status(&buf[..len]);
            (status, Some(rtt))
        }
        _ => (None, None),
    }
}

/// Do one TCP connect probe and return rtt_ms.
async fn probe_tcp(dest: SocketAddr, timeout: Duration) -> Option<f64> {
    let start = Instant::now();
    match tokio::time::timeout(timeout, TcpStream::connect(dest)).await {
        Ok(Ok(_stream)) => {
            Some(start.elapsed().as_secs_f64() * 1000.0)
        }
        _ => None,
    }
}

// ── Main entry point ─────────────────────────────────────────────

pub async fn run_sip_probe(window: tauri::Window, config: SipProbeConfig) -> SipProbeResult {
    let ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => return make_error_result(config.host, String::new(), config.port, "auto", e),
    };

    let dest = SocketAddr::new(ip, config.port);
    let bind_addr: SocketAddr = if ip.is_ipv4() { "0.0.0.0:0".parse().unwrap() } else { "[::]:0".parse().unwrap() };
    let timeout = Duration::from_millis(config.timeout_ms);
    let interval = Duration::from_millis(config.interval_ms as u64);

    // ── Determine method ─────────────────────────────────────────
    let actual_method: ProbeMethod;

    if config.method == ProbeMethod::Auto {
        // Emit a "detecting" event so the UI knows what's happening
        let _ = window.emit("sip-probe-packet", SipProbePacketEvent {
            seq: 0, total: config.count, method: "auto-detect".to_string(),
            status_code: None, rtt_ms: None,
            running_sent: 0, running_received: 0,
            running_loss_pct: 0.0, running_avg_rtt_ms: 0.0, running_jitter_ms: 0.0,
        });

        let socket = match UdpSocket::bind(bind_addr).await {
            Ok(s) => s,
            Err(e) => return make_error_result(config.host, ip.to_string(), config.port, "auto", format!("Failed to bind socket: {}", e)),
        };

        // Try OPTIONS (3 probes)
        if try_method_udp(&socket, dest, &config.host, config.port,
            &socket.local_addr().unwrap().ip().to_string(),
            socket.local_addr().unwrap().port(),
            &ProbeMethod::Options, timeout, 3).await
        {
            actual_method = ProbeMethod::Options;
        }
        // Try REGISTER (3 probes)
        else if try_method_udp(&socket, dest, &config.host, config.port,
            &socket.local_addr().unwrap().ip().to_string(),
            socket.local_addr().unwrap().port(),
            &ProbeMethod::Register, timeout, 3).await
        {
            actual_method = ProbeMethod::Register;
        }
        // Try TCP connect
        else if try_method_tcp(dest, timeout).await {
            actual_method = ProbeMethod::Tcp;
        }
        // Nothing works — still run OPTIONS so user sees the timeouts
        else {
            actual_method = ProbeMethod::Options;
        }
    } else {
        actual_method = config.method.clone();
    }

    let method_str = match actual_method {
        ProbeMethod::Options => "options",
        ProbeMethod::Register => "register",
        ProbeMethod::Tcp => "tcp",
        ProbeMethod::Auto => "options", // shouldn't happen
    };

    // ── Run the probes ───────────────────────────────────────────

    if actual_method == ProbeMethod::Tcp {
        run_tcp_probes(&window, &config, dest, timeout, interval, method_str, ip).await
    } else {
        run_sip_udp_probes(&window, &config, dest, bind_addr, timeout, interval, &actual_method, method_str, ip).await
    }
}

async fn run_sip_udp_probes(
    window: &tauri::Window, config: &SipProbeConfig,
    dest: SocketAddr, bind_addr: SocketAddr,
    timeout: Duration, interval: Duration,
    method: &ProbeMethod, method_str: &str, ip: IpAddr,
) -> SipProbeResult {
    let socket = match UdpSocket::bind(bind_addr).await {
        Ok(s) => s,
        Err(e) => return make_error_result(config.host.clone(), ip.to_string(), config.port, method_str, format!("Failed to bind socket: {}", e)),
    };

    let local_addr = socket.local_addr().unwrap();
    let local_ip = local_addr.ip().to_string();
    let local_port = local_addr.port();
    let call_id = generate_call_id();

    let mut probe_rtts: Vec<Option<f64>> = Vec::with_capacity(config.count as usize);
    let mut sip_responses: Vec<SipResponseInfo> = Vec::with_capacity(config.count as usize);
    let mut sent = 0u32;
    let mut received = 0u32;
    let mut rtt_sum = 0.0f64;
    let mut last_rtt: Option<f64> = None;
    let mut jitter_sum = 0.0f64;
    let mut jitter_count = 0u32;

    for seq in 0..config.count {
        let (status_code, rtt_ms) = probe_sip_udp(
            &socket, dest, &config.host, config.port,
            &local_ip, local_port, method, &call_id, seq + 1, timeout,
        ).await;

        sent += 1;
        if let Some(rtt) = rtt_ms {
            received += 1;
            rtt_sum += rtt;
            if let Some(prev) = last_rtt {
                jitter_sum += (rtt - prev).abs();
                jitter_count += 1;
            }
            last_rtt = Some(rtt);
        }

        probe_rtts.push(rtt_ms);
        sip_responses.push(SipResponseInfo { seq, status_code, rtt_ms });

        // Emit live event
        let running_loss = if sent > 0 { ((sent - received) as f64 / sent as f64) * 100.0 } else { 100.0 };
        let running_avg = if received > 0 { rtt_sum / received as f64 } else { 0.0 };
        let running_jitter = if jitter_count > 0 { jitter_sum / jitter_count as f64 } else { 0.0 };

        let _ = window.emit("sip-probe-packet", SipProbePacketEvent {
            seq, total: config.count, method: method_str.to_string(),
            status_code, rtt_ms,
            running_sent: sent, running_received: received,
            running_loss_pct: running_loss, running_avg_rtt_ms: running_avg,
            running_jitter_ms: running_jitter,
        });

        if seq + 1 < config.count {
            tokio::time::sleep(interval).await;
        }
    }

    let (avg, min, max, stddev, avg_jitter, max_jitter, loss) = compute_stats(&probe_rtts, sent, received);

    SipProbeResult {
        host: config.host.clone(), resolved_ip: ip.to_string(), port: config.port,
        method_used: method_str.to_string(),
        avg_latency_ms: avg, min_latency_ms: min, max_latency_ms: max, stddev_latency_ms: stddev,
        probe_rtts, avg_jitter_ms: avg_jitter, max_jitter_ms: max_jitter,
        packets_sent: sent, packets_received: received, packet_loss_pct: loss,
        sip_responses,
        success: received > 0, error: None,
    }
}

async fn run_tcp_probes(
    window: &tauri::Window, config: &SipProbeConfig,
    dest: SocketAddr, timeout: Duration, interval: Duration,
    method_str: &str, ip: IpAddr,
) -> SipProbeResult {
    let mut probe_rtts: Vec<Option<f64>> = Vec::with_capacity(config.count as usize);
    let mut sip_responses: Vec<SipResponseInfo> = Vec::with_capacity(config.count as usize);
    let mut sent = 0u32;
    let mut received = 0u32;
    let mut rtt_sum = 0.0f64;
    let mut last_rtt: Option<f64> = None;
    let mut jitter_sum = 0.0f64;
    let mut jitter_count = 0u32;

    for seq in 0..config.count {
        sent += 1;
        let rtt_ms = probe_tcp(dest, timeout).await;

        if let Some(rtt) = rtt_ms {
            received += 1;
            rtt_sum += rtt;
            if let Some(prev) = last_rtt {
                jitter_sum += (rtt - prev).abs();
                jitter_count += 1;
            }
            last_rtt = Some(rtt);
        }

        probe_rtts.push(rtt_ms);
        // For TCP, status_code conveys "connected" as a pseudo-code
        sip_responses.push(SipResponseInfo {
            seq,
            status_code: if rtt_ms.is_some() { Some(0) } else { None },
            rtt_ms,
        });

        let running_loss = if sent > 0 { ((sent - received) as f64 / sent as f64) * 100.0 } else { 100.0 };
        let running_avg = if received > 0 { rtt_sum / received as f64 } else { 0.0 };
        let running_jitter = if jitter_count > 0 { jitter_sum / jitter_count as f64 } else { 0.0 };

        let _ = window.emit("sip-probe-packet", SipProbePacketEvent {
            seq, total: config.count, method: method_str.to_string(),
            status_code: if rtt_ms.is_some() { Some(0) } else { None },
            rtt_ms,
            running_sent: sent, running_received: received,
            running_loss_pct: running_loss, running_avg_rtt_ms: running_avg,
            running_jitter_ms: running_jitter,
        });

        if seq + 1 < config.count {
            tokio::time::sleep(interval).await;
        }
    }

    let (avg, min, max, stddev, avg_jitter, max_jitter, loss) = compute_stats(&probe_rtts, sent, received);

    SipProbeResult {
        host: config.host.clone(), resolved_ip: ip.to_string(), port: config.port,
        method_used: method_str.to_string(),
        avg_latency_ms: avg, min_latency_ms: min, max_latency_ms: max, stddev_latency_ms: stddev,
        probe_rtts, avg_jitter_ms: avg_jitter, max_jitter_ms: max_jitter,
        packets_sent: sent, packets_received: received, packet_loss_pct: loss,
        sip_responses,
        success: received > 0, error: None,
    }
}
