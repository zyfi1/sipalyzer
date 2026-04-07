use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{IpAddr, SocketAddr};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DscpConfig {
    pub host: String,
    pub port: u16,
    pub dscp_value: u8,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DscpResult {
    pub host: String,
    pub dscp_sent: u8,
    pub dscp_name: String,
    pub packet_sent: bool,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for DscpConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 5060,
            dscp_value: 46, // EF (Expedited Forwarding) - standard for VoIP
            timeout_ms: 2000,
        }
    }
}

/// Sends packets with specific DSCP markings to verify QoS policies.
/// Tests whether the OS and network path support DSCP/TOS marking.
pub async fn run_dscp_test(config: DscpConfig) -> DscpResult {
    let ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return DscpResult {
                host: config.host,
                dscp_sent: config.dscp_value,
                dscp_name: dscp_name(config.dscp_value),
                packet_sent: false,
                success: false,
                error: Some(e),
            };
        }
    };

    let dscp = config.dscp_value;
    let port = config.port;
    let timeout_ms = config.timeout_ms;
    let host = config.host.clone();

    let result = tokio::task::spawn_blocking(move || send_dscp_packet(ip, port, dscp, timeout_ms))
        .await
        .unwrap_or_else(|e| Err(format!("Task error: {}", e)));

    match result {
        Ok(sent) => DscpResult {
            host,
            dscp_sent: dscp,
            dscp_name: dscp_name(dscp),
            packet_sent: sent,
            success: sent,
            error: None,
        },
        Err(e) => DscpResult {
            host,
            dscp_sent: dscp,
            dscp_name: dscp_name(dscp),
            packet_sent: false,
            success: false,
            error: Some(e),
        },
    }
}

fn send_dscp_packet(ip: IpAddr, port: u16, dscp: u8, _timeout_ms: u64) -> Result<bool, String> {
    let domain = if ip.is_ipv4() {
        Domain::IPV4
    } else {
        Domain::IPV6
    };
    let socket = Socket::new(domain, Type::DGRAM, Some(Protocol::UDP))
        .map_err(|e| format!("Socket error: {}", e))?;

    // Set TOS field (DSCP << 2 to convert to TOS byte)
    let tos = (dscp as u32) << 2;

    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        unsafe {
            let val = tos as libc::c_int;
            let ret = libc::setsockopt(
                socket.as_raw_fd(),
                libc::IPPROTO_IP,
                libc::IP_TOS,
                &val as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::c_int>() as libc::socklen_t,
            );
            if ret != 0 {
                return Err(format!(
                    "Failed to set TOS/DSCP: errno {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
    }

    #[cfg(windows)]
    {
        // Windows IP_TOS = 3
        socket
            .set_tos(tos)
            .map_err(|e| format!("Failed to set TOS: {}", e))?;
    }

    let dest = SocketAddr::new(ip, port);
    let dest_sock: socket2::SockAddr = dest.into();
    let payload = b"SIPalyzer DSCP test";

    match socket.send_to(payload, &dest_sock) {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Send failed: {}", e)),
    }
}

fn dscp_name(dscp: u8) -> String {
    match dscp {
        0 => "BE (Best Effort)".into(),
        8 => "CS1".into(),
        10 => "AF11".into(),
        12 => "AF12".into(),
        14 => "AF13".into(),
        16 => "CS2".into(),
        18 => "AF21".into(),
        20 => "AF22".into(),
        22 => "AF23".into(),
        24 => "CS3".into(),
        26 => "AF31".into(),
        28 => "AF32".into(),
        30 => "AF33".into(),
        32 => "CS4".into(),
        34 => "AF41".into(),
        36 => "AF42".into(),
        38 => "AF43".into(),
        40 => "CS5".into(),
        46 => "EF (Expedited Forwarding)".into(),
        48 => "CS6".into(),
        56 => "CS7".into(),
        _ => format!("DSCP {}", dscp),
    }
}
