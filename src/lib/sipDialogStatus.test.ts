import { describe, expect, it } from "vitest";
import type { SipDialog } from "@/types/forensics";
import { getDialogStatus } from "@/lib/sipDialogStatus";

function makeDialog(sequence: string[]): SipDialog {
  const base = new Date("2026-03-10T17:45:00.000Z");
  return {
    callId: "test-call",
    startTime: base.toISOString(),
    messages: sequence.map((methodOrCode, i) => ({
      methodOrCode,
      packetIndex: i,
      timestamp: new Date(base.getTime() + i * 1000).toISOString(),
    })),
  };
}

describe("getDialogStatus", () => {
  it("treats REGISTER auth challenge then 200 as success", () => {
    const d = makeDialog(["REGISTER", "401 Unauthorized", "REGISTER", "200 OK"]);
    expect(getDialogStatus(d)).toBe("success");
  });

  it("treats INVITE auth challenge then 200 as success", () => {
    const d = makeDialog(["INVITE", "100 Trying", "407 Proxy Authentication Required", "INVITE", "200 OK", "ACK"]);
    expect(getDialogStatus(d)).toBe("success");
  });

  it("keeps mixed non-auth 4xx + 200 as warning", () => {
    const d = makeDialog(["OPTIONS", "404 Not Found", "OPTIONS", "200 OK"]);
    expect(getDialogStatus(d)).toBe("warning");
  });

  it("marks plain 4xx without recovery as error", () => {
    const d = makeDialog(["INVITE", "486 Busy Here", "ACK"]);
    expect(getDialogStatus(d)).toBe("error");
  });
});

