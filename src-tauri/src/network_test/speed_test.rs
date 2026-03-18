use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio::time::sleep;

// ── Types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedTestProgressEvent {
    pub phase: String,        // "latency" | "download" | "upload"
    pub progress_pct: f64,    // 0-100
    pub current_mbps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedTestResult {
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub latency_ms: f64,
    pub jitter_ms: f64,
    pub download_loaded_latency_ms: f64,
    pub download_loaded_jitter_ms: f64,
    pub upload_loaded_latency_ms: f64,
    pub upload_loaded_jitter_ms: f64,
    pub idle_latency_samples: u32,
    pub download_loaded_latency_samples: u32,
    pub upload_loaded_latency_samples: u32,
    pub server: String,
    pub success: bool,
    pub error: Option<String>,
}

// ── Speed test endpoint defaults ─────────────────────────────────

const DEFAULT_CF_BASE: &str = "https://speed.cloudflare.com";
const DEFAULT_LIBRESPEED_BASE: &str = "https://librespeed.org";
const IDLE_LATENCY_SAMPLES_TARGET: usize = 12;
const IDLE_LATENCY_MIN_SAMPLES: usize = 6;
const REQUEST_RETRIES: usize = 2;
const RETRY_BACKOFF_MS: u64 = 120;

const DOWNLOAD_WINDOW: Duration = Duration::from_secs(10);
const DOWNLOAD_WARMUP: Duration = Duration::from_millis(1800);
const DOWNLOAD_WORKERS: usize = 3;
const DOWNLOAD_REQUEST_BYTES: usize = 8_000_000;

const UPLOAD_WINDOW: Duration = Duration::from_secs(8);
const UPLOAD_WARMUP: Duration = Duration::from_millis(1500);
const UPLOAD_WORKERS: usize = 2;
const UPLOAD_REQUEST_BYTES: usize = 1_000_000;

const LOADED_LATENCY_PROBE_INTERVAL: Duration = Duration::from_millis(350);
const MIN_MEASURED_TRANSFER_SECS: f64 = 2.0;
const MIN_LOADED_LATENCY_SAMPLES: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpeedSourceKind {
    Cloudflare,
    Librespeed,
}

#[derive(Debug, Clone)]
struct SpeedSourceProfile {
    kind: SpeedSourceKind,
    latency_url: String,
    download_url: String,
    upload_url: String,
    server_label: String,
}

impl SpeedSourceProfile {
    fn latency_url(&self) -> String {
        self.with_cache_buster(&self.latency_url)
    }

    fn download_url(&self) -> String {
        let mut base = self.with_cache_buster(&self.download_url);
        if self.kind == SpeedSourceKind::Cloudflare {
            base.push_str(&format!("&bytes={}", DOWNLOAD_REQUEST_BYTES));
        } else {
            base.push_str("&ckSize=100");
        }
        base
    }

    fn upload_url(&self) -> String {
        self.with_cache_buster(&self.upload_url)
    }

    fn with_cache_buster(&self, url: &str) -> String {
        let sep = if url.contains('?') { '&' } else { '?' };
        format!("{}{}r={}", url, sep, cache_buster())
    }
}

fn cache_buster() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn median(values: &mut [f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[mid - 1] + values[mid]) / 2.0
    } else {
        values[mid]
    }
}

fn median_of(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    median(&mut sorted)
}

fn median_absolute_deviation(values: &[f64], center: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut deviations: Vec<f64> = values.iter().map(|v| (v - center).abs()).collect();
    median(&mut deviations)
}

fn normalize_base_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if let Some(stripped) = trimmed.strip_prefix("//") {
        format!("https://{}", stripped)
    } else {
        trimmed.to_string()
    }
}

fn join_url(base: &str, path: &str) -> String {
    let normalized_path = path.trim();
    if normalized_path.starts_with("https://") || normalized_path.starts_with("http://") {
        return normalized_path.to_string();
    }
    let clean_base = normalize_base_url(base);
    let clean_path = normalized_path.trim_start_matches('/');
    format!("{}/{}", clean_base, clean_path)
}

fn cloudflare_profile() -> SpeedSourceProfile {
    SpeedSourceProfile {
        kind: SpeedSourceKind::Cloudflare,
        latency_url: format!("{}/__down?bytes=1", DEFAULT_CF_BASE),
        download_url: format!("{}/__down", DEFAULT_CF_BASE),
        upload_url: format!("{}/__up", DEFAULT_CF_BASE),
        server_label: "Cloudflare".to_string(),
    }
}

fn librespeed_profile(label: &str, base_url: &str, dl_path: &str, ul_path: &str, ping_path: &str) -> SpeedSourceProfile {
    SpeedSourceProfile {
        kind: SpeedSourceKind::Librespeed,
        latency_url: join_url(base_url, ping_path),
        download_url: join_url(base_url, dl_path),
        upload_url: join_url(base_url, ul_path),
        server_label: label.to_string(),
    }
}

fn parse_librespeed_encoded(normalized: &str) -> Option<SpeedSourceProfile> {
    let mut parts = normalized.split('|');
    let kind = parts.next()?;
    if !kind.eq_ignore_ascii_case("librespeed") {
        return None;
    }

    let label = parts.next()?.trim();
    let base = parts.next()?.trim();
    let dl_path = parts.next()?.trim();
    let ul_path = parts.next()?.trim();
    let ping_path = parts.next()?.trim();
    if parts.next().is_some() {
        return None;
    }
    if label.is_empty() || base.is_empty() || dl_path.is_empty() || ul_path.is_empty() || ping_path.is_empty() {
        return None;
    }

    Some(librespeed_profile(label, base, dl_path, ul_path, ping_path))
}

fn resolve_speed_source(source: Option<String>) -> Result<SpeedSourceProfile, String> {
    let normalized = source
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "cloudflare".to_string());

    if normalized.is_empty() || normalized.eq_ignore_ascii_case("cloudflare") {
        return Ok(cloudflare_profile());
    }

    if let Some(profile) = parse_librespeed_encoded(&normalized) {
        return Ok(profile);
    }

    if normalized.eq_ignore_ascii_case("librespeed")
        || normalized.eq_ignore_ascii_case("librespeed-official")
    {
        return Ok(librespeed_profile(
            "LibreSpeed Official",
            DEFAULT_LIBRESPEED_BASE,
            "backend/garbage.php",
            "backend/empty.php",
            "backend/empty.php",
        ));
    }

    Err(format!(
        "Unsupported speed source '{}'. Use a preset id (cloudflare, librespeed) or encoded LibreSpeed preset.",
        normalized
    ))
}

async fn latency_probe_once(client: &reqwest::Client, profile: &SpeedSourceProfile) -> Result<f64, String> {
    let start = Instant::now();
    let url = profile.latency_url();
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let _ = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(start.elapsed().as_secs_f64() * 1000.0)
}

async fn latency_probe_with_retries(
    client: &reqwest::Client,
    retries: usize,
    profile: &SpeedSourceProfile,
) -> Option<f64> {
    for attempt in 0..=retries {
        if let Ok(ms) = latency_probe_once(client, profile).await {
            return Some(ms);
        }
        if attempt < retries {
            sleep(Duration::from_millis(RETRY_BACKOFF_MS)).await;
        }
    }
    None
}

#[derive(Debug, Clone, Default)]
struct TransferAccumulator {
    total_bytes: u64,
    measured_bytes: u64,
    measured_secs: f64,
    successful_requests: usize,
    failed_requests: usize,
}

fn empty_result(server: String, error: String) -> SpeedTestResult {
    SpeedTestResult {
        download_mbps: 0.0,
        upload_mbps: 0.0,
        latency_ms: 0.0,
        jitter_ms: 0.0,
        download_loaded_latency_ms: 0.0,
        download_loaded_jitter_ms: 0.0,
        upload_loaded_latency_ms: 0.0,
        upload_loaded_jitter_ms: 0.0,
        idle_latency_samples: 0,
        download_loaded_latency_samples: 0,
        upload_loaded_latency_samples: 0,
        server,
        success: false,
        error: Some(error),
    }
}

async fn run_download_worker(
    client: reqwest::Client,
    deadline: Instant,
    warmup_end: Instant,
    accumulator: Arc<Mutex<TransferAccumulator>>,
    profile: Arc<SpeedSourceProfile>,
) {
    while Instant::now() < deadline {
        let url = profile.download_url();
        let mut ok_bytes = None;
        let mut req_secs = 0.0;
        for attempt in 0..=REQUEST_RETRIES {
            if Instant::now() >= deadline {
                break;
            }
            let req_start = Instant::now();
            match client.get(&url).send().await {
                Ok(response) if response.status().is_success() => match response.bytes().await {
                    Ok(body) => {
                        ok_bytes = Some(body.len() as u64);
                        req_secs = req_start.elapsed().as_secs_f64();
                        break;
                    }
                    Err(_) => {}
                },
                _ => {}
            }

            if attempt < REQUEST_RETRIES {
                sleep(Duration::from_millis(RETRY_BACKOFF_MS)).await;
            }
        }

        let mut acc = accumulator.lock().await;
        match ok_bytes {
            Some(bytes) => {
                acc.successful_requests += 1;
                acc.total_bytes += bytes;
                if Instant::now() >= warmup_end {
                    acc.measured_bytes += bytes;
                    acc.measured_secs += req_secs;
                }
            }
            None => {
                acc.failed_requests += 1;
            }
        }
    }
}

async fn run_upload_worker(
    client: reqwest::Client,
    deadline: Instant,
    warmup_end: Instant,
    payload: Arc<Vec<u8>>,
    accumulator: Arc<Mutex<TransferAccumulator>>,
    profile: Arc<SpeedSourceProfile>,
) {
    while Instant::now() < deadline {
        let url = profile.upload_url();
        let mut ok = false;
        let mut req_secs = 0.0;
        for attempt in 0..=REQUEST_RETRIES {
            if Instant::now() >= deadline {
                break;
            }
            let req_start = Instant::now();
            match client
                .post(&url)
                .body((*payload).clone())
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    ok = true;
                    req_secs = req_start.elapsed().as_secs_f64();
                    break;
                }
                _ => {}
            }

            if attempt < REQUEST_RETRIES {
                sleep(Duration::from_millis(RETRY_BACKOFF_MS)).await;
            }
        }

        let mut acc = accumulator.lock().await;
        if ok {
            acc.successful_requests += 1;
            acc.total_bytes += payload.len() as u64;
            if Instant::now() >= warmup_end {
                acc.measured_bytes += payload.len() as u64;
                acc.measured_secs += req_secs;
            }
        } else {
            acc.failed_requests += 1;
        }
    }
}

// ── Implementation ───────────────────────────────────────────────

/// Run an HTTP-based speed test using Cloudflare's speed test endpoints.
pub async fn run_speed_test(window: tauri::Window, source: Option<String>) -> SpeedTestResult {
    let profile = match resolve_speed_source(source) {
        Ok(s) => s,
        Err(e) => return empty_result("Speed Test".to_string(), e),
    };
    let server = profile.server_label.clone();

    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return empty_result(server, format!("Failed to create HTTP client: {}", e));
        }
    };

    // ── Phase 1: Idle Latency (robust median + MAD jitter) ───────
    let _ = window.emit("speed-test-progress", SpeedTestProgressEvent {
        phase: "latency".into(),
        progress_pct: 0.0,
        current_mbps: 0.0,
    });

    let mut idle_latencies = Vec::with_capacity(IDLE_LATENCY_SAMPLES_TARGET);
    for i in 0..IDLE_LATENCY_SAMPLES_TARGET {
        if let Some(ms) = latency_probe_with_retries(&client, REQUEST_RETRIES, &profile).await {
            idle_latencies.push(ms);
        }

        let _ = window.emit("speed-test-progress", SpeedTestProgressEvent {
            phase: "latency".into(),
            progress_pct: ((i + 1) as f64 / IDLE_LATENCY_SAMPLES_TARGET as f64) * 100.0,
            current_mbps: 0.0,
        });

        sleep(Duration::from_millis(100)).await;
    }

    let latency_ms = median_of(&idle_latencies);
    let jitter_ms = median_absolute_deviation(&idle_latencies, latency_ms);
    let idle_latency_ok = idle_latencies.len() >= IDLE_LATENCY_MIN_SAMPLES;

    // ── Phase 2: Time-windowed Download + loaded latency ─────────
    let _ = window.emit("speed-test-progress", SpeedTestProgressEvent {
        phase: "download".into(),
        progress_pct: 0.0,
        current_mbps: 0.0,
    });

    let download_start = Instant::now();
    let download_deadline = download_start + DOWNLOAD_WINDOW;
    let download_warmup_end = download_start + DOWNLOAD_WARMUP;
    let download_acc = Arc::new(Mutex::new(TransferAccumulator::default()));

    let mut download_workers = Vec::with_capacity(DOWNLOAD_WORKERS);
    for _ in 0..DOWNLOAD_WORKERS {
        download_workers.push(tokio::spawn(run_download_worker(
            client.clone(),
            download_deadline,
            download_warmup_end,
            Arc::clone(&download_acc),
            Arc::new(profile.clone()),
        )));
    }

    let mut download_loaded_latencies = Vec::new();
    while Instant::now() < download_deadline {
        if let Some(ms) = latency_probe_with_retries(&client, 1, &profile).await {
            download_loaded_latencies.push(ms);
        }

        let elapsed = download_start.elapsed().as_secs_f64();
        let total_bytes = {
            let acc = download_acc.lock().await;
            acc.total_bytes
        };
        let current_mbps = if elapsed > 0.0 {
            (total_bytes as f64 * 8.0) / elapsed / 1_000_000.0
        } else {
            0.0
        };

        let progress_pct = (elapsed / DOWNLOAD_WINDOW.as_secs_f64() * 100.0).clamp(0.0, 100.0);
        let _ = window.emit("speed-test-progress", SpeedTestProgressEvent {
            phase: "download".into(),
            progress_pct,
            current_mbps,
        });

        sleep(LOADED_LATENCY_PROBE_INTERVAL).await;
    }

    for worker in download_workers {
        let _ = worker.await;
    }

    let download_acc = download_acc.lock().await.clone();
    let download_mbps = if download_acc.measured_secs > 0.0 {
        (download_acc.measured_bytes as f64 * 8.0) / download_acc.measured_secs / 1_000_000.0
    } else {
        0.0
    };
    let download_loaded_latency_ms = median_of(&download_loaded_latencies);
    let download_loaded_jitter_ms =
        median_absolute_deviation(&download_loaded_latencies, download_loaded_latency_ms);
    let download_loaded_latency_ok = download_loaded_latencies.len() >= MIN_LOADED_LATENCY_SAMPLES;
    let download_meaningful = download_acc.successful_requests >= DOWNLOAD_WORKERS
        && download_acc.measured_secs >= MIN_MEASURED_TRANSFER_SECS
        && download_mbps > 0.0;

    // ── Phase 3: Time-windowed Upload + loaded latency ───────────
    let _ = window.emit("speed-test-progress", SpeedTestProgressEvent {
        phase: "upload".into(),
        progress_pct: 0.0,
        current_mbps: 0.0,
    });

    let upload_start = Instant::now();
    let upload_deadline = upload_start + UPLOAD_WINDOW;
    let upload_warmup_end = upload_start + UPLOAD_WARMUP;
    let upload_payload = Arc::new(vec![0xABu8; UPLOAD_REQUEST_BYTES]);
    let upload_acc = Arc::new(Mutex::new(TransferAccumulator::default()));

    let mut upload_workers = Vec::with_capacity(UPLOAD_WORKERS);
    for _ in 0..UPLOAD_WORKERS {
        upload_workers.push(tokio::spawn(run_upload_worker(
            client.clone(),
            upload_deadline,
            upload_warmup_end,
            Arc::clone(&upload_payload),
            Arc::clone(&upload_acc),
            Arc::new(profile.clone()),
        )));
    }

    let mut upload_loaded_latencies = Vec::new();
    while Instant::now() < upload_deadline {
        if let Some(ms) = latency_probe_with_retries(&client, 1, &profile).await {
            upload_loaded_latencies.push(ms);
        }

        let elapsed = upload_start.elapsed().as_secs_f64();
        let total_bytes = {
            let acc = upload_acc.lock().await;
            acc.total_bytes
        };
        let current_mbps = if elapsed > 0.0 {
            (total_bytes as f64 * 8.0) / elapsed / 1_000_000.0
        } else {
            0.0
        };

        let progress_pct = (elapsed / UPLOAD_WINDOW.as_secs_f64() * 100.0).clamp(0.0, 100.0);
        let _ = window.emit("speed-test-progress", SpeedTestProgressEvent {
            phase: "upload".into(),
            progress_pct,
            current_mbps,
        });

        sleep(LOADED_LATENCY_PROBE_INTERVAL).await;
    }

    for worker in upload_workers {
        let _ = worker.await;
    }

    let upload_acc = upload_acc.lock().await.clone();
    let upload_mbps = if upload_acc.measured_secs > 0.0 {
        (upload_acc.measured_bytes as f64 * 8.0) / upload_acc.measured_secs / 1_000_000.0
    } else {
        0.0
    };
    let upload_loaded_latency_ms = median_of(&upload_loaded_latencies);
    let upload_loaded_jitter_ms =
        median_absolute_deviation(&upload_loaded_latencies, upload_loaded_latency_ms);
    let upload_loaded_latency_ok = upload_loaded_latencies.len() >= MIN_LOADED_LATENCY_SAMPLES;
    let upload_meaningful = upload_acc.successful_requests >= UPLOAD_WORKERS
        && upload_acc.measured_secs >= MIN_MEASURED_TRANSFER_SECS
        && upload_mbps > 0.0;

    let success = idle_latency_ok
        && download_meaningful
        && upload_meaningful
        && download_loaded_latency_ok
        && upload_loaded_latency_ok;

    let mut reasons = Vec::new();
    if !idle_latency_ok {
        reasons.push("insufficient idle latency samples");
    }
    if !download_meaningful {
        reasons.push("download phase did not gather enough stable throughput data");
    }
    if !upload_meaningful {
        reasons.push("upload phase did not gather enough stable throughput data");
    }
    if !download_loaded_latency_ok {
        reasons.push("insufficient loaded latency samples during download");
    }
    if !upload_loaded_latency_ok {
        reasons.push("insufficient loaded latency samples during upload");
    }

    let error = if success {
        None
    } else {
        Some(format!("Speed test failed: {}.", reasons.join("; ")))
    };

    SpeedTestResult {
        download_mbps,
        upload_mbps,
        latency_ms,
        jitter_ms,
        download_loaded_latency_ms,
        download_loaded_jitter_ms,
        upload_loaded_latency_ms,
        upload_loaded_jitter_ms,
        idle_latency_samples: idle_latencies.len() as u32,
        download_loaded_latency_samples: download_loaded_latencies.len() as u32,
        upload_loaded_latency_samples: upload_loaded_latencies.len() as u32,
        server,
        success,
        error,
    }
}
