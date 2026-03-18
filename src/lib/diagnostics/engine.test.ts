import { describe, expect, it } from "vitest";
import { buildDiagnosticsReport } from "@/lib/diagnostics/engine";
import type { SipDialog } from "@/types/forensics";
import type { CaptureSession, RtpStreamInfo } from "@/types/packetCapture";

function makeDialog(code: string, callId = "call-1"): SipDialog {
  return {
    callId,
    startTime: "2026-03-10T10:00:00.000Z",
    endTime: "2026-03-10T10:01:00.000Z",
    messages: [
      { methodOrCode: "INVITE", timestamp: "2026-03-10T10:00:01.000Z", packetIndex: 100 },
      { methodOrCode: code, timestamp: "2026-03-10T10:00:03.000Z", packetIndex: 101 },
    ],
  };
}

function makeDialogWithMethods(methods: string[], callId = "call-methods"): SipDialog {
  return {
    callId,
    startTime: "2026-03-10T10:00:00.000Z",
    endTime: "2026-03-10T10:01:00.000Z",
    messages: methods.map((methodOrCode, i) => ({
      methodOrCode,
      timestamp: `2026-03-10T10:00:${String(i + 1).padStart(2, "0")}.000Z`,
      packetIndex: 200 + i,
    })),
  };
}

function makeDialogWithBranching(callId = "branching"): SipDialog {
  return {
    callId,
    startTime: "2026-03-10T10:00:00.000Z",
    endTime: "2026-03-10T10:01:00.000Z",
    messages: [
      // Branch A fails
      { methodOrCode: "INVITE", cseq: "101 INVITE", timestamp: "2026-03-10T10:00:01.000Z", packetIndex: 300, topViaBranch: "z9hG4bK-a" } as any,
      { methodOrCode: "503 Service Unavailable", cseq: "101 INVITE", timestamp: "2026-03-10T10:00:02.000Z", packetIndex: 301, topViaBranch: "z9hG4bK-a" } as any,
      // Branch B succeeds
      { methodOrCode: "INVITE", cseq: "101 INVITE", timestamp: "2026-03-10T10:00:03.000Z", packetIndex: 302, topViaBranch: "z9hG4bK-b" } as any,
      { methodOrCode: "200 OK", cseq: "101 INVITE", timestamp: "2026-03-10T10:00:04.000Z", packetIndex: 303, topViaBranch: "z9hG4bK-b" } as any,
      { methodOrCode: "ACK", cseq: "101 ACK", timestamp: "2026-03-10T10:00:05.000Z", packetIndex: 304, topViaBranch: "z9hG4bK-b" } as any,
    ],
  };
}

function makeStream(overrides?: Partial<RtpStreamInfo>): RtpStreamInfo {
  return {
    ssrc: 12345,
    srcIp: "10.0.0.1",
    srcPort: 30000,
    dstIp: "10.0.0.2",
    dstPort: 40000,
    payloadType: 0,
    codecName: "PCMU",
    packetCount: 1000,
    lostPackets: 30,
    lossPercentage: 3,
    jitter: 42,
    mosScore: 3.0,
    firstPacketTime: "2026-03-10T10:00:01.000Z",
    lastPacketTime: "2026-03-10T10:01:00.000Z",
    ...overrides,
  };
}

describe("diagnostics engine", () => {
  it("builds findings from SIP and RTP analyzers", () => {
    const session: CaptureSession = {
      id: "s-1",
      name: "UCaaS Teams HQ",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 1000,
      filePath: "/tmp/test.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [makeDialog("503 Service Unavailable"), makeDialog("488 Not Acceptable Here", "fax-1")],
      rtpStreams: [makeStream()],
    });

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.some((f) => f.domain === "sip")).toBe(true);
    expect(report.findings.some((f) => f.domain === "rtp")).toBe(true);
    expect(report.findings.some((f) => f.domain === "ucaas")).toBe(true);
  });

  it("keeps explanation text non-prescriptive", () => {
    const session: CaptureSession = {
      id: "s-2",
      name: "Generic Capture",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 100,
      filePath: "/tmp/test2.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [makeDialog("503 Service Unavailable")],
      rtpStreams: [],
    });
    const combined = report.findings
      .flatMap((f) => [f.explanation.summary, f.explanation.impact, f.explanation.why, ...(f.explanation.furtherChecks ?? [])])
      .join(" ")
      .toLowerCase();
    for (const token of ["must ", "should ", "reboot", "restart", "fix ", "change ", "set "]) {
      expect(combined).not.toContain(token);
    }
  });

  it("returns deterministic explanations for same input", () => {
    const session: CaptureSession = {
      id: "s-3",
      name: "UCaaS Teams HQ",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 1000,
      filePath: "/tmp/test3.pcap",
      tags: [],
    };
    const input = {
      session,
      dialogs: [makeDialog("503 Service Unavailable")],
      rtpStreams: [makeStream()],
    };
    const r1 = buildDiagnosticsReport(input);
    const r2 = buildDiagnosticsReport(input);
    expect(r1.generatedAt).toBe(r2.generatedAt);
    expect(r1.findings.map((f) => f.id)).toEqual(r2.findings.map((f) => f.id));
    expect(r1.findings.map((f) => f.explanation)).toEqual(r2.findings.map((f) => f.explanation));
  });

  it("does not flag 401 challenge when flow completes with 200 OK", () => {
    const session: CaptureSession = {
      id: "s-4",
      name: "Auth challenge success",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 300,
      filePath: "/tmp/test4.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [makeDialogWithMethods(["INVITE", "401 Unauthorized", "INVITE", "200 OK"], "auth-success")],
      rtpStreams: [],
    });
    expect(report.findings.some((f) => f.ruleId === "sip_final_non_2xx")).toBe(false);
    expect(report.findings.some((f) => f.ruleId === "sip_auth_challenge_loop")).toBe(false);
  });

  it("flags repeated auth challenge loop without success", () => {
    const session: CaptureSession = {
      id: "s-5",
      name: "Auth challenge loop",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 300,
      filePath: "/tmp/test5.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [makeDialogWithMethods(["INVITE", "401", "INVITE", "407", "INVITE", "401"], "auth-loop")],
      rtpStreams: [],
    });
    const loop = report.findings.find((f) => f.ruleId === "sip_auth_challenge_loop");
    expect(loop).toBeTruthy();
    expect(loop?.severity).toBe("critical");
  });

  it("treats CANCEL + 487 as expected call abort", () => {
    const session: CaptureSession = {
      id: "s-6",
      name: "Cancel flow",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 200,
      filePath: "/tmp/test6.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [makeDialogWithMethods(["INVITE", "180 Ringing", "CANCEL", "487 Request Terminated"], "cancel-487")],
      rtpStreams: [],
    });
    expect(report.findings.some((f) => f.ruleId === "sip_final_non_2xx")).toBe(false);
  });

  it("classifies busy response as informational, not warning/error", () => {
    const session: CaptureSession = {
      id: "s-7",
      name: "Busy flow",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 200,
      filePath: "/tmp/test7.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [makeDialogWithMethods(["INVITE", "486 Busy Here"], "busy-486")],
      rtpStreams: [],
    });
    const finding = report.findings.find((f) => f.ruleId === "sip_final_non_2xx");
    expect(finding).toBeTruthy();
    expect(finding?.severity).toBe("info");
  });

  it("does not let REGISTER auth success suppress INVITE failure", () => {
    const session: CaptureSession = {
      id: "s-8",
      name: "Mixed signaling outcome",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 350,
      filePath: "/tmp/test8.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [
        makeDialogWithMethods(["REGISTER", "401 Unauthorized", "REGISTER", "200 OK", "INVITE", "503 Service Unavailable"], "mixed-1"),
      ],
      rtpStreams: [],
    });
    const finalFailure = report.findings.find((f) => f.ruleId === "sip_final_non_2xx");
    expect(finalFailure).toBeTruthy();
    expect(finalFailure?.title).toContain("503");
    expect(finalFailure?.severity).toBe("critical");
    const metricLabels = (finalFailure?.evidence ?? []).map((e) => e.label);
    expect(metricLabels).toContain("INVITE auth retries");
    expect(metricLabels).toContain("REGISTER auth retries");
    expect(metricLabels).toContain("INVITE setup latency");
  });

  it("suppresses INVITE failure when another branch succeeds", () => {
    const session: CaptureSession = {
      id: "s-9",
      name: "Forking success",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 400,
      filePath: "/tmp/test9.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [makeDialogWithBranching()],
      rtpStreams: [],
    });
    expect(report.findings.some((f) => f.ruleId === "sip_final_non_2xx")).toBe(false);
  });

  it("uses real-world RTP thresholds for jitter and loss", () => {
    const session: CaptureSession = {
      id: "s-10",
      name: "RTP thresholds",
      interface: "en0",
      filterConfig: { protocols: [], srcIpRanges: [], dstIpRanges: [], srcPorts: [], dstPorts: [], portRanges: [] },
      startTime: "2026-03-10T10:00:00.000Z",
      status: "Stopped",
      packetCount: 450,
      filePath: "/tmp/test10.pcap",
      tags: [],
    };
    const report = buildDiagnosticsReport({
      session,
      dialogs: [],
      rtpStreams: [
        makeStream({ ssrc: 555, jitter: 65, lossPercentage: 2.5, mosScore: 3.7 }),
        makeStream({ ssrc: 556, jitter: 85, lossPercentage: 3.2, mosScore: 3.4 }),
      ],
    });
    const mild = report.findings.filter((f) =>
      f.id.includes("555") && (f.ruleId === "rtp_high_jitter" || f.ruleId === "rtp_packet_loss"),
    );
    expect(mild.length).toBe(0);
    const elevated = report.findings.filter((f) =>
      f.id.includes("556") && (f.ruleId === "rtp_high_jitter" || f.ruleId === "rtp_packet_loss"),
    );
    expect(elevated.some((f) => f.ruleId === "rtp_high_jitter" && f.severity === "warning")).toBe(true);
    expect(elevated.some((f) => f.ruleId === "rtp_packet_loss" && f.severity === "warning")).toBe(true);
  });
});

