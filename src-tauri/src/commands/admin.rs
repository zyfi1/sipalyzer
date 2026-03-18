use serde::Serialize;
use crate::core::admin::AdminAuth;
use crate::core::audit::{AuditWriter, AuditQueryFilters, AuditQueryResult, AuditStats};
use crate::core::process_registry::{self, ManagedProcess};
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const AUDIT_WRITE_MAX_CATEGORY_LEN: usize = 32;
const AUDIT_WRITE_MAX_ACTION_LEN: usize = 48;
const AUDIT_WRITE_MAX_ACTOR_LEN: usize = 16;
const AUDIT_WRITE_MAX_TARGET_LEN: usize = 256;
const AUDIT_WRITE_MAX_DETAIL_LEN: usize = 2048;
const AUDIT_WRITE_WINDOW_MS: u64 = 10_000;
const AUDIT_WRITE_MAX_PER_WINDOW: u32 = 50;

static AUDIT_WRITE_RATE: Lazy<Mutex<(u64, u32)>> = Lazy::new(|| Mutex::new((0, 0)));

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn is_safe_token(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

fn enforce_audit_write_rate_limit() -> Result<(), String> {
    let now = now_epoch_ms();
    let mut guard = AUDIT_WRITE_RATE.lock().unwrap_or_else(|e| e.into_inner());
    if now.saturating_sub(guard.0) > AUDIT_WRITE_WINDOW_MS {
        *guard = (now, 0);
    }
    if guard.1 >= AUDIT_WRITE_MAX_PER_WINDOW {
        return Err("Audit write denied: rate limit exceeded".to_string());
    }
    guard.1 += 1;
    Ok(())
}

fn require_admin_auth() -> Result<(), String> {
    AdminAuth::require_authenticated().map_err(|_| {
        "Admin authentication required. Verify your admin password first.".to_string()
    })
}

// ── Password commands ──

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_has_password() -> Result<bool, String> {
    AdminAuth::has_password().map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_set_password(password: String) -> Result<(), String> {
    let has_password = AdminAuth::has_password().map_err(|e| e.to_string())?;
    if has_password {
        require_admin_auth()?;
    }
    AdminAuth::set_password(&password).map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_verify_password(password: String) -> Result<bool, String> {
    let result = AdminAuth::verify_password(&password).map_err(|e| e.to_string())?;
    if result {
        AdminAuth::begin_authenticated_session();
        let _ = crate::core::audit::AuditWriter::write_entry(
            "admin", "admin_access", "user", None, None,
        );
    } else {
        AdminAuth::clear_authenticated_session();
    }
    Ok(result)
}

// ── Audit log commands ──

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_audit_write(
    category: String,
    action: String,
    actor: String,
    target: Option<String>,
    detail: Option<String>,
) -> Result<(), String> {
    let category = category.trim().to_string();
    let action = action.trim().to_string();
    let actor = actor.trim().to_string();

    if !is_safe_token(&category, AUDIT_WRITE_MAX_CATEGORY_LEN) {
        return Err("Audit write denied: invalid category".to_string());
    }
    if !is_safe_token(&action, AUDIT_WRITE_MAX_ACTION_LEN) {
        return Err("Audit write denied: invalid action".to_string());
    }
    if !is_safe_token(&actor, AUDIT_WRITE_MAX_ACTOR_LEN) {
        return Err("Audit write denied: invalid actor".to_string());
    }
    if actor != "user" && actor != "system" {
        return Err("Audit write denied: unsupported actor".to_string());
    }
    let allowed_categories = [
        "admin",
        "agent",
        "capture",
        "fax",
        "notes",
        "registration",
        "settings",
        "softphone",
        "system",
    ];
    if !allowed_categories.contains(&category.as_str()) {
        return Err("Audit write denied: category is not allowed".to_string());
    }
    let allowed_actions = [
        "backup_export",
        "backup_restore",
        "command_failed",
        "command_invoked",
    ];
    if !allowed_actions.contains(&action.as_str()) {
        return Err("Audit write denied: action is not allowed".to_string());
    }

    let target = target.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(
                trimmed
                    .chars()
                    .take(AUDIT_WRITE_MAX_TARGET_LEN)
                    .collect::<String>(),
            )
        }
    });
    let detail = detail.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(
                trimmed
                    .chars()
                    .take(AUDIT_WRITE_MAX_DETAIL_LEN)
                    .collect::<String>(),
            )
        }
    });

    enforce_audit_write_rate_limit()?;

    AuditWriter::write_entry(
        category.as_str(),
        action.as_str(),
        actor.as_str(),
        target.as_deref(),
        detail.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_audit_query(
    filters: AuditQueryFilters,
    page: i64,
    page_size: i64,
) -> Result<AuditQueryResult, String> {
    require_admin_auth()?;
    AuditWriter::query_log(&filters, page, page_size).map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_audit_verify_chain() -> Result<(bool, Option<i64>), String> {
    require_admin_auth()?;
    AuditWriter::verify_chain().map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_audit_stats() -> Result<AuditStats, String> {
    require_admin_auth()?;
    AuditWriter::get_stats().map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_audit_clear(password: String) -> Result<(), String> {
    require_admin_auth()?;
    let valid = AdminAuth::verify_password(&password).map_err(|e| e.to_string())?;
    if !valid {
        return Err("Invalid password".to_string());
    }
    AuditWriter::clear_log().map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_audit_categories() -> Result<Vec<String>, String> {
    require_admin_auth()?;
    AuditWriter::get_categories().map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_audit_actions() -> Result<Vec<String>, String> {
    require_admin_auth()?;
    AuditWriter::get_actions().map_err(|e| e.to_string())
}

// ── Process registry commands ──

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_list_processes() -> Vec<ManagedProcess> {
    if require_admin_auth().is_err() {
        return Vec::new();
    }
    process_registry::list_all()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_kill_process(id: String) -> bool {
    if require_admin_auth().is_err() {
        return false;
    }
    let killed = process_registry::kill(&id);
    if killed {
        let _ = crate::core::audit::AuditWriter::write_entry(
            "admin", "kill_process", "user", Some(&id), None,
        );
    }
    killed
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_clear_process(id: String) -> bool {
    if require_admin_auth().is_err() {
        return false;
    }
    process_registry::clear(&id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_clear_finished_processes() -> usize {
    if require_admin_auth().is_err() {
        return 0;
    }
    process_registry::clear_finished()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_kill_all_processes() -> usize {
    if require_admin_auth().is_err() {
        return 0;
    }
    let killed = process_registry::kill_all_active();
    if killed > 0 {
        let _ = crate::core::audit::AuditWriter::write_entry(
            "admin",
            "kill_process",
            "user",
            Some("all"),
            Some(&format!("killed={}", killed)),
        );
    }
    killed
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_clear_all_processes() -> usize {
    if require_admin_auth().is_err() {
        return 0;
    }
    let cleared = process_registry::clear_all();
    if cleared > 0 {
        let _ = crate::core::audit::AuditWriter::write_entry(
            "admin",
            "kill_process",
            "user",
            Some("all"),
            Some(&format!("cleared={}", cleared)),
        );
    }
    cleared
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_clear_events() -> Result<(), String> {
    require_admin_auth()?;
    AuditWriter::clear_log().map_err(|e| e.to_string())
}

// ── Database inspector commands ──

#[derive(Serialize)]
pub struct TableInfo {
    pub name: String,
    pub row_count: i64,
}

#[derive(Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
}

#[derive(Serialize)]
pub struct DbInfo {
    pub file_size_bytes: u64,
    pub page_count: i64,
    pub page_size: i64,
    pub wal_mode: String,
    pub table_count: usize,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_list_tables() -> Result<Vec<TableInfo>, String> {
    require_admin_auth()?;
    use crate::core::database::Database;
    let conn = Database::get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| e.to_string())?;
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::new();
    for name in tables {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM \"{}\"", name), [], |row| row.get(0))
            .unwrap_or(0);
        result.push(TableInfo { name, row_count: count });
    }
    Ok(result)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_run_query(sql: String) -> Result<QueryResult, String> {
    require_admin_auth()?;
    use crate::core::database::Database;
    let trimmed = sql.trim().to_uppercase();
    if !trimmed.starts_with("SELECT") && !trimmed.starts_with("PRAGMA") && !trimmed.starts_with("EXPLAIN") {
        return Err("Only SELECT, PRAGMA, and EXPLAIN queries are allowed".to_string());
    }
    let conn = Database::get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let col_count = stmt.column_count();
    let columns: Vec<String> = (0..col_count).map(|i| stmt.column_name(i).unwrap_or("?").to_string()).collect();

    let rows: Vec<Vec<serde_json::Value>> = stmt
        .query_map([], |row| {
            let mut vals = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let val: rusqlite::types::Value = row.get(i)?;
                let json_val = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(n) => serde_json::json!(n),
                    rusqlite::types::Value::Real(f) => serde_json::json!(f),
                    rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
                    rusqlite::types::Value::Blob(b) => serde_json::Value::String(format!("<blob {} bytes>", b.len())),
                };
                vals.push(json_val);
            }
            Ok(vals)
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let row_count = rows.len();
    Ok(QueryResult { columns, rows, row_count })
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_vacuum_db() -> Result<(), String> {
    require_admin_auth()?;
    use crate::core::database::Database;
    let conn = Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute_batch("VACUUM").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_get_db_info() -> Result<DbInfo, String> {
    require_admin_auth()?;
    use crate::core::database::Database;
    let file_size_bytes = Database::get_db_size().unwrap_or(0);
    let conn = Database::get_connection().map_err(|e| e.to_string())?;

    let page_count: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap_or(0);
    let page_size: i64 = conn.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap_or(0);
    let journal: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap_or_else(|_| "unknown".to_string());

    let mut stmt = conn.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map_err(|e| e.to_string())?;
    let table_count: usize = stmt.query_row([], |r| r.get::<_, i64>(0)).unwrap_or(0) as usize;

    Ok(DbInfo { file_size_bytes, page_count, page_size, wal_mode: journal, table_count })
}

// ── Feature flags commands ──

#[derive(Serialize)]
pub struct FeatureFlag {
    pub key: String,
    pub enabled: bool,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_list_feature_flags() -> Result<Vec<FeatureFlag>, String> {
    require_admin_auth()?;
    use crate::core::database::Database;
    let conn = Database::get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM global_settings WHERE key LIKE 'flag:%' ORDER BY key")
        .map_err(|e| e.to_string())?;
    let flags: Vec<FeatureFlag> = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok(FeatureFlag {
                key: key.strip_prefix("flag:").unwrap_or(&key).to_string(),
                enabled: value == "1" || value == "true",
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(flags)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_set_feature_flag(key: String, enabled: bool) -> Result<(), String> {
    require_admin_auth()?;
    use crate::core::database::Database;
    let conn = Database::get_connection().map_err(|e| e.to_string())?;
    let db_key = format!("flag:{}", key);
    let value = if enabled { "1" } else { "0" };
    conn.execute(
        "INSERT INTO global_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        rusqlite::params![db_key, value],
    )
    .map_err(|e| e.to_string())?;

    let _ = crate::core::audit::AuditWriter::write_entry(
        "admin",
        "toggle_feature_flag",
        "user",
        Some(&key),
        Some(if enabled { "enabled" } else { "disabled" }),
    );
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_get_feature_flag(key: String) -> Result<bool, String> {
    require_admin_auth()?;
    use crate::core::database::Database;
    let conn = Database::get_connection().map_err(|e| e.to_string())?;
    let db_key = format!("flag:{}", key);
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM global_settings WHERE key = ?1",
            rusqlite::params![db_key],
            |row| row.get(0),
        )
        .ok();
    Ok(result.map(|v| v == "1" || v == "true").unwrap_or(false))
}

// ── System health commands ──

#[derive(Serialize)]
pub struct SystemHealth {
    pub uptime_seconds: u64,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub cpu_usage_percent: f32,
    pub db_size_bytes: u64,
    pub active_processes: usize,
    pub process_counts: std::collections::HashMap<String, usize>,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn admin_get_system_health() -> Result<SystemHealth, String> {
    require_admin_auth()?;
    use sysinfo::System;
    use crate::core::database::Database;

    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();

    let db_size = Database::get_db_size().unwrap_or(0);

    let all = process_registry::list_all();
    let mut process_counts = std::collections::HashMap::new();
    for p in &all {
        *process_counts.entry(p.kind.clone()).or_insert(0usize) += 1;
    }

    Ok(SystemHealth {
        uptime_seconds: System::uptime(),
        memory_used_mb: sys.used_memory() / (1024 * 1024),
        memory_total_mb: sys.total_memory() / (1024 * 1024),
        cpu_usage_percent: sys.global_cpu_usage(),
        db_size_bytes: db_size,
        active_processes: process_registry::count_running(),
        process_counts,
    })
}
