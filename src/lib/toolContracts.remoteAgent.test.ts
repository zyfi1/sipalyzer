import { describe, expect, it } from "vitest";
import { registerTools } from "@/lib/tools";
import { toolRegistry } from "@/lib/toolRegistry";

describe("remote-agent tool contracts", () => {
  it("keeps the remote-agent route and subview ids stable", () => {
    registerTools();
    const remoteAgent = toolRegistry.get("remote-agent");
    expect(remoteAgent).toBeDefined();
    expect(remoteAgent?.route).toBe("/remote-agent");
    expect(remoteAgent?.subviews?.map((s) => s.id)).toEqual([
      "overview",
      "registry",
      "activity",
    ]);
  });
});
