//! Tauri commands for the comprehensive DNS testing suite.

use crate::network_test::dns::{
    diagnostics::{self, DigConfig, DnsQueryFlags, RawDnsResponse},
    geoip::{self, AsnResult, BatchGeoIpResult, GeoIpResult},
    records::{self, DnsConfig, DnsRecordSet, DnsRecordType},
    reverse::{self, BatchReverseDnsResult, ReverseDnsConfig, ReverseDnsResult},
    sip_resolution::{self, SipResolutionChain, SipResolutionConfig},
};
use crate::remote_agent::manager::AGENT_MANAGER;
use serde::{Deserialize, Serialize};
use sipalyzer_core::protocol::AgentCommand;

// ── DNS Lookup (full record types, custom server) ───────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_lookup(
    domain: String,
    record_type: Option<String>,
    server: Option<String>,
    port: Option<u16>,
    transport: Option<String>,
) -> Result<DnsRecordSet, String> {
    let rt = record_type
        .as_deref()
        .and_then(DnsRecordType::from_str_loose)
        .unwrap_or(DnsRecordType::A);

    let dns_transport = transport
        .as_deref()
        .and_then(|t| match t.to_lowercase().as_str() {
            "tcp" => Some(crate::network_test::dns::resolver::DnsTransport::Tcp),
            "udp" => Some(crate::network_test::dns::resolver::DnsTransport::Udp),
            _ => None,
        });

    let config = DnsConfig {
        domain,
        record_type: Some(rt),
        server,
        port,
        transport: dns_transport,
    };

    Ok(records::lookup_records(&config).await)
}

// ── RFC 3263 SIP Resolution Chain ───────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_sip_resolve(
    domain: String,
    server: Option<String>,
    port: Option<u16>,
) -> Result<SipResolutionChain, String> {
    let config = SipResolutionConfig {
        domain,
        server,
        port,
    };
    Ok(sip_resolution::resolve_sip_domain(config).await)
}

// ── Reverse DNS + FCrDNS ────────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_reverse(
    ip: String,
    server: Option<String>,
    port: Option<u16>,
    fcrdns: Option<bool>,
) -> Result<ReverseDnsResult, String> {
    let config = ReverseDnsConfig {
        ip,
        server,
        port,
        fcrdns: fcrdns.unwrap_or(true),
    };
    Ok(reverse::reverse_dns_lookup(config).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_reverse_batch(
    ips: Vec<String>,
    server: Option<String>,
    port: Option<u16>,
    fcrdns: Option<bool>,
    concurrency: Option<usize>,
) -> Result<BatchReverseDnsResult, String> {
    Ok(reverse::batch_reverse_dns(
        ips,
        server,
        port,
        fcrdns.unwrap_or(true),
        concurrency.unwrap_or(10),
    )
    .await)
}

// ── Dig-style raw query ─────────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_dig(
    domain: String,
    record_type: Option<String>,
    server: Option<String>,
    port: Option<u16>,
    use_tcp: Option<bool>,
    rd: Option<bool>,
    cd: Option<bool>,
    ad: Option<bool>,
) -> Result<RawDnsResponse, String> {
    let flags = if rd.is_some() || cd.is_some() || ad.is_some() {
        Some(DnsQueryFlags { rd, cd, ad })
    } else {
        None
    };

    let config = DigConfig {
        domain,
        record_type: record_type.unwrap_or_else(|| "A".to_string()),
        server,
        port,
        flags,
        use_tcp: use_tcp.unwrap_or(false),
    };

    Ok(diagnostics::run_dig(config).await)
}

// ── GeoIP Enrichment ────────────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_geoip(ip: String) -> Result<GeoIpResult, String> {
    Ok(geoip::geoip_lookup(&ip).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_geoip_batch(ips: Vec<String>) -> Result<BatchGeoIpResult, String> {
    Ok(geoip::geoip_batch(ips).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_asn_lookup(ip: String) -> Result<AsnResult, String> {
    Ok(geoip::cymru_asn_lookup(&ip).await)
}

// ── Multi-Site DNS Comparison ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSiteConfig {
    /// Type of DNS test to run: "lookup", "sip_resolve", "reverse", "dig"
    pub test_type: String,
    /// Domain or IP to test.
    pub target: String,
    /// Record type (for lookup/dig).
    pub record_type: Option<String>,
    /// DNS server (for all tests).
    pub server: Option<String>,
    /// Agent IDs to include. Empty or ["all"] = all connected agents.
    pub agent_ids: Vec<String>,
    /// Whether to include a local test as well.
    pub include_local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSiteDnsComparison {
    pub target: String,
    pub test_type: String,
    pub results: Vec<SiteDnsResult>,
    pub discrepancies: Vec<MultiSiteDiscrepancy>,
    pub total_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteDnsResult {
    /// "local" or agent hostname/name.
    pub source: String,
    /// Agent ID (None for local).
    pub agent_id: Option<String>,
    /// The command message ID (for remote results, used to correlate responses).
    pub command_id: Option<String>,
    /// Result data as JSON (type depends on test_type).
    pub result: Option<serde_json::Value>,
    pub latency_ms: Option<f64>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSiteDiscrepancy {
    pub severity: String,
    pub description: String,
    pub sites_affected: Vec<String>,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn dns_multi_site(config: MultiSiteConfig) -> Result<MultiSiteDnsComparison, String> {
    let start = std::time::Instant::now();
    let mut results: Vec<SiteDnsResult> = Vec::new();

    // Run local test if requested
    if config.include_local {
        let local_start = std::time::Instant::now();
        let local_result = run_local_dns_test(&config).await;
        let local_ms = local_start.elapsed().as_secs_f64() * 1000.0;

        results.push(SiteDnsResult {
            source: "Local".to_string(),
            agent_id: None,
            command_id: None,
            result: local_result.0,
            latency_ms: Some(local_ms),
            success: local_result.1,
            error: local_result.2,
        });
    }

    // Send test to remote agents (prepare sends while holding lock, then execute outside lock)
    let prepared_sends: Vec<_> = {
        let mgr = AGENT_MANAGER.lock().await;
        let connections = mgr.list_connections();

        let target_agents: Vec<_> =
            if config.agent_ids.is_empty() || config.agent_ids.iter().any(|id| id == "all") {
                connections.iter().collect()
            } else {
                connections
                    .iter()
                    .filter(|c| config.agent_ids.contains(&c.id))
                    .collect()
            };

        target_agents
            .iter()
            .map(|agent| {
                let command = build_agent_dns_command(&config);
                let display_name = agent.name.clone().unwrap_or_else(|| agent.hostname.clone());
                let agent_id = agent.id.clone();
                let prepared = mgr.prepare_send(&agent.id, command);
                (display_name, agent_id, prepared)
            })
            .collect()
        // Lock is dropped here
    };

    for (display_name, agent_id, prepared) in prepared_sends {
        match prepared {
            Ok((msg_id, tx, msg)) => {
                match tokio::time::timeout(std::time::Duration::from_secs(5), tx.send(msg)).await {
                    Ok(Ok(())) => {
                        results.push(SiteDnsResult {
                            source: display_name,
                            agent_id: Some(agent_id),
                            command_id: Some(msg_id),
                            result: None,
                            latency_ms: None,
                            success: true,
                            error: None,
                        });
                    }
                    Ok(Err(_)) => {
                        let err_msg = format!("Agent '{}' connection closed", agent_id);
                        results.push(SiteDnsResult {
                            source: display_name,
                            agent_id: Some(agent_id),
                            command_id: None,
                            result: None,
                            latency_ms: None,
                            success: false,
                            error: Some(err_msg),
                        });
                    }
                    Err(_) => {
                        let err_msg = format!("Send to agent '{}' timed out", agent_id);
                        results.push(SiteDnsResult {
                            source: display_name,
                            agent_id: Some(agent_id),
                            command_id: None,
                            result: None,
                            latency_ms: None,
                            success: false,
                            error: Some(err_msg),
                        });
                    }
                }
            }
            Err(e) => {
                results.push(SiteDnsResult {
                    source: display_name,
                    agent_id: Some(agent_id),
                    command_id: None,
                    result: None,
                    latency_ms: None,
                    success: false,
                    error: Some(e),
                });
            }
        }
    }

    let total_ms = start.elapsed().as_secs_f64() * 1000.0;

    Ok(MultiSiteDnsComparison {
        target: config.target,
        test_type: config.test_type,
        results,
        discrepancies: vec![],
        total_ms,
    })
}

/// Run the DNS test locally based on config type.
async fn run_local_dns_test(
    config: &MultiSiteConfig,
) -> (Option<serde_json::Value>, bool, Option<String>) {
    match config.test_type.as_str() {
        "lookup" => {
            let rt = config
                .record_type
                .as_deref()
                .and_then(DnsRecordType::from_str_loose)
                .unwrap_or(DnsRecordType::A);

            let dns_config = DnsConfig {
                domain: config.target.clone(),
                record_type: Some(rt),
                server: config.server.clone(),
                port: None,
                transport: None,
            };
            let result = records::lookup_records(&dns_config).await;
            let success = result.success;
            let error = result.error.clone();
            (serde_json::to_value(&result).ok(), success, error)
        }
        "sip_resolve" => {
            let sip_config = SipResolutionConfig {
                domain: config.target.clone(),
                server: config.server.clone(),
                port: None,
            };
            let result = sip_resolution::resolve_sip_domain(sip_config).await;
            let success = result.success;
            let error = result.error.clone();
            (serde_json::to_value(&result).ok(), success, error)
        }
        "reverse" => {
            let rev_config = ReverseDnsConfig {
                ip: config.target.clone(),
                server: config.server.clone(),
                port: None,
                fcrdns: true,
            };
            let result = reverse::reverse_dns_lookup(rev_config).await;
            let success = result.success;
            let error = result.error.clone();
            (serde_json::to_value(&result).ok(), success, error)
        }
        "dig" => {
            let dig_config = diagnostics::DigConfig {
                domain: config.target.clone(),
                record_type: config
                    .record_type
                    .clone()
                    .unwrap_or_else(|| "A".to_string()),
                server: config.server.clone(),
                port: None,
                flags: None,
                use_tcp: false,
            };
            let result = diagnostics::run_dig(dig_config).await;
            let success = result.success;
            let error = result.error.clone();
            (serde_json::to_value(&result).ok(), success, error)
        }
        _ => (
            None,
            false,
            Some(format!("Unknown test type: {}", config.test_type)),
        ),
    }
}

/// Build an AgentCommand for the given DNS test type.
fn build_agent_dns_command(config: &MultiSiteConfig) -> AgentCommand {
    match config.test_type.as_str() {
        "lookup" => AgentCommand::DnsLookup(sipalyzer_core::protocol::DnsLookupParams {
            hostname: config.target.clone(),
            server: config.server.clone(),
            record_type: config
                .record_type
                .clone()
                .unwrap_or_else(|| "A".to_string()),
            transport: None,
            port: None,
        }),
        "sip_resolve" => {
            AgentCommand::DnsSipResolve(sipalyzer_core::protocol::DnsSipResolveParams {
                domain: config.target.clone(),
                server: config.server.clone(),
                port: None,
            })
        }
        "reverse" => AgentCommand::DnsReverse(sipalyzer_core::protocol::DnsReverseParams {
            ip: config.target.clone(),
            server: config.server.clone(),
            port: None,
            fcrdns: true,
        }),
        "dig" => AgentCommand::DnsDig(sipalyzer_core::protocol::DnsDigParams {
            domain: config.target.clone(),
            record_type: config
                .record_type
                .clone()
                .unwrap_or_else(|| "A".to_string()),
            server: config.server.clone(),
            port: None,
            use_tcp: false,
            flags: None,
        }),
        _ => AgentCommand::DnsLookup(sipalyzer_core::protocol::DnsLookupParams {
            hostname: config.target.clone(),
            server: config.server.clone(),
            record_type: "A".to_string(),
            transport: None,
            port: None,
        }),
    }
}
