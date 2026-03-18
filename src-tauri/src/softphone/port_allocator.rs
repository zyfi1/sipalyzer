//! Central RTP / UDPTL port allocator.
//!
//! All media consumers (softphone calls, fax RTP, T.38 UDPTL) use this module
//! so ports are never double-assigned.
//!
//! Ports are **even** (RTP convention: RTP on even, RTCP on odd).
//! Range is configurable; default 10000–65500.
//! Each `allocate()` call verifies availability with a quick UDP bind, then
//! records the port as in-use.  `release()` returns it to the pool.

use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::net::UdpSocket;
use std::sync::Mutex;

/// Internal allocator state.
struct PortAllocatorState {
    /// Ports currently handed out and not yet released.
    in_use: HashSet<u16>,
    /// Next port to try (always even).
    cursor: u16,
    /// Inclusive lower bound (even).
    range_low: u16,
    /// Inclusive upper bound.
    range_high: u16,
    /// label/owner per port for diagnostics (call_id, "fax:<job_id>", etc.)
    labels: HashMap<u16, String>,
}

impl PortAllocatorState {
    fn new(low: u16, high: u16) -> Self {
        let low = if low % 2 != 0 { low + 1 } else { low };
        Self {
            in_use: HashSet::new(),
            cursor: low,
            range_low: low,
            range_high: high,
            labels: HashMap::new(),
        }
    }

    /// Number of even ports in the range.
    fn pool_size(&self) -> usize {
        ((self.range_high - self.range_low) / 2 + 1) as usize
    }
}

static STATE: Lazy<Mutex<PortAllocatorState>> =
    Lazy::new(|| Mutex::new(PortAllocatorState::new(10000, 65500)));

// ─── Public API ──────────────────────────────────────────────────────────────

/// Allocate the next available even port.
/// `label` is a diagnostic tag (e.g. call-id or "fax:<job>") shown in status queries.
pub fn allocate(label: &str) -> Result<u16, String> {
    let mut s = STATE.lock().map_err(|e| format!("port allocator lock: {}", e))?;
    let max_attempts = s.pool_size();

    for _ in 0..max_attempts {
        let port = s.cursor;
        // Advance cursor (wrapping)
        s.cursor = if port + 2 > s.range_high {
            s.range_low
        } else {
            port + 2
        };

        if s.in_use.contains(&port) {
            continue;
        }

        // Verify OS availability with a quick bind + drop
        if UdpSocket::bind(format!("0.0.0.0:{}", port)).is_ok() {
            s.in_use.insert(port);
            s.labels.insert(port, label.to_string());
            return Ok(port);
        }
    }

    Err(format!(
        "No available RTP port in range {}-{} ({} ports in use)",
        s.range_low,
        s.range_high,
        s.in_use.len()
    ))
}

/// Allocate a **specific** port (e.g. when the registrar has `rtp_port` pinned).
/// Fails if the port is already in use by the allocator or the OS.
pub fn allocate_specific(port: u16, label: &str) -> Result<u16, String> {
    let mut s = STATE.lock().map_err(|e| format!("port allocator lock: {}", e))?;

    if s.in_use.contains(&port) {
        return Err(format!("RTP port {} is already in use by another session", port));
    }

    if UdpSocket::bind(format!("0.0.0.0:{}", port)).is_err() {
        return Err(format!("RTP port {} is not available (OS rejected bind)", port));
    }

    s.in_use.insert(port);
    s.labels.insert(port, label.to_string());
    Ok(port)
}

/// Release a port back to the pool.  Safe to call with a port that was never allocated.
pub fn release(port: u16) {
    if let Ok(mut s) = STATE.lock() {
        let _had = s.in_use.remove(&port);
        let _lbl = s.labels.remove(&port).unwrap_or_default();
    }
}

/// Update the allocator range.  Does **not** release ports outside the new range that are
/// still in use — they will be released normally when their sessions end.
pub fn set_range(low: u16, high: u16) {
    if let Ok(mut s) = STATE.lock() {
        let low = if low % 2 != 0 { low + 1 } else { low };
        s.range_low = low;
        s.range_high = high;
        // Reset cursor if it's outside the new range
        if s.cursor < low || s.cursor > high {
            s.cursor = low;
        }
    }
}

/// Snapshot of the allocator state for diagnostics / frontend display.
#[derive(serde::Serialize, Clone, Debug)]
pub struct PortAllocatorStatus {
    pub range_low: u16,
    pub range_high: u16,
    pub in_use_count: usize,
    /// Each entry: (port, label).
    pub ports_in_use: Vec<(u16, String)>,
}

/// Return a snapshot of the current allocator state.
pub fn status() -> PortAllocatorStatus {
    let s = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let mut ports: Vec<(u16, String)> = s
        .in_use
        .iter()
        .map(|&p| (p, s.labels.get(&p).cloned().unwrap_or_default()))
        .collect();
    ports.sort_by_key(|&(p, _)| p);
    PortAllocatorStatus {
        range_low: s.range_low,
        range_high: s.range_high,
        in_use_count: s.in_use.len(),
        ports_in_use: ports,
    }
}
