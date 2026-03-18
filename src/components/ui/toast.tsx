import { X, CheckCircle2, XCircle, Info, AlertTriangle } from "@/lib/icons";
import { Notification as AppNotification, useNotificationStore } from "@/stores/notificationStore";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface ToastProps {
  notification: AppNotification;
  onDismiss: (id: string) => void;
  progress?: number; // 0-100 for auto-dismiss progress
}

const typeIcons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
  system: Info,
};

const typeStyles = {
  success: {
    icon: "text-success drop-shadow-[0_0_4px_hsl(var(--success)/0.5)]",
    accent: "bg-success",
    bg: "bg-success/8 border-success/25",
  },
  error: {
    icon: "text-destructive drop-shadow-[0_0_4px_hsl(var(--destructive)/0.5)]",
    accent: "bg-destructive",
    bg: "bg-destructive/8 border-destructive/25",
  },
  info: {
    icon: "text-primary drop-shadow-[0_0_4px_hsl(var(--primary)/0.4)]",
    accent: "bg-primary",
    bg: "bg-primary/8 border-primary/25",
  },
  warning: {
    icon: "text-warning drop-shadow-[0_0_4px_hsl(var(--warning)/0.5)]",
    accent: "bg-warning",
    bg: "bg-warning/8 border-warning/25",
  },
  system: {
    icon: "text-muted-foreground",
    accent: "bg-muted-foreground",
    bg: "bg-card border-border/50",
  },
};

export function ToastComponent({ notification, onDismiss, progress }: ToastProps) {
  const Icon = typeIcons[notification.type];
  const [isHovered, setIsHovered] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const styles = typeStyles[notification.type];

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(notification.id);
    }, 300);
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2.5 surface",
        "min-w-[280px] max-w-sm transition-[opacity,transform,box-shadow] duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
        styles.bg,
        "shadow-lg shadow-black/10",
        isExiting ? "toast-exit" : "toast-enter",
        isHovered && "shadow-xl shadow-black/15"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        padding: "10px 12px",
      }}
    >
      {/* Left accent bar */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-0.5 rounded-l-lg transition-opacity duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
        styles.accent,
        isHovered ? "opacity-100" : "opacity-70"
      )} />

      {/* Icon */}
      <div className={cn(
        "flex-shrink-0 transition-[opacity,transform,color] duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
        styles.icon
      )}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-xs leading-tight text-foreground">
          {notification.title}
        </div>
        {notification.description && (
          <div className="text-xs leading-snug text-muted-foreground/80 mt-0.5 line-clamp-2">
            {notification.description}
          </div>
        )}
        {notification.actions && notification.actions.length > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {notification.actions.map((action: any, idx: number) => (
              <button
                key={idx}
                onClick={(e) => {
                  e.stopPropagation();
                  try {
                    action.action();
                  } catch (error) {
                    console.error("Action failed:", error);
                  }
                }}
                className={cn(
                  "text-2xs font-medium px-2 py-1 rounded-lg transition-[transform,background-color,color,border-color,box-shadow] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
                  "hover:scale-105 active:scale-95",
                  action.variant === "primary"
                    ? "bg-foreground/10 hover:bg-foreground/20 text-foreground border border-foreground/20"
                    : "bg-background/40 hover:bg-background/60 text-foreground/80 border border-border/40"
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className={cn(
          "flex-shrink-0 opacity-0 group-hover:opacity-100 transition-[opacity,transform,color,background-color] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
          "hover:scale-110 active:scale-95 p-0.5 rounded",
          "hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
        )}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      {/* Progress bar */}
      {progress !== undefined && progress > 0 && !isHovered && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-lg overflow-hidden bg-foreground/5">
          <div
            className={cn(
              "h-full transition-[width] duration-[var(--motion-duration-micro)] ease-linear",
              styles.accent
            )}
            style={{ 
              width: `${100 - progress}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}

interface ToastContainerProps {
  notifications: AppNotification[];
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

export function ToastContainer({
  notifications,
  position = "top-right",
}: ToastContainerProps) {
  const store = useNotificationStore();
  const settings = store.settings;
  // Track which toasts have been manually dismissed (but keep in center)
  const [dismissedToasts, setDismissedToasts] = useState<Set<string>>(new Set());
  
  // Only show non-persistent notifications as toasts, max 5, that haven't been dismissed
  const toastNotifications = notifications
    .filter((n) => !n.persistent && settings.showToasts && !dismissedToasts.has(n.id))
    .slice(0, 5);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!settings.autoDismiss) return;

    const interval = setInterval(() => {
      setProgressMap(() => {
        const newMap = new Map();
        toastNotifications.forEach((notif) => {
          if (!notif.persistent) {
            const elapsed = Date.now() - notif.timestamp;
            const duration = settings.autoDismissDuration;
            const progress = Math.min((elapsed / duration) * 100, 100);
            newMap.set(notif.id, progress);
            
            // Auto-dismiss when progress reaches 100%
            if (progress >= 100) {
              setDismissedToasts((prev) => new Set(prev).add(notif.id));
            }
          }
        });
        return newMap;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [toastNotifications, settings.autoDismiss, settings.autoDismissDuration]);

  if (toastNotifications.length === 0 || !settings.showToasts) return null;

  const positionClasses = {
    "top-right": "top-14 right-4",
    "top-left": "top-14 left-4",
    "bottom-right": "bottom-4 right-4",
    "bottom-left": "bottom-4 left-4",
  };


  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col gap-2 pointer-events-none",
        positionClasses[position || settings.position]
      )}
    >
      {toastNotifications.map((notification, index) => (
        <div
          key={notification.id}
          className="pointer-events-auto"
          style={{
            animationDelay: `${index * 30}ms`,
          }}
        >
          <ToastComponent
            notification={notification}
            onDismiss={(id) => {
              // Just hide the toast, don't remove from notification center
              setDismissedToasts((prev) => new Set(prev).add(id));
            }}
            progress={progressMap.get(notification.id)}
          />
        </div>
      ))}
    </div>
  );
}
