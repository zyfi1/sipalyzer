import { KnowledgeBase } from "./KnowledgeBase";
import { X } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

interface KnowledgeBaseCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Slide-out overlay for the Knowledge Base, matching Notes/Notifications pattern. */
export function KnowledgeBaseCenter({ isOpen, onClose }: KnowledgeBaseCenterProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/58">
      <div className="h-full w-full bg-card border border-border/55 rounded-md flex flex-col overflow-hidden">
        <header className="flex-shrink-0 border-b border-border/55 bg-card">
          <div className="px-4 py-2.5 flex items-center gap-3">
            <TooltipWrapper title="Close" description="Close the Knowledge Base panel.">
              <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
                <X className="h-4 w-4" />
              </Button>
            </TooltipWrapper>
            <h2 className="text-sm font-semibold">Knowledge Base</h2>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-hidden">
          <KnowledgeBase />
        </div>
      </div>
    </div>
  );
}
