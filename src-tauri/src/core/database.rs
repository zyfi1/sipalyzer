use crate::core::config;
use anyhow::{bail, Context, Result};
use getrandom::fill as fill_random;
use hmac::{Hmac, Mac};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;
const INSTALL_SECRET_FILE: &str = "install_secret_v1.key";
const DB_KEY_CONTEXT: &[u8] = b"sipalyzer-sqlcipher-key-v2";
const CREDENTIAL_KEY_CONTEXT: &[u8] = b"sipalyzer-credentials-aead-v1";

pub struct Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteVersion {
    pub id: String,
    pub note_id: String,
    pub title: String,
    pub content: String,
    pub version_number: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteTemplate {
    pub id: String,
    pub name: String,
    pub title_template: String,
    pub content_template: String,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    /// Get path to encrypted database file.
    ///
    /// Resolution order (portable-first):
    /// 1. Look for a `data/` directory next to the app binary (or next to the
    ///    `.app` bundle on macOS). If it exists and is writable, use it.
    /// 2. Fall back to the standard config directory
    ///    (`~/Library/Application Support/sipalyzer/` on macOS).
    fn get_db_path() -> Result<PathBuf> {
        if let Some(portable_dir) = Self::portable_data_dir() {
            let db = portable_dir.join("data.db");
            // If the directory already exists, use it (portable mode).
            if portable_dir.is_dir() {
                return Ok(db);
            }
        }
        // Default: standard config directory
        Ok(config::get_config_dir()?.join("data.db"))
    }

    /// Try to locate a `data/` directory next to the running executable
    /// (or next to the `.app` bundle on macOS).
    fn portable_data_dir() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        // `exe` is e.g. /path/to/SIPalyzer.app/Contents/MacOS/sipalyzer on macOS
        let base = exe.parent()?.to_path_buf();

        // On macOS, walk up from Contents/MacOS to the folder containing the .app
        #[cfg(target_os = "macos")]
        let base = {
            let mut base = base;
            // Check if we're inside a .app bundle
            // Typical: Foo.app/Contents/MacOS/binary
            if let Some(ancestor) = base.parent().and_then(|p| p.parent()) {
                if ancestor
                    .file_name()
                    .map(|n| n.to_string_lossy().ends_with(".app"))
                    .unwrap_or(false)
                {
                    // `ancestor` is the .app dir; its parent is the folder containing it
                    if let Some(app_parent) = ancestor.parent() {
                        base = app_parent.to_path_buf();
                    }
                }
            }
            base
        };

        Some(base.join("data"))
    }

    fn legacy_derive_key() -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"sipalyzer-master-key-v1");
        hasher.update(b"sipalyzer-credential-salt-v1");
        hex::encode(hasher.finalize())
    }

    fn derive_subkey_from_secret(secret: &[u8], context: &[u8]) -> Result<[u8; 32]> {
        let mut mac = HmacSha256::new_from_slice(secret)
            .context("Failed to initialize key derivation HMAC")?;
        mac.update(context);
        let bytes = mac.finalize().into_bytes();
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        Ok(out)
    }

    fn derive_db_key_from_secret(secret: &[u8]) -> Result<String> {
        let key = Self::derive_subkey_from_secret(secret, DB_KEY_CONTEXT)?;
        Ok(hex::encode(key))
    }

    fn install_secret_path(config_dir: &Path) -> PathBuf {
        config_dir.join(INSTALL_SECRET_FILE)
    }

    fn load_or_create_install_secret_at(config_dir: &Path) -> Result<Vec<u8>> {
        let path = Self::install_secret_path(config_dir);

        if path.exists() {
            let raw = fs::read_to_string(&path).context("Failed to read install secret file")?;
            let secret = hex::decode(raw.trim()).context("Install secret file is invalid")?;
            if secret.len() != 32 {
                bail!("Install secret has invalid length");
            }
            return Ok(secret);
        }

        let mut secret = vec![0u8; 32];
        fill_random(&mut secret).context("Failed to generate install secret")?;
        fs::write(&path, hex::encode(&secret)).context("Failed to write install secret file")?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }

        Ok(secret)
    }

    pub(crate) fn derive_install_subkey(context: &[u8]) -> Result<[u8; 32]> {
        let config_dir = config::get_config_dir()?;
        let secret = Self::load_or_create_install_secret_at(&config_dir)?;
        Self::derive_subkey_from_secret(&secret, context)
    }

    pub(crate) fn credential_key_context() -> &'static [u8] {
        CREDENTIAL_KEY_CONTEXT
    }

    fn open_sqlcipher_connection(db_path: &Path, key: &str) -> Result<Connection> {
        let conn = Connection::open(db_path).context("Failed to open database")?;
        conn.pragma_update(None, "key", key)
            .context("Failed to set encryption key")?;
        conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| {
            row.get::<_, i64>(0)
        })
        .context("Failed to validate SQLCipher key")?;
        Ok(conn)
    }

    fn get_connection_with_paths(db_path: &Path, config_dir: &Path) -> Result<Connection> {
        let legacy_key = Self::legacy_derive_key();
        let secret = Self::load_or_create_install_secret_at(config_dir)?;
        let current_key = Self::derive_db_key_from_secret(&secret)?;

        if let Ok(conn) = Self::open_sqlcipher_connection(db_path, &current_key) {
            return Ok(conn);
        }

        let legacy_conn = Self::open_sqlcipher_connection(db_path, &legacy_key)
            .context("Failed to unlock database with current and legacy keys")?;

        if current_key != legacy_key {
            if let Err(err) = legacy_conn.pragma_update(None, "rekey", current_key.as_str()) {
                tracing::warn!("database key migration failed, continuing with legacy key: {err}");
            } else if let Err(err) =
                legacy_conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| {
                    row.get::<_, i64>(0)
                })
            {
                tracing::warn!("database validation failed after key migration: {err}");
            } else {
                tracing::info!("database key material migrated to per-install secret");
            }
        }

        Ok(legacy_conn)
    }

    /// Get database file size in bytes.
    pub fn get_db_size() -> Result<u64> {
        let path = Self::get_db_path()?;
        let meta = std::fs::metadata(&path).context("DB file not found")?;
        Ok(meta.len())
    }

    /// Get or create encrypted database connection
    pub fn get_connection() -> Result<Connection> {
        let db_path = Self::get_db_path()?;
        let config_dir = config::get_config_dir()?;
        let conn = Self::get_connection_with_paths(&db_path, &config_dir)?;

        // Initialize schema if needed
        Self::init_schema(&conn)?;

        Ok(conn)
    }

    /// Initialize database schema
    fn init_schema(conn: &Connection) -> Result<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS registrars (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                domain TEXT NOT NULL,
                remote_port INTEGER NOT NULL,
                local_port INTEGER,
                transport TEXT NOT NULL,
                username TEXT NOT NULL,
                auth_username TEXT,
                password TEXT NOT NULL,
                realm TEXT,
                timeout_seconds INTEGER NOT NULL,
                retry_count INTEGER NOT NULL,
                register_interval_seconds INTEGER,
                tags TEXT,
                group_name TEXT,
                custom_headers TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS global_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS session_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            ) WITHOUT ROWID",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS test_results (
                id TEXT PRIMARY KEY,
                registrar_id TEXT NOT NULL,
                test_type TEXT NOT NULL,
                result TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                diagnostics TEXT,
                FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Create index for faster queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_test_results_registrar ON test_results(registrar_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_test_results_timestamp ON test_results(timestamp)",
            [],
        )?;

        // Create note_folders table (must be before notes for foreign key)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT,
                path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (parent_id) REFERENCES note_folders(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Create notes table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT NOT NULL,
                linked_registrar_id TEXT,
                linked_agent_id TEXT,
                category TEXT,
                is_pinned INTEGER DEFAULT 0,
                linked_note_ids TEXT,
                folder_id TEXT,
                version INTEGER DEFAULT 1,
                template_id TEXT,
                search_vector TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                FOREIGN KEY (linked_registrar_id) REFERENCES registrars(id) ON DELETE SET NULL,
                FOREIGN KEY (folder_id) REFERENCES note_folders(id) ON DELETE SET NULL
            )",
            [],
        )?;

        // Create note_versions table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note_versions (
                id TEXT PRIMARY KEY,
                note_id TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Create note_templates table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                title_template TEXT NOT NULL,
                content_template TEXT NOT NULL,
                category TEXT,
                tags TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Create registrar_folders table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS registrar_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        // Migrate existing notes table to add new columns if they don't exist
        Self::migrate_notes_table(conn)?;
        // Migrate registrars table (e.g. rtp_port)
        Self::migrate_registrars_table(conn)?;
        // Migrate capture_sessions table (add source column for remote captures)
        Self::migrate_capture_sessions_table(conn)?;

        // Create indexes for notes
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_registrar ON notes(linked_registrar_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_agent ON notes(linked_agent_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_search ON notes(search_vector)",
            [],
        )?;

        // Only create indexes for new columns if they exist
        let has_category = Self::column_exists(conn, "notes", "category")?;
        if has_category {
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category)",
                [],
            )?;
        }

        let has_pinned = Self::column_exists(conn, "notes", "is_pinned")?;
        if has_pinned {
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(is_pinned)",
                [],
            )?;
        }

        // Create indexes for note_versions
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_versions_note_id ON note_versions(note_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_versions_created ON note_versions(created_at)",
            [],
        )?;

        // Create indexes for note_folders
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_folders_parent ON note_folders(parent_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_folders_path ON note_folders(path)",
            [],
        )?;

        // Create FTS5 virtual table for full-text search
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                id UNINDEXED,
                title,
                content,
                content_rowid=id
            )",
            [],
        )?;

        // Create capture_sessions table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS capture_sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                interface TEXT NOT NULL,
                filter_config TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                status TEXT NOT NULL,
                packet_count INTEGER NOT NULL DEFAULT 0,
                file_path TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS saved_filters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                filter_config TEXT NOT NULL,
                bpf_expression TEXT,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS packet_bookmarks (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                packet_index INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                note TEXT,
                tags TEXT,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        // Create index for capture sessions
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_capture_sessions_start_time ON capture_sessions(start_time)",
            [],
        )?;

        // Create scheduled_captures table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS scheduled_captures (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                interface TEXT NOT NULL,
                filter_config TEXT NOT NULL,
                schedule_type TEXT NOT NULL,
                scheduled_time TEXT NOT NULL,
                duration_seconds INTEGER,
                enabled INTEGER NOT NULL DEFAULT 1,
                last_run TEXT,
                next_run TEXT,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        // Create index for scheduled captures
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_scheduled_captures_next_run ON scheduled_captures(next_run)",
            [],
        )?;

        // Audit log table — immutable, HMAC-chained entries
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_log (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                seq       INTEGER NOT NULL UNIQUE,
                timestamp TEXT NOT NULL,
                category  TEXT NOT NULL,
                action    TEXT NOT NULL,
                actor     TEXT NOT NULL DEFAULT 'user',
                target    TEXT,
                detail    TEXT,
                checksum  TEXT NOT NULL
            )",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log(category)",
            [],
        )?;

        // Set default settings if not exist
        conn.execute(
            "INSERT OR IGNORE INTO global_settings (key, value) VALUES 
             ('default_local_port', '5060'),
             ('log_level', 'info')",
            [],
        )?;

        Ok(())
    }

    /// Check if a column exists in a table
    fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
        let query = format!(
            "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1",
            table
        );
        let count: i32 = conn.query_row(&query, params![column], |row| row.get(0))?;
        Ok(count > 0)
    }

    /// Migrate notes table to add new columns
    fn migrate_notes_table(conn: &Connection) -> Result<()> {
        // Check if table exists
        let table_exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='notes'",
            [],
            |row| row.get(0),
        )?;

        if table_exists == 0 {
            return Ok(()); // Table doesn't exist, will be created by CREATE TABLE
        }

        // Add category column if it doesn't exist
        if !Self::column_exists(conn, "notes", "category")? {
            conn.execute("ALTER TABLE notes ADD COLUMN category TEXT", [])?;
        }

        // Add is_pinned column if it doesn't exist
        if !Self::column_exists(conn, "notes", "is_pinned")? {
            conn.execute(
                "ALTER TABLE notes ADD COLUMN is_pinned INTEGER DEFAULT 0",
                [],
            )?;
        }

        // Add linked_note_ids column if it doesn't exist
        if !Self::column_exists(conn, "notes", "linked_note_ids")? {
            conn.execute("ALTER TABLE notes ADD COLUMN linked_note_ids TEXT", [])?;
        }

        // Add folder_id column if it doesn't exist
        if !Self::column_exists(conn, "notes", "folder_id")? {
            conn.execute("ALTER TABLE notes ADD COLUMN folder_id TEXT", [])?;
        }

        // Add version column if it doesn't exist
        if !Self::column_exists(conn, "notes", "version")? {
            conn.execute("ALTER TABLE notes ADD COLUMN version INTEGER DEFAULT 1", [])?;
        }

        // Add template_id column if it doesn't exist
        if !Self::column_exists(conn, "notes", "template_id")? {
            conn.execute("ALTER TABLE notes ADD COLUMN template_id TEXT", [])?;
        }

        // Add search_vector column if it doesn't exist
        if !Self::column_exists(conn, "notes", "search_vector")? {
            conn.execute("ALTER TABLE notes ADD COLUMN search_vector TEXT", [])?;
        }

        // Add linked_agent_id column if it doesn't exist
        if !Self::column_exists(conn, "notes", "linked_agent_id")? {
            conn.execute("ALTER TABLE notes ADD COLUMN linked_agent_id TEXT", [])?;
        }

        // Add deleted_at column for soft-delete support
        if !Self::column_exists(conn, "notes", "deleted_at")? {
            conn.execute("ALTER TABLE notes ADD COLUMN deleted_at TEXT", [])?;
        }

        Ok(())
    }

    /// Migrate registrars table to add new columns (e.g. rtp_port)
    fn migrate_registrars_table(conn: &Connection) -> Result<()> {
        let table_exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='registrars'",
            [],
            |row| row.get(0),
        )?;
        if table_exists == 0 {
            return Ok(());
        }
        if !Self::column_exists(conn, "registrars", "rtp_port")? {
            conn.execute("ALTER TABLE registrars ADD COLUMN rtp_port INTEGER", [])?;
        }
        if !Self::column_exists(conn, "registrars", "listening_port")? {
            conn.execute(
                "ALTER TABLE registrars ADD COLUMN listening_port INTEGER",
                [],
            )?;
        }
        if !Self::column_exists(conn, "registrars", "use_case")? {
            conn.execute("ALTER TABLE registrars ADD COLUMN use_case TEXT", [])?;
        }
        if !Self::column_exists(conn, "registrars", "voicemail_number")? {
            conn.execute(
                "ALTER TABLE registrars ADD COLUMN voicemail_number TEXT",
                [],
            )?;
        }
        if !Self::column_exists(conn, "registrars", "mwi_enabled")? {
            conn.execute(
                "ALTER TABLE registrars ADD COLUMN mwi_enabled INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !Self::column_exists(conn, "registrars", "auto_register")? {
            conn.execute(
                "ALTER TABLE registrars ADD COLUMN auto_register INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !Self::column_exists(conn, "registrars", "sort_order")? {
            conn.execute(
                "ALTER TABLE registrars ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
            // Backfill: assign sort_order based on rowid so existing registrars keep stable order
            conn.execute(
                "UPDATE registrars SET sort_order = rowid WHERE sort_order = 0",
                [],
            )?;
        }
        Ok(())
    }

    /// Migrate capture_sessions table to add source column for remote captures,
    /// folder_id and tags columns for organization.
    fn migrate_capture_sessions_table(conn: &Connection) -> Result<()> {
        let table_exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='capture_sessions'",
            [],
            |row| row.get(0),
        )?;
        if table_exists == 0 {
            return Ok(());
        }
        if !Self::column_exists(conn, "capture_sessions", "source")? {
            conn.execute("ALTER TABLE capture_sessions ADD COLUMN source TEXT", [])?;
        }
        // Folder assignment for capture sessions
        if !Self::column_exists(conn, "capture_sessions", "folder_id")? {
            conn.execute("ALTER TABLE capture_sessions ADD COLUMN folder_id TEXT", [])?;
        }
        // Tags stored as JSON array (e.g. '["sip","debug"]')
        if !Self::column_exists(conn, "capture_sessions", "tags")? {
            conn.execute(
                "ALTER TABLE capture_sessions ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
                [],
            )?;
        }
        // Flat folder table for organizing capture sessions
        conn.execute(
            "CREATE TABLE IF NOT EXISTS capture_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )",
            [],
        )?;
        Ok(())
    }

    /// Save registrar to database
    pub fn save_registrar(registrar: &crate::core::config::RegistrarConfig) -> Result<()> {
        let conn = Self::get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();

        let tags_json = serde_json::to_string(&registrar.tags)?;
        let headers_json = serde_json::to_string(&registrar.custom_headers)?;
        let transport_str = match registrar.transport {
            crate::core::config::TransportType::Udp => "udp",
            crate::core::config::TransportType::Tcp => "tcp",
            crate::core::config::TransportType::Tls => "tls",
            crate::core::config::TransportType::Wss => "wss",
        };

        // Check if registrar exists to preserve created_at
        let existing_created_at: Option<String> = conn
            .query_row(
                "SELECT created_at FROM registrars WHERE id = ?1",
                params![registrar.id],
                |row| row.get(0),
            )
            .ok();

        let created_at = existing_created_at.unwrap_or_else(|| now.clone());

        conn.execute(
            "INSERT OR REPLACE INTO registrars (
                id, name, domain, remote_port, local_port, transport,
                username, auth_username, password, realm,
                timeout_seconds, retry_count, register_interval_seconds,
                tags, group_name, use_case, rtp_port, listening_port, custom_headers,
                voicemail_number, mwi_enabled, auto_register, sort_order, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
            params![
                registrar.id,
                registrar.name,
                registrar.domain,
                registrar.remote_port,
                registrar.local_port,
                transport_str,
                registrar.username,
                registrar.auth_username,
                registrar.password,
                registrar.realm,
                registrar.timeout_seconds,
                registrar.retry_count,
                registrar.register_interval_seconds,
                tags_json,
                registrar.group,
                registrar.use_case,
                registrar.rtp_port,
                registrar.listening_port,
                headers_json,
                registrar.voicemail_number,
                registrar.mwi_enabled,
                registrar.auto_register,
                registrar.sort_order,
                created_at,
                now,
            ],
        )?;

        Ok(())
    }

    /// Load all registrars from database
    pub fn load_registrars() -> Result<Vec<crate::core::config::RegistrarConfig>> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, domain, remote_port, local_port, transport,
                    username, auth_username, password, realm,
                    timeout_seconds, retry_count, register_interval_seconds,
                    tags, group_name, use_case, rtp_port, listening_port, custom_headers,
                    voicemail_number, mwi_enabled, auto_register, sort_order
             FROM registrars ORDER BY sort_order, name",
        )?;

        let rows = stmt.query_map([], |row| Self::row_to_registrar(row))?;

        let mut registrars = Vec::new();
        for row in rows {
            registrars.push(row?);
        }

        Ok(registrars)
    }

    /// Convert database row to RegistrarConfig
    fn row_to_registrar(
        row: &Row,
    ) -> Result<crate::core::config::RegistrarConfig, rusqlite::Error> {
        let transport_str: String = row.get(5)?;
        let transport = match transport_str.as_str() {
            "udp" => crate::core::config::TransportType::Udp,
            "tcp" => crate::core::config::TransportType::Tcp,
            "tls" => crate::core::config::TransportType::Tls,
            "wss" => crate::core::config::TransportType::Wss,
            _ => {
                return Err(rusqlite::Error::InvalidColumnType(
                    5,
                    transport_str,
                    rusqlite::types::Type::Text,
                ));
            }
        };

        let tags_json: String = row.get(13)?;
        let use_case: Option<String> = row.get::<_, Option<String>>(15).unwrap_or(None);
        let rtp_port: Option<u16> = row
            .get::<_, Option<i64>>(16)
            .ok()
            .flatten()
            .and_then(|v| v.try_into().ok());
        let listening_port: Option<u16> = row
            .get::<_, Option<i64>>(17)
            .ok()
            .flatten()
            .and_then(|v| v.try_into().ok());
        let headers_json: String = row.get(18)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        let headers: Vec<crate::core::config::CustomHeader> =
            serde_json::from_str(&headers_json).unwrap_or_default();

        let voicemail_number: Option<String> = row.get::<_, Option<String>>(19).unwrap_or(None);
        let mwi_enabled: bool = row
            .get::<_, Option<bool>>(20)
            .unwrap_or(Some(false))
            .unwrap_or(false);
        let auto_register: bool = row
            .get::<_, Option<bool>>(21)
            .unwrap_or(Some(false))
            .unwrap_or(false);
        let sort_order: i64 = row
            .get::<_, Option<i64>>(22)
            .unwrap_or(Some(0))
            .unwrap_or(0);

        Ok(crate::core::config::RegistrarConfig {
            id: row.get(0)?,
            name: row.get(1)?,
            domain: row.get(2)?,
            remote_port: row.get(3)?,
            local_port: row.get(4)?,
            transport,
            username: row.get(6)?,
            auth_username: row.get(7)?,
            password: row.get(8)?,
            realm: row.get(9)?,
            timeout_seconds: row.get(10)?,
            retry_count: row.get(11)?,
            register_interval_seconds: row.get(12)?,
            tags,
            group: row.get(14)?,
            use_case,
            rtp_port,
            listening_port,
            custom_headers: headers,
            voicemail_number,
            mwi_enabled,
            auto_register,
            sort_order,
        })
    }

    /// Delete registrar from database
    pub fn delete_registrar(id: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute("DELETE FROM registrars WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Registrar Folders ───────────────────────────────────────────────

    /// Load all registrar folders ordered by sort_order.
    pub fn load_registrar_folders() -> Result<Vec<(String, String, i64, String)>> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, sort_order, created_at FROM registrar_folders ORDER BY sort_order, name"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut folders = Vec::new();
        for row in rows {
            folders.push(row?);
        }
        Ok(folders)
    }

    /// Save a registrar folder (insert or replace).
    pub fn save_registrar_folder(
        id: &str,
        name: &str,
        sort_order: i64,
        created_at: &str,
    ) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO registrar_folders (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, sort_order, created_at],
        )?;
        Ok(())
    }

    /// Rename a registrar folder.
    pub fn rename_registrar_folder(id: &str, name: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute(
            "UPDATE registrar_folders SET name = ?2 WHERE id = ?1",
            params![id, name],
        )?;
        Ok(())
    }

    /// Delete a registrar folder and ungroup its registrars.
    pub fn delete_registrar_folder(id: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        // Ungroup registrars that belong to this folder
        conn.execute(
            "UPDATE registrars SET group_name = NULL WHERE group_name = ?1",
            params![id],
        )?;
        conn.execute("DELETE FROM registrar_folders WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Reorder registrars: given an ordered list of IDs, set sort_order = position index.
    pub fn reorder_registrars(ids: &[String]) -> Result<()> {
        let conn = Self::get_connection()?;
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE registrars SET sort_order = ?2 WHERE id = ?1",
                params![id, i as i64],
            )?;
        }
        Ok(())
    }

    /// Reorder registrar folders: given an ordered list of IDs, set sort_order = position index.
    pub fn reorder_registrar_folders(ids: &[String]) -> Result<()> {
        let conn = Self::get_connection()?;
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE registrar_folders SET sort_order = ?2 WHERE id = ?1",
                params![id, i as i64],
            )?;
        }
        Ok(())
    }

    /// Load global settings
    pub fn load_global_settings() -> Result<crate::core::config::GlobalSettings> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare("SELECT key, value FROM global_settings")?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut settings = crate::core::config::GlobalSettings::default();
        for row in rows {
            let (key, value) = row?;
            match key.as_str() {
                "default_local_port" => {
                    settings.default_local_port = value.parse().ok();
                }
                "log_level" => {
                    settings.log_level = value;
                }
                _ => {}
            }
        }

        Ok(settings)
    }

    /// Save global settings
    pub fn save_global_settings(settings: &crate::core::config::GlobalSettings) -> Result<()> {
        let conn = Self::get_connection()?;

        if let Some(port) = settings.default_local_port {
            conn.execute(
                "INSERT OR REPLACE INTO global_settings (key, value) VALUES ('default_local_port', ?1)",
                params![port.to_string()],
            )?;
        }

        conn.execute(
            "INSERT OR REPLACE INTO global_settings (key, value) VALUES ('log_level', ?1)",
            params![&settings.log_level],
        )?;

        Ok(())
    }

    /// Save test result to database
    pub fn save_test_result(
        registrar_id: &str,
        test_type: &str,
        result: &serde_json::Value,
        diagnostics: Option<&serde_json::Value>,
    ) -> Result<()> {
        let conn = Self::get_connection()?;
        let id = Uuid::new_v4().to_string();
        let timestamp = chrono::Utc::now().to_rfc3339();

        let result_json = serde_json::to_string(result)?;
        let diagnostics_json = diagnostics.map(|d| serde_json::to_string(d)).transpose()?;

        conn.execute(
            "INSERT INTO test_results (id, registrar_id, test_type, result, timestamp, diagnostics) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, registrar_id, test_type, result_json, timestamp, diagnostics_json],
        )?;

        Ok(())
    }

    /// Load test results for a registrar (limited to last N results)
    pub fn load_test_results(
        registrar_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<serde_json::Value>> {
        let conn = Self::get_connection()?;
        let limit = limit.unwrap_or(50);

        let mut results = Vec::new();

        if let Some(reg_id) = registrar_id {
            let mut stmt = conn.prepare(
                "SELECT result, timestamp, test_type FROM test_results WHERE registrar_id = ?1 ORDER BY timestamp DESC LIMIT ?2"
            )?;
            let rows = stmt.query_map(params![reg_id, limit], |row| {
                let result_json: String = row.get(0)?;
                let timestamp: String = row.get(1)?;
                let test_type: String = row.get(2)?;
                let mut result_value: serde_json::Value = serde_json::from_str(&result_json)
                    .map_err(|_| {
                        rusqlite::Error::InvalidColumnType(
                            0,
                            "Invalid JSON in test result".to_string(),
                            rusqlite::types::Type::Text,
                        )
                    })?;
                // Add timestamp and test_type to the result
                if let Some(obj) = result_value.as_object_mut() {
                    obj.insert("_timestamp".to_string(), serde_json::json!(timestamp));
                    obj.insert("_test_type".to_string(), serde_json::json!(test_type));
                }
                Ok(result_value)
            })?;
            for row in rows {
                results.push(row?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT result, timestamp, test_type FROM test_results ORDER BY timestamp DESC LIMIT ?1"
            )?;
            let rows = stmt.query_map(params![limit], |row| {
                let result_json: String = row.get(0)?;
                let timestamp: String = row.get(1)?;
                let test_type: String = row.get(2)?;
                let mut result_value: serde_json::Value = serde_json::from_str(&result_json)
                    .map_err(|_| {
                        rusqlite::Error::InvalidColumnType(
                            0,
                            "Invalid JSON in test result".to_string(),
                            rusqlite::types::Type::Text,
                        )
                    })?;
                // Add timestamp and test_type to the result
                if let Some(obj) = result_value.as_object_mut() {
                    obj.insert("_timestamp".to_string(), serde_json::json!(timestamp));
                    obj.insert("_test_type".to_string(), serde_json::json!(test_type));
                }
                Ok(result_value)
            })?;
            for row in rows {
                results.push(row?);
            }
        }

        Ok(results)
    }

    /// Clear test results for a registrar (or all if registrar_id is None)
    pub fn clear_test_results(registrar_id: Option<&str>) -> Result<usize> {
        let conn = Self::get_connection()?;

        let deleted_count = if let Some(reg_id) = registrar_id {
            conn.execute(
                "DELETE FROM test_results WHERE registrar_id = ?1",
                params![reg_id],
            )?
        } else {
            conn.execute("DELETE FROM test_results", [])?
        };

        Ok(deleted_count)
    }

    /// Save note to database
    pub fn save_note(note: &crate::commands::notes::Note) -> Result<()> {
        let conn = Self::get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();
        let tags_json = serde_json::to_string(&note.tags)?;
        let linked_note_ids_json = note
            .linked_note_ids
            .as_ref()
            .map(|ids| serde_json::to_string(ids))
            .transpose()?;
        let is_pinned = note.is_pinned.unwrap_or(false) as i32;

        // Check if note exists to preserve created_at and get current version
        let existing: Option<(String, i32)> = conn
            .query_row(
                "SELECT created_at, version FROM notes WHERE id = ?1",
                params![note.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        // For new notes: start at version 1
        // For existing notes: increment version
        let (created_at, new_version) = match existing {
            Some((created, current_version)) => (created, current_version + 1),
            None => (now.clone(), 1),
        };

        // Create search vector (title + content for full-text search)
        let search_vector = format!("{} {}", note.title, note.content);

        conn.execute(
            "INSERT OR REPLACE INTO notes (id, title, content, tags, linked_registrar_id, category, is_pinned, linked_note_ids, folder_id, version, template_id, search_vector, created_at, updated_at, linked_agent_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                note.id,
                note.title,
                note.content,
                tags_json,
                note.linked_registrar_id,
                note.category,
                is_pinned,
                linked_note_ids_json,
                note.folder_id,
                new_version,
                note.template_id,
                search_vector,
                created_at,
                now,
                note.linked_agent_id,
            ],
        )?;

        // Update FTS5 index
        conn.execute(
            "INSERT OR REPLACE INTO notes_fts (rowid, id, title, content)
             VALUES ((SELECT rowid FROM notes WHERE id = ?1), ?1, ?2, ?3)",
            params![note.id, note.title, note.content],
        )?;

        Ok(())
    }

    /// Load note by ID
    pub fn load_note(id: &str) -> Result<crate::commands::notes::Note> {
        let conn = Self::get_connection()?;
        let note = conn.query_row(
            "SELECT id, title, content, tags, linked_registrar_id, category, is_pinned, linked_note_ids, folder_id, version, template_id, created_at, updated_at, linked_agent_id
             FROM notes WHERE id = ?1",
            params![id],
            |row| {
                let tags_json: String = row.get(3)?;
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
                let is_pinned: i32 = row.get(6)?;
                let linked_note_ids_json: Option<String> = row.get(7)?;
                let linked_note_ids = linked_note_ids_json
                    .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok());
                let version: Option<i32> = row.get(9)?;

                Ok(crate::commands::notes::Note {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    tags,
                    linked_registrar_id: row.get(4)?,
                    linked_agent_id: row.get(13)?,
                    category: row.get(5)?,
                    is_pinned: Some(is_pinned != 0),
                    linked_note_ids,
                    folder_id: row.get(8)?,
                    version,
                    template_id: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        )?;
        Ok(note)
    }

    /// Load notes with optional filters
    pub fn load_notes(
        linked_registrar_id: Option<&str>,
        filter_tags: Option<&[String]>,
        linked_agent_id: Option<&str>,
    ) -> Result<Vec<crate::commands::notes::Note>> {
        let conn = Self::get_connection()?;

        fn parse_note_row(row: &rusqlite::Row) -> rusqlite::Result<crate::commands::notes::Note> {
            let tags_json: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let is_pinned: i32 = row.get(6)?;
            let linked_note_ids_json: Option<String> = row.get(7)?;
            let linked_note_ids = linked_note_ids_json
                .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok());
            let version: Option<i32> = row.get(9)?;

            Ok(crate::commands::notes::Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                tags,
                linked_registrar_id: row.get(4)?,
                linked_agent_id: row.get(13)?,
                category: row.get(5)?,
                is_pinned: Some(is_pinned != 0),
                linked_note_ids,
                folder_id: row.get(8)?,
                version,
                template_id: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        }

        let notes: Vec<crate::commands::notes::Note> = if let Some(reg_id) = linked_registrar_id {
            let mut stmt = conn.prepare(
                "SELECT id, title, content, tags, linked_registrar_id, category, is_pinned, linked_note_ids, folder_id, version, template_id, created_at, updated_at, linked_agent_id 
                 FROM notes 
                 WHERE linked_registrar_id = ?1 AND deleted_at IS NULL
                 ORDER BY is_pinned DESC, updated_at DESC"
            )?;
            let rows = stmt.query_map(params![reg_id], parse_note_row)?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            result
        } else if let Some(agent_id) = linked_agent_id {
            let mut stmt = conn.prepare(
                "SELECT id, title, content, tags, linked_registrar_id, category, is_pinned, linked_note_ids, folder_id, version, template_id, created_at, updated_at, linked_agent_id 
                 FROM notes 
                 WHERE linked_agent_id = ?1 AND deleted_at IS NULL
                 ORDER BY is_pinned DESC, updated_at DESC"
            )?;
            let rows = stmt.query_map(params![agent_id], parse_note_row)?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            result
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, title, content, tags, linked_registrar_id, category, is_pinned, linked_note_ids, folder_id, version, template_id, created_at, updated_at, linked_agent_id 
                 FROM notes 
                 WHERE deleted_at IS NULL
                 ORDER BY is_pinned DESC, updated_at DESC"
            )?;
            let rows = stmt.query_map([], parse_note_row)?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            result
        };

        // Apply tag filtering in Rust (since tags are stored as JSON)
        let filtered_notes = if let Some(tags) = filter_tags {
            if tags.is_empty() {
                notes
            } else {
                notes
                    .into_iter()
                    .filter(|note| tags.iter().all(|t| note.tags.contains(t)))
                    .collect()
            }
        } else {
            notes
        };

        Ok(filtered_notes)
    }

    /// Delete note from database
    pub fn delete_note(id: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        // FTS5 will auto-update via triggers (if we set them up) or we can manually delete
        conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Search notes using FTS5
    pub fn search_notes(query: &str) -> Result<Vec<crate::commands::notes::Note>> {
        let conn = Self::get_connection()?;
        // Escape special characters and use prefix search
        let escaped_query = query.replace('"', "\"\"");
        let search_query = format!("\"{}\"*", escaped_query);

        let mut stmt = conn.prepare(
            "SELECT n.id, n.title, n.content, n.tags, n.linked_registrar_id, n.category, n.is_pinned, n.linked_note_ids, n.folder_id, n.version, n.template_id, n.created_at, n.updated_at, n.linked_agent_id
             FROM notes n
             JOIN notes_fts f ON n.id = f.id
             WHERE notes_fts MATCH ?1 AND n.deleted_at IS NULL
             ORDER BY n.is_pinned DESC, rank, n.updated_at DESC"
        )?;

        let rows = stmt.query_map(params![search_query], |row| {
            let tags_json: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let is_pinned: i32 = row.get(6)?;
            let linked_note_ids_json: Option<String> = row.get(7)?;
            let linked_note_ids = linked_note_ids_json
                .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok());
            let version: Option<i32> = row.get(9)?;

            Ok(crate::commands::notes::Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                tags,
                linked_registrar_id: row.get(4)?,
                linked_agent_id: row.get(13)?,
                category: row.get(5)?,
                is_pinned: Some(is_pinned != 0),
                linked_note_ids,
                folder_id: row.get(8)?,
                version,
                template_id: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?;

        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?);
        }

        Ok(notes)
    }

    /// Get all unique tags from notes
    pub fn get_all_tags() -> Result<Vec<String>> {
        let conn = Self::get_connection()?;
        let mut stmt =
            conn.prepare("SELECT tags FROM notes WHERE tags IS NOT NULL AND tags != ''")?;
        let rows = stmt.query_map([], |row| {
            let tags_json: String = row.get(0)?;
            Ok(serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default())
        })?;

        let mut all_tags = std::collections::HashSet::new();
        for row in rows {
            if let Ok(tags) = row {
                for tag in tags {
                    all_tags.insert(tag);
                }
            }
        }

        let mut tags_vec: Vec<String> = all_tags.into_iter().collect();
        tags_vec.sort();
        Ok(tags_vec)
    }

    /// Get all unique categories from notes
    // Note folder operations
    pub fn save_note_folder(folder: &NoteFolder) -> Result<()> {
        let conn = Self::get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();

        let existing_created_at: Option<String> = conn
            .query_row(
                "SELECT created_at FROM note_folders WHERE id = ?1",
                params![folder.id],
                |row| row.get(0),
            )
            .ok();

        let created_at = existing_created_at.unwrap_or_else(|| now.clone());

        conn.execute(
            "INSERT OR REPLACE INTO note_folders (id, name, parent_id, path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                folder.id,
                folder.name,
                folder.parent_id,
                folder.path,
                created_at,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn load_note_folders() -> Result<Vec<NoteFolder>> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, parent_id, path, created_at, updated_at FROM note_folders ORDER BY path"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(NoteFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                path: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        let mut folders = Vec::new();
        for row in rows {
            folders.push(row?);
        }
        Ok(folders)
    }

    pub fn delete_note_folder(id: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        // Reparent direct children to this folder's parent (so they become siblings or root)
        conn.execute(
            "UPDATE note_folders SET parent_id = (SELECT parent_id FROM note_folders WHERE id = ?1) WHERE parent_id = ?1",
            params![id],
        )?;
        // Move notes in this folder to parent folder or root
        conn.execute(
            "UPDATE notes SET folder_id = (SELECT parent_id FROM note_folders WHERE id = ?1) WHERE folder_id = ?1",
            params![id],
        )?;
        // Now safe to delete the folder
        conn.execute("DELETE FROM note_folders WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Note version operations
    pub fn save_note_version(version: &NoteVersion) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute(
            "INSERT INTO note_versions (id, note_id, title, content, version_number, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                version.id,
                version.note_id,
                version.title,
                version.content,
                version.version_number,
                version.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn load_note_versions(note_id: &str) -> Result<Vec<NoteVersion>> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, note_id, title, content, version_number, created_at 
             FROM note_versions 
             WHERE note_id = ?1 
             ORDER BY version_number DESC",
        )?;
        let rows = stmt.query_map(params![note_id], |row| {
            Ok(NoteVersion {
                id: row.get(0)?,
                note_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                version_number: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        let mut versions = Vec::new();
        for row in rows {
            versions.push(row?);
        }
        Ok(versions)
    }

    pub fn get_note_version(id: &str) -> Result<NoteVersion> {
        let conn = Self::get_connection()?;
        let version = conn.query_row(
            "SELECT id, note_id, title, content, version_number, created_at FROM note_versions WHERE id = ?1",
            params![id],
            |row| {
                Ok(NoteVersion {
                    id: row.get(0)?,
                    note_id: row.get(1)?,
                    title: row.get(2)?,
                    content: row.get(3)?,
                    version_number: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )?;
        Ok(version)
    }

    // Note template operations
    pub fn save_note_template(template: &NoteTemplate) -> Result<()> {
        let conn = Self::get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();
        let tags_json = serde_json::to_string(&template.tags)?;

        let existing_created_at: Option<String> = conn
            .query_row(
                "SELECT created_at FROM note_templates WHERE id = ?1",
                params![template.id],
                |row| row.get(0),
            )
            .ok();

        let created_at = existing_created_at.unwrap_or_else(|| now.clone());

        conn.execute(
            "INSERT OR REPLACE INTO note_templates (id, name, title_template, content_template, category, tags, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                template.id,
                template.name,
                template.title_template,
                template.content_template,
                template.category,
                tags_json,
                created_at,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn load_note_templates() -> Result<Vec<NoteTemplate>> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, title_template, content_template, category, tags, created_at, updated_at 
             FROM note_templates 
             ORDER BY name"
        )?;
        let rows = stmt.query_map([], |row| {
            let tags_json: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(NoteTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                title_template: row.get(2)?,
                content_template: row.get(3)?,
                category: row.get(4)?,
                tags,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        let mut templates = Vec::new();
        for row in rows {
            templates.push(row?);
        }
        Ok(templates)
    }

    pub fn delete_note_template(id: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute("DELETE FROM note_templates WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn load_note_folder(id: &str) -> Result<NoteFolder> {
        let conn = Self::get_connection()?;
        let folder = conn.query_row(
            "SELECT id, name, parent_id, path, created_at, updated_at FROM note_folders WHERE id = ?1",
            params![id],
            |row| {
                Ok(NoteFolder {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    path: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )?;
        Ok(folder)
    }

    pub fn get_all_categories() -> Result<Vec<String>> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare("SELECT DISTINCT category FROM notes WHERE category IS NOT NULL AND category != '' ORDER BY category")?;
        let rows = stmt.query_map([], |row| Ok(row.get::<_, String>(0)?))?;
        let mut categories = Vec::new();
        for row in rows {
            categories.push(row?);
        }
        Ok(categories)
    }

    // ── Session state key-value store ──────────────────────────────────

    /// Read a value from the session_state table.
    pub fn get_session_value(key: &str) -> Result<Option<String>> {
        let conn = Self::get_connection()?;
        let result = conn.query_row(
            "SELECT value FROM session_state WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Write a value to the session_state table (ACID, upsert).
    pub fn set_session_value(key: &str, value: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO session_state (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    /// Delete a value from the session_state table.
    pub fn delete_session_value(key: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute("DELETE FROM session_state WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn soft_delete_note(id: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE notes SET deleted_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn restore_note(id: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute(
            "UPDATE notes SET deleted_at = NULL WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn load_deleted_notes() -> Result<Vec<crate::commands::notes::Note>> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, content, tags, linked_registrar_id, category, is_pinned, linked_note_ids, folder_id, version, template_id, created_at, updated_at, linked_agent_id
             FROM notes
             WHERE deleted_at IS NOT NULL
             ORDER BY deleted_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            let tags_json: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let is_pinned: i32 = row.get(6)?;
            let linked_note_ids_json: Option<String> = row.get(7)?;
            let linked_note_ids = linked_note_ids_json
                .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok());
            let version: Option<i32> = row.get(9)?;
            Ok(crate::commands::notes::Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                tags,
                linked_registrar_id: row.get(4)?,
                linked_agent_id: row.get(13)?,
                category: row.get(5)?,
                is_pinned: Some(is_pinned != 0),
                linked_note_ids,
                folder_id: row.get(8)?,
                version,
                template_id: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?;
        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?);
        }
        Ok(notes)
    }

    pub fn permanently_delete_note(id: &str) -> Result<()> {
        let conn = Self::get_connection()?;
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM note_versions WHERE note_id = ?1", params![id])?;
        Ok(())
    }

    pub fn empty_trash() -> Result<i32> {
        let conn = Self::get_connection()?;
        let mut stmt = conn.prepare("SELECT id FROM notes WHERE deleted_at IS NOT NULL")?;
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        let count = ids.len() as i32;
        for id in &ids {
            conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])?;
            conn.execute("DELETE FROM note_versions WHERE note_id = ?1", params![id])?;
        }
        conn.execute("DELETE FROM notes WHERE deleted_at IS NOT NULL", [])?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::Database;
    use tempfile::tempdir;

    #[test]
    fn install_secret_is_stable_for_config_dir() {
        let temp = tempdir().expect("tempdir");
        let first = Database::load_or_create_install_secret_at(temp.path()).expect("first secret");
        let second =
            Database::load_or_create_install_secret_at(temp.path()).expect("second secret");
        assert_eq!(first.len(), 32);
        assert_eq!(first, second);
    }

    #[test]
    fn legacy_key_fallback_migrates_to_install_secret_key() {
        let temp = tempdir().expect("tempdir");
        let db_path = temp.path().join("data.db");
        let config_dir = temp.path().join("cfg");
        std::fs::create_dir_all(&config_dir).expect("create config dir");

        let legacy_key = Database::legacy_derive_key();
        let legacy_conn = Database::open_sqlcipher_connection(&db_path, &legacy_key)
            .expect("open legacy connection");
        legacy_conn
            .execute("CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT)", [])
            .expect("create table");
        legacy_conn
            .execute("INSERT INTO demo (value) VALUES ('ok')", [])
            .expect("insert row");
        drop(legacy_conn);

        let migrated_conn = Database::get_connection_with_paths(&db_path, &config_dir)
            .expect("open with migration logic");
        let value: String = migrated_conn
            .query_row("SELECT value FROM demo WHERE id = 1", [], |row| row.get(0))
            .expect("read migrated row");
        assert_eq!(value, "ok");
        drop(migrated_conn);

        let secret = Database::load_or_create_install_secret_at(&config_dir).expect("load secret");
        let current_key = Database::derive_db_key_from_secret(&secret).expect("derive current key");

        assert!(Database::open_sqlcipher_connection(&db_path, &current_key).is_ok());
        assert!(Database::open_sqlcipher_connection(&db_path, &legacy_key).is_err());
    }
}
