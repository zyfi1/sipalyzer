import { z } from "zod";
import type { RemoteCommandName } from "@/types/remoteCommandContract";

const remoteReplyTypeSchema = z.enum([
  "Heartbeat",
  "Result",
  "Error",
  "Progress",
  "StreamData",
  "ChatMessage",
]);

export const remoteAgentReplyEnvelopeSchema = z.object({
  id: z.string().min(1),
  response: z.object({
    type: remoteReplyTypeSchema,
    data: z.unknown().optional(),
  }),
});

export const remoteErrorDataSchema = z
  .object({
    message: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();

export const remoteProgressDataSchema = z
  .object({
    progress: z.number().optional(),
    partial: z.unknown().optional(),
  })
  .passthrough();

export const remoteStreamDataSchema = z
  .object({
    data: z.string().optional(),
    packet_info: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const remoteResultEnvelopeSchema = z
  .object({
    success: z.boolean().optional(),
    result: z.unknown().optional(),
    elapsed_ms: z.number().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const remoteChatDataSchema = z
  .object({
    text: z.string(),
    sender: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

function compactSchemaError(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function hasEnvelopeShape(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return "success" in value || "result" in value || "elapsed_ms" in value || "error" in value;
}

export type UnwrappedRemoteEnvelope =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export function unwrapRemoteResultEnvelope(value: unknown): UnwrappedRemoteEnvelope {
  if (!hasEnvelopeShape(value)) {
    return { ok: true, result: value };
  }

  const parsed = remoteResultEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid remote result envelope: ${compactSchemaError(parsed.error.message)}`,
    };
  }

  const envelope = parsed.data;
  if (envelope.success === false) {
    return { ok: false, error: envelope.error || "Remote command failed" };
  }

  return {
    ok: true,
    result: envelope.result !== undefined ? envelope.result : envelope,
  };
}

const capturePermSchema = z.object({
  available: z.boolean(),
  method: z.string().optional(),
  detail: z.string().optional(),
});

const fetchProvisionSchema = z.object({
  raw: z.string().optional(),
  parsed: z.unknown().nullable().optional(),
  request_info: z
    .object({
      final_url: z.string(),
      user_agent: z.string(),
      mac_used: z.string(),
      status: z.number(),
    })
    .optional(),
  parseable: z.boolean().optional(),
});

const natDetectResultSchema = z
  .object({
    nat_type: z.string().optional(),
    mapped_ip: z.string().optional(),
    mapped_port: z.number().optional(),
    local_ip: z.string().optional(),
    local_port: z.number().optional(),
    hairpin_supported: z.boolean().optional(),
    alg_detected: z.boolean().optional(),
    modified_headers: z.array(z.string()).optional(),
    udp_timeout_secs: z.number().optional(),
    elapsed_ms: z.number().optional(),

    // Legacy aliases we still accept for backwards compatibility.
    external_ip: z.string().optional(),
    external_port: z.number().optional(),
    public_ip: z.string().optional(),
    public_port: z.number().optional(),
    internal_ip: z.string().optional(),
    internal_port: z.number().optional(),
    private_ip: z.string().optional(),
    private_port: z.number().optional(),
    hairpin: z.boolean().optional(),
    sip_alg_detected: z.boolean().optional(),
    udp_timeout: z.number().optional(),
    response_ms: z.number().optional(),
    mapping_behavior: z.string().optional(),
    filtering_behavior: z.string().optional(),
    nat_mapping_behavior: z.string().optional(),
    nat_filtering_behavior: z.string().optional(),
    mapping: z.string().optional(),
    filtering: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const hasNatSignal =
      value.nat_type !== undefined ||
      value.mapped_ip !== undefined ||
      value.external_ip !== undefined ||
      value.public_ip !== undefined ||
      value.local_ip !== undefined ||
      value.internal_ip !== undefined ||
      value.private_ip !== undefined ||
      value.alg_detected !== undefined ||
      value.sip_alg_detected !== undefined ||
      value.mapping_behavior !== undefined ||
      value.nat_mapping_behavior !== undefined ||
      value.filtering_behavior !== undefined ||
      value.nat_filtering_behavior !== undefined;

    if (!hasNatSignal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NatDetect result missing NAT fields",
      });
    }
  });

export const remoteCommandResultSchemas: Partial<Record<RemoteCommandName, z.ZodTypeAny>> = {
  NatDetect: natDetectResultSchema,
  ProbeCapturePerm: capturePermSchema,
  RequestCapturePerm: capturePermSchema,
  FetchProvision: fetchProvisionSchema,
};
