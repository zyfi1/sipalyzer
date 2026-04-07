import { describe, expect, it } from "vitest";
import { shouldDeferToolsSubviewHydration } from "@/components/tools/toolsSubviewHydration";

describe("shouldDeferToolsSubviewHydration", () => {
  it("defers mcp subview while MCP flag is still loading", () => {
    expect(
      shouldDeferToolsSubviewHydration("mcp", {
        mcpEnabled: false,
        mcpLoading: true,
        mockupEnabled: false,
        mockupLoading: false,
      })
    ).toBe(true);
  });

  it("defers mockup subview while mockup flag is still loading", () => {
    expect(
      shouldDeferToolsSubviewHydration("mockup", {
        mcpEnabled: false,
        mcpLoading: false,
        mockupEnabled: false,
        mockupLoading: true,
      })
    ).toBe(true);
  });

  it("does not defer non-gated or resolved subviews", () => {
    expect(
      shouldDeferToolsSubviewHydration("syslog", {
        mcpEnabled: false,
        mcpLoading: true,
        mockupEnabled: false,
        mockupLoading: true,
      })
    ).toBe(false);
    expect(
      shouldDeferToolsSubviewHydration("mcp", {
        mcpEnabled: false,
        mcpLoading: false,
        mockupEnabled: false,
        mockupLoading: false,
      })
    ).toBe(false);
  });
});
