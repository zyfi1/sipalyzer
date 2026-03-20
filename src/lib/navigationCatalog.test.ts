import { describe, expect, it } from "vitest";
import { setCachedFeatureFlag } from "@/lib/featureFlagCache";
import { FEATURE_FLAG_MCP_UI } from "@/lib/featureFlags";
import { Activity } from "@/lib/icons";
import { getSubviewIcon, getVisibleToolSubviews } from "@/lib/navigationCatalog";
import type { ToolDefinition } from "@/lib/toolRegistry";

const toolsTool: Pick<ToolDefinition, "id" | "subviews"> = {
  id: "tools",
  subviews: [
    { id: "syslog", label: "Syslog" },
    { id: "mcp", label: "MCP" },
  ],
};

describe("navigationCatalog", () => {
  it("hides feature-flagged subviews when the flag is disabled", () => {
    setCachedFeatureFlag(FEATURE_FLAG_MCP_UI, false);
    const visible = getVisibleToolSubviews(toolsTool);
    expect(visible.map((item) => item.id)).toEqual(["syslog"]);
  });

  it("shows feature-flagged subviews when the flag is enabled", () => {
    setCachedFeatureFlag(FEATURE_FLAG_MCP_UI, true);
    const visible = getVisibleToolSubviews(toolsTool);
    expect(visible.map((item) => item.id)).toEqual(["syslog", "mcp"]);
  });

  it("returns configured subview icons", () => {
    expect(getSubviewIcon("network", "dns-access")).toBe(Activity);
  });
});
