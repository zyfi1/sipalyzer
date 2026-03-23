import { Settings } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface SettingsButtonProps {
  onClick: () => void;
}

/** Self-contained settings button for the header. */
export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <TooltipWrapper entry={tooltips.headerSettings}>
      <button type="button" onClick={onClick} className="header-icon-button" aria-label="Open settings">
        <Settings className="h-4 w-4" />
      </button>
    </TooltipWrapper>
  );
}
