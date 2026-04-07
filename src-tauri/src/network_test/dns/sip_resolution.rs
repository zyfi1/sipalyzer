//! RFC 3263 SIP DNS resolution: NAPTR -> SRV -> A/AAAA chain.
//!
//! Implements the full SIP URI resolution procedure:
//! 1. Query NAPTR for the domain to determine transport preferences
//! 2. Use NAPTR replacement fields to query SRV records
//! 3. Resolve SRV targets to A/AAAA addresses
//! 4. Fall back gracefully at each step per RFC 3263 section 4.1

use super::records::{self, DnsConfig, DnsRecordEntry, DnsRecordType, NaptrRecord};
use serde::{Deserialize, Serialize};
use std::time::Instant;

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipResolutionConfig {
    pub domain: String,
    pub server: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipResolutionChain {
    pub domain: String,
    pub steps: Vec<SipResolutionStep>,
    pub targets: Vec<SipTarget>,
    pub total_ms: f64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipResolutionStep {
    pub step_type: String,
    pub query: String,
    pub record_type: String,
    pub records_found: u32,
    pub resolution_ms: f64,
    pub details: Vec<StepDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepDetail {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipTarget {
    pub transport: String,
    pub host: String,
    pub port: u16,
    pub priority: u16,
    pub weight: u16,
    pub ip_addresses: Vec<String>,
}

// ── SIP transport preference from NAPTR service field ───────────────────

fn parse_naptr_transport(service: &str) -> Option<(&'static str, &'static str)> {
    let s = service.to_uppercase();
    // RFC 3263 / RFC 3761 NAPTR service fields for SIP
    if s.contains("SIPS+D2T") {
        Some(("TLS", "_sips._tcp"))
    } else if s.contains("SIP+D2T") {
        Some(("TCP", "_sip._tcp"))
    } else if s.contains("SIP+D2U") {
        Some(("UDP", "_sip._udp"))
    } else if s.contains("SIP+D2S") {
        Some(("SCTP", "_sip._sctp"))
    } else if s.contains("SIPS+D2W") {
        Some(("WSS", "_sips._wss"))
    } else if s.contains("SIP+D2W") {
        Some(("WS", "_sip._ws"))
    } else {
        None
    }
}

// ── Main resolution function ────────────────────────────────────────────

/// Run the full RFC 3263 SIP DNS resolution chain.
#[tracing::instrument(skip_all, fields(domain = %config.domain), name = "dns.sip_resolve")]
pub async fn resolve_sip_domain(config: SipResolutionConfig) -> SipResolutionChain {
    let total_start = Instant::now();
    let domain = config.domain.clone();
    let mut steps = Vec::new();
    let mut targets: Vec<SipTarget> = Vec::new();

    // Step 1: NAPTR lookup
    let naptr_start = Instant::now();
    tracing::info!(domain = %domain, "NAPTR lookup");
    let naptr_result = {
        let naptr_config = DnsConfig {
            domain: domain.clone(),
            record_type: Some(DnsRecordType::NAPTR),
            server: config.server.clone(),
            port: config.port,
            transport: None,
        };
        records::lookup_records(&naptr_config).await
    };
    let naptr_ms = naptr_start.elapsed().as_secs_f64() * 1000.0;

    let mut naptr_entries: Vec<(NaptrRecord, &'static str, &'static str)> = Vec::new();
    let mut naptr_details = Vec::new();

    if naptr_result.success {
        for rec in &naptr_result.records {
            if let DnsRecordEntry::NAPTR(ref naptr) = rec.data {
                if let Some((transport, srv_prefix)) = parse_naptr_transport(&naptr.service) {
                    naptr_details.push(StepDetail {
                        label: format!("Order {} Pref {}", naptr.order, naptr.preference),
                        value: format!(
                            "{} -> {} (flags={}, replacement={})",
                            naptr.service, transport, naptr.flags, naptr.replacement
                        ),
                    });
                    naptr_entries.push((naptr.clone(), transport, srv_prefix));
                }
            }
        }
        // Sort by order, then preference
        naptr_entries.sort_by(|a, b| {
            a.0.order
                .cmp(&b.0.order)
                .then(a.0.preference.cmp(&b.0.preference))
        });
    }

    steps.push(SipResolutionStep {
        step_type: "NAPTR".to_string(),
        query: domain.clone(),
        record_type: "NAPTR".to_string(),
        records_found: naptr_entries.len() as u32,
        resolution_ms: naptr_ms,
        details: naptr_details,
    });

    // Step 2: SRV lookups
    let srv_queries: Vec<(String, &'static str)> = if naptr_entries.is_empty() {
        // Fallback: no NAPTR, try standard SIP SRV prefixes per RFC 3263 section 4.1
        vec![
            (format!("_sips._tcp.{}", domain), "TLS"),
            (format!("_sip._tcp.{}", domain), "TCP"),
            (format!("_sip._udp.{}", domain), "UDP"),
        ]
    } else {
        naptr_entries
            .iter()
            .map(|(naptr, transport, srv_prefix)| {
                let srv_domain = if naptr.replacement.is_empty() || naptr.replacement == "." {
                    format!("{}.{}", srv_prefix, domain)
                } else {
                    naptr.replacement.clone()
                };
                (srv_domain, *transport)
            })
            .collect()
    };

    for (srv_domain, transport) in &srv_queries {
        let srv_start = Instant::now();
        tracing::info!(domain = %srv_domain, "SRV lookup");
        let srv_result = {
            let srv_config = DnsConfig {
                domain: srv_domain.clone(),
                record_type: Some(DnsRecordType::SRV),
                server: config.server.clone(),
                port: config.port,
                transport: None,
            };
            records::lookup_records(&srv_config).await
        };
        let srv_ms = srv_start.elapsed().as_secs_f64() * 1000.0;

        let mut srv_details = Vec::new();
        let mut srv_count = 0u32;

        if srv_result.success {
            for rec in &srv_result.records {
                if let DnsRecordEntry::SRV(ref srv) = rec.data {
                    srv_count += 1;
                    srv_details.push(StepDetail {
                        label: format!("pri={} w={}", srv.priority, srv.weight),
                        value: format!("{}:{}", srv.target, srv.port),
                    });

                    tracing::info!(target = %srv.target, "Resolving SRV target to A/AAAA");
                    let a_start = Instant::now();
                    let mut ip_addresses = Vec::new();
                    let mut addr_details = Vec::new();

                    // Try A records
                    let a_config = DnsConfig {
                        domain: srv.target.clone(),
                        record_type: Some(DnsRecordType::A),
                        server: config.server.clone(),
                        port: config.port,
                        transport: None,
                    };
                    let a_result = records::lookup_records(&a_config).await;
                    if a_result.success {
                        for arec in &a_result.records {
                            if let DnsRecordEntry::A(ip) = &arec.data {
                                ip_addresses.push(ip.clone());
                                addr_details.push(StepDetail {
                                    label: "A".to_string(),
                                    value: ip.clone(),
                                });
                            }
                        }
                    }

                    // Try AAAA records
                    let aaaa_config = DnsConfig {
                        domain: srv.target.clone(),
                        record_type: Some(DnsRecordType::AAAA),
                        server: config.server.clone(),
                        port: config.port,
                        transport: None,
                    };
                    let aaaa_result = records::lookup_records(&aaaa_config).await;
                    if aaaa_result.success {
                        for arec in &aaaa_result.records {
                            if let DnsRecordEntry::AAAA(ip) = &arec.data {
                                ip_addresses.push(ip.clone());
                                addr_details.push(StepDetail {
                                    label: "AAAA".to_string(),
                                    value: ip.clone(),
                                });
                            }
                        }
                    }

                    let a_ms = a_start.elapsed().as_secs_f64() * 1000.0;

                    if !addr_details.is_empty() {
                        steps.push(SipResolutionStep {
                            step_type: "A/AAAA".to_string(),
                            query: srv.target.clone(),
                            record_type: "A/AAAA".to_string(),
                            records_found: addr_details.len() as u32,
                            resolution_ms: a_ms,
                            details: addr_details,
                        });
                    }

                    targets.push(SipTarget {
                        transport: transport.to_string(),
                        host: srv.target.clone(),
                        port: srv.port,
                        priority: srv.priority,
                        weight: srv.weight,
                        ip_addresses,
                    });
                }
            }
        }

        steps.push(SipResolutionStep {
            step_type: "SRV".to_string(),
            query: srv_domain.clone(),
            record_type: "SRV".to_string(),
            records_found: srv_count,
            resolution_ms: srv_ms,
            details: srv_details,
        });
    }

    // Fallback: if no SRV records found at all, try direct A/AAAA with default port
    if targets.is_empty() {
        let a_start = Instant::now();
        let mut ip_addresses = Vec::new();
        let mut fallback_details = Vec::new();

        let a_config = DnsConfig {
            domain: domain.clone(),
            record_type: Some(DnsRecordType::A),
            server: config.server.clone(),
            port: config.port,
            transport: None,
        };
        let a_result = records::lookup_records(&a_config).await;
        if a_result.success {
            for rec in &a_result.records {
                if let DnsRecordEntry::A(ip) = &rec.data {
                    ip_addresses.push(ip.clone());
                    fallback_details.push(StepDetail {
                        label: "A".to_string(),
                        value: ip.clone(),
                    });
                }
            }
        }

        let aaaa_config = DnsConfig {
            domain: domain.clone(),
            record_type: Some(DnsRecordType::AAAA),
            server: config.server.clone(),
            port: config.port,
            transport: None,
        };
        let aaaa_result = records::lookup_records(&aaaa_config).await;
        if aaaa_result.success {
            for rec in &aaaa_result.records {
                if let DnsRecordEntry::AAAA(ip) = &rec.data {
                    ip_addresses.push(ip.clone());
                    fallback_details.push(StepDetail {
                        label: "AAAA".to_string(),
                        value: ip.clone(),
                    });
                }
            }
        }

        let a_ms = a_start.elapsed().as_secs_f64() * 1000.0;

        if !ip_addresses.is_empty() {
            steps.push(SipResolutionStep {
                step_type: "Fallback A/AAAA".to_string(),
                query: domain.clone(),
                record_type: "A/AAAA".to_string(),
                records_found: ip_addresses.len() as u32,
                resolution_ms: a_ms,
                details: fallback_details,
            });

            targets.push(SipTarget {
                transport: "UDP".to_string(),
                host: domain.clone(),
                port: 5060,
                priority: 0,
                weight: 0,
                ip_addresses,
            });
        }
    }

    // Sort targets by priority (ascending), then weight (descending)
    targets.sort_by(|a, b| a.priority.cmp(&b.priority).then(b.weight.cmp(&a.weight)));

    let total_ms = total_start.elapsed().as_secs_f64() * 1000.0;

    let chain = SipResolutionChain {
        domain: config.domain,
        steps,
        success: !targets.is_empty(),
        error: if targets.is_empty() {
            Some("No SIP targets found via NAPTR, SRV, or A/AAAA fallback".to_string())
        } else {
            None
        },
        targets,
        total_ms,
    };
    chain
}
