import { useState } from "react";
import {
  useNotificationStore,
  SOURCE_LABELS,
  type NotificationSource,
  type NotificationType,
} from "@/stores/notificationStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Bell,
  CheckCircle,
  XCircle,
  Info,
  AlertTriangle,
  AlertCircle,
  Clock,
  Trash,
  RotateCcw,
  Eye,
  Settings,
} from "@/lib/icons";

const TYPE_ICONS: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
  system: AlertCircle,
};

const TYPE_COLORS: Record<NotificationType, string> = {
  success: "text-success",
  error: "text-destructive",
  info: "text-blue-400",
  warning: "text-yellow-400",
  system: "text-muted-foreground",
};

const defaultSettings = {
  position: "top-right" as const,
  autoDismiss: true,
  autoDismissDuration: 5000,
  soundEnabled: false,
  doNotDisturb: false,
  maxHistory: 100,
  showToasts: true,
  showInCenter: true,
  groupSimilar: true,
  mutedSources: [] as NotificationSource[],
};

export function NotificationAdminView() {
  const notifications = useNotificationStore((s) => s.notifications);
  const settings = useNotificationStore((s) => s.settings);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const dismissAll = useNotificationStore((s) => s.dismissAll);
  const updateSettings = useNotificationStore((s) => s.updateSettings);
  const [confirmClear, setConfirmClear] = useState(false);

  const countByType: Record<NotificationType, number> = {
    success: 0,
    error: 0,
    info: 0,
    warning: 0,
    system: 0,
  };
  for (const n of notifications) {
    countByType[n.type]++;
  }

  const countBySource: Partial<Record<NotificationSource, number>> = {};
  for (const n of notifications) {
    if (n.source) {
      countBySource[n.source] = (countBySource[n.source] || 0) + 1;
    }
  }

  const recent = notifications.slice(0, 10);

  const formatTime = (ts: number) => {
    try {
      return new Date(ts).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "—";
    }
  };

  const handleClear = () => {
    if (confirmClear) {
      dismissAll();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  const handleResetSettings = () => {
    updateSettings(defaultSettings);
  };

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
      {/* ── Statistics ── */}
      <div className="ui-panel-shell rounded-lg">
        <div className="px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Notification Statistics</span>
          </div>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-caption">Total:</span>
              <span className="text-sm font-semibold tabular-nums">{notifications.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-caption">Unread:</span>
              <span className="text-sm font-semibold tabular-nums">{unreadCount}</span>
            </div>
          </div>

          {/* Per-type counts */}
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(countByType) as NotificationType[]).map((type) => {
              const Icon = TYPE_ICONS[type];
              return (
                <div
                  key={type}
                  className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1"
                >
                  <Icon className={`h-3.5 w-3.5 ${TYPE_COLORS[type]}`} />
                  <span className="text-xs capitalize">{type}</span>
                  <span className="text-xs font-semibold tabular-nums">{countByType[type]}</span>
                </div>
              );
            })}
          </div>

          {/* Per-source counts */}
          {Object.keys(countBySource).length > 0 && (
            <div>
              <span className="text-caption text-xs">By source:</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {(Object.entries(countBySource) as [NotificationSource, number][]).map(
                  ([source, count]) => (
                    <Badge key={source} variant="outline" className="text-xs gap-1">
                      {SOURCE_LABELS[source]}
                      <span className="font-semibold tabular-nums">{count}</span>
                    </Badge>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Current Settings ── */}
      <div className="ui-panel-shell rounded-lg">
        <div className="px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Current Settings</span>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-caption">Toast position</span>
              <span className="font-medium">{settings.position}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption">Auto-dismiss</span>
              <span className="font-medium">
                {settings.autoDismiss
                  ? `On (${(settings.autoDismissDuration / 1000).toFixed(1)}s)`
                  : "Off"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption">Group by time</span>
              <span className="font-medium">{settings.groupSimilar ? "On" : "Off"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption">Max history</span>
              <span className="font-medium tabular-nums">{settings.maxHistory}</span>
            </div>
            {settings.mutedSources.length > 0 && (
              <div className="col-span-2 flex items-center gap-2 pt-1">
                <span className="text-caption">Muted sources:</span>
                <div className="flex flex-wrap gap-1">
                  {settings.mutedSources.map((src) => (
                    <Badge key={src} variant="secondary" className="text-[10px]">
                      {SOURCE_LABELS[src]}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Recent Notifications ── */}
      <div className="flex-1 ui-panel-shell rounded-lg overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Recent Notifications</span>
            <span className="text-caption text-xs">(last 10)</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {recent.length === 0 ? (
            <EmptyState
              variant="inline"
              compact
              title="No notifications yet."
              className="p-8 pt-8"
            />
          ) : (
            <div className="divide-y divide-border/30">
              {recent.map((n) => {
                const Icon = TYPE_ICONS[n.type];
                return (
                  <div
                    key={n.id}
                    className="flex items-center gap-3 px-4 py-2 text-xs"
                  >
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${TYPE_COLORS[n.type]}`} />
                    <span className={`flex-1 truncate ${n.read ? "text-muted-foreground" : "font-medium"}`}>
                      {n.title}
                    </span>
                    {!n.read && (
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                    <span className="text-caption tabular-nums shrink-0">
                      {formatTime(n.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="ui-panel-shell rounded-lg">
        <div className="flex items-center gap-2 px-4 py-3">
          <Button
            variant="neutral"
            size="sm"
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
            className="h-7 text-xs"
          >
            <Eye className="h-3 w-3 mr-1" />
            Mark All as Read
          </Button>
          <Button
            variant={confirmClear ? "destructive" : "neutral"}
            size="sm"
            onClick={handleClear}
            disabled={notifications.length === 0}
            className="h-7 text-xs"
          >
            <Trash className="h-3 w-3 mr-1" />
            {confirmClear ? "Confirm Clear?" : "Clear All Notifications"}
          </Button>
          <Button
            variant="neutral"
            size="sm"
            onClick={handleResetSettings}
            className="h-7 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset Settings to Defaults
          </Button>
        </div>
      </div>
    </div>
  );
}
