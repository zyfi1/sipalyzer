//! Fax Media Handler
//!
//! This module handles RTP audio I/O for G.711 fax passthrough mode.
//! It bridges SpanDSP's audio processing with the RTP stream.
//!
//! ## RTP Timing
//! Fax audio uses strict 20ms intervals (160 samples at 8kHz).
//! Uses Instant-based timing to maintain accurate pacing.

use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;

use tauri::{AppHandle, Emitter};
use super::session::FaxSession;

// Re-export the existing G711Codec from the softphone module
pub use crate::softphone::codecs::G711Codec;

/// Generate a pseudo-random u32 for RTP sequence/timestamp initialization
fn random_u32() -> u32 {
    let mut hasher = DefaultHasher::new();
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .hash(&mut hasher);
    std::thread::current().id().hash(&mut hasher);
    hasher.finish() as u32
}

/// Fax media result
pub struct FaxMediaResult {
    pub success: bool,
    pub pages_sent: u32,
    pub error: Option<String>,
    pub remote_station_id: Option<String>,
    pub negotiated_baud_rate: Option<u32>,
    pub ecm_used: Option<bool>,
}

/// Reordering jitter buffer for fax RTP.
///
/// Fax is much less tolerant of packet loss than voice. Instead of dropping
/// late (out-of-order) packets, we insert them at the correct position in the
/// buffer using a small reorder window. Only truly ancient packets (more than
/// `reorder_window` frames behind) are dropped.
struct JitterBuffer {
    /// Buffered samples waiting to be consumed
    buffer: Vec<i16>,
    /// Maximum buffer depth in samples
    max_depth: usize,
    /// Expected RTP sequence number
    expected_seq: u16,
    /// Started tracking
    started: bool,
    /// Packets received out-of-order and successfully reinserted
    reorder_count: u32,
    /// Packets too old to reorder (truly dropped)
    drop_count: u32,
    /// How many frames (20ms each) of reorder window we allow
    reorder_window_frames: i16,
    /// Pending out-of-order packets: (seq, samples)
    pending: Vec<(u16, Vec<i16>)>,
}

impl JitterBuffer {
    fn new(max_depth_ms: u32) -> Self {
        let max_samples = (max_depth_ms as usize * 8000) / 1000; // 8kHz sample rate
        Self {
            buffer: Vec::with_capacity(max_samples),
            max_depth: max_samples,
            expected_seq: 0,
            started: false,
            reorder_count: 0,
            drop_count: 0,
            reorder_window_frames: 10, // Allow up to 10 frames (200ms) of reorder
            pending: Vec::new(),
        }
    }

    /// Add decoded samples from an RTP packet
    fn push(&mut self, seq: u16, samples: &[i16]) {
        if !self.started {
            self.started = true;
            self.expected_seq = seq;
        }

        let diff = seq.wrapping_sub(self.expected_seq) as i16;

        if diff < -self.reorder_window_frames {
            // Truly ancient -- drop
            self.drop_count += 1;
            return;
        }

        if diff < 0 {
            // Late but within reorder window -- try to insert at correct position.
            // The samples would have been where silence was inserted, so we just
            // append to buffer (SpanDSP handles the minor timing jitter).
            self.reorder_count += 1;
            let space = self.max_depth.saturating_sub(self.buffer.len());
            let to_add = samples.len().min(space);
            self.buffer.extend_from_slice(&samples[..to_add]);
            return;
        }

        if diff == 0 {
            // Exactly the expected packet
            self.expected_seq = seq.wrapping_add(1);
            let space = self.max_depth.saturating_sub(self.buffer.len());
            let to_add = samples.len().min(space);
            self.buffer.extend_from_slice(&samples[..to_add]);
            // Flush any pending packets that are now in order
            self.flush_pending();
            return;
        }

        // diff > 0: future packet -- fill gap with silence, queue for later if gap > 1
        if diff == 1 {
            // One frame gap -- insert silence for the missing frame then add this one
            let fill = (160_usize).min(self.max_depth.saturating_sub(self.buffer.len()));
            self.buffer.extend(std::iter::repeat(0i16).take(fill));
            self.expected_seq = seq.wrapping_add(1);
            let space = self.max_depth.saturating_sub(self.buffer.len());
            let to_add = samples.len().min(space);
            self.buffer.extend_from_slice(&samples[..to_add]);
            self.flush_pending();
        } else {
            // Larger gap -- fill silence for all missing frames
            let gap_samples = ((diff as usize).saturating_sub(1)) * 160;
            let fill = gap_samples.min(self.max_depth.saturating_sub(self.buffer.len()));
            self.buffer.extend(std::iter::repeat(0i16).take(fill));
            self.expected_seq = seq.wrapping_add(1);
            let space = self.max_depth.saturating_sub(self.buffer.len());
            let to_add = samples.len().min(space);
            self.buffer.extend_from_slice(&samples[..to_add]);
            self.flush_pending();
        }
    }

    /// Flush pending packets that are now in sequence
    fn flush_pending(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        self.pending.sort_by_key(|(seq, _)| *seq);
        while let Some(idx) = self.pending.iter().position(|(seq, _)| *seq == self.expected_seq) {
            let (_, samples) = self.pending.remove(idx);
            self.expected_seq = self.expected_seq.wrapping_add(1);
            let space = self.max_depth.saturating_sub(self.buffer.len());
            let to_add = samples.len().min(space);
            self.buffer.extend_from_slice(&samples[..to_add]);
        }
    }

    /// Consume samples from the buffer
    fn consume(&mut self, count: usize) -> Vec<i16> {
        if self.buffer.len() >= count {
            self.buffer.drain(..count).collect()
        } else {
            // Not enough data - return what we have plus silence
            let mut result = std::mem::take(&mut self.buffer);
            result.resize(count, 0);
            result
        }
    }

    /// Get current buffer depth in samples
    fn depth(&self) -> usize {
        self.buffer.len()
    }
}

/// Run fax transmission via the media engine (G.711 mode).
///
/// Uses the proven media engine RTP path (same as softphone) for reliable NAT traversal.
/// Call start_media, set_fax_send_mode, register_fax_receive, then run SpanDSP loop.
pub fn run_fax_via_media_engine(
    session: &mut FaxSession,
    call_id: &str,
    local_rtp_port: u16,
    remote_rtp_address: &str,
    remote_rtp_port: u16,
    codec: G711Codec,
    payload_type: u8,
    shutdown: Arc<AtomicBool>,
    app: Option<AppHandle>,
    job_id: Option<String>,
) -> Result<FaxMediaResult, String> {
    use crate::softphone::media_engine;

    media_engine::start_media(
        call_id.to_string(),
        local_rtp_port,
        remote_rtp_address,
        remote_rtp_port,
        None,
        None,
        40,
        200,
        None,
        Some(payload_type),
        None,
        1.0,
    )?;

    media_engine::set_fax_send_mode(call_id, true)?;

    let (tx_fax, rx_fax) = mpsc::sync_channel::<Vec<i16>>(256);
    media_engine::register_fax_receive(call_id, tx_fax)?;

    session.start()?;
    tracing::info!("Session started via media engine (call_id={})", &call_id[..call_id.len().min(12)]);

    let start_time = Instant::now();
    let mut tx_samples = vec![0i16; 160];
    let max_duration = Duration::from_secs(120);
    let frame_interval = Duration::from_millis(20);
    let rx_inactivity_timeout = Duration::from_secs(30);
    let mut next_frame_time = Instant::now();
    let mut last_rx_time = Instant::now();
    let mut last_stats_emit = Instant::now();
    let mut last_log_time = Instant::now();
    let stats_emit_interval = Duration::from_secs(2);
    let mut loop_err: Option<String> = None;
    let mut packets_received: u64 = 0;
    let mut one_way_warned = false;
    let mut frames_sent: u64 = 0;

    while !shutdown.load(Ordering::Relaxed) && !session.is_completed() {
        if start_time.elapsed() > max_duration {
            loop_err = Some("Fax transmission timeout (2 minutes)".to_string());
            break;
        }

        if last_rx_time.elapsed() > rx_inactivity_timeout {
            loop_err = Some(format!(
                "No RTP packets received for {}s -- remote unresponsive",
                rx_inactivity_timeout.as_secs()
            ));
            break;
        }

        let now = Instant::now();
        if now >= next_frame_time {
            next_frame_time = now + frame_interval;
            frames_sent += 1;

            let tx_count = match session.get_audio(&mut tx_samples) {
                Ok(n) => n,
                Err(e) => {
                    loop_err = Some(e.to_string());
                    break;
                }
            };
            if tx_count > 0 {
                let encoded = encode_g711(&tx_samples[..tx_count], codec);
                if let Err(e) = media_engine::push_send_audio(call_id, encoded) {
                    loop_err = Some(format!("push_send_audio: {}", e));
                    break;
                }
            }

            let mut got_rx_this_frame = false;
            while let Ok(pcm) = rx_fax.try_recv() {
                if !pcm.is_empty() {
                    packets_received += 1;
                    last_rx_time = Instant::now();
                    got_rx_this_frame = true;
                    if let Err(e) = session.process_audio(&pcm) {
                        loop_err = Some(e.to_string());
                        break;
                    }
                }
            }
            if loop_err.is_some() {
                break;
            }
            // Always feed silence when no RX data this frame so T.30 timers advance
            if !got_rx_this_frame {
                if let Err(e) = session.fill_audio(160) {
                    loop_err = Some(e.to_string());
                    break;
                }
            }

            // One-way media detection
            if !one_way_warned && frames_sent > 100 && packets_received < 3 && start_time.elapsed() > Duration::from_secs(5) {
                one_way_warned = true;
                tracing::warn!("WARNING: One-way RTP detected! tx={} rx={} after {:.0}s. NAT/firewall may be blocking return traffic",
                    frames_sent, packets_received, start_time.elapsed().as_secs_f32());
                if let (Some(ref app_handle), Some(ref jid)) = (&app, &job_id) {
                    let _ = app_handle.emit("fax:send_progress", serde_json::json!({
                        "jobId": jid,
                        "phase": "warning",
                        "warning": "One-way media detected -- return RTP not reaching us",
                        "detail": format!("tx={} rx={} after {:.0}s -- NAT/firewall may be blocking return traffic",
                            frames_sent, packets_received, start_time.elapsed().as_secs_f32()),
                        "messageDirection": "info",
                    }));
                }
            }

            if last_stats_emit.elapsed() >= stats_emit_interval {
                if let (Some(ref app_handle), Some(ref jid)) = (&app, &job_id) {
                    let _ = app_handle.emit("fax:send_progress", serde_json::json!({
                        "jobId": jid,
                        "phase": "g711_page",
                        "elapsedSecs": start_time.elapsed().as_secs(),
                    }));
                }
                last_stats_emit = Instant::now();
            }

            // Periodic stats logging
            let log_interval = if start_time.elapsed() < Duration::from_secs(5) {
                Duration::from_secs(2)
            } else {
                Duration::from_secs(10)
            };
            if last_log_time.elapsed() > log_interval {
                tracing::info!("Stats: tx_frames={}, rx={}, elapsed={:.1}s, completed={}",
                    frames_sent, packets_received, start_time.elapsed().as_secs_f32(), session.is_completed());
                last_log_time = Instant::now();
            }
        }

        std::thread::sleep(Duration::from_millis(1));
    }

    let _ = media_engine::unregister_fax_receive(call_id);
    let _ = media_engine::stop_media(call_id);

    if let Some(e) = loop_err {
        return Err(e);
    }

    let fax_result = session.stop();
    Ok(FaxMediaResult {
        success: fax_result.success,
        pages_sent: fax_result.pages_sent,
        error: fax_result.error,
        remote_station_id: fax_result.remote_station_id,
        negotiated_baud_rate: fax_result.negotiated_baud_rate,
        ecm_used: fax_result.ecm_used,
    })
}

/// Run fax transmission over RTP (G.711 mode) -- direct path with own socket.
///
/// Uses a dedicated socket with tight send/receive loop (no jitter buffer, no audio
/// devices) which matches fax T.30 timing requirements better than the media engine.
pub fn run_fax_over_rtp(
    session: &mut FaxSession,
    local_rtp_port: u16,
    remote_addr: SocketAddr,
    codec: G711Codec,
    shutdown: Arc<AtomicBool>,
    app: Option<AppHandle>,
    job_id: Option<String>,
    existing_socket: Option<UdpSocket>,
) -> Result<FaxMediaResult, String> {
    // Bind socket FRESH (matching the softphone's start_media() approach).
    // The softphone binds after 200 OK and it works. We do the same.
    let socket = if let Some(sock) = existing_socket {
        tracing::info!("Using provided RTP socket (port {})", local_rtp_port);
        sock
    } else {
        tracing::info!("Binding fresh RTP port {} (legacy path)...", local_rtp_port);
        UdpSocket::bind(format!("0.0.0.0:{}", local_rtp_port))
            .map_err(|e| format!("Failed to bind RTP port {}: {} (port in use?)", local_rtp_port, e))?
    };

    // Socket config: blocking mode with short read timeout.
    // Note: Softphone uses 100ms timeout but has SEPARATE threads for send/receive.
    // Fax has a SINGLE-threaded loop with 20ms frame pacing, so we need a short
    // timeout to avoid blocking the TX path. 1ms is enough to poll for data.
    let _ = socket.set_nonblocking(false);
    socket.set_read_timeout(Some(Duration::from_millis(1)))
        .map_err(|e| format!("Failed to set socket timeout: {}", e))?;

    // -- RTP header fields -- match softphone ----------------------------
    // Softphone uses DEFAULT_SSRC = 1 and starts seq/timestamp at 0.
    // We do the same to be identical from the SBC's perspective.
    let ssrc: u32 = 1; // Same as softphone DEFAULT_SSRC
    let mut rtp_seq: u16 = 0;
    let mut rtp_timestamp: u32 = 0;

    // -- NAT traversal: STUN + hole-punch + RX confirmation ------------
    //
    // Three-step approach to ensure bidirectional RTP before starting fax:
    //
    // 1) Fire STUN binding requests (fire-and-forget) to open broad NAT mappings.
    //    With full/restricted cone NAT, this opens the port for ANY inbound source,
    //    which helps even if the SBC sends from a different IP than the SDP claims.
    //    We don't block for responses -- the outbound UDP is what opens the mapping.
    //
    // 2) Hole-punch silence to the SBC to create the specific NAT mapping for the
    //    media path. SBC comedia latches to our source address:port.
    //
    // 3) Keep sending silence every 20ms until we get at least one packet back,
    //    confirming the pinhole is open. Timeout after 3 seconds.

    // G.711 silence: PCMU=0xFF (~0 amplitude), PCMA=0xD5 (~0 amplitude).
    let silence_byte: u8 = match codec {
        G711Codec::PCMU => 0xFF,
        G711Codec::PCMA => 0xD5,
    };
    let silence_160 = vec![silence_byte; 160];

    // Step 1: Fire-and-forget STUN requests to open broad NAT mappings.
    // These don't block -- we just send and move on. The outbound packets are what
    // create the NAT mapping, not the responses.
    {
        use std::net::ToSocketAddrs;
        let stun_targets = ["stun.l.google.com:19302", "stun.cloudflare.com:3478"];
        // Build a minimal STUN Binding Request
        let mut stun_req = Vec::with_capacity(20);
        stun_req.extend_from_slice(&0x0001u16.to_be_bytes()); // Binding Request
        stun_req.extend_from_slice(&0x0000u16.to_be_bytes()); // Length: 0
        stun_req.extend_from_slice(&0x2112A442u32.to_be_bytes()); // Magic Cookie
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        for i in 0..12 {
            stun_req.push(((seed >> (i * 7)) & 0xFF) as u8);
        }
        for target in &stun_targets {
            if let Ok(mut addrs) = target.to_socket_addrs() {
                if let Some(addr) = addrs.next() {
                    let _ = socket.send_to(&stun_req, addr);
                    tracing::info!("STUN ping -> {} (NAT mapping)", target);
                }
            }
        }
        // Also probe the SBC's media port (RFC 7983 -- many SBCs handle STUN on RTP ports).
        // This creates a NAT mapping for the exact SBC destination.
        let _ = socket.send_to(&stun_req, remote_addr);
        tracing::info!("STUN ping -> {} (SBC media port)", remote_addr);
    }

    // Step 2: Hole-punch -- burst of RTP silence to the SBC.
    // Uses the same SSRC/seq/ts that SpanDSP will continue with.
    for i in 0..5 {
        let _ = send_rtp_packet(&socket, &remote_addr, ssrc, rtp_seq, rtp_timestamp, codec.pt(), &silence_160);
        rtp_seq = rtp_seq.wrapping_add(1);
        rtp_timestamp = rtp_timestamp.wrapping_add(160);
        if i < 4 { std::thread::sleep(Duration::from_millis(20)); }
    }
    tracing::info!("Sent 5 hole-punch RTP packets to {} (ssrc=0x{:08X})", remote_addr, ssrc);

    // Step 3: Wait for bidirectional RTP -- keep sending silence every 20ms
    // until we get at least one RTP packet back, confirming the NAT pinhole is open.
    // Timeout after 3 seconds (short enough to not expire T.30 timers).
    let mut got_rx = false;
    let wait_start = Instant::now();
    let mut rtp_buffer = vec![0u8; 1500];
    let wait_timeout = Duration::from_secs(3);

    tracing::warn!("Waiting for return RTP (sending silence, up to {}s)...", wait_timeout.as_secs());
    while wait_start.elapsed() < wait_timeout && !shutdown.load(Ordering::Relaxed) {
        // Send silence to keep NAT alive and signal the SBC
        let _ = send_rtp_packet(&socket, &remote_addr, ssrc, rtp_seq, rtp_timestamp, codec.pt(), &silence_160);
        rtp_seq = rtp_seq.wrapping_add(1);
        rtp_timestamp = rtp_timestamp.wrapping_add(160);

        // Check for incoming packets -- accept from any source (media proxy may differ)
        match socket.recv_from(&mut rtp_buffer) {
            Ok((len, from)) => {
                if len >= 12 {
                    let source_note = if from.ip() != remote_addr.ip() {
                        format!(" (media proxy -- SDP said {})", remote_addr.ip())
                    } else {
                        String::new()
                    };
                    tracing::info!("Got RX from {} ({} bytes) after {:.1}s -- bidirectional!{}",
                        from, len, wait_start.elapsed().as_secs_f32(), source_note);
                    got_rx = true;
                    break;
                }
            }
            Err(_) => {} // WouldBlock -- keep trying
        }

        std::thread::sleep(Duration::from_millis(20));
    }

    if !got_rx {
        tracing::warn!("No return RTP after {:.1}s -- proceeding anyway (NAT/firewall may be blocking)", wait_start.elapsed().as_secs_f32());
        if let (Some(ref app_handle), Some(ref jid)) = (&app, &job_id) {
            let _ = app_handle.emit("fax:send_progress", serde_json::json!({
                "jobId": jid,
                "phase": "warning",
                "warning": "No return RTP during setup -- NAT/firewall may be blocking",
                "messageDirection": "info",
            }));
        }
    }

    session.start()?;
    tracing::info!("Session started, sending to {} (codec: {:?}, ssrc=0x{:08X}, next_seq={})", remote_addr, codec, ssrc, rtp_seq);

    let start_time = Instant::now();

    let mut tx_samples = vec![0i16; 160]; // 20ms at 8kHz
    let mut rx_decode_buf = vec![0i16; 320];
    let mut rtp_buffer = vec![0u8; 1500];
    let mut jitter = JitterBuffer::new(100); // 100ms jitter buffer

    let max_duration = Duration::from_secs(120); // 2 min max -- fax should complete well within this
    let frame_interval = Duration::from_millis(20); // Strict 20ms pacing
    let rx_inactivity_timeout = Duration::from_secs(30); // 30s with no RX -> remote is dead
    let mut one_way_warned = false;

    let mut packets_sent: u64 = 0;
    let mut packets_received: u64 = 0;
    let mut last_rx_time = Instant::now();
    let mut last_log_time = Instant::now();
    let mut next_frame_time = Instant::now();
    let mut last_stats_emit = Instant::now();
    let stats_emit_interval = Duration::from_secs(2); // Packet stats to frontend every 2s

    while !shutdown.load(Ordering::Relaxed) && !session.is_completed() {
        if start_time.elapsed() > max_duration {
            return Err("Fax transmission timeout (2 minutes)".to_string());
        }

        if last_rx_time.elapsed() > rx_inactivity_timeout {
            return Err(format!(
                "No RTP packets received for {}s -- remote unresponsive",
                rx_inactivity_timeout.as_secs()
            ));
        }

        let now = Instant::now();

        // Strict 20ms frame pacing
        if now >= next_frame_time {
            next_frame_time = now + frame_interval;

            // Get TX samples from SpanDSP and send
            let tx_count = session.get_audio(&mut tx_samples)?;
            if tx_count > 0 {
                let encoded = encode_g711(&tx_samples[..tx_count], codec);
                send_rtp_packet(&socket, &remote_addr, ssrc, rtp_seq, rtp_timestamp, codec.pt(), &encoded)?;
                packets_sent += 1;
                rtp_seq = rtp_seq.wrapping_add(1);
                rtp_timestamp = rtp_timestamp.wrapping_add(tx_count as u32);
            }

            // Feed buffered RX samples to SpanDSP.
            // CRITICAL: We MUST feed audio (real or silence) to SpanDSP every 20ms
            // even before the first RTP packet arrives. SpanDSP's T.30 state machine
            // uses fax_rx() to advance internal timers. Without continuous RX input,
            // T.30 timers stall and the protocol never progresses past CNG/CED.
            if jitter.depth() >= 160 {
                let samples = jitter.consume(160);
                session.process_audio(&samples)?;
            } else {
                // No buffered data -- feed silence (fax_rx_fillin) so T.30 timers advance.
                // This covers both "no packets yet" and "packet loss" scenarios.
                session.fill_audio(160)?;
            }

            // Emit periodic packet stats to frontend for the live packet view
            if last_stats_emit.elapsed() >= stats_emit_interval {
                if let (Some(ref app_handle), Some(ref jid)) = (&app, &job_id) {
                    let _ = app_handle.emit("fax:send_progress", serde_json::json!({
                        "jobId": jid,
                        "phase": "g711_page",
                        "udptlPacketsSent": packets_sent,
                        "udptlPacketsReceived": packets_received,
                        "elapsedSecs": start_time.elapsed().as_secs(),
                    }));
                }
                last_stats_emit = Instant::now();
            }
        }

        // Non-blocking receive loop.
        // Accept RTP from ANY source -- do NOT filter by the SDP address.
        // Many SBCs use media proxies/relays that send from a different IP
        // than the one in the SDP answer. Filtering drops valid audio and
        // causes one-way RTP.
        loop {
            match socket.recv_from(&mut rtp_buffer) {
                Ok((len, from)) => {
                    if len < 12 {
                        continue; // Too small for any valid packet
                    }

                    // Count as received (even small packets keep the inactivity timer alive)
                    packets_received += 1;
                    last_rx_time = Instant::now();

                    if packets_received <= 5 {
                        let source_note = if from.ip() != remote_addr.ip() {
                            format!(" (media proxy -- SDP said {})", remote_addr.ip())
                        } else {
                            String::new()
                        };
                        tracing::info!("RX #{} from {} ({} bytes){}", packets_received, from, len, source_note);
                    }

                    // Only decode actual RTP audio (G.711 = 12-byte header + payload).
                    // Small SBC packets (STUN probes, keepalives, RTCP) are too short to
                    // contain audio -- just count them for liveness.
                    if len < 32 {
                        continue;
                    }

                    // Validate RTP version (must be 2)
                    let rtp_version = (rtp_buffer[0] >> 6) & 0x03;
                    if rtp_version != 2 {
                        continue; // Not RTP -- skip
                    }

                    // Parse RTP header
                    let rtp_seq_rx = u16::from_be_bytes([rtp_buffer[2], rtp_buffer[3]]);
                    let cc = (rtp_buffer[0] & 0x0F) as usize;
                    let has_extension = (rtp_buffer[0] & 0x10) != 0;

                    let mut payload_offset = 12 + cc * 4;
                    if has_extension && payload_offset + 4 <= len {
                        let ext_len = u16::from_be_bytes([rtp_buffer[payload_offset + 2], rtp_buffer[payload_offset + 3]]) as usize;
                        payload_offset += 4 + ext_len * 4;
                    }

                    if payload_offset < len {
                        let payload = &rtp_buffer[payload_offset..len];
                        let decoded = decode_g711(payload, codec, &mut rx_decode_buf);
                        if decoded > 0 {
                            jitter.push(rtp_seq_rx, &rx_decode_buf[..decoded]);
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => break,
            }
        }

        // Sleep until next frame time
        let now = Instant::now();
        if now < next_frame_time {
            let sleep_dur = next_frame_time - now;
            if sleep_dur > Duration::from_millis(1) {
                std::thread::sleep(sleep_dur - Duration::from_millis(1));
            }
        }

        // Early one-way media detection: if we've sent >100 packets but received <3,
        // the return path is broken (NAT/firewall). Warn immediately so logs show the issue.
        if !one_way_warned && packets_sent > 100 && packets_received < 3 && start_time.elapsed() > Duration::from_secs(5) {
            one_way_warned = true;
            tracing::warn!("One-way RTP detected: tx={} rx={} after {:.0}s", packets_sent, packets_received, start_time.elapsed().as_secs_f32());
            if let (Some(ref app_handle), Some(ref jid)) = (&app, &job_id) {
                let _ = app_handle.emit("fax:send_progress", serde_json::json!({
                    "jobId": jid,
                    "phase": "warning",
                    "warning": "One-way media detected -- return RTP not reaching us",
                    "detail": format!("tx={} rx={} after {:.0}s -- NAT/firewall may be blocking return traffic",
                        packets_sent, packets_received, start_time.elapsed().as_secs_f32()),
                    "messageDirection": "info",
                }));
            }
        }

        // Periodic stats -- log at 2s, 5s, then every 10s for faster debugging
        let log_interval = if start_time.elapsed() < Duration::from_secs(5) {
            Duration::from_secs(2)
        } else {
            Duration::from_secs(10)
        };
        if last_log_time.elapsed() > log_interval {
            tracing::info!(tx = packets_sent, rx = packets_received, elapsed_s = start_time.elapsed().as_secs_f32(), completed = session.is_completed(), "Fax media stats");
            last_log_time = Instant::now();
        }
    }

    tracing::info!(tx = packets_sent, rx = packets_received, elapsed_s = start_time.elapsed().as_secs_f32(), "Fax media complete");

    let fax_result = session.stop();

    Ok(FaxMediaResult {
        success: fax_result.success,
        pages_sent: fax_result.pages_sent,
        error: fax_result.error,
        remote_station_id: fax_result.remote_station_id,
        negotiated_baud_rate: fax_result.negotiated_baud_rate,
        ecm_used: fax_result.ecm_used,
    })
}

/// Run fax *receive* over RTP (G.711 mode)
///
/// The session must have been initialized with `FaxSession::new_receive()`.
pub fn run_fax_receive_over_rtp(
    session: &mut FaxSession,
    local_rtp_port: u16,
    remote_addr: SocketAddr,
    codec: G711Codec,
    shutdown: Arc<AtomicBool>,
    _app: Option<AppHandle>,
    _receive_id: Option<String>,
) -> Result<FaxMediaResult, String> {
    tracing::info!("Binding RTP port {} for receive...", local_rtp_port);

    let socket = UdpSocket::bind(format!("0.0.0.0:{}", local_rtp_port))
        .map_err(|e| format!("Failed to bind RTP port {}: {} (port in use?)", local_rtp_port, e))?;
    socket.set_read_timeout(Some(Duration::from_millis(5)))
        .map_err(|e| format!("Failed to set socket timeout: {}", e))?;
    socket.set_write_timeout(Some(Duration::from_millis(100)))
        .map_err(|e| format!("Failed to set send timeout: {}", e))?;

    session.start()?;
    tracing::info!("Session started, expecting from {} (codec: {:?})", remote_addr, codec);

    let start_time = Instant::now();
    let mut rtp_seq: u16 = random_u32() as u16;
    let mut rtp_timestamp: u32 = random_u32();
    let ssrc: u32 = random_u32();

    let mut tx_samples = vec![0i16; 160];
    let mut rx_decode_buf = vec![0i16; 320];
    let mut rtp_buffer = vec![0u8; 1500];
    let mut jitter = JitterBuffer::new(100);

    let max_duration = Duration::from_secs(180);
    let frame_interval = Duration::from_millis(20);
    let rx_inactivity_timeout = Duration::from_secs(45);

    let mut packets_sent: u64 = 0;
    let mut packets_received: u64 = 0;
    let mut last_rx_time = Instant::now();
    let mut last_log_time = Instant::now();
    let mut next_frame_time = Instant::now();

    while !shutdown.load(Ordering::Relaxed) && !session.is_completed() {
        if start_time.elapsed() > max_duration {
            return Err("Fax receive timeout (3 minutes)".to_string());
        }
        if last_rx_time.elapsed() > rx_inactivity_timeout {
            return Err(format!("No RTP packets received for {}s", rx_inactivity_timeout.as_secs()));
        }

        let now = Instant::now();
        if now >= next_frame_time {
            next_frame_time = now + frame_interval;

            // Get TX samples from SpanDSP (CED, DIS, CFR, MCF responses)
            let tx_count = session.get_audio(&mut tx_samples)?;
            if tx_count > 0 {
                let encoded = encode_g711(&tx_samples[..tx_count], codec);
                send_rtp_packet(&socket, &remote_addr, ssrc, rtp_seq, rtp_timestamp, codec.pt(), &encoded)?;
                packets_sent += 1;
                rtp_seq = rtp_seq.wrapping_add(1);
                rtp_timestamp = rtp_timestamp.wrapping_add(tx_count as u32);
            }

            if jitter.depth() >= 160 {
                let samples = jitter.consume(160);
                session.process_audio(&samples)?;
            } else {
                // Always feed silence so T.30 timers advance (same fix as send path)
                session.fill_audio(160)?;
            }
        }

        loop {
            match socket.recv_from(&mut rtp_buffer) {
                Ok((len, from)) => {
                    // Filter runt / keepalive packets (same as first loop)
                    if len < 32 {
                        continue;
                    }
                    if len >= 12 {
                        packets_received += 1;
                        last_rx_time = Instant::now();

                        // Log source address of first 5 received packets for NAT diagnostics
                        if packets_received <= 5 {
                            tracing::info!("RX #{} from {} ({} bytes)", packets_received, from, len);
                        }

                        let rtp_seq_rx = u16::from_be_bytes([rtp_buffer[2], rtp_buffer[3]]);
                        let cc = (rtp_buffer[0] & 0x0F) as usize;
                        let has_extension = (rtp_buffer[0] & 0x10) != 0;
                        let mut payload_offset = 12 + cc * 4;
                        if has_extension && payload_offset + 4 <= len {
                            let ext_len = u16::from_be_bytes([rtp_buffer[payload_offset + 2], rtp_buffer[payload_offset + 3]]) as usize;
                            payload_offset += 4 + ext_len * 4;
                        }
                        if payload_offset < len {
                            let payload = &rtp_buffer[payload_offset..len];
                            let decoded = decode_g711(payload, codec, &mut rx_decode_buf);
                            if decoded > 0 {
                                jitter.push(rtp_seq_rx, &rx_decode_buf[..decoded]);
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => break,
            }
        }

        let now = Instant::now();
        if now < next_frame_time {
            let sleep_dur = next_frame_time - now;
            if sleep_dur > Duration::from_millis(1) {
                std::thread::sleep(sleep_dur - Duration::from_millis(1));
            }
        }

        if last_log_time.elapsed() > Duration::from_secs(10) {
            tracing::info!("Stats: tx={}, rx={}, jitter_depth={}, elapsed={:.1}s",
                packets_sent, packets_received, jitter.depth(), start_time.elapsed().as_secs_f32());
            last_log_time = Instant::now();
        }
    }

    tracing::info!("Complete: tx={}, rx={}, elapsed={:.1}s",
        packets_sent, packets_received, start_time.elapsed().as_secs_f32());

    let fax_result = session.stop();

    Ok(FaxMediaResult {
        success: fax_result.success,
        pages_sent: fax_result.pages_sent,
        error: fax_result.error,
        remote_station_id: fax_result.remote_station_id,
        negotiated_baud_rate: fax_result.negotiated_baud_rate,
        ecm_used: fax_result.ecm_used,
    })
}

/// Encode PCM samples to G.711
fn encode_g711(samples: &[i16], codec: G711Codec) -> Vec<u8> {
    codec.encode_frame(samples)
}

/// Decode G.711 to PCM samples
fn decode_g711(data: &[u8], codec: G711Codec, output: &mut [i16]) -> usize {
    let decoded = codec.decode_frame(data);
    let count = decoded.len().min(output.len());
    output[..count].copy_from_slice(&decoded[..count]);
    count
}

/// Send an RTP packet
fn send_rtp_packet(
    socket: &UdpSocket,
    remote_addr: &SocketAddr,
    ssrc: u32,
    seq: u16,
    timestamp: u32,
    pt: u8,
    payload: &[u8],
) -> Result<(), String> {
    let mut packet = Vec::with_capacity(12 + payload.len());

    // RTP header (12 bytes)
    packet.push(0x80); // Version 2
    packet.push(pt);   // Payload type
    packet.extend_from_slice(&seq.to_be_bytes());
    packet.extend_from_slice(&timestamp.to_be_bytes());
    packet.extend_from_slice(&ssrc.to_be_bytes());
    packet.extend_from_slice(payload);

    socket.send_to(&packet, remote_addr)
        .map_err(|e| format!("Failed to send RTP: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_g711_encode_decode() {
        let samples = [0i16, 1000, -1000, 16384, -16384];
        let encoded = encode_g711(&samples, G711Codec::PCMU);
        let mut decoded = vec![0i16; samples.len()];
        decode_g711(&encoded, G711Codec::PCMU, &mut decoded);

        for (orig, dec) in samples.iter().zip(decoded.iter()) {
            assert!((orig - dec).abs() < 2000, "orig={}, dec={}", orig, dec);
        }
    }

    #[test]
    fn test_jitter_buffer() {
        let mut jb = JitterBuffer::new(100);
        let samples = vec![1i16; 160];

        jb.push(0, &samples);
        jb.push(1, &samples);

        assert_eq!(jb.depth(), 320);
        let consumed = jb.consume(160);
        assert_eq!(consumed.len(), 160);
        assert_eq!(jb.depth(), 160);
    }
}
