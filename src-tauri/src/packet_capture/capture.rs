use crate::packet_capture::live_stats::{LiveStats, LiveStatsSnapshot};
use crate::packet_capture::pipeline::{CapturePipeline, PipelineConfig, PipelineStatsSnapshot};
use crate::packet_capture::protocol_decoder;
use crate::packet_capture::PacketInfo;
use anyhow::{Context, Result};
use pcap::{Active, Capture, Device};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Capture mode: single-threaded (legacy) or multi-threaded pipeline
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CaptureMode {
    /// Single-threaded capture loop (legacy, good for low traffic)
    #[default]
    SingleThreaded,
    /// Multi-threaded pipeline (high performance for 100k+ pps)
    Pipeline,
}

pub struct CaptureSession {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub interface: String,
    pub filter_config: crate::packet_capture::FilterConfig,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub status: CaptureStatus,
    /// Legacy statistics (uses Mutex, suitable for low-traffic scenarios).
    pub statistics: Arc<std::sync::Mutex<crate::packet_capture::CaptureStatistics>>,
    /// High-performance statistics using DashMap (lock-free for hot paths).
    pub live_stats: Arc<LiveStats>,
    pub file_path: Option<String>,
    pub pcap_writer: Option<Arc<std::sync::Mutex<crate::packet_capture::PcapWriter>>>,
    pub packet_buffer: crate::packet_capture::ring_buffer::SharedPacketBuffer,
    pub ip_counts: Arc<std::sync::Mutex<(HashMap<IpAddr, u64>, HashMap<IpAddr, u64>)>>,
    stop_flag: Arc<AtomicBool>,
    capture_handle: Option<thread::JoinHandle<()>>,

    // Pipeline mode fields
    capture_mode: CaptureMode,
    pipeline: Option<CapturePipeline>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum CaptureStatus {
    Stopped,
    Running,
    Paused,
    Error(String),
}

impl CaptureSession {
    /// Create a new capture session with default single-threaded mode.
    pub fn new(
        id: String,
        name: String,
        description: Option<String>,
        interface: String,
        filter_config: crate::packet_capture::FilterConfig,
        file_path: String,
    ) -> Result<Self> {
        Self::with_mode(
            id,
            name,
            description,
            interface,
            filter_config,
            file_path,
            CaptureMode::SingleThreaded,
        )
    }

    /// Create a new capture session with the specified capture mode.
    pub fn with_mode(
        id: String,
        name: String,
        description: Option<String>,
        interface: String,
        filter_config: crate::packet_capture::FilterConfig,
        file_path: String,
        capture_mode: CaptureMode,
    ) -> Result<Self> {
        let pcap_writer = Arc::new(std::sync::Mutex::new(
            crate::packet_capture::PcapWriter::new(&file_path)
                .context("Failed to create PCAP writer")?,
        ));

        Ok(Self {
            id,
            name,
            description,
            interface,
            filter_config,
            start_time: chrono::Utc::now(),
            status: CaptureStatus::Stopped,
            statistics: Arc::new(std::sync::Mutex::new(
                crate::packet_capture::CaptureStatistics::new(),
            )),
            live_stats: Arc::new(LiveStats::new()),
            file_path: Some(file_path),
            pcap_writer: Some(pcap_writer),
            // 2M packets for enterprise-scale live capture with lock-free access
            packet_buffer: Arc::new(Mutex::new(
                crate::packet_capture::ring_buffer::PacketRingBufferCompat::new(
                    crate::packet_capture::ring_buffer::DEFAULT_BUFFER_CAPACITY,
                ),
            )),
            ip_counts: Arc::new(std::sync::Mutex::new((HashMap::new(), HashMap::new()))),
            stop_flag: Arc::new(AtomicBool::new(false)),
            capture_handle: None,
            capture_mode,
            pipeline: None,
        })
    }

    /// Create a capture session backed by an externally-managed packet buffer
    /// (e.g. remote SSH capture). The session will NOT start a local pcap capture
    /// loop — packets are pushed into the buffer by the caller.
    pub fn new_external(
        id: String,
        name: String,
        description: Option<String>,
        interface: String,
        filter_config: crate::packet_capture::FilterConfig,
        file_path: Option<String>,
        packet_buffer: crate::packet_capture::ring_buffer::SharedPacketBuffer,
        pcap_writer: Arc<std::sync::Mutex<crate::packet_capture::PcapWriter>>,
    ) -> Self {
        Self {
            id,
            name,
            description,
            interface,
            filter_config,
            start_time: chrono::Utc::now(),
            status: CaptureStatus::Running,
            statistics: Arc::new(std::sync::Mutex::new(
                crate::packet_capture::CaptureStatistics::new(),
            )),
            live_stats: Arc::new(LiveStats::new()),
            file_path,
            pcap_writer: Some(pcap_writer),
            packet_buffer,
            ip_counts: Arc::new(std::sync::Mutex::new((HashMap::new(), HashMap::new()))),
            stop_flag: Arc::new(AtomicBool::new(false)),
            capture_handle: None,
            capture_mode: CaptureMode::SingleThreaded,
            pipeline: None,
        }
    }

    /// Get the current capture mode.
    pub fn capture_mode(&self) -> CaptureMode {
        self.capture_mode
    }

    /// Get pipeline statistics if using pipeline mode.
    pub fn pipeline_stats(&self) -> Option<PipelineStatsSnapshot> {
        self.pipeline.as_ref().map(|p| p.stats().snapshot())
    }

    /// Get a snapshot of the high-performance live statistics.
    pub fn live_stats_snapshot(&self) -> LiveStatsSnapshot {
        self.live_stats.update_rates();
        self.live_stats.snapshot()
    }

    /// Get a reference to the live stats for external updates.
    pub fn get_live_stats(&self) -> Arc<LiveStats> {
        Arc::clone(&self.live_stats)
    }

    /// Get packets from the active buffer (pipeline ring buffer or legacy packet_buffer).
    /// This is the unified accessor that works for both capture modes.
    pub fn get_packets_range(&self, offset: usize, limit: usize) -> Vec<PacketInfo> {
        if let Some(ref pipeline) = self.pipeline {
            pipeline.ring_buffer().get_range(offset, limit)
        } else {
            if let Ok(buffer) = self.packet_buffer.lock() {
                buffer.get_range(offset, limit)
            } else {
                Vec::new()
            }
        }
    }

    /// Get total packet count from the active buffer.
    pub fn get_packet_count(&self) -> usize {
        if let Some(ref pipeline) = self.pipeline {
            pipeline.ring_buffer().len()
        } else {
            if let Ok(buffer) = self.packet_buffer.lock() {
                buffer.len()
            } else {
                0
            }
        }
    }

    /// Get all packets from the active buffer.
    pub fn get_all_packets(&self) -> Vec<PacketInfo> {
        let count = self.get_packet_count();
        self.get_packets_range(0, count)
    }

    /// Get all packets as Arc references (zero-copy, no clone).
    /// Much faster for read-only operations like filtering.
    pub fn get_all_packets_arc(&self) -> Vec<std::sync::Arc<PacketInfo>> {
        let count = self.get_packet_count();
        if let Some(ref pipeline) = self.pipeline {
            pipeline.ring_buffer().get_range_arc(0, count)
        } else {
            if let Ok(buffer) = self.packet_buffer.lock() {
                buffer.get_range_arc(0, count)
            } else {
                Vec::new()
            }
        }
    }

    pub fn start(&mut self) -> Result<()> {
        let _span = tracing::info_span!(
            "capture.session_start",
            interface = %self.interface,
            mode = ?self.capture_mode,
        )
        .entered();
        tracing::info!(
            "start() called for session: {} (mode: {:?})",
            self.id,
            self.capture_mode
        );
        tracing::info!("Capture session started");

        if matches!(self.status, CaptureStatus::Running) {
            tracing::info!("Session already running, returning");
            return Ok(());
        }

        self.stop_flag.store(false, Ordering::Relaxed);
        self.status = CaptureStatus::Running;

        match self.capture_mode {
            CaptureMode::Pipeline => self.start_pipeline(),
            CaptureMode::SingleThreaded => self.start_single_threaded(),
        }
    }

    /// Start capture using the multi-threaded pipeline.
    fn start_pipeline(&mut self) -> Result<()> {
        tracing::info!("Starting multi-threaded pipeline capture...");

        let config = PipelineConfig {
            rtp_port_range: self.filter_config.rtp_port_range,
            ..PipelineConfig::default()
        };
        let parser_threads = config.parser_threads;

        let mut pipeline = CapturePipeline::new(config, self.filter_config.clone());

        let pcap_writer = self.pcap_writer.clone();
        let legacy_stats = Some(Arc::clone(&self.statistics));
        let live_stats = Some(Arc::clone(&self.live_stats));

        pipeline.start(
            self.interface.clone(),
            pcap_writer,
            legacy_stats,
            live_stats,
        )?;

        // Store pipeline's ring buffer reference for packet access
        // Note: The pipeline uses its own lock-free ring buffer internally
        tracing::info!("Pipeline started with {} parser threads", parser_threads);

        self.pipeline = Some(pipeline);
        tracing::info!("Pipeline capture started successfully");
        Ok(())
    }

    /// Start capture using the single-threaded loop (legacy mode).
    fn start_single_threaded(&mut self) -> Result<()> {
        tracing::info!("Setting up single-threaded capture...");

        let interface = self.interface.clone();
        let filter_config = self.filter_config.clone();
        let statistics = Arc::clone(&self.statistics);
        let live_stats = Arc::clone(&self.live_stats);
        let pcap_writer = Arc::clone(
            self.pcap_writer
                .as_ref()
                .context("PCAP writer not initialized")?,
        );
        let packet_buffer = Arc::clone(&self.packet_buffer);
        let ip_counts = Arc::clone(&self.ip_counts);
        let stop_flag = Arc::clone(&self.stop_flag);

        tracing::info!("Spawning capture thread for interface: {}", interface);

        let handle = thread::spawn(move || {
            tracing::info!("===== CAPTURE THREAD STARTED =====");
            tracing::info!("Thread ID: {:?}", std::thread::current().id());
            tracing::info!("Starting capture loop for interface: {}", interface);

            // Wrap capture loop in panic handler to prevent crashes
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                Self::capture_loop(
                    interface.clone(),
                    filter_config,
                    statistics,
                    live_stats,
                    pcap_writer,
                    packet_buffer,
                    ip_counts,
                    stop_flag,
                )
            }));

            match result {
                Ok(Ok(())) => {
                    tracing::info!("===== CAPTURE LOOP ENDED NORMALLY =====");
                }
                Ok(Err(e)) => {
                    tracing::error!("===== CAPTURE ERROR =====");
                    tracing::error!("Error on interface {}: {}", interface, e);
                }
                Err(_) => {
                    tracing::error!("===== CAPTURE PANIC CAUGHT =====");
                    tracing::error!("Capture thread panicked on interface: {}", interface);
                }
            }
        });

        self.capture_handle = Some(handle);
        tracing::info!("Capture thread spawned, returning from start()");
        Ok(())
    }

    pub fn stop(&mut self) -> Result<()> {
        let _span = tracing::info_span!("capture.session_stop").entered();
        tracing::info!(
            "stop() called for session: {} (mode: {:?})",
            self.id,
            self.capture_mode
        );
        tracing::info!("Capture session stopped");

        self.stop_flag.store(true, Ordering::Relaxed);
        self.status = CaptureStatus::Stopped;

        // Stop pipeline if in pipeline mode
        if let Some(ref mut pipeline) = self.pipeline {
            tracing::info!("Stopping pipeline...");
            if let Err(e) = pipeline.stop() {
                tracing::error!("Pipeline stop error: {}", e);
            }
            // Log final pipeline stats
            let stats = pipeline.stats().snapshot();
            tracing::info!("Final pipeline stats: captured={}, parsed={}, written={}, dropped_cap={}, dropped_parse={}", stats.packets_captured, stats.packets_parsed, stats.packets_written, stats.packets_dropped_capture, stats.packets_dropped_parser);
        }
        self.pipeline = None;

        // Stop single-threaded capture if running
        if let Some(handle) = self.capture_handle.take() {
            tracing::info!("Joining capture thread...");
            handle
                .join()
                .map_err(|_| anyhow::anyhow!("Failed to join capture thread"))?;
        }

        // Flush PCAP file to disk so it is readable immediately
        if let Some(ref writer) = self.pcap_writer {
            if let Ok(mut w) = writer.lock() {
                if let Err(e) = w.flush() {
                    tracing::error!("Warning: PCAP flush failed: {}", e);
                }
            }
        }

        // Log buffer state for diagnostics
        let buf_len = self.packet_buffer.lock().map(|b| b.len()).unwrap_or(0);
        tracing::info!(
            "Session {} stopped — buffer has {} packets, file={:?}",
            self.id,
            buf_len,
            self.file_path
        );
        tracing::info!(
            session_id = %self.id,
            buffer_packets = buf_len,
            "Final capture stats"
        );

        Ok(())
    }

    fn capture_loop(
        interface: String,
        filter_config: crate::packet_capture::FilterConfig,
        statistics: Arc<std::sync::Mutex<crate::packet_capture::CaptureStatistics>>,
        live_stats: Arc<LiveStats>,
        pcap_writer: Arc<std::sync::Mutex<crate::packet_capture::PcapWriter>>,
        packet_buffer: crate::packet_capture::ring_buffer::SharedPacketBuffer,
        _ip_counts: Arc<std::sync::Mutex<(HashMap<IpAddr, u64>, HashMap<IpAddr, u64>)>>,
        stop_flag: Arc<AtomicBool>,
    ) -> Result<()> {
        tracing::info!("===== ENTERING capture_loop() =====");
        tracing::info!("Opening capture device: {}", interface);

        // List all devices first for debugging
        tracing::info!("Listing all available devices...");
        let all_devices = Device::list().context("Failed to list devices")?;
        tracing::info!("Found {} devices:", all_devices.len());
        for (i, dev) in all_devices.iter().enumerate() {
            tracing::info!("Device {}: name='{}', desc='{:?}'", i, dev.name, dev.desc);
        }

        // Open device for capture
        let device = all_devices
            .into_iter()
            .find(|d| d.name == interface)
            .ok_or_else(|| {
                tracing::error!("ERROR: Interface '{}' not found in device list!", interface);
                anyhow::anyhow!("Interface not found: {}", interface)
            })?;

        tracing::info!(
            "Found matching device: name='{}', desc='{:?}'",
            device.name,
            device.desc
        );

        tracing::info!("Creating Capture object...");
        // Use a very short timeout (20ms) so we check stop_flag often and stop quickly when user clicks Stop
        let cap = Capture::from_device(device)
            .context("Failed to create Capture from device")?
            .promisc(true)
            .snaplen(65535)
            .timeout(20);

        tracing::info!("Opening capture device (this may require permissions)...");
        let mut cap = cap.open()
            .map_err(|e| {
                tracing::error!("ERROR: Failed to open capture device: {:?}", e);
                tracing::info!("This might be a permissions issue. On macOS, you may need to grant network access.");
                anyhow::anyhow!("Failed to activate capture: {:?}", e)
            })?;

        tracing::info!("===== CAPTURE DEVICE OPENED SUCCESSFULLY =====");

        // Get link layer type for cross-platform compatibility
        // Common types: 1=Ethernet (Linux/Windows), 113=Raw IP (macOS), 12=IEEE 802.11 (WiFi), 147=Loopback
        let link_layer_type = cap.get_datalink().0;
        tracing::info!(
            "Link layer type: {} (1=Ethernet, 12=802.11, 113=Raw IP, 147=Loop)",
            link_layer_type
        );

        // Log interface addresses for debugging
        // List all interfaces and their IPs to help user find the right one
        tracing::info!("=== Available interfaces and their IPs ===");
        if let Ok(all_devices) = Device::list() {
            for dev in all_devices {
                let ips: Vec<String> = dev
                    .addresses
                    .iter()
                    .map(|addr| addr.addr.to_string())
                    .collect();
                if !ips.is_empty() {
                    tracing::info!("{}: {:?}", dev.name, ips);
                }
            }
        }
        tracing::info!("==========================================");

        if let Some(device) = Device::list()
            .ok()
            .and_then(|devices| devices.into_iter().find(|d| d.name == interface))
        {
            tracing::info!(
                "Selected interface '{}' addresses: {:?}",
                interface,
                device.addresses
            );

            // List all IPs on this interface for debugging
            let interface_ips: Vec<String> = device
                .addresses
                .iter()
                .map(|addr| addr.addr.to_string())
                .collect();
            tracing::info!("Interface '{}' has IPs: {:?}", interface, interface_ips);

            // Check if REGISTER IP (10.235.136.25) is on this interface
            let has_register_ip = interface_ips.iter().any(|ip| ip.contains("10.235.136.25"));
            if !has_register_ip {
                tracing::warn!(
                    "⚠ WARNING: Interface '{}' does NOT have IP 10.235.136.25",
                    interface
                );
                tracing::info!("REGISTER packets are sent from 10.235.136.25:7061");
                tracing::info!("Look for an interface above that has 10.235.136.25");
            } else {
                tracing::info!(
                    "✓ Interface '{}' has REGISTER IP 10.235.136.25 - packets should be visible!",
                    interface
                );
            }
        }

        tracing::info!("Entering packet capture loop...");

        // Track when capture started for no-packet diagnostics
        let capture_started_at = std::time::Instant::now();
        let mut warned_no_packets = false;

        // Build BPF filter if needed
        let bpf_filter = Self::build_bpf_filter(&filter_config);
        if let Some(filter) = &bpf_filter {
            tracing::info!("Setting BPF filter: {}", filter);
            tracing::warn!("WARNING: BPF filter may exclude some packets. If you don't see expected packets, try removing protocol filters.");
            cap.filter(filter, true)
                .map_err(|e| anyhow::anyhow!("Failed to set BPF filter: {}", e))?;
            tracing::info!("BPF filter set successfully");
        } else {
            tracing::info!("No BPF filter - capturing ALL packets on interface");
        }

        let mut packet_count = 0u64;
        let mut last_stats_poll = std::time::Instant::now();
        loop {
            if stop_flag.load(Ordering::Relaxed) {
                tracing::info!("Stop flag set, exiting capture loop");
                break;
            }
            if last_stats_poll.elapsed() >= Duration::from_secs(1) {
                // Poll pcap counters periodically; this remains best-effort on platforms
                // where stats are unsupported.
                Self::update_pcap_stats(&mut cap, &statistics);
                last_stats_poll = std::time::Instant::now();
            }

            if packet_count % 100 == 0 && packet_count > 0 {
                tracing::info!("Still running, captured {} packets so far...", packet_count);
            }

            match cap.next_packet() {
                Ok(packet) => {
                    packet_count += 1;

                    // Process packet with error handling using new parser
                    let rtp_port_range = filter_config.rtp_port_range.or(Some((10000, 60000)));
                    let parser =
                        crate::packet_capture::packet_parser::PacketParser::with_rtp_port_range(
                            link_layer_type as u32,
                            rtp_port_range,
                        );
                    if packet_count <= 5 {
                        tracing::info!(
                            "Raw packet {}: len={}, first_bytes={:?}",
                            packet_count,
                            packet.len(),
                            &packet[..packet.len().min(20)]
                        );
                    }
                    if let Some(mut packet_info) = parser.parse(&packet, Some(packet_count)) {
                        packet_info.provenance =
                            crate::packet_capture::PacketProvenance::LocalCapture;
                        if packet_count <= 5 {
                            tracing::info!(
                                "✓ Packet {} parsed successfully: {}:{} -> {}:{}, protocol={:?}",
                                packet_count,
                                packet_info.src_ip,
                                packet_info.src_port,
                                packet_info.dst_ip,
                                packet_info.dst_port,
                                packet_info.protocol
                            );
                        }
                        // Log SIP packets for debugging (including UDP packets on SIP ports)
                        let is_sip_port = packet_info.dst_port == 5060
                            || packet_info.src_port == 5060
                            || packet_info.dst_port == 5061
                            || packet_info.src_port == 5061;
                        if matches!(packet_info.protocol, crate::packet_capture::Protocol::SIP) {
                            let matches_filter = filter_config.matches(&packet_info);
                            tracing::info!(
                                "✓ SIP PACKET DETECTED: {}:{} -> {}:{}, size={}, matches_filter={}",
                                packet_info.src_ip,
                                packet_info.src_port,
                                packet_info.dst_ip,
                                packet_info.dst_port,
                                packet_info.data.len(),
                                matches_filter
                            );
                            if !matches_filter {
                                tracing::info!(
                                    "✗ SIP packet FILTERED OUT by filter_config (protocols={:?})",
                                    filter_config.protocols
                                );
                            }
                        } else if is_sip_port
                            && matches!(packet_info.protocol, crate::packet_capture::Protocol::UDP)
                        {
                            // Log UDP packets on SIP ports that weren't detected as SIP
                            tracing::warn!("⚠ WARNING: UDP packet on SIP port {}:{} -> {}:{}, size={}, protocol={:?}", packet_info.src_ip, packet_info.src_port, packet_info.dst_ip, packet_info.dst_port, packet_info.data.len(), packet_info.protocol);
                            // Try to show first bytes for debugging
                            if packet_info.data.len() > 0 {
                                let preview = String::from_utf8_lossy(
                                    &packet_info.data[..packet_info.data.len().min(100)],
                                );
                                tracing::info!("First 100 bytes: {:?}", preview);
                            }
                        }

                        // Log all UDP packets on common SIP ports for debugging
                        if is_sip_port && packet_count % 10 == 0 {
                            tracing::info!(
                                "UDP packet on SIP port {}:{} -> {}:{}, protocol={:?}",
                                packet_info.src_ip,
                                packet_info.src_port,
                                packet_info.dst_ip,
                                packet_info.dst_port,
                                packet_info.protocol
                            );
                        }

                        // Single gate for relevance: only packets matching filter_config are stored, written to PCAP, or counted in stats.
                        // BPF (if set) only reduces kernel-captured packets; application-layer protocol and IP/port filters are applied here.
                        let matches_filter = filter_config.matches(&packet_info);
                        if packet_count <= 5 || packet_count % 100 == 0 {
                            tracing::info!("Packet {}: {}:{} -> {}:{}, protocol={:?}, matches_filter={}, filter_config.protocols={:?}", packet_count, packet_info.src_ip, packet_info.src_port, packet_info.dst_ip, packet_info.dst_port, packet_info.protocol, matches_filter, filter_config.protocols);
                        }
                        if matches_filter {
                            // Update legacy statistics (Mutex-based)
                            if let Ok(mut stats) = statistics.lock() {
                                stats.add_packet(&packet_info);
                            }

                            // Update high-performance statistics (lock-free DashMap)
                            live_stats.record(&packet_info);

                            // Write to PCAP
                            if let Ok(mut writer) = pcap_writer.lock() {
                                if let Err(e) = writer.write_packet(&packet_info) {
                                    tracing::error!("Failed to write packet: {}", e);
                                }
                            }

                            // Keeping full frame bytes for every packet in live memory can
                            // dramatically increase UI/render pressure at high packet rates.
                            // We retain raw frames only for SIP packets where per-packet
                            // re-export/debug workflows rely on frame-level fidelity.
                            if !matches!(packet_info.protocol, crate::packet_capture::Protocol::SIP)
                            {
                                packet_info.raw_frame = None;
                            }

                            // Store in packet buffer (ring buffer handles overflow automatically)
                            if let Ok(mut buffer) = packet_buffer.lock() {
                                // Log SIP packets when stored
                                if matches!(
                                    packet_info.protocol,
                                    crate::packet_capture::Protocol::SIP
                                ) {
                                    tracing::info!("📦 STORING SIP packet in buffer: {}:{} -> {}:{}, buffer_size={}", packet_info.src_ip, packet_info.src_port, packet_info.dst_ip, packet_info.dst_port, buffer.len());
                                }
                                buffer.push(packet_info);
                                let buffer_size = buffer.len();
                                if packet_count <= 10 || packet_count % 100 == 0 {
                                    tracing::info!(
                                        "Added packet {} to buffer, buffer size now: {}",
                                        packet_count,
                                        buffer_size
                                    );
                                }
                            } else {
                                tracing::error!("ERROR: Failed to lock packet buffer!");
                            }
                        } else {
                            // Log filtered packets for debugging (but only occasionally to avoid spam)
                            if packet_count % 50 == 0 || is_sip_port {
                                tracing::info!("Packet filtered out: {}:{} -> {}:{}, protocol={:?}, filter_config.protocols={:?}", packet_info.src_ip, packet_info.src_port, packet_info.dst_ip, packet_info.dst_port, packet_info.protocol, filter_config.protocols);
                            }
                        }
                    } else {
                        // Packet parsing failed
                        if packet_count <= 10 || packet_count % 1000 == 0 {
                            tracing::error!(
                                "✗ Packet {} failed to parse (link_layer_type={}, data_len={})",
                                packet_count,
                                link_layer_type,
                                packet.len()
                            );
                        }
                    }
                }
                Err(e) => {
                    // Check error type - timeout is normal and expected
                    let error_str = format!("{:?}", e);
                    if error_str.contains("timeout")
                        || error_str.contains("Timeout")
                        || error_str.contains("TimeoutExpired")
                    {
                        // Diagnose: if we've been running 3+ seconds with zero packets, something is wrong
                        if !warned_no_packets
                            && packet_count == 0
                            && capture_started_at.elapsed().as_secs() >= 3
                        {
                            warned_no_packets = true;
                            tracing::warn!(
                                "⚠ WARNING: No packets captured after {}s on interface '{}'",
                                capture_started_at.elapsed().as_secs(),
                                interface
                            );
                            tracing::info!(
                                "This may indicate a permissions issue or wrong interface."
                            );
                            tracing::info!("Try running with sudo, or check interface selection.");
                            // Try to get pcap stats for diagnostics
                            Self::update_pcap_stats(&mut cap, &statistics);
                        }
                        continue;
                    }
                    // Log other errors
                    if packet_count % 1000 == 0 || packet_count == 0 {
                        tracing::error!("Capture error (non-fatal): {:?}", e);
                    }
                    thread::sleep(Duration::from_millis(10));
                }
            }
        }
        // Final best-effort stats refresh before session exit.
        Self::update_pcap_stats(&mut cap, &statistics);

        Ok(())
    }

    fn update_pcap_stats(
        cap: &mut Capture<Active>,
        statistics: &Arc<std::sync::Mutex<crate::packet_capture::CaptureStatistics>>,
    ) {
        match cap.stats() {
            Ok(stats) => {
                tracing::info!(
                    "pcap stats: received={}, dropped={}, if_dropped={}",
                    stats.received,
                    stats.dropped,
                    stats.if_dropped
                );
                if let Ok(mut capture_stats) = statistics.lock() {
                    capture_stats.update_pcap_stats(
                        stats.received,
                        stats.dropped,
                        stats.if_dropped,
                        chrono::Utc::now(),
                    );
                }
            }
            Err(e) => {
                // Some capture backends do not support stats; do not fail capture.
                tracing::debug!("pcap stats unavailable: {:?}", e);
            }
        }
    }

    #[allow(dead_code)]
    fn parse_packet_old(
        packet: &pcap::Packet,
        link_layer_type: Option<u32>,
    ) -> Option<crate::packet_capture::PacketInfo> {
        // Parse packet based on link layer type for cross-platform compatibility
        // Common link layer types:
        // 1 = DLT_EN10MB (Ethernet) - Linux, Windows, most systems
        // 12 = DLT_IEEE802_11 (802.11 WiFi) - WiFi captures
        // 113 = DLT_RAW (Raw IP) - macOS, some BSD systems
        // 147 = DLT_NULL (Loopback) - Loopback interfaces

        if packet.data.len() < 20 {
            return None;
        }

        let ip_data = match link_layer_type {
            Some(1) | None => {
                // DLT_EN10MB (Ethernet) - Standard Ethernet frame
                // Ethernet header: 6 bytes dest MAC + 6 bytes src MAC + 2 bytes EtherType = 14 bytes
                if packet.data.len() >= 14 {
                    // Check for IPv4 EtherType (0x0800)
                    if packet.data[12] == 0x08 && packet.data[13] == 0x00 {
                        if packet.data.len() >= 34 && (packet.data[14] & 0xF0) == 0x40 {
                            &packet.data[14..]
                        } else {
                            return None;
                        }
                    } else {
                        // Not IPv4, skip
                        return None;
                    }
                } else {
                    return None;
                }
            }
            Some(113) => {
                // DLT_RAW (Raw IP) - Packet starts directly with IP header (macOS, BSD)
                if (packet.data[0] & 0xF0) == 0x40 {
                    &packet.data[..]
                } else {
                    return None;
                }
            }
            Some(147) => {
                // DLT_NULL (Loopback) - 4 byte address family + IP header
                // First 4 bytes are address family (AF_INET = 2 for IPv4)
                // On macOS, this is typically big-endian (0x00000002)
                if packet.data.len() >= 24 {
                    // Check if it's IPv4 (address family = 2)
                    // Try both endianness
                    let af_le = u32::from_le_bytes([
                        packet.data[0],
                        packet.data[1],
                        packet.data[2],
                        packet.data[3],
                    ]);
                    let af_be = u32::from_be_bytes([
                        packet.data[0],
                        packet.data[1],
                        packet.data[2],
                        packet.data[3],
                    ]);
                    if (af_le == 2 || af_be == 2) && (packet.data[4] & 0xF0) == 0x40 {
                        &packet.data[4..]
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
            Some(12) => {
                // DLT_IEEE802_11 (802.11 WiFi) - More complex, skip for now
                // Would need to parse 802.11 headers to find IP
                return None;
            }
            Some(other) => {
                // Unknown link layer type - try common strategies
                tracing::warn!(
                    "Unknown link layer type: {}, trying fallback parsing",
                    other
                );

                // Try raw IP first
                if (packet.data[0] & 0xF0) == 0x40 {
                    &packet.data[..]
                } else if packet.data.len() >= 14
                    && packet.data[12] == 0x08
                    && packet.data[13] == 0x00
                {
                    // Try Ethernet
                    if packet.data.len() >= 34 && (packet.data[14] & 0xF0) == 0x40 {
                        &packet.data[14..]
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
        };

        // Check for IPv4
        if ip_data.len() < 20 {
            return None;
        }

        let ip_version = (ip_data[0] >> 4) & 0x0F;
        if ip_version != 4 {
            return None;
        }

        // Extract IP addresses
        let src_ip = IpAddr::V4(std::net::Ipv4Addr::new(
            ip_data[12],
            ip_data[13],
            ip_data[14],
            ip_data[15],
        ));
        let dst_ip = IpAddr::V4(std::net::Ipv4Addr::new(
            ip_data[16],
            ip_data[17],
            ip_data[18],
            ip_data[19],
        ));

        // Extract protocol
        let ip_protocol = ip_data[9];

        // Handle different IP protocols
        let (src_port, dst_port, payload) = match ip_protocol {
            17 => {
                // UDP
                let ip_header_len = ((ip_data[0] & 0x0F) * 4) as usize;
                if ip_data.len() < ip_header_len + 8 {
                    return None;
                }
                let udp_data = &ip_data[ip_header_len..];
                let src_port = u16::from_be_bytes([udp_data[0], udp_data[1]]);
                let dst_port = u16::from_be_bytes([udp_data[2], udp_data[3]]);
                let payload = if udp_data.len() >= 8 {
                    udp_data[8..].to_vec()
                } else {
                    return None;
                };
                (src_port, dst_port, payload)
            }
            6 => {
                // TCP
                let ip_header_len = ((ip_data[0] & 0x0F) * 4) as usize;
                if ip_data.len() < ip_header_len + 20 {
                    return None;
                }
                let tcp_data = &ip_data[ip_header_len..];
                let src_port = u16::from_be_bytes([tcp_data[0], tcp_data[1]]);
                let dst_port = u16::from_be_bytes([tcp_data[2], tcp_data[3]]);
                let data_offset = ((tcp_data[12] >> 4) & 0x0F) * 4;
                let payload = if tcp_data.len() >= data_offset as usize {
                    tcp_data[data_offset as usize..].to_vec()
                } else {
                    Vec::new()
                };
                (src_port, dst_port, payload)
            }
            1 => {
                // ICMP
                return Some(crate::packet_capture::PacketInfo {
                    timestamp: chrono::DateTime::from_timestamp(
                        packet.header.ts.tv_sec,
                        (packet.header.ts.tv_usec as u32) * 1000,
                    )
                    .unwrap_or_else(|| chrono::Utc::now()),
                    src_ip: IpAddr::V4(std::net::Ipv4Addr::new(
                        ip_data[12],
                        ip_data[13],
                        ip_data[14],
                        ip_data[15],
                    )),
                    dst_ip: IpAddr::V4(std::net::Ipv4Addr::new(
                        ip_data[16],
                        ip_data[17],
                        ip_data[18],
                        ip_data[19],
                    )),
                    src_port: 0,
                    dst_port: 0,
                    protocol: crate::packet_capture::Protocol::ICMP,
                    size: ip_data.len().saturating_sub(20),
                    frame_length: packet.data.len(),
                    raw_frame: Some(packet.data.to_vec()),
                    data: if ip_data.len() > 20 {
                        ip_data[20..].to_vec()
                    } else {
                        Vec::new()
                    },
                    decoded: protocol_decoder::decode_packet(
                        packet.data,
                        link_layer_type,
                        None,
                        None,
                    )
                    .ok(),
                    fidelity: crate::packet_capture::PacketFidelity::Authoritative,
                    provenance: crate::packet_capture::PacketProvenance::LocalCapture,
                });
            }
            _ => {
                // Other IP protocols - return with generic info
                let ip_header_len = ((ip_data[0] & 0x0F) * 4) as usize;
                return Some(crate::packet_capture::PacketInfo {
                    timestamp: chrono::DateTime::from_timestamp(
                        packet.header.ts.tv_sec,
                        (packet.header.ts.tv_usec as u32) * 1000,
                    )
                    .unwrap_or_else(|| chrono::Utc::now()),
                    src_ip: IpAddr::V4(std::net::Ipv4Addr::new(
                        ip_data[12],
                        ip_data[13],
                        ip_data[14],
                        ip_data[15],
                    )),
                    dst_ip: IpAddr::V4(std::net::Ipv4Addr::new(
                        ip_data[16],
                        ip_data[17],
                        ip_data[18],
                        ip_data[19],
                    )),
                    src_port: 0,
                    dst_port: 0,
                    protocol: crate::packet_capture::Protocol::Other,
                    size: ip_data.len().saturating_sub(ip_header_len),
                    frame_length: packet.data.len(),
                    raw_frame: Some(packet.data.to_vec()),
                    data: if ip_data.len() > ip_header_len {
                        ip_data[ip_header_len..].to_vec()
                    } else {
                        Vec::new()
                    },
                    decoded: protocol_decoder::decode_packet(
                        packet.data,
                        link_layer_type,
                        None,
                        None,
                    )
                    .ok(),
                    fidelity: crate::packet_capture::PacketFidelity::Authoritative,
                    provenance: crate::packet_capture::PacketProvenance::LocalCapture,
                });
            }
        };

        // Decode packet (full protocol decoding) - use full packet data
        let decoded =
            protocol_decoder::decode_packet(packet.data, link_layer_type, None, None).ok();

        // Detect protocol using decoded application layer and transport protocol
        // Priority: RTP/RTCP (binary, structured) > SIP (text-based) > HTTP/DNS > TCP/UDP > fallback
        let protocol_type = if let Some(ref decoded_packet) = decoded {
            match &decoded_packet.application {
                protocol_decoder::ApplicationLayer::Rtp(_) => crate::packet_capture::Protocol::RTP,
                protocol_decoder::ApplicationLayer::Srtp(_) => {
                    crate::packet_capture::Protocol::SRTP
                }
                protocol_decoder::ApplicationLayer::Rtcp(_) => {
                    crate::packet_capture::Protocol::RTCP
                }
                protocol_decoder::ApplicationLayer::Sip(_) => {
                    // SIP was successfully parsed - this is definitely SIP
                    crate::packet_capture::Protocol::SIP
                }
                protocol_decoder::ApplicationLayer::SipOverWs { .. } => {
                    // SIP over WebSocket - still SIP protocol
                    crate::packet_capture::Protocol::SIP
                }
                protocol_decoder::ApplicationLayer::WebSocket(_) => {
                    // Generic WebSocket frame - treat as TCP
                    crate::packet_capture::Protocol::TCP
                }
                protocol_decoder::ApplicationLayer::Dns(_) => {
                    // DNS was successfully parsed - this is definitely DNS
                    crate::packet_capture::Protocol::DNS
                }
                protocol_decoder::ApplicationLayer::T38(_) => {
                    // T.38 UDPTL (FAX over IP) was successfully parsed
                    crate::packet_capture::Protocol::FAX
                }
                protocol_decoder::ApplicationLayer::Unknown(_) => {
                    // Detect based on transport protocol and port/content
                    if ip_protocol == 6 {
                        // TCP - check for HTTP/HTTPS
                        if dst_port == 80 || src_port == 80 {
                            if Self::is_http(&payload) {
                                crate::packet_capture::Protocol::HTTP
                            } else {
                                crate::packet_capture::Protocol::TCP
                            }
                        } else if dst_port == 443 || src_port == 443 {
                            crate::packet_capture::Protocol::HTTPS
                        } else {
                            crate::packet_capture::Protocol::TCP
                        }
                    } else {
                        // UDP - check for DNS and other protocols
                        if dst_port == 53 || src_port == 53 {
                            if Self::is_dns(&payload) {
                                crate::packet_capture::Protocol::DNS
                            } else {
                                crate::packet_capture::Protocol::UDP
                            }
                        } else {
                            // Fall back to payload-based detection
                            let detected =
                                crate::packet_capture::Protocol::detect(dst_port, &payload);
                            if detected != crate::packet_capture::Protocol::Other {
                                detected
                            } else {
                                crate::packet_capture::Protocol::UDP
                            }
                        }
                    }
                }
            }
        } else {
            // If decoding failed, detect based on IP protocol and ports
            if ip_protocol == 6 {
                // TCP
                if dst_port == 80 || src_port == 80 {
                    crate::packet_capture::Protocol::HTTP
                } else if dst_port == 443 || src_port == 443 {
                    crate::packet_capture::Protocol::HTTPS
                } else {
                    crate::packet_capture::Protocol::TCP
                }
            } else if ip_protocol == 17 {
                // UDP
                if dst_port == 53 || src_port == 53 {
                    crate::packet_capture::Protocol::DNS
                } else {
                    // Try protocol detection (SIP, RTP, RTCP, etc.)
                    let detected = crate::packet_capture::Protocol::detect(dst_port, &payload);
                    if detected != crate::packet_capture::Protocol::Other {
                        detected
                    } else {
                        // Only default to UDP if we truly can't identify it
                        // This preserves the transport protocol (UDP) when application layer is unknown
                        crate::packet_capture::Protocol::UDP
                    }
                }
            } else {
                crate::packet_capture::Protocol::Other
            }
        };

        // Convert pcap timestamp to chrono
        // pcap uses timeval: tv_sec (seconds) and tv_usec (microseconds)
        let timestamp = chrono::DateTime::from_timestamp(
            packet.header.ts.tv_sec,
            (packet.header.ts.tv_usec as u32) * 1000, // Convert microseconds to nanoseconds (multiply by 1000)
        )
        .unwrap_or_else(|| chrono::Utc::now());

        Some(crate::packet_capture::PacketInfo {
            timestamp,
            src_ip,
            dst_ip,
            src_port,
            dst_port,
            protocol: protocol_type,
            size: payload.len(),
            frame_length: packet.data.len(),
            raw_frame: Some(packet.data.to_vec()),
            data: payload,
            decoded,
            fidelity: crate::packet_capture::PacketFidelity::Authoritative,
            provenance: crate::packet_capture::PacketProvenance::LocalCapture,
        })
    }

    fn is_http(data: &[u8]) -> bool {
        if data.len() < 4 {
            return false;
        }
        // HTTP requests start with methods, responses start with "HTTP/"
        let start = String::from_utf8_lossy(&data[..data.len().min(10)]);
        let start_upper = start.to_uppercase();
        start_upper.starts_with("GET ")
            || start_upper.starts_with("POST ")
            || start_upper.starts_with("PUT ")
            || start_upper.starts_with("DELETE ")
            || start_upper.starts_with("HEAD ")
            || start_upper.starts_with("OPTIONS ")
            || start_upper.starts_with("PATCH ")
            || start_upper.starts_with("HTTP/")
    }

    fn is_dns(data: &[u8]) -> bool {
        if data.len() < 12 {
            return false;
        }
        // DNS packets have specific structure:
        // - Transaction ID (2 bytes)
        // - Flags (2 bytes) - QR bit in bit 7 of flags[0]
        // - Questions (2 bytes)
        // - Answer RRs (2 bytes)
        // - Authority RRs (2 bytes)
        // - Additional RRs (2 bytes)
        // Check that it looks like DNS (reasonable question/answer counts)
        let questions = u16::from_be_bytes([data[4], data[5]]);
        let answers = u16::from_be_bytes([data[6], data[7]]);
        // DNS typically has reasonable counts (not thousands)
        questions <= 100 && answers <= 1000
    }

    /// Build BPF filter from FilterConfig.
    /// Returns None if no filter specified → capture all (SIP/RTP are primarily UDP; INVITE and BYE will be in stream).
    fn build_bpf_filter(filter: &crate::packet_capture::FilterConfig) -> Option<String> {
        if filter.protocols.is_empty()
            && filter.src_ports.is_empty()
            && filter.dst_ports.is_empty()
            && filter.port_ranges.is_empty()
        {
            return None;
        }

        let mut protocol_parts = Vec::new();
        let mut port_parts = Vec::new();

        // VOIP is primarily UDP (SIP on 5060, RTP/RTCP on dynamic ports). Map SIP/RTP/RTCP to "udp" for BPF.
        if !filter.protocols.is_empty() {
            let mut protocols = std::collections::HashSet::new();
            let mut voip_ports = Vec::new();

            let has_sip = filter
                .protocols
                .iter()
                .any(|p| p.eq_ignore_ascii_case("sip"));
            let has_rtp = filter
                .protocols
                .iter()
                .any(|p| p.eq_ignore_ascii_case("rtp"));
            let has_rtcp = filter
                .protocols
                .iter()
                .any(|p| p.eq_ignore_ascii_case("rtcp"));
            let has_fax = filter
                .protocols
                .iter()
                .any(|p| p.eq_ignore_ascii_case("fax"));

            // Convert all protocols to BPF equivalents
            for protocol in &filter.protocols {
                let bpf_proto = match protocol.to_lowercase().as_str() {
                    "sip" | "rtp" | "rtcp" | "dns" | "udp" => "udp",
                    "tcp" | "http" | "https" => "tcp",
                    "icmp" => "icmp",
                    "arp" => "arp",
                    "fax" => "udp", // FAX/T.38 uses UDP
                    _ => "udp",     // Default to UDP
                };
                protocols.insert(bpf_proto.to_string());
            }

            // IMPORTANT: SIP can use ANY port (5060, 5061, 5062, 7060, 7061, etc.).
            // REGISTER, INVITE, and other SIP methods often use non-standard ports.
            // When SIP is selected, we capture ALL UDP traffic and rely on content-based
            // SIP detection (has_sip_signature) to identify SIP packets on any port.
            //
            // RTP/RTCP also use dynamic ports (e.g. 10000–60000).
            // FAX/T.38 uses specific ports but we include them for convenience.
            //
            // Only restrict by port for FAX-only captures (no SIP, RTP, or RTCP).
            if !has_sip && !has_rtp && !has_rtcp {
                if has_fax {
                    voip_ports.push("32896".to_string()); // T.38 FAX
                    voip_ports.push("4000".to_string()); // T.38 UDPTL
                }
            }
            // When SIP/RTP/RTCP is selected, voip_ports stays empty → all UDP captured

            protocol_parts.extend(protocols);

            for port in voip_ports {
                port_parts.push(format!("port {}", port));
            }
        }

        // Build port filter
        for port in &filter.src_ports {
            port_parts.push(format!("port {}", port));
        }
        for port in &filter.dst_ports {
            port_parts.push(format!("port {}", port));
        }
        for (min, max) in &filter.port_ranges {
            port_parts.push(format!("portrange {}-{}", min, max));
        }

        // Combine filters
        // IMPORTANT: BPF filters work at kernel level and can only filter by transport protocol and ports
        // Application-layer protocol detection (SIP/RTP/RTCP/FAX) happens after capture
        match (protocol_parts.is_empty(), port_parts.is_empty()) {
            (true, true) => None, // No filter - capture everything
            (false, true) => {
                // Only protocol filter - capture all packets of these transport protocols
                if protocol_parts.len() == 1 {
                    Some(protocol_parts[0].clone())
                } else {
                    // Multiple protocols - use OR
                    Some(format!("({})", protocol_parts.join(" or ")))
                }
            }
            (true, false) => {
                // Only port filter - include both UDP and TCP (SIP/RTP are primarily UDP)
                Some(format!("(udp or tcp) and ({})", port_parts.join(" or ")))
            }
            (false, false) => {
                // Both protocol and port filters
                let proto_expr: String = if protocol_parts.len() == 1 {
                    protocol_parts
                        .iter()
                        .next()
                        .unwrap_or(&"UDP".to_string())
                        .clone()
                } else {
                    // Multiple protocols - use OR
                    let parts: Vec<String> = protocol_parts.iter().cloned().collect();
                    format!("({})", parts.join(" or "))
                };
                // Combine: (protocol) and (port1 or port2 or ...)
                Some(format!("{} and ({})", proto_expr, port_parts.join(" or ")))
            }
        }
    }
}

/// Return the pcap device name that has the given IP address (e.g. the interface used for SIP).
/// Normalizes IP by stripping IPv6 scope (e.g. %en0). Returns None if no interface has that IP.
pub fn get_interface_for_ip(ip: &str) -> Result<Option<String>> {
    let want = ip.split('%').next().unwrap_or(ip).trim();
    if want.is_empty() {
        return Ok(None);
    }
    let devices = Device::list().context("Failed to list devices")?;
    for d in devices {
        for addr in &d.addresses {
            let a = addr.addr.to_string();
            let a_normalized = a.split('%').next().unwrap_or(&a).trim();
            if a_normalized == want {
                return Ok(Some(d.name.clone()));
            }
            // Also match without port (addr might be "1.2.3.4:0" or "1.2.3.4")
            if let Some(ip_part) = a_normalized.split(':').next() {
                if ip_part == want {
                    return Ok(Some(d.name.clone()));
                }
            }
        }
    }
    Ok(None)
}

pub fn list_interfaces() -> Result<Vec<NetworkInterface>> {
    let default_iface = default_net::get_default_interface().ok();
    let default_addrs: Vec<String> = default_iface
        .as_ref()
        .map(|i| {
            i.ipv4
                .iter()
                .map(|n| std::net::IpAddr::V4(n.addr).to_string())
                .chain(
                    i.ipv6
                        .iter()
                        .map(|n| std::net::IpAddr::V6(n.addr).to_string()),
                )
                .collect()
        })
        .unwrap_or_default();
    let default_name = default_iface.as_ref().map(|i| i.name.clone());
    let normalize_addr = |addr: &str| -> String {
        addr.split('%')
            .next()
            .unwrap_or(addr)
            .trim()
            .to_ascii_lowercase()
    };
    let normalized_default_addrs: Vec<String> = default_addrs
        .iter()
        .map(|addr| normalize_addr(addr))
        .collect();
    let devices = Device::list().context("Failed to list network devices")?;
    let mut list: Vec<NetworkInterface> = devices
        .into_iter()
        .map(|d| {
            let is_default_name = default_name.as_ref().map_or(false, |n| n == &d.name);
            let pcap_addrs: Vec<String> = d.addresses.iter().map(|a| a.addr.to_string()).collect();
            let normalized_pcap_addrs: Vec<String> =
                pcap_addrs.iter().map(|addr| normalize_addr(addr)).collect();
            let is_default_addr = normalized_pcap_addrs.iter().any(|addr| {
                normalized_default_addrs
                    .iter()
                    .any(|default_addr| default_addr == addr)
            });
            let is_default = is_default_name || is_default_addr;
            let addresses = if pcap_addrs.is_empty() && is_default && !default_addrs.is_empty() {
                default_addrs.clone()
            } else {
                pcap_addrs
            };
            NetworkInterface {
                name: d.name.clone(),
                description: d.desc.unwrap_or_else(|| d.name.clone()),
                addresses,
                is_default,
            }
        })
        .collect();
    if let (Some(ref def), Some(name)) = (default_iface, default_name) {
        let in_list = list.iter().any(|n| n.name == *name);
        if !in_list && !default_addrs.is_empty() {
            list.push(NetworkInterface {
                name: name.clone(),
                description: def.description.clone().unwrap_or_else(|| name.clone()),
                addresses: default_addrs,
                is_default: true,
            });
        }
    }
    Ok(list)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NetworkInterface {
    pub name: String,
    pub description: String,
    pub addresses: Vec<String>,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}
