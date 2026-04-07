//! ARP sweep — discovers alive hosts on the local subnet with MAC addresses.
//!
//! Primary method: send ARP who-has packets for each target IP and collect replies.
//! Fallback: parse `arp -a` output if raw sockets are unavailable (no elevated privileges).

use std::collections::HashMap;
use std::net::IpAddr;
use std::process::Command;

/// Result of an ARP probe for a single host.
#[derive(Debug, Clone)]
pub struct ArpEntry {
    pub ip: String,
    pub mac: String,
}

/// Run an ARP sweep for the given list of IPs.
///
/// Uses the system `arp` table first (fast, no privileges needed), then falls
/// back to pinging + re-reading the table for any IPs not yet cached.
pub async fn arp_sweep(ips: &[IpAddr]) -> Vec<ArpEntry> {
    if strict_mode_enabled() {
        tracing::warn!(
            "Strict diagnostics mode enabled: ARP discovery via shell tools is disabled (requires `ping`/`arp` commands)."
        );
        return Vec::new();
    }

    // Step 1: Ping all IPs quickly to populate the ARP cache
    ping_batch(ips).await;

    // Step 2: Read the ARP table
    let arp_table = read_arp_table();

    // Step 3: Match requested IPs against the ARP table
    let mut results = Vec::new();
    for ip in ips {
        let ip_str = ip.to_string();
        if let Some(mac) = arp_table.get(&ip_str) {
            if !is_incomplete_mac(mac) {
                results.push(ArpEntry {
                    ip: ip_str,
                    mac: normalize_mac(mac),
                });
            }
        }
    }

    results
}

/// Ping a batch of IPs with short timeout to populate ARP caches.
/// Uses tokio tasks for parallelism.
async fn ping_batch(ips: &[IpAddr]) {
    use tokio::process::Command as TokioCommand;

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(50));
    let mut handles = Vec::new();

    for ip in ips {
        let ip_str = ip.to_string();
        let sem = semaphore.clone();

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;
            // Single ping with 500ms timeout
            let _ = TokioCommand::new("ping")
                .args(ping_args(&ip_str))
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await;
        }));
    }

    for h in handles {
        let _ = h.await;
    }
}

/// Platform-specific ping arguments for a single, fast ping.
fn ping_args(ip: &str) -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec![
            "-n".into(),
            "1".into(),
            "-w".into(),
            "500".into(),
            ip.into(),
        ]
    } else {
        vec!["-c".into(), "1".into(), "-W".into(), "1".into(), ip.into()]
    }
}

/// Read the system ARP table. Returns a map of IP → MAC.
fn read_arp_table() -> HashMap<String, String> {
    let mut map = HashMap::new();

    let output = if cfg!(target_os = "windows") {
        Command::new("arp").arg("-a").output()
    } else {
        Command::new("arp").arg("-a").output()
    };

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            tracing::debug!("Failed to execute `arp -a`: {}", e);
            return map;
        }
    };

    let text = String::from_utf8_lossy(&output.stdout);

    for line in text.lines() {
        if let Some(entry) = parse_arp_line(line) {
            map.insert(entry.0, entry.1);
        }
    }

    map
}

fn strict_mode_enabled() -> bool {
    env_flag_enabled("SIPALYZER_DIAGNOSTICS_STRICT")
        || env_flag_enabled("NETWORK_DIAGNOSTICS_STRICT")
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Parse a single line from `arp -a` output.
/// Handles macOS/Linux format: `? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ...`
/// Handles Windows format: `192.168.1.1    aa-bb-cc-dd-ee-ff    dynamic`
fn parse_arp_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();

    // macOS/Linux: `hostname (IP) at MAC on interface [ifscope] ...`
    if line.contains(" at ") {
        let ip = extract_between_parens(line)?;
        let after_at = line.split(" at ").nth(1)?;
        let mac = after_at.split_whitespace().next()?;
        if mac.contains(':') || mac.contains('-') {
            return Some((ip, mac.to_string()));
        }
    }

    // Windows: `IP    MAC    Type`
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 2 {
        let ip_candidate = parts[0];
        let mac_candidate = parts[1];
        if ip_candidate.contains('.')
            && (mac_candidate.contains('-') || mac_candidate.contains(':'))
        {
            return Some((ip_candidate.to_string(), mac_candidate.to_string()));
        }
    }

    None
}

fn extract_between_parens(s: &str) -> Option<String> {
    let start = s.find('(')?;
    let end = s.find(')')?;
    if end > start + 1 {
        Some(s[start + 1..end].to_string())
    } else {
        None
    }
}

/// Check if a MAC address is "(incomplete)" or all zeros.
fn is_incomplete_mac(mac: &str) -> bool {
    mac.contains("incomplete")
        || mac == "(incomplete)"
        || mac == "ff:ff:ff:ff:ff:ff"
        || mac == "00:00:00:00:00:00"
        || mac == "FF-FF-FF-FF-FF-FF"
        || mac == "00-00-00-00-00-00"
}

/// Normalize MAC address to lowercase colon-separated format.
pub fn normalize_mac(mac: &str) -> String {
    mac.to_lowercase()
        .replace('-', ":")
        .split(':')
        .map(|octet| {
            if octet.len() == 1 {
                format!("0{}", octet)
            } else {
                octet.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_mac() {
        assert_eq!(normalize_mac("AA-BB-CC-DD-EE-FF"), "aa:bb:cc:dd:ee:ff");
        assert_eq!(normalize_mac("a:b:c:d:e:f"), "0a:0b:0c:0d:0e:0f");
        assert_eq!(normalize_mac("aa:bb:cc:dd:ee:ff"), "aa:bb:cc:dd:ee:ff");
    }

    #[test]
    fn test_parse_arp_line_macos() {
        let line = "? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]";
        let result = parse_arp_line(line);
        assert!(result.is_some());
        let (ip, mac) = result.unwrap();
        assert_eq!(ip, "192.168.1.1");
        assert_eq!(mac, "aa:bb:cc:dd:ee:ff");
    }

    #[test]
    fn test_parse_arp_line_incomplete() {
        let line = "? (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]";
        let result = parse_arp_line(line);
        // Should still parse, but is_incomplete_mac will filter it
        assert!(result.is_none() || is_incomplete_mac(&result.unwrap().1));
    }

    #[test]
    fn test_is_incomplete() {
        assert!(is_incomplete_mac("(incomplete)"));
        assert!(is_incomplete_mac("ff:ff:ff:ff:ff:ff"));
        assert!(!is_incomplete_mac("aa:bb:cc:dd:ee:ff"));
    }
}
