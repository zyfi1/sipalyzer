use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{Emitter, Manager};
use tokio::sync::watch;

// ═══════════════════════════════════════════════════════════════════════
//  Network Utilities
// ═══════════════════════════════════════════════════════════════════════

fn get_lan_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:53").ok()?;
    let addr = socket.local_addr().ok()?;
    match addr.ip() {
        std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => {
            Some(v4.to_string())
        }
        _ => None,
    }
}

fn has_parent_traversal(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn approved_local_scopes(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut scopes = Vec::new();
    if let Some(home) = dirs::home_dir() {
        scopes.push(home);
    }
    // Include current workspace/cwd when available for local development workflows.
    if let Ok(cwd) = std::env::current_dir() {
        scopes.push(cwd);
    }
    scopes.push(std::env::temp_dir());
    // macOS commonly resolves /tmp -> /private/tmp, which should remain browsable.
    scopes.push(PathBuf::from("/tmp"));
    scopes.push(PathBuf::from("/private/tmp"));
    scopes.push(PathBuf::from("/private"));
    // Allow normal filesystem traversal from explorer "go up"/breadcrumbs.
    scopes.push(PathBuf::from("/"));
    // File-server explorer presets include system paths; keep them explicitly in scope.
    for candidate in ["/var", "/etc", "/srv", "/opt", "/usr/local"] {
        scopes.push(PathBuf::from(candidate));
    }
    if let Ok(app_data) = app.path().app_data_dir() {
        scopes.push(app_data);
    }
    if let Ok(local_app_data) = app.path().app_local_data_dir() {
        scopes.push(local_app_data);
    }

    scopes
        .into_iter()
        .filter_map(|scope| scope.canonicalize().ok().or(Some(scope)))
        .collect()
}

fn is_within_approved_scopes(path: &Path, approved_scopes: &[PathBuf]) -> bool {
    approved_scopes.iter().any(|scope| path.starts_with(scope))
}

fn resolve_scoped_existing_path(
    path: &str,
    app: &tauri::AppHandle,
    operation: &str,
) -> Result<PathBuf, String> {
    let raw = PathBuf::from(path);
    if path.trim().is_empty() {
        return Err(format!("{operation} denied: path is empty"));
    }
    if has_parent_traversal(&raw) {
        return Err(format!(
            "{operation} denied: path traversal is not allowed ({path})"
        ));
    }
    let canonical = raw
        .canonicalize()
        .map_err(|e| format!("{operation} denied: cannot resolve path {path}: {e}"))?;
    let approved = approved_local_scopes(app);
    if !is_within_approved_scopes(&canonical, &approved) {
        return Err(format!(
            "{operation} denied: path is outside approved local scopes (home/app-data/temp): {}",
            canonical.to_string_lossy()
        ));
    }
    Ok(canonical)
}

// ═══════════════════════════════════════════════════════════════════════
//  Session Management
// ═══════════════════════════════════════════════════════════════════════

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static ACTIVE_SESSIONS: Lazy<StdMutex<HashMap<String, watch::Sender<bool>>>> =
    Lazy::new(|| StdMutex::new(HashMap::new()));

fn create_session() -> (String, watch::Receiver<bool>) {
    let id = format!("local-{}", SESSION_COUNTER.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = watch::channel(false);
    ACTIVE_SESSIONS.lock().unwrap().insert(id.clone(), tx);
    (id, rx)
}

fn cancel_session(id: &str) -> bool {
    if let Some(tx) = ACTIVE_SESSIONS.lock().unwrap().remove(id) {
        let _ = tx.send(true);
        true
    } else {
        false
    }
}

type VFileMap = HashMap<String, (Vec<u8>, String)>;
static VIRTUAL_STORES: Lazy<StdMutex<HashMap<String, Arc<tokio::sync::RwLock<VFileMap>>>>> =
    Lazy::new(|| StdMutex::new(HashMap::new()));

// ═══════════════════════════════════════════════════════════════════════
//  Directory Listing (existing)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: i64,
    pub mod_time: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirResult {
    pub path: String,
    pub entries: Vec<DirEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_list_dir(
    path: String,
    show_hidden: bool,
    app: tauri::AppHandle,
) -> Result<ListDirResult, String> {
    let canonical = resolve_scoped_existing_path(&path, &app, "Directory listing")?;
    let canonical_str = canonical.to_string_lossy().to_string();

    let dir = match tokio::fs::read_dir(&canonical).await {
        Ok(d) => d,
        Err(e) => {
            return Ok(ListDirResult {
                path: canonical_str,
                entries: vec![],
                error: Some(e.to_string()),
            });
        }
    };

    let mut entries = Vec::new();
    let mut reader = dir;
    while let Ok(Some(entry)) = reader.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        let meta = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mod_time = meta
            .modified()
            .ok()
            .and_then(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
            })
            .unwrap_or_default();

        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            format!("{:o}", meta.permissions().mode() & 0o7777)
        };
        #[cfg(not(unix))]
        let mode = if meta.permissions().readonly() {
            "r--".to_string()
        } else {
            "rw-".to_string()
        };

        entries.push(DirEntry {
            name,
            is_dir: meta.is_dir(),
            size: meta.len() as i64,
            mod_time,
            mode,
        });
    }

    Ok(ListDirResult {
        path: canonical_str,
        entries,
        error: None,
    })
}

// ═══════════════════════════════════════════════════════════════════════
//  Log Fetch (existing)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchLogResult {
    pub lines: Vec<String>,
    pub total_lines: u32,
    pub matched_lines: u32,
    pub file_size_bytes: u64,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_fetch_log(
    path: String,
    tail_lines: Option<u32>,
    filter: Option<String>,
    app: tauri::AppHandle,
) -> Result<FetchLogResult, String> {
    let scoped_path = resolve_scoped_existing_path(&path, &app, "Log read")?;
    let content = tokio::fs::read_to_string(&scoped_path)
        .await
        .map_err(|e| e.to_string())?;

    let all_lines: Vec<&str> = content.lines().collect();
    let total_lines = all_lines.len() as u32;
    let file_size_bytes = content.len() as u64;

    let tail_n = tail_lines.unwrap_or(500) as usize;
    let start = if all_lines.len() > tail_n {
        all_lines.len() - tail_n
    } else {
        0
    };
    let sliced = &all_lines[start..];

    let (lines, matched_lines) = if let Some(ref pattern) = filter {
        if pattern.is_empty() {
            (
                sliced.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                sliced.len() as u32,
            )
        } else {
            let re = regex::Regex::new(pattern).map_err(|e| format!("Invalid regex: {e}"))?;
            let filtered: Vec<String> = sliced
                .iter()
                .filter(|l| re.is_match(l))
                .map(|l| l.to_string())
                .collect();
            let count = filtered.len() as u32;
            (filtered, count)
        }
    } else {
        (
            sliced.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            sliced.len() as u32,
        )
    };

    Ok(FetchLogResult {
        lines,
        total_lines,
        matched_lines,
        file_size_bytes,
    })
}

// ═══════════════════════════════════════════════════════════════════════
//  Syslog Listener (local)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogEntry {
    pub timestamp: String,
    pub hostname: String,
    pub facility: String,
    pub severity: String,
    pub app_name: String,
    pub process_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyslogBatchPayload {
    session_id: String,
    entries: Vec<SyslogEntry>,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_syslog_start(
    app: tauri::AppHandle,
    port: u16,
    bind_all_interfaces: Option<bool>,
) -> Result<String, String> {
    let (session_id, mut cancel_rx) = create_session();
    let sid = session_id.clone();

    let bind_host = if bind_all_interfaces.unwrap_or(false) {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    let socket = tokio::net::UdpSocket::bind(format!("{bind_host}:{port}"))
        .await
        .map_err(|e| format!("Failed to bind UDP port {}: {}", port, e))?;

    tokio::spawn(async move {
        let mut buf = [0u8; 65535];
        let mut batch: Vec<SyslogEntry> = Vec::new();
        let mut last_flush = tokio::time::Instant::now();

        loop {
            tokio::select! {
                _ = cancel_rx.changed() => break,
                result = socket.recv_from(&mut buf) => {
                    match result {
                        Ok((len, addr)) => {
                            let raw = String::from_utf8_lossy(&buf[..len]);
                            let source = addr.ip().to_string();
                            batch.push(parse_syslog(&raw, &source));

                            let should_flush = batch.len() >= 50
                                || last_flush.elapsed() >= std::time::Duration::from_millis(500);
                            if should_flush {
                                let _ = app.emit("tools:syslog-batch", SyslogBatchPayload {
                                    session_id: sid.clone(),
                                    entries: std::mem::take(&mut batch),
                                });
                                last_flush = tokio::time::Instant::now();
                            }
                        }
                        Err(_) => break,
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                    if !batch.is_empty() {
                        let _ = app.emit("tools:syslog-batch", SyslogBatchPayload {
                            session_id: sid.clone(),
                            entries: std::mem::take(&mut batch),
                        });
                        last_flush = tokio::time::Instant::now();
                    }
                }
            }
        }

        if !batch.is_empty() {
            let _ = app.emit(
                "tools:syslog-batch",
                SyslogBatchPayload {
                    session_id: sid.clone(),
                    entries: batch,
                },
            );
        }
    });

    Ok(session_id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_syslog_stop(session_id: String) -> Result<(), String> {
    cancel_session(&session_id);
    Ok(())
}

const FACILITY_NAMES: &[&str] = &[
    "kern", "user", "mail", "daemon", "auth", "syslog", "lpr", "news", "uucp", "cron", "authpriv",
    "ftp", "ntp", "audit", "alert", "clock", "local0", "local1", "local2", "local3", "local4",
    "local5", "local6", "local7",
];

const SEVERITY_NAMES: &[&str] = &[
    "emergency",
    "alert",
    "critical",
    "error",
    "warning",
    "notice",
    "info",
    "debug",
];

fn parse_syslog(raw: &str, source: &str) -> SyslogEntry {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    if !raw.starts_with('<') {
        return SyslogEntry {
            timestamp: now,
            hostname: source.to_string(),
            facility: "user".into(),
            severity: "info".into(),
            app_name: String::new(),
            process_id: String::new(),
            message: raw.to_string(),
        };
    }

    let Some(gt) = raw.find('>') else {
        return SyslogEntry {
            timestamp: now,
            hostname: source.into(),
            facility: "user".into(),
            severity: "info".into(),
            app_name: String::new(),
            process_id: String::new(),
            message: raw.into(),
        };
    };

    let pri: u32 = match raw[1..gt].parse() {
        Ok(v) => v,
        Err(_) => {
            return SyslogEntry {
                timestamp: now,
                hostname: source.into(),
                facility: "user".into(),
                severity: "info".into(),
                app_name: String::new(),
                process_id: String::new(),
                message: raw.into(),
            };
        }
    };

    let facility = FACILITY_NAMES
        .get((pri / 8) as usize)
        .unwrap_or(&"unknown")
        .to_string();
    let severity = SEVERITY_NAMES
        .get((pri % 8) as usize)
        .unwrap_or(&"unknown")
        .to_string();
    let rest = &raw[gt + 1..];

    // RFC 5424: starts with version digit + space
    if rest.len() > 2 && rest.as_bytes()[0].is_ascii_digit() && rest.as_bytes()[1] == b' ' {
        let parts: Vec<&str> = rest[2..].splitn(6, ' ').collect();
        if parts.len() >= 5 {
            return SyslogEntry {
                timestamp: if parts[0] == "-" {
                    now
                } else {
                    parts[0].into()
                },
                hostname: if parts[1] == "-" {
                    source.into()
                } else {
                    parts[1].into()
                },
                facility,
                severity,
                app_name: if parts[2] == "-" {
                    String::new()
                } else {
                    parts[2].into()
                },
                process_id: if parts[3] == "-" {
                    String::new()
                } else {
                    parts[3].into()
                },
                message: parts.get(5).or(parts.get(4)).unwrap_or(&"").to_string(),
            };
        }
    }

    // RFC 3164: "Mmm dd HH:MM:SS" then hostname then msg
    let trimmed = rest.trim_start();
    if trimmed.len() > 15 {
        let ts = &trimmed[..15];
        let after = trimmed[15..].trim_start();
        let (hostname, message) = match after.find(' ') {
            Some(i) => (&after[..i], after[i + 1..].to_string()),
            None => (source, after.to_string()),
        };
        let (app_name, msg) = extract_app_name(&message);
        return SyslogEntry {
            timestamp: ts.into(),
            hostname: hostname.into(),
            facility,
            severity,
            app_name,
            process_id: String::new(),
            message: msg,
        };
    }

    SyslogEntry {
        timestamp: now,
        hostname: source.into(),
        facility,
        severity,
        app_name: String::new(),
        process_id: String::new(),
        message: rest.into(),
    }
}

fn extract_app_name(msg: &str) -> (String, String) {
    if let Some(colon) = msg.find(':') {
        let before = &msg[..colon];
        if before.len() < 50 && !before.contains(' ') {
            let after = msg[colon + 1..].trim_start().to_string();
            if let Some(br) = before.find('[') {
                return (before[..br].into(), after);
            }
            return (before.into(), after);
        }
    }
    (String::new(), msg.into())
}

// ═══════════════════════════════════════════════════════════════════════
//  Log Tail (local)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TailLinesPayload {
    session_id: String,
    lines: Vec<String>,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_tail_start(
    app: tauri::AppHandle,
    path: String,
    filter: Option<String>,
) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let scoped_path = resolve_scoped_existing_path(&path, &app, "Log tail")?;
    let (session_id, mut cancel_rx) = create_session();
    let sid = session_id.clone();

    let mut file = tokio::fs::File::open(&scoped_path)
        .await
        .map_err(|e| format!("Cannot open {}: {}", scoped_path.to_string_lossy(), e))?;

    let meta = file.metadata().await.map_err(|e| e.to_string())?;
    let mut pos = meta.len();
    file.seek(std::io::SeekFrom::End(0))
        .await
        .map_err(|e| e.to_string())?;

    let re = filter
        .as_deref()
        .filter(|f| !f.is_empty())
        .and_then(|f| regex::Regex::new(f).ok());

    tokio::spawn(async move {
        let mut leftover = String::new();
        loop {
            tokio::select! {
                _ = cancel_rx.changed() => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                    let new_meta = match tokio::fs::metadata(&scoped_path).await {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    let new_size = new_meta.len();
                    if new_size <= pos {
                        if new_size < pos {
                            // File was truncated — reset
                            pos = 0;
                            if let Err(_) = file.seek(std::io::SeekFrom::Start(0)).await {
                                continue;
                            }
                        }
                        continue;
                    }

                    let to_read = (new_size - pos) as usize;
                    let mut buf = vec![0u8; to_read];
                    if file.seek(std::io::SeekFrom::Start(pos)).await.is_err() {
                        continue;
                    }
                    match file.read_exact(&mut buf).await {
                        Ok(_) => {}
                        Err(_) => continue,
                    }
                    pos = new_size;

                    leftover.push_str(&String::from_utf8_lossy(&buf));
                    let mut new_lines: Vec<String> = Vec::new();
                    while let Some(nl) = leftover.find('\n') {
                        let line = leftover[..nl].to_string();
                        leftover = leftover[nl + 1..].to_string();
                        if let Some(ref re) = re {
                            if !re.is_match(&line) {
                                continue;
                            }
                        }
                        new_lines.push(line);
                    }

                    if !new_lines.is_empty() {
                        let _ = app.emit("tools:tail-lines", TailLinesPayload {
                            session_id: sid.clone(),
                            lines: new_lines,
                        });
                    }
                }
            }
        }
    });

    Ok(session_id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_tail_stop(session_id: String) -> Result<(), String> {
    cancel_session(&session_id);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  HTTP File Server (local)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileServeStartResult {
    pub session_id: String,
    pub http_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileServeRequestPayload {
    session_id: String,
    client_ip: String,
    method: String,
    path: String,
    status: u16,
    size: u64,
    duration_ms: u64,
    timestamp: String,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_serve_start(
    app: tauri::AppHandle,
    path: String,
    http_port: u16,
    show_hidden: Option<bool>,
    bind_all_interfaces: Option<bool>,
) -> Result<FileServeStartResult, String> {
    let canonical = resolve_scoped_existing_path(&path, &app, "HTTP serve path")?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", path));
    }
    let hide_hidden = !show_hidden.unwrap_or(false);
    let bind_all = bind_all_interfaces.unwrap_or(false);
    let bind_host = if bind_all { "0.0.0.0" } else { "127.0.0.1" };

    let listener = tokio::net::TcpListener::bind(format!("{bind_host}:{http_port}"))
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", http_port, e))?;

    let local_addr = listener.local_addr().map_err(|e| e.to_string())?;
    let ip = if bind_all {
        get_lan_ip().unwrap_or_else(|| "127.0.0.1".into())
    } else {
        "127.0.0.1".into()
    };
    let http_url = format!("http://{}:{}", ip, local_addr.port());

    let (session_id, mut cancel_rx) = create_session();
    let sid = session_id.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_rx.changed() => break,
                result = listener.accept() => {
                    if let Ok((stream, addr)) = result {
                        let root = canonical.clone();
                        let app_c = app.clone();
                        let sid_c = sid.clone();
                        tokio::spawn(async move {
                            let _ = handle_http_connection(stream, &root, &app_c, &sid_c, &addr.ip().to_string(), hide_hidden).await;
                        });
                    }
                }
            }
        }
    });

    Ok(FileServeStartResult {
        session_id,
        http_url,
    })
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_serve_stop(session_id: String) -> Result<(), String> {
    cancel_session(&session_id);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Virtual File Server (in-memory, no filesystem access)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Deserialize)]
pub struct VirtualFileInput {
    pub name: String,
    pub data_base64: String,
}

fn guess_content_type_by_name(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("");
    match ext.to_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "txt" | "log" | "cfg" | "conf" | "ini" | "yaml" | "yml" => "text/plain; charset=utf-8",
        "csv" => "text/csv",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "tar" => "application/x-tar",
        "bin" | "fw" | "img" | "rom" | "iso" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

fn decode_virtual_files(files: &[VirtualFileInput]) -> Result<VFileMap, String> {
    use base64::Engine;
    let mut map = HashMap::new();
    for f in files {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&f.data_base64)
            .map_err(|e| format!("Failed to decode {}: {}", f.name, e))?;
        let mime = guess_content_type_by_name(&f.name).to_string();
        map.insert(f.name.clone(), (bytes, mime));
    }
    Ok(map)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_virtual_serve_start(
    app: tauri::AppHandle,
    http_port: u16,
    files: Vec<VirtualFileInput>,
    bind_all_interfaces: Option<bool>,
) -> Result<FileServeStartResult, String> {
    let file_map = decode_virtual_files(&files)?;
    let store = Arc::new(tokio::sync::RwLock::new(file_map));
    let bind_all = bind_all_interfaces.unwrap_or(false);
    let bind_host = if bind_all { "0.0.0.0" } else { "127.0.0.1" };

    let listener = tokio::net::TcpListener::bind(format!("{bind_host}:{http_port}"))
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", http_port, e))?;

    let local_addr = listener.local_addr().map_err(|e| e.to_string())?;
    let ip = if bind_all {
        get_lan_ip().unwrap_or_else(|| "127.0.0.1".into())
    } else {
        "127.0.0.1".into()
    };
    let http_url = format!("http://{}:{}", ip, local_addr.port());

    let (session_id, mut cancel_rx) = create_session();
    let sid = session_id.clone();

    VIRTUAL_STORES
        .lock()
        .unwrap()
        .insert(session_id.clone(), store.clone());

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_rx.changed() => break,
                result = listener.accept() => {
                    if let Ok((stream, addr)) = result {
                        let store_c = store.clone();
                        let app_c = app.clone();
                        let sid_c = sid.clone();
                        tokio::spawn(async move {
                            let _ = handle_virtual_http_connection(
                                stream, &store_c, &app_c, &sid_c, &addr.ip().to_string(),
                            ).await;
                        });
                    }
                }
            }
        }
    });

    Ok(FileServeStartResult {
        session_id,
        http_url,
    })
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_virtual_add_files(
    session_id: String,
    files: Vec<VirtualFileInput>,
) -> Result<(), String> {
    let store = VIRTUAL_STORES
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Session not found".to_string())?;

    let decoded = decode_virtual_files(&files)?;
    let mut map = store.write().await;
    for (name, entry) in decoded {
        map.insert(name, entry);
    }
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_virtual_remove_file(session_id: String, name: String) -> Result<(), String> {
    let store = VIRTUAL_STORES
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Session not found".to_string())?;

    store.write().await.remove(&name);
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_virtual_serve_stop(session_id: String) -> Result<(), String> {
    cancel_session(&session_id);
    VIRTUAL_STORES.lock().unwrap().remove(&session_id);
    Ok(())
}

async fn handle_virtual_http_connection(
    mut stream: tokio::net::TcpStream,
    store: &Arc<tokio::sync::RwLock<VFileMap>>,
    app: &tauri::AppHandle,
    session_id: &str,
    client_ip: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let first_line = request.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    let method = parts.first().unwrap_or(&"GET").to_string();
    let raw_path = parts.get(1).unwrap_or(&"/").to_string();

    let start = std::time::Instant::now();

    if method == "OPTIONS" {
        let resp = format!(
            "HTTP/1.1 204 No Content\r\n{}Connection: close\r\n\r\n",
            CORS_HEADERS
        );
        stream.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    let path_only = request_path_only(&raw_path);
    let decoded = urlencoding::decode(path_only).unwrap_or_else(|_| path_only.into());
    let clean = decoded.trim_start_matches('/').trim_end_matches('/');

    let map = store.read().await;

    if clean.is_empty() || clean == "/" {
        let html = generate_virtual_listing(&map);
        let resp = format!(
            "HTTP/1.1 200 OK\r\n{}Content-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            CORS_HEADERS, html.len()
        );
        let size = html.len() as u64;
        stream.write_all(resp.as_bytes()).await?;
        stream.write_all(html.as_bytes()).await?;
        emit_request(
            app, session_id, client_ip, &method, &raw_path, 200, size, start,
        );
    } else {
        let matched_key = if map.contains_key(clean) {
            Some(clean.to_string())
        } else {
            map.keys().find(|k| k.eq_ignore_ascii_case(clean)).cloned()
        };

        if let Some(key) = matched_key {
            let (data, content_type) = map.get(&key).ok_or("missing virtual file")?;
            let header = format!(
            "HTTP/1.1 200 OK\r\n{}Content-Type: {}\r\nContent-Length: {}\r\nContent-Disposition: inline; filename=\"{}\"\r\nConnection: close\r\n\r\n",
            CORS_HEADERS, content_type, data.len(), key
        );
            stream.write_all(header.as_bytes()).await?;
            stream.write_all(data).await?;
            emit_request(
                app,
                session_id,
                client_ip,
                &method,
                &raw_path,
                200,
                data.len() as u64,
                start,
            );
        } else {
            let body = b"404 Not Found";
            let resp = format!(
                "HTTP/1.1 404 Not Found\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n",
                CORS_HEADERS,
                body.len()
            );
            stream.write_all(resp.as_bytes()).await?;
            stream.write_all(body).await?;
            emit_request(
                app,
                session_id,
                client_ip,
                &method,
                &raw_path,
                404,
                body.len() as u64,
                start,
            );
        }
    }

    Ok(())
}

fn generate_virtual_listing(files: &VFileMap) -> String {
    let mut entries: Vec<(&String, &(Vec<u8>, String))> = files.iter().collect();
    entries.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    let file_count = entries.len();
    let total_size: u64 = entries.iter().map(|(_, (data, _))| data.len() as u64).sum();

    let mut html = format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Virtual File Server</title>
<style>
*,*::before,*::after{{box-sizing:border-box}}
:root{{
  --bg:#0a0a0f;--surface:#10101a;--surface2:#161622;--surface3:#1c1c2c;
  --border:#1e1e30;--border2:#282840;
  --text:#d0d0e0;--text2:#7878a0;
  --accent:#6c9cff;--accent-dim:#4a6aa0;--accent-bg:rgba(108,156,255,0.06);
  --green:#4ade80;--amber:#fbbf24;--purple:#a78bfa;--red:#f87171;--cyan:#22d3ee;
  --radius:10px;
}}
body{{font-family:'Inter',system-ui,-apple-system,sans-serif;margin:0;padding:0;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:1000px;margin:0 auto;padding:28px 24px}}

.header{{margin-bottom:20px}}
.header h1{{font-size:13px;font-weight:600;color:var(--text);margin:0 0 4px;display:flex;align-items:center;gap:6px}}
.header h1 svg{{width:15px;height:15px;flex-shrink:0}}
.header .sub{{font-size:11px;color:var(--text2)}}

.toolbar{{display:flex;align-items:center;gap:8px;margin:16px 0 12px;flex-wrap:wrap}}
.search-box{{position:relative;flex:1;min-width:180px}}
.search-box input{{width:100%;height:34px;padding:0 12px 0 34px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;outline:none;transition:border-color .2s,box-shadow .2s}}
.search-box input:focus{{border-color:var(--accent-dim);box-shadow:0 0 0 3px rgba(108,156,255,0.08)}}
.search-box input::placeholder{{color:var(--text2);opacity:0.6}}
.search-box svg{{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text2);pointer-events:none}}
.search-count{{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--text2);font-variant-numeric:tabular-nums}}
.kbd{{display:inline-block;font-size:9px;font-family:'SF Mono',Monaco,Consolas,monospace;padding:1px 5px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text2)}}

.stats{{display:flex;gap:14px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--text2);margin-bottom:12px}}
.stats span{{display:flex;align-items:center;gap:5px}}
.stats .dot{{width:6px;height:6px;border-radius:50%}}
.stats .dot-file{{background:var(--green)}}.stats .dot-size{{background:var(--purple)}}

.table-wrap{{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}}
table{{width:100%;border-collapse:collapse}}
thead th{{padding:8px 14px;text-align:left;font-size:10px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--border);background:var(--surface2);cursor:pointer;user-select:none;white-space:nowrap;transition:color .15s}}
thead th:hover{{color:var(--text)}}
thead th.r{{text-align:right}}
thead th .sort-arrow{{display:inline-block;margin-left:4px;font-size:9px;opacity:0.4;transition:opacity .15s}}
thead th.sorted .sort-arrow{{opacity:1;color:var(--accent)}}
tbody tr{{transition:background .12s}}
tbody tr:hover{{background:var(--surface2)}}
tbody td{{padding:7px 14px;font-size:13px;border-bottom:1px solid rgba(30,30,48,0.6)}}
tbody tr:last-child td{{border-bottom:none}}
.icon{{width:28px;text-align:center}}.icon svg{{width:16px;height:16px;vertical-align:middle}}
.name a{{color:var(--text);text-decoration:none;font-weight:500;transition:color .12s}}.name a:hover{{color:var(--accent)}}
.name .hl{{background:rgba(108,156,255,0.2);color:var(--accent);border-radius:2px;padding:0 1px}}
.ext-tag{{display:inline-block;margin-left:6px;font-size:9px;font-weight:600;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:0.03em;opacity:0.7;vertical-align:1px}}
.ext-tag.cfg{{background:rgba(251,191,36,0.1);color:var(--amber)}}
.ext-tag.bin{{background:rgba(167,139,250,0.1);color:var(--purple)}}
.ext-tag.log{{background:rgba(200,200,216,0.06);color:var(--text2)}}
.sz{{text-align:right;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:12px;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}}
.tp{{text-align:right;font-size:11px;color:var(--text2);white-space:nowrap}}
.empty-row td{{text-align:center;padding:32px 14px;color:var(--text2);font-size:12px}}
.footer{{margin-top:16px;padding:12px 0;border-top:1px solid var(--border);font-size:10px;color:var(--text2);display:flex;justify-content:space-between;align-items:center;opacity:0.7}}
</style>
</head>
<body>
<div class="wrap">
<div class="header">
<h1>{hd_icon}Virtual File Server</h1>
<div class="sub">Files served from memory — drag and drop in the app to add more</div>
</div>"##,
        hd_icon = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"var(--accent)\"><path d=\"M224,64H32A16,16,0,0,0,16,80v96a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V80A16,16,0,0,0,224,64Zm0,112H32V80H224v96Zm-40-48a12,12,0,1,1-12-12A12,12,0,0,1,184,128Z\"/></svg>",
    );

    // Stats
    html.push_str(&format!(
        "<div class=\"stats\">\
         <span><span class=\"dot dot-file\"></span>{} file{}</span>\
         <span><span class=\"dot dot-size\"></span>{}</span>\
         </div>",
        file_count,
        if file_count == 1 { "" } else { "s" },
        format_file_size(total_size),
    ));

    // Toolbar
    html.push_str(r##"<div class="toolbar">
<div class="search-box">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>
<input type="text" id="search" placeholder="Search files..." autofocus>
<span class="search-count" id="searchCount"></span>
</div>
<div style="display:flex;align-items:center;gap:6px">
<span style="font-size:10px;color:var(--text2)">/</span><span class="kbd">to search</span>
</div>
</div>"##);

    // Table
    html.push_str(r##"<div class="table-wrap"><table id="fileTable"><thead><tr>
<th style="width:32px"></th>
<th class="sortable sorted" data-col="name" data-type="string">Name <span class="sort-arrow">▲</span></th>
<th style="width:80px" class="r sortable" data-col="size" data-type="num">Size <span class="sort-arrow">▲</span></th>
<th style="width:130px" class="r sortable" data-col="type" data-type="string">Type <span class="sort-arrow">▲</span></th>
</tr></thead><tbody id="fileBody">"##);

    if entries.is_empty() {
        html.push_str("<tr class=\"empty-row\"><td colspan=\"4\">No files — drop files in the app to serve them</td></tr>");
    }

    for (name, (data, content_type)) in &entries {
        let (icon_path, icon_color) = file_icon_for_ext(name);
        let icon = ph_icon(icon_path, icon_color);
        let href = urlencoding::encode(name);
        let size_str = format_file_size(data.len() as u64);
        let badge = file_badge(name, false);
        let short_type = content_type.split(';').next().unwrap_or(content_type);

        html.push_str(&format!(
            "<tr data-name=\"{esc_name}\" data-size=\"{raw_size}\" data-type=\"{tp}\">\
             <td class=\"icon\">{icon}</td>\
             <td class=\"name\"><a href=\"{href}\">{name}</a>{badge}</td>\
             <td class=\"sz\">{sz}</td>\
             <td class=\"tp\">{tp}</td></tr>",
            esc_name = name.replace('"', "&quot;"),
            raw_size = data.len(),
            icon = icon,
            href = href,
            name = name,
            badge = badge,
            sz = size_str,
            tp = short_type,
        ));
    }

    html.push_str("</tbody></table></div>");

    html.push_str(&format!(
        "<div class=\"footer\">\
         <span>Served by SIPalyzer</span>\
         <span>{} file{}</span>\
         </div></div>",
        file_count,
        if file_count == 1 { "" } else { "s" },
    ));

    // JavaScript for search + sort
    html.push_str(r##"<script>
(function(){
  const input=document.getElementById('search');
  const countEl=document.getElementById('searchCount');
  const tbody=document.getElementById('fileBody');
  const ths=document.querySelectorAll('th.sortable');
  let sortCol='name',sortAsc=true;

  function doFilter(){
    const q=input.value.toLowerCase().trim();
    const rows=tbody.querySelectorAll('tr:not(.empty-row)');
    let visible=0;
    rows.forEach(r=>{
      const name=r.dataset.name||'';
      const show=!q||name.toLowerCase().includes(q);
      r.style.display=show?'':'none';
      if(show)visible++;
      const nameCell=r.querySelector('.name a');
      if(nameCell){
        const orig=nameCell.textContent;
        if(q&&show){
          const idx=orig.toLowerCase().indexOf(q);
          if(idx>=0){
            nameCell.innerHTML=orig.slice(0,idx)+'<span class="hl">'+orig.slice(idx,idx+q.length)+'</span>'+orig.slice(idx+q.length);
          }
        } else { nameCell.innerHTML=orig; }
      }
    });
    countEl.textContent=q?(visible+' found'):'';
  }

  input.addEventListener('input',doFilter);

  function doSort(){
    const rows=Array.from(tbody.querySelectorAll('tr:not(.empty-row)'));
    rows.sort((a,b)=>{
      let av,bv;
      if(sortCol==='name'){av=a.dataset.name.toLowerCase();bv=b.dataset.name.toLowerCase();}
      else if(sortCol==='size'){av=parseInt(a.dataset.size)||0;bv=parseInt(b.dataset.size)||0;}
      else if(sortCol==='type'){av=a.dataset.type||'';bv=b.dataset.type||'';}
      if(typeof av==='number'){return sortAsc?av-bv:bv-av;}
      return sortAsc?av.localeCompare(bv):bv.localeCompare(av);
    });
    rows.forEach(r=>tbody.appendChild(r));
  }

  ths.forEach(th=>{
    th.addEventListener('click',()=>{
      const col=th.dataset.col;
      if(sortCol===col){sortAsc=!sortAsc;}
      else{sortCol=col;sortAsc=true;}
      ths.forEach(t=>{t.classList.remove('sorted');t.querySelector('.sort-arrow').textContent='▲';});
      th.classList.add('sorted');
      th.querySelector('.sort-arrow').textContent=sortAsc?'▲':'▼';
      doSort();
    });
  });

  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&document.activeElement!==input){e.preventDefault();input.focus();}
    if(e.key==='Escape'){input.value='';doFilter();input.blur();}
  });
})();
</script></body></html>"##);

    html
}

const CORS_HEADERS: &str = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nX-Content-Type-Options: nosniff\r\n";

fn request_path_only(raw_path: &str) -> &str {
    raw_path
        .split_once('?')
        .map(|(p, _)| p)
        .unwrap_or(raw_path)
        .split_once('#')
        .map(|(p, _)| p)
        .unwrap_or(raw_path)
}

async fn handle_http_connection(
    mut stream: tokio::net::TcpStream,
    serve_root: &Path,
    app: &tauri::AppHandle,
    session_id: &str,
    client_ip: &str,
    hide_hidden: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let first_line = request.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    let method = parts.first().unwrap_or(&"GET").to_string();
    let raw_path = parts.get(1).unwrap_or(&"/").to_string();

    let start = std::time::Instant::now();

    if method == "OPTIONS" {
        let resp = format!(
            "HTTP/1.1 204 No Content\r\n{}Connection: close\r\n\r\n",
            CORS_HEADERS
        );
        stream.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    let path_only = request_path_only(&raw_path);
    let decoded = urlencoding::decode(path_only).unwrap_or_else(|_| path_only.into());
    let clean = decoded.trim_start_matches('/');
    let target = serve_root.join(clean);
    let mut canonical_target = target.canonicalize().unwrap_or_else(|_| target.clone());

    // Some endpoints/phones vary filename case; allow case-insensitive file fallback.
    if !canonical_target.exists() && !clean.is_empty() {
        let parent = target.parent().unwrap_or(serve_root);
        if let Some(wanted) = target.file_name().and_then(|n| n.to_str()) {
            if let Ok(rd) = std::fs::read_dir(parent) {
                for entry in rd.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.eq_ignore_ascii_case(wanted) {
                        canonical_target =
                            entry.path().canonicalize().unwrap_or_else(|_| entry.path());
                        break;
                    }
                }
            }
        }
    }

    if !canonical_target.starts_with(serve_root) {
        let body = b"403 Forbidden";
        let resp = format!(
            "HTTP/1.1 403 Forbidden\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n",
            CORS_HEADERS,
            body.len()
        );
        stream.write_all(resp.as_bytes()).await?;
        stream.write_all(body).await?;
        emit_request(
            app,
            session_id,
            client_ip,
            &method,
            &raw_path,
            403,
            body.len() as u64,
            start,
        );
        return Ok(());
    }

    if canonical_target.is_dir() {
        let html = generate_directory_listing(&canonical_target, &raw_path, hide_hidden);
        let resp = format!(
            "HTTP/1.1 200 OK\r\n{}Content-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            CORS_HEADERS, html.len()
        );
        let size = html.len() as u64;
        stream.write_all(resp.as_bytes()).await?;
        stream.write_all(html.as_bytes()).await?;
        emit_request(
            app, session_id, client_ip, &method, &raw_path, 200, size, start,
        );
    } else if canonical_target.is_file() {
        let meta = tokio::fs::metadata(&canonical_target).await?;
        let len = meta.len();
        let ct = guess_content_type(&canonical_target);
        let filename = canonical_target
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "download".into());
        let header = format!(
            "HTTP/1.1 200 OK\r\n{}Content-Type: {}\r\nContent-Length: {}\r\nContent-Disposition: inline; filename=\"{}\"\r\nConnection: close\r\n\r\n",
            CORS_HEADERS, ct, len, filename
        );
        stream.write_all(header.as_bytes()).await?;

        let mut file = tokio::fs::File::open(&canonical_target).await?;
        let mut chunk = vec![0u8; 65536];
        loop {
            let n = tokio::io::AsyncReadExt::read(&mut file, &mut chunk).await?;
            if n == 0 {
                break;
            }
            stream.write_all(&chunk[..n]).await?;
        }
        emit_request(
            app, session_id, client_ip, &method, &raw_path, 200, len, start,
        );
    } else {
        let body = b"404 Not Found";
        let resp = format!(
            "HTTP/1.1 404 Not Found\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n",
            CORS_HEADERS,
            body.len()
        );
        stream.write_all(resp.as_bytes()).await?;
        stream.write_all(body).await?;
        emit_request(
            app,
            session_id,
            client_ip,
            &method,
            &raw_path,
            404,
            body.len() as u64,
            start,
        );
    }

    Ok(())
}

fn emit_request(
    app: &tauri::AppHandle,
    session_id: &str,
    client_ip: &str,
    method: &str,
    path: &str,
    status: u16,
    size: u64,
    start: std::time::Instant,
) {
    let _ = app.emit(
        "tools:file-request",
        FileServeRequestPayload {
            session_id: session_id.into(),
            client_ip: client_ip.into(),
            method: method.into(),
            path: path.into(),
            status,
            size,
            duration_ms: start.elapsed().as_millis() as u64,
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        },
    );
}

fn generate_directory_listing(dir: &Path, url_path: &str, hide_hidden: bool) -> String {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if hide_hidden {
                !e.file_name().to_string_lossy().starts_with('.')
            } else {
                true
            }
        })
        .collect();
    entries.sort_by_key(|e| {
        (
            !e.file_type().map(|ft| ft.is_dir()).unwrap_or(false),
            e.file_name(),
        )
    });

    let dir_count = entries
        .iter()
        .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
        .count();
    let file_count = entries.len() - dir_count;
    let total_size: u64 = entries
        .iter()
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum();

    let mut html = format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Index of {p}</title>
<style>
*,*::before,*::after{{box-sizing:border-box}}
:root{{
  --bg:#0a0a0f;--surface:#10101a;--surface2:#161622;--surface3:#1c1c2c;
  --border:#1e1e30;--border2:#282840;
  --text:#d0d0e0;--text2:#7878a0;--text3:#5555778;
  --accent:#6c9cff;--accent-dim:#4a6aa0;--accent-bg:rgba(108,156,255,0.06);
  --green:#4ade80;--amber:#fbbf24;--purple:#a78bfa;--red:#f87171;--cyan:#22d3ee;
  --radius:10px;
}}
body{{font-family:'Inter',system-ui,-apple-system,sans-serif;margin:0;padding:0;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:1000px;margin:0 auto;padding:28px 24px}}

/* Header */
.header{{margin-bottom:20px}}
.header h1{{font-size:13px;font-weight:600;color:var(--text);margin:0 0 8px;letter-spacing:-0.01em;display:flex;align-items:center;gap:6px}}
.header h1 svg{{width:15px;height:15px;flex-shrink:0}}
.breadcrumb{{display:flex;align-items:center;gap:3px;font-size:12px;color:var(--text2);font-family:'SF Mono',Monaco,Consolas,monospace;flex-wrap:wrap}}
.breadcrumb a{{color:var(--accent-dim);text-decoration:none;padding:2px 4px;border-radius:4px;transition:all .15s}}
.breadcrumb a:hover{{color:var(--accent);background:var(--accent-bg)}}
.breadcrumb .sep{{opacity:0.25;font-size:10px}}

/* Toolbar */
.toolbar{{display:flex;align-items:center;gap:8px;margin:16px 0 12px;flex-wrap:wrap}}
.search-box{{position:relative;flex:1;min-width:180px}}
.search-box input{{width:100%;height:34px;padding:0 12px 0 34px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;outline:none;transition:border-color .2s,box-shadow .2s}}
.search-box input:focus{{border-color:var(--accent-dim);box-shadow:0 0 0 3px rgba(108,156,255,0.08)}}
.search-box input::placeholder{{color:var(--text2);opacity:0.6}}
.search-box svg{{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text2);pointer-events:none}}
.search-count{{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--text2);font-variant-numeric:tabular-nums}}
.pill-group{{display:flex;gap:2px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:2px}}
.pill{{padding:5px 10px;font-size:10px;font-weight:600;color:var(--text2);cursor:pointer;border-radius:6px;transition:all .15s;text-transform:uppercase;letter-spacing:0.04em;border:none;background:none}}
.pill:hover{{color:var(--text)}}
.pill.active{{background:var(--accent-bg);color:var(--accent)}}

/* Stats */
.stats{{display:flex;gap:14px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--text2);margin-bottom:12px}}
.stats span{{display:flex;align-items:center;gap:5px}}
.stats .dot{{width:6px;height:6px;border-radius:50%}}
.stats .dot-dir{{background:var(--accent)}}.stats .dot-file{{background:var(--green)}}.stats .dot-size{{background:var(--purple)}}

/* Table */
.table-wrap{{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}}
table{{width:100%;border-collapse:collapse}}
thead th{{padding:8px 14px;text-align:left;font-size:10px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--border);background:var(--surface2);cursor:pointer;user-select:none;white-space:nowrap;transition:color .15s}}
thead th:hover{{color:var(--text)}}
thead th.r{{text-align:right}}
thead th .sort-arrow{{display:inline-block;margin-left:4px;font-size:9px;opacity:0.4;transition:opacity .15s}}
thead th.sorted .sort-arrow{{opacity:1;color:var(--accent)}}
tbody tr{{transition:background .12s}}
tbody tr:hover{{background:var(--surface2)}}
tbody tr.match-highlight{{background:rgba(108,156,255,0.04)}}
tbody td{{padding:7px 14px;font-size:13px;border-bottom:1px solid rgba(30,30,48,0.6)}}
tbody tr:last-child td{{border-bottom:none}}
.icon{{width:28px;text-align:center}}.icon svg{{width:16px;height:16px;vertical-align:middle}}
.name{{max-width:0}}
.name a{{color:var(--text);text-decoration:none;font-weight:500;transition:color .12s}}
.name a:hover{{color:var(--accent)}}
.name .dir-a{{color:var(--accent)}}
.name .hidden-f{{opacity:0.4}}
.name .hl{{background:rgba(108,156,255,0.2);color:var(--accent);border-radius:2px;padding:0 1px}}
.ext-tag{{display:inline-block;margin-left:6px;font-size:9px;font-weight:600;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:0.03em;opacity:0.7;vertical-align:1px}}
.ext-tag.cfg{{background:rgba(251,191,36,0.1);color:var(--amber)}}
.ext-tag.bin{{background:rgba(167,139,250,0.1);color:var(--purple)}}
.ext-tag.log{{background:rgba(200,200,216,0.06);color:var(--text2)}}
.ext-tag.dir{{background:rgba(108,156,255,0.08);color:var(--accent)}}
.sz{{text-align:right;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:12px;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}}
.mod{{text-align:right;font-size:11px;color:var(--text2);white-space:nowrap}}
.empty-row td{{text-align:center;padding:32px 14px;color:var(--text2);font-size:12px}}

/* Footer */
.footer{{margin-top:16px;padding:12px 0;border-top:1px solid var(--border);font-size:10px;color:var(--text2);display:flex;justify-content:space-between;align-items:center;opacity:0.7}}

/* Keyboard shortcut hint */
.kbd{{display:inline-block;font-size:9px;font-family:'SF Mono',Monaco,Consolas,monospace;padding:1px 5px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text2);margin-left:4px;vertical-align:1px}}

/* No-results */
.no-results{{text-align:center;padding:40px 20px;color:var(--text2);font-size:12px}}
.no-results svg{{width:32px;height:32px;margin-bottom:8px;opacity:0.3}}

/* Smooth transitions for filter */
tbody tr{{transition:background .12s}}
tbody tr[style*="display: none"]{{height:0;overflow:hidden}}
</style>
</head>
<body>
<div class="wrap">
<div class="header">
<h1>{hd_icon}File Server</h1>
<div class="breadcrumb">"##,
        p = url_path,
        hd_icon = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"var(--accent)\"><path d=\"M224,64H32A16,16,0,0,0,16,80v96a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V80A16,16,0,0,0,224,64Zm0,112H32V80H224v96Zm-40-48a12,12,0,1,1-12-12A12,12,0,0,1,184,128Z\"/></svg>",
    );

    // Breadcrumb navigation
    let segments: Vec<&str> = url_path.split('/').filter(|s| !s.is_empty()).collect();
    html.push_str("<a href=\"/\">/</a>");
    let mut crumb_path = String::from("/");
    for seg in &segments {
        crumb_path.push_str(seg);
        crumb_path.push('/');
        html.push_str(&format!(
            "<span class=\"sep\">&rsaquo;</span><a href=\"{}\">{}</a>",
            crumb_path, seg
        ));
    }
    html.push_str("</div></div>");

    // Stats bar
    html.push_str(&format!(
        "<div class=\"stats\">\
         <span><span class=\"dot dot-dir\"></span>{} director{}</span>\
         <span><span class=\"dot dot-file\"></span>{} file{}</span>\
         <span><span class=\"dot dot-size\"></span>{}</span>\
         </div>",
        dir_count,
        if dir_count == 1 { "y" } else { "ies" },
        file_count,
        if file_count == 1 { "" } else { "s" },
        format_file_size(total_size),
    ));

    // Toolbar
    html.push_str(r##"<div class="toolbar">
<div class="search-box">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>
<input type="text" id="search" placeholder="Search files..." autofocus>
<span class="search-count" id="searchCount"></span>
</div>
<div class="pill-group">
<button class="pill active" data-filter="all">All</button>
<button class="pill" data-filter="dir">Folders</button>
<button class="pill" data-filter="file">Files</button>
</div>
<div class="pill-group">
<span style="font-size:10px;color:var(--text2);padding:5px 6px">/</span>
<span class="kbd" style="margin-left:0">to search</span>
</div>
</div>"##);

    // Table
    html.push_str(r##"<div class="table-wrap"><table id="fileTable"><thead><tr>
<th style="width:32px"></th>
<th class="sortable sorted" data-col="name" data-type="string">Name <span class="sort-arrow">▲</span></th>
<th style="width:80px" class="r sortable" data-col="size" data-type="num">Size <span class="sort-arrow">▲</span></th>
<th style="width:140px" class="r sortable" data-col="mod" data-type="string">Modified <span class="sort-arrow">▲</span></th>
</tr></thead><tbody id="fileBody">"##);

    if url_path != "/" {
        html.push_str(&format!(
            "<tr class=\"parent-row\" data-name=\"..\" data-isdir=\"1\" data-size=\"0\" data-mod=\"\">\
             <td class=\"icon\">{}</td>\
             <td class=\"name\"><a href=\"..\" class=\"dir-a\">..</a></td>\
             <td></td><td></td></tr>",
            ph_icon(PH_ARROW_BEND_UP_LEFT, "var(--accent)")
        ));
    }

    for entry in &entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let meta = entry.metadata().ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let is_hidden = name.starts_with('.');

        let (icon_path, icon_color) = if is_dir {
            (PH_FOLDER, "var(--accent)")
        } else {
            file_icon_for_ext(&name)
        };
        let icon = ph_icon(icon_path, icon_color);
        let display = if is_dir {
            format!("{}/", name)
        } else {
            name.clone()
        };
        let href = urlencoding::encode(&name);
        let href = if is_dir {
            format!("{}/", href)
        } else {
            href.to_string()
        };
        let size_str = if is_dir {
            String::new()
        } else {
            format_file_size(size)
        };

        let mod_str = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                dt.format("%b %d, %H:%M").to_string()
            })
            .unwrap_or_default();

        let mod_sort = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                dt.format("%Y%m%d%H%M%S").to_string()
            })
            .unwrap_or_default();

        let link_class = if is_dir {
            "dir-a"
        } else if is_hidden {
            "hidden-f"
        } else {
            ""
        };
        let badge = file_badge(&name, is_dir);

        html.push_str(&format!(
            "<tr data-name=\"{esc_name}\" data-isdir=\"{isdir}\" data-size=\"{raw_size}\" data-mod=\"{mod_sort}\">\
             <td class=\"icon\">{icon}</td>\
             <td class=\"name\"><a href=\"{href}\" class=\"{cls}\">{display}</a>{badge}</td>\
             <td class=\"sz\">{sz}</td>\
             <td class=\"mod\">{mod_str}</td></tr>",
            esc_name = name.replace('"', "&quot;"),
            isdir = if is_dir { "1" } else { "0" },
            raw_size = size,
            mod_sort = mod_sort,
            icon = icon, href = href, cls = link_class, display = display,
            badge = badge, sz = size_str, mod_str = mod_str,
        ));
    }

    html.push_str("</tbody></table></div>");

    // Footer
    html.push_str(&format!(
        "<div class=\"footer\">\
         <span>Served by SIPalyzer</span>\
         <span>{} items</span>\
         </div></div>",
        entries.len()
    ));

    // JavaScript for search, sort, filter
    html.push_str(r##"<script>
(function(){
  const input=document.getElementById('search');
  const countEl=document.getElementById('searchCount');
  const tbody=document.getElementById('fileBody');
  const pills=document.querySelectorAll('.pill[data-filter]');
  const ths=document.querySelectorAll('th.sortable');
  let typeFilter='all';
  let sortCol='name',sortAsc=true,sortType='string';

  // Search
  function doFilter(){
    const q=input.value.toLowerCase().trim();
    const rows=tbody.querySelectorAll('tr:not(.parent-row)');
    let visible=0;
    rows.forEach(r=>{
      const name=r.dataset.name||'';
      const isDir=r.dataset.isdir==='1';
      const matchQ=!q||name.toLowerCase().includes(q);
      const matchType=typeFilter==='all'||(typeFilter==='dir'&&isDir)||(typeFilter==='file'&&!isDir);
      const show=matchQ&&matchType;
      r.style.display=show?'':'none';
      if(show)visible++;
      // Highlight matches
      const nameCell=r.querySelector('.name a');
      if(nameCell){
        const orig=nameCell.textContent;
        if(q&&show){
          const idx=orig.toLowerCase().indexOf(q);
          if(idx>=0){
            nameCell.innerHTML=orig.slice(0,idx)+'<span class="hl">'+orig.slice(idx,idx+q.length)+'</span>'+orig.slice(idx+q.length);
          }
        } else {
          nameCell.innerHTML=orig;
        }
      }
    });
    countEl.textContent=q?(visible+' found'):'';
  }

  input.addEventListener('input',doFilter);

  // Type filter pills
  pills.forEach(p=>{
    p.addEventListener('click',()=>{
      pills.forEach(x=>x.classList.remove('active'));
      p.classList.add('active');
      typeFilter=p.dataset.filter;
      doFilter();
    });
  });

  // Column sorting
  function doSort(){
    const rows=Array.from(tbody.querySelectorAll('tr:not(.parent-row)'));
    rows.sort((a,b)=>{
      const ad=a.dataset.isdir==='1',bd=b.dataset.isdir==='1';
      if(ad!==bd)return ad?-1:1; // dirs always first
      let av,bv;
      if(sortCol==='name'){av=a.dataset.name.toLowerCase();bv=b.dataset.name.toLowerCase();}
      else if(sortCol==='size'){av=parseInt(a.dataset.size)||0;bv=parseInt(b.dataset.size)||0;}
      else if(sortCol==='mod'){av=a.dataset.mod||'';bv=b.dataset.mod||'';}
      if(typeof av==='number'){return sortAsc?av-bv:bv-av;}
      return sortAsc?av.localeCompare(bv):bv.localeCompare(av);
    });
    rows.forEach(r=>tbody.appendChild(r));
  }

  ths.forEach(th=>{
    th.addEventListener('click',()=>{
      const col=th.dataset.col;
      if(sortCol===col){sortAsc=!sortAsc;}
      else{sortCol=col;sortAsc=true;sortType=th.dataset.type;}
      ths.forEach(t=>{t.classList.remove('sorted');t.querySelector('.sort-arrow').textContent='▲';});
      th.classList.add('sorted');
      th.querySelector('.sort-arrow').textContent=sortAsc?'▲':'▼';
      doSort();
    });
  });

  // Keyboard shortcut: / to focus search
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&document.activeElement!==input){e.preventDefault();input.focus();}
    if(e.key==='Escape'){input.value='';doFilter();input.blur();}
  });
})();
</script></body></html>"##);

    html
}

// Phosphor Icons (Regular weight, 256x256 viewBox) — SVG path data
const PH_FOLDER: &str = "M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Zm0,128H40V56H92.69l29.65,29.66A8,8,0,0,0,128,88h88Z";
const PH_FILE: &str = "M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z";
const PH_FILE_TEXT: &str = "M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z";
const PH_GEAR: &str = "M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.68l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187.11,168a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14A8,8,0,0,0,173.23,182l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.67a73.68,73.68,0,0,1-8.67,0,8,8,0,0,0-5.69,1.74l-17.73,14.19a91.57,91.57,0,0,1-15-6.23L82.77,182a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14A8,8,0,0,0,68.89,168l-22.58-2.51a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.67,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.68L40.08,94.93a91.57,91.57,0,0,1,6.23-15L68.89,82.77A8,8,0,0,0,74,80.13a74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.77,68.89l2.51-22.58a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.68,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.68-1.74l17.73-14.19a91.57,91.57,0,0,1,15,6.23L173.23,68.89a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.9,123.66Z";
const PH_HARD_DRIVE: &str = "M224,64H32A16,16,0,0,0,16,80v96a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V80A16,16,0,0,0,224,64Zm0,112H32V80H224v96Zm-40-48a12,12,0,1,1-12-12A12,12,0,0,1,184,128Z";
const PH_TERMINAL: &str = "M117.31,134l-72,64a8,8,0,1,1-10.63-12L100,128,34.69,70A8,8,0,1,1,45.31,58l72,64a8,8,0,0,1,0,12ZM216,184H120a8,8,0,0,0,0,16h96a8,8,0,0,0,0-16Z";
const PH_PACKAGE: &str = "M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm96,129.57V133.82L216,90v85.78Z";
const PH_IMAGE: &str = "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z";
const PH_GLOBE: &str = "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.56,87.56,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.56,87.56,0,0,1,216,128ZM40,128a87.56,87.56,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.56,87.56,0,0,1,40,128Zm16.35-40H94.3a143.31,143.31,0,0,0-13.14,0h0A88.29,88.29,0,0,1,56.35,88Zm41.48,0h60.34C151.31,69.06,140.3,54.48,128,45.74,115.7,54.48,104.69,69.06,97.83,88Zm60.34,80H97.83c6.86,18.94,17.87,33.52,30.17,42.26C140.3,201.52,151.31,186.94,158.17,168Zm41.48,0H161.7a143.31,143.31,0,0,0,13.14-30.5A88.29,88.29,0,0,1,199.65,168ZM97.92,104h60.16a141.52,141.52,0,0,1,0,48H97.92a141.52,141.52,0,0,1,0-48Z";
const PH_MUSIC_NOTE: &str = "M210.3,56.34l-80-24A8,8,0,0,0,120,40V148.26A48,48,0,1,0,136,184V50.75l69.7,20.91a8,8,0,1,0,4.6-15.32ZM88,216a32,32,0,1,1,32-32A32,32,0,0,1,88,216Z";
const PH_VIDEO: &str = "M164,128a36,36,0,1,1-36-36A36,36,0,0,1,164,128Zm68-56V184a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V72A16,16,0,0,1,40,56H216A16,16,0,0,1,232,72ZM216,184V72H40V184H216Zm-88-56a20,20,0,1,0-20,20A20,20,0,0,0,128,128Z";
const PH_FILE_PDF: &str = "M224,152a8,8,0,0,1-8,8H192v16h16a8,8,0,0,1,0,16H192v16a8,8,0,0,1-16,0V152a8,8,0,0,1,8-8h32A8,8,0,0,1,224,152ZM92,172a28,28,0,0,1-28,28H56v8a8,8,0,0,1-16,0V152a8,8,0,0,1,8-8H64A28,28,0,0,1,92,172Zm-16,0a12,12,0,0,0-12-12H56v24h8A12,12,0,0,0,76,172Zm88,0a36,36,0,0,1-36,36H112a8,8,0,0,1-8-8V152a8,8,0,0,1,8-8h16A36,36,0,0,1,164,172Zm-16,0a20,20,0,0,0-20-20h-8v40h8A20,20,0,0,0,148,172ZM40,112V40A16,16,0,0,1,56,24h96a8,8,0,0,1,5.66,2.34l56,56A8,8,0,0,1,216,88v24a8,8,0,0,1-16,0V96H152a8,8,0,0,1-8-8V40H56v72a8,8,0,0,1-16,0ZM160,80h28.69L160,51.31Z";
const PH_TABLE: &str = "M224,48H32A8,8,0,0,0,24,56V200a8,8,0,0,0,8,8H224a8,8,0,0,0,8-8V56A8,8,0,0,0,224,48ZM40,112h40v32H40Zm56,0H216v32H96Zm120-8H96V64H216ZM80,64v40H40V64ZM40,160H80v32H40Zm56,32V160H216v32Z";
const PH_ARROW_BEND_UP_LEFT: &str = "M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,61.66L51.31,96H128A104.11,104.11,0,0,1,232,200Z";

fn ph_icon(path_d: &str, color: &str) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"{}\"><path d=\"{}\"/></svg>",
        color, path_d
    )
}

fn file_icon_for_ext(name: &str) -> (&'static str, &'static str) {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "cfg" | "conf" | "ini" | "yaml" | "yml" | "xml" | "json" | "toml" => {
            (PH_GEAR, "var(--amber)")
        }
        "bin" | "fw" | "img" | "rom" | "iso" => (PH_HARD_DRIVE, "var(--purple)"),
        "log" | "txt" => (PH_FILE_TEXT, "var(--text2)"),
        "sh" | "bash" | "py" | "rb" | "pl" => (PH_TERMINAL, "var(--green)"),
        "tar" | "gz" | "zip" | "tgz" | "bz2" | "xz" | "7z" => (PH_PACKAGE, "var(--purple)"),
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "ico" | "webp" => (PH_IMAGE, "var(--green)"),
        "pdf" => (PH_FILE_PDF, "var(--red)"),
        "html" | "htm" | "css" | "js" => (PH_GLOBE, "var(--accent)"),
        "csv" | "tsv" => (PH_TABLE, "var(--green)"),
        "wav" | "mp3" | "ogg" | "flac" => (PH_MUSIC_NOTE, "var(--amber)"),
        "mp4" | "mkv" | "avi" | "mov" => (PH_VIDEO, "var(--purple)"),
        _ => (PH_FILE, "var(--text2)"),
    }
}

fn file_badge(name: &str, is_dir: bool) -> String {
    if is_dir {
        return " <span class=\"ext-tag dir\">dir</span>".into();
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "cfg" | "conf" | "ini" | "yaml" | "yml" | "xml" | "json" | "toml"
            => " <span class=\"ext-tag cfg\">config</span>".into(),
        "bin" | "fw" | "img" | "rom" | "iso"
            => " <span class=\"ext-tag bin\">firmware</span>".into(),
        "log" | "txt"
            => " <span class=\"ext-tag log\">log</span>".into(),
        "sh" | "bash" | "py" | "rb" | "pl"
            => format!(" <span class=\"ext-tag\" style=\"background:rgba(74,222,128,0.08);color:var(--green)\">{}</span>", ext),
        "tar" | "gz" | "zip" | "tgz" | "bz2" | "xz" | "7z"
            => " <span class=\"ext-tag bin\">archive</span>".into(),
        "pcap" | "pcapng" | "cap"
            => " <span class=\"ext-tag\" style=\"background:rgba(34,211,238,0.08);color:var(--cyan)\">capture</span>".into(),
        _ => String::new(),
    }
}

fn guess_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "txt" | "log" | "cfg" | "conf" | "ini" | "yaml" | "yml" => "text/plain; charset=utf-8",
        "csv" => "text/csv",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "tar" => "application/x-tar",
        _ => "application/octet-stream",
    }
}

fn format_file_size(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Firmware Catalog
// ═══════════════════════════════════════════════════════════════════════

use std::sync::LazyLock;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareEntry {
    pub id: String,
    pub vendor: String,
    pub series: String,
    pub models: String,
    pub version: String,
    pub filename: String,
    pub url: String,
    pub fallback_url: String,
    pub archive_format: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub notes: String,
    pub source: String,
}

fn built_in_catalog() -> Vec<FirmwareEntry> {
    vec![
        // ── Yealink T5 Series (T53/T53C/T53W/T54/T54W/T57/T57W) ────────
        FirmwareEntry {
            id: "yealink-t5-96.87.0.16".into(),
            vendor: "yealink".into(),
            series: "T5".into(),
            models: "T53,T53C,T53W,T54,T54W,T57,T57W".into(),
            version: "96.87.0.16".into(),
            filename: "T5x.rom".into(),
            url: "https://downloads-global.3cx.com/downloads/v200/templates/firmwareupdates/yealink/T5XW-96.87.0.16.rom".into(),
            fallback_url: "".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 49_945_200,
            notes: "Latest — unified .rom for all T5x models. Single file, no extraction needed.".into(),
            source: "builtin".into(),
        },
        FirmwareEntry {
            id: "yealink-t5-96.86.0.70".into(),
            vendor: "yealink".into(),
            series: "T5".into(),
            models: "T53,T53C,T53W,T54,T54W,T57,T57W".into(),
            version: "96.86.0.70".into(),
            filename: "T5x.rom".into(),
            url: "https://cdn.lightningip.com.au/firmware/yealink/96.86.0.70-T54W%2CT57W%2CT53W%2CT53%2CT53C%2CT54%2CT57.rom".into(),
            fallback_url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T5xW/T54W(T57W,T53W,T53,T53C,T54,T57)-96.86.0.70.rom".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 45_674_848,
            notes: "Stable v86 — unified .rom for all T5x models. Good for step-upgrade before v87.".into(),
            source: "builtin".into(),
        },
        FirmwareEntry {
            id: "yealink-t5-96.86.0.45".into(),
            vendor: "yealink".into(),
            series: "T5".into(),
            models: "T53,T53C,T53W,T54,T54W,T57,T57W".into(),
            version: "96.86.0.45".into(),
            filename: "T5x.rom".into(),
            url: "https://cdn.lightningip.com.au/firmware/yealink/96.86.0.45-T54W%2CT57W%2CT53W%2CT53%2CT53C%2CT54%2CT57.rom".into(),
            fallback_url: "".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 43_072_240,
            notes: "Older v86 — unified .rom for all T5x models. Use for step-upgrade path.".into(),
            source: "builtin".into(),
        },
        // ── Yealink T4U Series (T41U/T42U/T43U/T46U/T48U) ───────────
        FirmwareEntry {
            id: "yealink-t4u-108.86.0.70".into(),
            vendor: "yealink".into(),
            series: "T4U".into(),
            models: "T41U,T42U,T43U,T46U,T48U".into(),
            version: "108.86.0.70".into(),
            filename: "T4xU.rom".into(),
            url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T4xU/T46U(T43U,T46U,T41U,T48U,T42U)-108.86.0.70.rom".into(),
            fallback_url: "".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 37_982_288,
            notes: "Latest — unified .rom for all T4xU models. Successor to T4S series.".into(),
            source: "builtin".into(),
        },
        FirmwareEntry {
            id: "yealink-t4u-108.86.0.45".into(),
            vendor: "yealink".into(),
            series: "T4U".into(),
            models: "T41U,T42U,T43U,T46U,T48U".into(),
            version: "108.86.0.45".into(),
            filename: "T4xU.rom".into(),
            url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T4xU/T46U(T43U,T46U,T41U,T48U,T42U)-108.86.0.45.rom".into(),
            fallback_url: "".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 37_055_696,
            notes: "Stable v86 — unified .rom for all T4xU models. Good for step-upgrade.".into(),
            source: "builtin".into(),
        },
        FirmwareEntry {
            id: "yealink-t4u-108.86.0.20".into(),
            vendor: "yealink".into(),
            series: "T4U".into(),
            models: "T41U,T42U,T43U,T46U,T48U".into(),
            version: "108.86.0.20".into(),
            filename: "T4xU.rom".into(),
            url: "https://cdn.lightningip.com.au/firmware/yealink/108.86.0.20-T41U-T42U-T43U-T46U-T48U.rom".into(),
            fallback_url: "".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 36_793_152,
            notes: "Earliest available v86 — use as base for step-upgrade path on T4U.".into(),
            source: "builtin".into(),
        },
        // ── Yealink T4S Series (T41S/T42S/T46S/T48S — predecessor to T4U) ──
        FirmwareEntry {
            id: "yealink-t4s-66.86.0.160".into(),
            vendor: "yealink".into(),
            series: "T4S".into(),
            models: "T41S,T42S,T46S,T48S".into(),
            version: "66.86.0.160".into(),
            filename: "T4xS.rom".into(),
            url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T4xS/T46S_T48S-T42S-T41S_66.86.0.160.rom".into(),
            fallback_url: "https://tools.dstny.nl/downloads/phone-firmware/yealink/147-t46s-t48s-t42s-t41s-66-86-0-160/file".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 23_332_560,
            notes: "Latest — unified .rom for T4xS. These models are superseded by the T4U line.".into(),
            source: "builtin".into(),
        },
        FirmwareEntry {
            id: "yealink-t4s-66.86.0.15".into(),
            vendor: "yealink".into(),
            series: "T4S".into(),
            models: "T41S,T42S,T46S,T48S".into(),
            version: "66.86.0.15".into(),
            filename: "T4xS.rom".into(),
            url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T4xS/T46S_T48S-T42S-T41S_66.86.0.15.rom".into(),
            fallback_url: "https://cdn.lightningip.com.au/firmware/yealink/66.86.0.15-T41S%2CT42S%2CT46S%2CT48S.rom".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 23_192_144,
            notes: "Older stable — use for step-upgrade before .160 on T4S models.".into(),
            source: "builtin".into(),
        },
        // ── Yealink T46G (legacy single model — predecessor to T46S/T46U) ──
        FirmwareEntry {
            id: "yealink-t46g-28.83.0.160".into(),
            vendor: "yealink".into(),
            series: "T46G".into(),
            models: "T46G".into(),
            version: "28.83.0.160".into(),
            filename: "T46G.rom".into(),
            url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T46G/T46G-28.83.0.160.rom".into(),
            fallback_url: "".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 24_625_104,
            notes: "Final — last available firmware for T46G. Superseded by T46S → T46U.".into(),
            source: "builtin".into(),
        },
        // ── Yealink T42G (legacy single model — predecessor to T42S/T42U) ──
        FirmwareEntry {
            id: "yealink-t42g-29.83.0.160".into(),
            vendor: "yealink".into(),
            series: "T42G".into(),
            models: "T42G".into(),
            version: "29.83.0.160".into(),
            filename: "T42G.rom".into(),
            url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T42G/T42G-29.83.0.160.rom".into(),
            fallback_url: "".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 8_159_536,
            notes: "Final — last available firmware for T42G. Superseded by T42S → T42U.".into(),
            source: "builtin".into(),
        },
        // ── Yealink T3 Series (T30/T30P/T31/T31P/T31G/T31W/T33P/T33G/T34W) ──
        FirmwareEntry {
            id: "yealink-t3-124.86.0.75".into(),
            vendor: "yealink".into(),
            series: "T3".into(),
            models: "T30,T30P,T31,T31P,T31G,T31W,T33P,T33G,T34W".into(),
            version: "124.86.0.75".into(),
            filename: "T3x.rom".into(),
            url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T3x/T31(T30,T30P,T31G,T31P,T33P,T33G)-124.86.0.75.rom".into(),
            fallback_url: "".into(),
            archive_format: "".into(),
            sha256: "".into(),
            size_bytes: 37_613_120,
            notes: "Latest — unified .rom for all T3x entry-level models.".into(),
            source: "builtin".into(),
        },
        // ── Poly VVX — UCS 5.9.4 ──────────────────────────────────────
        // IMPORTANT: 5.9.x is the LAST firmware stream supporting legacy
        // VVX 300/310/400/410/500/600 (non-"01" models). These were
        // dropped entirely in UCS 6.x. The absolute final 5.9.x release
        // is 5.9.8, but only 5.9.4 is available on the Bicom mirror.
        // The x50 series (150/250/350/450) was added in later 5.9.x
        // releases and is NOT included in the 5.9.4 archive.
        FirmwareEntry {
            id: "poly-vvx-5.9.4".into(),
            vendor: "poly".into(),
            series: "VVX".into(),
            models: "VVX101,VVX201,VVX300,VVX301,VVX310,VVX311,VVX400,VVX401,VVX410,VVX411,VVX500,VVX501,VVX600,VVX601".into(),
            version: "5.9.4".into(),
            filename: "sip.ld".into(),
            url: "https://downloads.bicomsystems.com/polycom/polycom-v5.9.4.tar.bz2".into(),
            fallback_url: "".into(),
            archive_format: "tar.bz2".into(),
            sha256: "".into(),
            size_bytes: 344_440_843,
            notes: "Supports ALL VVX models incl. legacy 300/310/400/410/500/600. Last stream for these legacy models — they are DROPPED in UCS 6.x. Final 5.9.x is 5.9.8, but only 5.9.4 available on mirror. ~328 MB archive, extracts per-model .sip.ld and .cfg files.".into(),
            source: "builtin".into(),
        },
        // ── Poly VVX — UCS 6.1.0 ──────────────────────────────────────
        // First 6.x release. Adds VVX x50 series (150/250/350/450).
        // DROPS legacy models: VVX 300, 310, 400, 410, 500, 600.
        // The "01" successors (301/311/401/411/501/601) are still supported.
        FirmwareEntry {
            id: "poly-vvx-6.1.0".into(),
            vendor: "poly".into(),
            series: "VVX".into(),
            models: "VVX101,VVX150,VVX201,VVX250,VVX301,VVX311,VVX350,VVX401,VVX411,VVX450,VVX501,VVX601".into(),
            version: "6.1.0".into(),
            filename: "sip.ld".into(),
            url: "https://downloads.bicomsystems.com/polycom/polycom-v6.1.0.tar.bz2".into(),
            fallback_url: "".into(),
            archive_format: "tar.bz2".into(),
            sha256: "".into(),
            size_bytes: 667_566_080,
            notes: "First UCS 6.x — adds VVX x50 (150/250/350/450). DROPS legacy 300/310/400/410/500/600. Use 5.9.4 for those models. ~637 MB archive, extracts per-model .sip.ld and .cfg files.".into(),
            source: "builtin".into(),
        },
        // ── Poly VVX — UCS 6.4.7 (latest) ────────────────────────────
        // Latest and final known release for Poly VVX. Supports the same
        // model set as 6.1.0 (x50 + "01" models). No legacy 300/310/etc.
        FirmwareEntry {
            id: "poly-vvx-6.4.7".into(),
            vendor: "poly".into(),
            series: "VVX".into(),
            models: "VVX101,VVX150,VVX201,VVX250,VVX301,VVX311,VVX350,VVX401,VVX411,VVX450,VVX501,VVX601".into(),
            version: "6.4.7".into(),
            filename: "sip.ld".into(),
            url: "https://downloads.bicomsystems.com/polycom/poly_vvx_6.4.7.tar.bz2".into(),
            fallback_url: "".into(),
            archive_format: "tar.bz2".into(),
            sha256: "".into(),
            size_bytes: 956_452_360,
            notes: "Latest UCS release — all current VVX models. Does NOT support legacy 300/310/400/410/500/600 (use 5.9.4). ~912 MB archive, extracts per-model .sip.ld and .cfg files.".into(),
            source: "builtin".into(),
        },
    ]
}

static RUNTIME_CATALOG: LazyLock<RwLock<Vec<FirmwareEntry>>> =
    LazyLock::new(|| RwLock::new(built_in_catalog()));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareCacheEntry {
    pub entry_id: String,
    pub filename: String,
    pub files: Vec<String>,
    pub size: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareDownloadProgress {
    pub entry_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub pct: f64,
    /// "downloading" or "extracting"
    pub phase: String,
    pub files_extracted: u32,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_catalog() -> Result<Vec<FirmwareEntry>, String> {
    let catalog = RUNTIME_CATALOG.read().await;
    Ok(catalog.clone())
}

// ── Firmware Update Checks ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareUpdateCheck {
    pub series: String,
    pub vendor: String,
    pub catalog_latest: String,
    pub mirror_latest: String,
    pub has_update: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareCheckResult {
    pub checks: Vec<FirmwareUpdateCheck>,
    pub new_entries: Vec<FirmwareEntry>,
}

struct MirrorConfig {
    vendor: &'static str,
    series: &'static str,
    url: &'static str,
}

static MIRROR_CHECKS: &[MirrorConfig] = &[
    MirrorConfig {
        vendor: "yealink",
        series: "T5",
        url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T5xW/",
    },
    MirrorConfig {
        vendor: "yealink",
        series: "T4U",
        url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T4xU/",
    },
    MirrorConfig {
        vendor: "yealink",
        series: "T4S",
        url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T4xS/",
    },
    MirrorConfig {
        vendor: "yealink",
        series: "T3",
        url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T3x/",
    },
    MirrorConfig {
        vendor: "yealink",
        series: "T46G",
        url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T46G/",
    },
    MirrorConfig {
        vendor: "yealink",
        series: "T42G",
        url: "https://download.1afa.com/telefonie/toestellen/yealink/firmware/T42G/",
    },
    MirrorConfig {
        vendor: "poly",
        series: "VVX",
        url: "https://downloads.bicomsystems.com/polycom/",
    },
];

fn compare_fw_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let a_parts: Vec<u64> = a.split('.').filter_map(|s| s.parse().ok()).collect();
    let b_parts: Vec<u64> = b.split('.').filter_map(|s| s.parse().ok()).collect();
    let len = a_parts.len().max(b_parts.len());
    for i in 0..len {
        let av = a_parts.get(i).copied().unwrap_or(0);
        let bv = b_parts.get(i).copied().unwrap_or(0);
        match av.cmp(&bv) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

fn extract_yealink_version(filename: &str) -> Option<String> {
    let name = filename.strip_suffix(".rom")?;
    for part in name.split(|c: char| c == '-' || c == '_').rev() {
        let segs: Vec<&str> = part.split('.').collect();
        if segs.len() == 4
            && segs
                .iter()
                .all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
        {
            return Some(part.to_string());
        }
    }
    None
}

fn extract_poly_version(filename: &str) -> Option<String> {
    let name = filename.strip_suffix(".tar.bz2")?;
    for part in name.rsplit(|c: char| c == '-' || c == '_' || c == 'v') {
        let segs: Vec<&str> = part.split('.').collect();
        if (2..=3).contains(&segs.len())
            && segs
                .iter()
                .all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
        {
            return Some(part.to_string());
        }
    }
    None
}

fn parse_versions_from_listing(html: &str, vendor: &str) -> Vec<(String, String)> {
    let mut results: Vec<(String, String)> = Vec::new();
    let ext = if vendor == "poly" { ".tar.bz2" } else { ".rom" };
    let mut pos = 0;
    while let Some(idx) = html[pos..].find("href=\"") {
        let start = pos + idx + 6;
        if let Some(end) = html[start..].find('"') {
            let href = &html[start..start + end];
            if href.ends_with(ext) {
                let ver = if vendor == "poly" {
                    extract_poly_version(href)
                } else {
                    extract_yealink_version(href)
                };
                if let Some(v) = ver {
                    if !results.iter().any(|(rv, _)| rv == &v) {
                        results.push((v, href.to_string()));
                    }
                }
            }
            pos = start + end + 1;
        } else {
            break;
        }
    }
    results.sort_by(|a, b| compare_fw_versions(&a.0, &b.0));
    results
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_check_updates() -> Result<FirmwareCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let mut checks = Vec::new();
    let mut new_entries: Vec<FirmwareEntry> = Vec::new();

    let catalog = RUNTIME_CATALOG.read().await;
    let catalog_versions: std::collections::HashSet<String> = catalog
        .iter()
        .map(|e| format!("{}-{}-{}", e.vendor, e.series, e.version))
        .collect();

    for check in MIRROR_CHECKS {
        let html = match client.get(check.url).send().await {
            Ok(resp) if resp.status().is_success() => resp.text().await.unwrap_or_default(),
            _ => continue,
        };

        let found = parse_versions_from_listing(&html, check.vendor);

        let mirror_latest = found
            .iter()
            .max_by(|(a, _), (b, _)| compare_fw_versions(a, b))
            .map(|(v, _)| v.clone())
            .unwrap_or_default();

        let catalog_latest = catalog
            .iter()
            .filter(|e| e.vendor == check.vendor && e.series == check.series)
            .map(|e| e.version.as_str())
            .max_by(|a, b| compare_fw_versions(a, b))
            .unwrap_or("")
            .to_string();

        if mirror_latest.is_empty() {
            continue;
        }

        let has_update =
            compare_fw_versions(&mirror_latest, &catalog_latest) == std::cmp::Ordering::Greater;

        checks.push(FirmwareUpdateCheck {
            series: check.series.to_string(),
            vendor: check.vendor.to_string(),
            catalog_latest: catalog_latest.clone(),
            mirror_latest,
            has_update,
        });

        let template = catalog
            .iter()
            .find(|e| e.vendor == check.vendor && e.series == check.series);

        for (version, href) in &found {
            let key = format!("{}-{}-{}", check.vendor, check.series, version);
            if catalog_versions.contains(&key) {
                continue;
            }

            let models = template
                .map(|t| t.models.as_str())
                .unwrap_or("")
                .to_string();
            let filename = template
                .map(|t| t.filename.as_str())
                .unwrap_or("")
                .to_string();
            let archive_format = if check.vendor == "poly" {
                "tar.bz2".to_string()
            } else {
                String::new()
            };

            let url = if href.starts_with("http") {
                href.clone()
            } else {
                format!("{}{}", check.url, href)
            };

            let id = format!(
                "{}-{}-{}",
                check.vendor,
                check.series.to_lowercase(),
                version
            );

            new_entries.push(FirmwareEntry {
                id,
                vendor: check.vendor.to_string(),
                series: check.series.to_string(),
                models,
                version: version.clone(),
                filename,
                url,
                fallback_url: String::new(),
                archive_format,
                sha256: String::new(),
                size_bytes: 0,
                notes: "Discovered on mirror".to_string(),
                source: "mirror".to_string(),
            });
        }
    }
    drop(catalog);

    new_entries.sort_by(|a, b| {
        a.vendor
            .cmp(&b.vendor)
            .then_with(|| a.series.cmp(&b.series))
            .then_with(|| compare_fw_versions(&b.version, &a.version))
    });

    if !new_entries.is_empty() {
        let mut catalog = RUNTIME_CATALOG.write().await;
        for entry in &new_entries {
            if !catalog.iter().any(|e| e.id == entry.id) {
                catalog.push(entry.clone());
            }
        }
    }

    Ok(FirmwareCheckResult {
        checks,
        new_entries,
    })
}

static FIRMWARE_CACHE_OVERRIDE: LazyLock<RwLock<Option<PathBuf>>> =
    LazyLock::new(|| RwLock::new(None));

fn firmware_prefs_path() -> Result<PathBuf, String> {
    let config =
        crate::core::config::get_config_dir().map_err(|e| format!("Config dir error: {}", e))?;
    Ok(config.join("firmware_prefs.json"))
}

fn firmware_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(guard) = FIRMWARE_CACHE_OVERRIDE.try_read() {
        if let Some(ref custom) = *guard {
            std::fs::create_dir_all(custom)
                .map_err(|e| format!("Failed to create firmware dir: {}", e))?;
            return Ok(custom.clone());
        }
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = base.join("firmware");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create firmware cache dir: {}", e))?;
    Ok(dir)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_get_cache_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = firmware_cache_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_set_cache_dir(path: Option<String>) -> Result<String, String> {
    let resolved = match &path {
        Some(p) if !p.is_empty() => {
            let pb = PathBuf::from(p);
            std::fs::create_dir_all(&pb).map_err(|e| format!("Cannot create directory: {}", e))?;
            Some(pb)
        }
        _ => None,
    };

    let display = resolved
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "default".into());

    {
        let mut guard = FIRMWARE_CACHE_OVERRIDE.write().await;
        *guard = resolved;
    }

    let prefs_path = firmware_prefs_path()?;
    let json = serde_json::json!({ "cache_dir": path });
    std::fs::write(
        &prefs_path,
        serde_json::to_string_pretty(&json).unwrap_or_default(),
    )
    .map_err(|e| format!("Failed to save preferences: {}", e))?;

    Ok(display)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_load_prefs() -> Result<(), String> {
    let prefs_path = firmware_prefs_path()?;
    if !prefs_path.exists() {
        return Ok(());
    }
    let data = std::fs::read_to_string(&prefs_path).map_err(|e| format!("Read prefs: {}", e))?;
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(&data) {
        if let Some(dir) = obj.get("cache_dir").and_then(|v| v.as_str()) {
            if !dir.is_empty() {
                let pb = PathBuf::from(dir);
                if pb.exists() || std::fs::create_dir_all(&pb).is_ok() {
                    let mut guard = FIRMWARE_CACHE_OVERRIDE.write().await;
                    *guard = Some(pb);
                }
            }
        }
    }
    Ok(())
}

fn is_firmware_file(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".sip.ld")
        || n.ends_with(".ld")
        || n.ends_with(".cfg")
        || n.ends_with(".rom")
        || n.ends_with(".bin")
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_cache_list(
    app: tauri::AppHandle,
) -> Result<Vec<FirmwareCacheEntry>, String> {
    let dir = firmware_cache_dir(&app)?;
    let mut entries = Vec::new();
    let mut loose_files: Vec<String> = Vec::new();

    let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for item in rd.flatten() {
        let meta = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = item.file_name().to_string_lossy().to_string();

        if meta.is_dir() {
            let mut total_size: u64 = 0;
            let mut files: Vec<String> = Vec::new();
            if let Ok(sub_rd) = std::fs::read_dir(item.path()) {
                for sub_item in sub_rd.flatten() {
                    if let Ok(sub_meta) = sub_item.metadata() {
                        if sub_meta.is_file() {
                            let fname = sub_item.file_name().to_string_lossy().to_string();
                            if fname.ends_with(".tmp") {
                                continue;
                            }
                            total_size += sub_meta.len();
                            files.push(fname);
                        }
                    }
                }
            }
            if !files.is_empty() {
                let first_file = files[0].clone();
                entries.push(FirmwareCacheEntry {
                    entry_id: name,
                    filename: first_file,
                    files,
                    size: total_size,
                    path: item.path().to_string_lossy().to_string(),
                });
            }
        } else if meta.is_file() && is_firmware_file(&name) {
            loose_files.push(name);
        }
    }

    if !loose_files.is_empty() {
        let catalog = RUNTIME_CATALOG.read().await;
        for cat_entry in catalog.iter() {
            let matched: Vec<String> = loose_files
                .iter()
                .filter(|f| {
                    let fl = f.to_lowercase();
                    let series_lower = cat_entry.series.to_lowercase().replace(' ', "");
                    fl.contains(&series_lower)
                })
                .cloned()
                .collect();

            if !matched.is_empty() && !entries.iter().any(|e| e.entry_id == cat_entry.id) {
                let sub_dir = dir.join(&cat_entry.id);
                let _ = std::fs::create_dir_all(&sub_dir);
                let mut moved_files = Vec::new();
                let mut moved_size: u64 = 0;
                for fname in &matched {
                    let src = dir.join(fname);
                    let dst = sub_dir.join(fname);
                    if std::fs::rename(&src, &dst).is_ok() {
                        if let Ok(m) = std::fs::metadata(&dst) {
                            moved_size += m.len();
                        }
                        moved_files.push(fname.clone());
                    }
                }
                if !moved_files.is_empty() {
                    let first = moved_files[0].clone();
                    entries.push(FirmwareCacheEntry {
                        entry_id: cat_entry.id.clone(),
                        filename: first,
                        files: moved_files,
                        size: moved_size,
                        path: sub_dir.to_string_lossy().to_string(),
                    });
                }
            }
        }

        let remaining_loose: Vec<String> = loose_files
            .iter()
            .filter(|f| !entries.iter().any(|e| e.files.contains(f)))
            .cloned()
            .collect();
        if !remaining_loose.is_empty() {
            let unorg_dir = dir.join("_unorganized");
            let _ = std::fs::create_dir_all(&unorg_dir);
            let mut moved = Vec::new();
            let mut sz: u64 = 0;
            for fname in &remaining_loose {
                let src = dir.join(fname);
                let dst = unorg_dir.join(fname);
                if std::fs::rename(&src, &dst).is_ok() {
                    if let Ok(m) = std::fs::metadata(&dst) {
                        sz += m.len();
                    }
                    moved.push(fname.clone());
                }
            }
            if !moved.is_empty() {
                let first = moved[0].clone();
                entries.push(FirmwareCacheEntry {
                    entry_id: "_unorganized".into(),
                    filename: first,
                    files: moved,
                    size: sz,
                    path: unorg_dir.to_string_lossy().to_string(),
                });
            }
        }
    }

    Ok(entries)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_cache_clear(
    app: tauri::AppHandle,
    entry_id: Option<String>,
) -> Result<(), String> {
    let dir = firmware_cache_dir(&app)?;

    if let Some(id) = entry_id {
        let entry_dir = dir.join(&id);
        if entry_dir.exists() && entry_dir.is_dir() {
            std::fs::remove_dir_all(&entry_dir).map_err(|e| e.to_string())?;
        }
    } else {
        let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for item in rd.flatten() {
            let path = item.path();
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else if path.extension().and_then(|e| e.to_str()) == Some("tmp") {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_download(
    app: tauri::AppHandle,
    entry_id: String,
) -> Result<String, String> {
    let catalog = RUNTIME_CATALOG.read().await;
    let entry = catalog
        .iter()
        .find(|e| e.id == entry_id)
        .ok_or_else(|| format!("Unknown firmware entry: {}", entry_id))?
        .clone();
    drop(catalog);

    let cache_dir = firmware_cache_dir(&app)?;
    let entry_dir = cache_dir.join(&entry.id);

    if entry_dir.exists() {
        let files: Vec<String> = std::fs::read_dir(&entry_dir)
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| {
                        if e.metadata().map(|m| m.is_file()).unwrap_or(false) {
                            Some(e.file_name().to_string_lossy().to_string())
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        let has_files = !files.is_empty();
        if has_files {
            // Poly archives must provide both firmware binaries and cfg files.
            // If an older/bad extraction left an incomplete cache entry, force re-download.
            if entry.archive_format == "tar.bz2" {
                let has_ld = files
                    .iter()
                    .any(|f| f.to_ascii_lowercase().ends_with(".ld"));
                let has_cfg = files
                    .iter()
                    .any(|f| f.to_ascii_lowercase().ends_with(".cfg"));
                if has_ld && has_cfg {
                    return Ok(entry_dir.to_string_lossy().to_string());
                }
                let _ = std::fs::remove_dir_all(&entry_dir);
            } else {
                return Ok(entry_dir.to_string_lossy().to_string());
            }
        } else {
            let _ = std::fs::remove_dir_all(&entry_dir);
        }
    }

    let urls: Vec<String> = if entry.fallback_url.is_empty() {
        vec![entry.url.clone()]
    } else {
        vec![entry.url.clone(), entry.fallback_url.clone()]
    };

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let mut last_error = String::new();

    for url in &urls {
        match download_firmware(
            &app,
            &client,
            url,
            &entry.id,
            &entry.filename,
            &entry.sha256,
            &entry.archive_format,
            entry.size_bytes,
            &cache_dir,
        )
        .await
        {
            Ok(path) => return Ok(path),
            Err(e) => {
                last_error = e;
                continue;
            }
        }
    }

    Err(format!(
        "All download URLs failed. Last error: {}",
        last_error
    ))
}

async fn download_firmware(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    url: &str,
    entry_id: &str,
    entry_filename: &str,
    entry_sha256: &str,
    entry_archive_format: &str,
    entry_size_bytes: u64,
    cache_dir: &Path,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), url));
    }

    let total = resp.content_length().unwrap_or(entry_size_bytes);
    let mut downloaded: u64 = 0;
    let mut hasher = Sha256::new();
    let mut last_pct: i32 = -1;

    let tmp_path = cache_dir.join(format!(".{}.tmp", entry_id));
    let mut file =
        std::fs::File::create(&tmp_path).map_err(|e| format!("Create temp file: {}", e))?;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        let pct = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0).min(100.0)
        } else {
            0.0
        };
        let pct_int = pct as i32;
        if pct_int != last_pct {
            last_pct = pct_int;
            let _ = app.emit(
                "tools:firmware-progress",
                FirmwareDownloadProgress {
                    entry_id: entry_id.to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    pct,
                    phase: "downloading".into(),
                    files_extracted: 0,
                },
            );
        }
    }
    drop(file);

    if !entry_sha256.is_empty() {
        let computed = format!("{:x}", hasher.finalize());
        if computed != entry_sha256 {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(format!(
                "SHA256 mismatch: expected {}, got {}",
                entry_sha256, computed
            ));
        }
    }

    if entry_archive_format == "tar.bz2" {
        let entry_dir = cache_dir.join(entry_id);
        std::fs::create_dir_all(&entry_dir).map_err(|e| format!("Create entry dir: {}", e))?;

        let _ = app.emit(
            "tools:firmware-progress",
            FirmwareDownloadProgress {
                entry_id: entry_id.to_string(),
                downloaded_bytes: total,
                total_bytes: total,
                pct: 0.0,
                phase: "extracting".into(),
                files_extracted: 0,
            },
        );

        let tmp_for_extract = tmp_path.clone();
        let filename_for_extract = entry_filename.to_string();
        let dir_for_extract = entry_dir.clone();
        let app_for_extract = app.clone();
        let id_for_extract = entry_id.to_string();
        match tokio::task::spawn_blocking(move || {
            extract_from_tar_bz2(
                &tmp_for_extract,
                &filename_for_extract,
                &dir_for_extract,
                Some(&app_for_extract),
                &id_for_extract,
            )
        })
        .await
        .map_err(|e| format!("Extract task failed: {}", e))?
        {
            Ok((_, count)) => {
                let _ = std::fs::remove_file(&tmp_path);
                let _ = app.emit(
                    "tools:firmware-progress",
                    FirmwareDownloadProgress {
                        entry_id: entry_id.to_string(),
                        downloaded_bytes: total,
                        total_bytes: total,
                        pct: 100.0,
                        phase: "extracting".into(),
                        files_extracted: count as u32,
                    },
                );
                return Ok(entry_dir.to_string_lossy().to_string());
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&entry_dir);
                let _ = std::fs::remove_file(&tmp_path);
                return Err(e);
            }
        }
    }

    let entry_dir = cache_dir.join(entry_id);
    std::fs::create_dir_all(&entry_dir).map_err(|e| format!("Create entry dir: {}", e))?;
    let target = entry_dir.join(entry_filename);
    if let Err(e) = std::fs::rename(&tmp_path, &target) {
        let _ = std::fs::remove_dir_all(&entry_dir);
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("Rename failed: {}", e));
    }

    let _ = app.emit(
        "tools:firmware-progress",
        FirmwareDownloadProgress {
            entry_id: entry_id.to_string(),
            downloaded_bytes: total,
            total_bytes: total,
            pct: 100.0,
            phase: "downloading".into(),
            files_extracted: 0,
        },
    );

    Ok(entry_dir.to_string_lossy().to_string())
}

struct CountingReader<R> {
    inner: R,
    bytes_read: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

impl<R: std::io::Read> std::io::Read for CountingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.bytes_read
            .fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
        Ok(n)
    }
}

fn extract_from_tar_bz2(
    archive_path: &Path,
    _target_filename: &str,
    output_dir: &Path,
    app: Option<&tauri::AppHandle>,
    entry_id: &str,
) -> Result<(String, usize), String> {
    use std::io::BufReader;

    let archive_size = std::fs::metadata(archive_path)
        .map(|m| m.len())
        .unwrap_or(1);
    let file = std::fs::File::open(archive_path).map_err(|e| format!("Open archive: {}", e))?;
    let bytes_read = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let counter = CountingReader {
        inner: BufReader::new(file),
        bytes_read: bytes_read.clone(),
    };
    let decompressor = bzip2::read::BzDecoder::new(counter);
    let mut archive = tar::Archive::new(decompressor);

    let entries = archive
        .entries()
        .map_err(|e| format!("Read tar entries: {}", e))?;
    let mut count: u32 = 0;

    for entry_result in entries {
        let mut tar_entry = entry_result.map_err(|e| format!("Tar entry: {}", e))?;
        let path = tar_entry
            .path()
            .map_err(|e| format!("Tar entry path: {}", e))?
            .to_path_buf();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let dominated_by_dir = tar_entry.header().entry_type() == tar::EntryType::Directory;
        if dominated_by_dir || name.is_empty() {
            continue;
        }

        let name_lc = name.to_ascii_lowercase();
        let dominated = name_lc.ends_with(".ld") || name_lc.ends_with(".cfg");
        if !dominated {
            continue;
        }

        let out_path = output_dir.join(&name);
        let mut out_file =
            std::fs::File::create(&out_path).map_err(|e| format!("Create output: {}", e))?;
        std::io::copy(&mut tar_entry, &mut out_file).map_err(|e| format!("Extract copy: {}", e))?;
        count += 1;

        if let Some(app) = app {
            let consumed = bytes_read.load(std::sync::atomic::Ordering::Relaxed);
            let pct = ((consumed as f64 / archive_size as f64) * 100.0).min(99.0);
            let _ = app.emit(
                "tools:firmware-progress",
                FirmwareDownloadProgress {
                    entry_id: entry_id.to_string(),
                    downloaded_bytes: consumed,
                    total_bytes: archive_size,
                    pct,
                    phase: "extracting".into(),
                    files_extracted: count,
                },
            );
        }
    }

    if count == 0 {
        return Err("No firmware files found in archive".to_string());
    }

    Ok((output_dir.to_string_lossy().to_string(), count as usize))
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn tools_firmware_serve(
    app: tauri::AppHandle,
    entry_id: String,
    session_id: Option<String>,
    serve_dir: Option<String>,
) -> Result<String, String> {
    let cache_dir = firmware_cache_dir(&app)?;
    let entry_dir = cache_dir.join(&entry_id);

    if !entry_dir.exists() {
        return Err("Firmware not cached. Download it first.".into());
    }

    if let Some(sid) = session_id {
        let mut inputs = Vec::new();
        let rd = std::fs::read_dir(&entry_dir).map_err(|e| e.to_string())?;
        for item in rd.flatten() {
            if item.metadata().map(|m| m.is_file()).unwrap_or(false) {
                let fname = item.file_name().to_string_lossy().to_string();
                let data = std::fs::read(item.path()).map_err(|e| e.to_string())?;
                let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);
                inputs.push(VirtualFileInput {
                    name: fname,
                    data_base64: b64,
                });
            }
        }
        let count = inputs.len();
        tools_virtual_add_files(sid, inputs).await?;
        return Ok(format!(
            "Added {} file(s) from {} to virtual server",
            count, entry_id
        ));
    }

    if let Some(dir) = serve_dir {
        let dest_dir = PathBuf::from(&dir);
        let mut count = 0;
        let rd = std::fs::read_dir(&entry_dir).map_err(|e| e.to_string())?;
        for item in rd.flatten() {
            if item.metadata().map(|m| m.is_file()).unwrap_or(false) {
                let fname = item.file_name().to_string_lossy().to_string();
                let dest = dest_dir.join(&fname);
                std::fs::copy(item.path(), &dest).map_err(|e| e.to_string())?;
                count += 1;
            }
        }
        return Ok(format!(
            "Copied {} file(s) from {} to {}",
            count,
            entry_id,
            dest_dir.display()
        ));
    }

    Err("Provide either session_id (virtual server) or serve_dir".into())
}
