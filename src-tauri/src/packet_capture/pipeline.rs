//! Multi-threaded packet capture pipeline.
//!
//! Architecture:
//! ```text
//! NIC → [Capture Thread] → [Raw Packet Queue] → [Parser Thread Pool] → [Parsed Queue] → [Writer/Indexer]
//! ```
//!
//! The capture thread only reads packets from the network and pushes raw bytes to a queue.
//! Parser threads decode packets in parallel using rayon.
//! Writer thread handles batched PCAP writes asynchronously.
//! All communication uses lock-free crossbeam channels.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use std::collections::HashMap;

use anyhow::{Context, Result};
use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use parking_lot::RwLock;
use pcap::{Capture, Device};

use crate::packet_capture::packet_parser::PacketParser;
use crate::packet_capture::ring_buffer::{PacketRingBuffer, LockFreePacketBuffer};
use crate::packet_capture::live_stats::LiveStats;
use crate::packet_capture::{FilterConfig, PacketInfo, PcapWriter, CaptureStatistics};

/// Configuration for the capture pipeline.
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// Size of the raw packet queue (capture → parser).
    pub raw_queue_size: usize,
    /// Size of the parsed packet queue (parser → writer).
    pub parsed_queue_size: usize,
    /// Number of parser threads (0 = auto based on CPU cores).
    pub parser_threads: usize,
    /// Batch size for PCAP writes.
    pub write_batch_size: usize,
    /// Ring buffer capacity for live packets.
    pub ring_buffer_capacity: usize,
    /// RTP port range for detection.
    pub rtp_port_range: Option<(u16, u16)>,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            raw_queue_size: 65536,       // 64K raw packets in queue
            parsed_queue_size: 32768,    // 32K parsed packets in queue  
            parser_threads: 0,           // Auto-detect
            write_batch_size: 1000,      // Write 1000 packets at a time
            ring_buffer_capacity: 2_000_000, // 2M packets
            rtp_port_range: Some((10000, 60000)),
        }
    }
}

/// Raw packet data from capture thread.
#[derive(Clone)]
pub struct RawPacket {
    /// Timestamp from pcap header.
    pub timestamp_secs: i64,
    pub timestamp_usecs: u32,
    /// Packet number.
    pub packet_number: u64,
    /// Raw packet bytes.
    pub data: Vec<u8>,
    /// Link layer type for parsing.
    pub link_layer_type: u32,
}

/// Statistics for the capture pipeline.
#[derive(Debug, Default)]
pub struct PipelineStats {
    pub packets_captured: AtomicU64,
    pub packets_parsed: AtomicU64,
    pub packets_written: AtomicU64,
    pub packets_dropped_capture: AtomicU64,
    pub packets_dropped_parser: AtomicU64,
    pub parse_errors: AtomicU64,
    pub write_errors: AtomicU64,
}

impl PipelineStats {
    pub fn snapshot(&self) -> PipelineStatsSnapshot {
        PipelineStatsSnapshot {
            packets_captured: self.packets_captured.load(Ordering::Relaxed),
            packets_parsed: self.packets_parsed.load(Ordering::Relaxed),
            packets_written: self.packets_written.load(Ordering::Relaxed),
            packets_dropped_capture: self.packets_dropped_capture.load(Ordering::Relaxed),
            packets_dropped_parser: self.packets_dropped_parser.load(Ordering::Relaxed),
            parse_errors: self.parse_errors.load(Ordering::Relaxed),
            write_errors: self.write_errors.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PipelineStatsSnapshot {
    pub packets_captured: u64,
    pub packets_parsed: u64,
    pub packets_written: u64,
    pub packets_dropped_capture: u64,
    pub packets_dropped_parser: u64,
    pub parse_errors: u64,
    pub write_errors: u64,
}

/// The main capture pipeline.
pub struct CapturePipeline {
    config: PipelineConfig,
    stop_flag: Arc<AtomicBool>,
    stats: Arc<PipelineStats>,
    
    // Channels
    raw_tx: Sender<RawPacket>,
    raw_rx: Receiver<RawPacket>,
    parsed_tx: Sender<Arc<PacketInfo>>,
    parsed_rx: Receiver<Arc<PacketInfo>>,
    
    // Thread handles
    capture_handle: Option<JoinHandle<()>>,
    parser_handles: Vec<JoinHandle<()>>,
    writer_handle: Option<JoinHandle<()>>,
    
    // Shared state
    ring_buffer: LockFreePacketBuffer,
    filter_config: Arc<RwLock<FilterConfig>>,
}

impl CapturePipeline {
    /// Create a new capture pipeline.
    pub fn new(config: PipelineConfig, filter_config: FilterConfig) -> Self {
        let (raw_tx, raw_rx) = bounded(config.raw_queue_size);
        let (parsed_tx, parsed_rx) = bounded(config.parsed_queue_size);
        
        Self {
            ring_buffer: Arc::new(PacketRingBuffer::new(config.ring_buffer_capacity)),
            config,
            stop_flag: Arc::new(AtomicBool::new(false)),
            stats: Arc::new(PipelineStats::default()),
            raw_tx,
            raw_rx,
            parsed_tx,
            parsed_rx,
            capture_handle: None,
            parser_handles: Vec::new(),
            writer_handle: None,
            filter_config: Arc::new(RwLock::new(filter_config)),
        }
    }
    
    /// Get shared reference to the ring buffer.
    pub fn ring_buffer(&self) -> LockFreePacketBuffer {
        Arc::clone(&self.ring_buffer)
    }
    
    /// Get pipeline statistics.
    pub fn stats(&self) -> Arc<PipelineStats> {
        Arc::clone(&self.stats)
    }
    
    /// Start the capture pipeline.
    pub fn start(
        &mut self,
        interface: String,
        pcap_writer: Option<Arc<std::sync::Mutex<PcapWriter>>>,
        legacy_stats: Option<Arc<std::sync::Mutex<CaptureStatistics>>>,
        live_stats: Option<Arc<LiveStats>>,
    ) -> Result<()> {
        let _span = tracing::info_span!(
            "capture.pipeline_start",
            interface = %interface,
        )
        .entered();
        tracing::info!("Pipeline capture started");

        if self.capture_handle.is_some() {
            return Ok(()); // Already running
        }
        
        self.stop_flag.store(false, Ordering::SeqCst);
        
        // Start capture thread
        self.start_capture_thread(interface, legacy_stats.clone())?;
        
        // Start parser thread pool
        self.start_parser_threads()?;
        
        // Start writer thread
        self.start_writer_thread(pcap_writer, legacy_stats, live_stats)?;
        
        Ok(())
    }
    
    /// Stop the capture pipeline.
    pub fn stop(&mut self) -> Result<()> {
        let _span = tracing::info_span!("capture.pipeline_stop").entered();
        tracing::info!("Pipeline capture stopped");

        self.stop_flag.store(true, Ordering::SeqCst);
        
        // Wait for capture thread
        if let Some(handle) = self.capture_handle.take() {
            let _ = handle.join();
        }
        
        // Wait for parser threads
        for handle in self.parser_handles.drain(..) {
            let _ = handle.join();
        }
        
        // Wait for writer thread
        if let Some(handle) = self.writer_handle.take() {
            let _ = handle.join();
        }

        Ok(())
    }
    
    /// Check if the pipeline is running.
    pub fn is_running(&self) -> bool {
        self.capture_handle.is_some() && !self.stop_flag.load(Ordering::Relaxed)
    }
    
    fn start_capture_thread(
        &mut self,
        interface: String,
        legacy_stats: Option<Arc<std::sync::Mutex<CaptureStatistics>>>,
    ) -> Result<()> {
        let stop_flag = Arc::clone(&self.stop_flag);
        let stats = Arc::clone(&self.stats);
        let raw_tx = self.raw_tx.clone();
        let filter_config = Arc::clone(&self.filter_config);
        let rtp_port_range = self.config.rtp_port_range;
        
        let handle = thread::Builder::new()
            .name("capture".to_string())
            .spawn(move || {
                if let Err(e) = Self::capture_thread_main(
                    interface,
                    stop_flag,
                    stats,
                    raw_tx,
                    filter_config,
                    rtp_port_range,
                    legacy_stats,
                ) {
                    tracing::error!("Capture thread error: {}", e);
                }
            })
            .context("Failed to spawn capture thread")?;
        
        self.capture_handle = Some(handle);
        Ok(())
    }
    
    fn capture_thread_main(
        interface: String,
        stop_flag: Arc<AtomicBool>,
        stats: Arc<PipelineStats>,
        raw_tx: Sender<RawPacket>,
        filter_config: Arc<RwLock<FilterConfig>>,
        _rtp_port_range: Option<(u16, u16)>,
        legacy_stats: Option<Arc<std::sync::Mutex<CaptureStatistics>>>,
    ) -> Result<()> {
        tracing::info!("Capture thread starting on interface: {}", interface);
        
        // Find and open device
        let devices = Device::list().context("Failed to list devices")?;
        let device = devices
            .into_iter()
            .find(|d| d.name == interface)
            .ok_or_else(|| anyhow::anyhow!("Interface not found: {}", interface))?;
        
        let mut cap = Capture::from_device(device)
            .context("Failed to create capture")?
            .promisc(true)
            .snaplen(65535)
            .timeout(10) // 10ms timeout for responsive stop
            .open()
            .context("Failed to open capture")?;
        
        let link_layer_type = cap.get_datalink().0 as u32;
        tracing::info!("Link layer type: {}", link_layer_type);
        
        // Apply BPF filter if needed
        let filter = filter_config.read();
        if let Some(bpf) = Self::build_bpf_filter(&filter) {
            tracing::info!("Setting BPF filter: {}", bpf);
            cap.filter(&bpf, true)
                .map_err(|e| anyhow::anyhow!("Failed to set BPF filter: {}", e))?;
        }
        drop(filter);
        
        let mut packet_number = 0u64;
        let mut last_log = Instant::now();
        let mut last_pcap_stats_poll = Instant::now();
        loop {
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }
            if last_pcap_stats_poll.elapsed() >= Duration::from_secs(1) {
                Self::update_legacy_pcap_stats(&mut cap, &legacy_stats);
                last_pcap_stats_poll = Instant::now();
            }
            
            match cap.next_packet() {
                Ok(packet) => {
                    packet_number += 1;
                    stats.packets_captured.fetch_add(1, Ordering::Relaxed);
                    
                    let raw_packet = RawPacket {
                        timestamp_secs: packet.header.ts.tv_sec,
                        timestamp_usecs: packet.header.ts.tv_usec as u32,
                        packet_number,
                        data: packet.data.to_vec(),
                        link_layer_type,
                    };
                    
                    // Non-blocking send to avoid capture thread blocking
                    match raw_tx.try_send(raw_packet) {
                        Ok(()) => {}
                        Err(TrySendError::Full(_)) => {
                            stats.packets_dropped_capture.fetch_add(1, Ordering::Relaxed);
                        }
                        Err(TrySendError::Disconnected(_)) => {
                            break;
                        }
                    }
                }
                Err(e) => {
                    let error_str = format!("{:?}", e);
                    if !error_str.contains("Timeout") && !error_str.contains("timeout") {
                        // Only log non-timeout errors occasionally
                        if last_log.elapsed() > Duration::from_secs(5) {
                            tracing::error!("Capture error: {:?}", e);
                            last_log = Instant::now();
                        }
                    }
                }
            }
            
            // Periodic stats logging
            if last_log.elapsed() > Duration::from_secs(10) {
                let snap = stats.snapshot();
                tracing::info!(
                    "[Pipeline] Stats: captured={}, parsed={}, written={}, dropped_cap={}, dropped_parse={}",
                    snap.packets_captured, snap.packets_parsed, snap.packets_written,
                    snap.packets_dropped_capture, snap.packets_dropped_parser);
                last_log = Instant::now();
            }
        }
        // Final best-effort stats refresh.
        Self::update_legacy_pcap_stats(&mut cap, &legacy_stats);
        
        tracing::info!("Capture thread stopped");
        Ok(())
    }

    fn update_legacy_pcap_stats(
        cap: &mut Capture<pcap::Active>,
        legacy_stats: &Option<Arc<std::sync::Mutex<CaptureStatistics>>>,
    ) {
        let Some(legacy_stats) = legacy_stats else {
            return;
        };
        match cap.stats() {
            Ok(stats) => {
                if let Ok(mut capture_stats) = legacy_stats.lock() {
                    capture_stats.update_pcap_stats(
                        stats.received,
                        stats.dropped,
                        stats.if_dropped,
                        chrono::Utc::now(),
                    );
                }
            }
            Err(e) => {
                // Keep capture running when backend stats are unavailable.
                tracing::debug!("[Pipeline] pcap stats unavailable: {:?}", e);
            }
        }
    }
    
    fn start_parser_threads(&mut self) -> Result<()> {
        let num_threads = if self.config.parser_threads == 0 {
            (num_cpus::get() / 2).max(2).min(8) // Auto: half of CPUs, min 2, max 8
        } else {
            self.config.parser_threads
        };
        
        tracing::info!("Starting {} parser threads", num_threads);
        
        for i in 0..num_threads {
            let stop_flag = Arc::clone(&self.stop_flag);
            let stats = Arc::clone(&self.stats);
            let raw_rx = self.raw_rx.clone();
            let parsed_tx = self.parsed_tx.clone();
            let ring_buffer = Arc::clone(&self.ring_buffer);
            let filter_config = Arc::clone(&self.filter_config);
            let rtp_port_range = self.config.rtp_port_range;
            
            let handle = thread::Builder::new()
                .name(format!("parser-{}", i))
                .spawn(move || {
                    Self::parser_thread_main(
                        stop_flag,
                        stats,
                        raw_rx,
                        parsed_tx,
                        ring_buffer,
                        filter_config,
                        rtp_port_range,
                    );
                })
                .context("Failed to spawn parser thread")?;
            
            self.parser_handles.push(handle);
        }
        
        Ok(())
    }
    
    fn parser_thread_main(
        stop_flag: Arc<AtomicBool>,
        stats: Arc<PipelineStats>,
        raw_rx: Receiver<RawPacket>,
        parsed_tx: Sender<Arc<PacketInfo>>,
        ring_buffer: LockFreePacketBuffer,
        filter_config: Arc<RwLock<FilterConfig>>,
        rtp_port_range: Option<(u16, u16)>,
    ) {
        let thread_name = thread::current().name().unwrap_or("parser").to_string();
        tracing::info!("{} starting", thread_name);
        let mut parser_cache: HashMap<u32, PacketParser> = HashMap::new();
        
        loop {
            if stop_flag.load(Ordering::Relaxed) {
                // Drain remaining packets
                while let Ok(raw) = raw_rx.try_recv() {
                    Self::parse_and_store(
                        &raw,
                        &stats,
                        &parsed_tx,
                        &ring_buffer,
                        &filter_config,
                        rtp_port_range,
                        &mut parser_cache,
                    );
                }
                break;
            }
            
            match raw_rx.recv_timeout(Duration::from_millis(50)) {
                Ok(raw) => {
                    Self::parse_and_store(
                        &raw,
                        &stats,
                        &parsed_tx,
                        &ring_buffer,
                        &filter_config,
                        rtp_port_range,
                        &mut parser_cache,
                    );
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
            }
        }
        
        tracing::info!("{} stopped", thread_name);
    }
    
    fn parse_and_store(
        raw: &RawPacket,
        stats: &PipelineStats,
        parsed_tx: &Sender<Arc<PacketInfo>>,
        ring_buffer: &PacketRingBuffer,
        filter_config: &RwLock<FilterConfig>,
        rtp_port_range: Option<(u16, u16)>,
        parser_cache: &mut HashMap<u32, PacketParser>,
    ) {
        // Reuse parser instances by link-layer type to avoid per-packet construction.
        let parser = parser_cache.entry(raw.link_layer_type).or_insert_with(|| {
            PacketParser::with_rtp_port_range(raw.link_layer_type, rtp_port_range)
        });
        
        // Create pcap-compatible packet header
        let header = pcap::PacketHeader {
            ts: libc::timeval {
                tv_sec: raw.timestamp_secs,
                tv_usec: raw.timestamp_usecs as i32,
            },
            caplen: raw.data.len() as u32,
            len: raw.data.len() as u32,
        };
        
        let packet = pcap::Packet {
            header: &header,
            data: &raw.data,
        };
        
        if let Some(mut packet_info) = parser.parse(&packet, Some(raw.packet_number)) {
            packet_info.provenance = crate::packet_capture::PacketProvenance::PipelineCapture;
            stats.packets_parsed.fetch_add(1, Ordering::Relaxed);
            
            // Apply filter
            let filter = filter_config.read();
            if filter.matches(&packet_info) {
                drop(filter);

                // Preserve full raw frames for authoritative writer path, but avoid
                // retaining them in the live UI ring buffer for non-SIP traffic.
                if matches!(packet_info.protocol, crate::packet_capture::Protocol::SIP) {
                    let arc_packet = ring_buffer.push(packet_info);
                    let _ = parsed_tx.try_send(arc_packet);
                } else {
                    let writer_packet = Arc::new(packet_info.clone());
                    let mut ui_packet = packet_info;
                    ui_packet.raw_frame = None;
                    let _ = ring_buffer.push(ui_packet);
                    let _ = parsed_tx.try_send(writer_packet);
                }
            }
        } else {
            stats.parse_errors.fetch_add(1, Ordering::Relaxed);
        }
    }
    
    fn start_writer_thread(
        &mut self,
        pcap_writer: Option<Arc<std::sync::Mutex<PcapWriter>>>,
        legacy_stats: Option<Arc<std::sync::Mutex<CaptureStatistics>>>,
        live_stats: Option<Arc<LiveStats>>,
    ) -> Result<()> {
        let stop_flag = Arc::clone(&self.stop_flag);
        let stats = Arc::clone(&self.stats);
        let parsed_rx = self.parsed_rx.clone();
        let batch_size = self.config.write_batch_size;
        
        let handle = thread::Builder::new()
            .name("writer".to_string())
            .spawn(move || {
                Self::writer_thread_main(
                    stop_flag,
                    stats,
                    parsed_rx,
                    pcap_writer,
                    legacy_stats,
                    live_stats,
                    batch_size,
                );
            })
            .context("Failed to spawn writer thread")?;
        
        self.writer_handle = Some(handle);
        Ok(())
    }
    
    fn writer_thread_main(
        stop_flag: Arc<AtomicBool>,
        stats: Arc<PipelineStats>,
        parsed_rx: Receiver<Arc<PacketInfo>>,
        pcap_writer: Option<Arc<std::sync::Mutex<PcapWriter>>>,
        legacy_stats: Option<Arc<std::sync::Mutex<CaptureStatistics>>>,
        live_stats: Option<Arc<LiveStats>>,
        batch_size: usize,
    ) {
        tracing::info!("Writer thread starting");
        
        let mut batch: Vec<Arc<PacketInfo>> = Vec::with_capacity(batch_size);
        let mut last_flush = Instant::now();
        
        loop {
            if stop_flag.load(Ordering::Relaxed) {
                // Drain and flush remaining packets
                while let Ok(packet) = parsed_rx.try_recv() {
                    batch.push(packet);
                }
                Self::flush_batch(&batch, &pcap_writer, &legacy_stats, &live_stats, &stats);
                break;
            }
            
            match parsed_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(packet) => {
                    batch.push(packet);
                    
                    // Flush when batch is full or timeout
                    if batch.len() >= batch_size || last_flush.elapsed() > Duration::from_millis(500) {
                        Self::flush_batch(&batch, &pcap_writer, &legacy_stats, &live_stats, &stats);
                        batch.clear();
                        last_flush = Instant::now();
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    // Flush partial batch on timeout
                    if !batch.is_empty() {
                        Self::flush_batch(&batch, &pcap_writer, &legacy_stats, &live_stats, &stats);
                        batch.clear();
                        last_flush = Instant::now();
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
            }
        }
        
        tracing::info!("Writer thread stopped");
    }
    
    fn flush_batch(
        batch: &[Arc<PacketInfo>],
        pcap_writer: &Option<Arc<std::sync::Mutex<PcapWriter>>>,
        legacy_stats: &Option<Arc<std::sync::Mutex<CaptureStatistics>>>,
        live_stats: &Option<Arc<LiveStats>>,
        stats: &PipelineStats,
    ) {
        if batch.is_empty() {
            return;
        }
        
        for packet in batch {
            // Write to PCAP
            if let Some(ref writer) = pcap_writer {
                if let Ok(mut w) = writer.lock() {
                    if let Err(e) = w.write_packet(packet.as_ref()) {
                        stats.write_errors.fetch_add(1, Ordering::Relaxed);
                        tracing::error!("Write error: {}", e);
                    } else {
                        stats.packets_written.fetch_add(1, Ordering::Relaxed);
                    }
                }
            } else {
                stats.packets_written.fetch_add(1, Ordering::Relaxed);
            }
            
            // Update legacy statistics
            if let Some(ref legacy) = legacy_stats {
                if let Ok(mut s) = legacy.lock() {
                    s.add_packet(packet.as_ref());
                }
            }
            
            // Update high-performance live statistics (lock-free DashMap)
            if let Some(ref ls) = live_stats {
                ls.record(packet.as_ref());
            }
        }
    }
    
    fn build_bpf_filter(filter: &FilterConfig) -> Option<String> {
        // Reuse existing BPF filter logic
        if filter.protocols.is_empty()
            && filter.src_ports.is_empty()
            && filter.dst_ports.is_empty()
            && filter.port_ranges.is_empty()
        {
            return None;
        }
        
        let mut protocol_parts = std::collections::HashSet::new();
        let mut port_parts = Vec::new();
        
        if !filter.protocols.is_empty() {
            for protocol in &filter.protocols {
                let bpf_proto = match protocol.to_lowercase().as_str() {
                    "sip" | "rtp" | "rtcp" | "dns" | "udp" => "udp",
                    "tcp" | "http" | "https" => "tcp",
                    "icmp" => "icmp",
                    "arp" => "arp",
                    "fax" => "udp",
                    _ => "udp",
                };
                protocol_parts.insert(bpf_proto.to_string());
            }
        }
        
        for port in &filter.src_ports {
            port_parts.push(format!("port {}", port));
        }
        for port in &filter.dst_ports {
            port_parts.push(format!("port {}", port));
        }
        for (min, max) in &filter.port_ranges {
            port_parts.push(format!("portrange {}-{}", min, max));
        }
        
        match (protocol_parts.is_empty(), port_parts.is_empty()) {
            (true, true) => None,
            (false, true) => {
                if protocol_parts.len() == 1 {
                    Some(protocol_parts.into_iter().next().unwrap())
                } else {
                    let parts: Vec<_> = protocol_parts.into_iter().collect();
                    Some(format!("({})", parts.join(" or ")))
                }
            }
            (true, false) => {
                Some(format!("(udp or tcp) and ({})", port_parts.join(" or ")))
            }
            (false, false) => {
                let proto_expr = if protocol_parts.len() == 1 {
                    protocol_parts.into_iter().next().unwrap()
                } else {
                    let parts: Vec<_> = protocol_parts.into_iter().collect();
                    format!("({})", parts.join(" or "))
                };
                Some(format!("{} and ({})", proto_expr, port_parts.join(" or ")))
            }
        }
    }
}

impl Drop for CapturePipeline {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_pipeline_config_default() {
        let config = PipelineConfig::default();
        assert_eq!(config.raw_queue_size, 65536);
        assert_eq!(config.parsed_queue_size, 32768);
        assert_eq!(config.write_batch_size, 1000);
        assert_eq!(config.ring_buffer_capacity, 2_000_000);
    }
    
    #[test]
    fn test_pipeline_stats() {
        let stats = PipelineStats::default();
        stats.packets_captured.fetch_add(100, Ordering::Relaxed);
        stats.packets_parsed.fetch_add(95, Ordering::Relaxed);
        stats.packets_dropped_capture.fetch_add(5, Ordering::Relaxed);
        
        let snapshot = stats.snapshot();
        assert_eq!(snapshot.packets_captured, 100);
        assert_eq!(snapshot.packets_parsed, 95);
        assert_eq!(snapshot.packets_dropped_capture, 5);
    }
    
    #[test]
    fn test_bpf_filter_empty() {
        let filter = FilterConfig::default();
        assert!(CapturePipeline::build_bpf_filter(&filter).is_none());
    }
    
    #[test]
    fn test_bpf_filter_sip() {
        let filter = FilterConfig {
            protocols: vec!["sip".to_string()],
            ..Default::default()
        };
        let bpf = CapturePipeline::build_bpf_filter(&filter);
        assert_eq!(bpf, Some("udp".to_string()));
    }
}
