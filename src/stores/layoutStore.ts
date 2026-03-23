import { create } from "zustand";
import type { ReactNode } from "react";
import { isFeatureFlagEnabled } from "@/lib/featureFlagCache";
import { FEATURE_FLAG_KNOWLEDGE_BASE_UI } from "@/lib/featureFlags";

export type SettingsCenterTab =
  | "general"
  | "notifications"
  | "user-agent"
  | "packet-monitor"
  | "fax"
  | "terminal"
  | "soft-phone";

interface LayoutState {
  notificationsCenterOpen: boolean;
  notesCenterOpen: boolean;
  settingsCenterOpen: boolean;
  settingsCenterTab: SettingsCenterTab;
  kbCenterOpen: boolean;
  searchOpen: boolean;
  shortcutsPanelOpen: boolean;
  terminalOpen: boolean;
  terminalMinimized: boolean;
  /** Tabs to render in the main header (set by active tool) */
  headerTabs: ReactNode | null;
  /** Incrementing counter — each bump triggers a full UI reload with load screen. */
  reloadCounter: number;
  setNotificationsCenterOpen: (open: boolean) => void;
  setNotesCenterOpen: (open: boolean) => void;
  setSettingsCenterOpen: (open: boolean, tab?: SettingsCenterTab) => void;
  setSettingsCenterTab: (tab: SettingsCenterTab) => void;
  setKbCenterOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setShortcutsPanelOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  setTerminalMinimized: (minimized: boolean) => void;
  setHeaderTabs: (tabs: ReactNode | null) => void;
  /** Trigger a full UI reload (shows load screen and re-preloads tools). */
  triggerReload: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  notificationsCenterOpen: false,
  notesCenterOpen: false,
  settingsCenterOpen: false,
  settingsCenterTab: "general",
  kbCenterOpen: false,
  searchOpen: false,
  shortcutsPanelOpen: false,
  terminalOpen: false,
  terminalMinimized: false,
  headerTabs: null,
  reloadCounter: 0,
  setNotificationsCenterOpen: (open) =>
    set(() => ({
      notificationsCenterOpen: open,
      ...(open ? { notesCenterOpen: false, settingsCenterOpen: false, kbCenterOpen: false } : {}),
    })),
  setNotesCenterOpen: (open) =>
    set(() => ({
      notesCenterOpen: open,
      ...(open ? { notificationsCenterOpen: false, settingsCenterOpen: false, kbCenterOpen: false } : {}),
    })),
  setSettingsCenterOpen: (open, tab) =>
    set(() => ({
      settingsCenterOpen: open,
      ...(open ? { notificationsCenterOpen: false, notesCenterOpen: false, kbCenterOpen: false } : {}),
      ...(open && tab != null ? { settingsCenterTab: tab } : {}),
    })),
  setSettingsCenterTab: (tab) => set({ settingsCenterTab: tab }),
  setKbCenterOpen: (open) =>
    set((s) => {
      if (open && !isFeatureFlagEnabled(FEATURE_FLAG_KNOWLEDGE_BASE_UI, false)) {
        return s;
      }
      return {
        kbCenterOpen: open,
        ...(open ? { notificationsCenterOpen: false, notesCenterOpen: false, settingsCenterOpen: false } : {}),
      };
    }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setShortcutsPanelOpen: (open) => set({ shortcutsPanelOpen: open }),
  setTerminalOpen: (open) => set({ terminalOpen: open, ...(open ? {} : { terminalMinimized: false }) }),
  setTerminalMinimized: (minimized) => set({ terminalMinimized: minimized }),
  setHeaderTabs: (tabs) => set({ headerTabs: tabs }),
  triggerReload: () => set((s) => ({ reloadCounter: s.reloadCounter + 1 })),
}));
