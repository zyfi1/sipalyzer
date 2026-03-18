import { useState, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
  X,
  Pin,
  Eye,
  EyeOff,
} from "@/lib/icons";
import type { Notification } from "@/stores/notificationStore";
import { SOURCE_LABELS as sourceLabels } from "@/stores/notificationStore";
import { cn } from "@/lib/utils";
import { useNavigation } from "@/hooks/useNavigation";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 10) return `${seconds}s ago`;
  return "just now";
}

interface NotificationItemProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onTogglePin: (id: string) => void;
}

const typeIcons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
  system: Info,
};

const typeIconColors = {
  success: "text-success",
  error: "text-destructive",
  info: "text-primary",
  warning: "text-warning",
  system: "text-muted-foreground",
};

const typeBorderColors = {
  success: "bg-success/80",
  error: "bg-destructive/80",
  warning: "bg-warning/80",
  info: "bg-primary/80",
  system: "bg-muted-foreground/50",
};

export function NotificationItem({
  notification,
  onDismiss,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
}: NotificationItemProps) {
  const Icon = typeIcons[notification.type];
  const isUnread = !notification.read;
  const { navigate } = useNavigation();
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(notification.timestamp));
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setTimeAgo(formatTimeAgo(notification.timestamp));
    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(notification.timestamp));
    }, 30000);
    return () => clearInterval(interval);
  }, [notification.timestamp]);

  const handleNavigate = () => {
    try {
      if (notification.navigation) {
        navigate(notification.navigation);
        onMarkRead(notification.id);
      }
    } catch (error) {
      console.error("Navigation failed:", error);
    }
  };

  const handleClick = () => {
    if (!notification.read) onMarkRead(notification.id);
    if (notification.navigation) handleNavigate();
  };

  return (
    <div
      className={cn(
        "group relative rounded-md border border-border/50 p-3 transition-smooth",
        "bg-card/98 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.045)]",
        notification.priority === "urgent" && "ring-1 ring-destructive/30",
        notification.priority === "high" && "ring-1 ring-warning/20",
        notification.navigation && "cursor-pointer hover:bg-accent/52 hover:border-border/82"
      )}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isUnread && (
        <span
          className={cn(
            "absolute left-0 top-2.5 h-4 w-0.5 rounded-r-sm",
            typeBorderColors[notification.type],
          )}
          aria-hidden
        />
      )}
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "h-4.5 w-4.5 mt-0.5 flex-shrink-0",
            typeIconColors[notification.type]
          )}
        />
        <div className="flex-1 min-w-0">
          {/* Title + hover actions */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className={cn("text-sm leading-tight truncate", isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/85")}>
                  {notification.title}
                </div>
                {(notification.occurrenceCount ?? 1) > 1 && (
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground shrink-0">
                    x{notification.occurrenceCount}
                  </span>
                )}
              </div>
              {notification.description && (
                <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                  {notification.description}
                </div>
              )}
            </div>

            {/* Hover actions */}
            <div
              className={cn(
                "flex items-center gap-0.5 flex-shrink-0 transition-opacity",
                hovered ? "opacity-100" : "opacity-65"
              )}
            >
              <TooltipWrapper title={notification.pinned ? "Unpin" : "Pin"} side="top">
                <button
                  onClick={(e) => { e.stopPropagation(); onTogglePin(notification.id); }}
                  className={cn(
                    "p-1 rounded-md border border-transparent hover:border-border/55 hover:bg-accent/45 transition-smooth",
                    notification.pinned && "text-foreground"
                  )}
                  aria-label={notification.pinned ? "Unpin" : "Pin"}
                >
                  <Pin className="h-3.5 w-3.5" />
                </button>
              </TooltipWrapper>
              <TooltipWrapper title={isUnread ? "Mark as read" : "Mark as unread"} side="top">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    isUnread ? onMarkRead(notification.id) : onMarkUnread(notification.id);
                  }}
                  className="p-1 rounded-md border border-transparent hover:border-border/55 hover:bg-accent/45 transition-smooth"
                  aria-label={isUnread ? "Mark as read" : "Mark as unread"}
                >
                  {isUnread ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
              </TooltipWrapper>
              <TooltipWrapper title="Dismiss" side="top">
                <button
                  onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }}
                  className="p-1 rounded-md border border-transparent hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive transition-smooth"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipWrapper>
            </div>
          </div>

          {/* Meta row: source + time */}
          <div className="flex items-center gap-1.5 mt-1.5 text-2xs text-muted-foreground/80">
            {notification.source && notification.source !== "system" && (
              <>
                <span className="rounded px-1 py-0.5 bg-muted/45 text-muted-foreground/95">{sourceLabels[notification.source]}</span>
                <span className="opacity-30">·</span>
              </>
            )}
            <span>{timeAgo}</span>
          </div>

          {/* Action buttons */}
          {notification.actions && notification.actions.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {notification.actions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    try { action.action(); } catch (error) { console.error("Action failed:", error); }
                  }}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-md transition-smooth font-medium",
                    action.variant === "primary"
                      ? "bg-accent text-foreground hover:bg-muted"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  )}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
