//! Tauri commands for the Remote Agent feature.

use crate::remote_agent::config_gen::{CompileProgress, GenerateParams, GenerateResult};
use crate::remote_agent::manager::{AgentConnection, AGENT_MANAGER};
use crate::remote_agent::server;
use crate::remote_agent::server::ListenerInfo;
use once_cell::sync::Lazy;
use sipalyzer_core::protocol::{
    AgentCommand, ChatMessageData, ChatMessageParams, ShellCloseParams, ShellInputParams,
    ShellResizeParams, ShellSpawnParams,
};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

/// Tracks active relay controller loops so duplicate frontend calls do not
/// spawn parallel reconnect loops for the same session.
static ACTIVE_RELAY_SESSIONS: Lazy<Arc<Mutex<HashSet<String>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashSet::new())));
static RELAY_SHUTDOWN_REQUESTED: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
static REMOTE_CHAT_STATE: Lazy<StdMutex<RemoteChatState>> =
    Lazy::new(|| StdMutex::new(RemoteChatState::default()));

#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteChatMessage {
    pub id: String,
    pub agent_id: String,
    pub sender: String,
    pub text: String,
    pub timestamp: String,
    pub unread: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteChatSnapshot {
    pub messages: Vec<RemoteChatMessage>,
    pub unread_total: usize,
    pub unread_by_agent: std::collections::HashMap<String, usize>,
    pub last_sender: Option<String>,
    pub last_snippet: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteChatTrayState {
    pub unread_total: usize,
    pub unread_text: String,
    pub last_sender: Option<String>,
    pub last_snippet: Option<String>,
}

#[derive(Default)]
struct RemoteChatState {
    messages: Vec<RemoteChatMessage>,
}

impl RemoteChatState {
    fn add_message(&mut self, message: RemoteChatMessage) {
        self.messages.push(message);
        if self.messages.len() > 1000 {
            let drain = self.messages.len().saturating_sub(1000);
            self.messages.drain(0..drain);
        }
    }

    fn snapshot(&self) -> RemoteChatSnapshot {
        let unread_by_agent = self.messages.iter().filter(|m| m.unread).fold(
            std::collections::HashMap::new(),
            |mut acc, m| {
                *acc.entry(m.agent_id.clone()).or_insert(0usize) += 1;
                acc
            },
        );
        let unread_total = unread_by_agent.values().sum();
        let (last_sender, last_snippet) = self
            .messages
            .last()
            .map(|m| (Some(m.sender.clone()), Some(m.text.clone())))
            .unwrap_or((None, None));
        RemoteChatSnapshot {
            messages: self.messages.clone(),
            unread_total,
            unread_by_agent,
            last_sender,
            last_snippet,
        }
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn truncate_snippet(input: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (i, ch) in input.chars().enumerate() {
        if i >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn emit_remote_chat_events(app: &tauri::AppHandle, message: &RemoteChatMessage) {
    let _ = app.emit("remote-chat:message", message);
    let snapshot = {
        let state = REMOTE_CHAT_STATE.lock().unwrap_or_else(|e| e.into_inner());
        state.snapshot()
    };
    let _ = app.emit("remote-chat:state", &snapshot);
    crate::refresh_remote_chat_tray(app);
}

pub(crate) fn remote_chat_tray_state() -> RemoteChatTrayState {
    let snapshot = {
        let state = REMOTE_CHAT_STATE.lock().unwrap_or_else(|e| e.into_inner());
        state.snapshot()
    };
    let unread_text = if snapshot.unread_total > 0 {
        format!("Unread: {}", snapshot.unread_total)
    } else {
        "Unread: 0".to_string()
    };
    RemoteChatTrayState {
        unread_total: snapshot.unread_total,
        unread_text,
        last_sender: snapshot.last_sender,
        last_snippet: snapshot
            .last_snippet
            .as_deref()
            .map(|s| truncate_snippet(s, 42)),
    }
}

pub(crate) fn ingest_incoming_chat(
    agent_id: &str,
    payload: &ChatMessageData,
    app: &tauri::AppHandle,
) {
    let message = {
        let mut state = REMOTE_CHAT_STATE.lock().unwrap_or_else(|e| e.into_inner());
        let message = RemoteChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            sender: payload.sender.clone(),
            text: payload.text.clone(),
            timestamp: if payload.timestamp.trim().is_empty() {
                now_rfc3339()
            } else {
                payload.timestamp.clone()
            },
            unread: true,
        };
        state.add_message(message.clone());
        message
    };
    emit_remote_chat_events(app, &message);
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
    scopes.push(std::env::temp_dir());
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

fn resolve_scoped_write_path(
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

    let absolute = if raw.is_absolute() {
        raw.clone()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("{operation} denied: cannot resolve current dir: {e}"))?
            .join(&raw)
    };
    let parent = absolute
        .parent()
        .ok_or_else(|| format!("{operation} denied: invalid target path {path}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("{operation} denied: cannot resolve parent directory: {e}"))?;
    let file_name = absolute
        .file_name()
        .ok_or_else(|| format!("{operation} denied: target file name is missing"))?;
    let target = canonical_parent.join(file_name);

    let approved = approved_local_scopes(app);
    if !is_within_approved_scopes(&target, &approved) {
        return Err(format!(
            "{operation} denied: path is outside approved local scopes (home/app-data/temp): {}",
            target.to_string_lossy()
        ));
    }
    Ok(target)
}

pub async fn remote_agent_stop_all_relays() {
    RELAY_SHUTDOWN_REQUESTED.store(true, Ordering::SeqCst);
    let mut active = ACTIVE_RELAY_SESSIONS.lock().await;
    active.clear();
}

/// Start the remote agent listener on the specified port.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_start_listener(
    port: u16,
    auth_token: String,
    app: tauri::AppHandle,
    bind_all_interfaces: Option<bool>,
) -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent", "start_listener", "user", None,
        Some(&format!("port={}", port)),
    );
    // Default to all interfaces so VPN/LAN adapters are reachable without
    // requiring a separate "advanced" toggle on the frontend.
    server::start_listener(port, auth_token, app, bind_all_interfaces.unwrap_or(true)).await
}

/// Stop a specific listener by port.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_stop_listener(port: u16) -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "stop_listener",
        "user",
        None,
        Some(&format!("port={}", port)),
    );
    server::stop_listener(port).await
}

/// Check if any listener is running.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_is_listener_running() -> bool {
    server::is_running().await
}

/// List all active listeners (ports).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_list_listeners() -> Vec<ListenerInfo> {
    server::list_listeners().await
}

/// Get the first active listener port (backward-compat).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_get_listener_port() -> u16 {
    server::get_port().await
}

/// Get the shared auth token.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_get_listener_token() -> String {
    server::get_auth_token().await
}

/// List all connected agents.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_list_connections() -> Vec<AgentConnection> {
    let mgr = AGENT_MANAGER.lock().await;
    mgr.list_connections()
}

/// Send a command to a specific agent. Returns the command message ID.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_send_command(
    agent_id: String,
    command: AgentCommand,
) -> Result<String, String> {
    crate::remote_agent::manager::send_command(&agent_id, command).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_chat_send(
    agent_id: String,
    text: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Message cannot be empty".to_string());
    }
    let msg_id = crate::remote_agent::manager::send_command(
        &agent_id,
        AgentCommand::ChatMessage(ChatMessageParams {
            text: trimmed.to_string(),
            sender: Some("controller".to_string()),
        }),
    )
    .await?;

    let message = {
        let mut state = REMOTE_CHAT_STATE.lock().unwrap_or_else(|e| e.into_inner());
        let message = RemoteChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            agent_id,
            sender: "controller".to_string(),
            text: trimmed.to_string(),
            timestamp: now_rfc3339(),
            unread: false,
        };
        state.add_message(message.clone());
        message
    };
    emit_remote_chat_events(&app, &message);
    Ok(msg_id)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn remote_chat_get_state() -> RemoteChatSnapshot {
    let state = REMOTE_CHAT_STATE.lock().unwrap_or_else(|e| e.into_inner());
    state.snapshot()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn remote_chat_mark_read(agent_id: Option<String>, app: tauri::AppHandle) {
    {
        let mut state = REMOTE_CHAT_STATE.lock().unwrap_or_else(|e| e.into_inner());
        for msg in &mut state.messages {
            if !msg.unread {
                continue;
            }
            if msg.sender == "controller" {
                continue;
            }
            if agent_id.as_ref().map(|id| id == &msg.agent_id).unwrap_or(true) {
                msg.unread = false;
            }
        }
    }
    let snapshot = remote_chat_get_state();
    let _ = app.emit("remote-chat:state", snapshot);
    crate::refresh_remote_chat_tray(&app);
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn remote_chat_open_window(app: tauri::AppHandle) -> Result<(), String> {
    crate::open_remote_chat_window(&app)
}

/// Set a user-defined display name for an agent (pass None / null to clear).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_rename(agent_id: String, name: Option<String>) -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "rename",
        "user",
        Some(&agent_id),
        Some(&format!("name={}", name.as_deref().unwrap_or(""))),
    );
    let mut mgr = AGENT_MANAGER.lock().await;
    mgr.rename_agent(&agent_id, name)
}

/// Disconnect an agent gracefully (agent stays alive, can reconnect).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_disconnect(agent_id: String) -> Result<String, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent", "disconnect", "user", Some(&agent_id), None,
    );
    crate::remote_agent::manager::send_command(&agent_id, AgentCommand::Disconnect).await
}

/// Kill an agent process remotely (binary stays on disk).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_kill(agent_id: String) -> Result<String, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent", "kill", "user", Some(&agent_id), None,
    );
    crate::remote_agent::manager::send_command(&agent_id, AgentCommand::Kill).await
}

/// Self-destruct an agent: kill process AND delete binary + config from remote machine.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_self_destruct(agent_id: String) -> Result<String, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent", "self_destruct", "user", Some(&agent_id), None,
    );
    let msg_id =
        crate::remote_agent::manager::send_command(&agent_id, AgentCommand::SelfDestruct).await?;
    // Remove immediately from controller registry view; this action is intended
    // to fully remove the remote agent, not keep a disconnected tombstone.
    {
        let mut mgr = AGENT_MANAGER.lock().await;
        mgr.remove_agent(&agent_id);
    }
    Ok(msg_id)
}

/// Forget an agent from the controller registry/history.
/// This removes stale/offline discovered entries from the backend manager.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_forget(agent_id: String) -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "forget",
        "user",
        Some(&agent_id),
        Some("remove from registry"),
    );
    let mut mgr = AGENT_MANAGER.lock().await;
    mgr.remove_agent(&agent_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Remote shell session commands
// ---------------------------------------------------------------------------

/// Spawn an interactive shell on a remote agent. Returns the session ID.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_shell_spawn(
    agent_id: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "shell_spawn",
        "user",
        Some(&agent_id),
        Some(&format!("cols={}, rows={}", cols, rows)),
    );
    crate::remote_agent::manager::send_command(
        &agent_id,
        AgentCommand::ShellSpawn(ShellSpawnParams {
            cols,
            rows,
            shell: None,
        }),
    )
    .await
}

/// Write input data to a remote shell session's PTY.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_shell_write(
    agent_id: String,
    session_id: String,
    data: String,
) -> Result<String, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "shell_write",
        "user",
        Some(&agent_id),
        Some(&format!("session_id={}, bytes={}", session_id, data.len())),
    );
    crate::remote_agent::manager::send_command(
        &agent_id,
        AgentCommand::ShellInput(ShellInputParams { session_id, data }),
    )
    .await
}

/// Resize a remote shell session's PTY.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_shell_resize(
    agent_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "shell_resize",
        "user",
        Some(&agent_id),
        Some(&format!("session_id={}, cols={}, rows={}", session_id, cols, rows)),
    );
    crate::remote_agent::manager::send_command(
        &agent_id,
        AgentCommand::ShellResize(ShellResizeParams {
            session_id,
            cols,
            rows,
        }),
    )
    .await
}

/// Close a remote shell session.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_shell_close(
    agent_id: String,
    session_id: String,
) -> Result<String, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "shell_close",
        "user",
        Some(&agent_id),
        Some(&format!("session_id={}", session_id)),
    );
    crate::remote_agent::manager::send_command(
        &agent_id,
        AgentCommand::ShellClose(ShellCloseParams { session_id }),
    )
    .await
}

/// Generate an agent binary: cross-compile Go agent with config baked in.
/// The `output_path` is chosen by the frontend (via the dialog plugin) and passed in.
/// Emits `remote-agent:compile-progress` events for live status.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_generate(
    params: GenerateParams,
    output_path: String,
    app: tauri::AppHandle,
) -> Result<GenerateResult, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "generate_start",
        "user",
        None,
        Some(&format!(
            "target_os={}, controller_address={}, use_tls={}, experience={}, output_path={}",
            params.target_os,
            params.controller_address,
            params.use_tls,
            params.experience.clone().unwrap_or_else(|| params.profile.clone()),
            output_path
        )),
    );
    let resources_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot find resources dir: {e}"))?;

    let output = resolve_scoped_write_path(&output_path, &app, "Agent package generation")?;

    // Set up progress forwarding to the frontend
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::channel::<CompileProgress>(32);
    let app_for_progress = app.clone();

    let forwarder = tokio::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            let _ = app_for_progress.emit("remote-agent:compile-progress", &progress);
        }
    });

    // Generate in blocking context (Go compilation)
    let result = tokio::task::spawn_blocking(move || {
        let (std_tx, std_rx) = std::sync::mpsc::channel::<CompileProgress>();

        // Bridge std mpsc -> tokio mpsc
        let progress_tx_clone = progress_tx;
        std::thread::spawn(move || {
            while let Ok(progress) = std_rx.recv() {
                let _ = progress_tx_clone.blocking_send(progress);
            }
        });

        crate::remote_agent::config_gen::generate_agent_package(
            params,
            &resources_dir,
            &output,
            Some(std_tx),
        )
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?;

    let _ = forwarder.await;
    match &result {
        Ok(generated) => {
            let _ = crate::core::audit::AuditWriter::write_entry(
                "agent",
                "generate_success",
                "user",
                Some(&generated.agent_id),
                Some(&format!("binary_path={}", generated.binary_path)),
            );
        }
        Err(err) => {
            let _ = crate::core::audit::AuditWriter::write_entry(
                "agent",
                "generate_failed",
                "user",
                None,
                Some(&format!("error={}", err)),
            );
        }
    }
    result
}

/// Connect to the Cloudflare relay for a remote agent session.
/// The controller side connects outbound and waits for the agent to join.
///
/// This is spawned as a background task with an auto-reconnect loop:
/// if the relay connection drops (network blip, CF restart, agent disconnect
/// then reconnect), the controller re-establishes its relay side so the
/// agent's own reconnect loop can find it again.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_connect_relay(
    session_id: String,
    auth_token: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    RELAY_SHUTDOWN_REQUESTED.store(false, Ordering::SeqCst);
    // Deduplicate by session_id: only one reconnect loop may run at a time.
    {
        let mut active = ACTIVE_RELAY_SESSIONS.lock().await;
        if !active.insert(session_id.clone()) {
            tracing::debug!(
                "Relay connect already active for session {}, ignoring duplicate request",
                session_id
            );
            return Ok(());
        }
    }

    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "connect_relay",
        "user",
        Some(&session_id),
        Some("relay connect requested"),
    );
    let app_clone = app.clone();

    tokio::spawn(async move {
        let mut backoff = std::time::Duration::from_secs(2);
        let max_backoff = std::time::Duration::from_secs(60);

        loop {
            if RELAY_SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
                tracing::info!("Relay reconnect loop stop requested; session={}", session_id);
                break;
            }
            let sid = session_id.clone();
            let token = auth_token.clone();
            let app_handle = app_clone.clone();

            match server::connect_to_relay(sid, token, app_handle).await {
                Ok(()) => {
                    let _ = crate::core::audit::AuditWriter::write_entry(
                        "agent",
                        "relay_session_ended",
                        "system",
                        Some(&session_id),
                        Some("relay session ended; scheduling reconnect"),
                    );
                    // Session ended (agent disconnected or relay closed).
                    // Reconnect so the agent's own retry loop can find us again.
                    tracing::info!("Relay session ended, reconnecting in 2s...");
                    backoff = std::time::Duration::from_secs(2);
                }
                Err(e) if e.contains("token mismatch") => {
                    let _ = crate::core::audit::AuditWriter::write_entry(
                        "agent",
                        "relay_auth_failed",
                        "system",
                        Some(&session_id),
                        Some(&e),
                    );
                    // Permanent auth failure — don't retry
                    tracing::error!("Relay auth failure, stopping: {e}");
                    let _ = app_clone.emit("remote-agent:relay-error", serde_json::json!({
                        "session_id": &session_id,
                        "error": &e,
                    }));
                    break;
                }
                Err(e) if e.contains("already active") => {
                    tracing::info!(
                        "Relay loop already active for session {}, skipping duplicate worker",
                        session_id
                    );
                    break;
                }
                Err(e) => {
                    let _ = crate::core::audit::AuditWriter::write_entry(
                        "agent",
                        "relay_error",
                        "system",
                        Some(&session_id),
                        Some(&e),
                    );
                    tracing::error!(
                        "Relay error: {e} — reconnecting in {:?}",
                        backoff);
                    let _ = app_clone.emit("remote-agent:relay-error", serde_json::json!({
                        "session_id": &session_id,
                        "error": &e,
                    }));
                }
            }

            if RELAY_SHUTDOWN_REQUESTED.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(backoff).await;
            backoff = std::time::Duration::min(backoff * 2, max_backoff);
        }

        let mut active = ACTIVE_RELAY_SESSIONS.lock().await;
        active.remove(&session_id);
    });

    Ok(())
}

/// Generate an auth token (utility for the frontend).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn remote_agent_generate_token() -> String {
    sipalyzer_core::auth::generate_token()
}

/// Export audit log entries to a JSON file on disk.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_export_audit_log(
    entries: Vec<serde_json::Value>,
    path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let scoped_path = resolve_scoped_write_path(&path, &app, "Audit log export")?;
    let json = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("Failed to serialize audit log: {e}"))?;
    tokio::fs::write(&scoped_path, json)
        .await
        .map_err(|e| {
            format!(
                "Failed to write audit log to {}: {e}",
                scoped_path.to_string_lossy()
            )
        })?;
    Ok(())
}

/// Load audit log entries from a JSON file on disk.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn remote_agent_load_audit_log(
    path: String,
    app: tauri::AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let scoped_path = resolve_scoped_existing_path(&path, &app, "Audit log load")?;
    let data = tokio::fs::read_to_string(&scoped_path)
        .await
        .map_err(|e| {
            format!(
                "Failed to read audit log from {}: {e}",
                scoped_path.to_string_lossy()
            )
        })?;
    let entries: Vec<serde_json::Value> = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse audit log: {e}"))?;
    Ok(entries)
}
