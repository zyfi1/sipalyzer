use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunConfig {
    pub stun_server: String,
    pub stun_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunResult {
    pub stun_server: String,
    pub public_ip: Option<String>,
    pub public_port: Option<u16>,
    pub local_ip: Option<String>,
    pub local_port: Option<u16>,
    pub nat_type: String,
    pub response_ms: Option<f64>,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for StunConfig {
    fn default() -> Self {
        Self {
            stun_server: "stun.l.google.com".into(),
            stun_port: 19302,
        }
    }
}

/// Minimal STUN Binding Request implementation (RFC 5389).
/// Determines public IP and NAT type.
#[tracing::instrument(skip_all)]
pub async fn run_stun_test(config: StunConfig) -> StunResult {
    let stun_server = config.stun_server.clone();
    let stun_port = config.stun_port;

    let result = tokio::task::spawn_blocking(move || {
        stun_binding_request(&stun_server, stun_port)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task error: {}", e)));

    match result {
        Ok(r) => r,
        Err(e) => StunResult {
            stun_server: config.stun_server,
            public_ip: None,
            public_port: None,
            local_ip: None,
            local_port: None,
            nat_type: "Unknown".into(),
            response_ms: None,
            success: false,
            error: Some(e),
        },
    }
}

fn stun_binding_request(server: &str, port: u16) -> Result<StunResult, String> {
    let server_addr = format!("{}:{}", server, port);
    let dest: SocketAddr = server_addr
        .parse()
        .or_else(|_| {
            use std::net::ToSocketAddrs;
            server_addr
                .to_socket_addrs()
                .map_err(|e| format!("DNS error: {}", e))?
                .next()
                .ok_or_else(|| "No address found".to_string())
        })?;

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Bind error: {}", e))?;
    socket
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| format!("Timeout error: {}", e))?;

    // Connect to determine the real local IP (before connect, local_addr returns 0.0.0.0)
    socket
        .connect(dest)
        .map_err(|e| format!("Connect error: {}", e))?;
    let local_addr = socket.local_addr().ok();

    // Build STUN Binding Request (RFC 5389)
    // Message Type: 0x0001 (Binding Request)
    // Magic Cookie: 0x2112A442
    // Transaction ID: 12 random bytes
    let mut request = Vec::with_capacity(20);
    // Type: Binding Request
    request.extend_from_slice(&0x0001u16.to_be_bytes());
    // Length: 0 (no attributes)
    request.extend_from_slice(&0x0000u16.to_be_bytes());
    // Magic Cookie
    request.extend_from_slice(&0x2112A442u32.to_be_bytes());
    // Transaction ID (12 bytes)
    let txn_id: [u8; 12] = {
        use std::time::SystemTime;
        let seed = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut id = [0u8; 12];
        for (i, byte) in id.iter_mut().enumerate() {
            *byte = ((seed >> (i * 8)) & 0xFF) as u8;
        }
        id
    };
    request.extend_from_slice(&txn_id);

    let start = Instant::now();
    socket
        .send(&request)
        .map_err(|e| format!("Send error: {}", e))?;

    let mut buf = [0u8; 1024];
    let len = socket
        .recv(&mut buf)
        .map_err(|e| format!("Receive error: {}", e))?;

    let response_ms = start.elapsed().as_secs_f64() * 1000.0;

    // Parse STUN response
    if len < 20 {
        return Err("Response too short".into());
    }

    let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
    if msg_type != 0x0101 {
        // 0x0101 = Binding Success Response
        return Err(format!("Unexpected message type: 0x{:04X}", msg_type));
    }

    let msg_len = u16::from_be_bytes([buf[2], buf[3]]) as usize;

    // Parse attributes to find XOR-MAPPED-ADDRESS (0x0020) or MAPPED-ADDRESS (0x0001)
    let mut public_ip: Option<String> = None;
    let mut public_port: Option<u16> = None;
    let magic_cookie = 0x2112A442u32;

    let mut offset = 20;
    while offset + 4 <= 20 + msg_len && offset + 4 <= len {
        let attr_type = u16::from_be_bytes([buf[offset], buf[offset + 1]]);
        let attr_len = u16::from_be_bytes([buf[offset + 2], buf[offset + 3]]) as usize;
        let attr_start = offset + 4;

        if attr_start + attr_len > len {
            break;
        }

        match attr_type {
            0x0020 => {
                // XOR-MAPPED-ADDRESS
                if attr_len >= 8 {
                    let family = buf[attr_start + 1];
                    let xport = u16::from_be_bytes([buf[attr_start + 2], buf[attr_start + 3]])
                        ^ (magic_cookie >> 16) as u16;
                    if family == 0x01 && attr_len >= 8 {
                        // IPv4
                        let xip = u32::from_be_bytes([
                            buf[attr_start + 4],
                            buf[attr_start + 5],
                            buf[attr_start + 6],
                            buf[attr_start + 7],
                        ]) ^ magic_cookie;
                        let ip = IpAddr::V4(std::net::Ipv4Addr::from(xip));
                        public_ip = Some(ip.to_string());
                        public_port = Some(xport);
                    }
                }
            }
            0x0001 => {
                // MAPPED-ADDRESS (fallback)
                if public_ip.is_none() && attr_len >= 8 {
                    let family = buf[attr_start + 1];
                    let port = u16::from_be_bytes([buf[attr_start + 2], buf[attr_start + 3]]);
                    if family == 0x01 {
                        let ip = IpAddr::V4(std::net::Ipv4Addr::new(
                            buf[attr_start + 4],
                            buf[attr_start + 5],
                            buf[attr_start + 6],
                            buf[attr_start + 7],
                        ));
                        public_ip = Some(ip.to_string());
                        public_port = Some(port);
                    }
                }
            }
            _ => {}
        }

        // Attributes are padded to 4 bytes
        offset = attr_start + ((attr_len + 3) & !3);
    }

    // Simple NAT type detection
    let nat_type = if let (Some(ref pip), Some(pport)) = (&public_ip, public_port) {
        if let Some(local) = &local_addr {
            let local_ip_str = local.ip().to_string();
            if local_ip_str == *pip && local.port() == pport {
                "No NAT (Direct)"
            } else if local_ip_str != *pip {
                "NAT Detected"
            } else {
                "Port-Restricted NAT"
            }
        } else {
            "NAT Detected"
        }
    } else {
        "Unknown"
    };

    Ok(StunResult {
        stun_server: server.to_string(),
        public_ip,
        public_port,
        local_ip: local_addr.map(|a| a.ip().to_string()),
        local_port: local_addr.map(|a| a.port()),
        nat_type: nat_type.to_string(),
        response_ms: Some(response_ms),
        success: true,
        error: None,
    })
}
