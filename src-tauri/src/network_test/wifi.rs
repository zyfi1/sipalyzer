use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WifiInfo {
    pub ssid: Option<String>,
    pub bssid: Option<String>,
    pub rssi_dbm: Option<i32>,
    pub noise_dbm: Option<i32>,
    pub channel: Option<u32>,
    pub tx_rate_mbps: Option<f64>,
    pub security: Option<String>,
    pub signal_quality_pct: Option<u32>,
    pub success: bool,
    pub error: Option<String>,
}

/// Gets Wi-Fi signal information using platform-specific system commands.
pub async fn get_wifi_info() -> WifiInfo {
    tokio::task::spawn_blocking(get_wifi_blocking)
        .await
        .unwrap_or_else(|e| WifiInfo {
            ssid: None,
            bssid: None,
            rssi_dbm: None,
            noise_dbm: None,
            channel: None,
            tx_rate_mbps: None,
            security: None,
            signal_quality_pct: None,
            success: false,
            error: Some(format!("Task error: {}", e)),
        })
}

fn get_wifi_blocking() -> WifiInfo {
    #[cfg(target_os = "macos")]
    {
        let mut info = get_wifi_macos();
        normalize_wifi_metrics(&mut info);
        info
    }

    #[cfg(target_os = "linux")]
    {
        let mut info = get_wifi_linux();
        normalize_wifi_metrics(&mut info);
        info
    }

    #[cfg(target_os = "windows")]
    {
        let mut info = get_wifi_windows();
        normalize_wifi_metrics(&mut info);
        info
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        WifiInfo {
            ssid: None,
            bssid: None,
            rssi_dbm: None,
            noise_dbm: None,
            channel: None,
            tx_rate_mbps: None,
            security: None,
            signal_quality_pct: None,
            success: false,
            error: Some("Wi-Fi info not supported on this platform".into()),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  macOS — system_profiler only, no SSID (Apple requires Location
//  Services for that and it's not worth the hassle).
// ═══════════════════════════════════════════════════════════════════

#[cfg(target_os = "macos")]
fn get_wifi_macos() -> WifiInfo {
    let mut info = WifiInfo {
        ssid: None,
        bssid: None,
        rssi_dbm: None,
        noise_dbm: None,
        channel: None,
        tx_rate_mbps: None,
        security: None,
        signal_quality_pct: None,
        success: true,
        error: None,
    };

    let mut is_connected = false;

    // system_profiler gives us signal strength, channel, security, tx rate
    if let Ok(out) = Command::new("system_profiler")
        .args(["SPAirPortDataType", "-detailLevel", "basic"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&out.stdout);

        for line in stdout.lines() {
            if line.trim().starts_with("Status:") && line.contains("Connected") {
                is_connected = true;
                break;
            }
        }

        parse_system_profiler_details(&stdout, &mut info);
    }

    // If we have signal data we're connected
    if info.rssi_dbm.is_some() || info.channel.is_some() {
        is_connected = true;
    }

    // Filter out redacted/unusable SSID values from system_profiler
    if let Some(ref ssid) = info.ssid {
        let lower = ssid.to_lowercase();
        if lower.contains("redacted") || lower == "unknown" || ssid.starts_with('<') {
            info.ssid = None;
        }
    }

    // Fallback: use networksetup to get SSID if system_profiler didn't provide it
    if info.ssid.is_none() && is_connected {
        if let Some(ssid) = get_ssid_via_networksetup() {
            info.ssid = Some(ssid);
        }
    }

    if !is_connected {
        info.success = false;
        info.error = Some("No active Wi-Fi connection found".into());
    }

    info
}

/// Try to get the Wi-Fi SSID via `networksetup -getairportnetwork`.
/// Works on macOS even when system_profiler redacts the SSID.
#[cfg(target_os = "macos")]
fn get_ssid_via_networksetup() -> Option<String> {
    // Try common Wi-Fi interface names
    for iface in &["en0", "en1"] {
        if let Ok(out) = Command::new("networksetup")
            .args(["-getairportnetwork", iface])
            .output()
        {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // Output format: "Current Wi-Fi Network: MyNetworkName"
            if let Some(ssid) = stdout.strip_prefix("Current Wi-Fi Network: ") {
                let ssid = ssid.trim();
                if !ssid.is_empty()
                    && !ssid.to_lowercase().contains("redacted")
                    && !ssid.starts_with("You are not")
                {
                    return Some(ssid.to_string());
                }
            }
        }
    }
    None
}

/// Parse signal details from system_profiler output.
#[cfg(target_os = "macos")]
fn parse_system_profiler_details(output: &str, info: &mut WifiInfo) {
    let mut in_current_network = false;
    let mut found_network_header = false;

    for line in output.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("Current Network Information:") {
            in_current_network = true;
            found_network_header = false;
            continue;
        }

        if !in_current_network {
            continue;
        }

        if trimmed.is_empty() {
            continue;
        }

        let leading_spaces = line.len() - line.trim_start().len();
        if found_network_header && leading_spaces <= 8 && !trimmed.is_empty() {
            break;
        }

        // Network name header line (e.g. "MyNetwork:")
        if !found_network_header && trimmed.ends_with(':') && !trimmed.contains(" / ") {
            let name = trimmed.trim_end_matches(':').trim();
            if !name.is_empty() {
                info.ssid = Some(name.to_string());
            }
            found_network_header = true;
            continue;
        }

        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim();
            let val = val.trim();

            match key {
                "Channel" => {
                    info.channel = val
                        .split(|c: char| !c.is_ascii_digit())
                        .next()
                        .and_then(|c| c.parse().ok());
                }
                "Security" => info.security = Some(val.to_string()),
                "Signal / Noise" => {
                    let parts: Vec<&str> = val.split('/').collect();
                    if let Some(signal_str) = parts.first() {
                        info.rssi_dbm = signal_str.trim().replace("dBm", "").trim().parse().ok();
                    }
                    if let Some(noise_str) = parts.get(1) {
                        info.noise_dbm = noise_str.trim().replace("dBm", "").trim().parse().ok();
                    }
                }
                "Transmit Rate" => {
                    info.tx_rate_mbps = val.trim().parse().ok();
                }
                _ => {}
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  Linux — iw / iwconfig (SSID available without special permissions)
// ═══════════════════════════════════════════════════════════════════

#[cfg(target_os = "linux")]
fn get_wifi_linux() -> WifiInfo {
    let mut info = WifiInfo {
        ssid: None,
        bssid: None,
        rssi_dbm: None,
        noise_dbm: None,
        channel: None,
        tx_rate_mbps: None,
        security: None,
        signal_quality_pct: None,
        success: true,
        error: None,
    };

    let iw_ok = try_iw_linux(&mut info);
    if !iw_ok {
        try_iwconfig_linux(&mut info);
    }

    if info.ssid.is_none() && info.rssi_dbm.is_none() {
        info.success = false;
        info.error = Some("No active Wi-Fi connection found (tried iw and iwconfig)".into());
    }

    info
}

#[cfg(target_os = "linux")]
fn try_iw_linux(info: &mut WifiInfo) -> bool {
    let iface = detect_linux_wifi_iface().unwrap_or_else(|| "wlan0".to_string());

    let Ok(out) = Command::new("iw").args(["dev", &iface, "link"]).output() else {
        return false;
    };
    let stdout = String::from_utf8_lossy(&out.stdout);

    if stdout.contains("Not connected") {
        return false;
    }

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("SSID:") {
            info.ssid = Some(trimmed.trim_start_matches("SSID:").trim().to_string());
        } else if trimmed.starts_with("signal:") {
            info.rssi_dbm = trimmed
                .trim_start_matches("signal:")
                .trim()
                .replace("dBm", "")
                .trim()
                .parse()
                .ok();
        } else if trimmed.starts_with("tx bitrate:") {
            if let Some(rate_str) = trimmed.split_whitespace().nth(2) {
                info.tx_rate_mbps = rate_str.parse().ok();
            }
        }
    }

    if let Ok(info_out) = Command::new("iw").args(["dev", &iface, "info"]).output() {
        let info_stdout = String::from_utf8_lossy(&info_out.stdout);
        for line in info_stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("channel") {
                info.channel = trimmed
                    .split_whitespace()
                    .nth(1)
                    .and_then(|c| c.parse().ok());
                break;
            }
        }
    }

    info.ssid.is_some() || info.rssi_dbm.is_some()
}

#[cfg(target_os = "linux")]
fn try_iwconfig_linux(info: &mut WifiInfo) {
    let Ok(out) = Command::new("iwconfig").output() else {
        return;
    };
    let stdout = String::from_utf8_lossy(&out.stdout);

    for line in stdout.lines() {
        if line.contains("ESSID:") {
            if let Some(ssid) = line.split("ESSID:\"").nth(1) {
                info.ssid = Some(ssid.trim_end_matches('"').to_string());
            }
        }
        if line.contains("Link Quality=") {
            if let Some(quality_str) = line.split("Link Quality=").nth(1) {
                if let Some(fraction) = quality_str.split_whitespace().next() {
                    if let Some((num, denom)) = fraction.split_once('/') {
                        if let (Ok(n), Ok(d)) = (num.parse::<f64>(), denom.parse::<f64>()) {
                            if d > 0.0 {
                                info.signal_quality_pct = Some(((n / d) * 100.0) as u32);
                            }
                        }
                    }
                }
            }
        }
        if line.contains("Signal level=") {
            if let Some(level) = line.split("Signal level=").nth(1) {
                let level = level.split_whitespace().next().unwrap_or("");
                info.rssi_dbm = level.replace("dBm", "").trim().parse().ok();
            }
        }
        if line.contains("Bit Rate=") || line.contains("Bit Rate:") {
            let rate_str = line.split("Bit Rate").nth(1).unwrap_or("");
            let rate_str = rate_str.trim_start_matches(['=', ':']).trim();
            if let Some(rate) = rate_str.split_whitespace().next() {
                info.tx_rate_mbps = rate.parse().ok();
            }
        }
        if line.contains("Frequency:") {
            if let Some(ch) = line.split("Channel ").nth(1) {
                info.channel = ch.split(')').next().and_then(|c| c.parse().ok());
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn detect_linux_wifi_iface() -> Option<String> {
    if let Ok(contents) = std::fs::read_to_string("/proc/net/wireless") {
        for line in contents.lines().skip(2) {
            if let Some(iface) = line.split(':').next() {
                let iface = iface.trim();
                if !iface.is_empty() {
                    return Some(iface.to_string());
                }
            }
        }
    }
    None
}

// ═══════════════════════════════════════════════════════════════════
//  Windows — netsh (SSID available without special permissions)
// ═══════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
fn get_wifi_windows() -> WifiInfo {
    let output = Command::new("netsh")
        .args(["wlan", "show", "interfaces"])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut info = WifiInfo {
                ssid: None,
                bssid: None,
                rssi_dbm: None,
                noise_dbm: None,
                channel: None,
                tx_rate_mbps: None,
                security: None,
                signal_quality_pct: None,
                success: true,
                error: None,
            };

            for line in stdout.lines() {
                let line = line.trim();
                if let Some((key, val)) = line.split_once(':') {
                    let key = key.trim().to_lowercase();
                    let val = val.trim();
                    match key.as_str() {
                        "ssid" if !key.contains("bssid") => info.ssid = Some(val.to_string()),
                        "bssid" => info.bssid = Some(val.to_string()),
                        "signal" => {
                            let pct: Option<u32> = val.replace('%', "").trim().parse().ok();
                            info.signal_quality_pct = pct;
                            if let Some(p) = pct {
                                info.rssi_dbm = Some(quality_to_rssi(p));
                            }
                        }
                        "channel" => info.channel = val.parse().ok(),
                        "receive rate (mbps)" | "transmit rate (mbps)" => {
                            if info.tx_rate_mbps.is_none() {
                                info.tx_rate_mbps = val.parse().ok();
                            }
                        }
                        "authentication" => info.security = Some(val.to_string()),
                        _ => {}
                    }
                }
            }

            if info.ssid.is_none() && info.signal_quality_pct.is_none() {
                info.success = false;
                info.error = Some("No active Wi-Fi connection found".into());
            }

            info
        }
        Err(e) => WifiInfo {
            ssid: None,
            bssid: None,
            rssi_dbm: None,
            noise_dbm: None,
            channel: None,
            tx_rate_mbps: None,
            security: None,
            signal_quality_pct: None,
            success: false,
            error: Some(format!("Failed to run netsh: {}", e)),
        },
    }
}

// ═══════════════════════════════════════════════════════════════════
//  Shared helpers
// ═══════════════════════════════════════════════════════════════════

/// Convert RSSI (dBm) to signal quality percentage.
/// Uses a piecewise model that better tracks perceived quality across OSes.
fn rssi_to_quality(rssi: i32) -> u32 {
    if rssi <= -90 {
        0
    } else if rssi <= -80 {
        (((rssi + 90) as f64 / 10.0) * 25.0).round() as u32
    } else if rssi <= -70 {
        (25.0 + ((rssi + 80) as f64 / 10.0) * 25.0).round() as u32
    } else if rssi <= -60 {
        (50.0 + ((rssi + 70) as f64 / 10.0) * 25.0).round() as u32
    } else if rssi <= -50 {
        (75.0 + ((rssi + 60) as f64 / 10.0) * 15.0).round() as u32
    } else if rssi <= -40 {
        (90.0 + ((rssi + 50) as f64 / 10.0) * 10.0).round() as u32
    } else {
        100
    }
}

/// Convert SNR (signal-to-noise ratio in dB) to signal quality percentage.
/// Piecewise mapping to avoid over-crediting very low-noise environments.
fn snr_to_quality(snr_db: i32) -> u32 {
    if snr_db <= 0 {
        0
    } else if snr_db <= 10 {
        ((snr_db as f64 / 10.0) * 30.0).round() as u32
    } else if snr_db <= 20 {
        (30.0 + ((snr_db - 10) as f64 / 10.0) * 30.0).round() as u32
    } else if snr_db <= 30 {
        (60.0 + ((snr_db - 20) as f64 / 10.0) * 20.0).round() as u32
    } else if snr_db <= 40 {
        (80.0 + ((snr_db - 30) as f64 / 10.0) * 20.0).round() as u32
    } else {
        100
    }
}

/// Normalize an OS-provided quality percentage into our canonical 0-100 range.
fn normalize_vendor_quality_pct(quality: u32) -> u32 {
    quality.min(100)
}

/// Estimate RSSI from signal quality percentage.
#[allow(dead_code)]
fn quality_to_rssi(quality: u32) -> i32 {
    let q = quality.min(100) as f64;
    (-90.0 + (q / 100.0 * 50.0)).round() as i32
}

/// Produce a platform-agnostic Wi-Fi quality view:
/// 1) Use blended RSSI+SNR quality when both exist
/// 2) Else derive from RSSI
/// 3) Else use vendor percentage
/// Also backfill RSSI from quality when only quality is present.
fn normalize_wifi_metrics(info: &mut WifiInfo) {
    let vendor_quality = info.signal_quality_pct.map(normalize_vendor_quality_pct);
    let mut rssi_was_backfilled = false;

    if info.rssi_dbm.is_none() {
        if let Some(vq) = vendor_quality {
            info.rssi_dbm = Some(quality_to_rssi(vq));
            rssi_was_backfilled = true;
        }
    }

    info.signal_quality_pct = match (info.rssi_dbm, info.noise_dbm, vendor_quality) {
        // Best case: we have both RSSI and noise, so blend RSSI + SNR.
        (Some(rssi), Some(noise), _) => {
            let rssi_q = rssi_to_quality(rssi) as f64;
            let snr_q = snr_to_quality(rssi - noise) as f64;
            Some((rssi_q * 0.65 + snr_q * 0.35).round() as u32)
        }
        // If RSSI was synthesized from vendor quality, keep vendor quality as canonical.
        (Some(_), _, Some(vq)) if rssi_was_backfilled => Some(vq),
        // If both measured RSSI and vendor quality exist, lightly blend to smooth OS variance.
        (Some(rssi), _, Some(vq)) => {
            let rssi_q = rssi_to_quality(rssi) as f64;
            Some((rssi_q * 0.7 + vq as f64 * 0.3).round() as u32)
        }
        // RSSI only.
        (Some(rssi), _, None) => Some(rssi_to_quality(rssi)),
        // Vendor quality only.
        (None, _, Some(vq)) => Some(vq),
        _ => None,
    };
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_vendor_quality_pct, normalize_wifi_metrics, quality_to_rssi, rssi_to_quality,
        snr_to_quality, WifiInfo,
    };

    #[test]
    fn rssi_to_quality_uses_expected_range() {
        assert_eq!(rssi_to_quality(-90), 0);
        assert_eq!(rssi_to_quality(-40), 100);
        assert_eq!(rssi_to_quality(-60), 75);
    }

    #[test]
    fn snr_to_quality_is_linear_and_clamped() {
        assert_eq!(snr_to_quality(-5), 0);
        assert_eq!(snr_to_quality(0), 0);
        assert_eq!(snr_to_quality(20), 60);
        assert_eq!(snr_to_quality(30), 80);
        assert_eq!(snr_to_quality(40), 100);
        assert_eq!(snr_to_quality(55), 100);
    }

    #[test]
    fn quality_to_rssi_matches_updated_scale() {
        assert_eq!(quality_to_rssi(0), -90);
        assert_eq!(quality_to_rssi(100), -40);
        assert_eq!(quality_to_rssi(60), -60);
    }

    #[test]
    fn normalize_vendor_quality_pct_clamps() {
        assert_eq!(normalize_vendor_quality_pct(0), 0);
        assert_eq!(normalize_vendor_quality_pct(67), 67);
        assert_eq!(normalize_vendor_quality_pct(100), 100);
        assert_eq!(normalize_vendor_quality_pct(130), 100);
    }

    #[test]
    fn normalize_wifi_metrics_blends_rssi_and_snr() {
        let mut info = WifiInfo {
            ssid: Some("lab".into()),
            bssid: None,
            rssi_dbm: Some(-67),
            noise_dbm: Some(-95),
            channel: None,
            tx_rate_mbps: None,
            security: None,
            signal_quality_pct: None,
            success: true,
            error: None,
        };
        normalize_wifi_metrics(&mut info);
        assert_eq!(info.signal_quality_pct, Some(64));
    }
}
