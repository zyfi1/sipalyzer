pub mod archive;
pub mod call_regression;
pub mod capture;
pub mod dns_parser;
pub mod expert_analyzer;
pub mod filter;
pub mod lazy_packet;
pub mod live_stats;
pub mod packet_index;
pub mod packet_parser;
pub mod pcap_reader;
pub mod pcap_writer;
pub mod pipeline;
pub mod protocol_decoder;
pub mod protocols;
pub mod remote_capture;
pub mod ring_buffer;
pub mod rtcp_parser;
pub mod rtp_analyzer;
pub mod scheduler;
pub mod sip_parser;
pub mod statistics;
pub mod stream;
pub mod streaming_filter;
pub mod t38_parser;
pub mod verification;
pub mod websocket_parser;
pub mod wireshark_filter;

pub use capture::*;
pub use filter::*;
pub use pcap_writer::*;
pub use protocol_decoder::*;
pub use protocols::*;
pub use statistics::*;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpertFinding {
    pub id: String,
    pub rule_id: String,
    pub severity: FindingSeverity,
    pub category: FindingCategory,
    pub title: String,
    pub description: String,
    pub detail: Option<String>,
    pub evidence: Vec<FindingEvidence>,
    pub article_id: Option<String>,
    pub related_call_id: Option<String>,
    pub count: u32,
    pub first_seen: String,
    pub last_seen: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum FindingSeverity {
    Critical,
    Warning,
    Info,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FindingCategory {
    Signaling,
    Media,
    Network,
    Security,
    Performance,
    Fax,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingEvidence {
    pub evidence_type: EvidenceType,
    pub value: String,
    pub label: Option<String>,
    pub packet_indices: Vec<usize>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceType {
    Packet,
    SipDialog,
    RtpStream,
    Timestamp,
    Value,
}
