import { describe, expect, it } from "vitest";
import { mergeExpertFindingsLayers } from "@/lib/diagnostics/captureAnalysisPipeline";
import type { ExpertFinding } from "@/types/packetCapture";

function f(partial: Partial<ExpertFinding> & Pick<ExpertFinding, "ruleId" | "title" | "severity">): ExpertFinding {
  return {
    id: partial.id ?? "id-1",
    ruleId: partial.ruleId,
    severity: partial.severity,
    category: partial.category ?? "signaling",
    title: partial.title,
    description: partial.description ?? "",
    evidence: partial.evidence ?? [],
    count: partial.count ?? 1,
    firstSeen: partial.firstSeen ?? "2026-01-01T00:00:00.000Z",
    lastSeen: partial.lastSeen ?? "2026-01-01T00:00:00.000Z",
    relatedCallId: partial.relatedCallId,
    confidenceScore: partial.confidenceScore,
  };
}

describe("mergeExpertFindingsLayers", () => {
  it("dedupes same ruleId+title+callId keeping stricter severity", () => {
    const a = [
      f({
        ruleId: "sip_invite_no_final_response",
        title: "No final response",
        severity: "warning",
        relatedCallId: "abc",
      }),
    ];
    const b = [
      f({
        ruleId: "sip_invite_no_final_response",
        title: "No final response",
        severity: "critical",
        relatedCallId: "abc",
      }),
    ];
    const out = mergeExpertFindingsLayers([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("critical");
  });

  it("keeps distinct call ids", () => {
    const a = [f({ ruleId: "r1", title: "T", severity: "info", relatedCallId: "c1" })];
    const b = [f({ ruleId: "r1", title: "T", severity: "info", relatedCallId: "c2" })];
    const out = mergeExpertFindingsLayers([a, b]);
    expect(out).toHaveLength(2);
  });

  it("sorts critical before info", () => {
    const out = mergeExpertFindingsLayers([
      [f({ ruleId: "a", title: "A", severity: "info" })],
      [f({ ruleId: "b", title: "B", severity: "critical" })],
    ]);
    expect(out[0]?.severity).toBe("critical");
    expect(out[1]?.severity).toBe("info");
  });
});
