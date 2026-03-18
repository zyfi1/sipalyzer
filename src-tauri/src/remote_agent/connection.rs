//! Per-agent connection handler: auth, message routing, heartbeat tracking.

use futures_util::{SinkExt, StreamExt};
use sipalyzer_core::auth::{generate_nonce, verify_hmac, AuthChallenge, PROTOCOL_VERSION};
use sipalyzer_core::auth::AuthResponse;
use sipalyzer_core::protocol::{AgentMessage, AgentReply, AgentResponse, HeartbeatData};
use std::time::Duration;
use std::time::Instant;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::manager::AGENT_MANAGER;
use tauri::Emitter;

/// Internal type alias for the WebSocket stream used by both direct and relay connections.
pub(crate) type WsStream = WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>;
pub(crate) type WsWrite = futures_util::stream::SplitSink<WsStream, Message>;
pub(crate) type WsRead = futures_util::stream::SplitStream<WsStream>;

const HEARTBEAT_CHECK_INTERVAL_SECS: u64 = 10;
const BASE_HEARTBEAT_TIMEOUT_SECS: i64 = 45;
const MAX_HEARTBEAT_TIMEOUT_SECS: i64 = 120;
const RECENT_ACTIVITY_GRACE_SECS: u64 = 20;
const HEARTBEAT_MISS_THRESHOLD: u8 = 3;
const PING_INTERVAL_SECS: u64 = 20;
const MAX_CONSECUTIVE_PING_SEND_FAILS: u8 = 3;
const RTT_WINDOW_SIZE: usize = 12;

fn adaptive_heartbeat_timeout_secs(recent_rtts_ms: &[u64]) -> i64 {
    if recent_rtts_ms.is_empty() {
        return BASE_HEARTBEAT_TIMEOUT_SECS;
    }
    let sum: u64 = recent_rtts_ms.iter().sum();
    let avg = sum / (recent_rtts_ms.len() as u64);
    let worst = *recent_rtts_ms.iter().max().unwrap_or(&0);

    // Bias toward resilience on jittery links (VPN/relay/high-latency WAN),
    // while keeping a bounded timeout so dead sessions are still detected.
    let extra = ((avg * 2) + worst) / 1000;
    let timeout = BASE_HEARTBEAT_TIMEOUT_SECS + (extra as i64);
    timeout.clamp(BASE_HEARTBEAT_TIMEOUT_SECS, MAX_HEARTBEAT_TIMEOUT_SECS)
}

/// Handle a single agent WebSocket connection (direct/LAN path).
/// Performs authentication, then delegates to the shared session loop.
#[tracing::instrument(skip_all, fields(remote_addr = %remote_addr), name = "agent.connection")]
pub async fn handle_agent_connection(
    ws_stream: WsStream,
    auth_token: String,
    remote_addr: String,
    app_handle: tauri::AppHandle,
) {
    let (mut write, mut read) = ws_stream.split();

    // --- Authentication ---
    let nonce = generate_nonce();
    let challenge = AuthChallenge {
        nonce: nonce.clone(),
        protocol_version: PROTOCOL_VERSION,
    };
    let challenge_json = serde_json::to_string(&challenge).unwrap();

    if let Err(e) = write.send(Message::Text(challenge_json.into())).await {
        tracing::error!("Failed to send challenge: {e}");
        return;
    }

    // Wait for auth response
    let auth_msg = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        read.next(),
    )
    .await
    {
        Ok(Some(Ok(Message::Text(text)))) => text,
        _ => {
            tracing::error!("Auth timeout or error");
            return;
        }
    };

    let auth_resp: AuthResponse = match serde_json::from_str(&auth_msg) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Invalid auth response: {e}");
            let _ = write.send(Message::Close(None)).await;
            return;
        }
    };

    // Verify HMAC
    let hmac_valid = verify_hmac(&nonce, &auth_token, &auth_resp.hmac);
    tracing::info!(
        agent_id = %auth_resp.agent_id,
        success = hmac_valid,
        "agent.auth"
    );
    tracing::info!(
        "[RemoteAgent] Auth: agent={}, hmac_match={}",
        auth_resp.agent_id, hmac_valid,);
    if !hmac_valid {
        tracing::error!(
            "[RemoteAgent] Auth FAILED for agent {} — token mismatch!",
            auth_resp.agent_id);
        let _ = app_handle.emit("remote-agent:auth-failed", serde_json::json!({
            "agent_id": &auth_resp.agent_id,
            "remote_addr": &remote_addr,
            "reason": "HMAC token mismatch",
        }));
        let _ = write.send(Message::Close(None)).await;
        return;
    }

    let agent_id = auth_resp.agent_id.clone();
    let agent_profile = if auth_resp.profile.is_empty() { "standard".to_string() } else { auth_resp.profile.clone() };
    let agent_capabilities = auth_resp.capabilities.clone();
    tracing::info!("Agent '{}' authenticated from {} (profile={}, caps={})", agent_id, remote_addr, agent_profile, agent_capabilities.len());

    // Send auth confirmation
    if let Err(e) = write
        .send(Message::Text(
            serde_json::json!({"status": "authenticated"}).to_string().into(),
        ))
        .await
    {
        tracing::error!("Failed to send auth confirm: {e}");
        return;
    }

    run_agent_session(write, read, agent_id, agent_profile, agent_capabilities, remote_addr, app_handle).await;
}

/// Post-authentication agent session: register agent, run message loop, cleanup.
/// Shared between direct connections (`handle_agent_connection`) and relay connections.
pub async fn run_agent_session(
    mut write: WsWrite,
    mut read: WsRead,
    agent_id: String,
    agent_profile: String,
    agent_capabilities: Vec<String>,
    remote_addr: String,
    app_handle: tauri::AppHandle,
) {
    // Create command channel for this agent
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<AgentMessage>(64);

    // Register with a placeholder heartbeat; real data comes with first heartbeat
    let placeholder_ip = if remote_addr.starts_with("relay:") {
        // Relay connections don't have a direct IP — show as pending
        "via relay".to_string()
    } else {
        remote_addr.split(':').next().unwrap_or("").to_string()
    };
    let placeholder_hb = HeartbeatData {
        agent_id: agent_id.clone(),
        hostname: "connecting...".to_string(),
        os: "unknown".to_string(),
        os_version: String::new(),
        arch: String::new(),
        kernel: String::new(),
        cpus: 0,
        memory_mb: 0,
        uptime_secs: 0,
        local_ip: placeholder_ip,
        public_ip: None,
        gateway: None,
        interfaces: vec![],
        profile: agent_profile.clone(),
        capabilities: agent_capabilities.clone(),
    };

    {
        let mut mgr = AGENT_MANAGER.lock().await;
        mgr.register_agent(agent_id.clone(), &placeholder_hb, cmd_tx, remote_addr.clone());
    }

    // Emit auth success + connected events to frontend
    let _ = app_handle.emit("remote-agent:auth-success", serde_json::json!({
        "agent_id": &agent_id,
        "remote_addr": &remote_addr,
    }));
    let _ = app_handle.emit("remote-agent:connected", serde_json::json!({
        "agent_id": &agent_id,
        "remote_addr": &remote_addr,
        "profile": &agent_profile,
        "capabilities": &agent_capabilities,
    }));

    // --- Main message loop ---
    let mut heartbeat_check = tokio::time::interval(Duration::from_secs(HEARTBEAT_CHECK_INTERVAL_SECS));
    heartbeat_check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let mut ping_interval = tokio::time::interval(Duration::from_secs(PING_INTERVAL_SECS));
    ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_inbound_activity = Instant::now();
    let mut heartbeat_miss_count: u8 = 0;
    let mut pending_ping_sent_at: Option<Instant> = None;
    let mut recent_ping_rtts_ms: Vec<u64> = Vec::new();
    let mut consecutive_ping_send_fails: u8 = 0;

    let disconnect_reason: &str;

    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        last_inbound_activity = Instant::now();
                        match serde_json::from_str::<AgentReply>(&text) {
                            Ok(reply) => {
                                if let AgentResponse::Heartbeat(ref hb) = reply.response {
                                    let mut mgr = AGENT_MANAGER.lock().await;
                                    mgr.update_heartbeat(&agent_id, hb);
                                    heartbeat_miss_count = 0;
                                }
                                if let AgentResponse::ChatMessage(ref chat) = reply.response {
                                    crate::commands::remote_agent::ingest_incoming_chat(
                                        &agent_id,
                                        chat,
                                        &app_handle,
                                    );
                                }
                                let event_payload = serde_json::json!({
                                    "agent_id": &agent_id,
                                    "id": &reply.id,
                                    "response": &reply.response,
                                });
                                let _ = app_handle.emit("remote-agent:response", event_payload);
                            }
                            Err(e) => {
                                let preview: String = text.chars().take(500).collect();
                                tracing::info!(
                                    "[RemoteAgent] Bad message from {}: {} — raw: {}",
                                    agent_id, e, preview);
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        tracing::info!("Agent '{}' sent close frame", agent_id);
                        disconnect_reason = "clean_close";
                        break;
                    }
                    None => {
                        tracing::info!("Agent '{}' connection ended", agent_id);
                        disconnect_reason = "connection_lost";
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        last_inbound_activity = Instant::now();
                        let _ = write.send(Message::Pong(data.to_vec().into())).await;
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_inbound_activity = Instant::now();
                        if let Some(sent_at) = pending_ping_sent_at.take() {
                            let rtt_ms = sent_at.elapsed().as_millis() as u64;
                            recent_ping_rtts_ms.push(rtt_ms);
                            if recent_ping_rtts_ms.len() > RTT_WINDOW_SIZE {
                                recent_ping_rtts_ms.remove(0);
                            }
                        }
                        consecutive_ping_send_fails = 0;
                    }
                    Some(Err(e)) => {
                        tracing::error!("WebSocket error from {}: {}", agent_id, e);
                        let _ = app_handle.emit("remote-agent:ws-error", serde_json::json!({
                            "agent_id": &agent_id,
                            "error": format!("{}", e),
                        }));
                        disconnect_reason = "ws_error";
                        break;
                    }
                    _ => {}
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(agent_msg) => {
                        let json = serde_json::to_string(&agent_msg).unwrap();
                        if let Err(e) = write.send(Message::Text(json.into())).await {
                            tracing::error!("Send to {} failed: {}", agent_id, e);
                            let _ = app_handle.emit("remote-agent:ws-error", serde_json::json!({
                                "agent_id": &agent_id,
                                "error": format!("Send failed: {}", e),
                            }));
                            disconnect_reason = "send_error";
                            break;
                        }
                    }
                    None => {
                        disconnect_reason = "controller_closed";
                        break;
                    }
                }
            }
            _ = heartbeat_check.tick() => {
                let mgr = AGENT_MANAGER.lock().await;
                if let Some(entry) = mgr.agents.get(&agent_id) {
                    if let Ok(hb_time) = chrono::DateTime::parse_from_rfc3339(&entry.info.last_heartbeat) {
                        let elapsed = chrono::Utc::now() - hb_time.with_timezone(&chrono::Utc);
                        let timeout_secs = adaptive_heartbeat_timeout_secs(&recent_ping_rtts_ms);
                        if elapsed > chrono::Duration::seconds(timeout_secs) {
                            heartbeat_miss_count = heartbeat_miss_count.saturating_add(1);
                            let has_recent_activity = last_inbound_activity.elapsed() <= Duration::from_secs(RECENT_ACTIVITY_GRACE_SECS);
                            tracing::warn!(
                                "Heartbeat delayed for '{}' ({}s > {}s, misses={}, recent_activity={})",
                                agent_id,
                                elapsed.num_seconds(),
                                timeout_secs,
                                heartbeat_miss_count,
                                has_recent_activity,
                            );
                            if !has_recent_activity && heartbeat_miss_count >= HEARTBEAT_MISS_THRESHOLD {
                                drop(mgr);
                                disconnect_reason = "heartbeat_timeout";
                                break;
                            }
                        } else {
                            heartbeat_miss_count = 0;
                        }
                    }
                }
            }
            _ = ping_interval.tick() => {
                pending_ping_sent_at = Some(Instant::now());
                if let Err(e) = write.send(Message::Ping(vec![].into())).await {
                    consecutive_ping_send_fails = consecutive_ping_send_fails.saturating_add(1);
                    tracing::warn!(
                        "Ping failed for '{}' (attempt {}/{}): {}",
                        agent_id,
                        consecutive_ping_send_fails,
                        MAX_CONSECUTIVE_PING_SEND_FAILS,
                        e
                    );
                    if consecutive_ping_send_fails >= MAX_CONSECUTIVE_PING_SEND_FAILS {
                        disconnect_reason = "ping_failure";
                        break;
                    }
                } else {
                    consecutive_ping_send_fails = 0;
                }
            }
        }
    }

    // Mark as disconnected (keep in manager so the registry can show last-seen info)
    {
        let mut mgr = AGENT_MANAGER.lock().await;
        mgr.mark_disconnected(&agent_id);
    }

    let _ = app_handle.emit("remote-agent:disconnected", serde_json::json!({
        "agent_id": &agent_id,
        "reason": disconnect_reason,
    }));

    let _ = write.send(Message::Close(None)).await;
}
