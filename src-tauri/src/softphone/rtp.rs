//! RTP packet format per RFC 3550.
//! - Fixed header: V(2) P X CC M PT sequence timestamp SSRC; all integers network byte order.
//! - No CSRC list or extension; marker bit M=0 (can set for first packet after silence per profile).

use std::io::{Cursor, Write};

const RTP_VERSION: u8 = 2;
const RTP_HEADER_LEN: usize = 12;

#[derive(Debug, Clone)]
pub struct RtpPacket {
    pub payload_type: u8,
    pub sequence: u16,
    pub timestamp: u32,
    pub ssrc: u32,
    pub marker: bool,
    pub payload: Vec<u8>,
}

impl RtpPacket {
    /// Serialize to wire format (RFC 3550 §5.1): big-endian, V=2, P=0, X=0, CC=0, M, PT, seq, timestamp, SSRC.
    pub fn serialize(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(RTP_HEADER_LEN + self.payload.len());
        let mut c = Cursor::new(&mut buf);
        let b0 = RTP_VERSION << 6;
        c.write_all(&[b0]).unwrap();
        let b1 = (self.payload_type & 0x7F) | if self.marker { 0x80 } else { 0 };
        c.write_all(&[b1]).unwrap();
        c.write_all(&self.sequence.to_be_bytes()).unwrap();
        c.write_all(&self.timestamp.to_be_bytes()).unwrap();
        c.write_all(&self.ssrc.to_be_bytes()).unwrap();
        c.write_all(&self.payload).unwrap();
        buf
    }

    /// Deserialize; returns None if header too short or version != 2.
    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < RTP_HEADER_LEN {
            return None;
        }
        let version = (data[0] >> 6) & 0x3;
        if version != RTP_VERSION {
            return None;
        }
        let marker = (data[1] & 0x80) != 0;
        let payload_type = data[1] & 0x7F;
        let sequence = u16::from_be_bytes([data[2], data[3]]);
        let timestamp = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
        let ssrc = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
        let payload = data[RTP_HEADER_LEN..].to_vec();
        Some(RtpPacket {
            payload_type,
            sequence,
            timestamp,
            ssrc,
            marker,
            payload,
        })
    }
}
