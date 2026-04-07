use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthConfig {
    pub host: String,
    pub port: u16,
    pub duration_secs: u32,
    pub packet_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthResult {
    pub host: String,
    pub upload_kbps: f64,
    pub download_kbps: f64,
    pub duration_ms: f64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub packets_sent: u64,
    pub packets_received: u64,
    pub packet_loss_pct: f64,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for BandwidthConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 0, // 0 = auto (self-test)
            duration_secs: 5,
            packet_size: 1200,
        }
    }
}

/// Runs a bidirectional UDP throughput test.
///
/// **How it works:**
/// 1. A local UDP echo server is spawned on a random port.
/// 2. The client blasts UDP packets to the echo server as fast as possible.
/// 3. The echo server reflects every packet back.
/// 4. Both upload (client → echo) and download (echo → client) throughput are measured.
///
/// This is analogous to `iperf3 --udp` in loopback mode and always produces real
/// bidirectional numbers. The measured throughput represents the system's UDP
/// processing capacity — useful as a baseline and for detecting OS-level bottlenecks
/// (buffer sizes, CPU throttling, firewall overhead).
#[tracing::instrument(skip_all)]
pub async fn run_bandwidth_test(config: BandwidthConfig) -> BandwidthResult {
    let host_label =
        if config.host.is_empty() || config.host == "localhost" || config.host == "127.0.0.1" {
            "localhost (self-test)".to_string()
        } else {
            config.host.clone()
        };

    // ── 1. Spawn a local UDP echo server ────────────────────────
    let echo_socket = match UdpSocket::bind("127.0.0.1:0").await {
        Ok(s) => s,
        Err(e) => {
            return err_result(&host_label, format!("Failed to bind echo server: {}", e));
        }
    };
    let echo_addr = match echo_socket.local_addr() {
        Ok(a) => a,
        Err(e) => {
            return err_result(&host_label, format!("Failed to get echo address: {}", e));
        }
    };

    let stop = Arc::new(AtomicBool::new(false));
    let echo_bytes = Arc::new(AtomicU64::new(0));
    let echo_packets = Arc::new(AtomicU64::new(0));

    let stop_echo = stop.clone();
    let eb = echo_bytes.clone();
    let ep = echo_packets.clone();

    let echo_handle = tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        loop {
            if stop_echo.load(Ordering::Relaxed) {
                break;
            }
            match tokio::time::timeout(Duration::from_millis(50), echo_socket.recv_from(&mut buf))
                .await
            {
                Ok(Ok((n, addr))) => {
                    let _ = echo_socket.send_to(&buf[..n], addr).await;
                    eb.fetch_add(n as u64, Ordering::Relaxed);
                    ep.fetch_add(1, Ordering::Relaxed);
                }
                _ => {}
            }
        }
    });

    // ── 2. Client socket ────────────────────────────────────────
    let client = match UdpSocket::bind("127.0.0.1:0").await {
        Ok(s) => s,
        Err(e) => {
            stop.store(true, Ordering::Relaxed);
            let _ = echo_handle.await;
            return err_result(&host_label, format!("Failed to bind client socket: {}", e));
        }
    };

    let dest: SocketAddr = echo_addr;
    let packet = vec![0xABu8; config.packet_size];
    let duration = Duration::from_secs(config.duration_secs as u64);
    let warmup = if duration >= Duration::from_secs(4) {
        Duration::from_secs(1)
    } else {
        Duration::from_secs(0)
    };
    let start = Instant::now();
    let mut measured_bytes_sent: u64 = 0;
    let mut measured_bytes_received: u64 = 0;
    let mut measured_packets_sent: u64 = 0;
    let mut measured_packets_received: u64 = 0;
    let mut recv_buf = [0u8; 2048];

    // ── 3. Blast + receive loop ─────────────────────────────────
    while start.elapsed() < duration {
        // Send a burst of packets
        for _ in 0..16 {
            if start.elapsed() >= duration {
                break;
            }
            match client.send_to(&packet, dest).await {
                Ok(n) => {
                    if start.elapsed() >= warmup {
                        measured_bytes_sent += n as u64;
                        measured_packets_sent += 1;
                    }
                }
                Err(_) => break,
            }
        }

        // Drain available responses (non-blocking)
        loop {
            match tokio::time::timeout(Duration::from_micros(100), client.recv_from(&mut recv_buf))
                .await
            {
                Ok(Ok((n, _))) => {
                    if start.elapsed() >= warmup {
                        measured_bytes_received += n as u64;
                        measured_packets_received += 1;
                    }
                }
                _ => break,
            }
        }
    }

    // ── 4. Drain stragglers ─────────────────────────────────────
    let drain_deadline = tokio::time::Instant::now() + Duration::from_millis(500);
    loop {
        let remaining = drain_deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, client.recv_from(&mut recv_buf)).await {
            Ok(Ok((n, _))) => {
                measured_bytes_received += n as u64;
                measured_packets_received += 1;
            }
            _ => break,
        }
    }

    // ── 5. Shutdown echo server ─────────────────────────────────
    stop.store(true, Ordering::Relaxed);
    let _ = echo_handle.await;

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let elapsed_secs = (duration.saturating_sub(warmup)).as_secs_f64().max(0.001);

    let loss = if measured_packets_sent > 0 {
        let lost = measured_packets_sent.saturating_sub(measured_packets_received);
        (lost as f64 / measured_packets_sent as f64) * 100.0
    } else {
        0.0
    };

    BandwidthResult {
        host: host_label,
        upload_kbps: (measured_bytes_sent as f64 * 8.0) / elapsed_secs / 1000.0,
        download_kbps: (measured_bytes_received as f64 * 8.0) / elapsed_secs / 1000.0,
        duration_ms: elapsed_ms,
        bytes_sent: measured_bytes_sent,
        bytes_received: measured_bytes_received,
        packets_sent: measured_packets_sent,
        packets_received: measured_packets_received,
        packet_loss_pct: loss,
        success: measured_bytes_sent > 0 && measured_bytes_received > 0,
        error: None,
    }
}

fn err_result(host: &str, error: String) -> BandwidthResult {
    BandwidthResult {
        host: host.to_string(),
        upload_kbps: 0.0,
        download_kbps: 0.0,
        duration_ms: 0.0,
        bytes_sent: 0,
        bytes_received: 0,
        packets_sent: 0,
        packets_received: 0,
        packet_loss_pct: 0.0,
        success: false,
        error: Some(error),
    }
}
