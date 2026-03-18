//! T.38 / UDPTL parser for packet capture (RFC 3362, ITU T.38 Annex B).
//! Parses UDPTL type 0 (primary only) and optionally IFP type from primary payload.

use serde::{Deserialize, Serialize};

/// Parsed T.38 UDPTL packet for display in packet monitor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct T38UdpTLPacket {
    /// UDPTL type: 0 = primary only, 1 = primary + 1 redundancy, etc.
    pub udptl_type: u8,
    /// Sequence number (2 bytes BE in UDPTL).
    pub seq: u16,
    /// Length of primary IFP payload in bytes.
    pub primary_len: u16,
    /// IFP type name if recognizable from primary (first 2 bytes).
    pub ifp_type: Option<String>,
    /// Primary payload length actually present (may be less than primary_len if truncated).
    pub primary_payload_len: usize,
}

/// UDPTL type 0 = primary only. Format: [type=0][seq 2B BE][primary_len 2B BE][primary...]
#[allow(dead_code)]
const UDPTL_TYPE_PRIMARY_ONLY: u8 = 0;

/// IFP (T.38 Annex D) type prefixes (first 2 bytes of primary).
/// 0x00 0x00 = T30_INDICATOR, 0x80 0x01 = T30_DATA, 0x80 0x02 = T30_DATA_END, etc.
fn ifp_type_name(data: &[u8]) -> Option<String> {
    if data.len() < 2 {
        return None;
    }
    let (b0, b1) = (data[0], data[1]);
    let name = match (b0, b1) {
        (0x00, 0x00) => "T30_INDICATOR",
        (0x80, 0x01) => "T30_DATA",
        (0x80, 0x02) => "T30_DATA_END",
        (0x80, 0x03) => "T30_SIGNAL",
        (0x80, 0x04) => "T30_PRE_MESSAGE",
        (0x80, 0x05) => "T30_MESSAGE",
        (0x80, 0x06) => "T30_HDLC_DATA",
        (0x80, 0x07) => "T30_HDLC_SIGNAL",
        (0x80, 0x08) => "T30_HDLC_FAX_DATA",
        (0x80, 0x09) => "T30_HDLC_FAX_SIGNAL",
        (0x80, 0x0A) => "T30_HDLC_CFR",
        (0x80, 0x0B) => "T30_HDLC_CTC",
        (0x80, 0x0C) => "T30_HDLC_DCN",
        (0x80, 0x0D) => "T30_HDLC_NSC",
        (0x80, 0x0E) => "T30_HDLC_NSS",
        (0x80, 0x0F) => "T30_HDLC_EOM",
        (0x80, 0x10) => "T30_HDLC_MCF",
        (0x80, 0x11) => "T30_HDLC_RNR",
        (0x80, 0x12) => "T30_HDLC_PPR",
        (0x80, 0x13) => "T30_HDLC_PIP",
        _ => return None,
    };
    Some(name.to_string())
}

/// Parse T.38 UDPTL packet (type 0 = primary only). Returns None if not valid UDPTL.
pub fn parse_udptl(data: &[u8]) -> Option<T38UdpTLPacket> {
    // UDPTL type 0: [type=0][seq 2B BE][primary_len 2B BE][primary...] => minimum 5 bytes
    if data.len() < 5 {
        return None;
    }
    let udptl_type = data[0];
    let seq = u16::from_be_bytes([data[1], data[2]]);
    let primary_len = u16::from_be_bytes([data[3], data[4]]);

    // Sanity: primary_len should be reasonable (T.38 IFP typically < 2KB per packet)
    if primary_len > 4096 {
        return None;
    }

    let primary_payload = if data.len() >= 5 + primary_len as usize {
        &data[5..5 + primary_len as usize]
    } else {
        &data[5..]
    };
    let primary_payload_len = primary_payload.len();
    let ifp_type = ifp_type_name(primary_payload);

    Some(T38UdpTLPacket {
        udptl_type,
        seq,
        primary_len,
        ifp_type,
        primary_payload_len,
    })
}

/// Check if payload looks like UDPTL (type 0): first byte 0, len >= 5, primary_len reasonable.
pub fn looks_like_udptl(data: &[u8]) -> bool {
    if data.len() < 5 {
        return false;
    }
    if data[0] != 0 {
        return false;
    }
    let primary_len = u16::from_be_bytes([data[3], data[4]]);
    primary_len <= 4096 && (data.len() >= 5 + primary_len as usize || data.len() >= 5)
}
