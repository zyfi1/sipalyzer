//! Pre-computed live statistics using DashMap for lock-free concurrent access.
//!
//! This module provides high-performance statistics aggregation that updates
//! in real-time as packets are captured, without requiring full data scans.

use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use dashmap::DashMap;

use crate::packet_capture::{PacketInfo, Protocol};

/// Time window for rate calculations (seconds).
const RATE_WINDOW_SECONDS: u64 = 5;

/// Maximum entries to track for top N queries.
const MAX_TOP_ENTRIES: usize = 100;

/// Pre-computed live statistics.
pub struct LiveStats {
    /// Total packet count.
    pub total_packets: AtomicU64,
    /// Total bytes received.
    pub total_bytes: AtomicU64,
    /// Packet counts by protocol.
    pub protocol_counts: DashMap<Protocol, AtomicU64>,
    /// Byte counts by protocol.
    pub protocol_bytes: DashMap<Protocol, AtomicU64>,
    /// Source IP counts.
    pub src_ip_counts: DashMap<IpAddr, AtomicU64>,
    /// Destination IP counts.
    pub dst_ip_counts: DashMap<IpAddr, AtomicU64>,
    /// Source port counts.
    pub src_port_counts: DashMap<u16, AtomicU64>,
    /// Destination port counts.
    pub dst_port_counts: DashMap<u16, AtomicU64>,
    /// IP pair counts (src -> dst).
    pub ip_pair_counts: DashMap<(IpAddr, IpAddr), AtomicU64>,
    /// Packets in the current rate window.
    rate_window_packets: AtomicU64,
    /// Bytes in the current rate window.
    rate_window_bytes: AtomicU64,
    /// Start time of current rate window.
    rate_window_start: std::sync::RwLock<Instant>,
    /// Cached packet rate (packets/second).
    cached_packet_rate: std::sync::RwLock<f64>,
    /// Cached byte rate (bytes/second).
    cached_byte_rate: std::sync::RwLock<f64>,
    /// Timestamp of first packet.
    first_packet_time: std::sync::RwLock<Option<chrono::DateTime<chrono::Utc>>>,
    /// Timestamp of last packet.
    last_packet_time: std::sync::RwLock<Option<chrono::DateTime<chrono::Utc>>>,
}

/// Snapshot of live statistics for serialization.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatsSnapshot {
    pub total_packets: u64,
    pub total_bytes: u64,
    pub packet_rate: f64,
    pub byte_rate: f64,
    pub protocol_counts: Vec<ProtocolCount>,
    pub top_src_ips: Vec<IpCount>,
    pub top_dst_ips: Vec<IpCount>,
    pub top_src_ports: Vec<PortCount>,
    pub top_dst_ports: Vec<PortCount>,
    pub top_ip_pairs: Vec<IpPairCount>,
    pub duration_seconds: f64,
    pub first_packet_time: Option<i64>,
    pub last_packet_time: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProtocolCount {
    pub protocol: String,
    pub count: u64,
    pub bytes: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IpCount {
    pub ip: String,
    pub count: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PortCount {
    pub port: u16,
    pub count: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IpPairCount {
    pub src: String,
    pub dst: String,
    pub count: u64,
    pub percentage: f64,
}

impl LiveStats {
    /// Create a new live statistics tracker.
    pub fn new() -> Self {
        Self {
            total_packets: AtomicU64::new(0),
            total_bytes: AtomicU64::new(0),
            protocol_counts: DashMap::new(),
            protocol_bytes: DashMap::new(),
            src_ip_counts: DashMap::new(),
            dst_ip_counts: DashMap::new(),
            src_port_counts: DashMap::new(),
            dst_port_counts: DashMap::new(),
            ip_pair_counts: DashMap::new(),
            rate_window_packets: AtomicU64::new(0),
            rate_window_bytes: AtomicU64::new(0),
            rate_window_start: std::sync::RwLock::new(Instant::now()),
            cached_packet_rate: std::sync::RwLock::new(0.0),
            cached_byte_rate: std::sync::RwLock::new(0.0),
            first_packet_time: std::sync::RwLock::new(None),
            last_packet_time: std::sync::RwLock::new(None),
        }
    }

    /// Record a packet (thread-safe, lock-free for hot paths).
    pub fn record(&self, packet: &PacketInfo) {
        let size = packet.size as u64;

        // Update totals
        self.total_packets.fetch_add(1, Ordering::Relaxed);
        self.total_bytes.fetch_add(size, Ordering::Relaxed);

        // Update rate window
        self.rate_window_packets.fetch_add(1, Ordering::Relaxed);
        self.rate_window_bytes.fetch_add(size, Ordering::Relaxed);

        // Update protocol counts
        self.protocol_counts
            .entry(packet.protocol)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(1, Ordering::Relaxed);
        self.protocol_bytes
            .entry(packet.protocol)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(size, Ordering::Relaxed);

        // Update IP counts (limit entries to prevent memory bloat)
        if self.src_ip_counts.len() < MAX_TOP_ENTRIES
            || self.src_ip_counts.contains_key(&packet.src_ip)
        {
            self.src_ip_counts
                .entry(packet.src_ip)
                .or_insert_with(|| AtomicU64::new(0))
                .fetch_add(1, Ordering::Relaxed);
        }

        if self.dst_ip_counts.len() < MAX_TOP_ENTRIES
            || self.dst_ip_counts.contains_key(&packet.dst_ip)
        {
            self.dst_ip_counts
                .entry(packet.dst_ip)
                .or_insert_with(|| AtomicU64::new(0))
                .fetch_add(1, Ordering::Relaxed);
        }

        // Update port counts
        if self.src_port_counts.len() < MAX_TOP_ENTRIES
            || self.src_port_counts.contains_key(&packet.src_port)
        {
            self.src_port_counts
                .entry(packet.src_port)
                .or_insert_with(|| AtomicU64::new(0))
                .fetch_add(1, Ordering::Relaxed);
        }

        if self.dst_port_counts.len() < MAX_TOP_ENTRIES
            || self.dst_port_counts.contains_key(&packet.dst_port)
        {
            self.dst_port_counts
                .entry(packet.dst_port)
                .or_insert_with(|| AtomicU64::new(0))
                .fetch_add(1, Ordering::Relaxed);
        }

        // Update IP pair counts
        let pair = (packet.src_ip, packet.dst_ip);
        if self.ip_pair_counts.len() < MAX_TOP_ENTRIES || self.ip_pair_counts.contains_key(&pair) {
            self.ip_pair_counts
                .entry(pair)
                .or_insert_with(|| AtomicU64::new(0))
                .fetch_add(1, Ordering::Relaxed);
        }

        // Update timestamps
        let timestamp = packet.timestamp;
        {
            let mut first = self.first_packet_time.write().unwrap();
            if first.is_none() {
                *first = Some(timestamp);
            }
        }
        {
            let mut last = self.last_packet_time.write().unwrap();
            *last = Some(timestamp);
        }
    }

    /// Update rate calculations (call periodically, e.g., every second).
    pub fn update_rates(&self) {
        let now = Instant::now();
        let window_duration = {
            let start = self.rate_window_start.read().unwrap();
            now.duration_since(*start)
        };

        if window_duration >= Duration::from_secs(RATE_WINDOW_SECONDS) {
            let packets = self.rate_window_packets.swap(0, Ordering::Relaxed);
            let bytes = self.rate_window_bytes.swap(0, Ordering::Relaxed);
            let seconds = window_duration.as_secs_f64();

            {
                let mut rate = self.cached_packet_rate.write().unwrap();
                *rate = packets as f64 / seconds;
            }
            {
                let mut rate = self.cached_byte_rate.write().unwrap();
                *rate = bytes as f64 / seconds;
            }
            {
                let mut start = self.rate_window_start.write().unwrap();
                *start = now;
            }
        }
    }

    /// Get the current packet rate (packets/second).
    pub fn packet_rate(&self) -> f64 {
        *self.cached_packet_rate.read().unwrap()
    }

    /// Get the current byte rate (bytes/second).
    pub fn byte_rate(&self) -> f64 {
        *self.cached_byte_rate.read().unwrap()
    }

    /// Get a snapshot of all statistics.
    pub fn snapshot(&self) -> LiveStatsSnapshot {
        let total_packets = self.total_packets.load(Ordering::Relaxed);
        let total_bytes = self.total_bytes.load(Ordering::Relaxed);

        // Protocol counts
        let mut protocol_counts: Vec<ProtocolCount> = self
            .protocol_counts
            .iter()
            .map(|entry| {
                let protocol = *entry.key();
                let count = entry.value().load(Ordering::Relaxed);
                let bytes = self
                    .protocol_bytes
                    .get(&protocol)
                    .map(|b| b.load(Ordering::Relaxed))
                    .unwrap_or(0);
                let percentage = if total_packets > 0 {
                    (count as f64 / total_packets as f64) * 100.0
                } else {
                    0.0
                };
                ProtocolCount {
                    protocol: format!("{:?}", protocol),
                    count,
                    bytes,
                    percentage,
                }
            })
            .collect();
        protocol_counts.sort_by(|a, b| b.count.cmp(&a.count));

        // Top source IPs
        let mut top_src_ips: Vec<IpCount> = self
            .src_ip_counts
            .iter()
            .map(|entry| {
                let count = entry.value().load(Ordering::Relaxed);
                let percentage = if total_packets > 0 {
                    (count as f64 / total_packets as f64) * 100.0
                } else {
                    0.0
                };
                IpCount {
                    ip: entry.key().to_string(),
                    count,
                    percentage,
                }
            })
            .collect();
        top_src_ips.sort_by(|a, b| b.count.cmp(&a.count));
        top_src_ips.truncate(10);

        // Top destination IPs
        let mut top_dst_ips: Vec<IpCount> = self
            .dst_ip_counts
            .iter()
            .map(|entry| {
                let count = entry.value().load(Ordering::Relaxed);
                let percentage = if total_packets > 0 {
                    (count as f64 / total_packets as f64) * 100.0
                } else {
                    0.0
                };
                IpCount {
                    ip: entry.key().to_string(),
                    count,
                    percentage,
                }
            })
            .collect();
        top_dst_ips.sort_by(|a, b| b.count.cmp(&a.count));
        top_dst_ips.truncate(10);

        // Top source ports
        let mut top_src_ports: Vec<PortCount> = self
            .src_port_counts
            .iter()
            .map(|entry| {
                let count = entry.value().load(Ordering::Relaxed);
                let percentage = if total_packets > 0 {
                    (count as f64 / total_packets as f64) * 100.0
                } else {
                    0.0
                };
                PortCount {
                    port: *entry.key(),
                    count,
                    percentage,
                }
            })
            .collect();
        top_src_ports.sort_by(|a, b| b.count.cmp(&a.count));
        top_src_ports.truncate(10);

        // Top destination ports
        let mut top_dst_ports: Vec<PortCount> = self
            .dst_port_counts
            .iter()
            .map(|entry| {
                let count = entry.value().load(Ordering::Relaxed);
                let percentage = if total_packets > 0 {
                    (count as f64 / total_packets as f64) * 100.0
                } else {
                    0.0
                };
                PortCount {
                    port: *entry.key(),
                    count,
                    percentage,
                }
            })
            .collect();
        top_dst_ports.sort_by(|a, b| b.count.cmp(&a.count));
        top_dst_ports.truncate(10);

        // Top IP pairs
        let mut top_ip_pairs: Vec<IpPairCount> = self
            .ip_pair_counts
            .iter()
            .map(|entry| {
                let (src, dst) = *entry.key();
                let count = entry.value().load(Ordering::Relaxed);
                let percentage = if total_packets > 0 {
                    (count as f64 / total_packets as f64) * 100.0
                } else {
                    0.0
                };
                IpPairCount {
                    src: src.to_string(),
                    dst: dst.to_string(),
                    count,
                    percentage,
                }
            })
            .collect();
        top_ip_pairs.sort_by(|a, b| b.count.cmp(&a.count));
        top_ip_pairs.truncate(10);

        // Duration
        let (first_time, last_time) = {
            let first = self.first_packet_time.read().unwrap();
            let last = self.last_packet_time.read().unwrap();
            (*first, *last)
        };

        let duration_seconds = match (first_time, last_time) {
            (Some(first), Some(last)) => (last - first).num_milliseconds() as f64 / 1000.0,
            _ => 0.0,
        };

        LiveStatsSnapshot {
            total_packets,
            total_bytes,
            packet_rate: self.packet_rate(),
            byte_rate: self.byte_rate(),
            protocol_counts,
            top_src_ips,
            top_dst_ips,
            top_src_ports,
            top_dst_ports,
            top_ip_pairs,
            duration_seconds,
            first_packet_time: first_time.map(|t| t.timestamp_millis()),
            last_packet_time: last_time.map(|t| t.timestamp_millis()),
        }
    }

    /// Reset all statistics.
    pub fn reset(&self) {
        self.total_packets.store(0, Ordering::SeqCst);
        self.total_bytes.store(0, Ordering::SeqCst);
        self.protocol_counts.clear();
        self.protocol_bytes.clear();
        self.src_ip_counts.clear();
        self.dst_ip_counts.clear();
        self.src_port_counts.clear();
        self.dst_port_counts.clear();
        self.ip_pair_counts.clear();
        self.rate_window_packets.store(0, Ordering::SeqCst);
        self.rate_window_bytes.store(0, Ordering::SeqCst);
        *self.rate_window_start.write().unwrap() = Instant::now();
        *self.cached_packet_rate.write().unwrap() = 0.0;
        *self.cached_byte_rate.write().unwrap() = 0.0;
        *self.first_packet_time.write().unwrap() = None;
        *self.last_packet_time.write().unwrap() = None;
    }
}

impl Default for LiveStats {
    fn default() -> Self {
        Self::new()
    }
}

// Thread safety
unsafe impl Send for LiveStats {}
unsafe impl Sync for LiveStats {}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_packet(protocol: Protocol, src_ip: &str, dst_ip: &str) -> PacketInfo {
        PacketInfo {
            timestamp: chrono::Utc::now(),
            src_ip: src_ip.parse().unwrap(),
            dst_ip: dst_ip.parse().unwrap(),
            src_port: 5060,
            dst_port: 5061,
            protocol,
            size: 100,
            frame_length: 142,
            raw_frame: None,
            data: vec![],
            decoded: None,
            fidelity: crate::packet_capture::PacketFidelity::Simulated,
            provenance: crate::packet_capture::PacketProvenance::Unknown,
        }
    }

    #[test]
    fn test_record_packet() {
        let stats = LiveStats::new();

        stats.record(&create_test_packet(
            Protocol::SIP,
            "192.168.1.1",
            "192.168.1.2",
        ));
        stats.record(&create_test_packet(
            Protocol::RTP,
            "192.168.1.1",
            "192.168.1.2",
        ));
        stats.record(&create_test_packet(
            Protocol::SIP,
            "192.168.1.1",
            "192.168.1.3",
        ));

        assert_eq!(stats.total_packets.load(Ordering::Relaxed), 3);
        assert_eq!(stats.total_bytes.load(Ordering::Relaxed), 300);

        let snapshot = stats.snapshot();
        assert_eq!(snapshot.total_packets, 3);
        assert_eq!(snapshot.protocol_counts.len(), 2);
    }

    #[test]
    fn test_concurrent_access() {
        use std::sync::Arc;
        use std::thread;

        let stats = Arc::new(LiveStats::new());
        let mut handles = Vec::new();

        for i in 0..10 {
            let stats_clone = Arc::clone(&stats);
            let handle = thread::spawn(move || {
                for j in 0..100 {
                    stats_clone.record(&create_test_packet(
                        Protocol::SIP,
                        "192.168.1.1",
                        &format!("192.168.1.{}", (i * 10 + j) % 256),
                    ));
                }
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(stats.total_packets.load(Ordering::Relaxed), 1000);
    }

    #[test]
    fn test_snapshot() {
        let stats = LiveStats::new();

        for i in 0..100 {
            stats.record(&create_test_packet(
                if i % 2 == 0 {
                    Protocol::SIP
                } else {
                    Protocol::RTP
                },
                "192.168.1.1",
                "192.168.1.2",
            ));
        }

        let snapshot = stats.snapshot();
        assert_eq!(snapshot.total_packets, 100);
        assert_eq!(snapshot.total_bytes, 10000);
        assert!(!snapshot.protocol_counts.is_empty());
        assert!(!snapshot.top_src_ips.is_empty());
    }

    #[test]
    fn test_reset() {
        let stats = LiveStats::new();

        stats.record(&create_test_packet(
            Protocol::SIP,
            "192.168.1.1",
            "192.168.1.2",
        ));
        assert_eq!(stats.total_packets.load(Ordering::Relaxed), 1);

        stats.reset();
        assert_eq!(stats.total_packets.load(Ordering::Relaxed), 0);
        assert!(stats.protocol_counts.is_empty());
    }
}
