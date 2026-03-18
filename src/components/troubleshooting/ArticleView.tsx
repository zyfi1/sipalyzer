/**
 * ArticleView — renders a single KB article.
 * Unified with the app's design: translucent cards, compact typography, uppercase section headers.
 */

import { useMemo } from "react";
import { useKnowledgeBaseStore } from "@/stores/knowledgeBaseStore";
import { getArticleById } from "@/data/troubleshootingKnowledgeBase";
import { getRelatedArticles } from "@/lib/troubleshootingEngine";
import { navigateTo } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  ArrowLeft,
  ExternalLink,
  CheckCircle2,
  Wrench,
  BookOpen,
  ChevronRight,
} from "@/lib/icons";
import { cn } from "@/lib/utils";

// ── Styled helpers ──

function SectionHeader({ title, className }: { title: string; className?: string }) {
  return (
    <h3 className={cn("section-label-sm mb-2", className)}>
      {title}
    </h3>
  );
}

function ArticleCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("surface px-5 py-4", className)}>
      {children}
    </div>
  );
}

const SEVERITY_STYLES = {
  critical: { bg: "bg-destructive/8", border: "border-destructive/15", text: "text-destructive", dot: "bg-destructive" },
  warning: { bg: "bg-warning/8", border: "border-warning/15", text: "text-warning", dot: "bg-warning" },
  info: { bg: "bg-primary/8", border: "border-primary/15", text: "text-primary", dot: "bg-primary" },
};

const LIKELIHOOD_COLORS = {
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground/60",
};

const REF_TYPE_LABELS: Record<string, string> = {
  rfc: "RFC",
  vendor: "Vendor",
  community: "Community",
  standard: "Standard",
};

const DOMAIN_COLORS: Record<string, string> = {
  sip: "text-primary",
  rtp: "text-success",
  t38: "text-warning",
  network: "text-success",
  dns: "text-info",
  security: "text-destructive",
  general: "text-primary",
};

function isSafeReferenceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function ArticleView() {
  const articleId = useKnowledgeBaseStore((s) => s.selectedArticleId);
  const closeArticle = useKnowledgeBaseStore((s) => s.closArticle);
  const openArticle = useKnowledgeBaseStore((s) => s.openArticle);

  const article = useMemo(() => (articleId ? getArticleById(articleId) : undefined), [articleId]);
  const related = useMemo(() => (articleId ? getRelatedArticles(articleId) : []), [articleId]);

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Article not found.</p>
        <Button variant="neutral" size="sm" onClick={closeArticle} className="mt-2 gap-2 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
      </div>
    );
  }

  const sev = SEVERITY_STYLES[article.severity];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* ── Sticky header ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border/20">
        <TooltipWrapper title="Back" description="Return to the Knowledge Base.">
          <button type="button" onClick={closeArticle} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/10 transition-smooth">
            <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </TooltipWrapper>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold truncate">{article.title}</h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            {article.domains.map((d) => (
              <span key={d} className={cn("text-3xs font-medium uppercase", DOMAIN_COLORS[d] ?? "text-muted-foreground/60")}>{d}</span>
            ))}
            <span className="text-3xs text-muted-foreground/60">·</span>
            <span className={cn("text-3xs font-medium", sev.text)}>{article.severity}</span>
            <span className="text-3xs text-muted-foreground/60">·</span>
            <span className="text-3xs text-muted-foreground/60 font-mono">{article.lastUpdated}</span>
          </div>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="space-y-4">

          {/* ═══ SYMPTOMS ════════════════════════════════ */}
          <ArticleCard className={cn(sev.bg)}>
            <SectionHeader title="Symptoms" />
            <ul className="space-y-1.5">
              {article.symptoms.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                  <div className={cn("h-1.5 w-1.5 rounded-full shrink-0 mt-1.5", sev.dot)} />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </ArticleCard>

          {/* ═══ CAUSES ══════════════════════════════════ */}
          <ArticleCard>
            <SectionHeader title="Causes (by likelihood)" />
            <div className="space-y-2">
              {article.causes.map((cause, i) => (
                <div key={i} className="rounded-lg bg-muted/10 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("text-3xs font-semibold uppercase tracking-wider", LIKELIHOOD_COLORS[cause.likelihood])}>
                      {cause.likelihood}
                    </span>
                    <span className="text-xs font-medium">{cause.summary}</span>
                  </div>
                  <p className="text-2xs text-muted-foreground/60 leading-relaxed">{cause.detail}</p>
                </div>
              ))}
            </div>
          </ArticleCard>

          {/* ═══ DIAGNOSTIC STEPS ════════════════════════ */}
          <ArticleCard>
            <SectionHeader title="Diagnostic Steps" />
            <div className="space-y-2.5">
              {article.diagnosticSteps.map((step) => (
                <div key={step.order} className="flex gap-3">
                  <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-lg bg-muted/20 text-2xs font-semibold text-muted-foreground/60 tabular-nums">
                    {step.order}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-relaxed">{step.instruction}</p>
                    {step.expected && (
                      <div className="flex items-start gap-1.5 mt-1">
                        <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5 text-success/60" />
                        <p className="text-2xs text-muted-foreground/60 leading-relaxed">Expected: {step.expected}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ArticleCard>

          {/* ═══ SOLUTIONS ═══════════════════════════════ */}
          <ArticleCard>
            <SectionHeader title="Solutions" />
            <div className="space-y-2.5">
              {article.solutions.map((sol, i) => (
                <div key={i} className="rounded-lg bg-muted/10 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Wrench className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    <span className="text-xs font-medium">{sol.summary}</span>
                  </div>
                  {sol.appliesWhen && (
                    <p className="text-2xs text-muted-foreground/60 mb-1.5 italic">When: {sol.appliesWhen}</p>
                  )}
                  <ol className="space-y-1">
                    {sol.steps.map((step, j) => (
                      <li key={j} className="flex items-start gap-2 text-2xs text-muted-foreground/60 leading-relaxed">
                        <span className="text-3xs font-mono text-muted-foreground/60 shrink-0 mt-px">{j + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </ArticleCard>

          {/* ═══ SIPALYZER TOOLS ═════════════════════════ */}
          {article.sipalizerTools && article.sipalizerTools.length > 0 && (
            <ArticleCard>
              <SectionHeader title="Open in SIPalyzer" />
              <div className="flex flex-wrap gap-1.5">
                {article.sipalizerTools.map((tool, i) => (
                  <TooltipWrapper key={i} title={tool.label} description={`Open ${tool.label} to help diagnose this issue.`}>
                    <button
                      type="button"
                      onClick={() => navigateTo(tool.toolId, tool.subviewId)}
                      className="h-7 px-2.5 rounded-lg bg-muted/10 hover:bg-muted/20 transition-smooth flex items-center gap-1.5 text-2xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Wrench className="h-3 w-3" />
                      {tool.label}
                    </button>
                  </TooltipWrapper>
                ))}
              </div>
            </ArticleCard>
          )}

          {/* ═══ REFERENCES ══════════════════════════════ */}
          <ArticleCard>
            <SectionHeader title="References" />
            <div className="space-y-1.5">
              {article.references.map((ref, i) => {
                const safeUrl = isSafeReferenceUrl(ref.url);
                if (!safeUrl) {
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-lg px-2 py-1.5 -mx-2 opacity-70 cursor-not-allowed"
                      title="Blocked unsafe reference URL (only http/https links are allowed)."
                    >
                      <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground/60 shrink-0 mt-px w-14">
                        {REF_TYPE_LABELS[ref.type]}
                      </span>
                      <span className="text-2xs text-muted-foreground leading-relaxed flex-1 min-w-0">
                        {ref.title}
                      </span>
                      <span className="text-3xs text-muted-foreground/60 shrink-0 mt-0.5">Blocked</span>
                    </div>
                  );
                }

                return (
                  <a
                    key={i}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-muted/10 transition-smooth group"
                  >
                    <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground/60 shrink-0 mt-px w-14">
                      {REF_TYPE_LABELS[ref.type]}
                    </span>
                    <span className="text-2xs text-primary/80 group-hover:text-primary leading-relaxed flex-1 min-w-0">
                      {ref.title}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground/60 shrink-0 mt-0.5 group-hover:text-muted-foreground/60" />
                  </a>
                );
              })}
            </div>
          </ArticleCard>

          {/* ═══ RELATED SIP CODES ═══════════════════════ */}
          {article.relatedSipCodes && article.relatedSipCodes.length > 0 && (
            <ArticleCard>
              <SectionHeader title="Related SIP Codes" />
              <div className="flex flex-wrap gap-1.5">
                {article.relatedSipCodes.map((code) => (
                  <span key={code} className="h-6 px-2 rounded-lg bg-muted/10 flex items-center text-2xs font-mono text-muted-foreground/60">
                    {code}
                  </span>
                ))}
              </div>
            </ArticleCard>
          )}

          {/* ═══ RELATED ARTICLES ════════════════════════ */}
          {related.length > 0 && (
            <ArticleCard>
              <SectionHeader title="Related Articles" />
              <div className="space-y-1">
                {related.map((rel) => (
                  <button
                    key={rel.id}
                    type="button"
                    onClick={() => openArticle(rel.id)}
                    className="w-full text-left flex items-center gap-2.5 rounded-lg px-2.5 py-2 -mx-2.5 hover:bg-muted/10 transition-smooth group"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 group-hover:text-muted-foreground/60" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate group-hover:text-foreground">{rel.title}</p>
                      <p className="text-2xs text-muted-foreground/60 truncate">{rel.symptoms[0]}</p>
                    </div>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0 group-hover:text-muted-foreground/60" />
                  </button>
                ))}
              </div>
            </ArticleCard>
          )}
        </div>
      </div>
    </div>
  );
}
