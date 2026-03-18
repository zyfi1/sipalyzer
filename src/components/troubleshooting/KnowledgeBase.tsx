/**
 * KnowledgeBase — main browsable/searchable knowledge base view.
 * Unified with the app's design system: translucent cards, compact typography, uppercase section headers.
 */

import { useMemo, useCallback } from "react";
import { useKnowledgeBaseStore } from "@/stores/knowledgeBaseStore";
import { searchArticles, countByDomain } from "@/lib/troubleshootingEngine";
import { KNOWLEDGE_BASE_ARTICLES } from "@/data/troubleshootingKnowledgeBase";
import { DECISION_TREES } from "@/data/troubleshootingDecisionTrees";
import { ArticleView } from "@/components/troubleshooting/ArticleView";
import { DecisionTreeView } from "@/components/troubleshooting/DecisionTreeView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Search,
  X,
  BookOpen,
  ListOrdered,
  Network,
  Phone,
  Shield,
  Printer,
  Globe,
  ChevronRight,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { TsDomain, TsArticle } from "@/types/troubleshootingEngine";

// ── Styled helpers matching VoipView / SoftphoneSection patterns ──

function SectionHeader({ icon: Icon, color, title, badge, extra }: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  title: string;
  badge?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className={cn("h-3.5 w-3.5", color)} />
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">{title}</h3>
      {badge}
      {extra && <div className="ml-auto">{extra}</div>}
    </div>
  );
}

function KbCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("surface px-5 py-4", className)}>
      {children}
    </div>
  );
}

const DOMAIN_CONFIG: Record<TsDomain, { label: string; icon: typeof BookOpen; color: string }> = {
  sip: { label: "SIP", icon: Phone, color: "text-primary" },
  rtp: { label: "RTP", icon: Network, color: "text-success" },
  t38: { label: "T.38", icon: Printer, color: "text-warning" },
  network: { label: "Network", icon: Globe, color: "text-success" },
  dns: { label: "DNS", icon: Globe, color: "text-info" },
  security: { label: "Security", icon: Shield, color: "text-destructive" },
  general: { label: "General", icon: BookOpen, color: "text-primary" },
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-destructive",
  warning: "bg-warning",
  info: "bg-primary",
};

export function KnowledgeBase() {
  const view = useKnowledgeBaseStore((s) => s.view);
  const searchQuery = useKnowledgeBaseStore((s) => s.searchQuery);
  const activeDomain = useKnowledgeBaseStore((s) => s.activeDomain);
  const setSearchQuery = useKnowledgeBaseStore((s) => s.setSearchQuery);
  const setDomainFilter = useKnowledgeBaseStore((s) => s.setDomainFilter);
  const openArticle = useKnowledgeBaseStore((s) => s.openArticle);
  const startTree = useKnowledgeBaseStore((s) => s.startTree);
  const clearFilters = useKnowledgeBaseStore((s) => s.clearFilters);

  const domainCounts = useMemo(() => countByDomain(), []);

  const results = useMemo(() => {
    const filters = { domains: activeDomain ? [activeDomain] : undefined };

    if (searchQuery.trim()) {
      return searchArticles(searchQuery, filters);
    }

    let articles = KNOWLEDGE_BASE_ARTICLES;
    if (activeDomain) {
      articles = articles.filter((a) => a.domains.includes(activeDomain));
    }
    return articles.map((article) => ({
      article,
      relevanceScore: 0,
      matchedFields: [] as string[],
    }));
  }, [searchQuery, activeDomain]);

  const handleArticleClick = useCallback(
    (article: TsArticle) => openArticle(article.id),
    [openArticle]
  );

  // Sub-views
  if (view === "article") return <ArticleView />;
  if (view === "decision-tree") return <DecisionTreeView />;

  // ── Browser view ──
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="space-y-4">

          {/* ═══ HEADER CARD ═══════════════════════════════ */}
          <KbCard>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
                <BookOpen className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Knowledge Base</h2>
                <p className="text-2xs text-muted-foreground/60">
                  {KNOWLEDGE_BASE_ARTICLES.length} articles · VoIP, SIP, RTP, T.38, Networking
                </p>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search articles, SIP codes, symptoms..."
                className="w-full h-8 pl-8 pr-8 text-xs ui-control-shell"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground transition-smooth"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Domain filter tabs */}
            <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-0.5">
              <button
                type="button"
                className={cn(
                  "h-6 px-2 rounded-lg text-2xs font-medium transition-smooth shrink-0",
                  activeDomain === null
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/10"
                )}
                onClick={() => setDomainFilter(null)}
              >
                All ({KNOWLEDGE_BASE_ARTICLES.length})
              </button>
              {(Object.entries(DOMAIN_CONFIG) as [TsDomain, typeof DOMAIN_CONFIG[TsDomain]][]).map(
                ([domain, config]) => {
                  const count = domainCounts[domain] ?? 0;
                  if (count === 0) return null;
                  const Icon = config.icon;
                  return (
                    <button
                      key={domain}
                      type="button"
                      className={cn(
                        "h-6 px-2 rounded-lg text-2xs font-medium transition-smooth shrink-0 flex items-center gap-1",
                        activeDomain === domain
                          ? "bg-foreground/10 text-foreground"
                          : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/10"
                      )}
                      onClick={() => setDomainFilter(domain)}
                    >
                      <Icon className={cn("h-3 w-3", config.color)} />
                      {config.label} ({count})
                    </button>
                  );
                }
              )}
            </div>
          </KbCard>

          {/* ═══ GUIDED TROUBLESHOOTING ════════════════════ */}
          {!searchQuery.trim() && (
            <KbCard>
              <SectionHeader icon={ListOrdered} color="text-primary" title="Guided Troubleshooting" />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {DECISION_TREES.filter(
                  (dt) => !activeDomain || dt.domain === activeDomain
                ).map((dt) => {
                  const domainConf = DOMAIN_CONFIG[dt.domain];
                  return (
                    <TooltipWrapper key={dt.id} title={dt.title} description={dt.description}>
                      <button
                        type="button"
                        onClick={() => startTree(dt.id, dt.startNodeId)}
                        className="text-left rounded-lg bg-muted/10 p-2.5 hover:bg-muted/20 transition-smooth group"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="h-5 w-5 rounded bg-muted/30 flex items-center justify-center">
                            <ListOrdered className={cn("h-3 w-3", domainConf?.color ?? "text-muted-foreground")} />
                          </div>
                          <span className="text-2xs font-medium truncate group-hover:text-foreground">{dt.title}</span>
                        </div>
                        <p className="text-2xs text-muted-foreground/60 line-clamp-2 leading-relaxed">{dt.description}</p>
                      </button>
                    </TooltipWrapper>
                  );
                })}
              </div>
            </KbCard>
          )}

          {/* ═══ ARTICLE LIST ═════════════════════════════ */}
          <KbCard>
            <SectionHeader
              icon={BookOpen}
              color="text-primary"
              title={searchQuery.trim() ? `Results (${results.length})` : "Articles"}
              badge={
                searchQuery.trim() && results.length > 0
                  ? <span className="text-2xs text-muted-foreground/60 font-mono">{results.length} match{results.length !== 1 ? "es" : ""}</span>
                  : undefined
              }
            />

            {results.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No articles found"
                description={searchQuery ? `No results for "${searchQuery}"` : "No articles match the current filters."}
                action={
                  <Button variant="neutral" size="sm" onClick={clearFilters} className="h-7 text-xs">
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <div className="space-y-1">
                {results.map(({ article }) => (
                  <button
                    key={article.id}
                    type="button"
                    onClick={() => handleArticleClick(article)}
                    className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-muted/10 transition-smooth group flex items-start gap-2.5"
                  >
                    {/* Severity dot */}
                    <div className={cn("h-1.5 w-1.5 rounded-full shrink-0 mt-1.5", SEVERITY_DOT[article.severity])} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium group-hover:text-foreground leading-tight">{article.title}</span>
                      </div>
                      <p className="text-2xs text-muted-foreground/60 mt-0.5 line-clamp-1 leading-relaxed">{article.symptoms[0]}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {article.domains.map((d) => {
                          const conf = DOMAIN_CONFIG[d];
                          return (
                            <span key={d} className={cn("text-3xs font-medium", conf?.color ?? "text-muted-foreground/60")}>
                              {conf?.label ?? d}
                            </span>
                          );
                        })}
                        {article.relatedSipCodes?.slice(0, 3).map((code) => (
                          <span key={code} className="text-3xs font-mono text-muted-foreground/60">{code}</span>
                        ))}
                      </div>
                    </div>

                    <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0 mt-0.5 group-hover:text-muted-foreground/60 transition-smooth" />
                  </button>
                ))}
              </div>
            )}
          </KbCard>
        </div>
      </div>
    </div>
  );
}
