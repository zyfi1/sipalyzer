/**
 * Shared command-palette item definitions, search config, and recent-items helpers.
 *
 * Static commands and their Fuse index are lazily built once at module level
 * so opening the palette is instant (no re-computation per open).
 *
 * Used by both GlobalSearchDialog (modal) and the inline header search field.
 */

import Fuse from "fuse.js";
import type { IFuseOptions } from "fuse.js";
import { useToolStore } from "@/stores/toolStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSidebarStore } from "@/stores/sidebarStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useMcpStore } from "@/stores/mcpStore";
import { navigateTo } from "@/lib/navigation";
import { toolRegistry, HOME_TOOL_ID } from "@/lib/toolRegistry";
import { FEATURE_FLAG_MCP_UI } from "@/lib/featureFlags";
import { isFeatureFlagEnabled } from "@/lib/featureFlagCache";
import { SHORTCUTS } from "@/lib/shortcuts";
import {
  Home,
  Network,
  Server,
  PhoneCall,
  Printer,
  FileSearch,
  StickyNote,
  Bell,
  Settings,
  Keyboard,
  Eraser,
  PanelLeft,
  Activity,
  RefreshCw,
} from "@/lib/icons";
import type React from "react";

// ─── Types ────────────────────────────────────────────────────────────────

export interface PaletteItem {
  id: string;
  category: "navigation" | "action" | "registrar" | "capture" | "note" | "agent";
  name: string;
  subtitle?: string;
  keywords?: string[];
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  /** Show in default (empty-query) view. Defaults to true. */
  primary?: boolean;
  run: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────

export const MAX_PER_GROUP = 8;
export const MAX_RECENT = 5;
export const NOTES_DEBOUNCE_MS = 200;
export const NOTES_MIN_CHARS = 2;
// ─── Recent-items helpers ─────────────────────────────────────────────────

import { useUiPrefsStore } from "@/stores/uiPrefsStore";

export function loadRecentIds(): string[] {
  return useUiPrefsStore.getState().cmdPaletteRecent;
}

export function saveRecentId(id: string) {
  useUiPrefsStore.getState().addCmdPaletteRecent(id);
}

// ─── Tool icon & shortcut maps ────────────────────────────────────────────

export const TOOL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  [HOME_TOOL_ID]: Home,
  "packet-capture": Network,
  registration: Server,
  "soft-phone": PhoneCall,
  "fax-center": Printer,
  "provision-viewer": FileSearch,
  "network": Activity,
};

export const TOOL_SHORTCUT: Record<string, string> = {
  [HOME_TOOL_ID]: SHORTCUTS.goHome,
  "packet-capture": SHORTCUTS.goPacketCapture,
  registration: SHORTCUTS.goRegistration,
  "soft-phone": SHORTCUTS.goSoftPhone,
  "fax-center": SHORTCUTS.goFaxCenter,
  "provision-viewer": SHORTCUTS.goProvisionViewer,
  "network": SHORTCUTS.goNetworkTest,
};

// ─── Fuse config ──────────────────────────────────────────────────────────

export const FUSE_OPTS: IFuseOptions<PaletteItem> = {
  keys: [
    { name: "name", weight: 0.5 },
    { name: "subtitle", weight: 0.15 },
    { name: "keywords", weight: 0.35 },
  ],
  threshold: 0.4,
  includeScore: true,
};

// ─── Static command registry ──────────────────────────────────────────────

export function buildCommands(): PaletteItem[] {
  const cmds: PaletteItem[] = [];
  const mcpEnabled = isFeatureFlagEnabled(FEATURE_FLAG_MCP_UI, false);

  // Navigation: tools + subviews
  for (const tool of toolRegistry.getAll()) {
    const Icon = TOOL_ICON[tool.id] ?? Activity;

    cmds.push({
      id: `nav:${tool.id}`,
      category: "navigation",
      name: `Go to ${tool.name}`,
      keywords: [tool.name, tool.id, "navigate", "go", "open", "switch"],
      icon: Icon,
      shortcut: TOOL_SHORTCUT[tool.id],
      primary: true,
      run: () =>
        tool.id === HOME_TOOL_ID
          ? useToolStore.getState().setActiveTool(HOME_TOOL_ID)
          : navigateTo(tool.id),
    });

    if (tool.subviews) {
      const visibleSubviews =
        tool.id === "tools" && !mcpEnabled
          ? tool.subviews.filter((sv) => sv.id !== "mcp")
          : tool.subviews;
      for (const sv of visibleSubviews) {
        cmds.push({
          id: `nav:${tool.id}:${sv.id}`,
          category: "navigation",
          name: `${tool.name} \u203A ${sv.label}`,
          subtitle: sv.label,
          keywords: [tool.name, sv.label, sv.id, tool.id, "navigate", "go", "tab"],
          icon: Icon,
          primary: false,
          run: () => navigateTo(tool.id, sv.id),
        });
      }
    }
  }

  // Actions: panels
  cmds.push(
    {
      id: "act:notes",
      category: "action",
      name: "Open Notes",
      keywords: ["notes", "note", "write", "memo"],
      icon: StickyNote,
      shortcut: SHORTCUTS.openNotes,
      primary: true,
      run: () => useLayoutStore.getState().setNotesCenterOpen(true),
    },
    {
      id: "act:notifications",
      category: "action",
      name: "Open Notifications",
      keywords: ["notifications", "alerts", "bell"],
      icon: Bell,
      shortcut: SHORTCUTS.openNotifications,
      primary: true,
      run: () => useLayoutStore.getState().setNotificationsCenterOpen(true),
    },
    {
      id: "act:settings",
      category: "action",
      name: "Open Settings",
      keywords: ["settings", "preferences", "config"],
      icon: Settings,
      shortcut: SHORTCUTS.openSettings,
      primary: true,
      run: () => useLayoutStore.getState().setSettingsCenterOpen(true),
    },
  );

  // Actions: settings sub-tabs
  cmds.push(
    {
      id: "act:settings:general",
      category: "action",
      name: "Settings \u203A General",
      subtitle: "General preferences",
      keywords: ["settings", "general", "preferences"],
      icon: Settings,
      primary: false,
      run: () => useLayoutStore.getState().setSettingsCenterOpen(true, "general"),
    },
    {
      id: "act:settings:notifications",
      category: "action",
      name: "Settings \u203A Notifications",
      subtitle: "Notification preferences",
      keywords: ["settings", "notifications", "toast", "alerts"],
      icon: Bell,
      primary: false,
      run: () => useLayoutStore.getState().setSettingsCenterOpen(true, "notifications"),
    },
    {
      id: "act:settings:user-agent",
      category: "action",
      name: "Settings \u203A User Agent",
      subtitle: "User-Agent string",
      keywords: ["settings", "user-agent", "ua", "http"],
      icon: Settings,
      primary: false,
      run: () => useLayoutStore.getState().setSettingsCenterOpen(true, "user-agent"),
    },
    {
      id: "act:settings:packet-monitor",
      category: "action",
      name: "Settings \u203A Packet Monitor",
      subtitle: "Capture pipeline settings",
      keywords: ["settings", "packet", "monitor", "capture", "pipeline"],
      icon: Network,
      primary: false,
      run: () => useLayoutStore.getState().setSettingsCenterOpen(true, "packet-monitor"),
    },
    {
      id: "act:settings:fax",
      category: "action",
      name: "Settings \u203A Fax",
      subtitle: "Fax & T.38 settings",
      keywords: ["settings", "fax", "t38", "t30", "baud"],
      icon: Printer,
      primary: false,
      run: () => useLayoutStore.getState().setSettingsCenterOpen(true, "fax"),
    },
  );

  // Actions: utilities
  const utilityActions: PaletteItem[] = [];
  if (mcpEnabled) {
    utilityActions.push(
      {
        id: "act:mcp:view",
        category: "action",
        name: "Open MCP Integration",
        subtitle: "Tools > MCP",
        keywords: ["mcp", "model context protocol", "tools", "orchestration", "agent"],
        icon: Activity,
        primary: true,
        run: () => navigateTo("tools", "mcp"),
      },
      {
        id: "act:mcp:refresh",
        category: "action",
        name: "Refresh MCP Profiles",
        subtitle: "Reload profile and status state",
        keywords: ["mcp", "refresh", "profiles", "status", "reconnect"],
        icon: RefreshCw,
        primary: false,
        run: () => {
          void useMcpStore.getState().refreshAll();
        },
      },
    );
  }
  cmds.push(
    ...utilityActions,
    {
      id: "act:shortcuts",
      category: "action",
      name: "Keyboard Shortcuts",
      keywords: ["keyboard", "shortcuts", "hotkeys", "bindings", "help"],
      icon: Keyboard,
      shortcut: SHORTCUTS.shortcutsPanel,
      primary: true,
      run: () => useLayoutStore.getState().setShortcutsPanelOpen(true),
    },
    {
      id: "act:clear",
      category: "action",
      name: "Clear All Views",
      subtitle: "Reset trace, timeline & calls",
      keywords: ["clear", "reset", "clean", "views", "trace", "timeline"],
      icon: Eraser,
      shortcut: SHORTCUTS.clearAllViews,
      primary: true,
      run: () => {
        useTroubleshootingStore.getState().clearTrace();
        useTroubleshootingStore.getState().clearTimeline();
        useSoftphoneStore.getState().clearCalls();
      },
    },
    {
      id: "act:sidebar",
      category: "action",
      name: "Toggle Sidebar",
      subtitle: "Expand or collapse sidebar",
      keywords: ["sidebar", "toggle", "collapse", "expand", "panel"],
      icon: PanelLeft,
      shortcut: SHORTCUTS.toggleSidebar,
      primary: true,
      run: () => useSidebarStore.getState().toggle(),
    },
    {
      id: "act:refresh",
      category: "action",
      name: "Refresh UI",
      subtitle: "Force reload with load screen",
      keywords: ["refresh", "reload", "restart", "reboot", "ui", "force"],
      icon: RefreshCw,
      shortcut: SHORTCUTS.refreshUi,
      primary: true,
      run: () => useLayoutStore.getState().triggerReload(),
    },
  );

  return cmds;
}

// ─── Dynamic command access ────────────────────────────────────────────────

/** Build the static command list on demand to reflect feature-flag changes. */
export function getStaticCommands(): PaletteItem[] {
  return buildCommands();
}

/** Build a fresh Fuse index to reflect command visibility changes. */
export function getStaticFuse(): Fuse<PaletteItem> {
  return new Fuse(getStaticCommands(), FUSE_OPTS);
}

/** Primary navigation items for default view. */
export function getDefaultNav(): PaletteItem[] {
  return getStaticCommands().filter(
    (c) => c.category === "navigation" && c.primary !== false,
  );
}

/** Primary action items for default view. */
export function getDefaultAct(): PaletteItem[] {
  return getStaticCommands().filter(
    (c) => c.category === "action" && c.primary !== false,
  );
}
