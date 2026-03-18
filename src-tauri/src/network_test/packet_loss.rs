use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::net::UdpSocket;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketLossConfig {
    pub host: String,
    pub port: u16,
    pub burst_size: u32,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketLossResult {
    pub host: String,
    pub packets_sent: u32,
    pub packets_received: u32,
    pub loss_pct: f64,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for PacketLossConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 5060,
            burst_size: 200,
            timeout_ms: 3000,
        }
    }
}

/// Sends a burst of UDP packets and counts how many get a response.
#[tracing::instrument(skip_all)]
pub async fn run_packet_loss_test(config: PacketLossConfig) -> PacketLossResult {
    let ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return PacketLossResult {
                host: config.host,
                packets_sent: 0,
                packets_received: 0,
                loss_pct: 100.0,
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
            return PacketLossResult {
                host: config.host,
                packets_sent: 0,
                packets_received: 0,
                loss_pct: 100.0,
                success: false,
                error: Some(format!("Failed to bind socket: {}", e)),
            };
        }
    };

    // Send burst
    let mut sent = 0u32;
    for seq in 0..config.burst_size {
        let payload = seq.to_be_bytes();
        if socket.send_to(&payload, dest).await.is_ok() {
            sent += 1;
        }
        // Small delay to prevent overwhelming the network
        if seq % 10 == 0 {
            tokio::time::sleep(Duration::from_micros(500)).await;
        }
    }

    // Receive responses with timeout
    let mut received = 0u32;
    let timeout = Duration::from_millis(config.timeout_ms);
    let deadline = tokio::time::Instant::now() + timeout;
    let mut buf = [0u8; 128];

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, socket.recv_from(&mut buf)).await {
            Ok(Ok(_)) => {
                received += 1;
                if received >= sent {
                    break;
                }
            }
            _ => break,
        }
    }

    let loss_pct = if sent > 0 {
        ((sent - received) as f64 / sent as f64) * 100.0
    } else {
        100.0
    };

    PacketLossResult {
        host: config.host,
        packets_sent: sent,
        packets_received: received,
        loss_pct,
        success: sent > 0,
        error: None,
    }
}
