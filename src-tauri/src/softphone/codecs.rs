//! Audio codec abstractions: PCMU (μ-law), PCMA (A-law) at 8 kHz, G.722 at 16 kHz.
//! All codecs operate on 20 ms frames.

use ezk_g711::{alaw, mulaw};

pub const SAMPLE_RATE_8K: u32 = 8000;
pub const SAMPLE_RATE_16K: u32 = 16000;
pub const FRAME_MS: u32 = 20;
pub const SAMPLES_PER_FRAME: usize = (SAMPLE_RATE_8K as usize * FRAME_MS as usize) / 1000; // 160
pub const SAMPLES_PER_FRAME_16K: usize = (SAMPLE_RATE_16K as usize * FRAME_MS as usize) / 1000; // 320
/// Backwards-compatible alias used widely throughout the media engine.
pub const SAMPLE_RATE: u32 = SAMPLE_RATE_8K;
#[allow(dead_code)]
pub const BYTES_PER_FRAME: usize = SAMPLES_PER_FRAME; // 1 byte per sample G.711

/// Trait for audio codecs that can encode and decode PCM frames.
pub trait AudioCodec: Send + Sync {
    /// Encode a PCM frame (i16 samples) into encoded bytes.
    fn encode_frame(&self, pcm: &[i16]) -> Vec<u8>;
    /// Decode encoded bytes into a PCM frame (i16 samples).
    fn decode_frame(&self, encoded: &[u8]) -> Vec<i16>;
    /// Native sample rate of this codec.
    fn sample_rate(&self) -> u32;
    /// Number of PCM samples per 20ms frame at the codec's native rate.
    fn frame_samples(&self) -> usize;
    /// RTP payload type.
    fn pt(&self) -> u8;
    /// Human-readable codec name.
    fn name(&self) -> &'static str;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum G711Codec {
    PCMU, // μ-law, payload type 0
    PCMA, // A-law, payload type 8
}

impl G711Codec {
    pub fn from_pt(pt: u8) -> Option<Self> {
        match pt {
            0 => Some(G711Codec::PCMU),
            8 => Some(G711Codec::PCMA),
            _ => None,
        }
    }

    pub fn pt(&self) -> u8 {
        match self {
            G711Codec::PCMU => 0,
            G711Codec::PCMA => 8,
        }
    }

    pub fn encode_frame(&self, pcm: &[i16]) -> Vec<u8> {
        let mut out = Vec::with_capacity(pcm.len());
        for &s in pcm {
            let b = match self {
                G711Codec::PCMU => mulaw::encode(s),
                G711Codec::PCMA => alaw::encode(s),
            };
            out.push(b);
        }
        out
    }

    pub fn decode_frame(&self, encoded: &[u8]) -> Vec<i16> {
        encoded
            .iter()
            .map(|&b| match self {
                G711Codec::PCMU => mulaw::decode(b),
                G711Codec::PCMA => alaw::decode(b),
            })
            .collect()
    }
}

impl AudioCodec for G711Codec {
    fn encode_frame(&self, pcm: &[i16]) -> Vec<u8> {
        G711Codec::encode_frame(self, pcm)
    }
    fn decode_frame(&self, encoded: &[u8]) -> Vec<i16> {
        G711Codec::decode_frame(self, encoded)
    }
    fn sample_rate(&self) -> u32 { SAMPLE_RATE_8K }
    fn frame_samples(&self) -> usize { SAMPLES_PER_FRAME }
    fn pt(&self) -> u8 { G711Codec::pt(self) }
    fn name(&self) -> &'static str {
        match self {
            G711Codec::PCMU => "PCMU",
            G711Codec::PCMA => "PCMA",
        }
    }
}

/// G.722 wideband codec: 16 kHz PCM input, 80 bytes per 20ms frame.
/// Uses the ezk-g722 crate (libg722 module). G.722 has an RTP anomaly: the RTP clock rate
/// is 8000 (per RFC 3551 §4.5.2) but the actual audio is 16 kHz. Timestamp increment per
/// 20ms frame is 160 (as if 8kHz), NOT 320.
pub struct G722Codec {
    encoder: std::sync::Mutex<ezk_g722::libg722::encoder::Encoder>,
    decoder: std::sync::Mutex<ezk_g722::libg722::decoder::Decoder>,
}

impl G722Codec {
    pub fn new() -> Self {
        use ezk_g722::libg722::Bitrate;
        Self {
            encoder: std::sync::Mutex::new(
                ezk_g722::libg722::encoder::Encoder::new(Bitrate::Mode1_64000, false, false)
            ),
            decoder: std::sync::Mutex::new(
                ezk_g722::libg722::decoder::Decoder::new(Bitrate::Mode1_64000, false, false)
            ),
        }
    }
}

impl AudioCodec for G722Codec {
    fn encode_frame(&self, pcm: &[i16]) -> Vec<u8> {
        let mut encoder = self.encoder.lock().unwrap();
        encoder.encode(pcm)
    }

    fn decode_frame(&self, encoded: &[u8]) -> Vec<i16> {
        let mut decoder = self.decoder.lock().unwrap();
        decoder.decode(encoded)
    }

    fn sample_rate(&self) -> u32 { SAMPLE_RATE_16K }
    fn frame_samples(&self) -> usize { SAMPLES_PER_FRAME_16K }
    fn pt(&self) -> u8 { 9 }
    fn name(&self) -> &'static str { "G722" }
}

/// Create a codec from an RTP payload type. Returns a boxed AudioCodec.
pub fn codec_from_pt(pt: u8) -> Option<Box<dyn AudioCodec>> {
    match pt {
        0 => Some(Box::new(G711Codec::PCMU)),
        8 => Some(Box::new(G711Codec::PCMA)),
        9 => Some(Box::new(G722Codec::new())),
        _ => None,
    }
}
