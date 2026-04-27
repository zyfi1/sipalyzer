//! Command and response protocol for SIPalyzer remote agent communication.
//!
//! All messages are JSON-serialized and sent over a WebSocket channel.
//! Each command has a unique `id` for correlating responses.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Envelope: every WebSocket message is wrapped in one of these
// ---------------------------------------------------------------------------

/// A message sent from the controller to the agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    /// Unique message ID for correlating responses.
    pub id: String,
    /// The command payload.
    #[serde(flatten)]
    pub command: AgentCommand,
}

/// A message sent from the agent back to the controller.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentReply {
    /// Correlates to the `AgentMessage.id` that triggered this reply.
    pub id: String,
    /// The response payload.
    #[serde(flatten)]
    pub response: AgentResponse,
}

impl AgentMessage {
    pub fn new(command: AgentCommand) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            command,
        }
    }
}

// ---------------------------------------------------------------------------
// Commands (controller -> agent)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", content = "params")]
pub enum AgentCommand {
    // -- Network tools --
    Ping(PingParams),
    Traceroute(TracerouteParams),
    Mtr(MtrParams),
    DnsLookup(DnsLookupParams),
    DnsSipResolve(DnsSipResolveParams),
    DnsReverse(DnsReverseParams),
    DnsDig(DnsDigParams),
    DnsGeoIp(DnsGeoIpParams),
    PortScan(PortScanParams),
    NtpCheck(NtpCheckParams),
    NatDetect(NatDetectParams),
    SnmpPoll(SnmpPollParams),

    // -- SIP / VoIP tools --
    SipRegistrationTest(SipRegistrationTestParams),
    SipProbe(SipProbeParams),
    SipCall(SipCallParams),
    HangupCall(HangupCallParams),
    FaxSend(FaxSendParams),
    StunTest(StunTestParams),

    // -- Capture / discovery --
    PacketCapture(PacketCaptureParams),
    DeviceScan(DeviceScanParams),

    // -- Tools (agent-only) --
    SyslogListen(SyslogListenParams),
    FetchLog(FetchLogParams),
    TailLog(TailLogParams),
    FileServe(FileServeParams),
    ListDir(ListDirParams),
    StopSyslog(HangupCallParams),
    StopTailLog(HangupCallParams),
    StopFileServe(HangupCallParams),

    // -- Interactive remote shell --
    ShellSpawn(ShellSpawnParams),
    ShellInput(ShellInputParams),
    ShellResize(ShellResizeParams),
    ShellClose(ShellCloseParams),
    ChatMessage(ChatMessageParams),

    // -- System --
    SystemInfo,
    Heartbeat,
    Disconnect,
    Kill,
    SelfDestruct,
}

// ---------------------------------------------------------------------------
// Command parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingParams {
    pub host: String,
    #[serde(default = "default_ping_count")]
    pub count: u32,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_ping_count() -> u32 {
    4
}
fn default_timeout_ms() -> u64 {
    5000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteParams {
    pub host: String,
    #[serde(default = "default_max_hops")]
    pub max_hops: u8,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_max_hops() -> u8 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsLookupParams {
    pub hostname: String,
    /// Optional DNS server to query (uses system resolver if None).
    pub server: Option<String>,
    /// Record type: A, AAAA, MX, SRV, NAPTR, TXT, CNAME, NS, SOA, PTR, CAA, TLSA, SSHFP, HTTPS.
    #[serde(default = "default_record_type")]
    pub record_type: String,
    /// Transport: "udp" or "tcp" (default: udp).
    pub transport: Option<String>,
    /// Custom DNS port (default: 53).
    pub port: Option<u16>,
}

fn default_record_type() -> String {
    "A".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsSipResolveParams {
    /// SIP domain to resolve (RFC 3263 NAPTR -> SRV -> A/AAAA chain).
    pub domain: String,
    /// Optional DNS server IP.
    pub server: Option<String>,
    /// Custom DNS port.
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsReverseParams {
    /// IP address to reverse-lookup.
    pub ip: String,
    /// Optional DNS server IP.
    pub server: Option<String>,
    /// Custom DNS port.
    pub port: Option<u16>,
    /// If true, perform Forward-Confirmed Reverse DNS (FCrDNS) check.
    #[serde(default)]
    pub fcrdns: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsDigParams {
    /// Domain to query.
    pub domain: String,
    /// Record type (A, AAAA, MX, SRV, NAPTR, TXT, etc.).
    #[serde(default = "default_record_type")]
    pub record_type: String,
    /// Optional DNS server IP (default: 8.8.8.8 for raw queries).
    pub server: Option<String>,
    /// Custom DNS port.
    pub port: Option<u16>,
    /// Use TCP instead of UDP.
    #[serde(default)]
    pub use_tcp: bool,
    /// Query flags.
    pub flags: Option<DnsDigQueryFlags>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsDigQueryFlags {
    /// Recursion Desired.
    pub rd: Option<bool>,
    /// Checking Disabled (DNSSEC).
    pub cd: Option<bool>,
    /// Authenticated Data.
    pub ad: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsGeoIpParams {
    /// IP addresses to look up.
    pub ips: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortScanParams {
    pub host: String,
    /// Port range, e.g. "1-1024" or "80,443,5060-5061".
    pub ports: String,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipRegistrationTestParams {
    pub registrar: String,
    pub username: String,
    pub password: String,
    #[serde(default = "default_sip_port")]
    pub port: u16,
    #[serde(default)]
    pub transport: SipTransport,
    pub domain: Option<String>,
    #[serde(default)]
    pub unregister: bool,
}

fn default_sip_port() -> u16 {
    5060
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SipTransport {
    #[default]
    Udp,
    Tcp,
    Tls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipProbeParams {
    pub target: String,
    #[serde(default = "default_sip_port")]
    pub port: u16,
    #[serde(default)]
    pub transport: SipTransport,
    /// SIP method to send: OPTIONS, INVITE, etc.
    #[serde(default = "default_sip_method")]
    pub method: String,
}

fn default_sip_method() -> String {
    "OPTIONS".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunTestParams {
    /// STUN server address (e.g., "stun.l.google.com:19302").
    #[serde(default = "default_stun_server")]
    pub server: String,
}

fn default_stun_server() -> String {
    "stun.l.google.com:19302".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipCallParams {
    pub target: String,
    #[serde(default = "default_sip_port")]
    pub port: u16,
    #[serde(default)]
    pub caller_id: String,
    #[serde(default)]
    pub to_user: String,
    pub domain: Option<String>,
    #[serde(default = "default_call_duration")]
    pub duration_secs: u32,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

fn default_call_duration() -> u32 {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HangupCallParams {
    pub command_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaxSendParams {
    pub target: String,
    #[serde(default)]
    pub fax_number: String,
    #[serde(default = "default_sip_port")]
    pub port: u16,
    #[serde(default)]
    pub caller_id: String,
    #[serde(default = "default_station_id")]
    pub station_id: String,
    pub domain: Option<String>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    /// Baud rate: 2400, 4800, 7200, 9600, 14400 (default: 9600)
    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,
    /// Enable Error Correction Mode (ECM)
    #[serde(default)]
    pub ecm: bool,
    /// Resolution: "standard" or "fine"
    #[serde(default = "default_resolution")]
    pub resolution: String,
    /// Text header printed at top of fax page
    #[serde(default)]
    pub header_line: String,
}

fn default_baud_rate() -> u32 {
    9600
}

fn default_resolution() -> String {
    "standard".to_string()
}

fn default_station_id() -> String {
    "SIPalyzer".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketCaptureParams {
    /// Network interface to capture on (empty = default).
    pub interface: Option<String>,
    /// BPF filter expression.
    pub filter: Option<String>,
    /// Max packets to capture (0 = unlimited).
    #[serde(default)]
    pub max_packets: u32,
    /// Duration in seconds (0 = unlimited).
    #[serde(default)]
    pub duration_secs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceScanParams {
    /// Network CIDR to scan (e.g., "192.168.1.0/24"). Empty = auto-detect.
    pub network: Option<String>,
    /// Whether to do banner grabbing.
    #[serde(default)]
    pub banner_grab: bool,
}

// -- MTR --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtrParams {
    pub host: String,
    #[serde(default = "default_max_hops")]
    pub max_hops: u8,
    #[serde(default = "default_rounds")]
    pub rounds: u32,
    #[serde(default = "default_interval_ms")]
    pub interval_ms: u64,
    #[serde(default = "default_mtr_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_rounds() -> u32 {
    20
}
fn default_interval_ms() -> u64 {
    1000
}
fn default_mtr_timeout_ms() -> u64 {
    2000
}

// -- NTP --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpCheckParams {
    #[serde(default)]
    pub servers: Vec<String>,
    #[serde(default = "default_ntp_timeout")]
    pub timeout_ms: u64,
}

fn default_ntp_timeout() -> u64 {
    3000
}

// -- NAT / ALG --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatDetectParams {
    #[serde(default = "default_stun_server")]
    pub stun_server: String,
    #[serde(default)]
    pub stun_server_2: String,
}

// -- SNMP --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpPollParams {
    pub host: String,
    #[serde(default = "default_community")]
    pub community: String,
    #[serde(default = "default_snmp_version")]
    pub version: u8,
    #[serde(default)]
    pub oids: Vec<String>,
}

fn default_community() -> String {
    "public".to_string()
}
fn default_snmp_version() -> u8 {
    2
}

// -- Syslog --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogListenParams {
    #[serde(default = "default_syslog_port")]
    pub port: u16,
    #[serde(default)]
    pub duration_secs: u32,
    pub filter_severity: Option<String>,
    pub filter_facility: Option<String>,
    #[serde(default = "default_max_entries")]
    pub max_entries: u32,
}

fn default_syslog_port() -> u16 {
    514
}
fn default_max_entries() -> u32 {
    10000
}

// -- Log Fetch --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchLogParams {
    pub path: String,
    pub tail_lines: Option<u32>,
    pub filter: Option<String>,
}

// -- Log Tail --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailLogParams {
    pub path: String,
    pub filter: Option<String>,
}

// -- File Server --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileServeParams {
    #[serde(default)]
    pub path: String,
    #[serde(default = "default_http_port")]
    pub http_port: u16,
    #[serde(default = "default_tftp_port")]
    pub tftp_port: u16,
    #[serde(default = "default_ftp_port")]
    pub ftp_port: u16,
    #[serde(default)]
    pub protocols: Vec<String>,
    #[serde(default)]
    pub duration_secs: u32,
    #[serde(default)]
    pub files: Vec<PushedFile>,
}

fn default_http_port() -> u16 {
    8080
}
fn default_tftp_port() -> u16 {
    69
}
fn default_ftp_port() -> u16 {
    2121
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushedFile {
    pub name: String,
    pub content_base64: String,
}

// -- File Browser --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirParams {
    #[serde(default = "default_list_dir_path")]
    pub path: String,
    #[serde(default)]
    pub show_hidden: bool,
}

fn default_list_dir_path() -> String {
    "/".to_string()
}

// -- Interactive Remote Shell --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellSpawnParams {
    #[serde(default = "default_shell_cols")]
    pub cols: u16,
    #[serde(default = "default_shell_rows")]
    pub rows: u16,
    /// Optional shell override (e.g. "powershell.exe"). Defaults to platform default.
    #[serde(default)]
    pub shell: Option<String>,
}

fn default_shell_cols() -> u16 {
    80
}
fn default_shell_rows() -> u16 {
    24
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellInputParams {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellResizeParams {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellCloseParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageParams {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender: Option<String>,
}

// ---------------------------------------------------------------------------
// Responses (agent -> controller)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum AgentResponse {
    /// Intermediate progress update for a running command.
    Progress(ProgressData),
    /// Final result of a command.
    Result(ResultData),
    /// Streaming data (e.g., packet capture chunks).
    StreamData(StreamChunk),
    /// Error executing a command.
    Error(ErrorData),
    /// Heartbeat response with system information.
    Heartbeat(HeartbeatData),
    /// Acknowledgment of Kill/SelfDestruct/Disconnect.
    Ack(AckData),
    /// User chat message over the relay command channel.
    ChatMessage(ChatMessageData),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressData {
    /// Progress percentage (0.0 - 1.0), if applicable.
    pub progress: Option<f64>,
    /// Human-readable status message.
    pub message: String,
    /// Partial result data (tool-specific JSON).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultData {
    pub success: bool,
    /// Tool-specific result as JSON value.
    pub result: serde_json::Value,
    /// Execution time in milliseconds.
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    /// Chunk sequence number.
    pub seq: u64,
    /// Base64-encoded binary data (e.g., compressed pcap data).
    pub data: String,
    /// Whether this is the final chunk.
    #[serde(default)]
    pub final_chunk: bool,
    /// Parsed packet header information for display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub packet_info: Option<PacketInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketInfo {
    pub timestamp: String,
    pub src_ip: String,
    pub dst_ip: String,
    pub protocol: String,
    pub length: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dst_port: Option<u16>,
    pub info: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tcp_flags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorData {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatData {
    pub agent_id: String,
    pub hostname: String,
    pub os: String,
    pub os_version: String,
    #[serde(default)]
    pub arch: String,
    #[serde(default)]
    pub kernel: String,
    #[serde(default)]
    pub cpus: u32,
    #[serde(default)]
    pub memory_mb: u64,
    pub uptime_secs: u64,
    pub local_ip: String,
    #[serde(default)]
    pub public_ip: Option<String>,
    #[serde(default)]
    pub gateway: Option<String>,
    pub interfaces: Vec<NetworkInterface>,
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub ip: Option<String>,
    pub mac: Option<String>,
    pub is_up: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AckData {
    pub command: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageData {
    pub text: String,
    pub sender: String,
    pub timestamp: String,
}

// ---------------------------------------------------------------------------
// Ping-specific result types (commonly used)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub host: String,
    pub resolved_ip: String,
    pub probes: Vec<PingProbe>,
    pub packets_sent: u32,
    pub packets_received: u32,
    pub packet_loss_pct: f64,
    pub min_ms: f64,
    pub avg_ms: f64,
    pub max_ms: f64,
    pub jitter_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingProbe {
    pub seq: u32,
    pub rtt_ms: Option<f64>,
    pub ttl: Option<u8>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteResult {
    pub host: String,
    pub resolved_ip: String,
    pub hops: Vec<TracerouteHop>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteHop {
    pub ttl: u8,
    pub addr: Option<String>,
    pub hostname: Option<String>,
    pub rtt_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResult {
    pub query: String,
    pub record_type: String,
    pub server: Option<String>,
    pub records: Vec<DnsRecord>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    pub record_type: String,
    pub value: String,
    pub ttl: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortScanResult {
    pub host: String,
    pub open_ports: Vec<PortInfo>,
    pub closed_count: u32,
    pub filtered_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortInfo {
    pub port: u16,
    pub state: String,
    pub service: Option<String>,
    pub banner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunResult {
    pub server: String,
    pub public_ip: String,
    pub public_port: u16,
    pub nat_type: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceScanResult {
    pub network: String,
    pub devices: Vec<DiscoveredDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub ip: String,
    pub mac: Option<String>,
    pub hostname: Option<String>,
    pub vendor: Option<String>,
    pub open_ports: Vec<u16>,
    pub banner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfoResult {
    pub hostname: String,
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub cpus: usize,
    pub memory_mb: u64,
    pub interfaces: Vec<NetworkInterface>,
    pub default_gateway: Option<String>,
    pub public_ip: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_reply_deser_result() {
        // Exact JSON the Go agent sends for a Result response
        let json = r#"{"id":"abc-123","type":"Result","data":{"success":true,"result":{"host":"8.8.8.8","resolved_ip":"8.8.8.8","probes":[],"packets_sent":4,"packets_received":4,"packet_loss_pct":0.0,"min_ms":10.0,"avg_ms":12.0,"max_ms":15.0,"jitter_ms":2.0},"elapsed_ms":500}}"#;
        let reply: AgentReply = serde_json::from_str(json).expect("should parse AgentReply");
        assert_eq!(reply.id, "abc-123");
        match reply.response {
            AgentResponse::Result(data) => {
                assert!(data.success);
                assert_eq!(data.elapsed_ms, 500);
            }
            other => panic!("expected Result, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_reply_deser_error() {
        let json = r#"{"id":"err-1","type":"Error","data":{"code":"PING_ERROR","message":"permission denied"}}"#;
        let reply: AgentReply = serde_json::from_str(json).expect("should parse AgentReply");
        assert_eq!(reply.id, "err-1");
        match reply.response {
            AgentResponse::Error(data) => {
                assert_eq!(data.code, "PING_ERROR");
                assert_eq!(data.message, "permission denied");
            }
            other => panic!("expected Error, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_reply_deser_heartbeat() {
        let json = r#"{"id":"hb-1","type":"Heartbeat","data":{"agent_id":"a1","hostname":"test","os":"darwin","os_version":"macOS","uptime_secs":60,"local_ip":"192.168.1.1","interfaces":[]}}"#;
        let reply: AgentReply = serde_json::from_str(json).expect("should parse AgentReply");
        match reply.response {
            AgentResponse::Heartbeat(hb) => {
                assert_eq!(hb.hostname, "test");
            }
            other => panic!("expected Heartbeat, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_reply_deser_stream_data() {
        let json = r#"{"id":"cap-1","type":"StreamData","data":{"seq":1,"data":"AQID","final_chunk":false}}"#;
        let reply: AgentReply = serde_json::from_str(json).expect("should parse AgentReply");
        match reply.response {
            AgentResponse::StreamData(chunk) => {
                assert_eq!(chunk.seq, 1);
                assert!(!chunk.final_chunk);
            }
            other => panic!("expected StreamData, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_message_ser() {
        // Verify the AgentMessage serializes to the format the Go agent expects
        let msg = AgentMessage::new(AgentCommand::Ping(PingParams {
            host: "8.8.8.8".to_string(),
            count: 4,
            timeout_ms: 5000,
        }));
        let json = serde_json::to_string(&msg).unwrap();
        // Should contain "command":"Ping" and "params": {...} at top level
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["command"], "Ping");
        assert_eq!(v["params"]["host"], "8.8.8.8");
        assert!(v["id"].is_string());
    }

    #[test]
    fn test_agent_message_ser_no_params() {
        let msg = AgentMessage::new(AgentCommand::SystemInfo);
        let json = serde_json::to_string(&msg).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["command"], "SystemInfo");
        // SystemInfo has no params, should not have a "params" field
        assert!(v.get("params").is_none() || v["params"].is_null());
    }
}
