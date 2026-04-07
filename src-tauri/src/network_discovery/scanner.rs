//! Network Devices scanner — orchestrates ARP sweeps, port scans, banner grabs,
//! reverse DNS, and SIP probes across IP ranges to discover and fingerprint
//! all devices on the network.
//!
//! Results stream to the frontend in real time via `network-devices-progress` events.

use crate::core::user_agent;
use crate::network_discovery::arp;
use crate::network_discovery::banner;
use crate::network_discovery::fingerprint::{fingerprint_device, DeviceFingerprint, DeviceType};
use crate::network_discovery::ip_range;
use crate::network_discovery::oui;
use crate::network_discovery::rdns;
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

// ── Scan Mode ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanMode {
    Quick,
    Sip,
    Full,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanEnrichmentPreset {
    Fast,
    Balanced,
    Deep,
}

impl Default for ScanEnrichmentPreset {
    fn default() -> Self {
        Self::Balanced
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanEnrichmentFlags {
    pub rdns: bool,
    pub fingerprint: bool,
    pub port_scan: bool,
    pub banner_grab: bool,
}

impl Default for ScanEnrichmentFlags {
    fn default() -> Self {
        Self {
            rdns: true,
            fingerprint: true,
            port_scan: true,
            banner_grab: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanPhase {
    Discovering,
    Enriching,
    Fingerprinting,
    Finalizing,
}

impl Default for ScanMode {
    fn default() -> Self {
        Self::Quick
    }
}

// ── Discovery Method ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiscoveryMethod {
    Arp,
    Sip,
    Both,
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
    pub scan_mode: ScanMode,
    pub enrichment_preset: ScanEnrichmentPreset,
    pub enrichment_flags: ScanEnrichmentFlags,
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
            scan_mode: ScanMode::Quick,
            enrichment_preset: ScanEnrichmentPreset::Balanced,
            enrichment_flags: ScanEnrichmentFlags::default(),
        }
    }
}

// ── SIP-specific device info (sub-struct) ────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipDeviceInfo {
    pub port: u16,
    pub transport: String,
    pub status_code: u16,
    pub user_agent: String,
    pub server_header: String,
    pub allow_header: String,
    pub contact_header: String,
    pub fingerprint: DeviceFingerprint,
    pub raw_response: String,
}

// ── Unified Device Model ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    // General (from ARP + port scan)
    pub ip: String,
    pub mac_address: Option<String>,
    pub oui_vendor: Option<String>,
    pub hostname: Option<String>,
    pub open_ports: Vec<banner::OpenPort>,
    // SIP-specific (from SIP probe, may be None)
    pub sip: Option<SipDeviceInfo>,
    // Common
    pub rtt_ms: Option<f64>,
    pub discovery_method: DiscoveryMethod,

    // ── Legacy compatibility fields ──────────────────────────────
    // These mirror the old flat DiscoveredDevice shape so existing
    // frontend code can still render them without breaking.
    // They are derived from `sip` when present, or defaults otherwise.
    pub port: u16,
    pub transport: String,
    pub status_code: u16,
    pub user_agent: String,
    pub server_header: String,
    pub allow_header: String,
    pub contact_header: String,
    pub fingerprint: DeviceFingerprint,
    pub raw_response: String,
}

impl DiscoveredDevice {
    /// Create a device from generic host discovery (no ARP/SIP yet).
    pub fn from_host(ip: String) -> Self {
        Self {
            ip,
            mac_address: None,
            oui_vendor: None,
            hostname: None,
            open_ports: vec![],
            sip: None,
            rtt_ms: None,
            discovery_method: DiscoveryMethod::Arp,
            // Legacy compat
            port: 0,
            transport: String::new(),
            status_code: 0,
            user_agent: String::new(),
            server_header: String::new(),
            allow_header: String::new(),
            contact_header: String::new(),
            fingerprint: DeviceFingerprint::default(),
            raw_response: String::new(),
        }
    }

    /// Create a device from an ARP-only discovery (no SIP).
    pub fn from_arp(ip: String, mac: String, vendor: Option<String>) -> Self {
        Self {
            ip,
            mac_address: Some(mac),
            oui_vendor: vendor,
            hostname: None,
            open_ports: vec![],
            sip: None,
            rtt_ms: None,
            discovery_method: DiscoveryMethod::Arp,
            // Legacy compat
            port: 0,
            transport: String::new(),
            status_code: 0,
            user_agent: String::new(),
            server_header: String::new(),
            allow_header: String::new(),
            contact_header: String::new(),
            fingerprint: DeviceFingerprint::default(),
            raw_response: String::new(),
        }
    }

    /// Create a device from a SIP probe response (legacy-compatible).
    pub fn from_sip(ip: String, sip_info: SipDeviceInfo, rtt_ms: f64) -> Self {
        Self {
            ip,
            mac_address: None,
            oui_vendor: None,
            hostname: None,
            open_ports: vec![],
            // Legacy compat — copy from SIP info
            port: sip_info.port,
            transport: sip_info.transport.clone(),
            status_code: sip_info.status_code,
            user_agent: sip_info.user_agent.clone(),
            server_header: sip_info.server_header.clone(),
            allow_header: sip_info.allow_header.clone(),
            contact_header: sip_info.contact_header.clone(),
            fingerprint: sip_info.fingerprint.clone(),
            raw_response: sip_info.raw_response.clone(),
            // Actual fields
            sip: Some(sip_info),
            rtt_ms: Some(rtt_ms),
            discovery_method: DiscoveryMethod::Sip,
        }
    }

    /// Merge ARP info into an existing SIP-discovered device.
    pub fn merge_arp(&mut self, mac: String, vendor: Option<String>) {
        self.mac_address = Some(mac);
        self.oui_vendor = vendor;
        self.discovery_method = DiscoveryMethod::Both;
    }

    /// Add hostname from reverse DNS.
    pub fn set_hostname(&mut self, hostname: String) {
        self.hostname = Some(hostname);
    }

    /// Add open ports from port scan.
    pub fn set_open_ports(&mut self, ports: Vec<banner::OpenPort>) {
        self.open_ports = ports;
    }
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
    pub scan_mode: ScanMode,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<ScanPhase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_probed: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_total: Option<u32>,
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

fn infer_device_type(vendor: &str, hostname: &str, open_ports: &[banner::OpenPort]) -> DeviceType {
    let vendor_l = vendor.to_lowercase();
    let host_l = hostname.to_lowercase();
    let service_l = open_ports
        .iter()
        .map(|p| {
            format!(
                "{} {}",
                p.service_name.to_lowercase(),
                p.banner.to_lowercase()
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    let signal = format!("{} {} {}", vendor_l, host_l, service_l);
    let has_port = |port: u16| open_ports.iter().any(|p| p.port == port);
    let has_any = |ports: &[u16]| ports.iter().any(|p| has_port(*p));
    let mut best: (DeviceType, u16) = (DeviceType::Unknown, 0);
    let update_best = |best: &mut (DeviceType, u16), kind: DeviceType, score: u16| {
        if score > best.1 {
            *best = (kind, score);
        }
    };

    if signal.contains("opensips")
        || signal.contains("kamailio")
        || signal.contains("sip proxy")
        || signal.contains("proxy")
    {
        update_best(&mut best, DeviceType::Proxy, 92);
    }
    if signal.contains("session border")
        || signal.contains(" s-bc")
        || signal.contains(" sbc")
        || signal.contains("oracle communications")
    {
        update_best(&mut best, DeviceType::Sbc, 92);
    }
    if signal.contains("asterisk")
        || signal.contains("freepbx")
        || signal.contains("3cx")
        || signal.contains("freeswitch")
        || signal.contains("pbx")
        || (has_any(&[5060, 5061]) && has_any(&[8088, 8089, 10000, 2000]))
    {
        update_best(&mut best, DeviceType::Pbx, 90);
    }
    if signal.contains("linphone")
        || signal.contains("microsip")
        || signal.contains("zoiper")
        || signal.contains("bria")
    {
        update_best(&mut best, DeviceType::Softphone, 90);
    }
    if signal.contains("yealink")
        || signal.contains("polycom")
        || signal.contains("grandstream")
        || signal.contains("fanvil")
        || signal.contains("avaya")
        || signal.contains("mitel")
        || signal.contains(" snom")
        || signal.contains(" voip")
    {
        update_best(&mut best, DeviceType::Phone, 88);
    }
    if signal.contains("switch")
        || signal.contains("catalyst")
        || signal.contains("procurve")
        || signal.contains("aruba")
        || signal.contains("netgear")
    {
        update_best(&mut best, DeviceType::Switch, 84);
    }
    if signal.contains("access point")
        || signal.contains("wireless")
        || signal.contains("wifi")
        || signal.contains("wlan")
        || signal.contains("unifi ap")
    {
        update_best(&mut best, DeviceType::AccessPoint, 84);
    }
    if signal.contains("router")
        || signal.contains("gateway")
        || signal.contains("firewall")
        || signal.contains("fortigate")
        || signal.contains("palo alto")
        || signal.contains("mikrotik")
    {
        update_best(&mut best, DeviceType::Router, 86);
    }
    if signal.contains("nas")
        || signal.contains("synology")
        || signal.contains("qnap")
        || signal.contains("truenas")
        || (has_any(&[5000, 5001, 2049]) && has_any(&[445, 139]))
    {
        update_best(&mut best, DeviceType::Nas, 85);
    }
    if signal.contains("printer")
        || signal.contains("hp ")
        || signal.contains("brother")
        || signal.contains("epson")
        || signal.contains("xerox")
        || has_any(&[515, 631, 9100])
    {
        update_best(&mut best, DeviceType::Printer, 83);
    }
    if signal.contains("camera")
        || signal.contains("hikvision")
        || signal.contains("dahua")
        || signal.contains("axis")
        || signal.contains("cctv")
        || has_any(&[554, 8554])
    {
        update_best(&mut best, DeviceType::Camera, 83);
    }
    if signal.contains("server")
        || signal.contains("esxi")
        || signal.contains("proxmox")
        || has_any(&[1433, 1521, 3306, 5432, 6379, 9200, 27017])
    {
        update_best(&mut best, DeviceType::Server, 78);
    }
    if signal.contains("dell")
        || signal.contains("lenovo")
        || signal.contains("hewlett")
        || signal.contains("hp inc")
        || signal.contains("intel")
        || signal.contains("microsoft")
        || signal.contains("apple")
        || signal.contains("asus")
        || signal.contains("acer")
        || signal.contains("laptop")
        || signal.contains("desktop")
        || signal.contains("workstation")
        || has_any(&[3389, 5900, 445])
    {
        update_best(&mut best, DeviceType::Computer, 74);
    }
    if signal.contains("sonos")
        || signal.contains("roku")
        || signal.contains("chromecast")
        || signal.contains("amazon")
        || signal.contains("google")
        || signal.contains("tuya")
        || signal.contains("shelly")
        || signal.contains("espressif")
        || signal.contains("raspberry")
        || signal.contains("iot")
    {
        update_best(&mut best, DeviceType::Iot, 70);
    }
    if has_any(&[5060, 5061]) {
        update_best(&mut best, DeviceType::Gateway, 64);
    }

    // Avoid overconfident guesses from weak evidence.
    if best.1 >= 64 {
        best.0
    } else {
        DeviceType::Unknown
    }
}

fn enrich_device_fingerprint(device: &mut DiscoveredDevice, enabled: bool) {
    if !enabled {
        return;
    }
    if device.fingerprint.vendor.is_empty() {
        if let Some(vendor) = &device.oui_vendor {
            device.fingerprint.vendor = vendor.clone();
        }
    }

    if device.fingerprint.device_type != DeviceType::Unknown {
        return;
    }

    let vendor_hint = device
        .oui_vendor
        .as_deref()
        .unwrap_or(device.fingerprint.vendor.as_str());
    let hostname_hint = device.hostname.as_deref().unwrap_or("");
    let inferred = infer_device_type(vendor_hint, hostname_hint, &device.open_ports);
    if inferred != DeviceType::Unknown {
        device.fingerprint.device_type = inferred;
    }
}

fn phase_label(phase: ScanPhase) -> String {
    match phase {
        ScanPhase::Discovering => "Discovering hosts".to_string(),
        ScanPhase::Enriching => "Enriching host metadata".to_string(),
        ScanPhase::Fingerprinting => "Fingerprinting services".to_string(),
        ScanPhase::Finalizing => "Finalizing results".to_string(),
    }
}

fn apply_enrichment_preset(config: &mut ScanConfig) {
    let preset_flags = match config.enrichment_preset {
        ScanEnrichmentPreset::Fast => ScanEnrichmentFlags {
            rdns: false,
            fingerprint: true,
            port_scan: false,
            banner_grab: false,
        },
        ScanEnrichmentPreset::Balanced => ScanEnrichmentFlags {
            rdns: true,
            fingerprint: true,
            port_scan: true,
            banner_grab: false,
        },
        ScanEnrichmentPreset::Deep => ScanEnrichmentFlags {
            rdns: true,
            fingerprint: true,
            port_scan: true,
            banner_grab: true,
        },
    };
    config.enrichment_flags = preset_flags;
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
        call_id,
        effective_user_agent,
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
        call_id,
        effective_user_agent,
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
                return line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
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

// ── Single SIP probe ─────────────────────────────────────────────

async fn probe_sip_single(
    ip: IpAddr,
    port: u16,
    method: &ScanMethod,
    timeout: Duration,
) -> Option<(SipDeviceInfo, f64)> {
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
        ScanMethod::Options => build_sip_options(
            &ip.to_string(),
            port,
            &local_ip,
            local_port,
            &call_id,
            &branch,
        ),
        ScanMethod::Register => build_sip_register(
            &ip.to_string(),
            port,
            &local_ip,
            local_port,
            &call_id,
            &branch,
        ),
        ScanMethod::Invite => build_sip_invite(
            &ip.to_string(),
            port,
            &local_ip,
            local_port,
            &call_id,
            &branch,
        ),
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

    let sip_info = SipDeviceInfo {
        port,
        transport: "UDP".to_string(),
        status_code: parsed.status_code,
        user_agent: parsed.user_agent,
        server_header: parsed.server,
        allow_header: parsed.allow,
        contact_header: parsed.contact,
        fingerprint,
        raw_response: parsed.raw,
    };

    Some((sip_info, rtt_ms))
}

// ── Quick Scan (ARP only) ────────────────────────────────────────

async fn run_quick_scan(
    window: tauri::Window,
    config: &ScanConfig,
    ips: Vec<IpAddr>,
) -> Vec<DiscoveredDevice> {
    let total = ips.len() as u32;
    let probed_count = Arc::new(AtomicU32::new(0));

    // Phase 1: ARP sweep
    let arp_results = arp::arp_sweep(&ips).await;

    let mut devices = Vec::new();
    for entry in &arp_results {
        if SCAN_STOP.load(Ordering::SeqCst) {
            break;
        }

        let vendor = oui::lookup_oui(&entry.mac);
        let mut device = DiscoveredDevice::from_arp(entry.ip.clone(), entry.mac.clone(), vendor);
        enrich_device_fingerprint(&mut device, config.enrichment_flags.fingerprint);

        let count = probed_count.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = window.emit(
            "network-devices-progress",
            ScanProgressEvent {
                probed: count,
                total,
                device: Some(device.clone()),
                phase: Some(ScanPhase::Discovering),
                phase_label: Some(phase_label(ScanPhase::Discovering)),
                phase_probed: Some(count),
                phase_total: Some(total),
            },
        );

        devices.push(device);
    }

    if SCAN_STOP.load(Ordering::SeqCst) || devices.is_empty() {
        return devices;
    }

    // Phase 2: Quick rDNS for discovered hosts to populate hostnames
    let alive_ips: Vec<IpAddr> = devices
        .iter()
        .filter_map(|d| d.ip.parse::<IpAddr>().ok())
        .collect();

    if config.enrichment_flags.rdns {
        let rdns_results = rdns::batch_reverse_lookup(&alive_ips, 20).await;
        for (idx, (ip, hostname)) in rdns_results.iter().enumerate() {
            if let Some(device) = devices.iter_mut().find(|d| d.ip == ip.to_string()) {
                if let Some(name) = hostname {
                    device.set_hostname(name.clone());
                    enrich_device_fingerprint(device, config.enrichment_flags.fingerprint);
                }
            }
            let phase_count = (idx as u32).saturating_add(1);
            let _ = window.emit(
                "network-devices-progress",
                ScanProgressEvent {
                    probed: total,
                    total,
                    device: None,
                    phase: Some(ScanPhase::Enriching),
                    phase_label: Some(phase_label(ScanPhase::Enriching)),
                    phase_probed: Some(phase_count),
                    phase_total: Some(alive_ips.len() as u32),
                },
            );
        }
    }

    // Re-emit devices with hostnames populated
    for device in &devices {
        let _ = window.emit(
            "network-devices-progress",
            ScanProgressEvent {
                probed: total,
                total,
                device: Some(device.clone()),
                phase: Some(ScanPhase::Finalizing),
                phase_label: Some(phase_label(ScanPhase::Finalizing)),
                phase_probed: Some(total),
                phase_total: Some(total),
            },
        );
    }

    devices
}

// ── SIP Scan (existing behavior) ─────────────────────────────────

async fn run_sip_scan(
    window: tauri::Window,
    config: &ScanConfig,
    ips: &[IpAddr],
) -> Vec<DiscoveredDevice> {
    use std::collections::HashMap;
    let ports = if config.ports.is_empty() {
        vec![5060]
    } else {
        config.ports.clone()
    };
    let arp_total = ips.len() as u32;
    let timeout = Duration::from_millis(config.timeout_ms);
    let semaphore = Arc::new(Semaphore::new(config.concurrency as usize));
    let probed_count = Arc::new(AtomicU32::new(0));
    let sip_stage_count = Arc::new(AtomicU32::new(0));
    let mut device_map: HashMap<String, DiscoveredDevice> = HashMap::new();

    // Phase 1: ARP discovery first so Service mode always yields useful baseline hosts.
    let arp_results = arp::arp_sweep(ips).await;
    for entry in &arp_results {
        if SCAN_STOP.load(Ordering::SeqCst) {
            break;
        }
        let vendor = oui::lookup_oui(&entry.mac);
        let mut device = DiscoveredDevice::from_arp(entry.ip.clone(), entry.mac.clone(), vendor);
        enrich_device_fingerprint(&mut device, config.enrichment_flags.fingerprint);

        let count = probed_count.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = window.emit(
            "network-devices-progress",
            ScanProgressEvent {
                probed: count,
                total: arp_total,
                device: Some(device.clone()),
                phase: Some(ScanPhase::Discovering),
                phase_label: Some(phase_label(ScanPhase::Discovering)),
                phase_probed: Some(count),
                phase_total: Some(arp_total),
            },
        );
        device_map.insert(entry.ip.clone(), device);
    }

    if SCAN_STOP.load(Ordering::SeqCst) {
        return device_map.into_values().collect();
    }

    let discovered_ips: Vec<IpAddr> = device_map
        .keys()
        .filter_map(|ip| ip.parse::<IpAddr>().ok())
        .collect();
    let sip_targets: Vec<IpAddr> = if discovered_ips.is_empty() {
        ips.to_vec()
    } else {
        discovered_ips
    };
    let sip_total = (sip_targets.len() as u32).saturating_mul(ports.len() as u32);
    let overall_total = arp_total.saturating_add(sip_total);
    let devices = Arc::new(tokio::sync::Mutex::new(device_map));

    let mut handles = Vec::new();

    for ip in &sip_targets {
        for &port in &ports {
            if SCAN_STOP.load(Ordering::SeqCst) {
                break;
            }

            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let ip = *ip;
            let method = config.method.clone();
            let window_clone = window.clone();
            let probed = probed_count.clone();
            let sip_stage = sip_stage_count.clone();
            let devices_clone = devices.clone();

            handles.push(tokio::spawn(async move {
                let _permit = permit;

                if SCAN_STOP.load(Ordering::SeqCst) {
                    let stage_count = sip_stage.fetch_add(1, Ordering::Relaxed) + 1;
                    let count = probed.fetch_add(1, Ordering::Relaxed) + 1;
                    let _ = window_clone.emit(
                        "network-devices-progress",
                        ScanProgressEvent {
                            probed: count,
                            total: overall_total,
                            device: None,
                            phase: Some(ScanPhase::Fingerprinting),
                            phase_label: Some(phase_label(ScanPhase::Fingerprinting)),
                            phase_probed: Some(stage_count),
                            phase_total: Some(sip_total),
                        },
                    );
                    return;
                }

                let result = probe_sip_single(ip, port, &method, timeout).await;
                let stage_count = sip_stage.fetch_add(1, Ordering::Relaxed) + 1;
                let count = probed.fetch_add(1, Ordering::Relaxed) + 1;

                if let Some((sip_info, rtt)) = result {
                    let ip_str = ip.to_string();
                    let mut devs = devices_clone.lock().await;
                    let out = if let Some(existing) = devs.get_mut(&ip_str) {
                        // Merge repeated SIP responses on different ports into one device.
                        existing.sip = Some(sip_info.clone());
                        existing.rtt_ms = Some(existing.rtt_ms.map_or(rtt, |v| v.min(rtt)));
                        existing.discovery_method = DiscoveryMethod::Sip;
                        existing.port = sip_info.port;
                        existing.transport = sip_info.transport.clone();
                        existing.status_code = sip_info.status_code;
                        existing.user_agent = sip_info.user_agent.clone();
                        existing.server_header = sip_info.server_header.clone();
                        existing.allow_header = sip_info.allow_header.clone();
                        existing.contact_header = sip_info.contact_header.clone();
                        existing.fingerprint = sip_info.fingerprint.clone();
                        existing.raw_response = sip_info.raw_response.clone();
                        existing.clone()
                    } else {
                        let device = DiscoveredDevice::from_sip(ip_str.clone(), sip_info, rtt);
                        devs.insert(ip_str, device.clone());
                        device
                    };
                    let _ = window_clone.emit(
                        "network-devices-progress",
                        ScanProgressEvent {
                            probed: count,
                            total: overall_total,
                            device: Some(out),
                            phase: Some(ScanPhase::Fingerprinting),
                            phase_label: Some(phase_label(ScanPhase::Fingerprinting)),
                            phase_probed: Some(stage_count),
                            phase_total: Some(sip_total),
                        },
                    );
                } else {
                    let _ = window_clone.emit(
                        "network-devices-progress",
                        ScanProgressEvent {
                            probed: count,
                            total: overall_total,
                            device: None,
                            phase: Some(ScanPhase::Fingerprinting),
                            phase_label: Some(phase_label(ScanPhase::Fingerprinting)),
                            phase_probed: Some(stage_count),
                            phase_total: Some(sip_total),
                        },
                    );
                }
            }));
        }

        if SCAN_STOP.load(Ordering::SeqCst) {
            break;
        }
    }

    for handle in handles {
        let _ = handle.await;
    }

    let result = devices.lock().await;
    result.values().cloned().collect()
}

// ── Full Scan (ARP + ports + rDNS + SIP) ─────────────────────────

async fn run_full_scan(
    window: tauri::Window,
    config: &ScanConfig,
    ips: Vec<IpAddr>,
) -> Vec<DiscoveredDevice> {
    use std::collections::HashMap;

    let total_phases = 4u32; // ARP, rDNS, ports, SIP
    let total_ips = ips.len() as u32;
    let approx_total = total_ips * total_phases;
    let probed_count = Arc::new(AtomicU32::new(0));
    let timeout = Duration::from_millis(config.timeout_ms);

    // Phase 1: ARP sweep
    let arp_results = arp::arp_sweep(&ips).await;
    let mut device_map: HashMap<String, DiscoveredDevice> = HashMap::new();

    for entry in &arp_results {
        if SCAN_STOP.load(Ordering::SeqCst) {
            break;
        }

        let vendor = oui::lookup_oui(&entry.mac);
        let mut device = DiscoveredDevice::from_arp(entry.ip.clone(), entry.mac.clone(), vendor);
        enrich_device_fingerprint(&mut device, config.enrichment_flags.fingerprint);

        let count = probed_count.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = window.emit(
            "network-devices-progress",
            ScanProgressEvent {
                probed: count,
                total: approx_total,
                device: Some(device.clone()),
                phase: Some(ScanPhase::Discovering),
                phase_label: Some(phase_label(ScanPhase::Discovering)),
                phase_probed: Some(count),
                phase_total: Some(total_ips),
            },
        );

        device_map.insert(entry.ip.clone(), device);
    }

    if SCAN_STOP.load(Ordering::SeqCst) {
        return device_map.into_values().collect();
    }

    // Phase 2: Reverse DNS.
    // For reasonable target sizes, query all targets so we can learn hostnames
    // even when ARP is filtered/silent. For huge ranges, keep this bounded.
    let alive_ips: Vec<IpAddr> = arp_results
        .iter()
        .filter_map(|e| e.ip.parse::<IpAddr>().ok())
        .collect();
    let rdns_targets: Vec<IpAddr> = if ips.len() <= 1024 {
        ips.clone()
    } else {
        alive_ips.clone()
    };

    if config.enrichment_flags.rdns {
        let rdns_results = rdns::batch_reverse_lookup(&rdns_targets, 20).await;
        for (idx, (ip, hostname)) in rdns_results.iter().enumerate() {
            let ip_str = ip.to_string();
            if let Some(device) = device_map.get_mut(&ip_str) {
                if let Some(name) = hostname {
                    device.set_hostname(name.clone());
                    enrich_device_fingerprint(device, config.enrichment_flags.fingerprint);
                }
            } else if let Some(name) = hostname {
                let mut device = DiscoveredDevice::from_host(ip_str.clone());
                device.set_hostname(name.clone());
                enrich_device_fingerprint(&mut device, config.enrichment_flags.fingerprint);
                device_map.insert(ip_str, device);
            }
            let count = probed_count.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = window.emit(
                "network-devices-progress",
                ScanProgressEvent {
                    probed: count,
                    total: approx_total,
                    device: None,
                    phase: Some(ScanPhase::Enriching),
                    phase_label: Some(phase_label(ScanPhase::Enriching)),
                    phase_probed: Some((idx as u32).saturating_add(1)),
                    phase_total: Some(rdns_targets.len() as u32),
                },
            );
        }
    }

    if SCAN_STOP.load(Ordering::SeqCst) {
        return device_map.into_values().collect();
    }

    // Phase 3: Port scan + banner grab.
    // For practical-sized scans, probe all targets to discover hosts that do
    // not answer ARP but expose TCP services.
    let scan_ports = if config.enrichment_flags.banner_grab {
        banner::FULL_SCAN_PORTS
    } else {
        &[5060, 5061, 80, 443, 22]
    };
    let port_targets: Vec<IpAddr> = if ips.len() <= 2048 {
        ips.clone()
    } else {
        alive_ips.clone()
    };
    if config.enrichment_flags.port_scan {
        let port_targets_total = port_targets.len() as u32;
        let host_semaphore = Arc::new(tokio::sync::Semaphore::new(8));
        let port_results: Arc<tokio::sync::Mutex<Vec<(String, Vec<banner::OpenPort>)>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let mut port_handles = Vec::new();

        for ip in &port_targets {
            if SCAN_STOP.load(Ordering::SeqCst) {
                break;
            }
            let ip_val = *ip;
            let sem = host_semaphore.clone();
            let results = port_results.clone();
            let t = timeout;
            let pc = probed_count.clone();
            let w = window.clone();
            let at = approx_total;

            port_handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await;
                let open = banner::scan_ports(ip_val, scan_ports, t, 10).await;
                let count = pc.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = w.emit(
                    "network-devices-progress",
                    ScanProgressEvent {
                        probed: count,
                        total: at,
                        device: None,
                        phase: Some(ScanPhase::Fingerprinting),
                        phase_label: Some(phase_label(ScanPhase::Fingerprinting)),
                        phase_probed: Some(count),
                        phase_total: Some(port_targets_total),
                    },
                );
                if !open.is_empty() {
                    results.lock().await.push((ip_val.to_string(), open));
                }
            }));
        }

        for h in port_handles {
            let _ = h.await;
        }

        let port_data = port_results.lock().await;
        for (ip_str, open_ports) in port_data.iter() {
            if let Some(device) = device_map.get_mut(ip_str) {
                device.set_open_ports(open_ports.clone());
                enrich_device_fingerprint(device, config.enrichment_flags.fingerprint);
            } else {
                let mut device = DiscoveredDevice::from_host(ip_str.clone());
                device.set_open_ports(open_ports.clone());
                enrich_device_fingerprint(&mut device, config.enrichment_flags.fingerprint);
                device_map.insert(ip_str.clone(), device.clone());
                let _ = window.emit(
                    "network-devices-progress",
                    ScanProgressEvent {
                        probed: probed_count.load(Ordering::Relaxed),
                        total: approx_total,
                        device: Some(device),
                        phase: Some(ScanPhase::Fingerprinting),
                        phase_label: Some(phase_label(ScanPhase::Fingerprinting)),
                        phase_probed: Some(probed_count.load(Ordering::Relaxed)),
                        phase_total: Some(port_targets_total),
                    },
                );
            }
        }
    }

    if SCAN_STOP.load(Ordering::SeqCst) {
        return device_map.into_values().collect();
    }

    // Phase 4: SIP probe on SIP ports.
    // Probe full target set for moderate ranges, else only discovered hosts.
    let sip_ports: Vec<u16> = if config.ports.is_empty() {
        vec![5060]
    } else {
        config.ports.clone()
    };
    let sip_targets: Vec<IpAddr> = if ips.len() <= 1024 {
        ips.clone()
    } else {
        device_map
            .keys()
            .filter_map(|ip| ip.parse::<IpAddr>().ok())
            .collect()
    };

    for ip in &sip_targets {
        if SCAN_STOP.load(Ordering::SeqCst) {
            break;
        }

        for &port in &sip_ports {
            if let Some((sip_info, rtt)) =
                probe_sip_single(*ip, port, &config.method, timeout).await
            {
                let ip_str = ip.to_string();
                if let Some(device) = device_map.get_mut(&ip_str) {
                    // Merge SIP info into existing ARP-discovered device
                    device.sip = Some(sip_info.clone());
                    device.rtt_ms = Some(rtt);
                    device.discovery_method = DiscoveryMethod::Both;
                    // Update legacy compat fields
                    device.port = sip_info.port;
                    device.transport = sip_info.transport.clone();
                    device.status_code = sip_info.status_code;
                    device.user_agent = sip_info.user_agent.clone();
                    device.server_header = sip_info.server_header.clone();
                    device.allow_header = sip_info.allow_header.clone();
                    device.contact_header = sip_info.contact_header.clone();
                    device.fingerprint = sip_info.fingerprint.clone();
                    device.raw_response = sip_info.raw_response.clone();
                    enrich_device_fingerprint(device, config.enrichment_flags.fingerprint);

                    let _ = window.emit(
                        "network-devices-progress",
                        ScanProgressEvent {
                            probed: probed_count.load(Ordering::Relaxed),
                            total: approx_total,
                            device: Some(device.clone()),
                            phase: Some(ScanPhase::Finalizing),
                            phase_label: Some(phase_label(ScanPhase::Finalizing)),
                            phase_probed: Some(probed_count.load(Ordering::Relaxed)),
                            phase_total: Some(approx_total),
                        },
                    );
                } else {
                    // New SIP-only device not found via ARP
                    let device = DiscoveredDevice::from_sip(ip_str.clone(), sip_info, rtt);
                    let _ = window.emit(
                        "network-devices-progress",
                        ScanProgressEvent {
                            probed: probed_count.load(Ordering::Relaxed),
                            total: approx_total,
                            device: Some(device.clone()),
                            phase: Some(ScanPhase::Finalizing),
                            phase_label: Some(phase_label(ScanPhase::Finalizing)),
                            phase_probed: Some(probed_count.load(Ordering::Relaxed)),
                            phase_total: Some(approx_total),
                        },
                    );
                    device_map.insert(ip_str, device);
                }
            }
        }

        let count = probed_count.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = window.emit(
            "network-devices-progress",
            ScanProgressEvent {
                probed: count,
                total: approx_total,
                device: None,
                phase: Some(ScanPhase::Finalizing),
                phase_label: Some(phase_label(ScanPhase::Finalizing)),
                phase_probed: Some(count),
                phase_total: Some(approx_total),
            },
        );
    }

    // Emit final progress
    let _ = window.emit(
        "network-devices-progress",
        ScanProgressEvent {
            probed: approx_total,
            total: approx_total,
            device: None,
            phase: Some(ScanPhase::Finalizing),
            phase_label: Some(phase_label(ScanPhase::Finalizing)),
            phase_probed: Some(approx_total),
            phase_total: Some(approx_total),
        },
    );

    device_map.into_values().collect()
}

// ── Main scan entry point ────────────────────────────────────────

#[tracing::instrument(skip_all, name = "network_discovery.scan")]
pub async fn run_scan(window: tauri::Window, config: ScanConfig) -> ScanResult {
    let mut config = config;
    apply_enrichment_preset(&mut config);
    tracing::info!(targets = %config.targets, mode = ?config.scan_mode, "Starting network discovery scan");
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
            scan_mode: config.scan_mode.clone(),
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
                scan_mode: config.scan_mode.clone(),
            };
        }
    };

    let total_ips = ips.len() as u32;
    let scan_mode = config.scan_mode.clone();

    // Dispatch to the appropriate scan mode
    let devices = match &scan_mode {
        ScanMode::Quick => run_quick_scan(window, &config, ips).await,
        ScanMode::Sip => run_sip_scan(window, &config, &ips).await,
        ScanMode::Full => run_full_scan(window, &config, ips).await,
    };

    let duration_ms = start.elapsed().as_millis() as u64;
    let responded_count = devices.len() as u32;
    let stopped = SCAN_STOP.load(Ordering::SeqCst);
    let total_ports_scanned = match scan_mode {
        ScanMode::Quick => total_ips,
        ScanMode::Sip => {
            let sip_probes = total_ips.saturating_mul(config.ports.len().max(1) as u32);
            total_ips.saturating_add(sip_probes)
        }
        ScanMode::Full => total_ips.saturating_mul(4),
    };

    SCAN_RUNNING.store(false, Ordering::SeqCst);

    ScanResult {
        devices,
        total_ips_scanned: total_ips,
        total_ports_scanned,
        responded_count,
        duration_ms,
        stopped,
        error: None,
        scan_mode,
    }
}
