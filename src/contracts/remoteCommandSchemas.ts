import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const remoteCommandParamsSchemas = {
  Ping: z.object({ host: nonEmptyString, count: z.number(), timeout_ms: z.number() }),
  Traceroute: z.object({ host: nonEmptyString, max_hops: z.number(), timeout_ms: z.number() }),
  DnsLookup: z.object({ hostname: nonEmptyString, record_type: nonEmptyString }),
  PortScan: z.object({ host: nonEmptyString, ports: nonEmptyString, timeout_ms: z.number() }),
  DeviceScan: z.object({ network: z.string().optional(), banner_grab: z.boolean() }),
  SipRegistrationTest: z.object({
    registrar: nonEmptyString,
    username: nonEmptyString,
    password: z.string(),
    port: z.number(),
    transport: nonEmptyString,
    domain: z.string().optional(),
    expires: z.number().optional(),
    timeout_secs: z.number().optional(),
    unregister: z.boolean().optional(),
  }),
  FaxSend: z.object({
    target: nonEmptyString,
    fax_number: z.string().optional(),
    port: z.number().optional(),
    caller_id: z.string().optional(),
    station_id: z.string().optional(),
    domain: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    transport: z.string().optional(),
    timeout_secs: z.number().optional(),
    baud_rate: z.number().optional(),
    ecm: z.boolean().optional(),
    resolution: z.string().optional(),
    header_line: z.string().optional(),
  }),
  SipCall: z.object({
    target: nonEmptyString,
    port: z.number().optional(),
    caller_id: z.string().optional(),
    to_user: z.string().optional(),
    domain: z.string().optional(),
    duration_secs: z.number().optional(),
    transport: z.string().optional(),
    timeout_secs: z.number().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  }),
  HangupCall: z.object({ command_id: nonEmptyString }),
  MulticastJoin: z.object({ group: nonEmptyString, port: z.number(), interface: z.string().optional() }),
  MulticastIgmpQuery: z.object({ interface: z.string().optional() }),
  MulticastSnoopingVerify: z.object({ group: nonEmptyString, interface: z.string().optional() }),
  MulticastSendTest: z.object({
    group: nonEmptyString,
    port: z.number(),
    count: z.number(),
    interval_ms: z.number(),
    ttl: z.number().optional(),
  }),
  DnsSipResolve: z.object({ domain: nonEmptyString }),
  DnsReverse: z.object({ ip: nonEmptyString }),
  DnsDig: z.object({ domain: nonEmptyString, record_type: nonEmptyString, server: z.string().optional() }),
  DnsGeoIp: z.object({ ips: z.array(nonEmptyString) }),
  NtpCheck: z.object({ servers: z.array(nonEmptyString), timeout_ms: z.number() }),
  NatDetect: z.object({ stun_server: nonEmptyString }),
  SnmpPoll: z.object({
    host: nonEmptyString,
    oids: z.array(nonEmptyString).optional(),
    community: nonEmptyString,
    version: z.number(),
    v3_username: z.string().optional(),
    v3_auth_password: z.string().optional(),
    v3_priv_password: z.string().optional(),
    v3_security_level: z.enum(["noAuthNoPriv", "authNoPriv", "authPriv"]).optional(),
    v3_auth_protocol: z.enum(["md5", "sha1", "sha224", "sha256", "sha384", "sha512"]).optional(),
    v3_privacy_protocol: z.enum(["des", "aes128", "aes192", "aes256"]).optional(),
  }),
  Mtr: z.object({ host: nonEmptyString, max_hops: z.number(), rounds: z.number() }),
  DeviceControl: z.record(z.string(), z.unknown()),
  ProbeCapturePerm: z.record(z.string(), z.never()),
  RequestCapturePerm: z.record(z.string(), z.never()),
  SipProbe: z.object({
    target: nonEmptyString,
    port: z.number(),
    transport: nonEmptyString,
    method: nonEmptyString,
  }),
  StunTest: z.object({ server: nonEmptyString }),
  FetchProvision: z.object({
    provider_url: nonEmptyString,
    mac: nonEmptyString,
    model: nonEmptyString,
    include_mac_in_ua: z.boolean().optional(),
    vendor: z.string().optional(),
    user_agent: z.string().optional(),
  }),
  ChatMessage: z.object({
    text: nonEmptyString,
    sender: z.string().optional(),
  }),
} as const;

export type RemoteCommandNameFromSchema = keyof typeof remoteCommandParamsSchemas;

export type RemoteCommandParamsByName = {
  [K in RemoteCommandNameFromSchema]: z.infer<(typeof remoteCommandParamsSchemas)[K]>;
};

export const genericRemoteCommandSchema = z.object({
  command: nonEmptyString,
  params: z.record(z.string(), z.unknown()).optional(),
});

export function validateRemoteCommandPayload(
  payload: unknown,
): { command: string; params?: Record<string, unknown> } {
  const parsed = genericRemoteCommandSchema.parse(payload);
  const paramsSchema = remoteCommandParamsSchemas[parsed.command as RemoteCommandNameFromSchema];
  if (paramsSchema) {
    const safeParams = paramsSchema.parse(parsed.params ?? {}) as Record<string, unknown>;
    return {
      command: parsed.command,
      ...(Object.keys(safeParams).length > 0 ? { params: safeParams as Record<string, unknown> } : {}),
    };
  }
  return parsed;
}
