//! SIP Discovery scanner — sends SIP OPTIONS/REGISTER across IP ranges and
//! collects responses to identify and fingerprint SIP devices.
//!
//! Results stream to the frontend in real time via `sip-discovery-progress` events.

use crate::sip_discovery::fingerprint::{fingerprint_device, DeviceFingerprint};
use crate::sip_discovery::ip_range;
use crate::core::user_agent;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::net::UdpSocket;
use tokio::sync::Semaphore;

// ── Global stop flag ─────────────────────────────────────────────

static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);
static SCAN_STOP: AtomicBool = AtomicBool::new(false);

pub fn stop_scan() {
    SCAN_STOP.store(true, Ordering::SeqCst);
}

pub fn is_scan_running() -> bool {
    SCAN_RUNNING.load(Ordering::SeqCst)
}

// ── Config / Result types ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanMethod {
    Options,
    Register,
    Invite,
}

impl Default for ScanMethod {
    fn default() -> Self {
        Self::Options
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanTransport {
    Udp,
    Tcp,
}

impl Default for ScanTransport {
    fn default() -> Self {
        Self::Udp
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    pub targets: String,
    pub ports: Vec<u16>,
    pub transport: ScanTransport,
    pub timeout_ms: u64,
    pub concurrency: u32,
    pub method: ScanMethod,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            targets: String::new(),
            ports: vec![5060],
            transport: ScanTransport::Udp,
            timeout_ms: 2000,
            concurrency: 20,
            method: ScanMethod::Options,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub ip: String,
    pub port: u16,
    pub transport: String,
    pub status_code: u16,
    pub user_agent: String,
    pub server_header: String,
    pub allow_header: String,
    pub contact_header: String,
    pub rtt_ms: f64,
    pub fingerprint: DeviceFingerprint,
    pub raw_response: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub devices: Vec<DiscoveredDevice>,
    pub total_ips_scanned: u32,
    pub total_ports_scanned: u32,
    pub responded_count: u32,
    pub duration_ms: u64,
    pub stopped: bool,
    pub error: Option<String>,
}

/// Per-device progress event sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgressEvent {
    /// Completed probe count so far
    pub probed: u32,
    /// Total number of probes planned
    pub total: u32,
    /// Device info if this probe got a response (null if timeout)
    pub device: Option<DiscoveredDevice>,
}

// ── Helpers ──────────────────────────────────────────────────────

fn pseudo_random() -> u64 {
    use std::sync::atomic::AtomicU64;
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut x = t.wrapping_add(c).wrapping_mul(6364136223846793005);
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x
}

fn generate_branch() -> String {
    format!("z9hG4bK{:08x}", pseudo_random() as u32)
}
fn generate_tag() -> String {
    format!("{:08x}", pseudo_random() as u32)
}
fn generate_call_id() -> String {
    format!(
        "{:08x}{:08x}@sipalyzer",
        pseudo_random() as u32,
        pseudo_random() as u32
    )
}

fn build_sip_options(
    target_host: &str,
    target_port: u16,
    local_ip: &str,
    local_port: u16,
    call_id: &str,
    branch: &str,
) -> String {
    let effective_user_agent = user_agent::get_effective_user_agent();
    format!(
        "OPTIONS sip:{}:{} SIP/2.0\r\n\
         Via: SIP/2.0/UDP {}:{};branch={};rport\r\n\
         From: <sip:scanner@{}>;tag={}\r\n\
         To: <sip:{}:{}>\r\n\
         Call-ID: {}\r\n\
         CSeq: 1 OPTIONS\r\n\
         Max-Forwards: 70\r\n\
         User-Agent: {}\r\n\
         Accept: application/sdp\r\n\
         Content-Length: 0\r\n\
         \r\n",
        target_host,
        target_port,
        local_ip,
        local_port,
        branch,
        local_ip,
        generate_tag(),
        target_host,
        target_port,
        call_id, effective_user_agent,
    )
}

fn build_sip_register(
    target_host: &str,
    _target_port: u16,
    local_ip: &str,
    local_port: u16,
    call_id: &str,
    branch: &str,
) -> String {
    let effective_user_agent = user_agent::get_effective_user_agent();
    format!(
        "REGISTER sip:{} SIP/2.0\r\n\
         Via: SIP/2.0/UDP {}:{};branch={};rport\r\n\
         From: <sip:probe@{}>;tag={}\r\n\
         To: <sip:probe@{}>\r\n\
         Call-ID: {}\r\n\
         CSeq: 1 REGISTER\r\n\
         Contact: <sip:probe@{}:{}>\r\n\
         Max-Forwards: 70\r\n\
         User-Agent: {}\r\n\
         Expires: 0\r\n\
         Content-Length: 0\r\n\
         \r\n",
        target_host,
        local_ip,
        local_port,
        branch,
        target_host,
        generate_tag(),
        target_host,
        call_id,
        local_ip,
        local_port,
        effective_user_agent,
    )
}

fn build_sip_invite(
    target_host: &str,
    target_port: u16,
    local_ip: &str,
    local_port: u16,
    call_id: &str,
    branch: &str,
) -> String {
    let effective_user_agent = user_agent::get_effective_user_agent();
    format!(
        "INVITE sip:scanner@{}:{} SIP/2.0\r\n\
         Via: SIP/2.0/UDP {}:{};branch={};rport\r\n\
         From: <sip:scanner@{}>;tag={}\r\n\
         To: <sip:scanner@{}:{}>\r\n\
         Call-ID: {}\r\n\
         CSeq: 1 INVITE\r\n\
         Max-Forwards: 70\r\n\
         User-Agent: {}\r\n\
         Content-Length: 0\r\n\
         \r\n",
        target_host,
        target_port,
        local_ip,
        local_port,
        branch,
        local_ip,
        generate_tag(),
        target_host,
        target_port,
        call_id, effective_user_agent,
    )
}

/// Parse a SIP response and extract useful headers.
fn parse_sip_response(data: &[u8]) -> Option<ParsedResponse> {
    let text = std::str::from_utf8(data).ok()?;
    if !text.starts_with("SIP/2.0 ") {
        return None;
    }

    let status_code: u16 = text[8..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()?;

    let get_header = |name: &str| -> String {
        let name_lower = name.to_lowercase();
        for line in text.lines() {
            let line_lower = line.to_lowercase();
            if line_lower.starts_with(&format!("{}:", name_lower))
                || line_lower.starts_with(&format!("{} :", name_lower))
            {
                return line
                    .splitn(2, ':')
                    .nth(1)
                    .unwrap_or("")
                    .trim()
                    .to_string();
            }
        }
        String::new()
    };

    Some(ParsedResponse {
        status_code,
        user_agent: get_header("User-Agent"),
        server: get_header("Server"),
        allow: get_header("Allow"),
        contact: get_header("Contact"),
        raw: text.to_string(),
    })
}

struct ParsedResponse {
    status_code: u16,
    user_agent: String,
    server: String,
    allow: String,
    contact: String,
    raw: String,
}

// ── Single probe ─────────────────────────────────────────────────

async fn probe_single(
    ip: IpAddr,
    port: u16,
    method: &ScanMethod,
    timeout: Duration,
) -> Option<(DiscoveredDevice, f64)> {
    let dest = SocketAddr::new(ip, port);
    let bind_addr: SocketAddr = if ip.is_ipv4() {
        "0.0.0.0:0".parse().unwrap()
    } else {
        "[::]:0".parse().unwrap()
    };

    let socket = UdpSocket::bind(bind_addr).await.ok()?;
    let local_addr = socket.local_addr().ok()?;
    let local_ip = local_addr.ip().to_string();
    let local_port = local_addr.port();

    let call_id = generate_call_id();
    let branch = generate_branch();

    let request = match method {
        ScanMethod::Options => {
            build_sip_options(&ip.to_string(), port, &local_ip, local_port, &call_id, &branch)
        }
        ScanMethod::Register => {
            build_sip_register(&ip.to_string(), port, &local_ip, local_port, &call_id, &branch)
        }
        ScanMethod::Invite => {
            build_sip_invite(&ip.to_string(), port, &local_ip, local_port, &call_id, &branch)
        }
    };

    let start = Instant::now();
    socket.send_to(request.as_bytes(), dest).await.ok()?;

    let mut buf = [0u8; 4096];
    let (len, _) = match tokio::time::timeout(timeout, socket.recv_from(&mut buf)).await {
        Ok(Ok(result)) => result,
        _ => return None,
    };
    let rtt_ms = start.elapsed().as_secs_f64() * 1000.0;

    let parsed = parse_sip_response(&buf[..len])?;
    let fingerprint = fingerprint_device(&parsed.user_agent, &parsed.server);

    let device = DiscoveredDevice {
        ip: ip.to_string(),
        port,
        transport: "UDP".to_string(),
        status_code: parsed.status_code,
        user_agent: parsed.user_agent,
        server_header: parsed.server,
        allow_header: parsed.allow,
        contact_header: parsed.contact,
        rtt_ms,
        fingerprint,
        raw_response: parsed.raw,
    };

    Some((device, rtt_ms))
}

// ── Main scan entry point ────────────────────────────────────────

#[tracing::instrument(skip_all, name = "sip_discovery.scan")]
pub async fn run_scan(window: tauri::Window, config: ScanConfig) -> ScanResult {
    tracing::info!(targets = %config.targets, method = ?config.method, "Starting SIP discovery scan");
    // Prevent concurrent scans
    if SCAN_RUNNING.swap(true, Ordering::SeqCst) {
        return ScanResult {
            devices: vec![],
            total_ips_scanned: 0,
            total_ports_scanned: 0,
            responded_count: 0,
            duration_ms: 0,
            stopped: false,
            error: Some("A scan is already running".to_string()),
        };
    }
    SCAN_STOP.store(false, Ordering::SeqCst);

    let start = Instant::now();

    // Expand targets
    let ips = match ip_range::expand_targets(&config.targets) {
        Ok(ips) => ips,
        Err(e) => {
            SCAN_RUNNING.store(false, Ordering::SeqCst);
            return ScanResult {
                devices: vec![],
                total_ips_scanned: 0,
                total_ports_scanned: 0,
                responded_count: 0,
                duration_ms: 0,
                stopped: false,
                error: Some(e),
            };
        }
    };

    let total_ips = ips.len() as u32;
    let ports = if config.ports.is_empty() {
        vec![5060]
    } else {
        config.ports.clone()
    };
    let total_probes = total_ips * ports.len() as u32;
    let timeout = Duration::from_millis(config.timeout_ms);
    let semaphore = Arc::new(Semaphore::new(config.concurrency as usize));
    let probed_count = Arc::new(AtomicU32::new(0));

    // Collect device results via a shared vec behind a mutex
    let devices = Arc::new(tokio::sync::Mutex::new(Vec::<DiscoveredDevice>::new()));

    let mut handles = Vec::new();

    for ip in &ips {
        for &port in &ports {
            if SCAN_STOP.load(Ordering::SeqCst) {
                break;
            }

            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let ip = *ip;
            let method = config.method.clone();
            let window_clone = window.clone();
            let probed = probed_count.clone();
            let devices_clone = devices.clone();

            handles.push(tokio::spawn(async move {
                let _permit = permit; // held until task completes

                if SCAN_STOP.load(Ordering::SeqCst) {
                    let count = probed.fetch_add(1, Ordering::Relaxed) + 1;
                    let _ = window_clone.emit(
                        "sip-discovery-progress",
                        ScanProgressEvent {
                            probed: count,
                            total: total_probes,
                            device: None,
                        },
                    );
                    return;
                }

                let result = probe_single(ip, port, &method, timeout).await;

                let count = probed.fetch_add(1, Ordering::Relaxed) + 1;

                if let Some((device, _rtt)) = result {
                    let mut devs = devices_clone.lock().await;
                    devs.push(device.clone());
                    let _ = window_clone.emit(
                        "sip-discovery-progress",
                        ScanProgressEvent {
                            probed: count,
                            total: total_probes,
                            device: Some(device),
                        },
                    );
                } else {
                    let _ = window_clone.emit(
                        "sip-discovery-progress",
                        ScanProgressEvent {
                            probed: count,
                            total: total_probes,
                            device: None,
                        },
                    );
                }
            }));
        }

        if SCAN_STOP.load(Ordering::SeqCst) {
            break;
        }
    }

    // Wait for all probes to complete
    for handle in handles {
        let _ = handle.await;
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    let final_devices = devices.lock().await.clone();
    let responded_count = final_devices.len() as u32;
    let stopped = SCAN_STOP.load(Ordering::SeqCst);

    SCAN_RUNNING.store(false, Ordering::SeqCst);

    ScanResult {
        devices: final_devices,
        total_ips_scanned: total_ips,
        total_ports_scanned: total_probes,
        responded_count,
        duration_ms,
        stopped,
        error: None,
    }
}
