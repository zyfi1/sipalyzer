//! GeoIP enrichment — HTTPS geolocation (ipwho.is) + optional RDAP (WHOIS-style registry data)
//! + Cymru DNS ASN fallback.

use super::rdap::{self, GeoIpRdapInfo};
use super::resolver;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

// ── Rate limiting ───────────────────────────────────────────────────────

static LAST_API_CALL_MS: AtomicU64 = AtomicU64::new(0);
const MIN_INTERVAL_MS: u64 = 1400; // ~45 req/min

fn can_call_api() -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let last = LAST_API_CALL_MS.load(Ordering::Relaxed);
    if now - last >= MIN_INTERVAL_MS {
        LAST_API_CALL_MS.store(now, Ordering::Relaxed);
        true
    } else {
        false
    }
}

fn is_non_routable_for_rdap(ip: &str) -> bool {
    let Ok(addr) = ip.parse::<IpAddr>() else {
        return true;
    };
    match addr {
        IpAddr::V4(a) => {
            a.is_private()
                || a.is_loopback()
                || a.is_link_local()
                || a.is_broadcast()
                || a.is_documentation()
                || a.is_unspecified()
        }
        IpAddr::V6(a) => {
            a.is_loopback()
                || a.is_unspecified()
                || a.is_unique_local()
                || a.is_unicast_link_local()
                || a.is_multicast()
        }
    }
}

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoIpResult {
    pub ip: String,
    pub success: bool,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub isp: Option<String>,
    pub org: Option<String>,
    pub asn: Option<String>,
    pub timezone: Option<String>,
    pub source: String,
    pub error: Option<String>,
    /// Continent name from geolocation provider (e.g. North America).
    pub continent: Option<String>,
    /// ISO continent code when available (e.g. NA).
    pub continent_code: Option<String>,
    /// Postal / ZIP from provider when available.
    pub postal: Option<String>,
    /// Provider region code (e.g. US state code).
    pub region_code: Option<String>,
    /// Network operator domain from provider (e.g. amazon.com).
    pub connection_domain: Option<String>,
    /// Provider connection category when present (e.g. hosting, business, education).
    pub connection_class: Option<String>,
    /// IPv4 / IPv6 from provider.
    pub ip_kind: Option<String>,
    /// RDAP-derived registry / WHOIS-style network intelligence.
    pub rdap: Option<GeoIpRdapInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsnResult {
    pub ip: String,
    pub asn: Option<String>,
    pub cidr: Option<String>,
    pub country_code: Option<String>,
    pub registry: Option<String>,
    pub org_name: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchGeoIpResult {
    pub results: Vec<GeoIpResult>,
    pub total_ms: f64,
}

// ── HTTPS provider response (ipwho.is) ──────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IpWhoIsConnection {
    isp: Option<String>,
    org: Option<String>,
    asn: Option<serde_json::Value>,
    domain: Option<String>,
    #[serde(rename = "type")]
    connection_class: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IpWhoIsTimezone {
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IpWhoIsResponse {
    success: bool,
    #[serde(rename = "type")]
    ip_kind: Option<String>,
    continent: Option<String>,
    continent_code: Option<String>,
    country: Option<String>,
    country_code: Option<String>,
    region: Option<String>,
    region_code: Option<String>,
    city: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    postal: Option<String>,
    timezone: Option<IpWhoIsTimezone>,
    connection: Option<IpWhoIsConnection>,
    message: Option<String>,
}

fn normalize_asn(value: Option<&serde_json::Value>) -> Option<String> {
    value.and_then(|raw| match raw {
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else if trimmed.to_ascii_uppercase().starts_with("AS") {
                Some(trimmed.to_string())
            } else {
                Some(format!("AS{}", trimmed))
            }
        }
        serde_json::Value::Number(n) => Some(format!("AS{}", n)),
        _ => None,
    })
}

fn merge_rdap(result: &mut GeoIpResult, rdap: Option<GeoIpRdapInfo>) {
    if let Some(info) = rdap {
        // Prefer RDAP registrant as org hint when provider org is empty.
        if result.org.is_none() {
            result.org = info.registrant.clone();
        }
        result.rdap = Some(info);
    }
}

async fn geoip_lookup_https(ip: &str) -> Result<GeoIpResult, String> {
    let url = format!("https://ipwho.is/{}", ip);
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTPS GeoIP request failed: {}", e))?;
    let data = response
        .json::<IpWhoIsResponse>()
        .await
        .map_err(|e| format!("HTTPS GeoIP JSON parse error: {}", e))?;

    if !data.success {
        return Ok(geoip_error(
            ip,
            data.message
                .as_deref()
                .unwrap_or("GeoIP provider returned an unsuccessful response"),
        ));
    }

    let conn = data.connection.as_ref();
    Ok(GeoIpResult {
        ip: ip.to_string(),
        success: true,
        country: data.country,
        country_code: data.country_code,
        region: data.region,
        city: data.city,
        lat: data.latitude,
        lon: data.longitude,
        isp: conn.and_then(|c| c.isp.clone()),
        org: conn.and_then(|c| c.org.clone()),
        asn: normalize_asn(conn.and_then(|c| c.asn.as_ref())),
        timezone: data.timezone.and_then(|tz| tz.id),
        source: "ipwho.is".to_string(),
        error: None,
        continent: data.continent,
        continent_code: data.continent_code,
        postal: data.postal,
        region_code: data.region_code,
        connection_domain: conn.and_then(|c| c.domain.clone()),
        connection_class: conn.and_then(|c| c.connection_class.clone()),
        ip_kind: data.ip_kind,
        rdap: None,
    })
}

// ── Primary: HTTPS provider + parallel RDAP ─────────────────────────────

/// Look up GeoIP info for a single IP using an HTTPS provider plus RDAP when applicable.
pub async fn geoip_lookup(ip: &str) -> GeoIpResult {
    let skip_rdap = is_non_routable_for_rdap(ip);
    let rdap_fut = async {
        if skip_rdap {
            None
        } else {
            rdap::enrich_ip(ip).await
        }
    };

    if !can_call_api() {
        let (mut result, rdap_opt) = tokio::join!(geoip_from_asn(ip), rdap_fut);
        merge_rdap(&mut result, rdap_opt);
        return result;
    }

    let (ipwho, rdap_opt) = tokio::join!(geoip_lookup_https(ip), rdap_fut);

    match ipwho {
        Ok(mut result) => {
            merge_rdap(&mut result, rdap_opt);
            result
        }
        Err(e) => {
            tracing::error!(
                "HTTPS GeoIP request failed for {}: {}, falling back to DNS",
                ip,
                e
            );
            let mut result = geoip_from_asn(ip).await;
            merge_rdap(&mut result, rdap_opt);
            result
        }
    }
}

/// Batch GeoIP lookup using HTTPS provider only (no RDAP — keeps latency predictable).
pub async fn geoip_batch(ips: Vec<String>) -> BatchGeoIpResult {
    let start = Instant::now();
    let mut all_results = Vec::new();
    for ip in ips {
        while !can_call_api() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        match geoip_lookup_https(&ip).await {
            Ok(result) => all_results.push(result),
            Err(_) => all_results.push(geoip_from_asn(&ip).await),
        };
    }

    BatchGeoIpResult {
        results: all_results,
        total_ms: start.elapsed().as_secs_f64() * 1000.0,
    }
}

// ── Fallback: DNS-based Cymru ASN lookup ────────────────────────────────

/// Cymru ASN lookup via DNS TXT records (no HTTP needed).
pub async fn cymru_asn_lookup(ip: &str) -> AsnResult {
    let resolver = match resolver::create_fast_resolver(None, None) {
        Ok(r) => r,
        Err(e) => {
            return AsnResult {
                ip: ip.to_string(),
                asn: None,
                cidr: None,
                country_code: None,
                registry: None,
                org_name: None,
                success: false,
                error: Some(e),
            };
        }
    };

    // Reverse the IP octets for Cymru query
    let reversed = match reverse_ip_for_cymru(ip) {
        Some(r) => r,
        None => {
            return AsnResult {
                ip: ip.to_string(),
                asn: None,
                cidr: None,
                country_code: None,
                registry: None,
                org_name: None,
                success: false,
                error: Some("Invalid IP address format".to_string()),
            };
        }
    };

    // Query origin.asn.cymru.com for ASN info
    let origin_domain = format!("{}.origin.asn.cymru.com", reversed);
    let (asn, cidr, country_code, registry) = match resolver.txt_lookup(&origin_domain).await {
        Ok(txt) => {
            let text: String = txt
                .iter()
                .next()
                .map(|t| {
                    t.iter()
                        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
                        .collect::<Vec<_>>()
                        .join("")
                })
                .unwrap_or_default();
            parse_cymru_origin(&text)
        }
        Err(_) => (None, None, None, None),
    };

    // Query AS{number}.asn.cymru.com for org name
    let org_name = if let Some(ref asn_num) = asn {
        let asn_domain = format!("AS{}.asn.cymru.com", asn_num);
        match resolver.txt_lookup(&asn_domain).await {
            Ok(txt) => {
                let text: String = txt
                    .iter()
                    .next()
                    .map(|t| {
                        t.iter()
                            .map(|chunk| String::from_utf8_lossy(chunk).to_string())
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .unwrap_or_default();
                parse_cymru_asn_org(&text)
            }
            Err(_) => None,
        }
    } else {
        None
    };

    AsnResult {
        ip: ip.to_string(),
        asn,
        cidr,
        country_code,
        registry,
        org_name,
        success: true,
        error: None,
    }
}

/// Convert GeoIP from ASN-only DNS fallback.
async fn geoip_from_asn(ip: &str) -> GeoIpResult {
    let asn = cymru_asn_lookup(ip).await;

    GeoIpResult {
        ip: ip.to_string(),
        success: asn.success && asn.asn.is_some(),
        country: None,
        country_code: asn.country_code.clone(),
        region: None,
        city: None,
        lat: None,
        lon: None,
        isp: None,
        org: asn.org_name.clone(),
        asn: asn.asn.map(|a| format!("AS{}", a)),
        timezone: None,
        source: "cymru-dns".to_string(),
        error: asn.error,
        continent: None,
        continent_code: None,
        postal: None,
        region_code: None,
        connection_domain: None,
        connection_class: None,
        ip_kind: None,
        rdap: None,
    }
}

fn geoip_error(ip: &str, error: &str) -> GeoIpResult {
    GeoIpResult {
        ip: ip.to_string(),
        success: false,
        country: None,
        country_code: None,
        region: None,
        city: None,
        lat: None,
        lon: None,
        isp: None,
        org: None,
        asn: None,
        timezone: None,
        source: "error".to_string(),
        error: Some(error.to_string()),
        continent: None,
        continent_code: None,
        postal: None,
        region_code: None,
        connection_domain: None,
        connection_class: None,
        ip_kind: None,
        rdap: None,
    }
}

/// Reverse IP octets for Cymru DNS lookup (e.g., "1.2.3.4" -> "4.3.2.1").
fn reverse_ip_for_cymru(ip: &str) -> Option<String> {
    if let Ok(addr) = ip.parse::<std::net::Ipv4Addr>() {
        let octets = addr.octets();
        Some(format!(
            "{}.{}.{}.{}",
            octets[3], octets[2], octets[1], octets[0]
        ))
    } else if let Ok(addr) = ip.parse::<std::net::Ipv6Addr>() {
        // IPv6 reverse: expand to full form, reverse nibbles
        let segments = addr.segments();
        let mut nibbles = Vec::new();
        for seg in segments.iter().rev() {
            nibbles.push(format!("{:x}", seg & 0xF));
            nibbles.push(format!("{:x}", (seg >> 4) & 0xF));
            nibbles.push(format!("{:x}", (seg >> 8) & 0xF));
            nibbles.push(format!("{:x}", (seg >> 12) & 0xF));
        }
        Some(nibbles.join("."))
    } else {
        None
    }
}

/// Parse Cymru origin TXT record: "AS# | CIDR | CC | registry | date"
fn parse_cymru_origin(
    text: &str,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let parts: Vec<&str> = text.split('|').map(|s| s.trim()).collect();
    (
        parts.first().and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        }),
        parts.get(1).and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        }),
        parts.get(2).and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        }),
        parts.get(3).and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        }),
    )
}

/// Parse Cymru ASN TXT record for the org name (last pipe-separated field).
fn parse_cymru_asn_org(text: &str) -> Option<String> {
    let parts: Vec<&str> = text.split('|').map(|s| s.trim()).collect();
    parts.last().and_then(|s| {
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    })
}
