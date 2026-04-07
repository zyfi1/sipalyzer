//! Provision Viewer: fetch Yealink/Poly-style provisioning files by URL with UA/MAC resolution.
//!
//! Yealink UA: "Yealink SIP-{Model} {Firmware}" — firmware versions from Yealink support (2024/2025).
//! Poly UA: "PolycomSoundPointIP-{Model}/{Firmware}" or "PolycomVVX-{Model}/{Firmware}".
//! MAC in UA is sent as colon-separated (00:11:22:33:44:55) to match real phone behavior.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::command;

/// Yealink model id → User-Agent. Format: "Yealink SIP-{Model} {Firmware}".
/// Firmware versions from Yealink support / release notes (T5 96.86.x, T4 U/S 66.86.x, T4 G 28.81.x, etc.).
const YEALINK_USER_AGENTS: &[(&str, &str)] = &[
    // T5 series — unified firmware 96.86.x.x (T53/T53W/T54W/T57W)
    ("T57W", "Yealink SIP-T57W 96.86.0.45"),
    ("T54W", "Yealink SIP-T54W 96.86.0.45"),
    ("T53W", "Yealink SIP-T53W 96.86.0.45"),
    ("T53", "Yealink SIP-T53 96.86.0.45"),
    // T4 series — U/S (66.86.x.x)
    ("T48U", "Yealink SIP-T48U 66.86.0.25"),
    ("T48S", "Yealink SIP-T48S 66.86.0.25"),
    ("T46U", "Yealink SIP-T46U 66.86.0.25"),
    ("T46S", "Yealink SIP-T46S 66.86.0.25"),
    ("T43U", "Yealink SIP-T43U 66.86.0.25"),
    ("T42U", "Yealink SIP-T42U 66.86.0.25"),
    ("T42S", "Yealink SIP-T42S 66.86.0.25"),
    ("T41S", "Yealink SIP-T41S 66.86.0.25"),
    // T4 series — G (28.81.x.x)
    ("T48G", "Yealink SIP-T48G 28.81.0.25"),
    ("T46G", "Yealink SIP-T46G 28.81.0.25"),
    ("T42G", "Yealink SIP-T42G 28.81.0.25"),
    ("T41P", "Yealink SIP-T41P 28.81.0.25"),
    ("T40P", "Yealink SIP-T40P 28.81.0.25"),
    ("T40G", "Yealink SIP-T40G 28.81.0.25"),
    // T3 series (96.86.x.x)
    ("T34W", "Yealink SIP-T34W 96.86.0.45"),
    ("T33G", "Yealink SIP-T33G 96.86.0.45"),
    ("T33P", "Yealink SIP-T33P 96.86.0.45"),
    ("T31W", "Yealink SIP-T31W 96.86.0.45"),
    ("T31G", "Yealink SIP-T31G 96.86.0.45"),
    ("T31P", "Yealink SIP-T31P 96.86.0.45"),
    ("T31", "Yealink SIP-T31 96.86.0.45"),
    ("T30P", "Yealink SIP-T30P 96.86.0.45"),
    ("T30", "Yealink SIP-T30 96.86.0.45"),
    // T2 series (58.80.x.x)
    ("T29G", "Yealink SIP-T29G 58.80.0.30"),
    ("T27G", "Yealink SIP-T27G 58.80.0.30"),
    ("T23P", "Yealink SIP-T23P 58.80.0.30"),
    ("T21P", "Yealink SIP-T21P 58.80.0.30"),
    ("T19P", "Yealink SIP-T19P 58.80.0.30"),
    // Conference (148.86.x.x)
    ("CP925", "Yealink SIP-CP925 148.86.0.25"),
    ("CP920", "Yealink SIP-CP920 148.86.0.25"),
    // Video (124.86.x.x)
    ("VP59", "Yealink SIP-VP59 124.86.0.25"),
];

/// Poly (Polycom) model id → User-Agent.
/// VVX: "PolycomVVX-{Model}/{Firmware}", SoundPoint: "PolycomSoundPointIP-{Model}/{Firmware}".
/// Trio: "PolycomRealPresenceTrio-{Model}/{Firmware}".
/// Firmware versions from Poly/HP support (UCS 6.4.x, 5.9.x).
const POLY_USER_AGENTS: &[(&str, &str)] = &[
    // VVX x50 series — UCS 6.4.x
    ("VVX150", "PolycomVVX-VVX_150-UA/6.4.4.8275"),
    ("VVX250", "PolycomVVX-VVX_250-UA/6.4.4.8275"),
    ("VVX350", "PolycomVVX-VVX_350-UA/6.4.4.8275"),
    ("VVX450", "PolycomVVX-VVX_450-UA/6.4.4.8275"),
    // VVX x01 series — UCS 5.9.x
    ("VVX101", "PolycomVVX-VVX_101-UA/5.9.7.3480"),
    ("VVX201", "PolycomVVX-VVX_201-UA/5.9.7.3480"),
    ("VVX301", "PolycomVVX-VVX_301-UA/5.9.7.3480"),
    ("VVX311", "PolycomVVX-VVX_311-UA/5.9.7.3480"),
    ("VVX401", "PolycomVVX-VVX_401-UA/5.9.7.3480"),
    ("VVX411", "PolycomVVX-VVX_411-UA/5.9.7.3480"),
    ("VVX501", "PolycomVVX-VVX_501-UA/5.9.7.3480"),
    ("VVX601", "PolycomVVX-VVX_601-UA/5.9.7.3480"),
    // VVX x00 series — UCS 5.9.x
    ("VVX300", "PolycomVVX-VVX_300-UA/5.9.7.3480"),
    ("VVX310", "PolycomVVX-VVX_310-UA/5.9.7.3480"),
    ("VVX400", "PolycomVVX-VVX_400-UA/5.9.7.3480"),
    ("VVX410", "PolycomVVX-VVX_410-UA/5.9.7.3480"),
    ("VVX500", "PolycomVVX-VVX_500-UA/5.9.7.3480"),
    ("VVX600", "PolycomVVX-VVX_600-UA/5.9.7.3480"),
    // VVX 1500 — UCS 5.9.x
    ("VVX1500", "PolycomVVX-VVX_1500-UA/5.9.7.3480"),
    // SoundPoint IP — UCS 4.0.x (legacy)
    ("SPIP550", "PolycomSoundPointIP-SPIP_550-UA/4.0.15.1009"),
    ("SPIP560", "PolycomSoundPointIP-SPIP_560-UA/4.0.15.1009"),
    ("SPIP650", "PolycomSoundPointIP-SPIP_650-UA/4.0.15.1009"),
    ("SPIP670", "PolycomSoundPointIP-SPIP_670-UA/4.0.15.1009"),
    ("SPIP335", "PolycomSoundPointIP-SPIP_335-UA/4.0.15.1009"),
    ("SPIP450", "PolycomSoundPointIP-SPIP_450-UA/4.0.15.1009"),
    // Trio — UCS 7.x
    (
        "Trio8500",
        "PolycomRealPresenceTrio-Trio_8500-UA/7.2.2.1094",
    ),
    (
        "Trio8800",
        "PolycomRealPresenceTrio-Trio_8800-UA/7.2.2.1094",
    ),
    ("TrioC60", "PolycomRealPresenceTrio-Trio_C60-UA/7.2.2.1094"),
];

fn get_user_agent(model: &str, vendor: &str) -> Option<&'static str> {
    match vendor {
        "poly" => POLY_USER_AGENTS
            .iter()
            .find(|(id, _)| *id == model)
            .map(|(_, ua)| *ua),
        _ => YEALINK_USER_AGENTS
            .iter()
            .find(|(id, _)| *id == model)
            .map(|(_, ua)| *ua),
    }
}

/// Normalize MAC to 12-char lowercase hex, no separators. Reject invalid.
fn normalize_mac(input: &str) -> Result<String, String> {
    let s = input
        .trim()
        .replace([':', '-', '.', ' '], "")
        .to_lowercase();
    if s.len() != 12 {
        return Err(format!(
            "MAC must be 12 hex characters (with or without separators), got {}",
            s.len()
        ));
    }
    if !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("MAC must contain only hex digits (0-9, a-f)".to_string());
    }
    Ok(s)
}

/// Build final URL: substitute {mac}, %mac%, or literal mac.cfg; or append {MAC}.cfg to path.
fn build_provision_url(template: &str, mac: &str) -> String {
    let mac_lower = mac.to_lowercase();
    let mut url = template.trim().to_string();

    // Placeholders (case-insensitive for the placeholder name)
    if url.contains("{mac}") {
        url = url.replace("{mac}", &mac_lower);
    }
    if url.contains("{MAC}") {
        url = url.replace("{MAC}", &mac_lower);
    }
    if url.to_lowercase().contains("%mac%") {
        let lower = url.to_lowercase();
        if let Some(start) = lower.find("%mac%") {
            url = format!("{}{}{}", &url[..start], mac_lower, &url[start + 5..]);
        }
    }

    // Literal "mac.cfg" in path → replace with {mac}.cfg
    let url_lower = url.to_lowercase();
    if url_lower.ends_with("mac.cfg") {
        let n = url.len() - 7;
        url = format!("{}{}.cfg", &url[..n], mac_lower);
    } else if url_lower.contains("/mac.cfg") {
        if let Some(pos) = url_lower.find("/mac.cfg") {
            url = format!("{}/{}.cfg", &url[..pos], mac_lower);
        }
    }

    // No placeholder found and path looks like a directory or base URL → append /{mac}.cfg
    if !url.to_lowercase().contains(&mac_lower) {
        let trimmed = url.trim_end_matches('/');
        if trimmed.is_empty()
            || !trimmed.contains(".cfg")
            || url.ends_with('/')
            || url.rsplit('/').next().map(|s| s.is_empty()).unwrap_or(true)
        {
            url = format!("{}/{}.cfg", trimmed, mac_lower);
        }
    }

    url
}

/// Build Poly provision URL. Poly phones request {mac}-phone.cfg (or {mac}.cfg).
/// MAC is sent lowercase. Standard Poly patterns:
///   - {mac}-phone.cfg (device-specific)
///   - {mac}.cfg (common configs)
///   - 000000000000.cfg (base/default config)
fn build_poly_provision_url(template: &str, mac: &str) -> String {
    let mac_lower = mac.to_lowercase();
    let mut url = template.trim().to_string();

    // Same placeholder substitution as Yealink
    if url.contains("{mac}") {
        url = url.replace("{mac}", &mac_lower);
    }
    if url.contains("{MAC}") {
        url = url.replace("{MAC}", &mac_lower);
    }
    if url.to_lowercase().contains("%mac%") {
        let lower = url.to_lowercase();
        if let Some(start) = lower.find("%mac%") {
            url = format!("{}{}{}", &url[..start], mac_lower, &url[start + 5..]);
        }
    }

    // Literal "mac.cfg" → replace with {mac}.cfg
    let url_lower = url.to_lowercase();
    if url_lower.ends_with("mac.cfg") || url_lower.ends_with("mac-phone.cfg") {
        let filename_start = url.rfind('/').map(|i| i + 1).unwrap_or(0);
        url = format!("{}{}.cfg", &url[..filename_start], mac_lower);
    }

    // No MAC found → append {mac}.cfg (Poly default phone config)
    if !url.to_lowercase().contains(&mac_lower) {
        let trimmed = url.trim_end_matches('/');
        url = format!("{}/{}.cfg", trimmed, mac_lower);
    }

    url
}

/// Format 12-char hex MAC as colon-separated (00:11:22:33:44:55). Yealink phones send MAC in UA in this form.
fn mac_with_colons(mac: &str) -> String {
    let s = mac.to_lowercase();
    if s.len() != 12 {
        return mac.to_string();
    }
    format!(
        "{}:{}:{}:{}:{}:{}",
        &s[0..2],
        &s[2..4],
        &s[4..6],
        &s[6..8],
        &s[8..10],
        &s[10..12]
    )
}

/// User-Agent with MAC suffix in Yealink style (00:00:00:00:00:00). Some servers expect MAC in UA.
fn user_agent_with_mac(base_ua: &str, mac: &str) -> String {
    let mac_tag = mac_with_colons(mac);
    format!("{} {}", base_ua, mac_tag)
}

fn validate_fetch_url(raw: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(raw).map_err(|e| format!("Invalid URL: {}", e))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Only http/https URLs are allowed".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL must include a host".to_string())?;
    let allow_local = std::env::var("SIPALYZER_ALLOW_LOCAL_FETCH")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if !allow_local {
        let is_localhost = host.eq_ignore_ascii_case("localhost");
        let is_loopback_ip = host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback() || ip.is_unspecified())
            .unwrap_or(false);
        if is_localhost || is_loopback_ip {
            return Err("Loopback/localhost fetch targets are blocked".to_string());
        }
    }
    Ok(parsed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestInfo {
    pub final_url: String,
    pub user_agent: String,
    pub mac_used: String,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_log: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedCfg {
    /// Groups by key prefix (e.g. "static." -> list of { key, value })
    pub groups: HashMap<String, Vec<KeyValue>>,
    /// Flat list of all entries
    pub entries: Vec<KeyValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchProvisionResult {
    pub raw: String,
    pub parsed: Option<ParsedCfg>,
    pub request_info: RequestInfo,
    pub parseable: bool,
}

/// Parse Yealink .cfg: line-based key = value; strip # comments and blank lines; group by prefix.
fn parse_yealink_cfg(body: &str) -> Option<ParsedCfg> {
    let mut groups: HashMap<String, Vec<KeyValue>> = HashMap::new();
    let mut entries = Vec::new();

    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(eq_pos) = line.find('=') else {
            continue;
        };
        let key = line[..eq_pos].trim().to_string();
        let value = line[eq_pos + 1..].trim().to_string();
        if key.is_empty() {
            continue;
        }

        let prefix = key
            .split('.')
            .next()
            .map(|s| format!("{}.", s))
            .unwrap_or_else(|| key.clone());
        let kv = KeyValue {
            key: key.clone(),
            value: value.clone(),
        };
        groups.entry(prefix).or_default().push(kv.clone());
        entries.push(kv);
    }

    if entries.is_empty() {
        return None;
    }

    Some(ParsedCfg { groups, entries })
}

/// Parse Poly (Polycom) XML cfg: XML with <key attr="val"/> and <key attr="val">value</key> format.
/// Polycom configs use XML structure like:
///   <reg reg.1.address="user" reg.1.server.1.address="sip.example.com" />
///   <voIpProt voIpProt.server.1.address="sip.example.com" />
/// We flatten all attributes into key=value entries for the same ParsedCfg format.
fn parse_poly_cfg(body: &str) -> Option<ParsedCfg> {
    let mut groups: HashMap<String, Vec<KeyValue>> = HashMap::new();
    let mut entries = Vec::new();

    // Match XML tags with attributes: <tagName attr1="val1" attr2="val2" ... />
    // or <tagName attr1="val1">...</tagName>
    let attr_re = regex::Regex::new(r#"(\w[\w.]*)\s*=\s*"([^"]*)""#).ok()?;

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("<!--") {
            continue;
        }
        // Extract attributes from XML tags
        for cap in attr_re.captures_iter(trimmed) {
            let key = match cap.get(1) {
                Some(m) => m.as_str().to_string(),
                None => continue,
            };
            let value = match cap.get(2) {
                Some(m) => m.as_str().to_string(),
                None => continue,
            };
            if key.is_empty() || key == "xmlns" || key == "xml" || key.starts_with("xmlns:") {
                continue;
            }
            let prefix = key
                .split('.')
                .next()
                .map(|s| format!("{}.", s))
                .unwrap_or_else(|| key.clone());
            let kv = KeyValue {
                key: key.clone(),
                value: value.clone(),
            };
            groups.entry(prefix).or_default().push(kv.clone());
            entries.push(kv);
        }
    }

    if entries.is_empty() {
        return None;
    }

    Some(ParsedCfg { groups, entries })
}

/// Detect if body looks parseable. Supports Yealink key=value and Poly XML formats.
/// Encrypted/binary → not parseable.
fn looks_parseable(body: &str) -> bool {
    // Check for Poly XML format first
    if looks_poly_xml(body) {
        return true;
    }
    let mut lines_with_equals = 0u32;
    let mut total_non_empty = 0u32;
    for line in body.lines().take(100) {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        total_non_empty += 1;
        if t.contains('=') {
            lines_with_equals += 1;
        }
    }
    total_non_empty > 0 && (lines_with_equals as f64 / total_non_empty.max(1) as f64) > 0.5
}

/// Check if body looks like Poly XML config (contains XML tags with dot-notation attributes).
fn looks_poly_xml(body: &str) -> bool {
    let trimmed = body.trim();
    // Quick check: must start with < (XML) and contain dot-notation attributes
    if !trimmed.starts_with('<') && !trimmed.starts_with("<?xml") {
        return false;
    }
    // Look for Poly-style attribute patterns: word.word.word="value"
    let mut poly_attrs = 0u32;
    for line in trimmed.lines().take(50) {
        let t = line.trim();
        if t.contains("reg.")
            || t.contains("voIpProt.")
            || t.contains("tcpIpApp.")
            || t.contains("call.")
            || t.contains("feature.")
            || t.contains("attendant.")
            || t.contains("nat.")
            || t.contains("dir.")
            || t.contains("mb.")
        {
            poly_attrs += 1;
        }
    }
    poly_attrs >= 2
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FetchProvisionFileArgs {
    provider_url: String,
    mac: String,
    model: String,
    #[serde(default)]
    include_mac_in_ua: Option<bool>,
    /// "yealink" (default) or "poly"
    #[serde(default)]
    vendor: Option<String>,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn fetch_provision_file(args: FetchProvisionFileArgs) -> Result<FetchProvisionResult, String> {
    let FetchProvisionFileArgs {
        provider_url,
        mac,
        model,
        include_mac_in_ua,
        vendor,
    } = args;
    let vendor = vendor.as_deref().unwrap_or("yealink");
    let normalized_mac = normalize_mac(&mac)?;
    let ua_table = match vendor {
        "poly" => POLY_USER_AGENTS,
        _ => YEALINK_USER_AGENTS,
    };
    let base_ua = get_user_agent(&model, vendor).ok_or_else(|| {
        format!(
            "Unknown {} model '{}'. Supported: {}",
            vendor,
            model,
            ua_table
                .iter()
                .map(|(id, _)| *id)
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;

    let final_url = if vendor == "poly" {
        build_poly_provision_url(&provider_url, &normalized_mac)
    } else {
        build_provision_url(&provider_url, &normalized_mac)
    };
    let validated_url = validate_fetch_url(&final_url)?;
    let timeout_secs = 15u64;
    // Poly phones typically don't send MAC in UA
    let send_mac_in_ua = if vendor == "poly" {
        include_mac_in_ua.unwrap_or(false)
    } else {
        include_mac_in_ua.unwrap_or(true)
    };

    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("HTTP client build failed: {}", e))?;

    let mut retry_log = Vec::new();

    let initial_ua = if send_mac_in_ua {
        user_agent_with_mac(base_ua, &normalized_mac)
    } else {
        base_ua.to_string()
    };
    let (body, status, redirects, ua_used) =
        do_fetch(&client, validated_url.as_str(), &initial_ua, None)?;
    retry_log.push(format!(
        "Request: UA {} → status {}",
        if send_mac_in_ua {
            format!("with MAC {}", mac_with_colons(&normalized_mac))
        } else {
            "without MAC".to_string()
        },
        status
    ));

    // Optional retry: if user had MAC in UA and server returns 403/404, retry without MAC (some servers expect UA without MAC)
    let (body, status, redirects, ua_used) = if send_mac_in_ua
        && (status == 403 || status == 404)
        && !body.is_empty()
        && body.len() < 500
    {
        retry_log.push("Retrying with UA without MAC".to_string());
        match do_fetch(&client, validated_url.as_str(), base_ua, None) {
            Ok((b, s, r, u)) => {
                retry_log.push(format!("Attempt 2: UA without MAC → status {}", s));
                (b, s, r, u)
            }
            Err(e) => {
                retry_log.push(format!("Attempt 2 failed: {}", e));
                (body, status, redirects, ua_used)
            }
        }
    } else {
        (body, status, redirects, ua_used)
    };

    let parseable = looks_parseable(&body);
    let parsed = if parseable {
        if vendor == "poly" || looks_poly_xml(&body) {
            parse_poly_cfg(&body).or_else(|| parse_yealink_cfg(&body))
        } else {
            parse_yealink_cfg(&body)
        }
    } else {
        None
    };

    let request_info = RequestInfo {
        final_url: validated_url.to_string(),
        user_agent: ua_used,
        mac_used: normalized_mac,
        status,
        redirects: if redirects.is_empty() {
            None
        } else {
            Some(redirects)
        },
        retry_log: Some(retry_log),
    };

    Ok(FetchProvisionResult {
        raw: body,
        parsed,
        request_info,
        parseable,
    })
}

/// Fetch a URL (e.g. mac-contact.file) and return the response body as text.
/// Used by Provision Viewer to load and display linked files (e.g. Yealink contacts).
/// If user_agent is provided (e.g. same as provision request), use it — many servers return 403/500 otherwise.
/// Falls back to the app's configured user agent from Settings.
#[command]
#[tracing::instrument(skip_all)]
pub fn fetch_url(url: String, user_agent: Option<String>) -> Result<String, String> {
    use crate::core::user_agent;

    let url = url.trim();
    if url.is_empty() {
        return Err("URL is empty".to_string());
    }
    let validated_url = validate_fetch_url(url)?;
    let ua = user_agent
        .as_deref()
        .and_then(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
        .unwrap_or_else(|| user_agent::get_effective_user_agent());
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client build failed: {}", e))?;
    let response = client
        .get(validated_url)
        .header("User-Agent", &ua)
        .send()
        .map_err(|e| format!("Request failed: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    let body = response
        .bytes()
        .map_err(|e| format!("Reading body failed: {}", e))?;
    const MAX_FETCH_BYTES: usize = 2 * 1024 * 1024;
    if body.len() > MAX_FETCH_BYTES {
        return Err("Response too large (max 2MB)".to_string());
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// Fetch a URL as binary and return the content as a base64 data URL.
/// Used for loading images (wallpapers, etc.) that can't be fetched from the frontend due to CORS.
#[command]
#[tracing::instrument(skip_all)]
pub fn fetch_image_base64(url: String, user_agent: Option<String>) -> Result<String, String> {
    use crate::core::user_agent;
    use base64::{engine::general_purpose::STANDARD, Engine};

    let url = url.trim();
    if url.is_empty() {
        return Err("URL is empty".to_string());
    }
    let validated_url = validate_fetch_url(url)?;
    let ua = user_agent
        .as_deref()
        .and_then(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
        .unwrap_or_else(|| user_agent::get_effective_user_agent());
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client build failed: {}", e))?;
    let response = client
        .get(validated_url)
        .header("User-Agent", &ua)
        .send()
        .map_err(|e| format!("Request failed: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    // Determine content type
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    // Only allow image types
    if !content_type.starts_with("image/") {
        return Err(format!("Not an image: {}", content_type));
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("Reading body failed: {}", e))?;
    const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image too large (max 10MB)".to_string());
    }
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

fn do_fetch(
    client: &reqwest::blocking::Client,
    url: &str,
    user_agent: &str,
    _mac_in_ua: Option<&str>,
) -> Result<(String, u16, Vec<String>, String), String> {
    let ua = user_agent.to_string();
    let request = client.get(url).header("User-Agent", &ua);

    let response = request
        .send()
        .map_err(|e| format!("Request failed: {}", e))?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let body_bytes = response
        .bytes()
        .map_err(|e| format!("Reading body failed: {}", e))?;
    const MAX_PROVISION_BYTES: usize = 2 * 1024 * 1024;
    if body_bytes.len() > MAX_PROVISION_BYTES {
        return Err("Provision file too large (max 2MB)".to_string());
    }
    let body = String::from_utf8_lossy(&body_bytes).into_owned();
    // reqwest doesn't expose full redirect chain; record [requested, final] when they differ
    let redirect_list: Vec<String> = if final_url != url {
        vec![url.to_string(), final_url]
    } else {
        vec![]
    };

    Ok((body, status, redirect_list, ua))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_mac() {
        assert_eq!(normalize_mac("00:15:65:74:B1:50").unwrap(), "00156574b150");
        assert_eq!(normalize_mac("00156574b150").unwrap(), "00156574b150");
        assert!(normalize_mac("00-15-65-74-B1-50").unwrap() == "00156574b150");
        assert!(normalize_mac("001").is_err());
        assert!(normalize_mac("gg156574b150").is_err());
    }

    #[test]
    fn test_build_url() {
        assert_eq!(
            build_provision_url("https://prov.example.com/yealink/{mac}.cfg", "00156574b150"),
            "https://prov.example.com/yealink/00156574b150.cfg"
        );
        assert_eq!(
            build_provision_url("https://prov.example.com/yealink/", "00156574b150"),
            "https://prov.example.com/yealink/00156574b150.cfg"
        );
        assert_eq!(
            build_provision_url("https://prov.example.com/yealink/mac.cfg", "00156574b150"),
            "https://prov.example.com/yealink/00156574b150.cfg"
        );
    }

    #[test]
    fn test_parse_cfg() {
        let cfg = "static.foo = 1\n# comment\naccount.1.label = Test\nstatic.bar = 2\n";
        let p = parse_yealink_cfg(cfg).unwrap();
        assert_eq!(p.entries.len(), 3);
        assert!(p.groups.contains_key("static."));
        assert!(p.groups.contains_key("account."));
    }

    #[test]
    fn test_mac_with_colons() {
        assert_eq!(mac_with_colons("00156574b150"), "00:15:65:74:b1:50");
        assert_eq!(mac_with_colons("aabbccddeeff"), "aa:bb:cc:dd:ee:ff");
    }

    #[test]
    fn test_user_agent_with_mac() {
        let ua = user_agent_with_mac("Yealink SIP-T46G 28.81.0.25", "00156574b150");
        assert_eq!(ua, "Yealink SIP-T46G 28.81.0.25 00:15:65:74:b1:50");
    }
}
