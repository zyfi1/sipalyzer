use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatDetectConfig {
    pub stun_server: String,
    pub stun_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatDetectResult {
    pub nat_type: String,
    pub mapped_ip: String,
    pub mapped_port: u16,
    pub local_ip: String,
    pub local_port: u16,
    pub hairpin_supported: bool,
    pub alg_detected: bool,
    pub modified_headers: Vec<String>,
    pub udp_timeout_secs: u32,
    pub elapsed_ms: u64,
}

impl Default for NatDetectConfig {
    fn default() -> Self {
        Self {
            stun_server: "stun.l.google.com".to_string(),
            stun_port: 19302,
        }
    }
}

pub async fn run_nat_detect(config: NatDetectConfig) -> NatDetectResult {
    let result = tokio::task::spawn_blocking(move || run_nat_detect_blocking(config))
        .await
        .unwrap_or_else(|_e| NatDetectResult {
            nat_type: "error".to_string(),
            mapped_ip: String::new(),
            mapped_port: 0,
            local_ip: String::new(),
            local_port: 0,
            hairpin_supported: false,
            alg_detected: false,
            modified_headers: vec![],
            udp_timeout_secs: 0,
            elapsed_ms: 0,
        });
    result
}

fn run_nat_detect_blocking(config: NatDetectConfig) -> NatDetectResult {
    let start = Instant::now();
    let server_addr = format!("{}:{}", config.stun_server, config.stun_port);
    let resolved_server = match server_addr
        .to_socket_addrs()
        .ok()
        .and_then(|mut it| it.next())
    {
        Some(addr) => addr,
        None => {
            return NatDetectResult {
                nat_type: "error".to_string(),
                elapsed_ms: start.elapsed().as_millis() as u64,
                ..Default::default()
            };
        }
    };

    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => {
            return NatDetectResult {
                nat_type: "error".to_string(),
                ..Default::default()
            };
        }
    };
    socket.set_read_timeout(Some(Duration::from_secs(5))).ok();
    // Connect first so local_addr reflects the actual outbound interface instead of 0.0.0.0.
    socket.connect(resolved_server).ok();

    let local_addr = socket.local_addr().ok();
    // Treat unspecified bind addresses (0.0.0.0/::) as not meaningful for NAT classification.
    let meaningful_local_ip = local_addr.and_then(|addr| {
        if addr.ip().is_unspecified() {
            None
        } else {
            Some(addr.ip())
        }
    });
    let local_ip = meaningful_local_ip
        .map(|ip| ip.to_string())
        .unwrap_or_default();
    let local_port = local_addr.map(|a| a.port()).unwrap_or(0);

    // STUN Binding Request
    let (mapped_ip, mapped_port) = match stun_binding(&socket, &server_addr) {
        Some(r) => r,
        None => {
            return NatDetectResult {
                nat_type: "error".to_string(),
                local_ip,
                local_port,
                elapsed_ms: start.elapsed().as_millis() as u64,
                ..Default::default()
            };
        }
    };

    let nat_type = {
        let mapped_ip_addr = mapped_ip.parse::<IpAddr>().ok();
        let mapped_matches_local = meaningful_local_ip
            .zip(mapped_ip_addr)
            .map_or(false, |(local, mapped)| local == mapped);
        let mapped_is_local = mapped_matches_local && mapped_port == local_port;

        if meaningful_local_ip.map_or(false, is_public_ip) && mapped_is_local {
            "Open Internet (No NAT)".to_string()
        } else {
            "NAT Detected (Type Unknown)".to_string()
        }
    };

    NatDetectResult {
        nat_type,
        mapped_ip,
        mapped_port,
        local_ip,
        local_port,
        hairpin_supported: false,
        alg_detected: false,
        modified_headers: vec![],
        udp_timeout_secs: 0,
        elapsed_ms: start.elapsed().as_millis() as u64,
    }
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !v4.is_private()
                && !v4.is_loopback()
                && !v4.is_link_local()
                && v4 != Ipv4Addr::UNSPECIFIED
        }
        IpAddr::V6(v6) => {
            !v6.is_loopback()
                && !v6.is_unspecified()
                && !v6.is_unique_local()
                && !v6.is_unicast_link_local()
                && v6 != Ipv6Addr::LOCALHOST
                && v6 != Ipv6Addr::UNSPECIFIED
        }
    }
}

impl Default for NatDetectResult {
    fn default() -> Self {
        Self {
            nat_type: String::new(),
            mapped_ip: String::new(),
            mapped_port: 0,
            local_ip: String::new(),
            local_port: 0,
            hairpin_supported: false,
            alg_detected: false,
            modified_headers: vec![],
            udp_timeout_secs: 0,
            elapsed_ms: 0,
        }
    }
}

/// Minimal STUN Binding Request and XOR-MAPPED-ADDRESS parsing.
fn stun_binding(socket: &UdpSocket, server: &str) -> Option<(String, u16)> {
    // STUN header: Type(2) + Length(2) + Magic Cookie(4) + Transaction ID(12) = 20 bytes
    let mut req = [0u8; 20];
    req[0] = 0x00;
    req[1] = 0x01; // Binding Request
                   // Length = 0 (no attributes)
                   // Magic Cookie
    req[4] = 0x21;
    req[5] = 0x12;
    req[6] = 0xA4;
    req[7] = 0x42;
    // Random transaction ID
    for i in 8..20 {
        req[i] = (i as u8).wrapping_mul(37).wrapping_add(7);
    }

    socket.send_to(&req, server).ok()?;

    let mut resp = [0u8; 256];
    let n = socket.recv(&mut resp).ok()?;
    if n < 20 {
        return None;
    }

    // Parse attributes looking for XOR-MAPPED-ADDRESS (0x0020)
    let mut offset = 20;
    while offset + 4 <= n {
        let attr_type = u16::from_be_bytes([resp[offset], resp[offset + 1]]);
        let attr_len = u16::from_be_bytes([resp[offset + 2], resp[offset + 3]]) as usize;
        offset += 4;

        if attr_type == 0x0020 && attr_len >= 8 && offset + attr_len <= n {
            // XOR-MAPPED-ADDRESS
            let family = resp[offset + 1];
            if family == 0x01 {
                // IPv4
                let port = u16::from_be_bytes([resp[offset + 2], resp[offset + 3]]) ^ 0x2112;
                let ip = [
                    resp[offset + 4] ^ 0x21,
                    resp[offset + 5] ^ 0x12,
                    resp[offset + 6] ^ 0xA4,
                    resp[offset + 7] ^ 0x42,
                ];
                return Some((format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]), port));
            }
        }

        // Align to 4-byte boundary
        offset += (attr_len + 3) & !3;
    }

    None
}
