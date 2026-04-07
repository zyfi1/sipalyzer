//! Multicast audio sender with three source modes:
//!   1. **Tone** — synthetic waveforms (sine, sweep, noise, silence)
//!   2. **Microphone** — live capture from a cpal input device
//!   3. **TTS** — PCM samples fed from the frontend (Web Speech API)
//!
//! All modes share the same encode → RTP → multicast UDP pipeline.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use once_cell::sync::Lazy;

use crate::softphone::codecs::{AudioCodec, G711Codec, G722Codec, FRAME_MS};
use crate::softphone::rtp::RtpPacket;

use super::types::{AudioGeneratorMetrics, AudioGeneratorState};

const DEFAULT_FREQUENCY: f32 = 440.0;
const DEFAULT_AMPLITUDE: f32 = 0.5;
const DEFAULT_INPUT_GAIN: f32 = 1.0;

// ── Source Mode ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceMode {
    Tone,
    Microphone,
    Tts,
}

impl SourceMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "microphone" | "mic" => SourceMode::Microphone,
            "tts" | "speech" => SourceMode::Tts,
            _ => SourceMode::Tone,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            SourceMode::Tone => "tone",
            SourceMode::Microphone => "microphone",
            SourceMode::Tts => "tts",
        }
    }
}

// ── Tone Types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToneType {
    Sine,
    Sweep,
    WhiteNoise,
    Silence,
}

impl ToneType {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "sine" => ToneType::Sine,
            "sweep" => ToneType::Sweep,
            "noise" | "white_noise" => ToneType::WhiteNoise,
            "silence" => ToneType::Silence,
            _ => ToneType::Sine,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            ToneType::Sine => "Sine",
            ToneType::Sweep => "Sweep",
            ToneType::WhiteNoise => "White Noise",
            ToneType::Silence => "Silence",
        }
    }
}

// ── Shared State ─────────────────────────────────────────────────

pub(crate) struct GeneratorMetrics {
    packets_sent: u64,
    bytes_sent: u64,
    start_time: Instant,
}

/// Ring buffer for TTS PCM samples fed from the frontend.
pub(crate) struct TtsPcmBuffer {
    buf: VecDeque<i16>,
}

impl TtsPcmBuffer {
    fn new() -> Self {
        Self {
            buf: VecDeque::with_capacity(32000),
        }
    }

    fn push(&mut self, samples: &[i16]) {
        // Cap at ~4 seconds of 8kHz audio to prevent unbounded growth
        const MAX_SAMPLES: usize = 64000;
        for &s in samples {
            if self.buf.len() >= MAX_SAMPLES {
                self.buf.pop_front();
            }
            self.buf.push_back(s);
        }
    }

    fn drain_frame(&mut self, count: usize) -> Vec<i16> {
        let available = self.buf.len().min(count);
        let mut frame: Vec<i16> = self.buf.drain(..available).collect();
        // Pad with silence if not enough samples
        frame.resize(count, 0);
        frame
    }

    fn available(&self) -> usize {
        self.buf.len()
    }
}

/// Mic capture samples shared between the cpal callback and the sender thread.
pub(crate) struct MicBuffer {
    buf: VecDeque<i16>,
}

impl MicBuffer {
    fn new() -> Self {
        Self {
            buf: VecDeque::with_capacity(32000),
        }
    }

    fn push_interleaved_f32_resampled(
        &mut self,
        data: &[f32],
        channels: usize,
        source_rate: u32,
        target_rate: u32,
        gain: f32,
        resample_pos: &mut f32,
    ) {
        if channels == 0 || source_rate == 0 || target_rate == 0 {
            return;
        }
        let frames = data.len() / channels;
        if frames == 0 {
            return;
        }
        const MAX_SAMPLES: usize = 64000;
        let step = source_rate as f32 / target_rate as f32;
        let mut frame_pos = *resample_pos;
        while frame_pos < frames as f32 {
            let frame_idx = frame_pos as usize;
            let base = frame_idx * channels;
            let mut mono = 0.0f32;
            for ch in 0..channels {
                mono += data[base + ch];
            }
            mono /= channels as f32;
            let val = (mono * gain * 32767.0).clamp(-32767.0, 32767.0) as i16;
            if self.buf.len() >= MAX_SAMPLES {
                self.buf.pop_front();
            }
            self.buf.push_back(val);
            frame_pos += step;
        }
        *resample_pos = frame_pos - frames as f32;
    }

    fn push_interleaved_i16_resampled(
        &mut self,
        data: &[i16],
        channels: usize,
        source_rate: u32,
        target_rate: u32,
        gain: f32,
        resample_pos: &mut f32,
    ) {
        if channels == 0 || source_rate == 0 || target_rate == 0 {
            return;
        }
        let frames = data.len() / channels;
        if frames == 0 {
            return;
        }
        const MAX_SAMPLES: usize = 64000;
        let step = source_rate as f32 / target_rate as f32;
        let mut frame_pos = *resample_pos;
        while frame_pos < frames as f32 {
            let frame_idx = frame_pos as usize;
            let base = frame_idx * channels;
            let mut mono = 0.0f32;
            for ch in 0..channels {
                mono += data[base + ch] as f32 / 32768.0;
            }
            mono /= channels as f32;
            let val = (mono * gain * 32767.0).clamp(-32767.0, 32767.0) as i16;
            if self.buf.len() >= MAX_SAMPLES {
                self.buf.pop_front();
            }
            self.buf.push_back(val);
            frame_pos += step;
        }
        *resample_pos = frame_pos - frames as f32;
    }

    fn push_interleaved_u16_resampled(
        &mut self,
        data: &[u16],
        channels: usize,
        source_rate: u32,
        target_rate: u32,
        gain: f32,
        resample_pos: &mut f32,
    ) {
        if channels == 0 || source_rate == 0 || target_rate == 0 {
            return;
        }
        let frames = data.len() / channels;
        if frames == 0 {
            return;
        }
        const MAX_SAMPLES: usize = 64000;
        let step = source_rate as f32 / target_rate as f32;
        let mut frame_pos = *resample_pos;
        while frame_pos < frames as f32 {
            let frame_idx = frame_pos as usize;
            let base = frame_idx * channels;
            let mut mono = 0.0f32;
            for ch in 0..channels {
                mono += (data[base + ch] as f32 - 32768.0) / 32768.0;
            }
            mono /= channels as f32;
            let val = (mono * gain * 32767.0).clamp(-32767.0, 32767.0) as i16;
            if self.buf.len() >= MAX_SAMPLES {
                self.buf.pop_front();
            }
            self.buf.push_back(val);
            frame_pos += step;
        }
        *resample_pos = frame_pos - frames as f32;
    }

    fn drain_frame(&mut self, count: usize) -> Vec<i16> {
        let available = self.buf.len().min(count);
        let mut frame: Vec<i16> = self.buf.drain(..available).collect();
        frame.resize(count, 0);
        frame
    }
}

// Wrapper to allow cpal::Stream in a static HashMap (Send required)
struct SendStream(cpal::Stream);
unsafe impl Send for SendStream {}

pub struct MulticastAudioSender {
    pub group: String,
    pub port: u16,
    pub cancel_tx: tokio::sync::watch::Sender<bool>,
    pub source_mode: Arc<Mutex<SourceMode>>,
    pub frequency: Arc<AtomicU32>,
    pub amplitude: Arc<AtomicU32>,
    pub input_gain: Arc<AtomicU32>,
    pub tone_type: Arc<Mutex<ToneType>>,
    pub(crate) metrics: Arc<Mutex<GeneratorMetrics>>,
    pub tts_buffer: Arc<Mutex<TtsPcmBuffer>>,
    pub mic_buffer: Arc<Mutex<MicBuffer>>,
    pub target_sample_rate: u32,
    pub input_device_id: Arc<Mutex<Option<String>>>,
    _mic_stream: Option<SendStream>,
    #[allow(dead_code)]
    sender_handle: Option<thread::JoinHandle<()>>,
}

static ACTIVE_SENDERS: Lazy<Mutex<HashMap<String, MulticastAudioSender>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn codec_from_name(name: &str) -> Option<Box<dyn AudioCodec>> {
    match name.to_uppercase().as_str() {
        "PCMU" => Some(Box::new(G711Codec::PCMU)),
        "PCMA" => Some(Box::new(G711Codec::PCMA)),
        "G722" => Some(Box::new(G722Codec::new())),
        _ => None,
    }
}

// ── Tone generation ──────────────────────────────────────────────

fn generate_sine(
    sample_rate: u32,
    frequency: f32,
    amplitude: f32,
    phase: &mut f32,
    count: usize,
) -> Vec<i16> {
    let mut samples = Vec::with_capacity(count);
    let phase_inc = 2.0 * std::f32::consts::PI * frequency / sample_rate as f32;
    for _ in 0..count {
        let val = (*phase).sin() * amplitude * 32767.0;
        samples.push(val.clamp(-32767.0, 32767.0) as i16);
        *phase += phase_inc;
        if *phase > 2.0 * std::f32::consts::PI {
            *phase -= 2.0 * std::f32::consts::PI;
        }
    }
    samples
}

fn generate_sweep(
    sample_rate: u32,
    amplitude: f32,
    phase: &mut f32,
    sweep_pos: &mut f32,
    count: usize,
) -> Vec<i16> {
    let mut samples = Vec::with_capacity(count);
    let sweep_rate = 2.0 / sample_rate as f32;
    for _ in 0..count {
        let freq = 200.0 + (*sweep_pos).abs() * 3800.0;
        let phase_inc = 2.0 * std::f32::consts::PI * freq / sample_rate as f32;
        let val = (*phase).sin() * amplitude * 32767.0;
        samples.push(val.clamp(-32767.0, 32767.0) as i16);
        *phase += phase_inc;
        if *phase > 2.0 * std::f32::consts::PI {
            *phase -= 2.0 * std::f32::consts::PI;
        }
        *sweep_pos += sweep_rate;
        if *sweep_pos > 1.0 {
            *sweep_pos -= 2.0;
        }
    }
    samples
}

fn generate_noise(amplitude: f32, count: usize) -> Vec<i16> {
    let mut samples = Vec::with_capacity(count);
    let mut seed: u32 = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos())
        ^ 0xDEADBEEF;
    for _ in 0..count {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let val = ((seed as i32 >> 16) as f32 / 32768.0) * amplitude * 32767.0;
        samples.push(val.clamp(-32767.0, 32767.0) as i16);
    }
    samples
}

// ── Microphone capture ───────────────────────────────────────────

fn start_mic_capture(
    device_id: Option<&str>,
    mic_buf: Arc<Mutex<MicBuffer>>,
    gain: Arc<AtomicU32>,
    target_rate: u32,
    cancel: tokio::sync::watch::Receiver<bool>,
) -> Result<SendStream, String> {
    let host = cpal::default_host();

    let device = if let Some(id) = device_id {
        host.input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().ok().as_deref() == Some(id))
            .or_else(|| host.default_input_device())
    } else {
        host.default_input_device()
    };

    let device = device.ok_or_else(|| "No input device available".to_string())?;

    let default_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {}", e))?;
    let mut selected_config = default_config.config();
    let mut selected_sample_format = default_config.sample_format();
    if let Ok(mut supported) = device.supported_input_configs() {
        if let Some(range) = supported.find(|cfg| {
            let min = cfg.min_sample_rate().0;
            let max = cfg.max_sample_rate().0;
            min <= target_rate && target_rate <= max
        }) {
            selected_sample_format = range.sample_format();
            selected_config = range
                .with_sample_rate(cpal::SampleRate(target_rate))
                .config();
        }
    }

    let channels = selected_config.channels as usize;
    let source_rate = selected_config.sample_rate.0;
    let target_rate = target_rate.max(8000);
    let resample_pos = Arc::new(Mutex::new(0.0f32));

    let stream = device
        .build_input_stream_raw(
            &selected_config,
            selected_sample_format,
            move |data: &cpal::Data, _: &cpal::InputCallbackInfo| {
                if *cancel.borrow() {
                    return;
                }
                let g = f32::from_bits(gain.load(Ordering::Relaxed));
                let mut pos_guard = match resample_pos.lock() {
                    Ok(p) => p,
                    Err(_) => return,
                };
                let mut buf = match mic_buf.lock() {
                    Ok(b) => b,
                    Err(_) => return,
                };

                match selected_sample_format {
                    cpal::SampleFormat::F32 => {
                        if let Some(samples) = data.as_slice::<f32>() {
                            buf.push_interleaved_f32_resampled(
                                samples,
                                channels,
                                source_rate,
                                target_rate,
                                g,
                                &mut pos_guard,
                            );
                        }
                    }
                    cpal::SampleFormat::I16 => {
                        if let Some(samples) = data.as_slice::<i16>() {
                            buf.push_interleaved_i16_resampled(
                                samples,
                                channels,
                                source_rate,
                                target_rate,
                                g,
                                &mut pos_guard,
                            );
                        }
                    }
                    cpal::SampleFormat::U16 => {
                        if let Some(samples) = data.as_slice::<u16>() {
                            buf.push_interleaved_u16_resampled(
                                samples,
                                channels,
                                source_rate,
                                target_rate,
                                g,
                                &mut pos_guard,
                            );
                        }
                    }
                    _ => {}
                }
            },
            |err| {
                tracing::error!("capture error: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Failed to build mic input stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start mic stream: {}", e))?;
    Ok(SendStream(stream))
}

// ── Public API ───────────────────────────────────────────────────

/// Start the audio sender on a multicast group.
pub fn start(
    group: &str,
    port: u16,
    codec_name: Option<&str>,
    source: Option<&str>,
    tone: Option<&str>,
    frequency: Option<f32>,
    amplitude: Option<f32>,
    input_device_id: Option<&str>,
) -> Result<(), String> {
    let group_addr: std::net::Ipv4Addr = group
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    if !group_addr.is_multicast() {
        return Err(format!("{} is not a multicast IPv4 address", group));
    }

    let key = format!("{}:{}", group, port);
    {
        let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
        if guard.contains_key(&key) {
            return Err(format!("Generator already active for {}:{}", group, port));
        }
    }

    let codec: Box<dyn AudioCodec> = codec_name
        .and_then(codec_from_name)
        .unwrap_or_else(|| Box::new(G711Codec::PCMU));
    let codec_sample_rate = codec.sample_rate();

    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

    let mode = Arc::new(Mutex::new(
        source.map(SourceMode::from_str).unwrap_or(SourceMode::Tone),
    ));
    let freq_atomic = Arc::new(AtomicU32::new(
        frequency.unwrap_or(DEFAULT_FREQUENCY).to_bits(),
    ));
    let amp_atomic = Arc::new(AtomicU32::new(
        amplitude.unwrap_or(DEFAULT_AMPLITUDE).to_bits(),
    ));
    let gain_atomic = Arc::new(AtomicU32::new(DEFAULT_INPUT_GAIN.to_bits()));
    let tone_type = Arc::new(Mutex::new(
        tone.map(ToneType::from_str).unwrap_or(ToneType::Sine),
    ));
    let metrics = Arc::new(Mutex::new(GeneratorMetrics {
        packets_sent: 0,
        bytes_sent: 0,
        start_time: Instant::now(),
    }));
    let tts_buffer = Arc::new(Mutex::new(TtsPcmBuffer::new()));
    let mic_buffer = Arc::new(Mutex::new(MicBuffer::new()));
    let input_dev_id = Arc::new(Mutex::new(input_device_id.map(String::from)));

    // Start mic capture if in microphone mode
    let initial_mode = mode.lock().map(|m| m.clone()).unwrap_or(SourceMode::Tone);
    let mic_stream = if initial_mode == SourceMode::Microphone {
        match start_mic_capture(
            input_device_id,
            mic_buffer.clone(),
            gain_atomic.clone(),
            codec_sample_rate,
            cancel_rx.clone(),
        ) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::error!("mic capture failed, falling back to tone: {}", e);
                if let Ok(mut m) = mode.lock() {
                    *m = SourceMode::Tone;
                }
                None
            }
        }
    } else {
        None
    };

    // Create UDP socket
    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )
    .map_err(|e| e.to_string())?;
    socket.set_reuse_address(true).map_err(|e| e.to_string())?;
    socket
        .set_send_buffer_size(1 << 20)
        .map_err(|e| format!("Failed to set send buffer size: {}", e))?;
    let sock_ref = socket2::SockRef::from(&socket);
    sock_ref
        .set_multicast_loop_v4(true)
        .map_err(|e| e.to_string())?;
    let bind_addr = std::net::SocketAddrV4::new(std::net::Ipv4Addr::UNSPECIFIED, 0);
    socket
        .bind(&socket2::SockAddr::from(bind_addr))
        .map_err(|e| e.to_string())?;
    let dest = socket2::SockAddr::from(std::net::SocketAddrV4::new(group_addr, port));

    // Clone shared state for the sender thread
    let mode_tx = mode.clone();
    let freq_tx = freq_atomic.clone();
    let amp_tx = amp_atomic.clone();
    let tone_tx = tone_type.clone();
    let metrics_tx = metrics.clone();
    let tts_tx = tts_buffer.clone();
    let mic_tx = mic_buffer.clone();

    let sender_handle = thread::spawn(move || {
        let sample_rate = codec.sample_rate();
        let frame_samples = codec.frame_samples();
        let pt = codec.pt();
        let frame_duration = Duration::from_millis(FRAME_MS as u64);

        let ssrc = rand_ssrc();
        let mut sequence: u16 = 0;
        let mut timestamp: u32 = 0;
        let mut phase: f32 = 0.0;
        let mut sweep_pos: f32 = 0.0;
        let mut next_send = Instant::now();

        while !*cancel_rx.borrow() {
            let now = Instant::now();
            if now < next_send {
                thread::sleep(next_send.saturating_duration_since(now));
            }
            next_send += frame_duration;

            let current_mode = mode_tx
                .lock()
                .map(|m| m.clone())
                .unwrap_or(SourceMode::Tone);

            let pcm = match current_mode {
                SourceMode::Tone => {
                    let freq = f32::from_bits(freq_tx.load(Ordering::Relaxed));
                    let amp = f32::from_bits(amp_tx.load(Ordering::Relaxed));
                    let current_tone = tone_tx.lock().map(|t| *t).unwrap_or(ToneType::Sine);
                    match current_tone {
                        ToneType::Sine => {
                            generate_sine(sample_rate, freq, amp, &mut phase, frame_samples)
                        }
                        ToneType::Sweep => generate_sweep(
                            sample_rate,
                            amp,
                            &mut phase,
                            &mut sweep_pos,
                            frame_samples,
                        ),
                        ToneType::WhiteNoise => generate_noise(amp, frame_samples),
                        ToneType::Silence => vec![0i16; frame_samples],
                    }
                }
                SourceMode::Microphone => {
                    if let Ok(mut buf) = mic_tx.lock() {
                        buf.drain_frame(frame_samples)
                    } else {
                        vec![0i16; frame_samples]
                    }
                }
                SourceMode::Tts => {
                    if let Ok(mut buf) = tts_tx.lock() {
                        buf.drain_frame(frame_samples)
                    } else {
                        vec![0i16; frame_samples]
                    }
                }
            };

            let encoded = codec.encode_frame(&pcm);

            let rtp = RtpPacket {
                payload_type: pt,
                sequence,
                timestamp,
                ssrc,
                marker: sequence == 0,
                payload: encoded,
            };
            let wire = rtp.serialize();

            match socket.send_to(&wire, &dest) {
                Ok(n) => {
                    if let Ok(mut m) = metrics_tx.lock() {
                        m.packets_sent += 1;
                        m.bytes_sent += n as u64;
                    }
                }
                Err(_) => break,
            }

            sequence = sequence.wrapping_add(1);
            let ts_increment = if pt == 9 { 160 } else { frame_samples as u32 };
            timestamp = timestamp.wrapping_add(ts_increment);
        }
    });

    let sender = MulticastAudioSender {
        group: group.to_string(),
        port,
        cancel_tx,
        source_mode: mode,
        frequency: freq_atomic,
        amplitude: amp_atomic,
        input_gain: gain_atomic,
        tone_type,
        metrics,
        tts_buffer,
        mic_buffer,
        target_sample_rate: codec_sample_rate,
        input_device_id: input_dev_id,
        _mic_stream: mic_stream,
        sender_handle: Some(sender_handle),
    };

    let mut guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    guard.insert(key, sender);

    Ok(())
}

/// Stop the audio generator for the given group.
pub fn stop(group: &str) -> Result<(), String> {
    let key = {
        let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
        match guard
            .keys()
            .find(|k| k.starts_with(&format!("{}:", group)))
            .cloned()
        {
            Some(k) => k,
            None => return Ok(()), // idempotent stop
        }
    };
    let sender = {
        let mut guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
        match guard.remove(&key) {
            Some(s) => s,
            None => return Ok(()), // idempotent stop
        }
    };
    let _ = sender.cancel_tx.send(true);
    Ok(())
}

/// Switch source mode (tone / microphone / tts). Starts/stops mic capture as needed.
pub fn set_source_mode(group: &str, source: &str, device_id: Option<&str>) -> Result<(), String> {
    let new_mode = SourceMode::from_str(source);
    let mut guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    let key = guard
        .keys()
        .find(|k| k.starts_with(&format!("{}:", group)))
        .cloned()
        .ok_or_else(|| format!("No active generator for group {}", group))?;
    let sender = guard
        .get_mut(&key)
        .ok_or_else(|| format!("No active generator for group {}", group))?;

    if let Ok(mut dev) = sender.input_device_id.lock() {
        *dev = device_id.map(String::from);
    }

    // Start mic capture if switching to microphone mode
    if new_mode == SourceMode::Microphone && sender._mic_stream.is_none() {
        match start_mic_capture(
            device_id,
            sender.mic_buffer.clone(),
            sender.input_gain.clone(),
            sender.target_sample_rate,
            sender.cancel_tx.subscribe(),
        ) {
            Ok(s) => sender._mic_stream = Some(s),
            Err(e) => return Err(format!("Failed to start mic: {}", e)),
        }
    } else if new_mode != SourceMode::Microphone {
        sender._mic_stream = None;
    }

    if let Ok(mut m) = sender.source_mode.lock() {
        *m = new_mode;
    }

    Ok(())
}

/// Feed TTS PCM samples (i16, mono, at codec sample rate).
pub fn feed_tts_pcm(group: &str, samples: &[i16]) -> Result<(), String> {
    let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    let sender = find_sender(&guard, group)?;
    if let Ok(mut buf) = sender.tts_buffer.lock() {
        buf.push(samples);
    }
    Ok(())
}

/// Set input gain for microphone mode (0.0 - 4.0).
pub fn set_input_gain(group: &str, gain: f32) -> Result<(), String> {
    let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    let sender = find_sender(&guard, group)?;
    sender
        .input_gain
        .store(gain.clamp(0.0, 4.0).to_bits(), Ordering::Relaxed);
    Ok(())
}

/// Update the tone frequency (Hz).
pub fn set_frequency(group: &str, frequency: f32) -> Result<(), String> {
    let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    let sender = find_sender(&guard, group)?;
    sender
        .frequency
        .store(frequency.to_bits(), Ordering::Relaxed);
    Ok(())
}

/// Update the amplitude (0.0 to 1.0).
pub fn set_amplitude(group: &str, amplitude: f32) -> Result<(), String> {
    let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    let sender = find_sender(&guard, group)?;
    sender
        .amplitude
        .store(amplitude.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    Ok(())
}

/// Update the tone type.
pub fn set_tone_type(group: &str, tone: &str) -> Result<(), String> {
    let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    let sender = find_sender(&guard, group)?;
    if let Ok(mut t) = sender.tone_type.lock() {
        *t = ToneType::from_str(tone);
    }
    Ok(())
}

/// Get the current generator state.
pub fn get_state(group: &str) -> Result<AudioGeneratorState, String> {
    let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    let sender = find_sender(&guard, group)?;
    let tone_name = sender
        .tone_type
        .lock()
        .map(|t| t.name().to_string())
        .unwrap_or_default();
    let mode_name = sender
        .source_mode
        .lock()
        .map(|m| m.name().to_string())
        .unwrap_or_else(|_| "tone".to_string());
    let dev_id = sender.input_device_id.lock().ok().and_then(|g| g.clone());
    Ok(AudioGeneratorState {
        group: sender.group.clone(),
        generating: true,
        tone_type: tone_name,
        frequency: f32::from_bits(sender.frequency.load(Ordering::Relaxed)),
        amplitude: f32::from_bits(sender.amplitude.load(Ordering::Relaxed)),
        source_mode: mode_name,
        input_device_id: dev_id,
        input_gain: f32::from_bits(sender.input_gain.load(Ordering::Relaxed)),
    })
}

/// Get generator metrics.
pub fn get_metrics(group: &str) -> Result<AudioGeneratorMetrics, String> {
    let guard = ACTIVE_SENDERS.lock().map_err(|e| e.to_string())?;
    let sender = find_sender(&guard, group)?;
    let m = sender.metrics.lock().map_err(|e| e.to_string())?;
    let duration_secs = m.start_time.elapsed().as_secs_f64();
    let bitrate_kbps = if duration_secs > 0.0 {
        (m.bytes_sent as f64 * 8.0 / 1000.0) / duration_secs
    } else {
        0.0
    };
    Ok(AudioGeneratorMetrics {
        group: sender.group.clone(),
        packets_sent: m.packets_sent,
        bytes_sent: m.bytes_sent,
        duration_secs,
        bitrate_kbps,
    })
}

/// List all active generators.
pub fn list_active() -> Vec<AudioGeneratorState> {
    let guard = match ACTIVE_SENDERS.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    guard
        .values()
        .map(|s| {
            let tone_name = s
                .tone_type
                .lock()
                .map(|t| t.name().to_string())
                .unwrap_or_default();
            let mode_name = s
                .source_mode
                .lock()
                .map(|m| m.name().to_string())
                .unwrap_or_else(|_| "tone".to_string());
            let dev_id = s.input_device_id.lock().ok().and_then(|g| g.clone());
            AudioGeneratorState {
                group: s.group.clone(),
                generating: true,
                tone_type: tone_name,
                frequency: f32::from_bits(s.frequency.load(Ordering::Relaxed)),
                amplitude: f32::from_bits(s.amplitude.load(Ordering::Relaxed)),
                source_mode: mode_name,
                input_device_id: dev_id,
                input_gain: f32::from_bits(s.input_gain.load(Ordering::Relaxed)),
            }
        })
        .collect()
}

fn find_sender<'a>(
    guard: &'a HashMap<String, MulticastAudioSender>,
    group: &str,
) -> Result<&'a MulticastAudioSender, String> {
    let key = guard
        .keys()
        .find(|k| k.starts_with(&format!("{}:", group)))
        .cloned()
        .ok_or_else(|| format!("No active generator for group {}", group))?;
    guard
        .get(&key)
        .ok_or_else(|| format!("No active generator for group {}", group))
}

fn rand_ssrc() -> u32 {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    (t.as_nanos() as u32) ^ 0x12345678
}
