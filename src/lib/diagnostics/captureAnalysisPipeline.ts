/**
 * Unified packet-capture diagnostics pipeline.
 *
 * Merges:
 * - **TypeScript layer** — dialog/RTP-oriented rules (`buildDiagnosticsReport` / `runDomainAnalyzers`)
 * - **Rust layer** — packet-oriented expert rules (`get_expert_findings` / `expert_analyzer`)
 *
 * Resilience: parallel fetch with `Promise.allSettled`, per-layer retries for IPC, partial results
 * if one engine fails. Findings are merged, deduplicated by (ruleId + title + relatedCallId), then
 * sorted by severity.
 */

import {
  getCaptureSession,
  getExpertFindings,
  getRtpStreams,
  getSipDialogs,
} from "@/api/packetCapture";
import { diagnosticsFindingToExpertFinding } from "@/lib/diagnostics/adapter";
import { buildDiagnosticsReport } from "@/lib/diagnostics/engine";
import type { ExpertFinding } from "@/types/packetCapture";

export interface CaptureDiagnosticsRunMeta {
  tsFindingsCount: number;
  rustFindingsCount: number;
  errors: Array<{ source: "typescript" | "rust"; message: string }>;
  /** True if at least one engine failed (other may still have produced findings). */
  partial: boolean;
}

const SEVERITY_RANK: Record<ExpertFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function severityCmp(a: ExpertFinding, b: ExpertFinding): number {
  const dr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (dr !== 0) return dr;
  const ac = a.confidenceScore ?? 0;
  const bc = b.confidenceScore ?? 0;
  if (bc !== ac) return bc - ac;
  return (a.firstSeen || "").localeCompare(b.firstSeen || "");
}

/**
 * Merge findings from multiple engines. Drops near-duplicates (same rule + same title + same call).
 */
export function mergeExpertFindingsLayers(layers: ExpertFinding[][]): ExpertFinding[] {
  const keyOf = (f: ExpertFinding) =>
    `${f.ruleId}\0${f.title.trim().toLowerCase()}\0${f.relatedCallId ?? ""}`;

  const byKey = new Map<string, ExpertFinding>();
  for (const layer of layers) {
    for (const f of layer) {
      const key = keyOf(f);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, f);
        continue;
      }
      // Keep the higher-severity / higher-confidence duplicate
      const merged = [existing, f].sort(severityCmp)[0];
      byKey.set(key, merged ?? f);
    }
  }
  return [...byKey.values()].sort(severityCmp);
}

export async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number } = { retries: 2, baseDelayMs: 280 },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === opts.retries) break;
      const delay = opts.baseDelayMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label}: ${String(lastErr)}`);
}

async function loadTypescriptFindings(sessionId: string): Promise<ExpertFinding[]> {
  const [session, dialogs, rtpStreams] = await Promise.all([
    getCaptureSession(sessionId),
    getSipDialogs(sessionId),
    getRtpStreams(sessionId),
  ]);
  const report = buildDiagnosticsReport({
    session,
    dialogs: dialogs ?? [],
    rtpStreams: rtpStreams ?? [],
  });
  return report.findings.map(diagnosticsFindingToExpertFinding);
}

async function loadRustFindings(sessionId: string): Promise<ExpertFinding[]> {
  return withRetries("getExpertFindings", () => getExpertFindings(sessionId));
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Full capture analysis: TS + Rust expert engines, merged. Does not throw if one side fails.
 */
export async function getAnalysisDiagnosticsWithMeta(
  sessionId: string,
): Promise<{ findings: ExpertFinding[]; meta: CaptureDiagnosticsRunMeta }> {
  const meta: CaptureDiagnosticsRunMeta = {
    tsFindingsCount: 0,
    rustFindingsCount: 0,
    errors: [],
    partial: false,
  };

  const [tsSettled, rustSettled] = await Promise.allSettled([
    loadTypescriptFindings(sessionId),
    loadRustFindings(sessionId),
  ]);

  const layers: ExpertFinding[][] = [];

  if (tsSettled.status === "fulfilled") {
    layers.push(tsSettled.value);
    meta.tsFindingsCount = tsSettled.value.length;
  } else {
    meta.errors.push({ source: "typescript", message: errMessage(tsSettled.reason) });
    meta.partial = true;
  }

  if (rustSettled.status === "fulfilled") {
    layers.push(rustSettled.value);
    meta.rustFindingsCount = rustSettled.value.length;
  } else {
    meta.errors.push({ source: "rust", message: errMessage(rustSettled.reason) });
    meta.partial = true;
  }

  if (layers.length === 0) {
    const err = new Error(
      meta.errors.map((e) => `${e.source}: ${e.message}`).join("; ") || "No diagnostics available",
    );
    throw err;
  }

  const findings = mergeExpertFindingsLayers(layers);
  return { findings, meta };
}
