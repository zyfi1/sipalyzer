import type { SipDialog } from "@/types/forensics";

export type DialogStatus = "success" | "error" | "warning" | "ringing" | "unknown";

function responseCode(methodOrCode: string): number | null {
  const match = methodOrCode.trim().match(/^(\d{3})/);
  const code = match?.[1];
  return code ? parseInt(code, 10) : null;
}

export function getDialogStatus(d: SipDialog): DialogStatus {
  const codes = d.messages
    .map((m) => responseCode(m.methodOrCode))
    .filter((c): c is number => c != null);

  const hasAck = d.messages.some((m) => m.methodOrCode.trim().toUpperCase() === "ACK");
  const hasBye = d.messages.some((m) => m.methodOrCode.trim().toUpperCase() === "BYE");
  const has1xx = codes.some((c) => c >= 100 && c < 200);
  const has200 = codes.includes(200);
  const has3xx = codes.some((c) => c >= 300 && c < 400);
  const has4xx = codes.some((c) => c >= 400 && c < 500);
  const has5xxOr6xx = codes.some((c) => c >= 500);
  const hasNonAuth4xx = codes.some((c) => c >= 400 && c < 500 && c !== 401 && c !== 407);

  if (has5xxOr6xx) return "error";
  if (has200) {
    // Auth challenges (401/407) followed by 200 are expected success flows.
    if (!hasNonAuth4xx && !has3xx) return "success";
    return "warning";
  }
  if (hasNonAuth4xx || has4xx) return "error";
  if (has3xx) return "warning";
  if (hasAck) return "success";

  // Completed call with duration -> established and ran; treat as success.
  const start = d.startTime ? new Date(d.startTime).getTime() : NaN;
  const end = d.endTime ? new Date(d.endTime).getTime() : null;
  const lastTs =
    d.messages.length > 0 ? new Date(d.messages[d.messages.length - 1]!.timestamp).getTime() : null;
  const endMs = end ?? lastTs ?? start;
  const durationMs = !Number.isNaN(start) && endMs && endMs > start ? endMs - start : 0;
  if (durationMs > 0 && hasBye) return "success";

  if (has1xx) return "ringing";
  return "unknown";
}

