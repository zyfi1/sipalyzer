import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Bell, X } from "@/lib/icons";
import { NotificationCenter } from "./NotificationCenter";

interface NotificationsCenterProps {
  isOpen: boolean;
  onClose?: () => void;
}

export function NotificationsCenter({ isOpen, onClose }: NotificationsCenterProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-x-0 top-9 bottom-7 bg-black/35 z-40 transition-smooth"
        onClick={onClose}
      />
      <div className="fixed top-9 bottom-7 right-0 h-auto w-full max-w-[42rem] border-l border-border/70 bg-card z-50 flex flex-col shadow-elevated transition-smooth animate-in slide-in-from-right duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
        <div className="flex-shrink-0 h-11 flex items-center justify-between px-3 border-b border-border/55 bg-card">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Notifications</span>
          </div>
          <TooltipWrapper title="Close" description="Close Notifications panel (Escape).">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
              <X className="h-4 w-4" />
            </Button>
          </TooltipWrapper>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <NotificationCenter isOpen mode="embedded" />
        </div>
      </div>
    </>
  );
}
