//! Connection manager: tracks all connected agents and their state.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sipalyzer_core::protocol::{AgentCommand, AgentMessage, HeartbeatData};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};

/// Global connection manager instance.
pub static AGENT_MANAGER: Lazy<Arc<Mutex<AgentManager>>> =
    Lazy::new(|| Arc::new(Mutex::new(AgentManager::new())));

/// Represents a connected remote agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConnection {
    pub id: String,
    pub hostname: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub kernel: String,
    pub cpus: u32,
    pub memory_mb: u64,
    pub ip: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gateway: Option<String>,
    pub connected_at: String,
    pub last_heartbeat: String,
    pub status: AgentStatus,
    pub latency_ms: Option<f64>,
    pub uptime_secs: u64,
    pub interfaces: Vec<sipalyzer_core::protocol::NetworkInterface>,
    pub profile: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Connected,
    Disconnected,
    Authenticating,
}

/// Internal agent entry with communication channels.
pub struct AgentEntry {
    pub info: AgentConnection,
    /// Send commands to this agent's connection handler.
    pub command_tx: mpsc::Sender<AgentMessage>,
}

pub struct AgentManager {
    pub agents: HashMap<String, AgentEntry>,
}

const STALE_CONNECTED_SECS: i64 = 90;

impl AgentManager {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
        }
    }

    /// Register a newly authenticated agent.
    /// Preserves user-assigned name from a previous session if the agent reconnects.
    pub fn register_agent(
        &mut self,
        agent_id: String,
        heartbeat: &HeartbeatData,
        command_tx: mpsc::Sender<AgentMessage>,
        remote_ip: String,
    ) {
        let now = chrono::Utc::now().to_rfc3339();
        let prev_name = self
            .agents
            .get(&agent_id)
            .and_then(|e| e.info.name.clone());

        let conn = AgentConnection {
            id: agent_id.clone(),
            hostname: heartbeat.hostname.clone(),
            name: prev_name,
            os: heartbeat.os.clone(),
            os_version: heartbeat.os_version.clone(),
            arch: heartbeat.arch.clone(),
            kernel: heartbeat.kernel.clone(),
            cpus: heartbeat.cpus,
            memory_mb: heartbeat.memory_mb,
            ip: remote_ip,
            public_ip: heartbeat.public_ip.clone(),
            gateway: heartbeat.gateway.clone(),
            connected_at: now.clone(),
            last_heartbeat: now,
            status: AgentStatus::Connected,
            latency_ms: None,
            uptime_secs: heartbeat.uptime_secs,
            interfaces: heartbeat.interfaces.clone(),
            profile: heartbeat.profile.clone(),
            capabilities: heartbeat.capabilities.clone(),
        };

        self.agents.insert(
            agent_id,
            AgentEntry {
                info: conn,
                command_tx,
            },
        );
    }

    /// Update heartbeat data for an agent.
    pub fn update_heartbeat(&mut self, agent_id: &str, heartbeat: &HeartbeatData) {
        if let Some(entry) = self.agents.get_mut(agent_id) {
            entry.info.last_heartbeat = chrono::Utc::now().to_rfc3339();
            entry.info.hostname = heartbeat.hostname.clone();
            entry.info.os = heartbeat.os.clone();
            entry.info.os_version = heartbeat.os_version.clone();
            entry.info.arch = heartbeat.arch.clone();
            entry.info.kernel = heartbeat.kernel.clone();
            entry.info.cpus = heartbeat.cpus;
            entry.info.memory_mb = heartbeat.memory_mb;
            entry.info.uptime_secs = heartbeat.uptime_secs;
            entry.info.interfaces = heartbeat.interfaces.clone();
            entry.info.profile = heartbeat.profile.clone();
            entry.info.capabilities = heartbeat.capabilities.clone();
            if let Some(best_ip) = select_best_agent_ip(heartbeat) {
                entry.info.ip = best_ip;
            }
            if heartbeat.public_ip.is_some() {
                entry.info.public_ip = heartbeat.public_ip.clone();
            }
            if heartbeat.gateway.is_some() {
                entry.info.gateway = heartbeat.gateway.clone();
            }
        }
    }

    /// Mark an agent as disconnected (keeps it in the list for the registry).
    pub fn mark_disconnected(&mut self, agent_id: &str) {
        if let Some(entry) = self.agents.get_mut(agent_id) {
            entry.info.status = AgentStatus::Disconnected;
            entry.info.last_heartbeat = chrono::Utc::now().to_rfc3339();
            entry.info.latency_ms = None;
        }
    }

    /// Fully remove an agent from the manager (e.g. self-destruct / kill).
    pub fn remove_agent(&mut self, agent_id: &str) {
        self.agents.remove(agent_id);
    }

    /// Set a user-defined display name for an agent.
    pub fn rename_agent(&mut self, agent_id: &str, name: Option<String>) -> Result<(), String> {
        let entry = self
            .agents
            .get_mut(agent_id)
            .ok_or_else(|| format!("Agent '{}' not connected", agent_id))?;
        entry.info.name = name;
        Ok(())
    }

    /// Get a list of all connected agents (for the frontend).
    pub fn list_connections(&self) -> Vec<AgentConnection> {
        let now = chrono::Utc::now();
        self.agents
            .values()
            .map(|e| {
                let mut info = e.info.clone();
                if info.status == AgentStatus::Connected {
                    let stale = chrono::DateTime::parse_from_rfc3339(&info.last_heartbeat)
                        .ok()
                        .map(|ts| now - ts.with_timezone(&chrono::Utc) > chrono::Duration::seconds(STALE_CONNECTED_SECS))
                        .unwrap_or(true);
                    if stale {
                        info.status = AgentStatus::Disconnected;
                        info.latency_ms = None;
                    }
                }
                info
            })
            .collect()
    }

    /// Prepare a command send by cloning the channel sender.
    ///
    /// The caller should drop the manager lock, then await the send.
    /// This prevents holding the global lock during async send.
    pub fn prepare_send(
        &self,
        agent_id: &str,
        command: AgentCommand,
    ) -> Result<(String, mpsc::Sender<AgentMessage>, AgentMessage), String> {
        let entry = self
            .agents
            .get(agent_id)
            .ok_or_else(|| format!("Agent '{}' not connected", agent_id))?;
        if entry.info.status != AgentStatus::Connected {
            return Err(format!("Agent '{}' is currently disconnected", agent_id));
        }

        let msg = AgentMessage::new(command);
        let msg_id = msg.id.clone();
        let tx = entry.command_tx.clone();

        Ok((msg_id, tx, msg))
    }
}

fn is_link_local_ipv4(ip: &str) -> bool {
    ip.starts_with("169.254.")
}

fn select_best_agent_ip(heartbeat: &HeartbeatData) -> Option<String> {
    if !heartbeat.local_ip.is_empty() && !is_link_local_ipv4(&heartbeat.local_ip) {
        return Some(heartbeat.local_ip.clone());
    }

    heartbeat
        .interfaces
        .iter()
        .filter(|iface| iface.is_up)
        .find_map(|iface| iface.ip.clone().filter(|ip| !is_link_local_ipv4(ip)))
        .or_else(|| {
            heartbeat
                .interfaces
                .iter()
                .find_map(|iface| iface.ip.clone().filter(|ip| !is_link_local_ipv4(ip)))
        })
}

/// Send a command to an agent with a 5-second timeout, without holding the
/// manager lock during the send. This is the preferred way to send commands.
pub async fn send_command(agent_id: &str, command: AgentCommand) -> Result<String, String> {
    let (msg_id, tx, msg) = {
        let mgr = AGENT_MANAGER.lock().await;
        mgr.prepare_send(agent_id, command)?
        // Lock is dropped here
    };

    match tokio::time::timeout(std::time::Duration::from_secs(15), tx.send(msg)).await {
        Ok(Ok(())) => Ok(msg_id),
        Ok(Err(_)) => Err(format!("Agent '{}' connection closed", agent_id)),
        Err(_) => Err(format!("Send to agent '{}' timed out (15s)", agent_id)),
    }
}
