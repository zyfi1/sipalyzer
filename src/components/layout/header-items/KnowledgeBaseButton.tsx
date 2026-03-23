import { BookOpen } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAG_KNOWLEDGE_BASE_UI } from "@/lib/featureFlags";

interface KnowledgeBaseButtonProps {
  onClick: () => void;
}

/** Knowledge Base shortcut button for the header — toggles slide-out panel. */
export function KnowledgeBaseButton({ onClick }: KnowledgeBaseButtonProps) {
  const { enabled: knowledgeBaseEnabled } = useFeatureFlag(FEATURE_FLAG_KNOWLEDGE_BASE_UI);

  if (!knowledgeBaseEnabled) return null;

  return (
    <TooltipWrapper title="Knowledge Base" description="Open the troubleshooting knowledge base.">
      <button type="button" onClick={onClick} className="header-icon-button" aria-label="Open knowledge base">
        <BookOpen className="h-4 w-4" />
      </button>
    </TooltipWrapper>
  );
}
