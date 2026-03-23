use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use once_cell::sync::Lazy;
use uuid::Uuid;
use hickory_resolver::config::*;
use hickory_resolver::name_server::TokioConnectionProvider;
use hickory_resolver::Resolver;
use crate::core::config;
use crate::core::database;
use crate::packet_capture::{CaptureSession, FilterConfig, PacketInfo, Protocol};
use crate::packet_capture::capture::{self, NetworkInterface, CaptureStatus};
use crate::packet_capture::call_regression::{
    diff_call_behaviors, CallBehaviorDiffResult, CallBehaviorSummary, CodecNegotiationSummary,
    NormalizedSipHeaders,
};
use crate::packet_capture::live_stats::LiveStatsSnapshot;
use crate::packet_capture::packet_parser::PacketParser;
use crate::packet_capture::pcap_reader::MmapPcapReader;
use crate::packet_capture::rtp_analyzer::{RtpStreamTracker, resolve_codec_name, calculate_mos};
use crate::packet_capture::sip_parser::ParsedSipMessage;
use crate::packet_capture::protocol_decoder::ApplicationLayer;
use crate::packet_capture::websocket_parser::WebSocketFrame;
use crate::packet_capture::PcapWriter;
use crate::packet_capture::wireshark_filter::WiresharkFilter;
use pcap::Capture;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::collections::HashSet;

/// Maximum number of sessions to keep in memory
const MAX_SESSIONS_IN_MEMORY: usize = 10;

/// Timeout for stopped sessions before eviction (30 minutes)
const STOPPED_SESSION_TIMEOUT_SECS: u64 = 30 * 60;

const PACKET_CAPTURE_STRICT_MODE_ENV: &str = "SIPALYZER_PACKET_CAPTURE_STRICT_MODE";
const PACKET_CAPTURE_ENABLE_LOCAL_ENV: &str = "SIPALYZER_PACKET_CAPTURE_ENABLE_LOCAL";

fn parse_env_bool(key: &str) -> Option<bool> {
    let raw = std::env::var(key).ok()?;
    let value = raw.trim();
    if value.eq_ignore_ascii_case("1")
        || value.eq_ignore_ascii_case("true")
        || value.eq_ignore_ascii_case("yes")
        || value.eq_ignore_ascii_case("on")
    {
        return Some(true);
    }
    if value.eq_ignore_ascii_case("0")
        || value.eq_ignore_ascii_case("false")
        || value.eq_ignore_ascii_case("no")
        || value.eq_ignore_ascii_case("off")
    {
        return Some(false);
    }
    None
}

fn packet_capture_strict_mode_enabled() -> bool {
    parse_env_bool(PACKET_CAPTURE_STRICT_MODE_ENV).unwrap_or(true)
}

fn local_capture_allowed() -> bool {
    true
}

fn local_capture_gate_error() -> String {
    format!(
        "Local packet capture is disabled by strict mode. Set {}=true to explicitly enable local capture on this host.",
        PACKET_CAPTURE_ENABLE_LOCAL_ENV
    )
}

/// Session with metadata for eviction tracking
pub struct SessionEntry {
    session: Arc<Mutex<CaptureSession>>,
    stopped_at: Option<Instant>,
}

impl SessionEntry {
    /// Create a new running session entry.
    pub fn new_running(session: CaptureSession) -> Self {
        Self {
            session: Arc::new(Mutex::new(session)),
            stopped_at: None,
        }
    }

    /// Mark the session as stopped (for eviction tracking).
    pub fn mark_stopped(&mut self) {
        self.stopped_at = Some(Instant::now());
    }
}

// Global session manager with eviction tracking
static SESSIONS: Lazy<Mutex<HashMap<String, SessionEntry>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Cache for packets loaded from PCAP files (stopped/saved sessions).
/// Key = session_id, Value = (loaded_at, Arc'd packets).
/// Avoids re-parsing the entire PCAP file on every filter/page request.
static PCAP_CACHE: Lazy<Mutex<HashMap<String, (Instant, Arc<Vec<PacketInfo>>)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Max age before a cached PCAP entry is considered stale (10 minutes).
const PCAP_CACHE_TTL_SECS: u64 = 10 * 60;
/// Max entries in the PCAP cache.
const PCAP_CACHE_MAX_ENTRIES: usize = 8;

/// Cache for memory-mapped raw packet index data.
/// Key = session_id, Value = fast random-access metadata for raw frame retrieval.
static RAW_PCAP_INDEX_CACHE: Lazy<Mutex<HashMap<String, RawPcapIndexCacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Bounded LRU cache for reviewed raw packet bytes.
/// Key = "session_id:packet_index".
static RAW_PACKET_BYTES_CACHE: Lazy<Mutex<RawPacketBytesCache>> =
    Lazy::new(|| Mutex::new(RawPacketBytesCache::new()));

const RAW_PACKET_BYTES_CACHE_MAX_ENTRIES: usize = 256;
const RAW_PACKET_BYTES_CACHE_MAX_TOTAL_BYTES: usize = 32 * 1024 * 1024; // 32 MiB
const FILTERED_PACKET_QUERY_CACHE_MAX_ENTRIES: usize = 64;

/// Cache for filtered/sorted packet indices.
/// Key is the logical query; packet-shape validation lives in cache values.
/// This avoids cache-key churn while still invalidating on packet changes.
static FILTERED_PACKET_QUERY_CACHE: Lazy<Mutex<FilteredPacketQueryCache>> =
    Lazy::new(|| Mutex::new(FilteredPacketQueryCache::new()));

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct FilteredPacketQueryKey {
    session_id: String,
    filter_expression: String,
    sort_column: String,
    sort_ascending: bool,
}

struct FilteredPacketQueryEntry {
    packet_count: usize,
    first_packet_fingerprint: u64,
    last_packet_fingerprint: u64,
    indices: Arc<Vec<usize>>,
}

struct RawPcapIndexCacheEntry {
    loaded_at: Instant,
    file_path: String,
    reader: Arc<MmapPcapReader>,
    // (packet_data_offset, packet_data_len)
    packet_data_index: Arc<Vec<(usize, usize)>>,
}

struct RawPacketBytesCache {
    entries: HashMap<String, Vec<u8>>,
    lru_order: VecDeque<String>,
    total_bytes: usize,
}

struct FilteredPacketQueryCache {
    entries: HashMap<FilteredPacketQueryKey, FilteredPacketQueryEntry>,
    lru_order: VecDeque<FilteredPacketQueryKey>,
}

impl RawPacketBytesCache {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
            lru_order: VecDeque::new(),
            total_bytes: 0,
        }
    }

    fn get(&mut self, key: &str) -> Option<Vec<u8>> {
        let value = self.entries.get(key)?.clone();
        self.touch(key);
        Some(value)
    }

    fn insert(&mut self, key: String, value: Vec<u8>) {
        if let Some(previous) = self.entries.remove(&key) {
            self.total_bytes = self.total_bytes.saturating_sub(previous.len());
            self.remove_from_lru(&key);
        }

        self.total_bytes += value.len();
        self.entries.insert(key.clone(), value);
        self.lru_order.push_back(key);
        self.evict_if_needed();
    }

    fn touch(&mut self, key: &str) {
        self.remove_from_lru(key);
        self.lru_order.push_back(key.to_string());
    }

    fn remove_from_lru(&mut self, key: &str) {
        if let Some(pos) = self.lru_order.iter().position(|k| k == key) {
            self.lru_order.remove(pos);
        }
    }

    fn evict_if_needed(&mut self) {
        while self.entries.len() > RAW_PACKET_BYTES_CACHE_MAX_ENTRIES
            || self.total_bytes > RAW_PACKET_BYTES_CACHE_MAX_TOTAL_BYTES
        {
            let Some(oldest_key) = self.lru_order.pop_front() else {
                break;
            };
            if let Some(oldest) = self.entries.remove(&oldest_key) {
                self.total_bytes = self.total_bytes.saturating_sub(oldest.len());
            }
        }
    }

    fn remove_session_entries(&mut self, session_id: &str) {
        let prefix = format!("{}:", session_id);
        let keys_to_remove: Vec<String> = self
            .entries
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in keys_to_remove {
            if let Some(value) = self.entries.remove(&key) {
                self.total_bytes = self.total_bytes.saturating_sub(value.len());
            }
            self.remove_from_lru(&key);
        }
    }
}

impl FilteredPacketQueryCache {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
            lru_order: VecDeque::new(),
        }
    }

    fn get(
        &mut self,
        key: &FilteredPacketQueryKey,
        packet_count: usize,
        first_packet_fingerprint: u64,
        last_packet_fingerprint: u64,
    ) -> Option<Arc<Vec<usize>>> {
        let value = self.entries.get(key)?;
        if value.packet_count != packet_count
            || value.first_packet_fingerprint != first_packet_fingerprint
            || value.last_packet_fingerprint != last_packet_fingerprint
        {
            return None;
        }
        let value = Arc::clone(&value.indices);
        self.touch(key);
        Some(value)
    }

    fn insert(
        &mut self,
        key: FilteredPacketQueryKey,
        packet_count: usize,
        first_packet_fingerprint: u64,
        last_packet_fingerprint: u64,
        indices: Arc<Vec<usize>>,
    ) {
        if self.entries.contains_key(&key) {
            self.remove_from_lru(&key);
        }
        self.entries.insert(
            key.clone(),
            FilteredPacketQueryEntry {
                packet_count,
                first_packet_fingerprint,
                last_packet_fingerprint,
                indices,
            },
        );
        self.lru_order.push_back(key);
        self.evict_if_needed();
    }

    fn remove_session_entries(&mut self, session_id: &str) {
        let keys_to_remove: Vec<FilteredPacketQueryKey> = self
            .entries
            .keys()
            .filter(|k| k.session_id == session_id)
            .cloned()
            .collect();
        for key in keys_to_remove {
            self.entries.remove(&key);
            self.remove_from_lru(&key);
        }
    }

    fn touch(&mut self, key: &FilteredPacketQueryKey) {
        self.remove_from_lru(key);
        self.lru_order.push_back(key.clone());
    }

    fn remove_from_lru(&mut self, key: &FilteredPacketQueryKey) {
        if let Some(pos) = self.lru_order.iter().position(|k| k == key) {
            self.lru_order.remove(pos);
        }
    }

    fn evict_if_needed(&mut self) {
        while self.entries.len() > FILTERED_PACKET_QUERY_CACHE_MAX_ENTRIES {
            let Some(oldest_key) = self.lru_order.pop_front() else {
                break;
            };
            self.entries.remove(&oldest_key);
        }
    }
}

fn invalidate_session_caches(session_id: &str) {
    if let Ok(mut cache) = PCAP_CACHE.lock() {
        cache.remove(session_id);
    }
    if let Ok(mut cache) = RAW_PCAP_INDEX_CACHE.lock() {
        cache.remove(session_id);
    }
    if let Ok(mut cache) = RAW_PACKET_BYTES_CACHE.lock() {
        cache.remove_session_entries(session_id);
    }
    if let Ok(mut cache) = FILTERED_PACKET_QUERY_CACHE.lock() {
        cache.remove_session_entries(session_id);
    }
}

/// Acquire a lock on the global session map (used by remote_capture module).
pub fn sessions_lock() -> Result<std::sync::MutexGuard<'static, HashMap<String, SessionEntry>>, String> {
    SESSIONS.lock().map_err(|_| "Failed to lock sessions".to_string())
}

/// Evict stopped sessions that have timed out
fn evict_timed_out_sessions(sessions: &mut HashMap<String, SessionEntry>) -> Vec<String> {
    let now = Instant::now();
    let timeout = Duration::from_secs(STOPPED_SESSION_TIMEOUT_SECS);
    
    let to_evict: Vec<String> = sessions
        .iter()
        .filter_map(|(id, entry)| {
            if let Some(stopped_at) = entry.stopped_at {
                if now.duration_since(stopped_at) > timeout {
                    return Some(id.clone());
                }
            }
            None
        })
        .collect();
    
    for id in &to_evict {
        sessions.remove(id);
        tracing::info!("Evicted timed-out session: {}", id);
    }
    
    to_evict
}

/// Evict oldest stopped sessions if over memory limit
fn evict_excess_sessions(sessions: &mut HashMap<String, SessionEntry>, max_sessions: usize) -> Vec<String> {
    if sessions.len() <= max_sessions {
        return Vec::new();
    }
    
    // Collect stopped sessions sorted by stopped_at time (oldest first)
    let mut stopped: Vec<_> = sessions
        .iter()
        .filter_map(|(id, entry)| {
            entry.stopped_at.map(|t| (id.clone(), t))
        })
        .collect();
    
    stopped.sort_by_key(|(_, t)| *t);
    
    let to_remove = sessions.len().saturating_sub(max_sessions);
    let to_evict: Vec<String> = stopped.into_iter().take(to_remove).map(|(id, _)| id).collect();
    
    for id in &to_evict {
        sessions.remove(id);
        tracing::info!("Evicted excess session: {}", id);
    }
    
    to_evict
}

/// Cleanup sessions - evict timed out and excess sessions
fn cleanup_sessions_internal(sessions: &mut HashMap<String, SessionEntry>) -> (Vec<String>, usize) {
    let timed_out = evict_timed_out_sessions(sessions);
    let excess = evict_excess_sessions(sessions, MAX_SESSIONS_IN_MEMORY);
    let remaining = sessions.len();
    
    let mut evicted = timed_out;
    evicted.extend(excess);
    
    (evicted, remaining)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSessionInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub interface: String,
    pub filter_config: FilterConfig,
    pub start_time: String,
    pub end_time: Option<String>,
    pub status: String,
    pub packet_count: u64,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<crate::packet_capture::remote_capture::CaptureSource>,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
}


#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFolder {
    pub id: String,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFilter {
    pub id: String,
    pub name: String,
    pub filter_config: FilterConfig,
    pub bpf_expression: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketBookmark {
    pub id: String,
    pub session_id: String,
    pub packet_index: i64,
    pub timestamp: String,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn list_interfaces() -> Result<Vec<NetworkInterface>, String> {
    if !local_capture_allowed() {
        return Err(local_capture_gate_error());
    }
    capture::list_interfaces()
        .map_err(|e| e.to_string())
}

/// Return the pcap device name that has the given IP (e.g. the interface used for SIP).
/// Use this to pick the right interface for capture when you know the local IP from a test or call.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_interface_for_ip(ip: String) -> Result<Option<String>, String> {
    if !local_capture_allowed() {
        return Err(local_capture_gate_error());
    }
    capture::get_interface_for_ip(&ip).map_err(|e| e.to_string())
}

/// Start a capture session (used by registration/softphone/fax for per-test/call captures, or by Packet Monitor/scheduler with user filter).
/// Uses the same capture loop: BPF (if filter has protocols/ports) + FilterConfig::matches() so only relevant packets are stored.
/// FilterConfig::default() means no filter → all packets on the interface are captured (intended for per-test/per-call).
pub fn start_capture_session(
    name: String,
    description: Option<String>,
    interface: String,
    filter_config: FilterConfig,
) -> Result<String, String> {
    start_capture_session_with_mode(name, description, interface, filter_config, false)
}

/// Start a capture session with optional pipeline mode.
/// 
/// `use_pipeline`: If true, uses multi-threaded capture pipeline (high performance for 100k+ pps).
///                 If false, uses single-threaded capture loop (legacy mode).
pub fn start_capture_session_with_mode(
    name: String,
    description: Option<String>,
    interface: String,
    filter_config: FilterConfig,
    use_pipeline: bool,
) -> Result<String, String> {
    if !local_capture_allowed() {
        return Err(local_capture_gate_error());
    }

    use crate::packet_capture::CaptureMode;
    
    let id = Uuid::new_v4().to_string();
    let config_dir = config::get_config_dir().map_err(|e| e.to_string())?;
    let captures_dir = config_dir.join("captures");
    std::fs::create_dir_all(&captures_dir).map_err(|e| e.to_string())?;
    let file_path = captures_dir.join(format!("{}.pcap", id));

    let capture_mode = if use_pipeline {
        CaptureMode::Pipeline
    } else {
        CaptureMode::SingleThreaded
    };
    
    tracing::info!("Starting capture session {} with mode: {:?}", id, capture_mode);

    let mut session = CaptureSession::with_mode(
        id.clone(),
        name.clone(),
        description.clone(),
        interface.clone(),
        filter_config.clone(),
        file_path.to_string_lossy().to_string(),
        capture_mode,
    )
    .map_err(|e| e.to_string())?;

    session.start().map_err(|e| e.to_string())?;

    {
        let mut sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        
        // Cleanup before adding new session
        let (evicted, remaining) = cleanup_sessions_internal(&mut sessions);
        if !evicted.is_empty() {
            for evicted_id in &evicted {
                invalidate_session_caches(evicted_id);
            }
            tracing::info!("Cleaned up {} sessions before start, {} remaining", evicted.len(), remaining);
        }
        
        sessions.insert(id.clone(), SessionEntry {
            session: Arc::new(Mutex::new(session)),
            stopped_at: None,
        });
    }

    let _ = crate::core::audit::AuditWriter::write_entry(
        "capture", "start_capture", "user", Some(&id),
        Some(&format!("name={}, interface={}", name, interface)),
    );

    crate::core::process_registry::register(crate::core::process_registry::ManagedProcess {
        id: id.clone(),
        kind: "capture".to_string(),
        label: name.clone(),
        started_at: chrono::Utc::now().to_rfc3339(),
        status: "running".to_string(),
        metadata: serde_json::json!({ "interface": interface }),
    });

    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let filter_config_json = serde_json::to_string(&filter_config).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO capture_sessions (id, name, description, interface, filter_config, start_time, status, packet_count, file_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            name,
            description,
            interface,
            filter_config_json,
            chrono::Utc::now().to_rfc3339(),
            "Running",
            0,
            file_path.to_string_lossy(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn start_capture(
    name: String,
    description: Option<String>,
    interface: String,
    filter_config: FilterConfig,
) -> Result<String, String> {
    start_capture_session(name, description, interface, filter_config)
}

/// Start a capture session with multi-threaded pipeline mode for high-performance capture.
/// This mode can handle 100k+ packets per second with minimal drop.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn start_capture_pipeline(
    name: String,
    description: Option<String>,
    interface: String,
    filter_config: FilterConfig,
) -> Result<String, String> {
    start_capture_session_with_mode(name, description, interface, filter_config, true)
}

/// Get pipeline statistics for a running capture session.
/// Returns None if the session is not using pipeline mode.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_pipeline_stats(session_id: String) -> Result<Option<PipelineStatsInfo>, String> {
    let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    
    if let Some(entry) = sessions.get(&session_id) {
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        if let Some(stats) = session.pipeline_stats() {
            return Ok(Some(PipelineStatsInfo {
                packets_captured: stats.packets_captured,
                packets_parsed: stats.packets_parsed,
                packets_written: stats.packets_written,
                packets_dropped_capture: stats.packets_dropped_capture,
                packets_dropped_parser: stats.packets_dropped_parser,
                parse_errors: stats.parse_errors,
                write_errors: stats.write_errors,
            }));
        }
    }
    
    Ok(None)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStatsInfo {
    pub packets_captured: u64,
    pub packets_parsed: u64,
    pub packets_written: u64,
    pub packets_dropped_capture: u64,
    pub packets_dropped_parser: u64,
    pub parse_errors: u64,
    pub write_errors: u64,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn stop_capture(session_id: String) -> Result<(), String> {
    let session_arc = {
        let mut sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        if let Some(entry) = sessions.get_mut(&session_id) {
            // Mark stopped time for eviction tracking
            entry.stopped_at = Some(Instant::now());
            Some(Arc::clone(&entry.session))
        } else {
            None
        }
    };

    if let Some(session_arc) = session_arc {
        let mut session = session_arc.lock().map_err(|_| "Failed to lock session")?;
        session.stop().map_err(|e| e.to_string())?;

        crate::core::process_registry::deregister(&session_id);
        let _ = crate::core::audit::AuditWriter::write_entry(
            "capture", "stop_capture", "user", Some(&session_id), None,
        );

        let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
        let stats = session.statistics.lock().map_err(|_| "Failed to lock statistics")?;
        conn.execute(
            "UPDATE capture_sessions SET status = ?1, end_time = ?2, packet_count = ?3 WHERE id = ?4",
            rusqlite::params![
                "Stopped",
                chrono::Utc::now().to_rfc3339(),
                stats.total_packets,
                session_id,
            ],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Session not in memory (e.g. restarted app). Mark as stopped in DB so UI can recover.
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let updated = conn.execute(
        "UPDATE capture_sessions SET status = ?1, end_time = ?2 WHERE id = ?3 AND status = ?4",
        rusqlite::params!["Stopped", chrono::Utc::now().to_rfc3339(), session_id, "Running"],
    )
    .map_err(|e| e.to_string())?;
    if updated > 0 {
        return Ok(());
    }
    Err("Session not found or already stopped".to_string())
}

/// Stop **all** running capture sessions (local). Called on app shutdown.
pub fn stop_all_captures() {
    tracing::info!("stop_all_captures() — shutting down all running sessions");

    // 1. Collect running sessions and mark them stopped in memory
    let running: Vec<(String, Arc<Mutex<crate::packet_capture::capture::CaptureSession>>)> = {
        let mut sessions = match SESSIONS.lock() {
            Ok(s) => s,
            Err(_) => {
                tracing::error!("stop_all_captures: failed to lock SESSIONS");
                return;
            }
        };
        sessions
            .iter_mut()
            .filter(|(_, entry)| entry.stopped_at.is_none())
            .map(|(id, entry)| {
                entry.stopped_at = Some(Instant::now());
                (id.clone(), Arc::clone(&entry.session))
            })
            .collect()
    };

    if running.is_empty() {
        tracing::info!("stop_all_captures: no running sessions");
        return;
    }

    tracing::info!(
        "[PacketCapture] stop_all_captures: stopping {} session(s)",
        running.len());

    let now = chrono::Utc::now().to_rfc3339();

    for (id, session_arc) in &running {
        // Stop the capture thread/pipeline
        match session_arc.lock() {
            Ok(mut session) => {
                if let Err(e) = session.stop() {
                    tracing::error!("stop_all: error stopping {}: {}", id, e);
                }
            }
            Err(e) => {
                tracing::error!("stop_all: lock error for {}: {}", id, e);
            }
        }
    }

    // 2. Bulk-update DB — mark every still-running row as Stopped
    if let Ok(conn) = database::Database::get_connection() {
        for (id, session_arc) in &running {
            let pkt_count = session_arc
                .lock()
                .ok()
                .and_then(|s| s.statistics.lock().ok().map(|st| st.total_packets))
                .unwrap_or(0);
            let _ = conn.execute(
                "UPDATE capture_sessions SET status = ?1, end_time = ?2, packet_count = ?3 WHERE id = ?4",
                rusqlite::params!["Stopped", &now, pkt_count, id],
            );
        }
        tracing::info!("stop_all_captures: DB updated");
    }
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_capture_status(session_id: String) -> Result<CaptureSessionInfo, String> {
    let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    
    if let Some(entry) = sessions.get(&session_id) {
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        let stats = session.statistics.lock().map_err(|_| "Failed to lock statistics")?;

        // Fetch folder_id and tags from DB for running sessions
        let (folder_id, tags) = {
            let conn = database::Database::get_connection().ok();
            conn.and_then(|c| {
                c.query_row(
                    "SELECT folder_id, tags FROM capture_sessions WHERE id = ?1",
                    rusqlite::params![session.id],
                    |row| {
                        let fid: Option<String> = row.get(0).ok().flatten();
                        let tj: String = row.get::<_, String>(1).unwrap_or_else(|_| "[]".to_string());
                        Ok((fid, tj))
                    },
                ).ok()
            }).unwrap_or((None, "[]".to_string()))
        };
        let tags_vec: Vec<String> = serde_json::from_str(&tags).unwrap_or_default();

        Ok(CaptureSessionInfo {
            id: session.id.clone(),
            name: session.name.clone(),
            description: session.description.clone(),
            interface: session.interface.clone(),
            filter_config: session.filter_config.clone(),
            start_time: session.start_time.to_rfc3339(),
            end_time: None,
            status: format!("{:?}", session.status),
            packet_count: stats.total_packets,
            file_path: session.file_path.clone().unwrap_or_default(),
            source: None,
            folder_id,
            tags: tags_vec,
        })
    } else {
        // Try to load from database
        let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, interface, filter_config, start_time, end_time, status, packet_count, file_path, source, folder_id, tags
             FROM capture_sessions WHERE id = ?1"
        ).map_err(|e| e.to_string())?;

        let row = stmt.query_row(rusqlite::params![session_id], |row| {
            let source_json: Option<String> = row.get(10).ok();
            let source = source_json
                .and_then(|s| serde_json::from_str(&s).ok());
            let folder_id: Option<String> = row.get(11).ok().flatten();
            let tags_json: String = row.get::<_, String>(12).unwrap_or_else(|_| "[]".to_string());
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(CaptureSessionInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                interface: row.get(3)?,
                filter_config: serde_json::from_str(&row.get::<_, String>(4)?).unwrap_or_default(),
                start_time: row.get(5)?,
                end_time: row.get(6)?,
                status: row.get(7)?,
                packet_count: row.get(8)?,
                file_path: row.get(9)?,
                source,
                folder_id,
                tags,
            })
        }).map_err(|e| e.to_string())?;

        Ok(row)
    }
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_capture_statistics(session_id: String) -> Result<serde_json::Value, String> {
    let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    
    if let Some(entry) = sessions.get(&session_id) {
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        let stats = session.statistics.lock().map_err(|_| "Failed to lock statistics")?;
        
        serde_json::to_value(&*stats).map_err(|e| e.to_string())
    } else {
        Err("Session not found".to_string())
    }
}

/// Get high-performance live statistics for a capture session.
/// Uses DashMap for lock-free concurrent access - suitable for high-throughput captures.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_live_statistics(session_id: String) -> Result<LiveStatsSnapshot, String> {
    let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    
    if let Some(entry) = sessions.get(&session_id) {
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        Ok(session.live_stats_snapshot())
    } else {
        Err("Session not found".to_string())
    }
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_capture_packets(
    session_id: String,
    limit: Option<usize>,
    compact_for_diff: Option<bool>,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.unwrap_or(1000).min(50_000);
    let compact = compact_for_diff.unwrap_or(false);

    // Try live memory first
    let (found, is_stopped, packets_json) = {
        let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        if let Some(entry) = sessions.get(&session_id) {
            let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
            let stopped = matches!(session.status, crate::packet_capture::capture::CaptureStatus::Stopped);

            let buffer_size = session.get_packet_count();
            tracing::info!("Buffer has {} packets (mode: {:?})", buffer_size, session.capture_mode());

            let start = buffer_size.saturating_sub(limit);
            let packet_list = session.get_packets_range(start, limit);
            tracing::info!("Retrieved {} packets from buffer (requested limit: {})", packet_list.len(), limit);
            let json: Vec<serde_json::Value> = if compact {
                packet_list.iter().map(packet_info_to_json_for_diff).collect()
            } else {
                packet_list_to_json(packet_list.iter())
            };
            (true, stopped, json)
        } else {
            (false, false, Vec::new())
        }
    };

    // Return memory data if available
    if found && (!is_stopped || !packets_json.is_empty()) {
        return Ok(packets_json);
    }

    // Fall back to loading from saved PCAP file
    if found {
        tracing::info!("Session {} stopped with empty buffer — loading from file", session_id);
    }
    load_capture_session_range(session_id, 0, limit, compact)
}

/// Returns total packet count for a session (live buffer length or DB count for saved).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_capture_packet_count(session_id: String) -> Result<u64, String> {
    let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    if let Some(entry) = sessions.get(&session_id) {
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        // Use unified accessor that works for both pipeline and single-threaded modes
        return Ok(session.get_packet_count() as u64);
    }
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let count: u64 = conn.query_row(
        "SELECT packet_count FROM capture_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(count)
}

/// Returns packets in range [offset, offset+limit). Use for windowed loading of large captures.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_capture_packets_range(
    session_id: String,
    offset: u64,
    limit: usize,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.min(50_000); // cap single request
    let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    if let Some(entry) = sessions.get(&session_id) {
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        // Use unified accessor that works for both pipeline and single-threaded modes
        let packet_list = session.get_packets_range(offset as usize, limit);
        let packets = packet_list_to_json(packet_list.iter());
        return Ok(packets);
    }
    drop(sessions); // Release lock before cache/file operations

    // Saved session: use cached parsed packets to avoid reparsing from packet 0 on each page.
    let all_packets = get_session_packets_shared(&session_id)?;
    let start = offset as usize;
    if start >= all_packets.len() {
        return Ok(Vec::new());
    }
    let end = (start + limit).min(all_packets.len());
    Ok(packet_list_to_json(all_packets[start..end].iter()))
}

fn packet_list_to_json<'a, I>(packet_list: I) -> Vec<serde_json::Value>
where
    I: Iterator<Item = &'a PacketInfo>,
{
    packet_list
        .map(|p| packet_info_to_json(p))
        .collect()
}

/// SIP JSON for packet diff: drop full wire text and SDP body text (keeps structured SDP).
fn parsed_sip_to_json_for_diff(sip: &ParsedSipMessage) -> serde_json::Value {
    let body = sip.body.as_ref().map(|b| {
        serde_json::json!({
            "contentType": b.content_type,
            "content": "",
            "sdp": &b.sdp,
        })
    });
    serde_json::json!({
        "method": sip.method,
        "responseCode": sip.response_code,
        "responseText": sip.response_text,
        "requestUri": sip.request_uri,
        "headers": &sip.headers,
        "body": body,
        "callId": sip.call_id,
        "from": sip.from,
        "to": sip.to,
        "cseq": sip.cseq,
        "via": &sip.via,
        "contact": sip.contact,
        "contentType": sip.content_type,
        "contentLength": sip.content_length,
        "rawMessage": "",
    })
}

fn websocket_frame_to_json_lite(frame: &WebSocketFrame) -> serde_json::Value {
    serde_json::json!({
        "fin": frame.fin,
        "rsv1": frame.rsv1,
        "rsv2": frame.rsv2,
        "rsv3": frame.rsv3,
        "opcode": frame.opcode,
        "opcodeName": frame.opcode_name,
        "masked": frame.masked,
        "payloadLength": frame.payload_length,
        "maskKey": frame.mask_key.map(|k| k.iter().copied().collect::<Vec<u8>>()),
        "payload": Vec::<u8>::new(),
        "headerSize": frame.header_size,
    })
}

fn unknown_payload_lite(data: &[u8]) -> serde_json::Value {
    const CAP: usize = 64;
    let n = data.len().min(CAP);
    serde_json::json!(data[..n].to_vec())
}

/// Smaller JSON for VoIP packet diff: omits rawPayload, SIP raw text, WS payloads, truncates unknown bytes.
pub fn packet_info_to_json_for_diff(p: &PacketInfo) -> serde_json::Value {
    let protocol_str = serde_json::to_string(&p.protocol)
        .unwrap_or_else(|_| format!("{:?}", p.protocol))
        .trim_matches('"')
        .to_string();
    let mut packet_json = serde_json::json!({
        "timestamp": p.timestamp.to_rfc3339(),
        "srcIp": p.src_ip.to_string(),
        "dstIp": p.dst_ip.to_string(),
        "srcPort": p.src_port,
        "dstPort": p.dst_port,
        "protocol": protocol_str,
        "size": p.size,
        "frameLength": p.frame_length,
        "fidelity": p.fidelity,
        "provenance": p.provenance,
        "summary": p.summary(),
    });
    if let Some(ref decoded) = p.decoded {
        let mut decoded_json = serde_json::json!({
            "ethernet": &decoded.ethernet,
            "ip": &decoded.ip,
            "udp": &decoded.udp,
            "tcp": &decoded.tcp,
        });
        match &decoded.application {
            ApplicationLayer::Sip(sip) => {
                decoded_json["application"] =
                    serde_json::json!({ "type": "Sip", "data": parsed_sip_to_json_for_diff(sip) });
            }
            ApplicationLayer::SipOverWs { ws_frame, sip } => {
                decoded_json["application"] = serde_json::json!({
                    "type": "SipOverWs",
                    "data": {
                        "wsFrame": websocket_frame_to_json_lite(ws_frame),
                        "sip": parsed_sip_to_json_for_diff(sip),
                    }
                });
            }
            ApplicationLayer::Rtp(rtp) => {
                decoded_json["application"] = serde_json::json!({ "type": "Rtp", "data": rtp });
            }
            ApplicationLayer::Srtp(rtp) => {
                decoded_json["application"] = serde_json::json!({ "type": "Srtp", "data": rtp });
            }
            ApplicationLayer::Rtcp(rtcp) => {
                decoded_json["application"] = serde_json::json!({ "type": "Rtcp", "data": rtcp });
            }
            ApplicationLayer::Dns(dns) => {
                decoded_json["application"] = serde_json::json!({ "type": "Dns", "data": dns });
            }
            ApplicationLayer::T38(t38) => {
                decoded_json["application"] = serde_json::json!({ "type": "T38", "data": t38 });
            }
            ApplicationLayer::WebSocket(ws) => {
                decoded_json["application"] = serde_json::json!({
                    "type": "WebSocket",
                    "data": websocket_frame_to_json_lite(ws),
                });
            }
            ApplicationLayer::Unknown(data) => {
                decoded_json["application"] =
                    serde_json::json!({ "type": "Unknown", "data": unknown_payload_lite(data) });
            }
        }
        packet_json["decoded"] = decoded_json;
    }
    packet_json
}

pub fn packet_info_to_json(p: &PacketInfo) -> serde_json::Value {
    let protocol_str = serde_json::to_string(&p.protocol)
        .unwrap_or_else(|_| format!("{:?}", p.protocol))
        .trim_matches('"')
        .to_string();
    let mut packet_json = serde_json::json!({
        "timestamp": p.timestamp.to_rfc3339(),
        "srcIp": p.src_ip.to_string(),
        "dstIp": p.dst_ip.to_string(),
        "srcPort": p.src_port,
        "dstPort": p.dst_port,
        "protocol": protocol_str,
        "size": p.size,
        "frameLength": p.frame_length,
        "fidelity": p.fidelity,
        "provenance": p.provenance,
        "summary": p.summary(),
    });
    if !p.data.is_empty() {
        if let Some(ref decoded) = p.decoded {
            match &decoded.application {
                ApplicationLayer::Rtp(_) | ApplicationLayer::Dns(_) | ApplicationLayer::T38(_) => {
                    packet_json["rawPayload"] = serde_json::json!(p.data);
                }
                _ => {}
            }
        }
    }
    if let Some(ref decoded) = p.decoded {
        let mut decoded_json = serde_json::json!({
            "ethernet": decoded.ethernet,
            "ip": decoded.ip,
            "udp": decoded.udp,
            "tcp": decoded.tcp,
        });
        match &decoded.application {
            ApplicationLayer::Sip(sip) => {
                decoded_json["application"] = serde_json::json!({ "type": "Sip", "data": sip });
            }
            ApplicationLayer::SipOverWs { ws_frame, sip } => {
                decoded_json["application"] = serde_json::json!({ 
                    "type": "SipOverWs", 
                    "data": { "wsFrame": ws_frame, "sip": sip } 
                });
            }
            ApplicationLayer::Rtp(rtp) => {
                decoded_json["application"] = serde_json::json!({ "type": "Rtp", "data": rtp });
            }
            ApplicationLayer::Srtp(rtp) => {
                decoded_json["application"] = serde_json::json!({ "type": "Srtp", "data": rtp });
            }
            ApplicationLayer::Rtcp(rtcp) => {
                decoded_json["application"] = serde_json::json!({ "type": "Rtcp", "data": rtcp });
            }
            ApplicationLayer::Dns(dns) => {
                decoded_json["application"] = serde_json::json!({ "type": "Dns", "data": dns });
            }
            ApplicationLayer::T38(t38) => {
                decoded_json["application"] = serde_json::json!({ "type": "T38", "data": t38 });
            }
            ApplicationLayer::WebSocket(ws) => {
                decoded_json["application"] = serde_json::json!({ "type": "WebSocket", "data": ws });
            }
            ApplicationLayer::Unknown(data) => {
                decoded_json["application"] = serde_json::json!({ "type": "Unknown", "data": data });
            }
        }
        packet_json["decoded"] = decoded_json;
    }
    packet_json
}

/// Load packets from saved PCAP file in range [offset, offset+limit).
/// Offset and limit are in terms of *parsed* packet index (display order), so the history view
/// shows the correct packets and counts even when some raw reads fail to parse.
fn load_capture_session_range(
    session_id: String,
    offset: u64,
    limit: usize,
    for_diff: bool,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let (file_path, rtp_port_range): (String, Option<(u16, u16)>) = conn.query_row(
        "SELECT file_path, filter_config FROM capture_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| {
            let path: String = row.get(0)?;
            let filter_config_json: String = row.get(1)?;
            let rtp_port_range = serde_json::from_str::<FilterConfig>(&filter_config_json)
                .ok()
                .and_then(|fc| fc.rtp_port_range);
            Ok((path, rtp_port_range))
        },
    ).map_err(|e| e.to_string())?;

    let mut cap = Capture::from_file(&file_path)
        .map_err(|e| format!("Failed to open pcap file: {}", e))?;
    let link_layer_type = cap.get_datalink().0 as u32;
    let parser = PacketParser::with_rtp_port_range(link_layer_type, rtp_port_range);
    let mut packets = Vec::new();
    let mut parsed_index = 0u64; // 0-based index of each successfully parsed packet (display order)

    loop {
        let packet = match cap.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if let Some(packet_info) = parser.parse(&packet, Some(parsed_index)) {
            if parsed_index >= offset && packets.len() < limit {
                packets.push(if for_diff {
                    packet_info_to_json_for_diff(&packet_info)
                } else {
                    packet_info_to_json(&packet_info)
                });
            }
            parsed_index += 1;
            if parsed_index >= offset + limit as u64 {
                break;
            }
        }
    }
    Ok(packets)
}

/// Result from filtered packet query - includes total count for pagination
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredPacketsResult {
    pub packets: Vec<serde_json::Value>,
    pub total_count: usize,
    pub offset: usize,
    pub limit: usize,
}

/// Get filtered and sorted packets with pagination.
/// This moves filtering/sorting to the Rust backend for performance.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_filtered_packets(
    session_id: String,
    filter_expression: Option<String>,
    sort_column: Option<String>,
    sort_ascending: Option<bool>,
    offset: usize,
    limit: usize,
) -> Result<FilteredPacketsResult, String> {
    let limit = limit.min(5000);
    let normalized_filter_expression = filter_expression
        .as_deref()
        .map(str::trim)
        .filter(|expr| !expr.is_empty())
        .map(ToOwned::to_owned);
    let normalized_sort_column = sort_column.clone().unwrap_or_default();
    let normalized_sort_ascending = if sort_column.is_some() {
        sort_ascending.unwrap_or(true)
    } else {
        true
    };

    // Fast path for live, unsorted, unfiltered reads: avoid cloning the entire packet set.
    // We preserve exact index semantics where originalIndex maps to the snapshot index.
    if normalized_filter_expression.is_none() && sort_column.is_none() {
        let live_snapshot: Option<(usize, Vec<PacketInfo>)> = {
            let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
            if let Some(entry) = sessions.get(&session_id) {
                let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
                let is_stopped = matches!(session.status, CaptureStatus::Stopped);
                let total_count = session.get_packet_count();
                if !is_stopped || total_count > 0 {
                    Some((total_count, session.get_packets_range(offset, limit)))
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some((total_count, packet_list)) = live_snapshot {
            let paginated: Vec<serde_json::Value> = packet_list
                .iter()
                .enumerate()
                .map(|(local_idx, p)| {
                    let mut json = packet_info_to_json(p);
                    json["originalIndex"] = serde_json::json!(offset + local_idx);
                    json
                })
                .collect();
            return Ok(FilteredPacketsResult { packets: paginated, total_count, offset, limit });
        }
    }

    // Saved or filtered/sorted path: build a shared packet view.
    let all_packets = get_session_packets_shared(&session_id)?;
    let packet_count = all_packets.len();
    let first_packet_fingerprint = all_packets.first().map(packet_fingerprint).unwrap_or_default();
    let last_packet_fingerprint = all_packets.last().map(packet_fingerprint).unwrap_or_default();

    // Parse filter once
    let filter = match normalized_filter_expression.as_deref() {
        Some(expr) => {
            Some(WiresharkFilter::parse(expr).map_err(|e| format!("Invalid filter: {}", e))?)
        }
        _ => None,
    };

    // Fast path: no filter, no sort → just paginate directly
    if filter.is_none() && sort_column.is_none() {
        let total_count = packet_count;
        let paginated: Vec<serde_json::Value> = all_packets
            .iter()
            .enumerate()
            .skip(offset)
            .take(limit)
            .map(|(idx, p)| {
                let mut json = packet_info_to_json(p);
                json["originalIndex"] = serde_json::json!(idx);
                json
            })
            .collect();
        return Ok(FilteredPacketsResult { packets: paginated, total_count, offset, limit });
    }

    let cache_key = FilteredPacketQueryKey {
        session_id: session_id.clone(),
        filter_expression: normalized_filter_expression.unwrap_or_default(),
        sort_column: normalized_sort_column,
        sort_ascending: normalized_sort_ascending,
    };

    let sorted_indices: Arc<Vec<usize>> = if let Ok(mut cache) = FILTERED_PACKET_QUERY_CACHE.lock() {
        if let Some(indices) = cache.get(
            &cache_key,
            packet_count,
            first_packet_fingerprint,
            last_packet_fingerprint,
        ) {
            indices
        } else {
            drop(cache);
            let computed = compute_filtered_sorted_indices(
                &all_packets,
                filter.as_ref(),
                sort_column.as_deref(),
                sort_ascending,
            );
            let computed = Arc::new(computed);
            if let Ok(mut cache) = FILTERED_PACKET_QUERY_CACHE.lock() {
                cache.insert(
                    cache_key,
                    packet_count,
                    first_packet_fingerprint,
                    last_packet_fingerprint,
                    Arc::clone(&computed),
                );
            }
            computed
        }
    } else {
        Arc::new(compute_filtered_sorted_indices(
            &all_packets,
            filter.as_ref(),
            sort_column.as_deref(),
            sort_ascending,
        ))
    };

    let total_count = sorted_indices.len();

    // Paginate — only serialize the visible page
    let paginated: Vec<serde_json::Value> = sorted_indices
        .iter()
        .skip(offset)
        .take(limit)
        .map(|&idx| {
            let mut json = packet_info_to_json(&all_packets[idx]);
            json["originalIndex"] = serde_json::json!(idx);
            json
        })
        .collect();

    Ok(FilteredPacketsResult { packets: paginated, total_count, offset, limit })
}

fn packet_fingerprint(packet: &PacketInfo) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    packet.timestamp.timestamp_micros().hash(&mut hasher);
    packet.src_ip.hash(&mut hasher);
    packet.dst_ip.hash(&mut hasher);
    packet.src_port.hash(&mut hasher);
    packet.dst_port.hash(&mut hasher);
    packet.protocol.hash(&mut hasher);
    packet.size.hash(&mut hasher);
    packet.frame_length.hash(&mut hasher);
    hasher.finish()
}

fn compute_filtered_sorted_indices(
    all_packets: &Arc<Vec<PacketInfo>>,
    filter: Option<&WiresharkFilter>,
    sort_column: Option<&str>,
    sort_ascending: Option<bool>,
) -> Vec<usize> {
    // Filter with indices — iterate once, collect only matching indices
    let filtered_indices: Vec<usize> = if let Some(f) = filter {
        all_packets
            .iter()
            .enumerate()
            .filter(|(_, p)| f.matches(p))
            .map(|(i, _)| i)
            .collect()
    } else {
        (0..all_packets.len()).collect()
    };

    // Sort if requested — sort indices by packet field, avoid string allocs
    if let Some(col) = sort_column {
        let ascending = sort_ascending.unwrap_or(true);
        let mut indices = filtered_indices;
        indices.sort_by(|&a, &b| {
            let pa = &all_packets[a];
            let pb = &all_packets[b];
            let cmp = match col {
                "time" => pa.timestamp.cmp(&pb.timestamp),
                "source" => pa.src_ip.cmp(&pb.src_ip),
                "destination" => pa.dst_ip.cmp(&pb.dst_ip),
                "protocol" => protocol_ordinal(pa.protocol).cmp(&protocol_ordinal(pb.protocol)),
                "length" => pa.size.cmp(&pb.size),
                "srcPort" => pa.src_port.cmp(&pb.src_port),
                "dstPort" => pa.dst_port.cmp(&pb.dst_port),
                _ => std::cmp::Ordering::Equal,
            };
            if ascending { cmp } else { cmp.reverse() }
        });
        indices
    } else {
        filtered_indices
    }
}

/// Cheap ordinal for protocol comparison (avoids format!/string alloc in sort).
#[inline]
fn protocol_ordinal(p: Protocol) -> u8 {
    match p {
        Protocol::ARP  => 0,
        Protocol::ICMP => 1,
        Protocol::DNS  => 2,
        Protocol::UDP  => 3,
        Protocol::TCP  => 4,
        Protocol::HTTP => 5,
        Protocol::HTTPS => 6,
        Protocol::SIP  => 7,
        Protocol::RTP  => 8,
        Protocol::SRTP => 8,
        Protocol::RTCP => 9,
        Protocol::FAX  => 10,
        Protocol::Other => 11,
    }
}

/// Get count of packets matching a filter (for pagination UI).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_filtered_packet_count(
    session_id: String,
    filter_expression: Option<String>,
) -> Result<usize, String> {
    let all_packets = get_session_packets_shared(&session_id)?;

    let filter = match filter_expression.as_deref() {
        Some(expr) if !expr.trim().is_empty() => {
            Some(WiresharkFilter::parse(expr).map_err(|e| format!("Invalid filter: {}", e))?)
        }
        _ => None,
    };

    let count = match filter {
        Some(ref f) => all_packets.iter().filter(|p| f.matches(p)).count(),
        None => all_packets.len(),
    };

    Ok(count)
}

// ── Packet access layer ────────────────────────────────────────────────
// Provides two flavours:
//   • `get_all_packets_for_session`  – clones packets (legacy compat)
//   • `get_session_packets_shared`   – returns Arc<Vec<PacketInfo>> for zero-copy filtering

/// Helper to get all packets for a session (from live buffer or saved file).
fn get_all_packets_for_session(session_id: &str) -> Result<Vec<PacketInfo>, String> {
    // For live sessions use the memory buffer directly
    let (found, is_stopped, packets) = {
        let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        if let Some(entry) = sessions.get(session_id) {
            let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
            let stopped = matches!(session.status, CaptureStatus::Stopped);
            let pkts = session.get_all_packets();
            (true, stopped, pkts)
        } else {
            (false, false, Vec::new())
        }
    };
    if found && (!is_stopped || !packets.is_empty()) {
        return Ok(packets);
    }
    // Stopped with empty buffer or not in memory → load from file (via cache)
    let cached = get_cached_or_load(session_id)?;
    Ok((*cached).clone())
}

/// Return an Arc'd packet vec — zero-copy for filtering/sorting.
/// Live sessions get a snapshot; stopped/file sessions use the PCAP cache.
fn get_session_packets_shared(session_id: &str) -> Result<Arc<Vec<PacketInfo>>, String> {
    // Live session → snapshot into an Arc (one clone, then shared)
    {
        let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        if let Some(entry) = sessions.get(session_id) {
            let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
            let is_stopped = matches!(session.status, CaptureStatus::Stopped);
            let count = session.get_packet_count();
            if !is_stopped || count > 0 {
                let pkts = session.get_all_packets();
                return Ok(Arc::new(pkts));
            }
        }
    }
    // Stopped/saved → use cache (no re-parse on subsequent calls)
    get_cached_or_load(session_id)
}

/// Get packets from cache or parse the PCAP file and cache the result.
fn get_cached_or_load(session_id: &str) -> Result<Arc<Vec<PacketInfo>>, String> {
    // Check cache first
    {
        let cache = PCAP_CACHE.lock().map_err(|_| "cache lock")?;
        if let Some((loaded_at, packets)) = cache.get(session_id) {
            if loaded_at.elapsed().as_secs() < PCAP_CACHE_TTL_SECS {
                return Ok(Arc::clone(packets));
            }
        }
    }
    // Cache miss — parse from file
    let packets = Arc::new(load_all_packets_from_file(session_id)?);
    // Insert into cache (evict oldest if over limit)
    {
        let mut cache = PCAP_CACHE.lock().map_err(|_| "cache lock")?;
        if cache.len() >= PCAP_CACHE_MAX_ENTRIES {
            // Evict oldest entry
            if let Some(oldest_id) = cache
                .iter()
                .min_by_key(|(_, (t, _))| *t)
                .map(|(id, _)| id.clone())
            {
                cache.remove(&oldest_id);
            }
        }
        cache.insert(session_id.to_string(), (Instant::now(), Arc::clone(&packets)));
    }
    Ok(packets)
}

/// Load all packets from a saved PCAP file.
fn load_all_packets_from_file(session_id: &str) -> Result<Vec<PacketInfo>, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let (file_path, rtp_port_range): (String, Option<(u16, u16)>) = conn.query_row(
        "SELECT file_path, filter_config FROM capture_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| {
            let path: String = row.get(0)?;
            let filter_config_json: String = row.get(1)?;
            let rtp_port_range = serde_json::from_str::<FilterConfig>(&filter_config_json)
                .ok()
                .and_then(|fc| fc.rtp_port_range);
            Ok((path, rtp_port_range))
        },
    ).map_err(|e| format!("Session not found: {}", e))?;

    let mut cap = Capture::from_file(&file_path)
        .map_err(|e| format!("Failed to open pcap file: {}", e))?;
    let link_layer_type = cap.get_datalink().0 as u32;
    let parser = PacketParser::with_rtp_port_range(link_layer_type, rtp_port_range);
    let mut packets = Vec::new();
    let mut packet_count = 0u64;

    loop {
        let packet = match cap.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if let Some(packet_info) = parser.parse(&packet, Some(packet_count)) {
            packets.push(packet_info);
            packet_count += 1;
        }
    }
    tracing::info!("Parsed {} packets from PCAP file for session {}", packet_count, session_id);
    Ok(packets)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn list_capture_sessions() -> Result<Vec<CaptureSessionInfo>, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, interface, filter_config, start_time, end_time, status, packet_count, file_path, source, folder_id, tags
         FROM capture_sessions ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;

    let sessions = stmt.query_map([], |row| {
        let source_json: Option<String> = row.get(10).ok();
        let source = source_json
            .and_then(|s| serde_json::from_str(&s).ok());
        let folder_id: Option<String> = row.get(11).ok().flatten();
        let tags_json: String = row.get::<_, String>(12).unwrap_or_else(|_| "[]".to_string());
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        Ok(CaptureSessionInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            interface: row.get(3)?,
            filter_config: serde_json::from_str(&row.get::<_, String>(4)?).unwrap_or_default(),
            start_time: row.get(5)?,
            end_time: row.get(6)?,
            status: row.get(7)?,
            packet_count: row.get(8)?,
            file_path: row.get(9)?,
            source,
            folder_id,
            tags,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(sessions)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_capture_session(session_id: String) -> Result<CaptureSessionInfo, String> {
    get_capture_status(session_id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn export_pcap(session_id: String, output_path: Option<String>) -> Result<String, String> {
    let source_path: std::path::PathBuf = {
        let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        if let Some(entry) = sessions.get(&session_id) {
            let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
            session.file_path.as_ref().ok_or("No file path")?.into()
        } else {
            let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
            let path: String = conn.query_row(
                "SELECT file_path FROM capture_sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            path.into()
        }
    };

    let final_path = if let Some(output) = output_path {
        std::path::PathBuf::from(output)
    } else {
        let default_name = format!("capture_{}.pcap", chrono::Utc::now().format("%Y%m%d_%H%M%S"));
        let dialog_handle = rfd::AsyncFileDialog::new()
            .set_title("Save PCAP File")
            .set_file_name(&default_name)
            .add_filter("PCAP files", &["pcap"])
            .save_file()
            .await;
        match dialog_handle {
            Some(handle) => handle.path().to_path_buf(),
            None => return Err("File save dialog was cancelled".to_string()),
        }
    };

    std::fs::copy(&source_path, &final_path).map_err(|e| e.to_string())?;
    Ok(final_path.to_string_lossy().to_string())
}

/// Copy an existing session's on-disk PCAP into the captures library as a **new** session (splice / working copy).
/// Requires a persisted `file_path` (stop live captures first if still recording).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn duplicate_capture_to_library(session_id: String) -> Result<String, String> {
    let source_path: std::path::PathBuf = {
        let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        if let Some(entry) = sessions.get(&session_id) {
            let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
            session
                .file_path
                .as_ref()
                .ok_or_else(|| {
                    "This capture has no saved file yet — stop the capture first, then add to Captures.".to_string()
                })?
                .into()
        } else {
            let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
            let path: String = conn
                .query_row(
                    "SELECT file_path FROM capture_sessions WHERE id = ?1",
                    rusqlite::params![session_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if path.trim().is_empty() {
                return Err("Session has no PCAP file.".to_string());
            }
            path.into()
        }
    };

    if !source_path.exists() {
        return Err(format!("PCAP file not found: {}", source_path.display()));
    }

    let info = get_capture_status(session_id.clone())?;
    let session_name = format!("Splice · {}", info.name);

    let cap = Capture::from_file(&source_path)
        .map_err(|e| format!("Not a valid PCAP file: {}", e))?;
    drop(cap);

    let mut cap = Capture::from_file(&source_path)
        .map_err(|e| format!("Failed to read PCAP file: {}", e))?;
    let link_layer_type = cap.get_datalink().0 as u32;
    let parser = PacketParser::with_rtp_port_range(link_layer_type, FilterConfig::default().rtp_port_range);
    let mut packet_count: u64 = 0;
    let mut parsed_packet_count: u64 = 0;
    while let Ok(packet) = cap.next_packet() {
        packet_count += 1;
        if parser.parse(&packet, Some(packet_count)).is_some() {
            parsed_packet_count += 1;
        }
    }
    drop(cap);

    let id = Uuid::new_v4().to_string();
    let config_dir = config::get_config_dir().map_err(|e| e.to_string())?;
    let captures_dir = config_dir.join("captures");
    std::fs::create_dir_all(&captures_dir).map_err(|e| e.to_string())?;
    let dest_path = captures_dir.join(format!("{}.pcap", id));

    std::fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy PCAP file: {}", e))?;

    let filter_config = FilterConfig::default();
    let filter_config_json = serde_json::to_string(&filter_config).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO capture_sessions (id, name, description, interface, filter_config, start_time, status, packet_count, file_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            session_name,
            format!(
                "Copy from session {} — {} ({} parsed / {} total packets)",
                session_id,
                source_path.display(),
                parsed_packet_count,
                packet_count
            ),
            "imported",
            filter_config_json,
            now,
            "Imported",
            parsed_packet_count,
            dest_path.to_string_lossy(),
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "[Splice] Duplicated session {} → new session {} ({} packets)",
        session_id,
        id,
        parsed_packet_count
    );

    Ok(id)
}

/// Import an external PCAP/PCAPNG file into the app as a new capture session.
/// Opens a native file dialog, copies the file into the captures directory, and creates a DB entry.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn import_pcap(name: Option<String>) -> Result<String, String> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("Import PCAP File")
        .add_filter("PCAP files", &["pcap", "pcapng", "cap"])
        .add_filter("All files", &["*"])
        .pick_file()
        .await;

    let source_path = match picked {
        Some(handle) => handle.path().to_path_buf(),
        None => return Err("Import cancelled".to_string()),
    };

    // Validate the file can be opened as a pcap
    let cap = Capture::from_file(&source_path)
        .map_err(|e| format!("Not a valid PCAP file: {}", e))?;
    drop(cap);

    // Count packets for session metadata and verify parser compatibility.
    let mut cap = Capture::from_file(&source_path)
        .map_err(|e| format!("Failed to read PCAP file: {}", e))?;
    let link_layer_type = cap.get_datalink().0 as u32;
    let parser = PacketParser::with_rtp_port_range(link_layer_type, FilterConfig::default().rtp_port_range);
    let mut packet_count: u64 = 0;
    let mut parsed_packet_count: u64 = 0;
    while let Ok(packet) = cap.next_packet() {
        packet_count += 1;
        if parser.parse(&packet, Some(packet_count)).is_some() {
            parsed_packet_count += 1;
        }
    }
    drop(cap);

    // Generate session ID and destination path
    let id = Uuid::new_v4().to_string();
    let config_dir = config::get_config_dir().map_err(|e| e.to_string())?;
    let captures_dir = config_dir.join("captures");
    std::fs::create_dir_all(&captures_dir).map_err(|e| e.to_string())?;
    let dest_path = captures_dir.join(format!("{}.pcap", id));

    // Copy the file into our captures directory
    std::fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy PCAP file: {}", e))?;

    // Derive a friendly name from the original filename if none provided
    let session_name = name.unwrap_or_else(|| {
        source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| format!("Imported: {}", s))
            .unwrap_or_else(|| "Imported capture".to_string())
    });

    // Insert into the database as a stopped session
    let filter_config = FilterConfig::default();
    let filter_config_json = serde_json::to_string(&filter_config).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO capture_sessions (id, name, description, interface, filter_config, start_time, status, packet_count, file_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            session_name,
            format!(
                "Imported from {} ({} parsed / {} total)",
                source_path.display(),
                parsed_packet_count,
                packet_count
            ),
            "imported",
            filter_config_json,
            now,
            "Imported",
            parsed_packet_count,
            dest_path.to_string_lossy(),
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "[Import] Imported PCAP: {} → session {} ({} packets)",
        source_path.display(),
        id,
        parsed_packet_count);

    Ok(id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn delete_capture_session(session_id: String) -> Result<(), String> {
    // Remove from memory
    {
        let mut sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        sessions.remove(&session_id);
    }
    invalidate_session_caches(&session_id);

    // Delete from database
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM capture_sessions WHERE id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Session update (name, description, folder, tags) ──

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn update_capture_session(
    session_id: String,
    name: Option<String>,
    description: Option<String>,
    folder_id: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let mut updates: Vec<String> = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    let mut idx = 1;

    if let Some(n) = name {
        updates.push(format!("name = ?{}", idx));
        params.push(rusqlite::types::Value::Text(n));
        idx += 1;
    }
    if let Some(d) = description {
        updates.push(format!("description = ?{}", idx));
        params.push(rusqlite::types::Value::Text(d));
        idx += 1;
    }
    if let Some(fid) = folder_id {
        if fid.is_empty() {
            updates.push(format!("folder_id = ?{}", idx));
            params.push(rusqlite::types::Value::Null);
        } else {
            updates.push(format!("folder_id = ?{}", idx));
            params.push(rusqlite::types::Value::Text(fid));
        }
        idx += 1;
    }
    if let Some(t) = tags {
        let json = serde_json::to_string(&t).unwrap_or_else(|_| "[]".to_string());
        updates.push(format!("tags = ?{}", idx));
        params.push(rusqlite::types::Value::Text(json));
        idx += 1;
    }

    if updates.is_empty() {
        return Ok(());
    }

    params.push(rusqlite::types::Value::Text(session_id));
    let query = format!(
        "UPDATE capture_sessions SET {} WHERE id = ?{}",
        updates.join(", "),
        idx
    );
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    stmt.execute(rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Capture Folder CRUD ──

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn list_capture_folders() -> Result<Vec<CaptureFolder>, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, sort_order, created_at FROM capture_folders ORDER BY sort_order ASC, created_at ASC")
        .map_err(|e| e.to_string())?;
    let folders = stmt
        .query_map([], |row| {
            Ok(CaptureFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(folders)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn create_capture_folder(name: String) -> Result<CaptureFolder, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    // Place new folder at end (max sort_order + 1)
    let max_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM capture_folders",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO capture_folders (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, max_order + 1, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(CaptureFolder {
        id,
        name,
        sort_order: max_order + 1,
        created_at: now,
    })
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn rename_capture_folder(id: String, name: String) -> Result<(), String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE capture_folders SET name = ?1 WHERE id = ?2",
        rusqlite::params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn delete_capture_folder(id: String) -> Result<(), String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    // Unset folder_id on sessions that referenced this folder (don't delete sessions)
    conn.execute(
        "UPDATE capture_sessions SET folder_id = NULL WHERE folder_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM capture_folders WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn reorder_capture_folders(ids: Vec<String>) -> Result<(), String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE capture_folders SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![i as i32, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Cleanup stopped sessions from memory to free resources.
/// Returns info about evicted sessions and current memory usage.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn cleanup_sessions() -> Result<SessionCleanupResult, String> {
    let mut sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    let before_count = sessions.len();
    
    let (evicted, remaining) = cleanup_sessions_internal(&mut sessions);
    for evicted_id in &evicted {
        invalidate_session_caches(evicted_id);
    }
    
    // Count running vs stopped
    let running_count = sessions.values()
        .filter(|e| e.stopped_at.is_none())
        .count();
    
    Ok(SessionCleanupResult {
        evicted_count: evicted.len(),
        evicted_session_ids: evicted,
        sessions_before: before_count,
        sessions_after: remaining,
        running_sessions: running_count,
        stopped_sessions: remaining - running_count,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCleanupResult {
    pub evicted_count: usize,
    pub evicted_session_ids: Vec<String>,
    pub sessions_before: usize,
    pub sessions_after: usize,
    pub running_sessions: usize,
    pub stopped_sessions: usize,
}

/// Get info about sessions currently in memory.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_session_memory_info() -> Result<SessionMemoryInfo, String> {
    let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    
    let mut session_infos = Vec::new();
    for (id, entry) in sessions.iter() {
        let status = if entry.stopped_at.is_some() { "Stopped" } else { "Running" };
        let stopped_seconds = entry.stopped_at.map(|t| t.elapsed().as_secs());
        
        if let Ok(session) = entry.session.lock() {
            if let Ok(buffer) = session.packet_buffer.lock() {
                session_infos.push(SessionMemoryEntry {
                    id: id.clone(),
                    name: session.name.clone(),
                    status: status.to_string(),
                    packet_count: buffer.len(),
                    stopped_seconds,
                });
            }
        }
    }
    
    Ok(SessionMemoryInfo {
        total_sessions: sessions.len(),
        max_sessions: MAX_SESSIONS_IN_MEMORY,
        timeout_seconds: STOPPED_SESSION_TIMEOUT_SECS,
        sessions: session_infos,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMemoryInfo {
    pub total_sessions: usize,
    pub max_sessions: usize,
    pub timeout_seconds: u64,
    pub sessions: Vec<SessionMemoryEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMemoryEntry {
    pub id: String,
    pub name: String,
    pub status: String,
    pub packet_count: usize,
    pub stopped_seconds: Option<u64>,
}

// Saved Filters Commands
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn save_filter(name: String, filter_config: FilterConfig, bpf_expression: Option<String>) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let filter_config_json = serde_json::to_string(&filter_config).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO saved_filters (id, name, filter_config, bpf_expression, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            id,
            name,
            filter_config_json,
            bpf_expression,
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn list_saved_filters() -> Result<Vec<SavedFilter>, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, filter_config, bpf_expression, created_at FROM saved_filters ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;

    let filters = stmt.query_map([], |row| {
        Ok(SavedFilter {
            id: row.get(0)?,
            name: row.get(1)?,
            filter_config: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or_default(),
            bpf_expression: row.get(3)?,
            created_at: row.get(4)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(filters)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn delete_saved_filter(filter_id: String) -> Result<(), String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM saved_filters WHERE id = ?1",
        rusqlite::params![filter_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// Packet Bookmarks Commands
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn create_packet_bookmark(
    session_id: String,
    packet_index: i64,
    timestamp: String,
    note: Option<String>,
    tags: Vec<String>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO packet_bookmarks (id, session_id, packet_index, timestamp, note, tags, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            id,
            session_id,
            packet_index,
            timestamp,
            note,
            tags_json,
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn list_packet_bookmarks(session_id: String) -> Result<Vec<PacketBookmark>, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, session_id, packet_index, timestamp, note, tags, created_at 
         FROM packet_bookmarks WHERE session_id = ?1 ORDER BY packet_index"
    ).map_err(|e| e.to_string())?;

    let bookmarks = stmt.query_map(rusqlite::params![session_id], |row| {
        let tags_json: String = row.get(5)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        
        Ok(PacketBookmark {
            id: row.get(0)?,
            session_id: row.get(1)?,
            packet_index: row.get(2)?,
            timestamp: row.get(3)?,
            note: row.get(4)?,
            tags,
            created_at: row.get(6)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(bookmarks)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn delete_packet_bookmark(bookmark_id: String) -> Result<(), String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM packet_bookmarks WHERE id = ?1",
        rusqlite::params![bookmark_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reverse DNS lookup - resolve IP address to hostname
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn reverse_dns_lookup(ip: String) -> Result<Option<String>, String> {
    // Parse IP address
    let ip_addr: IpAddr = ip.parse().map_err(|e| format!("Invalid IP address: {}", e))?;
    
    // Create async DNS resolver using 0.25 builder API
    let resolver = Resolver::builder_with_config(
        ResolverConfig::default(),
        TokioConnectionProvider::default(),
    )
    .with_options(ResolverOpts::default())
    .build();
    
    // Perform reverse DNS lookup
    match resolver.reverse_lookup(ip_addr).await {
        Ok(ptr) => {
            // Get the first PTR record
            if let Some(name) = ptr.iter().next() {
                return Ok(Some(name.to_string()));
            }
        }
        Err(_) => {
            // DNS lookup failed, return None
        }
    }
    
    Ok(None)
}

// ─── IP Intelligence Lookup ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpLookupResult {
    pub ip: String,
    pub hostname: Option<String>,
    pub asn: Option<u32>,
    pub org: Option<String>,
    pub country: Option<String>,
    pub prefix: Option<String>,
    pub registry: Option<String>,
    pub is_private: bool,
}

/// Check if an IPv4 address is private (RFC 1918) or reserved
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}

/// Reverse the octets of an IPv4 address for DNS queries
/// e.g. "8.8.4.4" -> "4.4.8.8"
fn reverse_ip_octets(ip: &str) -> Option<String> {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    Some(format!("{}.{}.{}.{}", parts[3], parts[2], parts[1], parts[0]))
}

/// Full IP intelligence lookup using DNS:
/// - Reverse DNS (PTR) for hostname
/// - Team Cymru ASN mapping via DNS TXT for ASN, org, country, prefix
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn ip_lookup(ip: String) -> Result<IpLookupResult, String> {
    let ip_addr: IpAddr = ip.parse().map_err(|e| format!("Invalid IP: {}", e))?;

    // Private IPs — return immediately, no external lookups
    if is_private_ip(&ip_addr) {
        return Ok(IpLookupResult {
            ip: ip.clone(),
            hostname: None,
            asn: None,
            org: None,
            country: None,
            prefix: None,
            registry: None,
            is_private: true,
        });
    }

    let resolver = Resolver::builder_with_config(
        ResolverConfig::default(),
        TokioConnectionProvider::default(),
    )
    .with_options(ResolverOpts::default())
    .build();

    // 1. Reverse DNS (PTR)
    let hostname = match resolver.reverse_lookup(ip_addr).await {
        Ok(ptr) => ptr.iter().next().map(|n| {
            let s = n.to_string();
            s.trim_end_matches('.').to_string()
        }),
        Err(_) => None,
    };

    // 2. ASN lookup via Team Cymru DNS TXT
    let mut asn: Option<u32> = None;
    let mut country: Option<String> = None;
    let mut prefix: Option<String> = None;
    let mut registry: Option<String> = None;
    let mut org: Option<String> = None;

    if let IpAddr::V4(_) = ip_addr {
        if let Some(reversed) = reverse_ip_octets(&ip) {
            let cymru_name = format!("{}.origin.asn.cymru.com.", reversed);
            if let Ok(txt_lookup) = resolver.txt_lookup(cymru_name).await {
                // Format: "ASN | PREFIX | CC | REGISTRY | DATE"
                if let Some(record) = txt_lookup.iter().next() {
                    let txt = record.to_string();
                    let parts: Vec<&str> = txt.split('|').map(|s| s.trim()).collect();
                    if parts.len() >= 3 {
                        // First field may contain multiple ASNs separated by spaces
                        if let Ok(n) = parts[0].split_whitespace().next().unwrap_or("").parse::<u32>() {
                            asn = Some(n);
                        }
                        let p = parts[1].trim().to_string();
                        if !p.is_empty() { prefix = Some(p); }
                        let c = parts[2].trim().to_string();
                        if !c.is_empty() { country = Some(c); }
                        if parts.len() >= 4 {
                            let r = parts[3].trim().to_string();
                            if !r.is_empty() { registry = Some(r); }
                        }
                    }
                }
            }

            // 3. Org name lookup via AS<number>.asn.cymru.com
            if let Some(asn_num) = asn {
                let as_name = format!("AS{}.asn.cymru.com.", asn_num);
                if let Ok(txt_lookup) = resolver.txt_lookup(as_name).await {
                    // Format: "ASN | CC | REGISTRY | DATE | DESCRIPTION"
                    if let Some(record) = txt_lookup.iter().next() {
                        let txt = record.to_string();
                        let parts: Vec<&str> = txt.split('|').map(|s| s.trim()).collect();
                        if parts.len() >= 5 {
                            let desc = parts[4].trim().to_string();
                            if !desc.is_empty() { org = Some(desc); }
                        }
                    }
                }
            }
        }
    }

    Ok(IpLookupResult {
        ip,
        hostname,
        asn,
        org,
        country,
        prefix,
        registry,
        is_private: false,
    })
}

/// Batch reverse DNS lookup for multiple IPs
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn batch_reverse_dns_lookup(ips: Vec<String>) -> Result<HashMap<String, Option<String>>, String> {
    let mut results = HashMap::new();
    
    // For each IP, perform reverse DNS lookup
    for ip in ips {
        match reverse_dns_lookup(ip.clone()).await {
            Ok(hostname) => {
                results.insert(ip, hostname);
            }
            Err(_) => {
                results.insert(ip, None);
            }
        }
    }
    
    Ok(results)
}

// Scheduled Capture Commands

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledCaptureInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub interface: String,
    pub filter_config: FilterConfig,
    pub schedule_type: String, // "one_time" or "recurring"
    pub scheduled_time: String, // ISO 8601 datetime or cron expression
    pub duration_seconds: Option<u64>,
    pub enabled: bool,
    pub last_run: Option<String>,
    pub next_run: Option<String>,
    pub created_at: String,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn create_scheduled_capture(
    name: String,
    description: Option<String>,
    interface: String,
    filter_config: FilterConfig,
    schedule_type: String,
    scheduled_time: String,
    duration_seconds: Option<u64>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let filter_config_json = serde_json::to_string(&filter_config).map_err(|e| e.to_string())?;
    
    // Calculate next_run based on schedule_type
    let next_run = if schedule_type == "one_time" {
        Some(scheduled_time.clone())
    } else {
        // For recurring, next_run is the scheduled_time (cron expression)
        Some(scheduled_time.clone())
    };
    
    conn.execute(
        "INSERT INTO scheduled_captures (id, name, description, interface, filter_config, schedule_type, scheduled_time, duration_seconds, enabled, next_run, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            id,
            name,
            description,
            interface,
            filter_config_json,
            schedule_type,
            scheduled_time,
            duration_seconds,
            1, // enabled by default
            next_run,
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn list_scheduled_captures() -> Result<Vec<ScheduledCaptureInfo>, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, interface, filter_config, schedule_type, scheduled_time, duration_seconds, enabled, last_run, next_run, created_at
         FROM scheduled_captures
         ORDER BY created_at DESC"
    )
    .map_err(|e| e.to_string())?;

    let captures = stmt.query_map([], |row| {
        let filter_config_json: String = row.get(4)?;
        let filter_config: FilterConfig = serde_json::from_str(&filter_config_json)
            .map_err(|_| rusqlite::Error::InvalidColumnType(4, "Invalid JSON".to_string(), rusqlite::types::Type::Text))?;

        Ok(ScheduledCaptureInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            interface: row.get(3)?,
            filter_config,
            schedule_type: row.get(5)?,
            scheduled_time: row.get(6)?,
            duration_seconds: row.get(7)?,
            enabled: row.get::<_, i64>(8)? != 0,
            last_run: row.get(9)?,
            next_run: row.get(10)?,
            created_at: row.get(11)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(captures)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn update_scheduled_capture(
    id: String,
    name: Option<String>,
    description: Option<String>,
    interface: Option<String>,
    filter_config: Option<FilterConfig>,
    schedule_type: Option<String>,
    scheduled_time: Option<String>,
    duration_seconds: Option<u64>,
    enabled: Option<bool>,
) -> Result<(), String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    
    let mut updates = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    let mut param_index = 1;

    if let Some(n) = name {
        updates.push(format!("name = ?{}", param_index));
        params.push(rusqlite::types::Value::Text(n));
        param_index += 1;
    }
    if let Some(d) = description {
        updates.push(format!("description = ?{}", param_index));
        params.push(rusqlite::types::Value::Text(d));
        param_index += 1;
    }
    if let Some(i) = interface {
        updates.push(format!("interface = ?{}", param_index));
        params.push(rusqlite::types::Value::Text(i));
        param_index += 1;
    }
    if let Some(fc) = filter_config {
        let filter_config_json = serde_json::to_string(&fc).map_err(|e| e.to_string())?;
        updates.push(format!("filter_config = ?{}", param_index));
        params.push(rusqlite::types::Value::Text(filter_config_json));
        param_index += 1;
    }
    if let Some(st) = schedule_type {
        updates.push(format!("schedule_type = ?{}", param_index));
        params.push(rusqlite::types::Value::Text(st));
        param_index += 1;
    }
    if let Some(st) = scheduled_time {
        updates.push(format!("scheduled_time = ?{}", param_index));
        params.push(rusqlite::types::Value::Text(st.clone()));
        param_index += 1;
        // Update next_run if scheduled_time changed
        updates.push(format!("next_run = ?{}", param_index));
        params.push(rusqlite::types::Value::Text(st));
        param_index += 1;
    }
    if let Some(d) = duration_seconds {
        updates.push(format!("duration_seconds = ?{}", param_index));
        params.push(rusqlite::types::Value::Integer(d as i64));
        param_index += 1;
    }
    if let Some(e) = enabled {
        updates.push(format!("enabled = ?{}", param_index));
        params.push(rusqlite::types::Value::Integer(if e { 1 } else { 0 }));
        param_index += 1;
    }

    if updates.is_empty() {
        return Ok(());
    }

    params.push(rusqlite::types::Value::Text(id));
    let query = format!("UPDATE scheduled_captures SET {} WHERE id = ?{}", updates.join(", "), param_index);
    
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    stmt.execute(rusqlite::params_from_iter(params.iter())).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn delete_scheduled_capture(id: String) -> Result<(), String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM scheduled_captures WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_scheduled_captures_due() -> Result<Vec<ScheduledCaptureInfo>, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    
    // Get enabled scheduled captures where next_run is in the past or now
    let mut stmt = conn.prepare(
        "SELECT id, name, description, interface, filter_config, schedule_type, scheduled_time, duration_seconds, enabled, last_run, next_run, created_at
         FROM scheduled_captures
         WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?1
         ORDER BY next_run ASC"
    )
    .map_err(|e| e.to_string())?;

    let captures = stmt.query_map(rusqlite::params![now], |row| {
        let filter_config_json: String = row.get(4)?;
        let filter_config: FilterConfig = serde_json::from_str(&filter_config_json)
            .map_err(|_| rusqlite::Error::InvalidColumnType(4, "Invalid JSON".to_string(), rusqlite::types::Type::Text))?;

        Ok(ScheduledCaptureInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            interface: row.get(3)?,
            filter_config,
            schedule_type: row.get(5)?,
            scheduled_time: row.get(6)?,
            duration_seconds: row.get(7)?,
            enabled: row.get::<_, i64>(8)? != 0,
            last_run: row.get(9)?,
            next_run: row.get(10)?,
            created_at: row.get(11)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(captures)
}

/// RTP stream summary for packet monitor UI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RtpStreamInfo {
    pub ssrc: u32,
    pub src_ip: String,
    pub src_port: u16,
    pub dst_ip: String,
    pub dst_port: u16,
    pub payload_type: u8,
    pub codec_name: String,
    pub packet_count: u64,
    pub lost_packets: u32,
    pub loss_percentage: f64,
    pub jitter: f64,
    pub mos_score: f64,
    pub first_packet_time: String,
    pub last_packet_time: String,
}

fn get_packets_for_session(session_id: &str, limit: usize) -> Result<Vec<PacketInfo>, String> {
    let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
    if let Some(entry) = sessions.get(session_id) {
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        let buffer = session.packet_buffer.lock().map_err(|_| "Failed to lock packet buffer")?;
        return Ok(buffer.get_last(limit));
    }
    drop(sessions); // Release lock before file I/O
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let (file_path, rtp_port_range): (String, Option<(u16, u16)>) = conn.query_row(
        "SELECT file_path, filter_config FROM capture_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| {
            let path: String = row.get(0)?;
            let filter_config_json: String = row.get(1)?;
            let rtp_port_range = serde_json::from_str::<FilterConfig>(&filter_config_json)
                .ok()
                .and_then(|fc| fc.rtp_port_range);
            Ok((path, rtp_port_range))
        },
    ).map_err(|e| e.to_string())?;

    let mut cap = Capture::from_file(&file_path)
        .map_err(|e| format!("Failed to open pcap file: {}", e))?;
    let link_layer_type = cap.get_datalink().0 as u32;
    let parser = PacketParser::with_rtp_port_range(link_layer_type, rtp_port_range);
    let mut packets = Vec::new();
    let mut packet_count = 0u64;

    while let Ok(packet) = cap.next_packet() {
        if packet_count >= limit as u64 {
            break;
        }
        if let Some(packet_info) = parser.parse(&packet, Some(packet_count)) {
            packets.push(packet_info);
            packet_count += 1;
        }
    }
    Ok(packets)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_rtp_streams(session_id: String) -> Result<Vec<RtpStreamInfo>, String> {
    let packets = get_packets_for_session(&session_id, 50_000)?;

    // Build dynamic codec map from SDP rtpmap attributes in SIP packets
    let sdp_codec_map = crate::packet_capture::rtp_analyzer::extract_sdp_codec_map(&packets);

    let mut tracker = RtpStreamTracker::new();

    for p in &packets {
        let is_rtp = p.protocol == Protocol::RTP
            || matches!(p.decoded.as_ref().map(|d| &d.application), Some(crate::packet_capture::ApplicationLayer::Rtp(_)));
        if !is_rtp || p.data.len() < 12 {
            continue;
        }
        let _ = tracker.process_packet(
            p.src_ip,
            p.src_port,
            p.dst_ip,
            p.dst_port,
            p.timestamp,
            &p.data,
        );
    }

    let streams: Vec<RtpStreamInfo> = tracker
        .get_all_streams()
        .iter()
        .map(|s| {
            let loss_percentage = if s.packet_count > 0 {
                (s.lost_packets as f64 / s.packet_count as f64) * 100.0
            } else {
                0.0
            };
            let mos_score = calculate_mos(s.jitter, loss_percentage);
            RtpStreamInfo {
                ssrc: s.ssrc,
                src_ip: s.src_ip.to_string(),
                src_port: s.src_port,
                dst_ip: s.dst_ip.to_string(),
                dst_port: s.dst_port,
                payload_type: s.payload_type,
                codec_name: resolve_codec_name(s.payload_type, &sdp_codec_map),
                packet_count: s.packet_count,
                lost_packets: s.lost_packets,
                loss_percentage,
                jitter: s.jitter,
                mos_score,
                first_packet_time: s.first_packet_time.to_rfc3339(),
                last_packet_time: s.last_packet_time.to_rfc3339(),
            }
        })
        .collect();

    Ok(streams)
}

/// Get time-series quality history for a specific RTP stream.
/// Returns per-second buckets of jitter, loss, MOS for graphing.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_rtp_stream_history(
    session_id: String,
    ssrc: u32,
) -> Result<Option<crate::packet_capture::rtp_analyzer::RtpStreamHistory>, String> {
    let packets = get_packets_for_session(&session_id, 50_000)?;
    let sdp_codec_map = crate::packet_capture::rtp_analyzer::extract_sdp_codec_map(&packets);
    let mut tracker = RtpStreamTracker::new();

    for p in &packets {
        let is_rtp = p.protocol == Protocol::RTP
            || matches!(p.decoded.as_ref().map(|d| &d.application), Some(crate::packet_capture::ApplicationLayer::Rtp(_)));
        if !is_rtp || p.data.len() < 12 {
            continue;
        }
        let _ = tracker.process_packet(
            p.src_ip,
            p.src_port,
            p.dst_ip,
            p.dst_port,
            p.timestamp,
            &p.data,
        );
    }

    Ok(tracker.get_stream_history(ssrc, Some(&sdp_codec_map)))
}

/// Get time-series quality history for all RTP streams in a session.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_all_rtp_stream_histories(
    session_id: String,
) -> Result<Vec<crate::packet_capture::rtp_analyzer::RtpStreamHistory>, String> {
    let packets = get_packets_for_session(&session_id, 50_000)?;
    let sdp_codec_map = crate::packet_capture::rtp_analyzer::extract_sdp_codec_map(&packets);
    let mut tracker = RtpStreamTracker::new();

    for p in &packets {
        let is_rtp = p.protocol == Protocol::RTP
            || matches!(p.decoded.as_ref().map(|d| &d.application), Some(crate::packet_capture::ApplicationLayer::Rtp(_)));
        if !is_rtp || p.data.len() < 12 {
            continue;
        }
        let _ = tracker.process_packet(
            p.src_ip,
            p.src_port,
            p.dst_ip,
            p.dst_port,
            p.timestamp,
            &p.data,
        );
    }

    Ok(tracker.get_all_stream_histories(Some(&sdp_codec_map)))
}

/// Extract tag from From/To header value (e.g. "<sip:u@h>;tag=abc" -> "abc").
fn sip_tag_from_header(header: &str) -> Option<String> {
    let lower = header.to_lowercase();
    let i = lower.find("tag=")?;
    let rest = header[i + 4..].trim_start();
    let end = rest.find(|c| c == ';' || c == ' ').unwrap_or(rest.len());
    let tag = rest[..end].trim().trim_matches('"');
    if tag.is_empty() {
        None
    } else {
        Some(tag.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SipDialogMessage {
    pub method_or_code: String,
    pub cseq: Option<String>,
    pub timestamp: String,
    pub packet_index: u64,
    /// Index into dialog participants (request: sender=From, receiver=To; response: sender=To, receiver=From).
    pub from_participant_index: Option<u32>,
    pub to_participant_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SipDialog {
    pub call_id: String,
    pub from_tag: Option<String>,
    pub to_tag: Option<String>,
    pub messages: Vec<SipDialogMessage>,
    pub start_time: String,
    pub end_time: Option<String>,
    /// Ordered list of participant identities (From/To) for multi-party ladder.
    pub participants: Option<Vec<String>>,
}

/// Normalize From/To for participant identity (trim, limit length).
fn sip_identity(header: Option<&String>) -> String {
    header
        .map(|s| s.trim())
        .unwrap_or("")
        .chars()
        .take(80)
        .collect::<String>()
        .trim()
        .to_string()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_sip_dialogs(session_id: String) -> Result<Vec<SipDialog>, String> {
    let packets = get_packets_for_session(&session_id, 50_000)?;
    #[derive(Clone)]
    struct RawMsg {
        method_or_code: String,
        cseq: Option<String>,
        timestamp: String,
        packet_index: u64,
        from_identity: String,
        to_identity: String,
        is_request: bool,
        /// IP-level source for correct directionality
        src_ip: String,
        /// IP-level destination for correct directionality
        dst_ip: String,
    }
    // Collect (call_id, from_tag, to_tag, raw_msg, timestamp) for each SIP message
    let mut per_message: Vec<(String, String, String, RawMsg, String)> = Vec::new();

    for (idx, p) in packets.iter().enumerate() {
        // Try to get SIP data from decoded application layer first
        let sip_from_decoded = p.decoded.as_ref().and_then(|d| {
            match &d.application {
                ApplicationLayer::Sip(s) => Some(s.clone()),
                _ => None,
            }
        });

        // If no decoded SIP but protocol is SIP, try re-parsing from raw payload
        let sip_reparsed;
        let sip = if let Some(ref s) = sip_from_decoded {
            s
        } else {
            // Only attempt re-parse if this packet is SIP (by protocol) or has SIP in payload
            if p.protocol != Protocol::SIP && !Protocol::is_sip(&p.data) {
                continue;
            }
            // Try to parse SIP from the raw payload
            match crate::packet_capture::sip_parser::parse_sip_message(&p.data) {
                Ok(parsed) => {
                    sip_reparsed = parsed;
                    &sip_reparsed
                }
                Err(_) => continue,
            }
        };

        let call_id = sip.call_id.as_deref().unwrap_or("").to_string();
        if call_id.is_empty() {
            continue;
        }
        let from_tag = sip
            .from
            .as_ref()
            .and_then(|f| sip_tag_from_header(f))
            .unwrap_or_else(|| "".to_string());
        let to_tag = sip
            .to
            .as_ref()
            .and_then(|t| sip_tag_from_header(t))
            .unwrap_or_else(|| "".to_string());
        let method_or_code = if let Some(m) = &sip.method {
            m.clone()
        } else if let Some(code) = sip.response_code {
            format!("{}", code)
        } else {
            continue;
        };
        let from_identity = sip_identity(sip.from.as_ref());
        let to_identity = sip_identity(sip.to.as_ref());
        let is_request = sip.method.is_some();
        let raw = RawMsg {
            method_or_code,
            cseq: sip.cseq.clone(),
            timestamp: p.timestamp.to_rfc3339(),
            packet_index: idx as u64,
            from_identity,
            to_identity,
            is_request,
            src_ip: p.src_ip.to_string(),
            dst_ip: p.dst_ip.to_string(),
        };
        per_message.push((call_id, from_tag, to_tag, raw, p.timestamp.to_rfc3339()));
    }

    // Group by dialog: same Call-ID and overlapping tag set (so INVITE/200/ACK/BYE from both sides end up in one dialog)
    #[derive(Clone, Default)]
    struct DialogBucket {
        messages: Vec<RawMsg>,
        start_time: String,
        end_time: Option<String>,
        tag_set: std::collections::BTreeSet<String>,
    }
    // by_call_id -> list of (tag_set, bucket). We merge buckets when tag sets overlap.
    let mut by_call: BTreeMap<String, Vec<DialogBucket>> = BTreeMap::new();

    for (call_id, from_tag, to_tag, raw, ts) in per_message {
        let mut tags: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        if !from_tag.is_empty() {
            tags.insert(from_tag);
        }
        if !to_tag.is_empty() {
            tags.insert(to_tag);
        }
        if tags.is_empty() {
            tags.insert("".to_string());
        }

        let buckets = by_call.entry(call_id.clone()).or_default();
        let mut merged_into: Option<usize> = None;
        for (i, b) in buckets.iter().enumerate() {
            if b.tag_set.is_empty() || tags.is_empty() {
                continue;
            }
            if b.tag_set.intersection(&tags).next().is_some() {
                merged_into = Some(i);
                break;
            }
        }
        match merged_into {
            Some(i) => {
                buckets[i].messages.push(raw);
                buckets[i].tag_set.extend(tags);
                if buckets[i].end_time.as_ref().map(|e| e.as_str()) < Some(ts.as_str()) {
                    buckets[i].end_time = Some(ts.clone());
                }
            }
            None => {
                buckets.push(DialogBucket {
                    messages: vec![raw],
                    start_time: ts.clone(),
                    end_time: Some(ts),
                    tag_set: tags,
                });
            }
        }
    }

    // Flatten: for each call_id we may have created multiple buckets when tags didn't overlap yet; merge again by tag set
    let mut dialogs: Vec<SipDialog> = Vec::new();
    for (call_id, mut buckets) in by_call {
        // Merge buckets that share any tag (e.g. (call_id, {a}) and (call_id, {a,b}) from INVITE then 200 OK)
        loop {
            let mut changed = false;
            for i in 0..buckets.len() {
                for j in (i + 1)..buckets.len() {
                    if buckets[i].tag_set.intersection(&buckets[j].tag_set).next().is_some() {
                        let mut b_j = buckets.swap_remove(j);
                        let b_i = &mut buckets[i];
                        b_i.messages.append(&mut b_j.messages);
                        b_i.tag_set.extend(b_j.tag_set);
                        let take_later = match (&b_i.end_time, &b_j.end_time) {
                            (Some(a), Some(b)) => b > a,
                            (None, Some(_)) => true,
                            _ => false,
                        };
                        if take_later {
                            b_i.end_time = b_j.end_time.clone();
                        }
                        changed = true;
                        break;
                    }
                }
                if changed {
                    break;
                }
            }
            if !changed {
                break;
            }
        }
        for b in buckets {
            let mut raw_messages = b.messages;
            raw_messages.sort_by_key(|m| m.packet_index);
            let start_time = raw_messages
                .first()
                .map(|m| m.timestamp.clone())
                .unwrap_or_else(|| b.start_time);
            let end_time = raw_messages
                .last()
                .map(|m| m.timestamp.clone())
                .or(b.end_time);

            // Build participants using IP addresses for reliable directionality.
            // We use IP:port-style labels as the ground truth for which side sent a message,
            // then enrich the display label with the SIP identity (From/To header) when available.
            
            // Step 1: Collect unique IP endpoints (source IPs seen in the dialog)
            let mut ip_to_sip_identity: HashMap<String, String> = HashMap::new();
            let mut ip_order: Vec<String> = Vec::new();
            for m in &raw_messages {
                // For requests, src_ip is the UAC (caller), dst_ip is the UAS (callee).
                // For responses, src_ip is the UAS, dst_ip is the UAC.
                // Map each IP to its SIP identity:
                // - UAC IP → From identity
                // - UAS IP → To identity
                if m.is_request {
                    if !ip_to_sip_identity.contains_key(&m.src_ip) && !m.from_identity.is_empty() {
                        ip_to_sip_identity.insert(m.src_ip.clone(), m.from_identity.clone());
                    }
                    if !ip_to_sip_identity.contains_key(&m.dst_ip) && !m.to_identity.is_empty() {
                        ip_to_sip_identity.insert(m.dst_ip.clone(), m.to_identity.clone());
                    }
                } else {
                    // Response: src_ip is UAS (To), dst_ip is UAC (From)
                    if !ip_to_sip_identity.contains_key(&m.src_ip) && !m.to_identity.is_empty() {
                        ip_to_sip_identity.insert(m.src_ip.clone(), m.to_identity.clone());
                    }
                    if !ip_to_sip_identity.contains_key(&m.dst_ip) && !m.from_identity.is_empty() {
                        ip_to_sip_identity.insert(m.dst_ip.clone(), m.from_identity.clone());
                    }
                }
                // Track unique IPs in order of first appearance
                if !ip_order.contains(&m.src_ip) {
                    ip_order.push(m.src_ip.clone());
                }
                if !ip_order.contains(&m.dst_ip) {
                    ip_order.push(m.dst_ip.clone());
                }
            }

            // Step 2: Build participant labels — prefer SIP identity, fallback to IP
            let mut participants: Vec<String> = Vec::new();
            let mut ip_to_participant_idx: HashMap<String, usize> = HashMap::new();
            for ip in &ip_order {
                let label = ip_to_sip_identity.get(ip)
                    .filter(|s| !s.is_empty())
                    .cloned()
                    .unwrap_or_else(|| ip.clone());
                // Avoid duplicate labels (e.g. proxy with same SIP identity as endpoint)
                // but keep separate participant indices for different IPs
                if !ip_to_participant_idx.contains_key(ip) {
                    let idx = participants.len();
                    participants.push(label);
                    ip_to_participant_idx.insert(ip.clone(), idx);
                }
            }

            let participants_opt = if participants.is_empty() {
                None
            } else {
                Some(participants)
            };

            // Step 3: Assign from/to indices using IP address mapping
            let messages: Vec<SipDialogMessage> = raw_messages
                .into_iter()
                .map(|m| {
                    let from_idx = ip_to_participant_idx.get(&m.src_ip).map(|i| *i as u32);
                    let to_idx = ip_to_participant_idx.get(&m.dst_ip).map(|i| *i as u32);
                    SipDialogMessage {
                        method_or_code: m.method_or_code,
                        cseq: m.cseq,
                        timestamp: m.timestamp,
                        packet_index: m.packet_index,
                        from_participant_index: from_idx,
                        to_participant_index: to_idx,
                    }
                })
                .collect();
            let tag_vec: Vec<String> = b.tag_set.into_iter().filter(|s| !s.is_empty()).collect();
            let from_tag = tag_vec.first().cloned();
            let to_tag = if tag_vec.len() > 1 {
                tag_vec.get(1).cloned()
            } else {
                None
            };
            dialogs.push(SipDialog {
                call_id: call_id.clone(),
                from_tag,
                to_tag,
                messages,
                start_time,
                end_time,
                participants: participants_opt,
            });
        }
    }
    dialogs.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    Ok(dialogs)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconstructedCallAnomaly {
    pub id: String,
    pub code: String,
    pub label: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconstructedCallLegRef {
    pub id: String,
    pub dialog_index: Option<u32>,
    pub call_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconstructedCallMediaRef {
    pub id: String,
    pub ssrc: Option<u32>,
    pub codec: Option<String>,
    pub src_label: Option<String>,
    pub dst_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallSessionEvent {
    pub id: String,
    pub r#type: String,
    pub event_type: String,
    pub label: String,
    pub timestamp: String,
    pub packet_index: Option<u64>,
    pub packet_indices: Vec<u64>,
    pub call_id: Option<String>,
    pub dialog_index: Option<u32>,
    pub message_index: Option<u32>,
    pub media_ssrc: Option<u32>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallSession {
    pub id: String,
    pub capture_session_id: String,
    pub parties: Vec<String>,
    pub start_time: String,
    pub end_time: Option<String>,
    pub duration_sec: Option<u64>,
    pub disposition: String,
    pub anomalies: Vec<ReconstructedCallAnomaly>,
    pub events: Vec<CallSessionEvent>,
    pub legs: Vec<ReconstructedCallLegRef>,
    pub media_refs: Vec<ReconstructedCallMediaRef>,
}

#[derive(Debug, Clone)]
struct SessionAnomalyFlags {
    has_error_response: bool,
    missing_termination: bool,
    out_of_order_signaling: bool,
}

#[derive(Debug, Clone)]
struct SipPacketMeta {
    packet_index: u64,
    timestamp: String,
    timestamp_dt: Option<chrono::DateTime<chrono::Utc>>,
    call_id: String,
    method: Option<String>,
    response_code: Option<u16>,
    cseq_method: Option<String>,
    src_endpoint: String,
    dst_endpoint: String,
    correlation_tokens: std::collections::BTreeSet<String>,
    linked_call_ids: std::collections::BTreeSet<String>,
    has_hold_sdp: bool,
    has_resume_sdp: bool,
    raw_upper: String,
}

#[derive(Debug, Clone)]
struct CallSessionLeg {
    dialog_index: u32,
    call_id: String,
    from_tag: Option<String>,
    to_tag: Option<String>,
    participants: Vec<String>,
    start_time: String,
    end_time: Option<String>,
    start_dt: Option<chrono::DateTime<chrono::Utc>>,
    end_dt: Option<chrono::DateTime<chrono::Utc>>,
    packet_indices: Vec<u64>,
    endpoints: HashSet<String>,
    correlation_tokens: std::collections::BTreeSet<String>,
    linked_call_ids: std::collections::BTreeSet<String>,
    rtp_ssrcs: std::collections::BTreeSet<u32>,
    has_transfer_signal: bool,
}

#[derive(Debug, Clone)]
struct SessionLegForGrouping {
    call_id: String,
    start_dt: Option<chrono::DateTime<chrono::Utc>>,
    end_dt: Option<chrono::DateTime<chrono::Utc>>,
    endpoints: HashSet<String>,
    correlation_tokens: std::collections::BTreeSet<String>,
    linked_call_ids: std::collections::BTreeSet<String>,
    rtp_ssrcs: std::collections::BTreeSet<u32>,
}

#[derive(Debug, Clone)]
struct SessionGroupingDsu {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl SessionGroupingDsu {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
            rank: vec![0; n],
        }
    }

    fn find(&mut self, x: usize) -> usize {
        if self.parent[x] != x {
            let root = self.find(self.parent[x]);
            self.parent[x] = root;
        }
        self.parent[x]
    }

    fn union(&mut self, a: usize, b: usize) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra == rb {
            return;
        }
        if self.rank[ra] < self.rank[rb] {
            self.parent[ra] = rb;
        } else if self.rank[ra] > self.rank[rb] {
            self.parent[rb] = ra;
        } else {
            self.parent[rb] = ra;
            self.rank[ra] = self.rank[ra].saturating_add(1);
        }
    }
}

fn parse_timestamp_utc(timestamp: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

fn cseq_method_upper(cseq: Option<&String>) -> Option<String> {
    cseq.and_then(|value| value.split_whitespace().last())
        .map(|method| method.to_uppercase())
}

fn decode_percent_encoding(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h1 = bytes[i + 1] as char;
            let h2 = bytes[i + 2] as char;
            if let (Some(a), Some(b)) = (h1.to_digit(16), h2.to_digit(16)) {
                out.push(((a << 4) as u8) | (b as u8));
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn parse_replaces_call_id(raw_value: &str) -> Option<String> {
    let decoded = decode_percent_encoding(raw_value);
    let lower = decoded.to_lowercase();
    let mut value = decoded.as_str();
    if let Some(idx) = lower.find("replaces=") {
        value = &decoded[idx + "replaces=".len()..];
    }
    let value = value.trim().trim_matches('<').trim_matches('>');
    let end = value
        .find(|c: char| c == ';' || c == '&' || c == ' ' || c == '?' || c == '>')
        .unwrap_or(value.len());
    let call_id = value[..end].trim().trim_matches('"');
    if call_id.is_empty() {
        None
    } else {
        Some(call_id.to_string())
    }
}

fn extract_notify_sipfrag_code(raw_upper: &str) -> Option<u16> {
    let body = if let Some(idx) = raw_upper.find("\r\n\r\n") {
        &raw_upper[idx + 4..]
    } else {
        raw_upper
    };
    let marker = "SIP/2.0 ";
    for (idx, _) in body.match_indices(marker) {
        let rest = &body[idx + marker.len()..];
        let code_str: String = rest.chars().take(3).collect();
        if code_str.len() == 3 && code_str.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(code) = code_str.parse::<u16>() {
                return Some(code);
            }
        }
    }
    None
}

fn extract_correlation_tokens(headers: &HashMap<String, String>) -> std::collections::BTreeSet<String> {
    let mut tokens = std::collections::BTreeSet::new();
    for (name, value) in headers {
        let name_l = name.to_lowercase();
        let is_target = name_l == "p-charge-info" || name_l.starts_with("x-");
        if !is_target {
            continue;
        }
        let normalized = value.trim().replace(char::is_whitespace, " ");
        if !normalized.is_empty() {
            tokens.insert(format!("{}={}", name_l, normalized));
        }
    }
    tokens
}

fn extract_sip_message_from_packet(packet: &PacketInfo) -> Option<crate::packet_capture::sip_parser::ParsedSipMessage> {
    if let Some(decoded) = &packet.decoded {
        match &decoded.application {
            ApplicationLayer::Sip(sip) => return Some(sip.clone()),
            ApplicationLayer::SipOverWs { sip, .. } => return Some(sip.clone()),
            _ => {}
        }
    }
    if packet.protocol != Protocol::SIP && !Protocol::is_sip(&packet.data) {
        return None;
    }
    crate::packet_capture::sip_parser::parse_sip_message(&packet.data).ok()
}

fn build_sip_packet_meta(packets: &[PacketInfo]) -> BTreeMap<u64, SipPacketMeta> {
    let mut by_index: BTreeMap<u64, SipPacketMeta> = BTreeMap::new();
    for (idx, packet) in packets.iter().enumerate() {
        let Some(sip) = extract_sip_message_from_packet(packet) else {
            continue;
        };
        let Some(call_id) = sip.call_id.clone().filter(|s| !s.trim().is_empty()) else {
            continue;
        };
        let timestamp = packet.timestamp.to_rfc3339();
        let method = sip.method.clone().map(|m| m.to_uppercase());
        let cseq_method = cseq_method_upper(sip.cseq.as_ref());
        let mut linked_call_ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        if let Some(replaces) = sip.headers.get("replaces").and_then(|v| parse_replaces_call_id(v)) {
            linked_call_ids.insert(replaces);
        }
        if let Some(refer_to) = sip.headers.get("refer-to").and_then(|v| parse_replaces_call_id(v)) {
            linked_call_ids.insert(refer_to);
        }
        let body_text = sip
            .body
            .as_ref()
            .map(|b| b.content.to_lowercase())
            .unwrap_or_default();
        let has_hold_sdp = body_text.contains("a=inactive") || body_text.contains("a=sendonly");
        let has_resume_sdp = body_text.contains("a=sendrecv");
        by_index.insert(
            idx as u64,
            SipPacketMeta {
                packet_index: idx as u64,
                timestamp_dt: parse_timestamp_utc(&timestamp),
                timestamp,
                call_id,
                method,
                response_code: sip.response_code,
                cseq_method,
                src_endpoint: format!("{}:{}", packet.src_ip, packet.src_port),
                dst_endpoint: format!("{}:{}", packet.dst_ip, packet.dst_port),
                correlation_tokens: extract_correlation_tokens(&sip.headers),
                linked_call_ids,
                has_hold_sdp,
                has_resume_sdp,
                raw_upper: sip.raw_message.to_uppercase(),
            },
        );
    }
    by_index
}

fn build_call_session_legs(dialogs: &[SipDialog], packet_meta: &BTreeMap<u64, SipPacketMeta>) -> Vec<CallSessionLeg> {
    dialogs
        .iter()
        .enumerate()
        .map(|(dialog_index, dialog)| {
            let mut endpoints: HashSet<String> = HashSet::new();
            let mut correlation_tokens: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
            let mut linked_call_ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
            let mut packet_indices: Vec<u64> = dialog.messages.iter().map(|m| m.packet_index).collect();
            packet_indices.sort_unstable();
            packet_indices.dedup();
            for idx in &packet_indices {
                if let Some(meta) = packet_meta.get(idx) {
                    endpoints.insert(meta.src_endpoint.clone());
                    endpoints.insert(meta.dst_endpoint.clone());
                    correlation_tokens.extend(meta.correlation_tokens.iter().cloned());
                    for linked in &meta.linked_call_ids {
                        if linked != &dialog.call_id {
                            linked_call_ids.insert(linked.clone());
                        }
                    }
                }
            }
            let participants = dialog.participants.clone().unwrap_or_default();
            let has_transfer_signal = dialog.messages.iter().any(|m| {
                let token = m.method_or_code.to_uppercase();
                token == "REFER"
            }) || !linked_call_ids.is_empty();
            CallSessionLeg {
                dialog_index: dialog_index as u32,
                call_id: dialog.call_id.clone(),
                from_tag: dialog.from_tag.clone(),
                to_tag: dialog.to_tag.clone(),
                participants,
                start_dt: parse_timestamp_utc(&dialog.start_time),
                end_dt: dialog
                    .end_time
                    .as_ref()
                    .and_then(|end| parse_timestamp_utc(end))
                    .or_else(|| parse_timestamp_utc(&dialog.start_time)),
                start_time: dialog.start_time.clone(),
                end_time: dialog.end_time.clone(),
                packet_indices,
                endpoints,
                correlation_tokens,
                linked_call_ids,
                rtp_ssrcs: std::collections::BTreeSet::new(),
                has_transfer_signal,
            }
        })
        .collect()
}

fn stream_matches_leg(stream: &RtpStreamInfo, leg: &CallSessionLeg) -> bool {
    let src_ep = format!("{}:{}", stream.src_ip, stream.src_port);
    let dst_ep = format!("{}:{}", stream.dst_ip, stream.dst_port);
    if !(leg.endpoints.contains(&src_ep) || leg.endpoints.contains(&dst_ep)) {
        return false;
    }
    let stream_start = parse_timestamp_utc(&stream.first_packet_time);
    let stream_end = parse_timestamp_utc(&stream.last_packet_time);
    let gap = time_gap_seconds(leg.start_dt, leg.end_dt, stream_start, stream_end);
    gap.unwrap_or(3) <= 2
}

fn build_packet_dialog_message_index(
    dialogs: &[SipDialog],
) -> HashMap<u64, (u32, u32, String, Option<String>, Option<String>)> {
    let mut packet_to_dialog: HashMap<u64, (u32, u32, String, Option<String>, Option<String>)> =
        HashMap::new();
    for (dialog_index, dialog) in dialogs.iter().enumerate() {
        for (message_index, message) in dialog.messages.iter().enumerate() {
            packet_to_dialog.insert(
                message.packet_index,
                (
                    dialog_index as u32,
                    message_index as u32,
                    dialog.call_id.clone(),
                    dialog.from_tag.clone(),
                    dialog.to_tag.clone(),
                ),
            );
        }
    }
    packet_to_dialog
}

fn time_gap_seconds(
    a_start: Option<chrono::DateTime<chrono::Utc>>,
    a_end: Option<chrono::DateTime<chrono::Utc>>,
    b_start: Option<chrono::DateTime<chrono::Utc>>,
    b_end: Option<chrono::DateTime<chrono::Utc>>,
) -> Option<i64> {
    match (a_start, a_end, b_start, b_end) {
        (Some(as_), Some(ae), Some(bs), Some(be)) => {
            if ae < bs {
                Some((bs - ae).num_seconds())
            } else if be < as_ {
                Some((as_ - be).num_seconds())
            } else {
                Some(0)
            }
        }
        _ => None,
    }
}

fn attach_rtp_ssrcs_to_legs(legs: &mut [CallSessionLeg], rtp_streams: &[RtpStreamInfo]) {
    for leg in legs.iter_mut() {
        for stream in rtp_streams {
            let src_ep = format!("{}:{}", stream.src_ip, stream.src_port);
            let dst_ep = format!("{}:{}", stream.dst_ip, stream.dst_port);
            if !(leg.endpoints.contains(&src_ep) || leg.endpoints.contains(&dst_ep)) {
                continue;
            }
            let stream_start = parse_timestamp_utc(&stream.first_packet_time);
            let stream_end = parse_timestamp_utc(&stream.last_packet_time);
            let gap = time_gap_seconds(leg.start_dt, leg.end_dt, stream_start, stream_end);
            if gap.unwrap_or(3) <= 2 {
                leg.rtp_ssrcs.insert(stream.ssrc);
            }
        }
    }
}

fn group_call_session_leg_indices(legs: &[SessionLegForGrouping]) -> Vec<Vec<usize>> {
    if legs.is_empty() {
        return Vec::new();
    }

    let mut dsu = SessionGroupingDsu::new(legs.len());

    // 1) REFER/Replaces linkage.
    for i in 0..legs.len() {
        for j in (i + 1)..legs.len() {
            let linked = legs[i].linked_call_ids.contains(&legs[j].call_id)
                || legs[j].linked_call_ids.contains(&legs[i].call_id);
            if linked {
                dsu.union(i, j);
            }
        }
    }

    // 2) Correlation headers (P-Charge-Info / X-*).
    for i in 0..legs.len() {
        for j in (i + 1)..legs.len() {
            if dsu.find(i) == dsu.find(j) {
                continue;
            }
            if legs[i]
                .correlation_tokens
                .intersection(&legs[j].correlation_tokens)
                .next()
                .is_some()
            {
                dsu.union(i, j);
            }
        }
    }

    // 3) Endpoint + temporal adjacency (~2s).
    for i in 0..legs.len() {
        for j in (i + 1)..legs.len() {
            if dsu.find(i) == dsu.find(j) {
                continue;
            }
            let endpoint_overlap = legs[i].endpoints.intersection(&legs[j].endpoints).next().is_some();
            if !endpoint_overlap {
                continue;
            }
            if time_gap_seconds(legs[i].start_dt, legs[i].end_dt, legs[j].start_dt, legs[j].end_dt)
                .unwrap_or(3)
                <= 2
            {
                dsu.union(i, j);
            }
        }
    }

    // 4) RTP SSRC continuity.
    for i in 0..legs.len() {
        for j in (i + 1)..legs.len() {
            if dsu.find(i) == dsu.find(j) {
                continue;
            }
            let ssrc_overlap = legs[i].rtp_ssrcs.intersection(&legs[j].rtp_ssrcs).next().is_some();
            if !ssrc_overlap {
                continue;
            }
            if time_gap_seconds(legs[i].start_dt, legs[i].end_dt, legs[j].start_dt, legs[j].end_dt)
                .unwrap_or(5)
                <= 5
            {
                dsu.union(i, j);
            }
        }
    }

    // 5) Fallback single-leg is implicit: each root stands alone if never linked.
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..legs.len() {
        let root = dsu.find(i);
        groups.entry(root).or_default().push(i);
    }
    let mut grouped: Vec<Vec<usize>> = groups.into_values().collect();
    for g in &mut grouped {
        g.sort_unstable();
    }
    grouped.sort_by(|a, b| {
        let a_first = a.first().copied().unwrap_or(usize::MAX);
        let b_first = b.first().copied().unwrap_or(usize::MAX);
        let a_time = legs.get(a_first).and_then(|l| l.start_dt);
        let b_time = legs.get(b_first).and_then(|l| l.start_dt);
        a_time
            .cmp(&b_time)
            .then_with(|| a_first.cmp(&b_first))
    });
    grouped
}

fn build_call_session_events(mut packet_meta: Vec<SipPacketMeta>) -> Vec<CallSessionEvent> {
    packet_meta.sort_by(|a, b| {
        a.timestamp_dt
            .cmp(&b.timestamp_dt)
            .then_with(|| a.packet_index.cmp(&b.packet_index))
    });
    let mut events: Vec<CallSessionEvent> = Vec::new();
    let mut event_counter: u64 = 0;
    let mut push_event = |event_type: &str, label: &str, meta: &SipPacketMeta, detail: Option<String>| {
        event_counter = event_counter.saturating_add(1);
        events.push(CallSessionEvent {
            id: format!("ev-{}-{}", meta.packet_index, event_counter),
            r#type: event_type.to_string(),
            event_type: event_type.to_string(),
            label: label.to_string(),
            timestamp: meta.timestamp.clone(),
            packet_index: Some(meta.packet_index),
            packet_indices: vec![meta.packet_index],
            call_id: Some(meta.call_id.clone()),
            dialog_index: None,
            message_index: None,
            media_ssrc: None,
            detail,
        });
    };
    for meta in packet_meta {
        if let Some(method) = &meta.method {
            match method.as_str() {
                "INVITE" => push_event("setup", "INVITE sent", &meta, Some("INVITE".to_string())),
                "REFER" => push_event("transferInitiated", "Transfer initiated", &meta, None),
                "BYE" => push_event("terminated", "Call terminated", &meta, Some("BYE".to_string())),
                "CANCEL" => push_event("terminated", "Call cancelled", &meta, Some("CANCEL".to_string())),
                "NOTIFY" => {
                    if let Some(sipfrag_code) = extract_notify_sipfrag_code(&meta.raw_upper) {
                        if (200..300).contains(&sipfrag_code) {
                            push_event(
                                "transferCompleted",
                                "Transfer completed",
                                &meta,
                                Some(format!("SIP {}", sipfrag_code)),
                            );
                        } else if sipfrag_code >= 400 {
                            push_event(
                                "transferFailed",
                                "Transfer failed",
                                &meta,
                                Some(format!("SIP {}", sipfrag_code)),
                            );
                        }
                    } else if meta.raw_upper.contains("SIPFRAG") && meta.raw_upper.contains("SIP/2.0 200") {
                        push_event("transferCompleted", "Transfer completed", &meta, None);
                    } else if meta.raw_upper.contains("SIP/2.0 4")
                        || meta.raw_upper.contains("SIP/2.0 5")
                        || meta.raw_upper.contains("SIP/2.0 6")
                    {
                        push_event("transferFailed", "Transfer failed", &meta, None);
                    }
                }
                _ => {}
            }
        }

        if meta.has_hold_sdp {
            push_event("hold", "Call held", &meta, None);
        }
        if meta.has_resume_sdp {
            push_event("resume", "Call resumed", &meta, None);
        }
        if !meta.linked_call_ids.is_empty() {
            push_event(
                "transferLinked",
                "Transfer linked",
                &meta,
                Some(meta.linked_call_ids.iter().cloned().collect::<Vec<_>>().join(",")),
            );
        }
        if let Some(code) = meta.response_code {
            match code {
                180 | 183 => push_event("ringing", "Ringing", &meta, Some(code.to_string())),
                200 if meta.cseq_method.as_deref() == Some("INVITE") => {
                    push_event("answered", "Call answered", &meta, Some("200".to_string()))
                }
                c if c >= 400 => {
                    push_event("anomaly", "SIP anomaly", &meta, Some(format!("SIP {}", c)));
                    if meta.cseq_method.as_deref() == Some("INVITE") {
                        push_event("terminated", "Call terminated", &meta, Some(format!("final {}", c)));
                    }
                }
                _ => {}
            }
        }
    }
    events.sort_by(|a, b| {
        parse_timestamp_utc(&a.timestamp)
            .cmp(&parse_timestamp_utc(&b.timestamp))
            .then_with(|| a.packet_indices.first().copied().unwrap_or(u64::MAX).cmp(&b.packet_indices.first().copied().unwrap_or(u64::MAX)))
            .then_with(|| a.event_type.cmp(&b.event_type))
    });
    events
}

fn build_call_session_disposition(packet_meta: &[SipPacketMeta]) -> String {
    let mut has_answered = false;
    let mut has_cancel = false;
    let mut has_bye = false;
    let mut has_busy = false;
    let mut has_no_answer = false;
    let mut has_failure = false;

    for meta in packet_meta {
        if let Some(method) = &meta.method {
            if method == "BYE" {
                has_bye = true;
            } else if method == "CANCEL" {
                has_cancel = true;
            }
        }
        if let Some(code) = meta.response_code {
            if code == 200 && meta.cseq_method.as_deref() == Some("INVITE") {
                has_answered = true;
            } else if code == 486 || code == 600 {
                has_busy = true;
            } else if code == 480 {
                has_no_answer = true;
            } else if code >= 400 {
                has_failure = true;
            }
        }
    }

    if has_answered {
        "answered".to_string()
    } else if has_cancel {
        "cancelled".to_string()
    } else if has_busy {
        "busy".to_string()
    } else if has_no_answer {
        "no-answer".to_string()
    } else if has_failure {
        "failed".to_string()
    } else if has_bye {
        "unknown".to_string()
    } else {
        "unknown".to_string()
    }
}

fn build_call_session_anomaly_flags(packet_meta: &[SipPacketMeta]) -> SessionAnomalyFlags {
    let has_error_response = packet_meta.iter().any(|m| m.response_code.unwrap_or(0) >= 400);
    let has_answered = packet_meta.iter().any(|m| {
        m.response_code == Some(200) && m.cseq_method.as_deref() == Some("INVITE")
    });
    let has_termination = packet_meta.iter().any(|m| {
        matches!(m.method.as_deref(), Some("BYE") | Some("CANCEL"))
    });
    let first_setup = packet_meta
        .iter()
        .find(|m| m.method.as_deref() == Some("INVITE"))
        .map(|m| m.packet_index);
    let first_answer = packet_meta
        .iter()
        .find(|m| m.response_code == Some(200) && m.cseq_method.as_deref() == Some("INVITE"))
        .map(|m| m.packet_index);
    let out_of_order_signaling = match (first_setup, first_answer) {
        (Some(setup), Some(answer)) => answer < setup,
        _ => false,
    };

    SessionAnomalyFlags {
        has_error_response,
        missing_termination: has_answered && !has_termination,
        out_of_order_signaling,
    }
}

fn build_call_session_anomalies(flags: &SessionAnomalyFlags) -> Vec<ReconstructedCallAnomaly> {
    let mut anomalies = Vec::new();
    if flags.has_error_response {
        anomalies.push(ReconstructedCallAnomaly {
            id: "sip-error-response".to_string(),
            code: "sip_error_response".to_string(),
            label: "SIP error response".to_string(),
            severity: "warning".to_string(),
        });
    }
    if flags.missing_termination {
        anomalies.push(ReconstructedCallAnomaly {
            id: "missing-termination".to_string(),
            code: "missing_termination".to_string(),
            label: "Missing termination signaling".to_string(),
            severity: "warning".to_string(),
        });
    }
    if flags.out_of_order_signaling {
        anomalies.push(ReconstructedCallAnomaly {
            id: "out-of-order-signaling".to_string(),
            code: "out_of_order_signaling".to_string(),
            label: "Out-of-order signaling".to_string(),
            severity: "critical".to_string(),
        });
    }
    anomalies
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_call_sessions(session_id: String) -> Result<Vec<CallSession>, String> {
    let packets = get_packets_for_session(&session_id, 50_000)?;
    let dialogs = get_sip_dialogs(session_id.clone())?;
    let rtp_streams = get_rtp_streams(session_id.clone())?;

    let packet_meta_by_index = build_sip_packet_meta(&packets);
    let mut legs = build_call_session_legs(&dialogs, &packet_meta_by_index);
    let packet_dialog_index = build_packet_dialog_message_index(&dialogs);
    attach_rtp_ssrcs_to_legs(&mut legs, &rtp_streams);

    let grouping_input: Vec<SessionLegForGrouping> = legs
        .iter()
        .map(|leg| SessionLegForGrouping {
            call_id: leg.call_id.clone(),
            start_dt: leg.start_dt,
            end_dt: leg.end_dt,
            endpoints: leg.endpoints.clone(),
            correlation_tokens: leg.correlation_tokens.clone(),
            linked_call_ids: leg.linked_call_ids.clone(),
            rtp_ssrcs: leg.rtp_ssrcs.clone(),
        })
        .collect();
    let groups = group_call_session_leg_indices(&grouping_input);

    let mut sessions: Vec<CallSession> = Vec::new();
    for (group_idx, leg_indices) in groups.iter().enumerate() {
        let mut parties: Vec<String> = Vec::new();
        let mut party_seen: HashSet<String> = HashSet::new();
        let mut packet_indices: Vec<u64> = Vec::new();
        let mut leg_refs: Vec<ReconstructedCallLegRef> = Vec::new();
        let mut start_dt: Option<chrono::DateTime<chrono::Utc>> = None;
        let mut end_dt: Option<chrono::DateTime<chrono::Utc>> = None;
        let mut start_time: Option<String> = None;
        let mut end_time: Option<String> = None;

        for (session_leg_index, leg_index) in leg_indices.iter().enumerate() {
            let Some(leg) = legs.get(*leg_index) else {
                continue;
            };
            packet_indices.extend(leg.packet_indices.iter().copied());
            leg_refs.push(ReconstructedCallLegRef {
                id: format!("leg-{:04}", session_leg_index + 1),
                dialog_index: Some(leg.dialog_index),
                call_id: Some(leg.call_id.clone()),
                from: leg.participants.first().cloned(),
                to: leg.participants.get(1).cloned(),
            });

            if let Some(dt) = leg.start_dt {
                if start_dt.map(|existing| dt < existing).unwrap_or(true) {
                    start_dt = Some(dt);
                    start_time = Some(leg.start_time.clone());
                }
            }
            if let Some(dt) = leg.end_dt {
                if end_dt.map(|existing| dt > existing).unwrap_or(true) {
                    end_dt = Some(dt);
                    end_time = leg.end_time.clone().or_else(|| Some(dt.to_rfc3339()));
                }
            }

            for party in &leg.participants {
                let norm = party.trim().to_string();
                if norm.is_empty() || !party_seen.insert(norm.clone()) {
                    continue;
                }
                parties.push(norm);
            }
        }

        packet_indices.sort_unstable();
        packet_indices.dedup();

        let mut session_packet_meta: Vec<SipPacketMeta> = packet_indices
            .iter()
            .filter_map(|idx| packet_meta_by_index.get(idx).cloned())
            .collect();
        session_packet_meta.sort_by_key(|m| m.packet_index);

        let mut events = build_call_session_events(session_packet_meta.clone());
        for event in &mut events {
            if let Some(packet_index) = event.packet_index {
                if let Some((dialog_index, message_index, dialog_call_id, _from_tag, _to_tag)) =
                    packet_dialog_index.get(&packet_index)
                {
                    if event
                        .call_id
                        .as_ref()
                        .map(|event_call_id| event_call_id == dialog_call_id)
                        .unwrap_or(true)
                    {
                        event.dialog_index = Some(*dialog_index);
                        event.message_index = Some(*message_index);
                    }
                }
            }
        }
        let duration_sec = match (start_dt, end_dt) {
            (Some(s), Some(e)) => (e - s).num_seconds().max(0) as u64,
            _ => 0u64,
        };
        let anomaly_flags = build_call_session_anomaly_flags(&session_packet_meta);
        let anomalies = build_call_session_anomalies(&anomaly_flags);
        let mut media_refs: Vec<ReconstructedCallMediaRef> = Vec::new();
        for stream in &rtp_streams {
            let belongs = leg_indices.iter().any(|leg_index| {
                legs.get(*leg_index)
                    .map(|leg| stream_matches_leg(stream, leg))
                    .unwrap_or(false)
            });
            if !belongs {
                continue;
            }
            media_refs.push(ReconstructedCallMediaRef {
                id: format!("rtp-{}", stream.ssrc),
                ssrc: Some(stream.ssrc),
                codec: Some(stream.codec_name.clone()),
                src_label: Some(format!("{}:{}", stream.src_ip, stream.src_port)),
                dst_label: Some(format!("{}:{}", stream.dst_ip, stream.dst_port)),
            });
        }
        media_refs.sort_by(|a, b| a.id.cmp(&b.id));
        media_refs.dedup_by(|a, b| a.id == b.id);
        sessions.push(CallSession {
            id: format!("session-{:04}", group_idx + 1),
            capture_session_id: session_id.clone(),
            parties,
            start_time: start_time.unwrap_or_default(),
            end_time,
            duration_sec: Some(duration_sec),
            disposition: build_call_session_disposition(&session_packet_meta),
            anomalies,
            events,
            legs: leg_refs,
            media_refs,
        });
    }

    sessions.sort_by(|a, b| {
        parse_timestamp_utc(&a.start_time)
            .cmp(&parse_timestamp_utc(&b.start_time))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(sessions)
}

fn extract_sip_message(packet: &PacketInfo) -> Option<ParsedSipMessage> {
    if let Some(decoded) = &packet.decoded {
        match &decoded.application {
            ApplicationLayer::Sip(sip) => return Some(sip.clone()),
            ApplicationLayer::SipOverWs { sip, .. } => return Some(sip.clone()),
            _ => {}
        }
    }
    if packet.protocol != Protocol::SIP && !Protocol::is_sip(&packet.data) {
        return None;
    }
    crate::packet_capture::sip_parser::parse_sip_message(&packet.data).ok()
}

fn collect_sip_messages_by_call_id(packets: &[PacketInfo]) -> BTreeMap<String, Vec<ParsedSipMessage>> {
    let mut map: BTreeMap<String, Vec<ParsedSipMessage>> = BTreeMap::new();
    for packet in packets {
        let Some(sip) = extract_sip_message(packet) else {
            continue;
        };
        let Some(call_id) = sip.call_id.clone().filter(|id| !id.trim().is_empty()) else {
            continue;
        };
        map.entry(call_id).or_default().push(sip);
    }
    map
}

fn collect_unique_values(values: impl Iterator<Item = String>) -> Vec<String> {
    let mut set = BTreeSet::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        set.insert(trimmed.to_string());
    }
    set.into_iter().collect()
}

fn header_values_from_messages(messages: &[ParsedSipMessage], key: &str) -> Vec<String> {
    collect_unique_values(
        messages
            .iter()
            .filter_map(|sip| sip.headers.get(key).cloned()),
    )
}

fn build_normalized_headers(messages: &[ParsedSipMessage]) -> NormalizedSipHeaders {
    NormalizedSipHeaders {
        from: collect_unique_values(messages.iter().filter_map(|sip| sip.from.clone())),
        to: collect_unique_values(messages.iter().filter_map(|sip| sip.to.clone())),
        contact: collect_unique_values(messages.iter().filter_map(|sip| sip.contact.clone())),
        via: collect_unique_values(
            messages
                .iter()
                .flat_map(|sip| sip.via.iter().cloned()),
        ),
        supported: header_values_from_messages(messages, "supported"),
        allow: header_values_from_messages(messages, "allow"),
        require: header_values_from_messages(messages, "require"),
        proxy_require: header_values_from_messages(messages, "proxy-require"),
        session_expires: header_values_from_messages(messages, "session-expires"),
        min_se: header_values_from_messages(messages, "min-se"),
    }
}

fn is_sdp_offer_message(sip: &ParsedSipMessage) -> bool {
    sip.method
        .as_deref()
        .map(|m| matches!(m.to_ascii_uppercase().as_str(), "INVITE" | "UPDATE" | "PRACK" | "ACK"))
        .unwrap_or(false)
}

fn is_sdp_answer_message(sip: &ParsedSipMessage) -> bool {
    sip.response_code.is_some()
}

fn build_codec_negotiation_summary(
    messages: &[ParsedSipMessage],
    sdp_codec_map: &HashMap<u8, String>,
) -> CodecNegotiationSummary {
    let mut offer_payload_types = BTreeSet::new();
    let mut answer_payload_types = BTreeSet::new();
    let mut offer_codecs = BTreeSet::new();
    let mut answer_codecs = BTreeSet::new();
    let mut payload_codec_map: BTreeMap<u8, String> = BTreeMap::new();

    for sip in messages {
        let Some(body) = &sip.body else {
            continue;
        };
        let Some(sdp) = &body.sdp else {
            continue;
        };

        let is_offer = is_sdp_offer_message(sip);
        let is_answer = is_sdp_answer_message(sip);
        for media in &sdp.media {
            if !media.media_type.eq_ignore_ascii_case("audio") {
                continue;
            }
            for payload_type in &media.payload_types {
                let codec_name = resolve_codec_name(*payload_type, sdp_codec_map);
                payload_codec_map.entry(*payload_type).or_insert_with(|| codec_name.clone());
                if is_offer {
                    offer_payload_types.insert(*payload_type);
                    offer_codecs.insert(codec_name.clone());
                }
                if is_answer {
                    answer_payload_types.insert(*payload_type);
                    answer_codecs.insert(codec_name);
                }
            }
        }
    }

    CodecNegotiationSummary {
        offer_payload_types: offer_payload_types.into_iter().collect(),
        answer_payload_types: answer_payload_types.into_iter().collect(),
        offer_codecs: offer_codecs.into_iter().collect(),
        answer_codecs: answer_codecs.into_iter().collect(),
        payload_codec_map,
    }
}

fn parse_response_code(method_or_code: &str) -> Option<u16> {
    if method_or_code.chars().all(|c| c.is_ascii_digit()) {
        return method_or_code.parse::<u16>().ok();
    }
    None
}

fn derive_setup_delay_ms(dialog: &SipDialog) -> Option<u64> {
    let invite_ts = dialog
        .messages
        .iter()
        .find(|m| m.method_or_code.eq_ignore_ascii_case("INVITE"))
        .and_then(|m| parse_timestamp_utc(&m.timestamp))?;

    let answer_ts = dialog
        .messages
        .iter()
        .filter_map(|m| {
            let code = parse_response_code(&m.method_or_code)?;
            if code < 180 {
                return None;
            }
            parse_timestamp_utc(&m.timestamp)
        })
        .min()?;

    let millis = (answer_ts - invite_ts).num_milliseconds();
    if millis < 0 {
        None
    } else {
        Some(millis as u64)
    }
}

fn derive_total_duration_ms(dialog: &SipDialog) -> Option<u64> {
    let start = parse_timestamp_utc(&dialog.start_time)?;
    let end = dialog
        .end_time
        .as_ref()
        .and_then(|ts| parse_timestamp_utc(ts))
        .unwrap_or(start);
    let millis = (end - start).num_milliseconds();
    if millis < 0 {
        None
    } else {
        Some(millis as u64)
    }
}

fn build_call_behavior_summaries(session_id: &str) -> Result<Vec<CallBehaviorSummary>, String> {
    let dialogs = get_sip_dialogs(session_id.to_string())?;
    let packets = get_session_packets_shared(session_id)?;
    let sdp_codec_map = crate::packet_capture::rtp_analyzer::extract_sdp_codec_map(packets.as_ref());
    let sip_messages_by_call = collect_sip_messages_by_call_id(packets.as_ref());

    let mut summaries = Vec::new();
    for (index, dialog) in dialogs.iter().enumerate() {
        let per_call_messages = sip_messages_by_call
            .get(&dialog.call_id)
            .cloned()
            .unwrap_or_default();
        let final_response_code = dialog
            .messages
            .iter()
            .rev()
            .find_map(|m| parse_response_code(&m.method_or_code));
        let participants = dialog.participants.clone().unwrap_or_default();

        summaries.push(CallBehaviorSummary {
            id: format!("call-{:04}", index + 1),
            call_id: dialog.call_id.clone(),
            participants,
            sip_sequence: dialog
                .messages
                .iter()
                .map(|m| m.method_or_code.clone())
                .collect(),
            final_response_code,
            headers: build_normalized_headers(&per_call_messages),
            codec: build_codec_negotiation_summary(&per_call_messages, &sdp_codec_map),
            setup_delay_ms: derive_setup_delay_ms(dialog),
            total_duration_ms: derive_total_duration_ms(dialog),
            start_time: Some(dialog.start_time.clone()),
            end_time: dialog.end_time.clone(),
        });
    }

    Ok(summaries)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn diff_call_behavior(
    before_session_id: String,
    after_session_id: String,
) -> Result<CallBehaviorDiffResult, String> {
    let before_calls = build_call_behavior_summaries(&before_session_id)?;
    let after_calls = build_call_behavior_summaries(&after_session_id)?;
    Ok(diff_call_behaviors(before_calls, after_calls))
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_expert_findings(
    session_id: String,
) -> Result<Vec<crate::packet_capture::ExpertFinding>, String> {
    use crate::packet_capture::expert_analyzer::{
        self, InputRtpStream, InputSipDialog, InputSipDialogMessage,
    };
    use crate::packet_capture::rtp_analyzer::{calculate_mos, resolve_codec_name, RtpStreamTracker};

    let packets = get_packets_for_session(&session_id, 50_000)?;

    let sdp_codec_map = crate::packet_capture::rtp_analyzer::extract_sdp_codec_map(&packets);
    let mut tracker = RtpStreamTracker::new();
    for p in &packets {
        let is_rtp = p.protocol == Protocol::RTP
            || matches!(
                p.decoded.as_ref().map(|d| &d.application),
                Some(crate::packet_capture::ApplicationLayer::Rtp(_))
            );
        if !is_rtp || p.data.len() < 12 {
            continue;
        }
        let _ = tracker.process_packet(
            p.src_ip, p.src_port, p.dst_ip, p.dst_port, p.timestamp, &p.data,
        );
    }
    let rtp_streams: Vec<InputRtpStream> = tracker
        .get_all_streams()
        .iter()
        .map(|s| {
            let loss_percentage = if s.packet_count > 0 {
                (s.lost_packets as f64 / s.packet_count as f64) * 100.0
            } else {
                0.0
            };
            let mos_score = calculate_mos(s.jitter, loss_percentage);
            InputRtpStream {
                ssrc: s.ssrc,
                src_ip: s.src_ip.to_string(),
                src_port: s.src_port,
                dst_ip: s.dst_ip.to_string(),
                dst_port: s.dst_port,
                codec_name: resolve_codec_name(s.payload_type, &sdp_codec_map),
                packet_count: s.packet_count,
                lost_packets: s.lost_packets,
                loss_percentage,
                jitter: s.jitter,
                mos_score,
                first_packet_time: s.first_packet_time.to_rfc3339(),
                last_packet_time: s.last_packet_time.to_rfc3339(),
            }
        })
        .collect();

    let mut dialog_map: BTreeMap<String, Vec<InputSipDialogMessage>> = BTreeMap::new();
    for (idx, p) in packets.iter().enumerate() {
        let sip = match p.decoded.as_ref().and_then(|d| match &d.application {
            ApplicationLayer::Sip(s) => Some(s),
            ApplicationLayer::SipOverWs { sip, .. } => Some(sip),
            _ => None,
        }) {
            Some(s) => s,
            None => continue,
        };
        let call_id = match sip.call_id.as_deref() {
            Some(c) if !c.is_empty() => c.to_string(),
            _ => continue,
        };
        let method_or_code = if let Some(m) = &sip.method {
            m.clone()
        } else if let Some(code) = sip.response_code {
            format!("{}", code)
        } else {
            continue;
        };
        dialog_map
            .entry(call_id)
            .or_default()
            .push(InputSipDialogMessage {
                method_or_code,
                cseq: sip.cseq.clone(),
                timestamp: p.timestamp.to_rfc3339(),
                packet_index: idx as u64,
            });
    }
    let dialogs: Vec<InputSipDialog> = dialog_map
        .into_iter()
        .map(|(call_id, mut msgs)| {
            msgs.sort_by_key(|m| m.packet_index);
            let start_time = msgs
                .first()
                .map(|m| m.timestamp.clone())
                .unwrap_or_default();
            let end_time = msgs.last().map(|m| m.timestamp.clone());
            InputSipDialog {
                call_id,
                messages: msgs,
                start_time,
                end_time,
            }
        })
        .collect();

    let findings = expert_analyzer::analyze(&packets, &dialogs, &rtp_streams);
    Ok(findings)
}

/// Export a PCAP containing only packets belonging to the given dialog (by index).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn export_dialog_pcap(session_id: String, dialog_index: u32) -> Result<String, String> {
    let dialogs = get_sip_dialogs(session_id.clone())?;
    let dialog = dialogs
        .get(dialog_index as usize)
        .ok_or_else(|| "Dialog index out of range".to_string())?;
    let indices: HashSet<u64> = dialog.messages.iter().map(|m| m.packet_index).collect();
    let packets = get_packets_for_session(&session_id, 50_000)?;
    let filtered: Vec<PacketInfo> = packets
        .into_iter()
        .enumerate()
        .filter(|(i, _)| indices.contains(&(*i as u64)))
        .map(|(_, p)| p)
        .collect();
    if filtered.is_empty() {
        return Err("No packets in dialog".to_string());
    }
    let config_dir = config::get_config_dir().map_err(|e| e.to_string())?;
    let support_dir = config_dir.join("captures").join("support_packages");
    std::fs::create_dir_all(&support_dir).map_err(|e| e.to_string())?;
    let call_snippet = dialog.call_id.chars().take(12).collect::<String>();
    let safe = call_snippet
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    let out_name = format!("dialog_{}.pcap", safe);
    let out_path = support_dir.join(&out_name);
    let mut writer = PcapWriter::new(&out_path).map_err(|e| e.to_string())?;
    for p in &filtered {
        writer.write_packet(p).map_err(|e| e.to_string())?;
    }
    Ok(out_path.to_string_lossy().to_string())
}

/// Export dialog PCAP and return contents as base64 for frontend download.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn export_dialog_pcap_base64(session_id: String, dialog_index: u32) -> Result<ExportDialogPcapResult, String> {
    use base64::prelude::Engine as _;
    let path = export_dialog_pcap(session_id, dialog_index)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let base64 = base64::prelude::BASE64_STANDARD.encode(&bytes);
    let filename = path
        .rsplit(std::path::MAIN_SEPARATOR)
        .next()
        .unwrap_or("dialog.pcap")
        .to_string();
    let _ = std::fs::remove_file(&path);
    Ok(ExportDialogPcapResult { filename, base64 })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDialogPcapResult {
    pub filename: String,
    pub base64: String,
}

/// Export dialog PCAP and show system save dialog; write to chosen path and return it.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn export_dialog_pcap_save(session_id: String, dialog_index: u32) -> Result<String, String> {
    let temp_path = export_dialog_pcap(session_id, dialog_index)?;
    let default_name = std::path::Path::new(&temp_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dialog.pcap")
        .to_string();
    let chosen = rfd::AsyncFileDialog::new()
        .set_title("Save Dialog PCAP")
        .set_file_name(&default_name)
        .add_filter("PCAP files", &["pcap"])
        .save_file()
        .await;
    let chosen_path = match chosen {
        Some(handle) => handle.path().to_path_buf(),
        None => {
            let _ = std::fs::remove_file(&temp_path);
            return Err("File save dialog was cancelled".to_string());
        }
    };
    std::fs::copy(&temp_path, &chosen_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&temp_path);
    Ok(chosen_path.to_string_lossy().to_string())
}

/// Show system save dialog and write content (base64) to chosen path. Used for CSV, JSON, HTML, PNG exports.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn save_export_file(
    default_name: String,
    content_base64: String,
    filter_name: String,
    extension: String,
) -> Result<String, String> {
    use base64::prelude::Engine as _;
    let bytes = base64::prelude::BASE64_STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    let ext = extension.trim_start_matches('.');
    let chosen = rfd::AsyncFileDialog::new()
        .set_title("Save Export File")
        .set_file_name(&default_name)
        .add_filter(&filter_name, &[ext])
        .save_file()
        .await;
    let path = match chosen {
        Some(handle) => handle.path().to_path_buf(),
        None => return Err("File save dialog was cancelled".to_string()),
    };
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Generate a call quality report for a SIP dialog.
/// Returns HTML content as base64.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn generate_call_quality_report(
    session_id: String,
    dialog_index: u32,
    format: String,
) -> Result<CallQualityReportResult, String> {
    use base64::prelude::Engine as _;
    
    // Get the SIP dialog
    let dialogs = get_sip_dialogs(session_id.clone())?;
    let dialog = dialogs
        .get(dialog_index as usize)
        .ok_or_else(|| "Dialog index out of range".to_string())?;
    
    // Get RTP streams for the session
    let rtp_streams = get_rtp_streams(session_id.clone())?;
    
    // Get RTP stream histories for quality metrics
    let rtp_histories = get_all_rtp_stream_histories(session_id.clone())?;
    
    // Calculate call duration
    let start_time = &dialog.start_time;
    let end_time = dialog.end_time.as_ref().unwrap_or(start_time);
    let duration_secs = {
        let start = chrono::DateTime::parse_from_rfc3339(start_time).ok();
        let end = chrono::DateTime::parse_from_rfc3339(end_time).ok();
        match (start, end) {
            (Some(s), Some(e)) => (e - s).num_seconds().max(0) as u64,
            _ => 0,
        }
    };
    
    // Build report data
    let participants = dialog.participants.clone().unwrap_or_else(|| vec!["Unknown".to_string()]);
    
    // Find issues based on RTP quality
    let mut issues: Vec<String> = Vec::new();
    for stream in &rtp_streams {
        if stream.loss_percentage > 3.0 {
            issues.push(format!(
                "High packet loss ({:.1}%) on stream SSRC 0x{:08x}",
                stream.loss_percentage, stream.ssrc
            ));
        }
        if stream.jitter > 30.0 {
            issues.push(format!(
                "High jitter ({:.1} ms) on stream SSRC 0x{:08x}",
                stream.jitter, stream.ssrc
            ));
        }
        if stream.mos_score < 3.5 {
            issues.push(format!(
                "Poor MOS score ({:.2}) on stream SSRC 0x{:08x}",
                stream.mos_score, stream.ssrc
            ));
        }
    }
    
    // Generate HTML report
    let html = generate_call_quality_html(
        &dialog,
        &participants,
        duration_secs,
        &rtp_streams,
        &rtp_histories,
        &issues,
    );
    
    let content_base64 = base64::prelude::BASE64_STANDARD.encode(html.as_bytes());
    let call_snippet = dialog.call_id.chars().take(12).collect::<String>();
    let safe_name = call_snippet
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    let filename = format!("call_quality_report_{}.html", safe_name);
    
    Ok(CallQualityReportResult {
        filename,
        content_base64,
        format,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallQualityReportResult {
    pub filename: String,
    pub content_base64: String,
    pub format: String,
}

fn generate_call_quality_html(
    dialog: &SipDialog,
    participants: &[String],
    duration_secs: u64,
    rtp_streams: &[RtpStreamInfo],
    _rtp_histories: &[crate::packet_capture::rtp_analyzer::RtpStreamHistory],
    issues: &[String],
) -> String {
    let duration_display = if duration_secs >= 60 {
        format!("{}m {}s", duration_secs / 60, duration_secs % 60)
    } else {
        format!("{}s", duration_secs)
    };
    
    // Calculate overall quality metrics
    let avg_mos = if rtp_streams.is_empty() {
        0.0
    } else {
        rtp_streams.iter().map(|s| s.mos_score).sum::<f64>() / rtp_streams.len() as f64
    };
    
    let total_packets: u64 = rtp_streams.iter().map(|s| s.packet_count).sum();
    let total_lost: u32 = rtp_streams.iter().map(|s| s.lost_packets).sum();
    let overall_loss = if total_packets > 0 {
        (total_lost as f64 / total_packets as f64) * 100.0
    } else {
        0.0
    };
    
    let avg_jitter = if rtp_streams.is_empty() {
        0.0
    } else {
        rtp_streams.iter().map(|s| s.jitter).sum::<f64>() / rtp_streams.len() as f64
    };
    
    let quality_class = if avg_mos >= 4.0 { "quality-good" } else if avg_mos >= 3.5 { "quality-fair" } else { "quality-poor" };
    let quality_label = if avg_mos >= 4.0 { "Good" } else if avg_mos >= 3.5 { "Fair" } else { "Poor" };
    
    let mut html = format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Call Quality Report - {}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #0a0a0a; color: #e5e5e5; }}
        .container {{ max-width: 1200px; margin: 0 auto; }}
        h1 {{ color: #fff; border-bottom: 2px solid #333; padding-bottom: 10px; }}
        h2 {{ color: #fff; margin-top: 30px; }}
        .header-meta {{ color: #999; margin-bottom: 20px; }}
        .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin: 20px 0; }}
        .metric-card {{ background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 15px; }}
        .metric-label {{ color: #999; font-size: 0.85em; }}
        .metric-value {{ color: #fff; font-size: 1.4em; font-weight: bold; margin-top: 5px; }}
        .quality-good {{ color: #22c55e; }}
        .quality-fair {{ color: #eab308; }}
        .quality-poor {{ color: #ef4444; }}
        .section-card {{ background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 15px; margin: 15px 0; }}
        .stream-grid {{ display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }}
        .stream-item {{ display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222; }}
        .stream-item:last-child {{ border-bottom: none; }}
        .stream-label {{ color: #999; }}
        .stream-value {{ color: #fff; font-family: monospace; }}
        .issue-item {{ background: #2a1a1a; border: 1px solid #442222; border-radius: 6px; padding: 10px 15px; margin: 8px 0; color: #f87171; }}
        .sip-flow {{ margin: 15px 0; }}
        .sip-message {{ display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #222; }}
        .sip-time {{ color: #666; font-size: 0.8em; width: 90px; font-family: monospace; }}
        .sip-method {{ padding: 3px 10px; border-radius: 4px; font-size: 0.85em; font-weight: 600; }}
        .sip-request {{ background: #1e3a5f; color: #60a5fa; }}
        .sip-response {{ background: #1a2e1a; color: #4ade80; }}
        .sip-error {{ background: #3b1414; color: #f87171; }}
        .participants {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }}
        .participant-tag {{ background: #333; border-radius: 15px; padding: 4px 12px; font-size: 0.85em; }}
        .footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #666; text-align: center; font-size: 0.85em; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Call Quality Report</h1>
        <div class="header-meta">
            <p><strong>Call ID:</strong> <code>{}</code></p>
            <p><strong>Generated:</strong> {}</p>
        </div>
        
        <h2>Overview</h2>
        <div class="metrics">
            <div class="metric-card">
                <div class="metric-label">Duration</div>
                <div class="metric-value">{}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Overall Quality</div>
                <div class="metric-value {}"><span style="font-size:0.7em">(MOS {:.2})</span> {}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Packet Loss</div>
                <div class="metric-value">{:.2}%</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Avg Jitter</div>
                <div class="metric-value">{:.1} ms</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">RTP Streams</div>
                <div class="metric-value">{}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">SIP Messages</div>
                <div class="metric-value">{}</div>
            </div>
        </div>
        
        <h2>Participants</h2>
        <div class="participants">"#,
        dialog.call_id.chars().take(20).collect::<String>(),
        dialog.call_id,
        chrono::Utc::now().to_rfc3339(),
        duration_display,
        quality_class, avg_mos, quality_label,
        overall_loss,
        avg_jitter,
        rtp_streams.len(),
        dialog.messages.len(),
    );
    
    for p in participants {
        html.push_str(&format!(r#"<span class="participant-tag">{}</span>"#, 
            html_escape(p)));
    }
    html.push_str("</div>");
    
    // Issues section
    if !issues.is_empty() {
        html.push_str(r#"<h2>Issues Detected</h2>"#);
        for issue in issues {
            html.push_str(&format!(r#"<div class="issue-item">{}</div>"#, html_escape(issue)));
        }
    }
    
    // RTP Streams section
    if !rtp_streams.is_empty() {
        html.push_str(r#"<h2>RTP Streams</h2>"#);
        for stream in rtp_streams {
            let mos_class = if stream.mos_score >= 4.0 { "quality-good" } else if stream.mos_score >= 3.5 { "quality-fair" } else { "quality-poor" };
            html.push_str(&format!(r#"
            <div class="section-card">
                <h3 style="margin-top:0">SSRC: 0x{:08X} - {}</h3>
                <div class="stream-grid">
                    <div class="stream-item"><span class="stream-label">Source</span><span class="stream-value">{}:{}</span></div>
                    <div class="stream-item"><span class="stream-label">Destination</span><span class="stream-value">{}:{}</span></div>
                    <div class="stream-item"><span class="stream-label">Packets</span><span class="stream-value">{}</span></div>
                    <div class="stream-item"><span class="stream-label">Lost</span><span class="stream-value">{} ({:.2}%)</span></div>
                    <div class="stream-item"><span class="stream-label">Jitter</span><span class="stream-value">{:.2} ms</span></div>
                    <div class="stream-item"><span class="stream-label">MOS Score</span><span class="stream-value {}">{:.2}</span></div>
                </div>
            </div>"#,
                stream.ssrc, stream.codec_name,
                stream.src_ip, stream.src_port,
                stream.dst_ip, stream.dst_port,
                stream.packet_count,
                stream.lost_packets, stream.loss_percentage,
                stream.jitter,
                mos_class, stream.mos_score,
            ));
        }
    }
    
    // SIP Flow section
    html.push_str(r#"<h2>SIP Message Flow</h2><div class="section-card"><div class="sip-flow">"#);
    for msg in &dialog.messages {
        let is_response = msg.method_or_code.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false);
        let code_num: Option<u16> = if is_response { msg.method_or_code.split_whitespace().next().and_then(|s| s.parse().ok()) } else { None };
        let msg_class = if is_response {
            if code_num.map(|c| c >= 400).unwrap_or(false) { "sip-error" } else { "sip-response" }
        } else { "sip-request" };
        
        let time_display = msg.timestamp.split('T').nth(1).unwrap_or(&msg.timestamp).chars().take(12).collect::<String>();
        
        html.push_str(&format!(r#"
            <div class="sip-message">
                <span class="sip-time">{}</span>
                <span class="sip-method {}">{}</span>
            </div>"#,
            time_display, msg_class, html_escape(&msg.method_or_code),
        ));
    }
    html.push_str("</div></div>");
    
    html.push_str(r#"
        <div class="footer">
            <p>Generated by VoIP Toolset - Call Quality Report</p>
        </div>
    </div>
</body>
</html>"#);
    
    html
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Return the raw SIP message (full text) for a packet in a capture session.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_sip_message_raw(session_id: String, packet_index: u64) -> Result<String, String> {
    let packets = get_packets_for_session(&session_id, 50_000)?;
    let idx = packet_index as usize;
    let p = packets.get(idx).ok_or_else(|| "Packet index out of range".to_string())?;
    match &p.decoded {
        Some(d) => match &d.application {
            ApplicationLayer::Sip(sip) => Ok(sip.raw_message.clone()),
            _ => Err("Packet is not SIP".to_string()),
        },
        None => {
            if p.protocol != Protocol::SIP {
                return Err("Packet is not SIP".to_string());
            }
            String::from_utf8(p.data.clone()).map_err(|e| format!("Invalid UTF-8: {}", e))
        }
    }
}

fn get_capture_file_path(session_id: &str) -> Result<String, String> {
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT file_path FROM capture_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| row.get(0),
    )
    .map_err(|e| format!("Session not found: {}", e))
}

fn get_or_build_raw_pcap_index(
    session_id: &str,
    file_path: &str,
) -> Result<(Arc<MmapPcapReader>, Arc<Vec<(usize, usize)>>), String> {
    {
        let cache = RAW_PCAP_INDEX_CACHE.lock().map_err(|_| "Failed to lock raw pcap cache")?;
        if let Some(entry) = cache.get(session_id) {
            if entry.file_path == file_path && entry.loaded_at.elapsed().as_secs() < PCAP_CACHE_TTL_SECS {
                return Ok((Arc::clone(&entry.reader), Arc::clone(&entry.packet_data_index)));
            }
        }
    }

    let mut reader =
        MmapPcapReader::open(file_path).map_err(|e| format!("Failed to mmap pcap file: {}", e))?;

    let packet_data_index = Arc::new(
        reader
            .build_index()
            .into_iter()
            .map(|(header_offset, header)| (header_offset + 16, header.caplen as usize))
            .collect::<Vec<_>>(),
    );
    let reader = Arc::new(reader);

    {
        let mut cache = RAW_PCAP_INDEX_CACHE.lock().map_err(|_| "Failed to lock raw pcap cache")?;
        cache.insert(
            session_id.to_string(),
            RawPcapIndexCacheEntry {
                loaded_at: Instant::now(),
                file_path: file_path.to_string(),
                reader: Arc::clone(&reader),
                packet_data_index: Arc::clone(&packet_data_index),
            },
        );
    }

    Ok((reader, packet_data_index))
}

fn read_raw_packet_from_pcap_by_index(
    session_id: &str,
    file_path: &str,
    packet_index: usize,
) -> Result<(Vec<u8>, &'static str), String> {
    // Best-effort fast path: mmap + prebuilt packet offset index.
    if let Ok((reader, packet_data_index)) = get_or_build_raw_pcap_index(session_id, file_path) {
        let (offset, length) = packet_data_index
            .get(packet_index)
            .copied()
            .ok_or_else(|| "Packet index out of range".to_string())?;
        let raw = reader
            .read_packet_data(offset, length)
            .map_err(|e| format!("Failed to read packet data: {}", e))?;
        return Ok((raw.to_vec(), "pcap_indexed"));
    }

    // Fidelity-preserving fallback path.
    let mut cap = Capture::from_file(file_path)
        .map_err(|e| format!("Failed to open pcap file: {}", e))?;
    let mut current = 0usize;
    while let Ok(packet) = cap.next_packet() {
        if current == packet_index {
            return Ok((packet.data.to_vec(), "pcap_scan_fallback"));
        }
        current += 1;
    }
    Err("Packet index out of range".to_string())
}

/// Return authoritative raw bytes for a packet in a capture session.
///
/// Preference order:
/// 1) In-memory full frame bytes (`raw_frame`) when available.
/// 2) Read from capture file by packet index (mmap/index fast path + scan fallback).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_packet_raw_bytes(session_id: String, packet_index: u64) -> Result<Vec<u8>, String> {
    let idx = usize::try_from(packet_index).map_err(|_| "Packet index too large".to_string())?;
    let cache_key = format!("{}:{}", session_id, idx);

    // Fast path: bounded LRU cache for recently reviewed packets.
    {
        let mut cache = RAW_PACKET_BYTES_CACHE
            .lock()
            .map_err(|_| "Failed to lock raw packet bytes cache".to_string())?;
        if let Some(bytes) = cache.get(&cache_key) {
            return Ok(bytes);
        }
    }

    // Session in memory: try raw_frame first.
    let (session_found, packet_opt, session_file_path) = {
        let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        if let Some(entry) = sessions.get(&session_id) {
            let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
            let packet = session.get_packets_range(idx, 1).into_iter().next();
            (true, packet, session.file_path.clone())
        } else {
            (false, None, None)
        }
    };

    if session_found {
        if let Some(packet) = packet_opt {
            if let Some(raw_frame) = packet.raw_frame {
                if !raw_frame.is_empty() {
                    if let Ok(mut cache) = RAW_PACKET_BYTES_CACHE.lock() {
                        cache.insert(cache_key, raw_frame.clone());
                    }
                    return Ok(raw_frame);
                }
            }
        }

        if let Some(file_path) = session_file_path {
            let (raw, _source) = read_raw_packet_from_pcap_by_index(&session_id, &file_path, idx)?;
            if let Ok(mut cache) = RAW_PACKET_BYTES_CACHE.lock() {
                cache.insert(cache_key, raw.clone());
            }
            return Ok(raw);
        }

        return Err("Packet raw bytes unavailable: session has no capture file".to_string());
    }

    // Session not in memory: read from persisted capture file.
    let file_path = get_capture_file_path(&session_id)?;
    let (raw, _source) = read_raw_packet_from_pcap_by_index(&session_id, &file_path, idx)?;
    if let Ok(mut cache) = RAW_PACKET_BYTES_CACHE.lock() {
        cache.insert(cache_key, raw.clone());
    }
    Ok(raw)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn create_support_package(
    session_id: String,
    summary: String,
    call_id: Option<String>,
) -> Result<String, String> {
    fn sanitize_support_text(input: &str, max_len: usize) -> String {
        let mut out = String::with_capacity(input.len().min(max_len));
        for ch in input.chars() {
            if out.len() >= max_len {
                break;
            }
            if ch == '\n' || ch == '\r' || ch == '\t' || !ch.is_control() {
                out.push(ch);
            }
        }
        out
    }

    fn mask_identifier(id: &str) -> String {
        let chars: Vec<char> = id.chars().collect();
        if chars.len() <= 8 {
            return "***".to_string();
        }
        let head: String = chars.iter().take(4).collect();
        let mut tail_chars: Vec<char> = chars.iter().rev().take(4).copied().collect();
        tail_chars.reverse();
        let tail: String = tail_chars.into_iter().collect();
        format!("{head}***{tail}")
    }

    fn env_flag_enabled(key: &str) -> bool {
        matches!(
            std::env::var(key),
            Ok(value) if value == "1" || value.eq_ignore_ascii_case("true")
        )
    }

    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let (file_path, name): (String, String) = conn.query_row(
        "SELECT file_path, name FROM capture_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;

    let config_dir = config::get_config_dir().map_err(|e| e.to_string())?;
    let support_dir = config_dir.join("captures").join("support_packages");
    std::fs::create_dir_all(&support_dir).map_err(|e| e.to_string())?;

    let package_id = Uuid::new_v4().to_string();
    let package_dir = support_dir.join(&package_id);
    std::fs::create_dir_all(&package_dir).map_err(|e| e.to_string())?;

    let pcap_dest = package_dir.join("capture.pcap");
    std::fs::copy(&file_path, &pcap_dest).map_err(|e| format!("Failed to copy pcap: {}", e))?;

    let include_raw_ids = env_flag_enabled("SIPALYZER_SUPPORT_PACKAGE_INCLUDE_IDS");
    let summary_clean = sanitize_support_text(&summary, 8192);

    let mut summary_content = format!(
        "Support package: {}\nSession: {} ({})\nCreated: {}\n\n",
        package_id,
        name,
        if include_raw_ids { session_id.clone() } else { mask_identifier(&session_id) },
        chrono::Utc::now().to_rfc3339(),
    );
    if let Some(cid) = &call_id {
        let shown = if include_raw_ids { cid.clone() } else { mask_identifier(cid) };
        summary_content.push_str(&format!("Call-ID: {}\n", shown));
    }
    summary_content.push_str("\n--- Summary ---\n");
    summary_content.push_str(&summary_clean);
    summary_content.push_str("\n\n--- Data Handling ---\n");
    summary_content.push_str("This package may include sensitive signaling/media metadata.\n");
    summary_content.push_str("Share only with authorized support personnel.\n");

    let summary_path = package_dir.join("summary.txt");
    std::fs::write(&summary_path, summary_content).map_err(|e| e.to_string())?;

    Ok(package_dir.to_string_lossy().to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn load_capture_session(session_id: String, limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    // Get file path and filter_config (for rtp_port_range) from database
    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let (file_path, rtp_port_range): (String, Option<(u16, u16)>) = conn.query_row(
        "SELECT file_path, filter_config FROM capture_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| {
            let path: String = row.get(0)?;
            let filter_config_json: String = row.get(1)?;
            let rtp_port_range = serde_json::from_str::<FilterConfig>(&filter_config_json)
                .ok()
                .and_then(|fc| fc.rtp_port_range);
            Ok((path, rtp_port_range))
        },
    ).map_err(|e| e.to_string())?;

    // Read packets from pcap file using pcap::Capture
    let mut cap = Capture::from_file(&file_path)
        .map_err(|e| format!("Failed to open pcap file: {}", e))?;
    
    // Get link layer type from the capture (convert i32 to u32)
    let link_layer_type = cap.get_datalink().0 as u32;
    let parser = PacketParser::with_rtp_port_range(link_layer_type, rtp_port_range);
    let mut packets = Vec::new();
    let limit = limit.unwrap_or(2000);
    let mut packet_count = 0u64;

    while let Ok(packet) = cap.next_packet() {
        if packet_count >= limit as u64 {
            break;
        }

        if let Some(packet_info) = parser.parse(&packet, Some(packet_count)) {
            packets.push(packet_info_to_json(&packet_info));
            packet_count += 1;
        }
    }

    Ok(packets)
}

// ============================================================================
// Remote SSH capture commands
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCaptureConfigPayload {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub remote_interface: String,
    pub capture_filter: Option<String>,
    pub use_sudo: bool,
    pub sudo_password: Option<String>,
    pub session_name: Option<String>,
    pub packet_limit: Option<u64>,
    pub duration_seconds: Option<u64>,
}

impl From<RemoteCaptureConfigPayload> for crate::packet_capture::remote_capture::RemoteCaptureConfig {
    fn from(p: RemoteCaptureConfigPayload) -> Self {
        use crate::packet_capture::remote_capture::SshAuthMethod;
        let auth_method = match p.auth_method.as_str() {
            "keyFile" | "key" => SshAuthMethod::KeyFile,
            "agent" => SshAuthMethod::Agent,
            _ => SshAuthMethod::Password,
        };
        Self {
            host: p.host,
            port: p.port,
            username: p.username,
            auth_method,
            password: p.password,
            key_path: p.key_path,
            remote_interface: p.remote_interface,
            capture_filter: p.capture_filter,
            use_sudo: p.use_sudo,
            sudo_password: p.sudo_password,
            session_name: p.session_name,
            packet_limit: p.packet_limit,
            duration_seconds: p.duration_seconds,
        }
    }
}

/// Test SSH connection with the given credentials.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn test_ssh_connection(
    host: String,
    port: u16,
    username: String,
    auth_method: String,
    password: Option<String>,
    key_path: Option<String>,
) -> Result<bool, String> {
    use crate::packet_capture::remote_capture;
    let method = match auth_method.as_str() {
        "keyFile" | "key" => remote_capture::SshAuthMethod::KeyFile,
        "agent" => remote_capture::SshAuthMethod::Agent,
        _ => remote_capture::SshAuthMethod::Password,
    };
    remote_capture::test_ssh_connection(
        &host,
        port,
        &username,
        &method,
        password.as_deref(),
        key_path.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

/// List network interfaces on the remote host via SSH.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn list_remote_interfaces(
    host: String,
    port: u16,
    username: String,
    auth_method: String,
    password: Option<String>,
    key_path: Option<String>,
) -> Result<Vec<String>, String> {
    use crate::packet_capture::remote_capture;
    let method = match auth_method.as_str() {
        "keyFile" | "key" => remote_capture::SshAuthMethod::KeyFile,
        "agent" => remote_capture::SshAuthMethod::Agent,
        _ => remote_capture::SshAuthMethod::Password,
    };
    remote_capture::list_remote_interfaces(
        &host,
        port,
        &username,
        &method,
        password.as_deref(),
        key_path.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

/// Start a remote SSH packet capture session. Returns the session ID.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn start_remote_capture(
    app: tauri::AppHandle,
    config: RemoteCaptureConfigPayload,
) -> Result<String, String> {
    use crate::packet_capture::remote_capture;
    let cfg: remote_capture::RemoteCaptureConfig = config.into();
    remote_capture::start_remote_capture(cfg, app)
        .await
        .map_err(|e| e.to_string())
}

/// Stop a running remote capture session.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn stop_remote_capture(session_id: String) -> Result<(), String> {
    use crate::packet_capture::remote_capture;
    remote_capture::stop_remote_capture(&session_id).map_err(|e| e.to_string())
}

/// Get list of active remote capture session IDs.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_active_remote_sessions() -> Vec<String> {
    crate::packet_capture::remote_capture::active_remote_session_ids()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCapabilityReport {
    pub platform: String,
    pub local_capture_supported: bool,
    pub local_capture_reason: Option<String>,
    pub remote_capture_supported: bool,
    pub remote_capture_reason: Option<String>,
    pub remote_capture_notes: Vec<String>,
    pub strict_mode_enabled: bool,
    pub local_capture_enabled: bool,
    pub local_capture_probe_succeeded: bool,
    pub local_capture_probe_reason: Option<String>,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_capture_capabilities() -> CaptureCapabilityReport {
    let platform = std::env::consts::OS.to_string();
    let strict_mode_enabled = packet_capture_strict_mode_enabled();
    let local_capture_enabled = local_capture_allowed();

    let local_capture_probe = pcap::Device::list();
    let (local_capture_probe_succeeded, local_capture_probe_reason) = match local_capture_probe {
        Ok(devices) if !devices.is_empty() => (true, None),
        Ok(_) => (
            false,
            Some(
                "No packet capture interfaces detected. This host may be missing capture privileges/drivers."
                    .to_string(),
            ),
        ),
        Err(err) => (
            false,
            Some(format!("Local capture probe failed: {}", err)),
        ),
    };

    let (local_capture_supported, local_capture_reason) = if !local_capture_enabled {
        let mode = if strict_mode_enabled {
            "strict mode"
        } else {
            "configuration"
        };
        (
            false,
            Some(format!(
                "Local packet capture is disabled by {}. Set {}=true to explicitly enable local capture.",
                mode, PACKET_CAPTURE_ENABLE_LOCAL_ENV
            )),
        )
    } else if local_capture_probe_succeeded {
        (true, None)
    } else {
        (
            false,
            local_capture_probe_reason.clone(),
        )
    };

    let remote_capture_supported = true;
    let remote_capture_reason = None;
    let remote_capture_notes = vec![
        "Remote SSH capture currently supports Unix-like remote hosts only.".to_string(),
        "Remote host must provide tcpdump in PATH.".to_string(),
    ];

    CaptureCapabilityReport {
        platform,
        local_capture_supported,
        local_capture_reason,
        remote_capture_supported,
        remote_capture_reason,
        remote_capture_notes,
        strict_mode_enabled,
        local_capture_enabled,
        local_capture_probe_succeeded,
        local_capture_probe_reason,
    }
}

// ── Feature 7: RTP Audio Playback ──

/// Decode an RTP stream's audio and return as base64-encoded WAV.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn rtp_stream_decode_audio(
    session_id: String,
    ssrc: u32,
) -> Result<serde_json::Value, String> {
    let packets = get_packets_for_session(&session_id, 500_000)?;
    let (audio_samples, _first_ts, _label, packet_count) = decode_ssrc_audio(&packets, ssrc)?;

    if audio_samples.is_empty() {
        return Err(format!(
            "No RTP audio data found for SSRC {} ({} packets scanned)",
            ssrc,
            packets.len()
        ));
    }

    let wav_data = encode_wav(&audio_samples, 8000);
    let wav_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &wav_data);
    let duration_sec = audio_samples.len() as f64 / 8000.0;

    Ok(serde_json::json!({
        "wavBase64": wav_b64,
        "durationSec": duration_sec,
        "packetCount": packet_count,
    }))
}

/// A single decoded RTP frame (one packet's worth of audio).
struct DecodedRtpFrame {
    rtp_timestamp: u32,
    capture_time: chrono::DateTime<chrono::Utc>,
    samples: Vec<i16>,
    src_ip: String,
    src_port: u16,
    dst_ip: String,
    dst_port: u16,
}

/// Helper: decode all RTP audio samples for a given SSRC.
///
/// Returns (samples, first_packet_capture_time, endpoint_label, packet_count).
/// Handles RTP packet reordering, duplicate detection, gap filling, and padding.
fn decode_ssrc_audio(
    packets: &[PacketInfo],
    ssrc: u32,
) -> Result<(Vec<i16>, Option<chrono::DateTime<chrono::Utc>>, String, u32), String> {
    let mut frames: Vec<DecodedRtpFrame> = Vec::new();

    for pkt in packets.iter() {
        if let Some(ref decoded) = pkt.decoded {
            if let ApplicationLayer::Rtp(rtp_header) = &decoded.application {
                if rtp_header.ssrc == ssrc {
                    let raw_data = &pkt.data;
                    // RTP header: 12 bytes fixed + CSRC list + extension block.
                    // extension_length already includes the 4-byte extension header
                    // (profile + length fields), so no extra +4 needed.
                    let header_size = 12
                        + (rtp_header.csrc_count as usize * 4)
                        + rtp_header
                            .extension_length
                            .map(|l| l as usize)
                            .unwrap_or(0);

                    if raw_data.len() > header_size {
                        let mut payload_end = raw_data.len();

                        // Strip RTP padding if present (RFC 3550 §5.1)
                        if rtp_header.padding && raw_data.len() > header_size {
                            let padding_len = raw_data[raw_data.len() - 1] as usize;
                            if padding_len > 0
                                && padding_len <= (raw_data.len() - header_size)
                            {
                                payload_end -= padding_len;
                            }
                        }

                        let audio_payload = &raw_data[header_size..payload_end];
                        let mut samples = Vec::with_capacity(audio_payload.len());

                        match rtp_header.payload_type {
                            0 => {
                                for &byte in audio_payload {
                                    samples.push(ulaw_to_linear(byte));
                                }
                            }
                            8 => {
                                for &byte in audio_payload {
                                    samples.push(alaw_to_linear(byte));
                                }
                            }
                            _ => {
                                // Unsupported codec — silence placeholder
                                samples.resize(audio_payload.len(), 0);
                            }
                        }

                        frames.push(DecodedRtpFrame {
                            rtp_timestamp: rtp_header.timestamp,
                            capture_time: pkt.timestamp,
                            samples,
                            src_ip: pkt.src_ip.to_string(),
                            src_port: pkt.src_port,
                            dst_ip: pkt.dst_ip.to_string(),
                            dst_port: pkt.dst_port,
                        });
                    }
                }
            }
        }
    }

    if frames.is_empty() {
        return Ok((Vec::new(), None, String::new(), 0));
    }

    let packet_count = frames.len() as u32;

    // Use the frame with the earliest capture time as reference for:
    // 1. The base RTP timestamp (position 0 in the output)
    // 2. The first_capture_time (used by combined player for stereo alignment)
    // This handles the common case correctly and is robust against network reordering.
    let earliest_capture_idx = frames
        .iter()
        .enumerate()
        .min_by_key(|(_, f)| f.capture_time)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let ref_frame = &frames[earliest_capture_idx];
    let base_ts = ref_frame.rtp_timestamp;
    let first_capture_time = Some(ref_frame.capture_time);
    let label = format!(
        "{}:{} -> {}:{}",
        ref_frame.src_ip, ref_frame.src_port, ref_frame.dst_ip, ref_frame.dst_port
    );

    // Sort by RTP timestamp relative to the reference (wrapping-safe).
    // This correctly orders packets even when the random RTP timestamp
    // starts near u32::MAX and wraps around during the call.
    frames.sort_by_key(|f| f.rtp_timestamp.wrapping_sub(base_ts));

    // Remove duplicate timestamps (retransmissions)
    frames.dedup_by_key(|f| f.rtp_timestamp);

    // Build output with gap filling for lost packets.
    // Max gap to fill: 10 seconds at 8kHz (prevents runaway allocation on timestamp discontinuity)
    const MAX_GAP_SAMPLES: usize = 8000 * 10;
    let mut output: Vec<i16> = Vec::new();

    for frame in &frames {
        let expected_pos = frame.rtp_timestamp.wrapping_sub(base_ts) as usize;

        if expected_pos > output.len() {
            let gap = expected_pos - output.len();
            if gap <= MAX_GAP_SAMPLES {
                // Fill gap with silence (lost packets)
                output.resize(expected_pos, 0);
            }
            // If gap > MAX_GAP_SAMPLES, skip the gap (timestamp discontinuity, e.g. hold/resume)
        }

        if expected_pos < output.len() {
            // Overlapping frame (duplicate/retransmit) — only append new samples beyond overlap
            let overlap = output.len() - expected_pos;
            if overlap < frame.samples.len() {
                output.extend_from_slice(&frame.samples[overlap..]);
            }
        } else {
            output.extend_from_slice(&frame.samples);
        }
    }

    Ok((output, first_capture_time, label, packet_count))
}

/// Decode two RTP streams, time-align them, and return a stereo WAV (left/right channels).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn rtp_streams_decode_combined(
    session_id: String,
    ssrc_left: u32,
    ssrc_right: u32,
) -> Result<serde_json::Value, String> {
    let packets = get_packets_for_session(&session_id, 500_000)?;

    let (left_samples, left_ts, left_label, _) = decode_ssrc_audio(&packets, ssrc_left)?;
    let (right_samples, right_ts, right_label, _) = decode_ssrc_audio(&packets, ssrc_right)?;

    if left_samples.is_empty() && right_samples.is_empty() {
        return Err(format!(
            "No RTP audio data found for SSRCs {} and {}",
            ssrc_left, ssrc_right
        ));
    }

    let sample_rate: u32 = 8000;

    // Time-align: pad the later-starting stream with leading silence
    let (mut left_aligned, mut right_aligned) = match (left_ts, right_ts) {
        (Some(lt), Some(rt)) => {
            let diff_ms = (lt - rt).num_milliseconds();
            let diff_samples = ((diff_ms.abs() as u64) * sample_rate as u64 / 1000) as usize;
            if diff_ms > 0 {
                // Left starts later → pad left with leading silence
                let mut padded_left = vec![0i16; diff_samples];
                padded_left.extend_from_slice(&left_samples);
                (padded_left, right_samples)
            } else if diff_ms < 0 {
                // Right starts later → pad right with leading silence
                let mut padded_right = vec![0i16; diff_samples];
                padded_right.extend_from_slice(&right_samples);
                (left_samples, padded_right)
            } else {
                (left_samples, right_samples)
            }
        }
        _ => (left_samples, right_samples),
    };

    // Pad shorter stream with trailing silence so both are the same length
    let max_len = left_aligned.len().max(right_aligned.len());
    left_aligned.resize(max_len, 0);
    right_aligned.resize(max_len, 0);

    let wav_data = encode_wav_stereo(&left_aligned, &right_aligned, sample_rate);
    let wav_b64 =
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &wav_data);
    let duration_sec = max_len as f64 / sample_rate as f64;

    Ok(serde_json::json!({
        "wavBase64": wav_b64,
        "durationSec": duration_sec,
        "leftLabel": left_label,
        "rightLabel": right_label,
    }))
}

/// Export decoded RTP audio as WAV file. If path is empty, opens a save dialog.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn rtp_stream_export_wav(
    session_id: String,
    ssrc: u32,
    path: String,
) -> Result<String, String> {
    let result = rtp_stream_decode_audio(session_id, ssrc)?;
    let wav_b64 = result["wavBase64"].as_str().ok_or("No WAV data")?;
    let wav_data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, wav_b64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let output_path = if path.is_empty() {
        let dialog = rfd::AsyncFileDialog::new()
            .set_title("Save WAV audio")
            .add_filter("WAV Audio", &["wav"])
            .set_file_name(&format!("rtp_stream_{}.wav", ssrc))
            .save_file()
            .await;
        match dialog {
            Some(handle) => handle.path().to_string_lossy().to_string(),
            None => return Err("Save cancelled".to_string()),
        }
    } else {
        path
    };

    std::fs::write(&output_path, &wav_data).map_err(|e| format!("Failed to write WAV: {}", e))?;
    Ok(output_path)
}

// ── Feature 8: Silence/Clipping Detection ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioIssue {
    #[serde(rename = "type")]
    pub issue_type: String,
    pub start_time_sec: f64,
    pub duration_ms: f64,
    pub severity: String,
    pub description: String,
}

/// Analyze decoded RTP audio for silence, clipping, and one-way audio issues.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn rtp_stream_analyze_quality(
    session_id: String,
    ssrc: u32,
) -> Result<Vec<AudioIssue>, String> {
    let decode_result = rtp_stream_decode_audio(session_id, ssrc)?;
    let wav_b64 = decode_result["wavBase64"].as_str().ok_or("No WAV data")?;
    let wav_data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, wav_b64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    // Skip WAV header (44 bytes) and read PCM samples
    if wav_data.len() < 44 {
        return Err("WAV data too short".to_string());
    }
    let pcm_data = &wav_data[44..];
    let samples: Vec<i16> = pcm_data
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();

    let sample_rate = 8000;
    let mut issues: Vec<AudioIssue> = Vec::new();

    // Detect silence: consecutive samples below -50 dBFS for > 500ms
    let silence_threshold = 100i16; // ~-50 dBFS for 16-bit audio
    let silence_min_samples = sample_rate / 2; // 500ms
    let mut silence_start: Option<usize> = None;
    let mut silence_count = 0usize;

    for (i, &sample) in samples.iter().enumerate() {
        if sample.unsigned_abs() < silence_threshold as u16 {
            if silence_start.is_none() {
                silence_start = Some(i);
            }
            silence_count += 1;
        } else {
            if silence_count >= silence_min_samples {
                let start_sec = silence_start.unwrap_or(0) as f64 / sample_rate as f64;
                let duration_ms = (silence_count as f64 / sample_rate as f64) * 1000.0;
                let severity = if duration_ms > 3000.0 { "error" } else { "warning" };
                issues.push(AudioIssue {
                    issue_type: "silence".to_string(),
                    start_time_sec: start_sec,
                    duration_ms,
                    severity: severity.to_string(),
                    description: format!("Silence detected: {:.1}s at {:.0}s", duration_ms / 1000.0, start_sec),
                });
            }
            silence_start = None;
            silence_count = 0;
        }
    }
    // Check trailing silence
    if silence_count >= silence_min_samples {
        let start_sec = silence_start.unwrap_or(0) as f64 / sample_rate as f64;
        let duration_ms = (silence_count as f64 / sample_rate as f64) * 1000.0;
        issues.push(AudioIssue {
            issue_type: "silence".to_string(),
            start_time_sec: start_sec,
            duration_ms,
            severity: "warning".to_string(),
            description: format!("Trailing silence: {:.1}s", duration_ms / 1000.0),
        });
    }

    // Detect clipping: consecutive samples at max amplitude for > 50ms
    let clipping_threshold = 32000i16; // near max for 16-bit
    let clipping_min_samples = sample_rate / 20; // 50ms
    let mut clip_start: Option<usize> = None;
    let mut clip_count = 0usize;

    for (i, &sample) in samples.iter().enumerate() {
        if sample.unsigned_abs() > clipping_threshold as u16 {
            if clip_start.is_none() {
                clip_start = Some(i);
            }
            clip_count += 1;
        } else {
            if clip_count >= clipping_min_samples {
                let start_sec = clip_start.unwrap_or(0) as f64 / sample_rate as f64;
                let duration_ms = (clip_count as f64 / sample_rate as f64) * 1000.0;
                issues.push(AudioIssue {
                    issue_type: "clipping".to_string(),
                    start_time_sec: start_sec,
                    duration_ms,
                    severity: "error".to_string(),
                    description: format!("Audio clipping: {:.1}s at {:.0}s", duration_ms / 1000.0, start_sec),
                });
            }
            clip_start = None;
            clip_count = 0;
        }
    }

    Ok(issues)
}

// ── Feature 9: CDR Export ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdrRecord {
    pub call_id: String,
    pub caller: String,
    pub callee: String,
    pub start_time: String,
    pub ring_time: Option<String>,
    pub connect_time: Option<String>,
    pub end_time: Option<String>,
    pub duration_sec: f64,
    pub disposition: String,
    pub final_status_code: u16,
    pub codec: Option<String>,
    pub mos: Option<f64>,
    pub jitter: Option<f64>,
    pub packet_loss: Option<f64>,
    pub packets_sent: Option<u64>,
    pub packets_received: Option<u64>,
    pub capture_session_id: String,
}

/// Export Call Detail Records from SIP dialogs in a capture session.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn export_cdrs(
    session_id: String,
    format: String,
) -> Result<String, String> {
    // Reuse existing get_sip_dialogs and get_rtp_streams commands
    let dialogs = get_sip_dialogs(session_id.clone())?;
    let rtp_streams_result = get_rtp_streams(session_id.clone())?;

    let mut cdrs: Vec<CdrRecord> = Vec::new();

    for dialog in &dialogs {
        let mut disposition = "unknown".to_string();
        let mut final_code: u16 = 0;
        let mut ring_time: Option<String> = None;
        let mut connect_time: Option<String> = None;

        for msg in &dialog.messages {
            let code_str = msg.method_or_code.trim();
            if let Ok(code) = code_str.parse::<u16>() {
                final_code = code;
                match code {
                    180 | 183 => {
                        if ring_time.is_none() {
                            ring_time = Some(msg.timestamp.clone());
                        }
                    }
                    200 => {
                        connect_time = Some(msg.timestamp.clone());
                        disposition = "answered".to_string();
                    }
                    486 | 600 => disposition = "busy".to_string(),
                    487 => disposition = "cancelled".to_string(),
                    480 => disposition = "no-answer".to_string(),
                    c if c >= 400 => disposition = "failed".to_string(),
                    _ => {}
                }
            }
        }

        let duration = if let (Some(start), Some(end)) = (dialog.messages.first(), dialog.messages.last()) {
            if let (Ok(s), Ok(e)) = (
                chrono::DateTime::parse_from_rfc3339(&start.timestamp),
                chrono::DateTime::parse_from_rfc3339(&end.timestamp),
            ) {
                (e - s).num_milliseconds() as f64 / 1000.0
            } else {
                0.0
            }
        } else {
            0.0
        };

        // Find matching RTP streams for quality metrics
        let mut mos: Option<f64> = None;
        let mut jitter: Option<f64> = None;
        let mut loss: Option<f64> = None;

        for stream in &rtp_streams_result {
            mos = Some(stream.mos_score);
            jitter = Some(stream.jitter);
            loss = Some(stream.loss_percentage);
            break;
        }

        let caller = dialog.participants.as_ref().and_then(|p| p.first()).cloned().unwrap_or_default();
        let callee = dialog.participants.as_ref().and_then(|p| p.get(1)).cloned().unwrap_or_default();

        cdrs.push(CdrRecord {
            call_id: dialog.call_id.clone(),
            caller,
            callee,
            start_time: dialog.start_time.clone(),
            ring_time,
            connect_time,
            end_time: dialog.end_time.clone(),
            duration_sec: duration,
            disposition,
            final_status_code: final_code,
            codec: rtp_streams_result.first().map(|s| s.codec_name.clone()),
            mos,
            jitter,
            packet_loss: loss,
            packets_sent: None,
            packets_received: rtp_streams_result.first().map(|s| s.packet_count as u64),
            capture_session_id: session_id.clone(),
        });
    }

    match format.as_str() {
        "csv" => {
            let mut csv = String::from("Call-ID,Caller,Callee,Start Time,Connect Time,End Time,Duration(s),Disposition,Status Code,Codec,MOS,Jitter(ms),Loss(%)\n");
            for cdr in &cdrs {
                csv.push_str(&format!(
                    "{},{},{},{},{},{},{:.1},{},{},{},{},{},{}\n",
                    cdr.call_id,
                    cdr.caller,
                    cdr.callee,
                    cdr.start_time,
                    cdr.connect_time.as_deref().unwrap_or(""),
                    cdr.end_time.as_deref().unwrap_or(""),
                    cdr.duration_sec,
                    cdr.disposition,
                    cdr.final_status_code,
                    cdr.codec.as_deref().unwrap_or(""),
                    cdr.mos.map(|m| format!("{:.2}", m)).unwrap_or_default(),
                    cdr.jitter.map(|j| format!("{:.1}", j)).unwrap_or_default(),
                    cdr.packet_loss.map(|l| format!("{:.2}", l)).unwrap_or_default(),
                ));
            }
            Ok(csv)
        }
        _ => {
            serde_json::to_string_pretty(&cdrs).map_err(|e| e.to_string())
        }
    }
}

// ── Feature 15: Passive RTP Quality Monitor ──

/// Get live RTP streams from an active capture session (for real-time monitoring).
/// Reuses the existing get_rtp_streams logic but intended for polling during live capture.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn get_live_rtp_streams(
    session_id: String,
) -> Result<Vec<RtpStreamInfo>, String> {
    get_rtp_streams(session_id)
}

// ── Audio codec helpers ──

/// ITU-T G.711 u-law to 16-bit linear PCM (reference: Sun Microsystems / ITU-T G.711).
/// Output range: [-32124, 32124].
fn ulaw_to_linear(u_val: u8) -> i16 {
    let u_val = !u_val as i32;
    let sign: i32 = if u_val & 0x80 != 0 { -1 } else { 1 };
    let exponent = (u_val >> 4) & 0x07;
    let mantissa = u_val & 0x0F;
    let magnitude = ((mantissa << 3) | 0x84) << exponent;
    (sign * (magnitude - 0x84)) as i16
}

/// ITU-T G.711 A-law to 16-bit linear PCM.
/// Output range: [-32256, 32256].
fn alaw_to_linear(a_val: u8) -> i16 {
    let a_val = (a_val ^ 0x55) as i32;
    let sign: i32 = if a_val & 0x80 != 0 { 1 } else { -1 };
    let exponent = (a_val >> 4) & 0x07;
    let mantissa = a_val & 0x0F;
    let magnitude = if exponent == 0 {
        (mantissa << 4) | 8
    } else {
        ((mantissa << 4) | 0x108) << (exponent - 1)
    };
    (sign * magnitude) as i16
}

fn encode_wav(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_size = (samples.len() * 2) as u32;
    let file_size = 36 + data_size;
    let mut buf = Vec::with_capacity(file_size as usize + 8);

    // RIFF header
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&file_size.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt chunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // chunk size
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    buf.extend_from_slice(&1u16.to_le_bytes()); // mono
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
    buf.extend_from_slice(&2u16.to_le_bytes()); // block align
    buf.extend_from_slice(&16u16.to_le_bytes()); // bits per sample

    // data chunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_size.to_le_bytes());
    for &sample in samples {
        buf.extend_from_slice(&sample.to_le_bytes());
    }

    buf
}

/// Encode interleaved stereo PCM samples as a 2-channel 16-bit WAV.
fn encode_wav_stereo(left: &[i16], right: &[i16], sample_rate: u32) -> Vec<u8> {
    let num_samples = left.len().max(right.len());
    let num_channels: u16 = 2;
    let bits_per_sample: u16 = 16;
    let block_align = num_channels * (bits_per_sample / 8); // 4
    let byte_rate = sample_rate * block_align as u32;
    let data_size = (num_samples as u32) * (block_align as u32);
    let file_size = 36 + data_size;
    let mut buf = Vec::with_capacity(file_size as usize + 8);

    // RIFF header
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&file_size.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt chunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // chunk size
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    buf.extend_from_slice(&num_channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data chunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_size.to_le_bytes());
    for i in 0..num_samples {
        let l = if i < left.len() { left[i] } else { 0i16 };
        let r = if i < right.len() { right[i] } else { 0i16 };
        buf.extend_from_slice(&l.to_le_bytes());
        buf.extend_from_slice(&r.to_le_bytes());
    }

    buf
}

// ---------------------------------------------------------------------------
// Agent capture session management
// ---------------------------------------------------------------------------

/// Create a capture session for an agent-based remote capture.
/// This creates a ring buffer + pcap file + DB record so the existing
/// `get_filtered_packets` pipeline works transparently.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn create_agent_capture_session(
    session_id: String,
    name: String,
    interface_name: String,
) -> Result<(), String> {
    use crate::packet_capture::ring_buffer::{PacketRingBufferCompat, DEFAULT_BUFFER_CAPACITY};

    let config_dir = config::get_config_dir().map_err(|e| e.to_string())?;
    let captures_dir = config_dir.join("captures");
    std::fs::create_dir_all(&captures_dir).map_err(|e| e.to_string())?;
    let file_path = captures_dir.join(format!("{}.pcap", session_id));

    let pcap_writer = Arc::new(std::sync::Mutex::new(
        PcapWriter::new(&file_path).map_err(|e| e.to_string())?,
    ));

    let packet_buffer: crate::packet_capture::ring_buffer::SharedPacketBuffer =
        Arc::new(std::sync::Mutex::new(PacketRingBufferCompat::new(DEFAULT_BUFFER_CAPACITY)));

    let session_obj = CaptureSession::new_external(
        session_id.clone(),
        name.clone(),
        Some("Agent remote capture".to_string()),
        format!("agent:{}", interface_name),
        FilterConfig::default(),
        Some(file_path.to_string_lossy().to_string()),
        packet_buffer,
        pcap_writer,
    );

    {
        let mut sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        let (evicted, _) = cleanup_sessions_internal(&mut sessions);
        for evicted_id in &evicted {
            invalidate_session_caches(evicted_id);
        }
        sessions.insert(session_id.clone(), SessionEntry::new_running(session_obj));
    }

    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    let filter_config_json = serde_json::to_string(&FilterConfig::default()).unwrap_or_default();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO capture_sessions (id, name, description, interface, filter_config, start_time, status, packet_count, file_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            session_id,
            name,
            "Agent remote capture",
            format!("agent:{}", interface_name),
            filter_config_json,
            now,
            "Running",
            0i64,
            file_path.to_string_lossy(),
            now,
        ],
    ).map_err(|e| e.to_string())?;

    tracing::info!("Created session {} for agent capture", session_id);
    Ok(())
}

/// Inject raw Ethernet frames captured by a remote agent into the local
/// capture session's ring buffer. Each frame is a base64-encoded raw packet.
/// Returns the number of packets successfully parsed and injected.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn inject_agent_raw_frames(
    session_id: String,
    frames: Vec<String>,
) -> Result<u32, String> {
    use base64::Engine;
    use crate::packet_capture::protocol_decoder;

    let (buffer, pcap_writer) = {
        let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        let entry = sessions.get(&session_id)
            .ok_or_else(|| format!("Agent session not found: {}", session_id))?;
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        (session.packet_buffer.clone(), session.pcap_writer.clone())
    };

    let mut injected = 0u32;

    for frame_b64 in &frames {
        let raw = match base64::engine::general_purpose::STANDARD.decode(frame_b64) {
            Ok(d) => d,
            Err(_) => continue,
        };
        if raw.len() < 14 {
            continue;
        }

        let ts = chrono::Utc::now();
        let frame_len = raw.len();

        let decoded = protocol_decoder::decode_packet(
            &raw,
            Some(1), // Ethernet link type
            Some(injected as u64),
            Some((10000, 60000)),
        ).ok();

        let ip_data = extract_ip_layer_for_injection(&raw);
        let (src_ip, dst_ip, src_port, dst_port, _transport_proto, payload) =
            parse_ip_transport(ip_data);
        let payload_vec = payload.to_vec();

        let protocol = Protocol::detect_with_ports(src_port, dst_port, payload);

        let pkt = PacketInfo {
            timestamp: ts,
            src_ip,
            dst_ip,
            src_port,
            dst_port,
            protocol,
            size: payload.len(),
            frame_length: frame_len,
            raw_frame: Some(raw),
            data: payload_vec,
            decoded,
            fidelity: crate::packet_capture::PacketFidelity::Authoritative,
            provenance: crate::packet_capture::PacketProvenance::AgentRawFrameInjection,
        };

        if let Some(ref writer) = pcap_writer {
            if let Ok(mut w) = writer.lock() {
                let _ = w.write_packet(&pkt);
            }
        }

        if let Ok(mut buf) = buffer.lock() {
            buf.push(pkt);
        }

        injected += 1;
    }

    Ok(injected)
}

/// Inject packets described by agent-provided PacketInfo JSON (for tcpdump
/// fallback where raw frame data is not available as an Ethernet frame).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn inject_agent_packet_infos(
    session_id: String,
    packets: Vec<serde_json::Value>,
) -> Result<u32, String> {
    let buffer = {
        let sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        let entry = sessions.get(&session_id)
            .ok_or_else(|| format!("Agent session not found: {}", session_id))?;
        let session = entry.session.lock().map_err(|_| "Failed to lock session")?;
        session.packet_buffer.clone()
    };

    let mut injected = 0u32;

    for pkt_json in &packets {
        let src_ip_str = pkt_json.get("src_ip").and_then(|v| v.as_str()).unwrap_or("0.0.0.0");
        let dst_ip_str = pkt_json.get("dst_ip").and_then(|v| v.as_str()).unwrap_or("0.0.0.0");
        let protocol_str = pkt_json.get("protocol").and_then(|v| v.as_str()).unwrap_or("Unknown");
        let length = pkt_json.get("length").and_then(|v| v.as_i64()).unwrap_or(0) as usize;
        let src_port = pkt_json.get("src_port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
        let dst_port = pkt_json.get("dst_port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
        let info = pkt_json.get("info").and_then(|v| v.as_str()).unwrap_or("");

        let src_ip: IpAddr = src_ip_str.parse().unwrap_or(IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
        let dst_ip: IpAddr = dst_ip_str.parse().unwrap_or(IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));

        let protocol = match protocol_str {
            "TCP" => Protocol::TCP,
            "UDP" => Protocol::UDP,
            "SIP" => Protocol::SIP,
            "RTP" => Protocol::RTP,
            "RTCP" => Protocol::RTCP,
            "DNS" => Protocol::DNS,
            "ARP" => Protocol::ARP,
            "ICMP" => Protocol::ICMP,
            "HTTP" => Protocol::HTTP,
            "HTTPS" => Protocol::HTTPS,
            "FAX" => Protocol::FAX,
            _ => Protocol::Other,
        };

        let pkt = PacketInfo {
            timestamp: chrono::Utc::now(),
            src_ip,
            dst_ip,
            src_port,
            dst_port,
            protocol,
            size: length,
            frame_length: length,
            raw_frame: None,
            data: info.as_bytes().to_vec(),
            decoded: None,
            fidelity: crate::packet_capture::PacketFidelity::Simulated,
            provenance: crate::packet_capture::PacketProvenance::AgentPacketInfoInjection,
        };

        if let Ok(mut buf) = buffer.lock() {
            buf.push(pkt);
        }
        injected += 1;
    }

    Ok(injected)
}

/// Stop an agent capture session (mark as stopped in memory and DB).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn stop_agent_capture_session(session_id: String) -> Result<(), String> {
    {
        let mut sessions = SESSIONS.lock().map_err(|_| "Failed to lock sessions")?;
        if let Some(entry) = sessions.get_mut(&session_id) {
            entry.mark_stopped();
            if let Ok(mut sess) = entry.session.lock() {
                let _ = sess.stop();
            }
        }
    }

    if let Ok(conn) = database::Database::get_connection() {
        let _ = conn.execute(
            "UPDATE capture_sessions SET status = ?1, end_time = ?2 WHERE id = ?3",
            rusqlite::params!["Stopped", chrono::Utc::now().to_rfc3339(), session_id],
        );
    }

    tracing::info!("Stopped session {}", session_id);
    Ok(())
}

/// Extract IP layer from a raw Ethernet frame for agent packet injection.
fn extract_ip_layer_for_injection(data: &[u8]) -> &[u8] {
    if data.len() < 14 {
        return &[];
    }
    let ethertype = u16::from_be_bytes([data[12], data[13]]);
    match ethertype {
        0x0800 | 0x86DD => &data[14..],
        0x8100 if data.len() >= 18 => &data[18..],
        _ => &[],
    }
}

/// Parse IP + transport headers to extract addresses, ports, and payload.
fn parse_ip_transport(ip_data: &[u8]) -> (IpAddr, IpAddr, u16, u16, u8, &[u8]) {
    if ip_data.len() < 20 {
        return (
            IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED),
            IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED),
            0, 0, 0, &[],
        );
    }

    let version = ip_data[0] >> 4;
    let (src_ip, dst_ip, proto, transport) = if version == 4 {
        let ihl = (ip_data[0] & 0x0f) as usize * 4;
        if ip_data.len() < ihl {
            return (IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 0, 0, 0, &[]);
        }
        let src = IpAddr::V4(std::net::Ipv4Addr::new(ip_data[12], ip_data[13], ip_data[14], ip_data[15]));
        let dst = IpAddr::V4(std::net::Ipv4Addr::new(ip_data[16], ip_data[17], ip_data[18], ip_data[19]));
        (src, dst, ip_data[9], &ip_data[ihl..])
    } else if version == 6 && ip_data.len() >= 40 {
        let src = IpAddr::V6(std::net::Ipv6Addr::from({ let mut a = [0u8; 16]; a.copy_from_slice(&ip_data[8..24]); a }));
        let dst = IpAddr::V6(std::net::Ipv6Addr::from({ let mut a = [0u8; 16]; a.copy_from_slice(&ip_data[24..40]); a }));
        (src, dst, ip_data[6], &ip_data[40..])
    } else {
        return (IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 0, 0, 0, &[]);
    };

    let (sp, dp, payload) = match proto {
        6 if transport.len() >= 20 => {
            let sp = u16::from_be_bytes([transport[0], transport[1]]);
            let dp = u16::from_be_bytes([transport[2], transport[3]]);
            let offset = ((transport[12] >> 4) as usize) * 4;
            let pl = if transport.len() > offset { &transport[offset..] } else { &[] };
            (sp, dp, pl)
        }
        17 if transport.len() >= 8 => {
            let sp = u16::from_be_bytes([transport[0], transport[1]]);
            let dp = u16::from_be_bytes([transport[2], transport[3]]);
            (sp, dp, &transport[8..])
        }
        _ => (0, 0, transport),
    };

    (src_ip, dst_ip, sp, dp, proto, payload)
}

#[cfg(test)]
mod tests {
    use super::{
        build_call_session_events, build_packet_dialog_message_index, extract_notify_sipfrag_code,
        group_call_session_leg_indices, packet_info_to_json, parse_timestamp_utc,
        read_raw_packet_from_pcap_by_index, stream_matches_leg, CallSessionLeg, RtpStreamInfo,
        SessionLegForGrouping, SipDialog, SipDialogMessage, SipPacketMeta, RAW_PCAP_INDEX_CACHE,
    };
    use crate::packet_capture::{PacketFidelity, PacketInfo, PacketProvenance, Protocol};
    use chrono::TimeZone;
    use std::collections::{BTreeSet, HashSet};
    use std::io::Write;
    use std::net::{IpAddr, Ipv4Addr};
    use tempfile::NamedTempFile;

    fn test_packet(
        fidelity: PacketFidelity,
        provenance: PacketProvenance,
        raw_frame: Option<Vec<u8>>,
    ) -> PacketInfo {
        PacketInfo {
            timestamp: chrono::Utc
                .with_ymd_and_hms(2024, 1, 2, 3, 4, 5)
                .single()
                .expect("valid fixed timestamp"),
            src_ip: IpAddr::V4(Ipv4Addr::new(192, 0, 2, 10)),
            dst_ip: IpAddr::V4(Ipv4Addr::new(198, 51, 100, 20)),
            src_port: 5060,
            dst_port: 5070,
            protocol: Protocol::UDP,
            size: 4,
            frame_length: 60,
            raw_frame,
            data: b"ping".to_vec(),
            decoded: None,
            fidelity,
            provenance,
        }
    }

    #[test]
    fn packet_info_to_json_serializes_fidelity_and_provenance() {
        let packet = test_packet(
            PacketFidelity::Authoritative,
            PacketProvenance::AgentRawFrameInjection,
            Some(vec![0xde, 0xad, 0xbe, 0xef]),
        );

        let json = packet_info_to_json(&packet);
        assert_eq!(json["fidelity"], "authoritative");
        assert_eq!(json["provenance"], "agent_raw_frame_injection");
    }

    #[test]
    fn simulated_packet_info_injection_is_not_authoritative_for_writes() {
        let packet = test_packet(
            PacketFidelity::Simulated,
            PacketProvenance::AgentPacketInfoInjection,
            Some(vec![1, 2, 3, 4]),
        );

        // Simulated packet-info injection should never be treated as authoritative write input.
        assert!(!packet.can_write_authoritative_pcap());
    }

    fn create_test_pcap_with_frames(frames: &[&[u8]]) -> NamedTempFile {
        let mut file = NamedTempFile::new().expect("temp pcap file");

        // PCAP global header (little-endian).
        let header: [u8; 24] = [
            0xd4, 0xc3, 0xb2, 0xa1, // Magic
            0x02, 0x00, // Version major
            0x04, 0x00, // Version minor
            0x00, 0x00, 0x00, 0x00, // thiszone
            0x00, 0x00, 0x00, 0x00, // sigfigs
            0xff, 0xff, 0x00, 0x00, // snaplen
            0x01, 0x00, 0x00, 0x00, // linktype ethernet
        ];
        file.write_all(&header).expect("write pcap header");

        for frame in frames {
            let len = frame.len() as u32;
            let pkt_header: [u8; 16] = [
                0x00, 0x00, 0x00, 0x00, // ts_sec
                0x00, 0x00, 0x00, 0x00, // ts_usec
                (len & 0xff) as u8,
                ((len >> 8) & 0xff) as u8,
                ((len >> 16) & 0xff) as u8,
                ((len >> 24) & 0xff) as u8, // caplen
                (len & 0xff) as u8,
                ((len >> 8) & 0xff) as u8,
                ((len >> 16) & 0xff) as u8,
                ((len >> 24) & 0xff) as u8, // len
            ];
            file.write_all(&pkt_header).expect("write packet header");
            file.write_all(frame).expect("write frame");
        }

        file.flush().expect("flush pcap");
        file
    }

    #[test]
    fn read_raw_packet_by_index_returns_exact_frame_bytes() {
        let _ = RAW_PCAP_INDEX_CACHE.lock().map(|mut c| c.clear());
        let frame_a = [0xde, 0xad, 0xbe, 0xef];
        let frame_b = [0xaa, 0xbb, 0xcc];
        let pcap = create_test_pcap_with_frames(&[&frame_a, &frame_b]);

        let (raw0, source0) = read_raw_packet_from_pcap_by_index(
            "test-session-raw-0",
            &pcap.path().to_string_lossy(),
            0,
        )
        .expect("first frame should load");
        assert_eq!(raw0, frame_a);
        assert_eq!(source0, "pcap_indexed");

        let (raw1, source1) = read_raw_packet_from_pcap_by_index(
            "test-session-raw-0",
            &pcap.path().to_string_lossy(),
            1,
        )
        .expect("second frame should load");
        assert_eq!(raw1, frame_b);
        assert_eq!(source1, "pcap_indexed");
    }

    #[test]
    fn read_raw_packet_by_index_reports_out_of_range() {
        let _ = RAW_PCAP_INDEX_CACHE.lock().map(|mut c| c.clear());
        let frame = [1u8, 2, 3, 4];
        let pcap = create_test_pcap_with_frames(&[&frame]);

        let err = read_raw_packet_from_pcap_by_index(
            "test-session-raw-oob",
            &pcap.path().to_string_lossy(),
            9,
        )
        .expect_err("index should be out of range");
        assert!(err.contains("out of range"));
    }

    fn set_of(values: &[&str]) -> HashSet<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    fn sorted_groups(mut groups: Vec<Vec<usize>>) -> Vec<Vec<usize>> {
        for group in &mut groups {
            group.sort_unstable();
        }
        groups.sort();
        groups
    }

    #[test]
    fn grouping_prefers_refer_replaces_linkage() {
        let legs = vec![
            SessionLegForGrouping {
                call_id: "A".to_string(),
                start_dt: parse_timestamp_utc("2024-01-01T00:00:00Z"),
                end_dt: parse_timestamp_utc("2024-01-01T00:00:08Z"),
                endpoints: set_of(&["10.0.0.1:5060"]),
                correlation_tokens: BTreeSet::new(),
                linked_call_ids: vec!["B".to_string()].into_iter().collect(),
                rtp_ssrcs: BTreeSet::new(),
            },
            SessionLegForGrouping {
                call_id: "B".to_string(),
                start_dt: parse_timestamp_utc("2024-01-01T00:00:20Z"),
                end_dt: parse_timestamp_utc("2024-01-01T00:00:25Z"),
                endpoints: set_of(&["10.0.0.9:5060"]),
                correlation_tokens: BTreeSet::new(),
                linked_call_ids: BTreeSet::new(),
                rtp_ssrcs: BTreeSet::new(),
            },
            SessionLegForGrouping {
                call_id: "C".to_string(),
                start_dt: parse_timestamp_utc("2024-01-01T00:01:00Z"),
                end_dt: parse_timestamp_utc("2024-01-01T00:01:03Z"),
                endpoints: set_of(&["10.0.0.3:5060"]),
                correlation_tokens: BTreeSet::new(),
                linked_call_ids: BTreeSet::new(),
                rtp_ssrcs: BTreeSet::new(),
            },
        ];

        let grouped = sorted_groups(group_call_session_leg_indices(&legs));
        assert_eq!(grouped, vec![vec![0, 1], vec![2]]);
    }

    #[test]
    fn grouping_uses_endpoint_and_temporal_adjacency() {
        let shared_endpoint = set_of(&["10.1.1.1:5060"]);
        let legs = vec![
            SessionLegForGrouping {
                call_id: "L1".to_string(),
                start_dt: parse_timestamp_utc("2024-01-01T00:00:00Z"),
                end_dt: parse_timestamp_utc("2024-01-01T00:00:04Z"),
                endpoints: shared_endpoint.clone(),
                correlation_tokens: BTreeSet::new(),
                linked_call_ids: BTreeSet::new(),
                rtp_ssrcs: BTreeSet::new(),
            },
            SessionLegForGrouping {
                call_id: "L2".to_string(),
                start_dt: parse_timestamp_utc("2024-01-01T00:00:05Z"),
                end_dt: parse_timestamp_utc("2024-01-01T00:00:07Z"),
                endpoints: shared_endpoint,
                correlation_tokens: BTreeSet::new(),
                linked_call_ids: BTreeSet::new(),
                rtp_ssrcs: BTreeSet::new(),
            },
        ];

        let grouped = sorted_groups(group_call_session_leg_indices(&legs));
        assert_eq!(grouped, vec![vec![0, 1]]);
    }

    #[test]
    fn session_events_are_strictly_ordered() {
        let meta_b = SipPacketMeta {
            packet_index: 9,
            timestamp: "2024-01-01T00:00:02Z".to_string(),
            timestamp_dt: parse_timestamp_utc("2024-01-01T00:00:02Z"),
            call_id: "A".to_string(),
            method: None,
            response_code: Some(200),
            cseq_method: Some("INVITE".to_string()),
            src_endpoint: "10.0.0.2:5060".to_string(),
            dst_endpoint: "10.0.0.1:5060".to_string(),
            correlation_tokens: BTreeSet::new(),
            linked_call_ids: BTreeSet::new(),
            has_hold_sdp: false,
            has_resume_sdp: false,
            raw_upper: String::new(),
        };
        let meta_a = SipPacketMeta {
            packet_index: 3,
            timestamp: "2024-01-01T00:00:01Z".to_string(),
            timestamp_dt: parse_timestamp_utc("2024-01-01T00:00:01Z"),
            call_id: "A".to_string(),
            method: Some("INVITE".to_string()),
            response_code: None,
            cseq_method: Some("INVITE".to_string()),
            src_endpoint: "10.0.0.1:5060".to_string(),
            dst_endpoint: "10.0.0.2:5060".to_string(),
            correlation_tokens: BTreeSet::new(),
            linked_call_ids: BTreeSet::new(),
            has_hold_sdp: false,
            has_resume_sdp: false,
            raw_upper: String::new(),
        };
        let events = build_call_session_events(vec![meta_b, meta_a]);
        assert_eq!(events.first().map(|e| e.event_type.as_str()), Some("setup"));
        assert_eq!(events.last().map(|e| e.event_type.as_str()), Some("answered"));
        assert!(events
            .windows(2)
            .all(|pair| pair[0].timestamp <= pair[1].timestamp));
    }

    #[test]
    fn parse_notify_sipfrag_code_prefers_body_status() {
        let raw = "NOTIFY sip:b@example.com SIP/2.0\r\nVia: SIP/2.0/UDP a.example.com\r\nContent-Type: message/sipfrag\r\n\r\nSIP/2.0 486 Busy Here\r\n";
        let code = extract_notify_sipfrag_code(raw);
        assert_eq!(code, Some(486));
    }

    #[test]
    fn packet_dialog_message_index_maps_precise_dialog_message() {
        let dialogs = vec![
            SipDialog {
                call_id: "call-a".to_string(),
                from_tag: Some("fa".to_string()),
                to_tag: Some("ta".to_string()),
                messages: vec![SipDialogMessage {
                    method_or_code: "INVITE".to_string(),
                    cseq: Some("1 INVITE".to_string()),
                    timestamp: "2024-01-01T00:00:00Z".to_string(),
                    packet_index: 10,
                    from_participant_index: Some(0),
                    to_participant_index: Some(1),
                }],
                start_time: "2024-01-01T00:00:00Z".to_string(),
                end_time: None,
                participants: Some(vec!["a".to_string(), "b".to_string()]),
            },
            SipDialog {
                call_id: "call-b".to_string(),
                from_tag: Some("fb".to_string()),
                to_tag: Some("tb".to_string()),
                messages: vec![SipDialogMessage {
                    method_or_code: "INVITE".to_string(),
                    cseq: Some("1 INVITE".to_string()),
                    timestamp: "2024-01-01T00:00:02Z".to_string(),
                    packet_index: 20,
                    from_participant_index: Some(0),
                    to_participant_index: Some(1),
                }],
                start_time: "2024-01-01T00:00:02Z".to_string(),
                end_time: None,
                participants: Some(vec!["c".to_string(), "d".to_string()]),
            },
        ];

        let index = build_packet_dialog_message_index(&dialogs);
        assert_eq!(index.get(&10).map(|v| (v.0, v.1, v.2.as_str())), Some((0, 0, "call-a")));
        assert_eq!(index.get(&20).map(|v| (v.0, v.1, v.2.as_str())), Some((1, 0, "call-b")));
    }

    #[test]
    fn packet_dialog_message_index_handles_same_call_id_multiple_dialogs() {
        let dialogs = vec![
            SipDialog {
                call_id: "same-call-id".to_string(),
                from_tag: Some("from-a".to_string()),
                to_tag: Some("to-a".to_string()),
                messages: vec![SipDialogMessage {
                    method_or_code: "INVITE".to_string(),
                    cseq: Some("1 INVITE".to_string()),
                    timestamp: "2024-01-01T00:00:00Z".to_string(),
                    packet_index: 101,
                    from_participant_index: Some(0),
                    to_participant_index: Some(1),
                }],
                start_time: "2024-01-01T00:00:00Z".to_string(),
                end_time: None,
                participants: Some(vec!["a".to_string(), "b".to_string()]),
            },
            SipDialog {
                call_id: "same-call-id".to_string(),
                from_tag: Some("from-b".to_string()),
                to_tag: Some("to-b".to_string()),
                messages: vec![SipDialogMessage {
                    method_or_code: "INVITE".to_string(),
                    cseq: Some("1 INVITE".to_string()),
                    timestamp: "2024-01-01T00:00:02Z".to_string(),
                    packet_index: 202,
                    from_participant_index: Some(0),
                    to_participant_index: Some(1),
                }],
                start_time: "2024-01-01T00:00:02Z".to_string(),
                end_time: None,
                participants: Some(vec!["c".to_string(), "d".to_string()]),
            },
        ];

        let index = build_packet_dialog_message_index(&dialogs);
        assert_eq!(index.get(&101).map(|v| (v.0, v.1)), Some((0, 0)));
        assert_eq!(index.get(&202).map(|v| (v.0, v.1)), Some((1, 0)));
    }

    #[test]
    fn stream_matches_leg_requires_temporal_overlap_not_only_endpoint_match() {
        let leg = CallSessionLeg {
            dialog_index: 0,
            call_id: "call-a".to_string(),
            from_tag: Some("fa".to_string()),
            to_tag: Some("ta".to_string()),
            participants: vec!["a".to_string(), "b".to_string()],
            start_time: "2024-01-01T00:00:00Z".to_string(),
            end_time: Some("2024-01-01T00:00:05Z".to_string()),
            start_dt: parse_timestamp_utc("2024-01-01T00:00:00Z"),
            end_dt: parse_timestamp_utc("2024-01-01T00:00:05Z"),
            packet_indices: vec![1, 2, 3],
            endpoints: vec!["10.0.0.1:4000".to_string(), "10.0.0.2:5000".to_string()]
                .into_iter()
                .collect(),
            correlation_tokens: BTreeSet::new(),
            linked_call_ids: BTreeSet::new(),
            rtp_ssrcs: BTreeSet::new(),
            has_transfer_signal: false,
        };
        let stream = RtpStreamInfo {
            ssrc: 77,
            src_ip: "10.0.0.1".to_string(),
            src_port: 4000,
            dst_ip: "10.0.0.2".to_string(),
            dst_port: 5000,
            payload_type: 0,
            codec_name: "PCMU".to_string(),
            packet_count: 150,
            lost_packets: 0,
            loss_percentage: 0.0,
            jitter: 1.0,
            mos_score: 4.3,
            first_packet_time: "2024-01-01T00:00:45Z".to_string(),
            last_packet_time: "2024-01-01T00:00:48Z".to_string(),
        };

        assert!(!stream_matches_leg(&stream, &leg));
    }
}

