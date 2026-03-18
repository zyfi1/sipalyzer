import { Bell } from "@/lib/icons";
import { useNotificationStore } from "@/stores/notificationStore";
import type { NotificationType } from "@/stores/notificationStore";
import { useState, useEffect, useMemo } from "react";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { cn } from "@/lib/utils";

interface NotificationBellProps {
  onClick: () => void;
}

export function NotificationBell({ onClick }: NotificationBellProps) {
  const notifications = useNotificationStore((s) => s.notifications);
  const [hasNewNotification, setHasNewNotification] = useState(false);
  const [activeSeverityIndex, setActiveSeverityIndex] = useState(0);

  const totalCount = notifications.length;
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Use grouped occurrence counts so repeated/coalesced notifications
  // hold their color longer in the header badge cycle.
  const severityCycle = useMemo(() => {
    const counts: Record<NotificationType, number> = {
      error: 0,
      warning: 0,
      success: 0,
      info: 0,
      system: 0,
    };

    for (const n of notifications) {
      if (n.read) continue;
      const weight = Math.max(1, n.occurrenceCount ?? 1);
      counts[n.type] += weight;
    }

    return (Object.entries(counts) as [NotificationType, number][])
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ type, count }));
  }, [notifications]);

  useEffect(() => {
    setActiveSeverityIndex(0);
  }, [severityCycle.length]);

  useEffect(() => {
    if (severityCycle.length <= 1) return;

    const current = severityCycle[activeSeverityIndex];
    if (!current) return;

    const durationMs = Math.max(1100, Math.min(7000, current.count * 900));
    const timer = window.setTimeout(() => {
      setActiveSeverityIndex((idx) => (idx + 1) % severityCycle.length);
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [severityCycle, activeSeverityIndex]);

  const activeSeverity = severityCycle[activeSeverityIndex]?.type ?? "info";

  const tokenBySeverity: Record<NotificationType, { bg: string; fg: string; ping: string }> = {
    // Use the same high-contrast numeral treatment across every badge color.
    error: { bg: "--destructive", fg: "--background", ping: "hsl(var(--destructive) / 0.2)" },
    warning: { bg: "--warning", fg: "--background", ping: "hsl(var(--warning) / 0.2)" },
    success: { bg: "--success", fg: "--background", ping: "hsl(var(--success) / 0.2)" },
    info: { bg: "--info", fg: "--background", ping: "hsl(var(--info) / 0.2)" },
    system: { bg: "--primary", fg: "--background", ping: "hsl(var(--primary) / 0.2)" },
  };

  const activeTokens = tokenBySeverity[activeSeverity];
  const severityStats = useMemo(() => {
    const unread: Record<NotificationType, number> = {
      error: 0,
      warning: 0,
      success: 0,
      info: 0,
      system: 0,
    };
    const total: Record<NotificationType, number> = {
      error: 0,
      warning: 0,
      success: 0,
      info: 0,
      system: 0,
    };

    for (const n of notifications) {
      total[n.type] += 1;
      if (!n.read) unread[n.type] += 1;
    }

    return { unread, total };
  }, [notifications]);

  useEffect(() => {
    if (unreadCount > 0) {
      setHasNewNotification(true);
      const timer = setTimeout(() => setHasNewNotification(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [unreadCount]);

  return (
    <TooltipWrapper
      content={(
        <div className="space-y-1.5 min-w-[220px]">
          <p className="font-medium text-foreground leading-snug">Notifications</p>
          <div className="text-xs text-muted-foreground leading-snug">
            <div>Total: {totalCount}</div>
            <div>Unread: {unreadCount}</div>
          </div>
          <div className="h-px bg-border/50" />
          <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">Errors</span>
            <span className="text-foreground tabular-nums">{severityStats.unread.error}/{severityStats.total.error}</span>
            <span className="text-muted-foreground">Warnings</span>
            <span className="text-foreground tabular-nums">{severityStats.unread.warning}/{severityStats.total.warning}</span>
            <span className="text-muted-foreground">Success</span>
            <span className="text-foreground tabular-nums">{severityStats.unread.success}/{severityStats.total.success}</span>
            <span className="text-muted-foreground">Info</span>
            <span className="text-foreground tabular-nums">{severityStats.unread.info}/{severityStats.total.info}</span>
            <span className="text-muted-foreground">System</span>
            <span className="text-foreground tabular-nums">{severityStats.unread.system}/{severityStats.total.system}</span>
          </div>
        </div>
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="header-icon-button relative"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className={cn(
          "h-4 w-4 transition-smooth",
          hasNewNotification && unreadCount > 0 && "animate-wiggle"
        )} />
        {unreadCount > 0 && (
          <>
            <span
              className="absolute bottom-0 right-0 h-[14px] min-w-[14px] px-[1px] rounded-sm border border-border/55 flex items-center justify-center text-[10px] font-semibold tabular-nums leading-none transition-colors duration-[var(--motion-duration-attention)] [transition-timing-function:var(--motion-ease-navigation)]"
              style={{
                backgroundColor: `hsl(var(${activeTokens.bg}))`,
                color: `hsl(var(${activeTokens.fg}))`,
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
            {hasNewNotification && (
              <span className="absolute inset-0 rounded-lg animate-live-ripple motion-reduce:animate-none" style={{ backgroundColor: activeTokens.ping }} />
            )}
          </>
        )}
      </button>
    </TooltipWrapper>
  );
}
