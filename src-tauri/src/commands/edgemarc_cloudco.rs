//! EdgeMarc firmware via CloudCo Partner's public FTP mirror.
//!
//! Credentials and server details are published on:
//! <https://support.cloudcopartner.com/article/342-latest-edgemarc-firmware>
//!
//! Users may override host/user/password in `firmware_prefs.json` if CloudCo rotates them.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use suppaftp::tokio::AsyncFtpStream;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::sync::RwLock;

use super::emfw::{EmfwFirmwareRow, EmfwManifestEntry};

pub const SUPPORT_ARTICLE_URL: &str =
    "https://support.cloudcopartner.com/article/342-latest-edgemarc-firmware";
pub const DEFAULT_FTP_HOST: &str = "firmware.cloudcopartner.com";
pub const DEFAULT_FTP_USER: &str = "firmware";
/// Published on CloudCo's public support article; override via prefs if rotated.
pub const DEFAULT_FTP_PASSWORD: &str = "K53zq8HfgVd8bp9QS";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgemarcCloudcoPrefs {
    #[serde(default = "default_ftp_host")]
    pub ftp_host: String,
    #[serde(default = "default_ftp_port")]
    pub ftp_port: u16,
    #[serde(default = "default_ftp_user")]
    pub ftp_user: String,
    #[serde(default)]
    pub ftp_password: Option<String>,
}

fn default_ftp_host() -> String {
    DEFAULT_FTP_HOST.into()
}
fn default_ftp_port() -> u16 {
    21
}
fn default_ftp_user() -> String {
    DEFAULT_FTP_USER.into()
}

impl Default for EdgemarcCloudcoPrefs {
    fn default() -> Self {
        Self {
            ftp_host: default_ftp_host(),
            ftp_port: default_ftp_port(),
            ftp_user: default_ftp_user(),
            ftp_password: None,
        }
    }
}

/// Effective FTP credentials for the remote agent (same host the desktop would use).
#[derive(Debug, Clone, Serialize)]
pub struct EdgemarcFtpDialParams {
    pub ftp_host: String,
    pub ftp_port: u16,
    pub ftp_user: String,
    pub ftp_password: String,
}

pub async fn ftp_dial_params_for_remote() -> EdgemarcFtpDialParams {
    let p = prefs_snapshot().await;
    EdgemarcFtpDialParams {
        ftp_host: p.ftp_host.clone(),
        ftp_port: p.ftp_port,
        ftp_user: p.ftp_user.clone(),
        ftp_password: effective_ftp_password(&p),
    }
}

/// Safe subset for the UI (no password).
#[derive(Debug, Clone, Serialize)]
pub struct EdgemarcCloudcoPrefsPublic {
    pub ftp_host: String,
    pub ftp_port: u16,
    pub ftp_user: String,
    pub has_password_override: bool,
    pub support_article_url: &'static str,
}

impl EdgemarcCloudcoPrefsPublic {
    pub fn from_prefs(p: &EdgemarcCloudcoPrefs) -> Self {
        Self {
            ftp_host: p.ftp_host.clone(),
            ftp_port: p.ftp_port,
            ftp_user: p.ftp_user.clone(),
            has_password_override: p
                .ftp_password
                .as_ref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false),
            support_article_url: SUPPORT_ARTICLE_URL,
        }
    }
}

static EDGEMARC_PREFS: LazyLock<RwLock<EdgemarcCloudcoPrefs>> =
    LazyLock::new(|| RwLock::new(EdgemarcCloudcoPrefs::default()));

/// Cached rows from the last successful CloudCo FTP catalog refresh.
static EDGEMARC_CLOUDCO_ROWS: LazyLock<RwLock<Vec<EmfwFirmwareRow>>> =
    LazyLock::new(|| RwLock::new(Vec::new()));

pub fn effective_ftp_password(p: &EdgemarcCloudcoPrefs) -> String {
    p.ftp_password
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_FTP_PASSWORD.to_string())
}

pub async fn prefs_snapshot() -> EdgemarcCloudcoPrefs {
    EDGEMARC_PREFS.read().await.clone()
}

pub async fn set_prefs(p: EdgemarcCloudcoPrefs) {
    *EDGEMARC_PREFS.write().await = p;
}

/// Merge `edgemarc_cloudco` from firmware_prefs.json into memory.
pub async fn load_prefs_from_firmware_json(value: &serde_json::Value) {
    if let Some(obj) = value.get("edgemarc_cloudco") {
        if let Ok(p) = serde_json::from_value::<EdgemarcCloudcoPrefs>(obj.clone()) {
            *EDGEMARC_PREFS.write().await = p;
        }
    }
}

pub fn prefs_json_fragment(p: &EdgemarcCloudcoPrefs) -> serde_json::Value {
    serde_json::to_value(p).unwrap_or_default()
}

pub fn cloudco_pub_root(cache: &Path) -> PathBuf {
    cache.join("cloudco_pub")
}

pub async fn cloudco_rows_snapshot() -> Vec<EmfwFirmwareRow> {
    EDGEMARC_CLOUDCO_ROWS.read().await.clone()
}

pub async fn clear_cloudco_catalog_cache() {
    EDGEMARC_CLOUDCO_ROWS.write().await.clear();
}

fn ftp_addr(p: &EdgemarcCloudcoPrefs) -> String {
    format!("{}:{}", p.ftp_host.trim(), p.ftp_port)
}

/// Walk `pub/<series>/` on the FTP server and build manifest-like rows (sizes via SIZE).
pub async fn refresh_catalog_from_ftp() -> Result<Vec<EmfwFirmwareRow>, String> {
    let prefs = prefs_snapshot().await;
    let addr = ftp_addr(&prefs);
    let mut ftp = AsyncFtpStream::connect(&addr)
        .await
        .map_err(|e| format!("FTP connect {addr}: {e}"))?;
    ftp.login(&prefs.ftp_user, &effective_ftp_password(&prefs))
        .await
        .map_err(|e| format!("FTP login: {e}"))?;

    let subs = ftp
        .nlst(Some("pub"))
        .await
        .map_err(|e| format!("FTP NLST pub: {e}"))?;

    let mut manifest_entries: Vec<EmfwManifestEntry> = Vec::new();

    for sub in subs {
        let sub = sub.trim();
        if sub.is_empty() || sub.contains("..") {
            continue;
        }
        // NLST may return `e_2900` or `pub/e_2900` depending on server; normalize.
        let series_dir = sub.strip_prefix("pub/").unwrap_or(sub);
        if !series_dir.starts_with('e') {
            continue;
        }
        let remote_dir = format!("pub/{}", series_dir);
        let files = ftp
            .nlst(Some(&remote_dir))
            .await
            .map_err(|e| format!("FTP NLST {remote_dir}: {e}"))?;

        for name in files {
            let base = Path::new(&name)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&name)
                .to_string();
            if !base.starts_with("image.bin.") {
                continue;
            }
            let rel_path = format!("{}/{}", remote_dir, base);
            if rel_path.contains("..") {
                continue;
            }
            let size = ftp.size(&rel_path).await.unwrap_or(0) as u64;
            manifest_entries.push(EmfwManifestEntry {
                path: rel_path.replace('\\', "/"),
                size,
            });
        }
    }

    let _ = ftp.quit().await;

    let rows = super::emfw::firmware_rows_from_manifest(&manifest_entries);
    *EDGEMARC_CLOUDCO_ROWS.write().await = rows.clone();
    Ok(rows)
}

/// Download `storage_path` (e.g. `pub/e_2900/image.bin...`) into `entry_dir/filename` and mirror under `cloudco_pub/` for FTP serve layout.
pub async fn download_firmware_file(
    app: &AppHandle,
    cache: &Path,
    storage_path: &str,
    filename: &str,
    entry_id: &str,
) -> Result<PathBuf, String> {
    use crate::commands::tools::FirmwareDownloadProgress;

    let prefs = prefs_snapshot().await;
    let addr = ftp_addr(&prefs);
    let mut ftp = AsyncFtpStream::connect(&addr)
        .await
        .map_err(|e| format!("FTP connect {addr}: {e}"))?;
    ftp.login(&prefs.ftp_user, &effective_ftp_password(&prefs))
        .await
        .map_err(|e| format!("FTP login: {e}"))?;

    if storage_path.contains("..") || filename.contains("..") {
        return Err("invalid path".into());
    }

    let entry_dir = cache.join(entry_id);
    std::fs::remove_dir_all(&entry_dir).ok();
    std::fs::create_dir_all(&entry_dir).map_err(|e| format!("mkdir cache entry: {e}"))?;
    let dest_file = entry_dir.join(filename);

    let mirrored = cloudco_pub_root(cache).join(storage_path);
    if let Some(parent) = mirrored.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir cloudco_pub: {e}"))?;
    }

    let total = ftp.size(storage_path).await.unwrap_or(0) as u64;
    let total_hint = total.max(1);

    let mut stream = ftp
        .retr_as_stream(storage_path)
        .await
        .map_err(|e| format!("FTP RETR {storage_path}: {e}"))?;

    let f = tokio::fs::File::create(&dest_file)
        .await
        .map_err(|e| format!("create file: {e}"))?;
    let mut w = BufWriter::new(f);
    let mut buf = vec![0u8; 256 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_pct: i32 = -1;

    loop {
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|e| format!("FTP read: {e}"))?;
        if n == 0 {
            break;
        }
        w.write_all(&buf[..n])
            .await
            .map_err(|e| format!("write: {e}"))?;
        downloaded += n as u64;

        let pct = ((downloaded as f64 / total_hint as f64) * 100.0).min(99.0) as i32;
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit(
                "tools:firmware-progress",
                FirmwareDownloadProgress {
                    entry_id: entry_id.to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes: total_hint,
                    pct: pct as f64,
                    phase: "downloading".into(),
                    files_extracted: 0,
                },
            );
        }
    }

    w.flush().await.map_err(|e| format!("flush: {e}"))?;
    w.shutdown()
        .await
        .map_err(|e| format!("shutdown writer: {e}"))?;

    ftp.finalize_retr_stream(stream)
        .await
        .map_err(|e| format!("FTP finalize RETR: {e}"))?;

    std::fs::copy(&dest_file, &mirrored).map_err(|e| format!("mirror to cloudco_pub: {e}"))?;

    let _ = ftp.quit().await;

    let _ = app.emit(
        "tools:firmware-progress",
        FirmwareDownloadProgress {
            entry_id: entry_id.to_string(),
            downloaded_bytes: total_hint,
            total_bytes: total_hint,
            pct: 100.0,
            phase: "downloading".into(),
            files_extracted: 0,
        },
    );

    Ok(entry_dir)
}
