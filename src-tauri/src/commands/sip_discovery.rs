use crate::sip_discovery::scanner;
use crate::sip_discovery::ip_range;
use serde::Serialize;

/// Detect the local subnet in CIDR notation (e.g., "192.168.1.0/24").
/// Uses the default network interface.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn sip_discovery_detect_subnet() -> Result<DetectedSubnet, String> {
    let iface = default_net::get_default_interface()
        .map_err(|e| format!("Failed to detect default interface: {}", e))?;

    let ipv4 = iface.ipv4.first().ok_or("No IPv4 address on default interface")?;
    let addr = ipv4.addr;
    let prefix = ipv4.prefix_len;

    // Compute the network address (zero out host bits)
    let ip_u32 = u32::from(addr);
    let mask = if prefix == 0 { 0u32 } else { !0u32 << (32 - prefix) };
    let network_u32 = ip_u32 & mask;
    let network = std::net::Ipv4Addr::from(network_u32);

    Ok(DetectedSubnet {
        cidr: format!("{}/{}", network, prefix),
        local_ip: addr.to_string(),
        prefix_len: prefix,
        gateway: iface.gateway.map(|g| g.ip_addr.to_string()),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedSubnet {
    pub cidr: String,
    pub local_ip: String,
    pub prefix_len: u8,
    pub gateway: Option<String>,
}

/// Start a SIP discovery scan across the given targets.
/// Results stream to the frontend in real time via `sip-discovery-progress` events.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn sip_discovery_scan(
    window: tauri::Window,
    targets: String,
    ports: Option<Vec<u16>>,
    transport: Option<scanner::ScanTransport>,
    timeout_ms: Option<u64>,
    concurrency: Option<u32>,
    method: Option<scanner::ScanMethod>,
) -> Result<scanner::ScanResult, String> {
    let config = scanner::ScanConfig {
        targets,
        ports: ports.unwrap_or_else(|| vec![5060]),
        transport: transport.unwrap_or_default(),
        timeout_ms: timeout_ms.unwrap_or(2000),
        concurrency: concurrency.unwrap_or(20),
        method: method.unwrap_or_default(),
    };
    Ok(scanner::run_scan(window, config).await)
}

/// Stop a currently running scan.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn sip_discovery_stop_scan() -> Result<(), String> {
    scanner::stop_scan();
    Ok(())
}

/// Check if a scan is currently running.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn sip_discovery_is_running() -> bool {
    scanner::is_scan_running()
}

/// Preview how many IPs a target string will expand to.
/// Returns the list of IP strings (useful for the UI preview).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn sip_discovery_expand_targets(input: String) -> Result<Vec<String>, String> {
    let ips = ip_range::expand_targets(&input)?;
    Ok(ips.iter().map(|ip| ip.to_string()).collect())
}
