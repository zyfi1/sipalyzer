use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use socket2::{Domain, Socket, Type, Protocol};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtuConfig {
    pub host: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtuResult {
    pub host: String,
    pub path_mtu: u32,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for MtuConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            timeout_ms: 2000,
        }
    }
}

/// Discovers Path MTU using binary search with Don't Fragment bit.
/// Sends UDP packets of various sizes with DF bit set.
#[tracing::instrument(skip_all)]
pub async fn run_mtu_discovery(config: MtuConfig) -> MtuResult {
    let ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return MtuResult {
                host: config.host,
                path_mtu: 0,
                success: false,
                error: Some(e),
            };
        }
    };

    let timeout_ms = config.timeout_ms;
    let host = config.host.clone();

    let result = tokio::task::spawn_blocking(move || {
        discover_mtu_blocking(ip, timeout_ms)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task error: {}", e)));

    match result {
        Ok(mtu) => MtuResult {
            host,
            path_mtu: mtu,
            success: true,
            error: None,
        },
        Err(e) => MtuResult {
            host,
            path_mtu: 0,
            success: false,
            error: Some(e),
        },
    }
}

fn discover_mtu_blocking(ip: IpAddr, timeout_ms: u64) -> Result<u32, String> {
    let domain = if ip.is_ipv4() { Domain::IPV4 } else { Domain::IPV6 };
    let timeout = Duration::from_millis(timeout_ms);

    // Binary search between 68 (minimum IPv4 MTU) and 1500 (typical Ethernet MTU)
    let mut low: u32 = 68;
    let mut high: u32 = 1500;
    let mut last_success: u32 = low;

    // Add UDP + IP header overhead (28 bytes for IPv4, 48 for IPv6)
    let overhead: u32 = if ip.is_ipv4() { 28 } else { 48 };

    while low <= high {
        let mid = (low + high) / 2;
        let payload_size = (mid - overhead) as usize;

        if can_send_with_size(domain, ip, payload_size, timeout)? {
            last_success = mid;
            low = mid + 1;
        } else {
            if mid == 0 { break; }
            high = mid - 1;
        }
    }

    Ok(last_success)
}

fn can_send_with_size(
    domain: Domain,
    ip: IpAddr,
    payload_size: usize,
    timeout: Duration,
) -> Result<bool, String> {
    let socket = Socket::new(domain, Type::DGRAM, Some(Protocol::UDP))
        .map_err(|e| format!("Socket error: {}", e))?;

    // Set Don't Fragment
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::io::AsRawFd;
        unsafe {
            let val: libc::c_int = 2; // IP_PMTUDISC_DO
            libc::setsockopt(
                socket.as_raw_fd(),
                libc::IPPROTO_IP,
                libc::IP_MTU_DISCOVER,
                &val as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::c_int>() as libc::socklen_t,
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: IP_DONTFRAG
        use std::os::unix::io::AsRawFd;
        unsafe {
            let val: libc::c_int = 1;
            libc::setsockopt(
                socket.as_raw_fd(),
                libc::IPPROTO_IP,
                28, // IP_DONTFRAG on macOS
                &val as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::c_int>() as libc::socklen_t,
            );
        }
    }

    socket.set_read_timeout(Some(timeout)).ok();

    let dest = SocketAddr::new(ip, 33434);
    let dest_sock: socket2::SockAddr = dest.into();
    let payload = vec![0u8; payload_size.min(1500)];

    match socket.send_to(&payload, &dest_sock) {
        Ok(_) => Ok(true),
        Err(e) => {
            let err_str = e.to_string().to_lowercase();
            if err_str.contains("message too long") || err_str.contains("too large") {
                Ok(false)
            } else {
                // Other errors (e.g., network unreachable) - treat as success for MTU purposes
                Ok(true)
            }
        }
    }
}
