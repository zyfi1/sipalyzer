use crate::mcp::{
    McpConnectionTestResult, McpHostedServerState, McpOrchestrationResult, McpOrchestrationTask,
    McpPromptDescriptor, McpResourceDescriptor, McpServerProfile, McpServerStatus,
    McpToolCallResult, McpToolDescriptor, MCP_MANAGER,
};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::sync::watch;
use once_cell::sync::Lazy;
use std::time::Duration;
use std::path::Path;

static HOSTED_SERVER_STOP: Lazy<std::sync::Mutex<Option<watch::Sender<bool>>>> =
    Lazy::new(|| std::sync::Mutex::new(None));

fn default_catalog(profile: &McpServerProfile) -> (Vec<McpToolDescriptor>, Vec<McpResourceDescriptor>, Vec<McpPromptDescriptor>) {
    let tools = vec![
        McpToolDescriptor {
            server_id: profile.id.clone(),
            name: "search_knowledge_base".to_string(),
            description: "Search troubleshooting knowledge entries".to_string(),
            input_schema_json: r#"{"type":"object","properties":{"query":{"type":"string"}}}"#
                .to_string(),
        },
        McpToolDescriptor {
            server_id: profile.id.clone(),
            name: "run_network_probe".to_string(),
            description: "Run a network probe from MCP bridge".to_string(),
            input_schema_json: r#"{"type":"object","properties":{"target":{"type":"string"}}}"#
                .to_string(),
        },
    ];
    let resources = vec![McpResourceDescriptor {
        server_id: profile.id.clone(),
        uri: "sipalyzer://docs/mcp/quickstart".to_string(),
        name: "MCP Quickstart".to_string(),
        mime_type: "text/markdown".to_string(),
    }];
    let prompts = vec![McpPromptDescriptor {
        server_id: profile.id.clone(),
        name: "mcp_diagnostic_triage".to_string(),
        description: "Diagnose SIP and network symptoms from a short transcript".to_string(),
    }];
    (tools, resources, prompts)
}

async fn call_network_tool(endpoint: &str, tool_name: &str, arguments_json: &str) -> Result<String, String> {
    let parsed_args = serde_json::from_str::<serde_json::Value>(arguments_json)
        .map_err(|e| format!("Invalid tool arguments JSON: {e}"))?;
    if endpoint.starts_with("tcp://") {
        let addr = endpoint.trim_start_matches("tcp://");
        let mut stream = TcpStream::connect(addr)
            .await
            .map_err(|e| format!("TCP connect failed: {e}"))?;
        let request = serde_json::json!({
            "method": "tools/call",
            "params": { "toolName": tool_name, "arguments": parsed_args }
        });
        let line = format!("{}\n", request);
        stream
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("TCP write failed: {e}"))?;
        let mut reader = BufReader::new(stream);
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .await
            .map_err(|e| format!("TCP read failed: {e}"))?;
        Ok(response.trim().to_string())
    } else {
        let url = endpoint.trim_end_matches('/').to_string();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("HTTP client init failed: {e}"))?;
        let args_value = serde_json::from_str::<serde_json::Value>(arguments_json)
            .unwrap_or(serde_json::json!({}));
        let body = serde_json::json!({
            "toolName": tool_name,
            "arguments": args_value
        });
        let res = client
            .post(format!("{url}/tool"))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP tool call failed: {e}"))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("HTTP tool call returned {}: {}", status, text));
        }
        Ok(text)
    }
}

async fn check_network_endpoint(endpoint: &str) -> Result<(), String> {
    if endpoint.starts_with("tcp://") {
        let addr = endpoint.trim_start_matches("tcp://");
        let mut stream = TcpStream::connect(addr)
            .await
            .map_err(|e| format!("TCP connect failed: {e}"))?;
        let request = serde_json::json!({ "method": "health", "params": {} });
        stream
            .write_all(format!("{}\n", request).as_bytes())
            .await
            .map_err(|e| format!("TCP write failed: {e}"))?;
        let mut reader = BufReader::new(stream);
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .await
            .map_err(|e| format!("TCP read failed: {e}"))?;
        if response.trim().is_empty() {
            return Err("TCP health check returned empty response".to_string());
        }
        let parsed = serde_json::from_str::<serde_json::Value>(response.trim())
            .map_err(|e| format!("TCP health response is not valid JSON: {e}"))?;
        if parsed.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            Ok(())
        } else {
            Err("TCP health response did not indicate success".to_string())
        }
    } else {
        let url = endpoint.trim_end_matches('/').to_string();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|e| format!("HTTP client init failed: {e}"))?;
        let status = client
            .get(format!("{url}/health"))
            .send()
            .await
            .map_err(|e| format!("HTTP health check failed: {e}"))?
            .status();
        if !status.is_success() {
            return Err(format!("HTTP health endpoint returned {}", status));
        }
        Ok(())
    }
}

async fn call_stdio_tool(profile: &McpServerProfile, tool_name: &str, arguments_json: &str) -> Result<String, String> {
    let command = profile
        .command
        .as_deref()
        .ok_or_else(|| "stdio profile is missing command".to_string())?;
    let mut cmd = Command::new(command);
    if !profile.args.is_empty() {
        cmd.args(&profile.args);
    }
    cmd.env("SIPALYZER_MCP_TOOL_NAME", tool_name);
    cmd.env("SIPALYZER_MCP_TOOL_ARGS_JSON", arguments_json);
    for (key, value) in &profile.env {
        cmd.env(key, value);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn stdio MCP command: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("stdio MCP command failed: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn execute_profile_tool_call(
    profile: McpServerProfile,
    tool_name: String,
    arguments_json: String,
) -> McpToolCallResult {
    let result = match profile.transport.as_str() {
        "network" => {
            if let Some(endpoint) = profile.endpoint.as_deref() {
                call_network_tool(endpoint, &tool_name, &arguments_json).await
            } else {
                Err("network profile is missing endpoint".to_string())
            }
        }
        "stdio" => call_stdio_tool(&profile, &tool_name, &arguments_json).await,
        other => Err(format!("Unsupported MCP transport: {other}")),
    };

    match result {
        Ok(content_json) => McpToolCallResult {
            server_id: profile.id,
            tool_name,
            ok: true,
            content_json,
            error: None,
        },
        Err(error) => McpToolCallResult {
            server_id: profile.id,
            tool_name,
            ok: false,
            content_json: String::new(),
            error: Some(error),
        },
    }
}

fn command_exists(command: &str) -> bool {
    if command.trim().is_empty() {
        return false;
    }
    let command_path = Path::new(command);
    if command_path.components().count() > 1 {
        return command_path.exists();
    }
    let path_value = std::env::var_os("PATH");
    let Some(path_value) = path_value else {
        return false;
    };
    std::env::split_paths(&path_value).any(|dir| dir.join(command).exists())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_list_profiles() -> Vec<McpServerProfile> {
    let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.profiles.values().cloned().collect()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_upsert_profile(profile: McpServerProfile) -> Result<(), String> {
    let mut mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.upsert_profile(profile);
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_delete_profile(server_id: String) -> Result<(), String> {
    let mut mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.profiles.remove(&server_id);
    mgr.statuses.remove(&server_id);
    mgr.tools.remove(&server_id);
    mgr.resources.remove(&server_id);
    mgr.prompts.remove(&server_id);
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_connect_server(server_id: String, app: tauri::AppHandle) -> Result<McpServerStatus, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "mcp_connect_server",
        "user",
        Some(&server_id),
        None,
    );
    let profile = {
        let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
        mgr.profiles
            .get(&server_id)
            .cloned()
            .ok_or_else(|| format!("MCP profile not found: {server_id}"))?
    };

    if profile.transport == "network" {
        if let Some(endpoint) = profile.endpoint.as_deref() {
            check_network_endpoint(endpoint).await?;
        } else {
            return Err("network profile is missing endpoint".to_string());
        }
    } else if profile.transport == "stdio" && profile.command.as_deref().unwrap_or("").is_empty() {
        return Err("stdio profile is missing command".to_string());
    }

    let (tools, resources, prompts) = default_catalog(&profile);
    let mut mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());

    mgr.tools.insert(server_id.clone(), tools.clone());
    mgr.resources.insert(server_id.clone(), resources.clone());
    mgr.prompts.insert(server_id.clone(), prompts.clone());
    let status = McpServerStatus {
        server_id: server_id.clone(),
        connected: true,
        last_error: None,
        capabilities: vec!["tools".to_string(), "resources".to_string(), "prompts".to_string()],
        tool_count: tools.len(),
        resource_count: resources.len(),
        prompt_count: prompts.len(),
    };
    mgr.statuses.insert(server_id.clone(), status.clone());
    drop(mgr);

    let _ = app.emit(
        "mcp:server-status",
        serde_json::json!({ "serverId": server_id, "connected": true }),
    );
    Ok(status)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_test_server_connection(server_id: String) -> Result<McpConnectionTestResult, String> {
    let profile = {
        let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
        mgr.profiles
            .get(&server_id)
            .cloned()
            .ok_or_else(|| format!("MCP profile not found: {server_id}"))?
    };

    let result = match profile.transport.as_str() {
        "network" => {
            if let Some(endpoint) = profile.endpoint.as_deref() {
                check_network_endpoint(endpoint).await
            } else {
                Err("network profile is missing endpoint".to_string())
            }
        }
        "stdio" => {
            let command = profile.command.as_deref().unwrap_or("");
            if command.is_empty() {
                Err("stdio profile is missing command".to_string())
            } else if !command_exists(command) {
                Err(format!("stdio command not found in PATH: {command}"))
            } else {
                Ok(())
            }
        }
        other => Err(format!("Unsupported MCP transport: {other}")),
    };

    Ok(match result {
        Ok(()) => McpConnectionTestResult {
            server_id,
            ok: true,
            message: "Connection test passed".to_string(),
        },
        Err(message) => McpConnectionTestResult {
            server_id,
            ok: false,
            message,
        },
    })
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_disconnect_server(server_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "mcp_disconnect_server",
        "user",
        Some(&server_id),
        None,
    );
    let mut mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(status) = mgr.statuses.get_mut(&server_id) {
        status.connected = false;
    }
    let _ = app.emit(
        "mcp:server-status",
        serde_json::json!({ "serverId": server_id, "connected": false }),
    );
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_list_server_status() -> Vec<McpServerStatus> {
    let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.statuses.values().cloned().collect()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_list_tools(server_id: String) -> Vec<McpToolDescriptor> {
    let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.tools.get(&server_id).cloned().unwrap_or_default()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_list_resources(server_id: String) -> Vec<McpResourceDescriptor> {
    let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.resources.get(&server_id).cloned().unwrap_or_default()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_list_prompts(server_id: String) -> Vec<McpPromptDescriptor> {
    let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.prompts.get(&server_id).cloned().unwrap_or_default()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    arguments_json: String,
    app: tauri::AppHandle,
) -> Result<McpToolCallResult, String> {
    serde_json::from_str::<serde_json::Value>(&arguments_json)
        .map_err(|e| format!("Invalid tool arguments JSON: {e}"))?;
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "mcp_call_tool",
        "user",
        Some(&server_id),
        Some(&format!("tool={}", tool_name)),
    );
    let _ = app.emit(
        "mcp:tool-call-start",
        serde_json::json!({ "serverId": server_id, "toolName": tool_name }),
    );

    let profile = {
        let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
        mgr.profiles
            .get(&server_id)
            .cloned()
            .ok_or_else(|| format!("MCP profile not found: {server_id}"))?
    };

    let result = execute_profile_tool_call(profile, tool_name.clone(), arguments_json).await;

    let _ = app.emit("mcp:tool-call-finish", &result);
    Ok(result)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_orchestrate_call(
    tasks: Vec<McpOrchestrationTask>,
    app: tauri::AppHandle,
) -> Result<McpOrchestrationResult, String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "mcp_orchestrate_call",
        "user",
        None,
        Some(&format!("tasks={}", tasks.len())),
    );
    let task_id = uuid::Uuid::new_v4().to_string();
    let total = tasks.len();
    let mut results = Vec::with_capacity(total);

    let profiles = {
        let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
        tasks
            .iter()
            .map(|task| {
                mgr.profiles
                    .get(&task.server_id)
                    .cloned()
                    .ok_or_else(|| format!("MCP profile not found: {}", task.server_id))
            })
            .collect::<Result<Vec<_>, _>>()?
    };

    let mut handles = Vec::with_capacity(total);
    for (idx, task) in tasks.iter().enumerate() {
        let _ = app.emit(
            "mcp:agent-progress",
            serde_json::json!({
                "taskId": task_id,
                "index": idx,
                "total": total,
                "serverId": task.server_id,
                "toolName": task.tool_name,
                "agentRole": task.agent_role,
                "objective": task.objective
            }),
        );
        let profile = profiles[idx].clone();
        let tool_name = task.tool_name.clone();
        let arguments_json = task.arguments_json.clone();
        handles.push(tokio::spawn(async move {
            execute_profile_tool_call(profile, tool_name, arguments_json).await
        }));
    }

    for handle in handles {
        let result = handle.await.map_err(|e| format!("MCP orchestration worker failed: {e}"))?;
        results.push(result);
    }

    let succeeded = results.iter().filter(|result| result.ok).count();
    let failed = results.len().saturating_sub(succeeded);

    let summary = McpOrchestrationResult {
        task_id,
        total_tasks: total,
        completed_tasks: total,
        succeeded_tasks: succeeded,
        failed_tasks: failed,
        results,
    };
    let _ = app.emit("mcp:orchestration-finish", &summary);
    Ok(summary)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_start_hosted_server(
    stdio_enabled: bool,
    network_enabled: bool,
    network_bind: Option<String>,
    network_port: Option<u16>,
    auth_token: Option<String>,
) -> Result<McpHostedServerState, String> {
    if !stdio_enabled && !network_enabled {
        return Err("Hosted MCP server requires at least one transport (stdio or network).".to_string());
    }
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "mcp_start_hosted_server",
        "user",
        None,
        Some(&format!("stdio={}, network={}", stdio_enabled, network_enabled)),
    );
    if let Some(sender) = HOSTED_SERVER_STOP
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let _ = sender.send(true);
    }
    let mut mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    let state = McpHostedServerState {
        stdio_enabled,
        network_enabled,
        network_bind: network_bind.unwrap_or_else(|| "127.0.0.1".to_string()),
        network_port: network_port.unwrap_or(9595),
        auth_token: auth_token.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        published_tool_count: 12,
    };
    mgr.hosted_state = Some(state.clone());
    drop(mgr);

    if state.network_enabled {
        let bind = state.network_bind.clone();
        let port = state.network_port;
        let token = state.auth_token.clone();
        let (tx, mut rx) = watch::channel(false);
        {
            let mut guard = HOSTED_SERVER_STOP.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(tx);
        }
        tokio::spawn(async move {
            let listener = match TcpListener::bind(format!("{bind}:{port}")).await {
                Ok(listener) => listener,
                Err(err) => {
                    tracing::error!("Failed to start hosted MCP network listener: {}", err);
                    return;
                }
            };
            loop {
                tokio::select! {
                    _ = rx.changed() => {
                        if *rx.borrow() {
                            break;
                        }
                    }
                    accepted = listener.accept() => {
                        let (socket, _) = match accepted {
                            Ok(tuple) => tuple,
                            Err(err) => {
                                tracing::warn!("Hosted MCP accept failed: {}", err);
                                continue;
                            }
                        };
                        let auth_token = token.clone();
                        tokio::spawn(async move {
                            let (reader, mut writer) = socket.into_split();
                            let mut lines = BufReader::new(reader).lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                let response = match serde_json::from_str::<serde_json::Value>(&line) {
                                    Ok(request) => {
                                        let incoming = request.get("authToken").and_then(|value| value.as_str()).unwrap_or("");
                                        if incoming != auth_token {
                                            serde_json::json!({ "ok": false, "error": "unauthorized" })
                                        } else {
                                            match request.get("method").and_then(|value| value.as_str()).unwrap_or("") {
                                                "health" => serde_json::json!({ "ok": true, "status": "healthy" }),
                                                "tools/list" => serde_json::json!({
                                                    "ok": true,
                                                    "tools": [
                                                        { "name": "search_knowledge_base", "description": "Search troubleshooting entries" },
                                                        { "name": "run_network_probe", "description": "Run basic network probe" }
                                                    ]
                                                }),
                                                "tools/call" => {
                                                    let params = request.get("params").cloned().unwrap_or(serde_json::json!({}));
                                                    serde_json::json!({
                                                        "ok": true,
                                                        "result": {
                                                            "mode": "hosted-network",
                                                            "echo": params
                                                        }
                                                    })
                                                }
                                                _ => serde_json::json!({ "ok": false, "error": "unsupported_method" }),
                                            }
                                        }
                                    }
                                    Err(err) => serde_json::json!({ "ok": false, "error": format!("invalid_json: {}", err) }),
                                };
                                let _ = writer.write_all(format!("{}\n", response).as_bytes()).await;
                            }
                        });
                    }
                }
            }
        });
    }
    Ok(state)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_stop_hosted_server() -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "agent",
        "mcp_stop_hosted_server",
        "user",
        None,
        None,
    );
    let mut mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.hosted_state = None;
    drop(mgr);
    if let Some(sender) = HOSTED_SERVER_STOP
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let _ = sender.send(true);
    }
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn mcp_get_hosted_server_state() -> Option<McpHostedServerState> {
    let mgr = MCP_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    mgr.hosted_state.clone()
}

