use serde::{Deserialize, Serialize};

/// ITU-T G.107 E-model parameters for MOS estimation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MosInput {
    pub latency_ms: f64,
    pub jitter_ms: f64,
    pub packet_loss_pct: f64,
    /// Codec impairment factor (default: 0 for G.711)
    pub codec_ie: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MosResult {
    pub r_factor: f64,
    pub mos: f64,
    pub quality: String,
    pub latency_ms: f64,
    pub jitter_ms: f64,
    pub packet_loss_pct: f64,
}

/// Calculate MOS score using the ITU-T G.107 E-model simplified algorithm.
///
/// R = R0 - Is - Id - Ie_eff + A
/// MOS = 1 + 0.035*R + R*(R-60)*(100-R)*7e-6
///
/// Where:
/// - R0 = 93.2 (basic signal-to-noise ratio)
/// - Is = 0 (simultaneous impairment factor, simplified)
/// - Id = delay impairment (from one-way delay)
/// - Ie_eff = effective equipment impairment (codec + packet loss)
/// - A = 0 (advantage factor)
pub fn calculate_mos(input: MosInput) -> MosResult {
    let r0 = 93.2f64;
    let codec_ie = input.codec_ie.unwrap_or(0.0); // G.711 = 0

    // Delay impairment factor (Id)
    // Treat latency_ms as one-way latency. Halving underestimates impairment and
    // overstates MOS in degraded network conditions.
    let one_way_delay = input.latency_ms + input.jitter_ms;
    let id = if one_way_delay > 177.3 {
        0.024 * one_way_delay + 0.11 * (one_way_delay - 177.3) * step(one_way_delay - 177.3)
    } else {
        0.024 * one_way_delay
    };

    // Effective equipment impairment (Ie_eff)
    // Accounts for codec impairment + packet loss
    let bpl = 25.0; // Packet loss robustness factor (codec dependent, ~25 for G.711)
    let ie_eff =
        codec_ie + (95.0 - codec_ie) * (input.packet_loss_pct / (input.packet_loss_pct + bpl));

    // R-factor
    let mut r = r0 - id - ie_eff;
    r = r.clamp(0.0, 100.0);

    // Convert R to MOS
    let mos = if r <= 0.0 {
        1.0
    } else if r >= 100.0 {
        4.5
    } else {
        1.0 + 0.035 * r + r * (r - 60.0) * (100.0 - r) * 7.0e-6
    };

    let mos = mos.clamp(1.0, 5.0);

    let quality = match mos {
        m if m >= 4.3 => "Excellent",
        m if m >= 4.0 => "Good",
        m if m >= 3.6 => "Fair",
        m if m >= 3.1 => "Poor",
        _ => "Bad",
    }
    .to_string();

    MosResult {
        r_factor: r,
        mos,
        quality,
        latency_ms: input.latency_ms,
        jitter_ms: input.jitter_ms,
        packet_loss_pct: input.packet_loss_pct,
    }
}

fn step(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_excellent_conditions() {
        let result = calculate_mos(MosInput {
            latency_ms: 20.0,
            jitter_ms: 1.0,
            packet_loss_pct: 0.0,
            codec_ie: None,
        });
        assert!(result.mos > 4.3);
        assert_eq!(result.quality, "Excellent");
    }

    #[test]
    fn test_poor_conditions() {
        let result = calculate_mos(MosInput {
            latency_ms: 300.0,
            jitter_ms: 50.0,
            packet_loss_pct: 5.0,
            codec_ie: None,
        });
        assert!(result.mos < 3.6);
    }
}
