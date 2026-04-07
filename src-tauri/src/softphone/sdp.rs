//! SDP per RFC 4566; media direction per RFC 3264 (hold = sendonly §8.4, resume = sendrecv).
//!
//! Fax over VoIP (US carriers): We always start with **m=audio G.711** (PCMU first = pt 0) so SIP
//! and carriers accept the call; then we send a **re-INVITE with m=image udptl t38** (T.38 over
//! UDPTL per RFC 3362 / ITU T.38). We do not transcode—after 200 OK to the re-INVITE we send
//! T.38 UDPTL only. Carriers may transcode T.38↔PSTN or T.38↔G.711 on their side.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Global session version counter for SDP o= line (RFC 4566 §5.2).
/// Starts from system time, increments on each new SDP to ensure uniqueness.
static SESSION_VERSION: AtomicU64 = AtomicU64::new(0);

/// Generate unique session-id and session-version for SDP o= line.
/// RFC 4566: o=<username> <sess-id> <sess-version> IN IP4 <addr>
fn generate_session_ids() -> (u64, u64) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Use CAS to initialize SESSION_VERSION from system time on first call
    let _ = SESSION_VERSION.compare_exchange(0, now, Ordering::SeqCst, Ordering::Relaxed);
    let version = SESSION_VERSION.fetch_add(1, Ordering::SeqCst);
    // session-id can be the same as version for simplicity (both unique per SDP)
    (version, version)
}

/// Parse c= line: c=IN IP4 192.168.1.1 (RFC 4566 §5.7). Returns first c= in the body (session-level).
pub fn parse_connection(sdp_body: &str) -> Option<String> {
    for line in sdp_body.lines() {
        let line = line.trim();
        if line.starts_with("c=IN IP4 ") {
            return Some(line["c=IN IP4 ".len()..].trim().to_string());
        }
    }
    None
}

/// Parse connection address that applies to m=image (T.38). RFC 4566: media-level c= overrides session.
/// Scans for m=image, then uses the next c= in that media block, or session-level c= if none.
pub fn parse_connection_for_image(sdp_body: &str) -> Option<String> {
    let mut session_c: Option<String> = None;
    let mut in_image = false;
    for line in sdp_body.lines() {
        let line = line.trim();
        if line.starts_with("m=") {
            in_image = line.starts_with("m=image ");
            continue;
        }
        if line.starts_with("c=IN IP4 ") {
            let addr = line["c=IN IP4 ".len()..].trim().to_string();
            if in_image {
                return Some(addr);
            }
            if session_c.is_none() {
                session_c = Some(addr);
            }
        }
    }
    session_c
}

/// Returns true if the SDP body describes a T.38/fax session (m=image ... udptl t38).
/// Used to route inbound INVITEs to fax center vs softphone.
pub fn is_t38_invite(sdp_body: &str) -> bool {
    let mut has_image = false;
    let mut has_udptl_t38 = false;
    for line in sdp_body.lines() {
        let line = line.trim();
        if line.starts_with("m=image ") {
            has_image = true;
            if line.contains("udptl") && line.contains("t38") {
                has_udptl_t38 = true;
            }
        }
    }
    has_image && has_udptl_t38
}

/// Parse m=image line for T.38: m=image 4000 udptl t38
/// Returns UDPTL port.
pub fn parse_t38_media(sdp_body: &str) -> Option<u16> {
    for line in sdp_body.lines() {
        let line = line.trim();
        if line.starts_with("m=image ") {
            let rest = line["m=image ".len()..].trim();
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if !parts.is_empty() {
                return parts[0].parse().ok();
            }
        }
    }
    None
}

/// Parse m= line: m=audio 10000 RTP/AVP 0 8
/// Returns (port, payload types).
pub fn parse_media(sdp_body: &str) -> Option<(u16, Vec<u8>)> {
    for line in sdp_body.lines() {
        let line = line.trim();
        if line.starts_with("m=audio ") {
            let rest = line["m=audio ".len()..].trim();
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() >= 3 {
                let port: u16 = parts[0].parse().ok()?;
                let pts: Vec<u8> = parts[2..]
                    .iter()
                    .filter_map(|s| s.parse::<u8>().ok())
                    .collect();
                return Some((port, pts));
            }
        }
    }
    None
}

/// RTP payload type to SDP rtpmap (codec/clock).
pub fn pt_to_rtpmap(pt: u8) -> Option<&'static str> {
    match pt {
        0 => Some("PCMU/8000"),
        8 => Some("PCMA/8000"),
        9 => Some("G722/8000"),
        101 => Some("telephone-event/8000"),
        _ => None,
    }
}

/// SDP fmtp for telephone-event: supported DTMF events 0-16 (digits, *, #, A-D, flash).
pub fn pt_to_fmtp(pt: u8) -> Option<String> {
    match pt {
        101 => Some(format!("a=fmtp:{} 0-16", pt)),
        _ => None,
    }
}

/// Default payload types when none specified: PCMU, PCMA, G.722 (VoIP-compatible).
const DEFAULT_PTS: &[u8] = &[0, 8, 9];

/// Codec order for fax initial INVITE: PCMU (0) first for US carrier compatibility, then PCMA, G.722.
/// We never offer T.38 in the initial INVITE; we offer G.711 and then re-INVITE to T.38.
pub const FAX_INITIAL_CODECS: &[u8] = &[0, 8, 9]; // PCMU, PCMA, G.722

/// Build SDP offer (RFC 4566): v, o, s, c, t, m=audio, a=rtpmap; a=sendrecv per RFC 3264.
/// Always includes m=audio and codecs (PCMU/PCMA/G.722) so INVITE is never sent without media.
/// Uses a single format! for the core SDP to avoid any chance of truncated or empty media.
/// No leading spaces on lines (RFC 4566: line starting with space/tab is continuation).
pub fn build_offer(local_ip: &str, local_rtp_port: u16, preferred_pts: &[u8]) -> String {
    let pts: &[u8] = if preferred_pts.is_empty() {
        DEFAULT_PTS
    } else {
        preferred_pts
    };
    // Build m= line and a=rtpmap lines explicitly so output is never empty/truncated.
    let mut pt_list = String::new();
    let mut rtpmaps = String::new();
    for pt in pts {
        pt_list.push_str(&format!("{} ", pt));
        if let Some(name) = pt_to_rtpmap(*pt) {
            rtpmaps.push_str(&format!("a=rtpmap:{} {}\r\n", pt, name));
        }
    }
    // Always include telephone-event for DTMF (RFC 2833) unless already in the list
    if !pts.contains(&101) {
        pt_list.push_str("101 ");
        rtpmaps.push_str("a=rtpmap:101 telephone-event/8000\r\n");
        rtpmaps.push_str("a=fmtp:101 0-16\r\n");
    } else if let Some(fmtp) = pt_to_fmtp(101) {
        rtpmaps.push_str(&format!("{}\r\n", fmtp));
    }
    // Generate unique session IDs (RFC 4566 §5.2) - some gateways reject static 0 0 values.
    let (sess_id, sess_ver) = generate_session_ids();
    // Single format! for entire SDP: session + m=audio + attributes (no partial writes).
    format!(
        "v=0\r\n\
o=sipalyzer {} {} IN IP4 {}\r\n\
s=-\r\n\
c=IN IP4 {}\r\n\
t=0 0\r\n\
m=audio {} RTP/AVP {}\r\n\
a=sendrecv\r\n\
a=ptime:20\r\n\
{}",
        sess_id,
        sess_ver,
        local_ip,
        local_ip,
        local_rtp_port,
        pt_list.trim_end(),
        rtpmaps
    )
}

/// Build SDP offer for T.38 fax re-INVITE (RFC 3362 / ITU T.38 Annex D).
/// m=image &lt;port&gt; udptl t38 — UDPTL transport, not RTP. Used after initial call is up on G.711.
///
/// Attributes per RFC 4612:
///   T38FaxVersion:0          — T.38 (1998) baseline
///   T38MaxBitRate:14400      — V.17 max (standard Group 3)
///   T38FaxUdpEC:t38UDPRedundancy — redundancy-based error correction
///   T38FaxRateManagement:localTCF — we generate Training Check Function
///   T38FaxMaxDatagram:400    — max UDPTL packet size (required by many gateways)
///
/// NOTE: SDP attribute values use COLON separator (a=attr:value) per RFC 4566 §5.13.
/// Using `=` instead of `:` causes gateways to parse the entire string as a flag attribute
/// with no value, which silently breaks T.38 negotiation.
#[allow(dead_code)]
pub fn build_t38_offer(local_ip: &str, udptl_port: u16) -> String {
    // Generate unique session IDs for the re-INVITE (RFC 4566 §5.2).
    // The session-version MUST be greater than the initial INVITE's version per RFC 3264.
    let (sess_id, sess_ver) = generate_session_ids();
    format!(
        "v=0\r\n\
o=sipalyzer {} {} IN IP4 {}\r\n\
s=-\r\n\
c=IN IP4 {}\r\n\
t=0 0\r\n\
m=image {} udptl t38\r\n\
a=sendrecv\r\n\
a=T38FaxVersion:0\r\n\
a=T38MaxBitRate:14400\r\n\
a=T38FaxUdpEC:t38UDPRedundancy\r\n\
a=T38FaxRateManagement:localTCF\r\n\
a=T38FaxMaxDatagram:400\r\n",
        sess_id, sess_ver, local_ip, local_ip, udptl_port
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_offer_contains_media_and_codecs() {
        let sdp = build_offer("10.0.0.1", 10000, &[0, 8, 9]);
        assert!(sdp.contains("m=audio"), "SDP must contain m=audio line");
        assert!(sdp.contains("RTP/AVP"), "SDP must contain RTP/AVP");
        assert!(
            sdp.contains("a=rtpmap:0 PCMU/8000"),
            "SDP must contain PCMU rtpmap"
        );
        assert!(sdp.contains("a=sendrecv"), "SDP must contain sendrecv");
        assert!(sdp.len() > 150, "Full SDP should be well over 150 bytes");
    }

    #[test]
    fn build_offer_empty_pts_uses_defaults() {
        let sdp = build_offer("192.168.1.1", 20000, &[]);
        assert!(sdp.contains("m=audio"));
        assert!(sdp.contains("RTP/AVP"));
    }
}

/// Negotiated T.38 parameters from remote SDP answer
#[derive(Debug, Clone)]
pub struct T38NegotiatedParams {
    /// T.38 version (from a=T38FaxVersion)
    pub version: u8,
    /// Maximum bit rate (from a=T38maxBitRate)
    pub max_bit_rate: u32,
    /// Error correction mode (from a=T38FaxUdpEC)
    pub udp_ec: String,
    /// Rate management method (from a=T38FaxRateManagement)
    pub rate_management: String,
    /// Maximum datagram size (from a=T38MaxDatagram)
    pub max_datagram: u16,
    /// Remote UDPTL port (from m=image line)
    pub remote_port: u16,
    /// Whether T.38 was accepted
    pub accepted: bool,
}

impl Default for T38NegotiatedParams {
    fn default() -> Self {
        Self {
            version: 0,
            max_bit_rate: 14400,
            udp_ec: "t38UDPRedundancy".to_string(),
            rate_management: "localTCF".to_string(),
            max_datagram: 400,
            remote_port: 0,
            accepted: false,
        }
    }
}

/// Parse T.38 SDP attributes from a remote SDP answer.
/// Returns negotiated parameters if T.38 was accepted, None if rejected.
pub fn parse_t38_answer(sdp_body: &str) -> Option<T38NegotiatedParams> {
    let mut params = T38NegotiatedParams::default();

    // Check for m=image line
    let port = parse_t38_media(sdp_body)?;
    if port == 0 {
        return None;
    }
    params.remote_port = port;
    params.accepted = true;

    // Parse T.38 attributes
    let mut in_image_section = false;
    for line in sdp_body.lines() {
        let line = line.trim();

        if line.starts_with("m=") {
            in_image_section = line.starts_with("m=image ");
            continue;
        }

        if !in_image_section {
            continue;
        }

        // T.38 SDP attributes (case-insensitive key matching)
        if let Some(val) = line
            .strip_prefix("a=T38FaxVersion:")
            .or_else(|| line.strip_prefix("a=T38FaxVersion="))
        {
            params.version = val.trim().parse().unwrap_or(0);
        } else if let Some(val) = line
            .strip_prefix("a=T38maxBitRate:")
            .or_else(|| line.strip_prefix("a=T38maxBitRate="))
        {
            params.max_bit_rate = val.trim().parse().unwrap_or(14400);
        } else if let Some(val) = line
            .strip_prefix("a=T38FaxUdpEC:")
            .or_else(|| line.strip_prefix("a=T38FaxUdpEC="))
        {
            params.udp_ec = val.trim().to_string();
        } else if let Some(val) = line
            .strip_prefix("a=T38FaxRateManagement:")
            .or_else(|| line.strip_prefix("a=T38FaxRateManagement="))
        {
            params.rate_management = val.trim().to_string();
        } else if let Some(val) = line
            .strip_prefix("a=T38MaxDatagram:")
            .or_else(|| line.strip_prefix("a=T38MaxDatagram="))
        {
            params.max_datagram = val.trim().parse().unwrap_or(400);
        }
    }

    Some(params)
}

/// Build SDP for re-INVITE (RFC 3264 §8.4): hold = a=sendonly, resume = a=sendrecv.
/// RFC 3264: session-version MUST be incremented in re-INVITE SDP.
/// No leading spaces on lines (RFC 4566: line starting with space/tab is continuation).
pub fn build_reinvite_sdp(local_ip: &str, local_rtp_port: u16, on_hold: bool) -> String {
    let dir = if on_hold { "sendonly" } else { "sendrecv" };
    // Generate unique session IDs with incremented version per RFC 3264 §8.
    let (sess_id, sess_ver) = generate_session_ids();
    format!(
        "v=0\r\n\
o=sipalyzer {} {} IN IP4 {}\r\n\
s=-\r\n\
c=IN IP4 {}\r\n\
t=0 0\r\n\
m=audio {} RTP/AVP 0 8 9 101\r\n\
a={}\r\n\
a=ptime:20\r\n\
a=rtpmap:0 PCMU/8000\r\n\
a=rtpmap:8 PCMA/8000\r\n\
a=rtpmap:9 G722/8000\r\n\
a=rtpmap:101 telephone-event/8000\r\n\
a=fmtp:101 0-16\r\n",
        sess_id, sess_ver, local_ip, local_ip, local_rtp_port, dir
    )
}
