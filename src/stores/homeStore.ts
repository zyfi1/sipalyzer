import { create } from "zustand";
import type { LayoutItem } from "react-grid-layout";
import {
  isNavigationSubviewVisible,
  isNavigationToolFeatureVisible,
} from "@/lib/navigationCatalog";
import { toolRegistry } from "@/lib/toolRegistry";

export interface HomeSectionConfig {
  id: string;
  enabled: boolean;
}

export interface HomeQuickActionItem {
  id: string;
  toolId: string;
  subviewId?: string;
  label?: string;
  enabled: boolean;
}

export type HomeWidgetId = "quick-launch" | "capture-import" | "quick-note";

export interface HomeWidgetItem {
  id: HomeWidgetId;
  enabled: boolean;
}

export function makeHomeQuickActionId(toolId: string, subviewId?: string): string {
  return subviewId ? `${toolId}::${subviewId}` : toolId;
}

export function buildDefaultHomeQuickActions(): HomeQuickActionItem[] {
  const allActions = toolRegistry.getAll().filter((tool) => !tool.hidden).flatMap((tool) => {
    if (!isNavigationToolFeatureVisible(tool.id)) return [];
    const baseAction: HomeQuickActionItem = {
      id: makeHomeQuickActionId(tool.id),
      toolId: tool.id,
      label: tool.name,
      enabled: false,
    };
    const subviewActions = (tool.subviews ?? [])
      .filter((subview) => isNavigationSubviewVisible(tool.id, subview.id))
      .map<HomeQuickActionItem>((subview) => ({
        id: makeHomeQuickActionId(tool.id, subview.id),
        toolId: tool.id,
        subviewId: subview.id,
        label: `${tool.name} - ${subview.label}`,
        enabled: false,
      }));
    return [baseAction, ...subviewActions];
  });
  return allActions.map((action, index) => ({
    ...action,
    enabled: index < 6,
  }));
}

export function reconcileHomeQuickActions(
  actions: HomeQuickActionItem[],
  defaults: HomeQuickActionItem[] = buildDefaultHomeQuickActions(),
): HomeQuickActionItem[] {
  if (defaults.length === 0) return actions;
  const defaultsById = new Map(defaults.map((item) => [item.id, item]));
  const merged: HomeQuickActionItem[] = [];

  for (const action of actions) {
    const base = defaultsById.get(action.id);
    if (!base) continue;
    merged.push({
      ...base,
      enabled: action.enabled,
      label: action.label ?? base.label,
    });
    defaultsById.delete(action.id);
  }

  for (const missing of defaultsById.values()) {
    merged.push(missing);
  }
  let enabledCount = 0;
  return merged.map((action) => {
    if (!action.enabled) return action;
    enabledCount += 1;
    if (enabledCount <= 6) return action;
    return { ...action, enabled: false };
  });
}

export function defaultHomeWidgets(): HomeWidgetItem[] {
  return [
    { id: "quick-launch", enabled: true },
    { id: "capture-import", enabled: true },
    { id: "quick-note", enabled: true },
  ];
}

export function reconcileHomeWidgets(
  widgets: HomeWidgetItem[],
  defaults: HomeWidgetItem[] = defaultHomeWidgets(),
): HomeWidgetItem[] {
  const defaultsById = new Map(defaults.map((item) => [item.id, item]));
  const merged: HomeWidgetItem[] = [];
  for (const widget of widgets) {
    const base = defaultsById.get(widget.id);
    if (!base) continue;
    merged.push({
      ...base,
      enabled: widget.enabled,
    });
    defaultsById.delete(widget.id);
  }
  for (const missing of defaultsById.values()) {
    merged.push(missing);
  }
  return merged;
}

export interface HeroConfig {
  showGreeting: boolean;
  showClock: boolean;
  showSeconds: boolean;
  showDate: boolean;
  showWeather: boolean;
  showWeatherDescription: boolean;
  showLocation: boolean;
  showWind: boolean;
  showFeelsLike: boolean;
  showHumidity: boolean;
  showMoonPhase: boolean;
  showForecast: boolean;
  forecastDays: number;
  showForecastRainChance: boolean;
  showWeatherEffects: boolean;
}

export type HomeMode = "hero" | "dashboard";
export type HomePreset = "focus" | "operations" | "monitoring";

export const DEFAULT_HERO: HeroConfig = {
  showGreeting: true,
  showClock: true,
  showSeconds: false,
  showDate: true,
  showWeather: true,
  showWeatherDescription: true,
  showLocation: true,
  showWind: true,
  showFeelsLike: true,
  showHumidity: true,
  showMoonPhase: true,
  showForecast: true,
  forecastDays: 3,
  showForecastRainChance: true,
  showWeatherEffects: true,
};

export interface HomeState {
  sections: HomeSectionConfig[];
  layouts: LayoutItem[];
  homeQuickActions: HomeQuickActionItem[];
  homeWidgets: HomeWidgetItem[];
  hero: HeroConfig;
  homeMode: HomeMode;
  homePreset: HomePreset;
  activityMonitorClearedAt: number;
  dismissedActivityMonitorIds: string[];
  // Backward-compatible aliases (legacy naming)
  recentActivityClearedAt: number;
  dismissedRecentActivityIds: string[];
  editing: boolean;
  topPaneOpen: boolean;

  setSections: (sections: HomeSectionConfig[]) => void;
  toggleSection: (id: string) => void;
  setLayouts: (layouts: LayoutItem[]) => void;
  setHomeQuickActions: (actions: HomeQuickActionItem[]) => void;
  setHomeWidgets: (widgets: HomeWidgetItem[]) => void;
  toggleHomeWidget: (id: HomeWidgetId, enabled?: boolean) => void;
  reorderHomeWidget: (fromIndex: number, toIndex: number) => void;
  resetHomeWidgets: () => void;
  updateHomeQuickAction: (
    id: string,
    patch: Partial<Omit<HomeQuickActionItem, "id">>,
  ) => void;
  reorderHomeQuickActions: (fromIndex: number, toIndex: number) => void;
  toggleHomeQuickAction: (id: string, enabled?: boolean) => void;
  addHomeQuickAction: (action: HomeQuickActionItem) => void;
  removeHomeQuickAction: (id: string) => void;
  resetHomeQuickActions: () => void;
  syncHomeQuickActions: () => void;
  setHero: (hero: Partial<HeroConfig>) => void;
  setHomeMode: (mode: HomeMode) => void;
  setHomePreset: (preset: HomePreset) => void;
  toggleHomeMode: () => void;
  showHero: () => void;
  showDashboard: () => void;
  setActivityMonitorClearedAt: (timestamp: number) => void;
  dismissActivityMonitorItem: (id: string) => void;
  restoreActivityMonitorItem: (id: string) => void;
  clearDismissedActivityMonitorItems: () => void;
  // Backward-compatible aliases (legacy naming)
  setRecentActivityClearedAt: (timestamp: number) => void;
  dismissRecentActivityItem: (id: string) => void;
  restoreRecentActivityItem: (id: string) => void;
  clearDismissedRecentActivityItems: () => void;
  setEditing: (editing: boolean) => void;
  setTopPaneOpen: (open: boolean) => void;
  toggleTopPaneOpen: () => void;
  resetToDefaults: () => void;
}

export const DEFAULT_SECTIONS: HomeSectionConfig[] = [
  { id: "registration-health", enabled: true },
  { id: "agent-fleet", enabled: true },
  { id: "recent-activity", enabled: true },
  { id: "network-at-glance", enabled: true },
  { id: "quick-launch", enabled: true },
  { id: "last-speed-test", enabled: false },
  { id: "active-captures", enabled: false },
  { id: "quick-notes", enabled: false },
  { id: "error-summary", enabled: false },
  { id: "recent-sessions", enabled: false },
  { id: "scheduled-tasks", enabled: false },
  { id: "kb-spotlight", enabled: false },
];

export const DEFAULT_LAYOUTS: LayoutItem[] = [
  { i: "registration-health", x: 0, y: 0,  w: 1, h: 4, minW: 1, minH: 2 },
  { i: "agent-fleet",         x: 1, y: 0,  w: 1, h: 4, minW: 1, minH: 2 },
  { i: "network-at-glance",   x: 2, y: 0,  w: 1, h: 4, minW: 1, minH: 3 },
  { i: "recent-activity",     x: 0, y: 4,  w: 3, h: 5, minW: 2, minH: 3 },
  { i: "quick-launch",        x: 0, y: 9,  w: 3, h: 4, minW: 2, minH: 2 },
  { i: "last-speed-test",     x: 0, y: 13, w: 1, h: 4, minW: 1, minH: 3 },
  { i: "active-captures",     x: 1, y: 13, w: 1, h: 4, minW: 1, minH: 2 },
  { i: "error-summary",       x: 2, y: 13, w: 1, h: 4, minW: 1, minH: 2 },
  { i: "quick-notes",         x: 0, y: 17, w: 1, h: 4, minW: 1, minH: 2 },
  { i: "recent-sessions",     x: 1, y: 17, w: 1, h: 4, minW: 1, minH: 2 },
  { i: "scheduled-tasks",     x: 2, y: 17, w: 1, h: 4, minW: 1, minH: 2 },
  { i: "kb-spotlight",        x: 0, y: 21, w: 3, h: 4, minW: 1, minH: 2 },
];

const HOME_COLS = 3;

function normalizeLayoutItem(item: LayoutItem): LayoutItem {
  const minW = Math.max(1, item.minW ?? 1);
  const minH = Math.max(1, item.minH ?? 1);
  const maxW = HOME_COLS;
  const w = Math.min(HOME_COLS, Math.max(minW, item.w ?? minW));
  const h = Math.max(minH, item.h ?? minH);
  const x = Math.max(0, Math.min((item.x ?? 0), HOME_COLS - w));
  const y = Math.max(0, item.y ?? 0);
  return { ...item, x, y, w, h, minW, minH, maxW };
}

function normalizeLayouts(layouts: LayoutItem[]): LayoutItem[] {
  const seen = new Set<string>();
  return layouts
    .filter((l) => {
      if (!l?.i || seen.has(l.i)) return false;
      seen.add(l.i);
      return true;
    })
    .map(normalizeLayoutItem);
}

export function getLayoutForSection(layouts: LayoutItem[], id: string): LayoutItem {
  const existing = layouts.find((l) => l.i === id);
  if (existing) return normalizeLayoutItem(existing);
  const def = DEFAULT_LAYOUTS.find((l) => l.i === id);
  if (def) return normalizeLayoutItem({ ...def });
  return normalizeLayoutItem({ i: id, x: 0, y: 999, w: 2, h: 3, minW: 1, minH: 2 });
}

export const useHomeStore = create<HomeState>((set) => ({
  sections: DEFAULT_SECTIONS,
  layouts: DEFAULT_LAYOUTS.map((l) => ({ ...l })),
  homeQuickActions: buildDefaultHomeQuickActions(),
  homeWidgets: defaultHomeWidgets(),
  hero: DEFAULT_HERO,
  homeMode: "hero",
  homePreset: "focus",
  activityMonitorClearedAt: 0,
  dismissedActivityMonitorIds: [],
  recentActivityClearedAt: 0,
  dismissedRecentActivityIds: [],
  editing: false,
  topPaneOpen: true,

  setSections: (sections) => set({ sections }),

  toggleSection: (id) =>
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.id === id ? { ...sec, enabled: !sec.enabled } : sec,
      ),
    })),

  setLayouts: (layouts) => set({ layouts: normalizeLayouts(layouts) }),
  setHomeQuickActions: (actions) =>
    set({ homeQuickActions: reconcileHomeQuickActions(actions) }),
  setHomeWidgets: (widgets) =>
    set({ homeWidgets: reconcileHomeWidgets(widgets) }),
  toggleHomeWidget: (id, enabled) =>
    set((s) => ({
      homeWidgets: reconcileHomeWidgets(
        s.homeWidgets.map((widget) =>
          widget.id === id
            ? { ...widget, enabled: enabled ?? !widget.enabled }
            : widget,
        ),
      ),
    })),
  reorderHomeWidget: (fromIndex, toIndex) =>
    set((s) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= s.homeWidgets.length ||
        toIndex >= s.homeWidgets.length ||
        fromIndex === toIndex
      ) {
        return s;
      }
      const next = [...s.homeWidgets];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return s;
      next.splice(toIndex, 0, moved);
      return { homeWidgets: next };
    }),
  resetHomeWidgets: () =>
    set({ homeWidgets: defaultHomeWidgets() }),
  updateHomeQuickAction: (id, patch) =>
    set((s) => ({
      homeQuickActions: reconcileHomeQuickActions(
        s.homeQuickActions.map((action) =>
          action.id === id ? { ...action, ...patch, id: action.id } : action,
        ),
      ),
    })),
  reorderHomeQuickActions: (fromIndex, toIndex) =>
    set((s) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= s.homeQuickActions.length ||
        toIndex >= s.homeQuickActions.length ||
        fromIndex === toIndex
      ) {
        return s;
      }
      const next = [...s.homeQuickActions];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return s;
      next.splice(toIndex, 0, moved);
      return { homeQuickActions: next };
    }),
  toggleHomeQuickAction: (id, enabled) =>
    set((s) => ({
      homeQuickActions: s.homeQuickActions.map((action) =>
        action.id === id
          ? { ...action, enabled: enabled ?? !action.enabled }
          : action,
      ),
    })),
  addHomeQuickAction: (action) =>
    set((s) => ({
      homeQuickActions: reconcileHomeQuickActions([
        ...s.homeQuickActions.filter((item) => item.id !== action.id),
        action,
      ]),
    })),
  removeHomeQuickAction: (id) =>
    set((s) => ({
      homeQuickActions: s.homeQuickActions.filter((action) => action.id !== id),
    })),
  resetHomeQuickActions: () =>
    set({ homeQuickActions: buildDefaultHomeQuickActions() }),
  syncHomeQuickActions: () =>
    set((s) => ({ homeQuickActions: reconcileHomeQuickActions(s.homeQuickActions) })),

  setHero: (patch) =>
    set((s) => ({ hero: { ...s.hero, ...patch } })),

  setHomeMode: (homeMode) => set({ homeMode }),
  setHomePreset: (homePreset) => set({ homePreset }),
  toggleHomeMode: () =>
    set((s) => ({ homeMode: s.homeMode === "hero" ? "dashboard" : "hero" })),
  showHero: () => set({ homeMode: "hero" }),
  showDashboard: () => set({ homeMode: "dashboard" }),

  setActivityMonitorClearedAt: (timestamp) =>
    set({ activityMonitorClearedAt: timestamp, recentActivityClearedAt: timestamp }),
  dismissActivityMonitorItem: (id) =>
    set((s) => ({
      dismissedActivityMonitorIds: s.dismissedActivityMonitorIds.includes(id)
        ? s.dismissedActivityMonitorIds
        : [...s.dismissedActivityMonitorIds, id],
      dismissedRecentActivityIds: s.dismissedActivityMonitorIds.includes(id)
        ? s.dismissedActivityMonitorIds
        : [...s.dismissedActivityMonitorIds, id],
    })),
  restoreActivityMonitorItem: (id) =>
    set((s) => ({
      dismissedActivityMonitorIds: s.dismissedActivityMonitorIds.filter((v) => v !== id),
      dismissedRecentActivityIds: s.dismissedActivityMonitorIds.filter((v) => v !== id),
    })),
  clearDismissedActivityMonitorItems: () =>
    set({ dismissedActivityMonitorIds: [], dismissedRecentActivityIds: [] }),
  setRecentActivityClearedAt: (timestamp) =>
    set({ activityMonitorClearedAt: timestamp, recentActivityClearedAt: timestamp }),
  dismissRecentActivityItem: (id) =>
    set((s) => ({
      dismissedActivityMonitorIds: s.dismissedActivityMonitorIds.includes(id)
        ? s.dismissedActivityMonitorIds
        : [...s.dismissedActivityMonitorIds, id],
      dismissedRecentActivityIds: s.dismissedActivityMonitorIds.includes(id)
        ? s.dismissedActivityMonitorIds
        : [...s.dismissedActivityMonitorIds, id],
    })),
  restoreRecentActivityItem: (id) =>
    set((s) => ({
      dismissedActivityMonitorIds: s.dismissedActivityMonitorIds.filter((v) => v !== id),
      dismissedRecentActivityIds: s.dismissedActivityMonitorIds.filter((v) => v !== id),
    })),
  clearDismissedRecentActivityItems: () =>
    set({ dismissedActivityMonitorIds: [], dismissedRecentActivityIds: [] }),

  setEditing: (editing) => set({ editing }),

  setTopPaneOpen: (open) => set({ topPaneOpen: open }),
  toggleTopPaneOpen: () => set((s) => ({ topPaneOpen: !s.topPaneOpen })),

  resetToDefaults: () =>
    set({
      sections: DEFAULT_SECTIONS,
      layouts: DEFAULT_LAYOUTS.map((l) => ({ ...l })),
      homeQuickActions: buildDefaultHomeQuickActions(),
      homeWidgets: defaultHomeWidgets(),
      hero: DEFAULT_HERO,
      homeMode: "hero",
      homePreset: "focus",
      activityMonitorClearedAt: 0,
      dismissedActivityMonitorIds: [],
      recentActivityClearedAt: 0,
      dismissedRecentActivityIds: [],
      topPaneOpen: true,
    }),
}));
