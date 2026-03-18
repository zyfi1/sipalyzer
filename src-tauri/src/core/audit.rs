use anyhow::{Context, Result};
use getrandom::fill as fill_random;
use hmac::{Hmac, Mac};
use once_cell::sync::Lazy;
use rusqlite::params;
use sha2::Sha256;
use serde::{Deserialize, Serialize};

use super::database::Database;

type HmacSha256 = Hmac<Sha256>;

const AUDIT_HMAC_SESSION_KEY: &str = "audit_hmac_key_v1";

static HMAC_KEY: Lazy<Vec<u8>> = Lazy::new(|| {
    // Highest-priority source: explicit runtime secret (for managed deployments/rotation).
    if let Ok(env_key) = std::env::var("SIPALYZER_AUDIT_HMAC_KEY") {
        let trimmed = env_key.trim();
        if !trimmed.is_empty() {
            return trimmed.as_bytes().to_vec();
        }
    }

    // Persistent local secret for standalone installs.
    if let Ok(Some(stored_hex)) = Database::get_session_value(AUDIT_HMAC_SESSION_KEY) {
        if let Ok(bytes) = hex::decode(stored_hex.trim()) {
            if bytes.len() >= 32 {
                return bytes;
            }
        }
    }

    // Generate and persist a new random key.
    let mut key = [0u8; 32];
    if fill_random(&mut key).is_ok() {
        let encoded = hex::encode(key);
        let _ = Database::set_session_value(AUDIT_HMAC_SESSION_KEY, &encoded);
        return key.to_vec();
    }

    // Last-resort fallback: unique per run context (prevents static shared key).
    format!("audit-key-fallback-{}", uuid::Uuid::new_v4())
        .into_bytes()
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: i64,
    pub seq: i64,
    pub timestamp: String,
    pub category: String,
    pub action: String,
    pub actor: String,
    pub target: Option<String>,
    pub detail: Option<String>,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditQueryFilters {
    pub category: Option<String>,
    pub action: Option<String>,
    pub actor: Option<String>,
    pub search: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditQueryResult {
    pub entries: Vec<AuditEntry>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditStats {
    pub total_entries: i64,
    pub earliest: Option<String>,
    pub latest: Option<String>,
    pub chain_valid: bool,
}

pub struct AuditWriter;

impl AuditWriter {
    /// Write a new audit entry with chained HMAC checksum.
    pub fn write_entry(
        category: &str,
        action: &str,
        actor: &str,
        target: Option<&str>,
        detail: Option<&str>,
    ) -> Result<()> {
        let conn = Database::get_connection()?;
        let timestamp = chrono::Utc::now().to_rfc3339();

        let (last_seq, last_checksum) = Self::get_last_entry(&conn)?;
        let new_seq = last_seq + 1;

        let checksum = Self::compute_checksum(
            &last_checksum,
            new_seq,
            &timestamp,
            category,
            action,
            actor,
            target,
            detail,
        );

        conn.execute(
            "INSERT INTO audit_log (seq, timestamp, category, action, actor, target, detail, checksum)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![new_seq, timestamp, category, action, actor, target, detail, checksum],
        )
        .context("Failed to write audit entry")?;

        Ok(())
    }

    /// Verify the HMAC chain. Returns (valid, broken_at_seq).
    /// After retention pruning, the first entry's predecessor may be gone,
    /// so we accept the first entry's checksum as the chain start and verify
    /// consecutive integrity from there.
    pub fn verify_chain() -> Result<(bool, Option<i64>)> {
        let conn = Database::get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, seq, timestamp, category, action, actor, target, detail, checksum
             FROM audit_log ORDER BY seq ASC",
        )?;

        let entries = stmt.query_map([], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                seq: row.get(1)?,
                timestamp: row.get(2)?,
                category: row.get(3)?,
                action: row.get(4)?,
                actor: row.get(5)?,
                target: row.get(6)?,
                detail: row.get(7)?,
                checksum: row.get(8)?,
            })
        })?;

        let mut prev_checksum = String::new();
        let mut is_first = true;

        for entry_result in entries {
            let entry = entry_result?;
            let expected = Self::compute_checksum(
                &prev_checksum,
                entry.seq,
                &entry.timestamp,
                &entry.category,
                &entry.action,
                &entry.actor,
                entry.target.as_deref(),
                entry.detail.as_deref(),
            );
            if expected != entry.checksum {
                if is_first && entry.seq > 1 {
                    // First entry's predecessor was pruned; trust its stored checksum
                    prev_checksum = entry.checksum;
                    is_first = false;
                    continue;
                }
                return Ok((false, Some(entry.seq)));
            }
            prev_checksum = entry.checksum;
            is_first = false;
        }

        Ok((true, None))
    }

    /// Query the audit log with pagination and filters.
    pub fn query_log(
        filters: &AuditQueryFilters,
        page: i64,
        page_size: i64,
    ) -> Result<AuditQueryResult> {
        let conn = Database::get_connection()?;

        let mut where_clauses = Vec::new();
        let mut bind_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref cat) = filters.category {
            bind_values.push(Box::new(cat.clone()));
            where_clauses.push(format!("category = ?{}", bind_values.len()));
        }
        if let Some(ref act) = filters.action {
            bind_values.push(Box::new(act.clone()));
            where_clauses.push(format!("action = ?{}", bind_values.len()));
        }
        if let Some(ref a) = filters.actor {
            bind_values.push(Box::new(a.clone()));
            where_clauses.push(format!("actor = ?{}", bind_values.len()));
        }
        if let Some(ref s) = filters.search {
            let pattern = format!("%{}%", s);
            bind_values.push(Box::new(pattern.clone()));
            let idx = bind_values.len();
            bind_values.push(Box::new(pattern));
            let idx2 = bind_values.len();
            where_clauses.push(format!("(target LIKE ?{} OR detail LIKE ?{})", idx, idx2));
        }
        if let Some(ref from) = filters.from_date {
            bind_values.push(Box::new(from.clone()));
            where_clauses.push(format!("timestamp >= ?{}", bind_values.len()));
        }
        if let Some(ref to) = filters.to_date {
            bind_values.push(Box::new(to.clone()));
            where_clauses.push(format!("timestamp <= ?{}", bind_values.len()));
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        let count_sql = format!("SELECT COUNT(*) FROM audit_log {}", where_sql);
        let refs: Vec<&dyn rusqlite::types::ToSql> = bind_values.iter().map(|b| b.as_ref()).collect();
        let total: i64 = conn.query_row(&count_sql, refs.as_slice(), |row| row.get(0))?;

        let offset = page * page_size;
        bind_values.push(Box::new(page_size));
        let limit_idx = bind_values.len();
        bind_values.push(Box::new(offset));
        let offset_idx = bind_values.len();

        let query_sql = format!(
            "SELECT id, seq, timestamp, category, action, actor, target, detail, checksum
             FROM audit_log {} ORDER BY seq DESC LIMIT ?{} OFFSET ?{}",
            where_sql, limit_idx, offset_idx
        );

        let refs2: Vec<&dyn rusqlite::types::ToSql> = bind_values.iter().map(|b| b.as_ref()).collect();
        let mut stmt = conn.prepare(&query_sql)?;
        let entries: Vec<AuditEntry> = stmt
            .query_map(refs2.as_slice(), |row| {
                Ok(AuditEntry {
                    id: row.get(0)?,
                    seq: row.get(1)?,
                    timestamp: row.get(2)?,
                    category: row.get(3)?,
                    action: row.get(4)?,
                    actor: row.get(5)?,
                    target: row.get(6)?,
                    detail: row.get(7)?,
                    checksum: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(AuditQueryResult {
            entries,
            total,
            page,
            page_size,
        })
    }

    /// Get audit log statistics.
    pub fn get_stats() -> Result<AuditStats> {
        let conn = Database::get_connection()?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM audit_log",
            [],
            |row| row.get(0),
        )?;

        let earliest: Option<String> = conn
            .query_row("SELECT timestamp FROM audit_log ORDER BY seq ASC LIMIT 1", [], |row| row.get(0))
            .ok();
        let latest: Option<String> = conn
            .query_row("SELECT timestamp FROM audit_log ORDER BY seq DESC LIMIT 1", [], |row| row.get(0))
            .ok();

        let (chain_valid, _) = Self::verify_chain()?;

        Ok(AuditStats {
            total_entries: total,
            earliest,
            latest,
            chain_valid,
        })
    }

    /// Clear all audit entries. Writes a genesis "audit_clear" entry after clearing.
    pub fn clear_log() -> Result<()> {
        let conn = Database::get_connection()?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))?;

        conn.execute("DELETE FROM audit_log", [])?;

        // Write genesis entry for the new chain
        let timestamp = chrono::Utc::now().to_rfc3339();
        let new_seq: i64 = 1;
        let detail = format!("{{\"cleared_entries\":{}}}", count);
        let checksum = Self::compute_checksum(
            "",
            new_seq,
            &timestamp,
            "admin",
            "audit_clear",
            "user",
            None,
            Some(&detail),
        );

        conn.execute(
            "INSERT INTO audit_log (seq, timestamp, category, action, actor, target, detail, checksum)
             VALUES (?1, ?2, 'admin', 'audit_clear', 'user', NULL, ?3, ?4)",
            params![new_seq, timestamp, detail, checksum],
        )?;

        Ok(())
    }

    /// Get distinct categories from the log.
    pub fn get_categories() -> Result<Vec<String>> {
        let conn = Database::get_connection()?;
        let mut stmt = conn.prepare("SELECT DISTINCT category FROM audit_log ORDER BY category")?;
        let cats: Vec<String> = stmt.query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(cats)
    }

    /// Get distinct actions from the log.
    pub fn get_actions() -> Result<Vec<String>> {
        let conn = Database::get_connection()?;
        let mut stmt = conn.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action")?;
        let acts: Vec<String> = stmt.query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(acts)
    }

    /// Delete entries older than `retention_days` days.
    /// Returns the number of pruned entries.
    pub fn prune_old_entries(retention_days: i64) -> Result<usize> {
        let conn = Database::get_connection()?;
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(retention_days)).to_rfc3339();
        let deleted = conn.execute(
            "DELETE FROM audit_log WHERE timestamp < ?1",
            params![cutoff],
        )?;
        Ok(deleted)
    }

    // ── Private helpers ──

    fn get_last_entry(conn: &rusqlite::Connection) -> Result<(i64, String)> {
        let result = conn.query_row(
            "SELECT seq, checksum FROM audit_log ORDER BY seq DESC LIMIT 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        );
        match result {
            Ok(pair) => Ok(pair),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok((0, String::new())),
            Err(e) => Err(e.into()),
        }
    }

    fn compute_checksum(
        prev_checksum: &str,
        seq: i64,
        timestamp: &str,
        category: &str,
        action: &str,
        actor: &str,
        target: Option<&str>,
        detail: Option<&str>,
    ) -> String {
        let mut mac =
            HmacSha256::new_from_slice(HMAC_KEY.as_slice()).expect("HMAC accepts any key length");
        mac.update(prev_checksum.as_bytes());
        mac.update(seq.to_string().as_bytes());
        mac.update(timestamp.as_bytes());
        mac.update(category.as_bytes());
        mac.update(action.as_bytes());
        mac.update(actor.as_bytes());
        mac.update(target.unwrap_or("").as_bytes());
        mac.update(detail.unwrap_or("").as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }
}
