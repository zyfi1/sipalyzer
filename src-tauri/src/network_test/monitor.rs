use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorConfig {
    pub host: String,
    pub duration_secs: u32,
    pub interval_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorSample {
    pub timestamp_ms: f64,
    pub latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub packet_loss_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorStatus {
    pub running: bool,
    pub elapsed_secs: f64,
    pub total_samples: u32,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            duration_secs: 60,
            interval_ms: 1000,
        }
    }
}

/// Shared cancellation flag for the continuous monitor.
static MONITOR_RUNNING: once_cell::sync::Lazy<Arc<AtomicBool>> =
    once_cell::sync::Lazy::new(|| Arc::new(AtomicBool::new(false)));

pub fn is_monitor_running() -> bool {
    MONITOR_RUNNING.load(Ordering::Relaxed)
}

pub fn stop_monitor() {
    MONITOR_RUNNING.store(false, Ordering::Relaxed);
}

/// Runs a continuous quality monitor that emits samples via Tauri events.
pub async fn start_monitor(window: tauri::Window, config: MonitorConfig) -> Result<(), String> {
    if MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Monitor is already running".into());
    }

    let ip = crate::network_test::ping::resolve_host(&config.host)
        .map_err(|e| {
            MONITOR_RUNNING.store(false, Ordering::Relaxed);
            e
        })?;

    let interval = Duration::from_millis(config.interval_ms as u64);
    let total_iterations = (config.duration_secs as u64 * 1000) / config.interval_ms as u64;
    let start = std::time::Instant::now();

    // Emit initial status
    let _ = window.emit("network-monitor-status", MonitorStatus {
        running: true,
        elapsed_secs: 0.0,
        total_samples: 0,
    });

    let mut sample_count: u32 = 0;
    let mut prev_rtt: Option<f64> = None;
    let mut running_jitter: f64 = 0.0;
    let mut loss_window: Vec<bool> = Vec::new();

    for _ in 0..total_iterations {
        if !MONITOR_RUNNING.load(Ordering::Relaxed) {
            break;
        }

        let probe_start = std::time::Instant::now();

        // Quick ping probe
        let ping_config = crate::network_test::ping::PingConfig {
            host: ip.to_string(),
            count: 1,
            timeout_ms: 2000,
        };
        let ping_result = crate::network_test::ping::run_ping(ping_config).await;

        let latency = if ping_result.success {
            Some(ping_result.avg_ms)
        } else {
            None
        };

        // Calculate running jitter (RFC 3550 exponentially weighted)
        let jitter = if let (Some(curr), Some(prev)) = (latency, prev_rtt) {
            let delta = (curr - prev).abs();
            running_jitter += (delta - running_jitter) / 16.0;
            Some(running_jitter)
        } else {
            None
        };
        prev_rtt = latency;

        // Track packet loss in a sliding window
        loss_window.push(latency.is_some());
        if loss_window.len() > 20 {
            loss_window.remove(0);
        }
        let loss_pct = if !loss_window.is_empty() {
            let successes = loss_window.iter().filter(|&&s| s).count();
            ((loss_window.len() - successes) as f64 / loss_window.len() as f64) * 100.0
        } else {
            None.unwrap_or(0.0)
        };

        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        sample_count += 1;

        let sample = MonitorSample {
            timestamp_ms: elapsed,
            latency_ms: latency,
            jitter_ms: jitter,
            packet_loss_pct: Some(loss_pct),
        };

        let _ = window.emit("network-monitor-sample", &sample);

        // Sleep for remaining interval
        let probe_elapsed = probe_start.elapsed();
        if probe_elapsed < interval {
            tokio::time::sleep(interval - probe_elapsed).await;
        }
    }

    MONITOR_RUNNING.store(false, Ordering::Relaxed);

    // Emit final status
    let _ = window.emit("network-monitor-status", MonitorStatus {
        running: false,
        elapsed_secs: start.elapsed().as_secs_f64(),
        total_samples: sample_count,
    });

    Ok(())
}
