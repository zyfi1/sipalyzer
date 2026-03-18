use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub level: LogLevel,
    pub message: String,
    pub registrar_id: Option<String>,
    pub component: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[allow(dead_code)]
pub struct Logger {
    entries: Arc<Mutex<VecDeque<LogEntry>>>,
    max_entries: usize,
}

#[allow(dead_code)]
impl Logger {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: Arc::new(Mutex::new(VecDeque::with_capacity(max_entries))),
            max_entries,
        }
    }

    pub fn log(&self, level: LogLevel, message: String, registrar_id: Option<String>, component: String) {
        let entry = LogEntry {
            timestamp: Utc::now(),
            level,
            message,
            registrar_id,
            component,
        };

        let mut entries = self.entries.lock().unwrap();
        entries.push_back(entry);
        
        if entries.len() > self.max_entries {
            entries.pop_front();
        }
    }

    pub fn get_entries(&self, limit: Option<usize>, registrar_id: Option<&str>) -> Vec<LogEntry> {
        let entries = self.entries.lock().unwrap();
        let filtered: Vec<LogEntry> = entries
            .iter()
            .filter(|e| {
                if let Some(rid) = registrar_id {
                    e.registrar_id.as_ref().map(|id| id == rid).unwrap_or(false)
                } else {
                    true
                }
            })
            .cloned()
            .collect();
        
        if let Some(limit) = limit {
            filtered.into_iter().rev().take(limit).collect()
        } else {
            filtered.into_iter().rev().collect()
        }
    }

    pub fn clear(&self) {
        let mut entries = self.entries.lock().unwrap();
        entries.clear();
    }
}

impl Default for Logger {
    fn default() -> Self {
        Self::new(10000)
    }
}
