import { beforeEach, describe, expect, it } from "vitest";
import { getContextMenuSections } from "@/lib/contextMenuRegistry";
import { createDefaultContextMenuContext, isSubmenu, type ContextMenuEntry } from "@/types/contextMenu";
import { FEATURE_FLAG_MCP_UI, FEATURE_FLAG_TOOLS_MOCKUP_UI } from "@/lib/featureFlags";
import { setCachedFeatureFlag } from "@/lib/featureFlagCache";
import { Activity } from "@/lib/icons";
import { registerTools } from "@/lib/tools";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";

registerTools();

function findEntry(entries: ContextMenuEntry[], id: string): ContextMenuEntry | null {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    if (isSubmenu(entry)) {
      const nested = findEntry(entry.children, id);
      if (nested) return nested;
    }
  }
  return null;
}

function findSectionIndex(sections: ReturnType<typeof getContextMenuSections>, sectionId: string): number {
  return sections.findIndex((section) => section.id === sectionId);
}

describe("context menu registry", () => {
  beforeEach(() => {
    useSoftphoneStore.setState({
      calls: [],
      activeCallId: null,
      activeRegistrarId: null,
    });
    usePacketCaptureStore.setState({
      activeSessionId: null,
    });
    useNetworkTestStore.setState({
      monitorRunning: false,
    });
  });

  it("omits edit submenu for empty, non-editable contexts", () => {
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" }),
    );
    const contextActions = sections.find((section) => section.id === "context-actions");
    expect(contextActions).toBeTruthy();
    const editSubmenu = findEntry(contextActions?.entries ?? [], "context-edit");
    expect(editSubmenu).toBeNull();
    expect(findEntry(sections.flatMap((section) => section.entries), "cut")).toBeNull();
    expect(findEntry(sections.flatMap((section) => section.entries), "copy")).toBeNull();
    expect(findEntry(sections.flatMap((section) => section.entries), "paste")).toBeNull();
    expect(findEntry(sections.flatMap((section) => section.entries), "select-all")).toBeNull();
  });

  it("disables cut for non-editable contexts", () => {
    const context = createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" });
    context.capabilities.canCopy = true;
    const sections = getContextMenuSections(context);
    const contextActions = sections.find((section) => section.id === "context-actions");
    expect(contextActions).toBeTruthy();
    const cut = findEntry(contextActions?.entries ?? [], "cut");
    expect(cut && !isSubmenu(cut) ? cut.disabled : false).toBe(true);
    expect(cut && !isSubmenu(cut) ? cut.disabledReason : "").toBe("Read-only");
  });

  it("keeps select-all available without implying copy/cut", () => {
    const context = createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" });
    context.capabilities.canSelectAll = true;
    const sections = getContextMenuSections(context);
    const contextActions = sections.find((section) => section.id === "context-actions");
    expect(contextActions).toBeTruthy();
    const editSubmenu = findEntry(contextActions?.entries ?? [], "context-edit");
    expect(editSubmenu).toBeTruthy();
    expect(findEntry(contextActions?.entries ?? [], "select-all")).toBeTruthy();
    const copy = findEntry(contextActions?.entries ?? [], "copy");
    expect(copy && !isSubmenu(copy) ? copy.disabled : true).toBe(true);
    const cut = findEntry(contextActions?.entries ?? [], "cut");
    expect(cut && !isSubmenu(cut) ? cut.disabled : true).toBe(true);
  });

  it("orders sections by IA policy", () => {
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" }),
    );
    const navigateIndex = findSectionIndex(sections, "navigate");
    const viewsIndex = findSectionIndex(sections, "views");
    const actionsIndex = findSectionIndex(sections, "context-actions");
    const appIndex = findSectionIndex(sections, "app");
    const dangerIndex = findSectionIndex(sections, "danger");
    expect(navigateIndex).toBeGreaterThanOrEqual(0);
    expect(viewsIndex).toBeGreaterThanOrEqual(0);
    expect(actionsIndex).toBeGreaterThanOrEqual(0);
    expect(appIndex).toBeGreaterThanOrEqual(0);
    expect(dangerIndex).toBeGreaterThanOrEqual(0);
    expect(navigateIndex).toBeLessThan(viewsIndex);
    expect(viewsIndex).toBeLessThan(actionsIndex);
    expect(actionsIndex).toBeLessThan(appIndex);
    expect(appIndex).toBeLessThan(dangerIndex);
  });

  it("marks only the current tool as active in navigation submenu", () => {
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" }),
    );
    const navigateSection = sections.find((section) => section.id === "navigate");
    expect(navigateSection).toBeTruthy();
    const navSubmenu = findEntry(navigateSection?.entries ?? [], "nav-sub");
    expect(navSubmenu && isSubmenu(navSubmenu)).toBe(true);
    const navChildren = navSubmenu && isSubmenu(navSubmenu) ? navSubmenu.children : [];
    const activeNavIds = navChildren
      .filter((entry) => !isSubmenu(entry) && entry.active)
      .map((entry) => entry.id);
    expect(activeNavIds).toEqual(["nav-network"]);
  });

  it("marks the active network subview and leaves sibling subviews inactive", () => {
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "network", subviewId: "dns-access" }),
    );
    const viewsSection = sections.find((section) => section.id === "views");
    expect(viewsSection).toBeTruthy();
    const viewsSubmenu = findEntry(viewsSection?.entries ?? [], "network-views");
    expect(viewsSubmenu && isSubmenu(viewsSubmenu)).toBe(true);
    const viewChildren = viewsSubmenu && isSubmenu(viewsSubmenu) ? viewsSubmenu.children : [];
    const activeViewIds = viewChildren
      .filter((entry) => !isSubmenu(entry) && entry.active)
      .map((entry) => entry.id);
    expect(activeViewIds).toEqual(["network-view-dns-access"]);
    expect(
      viewChildren.some((entry) => !isSubmenu(entry) && entry.id !== "network-view-dns-access" && entry.active),
    ).toBe(false);
  });

  it("omits context-actions when there are no edit or tool actions", () => {
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: null, subviewId: null }),
    );
    expect(sections.find((section) => section.id === "context-actions")).toBeUndefined();
  });

  it("marks reload action as loading when runtime is busy", () => {
    const context = createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" });
    context.runtime.isBusy = true;
    const sections = getContextMenuSections(context);
    const appSection = sections.find((section) => section.id === "app");
    expect(appSection).toBeTruthy();
    const refresh = findEntry(appSection?.entries ?? [], "refresh-ui");
    expect(refresh && !isSubmenu(refresh) ? refresh.loading : false).toBe(true);
  });

  it("shows danger zone only for tools with relevant destructive actions", () => {
    const toolsSections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "tools", subviewId: "syslog" }),
    );
    expect(toolsSections.find((section) => section.id === "danger")).toBeUndefined();

    const networkSections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" }),
    );
    const dangerSection = networkSections.find((section) => section.id === "danger");
    expect(dangerSection).toBeTruthy();
    const clearHistory = findEntry(dangerSection?.entries ?? [], "net-clear-history");
    expect(clearHistory && !isSubmenu(clearHistory)).toBe(true);
  });

  it("hides MCP subview from tools context menu when feature flag is off", () => {
    setCachedFeatureFlag(FEATURE_FLAG_MCP_UI, false);
    setCachedFeatureFlag(FEATURE_FLAG_TOOLS_MOCKUP_UI, true);
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "tools", subviewId: "syslog" }),
    );
    const viewsSection = sections.find((section) => section.id === "views");
    expect(viewsSection).toBeTruthy();
    const views = findEntry(viewsSection?.entries ?? [], "tools-views");
    const viewIds = views && isSubmenu(views) ? views.children.map((child) => child.id) : [];
    expect(viewIds).toContain("tools-view-syslog");
    expect(viewIds).not.toContain("tools-view-mcp");
  });

  it("hides mockup subview from tools context menu when feature flag is off", () => {
    setCachedFeatureFlag(FEATURE_FLAG_MCP_UI, true);
    setCachedFeatureFlag(FEATURE_FLAG_TOOLS_MOCKUP_UI, false);
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "tools", subviewId: "syslog" }),
    );
    const viewsSection = sections.find((section) => section.id === "views");
    expect(viewsSection).toBeTruthy();
    const views = findEntry(viewsSection?.entries ?? [], "tools-views");
    const viewIds = views && isSubmenu(views) ? views.children.map((child) => child.id) : [];
    expect(viewIds).toContain("tools-view-syslog");
    expect(viewIds).not.toContain("tools-view-mockup");
  });

  it("renders configured subview icons in views submenus", () => {
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "network", subviewId: "dns-access" }),
    );
    const viewsSection = sections.find((section) => section.id === "views");
    expect(viewsSection).toBeTruthy();
    const views = findEntry(viewsSection?.entries ?? [], "network-views");
    const dnsAccess = views && isSubmenu(views)
      ? views.children.find((child) => child.id === "network-view-dns-access")
      : null;
    expect(dnsAccess && !isSubmenu(dnsAccess) ? dnsAccess.icon : undefined).toBe(Activity);
  });
});
