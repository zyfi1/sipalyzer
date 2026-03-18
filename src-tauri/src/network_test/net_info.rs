use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub friendly_name: Option<String>,
    pub mac_address: Option<String>,
    pub ipv4: Vec<String>,
    pub ipv6: Vec<String>,
    pub is_default: bool,
    pub interface_type: String,
    pub gateway: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetInfoResult {
    pub interfaces: Vec<NetworkInterface>,
    pub default_interface: Option<String>,
    pub default_gateway: Option<String>,
    pub local_ip: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

/// Lists all network interfaces with their configuration.
pub async fn get_network_info() -> NetInfoResult {
    let result = tokio::task::spawn_blocking(get_info_blocking)
        .await
        .unwrap_or_else(|e| NetInfoResult {
            interfaces: vec![],
            default_interface: None,
            default_gateway: None,
            local_ip: None,
            success: false,
            error: Some(format!("Task error: {}", e)),
        });

    result
}

fn get_info_blocking() -> NetInfoResult {
    let mut interfaces = Vec::new();

    // Get default interface info
    let default_iface = default_net::get_default_interface().ok();
    let default_name = default_iface.as_ref().map(|i| i.name.clone());
    let default_gw = default_iface.as_ref().and_then(|i| {
        i.gateway.as_ref().map(|g| g.ip_addr.to_string())
    });
    // Extract local IP directly from the default interface (most reliable source)
    let local_ip = default_iface.as_ref().and_then(|i| {
        i.ipv4.first().map(|ip| ip.addr.to_string())
    });

    // List all interfaces
    let all_interfaces = default_net::get_interfaces();
    for iface in all_interfaces {
        let is_default = default_name.as_deref() == Some(&iface.name);
        let mac = iface.mac_addr.map(|m| m.to_string());

        let ipv4: Vec<String> = iface
            .ipv4
            .iter()
            .map(|ip| ip.addr.to_string())
            .collect();
        let ipv6: Vec<String> = iface
            .ipv6
            .iter()
            .map(|ip| ip.addr.to_string())
            .collect();

        let iface_type = guess_interface_type(&iface.name, &iface.friendly_name.clone().unwrap_or_default());
        let gateway = iface.gateway.as_ref().map(|g| g.ip_addr.to_string());

        interfaces.push(NetworkInterface {
            name: iface.name.clone(),
            friendly_name: iface.friendly_name,
            mac_address: mac,
            ipv4,
            ipv6,
            is_default,
            interface_type: iface_type,
            gateway,
        });
    }

    // Sort: default first, then by name
    interfaces.sort_by(|a, b| b.is_default.cmp(&a.is_default).then(a.name.cmp(&b.name)));

    NetInfoResult {
        interfaces,
        default_interface: default_name,
        default_gateway: default_gw,
        local_ip,
        success: true,
        error: None,
    }
}

fn guess_interface_type(name: &str, friendly_name: &str) -> String {
    let n = name.to_lowercase();
    let f = friendly_name.to_lowercase();

    if n.starts_with("en") || f.contains("wi-fi") || f.contains("wireless") || n.contains("wlan") {
        if f.contains("wi-fi") || f.contains("wireless") || n.contains("wlan") {
            "Wi-Fi".into()
        } else {
            "Ethernet".into()
        }
    } else if n.starts_with("lo") || n == "lo0" {
        "Loopback".into()
    } else if n.contains("utun") || n.contains("tun") || n.contains("tap") || f.contains("vpn") {
        "VPN/Tunnel".into()
    } else if n.contains("bridge") || n.contains("br") {
        "Bridge".into()
    } else if n.contains("docker") || n.contains("veth") {
        "Virtual".into()
    } else if n.starts_with("eth") || f.contains("ethernet") {
        "Ethernet".into()
    } else {
        "Other".into()
    }
}
