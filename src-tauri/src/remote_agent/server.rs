//! WebSocket server for accepting remote agent connections.
//! Supports multiple concurrent listeners on different ports,
//! and outbound relay connections for remote (cross-network) mode.

use super::connection::{handle_agent_connection, run_agent_session};
use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use serde::Serialize;
use sipalyzer_core::auth::{
    generate_nonce, verify_hmac, AuthChallenge, AuthResponse, PROTOCOL_VERSION,
};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::{watch, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

/// The relay host used for remote (cross-network) agent connections.
pub const RELAY_URL: &str = "relay.zyfi.io";

/// Per-listener instance holding its shutdown handle.
struct ListenerInstance {
    shutdown_tx: watch::Sender<bool>,
}

/// Global server state: a map of port → listener instance, plus shared auth token.
struct ServerState {
    listeners: HashMap<u16, ListenerInstance>,
    auth_token: String,
}

static SERVER_STATE: Lazy<Arc<Mutex<ServerState>>> = Lazy::new(|| {
    Arc::new(Mutex::new(ServerState {
        listeners: HashMap::new(),
        auth_token: String::new(),
    }))
});

/// Prevents concurrent controller connections for the same relay session ID.
static ACTIVE_RELAY_CONNECTS: Lazy<StdMutex<std::collections::HashSet<String>>> =
    Lazy::new(|| StdMutex::new(std::collections::HashSet::new()));

/// RAII guard that removes a session from ACTIVE_RELAY_CONNECTS on drop.
struct RelayConnectGuard {
    session_id: String,
}

impl RelayConnectGuard {
    fn acquire(session_id: &str) -> Result<Self, String> {
        let mut active = ACTIVE_RELAY_CONNECTS
            .lock()
            .map_err(|_| "Relay session lock poisoned".to_string())?;
        if !active.insert(session_id.to_string()) {
            return Err(format!("Relay session already active: {session_id}"));
        }
        Ok(Self {
            session_id: session_id.to_string(),
        })
    }
}

impl Drop for RelayConnectGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_RELAY_CONNECTS.lock() {
            active.remove(&self.session_id);
        }
    }
}

/// Info about a running listener, returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ListenerInfo {
    pub port: u16,
}

/// Start a WebSocket listener on the given port.
/// Multiple listeners can run concurrently on different ports.
#[tracing::instrument(skip_all, fields(port), name = "agent.listener_start")]
pub async fn start_listener(
    port: u16,
    auth_token: String,
    app_handle: tauri::AppHandle,
    bind_all_interfaces: bool,
) -> Result<(), String> {
    tracing::info!(port = port, "Starting agent WebSocket listener");
    let mut state = SERVER_STATE.lock().await;

    if state.listeners.contains_key(&port) {
        return Err(format!("Listener already running on port {port}"));
    }

    let bind_host = if bind_all_interfaces {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    let addr: SocketAddr = format!("{bind_host}:{port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind on port {port}: {e}"))?;

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Store the shared auth token (same for all listeners)
    if state.auth_token.is_empty() {
        state.auth_token = auth_token.clone();
    }

    state
        .listeners
        .insert(port, ListenerInstance { shutdown_tx });
    drop(state); // Release lock before spawning

    tracing::info!("Listener started on port {port}");

    let token = auth_token.clone();
    tokio::spawn(async move {
        run_listener(listener, token, shutdown_rx, app_handle).await;

        // Remove from the map when done
        let mut state = SERVER_STATE.lock().await;
        state.listeners.remove(&port);
        tracing::info!("Listener on port {port} stopped");
    });

    Ok(())
}

/// Stop a specific listener by port.
#[tracing::instrument(skip_all, fields(port), name = "agent.listener_stop")]
pub async fn stop_listener(port: u16) -> Result<(), String> {
    let mut state = SERVER_STATE.lock().await;

    if let Some(instance) = state.listeners.remove(&port) {
        let _ = instance.shutdown_tx.send(true);
        Ok(())
    } else {
        Err(format!("No listener running on port {port}"))
    }
}

/// Stop all running listeners.
pub async fn stop_all_listeners() -> Result<(), String> {
    let mut state = SERVER_STATE.lock().await;
    for (_port, instance) in state.listeners.drain() {
        let _ = instance.shutdown_tx.send(true);
    }
    Ok(())
}

/// Check if any listener is running.
pub async fn is_running() -> bool {
    !SERVER_STATE.lock().await.listeners.is_empty()
}

/// List all active listener ports.
pub async fn list_listeners() -> Vec<ListenerInfo> {
    let state = SERVER_STATE.lock().await;
    state
        .listeners
        .keys()
        .map(|&port| ListenerInfo { port })
        .collect()
}

/// Get the first active listener port (for backward-compat / default).
pub async fn get_port() -> u16 {
    let state = SERVER_STATE.lock().await;
    state.listeners.keys().copied().min().unwrap_or(0)
}

/// Get the shared auth token.
pub async fn get_auth_token() -> String {
    SERVER_STATE.lock().await.auth_token.clone()
}

/// Connect outbound to the Cloudflare relay for a remote agent session.
///
/// The controller connects to `wss://relay.zyfi.io/session/{session_id}/controller`
/// and periodically sends auth challenges. When the agent connects on the other
/// side of the relay and responds to a challenge, the authenticated session begins.
///
/// This function blocks until the relay connection ends (agent disconnect, error, etc.).
pub async fn connect_to_relay(
    session_id: String,
    auth_token: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let _connect_guard = RelayConnectGuard::acquire(&session_id)?;
    let url = format!("wss://{}/session/{}/controller", RELAY_URL, session_id);
    tracing::info!("Connecting to relay: {}", url);

    let (ws_stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("Relay connection failed: {e}"))?;

    tracing::info!(
        "Connected to relay session {}, waiting for agent...",
        session_id
    );

    let _ = app_handle.emit(
        "remote-agent:relay-waiting",
        serde_json::json!({
            "session_id": &session_id,
        }),
    );

    let (mut write, mut read) = ws_stream.split();

    // Phase 1: Auth polling — send a challenge every 5 seconds until the agent responds.
    // When the agent hasn't connected yet, the relay drops these (no peer).
    // Once the agent connects it receives the next challenge and responds.
    let mut recent_nonces: Vec<String> = Vec::new();

    let (agent_id, agent_profile, agent_capabilities) = 'auth: loop {
        let nonce = generate_nonce();
        recent_nonces.push(nonce.clone());
        if recent_nonces.len() > 5 {
            recent_nonces.remove(0);
        }

        let challenge = AuthChallenge {
            nonce: nonce.clone(),
            protocol_version: PROTOCOL_VERSION,
        };
        let challenge_json = serde_json::to_string(&challenge).unwrap();

        if let Err(e) = write.send(Message::Text(challenge_json.into())).await {
            return Err(format!("Relay send failed: {e}"));
        }

        // Wait up to 5 seconds for a response before sending the next challenge
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break; // No response yet, send another challenge
            }

            tokio::select! {
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(auth_resp) = serde_json::from_str::<AuthResponse>(&text) {
                                // Try verification against any recent nonce
                                let mut verified = false;
                                for n in &recent_nonces {
                                    if verify_hmac(n, &auth_token, &auth_resp.hmac) {
                                        verified = true;
                                        break;
                                    }
                                }

                                if verified {
                                    let id = auth_resp.agent_id.clone();
                                    let profile = if auth_resp.profile.is_empty() {
                                        "standard".to_string()
                                    } else {
                                        auth_resp.profile.clone()
                                    };
                                    let caps = auth_resp.capabilities.clone();

                                    tracing::info!(
                                        "[RemoteAgent] Agent '{}' authenticated via relay (session={})",
                                        id, session_id);

                                    // Send auth confirmation
                                    if let Err(e) = write
                                        .send(Message::Text(
                                            serde_json::json!({"status": "authenticated"}).to_string().into(),
                                        ))
                                        .await
                                    {
                                        return Err(format!("Failed to send auth confirm via relay: {e}"));
                                    }

                                    break 'auth (id, profile, caps);
                                } else {
                                    tracing::error!("Relay auth FAILED — HMAC mismatch (session={})", session_id);
                                    let _ = app_handle.emit("remote-agent:auth-failed", serde_json::json!({
                                        "agent_id": &auth_resp.agent_id,
                                        "remote_addr": format!("relay:{}", session_id),
                                        "reason": "HMAC token mismatch",
                                    }));
                                    let _ = write.send(Message::Close(None)).await;
                                    return Err("Agent authentication failed: token mismatch".to_string());
                                }
                            }
                            // Not an auth response — ignore (could be relay metadata)
                        }
                        Some(Ok(Message::Ping(data))) => {
                            let _ = write.send(Message::Pong(data.to_vec().into())).await;
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            return Err("Relay connection closed while waiting for agent".to_string());
                        }
                        _ => {}
                    }
                }
                _ = tokio::time::sleep_until(deadline) => {
                    break; // Timeout, send another challenge
                }
            }
        }
    };

    // Phase 2: Auth succeeded — run the shared session loop
    let remote_addr = format!("relay:{}", session_id);
    run_agent_session(
        write,
        read,
        agent_id,
        agent_profile,
        agent_capabilities,
        remote_addr,
        app_handle,
    )
    .await;

    Ok(())
}

/// Internal listener loop.
async fn run_listener(
    listener: TcpListener,
    auth_token: String,
    mut shutdown_rx: watch::Receiver<bool>,
    app_handle: tauri::AppHandle,
) {
    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, addr)) => {
                        tracing::info!(remote_addr = %addr, "Agent connection accepted");
                        let token = auth_token.clone();
                        let app = app_handle.clone();
                        let remote_addr = addr.to_string();

                        tokio::spawn(async move {
                            // Upgrade TCP to WebSocket
                            match accept_async(tokio_tungstenite::MaybeTlsStream::Plain(stream)).await {
                                Ok(ws_stream) => {
                                    handle_agent_connection(ws_stream, token, remote_addr, app).await;
                                }
                                Err(e) => {
                                    tracing::error!("WebSocket upgrade failed from {}: {e}", remote_addr);
                                }
                            }
                        });
                    }
                    Err(e) => {
                        tracing::error!("Accept error: {e}");
                    }
                }
            }
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    break;
                }
            }
        }
    }
}
