//! Full DNS record type lookups — A, AAAA, SRV, NAPTR, MX, TXT, CNAME, NS, SOA, PTR, CAA, TLSA.

use super::resolver::{self, DnsTransport};
use hickory_resolver::lookup::Lookup;
use hickory_resolver::proto::rr::RecordType;
use serde::{Deserialize, Serialize};
use std::time::Instant;

// ── Config ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsConfig {
    pub domain: String,
    /// If None, resolves all SIP-relevant records (A, AAAA, SRV, NAPTR).
    /// If Some, resolves only the specified record type.
    pub record_type: Option<DnsRecordType>,
    /// Optional custom DNS server IP.
    pub server: Option<String>,
    /// Optional DNS server port (default 53).
    pub port: Option<u16>,
    /// Optional transport (UDP/TCP).
    pub transport: Option<DnsTransport>,
}

// ── Record types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum DnsRecordType {
    A,
    AAAA,
    SRV,
    NAPTR,
    MX,
    TXT,
    CNAME,
    NS,
    SOA,
    PTR,
    CAA,
    TLSA,
    SSHFP,
    HTTPS,
    ANY,
}

impl DnsRecordType {
    pub fn to_hickory(&self) -> RecordType {
        match self {
            DnsRecordType::A => RecordType::A,
            DnsRecordType::AAAA => RecordType::AAAA,
            DnsRecordType::SRV => RecordType::SRV,
            DnsRecordType::NAPTR => RecordType::NAPTR,
            DnsRecordType::MX => RecordType::MX,
            DnsRecordType::TXT => RecordType::TXT,
            DnsRecordType::CNAME => RecordType::CNAME,
            DnsRecordType::NS => RecordType::NS,
            DnsRecordType::SOA => RecordType::SOA,
            DnsRecordType::PTR => RecordType::PTR,
            DnsRecordType::CAA => RecordType::CAA,
            DnsRecordType::TLSA => RecordType::TLSA,
            DnsRecordType::SSHFP => RecordType::SSHFP,
            DnsRecordType::HTTPS => RecordType::HTTPS,
            DnsRecordType::ANY => RecordType::ANY,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            DnsRecordType::A => "A",
            DnsRecordType::AAAA => "AAAA",
            DnsRecordType::SRV => "SRV",
            DnsRecordType::NAPTR => "NAPTR",
            DnsRecordType::MX => "MX",
            DnsRecordType::TXT => "TXT",
            DnsRecordType::CNAME => "CNAME",
            DnsRecordType::NS => "NS",
            DnsRecordType::SOA => "SOA",
            DnsRecordType::PTR => "PTR",
            DnsRecordType::CAA => "CAA",
            DnsRecordType::TLSA => "TLSA",
            DnsRecordType::SSHFP => "SSHFP",
            DnsRecordType::HTTPS => "HTTPS",
            DnsRecordType::ANY => "ANY",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "A" => Some(DnsRecordType::A),
            "AAAA" => Some(DnsRecordType::AAAA),
            "SRV" => Some(DnsRecordType::SRV),
            "NAPTR" => Some(DnsRecordType::NAPTR),
            "MX" => Some(DnsRecordType::MX),
            "TXT" => Some(DnsRecordType::TXT),
            "CNAME" => Some(DnsRecordType::CNAME),
            "NS" => Some(DnsRecordType::NS),
            "SOA" => Some(DnsRecordType::SOA),
            "PTR" => Some(DnsRecordType::PTR),
            "CAA" => Some(DnsRecordType::CAA),
            "TLSA" => Some(DnsRecordType::TLSA),
            "SSHFP" => Some(DnsRecordType::SSHFP),
            "HTTPS" | "SVCB" => Some(DnsRecordType::HTTPS),
            "ANY" | "*" => Some(DnsRecordType::ANY),
            _ => None,
        }
    }
}

// ── Result types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecordSet {
    pub domain: String,
    pub record_type: String,
    pub server: Option<String>,
    pub records: Vec<DnsRecord>,
    pub resolution_ms: f64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    pub name: String,
    pub record_type: String,
    pub ttl: u32,
    pub data: DnsRecordEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum DnsRecordEntry {
    A(String),
    AAAA(String),
    SRV(SrvRecord),
    NAPTR(NaptrRecord),
    MX(MxRecord),
    TXT(TxtRecord),
    CNAME(String),
    NS(String),
    SOA(SoaRecord),
    PTR(String),
    CAA(CaaRecord),
    TLSA(TlsaRecord),
    SSHFP(SshfpRecord),
    HTTPS(String),
    Raw(String),
}

// ── Structured record types ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SrvRecord {
    pub service: String,
    pub priority: u16,
    pub weight: u16,
    pub port: u16,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaptrRecord {
    pub order: u16,
    pub preference: u16,
    pub flags: String,
    pub service: String,
    pub regexp: String,
    pub replacement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MxRecord {
    pub preference: u16,
    pub exchange: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxtRecord {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoaRecord {
    pub mname: String,
    pub rname: String,
    pub serial: u32,
    pub refresh: i32,
    pub retry: i32,
    pub expire: i32,
    pub minimum: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaaRecord {
    pub issuer_critical: bool,
    pub tag: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsaRecord {
    pub cert_usage: u8,
    pub selector: u8,
    pub matching_type: u8,
    pub cert_data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshfpRecord {
    pub algorithm: u8,
    pub fingerprint_type: u8,
    pub fingerprint: String,
}

// ── Lookup function ─────────────────────────────────────────────────────

/// Perform a DNS lookup for the specified domain and record type.
pub async fn lookup_records(config: &DnsConfig) -> DnsRecordSet {
    let start = Instant::now();
    let record_type = config.record_type.unwrap_or(DnsRecordType::A);

    let resolver =
        match resolver::create_resolver(config.server.as_deref(), config.port, config.transport) {
            Ok(r) => r,
            Err(e) => {
                return DnsRecordSet {
                    domain: config.domain.clone(),
                    record_type: record_type.label().to_string(),
                    server: config.server.clone(),
                    records: vec![],
                    resolution_ms: start.elapsed().as_secs_f64() * 1000.0,
                    success: false,
                    error: Some(e),
                };
            }
        };

    let domain = config.domain.trim_end_matches('.');

    // Use specialized methods for certain record types that have dedicated APIs
    let result: Result<Vec<DnsRecord>, String> = match record_type {
        DnsRecordType::A => lookup_a(&resolver, domain).await,
        DnsRecordType::AAAA => lookup_aaaa(&resolver, domain).await,
        DnsRecordType::SRV => lookup_srv(&resolver, domain).await,
        DnsRecordType::MX => lookup_mx(&resolver, domain).await,
        DnsRecordType::TXT => lookup_txt(&resolver, domain).await,
        DnsRecordType::NS => lookup_ns(&resolver, domain).await,
        DnsRecordType::SOA => lookup_soa(&resolver, domain).await,
        DnsRecordType::PTR => lookup_ptr(&resolver, domain).await,
        _ => lookup_generic(&resolver, domain, record_type).await,
    };

    let elapsed = start.elapsed().as_secs_f64() * 1000.0;

    match result {
        Ok(records) => DnsRecordSet {
            domain: config.domain.clone(),
            record_type: record_type.label().to_string(),
            server: config.server.clone(),
            records,
            resolution_ms: elapsed,
            success: true,
            error: None,
        },
        Err(e) => DnsRecordSet {
            domain: config.domain.clone(),
            record_type: record_type.label().to_string(),
            server: config.server.clone(),
            records: vec![],
            resolution_ms: elapsed,
            success: false,
            error: Some(e),
        },
    }
}

// ── Type-specific lookups ───────────────────────────────────────────────

async fn lookup_a(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let response = resolver
        .ipv4_lookup(domain)
        .await
        .map_err(|e| format!("A lookup failed: {}", e))?;

    Ok(response
        .iter()
        .map(|ip| DnsRecord {
            name: domain.to_string(),
            record_type: "A".to_string(),
            ttl: response
                .as_lookup()
                .record_iter()
                .next()
                .map(|r| r.ttl())
                .unwrap_or(0),
            data: DnsRecordEntry::A(ip.to_string()),
        })
        .collect())
}

async fn lookup_aaaa(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let response = resolver
        .ipv6_lookup(domain)
        .await
        .map_err(|e| format!("AAAA lookup failed: {}", e))?;

    Ok(response
        .iter()
        .map(|ip| DnsRecord {
            name: domain.to_string(),
            record_type: "AAAA".to_string(),
            ttl: response
                .as_lookup()
                .record_iter()
                .next()
                .map(|r| r.ttl())
                .unwrap_or(0),
            data: DnsRecordEntry::AAAA(ip.to_string()),
        })
        .collect())
}

async fn lookup_srv(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let response = resolver
        .srv_lookup(domain)
        .await
        .map_err(|e| format!("SRV lookup failed: {}", e))?;

    Ok(response
        .iter()
        .map(|srv| DnsRecord {
            name: domain.to_string(),
            record_type: "SRV".to_string(),
            ttl: response
                .as_lookup()
                .record_iter()
                .next()
                .map(|r| r.ttl())
                .unwrap_or(0),
            data: DnsRecordEntry::SRV(SrvRecord {
                service: domain.to_string(),
                priority: srv.priority(),
                weight: srv.weight(),
                port: srv.port(),
                target: srv.target().to_string().trim_end_matches('.').to_string(),
            }),
        })
        .collect())
}

async fn lookup_mx(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let response = resolver
        .mx_lookup(domain)
        .await
        .map_err(|e| format!("MX lookup failed: {}", e))?;

    Ok(response
        .iter()
        .map(|mx| DnsRecord {
            name: domain.to_string(),
            record_type: "MX".to_string(),
            ttl: response
                .as_lookup()
                .record_iter()
                .next()
                .map(|r| r.ttl())
                .unwrap_or(0),
            data: DnsRecordEntry::MX(MxRecord {
                preference: mx.preference(),
                exchange: mx.exchange().to_string().trim_end_matches('.').to_string(),
            }),
        })
        .collect())
}

async fn lookup_txt(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let response = resolver
        .txt_lookup(domain)
        .await
        .map_err(|e| format!("TXT lookup failed: {}", e))?;

    Ok(response
        .iter()
        .map(|txt| {
            let text = txt
                .iter()
                .map(|chunk| String::from_utf8_lossy(chunk).to_string())
                .collect::<Vec<_>>()
                .join("");
            DnsRecord {
                name: domain.to_string(),
                record_type: "TXT".to_string(),
                ttl: response
                    .as_lookup()
                    .record_iter()
                    .next()
                    .map(|r| r.ttl())
                    .unwrap_or(0),
                data: DnsRecordEntry::TXT(TxtRecord { text }),
            }
        })
        .collect())
}

async fn lookup_ns(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let response = resolver
        .ns_lookup(domain)
        .await
        .map_err(|e| format!("NS lookup failed: {}", e))?;

    Ok(response
        .iter()
        .map(|ns| DnsRecord {
            name: domain.to_string(),
            record_type: "NS".to_string(),
            ttl: response
                .as_lookup()
                .record_iter()
                .next()
                .map(|r| r.ttl())
                .unwrap_or(0),
            data: DnsRecordEntry::NS(ns.to_string().trim_end_matches('.').to_string()),
        })
        .collect())
}

async fn lookup_soa(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let response = resolver
        .soa_lookup(domain)
        .await
        .map_err(|e| format!("SOA lookup failed: {}", e))?;

    Ok(response
        .iter()
        .map(|soa| DnsRecord {
            name: domain.to_string(),
            record_type: "SOA".to_string(),
            ttl: response
                .as_lookup()
                .record_iter()
                .next()
                .map(|r| r.ttl())
                .unwrap_or(0),
            data: DnsRecordEntry::SOA(SoaRecord {
                mname: soa.mname().to_string().trim_end_matches('.').to_string(),
                rname: soa.rname().to_string().trim_end_matches('.').to_string(),
                serial: soa.serial(),
                refresh: soa.refresh(),
                retry: soa.retry(),
                expire: soa.expire(),
                minimum: soa.minimum(),
            }),
        })
        .collect())
}

async fn lookup_ptr(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    // If domain looks like an IP, convert to in-addr.arpa format
    if let Ok(ip) = domain.parse::<std::net::IpAddr>() {
        let response = resolver
            .reverse_lookup(ip)
            .await
            .map_err(|e| format!("PTR lookup failed: {}", e))?;

        return Ok(response
            .iter()
            .map(|name| DnsRecord {
                name: domain.to_string(),
                record_type: "PTR".to_string(),
                ttl: response
                    .as_lookup()
                    .record_iter()
                    .next()
                    .map(|r| r.ttl())
                    .unwrap_or(0),
                data: DnsRecordEntry::PTR(name.to_string().trim_end_matches('.').to_string()),
            })
            .collect());
    }

    // Otherwise do a generic PTR lookup on the domain as given (e.g., already in-addr.arpa)
    lookup_generic(resolver, domain, DnsRecordType::PTR).await
}

/// Generic lookup for record types without dedicated resolver methods.
/// Uses the low-level lookup method with hickory RecordType.
async fn lookup_generic(
    resolver: &hickory_resolver::TokioResolver,
    domain: &str,
    record_type: DnsRecordType,
) -> Result<Vec<DnsRecord>, String> {
    use hickory_resolver::proto::rr::RData;

    let hickory_type = record_type.to_hickory();
    let name = hickory_resolver::proto::rr::Name::from_ascii(domain)
        .map_err(|e| format!("Invalid domain name '{}': {}", domain, e))?;

    let response: Lookup = resolver
        .lookup(name, hickory_type)
        .await
        .map_err(|e| format!("{} lookup failed: {}", record_type.label(), e))?;

    let mut records = Vec::new();
    for record in response.record_iter() {
        let ttl = record.ttl();
        let data = match record.data() {
            RData::A(a) => DnsRecordEntry::A(a.to_string()),
            RData::AAAA(aaaa) => DnsRecordEntry::AAAA(aaaa.to_string()),
            RData::CNAME(cname) => {
                DnsRecordEntry::CNAME(cname.to_string().trim_end_matches('.').to_string())
            }
            RData::NS(ns) => DnsRecordEntry::NS(ns.to_string().trim_end_matches('.').to_string()),
            RData::PTR(ptr) => {
                DnsRecordEntry::PTR(ptr.to_string().trim_end_matches('.').to_string())
            }
            RData::MX(mx) => DnsRecordEntry::MX(MxRecord {
                preference: mx.preference(),
                exchange: mx.exchange().to_string().trim_end_matches('.').to_string(),
            }),
            RData::TXT(txt) => {
                let text = txt
                    .iter()
                    .map(|chunk| String::from_utf8_lossy(chunk).to_string())
                    .collect::<Vec<_>>()
                    .join("");
                DnsRecordEntry::TXT(TxtRecord { text })
            }
            RData::SRV(srv) => DnsRecordEntry::SRV(SrvRecord {
                service: domain.to_string(),
                priority: srv.priority(),
                weight: srv.weight(),
                port: srv.port(),
                target: srv.target().to_string().trim_end_matches('.').to_string(),
            }),
            RData::NAPTR(naptr) => DnsRecordEntry::NAPTR(NaptrRecord {
                order: naptr.order(),
                preference: naptr.preference(),
                flags: String::from_utf8_lossy(naptr.flags()).to_string(),
                service: String::from_utf8_lossy(naptr.services()).to_string(),
                regexp: String::from_utf8_lossy(naptr.regexp()).to_string(),
                replacement: naptr
                    .replacement()
                    .to_string()
                    .trim_end_matches('.')
                    .to_string(),
            }),
            RData::SOA(soa) => DnsRecordEntry::SOA(SoaRecord {
                mname: soa.mname().to_string().trim_end_matches('.').to_string(),
                rname: soa.rname().to_string().trim_end_matches('.').to_string(),
                serial: soa.serial(),
                refresh: soa.refresh(),
                retry: soa.retry(),
                expire: soa.expire(),
                minimum: soa.minimum(),
            }),
            RData::CAA(caa) => {
                #[allow(deprecated)]
                let value = format!("{}", caa.value());
                DnsRecordEntry::CAA(CaaRecord {
                    issuer_critical: caa.issuer_critical(),
                    tag: caa.tag().to_string(),
                    value,
                })
            }
            RData::TLSA(tlsa) => DnsRecordEntry::TLSA(TlsaRecord {
                cert_usage: tlsa.cert_usage().into(),
                selector: tlsa.selector().into(),
                matching_type: tlsa.matching().into(),
                cert_data: hex::encode(tlsa.cert_data()),
            }),
            RData::SSHFP(sshfp) => DnsRecordEntry::SSHFP(SshfpRecord {
                algorithm: sshfp.algorithm().into(),
                fingerprint_type: sshfp.fingerprint_type().into(),
                fingerprint: hex::encode(sshfp.fingerprint()),
            }),
            other => DnsRecordEntry::Raw(format!("{:?}", other)),
        };

        records.push(DnsRecord {
            name: domain.to_string(),
            record_type: record_type.label().to_string(),
            ttl,
            data,
        });
    }

    Ok(records)
}
