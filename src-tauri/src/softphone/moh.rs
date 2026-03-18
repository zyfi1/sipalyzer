//! Music on hold: system (hosted VoIP / PBX). We send silence; the provider or PBX plays MOH to the held party (RFC 3264).

/// MOH: system only — we send silence so the hosted VoIP provider or PBX can play its own MOH.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MohPreset {
    /// Send silence; PBX or hosted provider plays MOH to the held party.
    System,
}

impl MohPreset {
    pub fn from_str(_s: &str) -> Self {
        MohPreset::System
    }
}
