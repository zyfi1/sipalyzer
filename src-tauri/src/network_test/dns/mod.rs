pub mod diagnostics;
pub mod geoip;
pub mod pcap_correlation;
pub mod records;
pub mod resolver;
pub mod reverse;
pub mod sip_resolution;

// Re-export commonly used types for backward compatibility
#[allow(unused_imports)]
pub use diagnostics::{DnsFlags, DnsSection, RawDnsRecord, RawDnsResponse};
#[allow(unused_imports)]
pub use geoip::{AsnResult, GeoIpResult};
#[allow(unused_imports)]
pub use pcap_correlation::DnsCorrelation;
#[allow(unused_imports)]
pub use records::{
    CaaRecord, DnsConfig, DnsRecordEntry, DnsRecordSet, DnsRecordType, MxRecord, NaptrRecord,
    SoaRecord, SrvRecord, TxtRecord,
};
#[allow(unused_imports)]
pub use reverse::{FcrDnsResult, ReverseDnsResult};
#[allow(unused_imports)]
pub use sip_resolution::{SipResolutionChain, SipResolutionStep, SipTarget};

/// Legacy run_dns_lookup for backward compatibility with existing commands.
/// Delegates to the new records module.
pub async fn run_dns_lookup(config: LegacyDnsConfig) -> LegacyDnsResult {
    use std::time::Instant;

    let start = Instant::now();
    let domain = config.domain.clone();

    let new_config = DnsConfig {
        domain: domain.clone(),
        record_type: None,
        server: None,
        port: None,
        transport: None,
    };

    // Run A/AAAA lookup
    let a_aaaa = records::lookup_records(&DnsConfig {
        record_type: Some(DnsRecordType::A),
        ..new_config.clone()
    })
    .await;

    let aaaa_config = DnsConfig {
        record_type: Some(DnsRecordType::AAAA),
        ..new_config.clone()
    };
    let aaaa_result = records::lookup_records(&aaaa_config).await;

    // Run SRV lookups for SIP services
    let srv_services = ["_sip._udp", "_sip._tcp", "_sips._tcp"];
    let mut srv_records = Vec::new();
    for service in &srv_services {
        let srv_domain = format!("{}.{}", service, domain);
        let srv_config = DnsConfig {
            domain: srv_domain,
            record_type: Some(DnsRecordType::SRV),
            server: None,
            port: None,
            transport: None,
        };
        let srv_result = records::lookup_records(&srv_config).await;
        if srv_result.success {
            for entry in &srv_result.records {
                if let DnsRecordEntry::SRV(ref r) = entry.data {
                    srv_records.push(records::SrvRecord {
                        service: service.to_string(),
                        priority: r.priority,
                        weight: r.weight,
                        port: r.port,
                        target: r.target.clone(),
                    });
                }
            }
        }
    }

    // Run NAPTR lookup
    let naptr_config = DnsConfig {
        record_type: Some(DnsRecordType::NAPTR),
        ..new_config.clone()
    };
    let naptr_result = records::lookup_records(&naptr_config).await;
    let mut naptr_records = Vec::new();
    if naptr_result.success {
        for entry in &naptr_result.records {
            if let DnsRecordEntry::NAPTR(ref r) = entry.data {
                naptr_records.push(r.clone());
            }
        }
    }

    let elapsed = start.elapsed().as_secs_f64() * 1000.0;

    let mut a_records = Vec::new();
    let mut aaaa_records_vec = Vec::new();

    if a_aaaa.success {
        for entry in &a_aaaa.records {
            if let DnsRecordEntry::A(ip) = &entry.data {
                a_records.push(ip.clone());
            }
        }
    }
    if aaaa_result.success {
        for entry in &aaaa_result.records {
            if let DnsRecordEntry::AAAA(ip) = &entry.data {
                aaaa_records_vec.push(ip.clone());
            }
        }
    }

    let has_error = !a_aaaa.success && !aaaa_result.success;
    let error = if has_error {
        a_aaaa.error.or(aaaa_result.error)
    } else {
        None
    };

    let success = !has_error || !srv_records.is_empty();

    LegacyDnsResult {
        domain: config.domain,
        srv_records,
        naptr_records,
        a_records,
        aaaa_records: aaaa_records_vec,
        resolution_ms: elapsed,
        success,
        error,
    }
}

/// Legacy config for backward compat with existing `network_dns_lookup` command.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LegacyDnsConfig {
    pub domain: String,
}

/// Legacy result type matching the old DnsResult shape for backward compat.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LegacyDnsResult {
    pub domain: String,
    pub srv_records: Vec<SrvRecord>,
    pub naptr_records: Vec<NaptrRecord>,
    pub a_records: Vec<String>,
    pub aaaa_records: Vec<String>,
    pub resolution_ms: f64,
    pub success: bool,
    pub error: Option<String>,
}
