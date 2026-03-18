use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use dirs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub registrars: Vec<RegistrarConfig>,
    pub global_settings: GlobalSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalSettings {
    pub default_local_port: Option<u16>,
    pub log_level: String,
}

impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            default_local_port: Some(5060),
            log_level: "info".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrarConfig {
    pub id: String,
    pub name: String,
    pub domain: String,
    pub remote_port: u16,
    pub local_port: Option<u16>,
    /// Port to listen on for inbound SIP (UDP). If set, REGISTER Contact uses this so INVITEs reach us. Default 5062 when enabled.
    pub listening_port: Option<u16>,
    /// Local RTP port for media (UDP). SDP m= line and bind address. Default 10000.
    pub rtp_port: Option<u16>,
    pub transport: TransportType,
    pub username: String,
    pub auth_username: Option<String>,
    pub password: String, // Will be stored encrypted
    pub realm: Option<String>,
    pub custom_headers: Vec<CustomHeader>,
    pub timeout_seconds: u64,
    pub retry_count: u32,
    pub register_interval_seconds: Option<u64>,
    pub tags: Vec<String>,
    pub group: Option<String>,
    /// Use case: "faxing" | "calling" | null (aligns registrar with fax or voice)
    pub use_case: Option<String>,
    /// Voicemail number / URI to dial for checking voicemail (e.g. "*97" or "sip:vm@host").
    #[serde(default)]
    pub voicemail_number: Option<String>,
    /// Whether MWI (Message Waiting Indicator) subscription is enabled for this registrar.
    #[serde(default)]
    pub mwi_enabled: bool,
    /// When true, this registrar will automatically REGISTER on app startup.
    /// When false (default), it starts unregistered and the user must explicitly register.
    #[serde(default)]
    pub auto_register: bool,
    /// Persisted display order for manual sorting. Lower values appear first.
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(PartialEq)]
pub enum TransportType {
    Udp,
    Tcp,
    Tls,
    Wss,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomHeader {
    pub name: String,
    pub value: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            registrars: Vec::new(),
            global_settings: GlobalSettings::default(),
        }
    }
}

/// Legacy config dir name (before the Strix → SIPalyzer rename).
const LEGACY_DIR_NAME: &str = "strix";
/// Current config dir name.
const CONFIG_DIR_NAME: &str = "sipalyzer";
/// Marker file written after a successful migration from the legacy directory.
const MIGRATION_MARKER: &str = ".migrated_from_strix";

pub fn get_config_dir() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Failed to get config directory")?;
    let config_dir = base.join(CONFIG_DIR_NAME);

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .context("Failed to create config directory")?;
    }

    // One-time migration from legacy "strix" directory
    let marker = config_dir.join(MIGRATION_MARKER);
    if !marker.exists() {
        let legacy_dir = base.join(LEGACY_DIR_NAME);
        if legacy_dir.exists() && legacy_dir.is_dir() {
            migrate_legacy_dir(&legacy_dir, &config_dir);
        }
        // Write marker even if legacy dir doesn't exist to avoid re-checking every launch
        let _ = fs::write(&marker, "migrated");
    }

    Ok(config_dir)
}

/// Copy files from the legacy "strix" config directory into the new "sipalyzer" directory.
/// For files: copy if destination doesn't exist or old file is significantly larger (real data vs defaults).
/// For directories: merge contents (copy files that don't exist in target).
fn migrate_legacy_dir(legacy: &std::path::Path, target: &std::path::Path) {
    let entries = match fs::read_dir(legacy) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // Skip hidden files and temp files
        if name_str.starts_with('.') || name_str.ends_with(".tmp") {
            continue;
        }

        let src = entry.path();
        let dst = target.join(&name);

        if src.is_dir() {
            // Merge directory contents: copy any files from old dir that don't exist in new dir
            if let Err(e) = merge_dir_recursive(&src, &dst) {
                tracing::error!("failed to merge dir {:?} -> {:?}: {}", src, dst, e);
            } else {
                tracing::info!("merged dir {:?} -> {:?}", name, dst);
            }
        } else if src.is_file() {
            let src_size = src.metadata().map(|m| m.len()).unwrap_or(0);
            let dst_size = dst.metadata().map(|m| m.len()).unwrap_or(0);

            // Copy if destination doesn't exist, or if old file is significantly larger
            // (meaning the new file is just defaults and the old one has real data)
            let should_copy = !dst.exists() || (src_size > dst_size * 2 && src_size > 1024);

            if should_copy && src_size > 0 {
                match fs::copy(&src, &dst) {
                    Ok(_) => tracing::info!("copied {:?} ({} bytes -> replacing {} bytes)", name, src_size, dst_size),
                    Err(e) => tracing::error!("failed to copy {:?}: {}", name, e),
                }
            }
        }
    }
}

/// Recursively merge a directory tree: copy files that don't exist in the destination.
fn merge_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            merge_dir_recursive(&src_path, &dst_path)?;
        } else if !dst_path.exists() {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[allow(dead_code)]
pub fn get_config_path() -> Result<PathBuf> {
    Ok(get_config_dir()?.join("config.json"))
}

#[allow(dead_code)]
pub fn load_config() -> Result<AppConfig> {
    let config_path = get_config_path()?;
    
    if !config_path.exists() {
        return Ok(AppConfig::default());
    }
    
    let content = fs::read_to_string(&config_path)
        .context("Failed to read config file")?;
    
    let config: AppConfig = serde_json::from_str(&content)
        .context("Failed to parse config file")?;
    
    Ok(config)
}

#[allow(dead_code)]
pub fn save_config(config: &AppConfig) -> Result<()> {
    let config_path = get_config_path()?;
    let content = serde_json::to_string_pretty(config)
        .context("Failed to serialize config")?;
    
    fs::write(&config_path, content)
        .context("Failed to write config file")?;
    
    Ok(())
}
