import { useState, useMemo, useCallback } from "react";
import { useNotificationStore } from "@/stores/notificationStore";
import type { NotificationType, NotificationFilter, GroupedNotifications } from "@/stores/notificationStore";
import { NotificationItem } from "./NotificationItem";
import { NotificationSettings } from "./NotificationSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { X, Search, Trash2, CheckCheck, Bell, Filter, Settings } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface NotificationCenterProps {
  isOpen?: boolean;
  onClose?: () => void;
  mode?: "overlay" | "embedded";
}

type TypeFilter = "all" | NotificationType;
type NotificationPanelTab = "inbox" | "unread" | "pinned";
type NotificationViewMode = "feed" | "settings";

const TYPE_FILTER_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All Severities" },
  { value: "system", label: "System" },
  { value: "error", label: "Errors" },
  { value: "warning", label: "Warnings" },
  { value: "success", label: "Success" },
  { value: "info", label: "Info" },
];

export function NotificationCenter({ isOpen = true, onClose, mode = "overlay" }: NotificationCenterProps) {
  const isOverlay = mode === "overlay";
  const notifications = useNotificationStore((s) => s.notifications);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAsUnread = useNotificationStore((s) => s.markAsUnread);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const dismissAll = useNotificationStore((s) => s.dismissAll);
  const togglePin = useNotificationStore((s) => s.togglePin);
  const getNotifications = useNotificationStore((s) => s.getNotifications);
  const getGroupedNotifications = useNotificationStore((s) => s.getGroupedNotifications);
  const settings = useNotificationStore((s) => s.settings);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<NotificationPanelTab>("inbox");
  const [activeFilter, setActiveFilter] = useState<TypeFilter>("all");
  const [viewMode, setViewMode] = useState<NotificationViewMode>("feed");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const storeFilter = useMemo((): NotificationFilter => {
    const filter: NotificationFilter = {};
    if (activeFilter !== "all") filter.type = activeFilter;
    return filter;
  }, [activeFilter]);

  const groups = useMemo((): GroupedNotifications[] => {
    const tabMatch = (n: (typeof notifications)[number]) => {
      if (activeTab === "unread") return !n.read;
      if (activeTab === "pinned") return !!n.pinned;
      return true;
    };

    if (!settings.groupSimilar) {
      const filtered = getNotifications(storeFilter).filter(tabMatch);
      const searched = searchQuery.trim()
        ? filtered.filter(
            (n) =>
              n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              n.description?.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : filtered;
      return searched.length > 0 ? [{ key: "today", label: "All Notifications", notifications: searched }] : [];
    }

    const grouped = getGroupedNotifications(storeFilter)
      .map((group) => ({ ...group, notifications: group.notifications.filter(tabMatch) }))
      .filter((group) => group.notifications.length > 0);

    if (!searchQuery.trim()) return grouped;
    const query = searchQuery.toLowerCase();
    return grouped
      .map((group) => ({
        ...group,
        notifications: group.notifications.filter(
          (n) =>
            n.title.toLowerCase().includes(query) ||
            n.description?.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.notifications.length > 0);
  }, [notifications, activeTab, storeFilter, searchQuery, getNotifications, getGroupedNotifications, settings.groupSimilar]);

  const totalFiltered = useMemo(() => groups.reduce((sum, g) => sum + g.notifications.length, 0), [groups]);
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const pinnedCount = useMemo(() => notifications.filter((n) => !!n.pinned).length, [notifications]);
  const unreadByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notifications) {
      if (!n.read) counts[n.type] = (counts[n.type] || 0) + 1;
    }
    return counts;
  }, [notifications]);

  const handleDismiss = useCallback((id: string) => dismiss(id), [dismiss]);
  const handleMarkRead = useCallback((id: string) => markAsRead(id), [markAsRead]);
  const handleMarkUnread = useCallback((id: string) => markAsUnread(id), [markAsUnread]);
  const handleTogglePin = useCallback((id: string) => togglePin(id), [togglePin]);

  if (isOverlay && !isOpen) return null;

  const panel = (
    <>
      {isOverlay && (
        <div
          className="fixed inset-x-0 top-9 bottom-7 bg-black/35 z-[9800] transition-smooth"
          onClick={onClose}
        />
      )}

      <div
        className={cn(
          "flex flex-col min-h-0 ui-panel-shell bg-card/96",
          isOverlay
            ? "fixed top-9 bottom-7 right-0 h-auto w-full max-w-[500px] z-[9801] rounded-none border-l border-l-border/60 shadow-elevated transition-smooth animate-in slide-in-from-right duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]"
            : "h-full w-[min(42rem,100%)] rounded-none border border-border/45"
        )}
      >
        {/* Workbench-style tab strip + actions */}
        <div className="ui-section-header-md bg-card/96 px-3 pt-2 pb-0">
          <div className="flex items-end gap-2 min-h-10">
            <div className="notification-nav-tabs min-w-0">
              {([
                { id: "inbox", label: "Inbox", count: notifications.length },
                { id: "unread", label: "Unread", count: unreadCount },
                { id: "pinned", label: "Pinned", count: pinnedCount },
              ] as const).map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <TooltipWrapper
                    key={tab.id}
                    title={tab.label}
                    description={`Show ${tab.label.toLowerCase()} notifications`}
                    side="bottom"
                  >
                    <button
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      data-state={isActive ? "active" : "inactive"}
                      className="notification-nav-tab"
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span>{tab.label}</span>
                      {tab.count > 0 && <span className="notification-nav-tab-count">{tab.count}</span>}
                    </button>
                  </TooltipWrapper>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-1 pb-1">
              {unreadCount > 0 && (
                <TooltipWrapper content="Mark all as read">
                  <Button variant="neutral" size="icon" onClick={markAllAsRead} className="h-8 w-8">
                    <CheckCheck className="h-4 w-4" />
                  </Button>
                </TooltipWrapper>
              )}
              {notifications.length > 0 && (
                <TooltipWrapper content="Clear all">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setClearConfirmOpen(true)}
                    className="h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipWrapper>
              )}
              {onClose && (
                <TooltipWrapper content="Close">
                  <Button variant="neutral" size="icon" onClick={onClose} className="h-8 w-8">
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipWrapper>
              )}
            </div>
          </div>
        </div>

        {/* Unified control bar underneath tabs */}
        <div className="ui-section-header-md bg-card/94 px-4 py-2">
          <div className="flex items-center gap-1">
            <div className="relative flex-1 min-w-0" title="Search notifications">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search notifications..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 ui-control-shell"
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <div className="w-[180px]" title="Severity filter">
                <AppDropdown
                  className="h-8 w-full"
                  value={activeFilter}
                  onValueChange={(value) => setActiveFilter(value as TypeFilter)}
                  triggerPrefix={<Filter className="h-3.5 w-3.5 text-muted-foreground" />}
                  placeholder="Filter by severity"
                  options={TYPE_FILTER_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: `${opt.label}${opt.value !== "all" ? ` (${unreadByType[opt.value] || 0})` : ""}`,
                  }))}
                />
              </div>
              <TooltipWrapper
                title={viewMode === "settings" ? "Back to notifications" : "Notification settings"}
                description={viewMode === "settings" ? "Return to notification feed" : "Open notification settings"}
                side="bottom"
              >
                <div className="h-8 flex items-center">
                  <Button
                    type="button"
                    variant={viewMode === "settings" ? "neutral" : "ghost"}
                    size="icon"
                    onClick={() => setViewMode((v) => (v === "settings" ? "feed" : "settings"))}
                    className="h-full w-8"
                    aria-label={viewMode === "settings" ? "Back to notifications" : "Open notification settings"}
                  >
                    <Settings className="h-[18px] w-[18px]" />
                  </Button>
                </div>
              </TooltipWrapper>
            </div>
          </div>
        </div>

        {viewMode === "settings" ? (
          <div className="flex-1 min-h-0 overflow-y-auto bg-card/95">
            <NotificationSettings />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto bg-card/95">
          {totalFiltered === 0 ? (
            <EmptyState
              compact
              variant="inline"
              icon={<Bell />}
              title={
                searchQuery
                  ? "No matching notifications"
                  : activeTab === "unread"
                    ? "No unread notifications"
                    : activeTab === "pinned"
                      ? "No pinned notifications"
                      : activeFilter !== "all"
                        ? `No ${TYPE_FILTER_OPTIONS.find((t) => t.value === activeFilter)?.label?.toLowerCase() ?? "matching"} notifications`
                        : "No notifications yet"
              }
              description={
                searchQuery
                  ? "Try adjusting your search terms or clearing filters"
                  : activeTab === "unread"
                    ? "You're all caught up!"
                    : "Notifications from your tools will appear here"
              }
              action={
                searchQuery || activeFilter !== "all" || activeTab !== "inbox" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setSearchQuery("");
                      setActiveTab("inbox");
                      setActiveFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="p-4 space-y-1.5">
              {groups.map((group) => (
                <div key={group.key}>
                  {groups.length > 1 && (
                    <div className="flex items-center gap-2 px-1 pt-3 pb-1.5 first:pt-0">
                      <span className="section-label-sm">{group.label}</span>
                      <span className="text-2xs text-muted-foreground/50">{group.notifications.length}</span>
                      <div className="flex-1 h-px bg-border/40" />
                    </div>
                  )}
                  <div className="space-y-2">
                    {group.notifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onDismiss={handleDismiss}
                        onMarkRead={handleMarkRead}
                        onMarkUnread={handleMarkUnread}
                        onTogglePin={handleTogglePin}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        )}

        {viewMode === "feed" && notifications.length > 0 && (
          <div className="border-t border-border/50 bg-card/96 px-5 py-2 flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">
              {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
              {unreadCount > 0 && ` · ${unreadCount} unread`}
            </span>
            {totalFiltered !== notifications.length && (
              <span className="text-2xs text-muted-foreground/60">Showing {totalFiltered}</span>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="Clear All Notifications"
        description={`Are you sure you want to clear all ${notifications.length} notification${notifications.length > 1 ? "s" : ""}? This action cannot be undone.`}
        confirmText="Clear All"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={dismissAll}
      />
    </>
  );

  return panel;
}
