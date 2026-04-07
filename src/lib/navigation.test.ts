import { beforeEach, describe, expect, it, vi } from "vitest";

type CachedFlag = { enabled: boolean; fetchedAt: number } | undefined;

const flagState = vi.hoisted(() => ({
  mcp: undefined as CachedFlag,
  mockup: undefined as CachedFlag,
}));

vi.mock("@/lib/featureFlagCache", () => ({
  getCachedFeatureFlag: (key: string) => {
    if (key === "tools_mcp_ui") return flagState.mcp;
    if (key === "tools_mockup_ui") return flagState.mockup;
    return undefined;
  },
  isFeatureFlagEnabled: (_key: string, fallback = false) => fallback,
}));

vi.mock("@/lib/toolRegistry", () => ({
  HOME_TOOL_ID: "troubleshooting",
  toolRegistry: {
    get: (id: string) => {
      if (id === "troubleshooting" || id === "tools") return { id };
      return undefined;
    },
  },
}));

import { parseHash } from "@/lib/navigation";

function setHash(hash: string): void {
  Object.defineProperty(globalThis, "window", {
    value: { location: { hash } },
    writable: true,
    configurable: true,
  });
}

describe("navigation parseHash tools subviews", () => {
  beforeEach(() => {
    flagState.mcp = undefined;
    flagState.mockup = undefined;
  });

  it("preserves mcp subview when feature flags have not hydrated yet", () => {
    setHash("#/tools/mcp");
    expect(parseHash()).toMatchObject({ toolId: "tools", subviewId: "mcp" });
  });

  it("rewrites mcp subview to syslog when cached flag is disabled", () => {
    flagState.mcp = { enabled: false, fetchedAt: Date.now() };
    setHash("#/tools/mcp");
    expect(parseHash()).toMatchObject({ toolId: "tools", subviewId: "syslog" });
  });

  it("rewrites mockup subview to syslog when cached flag is disabled", () => {
    flagState.mockup = { enabled: false, fetchedAt: Date.now() };
    setHash("#/tools/mockup");
    expect(parseHash()).toMatchObject({ toolId: "tools", subviewId: "syslog" });
  });
});
