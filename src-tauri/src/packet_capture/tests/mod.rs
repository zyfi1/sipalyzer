use crate::packet_capture::protocol_decoder::{decode_packet, ApplicationLayer};
use crate::packet_capture::verification::{
    is_authoritative_provenance, run_fidelity_scaffold_checks, PacketProvenance,
};

fn build_ipv4_udp_frame(payload: &[u8], src_port: u16, dst_port: u16) -> Vec<u8> {
    let udp_len = (8 + payload.len()) as u16;
    let ip_len = 20 + udp_len;

    let mut frame = vec![
        // Ethernet
        0x00,
        0x11,
        0x22,
        0x33,
        0x44,
        0x55, // dst
        0x66,
        0x77,
        0x88,
        0x99,
        0xaa,
        0xbb, // src
        0x08,
        0x00, // ethertype = IPv4
        // IPv4
        0x45,
        0x00, // version+ihl, dscp/ecn
        ((ip_len >> 8) & 0xff) as u8,
        (ip_len & 0xff) as u8, // total length
        0x00,
        0x01, // identification
        0x40,
        0x00, // flags/fragment
        64,   // ttl
        17,   // protocol = UDP
        0x00,
        0x00, // checksum (unused by parser)
        192,
        0,
        2,
        1, // src ip
        198,
        51,
        100,
        2, // dst ip
        // UDP
        ((src_port >> 8) & 0xff) as u8,
        (src_port & 0xff) as u8,
        ((dst_port >> 8) & 0xff) as u8,
        (dst_port & 0xff) as u8,
        ((udp_len >> 8) & 0xff) as u8,
        (udp_len & 0xff) as u8,
        0x00,
        0x00, // checksum
    ];
    frame.extend_from_slice(payload);
    frame
}

fn maybe_has_external_decoder() -> bool {
    std::process::Command::new("tshark")
        .arg("-v")
        .output()
        .is_ok()
        || std::process::Command::new("tcpdump")
            .arg("--version")
            .output()
            .is_ok()
}

#[test]
fn simulated_packets_are_never_authoritative() {
    assert!(!is_authoritative_provenance(PacketProvenance::Simulated));
    assert!(is_authoritative_provenance(PacketProvenance::WireCapture));
}

#[test]
fn packet_fidelity_scaffold_rules_pass_for_valid_frame() {
    let payload = b"INVITE sip:bob@example.com SIP/2.0\r\nVia: SIP/2.0/UDP host\r\n\r\n";
    let frame = build_ipv4_udp_frame(payload, 5060, 5060);
    let decoded = decode_packet(&frame, Some(1), Some(1), Some((10000, 60000))).unwrap();
    assert!(matches!(decoded.application, ApplicationLayer::Sip(_)));

    let checks = run_fidelity_scaffold_checks(payload.len(), frame.len());
    assert!(!checks.is_empty());
    assert!(checks.iter().all(|r| r.passed), "{checks:?}");
}

#[test]
fn differential_decode_scaffold_is_explicitly_gated() {
    if std::env::var("SIPALYZER_ENABLE_DIFFERENTIAL_TESTS")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!(
            "Skipping differential decode scaffold: set SIPALYZER_ENABLE_DIFFERENTIAL_TESTS=1 to enable."
        );
        return;
    }

    if !maybe_has_external_decoder() {
        eprintln!(
            "Skipping differential decode scaffold: neither tshark nor tcpdump is available on PATH."
        );
        return;
    }

    // Placeholder assertion: tooling is available and gating works.
    // Real differential decode comparisons can be added on top of this scaffold.
    assert!(is_authoritative_provenance(
        PacketProvenance::DifferentialWireTruth
    ));
}
