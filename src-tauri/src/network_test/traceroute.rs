use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{IpAddr, SocketAddr};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

static TRACEROUTE_CANCELLED: AtomicBool = AtomicBool::new(false);
static ACTIVE_TRACEROUTE_CHILD: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

pub fn cancel_traceroute() {
    TRACEROUTE_CANCELLED.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = ACTIVE_TRACEROUTE_CHILD.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
        }
        *guard = None;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteConfig {
    pub host: String,
    pub max_hops: u8,
    pub timeout_ms: u64,
    pub probes_per_hop: u8,
    /// Explicit per-call override to allow shell traceroute fallback.
    /// Default runtime path stays in-process unless this or env opt-in is set.
    pub allow_shell_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteResult {
    pub host: String,
    pub resolved_ip: String,
    pub hops: Vec<TracerouteHop>,
    pub reached_destination: bool,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteHop {
    pub hop: u8,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub rtt_ms: Vec<Option<f64>>,
    pub avg_rtt_ms: Option<f64>,
}

impl Default for TracerouteConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            max_hops: 30,
            timeout_ms: 2000,
            probes_per_hop: 3,
            allow_shell_fallback: false,
        }
    }
}

/// UDP-based traceroute implementation.
/// Sends UDP packets with incrementing TTL and listens for ICMP Time Exceeded replies.
#[tracing::instrument(skip_all, fields(host = %config.host))]
pub async fn run_traceroute(config: TracerouteConfig) -> TracerouteResult {
    run_traceroute_with_progress(config, |_hop| {}).await
}

#[tracing::instrument(skip_all, fields(host = %config.host))]
pub async fn run_traceroute_with_progress<F>(
    config: TracerouteConfig,
    on_hop: F,
) -> TracerouteResult
where
    F: FnMut(&TracerouteHop) + Send + 'static,
{
    TRACEROUTE_CANCELLED.store(false, Ordering::SeqCst);
    let dest_ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return TracerouteResult {
                host: config.host,
                resolved_ip: String::new(),
                hops: vec![],
                reached_destination: false,
                success: false,
                error: Some(e),
            };
        }
    };

    // Run traceroute in blocking task since we use socket2 (synchronous)
    let max_hops = config.max_hops;
    let timeout_ms = config.timeout_ms;
    let probes_per_hop = config.probes_per_hop;
    let allow_shell_fallback = config.allow_shell_fallback;
    let host = config.host.clone();
    let mut hop_callback = on_hop;

    let result = tokio::task::spawn_blocking(move || {
        run_traceroute_blocking(
            dest_ip,
            max_hops,
            timeout_ms,
            probes_per_hop,
            allow_shell_fallback,
            Some(&mut hop_callback),
        )
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task error: {}", e)));

    let result = match result {
        Ok((hops, reached)) => TracerouteResult {
            host,
            resolved_ip: dest_ip.to_string(),
            hops,
            reached_destination: reached,
            success: true,
            error: None,
        },
        Err(e) => TracerouteResult {
            host,
            resolved_ip: dest_ip.to_string(),
            hops: vec![],
            reached_destination: false,
            success: false,
            error: Some(e),
        },
    };
    result
}

fn run_traceroute_blocking(
    dest_ip: IpAddr,
    max_hops: u8,
    timeout_ms: u64,
    probes_per_hop: u8,
    allow_shell_fallback: bool,
    mut on_hop: Option<&mut dyn FnMut(&TracerouteHop)>,
) -> Result<(Vec<TracerouteHop>, bool), String> {
    // Default path: in-process implementation only.
    // Shell tools are optional and explicitly opt-in.
    let socket_result = {
        let cb = on_hop
            .as_mut()
            .map(|cb| &mut **cb as &mut dyn FnMut(&TracerouteHop));
        run_socket_traceroute_blocking(dest_ip, max_hops, timeout_ms, probes_per_hop, cb)
    };
    match socket_result {
        Ok((hops, reached)) => Ok((hops, reached)),
        Err(socket_err) => {
            if !shell_fallback_enabled(allow_shell_fallback) {
                return Err(format!(
                    "{} (shell traceroute fallback disabled by default; opt in with allow_shell_fallback or SIPALYZER_TRACEROUTE_ALLOW_SHELL=1)",
                    socket_err
                ));
            }

            let (hops, reached) =
                run_system_traceroute(dest_ip, max_hops, timeout_ms, probes_per_hop)?;
            for hop in &hops {
                if let Some(cb) = on_hop.as_mut() {
                    cb(hop);
                }
            }
            Ok((hops, reached))
        }
    }
}

fn shell_fallback_enabled(per_call_opt_in: bool) -> bool {
    per_call_opt_in || env_flag_enabled("SIPALYZER_TRACEROUTE_ALLOW_SHELL")
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

fn run_socket_traceroute_blocking(
    dest_ip: IpAddr,
    max_hops: u8,
    timeout_ms: u64,
    probes_per_hop: u8,
    mut on_hop: Option<&mut dyn FnMut(&TracerouteHop)>,
) -> Result<(Vec<TracerouteHop>, bool), String> {
    let domain = if dest_ip.is_ipv4() {
        Domain::IPV4
    } else {
        Domain::IPV6
    };
    let timeout = Duration::from_millis(timeout_ms);
    let mut hops = Vec::new();
    let mut reached = false;

    for ttl in 1..=max_hops {
        if TRACEROUTE_CANCELLED.load(Ordering::SeqCst) {
            return Err("Cancelled by user".to_string());
        }
        let mut rtt_values: Vec<Option<f64>> = Vec::new();
        let mut hop_ip: Option<IpAddr> = None;

        for _ in 0..probes_per_hop {
            if TRACEROUTE_CANCELLED.load(Ordering::SeqCst) {
                return Err("Cancelled by user".to_string());
            }
            let send_socket = Socket::new(domain, Type::DGRAM, Some(Protocol::UDP))
                .map_err(|e| format!("Socket create error: {}", e))?;

            send_socket
                .set_ttl(ttl as u32)
                .map_err(|e| format!("Set TTL error: {}", e))?;
            send_socket
                .set_read_timeout(Some(timeout))
                .map_err(|e| format!("Set timeout error: {}", e))?;

            let dest_addr = SocketAddr::new(dest_ip, 33434 + ttl as u16);
            let payload = [0u8; 32];
            let start = Instant::now();

            // Send UDP packet
            let dest_sock: socket2::SockAddr = dest_addr.into();
            if send_socket.send_to(&payload, &dest_sock).is_err() {
                rtt_values.push(None);
                continue;
            }

            // Try to receive ICMP response (via the OS network stack)
            let mut buf = [std::mem::MaybeUninit::uninit(); 512];
            match send_socket.recv_from(&mut buf) {
                Ok((_, addr)) => {
                    let rtt = start.elapsed().as_secs_f64() * 1000.0;
                    let from_ip = addr.as_socket().map(|s| s.ip());
                    if let Some(ip) = from_ip {
                        hop_ip = Some(ip);
                    }
                    rtt_values.push(Some(rtt));
                    if from_ip == Some(dest_ip) {
                        reached = true;
                    }
                }
                Err(_) => {
                    // Timeout - no response at this TTL
                    rtt_values.push(None);
                }
            }
        }

        let valid_rtts: Vec<f64> = rtt_values.iter().filter_map(|r| *r).collect();
        let avg_rtt = if !valid_rtts.is_empty() {
            Some(valid_rtts.iter().sum::<f64>() / valid_rtts.len() as f64)
        } else {
            None
        };

        let hop = TracerouteHop {
            hop: ttl,
            ip: hop_ip.map(|ip| ip.to_string()),
            hostname: None, // Could do reverse DNS here
            rtt_ms: rtt_values,
            avg_rtt_ms: avg_rtt,
        };

        if let Some(cb) = on_hop.as_mut() {
            cb(&hop);
        }

        hops.push(hop);

        if reached {
            break;
        }
    }

    Ok((hops, reached))
}

fn run_system_traceroute(
    dest_ip: IpAddr,
    max_hops: u8,
    timeout_ms: u64,
    probes_per_hop: u8,
) -> Result<(Vec<TracerouteHop>, bool), String> {
    let timeout_secs = ((timeout_ms + 999) / 1000).max(1).to_string();
    let host = dest_ip.to_string();
    if cfg!(target_os = "windows") {
        let out = Command::new("tracert")
            .args([
                "-d",
                "-h",
                &max_hops.to_string(),
                "-w",
                &timeout_ms.to_string(),
                &host,
            ])
            .output()
            .map_err(|e| format!("Failed to execute tracert: {}", e))?;
        if !out.status.success() && out.stdout.is_empty() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() {
                "tracert failed".to_string()
            } else {
                format!("tracert failed: {}", err)
            });
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        return parse_traceroute_output(&stdout, dest_ip, probes_per_hop, max_hops);
    }

    // Adaptive Unix strategy with explicit binary paths:
    // 1) UDP traceroute (classic)
    // 2) ICMP traceroute (-I)
    // 3) TCP SYN traceroute (-T -p 443)
    // 4) tracepath fallback
    // Explicit paths are important because GUI app environments often lack /usr/sbin in PATH.
    let traceroute_bins = ["/usr/sbin/traceroute", "/usr/bin/traceroute", "traceroute"];
    let tracepath_bins = ["/usr/sbin/tracepath", "/usr/bin/tracepath", "tracepath"];
    let mut attempts: Vec<(&str, String, Vec<String>)> = Vec::new();
    for bin in traceroute_bins {
        attempts.push((
            "traceroute-udp",
            bin.to_string(),
            vec![
                "-n".to_string(),
                "-m".to_string(),
                max_hops.to_string(),
                "-w".to_string(),
                timeout_secs.clone(),
                "-q".to_string(),
                probes_per_hop.to_string(),
                host.clone(),
            ],
        ));
        attempts.push((
            "traceroute-icmp",
            bin.to_string(),
            vec![
                "-n".to_string(),
                "-I".to_string(),
                "-m".to_string(),
                max_hops.to_string(),
                "-w".to_string(),
                timeout_secs.clone(),
                "-q".to_string(),
                probes_per_hop.to_string(),
                host.clone(),
            ],
        ));
        attempts.push((
            "traceroute-tcp443",
            bin.to_string(),
            vec![
                "-n".to_string(),
                "-T".to_string(),
                "-p".to_string(),
                "443".to_string(),
                "-m".to_string(),
                max_hops.to_string(),
                "-w".to_string(),
                timeout_secs.clone(),
                "-q".to_string(),
                probes_per_hop.to_string(),
                host.clone(),
            ],
        ));
    }
    for bin in tracepath_bins {
        attempts.push((
            "tracepath",
            bin.to_string(),
            vec![
                "-n".to_string(),
                "-m".to_string(),
                max_hops.to_string(),
                host.clone(),
            ],
        ));
    }

    let mut first_err: Option<String> = None;
    for (label, bin, args_owned) in attempts {
        let args: Vec<&str> = args_owned.iter().map(|s| s.as_str()).collect();
        let output = match run_command_with_cancel(&bin, &args) {
            Ok(v) => v,
            Err(e) => {
                let msg = format!("{} launch failed [{}]: {}", label, bin, e);
                if first_err.is_none() {
                    first_err = Some(msg);
                }
                continue;
            }
        };

        if !output.status.success() && output.stdout.is_empty() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let msg = if err.is_empty() {
                format!("{} failed [{}]", label, bin)
            } else {
                format!("{} failed [{}]: {}", label, bin, err)
            };
            if first_err.is_none() {
                first_err = Some(msg);
            }
            continue;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed = parse_traceroute_output(&stdout, dest_ip, probes_per_hop, max_hops);
        match parsed {
            Ok((hops, reached)) => {
                let has_real_hop = hops.iter().any(|h| h.ip.is_some());
                if has_real_hop || reached {
                    tracing::info!("Traceroute succeeded with method {} [{}]", label, bin);
                    return Ok((hops, reached));
                }
                tracing::warn!(
                    "Traceroute method {} [{}] returned only star hops; trying fallback",
                    label,
                    bin
                );
            }
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("{} parse failed [{}]: {}", label, bin, e));
                }
            }
        }
    }

    Err(first_err.unwrap_or_else(|| "All traceroute methods failed".to_string()))
}

fn run_command_with_cancel(bin: &str, args: &[&str]) -> Result<std::process::Output, String> {
    if TRACEROUTE_CANCELLED.load(Ordering::SeqCst) {
        return Err("Cancelled by user".to_string());
    }

    let child = Command::new(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    {
        let mut guard = ACTIVE_TRACEROUTE_CHILD
            .lock()
            .map_err(|_| "Failed to lock traceroute child state".to_string())?;
        *guard = Some(child);
    }

    loop {
        if TRACEROUTE_CANCELLED.load(Ordering::SeqCst) {
            if let Ok(mut guard) = ACTIVE_TRACEROUTE_CHILD.lock() {
                if let Some(child) = guard.as_mut() {
                    let _ = child.kill();
                }
                *guard = None;
            }
            return Err("Cancelled by user".to_string());
        }

        let finished = {
            let mut guard = ACTIVE_TRACEROUTE_CHILD
                .lock()
                .map_err(|_| "Failed to lock traceroute child state".to_string())?;
            if let Some(child) = guard.as_mut() {
                child.try_wait().map_err(|e| e.to_string())?.is_some()
            } else {
                return Err("Traceroute process missing".to_string());
            }
        };

        if finished {
            let mut guard = ACTIVE_TRACEROUTE_CHILD
                .lock()
                .map_err(|_| "Failed to lock traceroute child state".to_string())?;
            if let Some(child) = guard.take() {
                return child.wait_with_output().map_err(|e| e.to_string());
            }
            return Err("Traceroute process missing".to_string());
        }

        thread::sleep(Duration::from_millis(25));
    }
}

fn parse_traceroute_output(
    stdout: &str,
    dest_ip: IpAddr,
    probes_per_hop: u8,
    max_hops: u8,
) -> Result<(Vec<TracerouteHop>, bool), String> {
    let mut hops: Vec<TracerouteHop> = Vec::new();
    let mut reached = false;
    let stdout_lower = stdout.to_ascii_lowercase();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let first_token = match trimmed.split_whitespace().next() {
            Some(v) => v,
            None => continue,
        };
        let hop_num: u8 = match first_token.parse::<u8>() {
            Ok(v) => v,
            Err(_) => continue,
        };

        let mut ip: Option<IpAddr> = None;
        for token in trimmed.split_whitespace() {
            let cleaned = token
                .trim_matches(|c: char| c == '(' || c == ')' || c == ',' || c == '[' || c == ']');
            if let Ok(parsed) = cleaned.parse::<IpAddr>() {
                ip = Some(parsed);
                break;
            }
        }

        let mut rtts: Vec<Option<f64>> = Vec::new();
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        let mut i = 0usize;
        while i < tokens.len() {
            let token = tokens[i];
            if token == "*" {
                rtts.push(None);
                i += 1;
                continue;
            }

            let mut parsed_rtt: Option<f64> = None;
            let cleaned = token.trim_start_matches('<').trim_end_matches("ms");
            if let Ok(v) = cleaned.parse::<f64>() {
                if token.ends_with("ms") {
                    parsed_rtt = Some(v);
                } else if i + 1 < tokens.len() && tokens[i + 1].eq_ignore_ascii_case("ms") {
                    parsed_rtt = Some(v);
                    i += 1;
                }
            }

            if let Some(v) = parsed_rtt {
                rtts.push(Some(v));
            }
            i += 1;
        }

        if rtts.is_empty() {
            rtts = vec![None; probes_per_hop as usize];
        } else if rtts.len() < probes_per_hop as usize {
            rtts.extend(std::iter::repeat(None).take(probes_per_hop as usize - rtts.len()));
        }

        let valid: Vec<f64> = rtts.iter().filter_map(|v| *v).collect();
        let avg_rtt_ms = if valid.is_empty() {
            None
        } else {
            Some(valid.iter().sum::<f64>() / valid.len() as f64)
        };

        if ip == Some(dest_ip) {
            reached = true;
        }

        hops.push(TracerouteHop {
            hop: hop_num,
            ip: ip.map(|v| v.to_string()),
            hostname: None,
            rtt_ms: rtts,
            avg_rtt_ms,
        });
    }

    if hops.is_empty() {
        return Err("No traceroute hop data returned".to_string());
    }

    // Some system traceroute variants complete successfully but do not emit the exact
    // resolved destination IP (e.g. DNS round-robin / anycast endpoint differences).
    // Treat these as reached if output indicates completion or if trace ended early.
    if !reached {
        if stdout_lower.contains("trace complete") || stdout_lower.contains("trace complete.") {
            reached = true;
        } else if let Some(last_hop) = hops.last() {
            let ended_early = last_hop.hop < max_hops;
            let has_reply = last_hop.ip.is_some() && last_hop.avg_rtt_ms.is_some();
            if ended_early && has_reply {
                reached = true;
            }
        }
    }

    Ok((hops, reached))
}
