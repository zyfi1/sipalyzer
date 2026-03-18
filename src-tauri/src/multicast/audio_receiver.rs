//! Lightweight receive-only RTP audio pipeline for multicast.
//! Pipeline: broadcast::Receiver<PacketData> → RtpPacket::deserialize → JitterBuffer → decode → volume/mute → cpal → speaker.
//!
//! NO socket is created here. The listener owns the single socket and broadcasts
//! raw packet data; this module subscribes via `tokio::sync::broadcast`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use once_cell::sync::Lazy;
use tauri::Emitter;

use crate::softphone::codecs::{
    codec_from_pt, AudioCodec, G711Codec, G722Codec, SAMPLE_RATE_16K,
};
use crate::softphone::jitter_buffer::JitterBuffer;
use crate::softphone::rtp::RtpPacket;

use super::types::{AudioStreamMetrics, AudioStreamState, AudioWaveform, PacketData};

const DEFAULT_VOLUME: f32 = 0.8;
const WAVEFORM_CAP_MS: u32 = 400;
const JITTER_MIN_MS: u32 = 20;
const JITTER_MAX_MS: u32 = 200;
const PLAYOUT_TICK_MS: u64 = 20;

struct SendStream(cpal::Stream);
// SAFETY: We only access the stream from behind a Mutex and control its lifecycle.
// cpal::Stream is not Send due to platform internals, but our usage is safe.
unsafe impl Send for SendStream {}

/// Internal metrics for the audio receiver.
pub(crate) struct AudioReceiverMetrics {
    packets_received: u64,
    bytes_received: u64,
    start_time: Instant,
    jitter_ms: f64,
    loss_count: u64,
    last_seq: Option<u16>,
    peak: f32,
}

/// Multicast audio receiver: receives RTP via broadcast channel, decodes, applies volume/mute, plays via cpal.
pub struct MulticastAudioReceiver {
    pub group: String,
    pub port: u16,
    pub volume: Arc<AtomicU32>,
    pub muted: Arc<AtomicBool>,
    pub cancel_tx: tokio::sync::watch::Sender<bool>,
    pub(crate) waveform: Arc<Mutex<WaveformRing>>,
    pub(crate) metrics: Arc<Mutex<AudioReceiverMetrics>>,
    pub codec_name: Arc<Mutex<String>>,
    pub ssrc: Arc<AtomicU32>,
    pub source_ip: Arc<Mutex<String>>,
    #[allow(dead_code)]
    receiver_handle: Option<thread::JoinHandle<()>>,
    #[allow(dead_code)]
    playout_handle: Option<thread::JoinHandle<()>>,
    #[allow(dead_code)]
    output_stream: Option<SendStream>,
}

static ACTIVE_RECEIVERS: Lazy<Mutex<HashMap<String, MulticastAudioReceiver>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn codec_from_name(name: &str) -> Option<Box<dyn AudioCodec>> {
    match name.to_uppercase().as_str() {
        "PCMU" => Some(Box::new(G711Codec::PCMU)),
        "PCMA" => Some(Box::new(G711Codec::PCMA)),
        "G722" => Some(Box::new(G722Codec::new())),
        _ => None,
    }
}

/// Ring buffer for waveform: last ~400ms of normalized f32 samples.
pub(crate) struct WaveformRing {
    buf: Vec<f32>,
    cap: usize,
    write_pos: usize,
    len: usize,
}

impl WaveformRing {
    fn new(sample_rate: u32) -> Self {
        let cap = (sample_rate as usize * WAVEFORM_CAP_MS as usize) / 1000;
        WaveformRing {
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

    fn get_copy(&self) -> Vec<f32> {
        if self.len == 0 {
            return vec![];
        }
        let start = (self.write_pos + self.cap - self.len) % self.cap;
        (0..self.len).map(|i| self.buf[(start + i) % self.cap]).collect()
    }

    fn peak_rms(samples: &[f32]) -> (f32, f32) {
        if samples.is_empty() {
            return (0.0, 0.0);
        }
        let peak = samples
            .iter()
            .map(|&s| s.abs())
            .fold(0.0f32, |a, b| a.max(b));
        let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
        let rms = (sum_sq / samples.len() as f32).sqrt();
        (peak, rms)
    }
}

/// Start receiving and playing multicast RTP audio.
/// Instead of creating a socket, subscribes to the listener's broadcast channel.
pub fn start(
    app: tauri::AppHandle,
    group: &str,
    port: u16,
    packet_rx: tokio::sync::broadcast::Receiver<PacketData>,
    output_device_id: Option<&str>,
    codec_override: Option<&str>,
) -> Result<(), String> {
    let key = format!("{}:{}", group, port);
    {
        let guard = ACTIVE_RECEIVERS.lock().map_err(|e| e.to_string())?;
        if guard.contains_key(&key) {
            return Err(format!("Receiver already active for {}:{}", group, port));
        }
    }

    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let volume = Arc::new(AtomicU32::new(DEFAULT_VOLUME.to_bits()));
    let muted = Arc::new(AtomicBool::new(false));
    let waveform_buf = Arc::new(Mutex::new(WaveformRing::new(SAMPLE_RATE_16K)));
    let metrics = Arc::new(Mutex::new(AudioReceiverMetrics {
        packets_received: 0,
        bytes_received: 0,
        start_time: Instant::now(),
        jitter_ms: 0.0,
        loss_count: 0,
        last_seq: None,
        peak: 0.0,
    }));
    let codec_name = Arc::new(Mutex::new(String::new()));
    let ssrc = Arc::new(AtomicU32::new(0));
    let source_ip = Arc::new(Mutex::new(String::new()));

    let codec: Arc<Mutex<Option<Box<dyn AudioCodec>>>> = Arc::new(Mutex::new(
        codec_override.and_then(|n| codec_from_name(n)),
    ));
    if codec_override.is_some() && codec.lock().map(|g| g.is_none()).unwrap_or(true) {
        return Err(format!("Invalid codec override: {:?}", codec_override));
    }
    if let Some(ref c) = codec_override {
        if let Ok(mut name) = codec_name.lock() {
            *name = c.to_string();
        }
    }

    let jitter = Arc::new(Mutex::new(JitterBuffer::new(JITTER_MIN_MS, JITTER_MAX_MS)));
    let (tx_playout, rx_playout) = mpsc::sync_channel::<Vec<i16>>(128);

    let codec_sample_rate: Arc<Mutex<u32>> = Arc::new(Mutex::new(
        codec_override.and_then(|n| codec_from_name(n).map(|c| c.sample_rate())).unwrap_or(0),
    ));

    tracing::info!("Audio receiver started for {}:{} (broadcast subscriber)", group, port);

    let group_owned = group.to_string();
    let app_recv = app.clone();
    let cancel_rx_recv = cancel_rx.clone();
    let jitter_recv = jitter.clone();
    let codec_recv = codec.clone();
    let metrics_recv = metrics.clone();
    let codec_name_recv = codec_name.clone();
    let ssrc_recv = ssrc.clone();
    let source_ip_recv = source_ip.clone();
    let codec_sample_rate_recv = codec_sample_rate.clone();
    let codec_override_owned = codec_override.map(|s| s.to_string());
    let volume_recv = volume.clone();
    let muted_recv = muted.clone();

    let receiver_handle = thread::spawn(move || {
        let mut packet_rx = packet_rx;
        while !*cancel_rx_recv.borrow() {
            let pkt_data = match packet_rx.blocking_recv() {
                Ok(d) => d,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::info!("broadcast lagged, missed {} packets", n);
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    tracing::info!("broadcast channel closed");
                    break;
                }
            };

            let data = &pkt_data.data;
            let from_ip = &pkt_data.source_ip;

            if let Some(pkt) = RtpPacket::deserialize(data) {
                if let Ok(mut m) = metrics_recv.lock() {
                    m.packets_received += 1;
                    m.bytes_received += data.len() as u64;
                    if let Some(prev) = m.last_seq {
                        let diff = pkt.sequence.wrapping_sub(prev) as u32;
                        if diff > 1 {
                            m.loss_count += (diff - 1) as u64;
                        }
                    }
                    m.last_seq = Some(pkt.sequence);
                }

                let now = Instant::now();
                if let Ok(mut j) = jitter_recv.lock() {
                    if let Ok(cg) = codec_recv.lock() {
                        if let Some(ref c) = *cg {
                            j.set_clock_rate(c.sample_rate());
                        }
                    }
                    j.push(pkt.clone(), now);
                    if let Ok(mut m) = metrics_recv.lock() {
                        m.jitter_ms = j.estimated_jitter_ms();
                    }
                }

                let is_first = {
                    let has_codec = codec_recv.lock().ok().map(|g| g.is_some()).unwrap_or(false);
                    if !has_codec {
                        let new_codec = codec_override_owned
                            .as_deref()
                            .and_then(|n| codec_from_name(n))
                            .or_else(|| codec_from_pt(pkt.payload_type));
                        if let Some(c) = new_codec {
                            if let Ok(mut g) = codec_recv.lock() {
                                *g = Some(c);
                            }
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };

                if is_first {
                    if let Ok(g) = codec_recv.lock() {
                        if let Some(ref c) = *g {
                            if let Ok(mut rate) = codec_sample_rate_recv.lock() {
                                *rate = c.sample_rate();
                            }
                            if let Ok(mut j) = jitter_recv.lock() {
                                j.set_clock_rate(c.sample_rate());
                            }
                        }
                    }
                    ssrc_recv.store(pkt.ssrc, Ordering::Relaxed);
                    if let Ok(mut ip) = source_ip_recv.lock() {
                        *ip = from_ip.clone();
                    }
                    if let Ok(mut name) = codec_name_recv.lock() {
                        if name.is_empty() {
                            if let Ok(guard) = codec_recv.lock() {
                                if let Some(ref c) = *guard {
                                    *name = c.name().to_string();
                                }
                            }
                        }
                    }
                    let state = AudioStreamState {
                        group: group_owned.clone(),
                        playing: true,
                        muted: muted_recv.load(Ordering::Relaxed),
                        volume: f32::from_bits(volume_recv.load(Ordering::Relaxed)),
                        codec_name: codec_name_recv.lock().map(|g| g.clone()).unwrap_or_default(),
                        sample_rate: codec_sample_rate_recv.lock().map(|g| *g).unwrap_or(0),
                        ssrc: pkt.ssrc,
                        source_ip: source_ip_recv.lock().map(|g| g.clone()).unwrap_or_default(),
                    };
                    let _ = app_recv.emit("multicast:audio-stream", state);
                }
            }
        }
    });

    let cancel_rx_play = cancel_rx.clone();
    let jitter_play = jitter.clone();
    let codec_play = codec.clone();
    let metrics_play = metrics.clone();
    let waveform_play = waveform_buf.clone();
    let volume_play = volume.clone();
    let muted_play = muted.clone();
    let playout_handle = thread::spawn(move || {
        let frame_duration = Duration::from_millis(PLAYOUT_TICK_MS);
        let mut next_playout = Instant::now();
        while !*cancel_rx_play.borrow() {
            let now = Instant::now();
            if now < next_playout {
                thread::sleep(next_playout.saturating_duration_since(now));
            }
            next_playout += frame_duration;

            let pcm = {
                let codec_guard = match codec_play.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                if codec_guard.is_none() {
                    let silent = vec![0i16; 160];
                    let _ = tx_playout.try_send(silent);
                    continue;
                }
                let c = codec_guard.as_ref().unwrap();
                let packet = {
                    let mut j = match jitter_play.lock() {
                        Ok(g) => g,
                        Err(_) => continue,
                    };
                    j.pop_ready(Instant::now())
                };
                let decoded = packet
                    .map(|pkt| c.decode_frame(&pkt.payload))
                    .unwrap_or_else(|| vec![0i16; c.frame_samples()]);

                let vol = f32::from_bits(volume_play.load(Ordering::Relaxed));
                let mute = muted_play.load(Ordering::Relaxed);
                let out: Vec<i16> = decoded
                    .iter()
                    .map(|&s| {
                        let v = if mute {
                            0.0
                        } else {
                            (s as f32 / 32768.0 * vol).clamp(-1.0, 1.0) * 32767.0
                        };
                        v as i16
                    })
                    .collect();

                if let Ok(mut m) = metrics_play.lock() {
                    let peak = out
                        .iter()
                        .map(|&s| (s as i32).abs())
                        .max()
                        .unwrap_or(0) as f32
                        / 32768.0;
                    m.peak = m.peak.max(peak);
                }

                let f32_samples: Vec<f32> = out.iter().map(|&s| s as f32 / 32768.0).collect();
                if let Ok(mut w) = waveform_play.lock() {
                    w.push(&f32_samples);
                }

                out
            };

            if tx_playout.send(pcm).is_err() {
                break;
            }
        }
    });

    let host = cpal::default_host();
    let output_device = if let Some(id) = output_device_id {
        host.output_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().map(|n| n == id).unwrap_or(false))
            .or_else(|| host.default_output_device())
    } else {
        host.default_output_device()
    };

    let output_device = output_device.ok_or("No output device available")?;

    let default_config = output_device
        .default_output_config()
        .map_err(|e| e.to_string())?;
    let out_config: cpal::StreamConfig = default_config.clone().into();
    let device_rate = default_config.sample_rate().0;

    let rx_playout_shared: Arc<Mutex<mpsc::Receiver<Vec<i16>>>> = Arc::new(Mutex::new(rx_playout));
    let playout_buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));

    let ratio_cell = codec_sample_rate.clone();
    let rx_cpal = rx_playout_shared.clone();
    let playout_buf_cb = playout_buf.clone();

    let output_stream = output_device
        .build_output_stream(
            &out_config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let codec_rate = ratio_cell.lock().map(|g| *g).unwrap_or(8000);
                let ratio = if codec_rate > 0 {
                    (device_rate / codec_rate).max(1) as usize
                } else {
                    1
                };

                let mut pos = 0;
                while pos < data.len() {
                    if let Ok(mut buf) = playout_buf_cb.lock() {
                        if buf.is_empty() {
                            match rx_cpal
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
                                    return;
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
        )
        .map_err(|e| e.to_string())?;

    output_stream.play().map_err(|e| e.to_string())?;

    let receiver = MulticastAudioReceiver {
        group: group.to_string(),
        port,
        volume,
        muted,
        cancel_tx,
        waveform: waveform_buf,
        metrics,
        codec_name,
        ssrc,
        source_ip,
        receiver_handle: Some(receiver_handle),
        playout_handle: Some(playout_handle),
        output_stream: Some(SendStream(output_stream)),
    };

    let mut guard = ACTIVE_RECEIVERS.lock().map_err(|e| e.to_string())?;
    guard.insert(key, receiver);

    Ok(())
}

/// Stop the multicast audio receiver for the given group.
pub fn stop(group: &str) -> Result<(), String> {
    let key = {
        let guard = ACTIVE_RECEIVERS.lock().map_err(|e| e.to_string())?;
        match guard
            .keys()
            .find(|k| k.starts_with(&format!("{}:", group)))
            .cloned()
        {
            Some(k) => k,
            None => return Ok(()), // idempotent stop
        }
    };
    stop_by_key(&key)
}

fn stop_by_key(key: &str) -> Result<(), String> {
    let receiver = {
        let mut guard = ACTIVE_RECEIVERS.lock().map_err(|e| e.to_string())?;
        guard.remove(key).ok_or_else(|| format!("No active receiver for key {}", key))?
    };
    let _ = receiver.cancel_tx.send(true);
    Ok(())
}

/// Set volume for the receiver (0.0 ..= 1.0).
pub fn set_volume(group: &str, volume: f32) -> Result<(), String> {
    let guard = ACTIVE_RECEIVERS.lock().map_err(|e| e.to_string())?;
    let key = guard
        .keys()
        .find(|k| k.starts_with(&format!("{}:", group)))
        .cloned()
        .ok_or_else(|| format!("No active receiver for group {}", group))?;
    let r = guard.get(&key).ok_or_else(|| format!("No active receiver for group {}", group))?;
    r.volume.store(volume.to_bits(), Ordering::Relaxed);
    Ok(())
}

/// Set muted state for the receiver.
pub fn set_muted(group: &str, muted: bool) -> Result<(), String> {
    let guard = ACTIVE_RECEIVERS.lock().map_err(|e| e.to_string())?;
    let key = guard
        .keys()
        .find(|k| k.starts_with(&format!("{}:", group)))
        .cloned()
        .ok_or_else(|| format!("No active receiver for group {}", group))?;
    let r = guard.get(&key).ok_or_else(|| format!("No active receiver for group {}", group))?;
    r.muted.store(muted, Ordering::Relaxed);
    Ok(())
}

/// Get waveform snapshot (samples, peak, rms) for the receiver.
pub fn get_waveform(group: &str) -> Result<super::types::AudioWaveform, String> {
    let guard = ACTIVE_RECEIVERS.lock().map_err(|e| e.to_string())?;
    let key = guard
        .keys()
        .find(|k| k.starts_with(&format!("{}:", group)))
        .cloned()
        .ok_or_else(|| format!("No active receiver for group {}", group))?;
    let r = guard.get(&key).ok_or_else(|| format!("No active receiver for group {}", group))?;
    let w = r.waveform.lock().map_err(|e| e.to_string())?;
    let samples = w.get_copy();
    let (peak, rms) = WaveformRing::peak_rms(&samples);
    Ok(AudioWaveform {
        samples,
        peak,
        rms,
    })
}

/// Get metrics for the receiver.
pub fn get_metrics(group: &str) -> Result<super::types::AudioStreamMetrics, String> {
    let guard = ACTIVE_RECEIVERS.lock().map_err(|e| e.to_string())?;
    let key = guard
        .keys()
        .find(|k| k.starts_with(&format!("{}:", group)))
        .cloned()
        .ok_or_else(|| format!("No active receiver for group {}", group))?;
    let r = guard.get(&key).ok_or_else(|| format!("No active receiver for group {}", group))?;
    let m = r.metrics.lock().map_err(|e| e.to_string())?;
    let duration_secs = m.start_time.elapsed().as_secs_f64();
    let loss_percent = if m.packets_received > 0 {
        (m.loss_count as f64 / (m.packets_received + m.loss_count) as f64) * 100.0
    } else {
        0.0
    };
    let bitrate_kbps = if duration_secs > 0.0 {
        (m.bytes_received as f64 * 8.0 / 1000.0) / duration_secs
    } else {
        0.0
    };
    Ok(AudioStreamMetrics {
        group: r.group.clone(),
        jitter_ms: m.jitter_ms,
        loss_percent,
        bitrate_kbps,
        recv_peak: m.peak as f64,
        packets_received: m.packets_received,
        duration_secs,
    })
}
