import { invokeTauri } from "./invoke";
import { listen, type UnlistenFn } from "@/lib/tauriEvents";

export interface McpServerProfile {
  id: string;
  name: string;
  transport: "stdio" | "network";
  endpoint: string | null;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface McpServerStatus {
  serverId: string;
  connected: boolean;
  lastError: string | null;
  capabilities: string[];
  toolCount: number;
  resourceCount: number;
  promptCount: number;
}

export interface McpToolDescriptor {
  serverId: string;
  name: string;
  description: string;
  inputSchemaJson: string;
}

export interface McpResourceDescriptor {
  serverId: string;
  uri: string;
  name: string;
  mimeType: string;
}

export interface McpPromptDescriptor {
  serverId: string;
  name: string;
  description: string;
}

export interface McpToolCallResult {
  serverId: string;
  toolName: string;
  ok: boolean;
  contentJson: string;
  error: string | null;
}

export interface McpOrchestrationTask {
  serverId: string;
  toolName: string;
  argumentsJson: string;
  agentRole?: string;
  objective?: string;
}

export interface McpOrchestrationResult {
  taskId: string;
  totalTasks: number;
  completedTasks: number;
  succeededTasks: number;
  failedTasks: number;
  results: McpToolCallResult[];
}

export interface McpHostedServerState {
  stdioEnabled: boolean;
  networkEnabled: boolean;
  networkBind: string;
  networkPort: number;
  authToken: string;
  publishedToolCount: number;
}

export interface McpConnectionTestResult {
  serverId: string;
  ok: boolean;
  message: string;
}

export function mcpListProfiles(): Promise<McpServerProfile[]> {
  return invokeTauri<McpServerProfile[]>("mcp_list_profiles", {});
}

export function mcpUpsertProfile(profile: McpServerProfile): Promise<void> {
  return invokeTauri<void>("mcp_upsert_profile", { profile });
}

export function mcpDeleteProfile(serverId: string): Promise<void> {
  return invokeTauri<void>("mcp_delete_profile", { serverId });
}

export function mcpConnectServer(serverId: string): Promise<McpServerStatus> {
  return invokeTauri<McpServerStatus>("mcp_connect_server", { serverId });
}

export function mcpTestServerConnection(serverId: string): Promise<McpConnectionTestResult> {
  return invokeTauri<McpConnectionTestResult>("mcp_test_server_connection", { serverId });
}

export function mcpDisconnectServer(serverId: string): Promise<void> {
  return invokeTauri<void>("mcp_disconnect_server", { serverId });
}

export function mcpListServerStatus(): Promise<McpServerStatus[]> {
  return invokeTauri<McpServerStatus[]>("mcp_list_server_status", {});
}

export function mcpListTools(serverId: string): Promise<McpToolDescriptor[]> {
  return invokeTauri<McpToolDescriptor[]>("mcp_list_tools", { serverId });
}

export function mcpListResources(serverId: string): Promise<McpResourceDescriptor[]> {
  return invokeTauri<McpResourceDescriptor[]>("mcp_list_resources", { serverId });
}

export function mcpListPrompts(serverId: string): Promise<McpPromptDescriptor[]> {
  return invokeTauri<McpPromptDescriptor[]>("mcp_list_prompts", { serverId });
}

export function mcpCallTool(serverId: string, toolName: string, argumentsJson: string): Promise<McpToolCallResult> {
  return invokeTauri<McpToolCallResult>("mcp_call_tool", { serverId, toolName, argumentsJson });
}

export function mcpOrchestrateCall(tasks: McpOrchestrationTask[]): Promise<McpOrchestrationResult> {
  return invokeTauri<McpOrchestrationResult>("mcp_orchestrate_call", { tasks });
}

export function mcpStartHostedServer(payload: {
  stdioEnabled: boolean;
  networkEnabled: boolean;
  networkBind?: string | null;
  networkPort?: number | null;
  authToken?: string | null;
}): Promise<McpHostedServerState> {
  return invokeTauri<McpHostedServerState>("mcp_start_hosted_server", payload);
}

export function mcpStopHostedServer(): Promise<void> {
  return invokeTauri<void>("mcp_stop_hosted_server", {});
}

export function mcpGetHostedServerState(): Promise<McpHostedServerState | null> {
  return invokeTauri<McpHostedServerState | null>("mcp_get_hosted_server_state", {});
}

export function onMcpServerStatus(handler: (payload: { serverId: string; connected: boolean }) => void): Promise<UnlistenFn> {
  return listen<{ serverId: string; connected: boolean }>("mcp:server-status", (event) => handler(event.payload));
}

export function onMcpAgentProgress(
  handler: (payload: {
    taskId: string;
    index: number;
    total: number;
    serverId: string;
    toolName: string;
    agentRole?: string | null;
    objective?: string | null;
  }) => void,
): Promise<UnlistenFn> {
  return listen<{
    taskId: string;
    index: number;
    total: number;
    serverId: string;
    toolName: string;
    agentRole?: string | null;
    objective?: string | null;
  }>(
    "mcp:agent-progress",
    (event) => handler(event.payload),
  );
}
