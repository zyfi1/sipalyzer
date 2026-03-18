import { getCaptureSession, getRtpStreams, getSipDialogs } from "@/api/packetCapture";
import { diagnosticsFindingToExpertFinding } from "@/lib/diagnostics/adapter";
import { buildDiagnosticsReport } from "@/lib/diagnostics/engine";
import type { ExpertFinding } from "@/types/packetCapture";

export async function getAnalysisDiagnostics(sessionId: string): Promise<ExpertFinding[]> {
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

