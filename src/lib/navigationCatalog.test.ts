import { describe, expect, it } from "vitest";
import { setCachedFeatureFlag } from "@/lib/featureFlagCache";
import { FEATURE_FLAG_MCP_UI, FEATURE_FLAG_TOOLS_MOCKUP_UI } from "@/lib/featureFlags";
import { Activity } from "@/lib/icons";
import { getSubviewIcon, getVisibleToolSubviews } from "@/lib/navigationCatalog";
import type { ToolDefinition } from "@/lib/toolRegistry";

const toolsTool: Pick<ToolDefinition, "id" | "subviews"> = {
  id: "tools",
  subviews: [
    { id: "syslog", label: "Syslog" },
    { id: "mockup", label: "Mockup" },
    { id: "mcp", label: "MCP" },
  ],
};

describe("navigationCatalog", () => {
  it("hides MCP and mockup subviews when their flags are disabled", () => {
    setCachedFeatureFlag(FEATURE_FLAG_MCP_UI, false);
    setCachedFeatureFlag(FEATURE_FLAG_TOOLS_MOCKUP_UI, false);
    const visible = getVisibleToolSubviews(toolsTool);
    expect(visible.map((item) => item.id)).toEqual(["syslog"]);
  });

  it("shows MCP and mockup subviews when their flags are enabled", () => {
    setCachedFeatureFlag(FEATURE_FLAG_MCP_UI, true);
    setCachedFeatureFlag(FEATURE_FLAG_TOOLS_MOCKUP_UI, true);
    const visible = getVisibleToolSubviews(toolsTool);
    expect(visible.map((item) => item.id)).toEqual(["syslog", "mockup", "mcp"]);
  });

  it("shows only mockup when MCP flag is off and mockup flag is on", () => {
    setCachedFeatureFlag(FEATURE_FLAG_MCP_UI, false);
    setCachedFeatureFlag(FEATURE_FLAG_TOOLS_MOCKUP_UI, true);
    const visible = getVisibleToolSubviews(toolsTool);
    expect(visible.map((item) => item.id)).toEqual(["syslog", "mockup"]);
  });

  it("returns configured subview icons", () => {
    expect(getSubviewIcon("network", "dns-access")).toBe(Activity);
  });
});
