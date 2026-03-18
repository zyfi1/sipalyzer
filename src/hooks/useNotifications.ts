import { useNotificationStore } from "@/stores/notificationStore";
import type {
  NotificationType,
  NotificationSource,
  NotificationPriority,
} from "@/stores/notificationStore";
import { useEffect, useRef } from "react";
import { toast as sonnerToast } from "sonner";

type Timeout = ReturnType<typeof setTimeout>;

export interface NotificationOptions {
  type: NotificationType;
  title: string;
  description?: string;
  persistent?: boolean;
  duration?: number;
  actions?: Array<{ label: string; action: () => void; variant?: "primary" | "secondary" }>;
  navigation?: { tool: string; view?: string; registrarId?: string; [key: string]: unknown };
  metadata?: Record<string, unknown>;
  /** Which tool/feature generated this notification */
  source?: NotificationSource;
  /** Priority level — high/urgent get special treatment */
  priority?: NotificationPriority;
  /** Group key for collapsing similar notifications */
  group?: string;
}

export function useNotifications() {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const settings = useNotificationStore((s) => s.settings);
  const timeoutRefs = useRef<Map<string, Timeout>>(new Map());

  const notify = (options: NotificationOptions) => {
    const isMuted = options.source && settings.mutedSources.includes(options.source);

    // Always add to notification center if enabled
    const id = addNotification({
      type: options.type,
      title: options.title,
      description: options.description,
      persistent: options.persistent,
      actions: options.actions,
      navigation: options.navigation,
      metadata: options.metadata,
      source: options.source,
      priority: options.priority ?? "normal",
      group: options.group,
    });

    // Show Sonner toast when toasts are enabled, DND is off, source is not muted, and not persistent
    // Exception: urgent priority always shows a toast even when muted or DND
    const shouldToast =
      settings.showToasts &&
      !options.persistent &&
      (!settings.doNotDisturb || options.priority === "urgent") &&
      (!isMuted || options.priority === "urgent");

    if (shouldToast) {
      const duration = options.duration ?? settings.autoDismissDuration;
      const toastOptions = {
        description: options.description,
        duration: duration > 0 ? duration : undefined,
      };
      switch (options.type) {
        case "success":
          sonnerToast.success(options.title, toastOptions);
          break;
        case "error":
          sonnerToast.error(options.title, toastOptions);
          break;
        case "warning":
          sonnerToast.warning(options.title, toastOptions);
          break;
        case "info":
        case "system":
        default:
          sonnerToast.info(options.title, toastOptions);
          break;
      }
    }

    // Auto-dismiss from store if enabled and not persistent (notification center list)
    if (settings.autoDismiss && !options.persistent && settings.showToasts) {
      const duration = options.duration || settings.autoDismissDuration;
      const timeout = setTimeout(() => {
        timeoutRefs.current.delete(id);
      }, duration);
      timeoutRefs.current.set(id, timeout);
    }

    return id;
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
      timeoutRefs.current.clear();
    };
  }, []);

  return {
    notify,
    success: (title: string, description?: string, options?: Partial<NotificationOptions>) =>
      notify({ type: "success", title, description, ...options }),
    error: (title: string, description?: string, options?: Partial<NotificationOptions>) =>
      notify({ type: "error", title, description, persistent: true, ...options }),
    info: (title: string, description?: string, options?: Partial<NotificationOptions>) =>
      notify({ type: "info", title, description, ...options }),
    warning: (title: string, description?: string, options?: Partial<NotificationOptions>) =>
      notify({ type: "warning", title, description, ...options }),
  };
}
