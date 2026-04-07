//! Real-time packet streaming using Tauri events.
//!
//! Replaces polling with WebSocket-like streaming for real-time packet updates.
//! Uses Tauri's event system with broadcast channels for efficient delivery.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;

use crate::packet_capture::PacketInfo;

/// Maximum number of packets to buffer in the broadcast channel.
const BROADCAST_CAPACITY: usize = 10000;

/// Minimum interval between batch emissions (milliseconds).
const MIN_EMIT_INTERVAL_MS: u64 = 50;

/// Maximum packets per batch emission.
const MAX_BATCH_SIZE: usize = 100;

/// Packet stream event names.
pub mod events {
    pub const PACKET_NEW: &str = "packet:new";
    pub const PACKET_BATCH: &str = "packet:batch";
    pub const STREAM_STATS: &str = "stream:stats";
    pub const STREAM_ERROR: &str = "stream:error";
}

/// Serializable packet for streaming (lighter weight than full PacketInfo).
#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamPacket {
    pub timestamp: i64,
    pub src_ip: String,
    pub dst_ip: String,
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: String,
    pub size: usize,
    pub summary: String,
}

impl From<&PacketInfo> for StreamPacket {
    fn from(info: &PacketInfo) -> Self {
        Self {
            timestamp: info.timestamp.timestamp_millis(),
            src_ip: info.src_ip.to_string(),
            dst_ip: info.dst_ip.to_string(),
            src_port: info.src_port,
            dst_port: info.dst_port,
            protocol: format!("{:?}", info.protocol),
            size: info.size,
            summary: info.summary(),
        }
    }
}

/// Batch of packets for efficient streaming.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PacketBatch {
    pub session_id: String,
    pub packets: Vec<StreamPacket>,
    pub total_count: u64,
    pub dropped_count: u64,
}

/// Stream statistics.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamStats {
    pub session_id: String,
    pub packets_sent: u64,
    pub packets_dropped: u64,
    pub bytes_sent: u64,
    pub emit_rate_pps: f64,
}

/// Manages packet streaming for a capture session.
pub struct PacketStream {
    session_id: String,
    sender: broadcast::Sender<Arc<PacketInfo>>,
    is_active: AtomicBool,
    stats: StreamStatsInternal,
    app_handle: Option<AppHandle>,
}

struct StreamStatsInternal {
    packets_sent: AtomicU64,
    packets_dropped: AtomicU64,
    bytes_sent: AtomicU64,
}

impl PacketStream {
    /// Create a new packet stream.
    pub fn new(session_id: String) -> Self {
        let (sender, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            session_id,
            sender,
            is_active: AtomicBool::new(false),
            stats: StreamStatsInternal {
                packets_sent: AtomicU64::new(0),
                packets_dropped: AtomicU64::new(0),
                bytes_sent: AtomicU64::new(0),
            },
            app_handle: None,
        }
    }

    /// Set the Tauri app handle for event emission.
    pub fn set_app_handle(&mut self, handle: AppHandle) {
        self.app_handle = Some(handle);
    }

    /// Subscribe to the packet stream.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<PacketInfo>> {
        self.sender.subscribe()
    }

    /// Push a packet to the stream.
    pub fn push(&self, packet: Arc<PacketInfo>) {
        if !self.is_active.load(Ordering::Relaxed) {
            return;
        }

        match self.sender.send(packet.clone()) {
            Ok(_) => {
                self.stats.packets_sent.fetch_add(1, Ordering::Relaxed);
                self.stats
                    .bytes_sent
                    .fetch_add(packet.size as u64, Ordering::Relaxed);
            }
            Err(_) => {
                self.stats.packets_dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    /// Start the stream.
    pub fn start(&self) {
        self.is_active.store(true, Ordering::SeqCst);
    }

    /// Stop the stream.
    pub fn stop(&self) {
        self.is_active.store(false, Ordering::SeqCst);
    }

    /// Check if the stream is active.
    pub fn is_active(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }

    /// Get stream statistics.
    pub fn get_stats(&self) -> StreamStats {
        StreamStats {
            session_id: self.session_id.clone(),
            packets_sent: self.stats.packets_sent.load(Ordering::Relaxed),
            packets_dropped: self.stats.packets_dropped.load(Ordering::Relaxed),
            bytes_sent: self.stats.bytes_sent.load(Ordering::Relaxed),
            emit_rate_pps: 0.0, // Calculated externally
        }
    }

    /// Get the number of active subscribers.
    pub fn subscriber_count(&self) -> usize {
        self.sender.receiver_count()
    }
}

/// Manages multiple packet streams.
pub struct StreamManager {
    streams: RwLock<std::collections::HashMap<String, Arc<PacketStream>>>,
    app_handle: RwLock<Option<AppHandle>>,
}

impl StreamManager {
    /// Create a new stream manager.
    pub fn new() -> Self {
        Self {
            streams: RwLock::new(std::collections::HashMap::new()),
            app_handle: RwLock::new(None),
        }
    }

    /// Set the Tauri app handle.
    pub fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.write() = Some(handle);
    }

    /// Get or create a stream for a session.
    pub fn get_or_create(&self, session_id: &str) -> Arc<PacketStream> {
        let mut streams = self.streams.write();
        streams
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(PacketStream::new(session_id.to_string())))
            .clone()
    }

    /// Get an existing stream.
    pub fn get(&self, session_id: &str) -> Option<Arc<PacketStream>> {
        self.streams.read().get(session_id).cloned()
    }

    /// Remove a stream.
    pub fn remove(&self, session_id: &str) -> Option<Arc<PacketStream>> {
        self.streams.write().remove(session_id)
    }

    /// Emit a packet batch to the frontend.
    pub fn emit_batch(
        &self,
        session_id: &str,
        packets: Vec<StreamPacket>,
        total: u64,
        dropped: u64,
    ) {
        if let Some(ref handle) = *self.app_handle.read() {
            let batch = PacketBatch {
                session_id: session_id.to_string(),
                packets,
                total_count: total,
                dropped_count: dropped,
            };
            let _ = handle.emit(events::PACKET_BATCH, batch);
        }
    }

    /// Emit stream statistics.
    pub fn emit_stats(&self, stats: StreamStats) {
        if let Some(ref handle) = *self.app_handle.read() {
            let _ = handle.emit(events::STREAM_STATS, stats);
        }
    }

    /// Get all active streams.
    pub fn active_streams(&self) -> Vec<String> {
        self.streams
            .read()
            .iter()
            .filter(|(_, stream)| stream.is_active())
            .map(|(id, _)| id.clone())
            .collect()
    }
}

impl Default for StreamManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Batch emitter that collects packets and emits them in batches.
pub struct BatchEmitter {
    session_id: String,
    buffer: RwLock<Vec<StreamPacket>>,
    last_emit: RwLock<Instant>,
    total_count: AtomicU64,
    dropped_count: AtomicU64,
    manager: Arc<StreamManager>,
}

impl BatchEmitter {
    /// Create a new batch emitter.
    pub fn new(session_id: String, manager: Arc<StreamManager>) -> Self {
        Self {
            session_id,
            buffer: RwLock::new(Vec::with_capacity(MAX_BATCH_SIZE)),
            last_emit: RwLock::new(Instant::now()),
            total_count: AtomicU64::new(0),
            dropped_count: AtomicU64::new(0),
            manager,
        }
    }

    /// Add a packet to the batch.
    pub fn push(&self, packet: &PacketInfo) {
        self.total_count.fetch_add(1, Ordering::Relaxed);

        let stream_packet = StreamPacket::from(packet);
        let mut buffer = self.buffer.write();

        if buffer.len() < MAX_BATCH_SIZE {
            buffer.push(stream_packet);
        } else {
            self.dropped_count.fetch_add(1, Ordering::Relaxed);
        }

        // Check if we should emit
        let should_emit = buffer.len() >= MAX_BATCH_SIZE || {
            let last_emit = self.last_emit.read();
            last_emit.elapsed() >= Duration::from_millis(MIN_EMIT_INTERVAL_MS)
        };

        if should_emit && !buffer.is_empty() {
            let packets: Vec<_> = buffer.drain(..).collect();
            drop(buffer); // Release lock before emitting

            *self.last_emit.write() = Instant::now();

            self.manager.emit_batch(
                &self.session_id,
                packets,
                self.total_count.load(Ordering::Relaxed),
                self.dropped_count.load(Ordering::Relaxed),
            );
        }
    }

    /// Flush any remaining packets.
    pub fn flush(&self) {
        let mut buffer = self.buffer.write();
        if !buffer.is_empty() {
            let packets: Vec<_> = buffer.drain(..).collect();
            drop(buffer);

            *self.last_emit.write() = Instant::now();

            self.manager.emit_batch(
                &self.session_id,
                packets,
                self.total_count.load(Ordering::Relaxed),
                self.dropped_count.load(Ordering::Relaxed),
            );
        }
    }

    /// Get statistics.
    pub fn stats(&self) -> (u64, u64) {
        (
            self.total_count.load(Ordering::Relaxed),
            self.dropped_count.load(Ordering::Relaxed),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    fn create_test_packet() -> PacketInfo {
        PacketInfo {
            timestamp: chrono::Utc::now(),
            src_ip: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)),
            dst_ip: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
            src_port: 5060,
            dst_port: 5060,
            protocol: crate::packet_capture::Protocol::SIP,
            size: 100,
            frame_length: 142,
            raw_frame: None,
            data: vec![0u8; 100],
            decoded: None,
            fidelity: crate::packet_capture::PacketFidelity::Simulated,
            provenance: crate::packet_capture::PacketProvenance::Unknown,
        }
    }

    #[test]
    fn test_stream_creation() {
        let stream = PacketStream::new("test-session".to_string());
        assert!(!stream.is_active());
        assert_eq!(stream.subscriber_count(), 0);
    }

    #[test]
    fn test_stream_start_stop() {
        let stream = PacketStream::new("test-session".to_string());

        stream.start();
        assert!(stream.is_active());

        stream.stop();
        assert!(!stream.is_active());
    }

    #[test]
    fn test_stream_subscribe() {
        let stream = PacketStream::new("test-session".to_string());
        let _rx = stream.subscribe();
        assert_eq!(stream.subscriber_count(), 1);
    }

    #[test]
    fn test_stream_push() {
        let stream = PacketStream::new("test-session".to_string());
        stream.start();

        let _rx = stream.subscribe();
        let packet = Arc::new(create_test_packet());

        stream.push(packet);

        let stats = stream.get_stats();
        assert_eq!(stats.packets_sent, 1);
    }

    #[test]
    fn test_stream_manager() {
        let manager = StreamManager::new();

        let stream1 = manager.get_or_create("session-1");
        let stream2 = manager.get_or_create("session-2");

        assert_ne!(Arc::as_ptr(&stream1), Arc::as_ptr(&stream2));

        // Same session returns same stream
        let stream1_again = manager.get_or_create("session-1");
        assert_eq!(Arc::as_ptr(&stream1), Arc::as_ptr(&stream1_again));
    }

    #[test]
    fn test_stream_packet_conversion() {
        let packet = create_test_packet();
        let stream_packet = StreamPacket::from(&packet);

        assert_eq!(stream_packet.src_ip, "192.168.1.1");
        assert_eq!(stream_packet.dst_ip, "192.168.1.2");
        assert_eq!(stream_packet.src_port, 5060);
        assert_eq!(stream_packet.protocol, "SIP");
    }
}
