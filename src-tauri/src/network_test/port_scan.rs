use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};
use tokio::net::{TcpStream, UdpSocket};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortTestEntry {
    pub port: u16,
    pub protocol: PortProtocol,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PortProtocol {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortTestConfig {
    pub host: String,
    pub entries: Vec<PortTestEntry>,
    pub timeout_ms: u64,
    pub concurrency: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortTestResult {
    pub port: u16,
    pub protocol: PortProtocol,
    pub label: Option<String>,
    pub status: PortStatus,
    pub response_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PortStatus {
    /// Definitively open — got a valid response back.
    Open,
    /// Definitively closed — connection refused (TCP) or ICMP unreachable (UDP).
    Closed,
    /// No response at all — could be firewalled or silently dropped.
    Filtered,
    /// UDP-specific: no response and no ICMP unreachable — most likely open,
    /// but indistinguishable from filtered without application-layer probing.
    /// For VoIP/SIP this is typically a pass (most UDP services don't respond
    /// to unrecognised packets).
    OpenFiltered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortScanResult {
    pub host: String,
    pub results: Vec<PortTestResult>,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for PortTestConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            entries: vec![],
            timeout_ms: 3000,
            concurrency: 20,
        }
    }
}

/// Expand a port range string like "10000-10010" into individual entries.
pub fn expand_port_range(range: &str, protocol: PortProtocol, label: Option<String>) -> Vec<PortTestEntry> {
    if let Some((start_str, end_str)) = range.split_once('-') {
        if let (Ok(start), Ok(end)) = (start_str.trim().parse::<u16>(), end_str.trim().parse::<u16>()) {
            return (start..=end)
                .map(|p| PortTestEntry {
                    port: p,
                    protocol: protocol.clone(),
                    label: label.clone(),
                })
                .collect();
        }
    }
    if let Ok(port) = range.trim().parse::<u16>() {
        return vec![PortTestEntry { port, protocol, label }];
    }
    vec![]
}

/// VoIP preset port sets.
pub fn voip_presets() -> Vec<(&'static str, Vec<PortTestEntry>)> {
    vec![
        ("SIP Signaling", vec![
            PortTestEntry { port: 5060, protocol: PortProtocol::Udp, label: Some("SIP UDP".into()) },
            PortTestEntry { port: 5060, protocol: PortProtocol::Tcp, label: Some("SIP TCP".into()) },
            PortTestEntry { port: 5061, protocol: PortProtocol::Tcp, label: Some("SIP TLS".into()) },
        ]),
        ("WebRTC", vec![
            PortTestEntry { port: 3478, protocol: PortProtocol::Udp, label: Some("STUN UDP".into()) },
            PortTestEntry { port: 3478, protocol: PortProtocol::Tcp, label: Some("STUN TCP".into()) },
            PortTestEntry { port: 5349, protocol: PortProtocol::Tcp, label: Some("STUN/TURN TLS".into()) },
            PortTestEntry { port: 443, protocol: PortProtocol::Tcp, label: Some("WSS".into()) },
        ]),
        ("Common PBX", vec![
            PortTestEntry { port: 2000, protocol: PortProtocol::Tcp, label: Some("SCCP/Skinny".into()) },
            PortTestEntry { port: 4569, protocol: PortProtocol::Udp, label: Some("IAX2".into()) },
            PortTestEntry { port: 8089, protocol: PortProtocol::Tcp, label: Some("WebSocket".into()) },
        ]),
    ]
}

/// Run port reachability tests with configurable concurrency.
#[tracing::instrument(skip_all)]
pub async fn run_port_scan(config: PortTestConfig) -> PortScanResult {
    let ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return PortScanResult {
                host: config.host,
                results: vec![],
                success: false,
                error: Some(e),
            };
        }
    };

    let timeout = Duration::from_millis(config.timeout_ms);
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(config.concurrency as usize));
    let mut handles = Vec::new();

    for entry in config.entries {
        let sem = semaphore.clone();
        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            test_port(ip, &entry, timeout).await
        });
        handles.push(handle);
    }

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(result) = handle.await {
            results.push(result);
        }
    }

    // Sort by port number
    results.sort_by_key(|r| (r.port, r.protocol == PortProtocol::Udp));

    PortScanResult {
        host: config.host,
        results,
        success: true,
        error: None,
    }
}

async fn test_port(ip: IpAddr, entry: &PortTestEntry, timeout: Duration) -> PortTestResult {
    let addr = SocketAddr::new(ip, entry.port);

    let (status, response_ms) = match entry.protocol {
        PortProtocol::Tcp => test_tcp_port(addr, timeout).await,
        PortProtocol::Udp => test_udp_port(addr, timeout).await,
    };

    PortTestResult {
        port: entry.port,
        protocol: entry.protocol.clone(),
        label: entry.label.clone(),
        status,
        response_ms,
    }
}

async fn test_tcp_port(addr: SocketAddr, timeout: Duration) -> (PortStatus, Option<f64>) {
    let start = Instant::now();
    match tokio::time::timeout(timeout, TcpStream::connect(addr)).await {
        Ok(Ok(_)) => (PortStatus::Open, Some(start.elapsed().as_secs_f64() * 1000.0)),
        Ok(Err(e)) => {
            let err = e.to_string().to_lowercase();
            if err.contains("refused") {
                (PortStatus::Closed, Some(start.elapsed().as_secs_f64() * 1000.0))
            } else {
                (PortStatus::Filtered, None)
            }
        }
        Err(_) => (PortStatus::Filtered, None),
    }
}

async fn test_udp_port(addr: SocketAddr, timeout: Duration) -> (PortStatus, Option<f64>) {
    let bind: SocketAddr = if addr.is_ipv4() {
        "0.0.0.0:0".parse().unwrap()
    } else {
        "[::]:0".parse().unwrap()
    };

    let socket = match UdpSocket::bind(bind).await {
        Ok(s) => s,
        Err(_) => return (PortStatus::Filtered, None),
    };

    let start = Instant::now();
    let payload = b"SIPalyzer port test";
    if socket.send_to(payload, addr).await.is_err() {
        return (PortStatus::Filtered, None);
    }

    let mut buf = [0u8; 512];
    match tokio::time::timeout(timeout, socket.recv_from(&mut buf)).await {
        Ok(Ok(_)) => (PortStatus::Open, Some(start.elapsed().as_secs_f64() * 1000.0)),
        Ok(Err(_)) => (PortStatus::Closed, Some(start.elapsed().as_secs_f64() * 1000.0)),
        Err(_) => {
            // UDP timeout: no response and no ICMP unreachable.
            // This typically means the port is open (most UDP services silently
            // ignore unrecognised packets) but it could also be filtered.
            // We report as open_filtered — considered a practical pass for VoIP.
            (PortStatus::OpenFiltered, None)
        }
    }
}
