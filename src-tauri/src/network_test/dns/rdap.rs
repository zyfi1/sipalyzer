//! RDAP (Registration Data Access Protocol) enrichment for IP addresses.
//! Uses the IANA RDAP bootstrap service to reach the correct RIR (ARIN, RIPE, APNIC, …)
//! and extracts network holder, allocation type, abuse contacts, and remarks.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GeoIpRdapInfo {
    /// RIR / registry id inferred from the RDAP server (e.g. ARIN, RIPE).
    pub registry: Option<String>,
    /// Announced prefix or start–end range (human-readable).
    pub net_range: Option<String>,
    /// RDAP handle for the inetnum object (e.g. NET-8-8-8-0-2).
    pub net_handle: Option<String>,
    /// Short RDAP name field (often an org / network code).
    pub net_name: Option<String>,
    /// Allocation semantics, e.g. "DIRECT ALLOCATION", "ALLOCATED PA".
    pub allocation_type: Option<String>,
    /// Status flags joined from RDAP (e.g. "active").
    pub status: Option<String>,
    /// Registrant / holder from RDAP entity roles when available.
    pub registrant: Option<String>,
    /// Abuse role contact email when published.
    pub abuse_email: Option<String>,
    /// Registrant or abuse postal label from vCard when available.
    pub org_address: Option<String>,
    /// Classic WHOIS port 43 server from RDAP.
    pub whois_server: Option<String>,
    /// First substantive remarks (truncated for UI).
    pub remarks: Option<String>,
}

fn registry_from_host(host: &str) -> String {
    let h = host.to_ascii_lowercase();
    if h.contains("arin") {
        "ARIN".to_string()
    } else if h.contains("ripe") {
        "RIPE".to_string()
    } else if h.contains("apnic") {
        "APNIC".to_string()
    } else if h.contains("lacnic") {
        "LACNIC".to_string()
    } else if h.contains("afrinic") {
        "AFRINIC".to_string()
    } else {
        host.to_string()
    }
}

fn vcard_props(vcard: &Value) -> Option<&Vec<Value>> {
    vcard.get(1)?.as_array()
}

fn vcard_text_line(props: &[Value], key: &str) -> Option<String> {
    for item in props {
        let arr = item.as_array()?;
        if arr.first()?.as_str()? != key {
            continue;
        }
        return match arr.get(3) {
            Some(Value::String(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Some(Value::Array(parts)) => {
                let joined = parts
                    .iter()
                    .filter_map(|p| p.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                if joined.is_empty() {
                    None
                } else {
                    Some(joined)
                }
            }
            _ => None,
        };
    }
    None
}

fn vcard_address_label(props: &[Value]) -> Option<String> {
    for item in props {
        let arr = item.as_array()?;
        if arr.first()?.as_str()? != "adr" {
            continue;
        }
        if let Some(params) = arr.get(1).and_then(|x| x.as_object()) {
            if let Some(label) = params.get("label").and_then(|x| x.as_str()) {
                let compact = label
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .collect::<Vec<_>>()
                    .join(", ");
                if !compact.is_empty() {
                    return Some(compact);
                }
            }
        }
    }
    None
}

fn roles_include(roles: &Value, needle: &str) -> bool {
    roles
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .any(|r| r.eq_ignore_ascii_case(needle))
        })
        .unwrap_or(false)
}

fn extract_from_entity(
    entity: &Value,
    registrant: &mut Option<String>,
    abuse_email: &mut Option<String>,
    org_addr: &mut Option<String>,
) {
    let roles = entity.get("roles").cloned().unwrap_or(Value::Null);
    let vcard = entity.get("vcardArray");
    let Some(vcard) = vcard else {
        return;
    };
    let Some(props) = vcard_props(vcard) else {
        return;
    };

    if roles_include(&roles, "registrant") && registrant.is_none() {
        if let Some(fn_) = vcard_text_line(props, "fn") {
            *registrant = Some(fn_);
        }
        if org_addr.is_none() {
            if let Some(addr) = vcard_address_label(props) {
                *org_addr = Some(addr);
            }
        }
    }

    if roles_include(&roles, "abuse") {
        if abuse_email.is_none() {
            if let Some(em) = vcard_text_line(props, "email") {
                *abuse_email = Some(em);
            }
        }
        if org_addr.is_none() {
            if let Some(addr) = vcard_address_label(props) {
                *org_addr = Some(addr);
            }
        }
    }
}

fn walk_entities(
    value: &Value,
    registrant: &mut Option<String>,
    abuse_email: &mut Option<String>,
    org_addr: &mut Option<String>,
) {
    if let Some(arr) = value.get("entities").and_then(|e| e.as_array()) {
        for ent in arr {
            extract_from_entity(ent, registrant, abuse_email, org_addr);
            walk_entities(ent, registrant, abuse_email, org_addr);
        }
    }
}

fn rdap_type_string(v: &Value) -> Option<String> {
    match v.get("type")? {
        Value::String(s) => Some(s.trim().to_string()),
        Value::Array(a) => {
            let joined = a
                .iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            if joined.is_empty() {
                None
            } else {
                Some(joined)
            }
        }
        _ => None,
    }
}

fn rdap_status_string(v: &Value) -> Option<String> {
    let arr = v.get("status")?.as_array()?;
    let joined = arr
        .iter()
        .filter_map(|x| x.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn collect_remarks(v: &Value, max_chars: usize) -> Option<String> {
    let mut out = String::new();
    if let Some(arr) = v.get("remarks").and_then(|r| r.as_array()) {
        for remark in arr {
            if let Some(desc) = remark.get("description").and_then(|d| d.as_array()) {
                for line in desc.iter().filter_map(|x| x.as_str()) {
                    let t = line.trim();
                    if t.is_empty() {
                        continue;
                    }
                    if !out.is_empty() {
                        out.push_str(" · ");
                    }
                    out.push_str(t);
                    if out.len() >= max_chars {
                        out.truncate(max_chars.saturating_sub(1));
                        out.push('…');
                        return Some(out);
                    }
                }
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn cidr_summary(v: &Value) -> Option<String> {
    if let Some(cidrs) = v.get("cidr0_cidrs").and_then(|c| c.as_array()) {
        let mut parts = Vec::new();
        for c in cidrs {
            let prefix = c.get("v4prefix").and_then(|x| x.as_str());
            let len = c.get("length");
            match (prefix, len) {
                (Some(p), Some(Value::Number(n))) => {
                    if let Some(l) = n.as_u64() {
                        parts.push(format!("{p}/{l}"));
                    }
                }
                (Some(p), _) => parts.push(p.to_string()),
                _ => {}
            }
        }
        if !parts.is_empty() {
            return Some(parts.join(", "));
        }
    }
    let start = v.get("startAddress").and_then(|x| x.as_str())?;
    let end = v.get("endAddress").and_then(|x| x.as_str())?;
    Some(format!("{start} – {end}"))
}

/// Fetch and parse RDAP data for a public IP (IPv4 or IPv6).
pub async fn enrich_ip(ip: &str) -> Option<GeoIpRdapInfo> {
    let client = reqwest::Client::builder()
        .user_agent("SIPalyzer/1.0 (+https://github.com/zyfi1/sipalyzer)")
        .redirect(reqwest::redirect::Policy::limited(12))
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;

    let url = format!("https://rdap-bootstrap.arin.net/bootstrap/ip/{ip}");
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        tracing::debug!("RDAP HTTP {} for {}", resp.status(), ip);
        return None;
    }
    let final_url = resp.url().clone();
    let registry = final_url
        .host_str()
        .map(registry_from_host)
        .unwrap_or_else(|| "RDAP".to_string());

    let v: Value = resp.json().await.ok()?;

    let net_range = cidr_summary(&v).or_else(|| {
        let s = v.get("startAddress").and_then(|x| x.as_str())?;
        let e = v.get("endAddress").and_then(|x| x.as_str())?;
        Some(format!("{s} – {e}"))
    });

    let net_handle = v
        .get("handle")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let net_name = v
        .get("name")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let allocation_type = rdap_type_string(&v);
    let status = rdap_status_string(&v);
    let whois_server = v
        .get("port43")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    let mut registrant = None;
    let mut abuse_email = None;
    let mut org_address = None;
    walk_entities(&v, &mut registrant, &mut abuse_email, &mut org_address);

    let remarks = collect_remarks(&v, 900);

    let empty = registrant.is_none()
        && abuse_email.is_none()
        && net_range.is_none()
        && net_handle.is_none()
        && remarks.is_none();
    if empty {
        return None;
    }

    Some(GeoIpRdapInfo {
        registry: Some(registry),
        net_range,
        net_handle,
        net_name,
        allocation_type,
        status,
        registrant,
        abuse_email,
        org_address,
        whois_server,
        remarks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_rdap_json() {
        let sample = r#"{
            "handle":"NET-TEST","name":"EXAMPLE","type":"DIRECT ALLOCATION",
            "startAddress":"8.8.8.0","endAddress":"8.8.8.255",
            "cidr0_cidrs":[{"v4prefix":"8.8.8.0","length":24}],
            "entities":[{
                "roles":["registrant"],
                "vcardArray":["vcard",[
                    ["fn",{},"text","Example Networks"],
                    ["adr",{"label":"1 Main St\nUS"},"text",["","","","","","",""]]
                ]]
            }]
        }"#;
        let v: Value = serde_json::from_str(sample).unwrap();
        let range = cidr_summary(&v).expect("cidr");
        assert!(range.contains("8.8.8.0/24"));
        let mut r = None;
        let mut a = None;
        let mut o = None;
        walk_entities(&v, &mut r, &mut a, &mut o);
        assert_eq!(r.as_deref(), Some("Example Networks"));
        assert!(o.is_some());
    }
}
