//! Per-call metrics: RFC 3550 jitter and simple MOS estimate.

use std::collections::VecDeque;
use std::time::Instant;

const JITTER_HISTORY_LEN: usize = 60; // ~1 sample/sec for 60 sec
const RTP_CLOCK: u32 = 8000; // 8 kHz clock, 1 tick = 125 µs

/// Per-call metrics (updated by receiver and sender/capture).
pub struct CallMetrics {
    pub last_rtp_ts: u32,
    pub last_arrival: Instant,
    pub first_arrival: Option<Instant>,
    pub jitter_rfc_ms: f64,
    pub jitter_history: VecDeque<(f64, f64)>, // (elapsed_sec, jitter_ms)
    pub last_seq: Option<u16>,
    pub received_packets: u64,
    pub lost_packets: u64,
    /// Last send peak (0.0–1.0) from capture.
    pub send_peak: f32,
    /// Last recv peak (0.0–1.0) from playout.
    pub recv_peak: f32,
}

impl CallMetrics {
    pub fn new() -> Self {
        CallMetrics {
            last_rtp_ts: 0,
            last_arrival: Instant::now(),
            first_arrival: None,
            jitter_rfc_ms: 0.0,
            jitter_history: VecDeque::with_capacity(JITTER_HISTORY_LEN),
            last_seq: None,
            received_packets: 0,
            lost_packets: 0,
            send_peak: 0.0,
            recv_peak: 0.0,
        }
    }

    pub fn set_send_peak(&mut self, peak: f32) {
        self.send_peak = peak;
    }

    pub fn set_recv_peak(&mut self, peak: f32) {
        self.recv_peak = peak;
    }

    /// Update with received RTP packet (RFC 3550 inter-arrival jitter + loss).
    pub fn push_rtp(&mut self, seq: u16, rtp_ts: u32, arrival: Instant) {
        if self.first_arrival.is_none() {
            self.first_arrival = Some(arrival);
        }
        let mut in_order = true;
        if let Some(last) = self.last_seq {
            let diff = seq.wrapping_sub(last);
            if diff == 0 {
                in_order = false; // duplicate
            } else if diff < 0x8000 {
                if diff > 1 {
                    self.lost_packets += (diff - 1) as u64;
                }
                self.last_seq = Some(seq);
            } else {
                in_order = false; // out-of-order
            }
        } else {
            self.last_seq = Some(seq);
        }
        self.received_packets += 1;
        let elapsed_sec = self.first_arrival.map(|t| arrival.saturating_duration_since(t).as_secs_f64()).unwrap_or(0.0);
        if in_order && self.last_rtp_ts != 0 {
            let d_sec = arrival.saturating_duration_since(self.last_arrival).as_secs_f64();
            let d_rtp = (rtp_ts.wrapping_sub(self.last_rtp_ts) as f64) / (RTP_CLOCK as f64);
            let d = (d_sec - d_rtp).abs() * 1000.0; // ms
            self.jitter_rfc_ms += (d - self.jitter_rfc_ms) / 16.0;
            self.jitter_history.push_back((elapsed_sec, self.jitter_rfc_ms));
            if self.jitter_history.len() > JITTER_HISTORY_LEN {
                self.jitter_history.pop_front();
            }
        }
        if in_order {
            self.last_rtp_ts = rtp_ts;
            self.last_arrival = arrival;
        }
    }

    /// Simple MOS from jitter (rough: 4.5 - jitter/25, clamped). MOS scale is 1.0–4.5; 5.0 is not achievable.
    pub fn mos(&self) -> f64 {
        (4.5 - self.jitter_rfc_ms / 25.0).clamp(1.0, 4.5)
    }

    pub fn loss_percent(&self) -> f64 {
        let expected = self.received_packets + self.lost_packets;
        if expected == 0 {
            0.0
        } else {
            (self.lost_packets as f64) * 100.0 / (expected as f64)
        }
    }

    /// Reset receiver state so post-resume metrics are fresh (no hold gap counted as loss).
    pub fn reset_for_resume(&mut self) {
        self.last_rtp_ts = 0;
        self.last_arrival = Instant::now();
        self.first_arrival = None;
        self.last_seq = None;
        self.jitter_history.clear();
        // Keep cumulative counts optional: we could zero them for a clean slate.
        self.received_packets = 0;
        self.lost_packets = 0;
        self.jitter_rfc_ms = 0.0;
    }
}
