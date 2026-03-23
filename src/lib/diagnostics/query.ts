import type { ExpertFinding } from "@/types/packetCapture";
import {
  getAnalysisDiagnosticsWithMeta,
  type CaptureDiagnosticsRunMeta,
} from "@/lib/diagnostics/captureAnalysisPipeline";

export type { CaptureDiagnosticsRunMeta };

/** Merged TS + Rust capture diagnostics (see `captureAnalysisPipeline.ts`). */
export async function getAnalysisDiagnostics(sessionId: string): Promise<ExpertFinding[]> {
  const { findings } = await getAnalysisDiagnosticsWithMeta(sessionId);
  return findings;
}

/** Same as {@link getAnalysisDiagnostics} plus per-engine counts and partial-run errors. */
export async function getAnalysisDiagnosticsDetailed(
  sessionId: string,
): Promise<{ findings: ExpertFinding[]; meta: CaptureDiagnosticsRunMeta }> {
  return getAnalysisDiagnosticsWithMeta(sessionId);
}

