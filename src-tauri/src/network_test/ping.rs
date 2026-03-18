use serde::{Deserialize, Serialize};
use std::net::{IpAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

static PING_CANCELLED: AtomicBool = AtomicBool::new(false);

pub fn cancel_ping() {
    PING_CANCELLED.store(true, Ordering::SeqCst);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingConfig {
    pub host: String,
    pub count: u32,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub host: String,
    pub resolved_ip: String,
    pub probes: Vec<ProbeResult>,
    pub min_ms: f64,
    pub max_ms: f64,
    pub avg_ms: f64,
    pub stddev_ms: f64,
    pub packet_loss_pct: f64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    pub seq: u32,
    pub rtt_ms: Option<f64>,
    pub success: bool,
}

impl Default for PingConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            count: 10,
            timeout_ms: 2000,
        }
    }
}

/// Strip an optional `:port` suffix from a host string.
/// Handles plain hostnames, IPv4, and bracketed IPv6 `[::1]:port`.
pub fn strip_port(host: &str) -> &str {
    let h = host.trim();
    // Bracketed IPv6 like [::1]:5060 → [::1]
    if h.starts_with('[') {
        if let Some(bracket) = h.find(']') {
            return &h[..bracket + 1];
        }
        return h;
    }
    // Only strip if exactly one colon (IPv6 literals have multiple)
    if h.matches(':').count() == 1 {
        if let Some(idx) = h.rfind(':') {
            // Verify the part after the colon looks like a port number
            let maybe_port = &h[idx + 1..];
            if maybe_port.chars().all(|c| c.is_ascii_digit()) && !maybe_port.is_empty() {
                return &h[..idx];
            }
        }
    }
    h
}

/// Extract the optional port from a `host:port` string.
pub fn extract_port(host: &str) -> Option<u16> {
    let h = host.trim();
    if h.starts_with('[') {
        // [::1]:5060
        if let Some(bracket) = h.find(']') {
            let rest = &h[bracket + 1..];
            if let Some(colon) = rest.strip_prefix(':') {
                return colon.parse().ok();
            }
        }
        return None;
    }
    if h.matches(':').count() == 1 {
        if let Some(idx) = h.rfind(':') {
            return h[idx + 1..].parse().ok();
        }
    }
    None
}

pub fn resolve_host(host: &str) -> Result<IpAddr, String> {
    // Strip any :port suffix so "sip.example.com:6070" resolves correctly
    let clean = strip_port(host);

    // Try parsing as IP first
    // Handle bracketed IPv6 like [::1]
    let ip_str = clean.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = ip_str.parse::<IpAddr>() {
        return Ok(ip);
    }
    // DNS resolution
    let addr = format!("{}:0", clean);
    addr.to_socket_addrs()
        .map_err(|e| format!("Failed to resolve {}: {}", clean, e))?
        .next()
        .map(|a| a.ip())
        .ok_or_else(|| format!("No addresses found for {}", clean))
}

/// UDP-based latency measurement (works without elevated privileges).
/// Sends a UDP packet to a high port and measures the ICMP unreachable response time,
/// or falls back to measuring the send/timeout cycle.
#[tracing::instrument(skip_all, fields(host = %config.host))]
pub async fn run_ping(config: PingConfig) -> PingResult {
    PING_CANCELLED.store(false, Ordering::SeqCst);
    let ip = match resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return PingResult {
                host: config.host,
                resolved_ip: String::new(),
                probes: vec![],
                min_ms: 0.0,
                max_ms: 0.0,
                avg_ms: 0.0,
                stddev_ms: 0.0,
                packet_loss_pct: 100.0,
                success: false,
                error: Some(e),
            };
        }
    };

    // Try ICMP ping first via surge_ping
    let result = match run_icmp_ping(ip, config.count, config.timeout_ms).await {
        Ok(result) => result,
        Err(_) => {
            // Fall back to UDP-based latency estimation
            run_udp_ping(ip, &config).await
        }
    };
    result
}

async fn run_icmp_ping(ip: IpAddr, count: u32, timeout_ms: u64) -> Result<PingResult, String> {
    use surge_ping::{Client, Config, PingIdentifier, PingSequence, ICMP};

    let config_builder = Config::builder();
    let config = match ip {
        IpAddr::V4(_) => config_builder.kind(ICMP::V4).build(),
        IpAddr::V6(_) => config_builder.kind(ICMP::V6).build(),
    };

    let client = Client::new(&config).map_err(|e| format!("ICMP client error: {}", e))?;
    let mut pinger = client
        .pinger(ip, PingIdentifier(rand_id()))
        .await;
    pinger.timeout(Duration::from_millis(timeout_ms));

    let payload = vec![0u8; 56];
    let mut probes = Vec::with_capacity(count as usize);
    let mut rtts = Vec::new();
    let mut cancelled = false;

    for seq in 0..count {
        if PING_CANCELLED.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        match pinger.ping(PingSequence(seq as u16), &payload).await {
            Ok((_packet, dur)) => {
                let rtt = dur.as_secs_f64() * 1000.0;
                rtts.push(rtt);
                probes.push(ProbeResult {
                    seq,
                    rtt_ms: Some(rtt),
                    success: true,
                });
            }
            Err(_) => {
                probes.push(ProbeResult {
                    seq,
                    rtt_ms: None,
                    success: false,
                });
            }
        }
        // Small delay between probes
        if seq + 1 < count {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    let (min, max, avg, stddev) = compute_stats(&rtts);
    let loss = if count > 0 {
        ((count as usize - rtts.len()) as f64 / count as f64) * 100.0
    } else {
        100.0
    };

    Ok(PingResult {
        host: ip.to_string(),
        resolved_ip: ip.to_string(),
        probes,
        min_ms: min,
        max_ms: max,
        avg_ms: avg,
        stddev_ms: stddev,
        packet_loss_pct: loss,
        success: !rtts.is_empty(),
        error: if cancelled { Some("Cancelled by user".to_string()) } else { None },
    })
}

async fn run_udp_ping(ip: IpAddr, config: &PingConfig) -> PingResult {
    let mut probes = Vec::with_capacity(config.count as usize);
    let mut rtts = Vec::new();
    let mut cancelled = false;

    for seq in 0..config.count {
        if PING_CANCELLED.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let dest = std::net::SocketAddr::new(ip, 33434 + (seq as u16 % 30));
        let bind_addr: std::net::SocketAddr = if ip.is_ipv4() {
            "0.0.0.0:0".parse().unwrap()
        } else {
            "[::]:0".parse().unwrap()
        };

        match UdpSocket::bind(bind_addr).await {
            Ok(socket) => {
                let start = Instant::now();
                let _ = socket.send_to(&[0u8; 32], dest).await;
                // Wait for ICMP unreachable or timeout
                let mut buf = [0u8; 64];
                let timeout = Duration::from_millis(config.timeout_ms);
                match tokio::time::timeout(timeout, socket.recv_from(&mut buf)).await {
                    Ok(Ok(_)) => {
                        let rtt = start.elapsed().as_secs_f64() * 1000.0;
                        rtts.push(rtt);
                        probes.push(ProbeResult { seq, rtt_ms: Some(rtt), success: true });
                    }
                    _ => {
                        // Use send time as upper bound estimate
                        let rtt = start.elapsed().as_secs_f64() * 1000.0;
                        if rtt < config.timeout_ms as f64 {
                            rtts.push(rtt);
                            probes.push(ProbeResult { seq, rtt_ms: Some(rtt), success: true });
                        } else {
                            probes.push(ProbeResult { seq, rtt_ms: None, success: false });
                        }
                    }
                }
            }
            Err(_) => {
                probes.push(ProbeResult { seq, rtt_ms: None, success: false });
            }
        }

        if seq + 1 < config.count {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    let (min, max, avg, stddev) = compute_stats(&rtts);
    let loss = if config.count > 0 {
        ((config.count as usize - rtts.len()) as f64 / config.count as f64) * 100.0
    } else {
        100.0
    };

    PingResult {
        host: config.host.clone(),
        resolved_ip: ip.to_string(),
        probes,
        min_ms: min,
        max_ms: max,
        avg_ms: avg,
        stddev_ms: stddev,
        packet_loss_pct: loss,
        success: !rtts.is_empty(),
        error: if cancelled { Some("Cancelled by user".to_string()) } else { None },
    }
}

fn compute_stats(values: &[f64]) -> (f64, f64, f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let sum: f64 = values.iter().sum();
    let avg = sum / values.len() as f64;
    let variance = values.iter().map(|v| (v - avg).powi(2)).sum::<f64>() / values.len() as f64;
    let stddev = variance.sqrt();
    (min, max, avg, stddev)
}

fn rand_id() -> u16 {
    use std::time::SystemTime;
    (SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos()
        & 0xFFFF) as u16
}
