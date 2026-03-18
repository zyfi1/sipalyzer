import { z } from "zod";

const networkInterfaceSchema = z.object({
  name: z.string(),
  ip: z.string().nullable(),
  mac: z.string().nullable(),
  is_up: z.boolean(),
});

const agentConnectionSchema = z.object({
  id: z.string().min(1),
  hostname: z.string(),
  name: z.string().nullable().optional(),
  os: z.string(),
  os_version: z.string(),
  arch: z.string(),
  kernel: z.string(),
  cpus: z.number(),
  memory_mb: z.number(),
  ip: z.string(),
  public_ip: z.string().nullable().optional(),
  gateway: z.string().nullable().optional(),
  connected_at: z.string(),
  last_heartbeat: z.string(),
  status: z.enum(["connected", "disconnected", "authenticating"]),
  latency_ms: z.number().nullable(),
  uptime_secs: z.number(),
  interfaces: z.array(networkInterfaceSchema),
  profile: z.string(),
  capabilities: z.array(z.string()),
});

const listenerInfoSchema = z.object({
  port: z.number(),
});

const generateResultSchema = z.object({
  binary_path: z.string(),
  auth_token: z.string(),
  agent_id: z.string(),
  config: z.record(z.string(), z.unknown()),
});

const stunResultSchema = z.object({
  public_ip: z.string().nullable(),
  public_port: z.number().nullable(),
  local_ip: z.string().nullable(),
  nat_type: z.string(),
  success: z.boolean(),
});

const netInfoResultSchema = z.object({
  interfaces: z.array(
    z.object({
      name: z.string(),
      friendly_name: z.string().nullable(),
      ipv4: z.array(z.string()),
      is_default: z.boolean(),
      interface_type: z.string(),
    }),
  ),
  local_ip: z.string().nullable(),
  default_gateway: z.string().nullable(),
  success: z.boolean(),
});

const networkCapabilityReportSchema = z.object({
  platform: z.string(),
  tracerouteSupported: z.boolean(),
  tracerouteReason: z.string().nullable(),
  mtrSupported: z.boolean(),
  mtrReason: z.string().nullable(),
  wifiSupported: z.boolean(),
  wifiReason: z.string().nullable(),
});

const captureCapabilityReportSchema = z.object({
  platform: z.string(),
  localCaptureSupported: z.boolean(),
  localCaptureReason: z.string().nullable().optional(),
  remoteCaptureSupported: z.boolean(),
  remoteCaptureReason: z.string().nullable().optional(),
  remoteCaptureNotes: z.array(z.string()),
});

const packetToolDirEntrySchema = z.object({
  name: z.string(),
  is_dir: z.boolean(),
  size: z.number(),
  mod_time: z.string(),
  mode: z.string(),
});

const toolsListDirResultSchema = z.object({
  path: z.string(),
  entries: z.array(packetToolDirEntrySchema),
  error: z.string().optional(),
});

const toolsFetchLogResultSchema = z.object({
  lines: z.array(z.string()),
  total_lines: z.number(),
  matched_lines: z.number(),
  file_size_bytes: z.number(),
});

const reconstructedCallSessionSchema = z.object({
  id: z.string(),
  captureSessionId: z.string(),
  parties: z.array(z.string()),
  startTime: z.string(),
  endTime: z.string().nullable().optional(),
  durationSec: z.number().nullable().optional(),
  disposition: z.enum(["answered", "busy", "failed", "cancelled", "no-answer", "terminated", "unknown", "in-progress"]),
  anomalies: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      label: z.string(),
      severity: z.enum(["critical", "warning", "info"]),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      type: z.string(),
      eventType: z.string().nullable().optional(),
      label: z.string(),
      detail: z.string().nullable().optional(),
      callId: z.string().nullable().optional(),
      packetIndex: z.number().nullable().optional(),
      packetIndices: z.array(z.number()).optional(),
      dialogIndex: z.number().nullable().optional(),
      messageIndex: z.number().nullable().optional(),
      mediaSsrc: z.number().nullable().optional(),
    }).passthrough(),
  ),
  legs: z.array(
    z.object({
      id: z.string(),
      dialogIndex: z.number().nullable().optional(),
      callId: z.string().nullable().optional(),
      from: z.string().nullable().optional(),
      to: z.string().nullable().optional(),
    }),
  ),
  mediaRefs: z.array(
    z.object({
      id: z.string(),
      ssrc: z.number().nullable().optional(),
      codec: z.string().nullable().optional(),
      srcLabel: z.string().nullable().optional(),
      dstLabel: z.string().nullable().optional(),
    }),
  ),
});

const callBehaviorDiffSummarySchema = z.object({
  beforeCallCount: z.number(),
  afterCallCount: z.number(),
  matchedCallCount: z.number(),
  addedCallCount: z.number(),
  removedCallCount: z.number(),
  headerChangeCount: z.number(),
  timerChangeCount: z.number(),
  codecChangeCount: z.number(),
  responseCodeChangeCount: z.number(),
  regressionCount: z.number(),
  hasRegressions: z.boolean(),
  comparableCallRatio: z.number().optional(),
  isComparable: z.boolean().optional(),
  comparabilityNote: z.string().nullable().optional(),
});

const callBehaviorDiffResponseSchema = z.object({
  summary: callBehaviorDiffSummarySchema,
  matchedCalls: z.array(z.unknown()),
  headerChanges: z.array(z.unknown()),
  timerChanges: z.array(z.unknown()),
  codecNegotiationChanges: z.array(z.unknown()),
  responseCodeChanges: z.array(z.unknown()),
  addedCalls: z.array(z.unknown()),
  removedCalls: z.array(z.unknown()),
});
const tauriUnitResultSchema = z.union([z.void(), z.null()]);

const remoteChatMessageSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  sender: z.string(),
  text: z.string(),
  timestamp: z.string(),
  unread: z.boolean(),
});

const remoteChatStateSchema = z.object({
  messages: z.array(remoteChatMessageSchema),
  unread_total: z.number(),
  unread_by_agent: z.record(z.string(), z.number()),
  last_sender: z.string().nullable().optional(),
  last_snippet: z.string().nullable().optional(),
});

const mcpServerProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: z.string(),
  endpoint: z.string().nullable(),
  command: z.string().nullable(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  enabled: z.boolean(),
});

const mcpServerStatusSchema = z.object({
  serverId: z.string(),
  connected: z.boolean(),
  lastError: z.string().nullable(),
  capabilities: z.array(z.string()),
  toolCount: z.number(),
  resourceCount: z.number(),
  promptCount: z.number(),
});

const mcpToolDescriptorSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  description: z.string(),
  inputSchemaJson: z.string(),
});

const mcpResourceDescriptorSchema = z.object({
  serverId: z.string(),
  uri: z.string(),
  name: z.string(),
  mimeType: z.string(),
});

const mcpPromptDescriptorSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  description: z.string(),
});

const mcpToolCallResultSchema = z.object({
  serverId: z.string(),
  toolName: z.string(),
  ok: z.boolean(),
  contentJson: z.string(),
  error: z.string().nullable(),
});

const mcpOrchestrationResultSchema = z.object({
  taskId: z.string(),
  totalTasks: z.number(),
  completedTasks: z.number(),
  succeededTasks: z.number(),
  failedTasks: z.number(),
  results: z.array(mcpToolCallResultSchema),
});

const mcpHostedServerStateSchema = z.object({
  stdioEnabled: z.boolean(),
  networkEnabled: z.boolean(),
  networkBind: z.string(),
  networkPort: z.number(),
  authToken: z.string(),
  publishedToolCount: z.number(),
});

const mcpConnectionTestResultSchema = z.object({
  serverId: z.string(),
  ok: z.boolean(),
  message: z.string(),
});

export const tauriInvokeResponseSchemas: Record<string, z.ZodTypeAny> = {
  remote_agent_start_listener: tauriUnitResultSchema,
  remote_agent_stop_listener: tauriUnitResultSchema,
  remote_agent_is_listener_running: z.boolean(),
  remote_agent_list_connections: z.array(agentConnectionSchema),
  remote_agent_send_command: z.string().min(1),
  remote_agent_list_listeners: z.array(listenerInfoSchema),
  remote_agent_get_listener_port: z.number(),
  remote_agent_get_listener_token: z.string(),
  remote_agent_generate: generateResultSchema,
  remote_agent_generate_token: z.string(),
  remote_agent_load_audit_log: z.array(z.unknown()),
  remote_agent_rename: tauriUnitResultSchema,
  remote_agent_disconnect: z.string(),
  remote_agent_kill: z.string(),
  remote_agent_self_destruct: z.string(),
  remote_agent_forget: tauriUnitResultSchema,
  remote_agent_connect_relay: tauriUnitResultSchema,
  remote_agent_export_audit_log: tauriUnitResultSchema,
  remote_chat_send: z.string().min(1),
  remote_chat_get_state: remoteChatStateSchema,
  remote_chat_mark_read: tauriUnitResultSchema,
  remote_chat_open_window: tauriUnitResultSchema,
  network_stun_test: stunResultSchema,
  network_get_interfaces: netInfoResultSchema,
  network_get_capabilities: networkCapabilityReportSchema,
  create_agent_capture_session: tauriUnitResultSchema,
  get_capture_capabilities: captureCapabilityReportSchema,
  inject_agent_raw_frames: z.number(),
  inject_agent_packet_infos: z.number(),
  stop_agent_capture_session: tauriUnitResultSchema,
  get_call_sessions: z.array(reconstructedCallSessionSchema),
  diff_call_behavior: callBehaviorDiffResponseSchema,
  tools_list_dir: toolsListDirResultSchema,
  tools_fetch_log: toolsFetchLogResultSchema,
  mcp_list_profiles: z.array(mcpServerProfileSchema),
  mcp_upsert_profile: tauriUnitResultSchema,
  mcp_delete_profile: tauriUnitResultSchema,
  mcp_connect_server: mcpServerStatusSchema,
  mcp_test_server_connection: mcpConnectionTestResultSchema,
  mcp_disconnect_server: tauriUnitResultSchema,
  mcp_list_server_status: z.array(mcpServerStatusSchema),
  mcp_list_tools: z.array(mcpToolDescriptorSchema),
  mcp_list_resources: z.array(mcpResourceDescriptorSchema),
  mcp_list_prompts: z.array(mcpPromptDescriptorSchema),
  mcp_call_tool: mcpToolCallResultSchema,
  mcp_orchestrate_call: mcpOrchestrationResultSchema,
  mcp_start_hosted_server: mcpHostedServerStateSchema,
  mcp_stop_hosted_server: tauriUnitResultSchema,
  mcp_get_hosted_server_state: mcpHostedServerStateSchema.nullable(),
};

export const tauriInvokePayloadSchemas: Record<string, z.ZodTypeAny> = {
  remote_agent_start_listener: z.object({
    port: z.number(),
    authToken: z.string().min(1),
  }),
  remote_agent_stop_listener: z.object({
    port: z.number(),
  }),
  remote_agent_send_command: z.object({
    agentId: z.string().min(1),
    command: z.object({
      command: z.string().min(1),
      params: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  remote_agent_generate: z.object({
    params: z.object({
      target_os: z.string(),
      controller_address: z.string(),
      use_tls: z.boolean(),
      auth_token: z.string(),
      expires_seconds: z.number().nullable(),
      label: z.string().nullable(),
      profile: z.string(),
      experience: z.enum(["minimal", "full"]).optional(),
      daemon_headless: z.boolean().optional(),
      agent_id: z.string().optional(),
    }),
    outputPath: z.string().min(1),
  }),
  remote_agent_rename: z.object({
    agentId: z.string().min(1),
    name: z.string().nullable(),
  }),
  remote_agent_disconnect: z.object({
    agentId: z.string().min(1),
  }),
  remote_agent_kill: z.object({
    agentId: z.string().min(1),
  }),
  remote_agent_self_destruct: z.object({
    agentId: z.string().min(1),
  }),
  remote_agent_forget: z.object({
    agentId: z.string().min(1),
  }),
  remote_agent_connect_relay: z.object({
    sessionId: z.string().min(1),
    authToken: z.string().min(1),
  }),
  remote_agent_export_audit_log: z.object({
    entries: z.array(z.unknown()),
    path: z.string().min(1),
  }),
  remote_agent_load_audit_log: z.object({
    path: z.string().min(1),
  }),
  remote_chat_send: z.object({
    agentId: z.string().min(1),
    text: z.string().min(1),
  }),
  remote_chat_get_state: z.object({}).passthrough().optional(),
  remote_chat_mark_read: z.object({
    agentId: z.string().nullable().optional(),
  }),
  remote_chat_open_window: z.object({}).passthrough().optional(),
  tools_list_dir: z.object({
    path: z.string().min(1),
    showHidden: z.boolean(),
  }),
  tools_fetch_log: z.object({
    path: z.string().min(1),
    tailLines: z.number(),
    filter: z.string().nullable(),
  }),
  create_agent_capture_session: z.object({
    sessionId: z.string().min(1),
    name: z.string().min(1),
    interfaceName: z.string().min(1),
  }),
  inject_agent_raw_frames: z.object({
    sessionId: z.string().min(1),
    frames: z.array(z.string()),
  }),
  inject_agent_packet_infos: z.object({
    sessionId: z.string().min(1),
    packets: z.array(z.record(z.string(), z.unknown())),
  }),
  stop_agent_capture_session: z.object({
    sessionId: z.string().min(1),
  }),
  get_call_sessions: z.object({
    sessionId: z.string().min(1),
  }),
  diff_call_behavior: z.object({
    beforeSessionId: z.string().min(1),
    afterSessionId: z.string().min(1),
  }),
  mcp_list_profiles: z.object({}).passthrough().optional(),
  mcp_upsert_profile: z.object({
    profile: mcpServerProfileSchema,
  }),
  mcp_delete_profile: z.object({
    serverId: z.string().min(1),
  }),
  mcp_connect_server: z.object({
    serverId: z.string().min(1),
  }),
  mcp_test_server_connection: z.object({
    serverId: z.string().min(1),
  }),
  mcp_disconnect_server: z.object({
    serverId: z.string().min(1),
  }),
  mcp_list_server_status: z.object({}).passthrough().optional(),
  mcp_list_tools: z.object({
    serverId: z.string().min(1),
  }),
  mcp_list_resources: z.object({
    serverId: z.string().min(1),
  }),
  mcp_list_prompts: z.object({
    serverId: z.string().min(1),
  }),
  mcp_call_tool: z.object({
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    argumentsJson: z.string(),
  }),
  mcp_orchestrate_call: z.object({
    tasks: z.array(
      z.object({
        serverId: z.string().min(1),
        toolName: z.string().min(1),
        argumentsJson: z.string(),
        agentRole: z.string().optional(),
        objective: z.string().optional(),
      }),
    ),
  }),
  mcp_start_hosted_server: z.object({
    stdioEnabled: z.boolean(),
    networkEnabled: z.boolean(),
    networkBind: z.string().nullable().optional(),
    networkPort: z.number().nullable().optional(),
    authToken: z.string().nullable().optional(),
  }),
  mcp_stop_hosted_server: z.object({}).passthrough().optional(),
  mcp_get_hosted_server_state: z.object({}).passthrough().optional(),
};
