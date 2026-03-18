//! Wake-on-LAN (WoL) — sends a magic packet to wake a device by MAC address.
//!
//! The magic packet consists of 6 bytes of `0xFF` followed by the target MAC
//! address repeated 16 times, sent as a UDP broadcast on port 9.

use std::net::{Ipv4Addr, SocketAddr, UdpSocket};

/// Send a Wake-on-LAN magic packet for the given MAC address.
///
/// The MAC address can be colon or dash-separated (e.g., "AA:BB:CC:DD:EE:FF"
/// or "AA-BB-CC-DD-EE-FF"), case-insensitive.
pub fn send_wol(mac: &str) -> Result<(), String> {
    let mac_bytes = parse_mac(mac)?;
    let packet = build_magic_packet(&mac_bytes);

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Failed to bind UDP socket: {}", e))?;

    socket
        .set_broadcast(true)
        .map_err(|e| format!("Failed to enable broadcast: {}", e))?;

    let broadcast_addr = SocketAddr::new(Ipv4Addr::BROADCAST.into(), 9);

    socket
        .send_to(&packet, broadcast_addr)
        .map_err(|e| format!("Failed to send WoL packet: {}", e))?;

    // Also try sending to the common WoL port 7
    let _ = socket.send_to(&packet, SocketAddr::new(Ipv4Addr::BROADCAST.into(), 7));

    Ok(())
}

/// Parse a MAC address string into 6 bytes.
fn parse_mac(mac: &str) -> Result<[u8; 6], String> {
    let mac = mac.trim().to_uppercase();
    let parts: Vec<&str> = if mac.contains(':') {
        mac.split(':').collect()
    } else if mac.contains('-') {
        mac.split('-').collect()
    } else if mac.len() == 12 {
        // No separator: "AABBCCDDEEFF"
        return parse_mac_no_sep(&mac);
    } else {
        return Err(format!("Invalid MAC address format: {}", mac));
    };

    if parts.len() != 6 {
        return Err(format!(
            "MAC address must have 6 octets, got {}: {}",
            parts.len(),
            mac
        ));
    }

    let mut bytes = [0u8; 6];
    for (i, part) in parts.iter().enumerate() {
        bytes[i] = u8::from_str_radix(part, 16)
            .map_err(|_| format!("Invalid hex octet '{}' in MAC: {}", part, mac))?;
    }

    Ok(bytes)
}

fn parse_mac_no_sep(mac: &str) -> Result<[u8; 6], String> {
    if mac.len() != 12 {
        return Err(format!("Invalid MAC address: {}", mac));
    }
    let mut bytes = [0u8; 6];
    for i in 0..6 {
        bytes[i] = u8::from_str_radix(&mac[i * 2..i * 2 + 2], 16)
            .map_err(|_| format!("Invalid hex in MAC: {}", mac))?;
    }
    Ok(bytes)
}

/// Build the WoL magic packet: 6 * 0xFF + 16 * MAC.
fn build_magic_packet(mac: &[u8; 6]) -> Vec<u8> {
    let mut packet = Vec::with_capacity(102);
    // 6 bytes of 0xFF
    packet.extend_from_slice(&[0xFF; 6]);
    // 16 repetitions of the target MAC address
    for _ in 0..16 {
        packet.extend_from_slice(mac);
    }
    packet
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_mac_colon() {
        let mac = parse_mac("AA:BB:CC:DD:EE:FF").unwrap();
        assert_eq!(mac, [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);
    }

    #[test]
    fn test_parse_mac_dash() {
        let mac = parse_mac("aa-bb-cc-dd-ee-ff").unwrap();
        assert_eq!(mac, [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);
    }

    #[test]
    fn test_parse_mac_no_sep() {
        let mac = parse_mac("AABBCCDDEEFF").unwrap();
        assert_eq!(mac, [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);
    }

    #[test]
    fn test_parse_mac_invalid() {
        assert!(parse_mac("ZZ:BB:CC:DD:EE:FF").is_err());
        assert!(parse_mac("AA:BB:CC").is_err());
    }

    #[test]
    fn test_magic_packet_size() {
        let mac = [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF];
        let packet = build_magic_packet(&mac);
        assert_eq!(packet.len(), 102); // 6 + 16*6
    }

    #[test]
    fn test_magic_packet_header() {
        let mac = [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF];
        let packet = build_magic_packet(&mac);
        assert_eq!(&packet[..6], &[0xFF; 6]);
        // First MAC repetition
        assert_eq!(&packet[6..12], &mac);
        // Last MAC repetition
        assert_eq!(&packet[96..102], &mac);
    }
}
