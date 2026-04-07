//! Remote SSH packet capture — connects to a remote host via SSH,
//! runs `tcpdump -U -w -` on the remote, and streams the pcap byte
//! stream back into the local capture pipeline for live viewing.

use anyhow::{Context, Result};
use once_cell::sync::Lazy;
use russh::client;
use russh_keys::key;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex as StdMutex};
use uuid::Uuid;

use crate::packet_capture::packet_parser::PacketParser;
use crate::packet_capture::ring_buffer::PacketRingBufferCompat;
use crate::packet_capture::{FilterConfig, PacketInfo, PcapWriter};

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthMethod {
    Password,
    KeyFile,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCaptureConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshAuthMethod,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub remote_interface: String,
    pub capture_filter: Option<String>,
    pub use_sudo: bool,
    pub sudo_password: Option<String>,
    pub session_name: Option<String>,
    pub packet_limit: Option<u64>,
    pub duration_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    #[serde(rename = "type")]
    pub source_type: String, // "local" or "remote"
    pub host: Option<String>,
    pub username: Option<String>,
}

impl CaptureSource {
    pub fn local() -> Self {
        Self {
            source_type: "local".to_string(),
            host: None,
            username: None,
        }
    }

    pub fn remote(host: &str, username: &str) -> Self {
        Self {
            source_type: "remote".to_string(),
            host: Some(host.to_string()),
            username: Some(username.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// Remote session tracking
// ---------------------------------------------------------------------------

struct RemoteSessionEntry {
    session_id: String,
    config: RemoteCaptureConfig,
    cancel_tx: tokio::sync::watch::Sender<bool>,
    source: CaptureSource,
}

static REMOTE_SESSIONS: Lazy<StdMutex<HashMap<String, RemoteSessionEntry>>> =
    Lazy::new(|| StdMutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// SSH client handler (minimal — we only need exec, not interactive)
// ---------------------------------------------------------------------------

struct SshClientHandler;

#[async_trait::async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        // Accept all host keys (like Wireshark sshdump does by default).
        // A production feature could persist known_hosts.
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Test that an SSH connection can be established with the given credentials.
pub async fn test_ssh_connection(
    host: &str,
    port: u16,
    username: &str,
    auth_method: &SshAuthMethod,
    password: Option<&str>,
    key_path: Option<&str>,
) -> Result<bool> {
    let config = Arc::new(client::Config {
        ..Default::default()
    });
    let handler = SshClientHandler;
    let mut session = client::connect(config, (host, port), handler)
        .await
        .context("SSH connect failed")?;

    let authenticated =
        authenticate(&mut session, username, auth_method, password, key_path).await?;
    // Disconnect cleanly
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "en")
        .await;
    Ok(authenticated)
}

/// List network interfaces on the remote host.
pub async fn list_remote_interfaces(
    host: &str,
    port: u16,
    username: &str,
    auth_method: &SshAuthMethod,
    password: Option<&str>,
    key_path: Option<&str>,
) -> Result<Vec<String>> {
    let config = Arc::new(client::Config {
        ..Default::default()
    });
    let handler = SshClientHandler;
    let mut session = client::connect(config, (host, port), handler)
        .await
        .context("SSH connect failed")?;

    authenticate(&mut session, username, auth_method, password, key_path).await?;
    detect_remote_capture_backend(&mut session).await?;

    // Prefer command outputs we can parse directly in Rust (avoid shell pipelines).
    let probes = [
        "ip -o link show",
        "ls /sys/class/net",
        "ifconfig -l",
        "ifconfig",
    ];

    for cmd in probes {
        let result =
            execute_remote_command(&mut session, cmd, std::time::Duration::from_secs(5)).await?;
        if result.exit_status != Some(0) {
            continue;
        }
        let interfaces = parse_interfaces_from_probe(cmd, &result.stdout);
        if !interfaces.is_empty() {
            let _ = session
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
            return Ok(interfaces);
        }
    }

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "en")
        .await;
    Ok(vec!["any".to_string()])
}

/// Start a remote capture session. Returns the local session ID.
/// The capture runs as a background Tokio task that:
/// 1. SSHs to the remote host
/// 2. Runs `tcpdump -i <iface> -U -w - [filter]`
/// 3. Reads the pcap byte stream
/// 4. Parses packets with PacketParser
/// 5. Pushes into the shared ring buffer + writes to local pcap file
pub async fn start_remote_capture(
    config: RemoteCaptureConfig,
    app_handle: tauri::AppHandle,
) -> Result<String> {
    let session_id = Uuid::new_v4().to_string();
    let session_name = config
        .session_name
        .clone()
        .unwrap_or_else(|| format!("Remote: {}@{}", config.username, config.host));

    // Create captures directory + pcap file
    let config_dir = crate::core::config::get_config_dir().context("No config dir")?;
    let captures_dir = config_dir.join("captures");
    std::fs::create_dir_all(&captures_dir)?;
    let file_path = captures_dir.join(format!("{}.pcap", session_id));

    let source = CaptureSource::remote(&config.host, &config.username);
    let source_json = serde_json::to_string(&source)?;

    // Insert DB row
    let conn = crate::core::database::Database::get_connection().context("DB connection failed")?;
    let filter_config = FilterConfig::default();
    let filter_config_json = serde_json::to_string(&filter_config)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO capture_sessions (id, name, description, interface, filter_config, start_time, status, packet_count, file_path, created_at, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            session_id,
            session_name,
            format!("Remote capture from {}@{}:{}", config.username, config.host, config.port),
            format!("remote:{}", config.remote_interface),
            filter_config_json,
            now,
            "Running",
            0i64,
            file_path.to_string_lossy(),
            now,
            source_json,
        ],
    )?;

    // Cancellation channel
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

    // Track the session
    {
        let mut sessions = REMOTE_SESSIONS
            .lock()
            .map_err(|_| anyhow::anyhow!("lock"))?;
        sessions.insert(
            session_id.clone(),
            RemoteSessionEntry {
                session_id: session_id.clone(),
                config: config.clone(),
                cancel_tx,
                source: source.clone(),
            },
        );
    }

    // Spawn the background capture task
    let sid = session_id.clone();
    let file_path_str = file_path.to_string_lossy().to_string();
    tokio::spawn(async move {
        if let Err(e) =
            run_remote_capture(sid.clone(), config, file_path_str, cancel_rx, app_handle).await
        {
            tracing::error!("Session {} error: {}", sid, e);
        }
        // Mark session stopped in DB
        if let Ok(conn) = crate::core::database::Database::get_connection() {
            let _ = conn.execute(
                "UPDATE capture_sessions SET status = ?1, end_time = ?2 WHERE id = ?3",
                rusqlite::params!["Stopped", chrono::Utc::now().to_rfc3339(), sid],
            );
        }
        // Remove from tracking
        if let Ok(mut sessions) = REMOTE_SESSIONS.lock() {
            sessions.remove(&sid);
        }
    });

    Ok(session_id)
}

/// Stop a running remote capture.
pub fn stop_remote_capture(session_id: &str) -> Result<()> {
    let sessions = REMOTE_SESSIONS
        .lock()
        .map_err(|_| anyhow::anyhow!("lock"))?;
    if let Some(entry) = sessions.get(session_id) {
        let _ = entry.cancel_tx.send(true);
        Ok(())
    } else {
        anyhow::bail!("Remote session not found: {}", session_id)
    }
}

/// Check if a remote session is running.
pub fn is_remote_session(session_id: &str) -> bool {
    REMOTE_SESSIONS
        .lock()
        .map(|s| s.contains_key(session_id))
        .unwrap_or(false)
}

/// Stop **all** running remote capture sessions. Called on app shutdown.
pub fn stop_all_remote_captures() {
    tracing::info!("stop_all_remote_captures() — shutting down all remote sessions");
    let sessions = match REMOTE_SESSIONS.lock() {
        Ok(s) => s,
        Err(_) => {
            tracing::error!("stop_all: failed to lock REMOTE_SESSIONS");
            return;
        }
    };
    if sessions.is_empty() {
        tracing::info!("stop_all: no running remote sessions");
        return;
    }
    tracing::info!(
        "[RemoteCapture] stop_all: cancelling {} remote session(s)",
        sessions.len()
    );
    for (id, entry) in sessions.iter() {
        if let Err(e) = entry.cancel_tx.send(true) {
            tracing::error!("stop_all: error cancelling {}: {}", id, e);
        }
    }
}

/// Get the list of active remote session IDs.
pub fn active_remote_session_ids() -> Vec<String> {
    REMOTE_SESSIONS
        .lock()
        .map(|s| s.keys().cloned().collect())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn authenticate(
    session: &mut client::Handle<SshClientHandler>,
    username: &str,
    auth_method: &SshAuthMethod,
    password: Option<&str>,
    key_path: Option<&str>,
) -> Result<bool> {
    match auth_method {
        SshAuthMethod::Password => {
            let pw = password.unwrap_or("");
            let ok = session
                .authenticate_password(username, pw)
                .await
                .context("Password auth failed")?;
            Ok(ok)
        }
        SshAuthMethod::KeyFile => {
            let path = key_path.ok_or_else(|| anyhow::anyhow!("Key path required"))?;
            let key_pair =
                russh_keys::load_secret_key(path, password).context("Failed to load SSH key")?;
            let ok = session
                .authenticate_publickey(username, Arc::new(key_pair))
                .await
                .context("Public key auth failed")?;
            Ok(ok)
        }
        SshAuthMethod::Agent => {
            // Try common default key file locations as SSH agent fallback.
            // Full SSH agent support requires agent-specific signing protocol.
            let home = dirs::home_dir().unwrap_or_default();
            let key_files = [
                home.join(".ssh/id_ed25519"),
                home.join(".ssh/id_rsa"),
                home.join(".ssh/id_ecdsa"),
            ];
            for path in &key_files {
                if path.exists() {
                    if let Ok(kp) =
                        russh_keys::load_secret_key(path.to_str().unwrap_or(""), None::<&str>)
                    {
                        if let Ok(true) =
                            session.authenticate_publickey(username, Arc::new(kp)).await
                        {
                            return Ok(true);
                        }
                    }
                }
            }
            Ok(false)
        }
    }
}

/// Read all stdout from a channel until EOF or timeout.
async fn read_channel_to_string(
    channel: &mut russh::Channel<client::Msg>,
    timeout: std::time::Duration,
) -> Result<String> {
    let mut buf = Vec::new();
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        buf.extend_from_slice(&data);
                    }
                    Some(russh::ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                break;
            }
        }
    }
    Ok(String::from_utf8_lossy(&buf).to_string())
}

struct RemoteCommandOutput {
    stdout: String,
    exit_status: Option<u32>,
}

async fn execute_remote_command(
    session: &mut client::Handle<SshClientHandler>,
    command: &str,
    timeout: std::time::Duration,
) -> Result<RemoteCommandOutput> {
    let mut channel = session.channel_open_session().await?;
    channel.exec(true, command.as_bytes()).await?;
    let deadline = tokio::time::Instant::now() + timeout;
    let mut stdout = Vec::new();
    let mut exit_status = None;

    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
                    Some(russh::ChannelMsg::ExitStatus { exit_status: status }) => {
                        exit_status = Some(status);
                    }
                    Some(russh::ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
            _ = tokio::time::sleep_until(deadline) => break,
        }
    }

    Ok(RemoteCommandOutput {
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        exit_status,
    })
}

fn parse_interfaces_from_probe(command: &str, output: &str) -> Vec<String> {
    match command {
        "ip -o link show" => parse_interfaces_from_ip_link(output),
        "ls /sys/class/net" => normalize_interface_names(output.lines().map(|l| l.trim())),
        "ifconfig -l" => normalize_interface_names(output.split_whitespace()),
        "ifconfig" => parse_interfaces_from_ifconfig(output),
        _ => Vec::new(),
    }
}

fn parse_interfaces_from_ip_link(output: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        let Some(first_colon) = trimmed.find(':') else {
            continue;
        };
        let rest = trimmed[(first_colon + 1)..].trim();
        let Some(second_colon) = rest.find(':') else {
            continue;
        };
        names.push(rest[..second_colon].trim());
    }
    normalize_interface_names(names)
}

fn parse_interfaces_from_ifconfig(output: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() || trimmed.starts_with('\t') || trimmed.starts_with(' ') {
            continue;
        }
        let Some(colon) = trimmed.find(':') else {
            continue;
        };
        names.push(trimmed[..colon].trim());
    }
    normalize_interface_names(names)
}

fn normalize_interface_names<'a, I>(iter: I) -> Vec<String>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut seen = HashSet::new();
    let mut interfaces = Vec::new();
    for raw in iter {
        let name = raw.trim();
        if name.is_empty() || name.eq_ignore_ascii_case("lo") || name.eq_ignore_ascii_case("lo0") {
            continue;
        }
        if seen.insert(name.to_string()) {
            interfaces.push(name.to_string());
        }
    }
    interfaces
}

/// The main capture loop running in a background task.
async fn run_remote_capture(
    session_id: String,
    config: RemoteCaptureConfig,
    file_path: String,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
    app_handle: tauri::AppHandle,
) -> Result<()> {
    use tauri::Emitter;

    tracing::info!(
        "[RemoteCapture] Connecting to {}@{}:{}",
        config.username,
        config.host,
        config.port
    );

    let ssh_config = Arc::new(client::Config {
        ..Default::default()
    });
    let handler = SshClientHandler;
    let mut session = client::connect(ssh_config, (&*config.host, config.port), handler).await?;

    let authenticated = authenticate(
        &mut session,
        &config.username,
        &config.auth_method,
        config.password.as_deref(),
        config.key_path.as_deref(),
    )
    .await?;
    if !authenticated {
        anyhow::bail!("SSH authentication failed");
    }
    detect_remote_capture_backend(&mut session).await?;

    // Build tcpdump command
    let mut cmd = String::new();
    if config.use_sudo {
        if let Some(ref sudo_pw) = config.sudo_password {
            cmd.push_str(&format!("echo '{}' | sudo -S ", sudo_pw));
        } else {
            cmd.push_str("sudo ");
        }
    }
    cmd.push_str(&format!(
        "tcpdump -i {} -U -w -",
        shell_escape(&config.remote_interface)
    ));
    if let Some(ref limit) = config.packet_limit {
        cmd.push_str(&format!(" -c {}", limit));
    }
    if let Some(ref filter) = config.capture_filter {
        if !filter.trim().is_empty() {
            cmd.push_str(&format!(" {}", filter));
        }
    }

    tracing::info!("Executing: {}", cmd);

    let mut channel = session.channel_open_session().await?;
    channel.exec(true, cmd.as_bytes()).await?;

    // Optionally enforce a duration limit
    let duration_deadline = config
        .duration_seconds
        .map(|s| tokio::time::Instant::now() + std::time::Duration::from_secs(s));

    // Set up local pcap writer (empty — header comes from remote stream)
    let pcap_writer = Arc::new(StdMutex::new(
        PcapWriter::new_empty(&file_path).context("Failed to create local PCAP writer")?,
    ));

    // Shared packet buffer for live viewing (same type as CaptureSession)
    let packet_buffer: crate::packet_capture::ring_buffer::SharedPacketBuffer =
        Arc::new(StdMutex::new(PacketRingBufferCompat::new(
            crate::packet_capture::ring_buffer::DEFAULT_BUFFER_CAPACITY,
        )));

    // Track this in the global SESSIONS so the existing monitor commands can read from it
    {
        let session_obj = crate::packet_capture::capture::CaptureSession::new_external(
            session_id.clone(),
            config
                .session_name
                .clone()
                .unwrap_or_else(|| format!("Remote: {}@{}", config.username, config.host)),
            Some(format!(
                "Remote capture from {}@{}:{}",
                config.username, config.host, config.port
            )),
            format!("remote:{}", config.remote_interface),
            FilterConfig::default(),
            Some(file_path.clone()),
            packet_buffer.clone(),
            pcap_writer.clone(),
        );
        let mut sessions =
            crate::commands::packet_capture::sessions_lock().map_err(|e| anyhow::anyhow!(e))?;
        sessions.insert(
            session_id.clone(),
            crate::commands::packet_capture::SessionEntry::new_running(session_obj),
        );
    }

    // Read pcap byte stream from SSH channel
    // The pcap global header is 24 bytes, then each record is 16 byte header + data.
    let mut pcap_buf: Vec<u8> = Vec::with_capacity(256 * 1024);
    let mut got_global_header = false;
    let mut link_type: u32 = 1; // default: Ethernet
    let mut packet_count: u64 = 0;
    let mut batch: Vec<serde_json::Value> = Vec::new();
    let batch_max = 100usize;
    let mut last_emit = tokio::time::Instant::now();
    let emit_interval = std::time::Duration::from_millis(50);

    loop {
        tokio::select! {
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    tracing::info!("Cancel requested for {}", session_id);
                    break;
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        pcap_buf.extend_from_slice(&data);

                        // Parse global header if we haven't yet
                        if !got_global_header && pcap_buf.len() >= 24 {
                            link_type = parse_pcap_link_type(&pcap_buf[..24]);
                            got_global_header = true;
                            tracing::info!("Got pcap global header, link_type={}", link_type);
                            // Write global header to local file
                            if let Ok(mut w) = pcap_writer.lock() {
                                let _ = w.write_raw_header(&pcap_buf[..24]);
                            }
                            pcap_buf.drain(..24);
                        }

                        if !got_global_header {
                            continue;
                        }

                        // Parse packet records from buffer
                        let parser = PacketParser::with_rtp_port_range(link_type, Some((10000, 60000)));
                        while pcap_buf.len() >= 16 {
                            let (ts_sec, ts_usec, incl_len, _orig_len) = parse_pcap_record_header(&pcap_buf[..16]);
                            let record_len = 16 + incl_len as usize;
                            if pcap_buf.len() < record_len {
                                break; // Wait for more data
                            }

                            let record_data = &pcap_buf[16..record_len];
                            let record_bytes = &pcap_buf[..record_len];

                            // Build a minimal pcap::Packet-like structure for the parser
                            let ts = chrono::DateTime::from_timestamp(ts_sec as i64, ts_usec * 1000)
                                .unwrap_or_else(|| chrono::Utc::now());
                            if let Some(pkt) = parse_raw_packet(&parser, record_data, ts, packet_count) {
                                // Persist exact record bytes from the remote stream.
                                if let Ok(mut w) = pcap_writer.lock() {
                                    let _ = w.write_raw_record(record_bytes);
                                }
                                // Push into ring buffer
                                if let Ok(mut buf) = packet_buffer.lock() {
                                    buf.push(pkt.clone());
                                }
                                // Accumulate batch for event emission
                                batch.push(crate::commands::packet_capture::packet_info_to_json(&pkt));
                                packet_count += 1;
                            }

                            pcap_buf.drain(..record_len);
                        }

                        // Emit batch events
                        let now = tokio::time::Instant::now();
                        if !batch.is_empty() && (batch.len() >= batch_max || now.duration_since(last_emit) >= emit_interval) {
                            let event_name = format!("packet:batch:{}", session_id);
                            let _ = app_handle.emit(&event_name, batch.clone());
                            batch.clear();
                            last_emit = now;

                            // Update packet count in DB periodically
                            if packet_count % 500 == 0 {
                                if let Ok(conn) = crate::core::database::Database::get_connection() {
                                    let _ = conn.execute(
                                        "UPDATE capture_sessions SET packet_count = ?1 WHERE id = ?2",
                                        rusqlite::params![packet_count as i64, session_id],
                                    );
                                }
                            }
                        }
                    }
                    Some(russh::ChannelMsg::Eof) | None => {
                        tracing::info!("Channel closed for {}", session_id);
                        break;
                    }
                    Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                        tracing::info!("tcpdump exited with status {}", exit_status);
                        break;
                    }
                    _ => {}
                }
            }
            _ = async {
                if let Some(deadline) = duration_deadline {
                    tokio::time::sleep_until(deadline).await;
                } else {
                    // Never completes if no duration set
                    std::future::pending::<()>().await;
                }
            } => {
                tracing::info!("Duration limit reached for {}", session_id);
                break;
            }
        }
    }

    // Flush remaining batch
    if !batch.is_empty() {
        let event_name = format!("packet:batch:{}", session_id);
        let _ = app_handle.emit(&event_name, batch);
    }

    // Final packet count update
    if let Ok(conn) = crate::core::database::Database::get_connection() {
        let _ = conn.execute(
            "UPDATE capture_sessions SET packet_count = ?1, status = ?2, end_time = ?3 WHERE id = ?4",
            rusqlite::params![
                packet_count as i64,
                "Stopped",
                chrono::Utc::now().to_rfc3339(),
                session_id
            ],
        );
    }

    // Remove from global in-memory sessions
    if let Ok(mut sessions) = crate::commands::packet_capture::sessions_lock() {
        if let Some(entry) = sessions.get_mut(&session_id) {
            entry.mark_stopped();
        }
    }

    tracing::info!(
        "[RemoteCapture] Session {} finished, {} packets captured",
        session_id,
        packet_count
    );

    // Disconnect SSH
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "en")
        .await;

    Ok(())
}

/// Parse the pcap global header to extract the link-layer type.
fn parse_pcap_link_type(header: &[u8]) -> u32 {
    if header.len() < 24 {
        return 1; // default Ethernet
    }
    let magic = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let is_le = magic == 0xa1b2c3d4 || magic == 0xa1b23c4d;
    if is_le {
        u32::from_le_bytes([header[20], header[21], header[22], header[23]])
    } else {
        u32::from_be_bytes([header[20], header[21], header[22], header[23]])
    }
}

/// Parse a pcap record header (16 bytes) → (ts_sec, ts_usec, incl_len, orig_len).
fn parse_pcap_record_header(header: &[u8]) -> (u32, u32, u32, u32) {
    // Assume little-endian (most common)
    let ts_sec = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let ts_usec = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
    let incl_len = u32::from_le_bytes([header[8], header[9], header[10], header[11]]);
    let orig_len = u32::from_le_bytes([header[12], header[13], header[14], header[15]]);
    (ts_sec, ts_usec, incl_len, orig_len)
}

/// Parse raw packet bytes using the PacketParser (mimics what capture.rs does).
fn parse_raw_packet(
    parser: &PacketParser,
    data: &[u8],
    timestamp: chrono::DateTime<chrono::Utc>,
    index: u64,
) -> Option<PacketInfo> {
    // Build a fake pcap::Packet with the right data
    // The PacketParser expects pcap::Packet, but we have raw bytes.
    // We'll use the parser's internal method via a minimal pcap::Packet.
    // Since pcap::Packet is not easily constructible, we use the parser's public
    // parse_raw method that we'll add, or use protocol_decoder directly.

    // Directly use the protocol decoder which is what PacketParser ultimately calls
    use crate::packet_capture::protocol_decoder;

    let link_type = parser.link_layer_type();
    let ip_data = extract_ip_layer(data, link_type)?;

    if ip_data.len() < 20 {
        return None;
    }

    let version = ip_data[0] >> 4;
    if version != 4 && version != 6 {
        return None;
    }

    let (src_ip, dst_ip, transport_protocol, transport_data) = if version == 4 {
        let ihl = (ip_data[0] & 0x0f) as usize * 4;
        if ip_data.len() < ihl {
            return None;
        }
        let proto = ip_data[9];
        let src = std::net::IpAddr::V4(std::net::Ipv4Addr::new(
            ip_data[12],
            ip_data[13],
            ip_data[14],
            ip_data[15],
        ));
        let dst = std::net::IpAddr::V4(std::net::Ipv4Addr::new(
            ip_data[16],
            ip_data[17],
            ip_data[18],
            ip_data[19],
        ));
        (src, dst, proto, &ip_data[ihl..])
    } else {
        // IPv6
        if ip_data.len() < 40 {
            return None;
        }
        let proto = ip_data[6];
        let src = std::net::IpAddr::V6(std::net::Ipv6Addr::from({
            let mut a = [0u8; 16];
            a.copy_from_slice(&ip_data[8..24]);
            a
        }));
        let dst = std::net::IpAddr::V6(std::net::Ipv6Addr::from({
            let mut a = [0u8; 16];
            a.copy_from_slice(&ip_data[24..40]);
            a
        }));
        (src, dst, proto, &ip_data[40..])
    };

    let (src_port, dst_port, payload) = match transport_protocol {
        6 => {
            // TCP
            if transport_data.len() < 20 {
                return None;
            }
            let sp = u16::from_be_bytes([transport_data[0], transport_data[1]]);
            let dp = u16::from_be_bytes([transport_data[2], transport_data[3]]);
            let data_offset = ((transport_data[12] >> 4) as usize) * 4;
            let payload = if transport_data.len() > data_offset {
                &transport_data[data_offset..]
            } else {
                &[]
            };
            (sp, dp, payload)
        }
        17 => {
            // UDP
            if transport_data.len() < 8 {
                return None;
            }
            let sp = u16::from_be_bytes([transport_data[0], transport_data[1]]);
            let dp = u16::from_be_bytes([transport_data[2], transport_data[3]]);
            (sp, dp, &transport_data[8..])
        }
        _ => (0, 0, transport_data),
    };

    // Decode application layer
    let decoded = protocol_decoder::decode_packet(
        data,
        Some(link_type),
        Some(index),
        None, // rtp_port_range
    )
    .ok();

    let protocol = crate::packet_capture::Protocol::detect_with_ports(src_port, dst_port, payload);

    Some(PacketInfo {
        timestamp,
        src_ip,
        dst_ip,
        src_port,
        dst_port,
        protocol,
        size: payload.len(),
        frame_length: data.len(),
        raw_frame: Some(data.to_vec()),
        data: payload.to_vec(),
        decoded,
        fidelity: crate::packet_capture::PacketFidelity::Authoritative,
        provenance: crate::packet_capture::PacketProvenance::RemoteCapture,
    })
}

/// Extract IP layer from raw frame based on link layer type.
fn extract_ip_layer(data: &[u8], link_type: u32) -> Option<&[u8]> {
    match link_type {
        1 => {
            // Ethernet
            if data.len() < 14 {
                return None;
            }
            let ethertype = u16::from_be_bytes([data[12], data[13]]);
            match ethertype {
                0x0800 => Some(&data[14..]), // IPv4
                0x86DD => Some(&data[14..]), // IPv6
                0x8100 => {
                    // VLAN tagged
                    if data.len() < 18 {
                        return None;
                    }
                    Some(&data[18..])
                }
                _ => None,
            }
        }
        0 => {
            // Null/loopback — skip 4-byte family header
            if data.len() < 4 {
                return None;
            }
            Some(&data[4..])
        }
        12 => {
            // Raw IP (no link layer)
            Some(data)
        }
        113 => {
            // Linux cooked capture (SLL)
            if data.len() < 16 {
                return None;
            }
            Some(&data[16..])
        }
        _ => {
            // Unknown, try to detect IP version from first nibble
            if !data.is_empty() {
                let version = data[0] >> 4;
                if version == 4 || version == 6 {
                    return Some(data);
                }
            }
            None
        }
    }
}

fn shell_escape(s: &str) -> String {
    // Simple shell escape — single-quote the value
    format!("'{}'", s.replace('\'', "'\\''"))
}

async fn detect_remote_capture_backend(
    session: &mut client::Handle<SshClientHandler>,
) -> Result<()> {
    let uname_probe =
        execute_remote_command(session, "uname -s", std::time::Duration::from_secs(3)).await?;
    let uname = uname_probe.stdout.trim().to_ascii_lowercase();
    if uname.contains("windows") || uname.contains("mingw") || uname.contains("cygwin") {
        anyhow::bail!(
            "Remote capture backend unsupported for this host: detected Windows-like target (`{}`). Unix-like SSH targets are currently supported.",
            uname
        );
    }

    let tcpdump_probe = execute_remote_command(
        session,
        "tcpdump --version",
        std::time::Duration::from_secs(4),
    )
    .await?;
    let tcpdump_out = tcpdump_probe.stdout.trim().to_ascii_lowercase();
    if tcpdump_probe.exit_status != Some(0) {
        if tcpdump_probe.exit_status == Some(127)
            || tcpdump_out.contains("not found")
            || tcpdump_out.contains("not recognized")
        {
            anyhow::bail!(
                "Remote capture backend unavailable: tcpdump is missing on the remote host (exit status {}). Install tcpdump and try again.",
                tcpdump_probe.exit_status.unwrap_or_default()
            );
        }
        anyhow::bail!(
            "Remote capture backend probe failed while checking tcpdump (exit status {}).",
            tcpdump_probe.exit_status.unwrap_or_default()
        );
    }

    Ok(())
}
