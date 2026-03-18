//! IP range / subnet expansion utilities.
//!
//! Supports:
//! - Single IPs:       `192.168.1.1`
//! - CIDR notation:    `192.168.1.0/24`
//! - Dash ranges:      `192.168.1.1-192.168.1.254`
//! - Last-octet range: `192.168.1.1-254`
//! - Comma-separated:  `192.168.1.1, 10.0.0.1, 172.16.0.0/28`
//! - Mixed:            `192.168.1.0/24, 10.0.0.1-10.0.0.50`

use std::net::{IpAddr, Ipv4Addr};

/// Expand a user-provided target string into a deduplicated, sorted list of IPs.
pub fn expand_targets(input: &str) -> Result<Vec<IpAddr>, String> {
    let mut all_ips: Vec<IpAddr> = Vec::new();

    for segment in input.split(',') {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }

        if segment.contains('/') {
            // CIDR notation
            let ips = expand_cidr(segment)?;
            all_ips.extend(ips);
        } else if segment.contains('-') {
            // Range notation
            let ips = expand_range(segment)?;
            all_ips.extend(ips);
        } else {
            // Single IP
            let ip: IpAddr = segment
                .parse()
                .map_err(|_| format!("Invalid IP address: {}", segment))?;
            all_ips.push(ip);
        }
    }

    // Deduplicate and sort
    all_ips.sort();
    all_ips.dedup();

    if all_ips.is_empty() {
        return Err("No valid IP addresses found in input".to_string());
    }

    Ok(all_ips)
}

/// Expand CIDR notation (e.g., `192.168.1.0/24`) into individual IPs.
/// Excludes network and broadcast addresses for /31 and larger.
fn expand_cidr(cidr: &str) -> Result<Vec<IpAddr>, String> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid CIDR notation: {}", cidr));
    }

    let base_ip: Ipv4Addr = parts[0]
        .trim()
        .parse()
        .map_err(|_| format!("Invalid IP in CIDR: {}", parts[0]))?;

    let prefix_len: u32 = parts[1]
        .trim()
        .parse()
        .map_err(|_| format!("Invalid prefix length: {}", parts[1]))?;

    if prefix_len > 32 {
        return Err(format!("Prefix length must be 0-32, got: {}", prefix_len));
    }

    // Safety: cap at /16 to avoid generating 65k+ IPs accidentally
    if prefix_len < 16 {
        return Err(format!(
            "Prefix /{} would generate {} IPs — maximum allowed is /16 (65534 hosts). \
             Use a narrower range.",
            prefix_len,
            2u64.pow(32 - prefix_len) - 2
        ));
    }

    let ip_u32 = u32::from(base_ip);
    let mask = if prefix_len == 0 {
        0u32
    } else {
        !0u32 << (32 - prefix_len)
    };
    let network = ip_u32 & mask;
    let broadcast = network | !mask;

    let mut ips = Vec::new();

    if prefix_len >= 31 {
        // /31 and /32: include all addresses
        for addr in network..=broadcast {
            ips.push(IpAddr::V4(Ipv4Addr::from(addr)));
        }
    } else {
        // Skip network and broadcast addresses
        for addr in (network + 1)..broadcast {
            ips.push(IpAddr::V4(Ipv4Addr::from(addr)));
        }
    }

    Ok(ips)
}

/// Expand a dash range. Supports two forms:
/// - Full range:       `192.168.1.1-192.168.1.254`
/// - Last-octet range: `192.168.1.1-254`
fn expand_range(range: &str) -> Result<Vec<IpAddr>, String> {
    let parts: Vec<&str> = range.split('-').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid range notation: {}", range));
    }

    let start_str = parts[0].trim();
    let end_str = parts[1].trim();

    let start_ip: Ipv4Addr = start_str
        .parse()
        .map_err(|_| format!("Invalid start IP: {}", start_str))?;

    let end_ip: Ipv4Addr = if end_str.contains('.') {
        // Full IP: 192.168.1.1-192.168.1.254
        end_str
            .parse()
            .map_err(|_| format!("Invalid end IP: {}", end_str))?
    } else {
        // Last-octet shorthand: 192.168.1.1-254
        let last_octet: u8 = end_str
            .parse()
            .map_err(|_| format!("Invalid end octet: {}", end_str))?;
        let octets = start_ip.octets();
        Ipv4Addr::new(octets[0], octets[1], octets[2], last_octet)
    };

    let start_u32 = u32::from(start_ip);
    let end_u32 = u32::from(end_ip);

    if start_u32 > end_u32 {
        return Err(format!(
            "Range start ({}) is greater than end ({})",
            start_ip, end_ip
        ));
    }

    let count = (end_u32 - start_u32 + 1) as u64;
    if count > 65_536 {
        return Err(format!(
            "Range {} to {} contains {} IPs — maximum allowed is 65536",
            start_ip, end_ip, count
        ));
    }

    let mut ips = Vec::with_capacity(count as usize);
    for addr in start_u32..=end_u32 {
        ips.push(IpAddr::V4(Ipv4Addr::from(addr)));
    }

    Ok(ips)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_ip() {
        let ips = expand_targets("192.168.1.1").unwrap();
        assert_eq!(ips.len(), 1);
        assert_eq!(ips[0], IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)));
    }

    #[test]
    fn test_comma_separated() {
        let ips = expand_targets("192.168.1.1, 10.0.0.1").unwrap();
        assert_eq!(ips.len(), 2);
    }

    #[test]
    fn test_cidr_24() {
        let ips = expand_targets("192.168.1.0/24").unwrap();
        assert_eq!(ips.len(), 254); // excludes .0 and .255
        assert_eq!(ips[0], IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)));
        assert_eq!(ips[253], IpAddr::V4(Ipv4Addr::new(192, 168, 1, 254)));
    }

    #[test]
    fn test_cidr_28() {
        let ips = expand_targets("10.0.0.0/28").unwrap();
        assert_eq!(ips.len(), 14); // 16 - 2 (network + broadcast)
    }

    #[test]
    fn test_range_full() {
        let ips = expand_targets("192.168.1.10-192.168.1.20").unwrap();
        assert_eq!(ips.len(), 11);
    }

    #[test]
    fn test_range_last_octet() {
        let ips = expand_targets("192.168.1.10-20").unwrap();
        assert_eq!(ips.len(), 11);
    }

    #[test]
    fn test_mixed() {
        let ips = expand_targets("192.168.1.0/28, 10.0.0.1-10.0.0.5, 172.16.0.1").unwrap();
        assert_eq!(ips.len(), 14 + 5 + 1); // no overlap
    }

    #[test]
    fn test_deduplication() {
        let ips = expand_targets("192.168.1.1, 192.168.1.1, 192.168.1.1").unwrap();
        assert_eq!(ips.len(), 1);
    }

    #[test]
    fn test_invalid_ip() {
        assert!(expand_targets("not.an.ip").is_err());
    }

    #[test]
    fn test_invalid_range() {
        assert!(expand_targets("192.168.1.20-192.168.1.10").is_err());
    }

    #[test]
    fn test_prefix_too_large() {
        assert!(expand_targets("10.0.0.0/8").is_err());
    }
}
