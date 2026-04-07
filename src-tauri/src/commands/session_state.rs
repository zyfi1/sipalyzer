//! Session state persistence backed by the encrypted SQLite database.

use crate::core::config;
use crate::core::database::Database;
use std::fs;
use tauri::command;

const SESSION_KEY: &str = "state";
const LEGACY_FILENAME: &str = "session_state.json";

/// Pull the full session-state JSON blob from the database.
/// On first run, migrates data from the legacy `session_state.json` file if present.
#[command]
#[tracing::instrument(skip_all)]
pub fn pull_session_state() -> Result<Option<String>, String> {
    // Try the DB first
    let existing = Database::get_session_value(SESSION_KEY).map_err(|e| e.to_string())?;
    if existing.is_some() {
        return Ok(existing);
    }

    // One-time migration: import from legacy JSON file
    if let Ok(config_dir) = config::get_config_dir() {
        let legacy_path = config_dir.join(LEGACY_FILENAME);
        if legacy_path.exists() {
            if let Ok(content) = fs::read_to_string(&legacy_path) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    // Write into DB
                    if let Err(e) = Database::set_session_value(SESSION_KEY, trimmed) {
                        tracing::error!("migration write failed: {}", e);
                    } else {
                        tracing::info!("migrated legacy session_state.json into DB");
                        // Remove the old file (and its .tmp sibling) so we don't re-migrate
                        let _ = fs::remove_file(&legacy_path);
                        let _ =
                            fs::remove_file(config_dir.join(format!("{}.tmp", LEGACY_FILENAME)));
                        return Ok(Some(trimmed.to_string()));
                    }
                }
            }
        }
    }

    Ok(None)
}

/// Push the full session-state JSON blob into the database (ACID upsert).
#[command]
#[tracing::instrument(skip_all)]
pub fn push_session_state(json: String) -> Result<(), String> {
    Database::set_session_value(SESSION_KEY, &json).map_err(|e| e.to_string())
}
