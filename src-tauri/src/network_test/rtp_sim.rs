use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RtpSimConfig {
    pub host: String,
    pub port: u16,
    /// Packet time in ms (e.g., 20 for G.711 20ms frames)
    pub ptime_ms: u32,
    /// Duration of simulation in seconds
    pub duration_secs: u32,
    /// Codec name for display
    pub codec: String,
    /// Payload size in bytes per packet
    pub payload_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RtpSimResult {
    pub host: String,
    pub codec: String,
    pub packets_sent: u32,
    pub packets_received: u32,
    pub packet_loss_pct: f64,
    pub avg_jitter_ms: f64,
    pub max_jitter_ms: f64,
    pub avg_latency_ms: f64,
    pub mos_estimate: f64,
    pub duration_ms: f64,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for RtpSimConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 5060,
            ptime_ms: 20,
            duration_secs: 10,
            codec: "G.711".into(),
            payload_size: 160, // G.711 20ms = 160 bytes
        }
    }
}

/// Simulates an RTP stream by sending UDP packets at regular intervals
/// mimicking real VoIP media traffic, then measures quality metrics.
pub async fn run_rtp_simulation(config: RtpSimConfig) -> RtpSimResult {
    let ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return RtpSimResult {
                host: config.host,
                codec: config.codec,
                packets_sent: 0,
                packets_received: 0,
                packet_loss_pct: 100.0,
                avg_jitter_ms: 0.0,
                max_jitter_ms: 0.0,
                avg_latency_ms: 0.0,
                mos_estimate: 1.0,
                duration_ms: 0.0,
                success: false,
                error: Some(e),
            };
        }
    };

    let dest = SocketAddr::new(ip, config.port);
    let bind: SocketAddr = if ip.is_ipv4() {
        "0.0.0.0:0".parse().unwrap()
    } else {
        "[::]:0".parse().unwrap()
    };

    let socket = match UdpSocket::bind(bind).await {
        Ok(s) => s,
        Err(e) => {
            return RtpSimResult {
                host: config.host,
                codec: config.codec,
                packets_sent: 0,
                packets_received: 0,
                packet_loss_pct: 100.0,
                avg_jitter_ms: 0.0,
                max_jitter_ms: 0.0,
                avg_latency_ms: 0.0,
                mos_estimate: 1.0,
                duration_ms: 0.0,
                success: false,
                error: Some(format!("Bind error: {}", e)),
            };
        }
    };

    let ptime = Duration::from_millis(config.ptime_ms as u64);
    let total_packets = (config.duration_secs as u64 * 1000) / config.ptime_ms as u64;
    let mut rtts: Vec<f64> = Vec::new();

    let start = Instant::now();

    // Build a fake RTP header + payload
    let rtp_header_size = 12;
    let packet_size = rtp_header_size + config.payload_size;
    let mut packet = vec![0u8; packet_size];
    // RTP version 2, no padding, no extension, no CSRC
    packet[0] = 0x80;
    // Payload type 0 (PCMU) or 8 (PCMA)
    packet[1] = 0x00;

    let mut seq: u16 = 0;
    let mut timestamp: u32 = 0;
    let ssrc: u32 = 0x12345678;
    packet[8..12].copy_from_slice(&ssrc.to_be_bytes());

    for _ in 0..total_packets {
        // Update RTP header
        packet[2..4].copy_from_slice(&seq.to_be_bytes());
        packet[4..8].copy_from_slice(&timestamp.to_be_bytes());

        let probe_start = Instant::now();
        if socket.send_to(&packet, dest).await.is_ok() {
            // Try to get a response
            let mut buf = [0u8; 512];
            if let Ok(Ok(_)) = tokio::time::timeout(
                Duration::from_millis(config.ptime_ms as u64 * 2),
                socket.recv_from(&mut buf),
            )
            .await
            {
                let rtt = probe_start.elapsed().as_secs_f64() * 1000.0;
                rtts.push(rtt);
            }
        }

        seq = seq.wrapping_add(1);
        timestamp = timestamp.wrapping_add(config.payload_size as u32);

        // Wait for next packet interval
        let elapsed = probe_start.elapsed();
        if elapsed < ptime {
            tokio::time::sleep(ptime - elapsed).await;
        }
    }

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let packets_sent = total_packets as u32;
    let packets_received = rtts.len() as u32;
    let loss_pct = if packets_sent > 0 {
        ((packets_sent - packets_received) as f64 / packets_sent as f64) * 100.0
    } else {
        100.0
    };

    // Calculate jitter from RTT variations
    let mut jitter_values = Vec::new();
    if rtts.len() >= 2 {
        for i in 1..rtts.len() {
            jitter_values.push((rtts[i] - rtts[i - 1]).abs());
        }
    }

    let avg_jitter = if !jitter_values.is_empty() {
        jitter_values.iter().sum::<f64>() / jitter_values.len() as f64
    } else {
        0.0
    };
    let max_jitter = jitter_values.iter().cloned().fold(0.0f64, f64::max);
    let avg_latency = if !rtts.is_empty() {
        rtts.iter().sum::<f64>() / rtts.len() as f64
    } else {
        0.0
    };

    // Estimate MOS
    let mos_input = crate::network_test::mos::MosInput {
        latency_ms: avg_latency,
        jitter_ms: avg_jitter,
        packet_loss_pct: loss_pct,
        codec_ie: None,
    };
    let mos_result = crate::network_test::mos::calculate_mos(mos_input);

    RtpSimResult {
        host: config.host,
        codec: config.codec,
        packets_sent,
        packets_received,
        packet_loss_pct: loss_pct,
        avg_jitter_ms: avg_jitter,
        max_jitter_ms: max_jitter,
        avg_latency_ms: avg_latency,
        mos_estimate: mos_result.mos,
        duration_ms: elapsed_ms,
        success: true,
        error: None,
    }
}
