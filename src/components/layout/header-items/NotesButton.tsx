import { StickyNote } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface NotesButtonProps {
  onClick: () => void;
}

/** Self-contained notes button for the header. */
export function NotesButton({ onClick }: NotesButtonProps) {
  return (
    <TooltipWrapper entry={tooltips.headerNotes}>
      <button type="button" onClick={onClick} className="header-icon-button" aria-label="Open notes">
        <StickyNote className="h-4 w-4" />
      </button>
    </TooltipWrapper>
  );
}
