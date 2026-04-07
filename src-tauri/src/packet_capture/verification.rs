/// Trust level of packet provenance used by verification checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PacketProvenance {
    /// Packet came directly from a real capture source (pcap/libpcap/tcpdump).
    WireCapture,
    /// Packet decode was cross-checked against a wire-truth decoder.
    DifferentialWireTruth,
    /// Packet was generated for testing/simulation and is non-authoritative.
    Simulated,
}

/// Result of a single packet-fidelity rule execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FidelityRuleResult {
    pub rule_id: &'static str,
    pub passed: bool,
    pub detail: &'static str,
}

/// Simulated packets are intentionally non-authoritative.
pub fn is_authoritative_provenance(provenance: PacketProvenance) -> bool {
    matches!(
        provenance,
        PacketProvenance::WireCapture | PacketProvenance::DifferentialWireTruth
    )
}

/// Initial lightweight packet-fidelity scaffolding.
///
/// This only checks rule wiring and deterministic invariants; protocol-specific
/// fidelity checks can be added incrementally.
pub fn run_fidelity_scaffold_checks(
    payload_len: usize,
    frame_len: usize,
) -> Vec<FidelityRuleResult> {
    vec![
        FidelityRuleResult {
            rule_id: "frame_len_gte_payload",
            passed: frame_len >= payload_len,
            detail: "frame length must be greater than or equal to payload length",
        },
        FidelityRuleResult {
            rule_id: "non_empty_frame",
            passed: frame_len > 0,
            detail: "frame length must be non-zero",
        },
    ]
}
