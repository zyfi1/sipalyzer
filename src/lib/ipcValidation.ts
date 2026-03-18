import { tauriInvokePayloadSchemas } from "@/contracts/tauriInvokeSchemas";

export function formatIpcIssues(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

export function validateIpcPayload(command: string, payload: Record<string, unknown>): void {
  const schema = tauriInvokePayloadSchemas[command];
  if (!schema) return;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid payload for "${command}": ${formatIpcIssues(parsed.error.message)}`);
  }
}
