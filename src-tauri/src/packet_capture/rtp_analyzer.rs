use anyhow::Result;
use std::collections::HashMap;
use std::net::IpAddr;

/// RTP clock rate (Hz) per payload type for jitter calculation.
/// Audio types per RFC 3551 Table 4; Video types per RFC 3551 Table 5.
fn get_clock_rate(payload_type: u8) -> u32 {
    match payload_type {
        0 | 8 => 8000,   // PCMU, PCMA
        3 => 8000,       // GSM
        4 => 8000,       // G.723 (RFC 3551 Table 4: 8000 Hz)
        5 => 8000,       // DVI4 8kHz
        6 => 16000,      // DVI4 16kHz
        7 => 8000,       // LPC
        9 => 8000,       // G.722 (RFC 3551: clock rate listed as 8000 despite 16kHz bandwidth)
        10 => 44100,     // L16 stereo
        11 => 44100,     // L16 mono
        12 => 8000,      // QCELP
        13 => 8000,      // CN (comfort noise)
        14 => 90000,     // MPA (RFC 3551 Table 4: 90000 Hz)
        15 => 8000,      // G.728 (RFC 3551 Table 4: 8000 Hz)
        16 => 11025,     // DVI4 11025Hz (RFC 3551 Table 4)
        17 => 22050,     // DVI4 22050Hz (RFC 3551 Table 4)
        18 => 8000,      // G.729
        25 => 90000,     // CelB (video)
        26 => 90000,     // JPEG (video)
        28 => 90000,     // nv (video)
        31 => 90000,     // H.261 (video)
        32 => 90000,     // MPV (video)
        33 => 90000,     // MP2T (video)
        34 => 90000,     // H.263 (video)
        96..=127 => 8000, // dynamic — default to 8000 (VoIP audio more common than video)
        _ => 8000,       // default for audio
    }
}

/// Decoded DTMF telephone-event (RFC 4733).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DtmfEvent {
    pub event: u8,
    pub digit: String,
    pub end_of_event: bool,
    pub volume: u8,
    pub duration: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RtpHeader {
    pub version: u8,
    pub padding: bool,
    pub extension: bool,
    pub csrc_count: u8,
    pub marker: bool,
    pub payload_type: u8,
    pub sequence_number: u16,
    pub timestamp: u32,
    pub ssrc: u32,
    pub csrc: Vec<u32>,
    /// Length of extension data in bytes (when extension is true). Used for payload start offset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension_length: Option<u16>,
    /// Decoded DTMF telephone-event payload, if applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dtmf_event: Option<DtmfEvent>,
    /// True when the stream is known to be encrypted (SRTP).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub encrypted: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RtpStream {
    pub ssrc: u32,
    pub src_ip: IpAddr,
    pub src_port: u16,
    pub dst_ip: IpAddr,
    pub dst_port: u16,
    pub payload_type: u8,
    pub first_packet_time: chrono::DateTime<chrono::Utc>,
    pub last_packet_time: chrono::DateTime<chrono::Utc>,
    pub packet_count: u64,
    pub bytes: u64,
    pub expected_sequence: u16,
    pub lost_packets: u32,
    pub out_of_order: u32,
    pub jitter: f64,
    pub last_timestamp: u32,
    pub last_arrival_time: Option<chrono::DateTime<chrono::Utc>>,
    /// Stream is validated once we see enough packets with incrementing sequence numbers,
    /// confirming this is real RTP and not random UDP that matched the header pattern.
    #[serde(default)]
    pub validated: bool,
    /// Count of consecutive packets with proper sequence progression (seq_diff 1-4).
    #[serde(default)]
    pub sequential_count: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RtpStatistics {
    pub ssrc: u32,
    pub packet_count: u64,
    pub lost_packets: u32,
    pub loss_percentage: f64,
    pub jitter: f64,
    pub mos_score: f64,
    pub payload_type: u8,
    pub codec_name: String,
}

/// Per-second snapshot of RTP stream quality metrics for time-series graphs.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RtpHistoryBucket {
    /// ISO 8601 timestamp for this bucket (start of second)
    pub timestamp: String,
    /// Packets received in this second
    pub packets: u32,
    /// Packets lost in this second
    pub lost: u32,
    /// Loss percentage for this second
    pub loss_percent: f64,
    /// Jitter (ms) at end of this second
    pub jitter: f64,
    /// MOS score at end of this second
    pub mos: f64,
}

/// Time-series history for an RTP stream (used for quality graphs).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RtpStreamHistory {
    pub ssrc: u32,
    pub codec_name: String,
    pub src_ip: String,
    pub src_port: u16,
    pub dst_ip: String,
    pub dst_port: u16,
    /// Per-second quality buckets (max 300 = 5 minutes)
    pub buckets: Vec<RtpHistoryBucket>,
}

/// Internal state for tracking per-second metrics during capture.
#[derive(Debug, Clone)]
struct HistoryAccumulator {
    /// Current bucket start time (truncated to second)
    current_second: i64,
    /// Packets in current second
    packets_this_second: u32,
    /// Lost packets in current second
    lost_this_second: u32,
    /// Completed buckets
    buckets: Vec<RtpHistoryBucket>,
}

impl HistoryAccumulator {
    fn new() -> Self {
        Self {
            current_second: 0,
            packets_this_second: 0,
            lost_this_second: 0,
            buckets: Vec::new(),
        }
    }

    /// Flush current bucket and start a new one for the given timestamp.
    fn flush_and_advance(&mut self, new_second: i64, jitter: f64, loss_percent: f64) {
        if self.current_second > 0 && (self.packets_this_second > 0 || self.lost_this_second > 0) {
            let bucket_loss = if self.packets_this_second + self.lost_this_second > 0 {
                (self.lost_this_second as f64) / ((self.packets_this_second + self.lost_this_second) as f64) * 100.0
            } else {
                loss_percent
            };
            let mos = calculate_mos(jitter, bucket_loss);
            let ts = chrono::DateTime::from_timestamp(self.current_second, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();
            self.buckets.push(RtpHistoryBucket {
                timestamp: ts,
                packets: self.packets_this_second,
                lost: self.lost_this_second,
                loss_percent: bucket_loss,
                jitter,
                mos,
            });
            // Keep max 300 buckets (5 minutes)
            if self.buckets.len() > 300 {
                self.buckets.remove(0);
            }
        }
        self.current_second = new_second;
        self.packets_this_second = 0;
        self.lost_this_second = 0;
    }
}

/// Parse an RTP header per RFC 3550 §5.1.
///
/// Layout (big-endian):
///   0                   1                   2                   3
///   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
///  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
///  |V=2|P|X|  CC   |M|     PT      |       sequence number         |
///  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
///  |                           timestamp                           |
///  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
///  |           synchronization source (SSRC) identifier            |
///  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
///  |            contributing source (CSRC) identifiers  (CC × 4B)  |
///  |                             ....                              |
///  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
pub fn parse_rtp_header(data: &[u8]) -> Result<RtpHeader> {
    if data.len() < 12 {
        return Err(anyhow::anyhow!("RTP header too short: {} bytes", data.len()));
    }

    let version = (data[0] >> 6) & 0x03;
    let padding = (data[0] & 0x20) != 0;
    let extension = (data[0] & 0x10) != 0;
    let csrc_count = data[0] & 0x0F;
    let marker = (data[1] & 0x80) != 0;
    let payload_type = data[1] & 0x7F;
    let sequence_number = u16::from_be_bytes([data[2], data[3]]);
    let timestamp = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
    let ssrc = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);

    // RFC 3550 §5.1: CSRC list follows the fixed header; packet MUST be large enough.
    let csrc_len = csrc_count as usize * 4;
    let min_header_len = 12 + csrc_len;
    if data.len() < min_header_len {
        return Err(anyhow::anyhow!(
            "RTP packet too short for CC={}: need {} bytes, have {}",
            csrc_count, min_header_len, data.len()
        ));
    }

    let mut csrc = Vec::with_capacity(csrc_count as usize);
    let mut offset = 12;
    for i in 0..csrc_count as usize {
        let o = offset + i * 4;
        csrc.push(u32::from_be_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]));
    }
    offset += csrc_len;

    // RFC 3550 §5.3.1: Extension header (if X=1) sits after CSRC list.
    // Format: 16-bit defined-by-profile, 16-bit length (count of 32-bit words following).
    let mut extension_length: Option<u16> = None;
    if extension {
        if data.len() < offset + 4 {
            return Err(anyhow::anyhow!(
                "RTP extension header indicated (X=1) but packet too short: need {} bytes, have {}",
                offset + 4, data.len()
            ));
        }
        let ext_len_words = u16::from_be_bytes([data[offset + 2], data[offset + 3]]);
        let ext_total_bytes = 4u32 + (ext_len_words as u32) * 4; // profile(2) + length(2) + payload
        // Validate that the extension fits within the packet
        let ext_end = offset as u32 + ext_total_bytes;
        if ext_end > data.len() as u32 {
            return Err(anyhow::anyhow!(
                "RTP extension header length ({} words = {} bytes) exceeds packet size ({})",
                ext_len_words, ext_total_bytes, data.len() - offset
            ));
        }
        extension_length = Some((ext_total_bytes.min(u16::MAX as u32)) as u16);
    }

    Ok(RtpHeader {
        version,
        padding,
        extension,
        csrc_count,
        marker,
        payload_type,
        sequence_number,
        timestamp,
        ssrc,
        csrc,
        extension_length,
        dtmf_event: None,
        encrypted: false,
    })
}

/// Parse DTMF telephone-event payload (RFC 4733 §3.2).
pub fn parse_dtmf_event(rtp_payload: &[u8]) -> Option<DtmfEvent> {
    if rtp_payload.len() < 4 {
        return None;
    }
    let event = rtp_payload[0];
    let end_of_event = (rtp_payload[1] & 0x80) != 0;
    let volume = rtp_payload[1] & 0x3F;
    let duration = u16::from_be_bytes([rtp_payload[2], rtp_payload[3]]);
    let digit = match event {
        0..=9 => format!("{}", event),
        10 => "*".to_string(),
        11 => "#".to_string(),
        12 => "A".to_string(),
        13 => "B".to_string(),
        14 => "C".to_string(),
        15 => "D".to_string(),
        16 => "Flash".to_string(),
        _ => format!("Event{}", event),
    };
    Some(DtmfEvent { event, digit, end_of_event, volume, duration })
}

pub struct RtpStreamTracker {
    streams: HashMap<u32, RtpStream>,
    /// Per-stream history accumulators for time-series graphs
    history: HashMap<u32, HistoryAccumulator>,
}

impl RtpStreamTracker {
    pub fn new() -> Self {
        Self {
            streams: HashMap::new(),
            history: HashMap::new(),
        }
    }

    pub fn process_packet(
        &mut self,
        src_ip: IpAddr,
        src_port: u16,
        dst_ip: IpAddr,
        dst_port: u16,
        timestamp: chrono::DateTime<chrono::Utc>,
        data: &[u8],
    ) -> Result<Option<RtpStatistics>> {
        let header = parse_rtp_header(data)?;

        // Get or create stream
        let stream = self.streams.entry(header.ssrc).or_insert_with(|| {
            RtpStream {
                ssrc: header.ssrc,
                src_ip,
                src_port,
                dst_ip,
                dst_port,
                payload_type: header.payload_type,
                first_packet_time: timestamp,
                last_packet_time: timestamp,
                packet_count: 0,
                bytes: 0,
                expected_sequence: header.sequence_number,
                lost_packets: 0,
                out_of_order: 0,
                jitter: 0.0,
                last_timestamp: header.timestamp,
                last_arrival_time: Some(timestamp),
                validated: false,
                sequential_count: 0,
            }
        });

        // Update stream statistics
        stream.packet_count += 1;
        stream.bytes += data.len() as u64;
        stream.last_packet_time = timestamp;

        // Check for lost packets and validate sequence progression
        let seq_diff = header.sequence_number.wrapping_sub(stream.expected_sequence);
        if seq_diff > 0 && seq_diff < 32768 {
            // Normal progression (possibly with small gap)
            if seq_diff > 1 {
                stream.lost_packets += (seq_diff - 1) as u32;
            }
            stream.expected_sequence = header.sequence_number.wrapping_add(1);

            // Track consecutive sequential packets for validation.
            // seq_diff 1 = perfect, 2-4 = small gap (still plausible real RTP).
            if seq_diff <= 4 {
                stream.sequential_count += 1;
                if stream.sequential_count >= 5 {
                    stream.validated = true;
                }
            } else {
                stream.sequential_count = 0;
            }
        } else if seq_diff != 0 {
            // Out of order or wrap-around
            stream.out_of_order += 1;
            stream.sequential_count = 0;
        }

        // Calculate jitter (RFC 3550): same units for arrival and timestamp
        if let Some(last_arrival) = stream.last_arrival_time {
            let d = (timestamp - last_arrival).num_milliseconds() as f64; // arrival delta in ms
            let clock = get_clock_rate(header.payload_type) as f64;
            let s_ms = (header.timestamp as i64 - stream.last_timestamp as i64) as f64 / clock * 1000.0; // RTP timestamp delta in ms
            let d_s = d - s_ms;
            stream.jitter += (d_s.abs() - stream.jitter) / 16.0;
        }

        stream.last_timestamp = header.timestamp;
        stream.last_arrival_time = Some(timestamp);

        // --- History accumulation ---
        let pkt_second = timestamp.timestamp(); // Unix seconds
        let hist = self.history.entry(header.ssrc).or_insert_with(HistoryAccumulator::new);
        if hist.current_second == 0 {
            // First packet for this stream
            hist.current_second = pkt_second;
        }
        if pkt_second > hist.current_second {
            // Crossed into a new second: flush the old bucket
            let loss_pct = if stream.packet_count > 0 {
                (stream.lost_packets as f64 / stream.packet_count as f64) * 100.0
            } else {
                0.0
            };
            hist.flush_and_advance(pkt_second, stream.jitter, loss_pct);
        }
        hist.packets_this_second += 1;
        // If packets were lost this packet, credit them to current second
        if seq_diff > 1 && seq_diff < 32768 {
            hist.lost_this_second += (seq_diff - 1) as u32;
        }

        // Calculate statistics if we have enough packets
        if stream.packet_count >= 10 {
            let loss_percentage = if stream.packet_count > 0 {
                (stream.lost_packets as f64 / stream.packet_count as f64) * 100.0
            } else {
                0.0
            };

            // Calculate MOS score (simplified)
            let mos = calculate_mos(stream.jitter, loss_percentage);

            Ok(Some(RtpStatistics {
                ssrc: stream.ssrc,
                packet_count: stream.packet_count,
                lost_packets: stream.lost_packets,
                loss_percentage,
                jitter: stream.jitter,
                mos_score: mos,
                payload_type: stream.payload_type,
                codec_name: get_codec_name(stream.payload_type),
            }))
        } else {
            Ok(None)
        }
    }

    #[allow(dead_code)]
    pub fn get_stream(&self, ssrc: u32) -> Option<&RtpStream> {
        self.streams.get(&ssrc)
    }

    pub fn get_all_streams(&self) -> Vec<&RtpStream> {
        self.streams.values().filter(|s| s.validated).collect()
    }

    /// Get time-series history for a specific stream by SSRC.
    /// Optionally pass an SDP codec map to resolve dynamic payload types.
    pub fn get_stream_history(&self, ssrc: u32, sdp_map: Option<&HashMap<u8, String>>) -> Option<RtpStreamHistory> {
        let stream = self.streams.get(&ssrc)?;
        let hist = self.history.get(&ssrc)?;
        let codec_name = match sdp_map {
            Some(m) => resolve_codec_name(stream.payload_type, m),
            None => get_codec_name(stream.payload_type),
        };
        Some(RtpStreamHistory {
            ssrc,
            codec_name,
            src_ip: stream.src_ip.to_string(),
            src_port: stream.src_port,
            dst_ip: stream.dst_ip.to_string(),
            dst_port: stream.dst_port,
            buckets: hist.buckets.clone(),
        })
    }

    /// Get time-series history for all streams.
    /// Optionally pass an SDP codec map to resolve dynamic payload types.
    pub fn get_all_stream_histories(&self, sdp_map: Option<&HashMap<u8, String>>) -> Vec<RtpStreamHistory> {
        self.streams
            .keys()
            .filter_map(|ssrc| self.get_stream_history(*ssrc, sdp_map))
            .collect()
    }
}

pub fn calculate_mos(jitter: f64, loss_percentage: f64) -> f64 {
    // Simplified MOS calculation
    // Real MOS calculation is more complex and requires R-factor
    let mut mos: f64 = 4.5;

    // Penalize jitter (milliseconds)
    if jitter > 50.0 {
        mos -= 0.5;
    } else if jitter > 30.0 {
        mos -= 0.3;
    } else if jitter > 20.0 {
        mos -= 0.1;
    }

    // Penalize packet loss
    if loss_percentage > 5.0 {
        mos -= 1.0;
    } else if loss_percentage > 2.0 {
        mos -= 0.5;
    } else if loss_percentage > 1.0 {
        mos -= 0.2;
    }

    // MOS scale is 1.0–4.5; 5.0 is not achievable in practice (E-Model / VoIP ceiling).
    mos.max(1.0).min(4.5)
}

/// Static RTP payload-type → codec name (RFC 3551 Table 4/5 + common extras).
/// For dynamic types (96-127) callers should prefer SDP rtpmap resolution via
/// `resolve_codec_name` and only fall back here.
pub fn get_codec_name(payload_type: u8) -> String {
    match payload_type {
        0 => "PCMU".into(),
        1 => "1016".into(),       // reserved / FS-1016
        2 => "G.721".into(),
        3 => "GSM".into(),
        4 => "G.723".into(),
        5 => "DVI4/8K".into(),
        6 => "DVI4/16K".into(),
        7 => "LPC".into(),
        8 => "PCMA".into(),
        9 => "G.722".into(),
        10 => "L16/S".into(),     // L16 stereo
        11 => "L16/M".into(),     // L16 mono
        12 => "QCELP".into(),
        13 => "CN".into(),        // comfort noise
        14 => "MPA".into(),       // MPEG audio
        15 => "G.728".into(),
        16 => "DVI4/11K".into(),
        17 => "DVI4/22K".into(),
        18 => "G.729".into(),
        25 => "CelB".into(),
        26 => "JPEG".into(),
        28 => "nv".into(),
        31 => "H.261".into(),
        32 => "MPV".into(),
        33 => "MP2T".into(),
        34 => "H.263".into(),
        101 => "telephone-event".into(),
        96..=127 => format!("PT{}", payload_type), // dynamic — needs SDP resolution
        _ => format!("PT{}", payload_type),
    }
}

/// Extract a payload-type → codec-name map from SDP `a=rtpmap:` attributes.
///
/// Strategy (layered, most-specific first):
/// 1. Parsed SDP structures in decoded SIP/SIP-over-WS packets
/// 2. Raw SIP message text (`raw_message` field)
/// 3. Raw packet payload bytes (catches un-decoded SIP or SDP-in-other-protocols)
pub fn extract_sdp_codec_map(
    packets: &[crate::packet_capture::protocols::PacketInfo],
) -> HashMap<u8, String> {
    use crate::packet_capture::protocol_decoder::ApplicationLayer;
    let mut map = HashMap::new();

    for p in packets {
        let sip_msg = match p.decoded.as_ref().map(|d| &d.application) {
            Some(ApplicationLayer::Sip(sip)) => Some(sip),
            Some(ApplicationLayer::SipOverWs { sip, .. }) => Some(sip),
            _ => None,
        };

        let mut found_via_parsed = false;

        if let Some(sip) = sip_msg {
            // Layer 1: parsed SDP structure
            if let Some(ref body) = sip.body {
                if let Some(ref sdp) = body.sdp {
                    parse_rtpmap_attrs(&sdp.attributes, &mut map);
                    for media in &sdp.media {
                        parse_rtpmap_attrs(&media.attributes, &mut map);
                    }
                    found_via_parsed = true;
                }
            }

            // Layer 2: raw SIP message text (in case SDP wasn't parsed into struct)
            if !found_via_parsed {
                parse_rtpmap_from_text(&sip.raw_message, &mut map);
            }
        }

        // Layer 3: raw packet data — scan any SIP-ish packet for rtpmap lines
        if !found_via_parsed && p.data.len() > 20 {
            if let Ok(text) = std::str::from_utf8(&p.data) {
                if text.contains("a=rtpmap:") {
                    parse_rtpmap_from_text(text, &mut map);
                }
            }
        }
    }
    map
}

/// Parse `rtpmap:<pt> <name>/<clock>[/<channels>]` from a list of SDP attribute strings.
/// These are already stripped of the `a=` prefix.
fn parse_rtpmap_attrs(attrs: &[String], map: &mut HashMap<u8, String>) {
    for attr in attrs {
        // attr is the value after "a=", e.g. "rtpmap:111 opus/48000/2"
        let s = attr.trim();
        if let Some(rest) = s.strip_prefix("rtpmap:") {
            parse_single_rtpmap(rest, map);
        }
    }
}

/// Scan raw text (SIP message or packet payload) for lines matching `a=rtpmap:...`.
fn parse_rtpmap_from_text(text: &str, map: &mut HashMap<u8, String>) {
    for line in text.lines() {
        let trimmed = line.trim();
        // Match "a=rtpmap:111 opus/48000/2"
        if let Some(rest) = trimmed.strip_prefix("a=rtpmap:") {
            parse_single_rtpmap(rest, map);
        }
    }
}

/// Parse a single rtpmap value: "<pt> <name>/<clock>[/<channels>]".
fn parse_single_rtpmap(value: &str, map: &mut HashMap<u8, String>) {
    let parts: Vec<&str> = value.trim().splitn(2, ' ').collect();
    if parts.len() == 2 {
        if let Ok(pt) = parts[0].parse::<u8>() {
            let codec = parts[1].split('/').next().unwrap_or(parts[1]);
            map.insert(pt, codec.to_string());
        }
    }
}

/// Resolve a payload type to a human-readable codec name.
/// Prefers the SDP-derived map (from rtpmap) for dynamic types, falling back
/// to the static RFC 3551 table.
pub fn resolve_codec_name(payload_type: u8, sdp_map: &HashMap<u8, String>) -> String {
    if let Some(name) = sdp_map.get(&payload_type) {
        return name.clone();
    }
    get_codec_name(payload_type)
}
