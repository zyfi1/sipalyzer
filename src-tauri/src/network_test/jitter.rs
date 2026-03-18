use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JitterConfig {
    pub host: String,
    pub port: u16,
    pub packet_count: u32,
    pub interval_ms: u32,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JitterResult {
    pub host: String,
    pub avg_jitter_ms: f64,
    pub max_jitter_ms: f64,
    pub min_jitter_ms: f64,
    pub stddev_jitter_ms: f64,
    pub packets_sent: u32,
    pub packets_received: u32,
    pub packet_loss_pct: f64,
    /// Individual inter-arrival deltas for charting
    pub jitter_samples: Vec<f64>,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for JitterConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 5060,
            packet_count: 100,
            interval_ms: 20, // 20ms = typical RTP ptime
            timeout_ms: 2000,
        }
    }
}

/// Measures jitter using a UDP echo-like approach.
/// Sends packets at regular intervals and measures inter-arrival time variation (RFC 3550 algorithm).
#[tracing::instrument(skip_all, fields(host = %config.host))]
pub async fn run_jitter_test(config: JitterConfig) -> JitterResult {
    let ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return JitterResult {
                host: config.host,
                avg_jitter_ms: 0.0,
                max_jitter_ms: 0.0,
                min_jitter_ms: 0.0,
                stddev_jitter_ms: 0.0,
                packets_sent: 0,
                packets_received: 0,
                packet_loss_pct: 100.0,
                jitter_samples: vec![],
                success: false,
                error: Some(e),
            };
        }
    };

    let dest = SocketAddr::new(ip, config.port);
    let bind_addr: SocketAddr = if ip.is_ipv4() {
        "0.0.0.0:0".parse().unwrap()
    } else {
        "[::]:0".parse().unwrap()
    };

    let socket = match UdpSocket::bind(bind_addr).await {
        Ok(s) => s,
        Err(e) => {
            return JitterResult {
                host: config.host,
                avg_jitter_ms: 0.0,
                max_jitter_ms: 0.0,
                min_jitter_ms: 0.0,
                stddev_jitter_ms: 0.0,
                packets_sent: 0,
                packets_received: 0,
                packet_loss_pct: 100.0,
                jitter_samples: vec![],
                success: false,
                error: Some(format!("Failed to bind socket: {}", e)),
            };
        }
    };

    let interval = Duration::from_millis(config.interval_ms as u64);
    let mut send_times: Vec<Instant> = Vec::with_capacity(config.packet_count as usize);
    let mut rtts: Vec<f64> = Vec::new();

    // Send packets and measure round-trip times
    for seq in 0..config.packet_count {
        let payload = seq.to_be_bytes();
        let start = Instant::now();
        send_times.push(start);

        if socket.send_to(&payload, dest).await.is_ok() {
            let mut buf = [0u8; 128];
            let timeout = Duration::from_millis(config.timeout_ms);
            if let Ok(Ok(_)) = tokio::time::timeout(timeout, socket.recv_from(&mut buf)).await {
                let rtt = start.elapsed().as_secs_f64() * 1000.0;
                rtts.push(rtt);
            }
        }

        if seq + 1 < config.packet_count {
            tokio::time::sleep(interval).await;
        }
    }

    // Calculate jitter using RFC 3550 algorithm (variation in consecutive transit times)
    let mut jitter_samples: Vec<f64> = Vec::new();
    if rtts.len() >= 2 {
        for i in 1..rtts.len() {
            let delta = (rtts[i] - rtts[i - 1]).abs();
            jitter_samples.push(delta);
        }
    }

    let (avg_jitter, max_jitter, min_jitter, stddev) = if !jitter_samples.is_empty() {
        let min = jitter_samples.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = jitter_samples.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let sum: f64 = jitter_samples.iter().sum();
        let avg = sum / jitter_samples.len() as f64;
        let var = jitter_samples.iter().map(|v| (v - avg).powi(2)).sum::<f64>() / jitter_samples.len() as f64;
        (avg, max, min, var.sqrt())
    } else {
        (0.0, 0.0, 0.0, 0.0)
    };

    let packets_received = rtts.len() as u32;
    let loss = if config.packet_count > 0 {
        ((config.packet_count - packets_received) as f64 / config.packet_count as f64) * 100.0
    } else {
        100.0
    };

    let result = JitterResult {
        host: config.host,
        avg_jitter_ms: avg_jitter,
        max_jitter_ms: max_jitter,
        min_jitter_ms: min_jitter,
        stddev_jitter_ms: stddev,
        packets_sent: config.packet_count,
        packets_received,
        packet_loss_pct: loss,
        jitter_samples,
        success: packets_received > 0,
        error: None,
    };
    result
}
