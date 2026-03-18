import { createContext, useContext, ReactNode } from "react";
import { useNotifications, NotificationOptions } from "@/hooks/useNotifications";
import { useNotificationStore, Notification as AppNotification } from "@/stores/notificationStore";
import type { NotificationType, NotificationSource } from "@/stores/notificationStore";

interface ToastContextType {
  toast: (options: {
    type: NotificationType;
    title: string;
    description?: string;
    duration?: number;
    source?: NotificationSource;
  }) => void;
  success: (title: string, description?: string, options?: Partial<NotificationOptions>) => void;
  error: (title: string, description?: string, options?: Partial<NotificationOptions>) => void;
  info: (title: string, description?: string, options?: Partial<NotificationOptions>) => void;
  warning: (title: string, description?: string, options?: Partial<NotificationOptions>) => void;
  notifications: AppNotification[];
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const notifications = useNotifications();
  const notificationList = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);

  const value: ToastContextType = {
    toast: (options) => notifications.notify(options),
    success: notifications.success,
    error: notifications.error,
    info: notifications.info,
    warning: notifications.warning,
    notifications: notificationList,
    dismiss,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastContext must be used within ToastProvider");
  }
  return context;
}
