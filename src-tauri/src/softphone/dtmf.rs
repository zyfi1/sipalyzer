//! RFC 2833 DTMF telephone-event RTP payload generation.
//!
//! Each DTMF digit press is encoded as a sequence of RTP packets with payload type 101
//! (telephone-event/8000). The first packet has the marker bit set. Continuation packets
//! carry incrementing duration. The final 3 packets have the End (E) bit set.
//!
//! Payload format (4 bytes):
//!   byte 0: event (0=0, 1=1, ..., 9=9, 10=*, 11=#, 12=A, 13=B, 14=C, 15=D)
//!   byte 1: E(1) R(1) volume(6) — E=end bit, R=reserved=0, volume=10
//!   byte 2-3: duration (in timestamp units, network byte order)

use crate::softphone::rtp::RtpPacket;

/// Default DTMF event volume (RFC 2833 §3.5): 0 = loudest, 63 = softest. 10 ≈ -10 dBm0.
const DTMF_VOLUME: u8 = 10;

/// Timestamp increment per 20ms frame at 8kHz.
const TIMESTAMP_INCREMENT: u32 = 160;

/// Total event duration in timestamp units (160ms = 8 frames).
pub const EVENT_DURATION_FRAMES: u32 = 8;

/// A DTMF event to be sent by the RTP sender.
#[derive(Debug, Clone)]
pub struct DtmfEvent {
    /// RFC 2833 event code (0-15).
    pub event: u8,
    /// RTP payload type for telephone-event (typically 101).
    pub payload_type: u8,
}

/// Convert a dial character to RFC 2833 event code.
pub fn digit_to_event(ch: char) -> Option<u8> {
    match ch {
        '0' => Some(0),
        '1' => Some(1),
        '2' => Some(2),
        '3' => Some(3),
        '4' => Some(4),
        '5' => Some(5),
        '6' => Some(6),
        '7' => Some(7),
        '8' => Some(8),
        '9' => Some(9),
        '*' => Some(10),
        '#' => Some(11),
        'A' | 'a' => Some(12),
        'B' | 'b' => Some(13),
        'C' | 'c' => Some(14),
        'D' | 'd' => Some(15),
        _ => None,
    }
}

/// Convert an RFC 2833 event code back to a dial character.
pub fn event_to_digit(event: u8) -> char {
    match event {
        0 => '0',
        1 => '1',
        2 => '2',
        3 => '3',
        4 => '4',
        5 => '5',
        6 => '6',
        7 => '7',
        8 => '8',
        9 => '9',
        10 => '*',
        11 => '#',
        12 => 'A',
        13 => 'B',
        14 => 'C',
        15 => 'D',
        _ => '?',
    }
}

/// Build a 4-byte RFC 2833 telephone-event payload.
fn build_event_payload(event: u8, end: bool, duration: u16) -> Vec<u8> {
    let mut buf = vec![0u8; 4];
    buf[0] = event;
    buf[1] = if end { 0x80 } else { 0x00 } | (DTMF_VOLUME & 0x3F);
    buf[2] = (duration >> 8) as u8;
    buf[3] = (duration & 0xFF) as u8;
    buf
}

/// Generate the full sequence of RTP packets for one DTMF digit press.
///
/// Returns a Vec of `(RtpPacket, delay_ms)` pairs. The caller should send each packet,
/// then sleep for `delay_ms` before sending the next. Sequence numbers and timestamps
/// are relative — the caller must add the current running sequence/timestamp.
///
/// Per RFC 2833:
/// - First packet: marker=true, duration=0
/// - Continuation packets: marker=false, duration increments by 160 each frame
/// - Last 3 packets: E=1, same timestamp and duration (retransmissions for reliability)
pub fn generate_dtmf_packets(
    event: u8,
    payload_type: u8,
    ssrc: u32,
    start_sequence: u16,
    start_timestamp: u32,
) -> Vec<(RtpPacket, u64)> {
    let mut packets = Vec::new();
    let mut seq = start_sequence;

    // Start packet (marker=1)
    packets.push((
        RtpPacket {
            payload_type,
            sequence: seq,
            timestamp: start_timestamp,
            ssrc,
            marker: true,
            payload: build_event_payload(event, false, 0),
        },
        20u64, // wait 20ms
    ));
    seq = seq.wrapping_add(1);

    // Continuation packets (marker=0, increasing duration)
    for frame in 1..EVENT_DURATION_FRAMES {
        let duration = frame * TIMESTAMP_INCREMENT;
        packets.push((
            RtpPacket {
                payload_type,
                sequence: seq,
                timestamp: start_timestamp,
                ssrc,
                marker: false,
                payload: build_event_payload(event, false, duration as u16),
            },
            20u64,
        ));
        seq = seq.wrapping_add(1);
    }

    // End packets (3 retransmissions with E=1, same final duration)
    let final_duration = EVENT_DURATION_FRAMES * TIMESTAMP_INCREMENT;
    for i in 0..3u8 {
        packets.push((
            RtpPacket {
                payload_type,
                sequence: seq,
                timestamp: start_timestamp,
                ssrc,
                marker: false,
                payload: build_event_payload(event, true, final_duration as u16),
            },
            if i < 2 { 20u64 } else { 0u64 }, // no delay after last
        ));
        seq = seq.wrapping_add(1);
    }

    packets
}
