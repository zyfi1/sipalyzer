use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

static REGISTRY: Lazy<DashMap<String, ManagedProcess>> = Lazy::new(DashMap::new);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedProcess {
    pub id: String,
    /// "capture", "fax", "registration", "scan", "call", "agent", "monitor", "test", etc.
    pub kind: String,
    pub label: String,
    pub started_at: String,
    /// "running", "paused", "completed", "failed", "cancelled"
    pub status: String,
    pub metadata: serde_json::Value,
}

pub fn register(proc: ManagedProcess) {
    REGISTRY.insert(proc.id.clone(), proc);
}

pub fn deregister(id: &str) {
    REGISTRY.remove(id);
}

pub fn update_status(id: &str, status: &str) {
    if let Some(mut entry) = REGISTRY.get_mut(id) {
        entry.status = status.to_string();
    }
}

pub fn list_all() -> Vec<ManagedProcess> {
    REGISTRY.iter().map(|r| r.value().clone()).collect()
}

pub fn get(id: &str) -> Option<ManagedProcess> {
    REGISTRY.get(id).map(|r| r.value().clone())
}

pub fn kill(id: &str) -> bool {
    if let Some(mut entry) = REGISTRY.get_mut(id) {
        entry.status = "cancelled".to_string();
        true
    } else {
        false
    }
}

pub fn kill_all_active() -> usize {
    let ids: Vec<String> = REGISTRY
        .iter()
        .filter(|r| {
            let status = &r.value().status;
            status == "running" || status == "paused"
        })
        .map(|r| r.key().clone())
        .collect();
    let count = ids.len();
    for id in ids {
        if let Some(mut entry) = REGISTRY.get_mut(&id) {
            entry.status = "cancelled".to_string();
        }
    }
    count
}

pub fn clear(id: &str) -> bool {
    if let Some(entry) = REGISTRY.get(id) {
        if entry.status != "running" && entry.status != "paused" {
            drop(entry);
            REGISTRY.remove(id);
            return true;
        }
    }
    false
}

pub fn clear_all() -> usize {
    let count = REGISTRY.len();
    REGISTRY.clear();
    count
}

pub fn clear_finished() -> usize {
    let ids: Vec<String> = REGISTRY
        .iter()
        .filter(|r| r.value().status != "running" && r.value().status != "paused")
        .map(|r| r.key().clone())
        .collect();
    let count = ids.len();
    for id in ids {
        REGISTRY.remove(&id);
    }
    count
}

pub fn count() -> usize {
    REGISTRY.len()
}

pub fn count_by_kind(kind: &str) -> usize {
    REGISTRY.iter().filter(|r| r.value().kind == kind).count()
}

pub fn count_running() -> usize {
    REGISTRY
        .iter()
        .filter(|r| r.value().status == "running")
        .count()
}
