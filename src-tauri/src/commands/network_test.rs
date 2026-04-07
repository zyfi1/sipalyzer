use crate::network_test::{
    bandwidth, dns, dscp, jitter, monitor, mos, mtr, mtu, nat_detect, net_info, ntp, packet_loss,
    ping, port_scan, rtp_sim, sip_probe, snmp, speed_test, stun, stun_quality, traceroute, turn,
    wifi,
};
use std::process::Command;
use tauri::Emitter;

// ── Health Check (public endpoints) ─────────────────────────────

/// Well-known public targets for general network health checks.
const PUBLIC_TARGETS: &[(&str, &str)] = &[
    ("8.8.8.8", "Google DNS"),
    ("1.1.1.1", "Cloudflare DNS"),
    ("208.67.222.222", "OpenDNS"),
    ("9.9.9.9", "Quad9 DNS"),
];

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct HealthPingEntry {
    pub host: String,
    pub label: String,
    pub result: ping::PingResult,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct HealthCheckResult {
    pub pings: Vec<HealthPingEntry>,
    pub gateway_reachable: bool,
    pub internet_reachable: bool,
    pub avg_latency_ms: Option<f64>,
    pub best_latency_ms: Option<f64>,
    pub packet_loss_pct: Option<f64>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetworkCapabilityReport {
    pub platform: String,
    pub traceroute_supported: bool,
    pub traceroute_reason: Option<String>,
    pub mtr_supported: bool,
    pub mtr_reason: Option<String>,
    pub wifi_supported: bool,
    pub wifi_reason: Option<String>,
}

fn command_available(cmd: &str, args: &[&str]) -> bool {
    Command::new(cmd)
        .args(args)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_get_capabilities() -> NetworkCapabilityReport {
    let platform = std::env::consts::OS.to_string();

    // Traceroute default path is in-process and does not depend on shell binaries.
    let traceroute_supported = true;
    let traceroute_reason = None;

    let mtr_supported = command_available("mtr", &["--version"]);
    let mtr_reason = if mtr_supported {
        None
    } else {
        Some("mtr is not installed on this host.".to_string())
    };

    let wifi_supported = if cfg!(target_os = "windows") {
        command_available("netsh", &["wlan", "show", "interfaces"])
    } else if cfg!(target_os = "macos") {
        command_available("networksetup", &["-listallhardwareports"])
    } else {
        command_available("iw", &["dev"]) || command_available("iwconfig", &[])
    };
    let wifi_reason = if wifi_supported {
        None
    } else {
        Some("Wi-Fi query tooling is not available on this host.".to_string())
    };

    NetworkCapabilityReport {
        platform,
        traceroute_supported,
        traceroute_reason,
        mtr_supported,
        mtr_reason,
        wifi_supported,
        wifi_reason,
    }
}

/// Runs a quick health check against well-known public endpoints.
/// No user input required — tests general internet connectivity.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_health_check() -> Result<HealthCheckResult, String> {
    let mut pings = Vec::new();

    // Ping all public targets in parallel
    let mut handles = Vec::new();
    for &(host, label) in PUBLIC_TARGETS {
        let h = host.to_string();
        let l = label.to_string();
        handles.push(tokio::spawn(async move {
            let config = ping::PingConfig {
                host: h.clone(),
                count: 5,
                timeout_ms: 2000,
            };
            let result = ping::run_ping(config).await;
            HealthPingEntry {
                host: h,
                label: l,
                result,
            }
        }));
    }

    // Also try to ping default gateway
    let gw_handle = tokio::spawn(async {
        let info = net_info::get_network_info().await;
        if let Some(gw) = info.default_gateway {
            let config = ping::PingConfig {
                host: gw.clone(),
                count: 3,
                timeout_ms: 1000,
            };
            let result = ping::run_ping(config).await;
            Some(HealthPingEntry {
                host: gw,
                label: "Default Gateway".into(),
                result,
            })
        } else {
            None
        }
    });

    for handle in handles {
        if let Ok(entry) = handle.await {
            pings.push(entry);
        }
    }

    let gateway_entry = gw_handle.await.ok().flatten();
    let gateway_reachable = gateway_entry
        .as_ref()
        .map(|e| e.result.success)
        .unwrap_or(false);
    if let Some(gw) = gateway_entry {
        pings.insert(0, gw);
    }

    let internet_reachable = pings
        .iter()
        .any(|p| p.label != "Default Gateway" && p.result.success);

    let successful: Vec<&HealthPingEntry> = pings
        .iter()
        .filter(|p| p.result.success && p.label != "Default Gateway")
        .collect();

    let avg_latency = if !successful.is_empty() {
        Some(successful.iter().map(|p| p.result.avg_ms).sum::<f64>() / successful.len() as f64)
    } else {
        None
    };

    let best_latency = successful
        .iter()
        .map(|p| p.result.min_ms)
        .fold(None, |acc, v| Some(acc.map_or(v, |a: f64| a.min(v))));

    let avg_loss = if !successful.is_empty() {
        Some(
            successful
                .iter()
                .map(|p| p.result.packet_loss_pct)
                .sum::<f64>()
                / successful.len() as f64,
        )
    } else {
        None
    };

    Ok(HealthCheckResult {
        pings,
        gateway_reachable,
        internet_reachable,
        avg_latency_ms: avg_latency,
        best_latency_ms: best_latency,
        packet_loss_pct: avg_loss,
    })
}

// ── Ping / Latency ──────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_ping(
    host: String,
    count: Option<u32>,
    timeout_ms: Option<u64>,
) -> Result<ping::PingResult, String> {
    let config = ping::PingConfig {
        host,
        count: count.unwrap_or(10),
        timeout_ms: timeout_ms.unwrap_or(2000),
    };
    Ok(ping::run_ping(config).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_stop_ping() -> Result<(), String> {
    ping::cancel_ping();
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_jitter(
    host: String,
    port: Option<u16>,
    packet_count: Option<u32>,
    interval_ms: Option<u32>,
) -> Result<jitter::JitterResult, String> {
    let config = jitter::JitterConfig {
        host,
        port: port.unwrap_or(5060),
        packet_count: packet_count.unwrap_or(100),
        interval_ms: interval_ms.unwrap_or(20),
        timeout_ms: 2000,
    };
    Ok(jitter::run_jitter_test(config).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_packet_loss(
    host: String,
    port: Option<u16>,
    burst_size: Option<u32>,
) -> Result<packet_loss::PacketLossResult, String> {
    let config = packet_loss::PacketLossConfig {
        host,
        port: port.unwrap_or(5060),
        burst_size: burst_size.unwrap_or(200),
        timeout_ms: 3000,
    };
    Ok(packet_loss::run_packet_loss_test(config).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_bandwidth(
    host: String,
    port: Option<u16>,
    duration_secs: Option<u32>,
) -> Result<bandwidth::BandwidthResult, String> {
    let config = bandwidth::BandwidthConfig {
        host,
        port: port.unwrap_or(5060),
        duration_secs: duration_secs.unwrap_or(5),
        packet_size: 1200,
    };
    Ok(bandwidth::run_bandwidth_test(config).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_calculate_mos(
    latency_ms: f64,
    jitter_ms: f64,
    packet_loss_pct: f64,
    codec_ie: Option<f64>,
) -> Result<mos::MosResult, String> {
    Ok(mos::calculate_mos(mos::MosInput {
        latency_ms,
        jitter_ms,
        packet_loss_pct,
        codec_ie,
    }))
}

// ── SIP Probe (VoIP-aware latency/jitter/loss) ─────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_sip_probe(
    window: tauri::Window,
    host: String,
    port: Option<u16>,
    count: Option<u32>,
    interval_ms: Option<u32>,
    method: Option<sip_probe::ProbeMethod>,
) -> Result<sip_probe::SipProbeResult, String> {
    let config = sip_probe::SipProbeConfig {
        host,
        port: port.unwrap_or(5060),
        count: count.unwrap_or(20),
        interval_ms: interval_ms.unwrap_or(200),
        timeout_ms: 2000,
        method: method.unwrap_or(sip_probe::ProbeMethod::Auto),
    };
    Ok(sip_probe::run_sip_probe(window, config).await)
}

// ── Path Analysis ───────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_traceroute(
    window: tauri::Window,
    host: String,
    max_hops: Option<u8>,
    timeout_ms: Option<u64>,
    allow_shell_fallback: Option<bool>,
) -> Result<traceroute::TracerouteResult, String> {
    let config = traceroute::TracerouteConfig {
        host,
        max_hops: max_hops.unwrap_or(30),
        timeout_ms: timeout_ms.unwrap_or(2000),
        probes_per_hop: 3,
        allow_shell_fallback: allow_shell_fallback.unwrap_or(false),
    };
    let progress_window = window.clone();
    Ok(
        traceroute::run_traceroute_with_progress(config, move |hop| {
            let _ = progress_window.emit("network-traceroute-hop", hop.clone());
        })
        .await,
    )
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_stop_traceroute() -> Result<(), String> {
    traceroute::cancel_traceroute();
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_mtu_discovery(host: String) -> Result<mtu::MtuResult, String> {
    let config = mtu::MtuConfig {
        host,
        timeout_ms: 2000,
    };
    Ok(mtu::run_mtu_discovery(config).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_dscp_test(
    host: String,
    port: Option<u16>,
    dscp_value: Option<u8>,
) -> Result<dscp::DscpResult, String> {
    let config = dscp::DscpConfig {
        host,
        port: port.unwrap_or(5060),
        dscp_value: dscp_value.unwrap_or(46),
        timeout_ms: 2000,
    };
    Ok(dscp::run_dscp_test(config).await)
}

// ── Connectivity ────────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_port_scan(
    host: String,
    entries: Vec<port_scan::PortTestEntry>,
    timeout_ms: Option<u64>,
    concurrency: Option<u32>,
) -> Result<port_scan::PortScanResult, String> {
    let config = port_scan::PortTestConfig {
        host,
        entries,
        timeout_ms: timeout_ms.unwrap_or(3000),
        concurrency: concurrency.unwrap_or(20),
    };
    Ok(port_scan::run_port_scan(config).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_get_voip_port_presets() -> Vec<(String, Vec<port_scan::PortTestEntry>)> {
    port_scan::voip_presets()
        .into_iter()
        .map(|(name, entries)| (name.to_string(), entries))
        .collect()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_expand_port_range(
    range: String,
    protocol: port_scan::PortProtocol,
    label: Option<String>,
) -> Vec<port_scan::PortTestEntry> {
    port_scan::expand_port_range(&range, protocol, label)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_dns_lookup(domain: String) -> Result<dns::LegacyDnsResult, String> {
    Ok(dns::run_dns_lookup(dns::LegacyDnsConfig { domain }).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_stun_test(
    stun_server: Option<String>,
    stun_port: Option<u16>,
) -> Result<stun::StunResult, String> {
    let config = stun::StunConfig {
        stun_server: stun_server.unwrap_or_else(|| "stun.l.google.com".into()),
        stun_port: stun_port.unwrap_or(19302),
    };
    Ok(stun::run_stun_test(config).await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_turn_test(
    server: String,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
) -> Result<turn::TurnResult, String> {
    let config = turn::TurnConfig {
        server,
        port: port.unwrap_or(3478),
        username,
        password,
    };
    Ok(turn::run_turn_test(config).await)
}

// ── Monitor ─────────────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_start_monitor(
    window: tauri::Window,
    host: String,
    duration_secs: Option<u32>,
    interval_ms: Option<u32>,
) -> Result<(), String> {
    let config = monitor::MonitorConfig {
        host,
        duration_secs: duration_secs.unwrap_or(60),
        interval_ms: interval_ms.unwrap_or(1000),
    };
    // Spawn the monitor in a background task so the command returns immediately
    tokio::spawn(async move {
        if let Err(e) = monitor::start_monitor(window, config).await {
            tracing::error!("Monitor error: {}", e);
        }
    });
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_stop_monitor() -> Result<(), String> {
    monitor::stop_monitor();
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_is_monitor_running() -> bool {
    monitor::is_monitor_running()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_rtp_simulation(
    host: String,
    port: Option<u16>,
    ptime_ms: Option<u32>,
    duration_secs: Option<u32>,
    codec: Option<String>,
) -> Result<rtp_sim::RtpSimResult, String> {
    let codec_name = codec.unwrap_or_else(|| "G.711".into());
    let ptime = ptime_ms.unwrap_or(20);
    let payload_size = match codec_name.as_str() {
        "G.722" => 160,
        _ => 160, // G.711 default
    };
    let config = rtp_sim::RtpSimConfig {
        host,
        port: port.unwrap_or(5060),
        ptime_ms: ptime,
        duration_secs: duration_secs.unwrap_or(10),
        codec: codec_name,
        payload_size,
    };
    Ok(rtp_sim::run_rtp_simulation(config).await)
}

// ── STUN Quality Probe ──────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_stun_quality(
    window: tauri::Window,
    server: Option<String>,
    port: Option<u16>,
    count: Option<u32>,
    interval_ms: Option<u32>,
) -> Result<stun_quality::StunQualityResult, String> {
    let config = stun_quality::StunQualityConfig {
        server: server.unwrap_or_else(|| "stun.l.google.com".into()),
        port: port.unwrap_or(19302),
        count: count.unwrap_or(100),
        interval_ms: interval_ms.unwrap_or(20),
        ..Default::default()
    };
    Ok(stun_quality::run_stun_quality_probe(window, config).await)
}

// ── Speed Test ──────────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_speed_test(
    window: tauri::Window,
    source: Option<String>,
) -> Result<speed_test::SpeedTestResult, String> {
    Ok(speed_test::run_speed_test(window, source).await)
}

// ── Environment ─────────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_get_interfaces() -> Result<net_info::NetInfoResult, String> {
    Ok(net_info::get_network_info().await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_get_wifi_info() -> Result<wifi::WifiInfo, String> {
    Ok(wifi::get_wifi_info().await)
}

// ── MTR (Continuous Traceroute) ─────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_mtr(
    window: tauri::Window,
    host: String,
    max_hops: Option<u8>,
    rounds: Option<u32>,
    interval_ms: Option<u64>,
    timeout_ms: Option<u64>,
) -> Result<mtr::MtrResult, String> {
    let config = mtr::MtrConfig {
        host,
        max_hops: max_hops.unwrap_or(30),
        rounds: rounds.unwrap_or(20),
        interval_ms: interval_ms.unwrap_or(1000),
        timeout_ms: timeout_ms.unwrap_or(2000),
    };
    let progress_window = window.clone();
    Ok(mtr::run_mtr_with_progress(config, move |round, hops| {
        let _ = progress_window.emit(
            "network-mtr-progress",
            MtrProgressEvent {
                round,
                hops: hops.clone(),
            },
        );
    })
    .await)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn network_stop_mtr() -> Result<(), String> {
    mtr::cancel_mtr();
    Ok(())
}

#[derive(Clone, Debug, serde::Serialize)]
struct MtrProgressEvent {
    round: u32,
    hops: Vec<mtr::MtrHop>,
}

// ── NTP / Time Sync Check ───────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_ntp_check(
    servers: Option<Vec<String>>,
    timeout_ms: Option<u64>,
) -> Result<ntp::NtpCheckResult, String> {
    let config = ntp::NtpConfig {
        servers: servers.unwrap_or_else(|| {
            vec![
                "pool.ntp.org".into(),
                "time.google.com".into(),
                "time.cloudflare.com".into(),
            ]
        }),
        timeout_ms: timeout_ms.unwrap_or(3000),
    };
    Ok(ntp::run_ntp_check(config).await)
}

// ── NAT / ALG Detection ────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_nat_detect(
    stun_server: Option<String>,
    stun_port: Option<u16>,
) -> Result<nat_detect::NatDetectResult, String> {
    let config = nat_detect::NatDetectConfig {
        stun_server: stun_server.unwrap_or_else(|| "stun.l.google.com".into()),
        stun_port: stun_port.unwrap_or(19302),
    };
    Ok(nat_detect::run_nat_detect(config).await)
}

// ── SNMP Poller ─────────────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn network_snmp_poll(
    host: String,
    community: Option<String>,
    version: Option<u8>,
    v3_username: Option<String>,
    v3_auth_password: Option<String>,
    v3_priv_password: Option<String>,
    v3_security_level: Option<snmp::SnmpV3SecurityLevel>,
    v3_auth_protocol: Option<snmp::SnmpV3AuthProtocol>,
    v3_privacy_protocol: Option<snmp::SnmpV3PrivacyProtocol>,
) -> Result<snmp::SnmpPollResult, String> {
    let config = snmp::SnmpConfig {
        host,
        community: community.unwrap_or_else(|| "public".into()),
        version: version.unwrap_or(2),
        v3_username,
        v3_auth_password,
        v3_priv_password,
        v3_security_level,
        v3_auth_protocol,
        v3_privacy_protocol,
    };
    Ok(snmp::run_snmp_poll(config).await)
}
