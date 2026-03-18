import type { ExpertFinding, FindingEvidence } from "@/types/packetCapture";
import type { DiagnosticsFindingWithExplanation } from "@/lib/diagnostics/engine";

function toEvidence(e: DiagnosticsFindingWithExplanation["evidence"][number]): FindingEvidence {
  const evidenceType: FindingEvidence["evidenceType"] =
    e.type === "packet"
      ? "packet"
      : e.type === "sip_dialog"
        ? "sipDialog"
        : e.type === "rtp_stream"
          ? "rtpStream"
          : e.type === "timestamp"
            ? "timestamp"
            : "value";
  return {
    evidenceType,
    label: e.label,
    value: e.value,
    packetIndices: e.packetIndices ?? [],
  };
}

export function diagnosticsFindingToExpertFinding(finding: DiagnosticsFindingWithExplanation): ExpertFinding {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    description: finding.description,
    detail: undefined,
    evidence: finding.evidence.map(toEvidence),
    articleId: undefined,
    relatedCallId: finding.relatedCallId,
    count: 1,
    firstSeen: finding.firstSeen,
    lastSeen: finding.lastSeen,
    explanationSummary: finding.explanation.summary,
    explanationImpact: finding.explanation.impact,
    explanationWhy: finding.explanation.why,
    furtherChecks: finding.explanation.furtherChecks,
    confidenceScore: finding.confidenceScore,
    domain: finding.domain,
  };
}

