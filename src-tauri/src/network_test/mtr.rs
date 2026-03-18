use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use crate::network_test::traceroute::{self, TracerouteConfig, TracerouteHop};

static MTR_CANCELLED: AtomicBool = AtomicBool::new(false);

pub fn cancel_mtr() {
    MTR_CANCELLED.store(true, Ordering::SeqCst);
    // Ensure an in-flight traceroute subprocess is terminated immediately.
    traceroute::cancel_traceroute();
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtrConfig {
    pub host: String,
    pub max_hops: u8,
    pub rounds: u32,
    pub interval_ms: u64,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtrResult {
    pub host: String,
    pub resolved_ip: String,
    pub hops: Vec<MtrHop>,
    pub rounds: u32,
    pub destination_reached: bool,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtrHop {
    pub hop: u8,
    pub ip: String,
    pub hostname: String,
    pub loss_pct: f64,
    pub sent: u32,
    pub received: u32,
    pub best_ms: f64,
    pub worst_ms: f64,
    pub avg_ms: f64,
    pub last_ms: f64,
    pub stdev_ms: f64,
    pub jitter_ms: f64,
}

impl Default for MtrConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            max_hops: 30,
            rounds: 20,
            interval_ms: 1000,
            timeout_ms: 2000,
        }
    }
}

#[tracing::instrument(skip_all)]
pub async fn run_mtr(config: MtrConfig) -> MtrResult {
    run_mtr_with_progress(config, |_round, _hops| {}).await
}

#[tracing::instrument(skip_all)]
pub async fn run_mtr_with_progress<F>(config: MtrConfig, on_progress: F) -> MtrResult
where
    F: FnMut(u32, &Vec<MtrHop>) + Send + 'static,
{
    MTR_CANCELLED.store(false, Ordering::SeqCst);
    let dest_ip: IpAddr = match crate::network_test::ping::resolve_host(&config.host) {
        Ok(ip) => ip,
        Err(e) => {
            return MtrResult {
                host: config.host,
                resolved_ip: String::new(),
                hops: vec![],
                rounds: 0,
                destination_reached: false,
                success: false,
                error: Some(e),
            };
        }
    };

    let host = config.host.clone();
    let rounds = config.rounds.max(1);
    let max_hops = config.max_hops.max(1);
    // Honor caller timeout for measurement accuracy while keeping a sane floor.
    let per_hop_timeout_ms = config.timeout_ms.max(200);
    let interval_ms = config.interval_ms;
    let mut progress_callback = on_progress;
    let mut accums: Vec<HopAccum> = (0..max_hops)
        .map(|_| HopAccum {
            ip: None,
            sent: 0,
            received: 0,
            rtts: Vec::new(),
            last_ms: 0.0,
        })
        .collect();
    let mut max_hop_seen: u8 = 0;
    let mut successful_rounds: u32 = 0;
    let mut last_error: Option<String> = None;
    let mut destination_reached = false;

    for round in 0..rounds {
        if MTR_CANCELLED.load(Ordering::SeqCst) {
            return MtrResult {
                host,
                resolved_ip: dest_ip.to_string(),
                hops: build_hops(&accums, max_hop_seen),
                rounds: round,
                destination_reached,
                success: false,
                error: Some("Cancelled by user".to_string()),
            };
        }

        let trace = traceroute::run_traceroute(TracerouteConfig {
            host: host.clone(),
            max_hops,
            timeout_ms: per_hop_timeout_ms,
            probes_per_hop: 1,
            allow_shell_fallback: false,
        }).await;
        destination_reached = destination_reached || trace.reached_destination;

        if !trace.hops.is_empty() {
            let had_reply = ingest_traceroute_round(&mut accums, &mut max_hop_seen, &trace.hops);
            if had_reply {
                successful_rounds += 1;
            }
        } else if let Some(err) = trace.error {
            last_error = Some(err);
        }

        let snapshot = build_hops(&accums, max_hop_seen);
        progress_callback(round + 1, &snapshot);

        if interval_ms > 0 && round + 1 < rounds {
            let sleep_total = Duration::from_millis(interval_ms);
            let mut slept = Duration::from_millis(0);
            let step = Duration::from_millis(50);
            while slept < sleep_total {
                if MTR_CANCELLED.load(Ordering::SeqCst) {
                    return MtrResult {
                        host,
                        resolved_ip: dest_ip.to_string(),
                        hops: build_hops(&accums, max_hop_seen),
                        rounds: round + 1,
                        destination_reached,
                        success: false,
                        error: Some("Cancelled by user".to_string()),
                    };
                }
                let remaining = sleep_total.saturating_sub(slept);
                let chunk = if remaining > step { step } else { remaining };
                std::thread::sleep(chunk);
                slept += chunk;
            }
        }
    }

    let hops = build_hops(&accums, max_hop_seen);
    destination_reached = destination_reached || infer_destination_reached(&hops, dest_ip, max_hops);
    let total_received: u32 = hops.iter().map(|h| h.received).sum();
    if successful_rounds == 0 || hops.is_empty() || total_received == 0 {
        return MtrResult {
            host,
            resolved_ip: dest_ip.to_string(),
            hops: vec![],
            rounds,
            destination_reached,
            success: false,
            error: Some(last_error.unwrap_or_else(|| "No MTR hop replies received".to_string())),
        };
    }

    MtrResult {
        host,
        resolved_ip: dest_ip.to_string(),
        hops,
        rounds,
        destination_reached,
        success: true,
        error: None,
    }
}

struct HopAccum {
    ip: Option<IpAddr>,
    sent: u32,
    received: u32,
    rtts: Vec<f64>,
    last_ms: f64,
}

fn ingest_traceroute_round(
    accums: &mut [HopAccum],
    max_hop_seen: &mut u8,
    trace_hops: &[TracerouteHop],
) -> bool {
    let mut had_reply = false;
    for hop in trace_hops {
        if hop.hop == 0 {
            continue;
        }
        let idx = (hop.hop - 1) as usize;
        if idx >= accums.len() {
            continue;
        }
        if hop.hop > *max_hop_seen {
            *max_hop_seen = hop.hop;
        }
        let a = &mut accums[idx];
        a.sent += 1;
        if let Some(ip) = hop.ip.as_ref().and_then(|value| value.parse::<IpAddr>().ok()) {
            a.ip = Some(ip);
        }
        if let Some(avg_rtt) = hop.avg_rtt_ms {
            a.received += 1;
            a.last_ms = avg_rtt;
            a.rtts.push(avg_rtt);
            had_reply = true;
        }
    }
    had_reply
}

fn build_hops(accums: &[HopAccum], max_hop_seen: u8) -> Vec<MtrHop> {
    let mut hops = Vec::new();
    for i in 0..max_hop_seen as usize {
        let a = &accums[i];
        let ip_str = a.ip.map(|ip| ip.to_string()).unwrap_or_default();

        let loss_pct = if a.sent > 0 {
            (a.sent - a.received) as f64 / a.sent as f64 * 100.0
        } else {
            0.0
        };

        let (best, worst, avg, stdev, jitter) = if !a.rtts.is_empty() {
            let sum: f64 = a.rtts.iter().sum();
            let avg = sum / a.rtts.len() as f64;
            let best = a.rtts.iter().cloned().fold(f64::INFINITY, f64::min);
            let worst = a.rtts.iter().cloned().fold(0.0f64, f64::max);
            let variance: f64 = a.rtts.iter().map(|r| (r - avg).powi(2)).sum::<f64>() / a.rtts.len() as f64;
            let stdev = variance.sqrt();
            let jitter = if a.rtts.len() > 1 {
                let jsum: f64 = a.rtts.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
                jsum / (a.rtts.len() - 1) as f64
            } else {
                0.0
            };
            (best, worst, avg, stdev, jitter)
        } else {
            (0.0, 0.0, 0.0, 0.0, 0.0)
        };

        hops.push(MtrHop {
            hop: (i + 1) as u8,
            ip: ip_str,
            hostname: String::new(),
            loss_pct,
            sent: a.sent,
            received: a.received,
            best_ms: best,
            worst_ms: worst,
            avg_ms: avg,
            last_ms: a.last_ms,
            stdev_ms: stdev,
            jitter_ms: jitter,
        });
    }
    hops
}

fn infer_destination_reached(hops: &[MtrHop], dest_ip: IpAddr, max_hops: u8) -> bool {
    let dest = dest_ip.to_string();
    if hops.iter().any(|h| h.ip == dest) {
        return true;
    }

    // Fallback for systems where final destination IP differs (anycast/CDN) but trace
    // clearly ended early with a valid final responder.
    if let Some(last_reply) = hops
        .iter()
        .rev()
        .find(|h| !h.ip.is_empty() && h.avg_ms > 0.0)
    {
        return last_reply.hop < max_hops;
    }
    false
}
