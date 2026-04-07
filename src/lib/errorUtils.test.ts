import { describe, expect, it } from "vitest";
import { formatHumanizedError, humanizeErrorMessage } from "@/lib/errorUtils";

describe("error humanization", () => {
  it("maps permission errors to actionable message", () => {
    const result = humanizeErrorMessage("Permission denied while opening capture device");
    expect(result.userMessage).toContain("Permission was denied");
    expect(result.actionHint).toBeTruthy();
  });

  it("maps timeout errors to actionable message", () => {
    const result = humanizeErrorMessage(new Error("request timed out after 30s"));
    expect(result.userMessage).toContain("timed out");
    expect(result.actionHint).toContain("Try again");
  });

  it("formats action line when hint exists", () => {
    const message = formatHumanizedError("Go toolchain not found");
    expect(message).toContain("Action:");
    expect(message).toContain("setup:go-toolchain");
  });
});
