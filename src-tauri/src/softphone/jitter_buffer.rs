//! Adaptive jitter buffer: dynamically adjusts playout delay based on observed
//! inter-arrival jitter (RFC 3550 §6.4.1). Falls back to min_delay when jitter is low,
//! ramps up toward max_delay under heavy jitter. Supports reorder for late packets.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use super::rtp::RtpPacket;

/// Max packets we'll reorder: late packets within this window are kept.
const REORDER_WINDOW: i16 = 10;
/// Smoothing factor for EWMA jitter estimate (higher = slower adaptation).
const JITTER_ALPHA: f64 = 0.97;
/// Safety margin above estimated jitter for target delay.
const JITTER_MARGIN: f64 = 2.0;
/// Minimum time between target delay adjustments to avoid oscillation.
const ADAPT_INTERVAL_MS: u64 = 1000;

pub struct JitterBuffer {
    min_delay_ms: u32,
    max_delay_ms: u32,
    target_delay_ms: u32,
    buffer: HashMap<u16, (RtpPacket, Instant)>,
    next_sequence: u16,
    last_played_ts: u32,
    started: bool,
    // Adaptive jitter estimation
    ewma_jitter_ms: f64,
    last_arrival: Option<Instant>,
    last_rtp_ts: Option<u32>,
    last_adapt: Instant,
    /// Codec clock rate (e.g. 8000 for G.711, 16000 for G.722). Defaults to 8000.
    clock_rate: u32,
}

impl JitterBuffer {
    pub fn new(min_delay_ms: u32, max_delay_ms: u32) -> Self {
        JitterBuffer {
            min_delay_ms,
            max_delay_ms,
            target_delay_ms: min_delay_ms,
            buffer: HashMap::new(),
            next_sequence: 0,
            last_played_ts: 0,
            started: false,
            ewma_jitter_ms: 0.0,
            last_arrival: None,
            last_rtp_ts: None,
            last_adapt: Instant::now(),
            clock_rate: 8000,
        }
    }

    pub fn set_clock_rate(&mut self, rate: u32) {
        self.clock_rate = rate.max(1);
    }

    /// Current adaptive target delay in ms.
    pub fn target_delay(&self) -> u32 {
        self.target_delay_ms
    }

    /// Current estimated jitter in ms.
    pub fn estimated_jitter_ms(&self) -> f64 {
        self.ewma_jitter_ms
    }

    pub fn push(&mut self, packet: RtpPacket, now: Instant) {
        let seq = packet.sequence;
        let rtp_ts = packet.timestamp;

        // Update jitter estimate (RFC 3550 §A.8 interarrival jitter)
        if let (Some(prev_arrival), Some(prev_ts)) = (self.last_arrival, self.last_rtp_ts) {
            let arrival_diff_ms = now.saturating_duration_since(prev_arrival).as_secs_f64() * 1000.0;
            let ts_diff_ms = (rtp_ts.wrapping_sub(prev_ts) as f64) / (self.clock_rate as f64) * 1000.0;
            let transit_diff = (arrival_diff_ms - ts_diff_ms).abs();
            self.ewma_jitter_ms = JITTER_ALPHA * self.ewma_jitter_ms + (1.0 - JITTER_ALPHA) * transit_diff;
        }
        self.last_arrival = Some(now);
        self.last_rtp_ts = Some(rtp_ts);

        // Periodically adapt target delay
        if now.saturating_duration_since(self.last_adapt) >= Duration::from_millis(ADAPT_INTERVAL_MS) {
            let desired = self.min_delay_ms as f64 + self.ewma_jitter_ms * JITTER_MARGIN;
            let clamped = desired.round().max(self.min_delay_ms as f64).min(self.max_delay_ms as f64) as u32;
            self.target_delay_ms = clamped;
            self.last_adapt = now;
        }

        if !self.started {
            self.next_sequence = seq;
            self.last_played_ts = rtp_ts;
            self.started = true;
            self.buffer.insert(seq, (packet, now));
            return;
        }
        let diff = seq.wrapping_sub(self.next_sequence) as i16;
        if diff < -REORDER_WINDOW {
            return;
        }
        if diff < 0 {
            self.next_sequence = seq;
        }
        self.buffer.insert(seq, (packet, now));
    }

    /// Pop next packet if it's time to play (target_delay elapsed since arrival).
    pub fn pop_ready(&mut self, now: Instant) -> Option<RtpPacket> {
        let target_delay = Duration::from_millis(self.target_delay_ms as u64);
        let max_delay = Duration::from_millis(self.max_delay_ms as u64);

        if let Some((pkt, arrived_at)) = self.buffer.get(&self.next_sequence) {
            if now.saturating_duration_since(*arrived_at) >= target_delay {
                let packet = pkt.clone();
                self.buffer.remove(&self.next_sequence);
                self.next_sequence = self.next_sequence.wrapping_add(1);
                self.last_played_ts = packet.timestamp;
                return Some(packet);
            }
        }

        // Skip overdue packets that exceeded max_delay
        let mut to_skip = Vec::new();
        for (seq, (_, arrived_at)) in &self.buffer {
            if now.saturating_duration_since(*arrived_at) > max_delay && *seq == self.next_sequence {
                to_skip.push(*seq);
            }
        }
        for seq in to_skip {
            self.buffer.remove(&seq);
            self.next_sequence = self.next_sequence.wrapping_add(1);
        }

        None
    }

    /// Flush buffered packets so next push re-syncs (e.g. after resume from hold).
    pub fn flush(&mut self) {
        self.buffer.clear();
        self.started = false;
        self.ewma_jitter_ms = 0.0;
        self.last_arrival = None;
        self.last_rtp_ts = None;
        self.target_delay_ms = self.min_delay_ms;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::rtp::RtpPacket;

    fn make_pkt(seq: u16, ts: u32) -> RtpPacket {
        RtpPacket {
            payload_type: 0,
            sequence: seq,
            timestamp: ts,
            ssrc: 1234,
            marker: false,
            payload: vec![0u8; 160],
        }
    }

    #[test]
    fn adapts_delay_under_jitter() {
        let mut jb = JitterBuffer::new(20, 200);
        let base = Instant::now();
        // Simulate packets with variable inter-arrival (jitter)
        for i in 0..100u16 {
            let jitter_ms = if i % 3 == 0 { 30 } else { 0 };
            let arrival = base + Duration::from_millis(i as u64 * 20 + jitter_ms as u64);
            jb.push(make_pkt(i, i as u32 * 160), arrival);
        }
        // After seeing jitter, target delay should have increased above minimum
        assert!(jb.target_delay_ms > 20, "target_delay should adapt: {}", jb.target_delay_ms);
    }

    #[test]
    fn stays_low_without_jitter() {
        let mut jb = JitterBuffer::new(20, 200);
        let base = Instant::now();
        for i in 0..50u16 {
            let arrival = base + Duration::from_millis(i as u64 * 20);
            jb.push(make_pkt(i, i as u32 * 160), arrival);
        }
        assert_eq!(jb.target_delay_ms, 20);
    }

    #[test]
    fn flush_resets_jitter() {
        let mut jb = JitterBuffer::new(20, 200);
        jb.ewma_jitter_ms = 50.0;
        jb.target_delay_ms = 120;
        jb.flush();
        assert_eq!(jb.target_delay_ms, 20);
        assert_eq!(jb.ewma_jitter_ms, 0.0);
    }
}
