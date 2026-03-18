/**
 * Remote Agent API — Tauri IPC wrappers for remote agent commands.
 */

import { invokeTauri } from "./invoke";
import type {
  RemoteCommandName,
  RemoteCommandParams,
} from "@/types/remoteCommandContract";
import { validateRemoteCommandPayload } from "@/contracts/remoteCommandSchemas";
import { validateIpcPayload } from "@/lib/ipcValidation";

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentConnection {
  id: string;
  hostname: string;
  name?: string | null;
  os: string;
  os_version: string;
  arch: string;
  kernel: string;
  cpus: number;
  memory_mb: number;
  ip: string;
  public_ip?: string | null;
  gateway?: string | null;
  connected_at: string;
  last_heartbeat: string;
  status: "connected" | "disconnected" | "authenticating";
  latency_ms: number | null;
  uptime_secs: number;
  interfaces: NetworkInterface[];
  profile: string;
  capabilities: string[];
}

export interface NetworkInterface {
  name: string;
  ip: string | null;
  mac: string | null;
  is_up: boolean;
}

export interface GenerateParams {
  target_os: string;
  controller_address: string;
  use_tls: boolean;
  auth_token: string;
  expires_seconds: number | null;
  label: string | null;
  /** Backward-compatible profile field mirrored into backend metadata. */
  profile: string;
  /** Runtime experience mode used by the generated agent package. */
  experience?: "minimal" | "full";
  /** @deprecated Use `experience: \"minimal\"` instead. */
  daemon_headless?: boolean;
  /** When recreating an agent, reuse this ID instead of generating a new one. */
  agent_id?: string;
}

/** Result of probing or requesting capture permissions on a remote agent. */
export interface CapturePermStatus {
  available: boolean;
  method?: string;
  detail?: string;
}

export interface GenerateResult {
  binary_path: string;
  auth_token: string;
  agent_id: string;
  config: Record<string, unknown>;
}

export interface AgentCommand<
  TCommand extends string = string,
  TParams = Record<string, unknown>,
> {
  command: TCommand;
  params?: TParams;
}

export interface RemoteChatMessage {
  id: string;
  agent_id: string;
  sender: string;
  text: string;
  timestamp: string;
  unread: boolean;
}

export interface RemoteChatState {
  messages: RemoteChatMessage[];
  unread_total: number;
  unread_by_agent: Record<string, number>;
  last_sender?: string | null;
  last_snippet?: string | null;
}

function invokeWithSchema<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return invokeTauri<T>(command, payload);
}

// ── Listener ───────────────────────────────────────────────────────────

export async function startListener(port: number, authToken: string): Promise<void> {
  const payload = { port, authToken };
  validateIpcPayload("remote_agent_start_listener", payload);
  return invokeWithSchema("remote_agent_start_listener", payload);
}

export async function stopListener(port: number): Promise<void> {
  const payload = { port };
  validateIpcPayload("remote_agent_stop_listener", payload);
  return invokeWithSchema("remote_agent_stop_listener", payload);
}

export async function isListenerRunning(): Promise<boolean> {
  return invokeWithSchema("remote_agent_is_listener_running");
}

export interface ListenerInfo {
  port: number;
}

export async function listListeners(): Promise<ListenerInfo[]> {
  return invokeWithSchema("remote_agent_list_listeners");
}

export async function getListenerPort(): Promise<number> {
  return invokeWithSchema("remote_agent_get_listener_port");
}

export async function getListenerToken(): Promise<string> {
  return invokeWithSchema("remote_agent_get_listener_token");
}

// ── Connections ────────────────────────────────────────────────────────

export async function listConnections(): Promise<AgentConnection[]> {
  return invokeWithSchema("remote_agent_list_connections");
}

export async function sendCommand<TCommand extends RemoteCommandName>(
  agentId: string,
  command: AgentCommand<TCommand, RemoteCommandParams<TCommand>>,
): Promise<string>;
export async function sendCommand(
  agentId: string,
  command: AgentCommand<string, Record<string, unknown>>,
): Promise<string>;
export async function sendCommand(
  agentId: string,
  command: AgentCommand<string, Record<string, unknown>>,
): Promise<string> {
  const safeCommand = validateRemoteCommandPayload(command);
  const payload = { agentId, command: safeCommand };
  validateIpcPayload("remote_agent_send_command", payload);
  return invokeWithSchema("remote_agent_send_command", payload);
}

export async function renameAgent(agentId: string, name: string | null): Promise<void> {
  const payload = { agentId, name };
  validateIpcPayload("remote_agent_rename", payload);
  return invokeWithSchema("remote_agent_rename", payload);
}

export async function disconnectAgent(agentId: string): Promise<string> {
  const payload = { agentId };
  validateIpcPayload("remote_agent_disconnect", payload);
  return invokeWithSchema("remote_agent_disconnect", payload);
}

export async function killAgent(agentId: string): Promise<string> {
  const payload = { agentId };
  validateIpcPayload("remote_agent_kill", payload);
  return invokeWithSchema("remote_agent_kill", payload);
}

export async function selfDestructAgent(agentId: string): Promise<string> {
  const payload = { agentId };
  validateIpcPayload("remote_agent_self_destruct", payload);
  return invokeWithSchema("remote_agent_self_destruct", payload);
}

export async function forgetAgent(agentId: string): Promise<void> {
  const payload = { agentId };
  validateIpcPayload("remote_agent_forget", payload);
  return invokeWithSchema("remote_agent_forget", payload);
}

// ── Address Detection ──────────────────────────────────────────────────

export interface DetectedAddress {
  ip: string;
  label: string;
  type: "local" | "public" | "interface";
  iface?: string;
  /** True if address is likely unreachable from remote networks (e.g. public IP behind NAT without forwarding). */
  unreachable?: boolean;
}

/** Result from detectAddresses with metadata about detection status. */
export interface AddressDetectionResult {
  addresses: DetectedAddress[];
  stunFailed: boolean;
  netInfoFailed: boolean;
  stunNatType?: string;
}

export interface StunResult {
  public_ip: string | null;
  public_port: number | null;
  local_ip: string | null;
  nat_type: string;
  success: boolean;
}

export interface NetInfoResult {
  interfaces: { name: string; friendly_name: string | null; ipv4: string[]; is_default: boolean; interface_type: string }[];
  local_ip: string | null;
  default_gateway: string | null;
  success: boolean;
}

/** Interface names that indicate non-routable local-only adapters we should suppress. */
const NON_ROUTABLE_IFACE_PATTERNS = [
  /^docker/i, /^br-/i, /^veth/i, /^virbr/i,       // Docker / libvirt
  /^vEthernet/i, /^WSL/i,                           // WSL / Hyper-V
  /^vmnet/i, /^vboxnet/i,                            // VMware / VirtualBox
  /^lo$/i, /^Loopback/i,                             // Loopback
];

/** Tunnel/VPN interface names are valid candidates for direct controller reachability. */
const VPN_IFACE_PATTERNS = [
  /^tailscale/i, /^utun/i, /^tun/i, /^tap/i, /^wg/i, /^wireguard/i, /^ppp/i,
];

function isNonRoutableInterface(name: string): boolean {
  return NON_ROUTABLE_IFACE_PATTERNS.some((re) => re.test(name));
}

function isVpnInterface(name: string): boolean {
  return VPN_IFACE_PATTERNS.some((re) => re.test(name));
}

function isLinkLocal(ip: string): boolean {
  return ip.startsWith("169.254.");
}

/**
 * Auto-detect local + public IPs by calling the existing STUN and network info commands.
 * Filters out noisy interfaces (Docker, VPN, WSL, etc.) and link-local addresses.
 * Returns addresses grouped with metadata about detection status.
 */
export async function detectAddresses(listenerPort: number): Promise<AddressDetectionResult> {
  const addresses: DetectedAddress[] = [];
  const seen = new Set<string>();
  let stunFailed = false;
  let netInfoFailed = false;
  let stunNatType: string | undefined;

  // Run STUN + net info in parallel
  const [stunResult, netInfo] = await Promise.allSettled([
    invokeWithSchema<StunResult>("network_stun_test", {}),
    invokeWithSchema<NetInfoResult>("network_get_interfaces"),
  ]);

  // Extract public IP from STUN
  if (stunResult.status === "fulfilled" && stunResult.value.success && stunResult.value.public_ip) {
    const ip = stunResult.value.public_ip;
    stunNatType = stunResult.value.nat_type;
    const isDirectNat = stunResult.value.nat_type === "No NAT (Direct)";
    if (!seen.has(ip)) {
      seen.add(ip);
      addresses.push({
        ip: `${ip}:${listenerPort}`,
        label: `Public IP (${stunResult.value.nat_type})`,
        type: "public",
        unreachable: !isDirectNat,
      });
    }
  } else {
    stunFailed = true;
  }

  // Staging list for route-aware local/interface candidates.
  const interfaceCandidates: Array<{ address: DetectedAddress; score: number }> = [];

  // Extract local IPs from network info
  if (netInfo.status === "fulfilled" && netInfo.value.success) {
    const info = netInfo.value;

    // Default local IP first
    if (info.local_ip && !seen.has(info.local_ip) && !isLinkLocal(info.local_ip)) {
      seen.add(info.local_ip);
      interfaceCandidates.push({
        address: {
          ip: `${info.local_ip}:${listenerPort}`,
          label: "Local IP (default route)",
          type: "local",
        },
        score: 0,
      });
    }

    // Other interfaces with IPv4. Keep VPN/tunnel routes as viable candidates.
    for (const iface of info.interfaces) {
      if (isNonRoutableInterface(iface.name)) continue;
      if (iface.friendly_name && isNonRoutableInterface(iface.friendly_name)) continue;

      const displayName = iface.friendly_name || iface.name;
      const vpnLike = isVpnInterface(iface.name) || (iface.friendly_name ? isVpnInterface(iface.friendly_name) : false);
      const ifaceType = (iface.interface_type || "").toLowerCase();
      const isVirtual = ifaceType.includes("virtual") || ifaceType.includes("tunnel");

      for (const ipv4 of iface.ipv4) {
        if (seen.has(ipv4) || ipv4 === "127.0.0.1" || isLinkLocal(ipv4)) continue;
        seen.add(ipv4);
        let score = 30;
        if (iface.is_default) score = 5;
        else if (vpnLike) score = 15;
        else if (isVirtual) score = 45;

        interfaceCandidates.push({
          address: {
            ip: `${ipv4}:${listenerPort}`,
            label: `${displayName} (${iface.interface_type})`,
            type: "interface",
            iface: iface.name,
          },
          score,
        });
      }
    }
  } else {
    netInfoFailed = true;
  }

  // Stable ordering: default route first, then VPN/tunnel routes, then other interfaces.
  interfaceCandidates
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.address.label.localeCompare(b.address.label);
    })
    .forEach((entry) => {
      addresses.push(entry.address);
    });

  return { addresses, stunFailed, netInfoFailed, stunNatType };
}

// ── Relay ──────────────────────────────────────────────────────────────

/** The relay host for cross-network (remote) agent connections. */
export const RELAY_URL = "relay.zyfi.io";

/**
 * Connect the controller side to the Cloudflare relay for a remote session.
 * The controller connects outbound and waits for the agent to join.
 * This returns immediately — the relay session runs in the background.
 */
export async function connectRelay(sessionId: string, authToken: string): Promise<void> {
  const payload = { sessionId, authToken };
  validateIpcPayload("remote_agent_connect_relay", payload);
  return invokeWithSchema("remote_agent_connect_relay", payload);
}

export async function remoteChatSend(agentId: string, text: string): Promise<string> {
  const payload = { agentId, text };
  validateIpcPayload("remote_chat_send", payload);
  return invokeWithSchema("remote_chat_send", payload);
}

export async function remoteChatGetState(): Promise<RemoteChatState> {
  return invokeWithSchema("remote_chat_get_state", {});
}

export async function remoteChatMarkRead(agentId?: string): Promise<void> {
  const payload = { agentId: agentId ?? null };
  validateIpcPayload("remote_chat_mark_read", payload);
  return invokeWithSchema("remote_chat_mark_read", payload);
}

export async function remoteChatOpenWindow(): Promise<void> {
  return invokeWithSchema("remote_chat_open_window", {});
}

// ── Generation ─────────────────────────────────────────────────────────

export async function generateAgentPackage(
  params: GenerateParams,
  outputPath: string,
): Promise<GenerateResult> {
  const payload = { params, outputPath };
  validateIpcPayload("remote_agent_generate", payload);
  return invokeWithSchema("remote_agent_generate", payload);
}

export async function generateToken(): Promise<string> {
  return invokeWithSchema("remote_agent_generate_token");
}

// ── Audit Log Persistence ──────────────────────────────────────────────

export async function exportAuditLog(entries: unknown[], path: string): Promise<void> {
  const payload = { entries, path };
  validateIpcPayload("remote_agent_export_audit_log", payload);
  return invokeWithSchema("remote_agent_export_audit_log", payload);
}

export async function loadAuditLog(path: string): Promise<unknown[]> {
  const payload = { path };
  validateIpcPayload("remote_agent_load_audit_log", payload);
  return invokeWithSchema("remote_agent_load_audit_log", payload);
}
