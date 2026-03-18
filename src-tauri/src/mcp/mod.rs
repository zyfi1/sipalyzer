use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerProfile {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub endpoint: Option<String>,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub server_id: String,
    pub connected: bool,
    pub last_error: Option<String>,
    pub capabilities: Vec<String>,
    pub tool_count: usize,
    pub resource_count: usize,
    pub prompt_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceDescriptor {
    pub server_id: String,
    pub uri: String,
    pub name: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptDescriptor {
    pub server_id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResult {
    pub server_id: String,
    pub tool_name: String,
    pub ok: bool,
    pub content_json: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOrchestrationTask {
    pub server_id: String,
    pub tool_name: String,
    pub arguments_json: String,
    #[serde(default)]
    pub agent_role: Option<String>,
    #[serde(default)]
    pub objective: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionTestResult {
    pub server_id: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOrchestrationResult {
    pub task_id: String,
    pub total_tasks: usize,
    pub completed_tasks: usize,
    pub succeeded_tasks: usize,
    pub failed_tasks: usize,
    pub results: Vec<McpToolCallResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHostedServerState {
    pub stdio_enabled: bool,
    pub network_enabled: bool,
    pub network_bind: String,
    pub network_port: u16,
    pub auth_token: String,
    pub published_tool_count: usize,
}

#[derive(Default)]
pub struct McpManager {
    pub profiles: HashMap<String, McpServerProfile>,
    pub statuses: HashMap<String, McpServerStatus>,
    pub tools: HashMap<String, Vec<McpToolDescriptor>>,
    pub resources: HashMap<String, Vec<McpResourceDescriptor>>,
    pub prompts: HashMap<String, Vec<McpPromptDescriptor>>,
    pub hosted_state: Option<McpHostedServerState>,
}

impl McpManager {
    pub fn upsert_profile(&mut self, profile: McpServerProfile) {
        let status = self.statuses.entry(profile.id.clone()).or_insert(McpServerStatus {
            server_id: profile.id.clone(),
            connected: false,
            last_error: None,
            capabilities: vec!["tools".to_string(), "resources".to_string(), "prompts".to_string()],
            tool_count: 0,
            resource_count: 0,
            prompt_count: 0,
        });
        status.last_error = None;
        self.profiles.insert(profile.id.clone(), profile);
    }
}

pub static MCP_MANAGER: Lazy<StdMutex<McpManager>> = Lazy::new(|| StdMutex::new(McpManager::default()));
