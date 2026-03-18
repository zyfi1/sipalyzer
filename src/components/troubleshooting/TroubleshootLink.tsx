/**
 * TroubleshootLink — reusable component for linking to KB articles from anywhere in the app.
 *
 * Usage:
 *   <TroubleshootLink sipCode={401} />
 *   <TroubleshootLink articleId="one-way-audio" />
 *   <TroubleshootLink metric="mos" value={2.8} />
 */

import { useCallback, useMemo } from "react";
import { useKnowledgeBaseStore } from "@/stores/knowledgeBaseStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { getArticlesForSipCode, getArticlesForMetric } from "@/lib/troubleshootingEngine";
import { getSipCode } from "@/data/sipResponseCodeMap";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { BookOpen } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAG_KNOWLEDGE_BASE_UI } from "@/lib/featureFlags";

interface TroubleshootLinkProps {
  sipCode?: number;
  articleId?: string;
  metric?: "mos" | "jitter" | "loss" | "latency";
  value?: number;
  hideIfEmpty?: boolean;
  className?: string;
  compact?: boolean;
}

export function TroubleshootLink({
  sipCode,
  articleId,
  metric,
  value,
  hideIfEmpty = true,
  className,
  compact = false,
}: TroubleshootLinkProps) {
  const { enabled: knowledgeBaseEnabled } = useFeatureFlag(FEATURE_FLAG_KNOWLEDGE_BASE_UI);

  if (!knowledgeBaseEnabled) return null;

  const openArticle = useKnowledgeBaseStore((s) => s.openArticle);

  const hasArticles = useMemo(() => {
    if (articleId) return true;
    if (sipCode != null) return getArticlesForSipCode(sipCode).length > 0;
    if (metric && value != null) return getArticlesForMetric(metric, value).length > 0;
    return false;
  }, [articleId, sipCode, metric, value]);

  const tooltip = useMemo(() => {
    if (articleId) return "Open troubleshooting article";
    if (sipCode != null) {
      const info = getSipCode(sipCode);
      return info ? `Troubleshoot ${sipCode} ${info.name}` : `Troubleshoot SIP ${sipCode}`;
    }
    if (metric) return `Troubleshoot ${metric} issue`;
    return "Open Knowledge Base";
  }, [articleId, sipCode, metric]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const openKb = () => useLayoutStore.getState().setKbCenterOpen(true);

      if (articleId) {
        openKb();
        setTimeout(() => openArticle(articleId), 50);
        return;
      }

      if (sipCode != null) {
        const articles = getArticlesForSipCode(sipCode);
        if (articles.length === 1) {
          openKb();
          setTimeout(() => openArticle(articles[0]!.id), 50);
        } else {
          openKb();
          setTimeout(() => useKnowledgeBaseStore.getState().setSearchQuery(String(sipCode)), 50);
        }
        return;
      }

      if (metric && value != null) {
        const articles = getArticlesForMetric(metric, value);
        if (articles.length === 1) {
          openKb();
          setTimeout(() => openArticle(articles[0]!.id), 50);
        } else {
          openKb();
          setTimeout(() => useKnowledgeBaseStore.getState().setSearchQuery(metric), 50);
        }
        return;
      }

      openKb();
    },
    [articleId, sipCode, metric, value, openArticle]
  );

  if (hideIfEmpty && !hasArticles) return null;

  const iconSize = compact ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <TooltipWrapper title="Troubleshoot" description={tooltip}>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-smooth shrink-0",
          compact ? "h-5 w-5" : "h-6 w-6",
          className
        )}
        aria-label={tooltip}
      >
        <BookOpen className={iconSize} />
      </button>
    </TooltipWrapper>
  );
}
