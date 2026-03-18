import { useState, useCallback } from "react";
import { KNOWLEDGE_BASE_ARTICLES } from "@/data/troubleshootingKnowledgeBase";
import { useLayoutStore } from "@/stores/layoutStore";
import { Lightbulb, RefreshCw } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TsArticle } from "@/types/troubleshootingEngine";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAG_KNOWLEDGE_BASE_UI } from "@/lib/featureFlags";

const SEVERITY_STYLES: Record<TsArticle["severity"], string> = {
  critical: "bg-destructive/15 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-primary/15 text-primary",
};

function randomIndex(): number {
  return Math.floor(Math.random() * KNOWLEDGE_BASE_ARTICLES.length);
}

export function KnowledgeBaseSpotlightSection() {
  const { enabled: knowledgeBaseEnabled } = useFeatureFlag(FEATURE_FLAG_KNOWLEDGE_BASE_UI);
  const [index, setIndex] = useState(randomIndex);

  const article = KNOWLEDGE_BASE_ARTICLES[index];

  const nextTip = useCallback(() => {
    setIndex((prev) => {
      let next = randomIndex();
      while (next === prev && KNOWLEDGE_BASE_ARTICLES.length > 1) {
        next = randomIndex();
      }
      return next;
    });
  }, []);

  const openKb = useCallback(() => {
    useLayoutStore.getState().setKbCenterOpen(true);
  }, []);

  if (!knowledgeBaseEnabled || !article) return null;

  return (
    <div className="surface p-5 flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-muted-foreground/60" />
          <h2 className="text-sm font-semibold text-foreground/70">Knowledge Base</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground/60 hover:text-foreground/70"
          onClick={nextTip}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <button
          type="button"
          onClick={openKb}
          className="text-left w-full group"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className={cn(
              "text-3xs px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider",
              SEVERITY_STYLES[article.severity],
            )}>
              {article.severity}
            </span>
          </div>
          <h3 className="text-sm font-medium text-foreground/75 group-hover:text-foreground/90 transition-colors leading-snug">
            {article.title}
          </h3>
        </button>

        {article.symptoms.length > 0 && (
          <ul className="mt-2 space-y-1">
            {article.symptoms.slice(0, 2).map((symptom, i) => (
              <li key={i} className="flex items-start gap-2 text-3xs text-muted-foreground/50">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
                <span className="leading-relaxed">{symptom}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
