//! Reverse DNS (PTR) lookup and Forward-Confirmed Reverse DNS (FCrDNS) verification.

use super::records::{self, DnsConfig, DnsRecordEntry, DnsRecordType};
use super::resolver;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::time::Instant;

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReverseDnsConfig {
    pub ip: String,
    pub server: Option<String>,
    pub port: Option<u16>,
    /// If true, also perform forward-confirmed reverse DNS check.
    pub fcrdns: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReverseDnsResult {
    pub ip: String,
    pub ptr_hostname: Option<String>,
    pub resolution_ms: f64,
    pub success: bool,
    pub error: Option<String>,
    /// FCrDNS result, if requested.
    pub fcrdns: Option<FcrDnsResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcrDnsResult {
    pub ip: String,
    pub ptr_hostname: Option<String>,
    /// IPs returned by forward lookup of the PTR hostname.
    pub forward_ips: Vec<String>,
    /// Whether the original IP appears in the forward lookup results.
    pub confirmed: bool,
    /// Explanation of any mismatch.
    pub mismatch_details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchReverseDnsResult {
    pub results: Vec<ReverseDnsResult>,
    pub total_ms: f64,
}

// ── Functions ───────────────────────────────────────────────────────────

/// Perform a reverse DNS (PTR) lookup with optional FCrDNS verification.
pub async fn reverse_dns_lookup(config: ReverseDnsConfig) -> ReverseDnsResult {
    let start = Instant::now();
    let ip_str = config.ip.clone();

    // Parse IP
    let ip_addr: IpAddr = match ip_str.parse() {
        Ok(ip) => ip,
        Err(e) => {
            return ReverseDnsResult {
                ip: ip_str,
                ptr_hostname: None,
                resolution_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: false,
                error: Some(format!("Invalid IP address: {}", e)),
                fcrdns: None,
            };
        }
    };

    // Create resolver
    let resolver = match resolver::create_resolver(config.server.as_deref(), config.port, None) {
        Ok(r) => r,
        Err(e) => {
            return ReverseDnsResult {
                ip: ip_str,
                ptr_hostname: None,
                resolution_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: false,
                error: Some(e),
                fcrdns: None,
            };
        }
    };

    // PTR lookup
    let ptr_hostname = match resolver.reverse_lookup(ip_addr).await {
        Ok(lookup) => lookup
            .iter()
            .next()
            .map(|name| name.to_string().trim_end_matches('.').to_string()),
        Err(e) => {
            return ReverseDnsResult {
                ip: ip_str,
                ptr_hostname: None,
                resolution_ms: start.elapsed().as_secs_f64() * 1000.0,
                success: false,
                error: Some(format!("PTR lookup failed: {}", e)),
                fcrdns: None,
            };
        }
    };

    // FCrDNS check if requested
    let fcrdns = if config.fcrdns {
        if let Some(ref hostname) = ptr_hostname {
            Some(fcrdns_check(&ip_str, hostname, config.server.as_deref(), config.port).await)
        } else {
            Some(FcrDnsResult {
                ip: ip_str.clone(),
                ptr_hostname: None,
                forward_ips: vec![],
                confirmed: false,
                mismatch_details: Some("No PTR record found".to_string()),
            })
        }
    } else {
        None
    };

    let elapsed = start.elapsed().as_secs_f64() * 1000.0;

    ReverseDnsResult {
        ip: ip_str,
        ptr_hostname,
        resolution_ms: elapsed,
        success: true,
        error: None,
        fcrdns,
    }
}

/// Forward-Confirmed Reverse DNS check.
async fn fcrdns_check(
    original_ip: &str,
    ptr_hostname: &str,
    server: Option<&str>,
    port: Option<u16>,
) -> FcrDnsResult {
    let mut forward_ips = Vec::new();

    // Forward A lookup
    let a_config = DnsConfig {
        domain: ptr_hostname.to_string(),
        record_type: Some(DnsRecordType::A),
        server: server.map(|s| s.to_string()),
        port,
        transport: None,
    };
    let a_result = records::lookup_records(&a_config).await;
    if a_result.success {
        for rec in &a_result.records {
            if let DnsRecordEntry::A(ip) = &rec.data {
                forward_ips.push(ip.clone());
            }
        }
    }

    // Forward AAAA lookup
    let aaaa_config = DnsConfig {
        domain: ptr_hostname.to_string(),
        record_type: Some(DnsRecordType::AAAA),
        server: server.map(|s| s.to_string()),
        port,
        transport: None,
    };
    let aaaa_result = records::lookup_records(&aaaa_config).await;
    if aaaa_result.success {
        for rec in &aaaa_result.records {
            if let DnsRecordEntry::AAAA(ip) = &rec.data {
                forward_ips.push(ip.clone());
            }
        }
    }

    let confirmed = forward_ips.iter().any(|ip| ip == original_ip);

    let mismatch_details = if !confirmed {
        if forward_ips.is_empty() {
            Some(format!(
                "PTR hostname '{}' has no A/AAAA records",
                ptr_hostname
            ))
        } else {
            Some(format!(
                "PTR hostname '{}' resolves to [{}], but original IP is {}",
                ptr_hostname,
                forward_ips.join(", "),
                original_ip
            ))
        }
    } else {
        None
    };

    FcrDnsResult {
        ip: original_ip.to_string(),
        ptr_hostname: Some(ptr_hostname.to_string()),
        forward_ips,
        confirmed,
        mismatch_details,
    }
}

/// Batch reverse DNS lookup with optional FCrDNS.
pub async fn batch_reverse_dns(
    ips: Vec<String>,
    server: Option<String>,
    port: Option<u16>,
    fcrdns: bool,
    concurrency: usize,
) -> BatchReverseDnsResult {
    let start = Instant::now();
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));
    let mut handles = Vec::new();

    for ip in ips {
        let sem = semaphore.clone();
        let srv = server.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;
            reverse_dns_lookup(ReverseDnsConfig {
                ip,
                server: srv,
                port,
                fcrdns,
            })
            .await
        }));
    }

    let mut results = Vec::new();
    for h in handles {
        if let Ok(result) = h.await {
            results.push(result);
        }
    }

    BatchReverseDnsResult {
        results,
        total_ms: start.elapsed().as_secs_f64() * 1000.0,
    }
}
