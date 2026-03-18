/**
 * Registers app-wide keyboard shortcuts (search, shortcuts panel, tool nav, Escape).
 * Use once in App.
 */

import { useEffect } from "react";
import { shortcutFromEvent, SHORTCUTS } from "@/lib/shortcuts";
import { useLayoutStore } from "@/stores/layoutStore";
import { useToolStore } from "@/stores/toolStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useSidebarStore } from "@/stores/sidebarStore";
import { HOME_TOOL_ID } from "@/lib/toolRegistry";
import { navigateTo } from "@/lib/navigation";

export function useAppShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcut = shortcutFromEvent(e);

      if (shortcut === SHORTCUTS.search) {
        e.preventDefault();
        useLayoutStore.getState().setSearchOpen(true);
        return;
      }
      if (shortcut === SHORTCUTS.shortcutsPanel || shortcut === SHORTCUTS.shortcutsPanelAlt) {
        e.preventDefault();
        useLayoutStore.getState().setShortcutsPanelOpen(true);
        return;
      }
      if (shortcut === SHORTCUTS.escape) {
        const layout = useLayoutStore.getState();
        if (layout.shortcutsPanelOpen) {
          e.preventDefault();
          layout.setShortcutsPanelOpen(false);
          return;
        }
        if (layout.searchOpen) {
          e.preventDefault();
          layout.setSearchOpen(false);
          return;
        }
        if (layout.settingsCenterOpen) {
          e.preventDefault();
          layout.setSettingsCenterOpen(false);
          return;
        }
        if (layout.notesCenterOpen) {
          e.preventDefault();
          layout.setNotesCenterOpen(false);
          return;
        }
        if (layout.notificationsCenterOpen) {
          e.preventDefault();
          layout.setNotificationsCenterOpen(false);
          return;
        }
        return;
      }

      // ── Tool navigation ──
      if (shortcut === SHORTCUTS.goHome) {
        e.preventDefault();
        useToolStore.getState().setActiveTool(HOME_TOOL_ID);
        return;
      }
      if (shortcut === SHORTCUTS.goPacketCapture) {
        e.preventDefault();
        navigateTo("packet-capture", "monitor");
        return;
      }
      if (shortcut === SHORTCUTS.goRegistration) {
        e.preventDefault();
        useToolStore.getState().setActiveTool("registration");
        return;
      }
      if (shortcut === SHORTCUTS.goSoftPhone) {
        e.preventDefault();
        useToolStore.getState().setActiveTool("soft-phone");
        return;
      }
      if (shortcut === SHORTCUTS.goFaxCenter) {
        e.preventDefault();
        useToolStore.getState().setActiveTool("fax-center");
        return;
      }
      if (shortcut === SHORTCUTS.goProvisionViewer) {
        e.preventDefault();
        useToolStore.getState().setActiveTool("provision-viewer");
        return;
      }
      if (shortcut === SHORTCUTS.goNetworkTest) {
        e.preventDefault();
        useToolStore.getState().setActiveTool("network");
        return;
      }

      // ── Dedicated per-view navigation ──
      const viewActions: Record<string, () => void> = {
        [SHORTCUTS.viewPacketMonitor]: () => navigateTo("packet-capture", "monitor"),
        [SHORTCUTS.viewPacketCaptures]: () => navigateTo("packet-capture", "captures"),
        [SHORTCUTS.viewPacketViewer]: () => navigateTo("packet-capture", "viewer"),
        [SHORTCUTS.viewPacketAnalysis]: () => navigateTo("packet-capture", "analysis"),
        [SHORTCUTS.viewPacketRemote]: () => navigateTo("packet-capture", "remote"),
        [SHORTCUTS.viewPacketScheduled]: () => navigateTo("packet-capture", "scheduled"),

        [SHORTCUTS.viewSoftPhone]: () => navigateTo("soft-phone", "phone"),
        [SHORTCUTS.viewSoftContacts]: () => navigateTo("soft-phone", "contacts"),
        [SHORTCUTS.viewSoftRecordings]: () => navigateTo("soft-phone", "recordings"),

        [SHORTCUTS.viewFaxSend]: () => navigateTo("fax-center", "send"),
        [SHORTCUTS.viewFaxHistory]: () => navigateTo("fax-center", "faxes"),

        [SHORTCUTS.viewProvisionMain]: () => navigateTo("provision-viewer", "provision"),
        [SHORTCUTS.viewProvisionContacts]: () => navigateTo("provision-viewer", "contacts"),
        [SHORTCUTS.viewProvisionDevice]: () => navigateTo("provision-viewer", "device"),
        [SHORTCUTS.viewProvisionDiff]: () => navigateTo("provision-viewer", "diff"),
        [SHORTCUTS.viewProvisionDesigner]: () => navigateTo("provision-viewer", "designer"),

        [SHORTCUTS.viewNetworkConnectivity]: () => navigateTo("network", "path-performance"),
        [SHORTCUTS.viewNetworkProbe]: () => navigateTo("network", "dns-access"),
        [SHORTCUTS.viewNetworkDevices]: () => navigateTo("network", "discovery"),
        [SHORTCUTS.viewNetworkVoip]: () => navigateTo("network", "dns-access"),
        [SHORTCUTS.viewNetworkMulticast]: () => navigateTo("network", "multicast"),

        [SHORTCUTS.viewRemoteOverview]: () => navigateTo("remote-agent", "overview"),
        [SHORTCUTS.viewRemoteRegistry]: () => navigateTo("remote-agent", "registry"),
        [SHORTCUTS.viewRemoteActivity]: () => navigateTo("remote-agent", "activity"),

        [SHORTCUTS.viewComposerRequests]: () => navigateTo("composer", "requests"),
        [SHORTCUTS.viewComposerSsh]: () => navigateTo("composer", "ssh"),
        [SHORTCUTS.viewComposerHistory]: () => navigateTo("composer", "history"),
        [SHORTCUTS.viewComposerDocs]: () => navigateTo("composer", "docs"),

        [SHORTCUTS.viewToolsSyslog]: () => navigateTo("tools", "syslog"),
        [SHORTCUTS.viewToolsLogs]: () => navigateTo("tools", "logs"),
        [SHORTCUTS.viewToolsFileServer]: () => navigateTo("tools", "file-server"),
        [SHORTCUTS.viewToolsFirmware]: () => navigateTo("tools", "firmware"),
        [SHORTCUTS.viewToolsPasswordGen]: () => navigateTo("tools", "password-gen"),
        [SHORTCUTS.viewToolsMcp]: () => navigateTo("tools", "mcp"),
      };

      const viewAction = viewActions[shortcut];
      if (viewAction) {
        e.preventDefault();
        viewAction();
        return;
      }

      // ── Panels ──
      if (shortcut === SHORTCUTS.openNotes) {
        e.preventDefault();
        const layout = useLayoutStore.getState();
        layout.setNotesCenterOpen(!layout.notesCenterOpen);
        return;
      }
      if (shortcut === SHORTCUTS.openNotifications) {
        e.preventDefault();
        const layout = useLayoutStore.getState();
        layout.setNotificationsCenterOpen(!layout.notificationsCenterOpen);
        return;
      }
      if (shortcut === SHORTCUTS.openSettings) {
        e.preventDefault();
        const layout = useLayoutStore.getState();
        layout.setSettingsCenterOpen(!layout.settingsCenterOpen);
        return;
      }
      if (shortcut === SHORTCUTS.toggleSidebar) {
        e.preventDefault();
        useSidebarStore.getState().toggle();
        return;
      }

      // ── Utilities ──
      if (shortcut === SHORTCUTS.refreshUi) {
        e.preventDefault();
        useLayoutStore.getState().triggerReload();
        return;
      }
      if (shortcut === SHORTCUTS.clearAllViews) {
        e.preventDefault();
        useTroubleshootingStore.getState().clearTrace();
        useTroubleshootingStore.getState().clearTimeline();
        useSoftphoneStore.getState().clearCalls();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
