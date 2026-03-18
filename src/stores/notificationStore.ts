import { create } from "zustand";

export type NotificationType = "success" | "error" | "info" | "warning" | "system";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export type NotificationSource =
  | "registration"
  | "packet-capture"
  | "soft-phone"
  | "fax-center"
  | "network"
  | "network-test"
  | "provision-viewer"
  | "troubleshooting"
  | "composer"
  | "forensics"
  | "sip-discovery"
  | "network-devices"
  | "tools"
  | "settings"
  | "terminal"
  | "notes"
  | "system";

/** Human-readable labels for each notification source */
export const SOURCE_LABELS: Record<NotificationSource, string> = {
  "registration": "Registration",
  "packet-capture": "Packet Capture",
  "soft-phone": "Soft Phone",
  "fax-center": "Fax Center",
  "network": "Network",
  "network-test": "Network Test",
  "provision-viewer": "Provision Viewer",
  "troubleshooting": "Troubleshooting",
  "composer": "Composer",
  "forensics": "Forensics",
  "sip-discovery": "SIP Discovery",
  "network-devices": "Network Devices",
  "tools": "Tools",
  "settings": "Settings",
  "terminal": "Terminal",
  "notes": "Notes",
  "system": "System",
};

export interface NotificationNavigation {
  tool: string;
  view?: string;
  registrarId?: string;
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description?: string;
  timestamp: number;
  read: boolean;
  persistent?: boolean; // Don't auto-dismiss
  actions?: NotificationAction[];
  navigation?: NotificationNavigation; // Navigation target for "View" button
  metadata?: Record<string, unknown>;
  /** Which tool/feature generated this notification */
  source?: NotificationSource;
  /** Priority level — urgent notifications get special treatment */
  priority?: NotificationPriority;
  /** Whether the notification is pinned to the top */
  pinned?: boolean;
  /** Group key — notifications with the same group key can be collapsed */
  group?: string;
  /** Number of times this notification occurred */
  occurrenceCount?: number;
}

export interface NotificationAction {
  label: string;
  action: () => void;
  variant?: "primary" | "secondary";
}

export interface NotificationSettings {
  position: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  autoDismiss: boolean;
  autoDismissDuration: number; // milliseconds
  soundEnabled: boolean;
  doNotDisturb: boolean;
  maxHistory: number;
  showToasts: boolean;
  showInCenter: boolean;
  /** Group similar notifications together */
  groupSimilar: boolean;
  /** Sources that are muted (no toasts, still saved to center) */
  mutedSources: NotificationSource[];
}

export type NotificationFilter = {
  type?: NotificationType;
  source?: NotificationSource;
  unreadOnly?: boolean;
  pinnedOnly?: boolean;
};

/** Time-based grouping for notification center */
export type TimeGroup = "pinned" | "today" | "yesterday" | "this-week" | "older";

export interface GroupedNotifications {
  key: TimeGroup;
  label: string;
  notifications: Notification[];
}

interface NotificationState {
  notifications: Notification[];
  settings: NotificationSettings;
  unreadCount: number;
  
  // Actions
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "read">) => string;
  markAsRead: (id: string) => void;
  markAsUnread: (id: string) => void;
  markAllAsRead: () => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  dismissRead: () => void;
  clearHistory: () => void;
  updateSettings: (settings: Partial<NotificationSettings>) => void;
  togglePin: (id: string) => void;
  toggleSourceMute: (source: NotificationSource) => void;
  getUnreadCount: () => number;
  getNotifications: (filter?: NotificationFilter) => Notification[];
  getGroupedNotifications: (filter?: NotificationFilter) => GroupedNotifications[];
  getUnreadCountByType: () => Record<NotificationType, number>;
  getUnreadCountBySource: () => Partial<Record<NotificationSource, number>>;
  hasUrgent: () => boolean;
}

const defaultSettings: NotificationSettings = {
  position: "top-right",
  autoDismiss: true,
  autoDismissDuration: 5000,
  soundEnabled: false,
  doNotDisturb: false,
  maxHistory: 100,
  showToasts: true,
  showInCenter: true,
  groupSimilar: true,
  mutedSources: [],
};

function getTimeGroup(timestamp: number): TimeGroup {
  const now = new Date();
  
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - (now.getDay() * 86400000);
  
  if (timestamp >= todayStart) return "today";
  if (timestamp >= yesterdayStart) return "yesterday";
  if (timestamp >= weekStart) return "this-week";
  return "older";
}

const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This Week",
  older: "Older",
};

function computeUnreadCount(notifications: Notification[]): number {
  return notifications.filter((n) => !n.read).length;
}

const COALESCE_WINDOW_MS = 3 * 60 * 1000; // 3 minutes for implicit similarity

function priorityRank(priority?: NotificationPriority): number {
  switch (priority ?? "normal") {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
    default:
      return 2;
  }
}

function higherPriority(a?: NotificationPriority, b?: NotificationPriority): NotificationPriority {
  return priorityRank(a) >= priorityRank(b) ? (a ?? "normal") : (b ?? "normal");
}

function areSimilar(existing: Notification, incoming: Omit<Notification, "id" | "timestamp" | "read">, now: number): boolean {
  // Explicit grouping key takes precedence for deterministic coalescing.
  if (incoming.group && existing.group) {
    return incoming.group === existing.group && incoming.source === existing.source && incoming.type === existing.type;
  }

  // Otherwise, only coalesce near-duplicate messages within a short time window.
  if (now - existing.timestamp > COALESCE_WINDOW_MS) return false;

  return (
    existing.type === incoming.type &&
    existing.source === incoming.source &&
    existing.title === incoming.title &&
    (existing.description ?? "") === (incoming.description ?? "")
  );
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  settings: defaultSettings,
  unreadCount: 0,

  addNotification: (notification) => {
    const now = Date.now();
    const id = `notif-${now}-${Math.random().toString(36).substring(2, 9)}`;
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: now,
      read: false,
      pinned: notification.pinned ?? false,
      occurrenceCount: 1,
    };

    set((state) => {
      const similarIndex = state.notifications.findIndex((existing) =>
        areSimilar(existing, notification, now)
      );

      let notifications: Notification[];

      if (similarIndex >= 0) {
        const similar = state.notifications[similarIndex]!;
        const updatedSimilar: Notification = {
          ...similar,
          description: notification.description ?? similar.description,
          actions: notification.actions ?? similar.actions,
          navigation: notification.navigation ?? similar.navigation,
          metadata: notification.metadata ?? similar.metadata,
          persistent: notification.persistent ?? similar.persistent,
          pinned: similar.pinned || (notification.pinned ?? false),
          priority: higherPriority(similar.priority, notification.priority),
          read: false,
          timestamp: now,
          occurrenceCount: (similar.occurrenceCount ?? 1) + 1,
        };

        notifications = [
          updatedSimilar,
          ...state.notifications.filter((_, idx) => idx !== similarIndex),
        ];
      } else {
        notifications = [newNotification, ...state.notifications];
      }

      // Limit history
      const maxHistory = state.settings.maxHistory;
      const limited = notifications.slice(0, maxHistory);
      
      return {
        notifications: limited,
        unreadCount: computeUnreadCount(limited),
      };
    });

    const coalesced = get().notifications[0];
    return coalesced?.id ?? id;
  },

  markAsRead: (id) => {
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      return {
        notifications,
        unreadCount: computeUnreadCount(notifications),
      };
    });
  },

  markAsUnread: (id) => {
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: false } : n
      );
      return {
        notifications,
        unreadCount: computeUnreadCount(notifications),
      };
    });
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  dismiss: (id) => {
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount: computeUnreadCount(notifications),
      };
    });
  },

  dismissAll: () => {
    set({ notifications: [], unreadCount: 0 });
  },

  dismissRead: () => {
    set((state) => {
      const notifications = state.notifications.filter((n) => !n.read);
      return {
        notifications,
        unreadCount: computeUnreadCount(notifications),
      };
    });
  },

  clearHistory: () => {
    set({ notifications: [], unreadCount: 0 });
  },

  updateSettings: (newSettings) => {
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    }));
  },

  togglePin: (id) => {
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, pinned: !n.pinned } : n
      );
      return { notifications };
    });
  },

  toggleSourceMute: (source) => {
    set((state) => {
      const muted = state.settings.mutedSources;
      const newMuted = muted.includes(source)
        ? muted.filter((s) => s !== source)
        : [...muted, source];
      return {
        settings: { ...state.settings, mutedSources: newMuted },
      };
    });
  },

  getUnreadCount: () => {
    return get().notifications.filter((n) => !n.read).length;
  },

  getNotifications: (filter) => {
    let notifications = get().notifications;
    
    if (filter?.type) {
      notifications = notifications.filter((n) => n.type === filter.type);
    }
    
    if (filter?.source) {
      notifications = notifications.filter((n) => n.source === filter.source);
    }
    
    if (filter?.unreadOnly) {
      notifications = notifications.filter((n) => !n.read);
    }
    
    if (filter?.pinnedOnly) {
      notifications = notifications.filter((n) => n.pinned);
    }
    
    return notifications;
  },

  getGroupedNotifications: (filter) => {
    const notifications = get().getNotifications(filter);
    
    // Separate pinned and non-pinned
    const pinned = notifications.filter((n) => n.pinned);
    const unpinned = notifications.filter((n) => !n.pinned);
    
    // Group non-pinned by time
    const timeGroups = new Map<TimeGroup, Notification[]>();
    
    for (const n of unpinned) {
      const group = getTimeGroup(n.timestamp);
      const existing = timeGroups.get(group) || [];
      existing.push(n);
      timeGroups.set(group, existing);
    }
    
    const result: GroupedNotifications[] = [];
    
    if (pinned.length > 0) {
      result.push({
        key: "pinned",
        label: TIME_GROUP_LABELS.pinned,
        notifications: pinned,
      });
    }
    
    const order: TimeGroup[] = ["today", "yesterday", "this-week", "older"];
    for (const key of order) {
      const group = timeGroups.get(key);
      if (group && group.length > 0) {
        result.push({
          key,
          label: TIME_GROUP_LABELS[key],
          notifications: group,
        });
      }
    }
    
    return result;
  },

  getUnreadCountByType: () => {
    const notifications = get().notifications.filter((n) => !n.read);
    const counts: Record<NotificationType, number> = {
      success: 0,
      error: 0,
      info: 0,
      warning: 0,
      system: 0,
    };
    for (const n of notifications) {
      counts[n.type]++;
    }
    return counts;
  },

  getUnreadCountBySource: () => {
    const notifications = get().notifications.filter((n) => !n.read);
    const counts: Partial<Record<NotificationSource, number>> = {};
    for (const n of notifications) {
      if (n.source) {
        counts[n.source] = (counts[n.source] || 0) + 1;
      }
    }
    return counts;
  },

  hasUrgent: () => {
    return get().notifications.some((n) => !n.read && n.priority === "urgent");
  },
}));
