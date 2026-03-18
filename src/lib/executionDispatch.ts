/**
 * Unified execution dispatch: routes tool execution to local Tauri commands
 * or remote agents based on the execution context.
 */

import type { ExecutionContext } from "@/stores/executionContextStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import type {
  RemoteCommandName,
  RemoteCommandParams,
} from "@/types/remoteCommandContract";
import {
  remoteCommandResultSchemas,
  unwrapRemoteResultEnvelope,
} from "@/contracts/remoteReplySchemas";

// ── Core dispatch ───────────────────────────────────────────────

export type DispatchSource = "local" | "remote";

export interface DispatchResult<T> {
  source: DispatchSource;
  result: T;
  agentId?: string;
}

function schemaErrorSummary(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

/**
 * Generic dispatch helper.
 * - Local: calls localFn() directly.
 * - Remote: sends command via agent, awaits result, normalizes.
 */
export async function dispatch<TResult, TCommand extends RemoteCommandName>(
  context: ExecutionContext,
  localFn: () => Promise<TResult>,
  remoteCommandType: TCommand,
  remoteParams: RemoteCommandParams<TCommand>,
  normalizer: (remoteResult: unknown) => TResult,
): Promise<DispatchResult<TResult>> {
  if (context.type === "local") {
    const result = await localFn();
    return {
      source: "local" as const,
      result,
      agentId: undefined,
    };
  }

  const { sendCommand, waitForCommand } = useRemoteAgentStore.getState();
  const msgId = await sendCommand(
    context.agentId,
    remoteCommandType,
    remoteParams,
  );

  const outcome = await waitForCommand(msgId);

  if ("error" in outcome) {
    throw new Error(outcome.error);
  }

  const unwrapped = unwrapRemoteResultEnvelope(outcome.result);
  if (!unwrapped.ok) {
    throw new Error(unwrapped.error);
  }
  const unwrappedRemoteResult = unwrapped.result;

  const resultSchema = remoteCommandResultSchemas[remoteCommandType];
  const safeRemoteResult = resultSchema
    ? (() => {
        const parsed = resultSchema.safeParse(unwrappedRemoteResult);
        if (!parsed.success) {
          throw new Error(
            `Invalid remote result for ${remoteCommandType}: ${schemaErrorSummary(parsed.error.message)}`,
          );
        }
        return parsed.data;
      })()
    : unwrappedRemoteResult;

  return {
    source: "remote" as const,
    result: normalizer(safeRemoteResult),
    agentId: context.agentId,
  };
}

// ── Per-tool dispatch adapters ──────────────────────────────────

import * as netApi from "@/api/networkTest";
import type { PortTestEntry } from "@/types/networkTest";
import {
  normalizePingResult,
  normalizeTracerouteResult,
  normalizeDnsResult,
  normalizePortScanResult,
  normalizeDeviceScanResult,
  normalizeRegistrationResult,
  normalizeFaxResult,
  normalizeSipCallResult,
  normalizeJoinResult,
  normalizeIgmpQueryResult,
  normalizeSnoopingVerifyResult,
  normalizeSendTestResult,
  normalizeDnsSipResolveResult,
  normalizeDnsReverseResult,
  normalizeDnsDigResult,
  normalizeDnsGeoIpResult,
  normalizeNtpCheckResult,
  normalizeNatDetectResult,
  normalizeSnmpPollResult,
  normalizeMtrResult,
  normalizeDeviceControlResult,
  normalizeCapturePermResult,
  normalizeFetchProvisionResult,
  normalizeSipProbeResult,
  normalizeStunResult,
} from "./resultNormalizers";
import * as multicastApi from "@/api/multicast";
import { fetchProvisionFile } from "@/api/provision";

// Ping
export function dispatchPing(
  ctx: ExecutionContext,
  host: string,
  count?: number,
) {
  return dispatch(
    ctx,
    () => netApi.networkPing(host, count),
    "Ping",
    { host, count: count ?? 4, timeout_ms: 5000 },
    normalizePingResult,
  );
}

// Traceroute
export function dispatchTraceroute(
  ctx: ExecutionContext,
  host: string,
  maxHops?: number,
) {
  return dispatch(
    ctx,
    () => netApi.networkTraceroute(host, maxHops),
    "Traceroute",
    { host, max_hops: maxHops ?? 30, timeout_ms: 5000 },
    normalizeTracerouteResult,
  );
}

// DNS
export function dispatchDns(ctx: ExecutionContext, domain: string) {
  return dispatch(
    ctx,
    () => netApi.networkDnsLookup(domain),
    "DnsLookup",
    { hostname: domain, record_type: "A" },
    normalizeDnsResult,
  );
}

// Port Scan
export function dispatchPortScan(
  ctx: ExecutionContext,
  host: string,
  entries: PortTestEntry[],
  timeoutMs?: number,
) {
  const portsStr = entries.map((e) => String(e.port)).join(",");
  return dispatch(
    ctx,
    () => netApi.networkPortScan(host, entries, timeoutMs),
    "PortScan",
    { host, ports: portsStr, timeout_ms: timeoutMs ?? 3000 },
    normalizePortScanResult,
  );
}

// Device Scan
export function dispatchDeviceScan(
  ctx: ExecutionContext,
  network?: string,
  bannerGrab?: boolean,
  localFn?: () => Promise<any>,
) {
  return dispatch(
    ctx,
    localFn ?? (() => Promise.reject(new Error("No local scan function"))),
    "DeviceScan",
    {
      ...(network ? { network } : {}),
      banner_grab: bannerGrab ?? false,
    },
    normalizeDeviceScanResult,
  );
}

// Registration Test
export function dispatchRegistrationTest(
  ctx: ExecutionContext,
  localFn: () => Promise<any>,
  params: {
    registrar: string;
    username: string;
    password: string;
    port?: number;
    transport?: string;
    domain?: string;
    expires?: number;
    timeout_secs?: number;
    unregister?: boolean;
  },
) {
  return dispatch(
    ctx,
    localFn,
    "SipRegistrationTest",
    {
      registrar: params.registrar,
      username: params.username,
      password: params.password,
      port: params.port ?? 5060,
      transport: params.transport ?? "udp",
      ...(params.domain ? { domain: params.domain } : {}),
      ...(typeof params.expires === "number" ? { expires: params.expires } : {}),
      ...(typeof params.timeout_secs === "number" ? { timeout_secs: params.timeout_secs } : {}),
      ...(params.unregister ? { unregister: true } : {}),
    },
    normalizeRegistrationResult,
  );
}

// Fax Send
export function dispatchFaxSend(
  ctx: ExecutionContext,
  localFn: () => Promise<any>,
  params: {
    target: string;
    fax_number?: string;
    port?: number;
    caller_id?: string;
    station_id?: string;
    domain?: string;
    username?: string;
    password?: string;
    transport?: string;
    timeout_secs?: number;
    baud_rate?: number;
    ecm?: boolean;
    resolution?: string;
    header_line?: string;
  },
) {
  return dispatch(ctx, localFn, "FaxSend", params, normalizeFaxResult);
}

// SIP Call
export function dispatchSipCall(
  ctx: ExecutionContext,
  localFn: () => Promise<any>,
  params: {
    target: string;
    port?: number;
    caller_id?: string;
    to_user?: string;
    domain?: string;
    duration_secs?: number;
    transport?: string;
    timeout_secs?: number;
    username?: string;
    password?: string;
  },
) {
  return dispatch(ctx, localFn, "SipCall", params, normalizeSipCallResult);
}

// Hangup Call (remote only -- sends HangupCall command)
export async function dispatchHangupCall(
  agentId: string,
  commandId: string,
) {
  const { sendCommand } = useRemoteAgentStore.getState();
  await sendCommand(agentId, "HangupCall", { command_id: commandId });
}

// ── Multicast ──────────────────────────────────────────────────

export function dispatchMulticastJoin(
  ctx: ExecutionContext,
  group: string,
  port: number,
  iface?: string,
) {
  return dispatch(
    ctx,
    () => multicastApi.multicastJoinGroup(group, port, iface),
    "MulticastJoin",
    { group, port, interface: iface },
    normalizeJoinResult,
  );
}

export function dispatchMulticastIgmpQuery(
  ctx: ExecutionContext,
  iface?: string,
) {
  return dispatch(
    ctx,
    () => multicastApi.multicastIgmpQuery(iface),
    "MulticastIgmpQuery",
    { interface: iface },
    normalizeIgmpQueryResult,
  );
}

export function dispatchMulticastSnoopingVerify(
  ctx: ExecutionContext,
  group: string,
  iface?: string,
) {
  return dispatch(
    ctx,
    () => multicastApi.multicastSnoopingVerify(group, iface),
    "MulticastSnoopingVerify",
    { group, interface: iface },
    normalizeSnoopingVerifyResult,
  );
}

export function dispatchMulticastSendTest(
  ctx: ExecutionContext,
  group: string,
  port: number,
  count: number,
  intervalMs: number,
  ttl?: number,
) {
  return dispatch(
    ctx,
    () => multicastApi.multicastSendTest(group, port, count, intervalMs, ttl),
    "MulticastSendTest",
    { group, port, count, interval_ms: intervalMs, ttl },
    normalizeSendTestResult,
  );
}

// ── DNS variants ────────────────────────────────────────────────

export function dispatchDnsSipResolve(
  ctx: ExecutionContext,
  domain: string,
  localFn: () => Promise<any>,
) {
  return dispatch(ctx, localFn, "DnsSipResolve", { domain }, normalizeDnsSipResolveResult);
}

export function dispatchDnsReverse(
  ctx: ExecutionContext,
  ip: string,
  localFn: () => Promise<any>,
) {
  return dispatch(ctx, localFn, "DnsReverse", { ip }, normalizeDnsReverseResult);
}

export function dispatchDnsDig(
  ctx: ExecutionContext,
  hostname: string,
  recordType: string,
  server: string | undefined,
  localFn: () => Promise<any>,
) {
  return dispatch(
    ctx, localFn, "DnsDig",
    { domain: hostname, record_type: recordType, ...(server ? { server } : {}) },
    normalizeDnsDigResult,
  );
}

export function dispatchDnsGeoIp(
  ctx: ExecutionContext,
  ip: string,
  localFn: () => Promise<any>,
) {
  return dispatch(ctx, localFn, "DnsGeoIp", { ips: [ip] }, normalizeDnsGeoIpResult);
}

// ── NTP ─────────────────────────────────────────────────────────

export function dispatchNtpCheck(
  ctx: ExecutionContext,
  servers: string[],
  localFn: () => Promise<any>,
  timeoutMs?: number,
) {
  return dispatch(
    ctx, localFn, "NtpCheck",
    { servers, timeout_ms: timeoutMs ?? 3000 },
    normalizeNtpCheckResult,
  );
}

// ── NAT Detect ──────────────────────────────────────────────────

export function dispatchNatDetect(
  ctx: ExecutionContext,
  localFn: () => Promise<any>,
  stunServer?: string,
) {
  return dispatch(
    ctx, localFn, "NatDetect",
    { stun_server: stunServer ?? "stun.l.google.com:19302" },
    normalizeNatDetectResult,
  );
}

// ── SNMP ────────────────────────────────────────────────────────

export function dispatchSnmpPoll(
  ctx: ExecutionContext,
  localFn: () => Promise<any>,
  params: {
    host: string;
    oids?: string[];
    community?: string;
    version?: number;
    v3Username?: string;
    v3AuthPassword?: string;
    v3PrivPassword?: string;
    v3SecurityLevel?: "noAuthNoPriv" | "authNoPriv" | "authPriv";
    v3AuthProtocol?: "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512";
    v3PrivacyProtocol?: "des" | "aes128" | "aes192" | "aes256";
  },
) {
  return dispatch(
    ctx, localFn, "SnmpPoll",
    {
      host: params.host,
      ...(params.oids && params.oids.length > 0 ? { oids: params.oids } : {}),
      community: params.community ?? "public",
      version: params.version ?? 2,
      ...(params.v3Username ? { v3_username: params.v3Username } : {}),
      ...(params.v3AuthPassword ? { v3_auth_password: params.v3AuthPassword } : {}),
      ...(params.v3PrivPassword ? { v3_priv_password: params.v3PrivPassword } : {}),
      ...(params.v3SecurityLevel ? { v3_security_level: params.v3SecurityLevel } : {}),
      ...(params.v3AuthProtocol ? { v3_auth_protocol: params.v3AuthProtocol } : {}),
      ...(params.v3PrivacyProtocol ? { v3_privacy_protocol: params.v3PrivacyProtocol } : {}),
    },
    normalizeSnmpPollResult,
  );
}

// ── MTR (streaming - uses dispatch for final result) ────────────

export function dispatchMtr(
  ctx: ExecutionContext,
  host: string,
  localFn: () => Promise<any>,
  maxHops?: number,
  rounds?: number,
) {
  return dispatch(
    ctx, localFn, "Mtr",
    { host, max_hops: maxHops ?? 30, rounds: rounds ?? 20 },
    normalizeMtrResult,
  );
}

// ── Device Control ──────────────────────────────────────────────

export function dispatchDeviceControl(
  ctx: ExecutionContext,
  localFn: () => Promise<any>,
  params: Record<string, unknown>,
) {
  return dispatch(ctx, localFn, "DeviceControl", params, normalizeDeviceControlResult);
}

// ── Capture Permissions ─────────────────────────────────────────

export function dispatchProbeCapturePerm(
  ctx: ExecutionContext,
  localFn: () => Promise<any>,
) {
  return dispatch(ctx, localFn, "ProbeCapturePerm", {}, normalizeCapturePermResult);
}

export function dispatchRequestCapturePerm(
  ctx: ExecutionContext,
  localFn: () => Promise<any>,
) {
  return dispatch(ctx, localFn, "RequestCapturePerm", {}, normalizeCapturePermResult);
}

// ── SIP Probe ───────────────────────────────────────────────────

export function dispatchSipProbe(
  ctx: ExecutionContext,
  host: string,
  port?: number,
  method?: string,
) {
  return dispatch(
    ctx,
    () => netApi.networkSipProbe(host, port),
    "SipProbe",
    {
      target: host,
      port: port ?? 5060,
      transport: "udp",
      method: method ?? "OPTIONS",
    },
    normalizeSipProbeResult,
  );
}

// ── STUN ────────────────────────────────────────────────────────

export function dispatchStunTest(
  ctx: ExecutionContext,
  stunServer?: string,
) {
  return dispatch(
    ctx,
    () => netApi.networkStunTest(stunServer),
    "StunTest",
    { server: stunServer ?? "stun.l.google.com:19302" },
    normalizeStunResult,
  );
}

// ── Provision ───────────────────────────────────────────────────

export function dispatchFetchProvision(
  ctx: ExecutionContext,
  providerUrl: string,
  mac: string,
  model: string,
  options?: { includeMacInUa?: boolean; vendor?: string; userAgent?: string },
) {
  return dispatch(
    ctx,
    () => fetchProvisionFile(providerUrl, mac, model, options),
    "FetchProvision",
    {
      provider_url: providerUrl,
      mac,
      model,
      ...(options?.includeMacInUa !== undefined ? { include_mac_in_ua: options.includeMacInUa } : {}),
      ...(options?.vendor ? { vendor: options.vendor } : {}),
      ...(options?.userAgent?.trim() ? { user_agent: options.userAgent.trim() } : {}),
    },
    normalizeFetchProvisionResult,
  );
}
