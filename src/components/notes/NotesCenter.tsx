import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { StickyNote, X } from "@/lib/icons";
import { NotesApp } from "./NotesApp";

interface NotesCenterProps {
  isOpen: boolean;
  onClose?: () => void;
}

export function NotesCenter({ isOpen, onClose }: NotesCenterProps) {
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
        className="fixed inset-x-0 top-9 bottom-7 bg-black/25 z-40 transition-smooth"
        onClick={onClose}
      />
      <div className="notes-center-shell fixed top-9 bottom-7 right-0 h-auto w-full max-w-[1220px] border-l border-border z-50 flex flex-col shadow-elevated transition-smooth animate-in slide-in-from-right duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]">
        <div className="notes-center-topbar flex-shrink-0 h-11 flex items-center justify-between px-3 border-b border-border/55">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Notes</span>
          </div>
          <TooltipWrapper title="Close" description="Close Notes panel (Escape).">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
              <X className="h-4 w-4" />
            </Button>
          </TooltipWrapper>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <NotesApp />
        </div>
      </div>
    </>
  );
}
