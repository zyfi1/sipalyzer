//! Dig-style raw DNS query diagnostics — full header flags, all sections, EDNS0, RCODE.

use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::{Name, RecordType, RData};
use hickory_proto::serialize::binary::BinEncodable;
use hickory_proto::udp::UdpClientStream;
use hickory_proto::tcp::TcpClientStream;
use hickory_client::client::{AsyncClient, ClientHandle};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::time::Instant;

use super::records::DnsRecordType;

/// Map DnsRecordType to hickory_proto 0.24 RecordType for use with hickory_client (dig path).
fn dns_record_type_to_proto_record_type(rt: DnsRecordType) -> RecordType {
    match rt {
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

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigConfig {
    pub domain: String,
    pub record_type: String,
    /// DNS server IP. If None, uses 8.8.8.8 as default for raw queries.
    pub server: Option<String>,
    pub port: Option<u16>,
    /// Query flags to set.
    pub flags: Option<DnsQueryFlags>,
    /// If true, use TCP instead of UDP.
    pub use_tcp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsQueryFlags {
    /// Recursion Desired (default: true)
    pub rd: Option<bool>,
    /// Checking Disabled (DNSSEC, default: false)
    pub cd: Option<bool>,
    /// Authenticated Data (default: false)
    pub ad: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawDnsResponse {
    /// Server queried.
    pub server: String,
    /// Query domain and type.
    pub query: String,
    pub query_type: String,
    /// Transport used.
    pub transport: String,

    /// Header flags.
    pub header: DnsFlags,

    /// Question section.
    pub question: Vec<DnsSection>,
    /// Answer section.
    pub answer: Vec<RawDnsRecord>,
    /// Authority section.
    pub authority: Vec<RawDnsRecord>,
    /// Additional section.
    pub additional: Vec<RawDnsRecord>,

    /// EDNS0 information (if present).
    pub edns: Option<EdnsInfo>,

    /// Timing.
    pub query_time_ms: f64,
    /// Response size in bytes.
    pub response_size: usize,
    /// Whether response was truncated (TC bit).
    pub truncated: bool,
    /// Whether we retried over TCP due to truncation.
    pub tcp_retry: bool,

    pub success: bool,
    pub error: Option<String>,

    /// Formatted dig-style text output.
    pub dig_output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsFlags {
    pub id: u16,
    pub qr: bool,
    pub opcode: String,
    pub aa: bool,
    pub tc: bool,
    pub rd: bool,
    pub ra: bool,
    pub ad: bool,
    pub cd: bool,
    pub rcode: String,
    pub rcode_description: String,
    pub qdcount: u16,
    pub ancount: u16,
    pub nscount: u16,
    pub arcount: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsSection {
    pub name: String,
    pub record_type: String,
    pub class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawDnsRecord {
    pub name: String,
    pub ttl: u32,
    pub class: String,
    pub record_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdnsInfo {
    pub version: u8,
    pub udp_payload_size: u16,
    pub dnssec_ok: bool,
    pub options: Vec<String>,
}

// ── Helper functions ────────────────────────────────────────────────────

fn rcode_description(rcode: &ResponseCode) -> &'static str {
    match *rcode {
        ResponseCode::NoError => "No Error — query completed successfully",
        ResponseCode::FormErr => "Format Error — server unable to interpret the query",
        ResponseCode::ServFail => "Server Failure — server was unable to process the query",
        ResponseCode::NXDomain => "Non-Existent Domain — the domain name does not exist",
        ResponseCode::NotImp => "Not Implemented — server does not support the query type",
        ResponseCode::Refused => "Query Refused — server refuses to perform the query",
        _ => "Unknown response code",
    }
}

fn opcode_string(opcode: OpCode) -> String {
    match opcode {
        OpCode::Query => "QUERY".to_string(),
        OpCode::Status => "STATUS".to_string(),
        OpCode::Notify => "NOTIFY".to_string(),
        OpCode::Update => "UPDATE".to_string(),
    }
}

fn record_data_to_string(rdata: &RData) -> String {
    match rdata {
        RData::A(a) => a.to_string(),
        RData::AAAA(aaaa) => aaaa.to_string(),
        RData::CNAME(cname) => cname.to_string(),
        RData::NS(ns) => ns.to_string(),
        RData::PTR(ptr) => ptr.to_string(),
        RData::MX(mx) => format!("{} {}", mx.preference(), mx.exchange()),
        RData::TXT(txt) => {
            txt.iter()
                .map(|chunk| format!("\"{}\"", String::from_utf8_lossy(chunk)))
                .collect::<Vec<_>>()
                .join(" ")
        }
        RData::SRV(srv) => format!(
            "{} {} {} {}",
            srv.priority(),
            srv.weight(),
            srv.port(),
            srv.target()
        ),
        RData::SOA(soa) => format!(
            "{} {} {} {} {} {} {}",
            soa.mname(),
            soa.rname(),
            soa.serial(),
            soa.refresh(),
            soa.retry(),
            soa.expire(),
            soa.minimum()
        ),
        RData::NAPTR(naptr) => format!(
            "{} {} \"{}\" \"{}\" \"{}\" {}",
            naptr.order(),
            naptr.preference(),
            String::from_utf8_lossy(naptr.flags()),
            String::from_utf8_lossy(naptr.services()),
            String::from_utf8_lossy(naptr.regexp()),
            naptr.replacement()
        ),
        RData::CAA(caa) => format!(
            "{} {} \"{}\"",
            if caa.issuer_critical() { 128 } else { 0 },
            caa.tag(),
            caa.value()
        ),
        other => format!("{:?}", other),
    }
}

/// Build a dig-style text output from the parsed response.
fn format_dig_output(
    config: &DigConfig,
    flags: &DnsFlags,
    question: &[DnsSection],
    answer: &[RawDnsRecord],
    authority: &[RawDnsRecord],
    additional: &[RawDnsRecord],
    edns: &Option<EdnsInfo>,
    query_time_ms: f64,
    response_size: usize,
    server: &str,
) -> String {
    let mut out = String::new();

    out.push_str(&format!(
        "; <<>> SIPalyzer DiG <<>> {} {} @{}\n",
        config.record_type, config.domain, server
    ));
    out.push_str(";; Got answer:\n");
    out.push_str(&format!(
        ";; ->>HEADER<<- opcode: {}, status: {}, id: {}\n",
        flags.opcode, flags.rcode, flags.id
    ));
    out.push_str(&format!(
        ";; flags: {}; QUERY: {}, ANSWER: {}, AUTHORITY: {}, ADDITIONAL: {}\n\n",
        format_flags(flags),
        flags.qdcount,
        flags.ancount,
        flags.nscount,
        flags.arcount,
    ));

    if let Some(ref edns_info) = edns {
        out.push_str(";; OPT PSEUDOSECTION:\n");
        out.push_str(&format!(
            "; EDNS: version: {}, flags:{}; udp: {}\n",
            edns_info.version,
            if edns_info.dnssec_ok { " do" } else { "" },
            edns_info.udp_payload_size,
        ));
        out.push('\n');
    }

    if !question.is_empty() {
        out.push_str(";; QUESTION SECTION:\n");
        for q in question {
            out.push_str(&format!(";{:<30} {} {}\n", q.name, q.class, q.record_type));
        }
        out.push('\n');
    }

    if !answer.is_empty() {
        out.push_str(";; ANSWER SECTION:\n");
        for r in answer {
            out.push_str(&format!(
                "{:<30} {:<8} {} {:<8} {}\n",
                r.name, r.ttl, r.class, r.record_type, r.data
            ));
        }
        out.push('\n');
    }

    if !authority.is_empty() {
        out.push_str(";; AUTHORITY SECTION:\n");
        for r in authority {
            out.push_str(&format!(
                "{:<30} {:<8} {} {:<8} {}\n",
                r.name, r.ttl, r.class, r.record_type, r.data
            ));
        }
        out.push('\n');
    }

    if !additional.is_empty() {
        out.push_str(";; ADDITIONAL SECTION:\n");
        for r in additional {
            out.push_str(&format!(
                "{:<30} {:<8} {} {:<8} {}\n",
                r.name, r.ttl, r.class, r.record_type, r.data
            ));
        }
        out.push('\n');
    }

    out.push_str(&format!(
        ";; Query time: {:.0} msec\n",
        query_time_ms
    ));
    out.push_str(&format!(";; SERVER: {}#53\n", server));
    out.push_str(&format!(";; MSG SIZE  rcvd: {}\n", response_size));

    out
}

fn format_flags(flags: &DnsFlags) -> String {
    let mut parts = Vec::new();
    if flags.qr { parts.push("qr"); }
    if flags.aa { parts.push("aa"); }
    if flags.tc { parts.push("tc"); }
    if flags.rd { parts.push("rd"); }
    if flags.ra { parts.push("ra"); }
    if flags.ad { parts.push("ad"); }
    if flags.cd { parts.push("cd"); }
    parts.join(" ")
}

// ── Main dig function ───────────────────────────────────────────────────

/// Perform a raw DNS query with full diagnostic output, similar to `dig`.
pub async fn run_dig(config: DigConfig) -> RawDnsResponse {
    let start = Instant::now();
    let server_ip = config
        .server
        .as_deref()
        .unwrap_or("8.8.8.8");
    let port = config.port.unwrap_or(53);
    let server_addr: SocketAddr = match format!("{}:{}", server_ip, port).parse() {
        Ok(a) => a,
        Err(e) => {
            return make_error_response(&config, server_ip, &format!("Invalid server address: {}", e));
        }
    };

    let record_type = DnsRecordType::from_str_loose(&config.record_type)
        .map(|rt| dns_record_type_to_proto_record_type(rt))
        .unwrap_or(RecordType::A);

    let name = match Name::from_ascii(&config.domain) {
        Ok(n) => n,
        Err(e) => {
            return make_error_response(&config, server_ip, &format!("Invalid domain: {}", e));
        }
    };

    // Build and send the query using hickory-client
    let flags = config.flags.as_ref();
    let rd = flags.and_then(|f| f.rd).unwrap_or(true);

    let result = if config.use_tcp {
        run_dig_tcp(server_addr, name.clone(), record_type, rd).await
    } else {
        run_dig_udp(server_addr, name.clone(), record_type, rd).await
    };

    let query_time = start.elapsed().as_secs_f64() * 1000.0;
    let transport = if config.use_tcp { "TCP" } else { "UDP" };

    match result {
        Ok((response, response_size)) => {
            let truncated = response.truncated();

            // If truncated and we were using UDP, retry over TCP
            if truncated && !config.use_tcp {
                let tcp_result = run_dig_tcp(server_addr, name, record_type, rd).await;
                let tcp_time = start.elapsed().as_secs_f64() * 1000.0;

                match tcp_result {
                    Ok((tcp_response, tcp_size)) => {
                        parse_response(&config, server_ip, "TCP", &tcp_response, tcp_size, tcp_time, true)
                    }
                    Err(e) => {
                        // TCP retry failed, return the truncated UDP result
                        let mut result = parse_response(&config, server_ip, "UDP", &response, response_size, query_time, false);
                        result.error = Some(format!("TCP retry failed: {}", e));
                        result
                    }
                }
            } else {
                parse_response(&config, server_ip, transport, &response, response_size, query_time, false)
            }
        }
        Err(e) => make_error_response(&config, server_ip, &e),
    }
}

async fn run_dig_udp(
    server: SocketAddr,
    name: Name,
    record_type: RecordType,
    _rd: bool,
) -> Result<(Message, usize), String> {
    let stream = UdpClientStream::<tokio::net::UdpSocket>::new(server);
    let (mut client, bg) = AsyncClient::connect(stream)
        .await
        .map_err(|e| format!("UDP connect failed: {}", e))?;
    tokio::spawn(bg);

    let query = client
        .query(name, hickory_proto::rr::DNSClass::IN, record_type)
        .await
        .map_err(|e| format!("UDP query failed: {}", e))?;

    let response = query.clone();
    let bytes = response
        .to_bytes()
        .map_err(|e| format!("Response encode error: {}", e))?;

    Ok((query.into(), bytes.len()))
}

async fn run_dig_tcp(
    server: SocketAddr,
    name: Name,
    record_type: RecordType,
    _rd: bool,
) -> Result<(Message, usize), String> {
    use hickory_proto::iocompat::AsyncIoTokioAsStd;

    let (stream, sender) = TcpClientStream::<AsyncIoTokioAsStd<tokio::net::TcpStream>>::new(server);
    let (mut client, bg) = AsyncClient::new(stream, sender, None)
        .await
        .map_err(|e| format!("TCP connect failed: {}", e))?;
    tokio::spawn(bg);

    let query = client
        .query(name, hickory_proto::rr::DNSClass::IN, record_type)
        .await
        .map_err(|e| format!("TCP query failed: {}", e))?;

    let response = query.clone();
    let bytes = response
        .to_bytes()
        .map_err(|e| format!("Response encode error: {}", e))?;

    Ok((query.into(), bytes.len()))
}

fn parse_response(
    config: &DigConfig,
    server_ip: &str,
    transport: &str,
    msg: &Message,
    response_size: usize,
    query_time_ms: f64,
    tcp_retry: bool,
) -> RawDnsResponse {
    let header = msg.header();
    let rcode = header.response_code();

    let flags = DnsFlags {
        id: header.id(),
        qr: header.message_type() == MessageType::Response,
        opcode: opcode_string(header.op_code()),
        aa: header.authoritative(),
        tc: header.truncated(),
        rd: header.recursion_desired(),
        ra: header.recursion_available(),
        ad: header.authentic_data(),
        cd: header.checking_disabled(),
        rcode: format!("{:?}", rcode),
        rcode_description: rcode_description(&rcode).to_string(),
        qdcount: header.query_count(),
        ancount: header.answer_count(),
        nscount: header.name_server_count(),
        arcount: header.additional_count(),
    };

    let question: Vec<DnsSection> = msg
        .queries()
        .iter()
        .map(|q| DnsSection {
            name: q.name().to_string(),
            record_type: format!("{:?}", q.query_type()),
            class: format!("{:?}", q.query_class()),
        })
        .collect();

    let answer: Vec<RawDnsRecord> = msg
        .answers()
        .iter()
        .map(|r| RawDnsRecord {
            name: r.name().to_string(),
            ttl: r.ttl(),
            class: "IN".to_string(),
            record_type: format!("{:?}", r.record_type()),
            data: r.data().map(|d| record_data_to_string(d)).unwrap_or_default(),
        })
        .collect();

    let authority: Vec<RawDnsRecord> = msg
        .name_servers()
        .iter()
        .map(|r| RawDnsRecord {
            name: r.name().to_string(),
            ttl: r.ttl(),
            class: "IN".to_string(),
            record_type: format!("{:?}", r.record_type()),
            data: r.data().map(|d| record_data_to_string(d)).unwrap_or_default(),
        })
        .collect();

    let additional: Vec<RawDnsRecord> = msg
        .additionals()
        .iter()
        .filter(|r| r.record_type() != RecordType::OPT)
        .map(|r| RawDnsRecord {
            name: r.name().to_string(),
            ttl: r.ttl(),
            class: "IN".to_string(),
            record_type: format!("{:?}", r.record_type()),
            data: r.data().map(|d| record_data_to_string(d)).unwrap_or_default(),
        })
        .collect();

    // Check for EDNS0 OPT record
    let edns = msg.extensions().as_ref().map(|opt| EdnsInfo {
        version: opt.version(),
        udp_payload_size: opt.max_payload(),
        dnssec_ok: opt.dnssec_ok(),
        options: vec![],
    });

    let dig_output = format_dig_output(
        config,
        &flags,
        &question,
        &answer,
        &authority,
        &additional,
        &edns,
        query_time_ms,
        response_size,
        server_ip,
    );

    RawDnsResponse {
        server: server_ip.to_string(),
        query: config.domain.clone(),
        query_type: config.record_type.clone(),
        transport: transport.to_string(),
        header: flags,
        question,
        answer,
        authority,
        additional,
        edns,
        query_time_ms,
        response_size,
        truncated: msg.truncated(),
        tcp_retry,
        success: true,
        error: None,
        dig_output,
    }
}

fn make_error_response(config: &DigConfig, server_ip: &str, error: &str) -> RawDnsResponse {
    RawDnsResponse {
        server: server_ip.to_string(),
        query: config.domain.clone(),
        query_type: config.record_type.clone(),
        transport: if config.use_tcp { "TCP" } else { "UDP" }.to_string(),
        header: DnsFlags {
            id: 0,
            qr: false,
            opcode: "QUERY".to_string(),
            aa: false,
            tc: false,
            rd: true,
            ra: false,
            ad: false,
            cd: false,
            rcode: "ERROR".to_string(),
            rcode_description: error.to_string(),
            qdcount: 0,
            ancount: 0,
            nscount: 0,
            arcount: 0,
        },
        question: vec![],
        answer: vec![],
        authority: vec![],
        additional: vec![],
        edns: None,
        query_time_ms: 0.0,
        response_size: 0,
        truncated: false,
        tcp_retry: false,
        success: false,
        error: Some(error.to_string()),
        dig_output: format!(";; connection timed out; no servers could be reached\n;; Error: {}\n", error),
    }
}
