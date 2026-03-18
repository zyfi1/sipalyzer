import type { DiagnosticsExplanation, DiagnosticsFinding } from "@/types/diagnostics";

const IMPERATIVE_PATTERNS = [
  /\breboot\b/i,
  /\brestart\b/i,
  /\bfix\b/i,
  /\bmust\b/i,
  /\bshould\b/i,
  /\bchange\b/i,
  /\bset\b/i,
];

function sanitizeNonPrescriptive(text: string): string {
  let next = text.trim();
  for (const pattern of IMPERATIVE_PATTERNS) {
    if (pattern.test(next)) {
      next = next
        .replace(/\bmust\b/gi, "can")
        .replace(/\bshould\b/gi, "may")
        .replace(/\bfix\b/gi, "investigate")
        .replace(/\bset\b/gi, "review")
        .replace(/\breboot\b/gi, "review device restart history")
        .replace(/\brestart\b/gi, "review restart history")
        .replace(/\bchange\b/gi, "compare");
    }
  }
  return next;
}

function buildImpact(finding: DiagnosticsFinding): string {
  switch (finding.category) {
    case "signaling":
      return "Call setup reliability may be reduced during this interval.";
    case "media":
      return "Audio quality may be degraded or inconsistent.";
    case "network":
      return "Network path quality may be affecting call behavior.";
    case "fax":
      return "Fax delivery reliability may be reduced for affected calls.";
    case "security":
      return "Authentication or policy behavior may interrupt expected call flow.";
    case "performance":
      return "Service responsiveness may be degraded under current conditions.";
    default:
      return "Call experience may be affected for impacted sessions.";
  }
}

function buildWhy(finding: DiagnosticsFinding): string {
  if (finding.evidence.length === 0) {
    return "This finding is based on deterministic rule matching over captured signaling and media data.";
  }
  const prioritized = [
    ...finding.evidence.filter((e) => e.type === "metric"),
    ...finding.evidence.filter((e) => e.type !== "metric"),
  ];
  const topEvidence = prioritized
    .slice(0, 3)
    .map((e) => `${e.label}: ${e.value}`)
    .join("; ");
  return `Matched evidence includes ${topEvidence}.`;
}

function buildFurtherChecks(finding: DiagnosticsFinding): string[] | undefined {
  if (finding.severity === "info") return undefined;
  if (finding.category === "media") {
    return [
      "You can compare uplink and downlink quality trends for asymmetry.",
      "You may compare this stream against neighboring calls in the same session window.",
    ];
  }
  if (finding.category === "signaling") {
    return [
      "You can compare final SIP response patterns across nearby dialogs.",
      "You may review whether the same response pattern appears across registrars.",
    ];
  }
  return ["You can compare this pattern across adjacent calls in the same timeframe."];
}

export function explainDiagnosticsFinding(finding: DiagnosticsFinding): DiagnosticsExplanation {
  const summary = sanitizeNonPrescriptive(finding.description || finding.title);
  const impact = sanitizeNonPrescriptive(buildImpact(finding));
  const why = sanitizeNonPrescriptive(buildWhy(finding));
  const furtherChecks = buildFurtherChecks(finding)?.map(sanitizeNonPrescriptive);
  return { summary, impact, why, furtherChecks };
}

