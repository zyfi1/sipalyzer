//! DNS PCAP correlation — link DNS test results to captured DNS packets.

use crate::packet_capture::dns_parser::DnsMessage;
use serde::{Deserialize, Serialize};

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsCorrelation {
    /// Domain queried in the test.
    pub query_domain: String,
    /// Record type queried.
    pub query_type: Option<String>,
    /// Matching captured DNS packets.
    pub matched_packets: Vec<MatchedDnsPacket>,
    /// Number of capture packets scanned.
    pub packets_scanned: u64,
    /// Discrepancies between test result and wire-level data.
    pub discrepancies: Vec<DnsDiscrepancy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedDnsPacket {
    /// Index of the packet in the capture session.
    pub packet_index: u64,
    /// Timestamp of the captured packet.
    pub timestamp: String,
    /// Source IP.
    pub src_ip: String,
    /// Destination IP.
    pub dst_ip: String,
    /// Source port.
    pub src_port: u16,
    /// Destination port.
    pub dst_port: u16,
    /// Whether this is a query (false) or response (true).
    pub is_response: bool,
    /// DNS transaction ID.
    pub transaction_id: u16,
    /// Queried domain name.
    pub query_name: String,
    /// Query type (numeric).
    pub query_type: u16,
    /// Answer records (if response).
    pub answers: Vec<MatchedDnsAnswer>,
    /// Response code (if response).
    pub response_code: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedDnsAnswer {
    pub name: String,
    pub record_type: u16,
    pub ttl: u32,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsDiscrepancy {
    pub severity: String,
    pub description: String,
}

// ── Correlation logic ───────────────────────────────────────────────────

/// Packet info needed for correlation, extracted from the capture engine.
pub struct CapturedPacketInfo {
    pub index: u64,
    pub timestamp: String,
    pub src_ip: String,
    pub dst_ip: String,
    pub src_port: u16,
    pub dst_port: u16,
    pub dns_message: DnsMessage,
}

/// Correlate a DNS test query domain with captured DNS packets.
pub fn correlate_dns(
    query_domain: &str,
    query_type: Option<&str>,
    captured_dns_packets: &[CapturedPacketInfo],
) -> DnsCorrelation {
    let domain_lower = query_domain.to_lowercase();
    let mut matched = Vec::new();
    let mut discrepancies = Vec::new();

    // Track request/response pairs by transaction ID
    let mut seen_query_ids: Vec<u16> = Vec::new();
    let mut seen_response_ids: Vec<u16> = Vec::new();

    for pkt in captured_dns_packets {
        let dns = &pkt.dns_message;

        // Check if any query in this packet matches our domain
        let domain_match = dns.queries.iter().any(|q| {
            let name = q.name.to_lowercase().trim_end_matches('.').to_string();
            name == domain_lower || name.ends_with(&format!(".{}", domain_lower))
        });

        if !domain_match {
            continue;
        }

        // Optional: filter by query type
        if let Some(qt) = query_type {
            let type_num = qtype_from_string(qt);
            if type_num > 0 {
                let type_match = dns.queries.iter().any(|q| q.qtype == type_num);
                if !type_match {
                    continue;
                }
            }
        }

        // Track transaction IDs
        if dns.is_response {
            seen_response_ids.push(dns.transaction_id);
        } else {
            seen_query_ids.push(dns.transaction_id);
        }

        let answers: Vec<MatchedDnsAnswer> = dns
            .answers
            .iter()
            .map(|a| MatchedDnsAnswer {
                name: a.name.clone(),
                record_type: a.rtype,
                ttl: a.ttl,
                data: a.data.clone(),
            })
            .collect();

        matched.push(MatchedDnsPacket {
            packet_index: pkt.index,
            timestamp: pkt.timestamp.clone(),
            src_ip: pkt.src_ip.clone(),
            dst_ip: pkt.dst_ip.clone(),
            src_port: pkt.src_port,
            dst_port: pkt.dst_port,
            is_response: dns.is_response,
            transaction_id: dns.transaction_id,
            query_name: dns
                .queries
                .first()
                .map(|q| q.name.clone())
                .unwrap_or_default(),
            query_type: dns.queries.first().map(|q| q.qtype).unwrap_or(0),
            answers,
            response_code: if dns.is_response {
                Some(dns.response_code)
            } else {
                None
            },
        });
    }

    // Detect discrepancies

    // Check for retransmissions (duplicate query transaction IDs)
    let mut query_id_counts = std::collections::HashMap::new();
    for id in &seen_query_ids {
        *query_id_counts.entry(*id).or_insert(0u32) += 1;
    }
    for (id, count) in &query_id_counts {
        if *count > 1 {
            discrepancies.push(DnsDiscrepancy {
                severity: "warning".to_string(),
                description: format!(
                    "DNS query retransmission detected: transaction ID 0x{:04x} sent {} times",
                    id, count
                ),
            });
        }
    }

    // Check for unanswered queries
    for qid in &seen_query_ids {
        if !seen_response_ids.contains(qid) {
            discrepancies.push(DnsDiscrepancy {
                severity: "error".to_string(),
                description: format!(
                    "DNS query 0x{:04x} has no matching response in capture",
                    qid
                ),
            });
        }
    }

    // Check for non-zero response codes
    for pkt in &matched {
        if let Some(rcode) = pkt.response_code {
            if rcode != 0 {
                discrepancies.push(DnsDiscrepancy {
                    severity: if rcode == 3 { "warning" } else { "error" }.to_string(),
                    description: format!(
                        "DNS response 0x{:04x} returned RCODE {} ({})",
                        pkt.transaction_id,
                        rcode,
                        rcode_name(rcode)
                    ),
                });
            }
        }
    }

    DnsCorrelation {
        query_domain: query_domain.to_string(),
        query_type: query_type.map(|s| s.to_string()),
        matched_packets: matched,
        packets_scanned: captured_dns_packets.len() as u64,
        discrepancies,
    }
}

fn qtype_from_string(s: &str) -> u16 {
    match s.to_uppercase().as_str() {
        "A" => 1,
        "NS" => 2,
        "CNAME" => 5,
        "SOA" => 6,
        "PTR" => 12,
        "MX" => 15,
        "TXT" => 16,
        "AAAA" => 28,
        "SRV" => 33,
        "NAPTR" => 35,
        "CAA" => 257,
        _ => 0,
    }
}

fn rcode_name(rcode: u8) -> &'static str {
    match rcode {
        0 => "NOERROR",
        1 => "FORMERR",
        2 => "SERVFAIL",
        3 => "NXDOMAIN",
        4 => "NOTIMP",
        5 => "REFUSED",
        _ => "UNKNOWN",
    }
}
