//! SIP device fingerprinting engine.
//!
//! Parses User-Agent and Server headers from SIP responses to identify
//! device vendor, model, firmware version, and device type.

use serde::{Deserialize, Serialize};

// ── Types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Phone,
    Pbx,
    Gateway,
    Sbc,
    Proxy,
    Softphone,
    Unknown,
}

impl std::fmt::Display for DeviceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeviceType::Phone => write!(f, "Phone"),
            DeviceType::Pbx => write!(f, "PBX"),
            DeviceType::Gateway => write!(f, "Gateway"),
            DeviceType::Sbc => write!(f, "SBC"),
            DeviceType::Proxy => write!(f, "Proxy"),
            DeviceType::Softphone => write!(f, "Softphone"),
            DeviceType::Unknown => write!(f, "Unknown"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceFingerprint {
    pub vendor: String,
    pub model: String,
    pub firmware: String,
    pub device_type: DeviceType,
}

impl Default for DeviceFingerprint {
    fn default() -> Self {
        Self {
            vendor: String::new(),
            model: String::new(),
            firmware: String::new(),
            device_type: DeviceType::Unknown,
        }
    }
}

// ── Fingerprinting ───────────────────────────────────────────────

/// Fingerprint a SIP device from its User-Agent and Server header values.
/// Either header (or both) may be empty.
pub fn fingerprint_device(user_agent: &str, server: &str) -> DeviceFingerprint {
    // Try User-Agent first, then Server header
    let ua = if !user_agent.is_empty() {
        user_agent
    } else if !server.is_empty() {
        server
    } else {
        return DeviceFingerprint::default();
    };

    let ua_lower = ua.to_lowercase();

    // ── Yealink ──────────────────────────────────────────────
    // Examples: "Yealink SIP-T46U 108.86.0.80" "Yealink SIP-T54W 96.86.0.100"
    if ua_lower.contains("yealink") {
        return parse_yealink(ua);
    }

    // ── Polycom / Poly ───────────────────────────────────────
    // Examples: "PolycomVVX-VVX_601-UA/6.4.3.2389" "Polycom/5.9.6.2327 ..."
    if ua_lower.contains("polycom") || ua_lower.contains("poly-") {
        return parse_polycom(ua);
    }

    // ── Cisco ────────────────────────────────────────────────
    // Examples: "Cisco-SIPGateway/IOS-16.12.4" "Cisco/SPA504G-7.6.2d"
    if ua_lower.contains("cisco") {
        return parse_cisco(ua);
    }

    // ── Grandstream ──────────────────────────────────────────
    // Examples: "Grandstream GXP2170 1.0.11.62" "Grandstream HT814 1.0.31.2"
    if ua_lower.contains("grandstream") {
        return parse_grandstream(ua);
    }

    // ── Snom ─────────────────────────────────────────────────
    // Examples: "snom760/8.7.5.46" "snomD785/10.1.140.18"
    if ua_lower.contains("snom") {
        return parse_snom(ua);
    }

    // ── Fanvil ───────────────────────────────────────────────
    // Examples: "Fanvil X6U 2.12.5.2" "Fanvil X3SP 2.10.2.3"
    if ua_lower.contains("fanvil") {
        return parse_fanvil(ua);
    }

    // ── Obihai / OBi ─────────────────────────────────────────
    // Examples: "OBi508/4.2.1(Build: 7713)" "OBi200/3.2.2"
    if ua_lower.contains("obi") {
        return parse_obihai(ua);
    }

    // ── AudioCodes ───────────────────────────────────────────
    // Examples: "Audiocodes-Sip-Gateway-Mediant 1000B/v.7.20A.258"
    if ua_lower.contains("audiocodes") {
        return parse_audiocodes(ua);
    }

    // ── Asterisk ─────────────────────────────────────────────
    // Examples: "Asterisk PBX 18.15.0" "FPBX-16.0.33(18.15.0)"
    if ua_lower.contains("asterisk") || ua_lower.contains("fpbx") {
        return parse_asterisk(ua);
    }

    // ── FreeSWITCH ───────────────────────────────────────────
    // Examples: "FreeSWITCH-mod_sofia/1.10.7-release~64bit"
    if ua_lower.contains("freeswitch") {
        return parse_freeswitch(ua);
    }

    // ── Kamailio ─────────────────────────────────────────────
    // Examples: "Kamailio (5.7.2 (x86_64/linux))"
    if ua_lower.contains("kamailio") {
        return parse_kamailio(ua);
    }

    // ── OpenSIPS ─────────────────────────────────────────────
    // Examples: "OpenSIPS (3.3.0 (x86_64/linux))"
    if ua_lower.contains("opensips") {
        return parse_opensips(ua);
    }

    // ── Avaya ────────────────────────────────────────────────
    if ua_lower.contains("avaya") {
        return parse_avaya(ua);
    }

    // ── Mitel ────────────────────────────────────────────────
    if ua_lower.contains("mitel") || ua_lower.contains("aastra") {
        return parse_mitel(ua);
    }

    // ── Linphone (softphone) ─────────────────────────────────
    if ua_lower.contains("linphone") {
        return parse_simple(ua, "Linphone", DeviceType::Softphone);
    }

    // ── MicroSIP (softphone) ─────────────────────────────────
    if ua_lower.contains("microsip") {
        return parse_simple(ua, "MicroSIP", DeviceType::Softphone);
    }

    // ── Twilio ───────────────────────────────────────────────
    if ua_lower.contains("twilio") {
        return DeviceFingerprint {
            vendor: "Twilio".to_string(),
            model: String::new(),
            firmware: extract_version(ua),
            device_type: DeviceType::Proxy,
        };
    }

    // ── SIPalyzer (ourselves) ────────────────────────────────
    if ua_lower.contains("sipalyzer") {
        return DeviceFingerprint {
            vendor: "SIPalyzer".to_string(),
            model: String::new(),
            firmware: extract_version(ua),
            device_type: DeviceType::Softphone,
        };
    }

    // ── Fallback — try to extract something useful ───────────
    DeviceFingerprint {
        vendor: extract_first_word(ua),
        model: String::new(),
        firmware: extract_version(ua),
        device_type: DeviceType::Unknown,
    }
}

// ── Vendor-specific parsers ──────────────────────────────────────

fn parse_yealink(ua: &str) -> DeviceFingerprint {
    // "Yealink SIP-T46U 108.86.0.80"
    let parts: Vec<&str> = ua.split_whitespace().collect();
    let model = parts.get(1).unwrap_or(&"").to_string();
    let firmware = parts.get(2).unwrap_or(&"").to_string();
    let device_type = if model.starts_with("SIP-T") || model.starts_with("SIP-VP") {
        DeviceType::Phone
    } else if model.starts_with("SIP-W") {
        DeviceType::Phone // DECT
    } else if model.starts_with("TA") || model.starts_with("VCS") {
        DeviceType::Gateway
    } else {
        DeviceType::Phone
    };
    DeviceFingerprint {
        vendor: "Yealink".to_string(),
        model,
        firmware,
        device_type,
    }
}

fn parse_polycom(ua: &str) -> DeviceFingerprint {
    // "PolycomVVX-VVX_601-UA/6.4.3.2389"
    // "Polycom/5.9.6.2327 ..."
    let firmware = extract_version(ua);
    let model = if ua.contains("VVX") {
        extract_between(ua, "VVX", "-UA").unwrap_or_else(|| "VVX".to_string())
    } else if ua.contains("SoundPoint") {
        "SoundPoint".to_string()
    } else if ua.contains("Trio") {
        "Trio".to_string()
    } else {
        String::new()
    };
    DeviceFingerprint {
        vendor: "Polycom".to_string(),
        model: if model.starts_with("_") {
            model[1..].to_string()
        } else {
            model
        },
        firmware,
        device_type: DeviceType::Phone,
    }
}

fn parse_cisco(ua: &str) -> DeviceFingerprint {
    // "Cisco-SIPGateway/IOS-16.12.4"
    // "Cisco/SPA504G-7.6.2d"
    // "Cisco-OCSBC/1.0"
    let ua_lower = ua.to_lowercase();
    let firmware = extract_version(ua);
    let device_type = if ua_lower.contains("gateway") {
        DeviceType::Gateway
    } else if ua_lower.contains("sbc") || ua_lower.contains("cube") {
        DeviceType::Sbc
    } else if ua_lower.contains("ucm") || ua_lower.contains("callmanager") {
        DeviceType::Pbx
    } else if ua_lower.contains("spa") || ua_lower.contains("cp-") {
        DeviceType::Phone
    } else {
        DeviceType::Unknown
    };
    let model = if let Some(m) = extract_cisco_model(ua) {
        m
    } else {
        String::new()
    };
    DeviceFingerprint {
        vendor: "Cisco".to_string(),
        model,
        firmware,
        device_type,
    }
}

fn extract_cisco_model(ua: &str) -> Option<String> {
    // Try "Cisco/SPA504G-..." or "CP-8845/..."
    for part in ua.split(&['/', '-', ' '][..]) {
        let p = part.trim();
        if (p.starts_with("SPA") || p.starts_with("CP") || p.starts_with("ATA"))
            && p.len() > 2
            && p.chars().any(|c| c.is_ascii_digit())
        {
            return Some(p.to_string());
        }
    }
    None
}

fn parse_grandstream(ua: &str) -> DeviceFingerprint {
    // "Grandstream GXP2170 1.0.11.62"
    // "Grandstream HT814 1.0.31.2"
    let parts: Vec<&str> = ua.split_whitespace().collect();
    let model = parts.get(1).unwrap_or(&"").to_string();
    let firmware = parts.get(2).unwrap_or(&"").to_string();
    let device_type =
        if model.starts_with("GXP") || model.starts_with("GRP") || model.starts_with("GXV") {
            DeviceType::Phone
        } else if model.starts_with("HT") || model.starts_with("GXW") {
            DeviceType::Gateway
        } else if model.starts_with("UCM") {
            DeviceType::Pbx
        } else {
            DeviceType::Phone
        };
    DeviceFingerprint {
        vendor: "Grandstream".to_string(),
        model,
        firmware,
        device_type,
    }
}

fn parse_snom(ua: &str) -> DeviceFingerprint {
    // "snom760/8.7.5.46" "snomD785/10.1.140.18"
    let model_fw: Vec<&str> = ua.splitn(2, '/').collect();
    let raw_model = model_fw.first().unwrap_or(&"").trim();
    let model = raw_model.replace("snom", "").replace("Snom", "");
    let firmware = model_fw.get(1).unwrap_or(&"").trim().to_string();
    DeviceFingerprint {
        vendor: "Snom".to_string(),
        model,
        firmware,
        device_type: DeviceType::Phone,
    }
}

fn parse_fanvil(ua: &str) -> DeviceFingerprint {
    // "Fanvil X6U 2.12.5.2"
    let parts: Vec<&str> = ua.split_whitespace().collect();
    let model = parts.get(1).unwrap_or(&"").to_string();
    let firmware = parts.get(2).unwrap_or(&"").to_string();
    DeviceFingerprint {
        vendor: "Fanvil".to_string(),
        model,
        firmware,
        device_type: DeviceType::Phone,
    }
}

fn parse_obihai(ua: &str) -> DeviceFingerprint {
    // "OBi508/4.2.1(Build: 7713)"
    let model_fw: Vec<&str> = ua.splitn(2, '/').collect();
    let model = model_fw.first().unwrap_or(&"").trim().to_string();
    let firmware = model_fw.get(1).unwrap_or(&"").trim().to_string();
    let device_type = if model.contains("508") || model.contains("504") {
        DeviceType::Gateway
    } else {
        DeviceType::Gateway // OBi devices are typically ATAs/gateways
    };
    DeviceFingerprint {
        vendor: "Obihai".to_string(),
        model,
        firmware,
        device_type,
    }
}

fn parse_audiocodes(ua: &str) -> DeviceFingerprint {
    // "Audiocodes-Sip-Gateway-Mediant 1000B/v.7.20A.258"
    let firmware = extract_version(ua);
    let model = if let Some(pos) = ua.to_lowercase().find("mediant") {
        let rest = &ua[pos..];
        rest.split('/').next().unwrap_or("").trim().to_string()
    } else {
        String::new()
    };
    let ua_lower = ua.to_lowercase();
    let device_type = if ua_lower.contains("gateway") {
        DeviceType::Gateway
    } else if ua_lower.contains("sbc") {
        DeviceType::Sbc
    } else {
        DeviceType::Gateway
    };
    DeviceFingerprint {
        vendor: "AudioCodes".to_string(),
        model,
        firmware,
        device_type,
    }
}

fn parse_asterisk(ua: &str) -> DeviceFingerprint {
    // "Asterisk PBX 18.15.0" "FPBX-16.0.33(18.15.0)"
    let firmware = extract_version(ua);
    let model = if ua.contains("FPBX") {
        "FreePBX".to_string()
    } else {
        "Asterisk".to_string()
    };
    DeviceFingerprint {
        vendor: "Digium/Sangoma".to_string(),
        model,
        firmware,
        device_type: DeviceType::Pbx,
    }
}

fn parse_freeswitch(ua: &str) -> DeviceFingerprint {
    // "FreeSWITCH-mod_sofia/1.10.7-release~64bit"
    let firmware = extract_version(ua);
    DeviceFingerprint {
        vendor: "FreeSWITCH".to_string(),
        model: "FreeSWITCH".to_string(),
        firmware,
        device_type: DeviceType::Pbx,
    }
}

fn parse_kamailio(ua: &str) -> DeviceFingerprint {
    // "Kamailio (5.7.2 (x86_64/linux))"
    let firmware = extract_version(ua);
    DeviceFingerprint {
        vendor: "Kamailio".to_string(),
        model: "Kamailio".to_string(),
        firmware,
        device_type: DeviceType::Proxy,
    }
}

fn parse_opensips(ua: &str) -> DeviceFingerprint {
    // "OpenSIPS (3.3.0 (x86_64/linux))"
    let firmware = extract_version(ua);
    DeviceFingerprint {
        vendor: "OpenSIPS".to_string(),
        model: "OpenSIPS".to_string(),
        firmware,
        device_type: DeviceType::Proxy,
    }
}

fn parse_avaya(ua: &str) -> DeviceFingerprint {
    let firmware = extract_version(ua);
    DeviceFingerprint {
        vendor: "Avaya".to_string(),
        model: String::new(),
        firmware,
        device_type: DeviceType::Phone,
    }
}

fn parse_mitel(ua: &str) -> DeviceFingerprint {
    let firmware = extract_version(ua);
    DeviceFingerprint {
        vendor: "Mitel".to_string(),
        model: String::new(),
        firmware,
        device_type: DeviceType::Phone,
    }
}

fn parse_simple(ua: &str, vendor: &str, device_type: DeviceType) -> DeviceFingerprint {
    let firmware = extract_version(ua);
    DeviceFingerprint {
        vendor: vendor.to_string(),
        model: String::new(),
        firmware,
        device_type,
    }
}

// ── Utility helpers ──────────────────────────────────────────────

/// Extract the first version-like string (digits and dots) from text.
fn extract_version(text: &str) -> String {
    let mut best = String::new();
    let mut current = String::new();
    let mut dot_count = 0;

    for ch in text.chars() {
        if ch.is_ascii_digit() || (ch == '.' && !current.is_empty()) {
            if ch == '.' {
                dot_count += 1;
            }
            current.push(ch);
        } else {
            if dot_count >= 1 && current.len() > best.len() {
                best = current.trim_end_matches('.').to_string();
            }
            current.clear();
            dot_count = 0;
        }
    }
    // Check the last segment
    if dot_count >= 1 && current.len() > best.len() {
        best = current.trim_end_matches('.').to_string();
    }
    best
}

/// Extract text between two markers.
fn extract_between(text: &str, start: &str, end: &str) -> Option<String> {
    let s = text.find(start)?;
    let after = s + start.len();
    let e = text[after..].find(end)?;
    Some(text[after..after + e].to_string())
}

/// Extract the first word from a string.
fn extract_first_word(text: &str) -> String {
    text.split_whitespace()
        .next()
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_yealink() {
        let fp = fingerprint_device("Yealink SIP-T46U 108.86.0.80", "");
        assert_eq!(fp.vendor, "Yealink");
        assert_eq!(fp.model, "SIP-T46U");
        assert_eq!(fp.firmware, "108.86.0.80");
        assert_eq!(fp.device_type, DeviceType::Phone);
    }

    #[test]
    fn test_asterisk() {
        let fp = fingerprint_device("Asterisk PBX 18.15.0", "");
        assert_eq!(fp.vendor, "Digium/Sangoma");
        assert_eq!(fp.model, "Asterisk");
        assert_eq!(fp.firmware, "18.15.0");
        assert_eq!(fp.device_type, DeviceType::Pbx);
    }

    #[test]
    fn test_freeswitch() {
        let fp = fingerprint_device("FreeSWITCH-mod_sofia/1.10.7-release~64bit", "");
        assert_eq!(fp.vendor, "FreeSWITCH");
        assert_eq!(fp.firmware, "1.10.7");
        assert_eq!(fp.device_type, DeviceType::Pbx);
    }

    #[test]
    fn test_grandstream() {
        let fp = fingerprint_device("Grandstream HT814 1.0.31.2", "");
        assert_eq!(fp.vendor, "Grandstream");
        assert_eq!(fp.model, "HT814");
        assert_eq!(fp.device_type, DeviceType::Gateway);
    }

    #[test]
    fn test_kamailio() {
        let fp = fingerprint_device("", "Kamailio (5.7.2 (x86_64/linux))");
        assert_eq!(fp.vendor, "Kamailio");
        assert_eq!(fp.firmware, "5.7.2");
        assert_eq!(fp.device_type, DeviceType::Proxy);
    }

    #[test]
    fn test_unknown() {
        let fp = fingerprint_device("SomethingWeird/3.2.1", "");
        assert_eq!(fp.device_type, DeviceType::Unknown);
        assert_eq!(fp.firmware, "3.2.1");
    }

    #[test]
    fn test_empty() {
        let fp = fingerprint_device("", "");
        assert_eq!(fp.device_type, DeviceType::Unknown);
        assert!(fp.vendor.is_empty());
    }
}
