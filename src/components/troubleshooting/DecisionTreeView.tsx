/**
 * DecisionTreeView — interactive guided troubleshooting.
 * Unified with the app's design: translucent cards, compact typography, uppercase section headers.
 */

import { useMemo } from "react";
import { useKnowledgeBaseStore } from "@/stores/knowledgeBaseStore";
import { getDecisionTreeById } from "@/data/troubleshootingDecisionTrees";
import { getArticleById } from "@/data/troubleshootingKnowledgeBase";
import { navigateTo } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  ArrowLeft,
  RotateCcw,
  ChevronRight,
  CheckCircle2,
  BookOpen,
  Wrench,
  ListOrdered,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { TsDecisionNode } from "@/types/troubleshootingEngine";

// ── Styled helpers ──

function TreeCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("surface px-5 py-4", className)}>
      {children}
    </div>
  );
}

function SectionHeader({ title, icon: Icon, color }: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {Icon && <Icon className={cn("h-3.5 w-3.5", color ?? "text-muted-foreground/60")} />}
      <h3 className="section-label-sm">{title}</h3>
    </div>
  );
}

const NODE_ICON: Record<TsDecisionNode["type"], typeof CheckCircle2> = {
  question: ListOrdered,
  action: Wrench,
  result: CheckCircle2,
};
const NODE_COLOR: Record<TsDecisionNode["type"], string> = {
  question: "text-primary",
  action: "text-warning",
  result: "text-success",
};

export function DecisionTreeView() {
  const activeTreeId = useKnowledgeBaseStore((s) => s.activeTreeId);
  const currentNodeId = useKnowledgeBaseStore((s) => s.currentNodeId);
  const nodeHistory = useKnowledgeBaseStore((s) => s.nodeHistory);
  const goToNode = useKnowledgeBaseStore((s) => s.goToNode);
  const goBack = useKnowledgeBaseStore((s) => s.goBack);
  const exitTree = useKnowledgeBaseStore((s) => s.exitTree);
  const openArticle = useKnowledgeBaseStore((s) => s.openArticle);
  const startTree = useKnowledgeBaseStore((s) => s.startTree);

  const tree = useMemo(() => (activeTreeId ? getDecisionTreeById(activeTreeId) : undefined), [activeTreeId]);
  const node = useMemo(
    () => tree?.nodes.find((n) => n.id === currentNodeId),
    [tree, currentNodeId]
  );

  if (!tree || !node) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Decision tree not found.</p>
        <Button variant="neutral" size="sm" onClick={exitTree} className="mt-2 gap-2 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
      </div>
    );
  }

  const linkedArticle = node.articleId ? getArticleById(node.articleId) : undefined;
  const NodeIcon = NODE_ICON[node.type];
  const nodeColor = NODE_COLOR[node.type];
  const stepNum = nodeHistory.length + 1;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* ── Sticky header ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 surface-subtle border-b border-border/50">
        <TooltipWrapper title="Exit" description="Exit this guided troubleshooting.">
          <button type="button" onClick={exitTree} className="h-7 w-7 rounded-md ui-control-shell flex items-center justify-center">
            <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </TooltipWrapper>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold truncate">{tree.title}</h2>
          <p className="text-2xs text-muted-foreground/60 truncate">{tree.description}</p>
        </div>
        <div className="flex items-center gap-1">
          {nodeHistory.length > 0 && (
            <TooltipWrapper title="Back" description="Go to the previous step.">
              <button type="button" onClick={goBack} className="h-7 w-7 rounded-md ui-control-shell flex items-center justify-center">
                <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipWrapper>
          )}
          <TooltipWrapper title="Start over" description="Restart from the beginning.">
            <button type="button" onClick={() => startTree(tree.id, tree.startNodeId)} className="h-7 w-7 rounded-md ui-control-shell flex items-center justify-center">
              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </TooltipWrapper>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="space-y-4">

          {/* ═══ PROGRESS ════════════════════════════════ */}
          <div className="flex items-center gap-2">
            {Array.from({ length: Math.min(stepNum + 2, 8) }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 rounded-full flex-1 transition-smooth",
                  i < stepNum ? "bg-foreground/20" : "bg-muted/10"
                )}
              />
            ))}
            <span className="text-3xs text-muted-foreground/60 font-mono tabular-nums ml-1">Step {stepNum}</span>
          </div>

          {/* ═══ CURRENT NODE ════════════════════════════ */}
          <TreeCard className={cn(
            node.type === "result" && "bg-success/[0.04]",
            node.type === "action" && "bg-warning/[0.04]"
          )}>
            <div className="flex items-center gap-2 mb-3">
              <div className={cn("h-6 w-6 rounded-lg bg-muted/50 flex items-center justify-center")}>
                <NodeIcon className={cn("h-3.5 w-3.5", nodeColor)} />
              </div>
              <span className={cn("section-label-sm", nodeColor)}>
                {node.type === "question" ? "Question" : node.type === "action" ? "Action" : "Result"}
              </span>
            </div>

            <p className="text-sm leading-relaxed mb-4">{node.text}</p>
            {node.detail && (
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap -mt-2 mb-4">
                {node.detail}
              </p>
            )}

            {/* ── Options (for question nodes) ── */}
            {node.options && node.options.length > 0 && (
              <div className="space-y-1.5">
                {node.options.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => goToNode(opt.nextNodeId)}
                    className="w-full text-left flex items-center gap-2.5 rounded-lg bg-muted/10 px-3 py-2.5 hover:bg-muted/20 transition-smooth group"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium group-hover:text-foreground">{opt.label}</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 group-hover:text-muted-foreground/60 transition-smooth" />
                  </button>
                ))}
              </div>
            )}

            {/* ── Next button (for action nodes) ── */}
            {node.type === "action" && node.options != null && node.options.length === 1 && (() => {
              const nextId = node.options![0]!.nextNodeId;
              return (
                <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => goToNode(nextId)}>
                  Next <ChevronRight className="h-3 w-3" />
                </Button>
              );
            })()}
          </TreeCard>

          {/* ═══ LINKED ARTICLE ══════════════════════════ */}
          {linkedArticle && (
            <TreeCard>
              <SectionHeader title="Related Article" icon={BookOpen} color="text-primary" />
              <button
                type="button"
                onClick={() => openArticle(linkedArticle.id)}
                className="w-full text-left flex items-center gap-2.5 rounded-lg bg-muted/10 px-3 py-2.5 hover:bg-muted/20 transition-smooth group"
              >
                <BookOpen className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 group-hover:text-muted-foreground/60" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate group-hover:text-foreground">{linkedArticle.title}</p>
                  <p className="text-2xs text-muted-foreground/60 truncate mt-0.5">{linkedArticle.symptoms[0]}</p>
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0 group-hover:text-muted-foreground/60" />
              </button>
            </TreeCard>
          )}

          {/* ═══ TOOL LINKS ═════════════════════════════ */}
          {node.toolLink && (
            <TreeCard>
              <SectionHeader title="Open in SIPalyzer" icon={Wrench} color="text-warning" />
              <TooltipWrapper title={node.toolLink.label} description={`Open ${node.toolLink.label} to help diagnose.`}>
                <button
                  type="button"
                  onClick={() => navigateTo(node.toolLink!.toolId, node.toolLink!.subviewId)}
                  className="h-7 px-2.5 rounded-lg bg-muted/10 hover:bg-muted/20 transition-smooth flex items-center gap-1.5 text-2xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Wrench className="h-3 w-3" />
                  {node.toolLink.label}
                </button>
              </TooltipWrapper>
            </TreeCard>
          )}

          {/* ═══ HISTORY (breadcrumb) ════════════════════ */}
          {nodeHistory.length > 0 && (
            <TreeCard>
              <SectionHeader title="Path taken" />
              <div className="flex flex-wrap items-center gap-1">
                {nodeHistory.map((nid, i) => {
                  const historyNode = tree.nodes.find((n) => n.id === nid);
                  if (!historyNode) return null;
                  return (
                    <span key={i} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          // Go back to this step
                          const stepsBack = nodeHistory.length - i;
                          for (let s = 0; s < stepsBack; s++) goBack();
                        }}
                        className="text-2xs text-muted-foreground/60 hover:text-foreground truncate max-w-32 transition-smooth"
                      >
                        {historyNode.text.slice(0, 40)}{historyNode.text.length > 40 ? "…" : ""}
                      </button>
                      <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
                    </span>
                  );
                })}
                <span className="text-2xs text-foreground/80 font-medium truncate max-w-40">
                  {node.text.slice(0, 40)}{node.text.length > 40 ? "…" : ""}
                </span>
              </div>
            </TreeCard>
          )}
        </div>
      </div>
    </div>
  );
}
