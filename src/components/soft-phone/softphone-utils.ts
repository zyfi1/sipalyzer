import { formatTime } from "@/lib/dateTime";

export const METRICS_HISTORY_MAX = 60;

export function formatOffsetTime(start?: string, offsetMs?: number) {
  if (!start) return "—";
  try {
    const base = new Date(start).getTime();
    const next = base + (offsetMs ?? 0);
    return formatTime(new Date(next).toISOString());
  } catch {
    return "—";
  }
}

export function formatOffsetTimeISO(start?: string, offsetMs?: number): string | undefined {
  if (!start) return undefined;
  try {
    const base = new Date(start).getTime();
    if (Number.isNaN(base)) return undefined;
    return new Date(base + (offsetMs ?? 0)).toISOString();
  } catch {
    return undefined;
  }
}

/** Format call duration from start/end timestamps (e.g. "0:45", "2m 34s"). */
export function formatCallDuration(start?: string, end?: string): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const totalMs = Math.max(0, endMs - startMs);
  return formatDurationMs(totalMs);
}

/** Format duration in ms to "45s" or "2m 30s". */
export function formatDurationMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  if (min >= 1) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

export function getSipStartLine(message?: string) {
  if (!message) return null;
  const line = message.split(/\r?\n/)[0]?.trim();
  return line || null;
}

/** Short method name for ladder display (e.g. "INVITE sip:... SIP/2.0" → "INVITE"). */
export function getSipMethodShort(line: string | null | undefined): string {
  if (!line?.trim()) return "INVITE";
  const method = line.trim().split(/\s+/)[0];
  return method || "INVITE";
}

export function getSipCSeq(message?: string) {
  if (!message) return null;
  const line = message
    .split(/\r?\n/)
    .find((l) => l.toLowerCase().startsWith("cseq:"));
  if (!line) return null;
  const parts = line.split(":")[1]?.trim().split(/\s+/);
  return parts?.[0] ?? null;
}

/** Extract host:port for display from SIP URI (e.g. sip:user@host:5060 or <sip:...>) */
export function sipUriToHostPort(uri: string | null | undefined): string {
  if (!uri || !uri.trim()) return "—";
  const raw = uri.trim().replace(/^<|>$/g, "");
  const match = raw.match(/sip:(?:[^@]+@)?([^;>\s]+)(?::(\d+))?/i);
  if (!match) return uri.includes("@") ? uri.split("@")[1]?.split(";")[0] ?? "—" : "—";
  const host = match[1] ?? "";
  const port = match[2];
  return port ? `${host}:${port}` : host;
}
