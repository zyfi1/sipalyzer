use anyhow::{Context, Result};
use std::net::{SocketAddr, UdpSocket, TcpStream, ToSocketAddrs, IpAddr};
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::Duration;
use hickory_resolver::config::{ResolveHosts, ResolverConfig, ResolverOpts};
use hickory_resolver::name_server::TokioConnectionProvider;
use hickory_resolver::Resolver;
use crate::core::config::TransportType;
use crate::sip::uri::SipUri;

const SUPPORTED_SIP_TRANSPORTS: &str = "UDP, TCP";

fn transport_name(transport_type: &TransportType) -> &'static str {
    match transport_type {
        TransportType::Udp => "UDP",
        TransportType::Tcp => "TCP",
        TransportType::Tls => "TLS",
        TransportType::Wss => "WSS",
    }
}

fn unsupported_transport_error(transport_type: &TransportType, operation: &str) -> anyhow::Error {
    anyhow::anyhow!(
        "Unsupported SIP transport `{}` for {}. This build supports: {}. Configure registrar transport to UDP or TCP.",
        transport_name(transport_type),
        operation,
        SUPPORTED_SIP_TRANSPORTS
    )
}

/// Bind a UDP socket with SO_REUSEPORT (macOS) / SO_REUSEADDR (Linux) so that
/// the inbound listener and outbound transports can share the same local port.
/// This is necessary because SIP registration, outbound calls, and the inbound
/// listener all need to use the same port so the registrar's Contact binding
/// stays consistent.
pub fn bind_udp_reuse(addr: SocketAddr) -> Result<UdpSocket> {
    use std::os::fd::AsRawFd;
    let socket2 = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    ).context("socket2 create")?;
    socket2.set_reuse_address(true).context("SO_REUSEADDR")?;
    #[cfg(target_os = "macos")]
    socket2.set_reuse_port(true).context("SO_REUSEPORT")?;
    socket2.bind(&addr.into()).context("bind")?;
    // Convert socket2 into std UdpSocket
    let raw_fd = socket2.as_raw_fd();
    // Prevent socket2 from closing the fd
    std::mem::forget(socket2);
    let std_socket = unsafe { UdpSocket::from_raw_fd(raw_fd) };
    Ok(std_socket)
}

use std::os::fd::FromRawFd;

pub struct Transport {
    transport_type: TransportType,
    local_addr: SocketAddr,
    remote_addr: SocketAddr,
    local_ip: Option<String>,
    /// For UDP only: one socket used for the whole dialog so BYE can be received on the same socket (RFC 3261).
    udp_socket: Option<UdpSocket>,
    /// For TCP only: one stream used for the whole dialog so BYE and disconnect can be received (RFC 3261).
    /// Lazy-initialized on first send; inner Option is taken for BYE listener after place_call.
    tcp_stream: Option<Mutex<Option<TcpStream>>>,
}

impl Transport {
    /// Create a new transport
    /// remote_host can be:
    /// - A SIP URI (sip:host, sip:host:port, sip:user@host:port)
    /// - A hostname (example.com)
    /// - An IP address (192.168.1.1)
    /// - An IP address with port (192.168.1.1:5060)
    pub fn new(
        transport_type: TransportType,
        local_port: u16,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Self> {
        if matches!(transport_type, TransportType::Tls | TransportType::Wss) {
            tracing::warn!(
                transport = transport_name(&transport_type),
                supported_transports = SUPPORTED_SIP_TRANSPORTS,
                "Unsupported SIP transport selected; refusing to initialize transport"
            );
            return Err(unsupported_transport_error(&transport_type, "transport initialization"));
        }

        let local_addr = SocketAddr::from(([0, 0, 0, 0], local_port));
        
        // Parse the remote host - could be a SIP URI or just hostname/IP
        let sip_uri = SipUri::parse(remote_host)
            .context("Failed to parse remote host as SIP URI or hostname")?;
        
        // Use port from URI if present, otherwise use provided remote_port
        let target_port = sip_uri.port.unwrap_or(remote_port);
        let target_host = sip_uri.host_for_resolution();
        
        // Resolve hostname to IP address
        let remote_addr = {
            let _dns_span = tracing::info_span!("sip.dns_resolve").entered();
            Self::resolve_host(target_host, target_port)
                .with_context(|| format!("Failed to resolve host: {}", target_host))?
        };

        // Get the actual local IP address by attempting a connection
        // This ensures we use the real network interface IP, not 127.0.0.1
        // We make a quick connection attempt just to determine which interface would be used
        let local_ip = Self::get_local_ip(&remote_addr).unwrap_or(None);

        // For UDP: bind one socket and keep it for the whole dialog so the same socket receives BYE (RFC 3261).
        // Uses SO_REUSEPORT so the inbound listener can share the same port.
        //
        // IMPORTANT: After binding, we connect() the socket to the remote address.
        // On macOS (and Linux), SO_REUSEPORT distributes packets round-robin between
        // all sockets bound to the same port. A connect()-ed UDP socket is PREFERRED
        // by the kernel for packets from the connected address, ensuring SIP responses
        // to our INVITE are delivered here instead of to the inbound listener's socket.
        let udp_socket = if transport_type == TransportType::Udp {
            let sock = bind_udp_reuse(local_addr)
                .context("Failed to bind UDP socket for dialog")?;
            sock.connect(remote_addr)
                .context("Failed to connect UDP socket to remote (for SO_REUSEPORT priority)")?;
            let _ = sock.set_read_timeout(Some(Duration::from_secs(5)));
            Some(sock)
        } else {
            None
        };

        let tcp_stream = if transport_type == TransportType::Tcp {
            Some(Mutex::new(None))
        } else {
            None
        };
        Ok(Self {
            transport_type,
            local_addr,
            remote_addr,
            local_ip,
            udp_socket,
            tcp_stream,
        })
    }

    /// Get the local IP address that would be used to connect to a remote address (public for inbound SIP).
    pub fn get_local_ip_for_remote(remote_addr: &SocketAddr) -> Result<Option<String>> {
        Self::get_local_ip(remote_addr)
    }

    /// Get the local IP address that would be used to connect to a remote address.
    /// Uses a non-blocking UDP "connect" (no actual packets sent) to let the OS
    /// routing table pick the correct source interface — instantaneous.
    fn get_local_ip(remote_addr: &SocketAddr) -> Result<Option<String>> {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            if socket.connect(remote_addr).is_ok() {
                if let Ok(local_addr) = socket.local_addr() {
                    if let IpAddr::V4(ipv4) = local_addr.ip() {
                        if !ipv4.is_unspecified() {
                            return Ok(Some(ipv4.to_string()));
                        }
                    }
                }
            }
        }
        Ok(None)
    }

    /// Get the local IP address for use in SIP headers
    pub fn get_local_ip_address(&self) -> String {
        self.local_ip.clone().unwrap_or_else(|| {
            // Try to get IP from an actual connection
            match Self::get_local_ip(&self.remote_addr) {
                Ok(Some(ip)) => return ip,
                _ => {}
            }
            
            // Fallback: try to extract from local_addr
            if let IpAddr::V4(ipv4) = self.local_addr.ip() {
                if !ipv4.is_unspecified() && !ipv4.is_loopback() {
                    return ipv4.to_string();
                }
            }
            
            // Last resort: try to get IP by connecting to a well-known address
            // This helps when the remote isn't reachable yet
            if let Ok(addr) = "8.8.8.8:53".parse::<SocketAddr>() {
                if let Ok(Some(ip)) = Self::get_local_ip(&addr) {
                    return ip;
                }
            }
            
            // If all else fails, we'll use 0.0.0.0 and let the server handle it
            // or the user can configure it manually
            "0.0.0.0".to_string()
        })
    }
    
    /// Resolve a hostname to a SocketAddr, trying DNS SRV first (RFC 3263).
    fn resolve_host(host: &str, port: u16) -> Result<SocketAddr> {
        // IP address: skip DNS entirely
        if let Ok(addr) = format!("{}:{}", host, port).parse::<SocketAddr>() {
            return Ok(addr);
        }

        // Only attempt SRV when using default SIP port (user didn't specify explicit port).
        // SRV via dig subprocess can be slow; skip it for explicit host:port configs.
        if port == 5060 {
            if let Some(addr) = Self::try_srv_lookup(host) {
                return Ok(addr);
            }
        }

        // Standard A/AAAA resolution
        let addr = format!("{}:{}", host, port)
            .to_socket_addrs()?
            .next()
            .context("No addresses found for hostname")?;

        Ok(addr)
    }

    /// Attempt DNS SRV lookup for _sip._udp.<domain> per RFC 3263.
    /// Returns the highest-priority target as a SocketAddr, or None.
    fn try_srv_lookup(domain: &str) -> Option<SocketAddr> {
        let domain_owned = domain.to_string();
        let lookup = move || -> Option<(u16, String)> {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .ok()?;

            runtime.block_on(async move {
                let mut opts = ResolverOpts::default();
                opts.timeout = Duration::from_secs(2);
                opts.attempts = 1;
                opts.use_hosts_file = ResolveHosts::Never;

                let resolver = Resolver::builder_with_config(
                    ResolverConfig::default(),
                    TokioConnectionProvider::default(),
                )
                .with_options(opts)
                .build();

                let srv_name = format!("_sip._udp.{}", domain_owned);
                let response = resolver.srv_lookup(srv_name).await.ok()?;
                let mut records: Vec<(u16, u16, u16, String)> = response
                    .iter()
                    .map(|srv| {
                        (
                            srv.priority(),
                            srv.weight(),
                            srv.port(),
                            srv.target().to_string().trim_end_matches('.').to_string(),
                        )
                    })
                    .filter(|(_, _, _, target)| target != ".")
                    .collect();

                if records.is_empty() {
                    return None;
                }

                // Sort by priority ascending, weight descending
                records.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
                let (_, _, port, target) = &records[0];
                Some((*port, target.clone()))
            })
        };

        let (port, target) = if tokio::runtime::Handle::try_current().is_ok() {
            std::thread::spawn(lookup).join().ok().flatten()?
        } else {
            lookup()?
        };

        // Resolve the SRV target hostname to IP
        let mut addrs = format!("{}:{}", target, port).to_socket_addrs().ok()?;
        addrs.next()
    }

    pub fn send(&self, data: &[u8]) -> Result<usize> {
        match self.transport_type {
            TransportType::Udp => self.send_udp(data),
            TransportType::Tcp => self.send_tcp(data),
            TransportType::Tls => self.send_tls(data),
            TransportType::Wss => self.send_wss(data),
        }
    }

    pub fn receive(&self, timeout: Duration) -> Result<Vec<u8>> {
        match self.transport_type {
            TransportType::Udp => self.receive_udp(timeout),
            TransportType::Tcp => self.receive_tcp(timeout),
            TransportType::Tls => self.receive_tls(timeout),
            TransportType::Wss => self.receive_wss(timeout),
        }
    }

    fn send_udp(&self, data: &[u8]) -> Result<usize> {
        let _span = tracing::info_span!("sip.send_message", transport = "UDP").entered();
        let socket = self.udp_socket.as_ref()
            .context("UDP socket not bound (already taken for BYE listener?)")?;
        // Socket is connect()-ed to remote_addr in new(), so use send() not send_to().
        socket.send(data)
            .context("Failed to send UDP packet")
    }
    
    /// Take the UDP socket so it can be handed to the BYE listener (same socket receives BYE per RFC 3261).
    /// Call only once after dialog establishment; further send/receive on this Transport will fail for UDP.
    pub fn take_udp_socket(&mut self) -> Option<UdpSocket> {
        self.udp_socket.take()
    }

    /// Take the TCP stream so it can be handed to the BYE listener (same connection receives BYE / EOF per RFC 3261).
    /// Call only once after dialog establishment; further send/receive on this Transport will fail for TCP.
    pub fn take_tcp_stream(&self) -> Option<TcpStream> {
        self.tcp_stream
            .as_ref()
            .and_then(|m| m.lock().ok())
            .and_then(|mut g| g.take())
    }

    /// Update local IP from actual socket connection
    pub fn update_local_ip(&mut self) -> Result<()> {
        if self.local_ip.is_none() {
            // Try to get IP from actual connection
            match Self::get_local_ip(&self.remote_addr) {
                Ok(Some(ip)) => {
                    self.local_ip = Some(ip);
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn receive_udp(&self, timeout: Duration) -> Result<Vec<u8>> {
        let _span = tracing::info_span!("sip.receive_message", transport = "UDP").entered();
        let socket = self.udp_socket.as_ref()
            .context("UDP socket not bound (already taken for BYE listener?)")?;
        socket.set_read_timeout(Some(timeout))?;
        let mut buf = vec![0u8; 4096];
        // Socket is connect()-ed, so recv() only returns packets from the remote addr.
        // This prevents the inbound listener (sharing the port via SO_REUSEPORT) from
        // stealing SIP responses meant for this dialog.
        let size = socket.recv(&mut buf)
            .context("Failed to receive UDP packet (timeout or remote unreachable)")?;
        buf.truncate(size);
        Ok(buf)
    }

    fn send_tcp(&self, data: &[u8]) -> Result<usize> {
        let mut guard = self
            .tcp_stream
            .as_ref()
            .context("TCP transport not configured")?
            .lock()
            .map_err(|e| anyhow::anyhow!("tcp lock: {}", e))?;
        if guard.is_none() {
            let _connect_span = tracing::info_span!("sip.tcp_connect").entered();
            let stream = TcpStream::connect(self.remote_addr)
                .context("Failed to connect TCP")?;
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .context("Failed to set TCP read timeout")?;
            *guard = Some(stream);
        }
        let _send_span = tracing::info_span!("sip.send_message", transport = "TCP").entered();
        let stream = guard.as_mut().context("TCP stream missing")?;
        stream.write_all(data).context("Failed to write TCP data")?;
        Ok(data.len())
    }

    fn receive_tcp(&self, timeout: Duration) -> Result<Vec<u8>> {
        let _span = tracing::info_span!("sip.receive_message", transport = "TCP").entered();
        let mut guard = self
            .tcp_stream
            .as_ref()
            .context("TCP stream not bound (already taken for BYE listener?)")?
            .lock()
            .map_err(|e| anyhow::anyhow!("tcp lock: {}", e))?;
        let stream = guard.as_mut().context("TCP stream missing")?;
        stream.set_read_timeout(Some(timeout))?;
        read_one_sip_message(stream).context("Failed to read TCP SIP message")
    }

    fn send_tls(&self, _data: &[u8]) -> Result<usize> {
        tracing::warn!(
            transport = transport_name(&self.transport_type),
            supported_transports = SUPPORTED_SIP_TRANSPORTS,
            "Unsupported SIP transport path reached for send"
        );
        Err(unsupported_transport_error(&self.transport_type, "send"))
    }

    fn receive_tls(&self, _timeout: Duration) -> Result<Vec<u8>> {
        tracing::warn!(
            transport = transport_name(&self.transport_type),
            supported_transports = SUPPORTED_SIP_TRANSPORTS,
            "Unsupported SIP transport path reached for receive"
        );
        Err(unsupported_transport_error(&self.transport_type, "receive"))
    }

    fn send_wss(&self, _data: &[u8]) -> Result<usize> {
        tracing::warn!(
            transport = transport_name(&self.transport_type),
            supported_transports = SUPPORTED_SIP_TRANSPORTS,
            "Unsupported SIP transport path reached for send"
        );
        Err(unsupported_transport_error(&self.transport_type, "send"))
    }

    fn receive_wss(&self, _timeout: Duration) -> Result<Vec<u8>> {
        tracing::warn!(
            transport = transport_name(&self.transport_type),
            supported_transports = SUPPORTED_SIP_TRANSPORTS,
            "Unsupported SIP transport path reached for receive"
        );
        Err(unsupported_transport_error(&self.transport_type, "receive"))
    }
}

/// Read one RFC 3261 SIP message from a stream: headers until \r\n\r\n, then body per Content-Length.
pub fn read_one_sip_message<R: Read>(r: &mut R) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    let mut last_three = [0u8; 3];
    let header_end = loop {
        let mut byte = [0u8; 1];
        if r.read(&mut byte)? == 0 {
            if buf.is_empty() {
                anyhow::bail!("EOF before message");
            }
            return Ok(buf);
        }
        buf.push(byte[0]);
        last_three[0] = last_three[1];
        last_three[1] = last_three[2];
        last_three[2] = byte[0];
        if last_three[0] == b'\r' && last_three[1] == b'\n' && last_three[2] == b'\r' {
            let mut next = [0u8; 1];
            if r.read(&mut next)? == 0 {
                return Ok(buf);
            }
            buf.push(next[0]);
            if next[0] == b'\n' {
                break buf.len();
            }
        } else if last_three[1] == b'\n' && last_three[2] == b'\n' {
            break buf.len();
        }
    };
    // RFC 3261 §7.3.1: Unfold continuation lines (lines starting with SP/HTAB are part of
    // the previous header). Then find Content-Length (or compact form "l:").
    let header_slice = &buf[..header_end];
    let content_length = {
        // Unfold headers: join lines that start with SP/HTAB to previous line
        let mut unfolded_lines: Vec<Vec<u8>> = Vec::new();
        for line in header_slice.split(|&b| b == b'\n') {
            let trimmed = line.strip_suffix(b"\r").unwrap_or(line);
            if !trimmed.is_empty() && (trimmed[0] == b' ' || trimmed[0] == b'\t') {
                // Continuation line — append to previous
                if let Some(prev) = unfolded_lines.last_mut() {
                    prev.push(b' ');
                    prev.extend_from_slice(trimmed.strip_prefix(&[b' ']).unwrap_or(trimmed.strip_prefix(&[b'\t']).unwrap_or(trimmed)));
                }
            } else {
                unfolded_lines.push(trimmed.to_vec());
            }
        }
        // Find Content-Length header (case-insensitive) or compact form "l:"
        unfolded_lines
            .iter()
            .find(|line| {
                let lower_start: Vec<u8> = line.iter().take(20).map(|b| b.to_ascii_lowercase()).collect();
                lower_start.starts_with(b"content-length:") || (line.len() >= 2 && lower_start.starts_with(b"l:"))
            })
            .and_then(|line| {
                let colon = line.iter().position(|&b| b == b':')?;
                let rest = std::str::from_utf8(&line[colon + 1..]).ok()?.trim();
                rest.parse::<usize>().ok()
            })
            .unwrap_or(0)
    };
    let body_read = buf.len().saturating_sub(header_end);
    let to_read = content_length.saturating_sub(body_read);
    for _ in 0..to_read {
        let mut byte = [0u8; 1];
        if r.read(&mut byte)? == 0 {
            break;
        }
        buf.push(byte[0]);
    }
    Ok(buf)
}

pub fn check_port_available(port: u16) -> bool {
    match UdpSocket::bind(("0.0.0.0", port)) {
        Ok(_) => true,
        Err(_) => false,
    }
}

pub fn find_available_port(start_port: u16) -> Option<u16> {
    for port in start_port..65535 {
        if check_port_available(port) {
            return Some(port);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_new_supports_udp_and_tcp() {
        assert!(Transport::new(TransportType::Udp, 0, "127.0.0.1", 5060).is_ok());
        assert!(Transport::new(TransportType::Tcp, 0, "127.0.0.1", 5060).is_ok());
    }

    #[test]
    fn transport_new_rejects_tls_and_wss_with_actionable_error() {
        for transport in [TransportType::Tls, TransportType::Wss] {
            let result = Transport::new(transport.clone(), 0, "127.0.0.1", 5060);
            assert!(result.is_err(), "unsupported transport should fail fast");
            let err = result.err().map(|e| e.to_string()).unwrap_or_default();

            assert!(err.contains("Unsupported SIP transport"));
            assert!(err.contains("UDP, TCP"));
            assert!(err.contains("Configure registrar transport to UDP or TCP"));
        }
    }

    #[test]
    fn unsupported_transport_error_is_explicit() {
        let err = unsupported_transport_error(&TransportType::Tls, "send").to_string();
        assert!(err.contains("TLS"));
        assert!(err.contains("send"));
        assert!(err.contains("UDP, TCP"));
    }
}
