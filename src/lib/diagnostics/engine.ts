import type { DiagnosticsFinding, DiagnosticsInput, DiagnosticsReport } from "@/types/diagnostics";
import { explainDiagnosticsFinding } from "@/lib/diagnostics/explainer";
import { runDomainAnalyzers } from "@/lib/diagnostics/analyzers";

export interface DiagnosticsFindingWithExplanation extends DiagnosticsFinding {
  explanation: ReturnType<typeof explainDiagnosticsFinding>;
}

export interface DiagnosticsReportWithExplanation extends Omit<DiagnosticsReport, "findings"> {
  findings: DiagnosticsFindingWithExplanation[];
}

function sortFindings(findings: DiagnosticsFinding[]): DiagnosticsFinding[] {
  const sevWeight: Record<DiagnosticsFinding["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return [...findings].sort((a, b) => {
    const bySeverity = sevWeight[a.severity] - sevWeight[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.confidenceScore - a.confidenceScore;
  });
}

export function buildDiagnosticsReport(input: DiagnosticsInput): DiagnosticsReportWithExplanation {
  const stableNow = input.session.startTime || "1970-01-01T00:00:00.000Z";
  const findings = sortFindings(runDomainAnalyzers(input)).map((finding) => ({
    ...finding,
    firstSeen: finding.firstSeen || stableNow,
    lastSeen: finding.lastSeen || stableNow,
    explanation: explainDiagnosticsFinding(finding),
  }));
  return {
    sessionId: input.session.id,
    generatedAt: stableNow,
    findings,
  };
}

