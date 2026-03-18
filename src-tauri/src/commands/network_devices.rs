use crate::network_discovery::scanner;
use crate::network_discovery::ip_range;
use crate::network_discovery::oui;
use crate::network_discovery::wol;
use serde::Serialize;

/// Detect the local subnet in CIDR notation (e.g., "192.168.1.0/24").
/// Uses the default network interface.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_devices_detect_subnet() -> Result<DetectedSubnet, String> {
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

/// Enumerate ALL network interfaces and return every IPv4 subnet found.
/// Filters out loopback (127.x) and link-local (169.254.x) addresses.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_devices_list_subnets() -> Vec<SubnetInfo> {
    let default_iface = default_net::get_default_interface().ok();
    let default_name = default_iface.as_ref().map(|i| i.name.clone());

    let all = default_net::get_interfaces();
    let mut subnets: Vec<SubnetInfo> = Vec::new();

    for iface in &all {
        let is_default = default_name.as_deref() == Some(&iface.name);
        let gateway = iface.gateway.as_ref().map(|g| g.ip_addr.to_string());
        let mac = iface.mac_addr.map(|m| m.to_string());

        let iface_type = guess_iface_type(&iface.name, iface.friendly_name.as_deref().unwrap_or(""));

        for ipv4 in &iface.ipv4 {
            let addr = ipv4.addr;
            let prefix = ipv4.prefix_len;

            // Skip loopback and link-local
            if addr.is_loopback() || addr.octets()[0] == 169 {
                continue;
            }

            // Compute network address
            let ip_u32 = u32::from(addr);
            let mask = if prefix == 0 { 0u32 } else { !0u32 << (32 - prefix) };
            let network_u32 = ip_u32 & mask;
            let network = std::net::Ipv4Addr::from(network_u32);

            let host_count: u64 = if prefix >= 31 {
                (1u64 << (32 - prefix as u64)).saturating_sub(0)
            } else {
                (1u64 << (32 - prefix as u64)).saturating_sub(2)
            };

            subnets.push(SubnetInfo {
                cidr: format!("{}/{}", network, prefix),
                local_ip: addr.to_string(),
                prefix_len: prefix,
                gateway: gateway.clone(),
                interface_name: iface.name.clone(),
                friendly_name: iface.friendly_name.clone(),
                mac_address: mac.clone(),
                interface_type: iface_type.clone(),
                is_default,
                host_count,
            });
        }
    }

    // Sort: default first, then by interface name
    subnets.sort_by(|a, b| {
        b.is_default.cmp(&a.is_default)
            .then(a.interface_name.cmp(&b.interface_name))
    });

    subnets
}

#[derive(Debug, Clone, Serialize)]
pub struct SubnetInfo {
    pub cidr: String,
    pub local_ip: String,
    pub prefix_len: u8,
    pub gateway: Option<String>,
    pub interface_name: String,
    pub friendly_name: Option<String>,
    pub mac_address: Option<String>,
    pub interface_type: String,
    pub is_default: bool,
    pub host_count: u64,
}

fn guess_iface_type(name: &str, friendly_name: &str) -> String {
    let n = name.to_lowercase();
    let f = friendly_name.to_lowercase();
    if n.contains("lo") && !n.contains("local") && n.len() <= 3 {
        "loopback".to_string()
    } else if n.contains("wlan") || n.contains("wl") || n.contains("wi-fi") || f.contains("wi-fi") || f.contains("wireless") || f.contains("airport") {
        "wifi".to_string()
    } else if n.contains("eth") || n.contains("en") || f.contains("ethernet") || f.contains("thunderbolt") {
        "ethernet".to_string()
    } else if n.contains("tun") || n.contains("tap") || n.contains("utun") || f.contains("vpn") {
        "vpn".to_string()
    } else if n.contains("bridge") || n.contains("br") || n.contains("docker") || n.contains("veth") {
        "virtual".to_string()
    } else if n.contains("vmnet") || n.contains("vbox") {
        "virtual".to_string()
    } else {
        "other".to_string()
    }
}

/// Start a network device scan across the given targets.
/// Results stream to the frontend in real time via `network-devices-progress` events.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_devices_scan(
    window: tauri::Window,
    targets: String,
    ports: Option<Vec<u16>>,
    transport: Option<scanner::ScanTransport>,
    timeout_ms: Option<u64>,
    concurrency: Option<u32>,
    method: Option<scanner::ScanMethod>,
    scan_mode: Option<scanner::ScanMode>,
    enrichment_preset: Option<scanner::ScanEnrichmentPreset>,
    enrichment_flags: Option<scanner::ScanEnrichmentFlags>,
) -> Result<scanner::ScanResult, String> {
    let config = scanner::ScanConfig {
        targets,
        ports: ports.unwrap_or_else(|| vec![5060]),
        transport: transport.unwrap_or_default(),
        timeout_ms: timeout_ms.unwrap_or(2000),
        concurrency: concurrency.unwrap_or(20),
        method: method.unwrap_or_default(),
        scan_mode: scan_mode.unwrap_or_default(),
        enrichment_preset: enrichment_preset.unwrap_or_default(),
        enrichment_flags: enrichment_flags.unwrap_or_default(),
    };
    Ok(scanner::run_scan(window, config).await)
}

/// Stop a currently running scan.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_devices_stop_scan() -> Result<(), String> {
    scanner::stop_scan();
    Ok(())
}

/// Check if a scan is currently running.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_devices_is_running() -> bool {
    scanner::is_scan_running()
}

/// Preview how many IPs a target string will expand to.
/// Returns the list of IP strings (useful for the UI preview).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_devices_expand_targets(input: String) -> Result<Vec<String>, String> {
    let ips = ip_range::expand_targets(&input)?;
    Ok(ips.iter().map(|ip| ip.to_string()).collect())
}

/// Send a Wake-on-LAN magic packet to wake a device by MAC address.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_devices_wake_on_lan(mac: String) -> Result<(), String> {
    wol::send_wol(&mac)
}

/// Look up the vendor/manufacturer for a MAC address using the IEEE OUI database.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_devices_oui_lookup(mac: String) -> OuiLookupResult {
    let clean: String = mac
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();

    let prefix = if clean.len() >= 6 {
        format!("{}:{}:{}", &clean[0..2], &clean[2..4], &clean[4..6])
    } else {
        String::new()
    };

    OuiLookupResult {
        mac: mac.clone(),
        prefix,
        vendor: oui::lookup_oui(&mac),
    }
}

/// Batch OUI lookup for multiple MAC addresses.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_devices_oui_lookup_batch(macs: Vec<String>) -> Vec<OuiLookupResult> {
    macs.into_iter()
        .map(|mac| network_devices_oui_lookup(mac))
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct OuiLookupResult {
    pub mac: String,
    pub prefix: String,
    pub vendor: Option<String>,
}
