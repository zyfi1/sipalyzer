//! STUN-based VoIP quality probe.
//!
//! Measures real UDP path quality by sending STUN Binding Requests at VoIP
//! packet rates (e.g., 20ms intervals = 50 pps, matching G.711 RTP).
//!
//! Unlike SIP probes, STUN servers are:
//! - Publicly accessible and designed for VoIP
//! - Highly reliable (Google, Twilio, Cloudflare, etc.)
//! - Not blocked by SBCs/firewalls that drop SIP traffic
//! - Represent the real UDP path quality a VoIP call would experience
//!
//! Metrics collected:
//! - RTT (latency proxy for one-way delay)
//! - Jitter (RFC 3550 style)
//! - Packet loss
//! - MOS score (ITU-T G.107 E-model)

use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, ToSocketAddrs};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::net::UdpSocket;

use super::mos::{calculate_mos, MosInput};

// ── STUN protocol constants ──────────────────────────────────────

const STUN_BINDING_REQUEST: u16 = 0x0001;
const STUN_MAGIC_COOKIE: u32 = 0x2112A442;
// STUN header is exactly 20 bytes: type(2) + length(2) + magic(4) + txn_id(12)
const STUN_HEADER_SIZE: usize = 20;

// ── Types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunQualityConfig {
    /// STUN server hostname (e.g. "stun.l.google.com")
    pub server: String,
    /// STUN server port (default 19302 for Google)
    pub port: u16,
    /// Total number of probes to send
    pub count: u32,
    /// Interval between probes in milliseconds (20 = G.711 rate, 30 = G.729 rate)
    pub interval_ms: u32,
    /// Timeout per probe in milliseconds
    pub timeout_ms: u64,
}

impl Default for StunQualityConfig {
    fn default() -> Self {
        Self {
            server: "stun.l.google.com".to_string(),
            port: 19302,
            count: 100,     // 2 seconds at 50pps
            interval_ms: 20, // G.711 RTP rate
            timeout_ms: 2000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunQualityResult {
    pub server: String,
    pub resolved_ip: String,
    pub port: u16,

    // Latency
    pub avg_rtt_ms: f64,
    pub min_rtt_ms: f64,
    pub max_rtt_ms: f64,
    pub stddev_rtt_ms: f64,

    // Jitter (RFC 3550 interarrival)
    pub avg_jitter_ms: f64,
    pub max_jitter_ms: f64,

    // Packet loss
    pub packets_sent: u32,
    pub packets_received: u32,
    pub packet_loss_pct: f64,

    // MOS (E-model)
    pub mos: f64,
    pub r_factor: f64,
    pub quality: String,

    // Per-probe RTTs for charting
    pub probe_rtts: Vec<Option<f64>>,

    pub success: bool,
    pub error: Option<String>,
}

/// Streamed per-packet event for live UI updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunQualityPacketEvent {
    pub seq: u32,
    pub total: u32,
    pub rtt_ms: Option<f64>,
    pub running_sent: u32,
    pub running_received: u32,
    pub running_loss_pct: f64,
    pub running_avg_rtt_ms: f64,
    pub running_jitter_ms: f64,
    pub running_mos: f64,
}

// ── STUN packet construction ─────────────────────────────────────

fn build_stun_binding_request(txn_id: &[u8; 12]) -> [u8; STUN_HEADER_SIZE] {
    let mut pkt = [0u8; STUN_HEADER_SIZE];
    // Message Type: Binding Request (0x0001)
    pkt[0] = (STUN_BINDING_REQUEST >> 8) as u8;
    pkt[1] = (STUN_BINDING_REQUEST & 0xFF) as u8;
    // Message Length: 0 (no attributes)
    pkt[2] = 0;
    pkt[3] = 0;
    // Magic Cookie
    pkt[4] = (STUN_MAGIC_COOKIE >> 24) as u8;
    pkt[5] = (STUN_MAGIC_COOKIE >> 16) as u8;
    pkt[6] = (STUN_MAGIC_COOKIE >> 8) as u8;
    pkt[7] = (STUN_MAGIC_COOKIE & 0xFF) as u8;
    // Transaction ID (12 bytes)
    pkt[8..20].copy_from_slice(txn_id);
    pkt
}

fn is_stun_response(data: &[u8], expected_txn_id: &[u8; 12]) -> bool {
    if data.len() < STUN_HEADER_SIZE {
        return false;
    }
    // Check message type: Binding Success Response = 0x0101
    let msg_type = ((data[0] as u16) << 8) | data[1] as u16;
    if msg_type != 0x0101 {
        return false;
    }
    // Check magic cookie
    let cookie = ((data[4] as u32) << 24) | ((data[5] as u32) << 16) | ((data[6] as u32) << 8) | data[7] as u32;
    if cookie != STUN_MAGIC_COOKIE {
        return false;
    }
    // Check transaction ID matches
    data[8..20] == expected_txn_id[..]
}

fn generate_txn_id() -> [u8; 12] {
    let mut id = [0u8; 12];
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos() as u64;
    use std::sync::atomic::{AtomicU64, Ordering};
    static CTR: AtomicU64 = AtomicU64::new(0);
    let c = CTR.fetch_add(1, Ordering::Relaxed);
    let mut x = t.wrapping_add(c).wrapping_mul(6364136223846793005);
    for chunk in id.chunks_mut(4) {
        x ^= x >> 33;
        x = x.wrapping_mul(0xff51afd7ed558ccd);
        let bytes = (x as u32).to_be_bytes();
        let len = chunk.len().min(4);
        chunk[..len].copy_from_slice(&bytes[..len]);
    }
    id
}

fn resolve_stun_server(server: &str, port: u16) -> Result<SocketAddr, String> {
    let addr_str = format!("{}:{}", server, port);
    addr_str
        .to_socket_addrs()
        .map_err(|e| format!("Failed to resolve {}: {}", server, e))?
        .next()
        .ok_or_else(|| format!("No addresses found for {}", server))
}

// ── Main entry point ─────────────────────────────────────────────

pub async fn run_stun_quality_probe(
    window: tauri::Window,
    config: StunQualityConfig,
) -> StunQualityResult {
    // Resolve server
    let dest = match resolve_stun_server(&config.server, config.port) {
        Ok(addr) => addr,
        Err(e) => {
            return StunQualityResult {
                server: config.server, resolved_ip: String::new(), port: config.port,
                avg_rtt_ms: 0.0, min_rtt_ms: 0.0, max_rtt_ms: 0.0, stddev_rtt_ms: 0.0,
                avg_jitter_ms: 0.0, max_jitter_ms: 0.0,
                packets_sent: 0, packets_received: 0, packet_loss_pct: 100.0,
                mos: 1.0, r_factor: 0.0, quality: "Failed".into(),
                probe_rtts: vec![], success: false, error: Some(e),
            };
        }
    };

    let ip_str = dest.ip().to_string();
    let bind_addr: SocketAddr = if dest.is_ipv4() {
        "0.0.0.0:0".parse().unwrap()
    } else {
        "[::]:0".parse().unwrap()
    };

    let socket = match UdpSocket::bind(bind_addr).await {
        Ok(s) => s,
        Err(e) => {
            return StunQualityResult {
                server: config.server, resolved_ip: ip_str, port: config.port,
                avg_rtt_ms: 0.0, min_rtt_ms: 0.0, max_rtt_ms: 0.0, stddev_rtt_ms: 0.0,
                avg_jitter_ms: 0.0, max_jitter_ms: 0.0,
                packets_sent: 0, packets_received: 0, packet_loss_pct: 100.0,
                mos: 1.0, r_factor: 0.0, quality: "Failed".into(),
                probe_rtts: vec![], success: false, error: Some(format!("Bind error: {}", e)),
            };
        }
    };

    let timeout = Duration::from_millis(config.timeout_ms);
    let interval = Duration::from_millis(config.interval_ms as u64);

    let mut probe_rtts: Vec<Option<f64>> = Vec::with_capacity(config.count as usize);
    let mut sent = 0u32;
    let mut received = 0u32;
    let mut rtt_sum = 0.0f64;
    let mut last_rtt: Option<f64> = None;
    let mut jitter_sum = 0.0f64;
    let mut jitter_count = 0u32;

    for seq in 0..config.count {
        let txn_id = generate_txn_id();
        let pkt = build_stun_binding_request(&txn_id);

        sent += 1;
        let start = Instant::now();

        let rtt_ms = if socket.send_to(&pkt, dest).await.is_ok() {
            let mut buf = [0u8; 512];
            match tokio::time::timeout(timeout, socket.recv_from(&mut buf)).await {
                Ok(Ok((len, _))) if is_stun_response(&buf[..len], &txn_id) => {
                    Some(start.elapsed().as_secs_f64() * 1000.0)
                }
                _ => None,
            }
        } else {
            None
        };

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

        // Running stats for live event
        let running_loss = if sent > 0 { ((sent - received) as f64 / sent as f64) * 100.0 } else { 100.0 };
        let running_avg = if received > 0 { rtt_sum / received as f64 } else { 0.0 };
        let running_jitter = if jitter_count > 0 { jitter_sum / jitter_count as f64 } else { 0.0 };

        // Running MOS
        let running_mos = calculate_mos(MosInput {
            latency_ms: running_avg,
            jitter_ms: running_jitter,
            packet_loss_pct: running_loss,
            codec_ie: None,
        }).mos;

        let _ = window.emit("stun-quality-packet", StunQualityPacketEvent {
            seq, total: config.count, rtt_ms,
            running_sent: sent, running_received: received,
            running_loss_pct: running_loss, running_avg_rtt_ms: running_avg,
            running_jitter_ms: running_jitter, running_mos,
        });

        if seq + 1 < config.count {
            tokio::time::sleep(interval).await;
        }
    }

    // Final stats
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
        let mut js: Vec<f64> = Vec::new();
        for i in 1..rtts.len() { js.push((rtts[i] - rtts[i - 1]).abs()); }
        let sum: f64 = js.iter().sum();
        (sum / js.len() as f64, js.iter().cloned().fold(0.0f64, f64::max))
    } else {
        (0.0, 0.0)
    };

    let loss = if sent > 0 { ((sent - received) as f64 / sent as f64) * 100.0 } else { 100.0 };

    let mos_result = calculate_mos(MosInput {
        latency_ms: avg,
        jitter_ms: avg_jitter,
        packet_loss_pct: loss,
        codec_ie: None,
    });

    StunQualityResult {
        server: config.server,
        resolved_ip: ip_str,
        port: config.port,
        avg_rtt_ms: avg,
        min_rtt_ms: min,
        max_rtt_ms: max,
        stddev_rtt_ms: stddev,
        avg_jitter_ms: avg_jitter,
        max_jitter_ms: max_jitter,
        packets_sent: sent,
        packets_received: received,
        packet_loss_pct: loss,
        mos: mos_result.mos,
        r_factor: mos_result.r_factor,
        quality: mos_result.quality,
        probe_rtts,
        success: received > 0,
        error: None,
    }
}
