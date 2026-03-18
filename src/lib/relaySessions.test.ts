import { describe, expect, it } from "vitest";

import {
  buildRelayRestorePlan,
  relaySessionIdFromControllerAddress,
} from "@/lib/relaySessions";
import type { GeneratedConfig } from "@/stores/remoteAgentStore";

function cfg(overrides: Partial<GeneratedConfig>): GeneratedConfig {
  return {
    id: "cfg-1",
    agentId: "agent-1",
    targetOs: "linux",
    controllerAddress: "relay.zyfi.io/session/sid-1",
    authToken: "token-1",
    generatedAt: "2026-03-09T10:00:00.000Z",
    label: null,
    zipPath: "/tmp/agent",
    profile: "full",
    ...overrides,
  };
}

describe("relaySessionIdFromControllerAddress", () => {
  it("extracts the session id from relay controller addresses", () => {
    expect(relaySessionIdFromControllerAddress("relay.zyfi.io/session/abc123")).toBe("abc123");
    expect(relaySessionIdFromControllerAddress("https://relay.zyfi.io/session/abc123?x=1")).toBe("abc123");
  });

  it("returns null for non-relay addresses", () => {
    expect(relaySessionIdFromControllerAddress("127.0.0.1:9090")).toBeNull();
    expect(relaySessionIdFromControllerAddress("relay.zyfi.io")).toBeNull();
  });
});

describe("buildRelayRestorePlan", () => {
  it("builds a deduped restore plan for all agents", () => {
    const plan = buildRelayRestorePlan([
      cfg({ id: "a", agentId: "agent-a", controllerAddress: "relay.zyfi.io/session/sid-a", authToken: "tok-a" }),
      cfg({ id: "b", agentId: "agent-b", controllerAddress: "relay.zyfi.io/session/sid-b", authToken: "tok-b" }),
      // Duplicate session id should be deduped.
      cfg({ id: "c", agentId: "agent-c", controllerAddress: "relay.zyfi.io/session/sid-a", authToken: "tok-a-2" }),
    ]);
    expect(plan).toEqual([
      { agentId: "agent-a", sessionId: "sid-a", authToken: "tok-a" },
      { agentId: "agent-b", sessionId: "sid-b", authToken: "tok-b" },
    ]);
  });

  it("can target a single agent for one-click tunnel restore", () => {
    const plan = buildRelayRestorePlan(
      [
        cfg({ id: "a", agentId: "agent-a", controllerAddress: "relay.zyfi.io/session/sid-a", authToken: "tok-a" }),
        cfg({ id: "b", agentId: "agent-b", controllerAddress: "relay.zyfi.io/session/sid-b", authToken: "tok-b" }),
      ],
      "agent-b",
    );
    expect(plan).toEqual([{ agentId: "agent-b", sessionId: "sid-b", authToken: "tok-b" }]);
  });
});
