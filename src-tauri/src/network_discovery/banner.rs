//! Lightweight banner grabbing for common TCP services.
//!
//! Connects to open TCP ports, reads the initial response (up to 512 bytes),
//! and parses common protocol banners to identify the service.

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// An open port with service identification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenPort {
    pub port: u16,
    pub protocol: String,
    pub status: String,
    pub service_name: String,
    pub banner: String,
}

/// Well-known ports and their expected protocols.
const COMMON_PORTS: &[(u16, &str)] = &[
    (21, "FTP"),
    (22, "SSH"),
    (23, "Telnet"),
    (25, "SMTP"),
    (53, "DNS"),
    (80, "HTTP"),
    (110, "POP3"),
    (143, "IMAP"),
    (443, "HTTPS"),
    (993, "IMAPS"),
    (995, "POP3S"),
    (3306, "MySQL"),
    (3389, "RDP"),
    (5060, "SIP"),
    (5061, "SIPS"),
    (5432, "PostgreSQL"),
    (8080, "HTTP-ALT"),
    (8443, "HTTPS-ALT"),
];

/// Default ports to scan during a Full scan.
/// Covers SSH, HTTP(S), common services, VoIP, databases, and management ports.
pub const FULL_SCAN_PORTS: &[u16] = &[
    21, 22, 23, 25, 53, 80, 110, 111, 139, 143, 389, 443, 445, 515, 554, 631, 993, 995, 1433, 1521,
    3306, 3389, 5000, 5001, 5060, 5061, 5432, 5900, 6379, 8080, 8443, 8888, 9090, 9100, 9200,
];

/// Probe a single TCP port and grab its banner.
pub async fn probe_port(ip: IpAddr, port: u16, timeout: Duration) -> Option<OpenPort> {
    let addr = SocketAddr::new(ip, port);

    // Try to connect
    let stream = match tokio::time::timeout(timeout, TcpStream::connect(addr)).await {
        Ok(Ok(stream)) => stream,
        _ => return None,
    };

    let expected_proto = guess_protocol(port);
    let (service_name, banner) = grab_banner(stream, port, &expected_proto, timeout).await;

    Some(OpenPort {
        port,
        protocol: "tcp".to_string(),
        status: "open".to_string(),
        service_name,
        banner,
    })
}

/// Scan multiple ports on a single host.
pub async fn scan_ports(
    ip: IpAddr,
    ports: &[u16],
    timeout: Duration,
    concurrency: usize,
) -> Vec<OpenPort> {
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));
    let mut handles = Vec::new();

    for &port in ports {
        let sem = semaphore.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;
            probe_port(ip, port, timeout).await
        }));
    }

    let mut results = Vec::new();
    for h in handles {
        if let Ok(Some(port)) = h.await {
            results.push(port);
        }
    }
    results.sort_by_key(|p| p.port);
    results
}

/// Guess the protocol based on well-known port numbers.
fn guess_protocol(port: u16) -> String {
    for &(p, name) in COMMON_PORTS {
        if p == port {
            return name.to_string();
        }
    }
    "Unknown".to_string()
}

/// Attempt to grab a service banner from an open connection.
async fn grab_banner(
    mut stream: TcpStream,
    port: u16,
    expected_proto: &str,
    timeout: Duration,
) -> (String, String) {
    let mut buf = vec![0u8; 512];

    match expected_proto {
        "HTTP" | "HTTP-ALT" | "HTTPS-ALT" => {
            // Send a minimal HTTP request to elicit a response
            let req = format!(
                "HEAD / HTTP/1.0\r\nHost: {}\r\nUser-Agent: NetworkScanner/1.0\r\n\r\n",
                stream
                    .peer_addr()
                    .map(|a| a.ip().to_string())
                    .unwrap_or_default()
            );
            let _ = stream.write_all(req.as_bytes()).await;
        }
        _ => {
            // For SSH, FTP, SMTP, Telnet, etc. — the server sends a banner first.
            // We just read.
        }
    }

    // Read response
    let banner = match tokio::time::timeout(
        Duration::from_millis(timeout.as_millis() as u64),
        stream.read(&mut buf),
    )
    .await
    {
        Ok(Ok(n)) if n > 0 => String::from_utf8_lossy(&buf[..n]).to_string(),
        _ => String::new(),
    };

    let service = identify_service(port, &banner, expected_proto);
    (service, sanitize_banner(&banner))
}

/// Identify the service from the banner content.
fn identify_service(port: u16, banner: &str, expected: &str) -> String {
    let banner_lower = banner.to_lowercase();

    // SSH: "SSH-2.0-OpenSSH_8.9p1 ..."
    if banner.starts_with("SSH-") {
        return format!("SSH ({})", banner.lines().next().unwrap_or("").trim());
    }

    // FTP: "220 ..." banner
    if banner.starts_with("220") && (port == 21 || banner_lower.contains("ftp")) {
        return "FTP".to_string();
    }

    // SMTP: "220 ... SMTP" or "220 ... ESMTP"
    if banner.starts_with("220")
        && (banner_lower.contains("smtp") || banner_lower.contains("esmtp"))
    {
        return "SMTP".to_string();
    }

    // HTTP: look for "Server:" header
    if banner.contains("HTTP/") {
        if let Some(server) = extract_http_server(&banner) {
            return format!("HTTP ({})", server);
        }
        return "HTTP".to_string();
    }

    // SIP: "SIP/2.0" response
    if banner.contains("SIP/2.0") {
        return "SIP".to_string();
    }

    // MySQL: usually starts with version packet
    if port == 3306 && banner.len() > 4 {
        return "MySQL".to_string();
    }

    // PostgreSQL
    if port == 5432 {
        return "PostgreSQL".to_string();
    }

    // Telnet
    if port == 23 {
        return "Telnet".to_string();
    }

    expected.to_string()
}

/// Extract the "Server:" header value from an HTTP response.
fn extract_http_server(response: &str) -> Option<String> {
    for line in response.lines() {
        let line_lower = line.to_lowercase();
        if line_lower.starts_with("server:") {
            return Some(line.splitn(2, ':').nth(1)?.trim().to_string());
        }
    }
    None
}

/// Sanitize banner text for display (remove control characters, limit length).
fn sanitize_banner(banner: &str) -> String {
    banner
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\r')
        .take(256)
        .collect::<String>()
        .trim()
        .to_string()
}
