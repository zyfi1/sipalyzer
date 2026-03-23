import { Activity, type IconComponent, Clock, FileSearch, Globe, Hash, Network, Package, Radio, Scan, Search, Server, Settings, Shield, SquareTerminal, Terminal, TestTube, Wrench } from "@/lib/icons";
import { FEATURE_FLAG_MCP_UI, FEATURE_FLAG_TOOLS_MOCKUP_UI } from "@/lib/featureFlags";
import { isFeatureFlagEnabled } from "@/lib/featureFlagCache";
import { toolRegistry, type ToolDefinition, type ToolSubView } from "@/lib/toolRegistry";
import { isProvisionViewerSubviewAvailable } from "@/lib/provisionNav";

interface SubviewVisibilityOptions {
  provisionResultLoaded?: boolean;
}

const TOOL_FEATURE_FLAGS: Partial<Record<string, string>> = {};

const SUBVIEW_FEATURE_FLAGS: Partial<Record<string, string>> = {
  "tools:mockup": FEATURE_FLAG_TOOLS_MOCKUP_UI,
  "tools:mcp": FEATURE_FLAG_MCP_UI,
};

const SUBVIEW_ICON_MAP: Partial<Record<string, IconComponent>> = {
  "packet-capture:monitor": Radio,
  "packet-capture:captures": Package,
  "packet-capture:viewer": FileSearch,
  "packet-capture:analysis": TestTube,
  "packet-capture:packet-diff": Hash,
  "packet-capture:remote": Terminal,
  "packet-capture:scheduled": Clock,
  "soft-phone:phone": SquareTerminal,
  "soft-phone:contacts": Server,
  "soft-phone:recordings": Radio,
  "fax-center:send": Wrench,
  "fax-center:faxes": FileSearch,
  "provision-viewer:provision": Wrench,
  "provision-viewer:firmware": Package,
  "provision-viewer:contacts": Server,
  "provision-viewer:device": Shield,
  "provision-viewer:diff": Hash,
  "provision-viewer:designer": Settings,
  "network:path-performance": Globe,
  "network:dns-access": Activity,
  "network:discovery": Scan,
  "network:multicast": Network,
  "remote-agent:overview": Activity,
  "remote-agent:registry": Server,
  "remote-agent:activity": Clock,
  "composer:requests": Wrench,
  "composer:ssh": Terminal,
  "composer:history": Clock,
  "composer:docs": FileSearch,
  "tools:syslog": Radio,
  "tools:logs": FileSearch,
  "tools:file-server": Server,
  "tools:password-gen": Shield,
  "tools:text-forge": Wrench,
  "tools:mockup": Search,
  "tools:mcp": Activity,
};

function subviewKey(toolId: string, subviewId: string): string {
  return `${toolId}:${subviewId}`;
}

/** When false, the tool is hidden from nav / home quick actions (see `TOOL_FEATURE_FLAGS`). */
export function isNavigationToolFeatureVisible(toolId: string): boolean {
  const featureFlag = TOOL_FEATURE_FLAGS[toolId];
  if (!featureFlag) return true;
  return isFeatureFlagEnabled(featureFlag, false);
}

export function isNavigationSubviewVisible(toolId: string, subviewId: string): boolean {
  const featureFlag = SUBVIEW_FEATURE_FLAGS[subviewKey(toolId, subviewId)];
  if (!featureFlag) return true;
  return isFeatureFlagEnabled(featureFlag, false);
}

export function getVisibleNavigationTools(): ToolDefinition[] {
  return toolRegistry
    .getAll()
    .filter((tool) => !tool.hidden && isNavigationToolFeatureVisible(tool.id));
}

export function getVisibleToolSubviews(
  tool: Pick<ToolDefinition, "id" | "subviews">,
  options?: SubviewVisibilityOptions,
): ToolSubView[] {
  const subviews = tool.subviews ?? [];
  const featureVisible = subviews.filter((subview) =>
    isNavigationSubviewVisible(tool.id, subview.id),
  );
  if (
    tool.id === "provision-viewer"
    && typeof options?.provisionResultLoaded === "boolean"
  ) {
    return featureVisible.filter((subview) =>
      isProvisionViewerSubviewAvailable(subview.id, options.provisionResultLoaded!),
    );
  }
  return featureVisible;
}

export function getToolIcon(toolId: string, fallback: IconComponent = Activity): IconComponent {
  return toolRegistry.get(toolId)?.icon ?? fallback;
}

export function getSubviewIcon(toolId: string, subviewId: string): IconComponent | undefined {
  return SUBVIEW_ICON_MAP[subviewKey(toolId, subviewId)];
}
