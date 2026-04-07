//! Media engine: capture → encode → RTP send; RTP recv → jitter buffer → decode → playback.
//! Supports PCMU/PCMA at 8 kHz and G.722 at 16 kHz, all using 20 ms frames.
//! Codec selection is dynamic via the `AudioCodec` trait.

use std::collections::{HashMap, VecDeque};
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use once_cell::sync::Lazy;

use super::audio_processing::{RecvProcessor, SendProcessor};
use super::codecs::{AudioCodec, G711Codec, G722Codec, SAMPLES_PER_FRAME, SAMPLE_RATE};
use super::jitter_buffer::JitterBuffer;
use super::metrics::CallMetrics;
use super::moh::MohPreset;
use super::rtp::RtpPacket;

const DEFAULT_SSRC: u32 = 1;

/// Emit a DTMF event to the frontend (both the dedicated dtmf event and the SIP log).
fn emit_dtmf_event(call_id: &str, digit: char, direction: &str) {
    let dir = if direction == "send" { "send" } else { "recv" };
    let ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    if let Some(app) = super::sip_log::app_handle() {
        use tauri::Emitter;
        let _ = app.emit(
            "softphone:dtmf_event",
            serde_json::json!({
                "call_id": call_id,
                "digit": digit.to_string(),
                "direction": dir,
                "timestamp": ts,
            }),
        );
    }

    super::sip_log::emit(super::sip_log::SipLogEvent {
        call_id: call_id.to_string(),
        direction: dir,
        method: "DTMF".to_string(),
        status_code: 0,
        summary: format!("DTMF {}", digit),
        raw: format!("DTMF digit={} direction={}", digit, direction),
        timestamp: ts,
    });
}

/// Ring buffer for oscillogram: last N samples (chronological order).
const WAVEFORM_CAP: usize = (SAMPLE_RATE as usize * 400) / 1000; // 400 ms at 8 kHz = 3200 samples

struct RingBuf {
    buf: Vec<f32>,
    cap: usize,
    write_pos: usize,
    len: usize,
}

impl RingBuf {
    fn new(cap: usize) -> Self {
        RingBuf {
            buf: vec![0.0; cap],
            cap,
            write_pos: 0,
            len: 0,
        }
    }

    fn push(&mut self, samples: &[f32]) {
        for &s in samples {
            self.buf[self.write_pos % self.cap] = s;
            self.write_pos = self.write_pos.wrapping_add(1);
            self.len = (self.len + 1).min(self.cap);
        }
    }

    /// Returns samples oldest-first for display.
    fn get_copy(&self) -> Vec<f32> {
        if self.len == 0 {
            return vec![];
        }
        let start = (self.write_pos + self.cap - self.len) % self.cap;
        (0..self.len)
            .map(|i| self.buf[(start + i) % self.cap])
            .collect()
    }
}

/// Queued DTMF event to be sent inline by the audio sender thread.
struct DtmfRequest {
    event_code: u8,
    dtmf_pt: u8,
}

struct CallMedia {
    shutdown: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    /// When true, muted sends MOH; when false, muted sends silence (mute vs hold).
    on_hold: Arc<AtomicBool>,
    /// When true, capture thread does not send; fax generator pushes via tx_send.
    fax_send_mode: Arc<AtomicBool>,
    /// Clone of send channel so fax (or other) can push G.711 frames when fax_send_mode is set.
    tx_send: mpsc::SyncSender<Vec<u8>>,
    jitter: Arc<Mutex<JitterBuffer>>,
    _media_handle: Option<thread::JoinHandle<()>>,
    /// Signal the audio thread to restart with new devices (without tearing down RTP).
    audio_restart: Arc<AtomicBool>,
    /// The local RTP port allocated from the central pool (released in stop_media).
    local_rtp_port: u16,
    /// Desired input device ID for next audio restart (None = default).
    desired_input_device: Arc<Mutex<Option<String>>>,
    /// Desired output device ID for next audio restart (None = default).
    desired_output_device: Arc<Mutex<Option<String>>>,
    /// Shared RTP socket for sending DTMF packets.
    rtp_socket: Arc<UdpSocket>,
    /// Remote RTP address for DTMF packets.
    remote_addr: std::net::SocketAddr,
    /// SSRC for this call's RTP stream.
    ssrc: u32,
    /// Shared RTP sequence number (updated by audio sender, read/advanced by DTMF sender).
    rtp_sequence: Arc<AtomicU16>,
    /// Shared RTP timestamp (updated by audio sender, read/advanced by DTMF sender).
    rtp_timestamp: Arc<AtomicU32>,
    /// Queue for DTMF events to be sent inline by the audio sender thread (ensures proper RTP sequencing).
    dtmf_tx: mpsc::Sender<DtmfRequest>,
    /// Recording flag: when true, capture and playout write samples to recording buffers.
    recording: Arc<AtomicBool>,
    /// Accumulated send (mic) samples for recording writer thread.
    recording_send_buf: Arc<Mutex<Vec<i16>>>,
    /// Accumulated recv (speaker) samples for recording writer thread.
    recording_recv_buf: Arc<Mutex<Vec<i16>>>,
    /// Sample rate for this call's codec (needed by recording writer).
    codec_sample_rate: u32,
    /// When set, playout forks decoded PCM to this channel for fax processing.
    tx_fax_receive: Arc<Mutex<Option<mpsc::SyncSender<Vec<i16>>>>>,
}

static CALLS: Lazy<Mutex<HashMap<String, CallMedia>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static METRICS: Lazy<Mutex<HashMap<String, Arc<Mutex<CallMetrics>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
/// Input gain per call (f32 stored as bits); 1.0 = 100%.
static INPUT_GAIN: Lazy<Mutex<HashMap<String, Arc<AtomicU32>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
/// Active recording writer thread handles, keyed by call_id.
static RECORDING_HANDLES: Lazy<Mutex<HashMap<String, RecordingHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct RecordingHandle {
    /// Signal to the writer thread to stop.
    stop: Arc<AtomicBool>,
    /// Writer thread join handle.
    _handle: thread::JoinHandle<()>,
    /// Path to the WAV file being written.
    path: PathBuf,
}

struct WaveformBuffers {
    send: Mutex<RingBuf>,
    recv: Mutex<RingBuf>,
}

static WAVEFORMS: Lazy<Mutex<HashMap<String, Arc<WaveformBuffers>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ── Conference mixer ──────────────────────────────────────────────────────
// Maps conference_id → { call_id → latest decoded PCM frame }
// Each playout thread contributes its decoded audio; when reading, it gets
// the sum of all *other* members' frames (N-1 mixing).
static CONFERENCE_MEMBERS: Lazy<Mutex<HashMap<String, HashMap<String, Vec<i16>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
/// Map call_id → conference_id for quick lookup.
static CALL_CONFERENCE: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Add a call to a conference (called from frontend via Tauri command).
pub fn join_conference(call_id: &str, conference_id: &str) {
    if let Ok(mut map) = CALL_CONFERENCE.lock() {
        map.insert(call_id.to_string(), conference_id.to_string());
    }
    if let Ok(mut conf) = CONFERENCE_MEMBERS.lock() {
        conf.entry(conference_id.to_string())
            .or_default()
            .entry(call_id.to_string())
            .or_insert_with(Vec::new);
    }
}

/// Remove a call from its conference.
pub fn leave_conference(call_id: &str) {
    let conf_id = if let Ok(mut map) = CALL_CONFERENCE.lock() {
        map.remove(call_id)
    } else {
        None
    };
    if let Some(cid) = conf_id {
        if let Ok(mut conf) = CONFERENCE_MEMBERS.lock() {
            if let Some(members) = conf.get_mut(&cid) {
                members.remove(call_id);
                if members.is_empty() {
                    conf.remove(&cid);
                }
            }
        }
    }
}

/// Contribute a decoded PCM frame from a call to its conference, and get
/// the mixed audio of all other members (N-1 mix). Returns None if the
/// call is not in a conference.
fn conference_mix(call_id: &str, own_pcm: &[i16]) -> Option<Vec<i16>> {
    let conf_id = CALL_CONFERENCE.lock().ok()?.get(call_id)?.clone();
    let mut conf = CONFERENCE_MEMBERS.lock().ok()?;
    let members = conf.get_mut(&conf_id)?;
    members.insert(call_id.to_string(), own_pcm.to_vec());

    if members.len() < 2 {
        return None;
    }

    let frame_len = own_pcm.len();
    let mut mixed = vec![0i32; frame_len];
    for (mid, frame) in members.iter() {
        if mid == call_id {
            continue;
        }
        for (i, &s) in frame.iter().enumerate() {
            if i < frame_len {
                mixed[i] += s as i32;
            }
        }
    }
    Some(
        mixed
            .iter()
            .map(|&s| s.clamp(-32768, 32767) as i16)
            .collect(),
    )
}

fn run_sender(
    socket: Arc<UdpSocket>,
    remote_addr: std::net::SocketAddr,
    ssrc: u32,
    payload_type: u8,
    rx: mpsc::Receiver<Vec<u8>>,
    shutdown: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    on_hold: Arc<AtomicBool>,
    codec: Arc<dyn AudioCodec>,
    _moh: MohPreset,
    shared_seq: Arc<AtomicU16>,
    shared_ts: Arc<AtomicU32>,
    dtmf_rx: mpsc::Receiver<DtmfRequest>,
) {
    use super::dtmf::{generate_dtmf_packets, EVENT_DURATION_FRAMES};

    let frame_duration = Duration::from_millis(20);
    let mut next_send = Instant::now();
    let silence_frame = codec.encode_frame(&vec![0i16; codec.frame_samples()]);

    // NAT hole-punch: send 3 silence packets immediately to establish mapping
    // before real audio. Helps SBC comedia and NAT traversal.
    {
        let mut seq = shared_seq.load(Ordering::SeqCst);
        let mut ts = shared_ts.load(Ordering::SeqCst);
        let ts_inc = SAMPLES_PER_FRAME as u32;
        for i in 0..3 {
            let packet = RtpPacket {
                payload_type,
                sequence: seq,
                timestamp: ts,
                ssrc,
                marker: false,
                payload: silence_frame.clone(),
            };
            let _ = socket.send_to(&packet.serialize(), remote_addr);
            seq = seq.wrapping_add(1);
            ts = ts.wrapping_add(ts_inc);
            if i < 2 {
                thread::sleep(Duration::from_millis(20));
            }
        }
        shared_seq.store(seq, Ordering::SeqCst);
        shared_ts.store(ts, Ordering::SeqCst);
    }

    // RTP timestamp increment: always 160 per 20ms frame.
    // G.722 uses an RTP clock rate of 8000 Hz (RFC 3551 §4.5.2) despite 16 kHz audio,
    // so its timestamp increment is also 160, same as G.711.
    let ts_increment = SAMPLES_PER_FRAME as u32; // 160 for both G.711 and G.722
    while !shutdown.load(Ordering::SeqCst) {
        // ── Check for queued DTMF events and send them inline (proper RTP sequencing) ──
        if let Ok(dtmf) = dtmf_rx.try_recv() {
            // Send DTMF packets inline from the sender thread so sequence numbers are
            // contiguous with audio. This prevents the far end from discarding "old" DTMF
            // packets that arrive after higher-sequenced audio packets.
            let seq_base = shared_seq.load(Ordering::SeqCst);
            let ts_base = shared_ts.load(Ordering::SeqCst);
            let packets =
                generate_dtmf_packets(dtmf.event_code, dtmf.dtmf_pt, ssrc, seq_base, ts_base);

            for (pkt, delay_ms) in &packets {
                let _ = socket.send_to(&pkt.serialize(), remote_addr);
                if *delay_ms > 0 {
                    thread::sleep(Duration::from_millis(*delay_ms));
                }
            }
            // Advance shared counters past the DTMF block
            let total_dtmf_packets = packets.len() as u16;
            shared_seq.fetch_add(total_dtmf_packets, Ordering::SeqCst);
            // Advance timestamp by the DTMF event duration so audio resumes at the right offset
            shared_ts.fetch_add(
                EVENT_DURATION_FRAMES * (SAMPLES_PER_FRAME as u32),
                Ordering::SeqCst,
            );
            // Reset pacing so next audio frame goes out immediately
            next_send = Instant::now();
            continue;
        }

        let payload = if muted.load(Ordering::SeqCst) || on_hold.load(Ordering::SeqCst) {
            // Mute or hold: send silence (system MOH — server plays its own MOH to held party).
            silence_frame.clone()
        } else {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(p) => p,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        };

        // Pace outgoing RTP at 20 ms so far end (and fax gateways) see real-time stream, not a burst.
        let now = Instant::now();
        if now < next_send {
            thread::sleep(next_send.saturating_duration_since(now));
        }
        next_send += frame_duration;

        let sequence = shared_seq.fetch_add(1, Ordering::SeqCst);
        let timestamp = shared_ts.fetch_add(ts_increment, Ordering::SeqCst);

        let packet = RtpPacket {
            payload_type,
            sequence,
            timestamp,
            ssrc,
            marker: false,
            payload: payload.clone(),
        };
        let _ = socket.send_to(&packet.serialize(), remote_addr);
    }
}

/// How long to wait without any RTP before assuming the remote party hung up (e.g. BYE was lost).
/// This is a safety net for when the SIP BYE never reaches us (firewall, NAT, proxy quirks).
/// 60 seconds is generous enough to avoid false positives from hold or network hiccups.
const RTP_SILENCE_TIMEOUT_SECS: u64 = 60;

fn run_receiver(
    socket: Arc<UdpSocket>,
    jitter: Arc<Mutex<JitterBuffer>>,
    metrics: Option<Arc<Mutex<CallMetrics>>>,
    shutdown: Arc<AtomicBool>,
    on_hold: Arc<AtomicBool>,
    call_id: String,
    dtmf_pt: u8,
) {
    let mut buf = [0u8; 2048];
    let mut last_rtp = Instant::now();
    let mut silence_notified = false;
    let mut packets_received: u64 = 0;
    let mut last_dtmf_event: Option<u8> = None;
    while !shutdown.load(Ordering::SeqCst) {
        let _ = socket.set_read_timeout(Some(Duration::from_millis(100)));
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                if n < 12 {
                    continue;
                }
                let now = Instant::now();
                last_rtp = now;
                silence_notified = false;
                if let Some(packet) = RtpPacket::deserialize(&buf[..n]) {
                    packets_received += 1;
                    if packets_received <= 3 {
                        tracing::info!(
                            "[RTP Receiver:{}] RX #{} from {} ({} bytes)",
                            call_id,
                            packets_received,
                            from,
                            n
                        );
                    }

                    // RFC 2833 telephone-event: detect inbound DTMF
                    if packet.payload_type == dtmf_pt && packet.payload.len() >= 4 {
                        let event = packet.payload[0];
                        let end = (packet.payload[1] & 0x80) != 0;
                        if end && last_dtmf_event != Some(event) {
                            last_dtmf_event = Some(event);
                            let digit = super::dtmf::event_to_digit(event);
                            emit_dtmf_event(&call_id, digit, "recv");
                        }
                        if end {
                            // After end packet, reset so next DTMF event is detected
                        } else {
                            // Continuation — clear last to allow same digit repeated
                            if packet.marker {
                                last_dtmf_event = None;
                            }
                        }
                        continue; // Don't push telephone-event into jitter buffer
                    }

                    if let Ok(mut j) = jitter.lock() {
                        j.push(packet.clone(), now);
                    }
                    if let Some(ref m) = metrics {
                        if let Ok(mut met) = m.lock() {
                            met.push_rtp(packet.sequence, packet.timestamp, now);
                        }
                    }
                }
            }
            Err(_) => {
                // Check for RTP silence — remote likely hung up and BYE was lost.
                // Skip detection when we put them on hold (they stop sending RTP, that's expected).
                if !silence_notified
                    && !on_hold.load(Ordering::SeqCst)
                    && last_rtp.elapsed() > Duration::from_secs(RTP_SILENCE_TIMEOUT_SECS)
                {
                    tracing::warn!(
                        "[RTP Receiver:{}] No RTP for {}s while not on hold — assuming remote hangup (BYE may have been lost)",
                        call_id, RTP_SILENCE_TIMEOUT_SECS);
                    crate::softphone::call_controller::push_remote_ended_call(call_id.clone());
                    silence_notified = true;
                    // Don't break — let shutdown flag from stop_media clean up properly
                }
                continue;
            }
        }
    }
}

fn run_playout(
    jitter: Arc<Mutex<JitterBuffer>>,
    tx: mpsc::SyncSender<Vec<i16>>,
    codec: Arc<dyn AudioCodec>,
    metrics: Option<Arc<Mutex<CallMetrics>>>,
    recv_waveform: Arc<WaveformBuffers>,
    shutdown: Arc<AtomicBool>,
    recording_flag: Arc<AtomicBool>,
    recording_recv_buf: Arc<Mutex<Vec<i16>>>,
    call_id_for_transcription: String,
    tx_fax_receive: Arc<Mutex<Option<mpsc::SyncSender<Vec<i16>>>>>,
    send_proc: Arc<SendProcessor>,
) {
    let frame_duration = Duration::from_millis(20);
    let mut next_playout = Instant::now();
    let recv_proc = RecvProcessor::new(true);
    while !shutdown.load(Ordering::SeqCst) {
        let now = Instant::now();
        if now < next_playout {
            thread::sleep(next_playout.saturating_duration_since(now));
        }
        next_playout += frame_duration;
        let packet = {
            let mut j = match jitter.lock() {
                Ok(g) => g,
                Err(_) => continue,
            };
            j.pop_ready(Instant::now())
        };
        let pcm = if let Some(pkt) = packet {
            let decoded = codec.decode_frame(&pkt.payload);
            recv_proc.good_frame(&decoded);
            decoded
        } else {
            match recv_proc.conceal() {
                Some(concealed) => concealed,
                None => continue,
            }
        };

        // Feed far-end audio to AEC reference before playout
        send_proc.feed_far_end(&pcm);

        if let Some(ref m) = metrics {
            let peak = pcm.iter().map(|&s| (s as i32).abs()).max().unwrap_or(0) as f32 / 32768.0;
            if let Ok(mut met) = m.lock() {
                met.set_recv_peak(peak);
            }
        }
        if recording_flag.load(Ordering::Relaxed) {
            if let Ok(mut buf) = recording_recv_buf.lock() {
                buf.extend_from_slice(&pcm);
            }
        }
        super::transcription::feed_recv_pcm(&call_id_for_transcription, &pcm);
        let recv_f32: Vec<f32> = pcm.iter().map(|&s| s as f32 / 32768.0).collect();
        if let Ok(mut buf) = recv_waveform.recv.lock() {
            buf.push(&recv_f32);
        }
        if let Ok(guard) = tx_fax_receive.lock() {
            if let Some(ref fax_tx) = *guard {
                let _ = fax_tx.try_send(pcm.clone());
            }
        }
        // Conference mixing: contribute this call's remote audio and get N-1 mix
        let playout_pcm = if let Some(mixed) = conference_mix(&call_id_for_transcription, &pcm) {
            mixed
        } else {
            pcm
        };
        let _ = tx.try_send(playout_pcm);
    }
}

/// Start media for a call: capture → encode → RTP send; RTP recv → jitter → decode → playback.
/// When muted (hold or mute), send silence so server can play MOH (system only).
pub fn start_media(
    call_id: String,
    local_rtp_port: u16,
    remote_rtp_address: &str,
    remote_rtp_port: u16,
    input_device_id: Option<String>,
    output_device_id: Option<String>,
    jitter_min_ms: u32,
    jitter_max_ms: u32,
    codec_name: Option<String>,
    payload_type: Option<u8>,
    moh_preset: Option<String>,
    input_gain: f32,
) -> Result<(), String> {
    let _span = tracing::info_span!("softphone.media_start", call_id = %call_id).entered();
    tracing::info!(call_id = %call_id, remote = %remote_rtp_address, port = remote_rtp_port, "Starting media engine");
    let gain = input_gain.clamp(0.01, 4.0);
    let gain_atomic = Arc::new(AtomicU32::new(gain.to_bits()));
    INPUT_GAIN
        .lock()
        .map_err(|e| e.to_string())?
        .insert(call_id.clone(), gain_atomic.clone());
    // Resolve codec from payload type or name using the AudioCodec trait.
    // Supported codecs: PCMU (pt=0), PCMA (pt=8), G.722 (pt=9 at 16 kHz).
    let audio_codec: Arc<dyn AudioCodec> = if let Some(pt) = payload_type {
        match pt {
            0 => Arc::new(G711Codec::PCMU),
            8 => Arc::new(G711Codec::PCMA),
            9 => Arc::new(G722Codec::new()),
            _ => Arc::new(G711Codec::PCMU), // unknown PT falls back to PCMU
        }
    } else if let Some(ref name) = codec_name {
        match name.to_uppercase().as_str() {
            "PCMU" => Arc::new(G711Codec::PCMU),
            "PCMA" => Arc::new(G711Codec::PCMA),
            "G722" => Arc::new(G722Codec::new()),
            _ => Arc::new(G711Codec::PCMU),
        }
    } else {
        Arc::new(G711Codec::PCMU)
    };
    let pt = audio_codec.pt();
    let codec_sample_rate = audio_codec.sample_rate();
    let codec_frame_samples = audio_codec.frame_samples();

    let remote_addr: std::net::SocketAddr = format!("{}:{}", remote_rtp_address, remote_rtp_port)
        .parse()
        .map_err(|e| format!("Invalid remote RTP address: {}", e))?;

    let socket = UdpSocket::bind(format!("0.0.0.0:{}", local_rtp_port))
        .map_err(|e| format!("Failed to bind RTP port {}: {}", local_rtp_port, e))?;
    let _ = socket.set_nonblocking(false);
    let socket = Arc::new(socket);

    let (tx_capture, rx_capture) = mpsc::sync_channel::<Vec<u8>>(128);
    let (tx_playout, rx_playout) = mpsc::sync_channel::<Vec<i16>>(128);

    let shutdown = Arc::new(AtomicBool::new(false));
    let muted = Arc::new(AtomicBool::new(false));
    let on_hold = Arc::new(AtomicBool::new(false));
    let fax_send_mode = Arc::new(AtomicBool::new(false));

    let jitter = Arc::new(Mutex::new(JitterBuffer::new(
        jitter_min_ms.max(20),
        jitter_max_ms.min(500),
    )));
    let metrics = Arc::new(Mutex::new(CallMetrics::new()));
    METRICS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(call_id.clone(), metrics.clone());

    let waveform_buffers = Arc::new(WaveformBuffers {
        send: Mutex::new(RingBuf::new(WAVEFORM_CAP)),
        recv: Mutex::new(RingBuf::new(WAVEFORM_CAP)),
    });
    WAVEFORMS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(call_id.clone(), waveform_buffers.clone());

    // Recording: shared buffers for send/recv PCM samples.
    let recording_flag = Arc::new(AtomicBool::new(false));
    let recording_send_buf: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
    let recording_recv_buf: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));

    let moh = MohPreset::from_str(moh_preset.as_deref().unwrap_or("system"));
    let shared_seq = Arc::new(AtomicU16::new(0));
    let shared_ts = Arc::new(AtomicU32::new(0));
    let (dtmf_tx, dtmf_rx) = mpsc::channel::<DtmfRequest>();
    let s = socket.clone();
    let sh = shutdown.clone();
    let mu = muted.clone();
    let oh_send = on_hold.clone();
    let codec_sender = audio_codec.clone();
    let seq_sender = shared_seq.clone();
    let ts_sender = shared_ts.clone();
    thread::spawn(move || {
        run_sender(
            s,
            remote_addr,
            DEFAULT_SSRC,
            pt,
            rx_capture,
            sh,
            mu,
            oh_send,
            codec_sender,
            moh,
            seq_sender,
            ts_sender,
            dtmf_rx,
        )
    });

    let s = socket.clone();
    let j = jitter.clone();
    let m = metrics.clone();
    let sh = shutdown.clone();
    let oh_recv = on_hold.clone();
    let cid_recv = call_id.clone();
    thread::spawn(move || run_receiver(s, j, Some(m), sh, oh_recv, cid_recv, 101));

    let send_proc = Arc::new(SendProcessor::new(true, true));

    let tx_fax_receive = Arc::new(Mutex::new(None::<mpsc::SyncSender<Vec<i16>>>));
    let j = jitter.clone();
    let m_playout = metrics.clone();
    let recv_waveform = waveform_buffers.clone();
    let sh = shutdown.clone();
    let codec_playout = audio_codec.clone();
    let rec_flag_play = recording_flag.clone();
    let rec_recv_buf_play = recording_recv_buf.clone();
    let call_id_playout = call_id.clone();
    let tx_fax_play = tx_fax_receive.clone();
    let send_proc_playout = send_proc.clone();
    thread::spawn(move || {
        run_playout(
            j,
            tx_playout,
            codec_playout,
            Some(m_playout),
            recv_waveform,
            sh,
            rec_flag_play,
            rec_recv_buf_play,
            call_id_playout,
            tx_fax_play,
            send_proc_playout,
        )
    });

    let shutdown_media = shutdown.clone();
    let shutdown_loop = shutdown.clone();
    let muted_media = muted.clone();
    let on_hold_media = on_hold.clone();
    let fax_mode_cap = fax_send_mode.clone();
    let fax_send_mode_for_call = fax_send_mode.clone();
    let tx_cap = tx_capture.clone();
    let metrics_cap = metrics.clone();
    let send_waveform = waveform_buffers.clone();
    let codec_for_capture = audio_codec.clone();
    let rec_flag_cap = recording_flag.clone();
    let rec_send_buf_cap = recording_send_buf.clone();

    let audio_restart = Arc::new(AtomicBool::new(false));
    let desired_input_device: Arc<Mutex<Option<String>>> =
        Arc::new(Mutex::new(input_device_id.as_ref().and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.clone())
            }
        })));
    let desired_output_device: Arc<Mutex<Option<String>>> =
        Arc::new(Mutex::new(output_device_id.as_ref().and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.clone())
            }
        })));

    let audio_restart_thread = audio_restart.clone();
    let desired_input_thread = desired_input_device.clone();
    let desired_output_thread = desired_output_device.clone();

    let gain_atomic_cap = gain_atomic.clone();
    let (setup_tx, setup_rx) = mpsc::sync_channel::<Result<(), String>>(1);
    let call_id_for_media = call_id.clone();
    let media_handle = thread::spawn(move || {
        // rx_playout is wrapped in Arc<Mutex<>> so it survives across audio device restarts.
        let rx_playout_shared: Arc<Mutex<mpsc::Receiver<Vec<i16>>>> =
            Arc::new(Mutex::new(rx_playout));
        let mut first_iteration = true;
        // Clone call_id for use in capture closures within the audio loop.
        let call_id = call_id_for_media;

        'audio_loop: loop {
            // Read desired device IDs
            let input_id = desired_input_thread.lock().ok().and_then(|g| g.clone());
            let output_id = desired_output_thread.lock().ok().and_then(|g| g.clone());

            let host = cpal::default_host();
            let input_device = if let Some(ref id) = input_id {
                host.input_devices()
                    .ok()
                    .and_then(|mut devices| {
                        devices.find(|d| d.name().ok().as_deref() == Some(id.as_str()))
                    })
                    .or_else(|| host.default_input_device())
            } else {
                host.default_input_device()
            };
            let input_device = match input_device {
                Some(d) => d,
                None => {
                    if first_iteration {
                        let _ = setup_tx.send(Err("No input device".to_string()));
                    }
                    return;
                }
            };
            // Use the codec's native sample rate (8 kHz for G.711, 16 kHz for G.722).
            let target_rate = codec_sample_rate;
            let target_frame = codec_frame_samples;
            let config_target = cpal::StreamConfig {
                channels: 1,
                sample_rate: cpal::SampleRate(target_rate),
                buffer_size: cpal::BufferSize::Default,
            };
            let tx_cap_native = tx_cap.clone();
            let codec_cap = codec_for_capture.clone();
            let metrics_native = metrics_cap.clone();
            let send_waveform_native = send_waveform.clone();
            let shutdown_native = shutdown_media.clone();
            let muted_native = muted_media.clone();
            let on_hold_native = on_hold_media.clone();
            let gain_native = gain_atomic_cap.clone();
            let fax_mode_native = fax_mode_cap.clone();
            let rec_flag_native = rec_flag_cap.clone();
            let rec_send_native = rec_send_buf_cap.clone();
            let call_id_cap_native = call_id.clone();
            let send_proc_native = send_proc.clone();
            let _input_stream = match input_device.build_input_stream(
                &config_target,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if shutdown_native.load(Ordering::SeqCst) {
                        return;
                    }
                    let g = f32::from_bits(gain_native.load(Ordering::Relaxed));
                    let pcm: Vec<i16> = data
                        .iter()
                        .map(|&s| (s * g * 32767.0).clamp(-32768.0, 32767.0) as i16)
                        .collect();
                    for chunk in pcm.chunks(target_frame) {
                        if chunk.len() == target_frame {
                            let mut processed = chunk.to_vec();
                            let is_voice = send_proc_native.process(&mut processed);
                            if !muted_native.load(Ordering::SeqCst)
                                && !on_hold_native.load(Ordering::SeqCst)
                                && !fax_mode_native.load(Ordering::SeqCst)
                            {
                                if is_voice || !send_proc_native.vad_enabled {
                                    let encoded = codec_cap.encode_frame(&processed);
                                    let _ = tx_cap_native.try_send(encoded);
                                }
                            }
                            if rec_flag_native.load(Ordering::Relaxed) {
                                if let Ok(mut buf) = rec_send_native.lock() {
                                    buf.extend_from_slice(&processed);
                                }
                            }
                            super::transcription::feed_send_pcm(&call_id_cap_native, &processed);
                            if let Ok(mut met) = metrics_native.lock() {
                                let peak = processed
                                    .iter()
                                    .map(|&s| (s as i32).abs())
                                    .max()
                                    .unwrap_or(0) as f32
                                    / 32768.0;
                                met.set_send_peak(peak);
                            }
                            let send_f32: Vec<f32> =
                                processed.iter().map(|&s| s as f32 / 32768.0).collect();
                            if let Ok(mut buf) = send_waveform_native.send.lock() {
                                buf.push(&send_f32);
                            }
                        }
                    }
                },
                move |_| {},
                None,
            ) {
                Ok(s) => s,
                Err(e) => {
                    // Device may not support the target rate; try default config and resample.
                    let err_msg = e.to_string();
                    let default_config = match input_device.default_input_config() {
                        Ok(c) => c,
                        Err(de) => {
                            if first_iteration {
                                let _ = setup_tx.send(Err(format!(
                                    "Input stream: {}; default config: {}",
                                    err_msg, de
                                )));
                            }
                            return;
                        }
                    };
                    let config: cpal::StreamConfig = default_config.clone().into();
                    let device_rate = default_config.sample_rate().0;
                    // Compute resampling: device_rate → target_rate (codec's native rate).
                    // E.g. 48000 → 8000 = ratio 6, 48000 → 16000 = ratio 3.
                    let ratio = (device_rate / target_rate).max(1) as usize;
                    let required = ratio * target_frame;
                    let input_buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
                    let input_buf_cb = input_buf.clone();
                    let tx_cap_fb = tx_cap.clone();
                    let codec_cap2 = codec_for_capture.clone();
                    let metrics_fb = metrics_cap.clone();
                    let send_waveform_fb = send_waveform.clone();
                    let shutdown_fb = shutdown_media.clone();
                    let muted_fb = muted_media.clone();
                    let on_hold_fb = on_hold_media.clone();
                    let fax_mode_fb = fax_send_mode_for_call.clone();
                    let gain_fb = gain_atomic_cap.clone();
                    let rec_flag_fb = rec_flag_cap.clone();
                    let rec_send_fb = rec_send_buf_cap.clone();
                    let call_id_cap_fb = call_id.clone();
                    let send_proc_fb = send_proc.clone();
                    match input_device.build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            if shutdown_fb.load(Ordering::SeqCst) {
                                return;
                            }
                            let g = f32::from_bits(gain_fb.load(Ordering::Relaxed));
                            if let Ok(mut buf) = input_buf_cb.lock() {
                                buf.extend_from_slice(data);
                                while buf.len() >= required {
                                    let chunk: Vec<f32> = buf.drain(..required).collect();
                                    let mut decimated: Vec<i16> = (0..target_frame)
                                        .map(|i| {
                                            let v = chunk[i * ratio] * g;
                                            (v * 32767.0).clamp(-32768.0, 32767.0) as i16
                                        })
                                        .collect();
                                    let is_voice = send_proc_fb.process(&mut decimated);
                                    if !muted_fb.load(Ordering::SeqCst)
                                        && !on_hold_fb.load(Ordering::SeqCst)
                                        && !fax_mode_fb.load(Ordering::SeqCst)
                                    {
                                        if is_voice || !send_proc_fb.vad_enabled {
                                            let encoded = codec_cap2.encode_frame(&decimated);
                                            let _ = tx_cap_fb.try_send(encoded);
                                        }
                                    }
                                    if rec_flag_fb.load(Ordering::Relaxed) {
                                        if let Ok(mut rbuf) = rec_send_fb.lock() {
                                            rbuf.extend_from_slice(&decimated);
                                        }
                                    }
                                    super::transcription::feed_send_pcm(
                                        &call_id_cap_fb,
                                        &decimated,
                                    );
                                    if let Ok(mut met) = metrics_fb.lock() {
                                        let peak = decimated
                                            .iter()
                                            .map(|&s| (s as i32).abs())
                                            .max()
                                            .unwrap_or(0)
                                            as f32
                                            / 32768.0;
                                        met.set_send_peak(peak);
                                    }
                                    let send_f32: Vec<f32> =
                                        decimated.iter().map(|&s| s as f32 / 32768.0).collect();
                                    if let Ok(mut w) = send_waveform_fb.send.lock() {
                                        w.push(&send_f32);
                                    }
                                }
                            }
                        },
                        move |_| {},
                        None,
                    ) {
                        Ok(stream) => stream,
                        Err(e2) => {
                            if first_iteration {
                                let _ = setup_tx.send(Err(format!(
                                    "Input stream: {}; fallback ({} Hz): {}",
                                    err_msg, device_rate, e2
                                )));
                            }
                            return;
                        }
                    }
                }
            };
            let output_device = if let Some(ref id) = output_id {
                host.output_devices()
                    .ok()
                    .and_then(|mut devices| {
                        devices.find(|d| d.name().ok().as_deref() == Some(id.as_str()))
                    })
                    .or_else(|| host.default_output_device())
            } else {
                host.default_output_device()
            };
            let output_device = match output_device {
                Some(d) => d,
                None => {
                    if first_iteration {
                        let _ = setup_tx.send(Err("No output device".to_string()));
                    }
                    return;
                }
            };
            let out_config_target = cpal::StreamConfig {
                channels: 1,
                sample_rate: cpal::SampleRate(target_rate),
                buffer_size: cpal::BufferSize::Default,
            };
            let mut playout_buf: VecDeque<i16> = VecDeque::with_capacity(target_frame * 4);
            let rx_playout_native = rx_playout_shared.clone();
            let output_stream = match output_device.build_output_stream(
                &out_config_target,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    for out in data.iter_mut() {
                        while playout_buf.is_empty() {
                            match rx_playout_native
                                .lock()
                                .map(|r| r.try_recv())
                                .unwrap_or(Err(mpsc::TryRecvError::Disconnected))
                            {
                                Ok(pcm) => playout_buf.extend(pcm),
                                Err(_) => break,
                            }
                        }
                        *out = if let Some(s) = playout_buf.pop_front() {
                            s as f32 / 32768.0
                        } else {
                            0.0
                        };
                    }
                },
                move |_| {},
                None,
            ) {
                Ok(s) => s,
                Err(e) => {
                    let err_msg = e.to_string();
                    let default_out = match output_device.default_output_config() {
                        Ok(c) => c,
                        Err(de) => {
                            if first_iteration {
                                let _ = setup_tx.send(Err(format!(
                                    "Output stream: {}; default config: {}",
                                    err_msg, de
                                )));
                            }
                            return;
                        }
                    };
                    let out_config: cpal::StreamConfig = default_out.clone().into();
                    let device_rate = default_out.sample_rate().0;
                    // Resample from codec's native rate to device rate for playback.
                    let ratio = (device_rate / target_rate).max(1) as usize;
                    let playout_device_buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
                    let playout_device_buf_cb = playout_device_buf.clone();
                    let rx_playout_fb = rx_playout_shared.clone();
                    match output_device.build_output_stream(
                        &out_config,
                        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                            let mut pos = 0;
                            while pos < data.len() {
                                if let Ok(mut buf) = playout_device_buf_cb.lock() {
                                    if buf.is_empty() {
                                        match rx_playout_fb
                                            .lock()
                                            .map(|r| r.try_recv())
                                            .unwrap_or(Err(mpsc::TryRecvError::Disconnected))
                                        {
                                            Ok(pcm) => {
                                                for &s in &pcm {
                                                    let v = s as f32 / 32768.0;
                                                    for _ in 0..ratio {
                                                        buf.push(v);
                                                    }
                                                }
                                            }
                                            Err(_) => {
                                                for out in data[pos..].iter_mut() {
                                                    *out = 0.0;
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    let take = (data.len() - pos).min(buf.len());
                                    data[pos..pos + take].copy_from_slice(&buf[..take]);
                                    buf.drain(..take);
                                    pos += take;
                                } else {
                                    break;
                                }
                            }
                        },
                        move |_| {},
                        None,
                    ) {
                        Ok(stream) => stream,
                        Err(e2) => {
                            if first_iteration {
                                let _ = setup_tx.send(Err(format!(
                                    "Output stream: {}; fallback ({} Hz): {}",
                                    err_msg, device_rate, e2
                                )));
                            }
                            return;
                        }
                    }
                }
            };
            if let Err(e) = output_stream.play() {
                if first_iteration {
                    let _ = setup_tx.send(Err(format!("Output play: {}", e)));
                }
                return;
            }
            if first_iteration {
                let _ = setup_tx.send(Ok(()));
                first_iteration = false;
            }

            // Wait for shutdown or audio device restart request
            while !shutdown_loop.load(Ordering::SeqCst)
                && !audio_restart_thread.load(Ordering::SeqCst)
            {
                thread::sleep(Duration::from_millis(50));
            }

            if shutdown_loop.load(Ordering::SeqCst) {
                break 'audio_loop; // Full shutdown: streams drop, thread exits
            }

            // Audio restart: clear the flag, drop streams (end of scope), loop to recreate with new devices
            audio_restart_thread.store(false, Ordering::SeqCst);
            // _input_stream and output_stream drop here, stopping old capture/playback
        }
    });

    match setup_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            return Err("Audio setup timeout (no device or stream)".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            return Err("Audio thread exited before ready".to_string())
        }
    }

    let call_media = CallMedia {
        shutdown,
        muted,
        on_hold,
        fax_send_mode: fax_send_mode.clone(),
        tx_send: tx_capture,
        jitter: jitter.clone(),
        _media_handle: Some(media_handle),
        audio_restart,
        desired_input_device,
        desired_output_device,
        rtp_socket: socket.clone(),
        remote_addr,
        ssrc: DEFAULT_SSRC,
        rtp_sequence: shared_seq,
        rtp_timestamp: shared_ts,
        dtmf_tx,
        recording: recording_flag,
        recording_send_buf,
        recording_recv_buf,
        codec_sample_rate,
        local_rtp_port,
        tx_fax_receive,
    };
    CALLS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(call_id, call_media);
    Ok(())
}

/// Stop media for a call. Also stops any active recording and releases the RTP port.
pub fn stop_media(call_id: &str) -> Result<(), String> {
    let _span = tracing::info_span!("softphone.media_stop", call_id = %call_id).entered();
    tracing::info!(call_id = %call_id, "Stopping media engine");
    // Stop recording if active (before shutting down audio threads)
    if is_recording(call_id) {
        let _ = stop_recording(call_id);
    }
    INPUT_GAIN
        .lock()
        .map_err(|e| e.to_string())?
        .remove(call_id);
    let mut calls = CALLS.lock().map_err(|e| e.to_string())?;
    if let Some(call) = calls.remove(call_id) {
        call.shutdown.store(true, Ordering::SeqCst);
        // Release the RTP port back to the central pool.
        super::port_allocator::release(call.local_rtp_port);
        if let Some(h) = call._media_handle {
            let _ = h.join();
        }
    }
    METRICS.lock().map_err(|e| e.to_string())?.remove(call_id);
    WAVEFORMS.lock().map_err(|e| e.to_string())?.remove(call_id);
    leave_conference(call_id);
    Ok(())
}

/// Get last N ms of send/recv PCM for oscillogram (normalized -1..1).
pub fn get_call_waveform(call_id: &str) -> Result<(Vec<f32>, Vec<f32>), String> {
    let waveforms = WAVEFORMS.lock().map_err(|e| e.to_string())?;
    if let Some(wb) = waveforms.get(call_id) {
        let send = wb.send.lock().map_err(|e| e.to_string())?.get_copy();
        let recv = wb.recv.lock().map_err(|e| e.to_string())?.get_copy();
        return Ok((send, recv));
    }
    Ok((vec![], vec![]))
}

/// Return active call codec sample rate (e.g. 8000 for G.711, 16000 for G.722).
pub fn get_call_codec_sample_rate(call_id: &str) -> Option<u32> {
    CALLS
        .lock()
        .ok()
        .and_then(|calls| calls.get(call_id).map(|c| c.codec_sample_rate))
}

/// Get current call metrics (MOS, jitter, send_peak, recv_peak, loss).
pub fn get_call_metrics(call_id: &str) -> Result<(f64, f64, f32, f32, f64, u64), String> {
    let metrics = METRICS.lock().map_err(|e| e.to_string())?;
    if let Some(m) = metrics.get(call_id) {
        if let Ok(met) = m.lock() {
            return Ok((
                met.mos(),
                met.jitter_rfc_ms,
                met.send_peak,
                met.recv_peak,
                met.loss_percent(),
                met.lost_packets,
            ));
        }
    }
    Ok((0.0, 0.0, 0.0, 0.0, 0.0, 0))
}

/// Get jitter history for graphing (timestamps in sec, jitter in ms).
pub fn get_call_jitter_history(call_id: &str) -> Result<(Vec<f64>, Vec<f64>), String> {
    let metrics = METRICS.lock().map_err(|e| e.to_string())?;
    if let Some(m) = metrics.get(call_id) {
        if let Ok(met) = m.lock() {
            let (t, j): (Vec<f64>, Vec<f64>) = met.jitter_history.iter().cloned().unzip();
            return Ok((t, j));
        }
    }
    Ok((vec![], vec![]))
}

/// Set input gain for an active call (0.01–4.0; 1.0 = 100%).
pub fn set_input_gain(call_id: &str, gain: f32) -> Result<(), String> {
    let g = gain.clamp(0.01, 4.0);
    INPUT_GAIN
        .lock()
        .map_err(|e| e.to_string())?
        .get(call_id)
        .ok_or_else(|| format!("Call {} not found", call_id))?
        .store(g.to_bits(), Ordering::Relaxed);
    Ok(())
}

/// Mute or unmute the send path. When muted, send path sends silence (not MOH).
pub fn set_muted(call_id: &str, muted: bool) -> Result<(), String> {
    let calls = CALLS.lock().map_err(|e| e.to_string())?;
    if let Some(call) = calls.get(call_id) {
        call.muted.store(muted, Ordering::SeqCst);
        tracing::info!("set_muted call_id={} muted={}", call_id, muted);
    } else {
        tracing::info!(
            "set_muted: call_id={} NOT FOUND in CALLS ({} active calls: {:?})",
            call_id,
            calls.len(),
            calls.keys().collect::<Vec<_>>()
        );
    }
    Ok(())
}

/// Enable or disable fax send mode. When true, capture does not send; use push_send_audio to inject G.711 frames.
pub fn set_fax_send_mode(call_id: &str, on: bool) -> Result<(), String> {
    let calls = CALLS.lock().map_err(|e| e.to_string())?;
    if let Some(call) = calls.get(call_id) {
        call.fax_send_mode.store(on, Ordering::SeqCst);
        if on {
            call.muted.store(false, Ordering::SeqCst);
        }
    }
    Ok(())
}

/// Push one G.711-encoded frame (160 bytes) to the send path. Call set_fax_send_mode(call_id, true) first.
pub fn push_send_audio(call_id: &str, frame: Vec<u8>) -> Result<(), String> {
    let calls = CALLS.lock().map_err(|e| e.to_string())?;
    if let Some(call) = calls.get(call_id) {
        call.tx_send.send(frame).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err(format!("Call {} not found", call_id))
}

/// Register a channel to receive decoded PCM from the playout path (for fax processing).
/// When set, run_playout forks each decoded frame to this sender. Call unregister_fax_receive when done.
pub fn register_fax_receive(call_id: &str, tx: mpsc::SyncSender<Vec<i16>>) -> Result<(), String> {
    let calls = CALLS.lock().map_err(|e| e.to_string())?;
    if let Some(call) = calls.get(call_id) {
        if let Ok(mut guard) = call.tx_fax_receive.lock() {
            *guard = Some(tx);
        }
        return Ok(());
    }
    Err(format!("Call {} not found", call_id))
}

/// Unregister the fax receive channel. Call when fax transmission completes.
pub fn unregister_fax_receive(call_id: &str) -> Result<(), String> {
    let calls = CALLS.lock().map_err(|e| e.to_string())?;
    if let Some(call) = calls.get(call_id) {
        if let Ok(mut guard) = call.tx_fax_receive.lock() {
            *guard = None;
        }
        return Ok(());
    }
    Err(format!("Call {} not found", call_id))
}

/// Switch audio input/output devices for an active call without restarting RTP.
/// The media thread will restart capture/playback with the new devices.
pub fn set_audio_devices(
    call_id: &str,
    input_device_id: Option<String>,
    output_device_id: Option<String>,
) -> Result<(), String> {
    let calls = CALLS.lock().map_err(|e| e.to_string())?;
    if let Some(call) = calls.get(call_id) {
        if let Ok(mut d) = call.desired_input_device.lock() {
            *d = input_device_id;
        }
        if let Ok(mut d) = call.desired_output_device.lock() {
            *d = output_device_id;
        }
        call.audio_restart.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        Err(format!("Call {} not found", call_id))
    }
}

/// Send a DTMF digit via RFC 2833 telephone-event on the call's RTP socket.
/// The digit is a char: '0'-'9', '*', '#', 'A'-'D'.
/// `dtmf_pt` is the negotiated telephone-event payload type (typically 101).
///
/// DTMF events are queued to the audio sender thread which sends them inline,
/// ensuring proper RTP sequence number ordering. Previously, a separate thread
/// would race with the audio sender, causing out-of-sequence packets that many
/// SIP endpoints silently discard.
pub fn send_dtmf(call_id: &str, digit: char, dtmf_pt: u8) -> Result<(), String> {
    use super::dtmf::digit_to_event;

    let event_code =
        digit_to_event(digit).ok_or_else(|| format!("Invalid DTMF digit: '{}'", digit))?;

    let dtmf_tx = {
        let calls = CALLS.lock().map_err(|e| e.to_string())?;
        let call = calls.get(call_id).ok_or("Call not found")?;
        call.dtmf_tx.clone()
    };

    dtmf_tx
        .send(DtmfRequest {
            event_code,
            dtmf_pt,
        })
        .map_err(|e| format!("Failed to queue DTMF event: {}", e))?;

    emit_dtmf_event(call_id, digit, "send");
    tracing::info!(
        "Queued digit '{}' (event={}) pt={} for call {}",
        digit,
        event_code,
        dtmf_pt,
        call_id
    );
    Ok(())
}

/// Set hold state: when transitioning from hold to resume, flush jitter and reset metrics so resume audio is fresh.
pub fn set_hold(call_id: &str, on_hold: bool) -> Result<(), String> {
    let (_was_hold, need_reset) = {
        let calls = CALLS.lock().map_err(|e| e.to_string())?;
        let was_hold = calls
            .get(call_id)
            .map(|c| c.on_hold.load(Ordering::SeqCst))
            .unwrap_or(false);
        if let Some(call) = calls.get(call_id) {
            call.on_hold.store(on_hold, Ordering::SeqCst);
            if was_hold && !on_hold {
                if let Ok(mut j) = call.jitter.lock() {
                    j.flush();
                }
            }
        }
        (was_hold, was_hold && !on_hold)
    };
    if need_reset {
        let metrics = METRICS.lock().map_err(|e| e.to_string())?;
        if let Some(m) = metrics.get(call_id) {
            if let Ok(mut met) = m.lock() {
                met.reset_for_resume();
            }
        }
    }
    Ok(())
}

// ──────────────────────── Recording ────────────────────────

/// Get (or create) the recordings directory under the app config dir.
fn recordings_dir() -> Result<PathBuf, String> {
    let config = crate::core::config::get_config_dir().map_err(|e| e.to_string())?;
    let dir = config.join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create recordings dir: {}", e))?;
    Ok(dir)
}

/// Start recording an active call to a stereo WAV file (left=send/mic, right=recv/speaker).
/// Returns the file path of the recording.
pub fn start_recording(call_id: &str) -> Result<String, String> {
    // Check if already recording
    if let Ok(handles) = RECORDING_HANDLES.lock() {
        if handles.contains_key(call_id) {
            return Err("Already recording this call".to_string());
        }
    }

    let (recording_flag, send_buf, recv_buf, sample_rate) = {
        let calls = CALLS.lock().map_err(|e| e.to_string())?;
        let call = calls.get(call_id).ok_or("Call not found")?;
        (
            call.recording.clone(),
            call.recording_send_buf.clone(),
            call.recording_recv_buf.clone(),
            call.codec_sample_rate,
        )
    };

    let dir = recordings_dir()?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    // Sanitize call_id for filename
    let safe_id: String = call_id
        .chars()
        .take(24)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let filename = format!("{}_{}.wav", safe_id, timestamp);
    let path = dir.join(&filename);

    let spec = hound::WavSpec {
        channels: 2,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let writer = hound::WavWriter::create(&path, spec)
        .map_err(|e| format!("Failed to create WAV file: {}", e))?;
    let writer = Arc::new(Mutex::new(writer));

    // Set recording flag so capture/playout start accumulating samples
    recording_flag.store(true, Ordering::SeqCst);

    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();
    let path_clone = path.clone();
    let writer_clone = writer.clone();

    let handle = thread::spawn(move || {
        // Writer thread: periodically drain send/recv buffers and interleave into stereo WAV.
        while !stop_clone.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(50));

            let send_samples: Vec<i16> = {
                let mut buf = match send_buf.lock() {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                buf.drain(..).collect()
            };
            let recv_samples: Vec<i16> = {
                let mut buf = match recv_buf.lock() {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                buf.drain(..).collect()
            };

            let len = send_samples.len().max(recv_samples.len());
            if len == 0 {
                continue;
            }

            if let Ok(mut w) = writer_clone.lock() {
                for i in 0..len {
                    let send = send_samples.get(i).copied().unwrap_or(0);
                    let recv = recv_samples.get(i).copied().unwrap_or(0);
                    let _ = w.write_sample(send);
                    let _ = w.write_sample(recv);
                }
            }
        }

        // Final drain: flush any remaining samples
        let send_samples: Vec<i16> = send_buf
            .lock()
            .map(|mut b| b.drain(..).collect())
            .unwrap_or_default();
        let recv_samples: Vec<i16> = recv_buf
            .lock()
            .map(|mut b| b.drain(..).collect())
            .unwrap_or_default();
        let len = send_samples.len().max(recv_samples.len());
        if len > 0 {
            if let Ok(mut w) = writer_clone.lock() {
                for i in 0..len {
                    let send = send_samples.get(i).copied().unwrap_or(0);
                    let recv = recv_samples.get(i).copied().unwrap_or(0);
                    let _ = w.write_sample(send);
                    let _ = w.write_sample(recv);
                }
            }
        }

        // Finalize WAV (writes header with correct data length)
        if let Ok(w) = Arc::try_unwrap(writer_clone).or_else(|arc| {
            // If other refs still exist, just try to finalize through the lock
            Err(arc)
        }) {
            if let Ok(w) = w.into_inner() {
                let _ = w.finalize();
            }
        }
    });

    RECORDING_HANDLES.lock().map_err(|e| e.to_string())?.insert(
        call_id.to_string(),
        RecordingHandle {
            stop,
            _handle: handle,
            path: path_clone.clone(),
        },
    );

    Ok(path_clone.to_string_lossy().to_string())
}

/// Stop recording an active call. Finalizes the WAV file.
/// Returns the path to the completed recording.
pub fn stop_recording(call_id: &str) -> Result<String, String> {
    // Clear the recording flag so buffers stop accumulating
    if let Ok(calls) = CALLS.lock() {
        if let Some(call) = calls.get(call_id) {
            call.recording.store(false, Ordering::SeqCst);
        }
    }

    let handle = RECORDING_HANDLES
        .lock()
        .map_err(|e| e.to_string())?
        .remove(call_id)
        .ok_or("No active recording for this call")?;

    // Signal writer thread to stop and wait for it to finalize
    handle.stop.store(true, Ordering::SeqCst);
    let _ = handle._handle.join();

    Ok(handle.path.to_string_lossy().to_string())
}

/// Check if a call is currently being recorded.
pub fn is_recording(call_id: &str) -> bool {
    RECORDING_HANDLES
        .lock()
        .map(|h| h.contains_key(call_id))
        .unwrap_or(false)
}

/// Recording metadata returned to the frontend.
#[derive(Clone, serde::Serialize)]
pub struct RecordingInfo {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub call_id_prefix: String,
}

/// List all recordings in the recordings directory.
pub fn list_recordings() -> Result<Vec<RecordingInfo>, String> {
    let dir = recordings_dir()?;
    let mut recordings = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().map(|e| e == "wav").unwrap_or(false) {
            let filename = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let meta = std::fs::metadata(&path).ok();
            let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let created_at = meta
                .and_then(|m| m.created().ok())
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Utc> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_default();
            // Extract call_id prefix from filename (before the first '_' that precedes timestamp)
            let call_id_prefix = filename.rsplitn(3, '_').last().unwrap_or("").to_string();
            recordings.push(RecordingInfo {
                filename,
                path: path.to_string_lossy().to_string(),
                size_bytes,
                created_at,
                call_id_prefix,
            });
        }
    }

    // Sort by creation time, newest first
    recordings.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(recordings)
}

/// Delete a recording file.
pub fn delete_recording(filename: &str) -> Result<(), String> {
    let dir = recordings_dir()?;
    let path = dir.join(filename);
    if !path.exists() {
        return Err("Recording not found".to_string());
    }
    // Safety: only delete .wav files in the recordings directory
    if path.extension().map(|e| e == "wav").unwrap_or(false) && path.parent() == Some(&dir) {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        Err("Invalid recording path".to_string())
    }
}

/// Read raw WAV bytes for a recording file. Used for browser-side playback.
pub fn read_recording_data(filename: &str) -> Result<Vec<u8>, String> {
    let dir = recordings_dir()?;
    let path = dir.join(filename);
    if !path.exists() {
        return Err("Recording not found".to_string());
    }
    if !path.extension().map(|e| e == "wav").unwrap_or(false) || path.parent() != Some(&dir) {
        return Err("Invalid recording path".to_string());
    }
    std::fs::read(&path).map_err(|e| format!("Failed to read recording: {}", e))
}
