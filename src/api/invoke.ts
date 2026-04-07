/**
 * Central Tauri invoke wrapper with error normalization.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { extractErrorMessage, formatHumanizedError } from "@/lib/errorUtils";
import { tauriInvokeResponseSchemas } from "@/contracts/tauriInvokeSchemas";
import { formatIpcIssues, validateIpcPayload } from "@/lib/ipcValidation";
import type { ZodType } from "zod";

const SKIP_AUDIT_COMMANDS = new Set([
  // Avoid recursive/self-noise audit calls
  "admin_audit_write",
  "admin_audit_query",
  "admin_audit_verify_chain",
  "admin_audit_stats",
  "admin_audit_categories",
  "admin_audit_actions",
  "admin_clear_events",
]);

function auditCategoryForCommand(cmd: string): string {
  if (cmd.startsWith("remote_agent_") || cmd.startsWith("remote_shell_")) {
    return "agent";
  }
  if (cmd.startsWith("fax_")) return "fax";
  if (cmd.startsWith("notes_")) return "notes";
  if (cmd.startsWith("packet_") || cmd.includes("capture")) return "capture";
  if (cmd.startsWith("softphone_")) return "softphone";
  if (cmd.startsWith("admin_")) return "admin";
  if (cmd.startsWith("registration_")) return "registration";
  if (cmd.startsWith("set_") || cmd.startsWith("get_") || cmd.includes("config")) return "settings";
  return "system";
}

async function writeAuditInvokeEvent(
  cmd: string,
  ok: boolean,
  startedAtMs: number,
  message?: string,
): Promise<void> {
  if (SKIP_AUDIT_COMMANDS.has(cmd)) return;
  const durationMs = Math.max(0, Math.round(performance.now() - startedAtMs));
  const sanitizedCmd = cmd.replace(/[^\w:-]/g, "").slice(0, 128);
  const sanitizedError =
    message
      ?.replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240) || "unknown";
  const detail = ok
    ? JSON.stringify({ source: "frontend_invoke", durationMs })
    : JSON.stringify({ source: "frontend_invoke", durationMs, error: sanitizedError });
  try {
    await tauriInvoke("admin_audit_write", {
      category: auditCategoryForCommand(cmd),
      action: ok ? "command_invoked" : "command_failed",
      actor: "user",
      target: sanitizedCmd,
      detail,
    });
  } catch {
    // Never block normal command execution on audit-write failures.
  }
}

export interface InvokeTauriOptions<T> {
  responseSchema?: ZodType<T>;
  schemaName?: string;
}

function summarizeSchemaIssues(message: string): string {
  const compact = formatIpcIssues(message);
  return compact.length > 280 ? `${compact.slice(0, 280)}...` : compact;
}

function validateInvokeResponse<T>(
  cmd: string,
  value: unknown,
  options?: InvokeTauriOptions<T>,
): T {
  const responseSchema =
    options?.responseSchema ??
    (tauriInvokeResponseSchemas[cmd] as ZodType<T> | undefined);
  if (!responseSchema) {
    return value as T;
  }
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) {
    const schemaName = options?.schemaName ?? `tauri:${cmd}`;
    const schemaLabel = schemaName ? ` (${schemaName})` : "";
    const detail = summarizeSchemaIssues(parsed.error.message);
    throw new Error(`IPC response validation failed for "${cmd}"${schemaLabel}: ${detail}`);
  }
  return parsed.data;
}

export async function invokeTauri<T>(
  cmd: string,
  payload?: Record<string, unknown>,
  options?: InvokeTauriOptions<T>,
): Promise<T> {
  const startedAtMs = performance.now();
  try {
    const payloadWithDefault = payload ?? {};
    validateIpcPayload(cmd, payloadWithDefault);
    const result = await tauriInvoke<unknown>(cmd, payloadWithDefault);
    const validatedResult = validateInvokeResponse(cmd, result, options);
    void writeAuditInvokeEvent(cmd, true, startedAtMs);
    return validatedResult;
  } catch (e) {
    const message = extractErrorMessage(e);
    void writeAuditInvokeEvent(cmd, false, startedAtMs, message);
    throw new Error(formatHumanizedError(message));
  }
}
