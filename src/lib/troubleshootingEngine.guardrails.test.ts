import { describe, expect, it } from "vitest";

import { DECISION_TREES } from "@/data/troubleshootingDecisionTrees";
import { KNOWLEDGE_BASE_ARTICLES, getArticleById } from "@/data/troubleshootingKnowledgeBase";
import { SIP_RESPONSE_CODE_MAP } from "@/data/sipResponseCodeMap";
import { matchSymptoms, mergeMatchSignals } from "@/lib/troubleshootingEngine";

describe("troubleshooting data integrity guardrails", () => {
  it("ensures SIP response map articleIds exist in troubleshooting knowledge base", () => {
    const articleIds = new Set(KNOWLEDGE_BASE_ARTICLES.map((article) => article.id));
    const missingRefs: string[] = [];

    for (const [code, entry] of Object.entries(SIP_RESPONSE_CODE_MAP)) {
      for (const articleId of entry.articleIds) {
        if (!articleIds.has(articleId)) {
          missingRefs.push(`${code} -> ${articleId}`);
        }
      }
    }

    expect(missingRefs).toEqual([]);
  });

  it("ensures decision-tree branch targets and result articleIds are valid", () => {
    const missingStartNodes: string[] = [];
    const missingNextNodeLinks: string[] = [];
    const missingArticleLinks: string[] = [];
    const duplicateNodeIds: string[] = [];

    for (const tree of DECISION_TREES) {
      const nodeIds = tree.nodes.map((node) => node.id);
      const nodeIdSet = new Set(nodeIds);

      if (nodeIds.length !== nodeIdSet.size) {
        duplicateNodeIds.push(tree.id);
      }
      if (!nodeIdSet.has(tree.startNodeId)) {
        missingStartNodes.push(`${tree.id} -> ${tree.startNodeId}`);
      }

      for (const node of tree.nodes) {
        for (const option of node.options ?? []) {
          if (!nodeIdSet.has(option.nextNodeId)) {
            missingNextNodeLinks.push(`${tree.id}/${node.id} -> ${option.nextNodeId}`);
          }
        }

        if (node.articleId && !getArticleById(node.articleId)) {
          missingArticleLinks.push(`${tree.id}/${node.id} -> ${node.articleId}`);
        }
      }
    }

    expect(duplicateNodeIds).toEqual([]);
    expect(missingStartNodes).toEqual([]);
    expect(missingNextNodeLinks).toEqual([]);
    expect(missingArticleLinks).toEqual([]);
  });
});

describe("matchSymptoms merge behavior", () => {
  it("upgrades relevance when a stronger later signal is merged", () => {
    const article = getArticleById("session-timer-expiry");
    expect(article).toBeDefined();
    if (!article) return;

    const weaker = mergeMatchSignals(undefined, article, 6, "registrationFailed");
    const stronger = mergeMatchSignals(weaker, article, 10, "SIP 422");

    expect(stronger.relevanceScore).toBe(10);
    expect(stronger.matchedFields).toEqual(["registrationFailed", "SIP 422"]);
  });

  it("keeps matchedFields unique while preserving all distinct context", () => {
    const article = getArticleById("reg-401-unauthorized");
    expect(article).toBeDefined();
    if (!article) return;

    const first = mergeMatchSignals(undefined, article, 8, "registrationFailed");
    const second = mergeMatchSignals(first, article, 8, "registrationFailed");
    const third = mergeMatchSignals(second, article, 10, "SIP 401");

    expect(third.relevanceScore).toBe(10);
    expect(third.matchedFields).toEqual(["registrationFailed", "SIP 401"]);
  });

  it("merges multiple signals for the same article in matchSymptoms output", () => {
    const results = matchSymptoms({
      sipCodes: [401],
      registrationFailed: true,
    });

    const authArticle = results.find((result) => result.article.id === "reg-401-unauthorized");
    expect(authArticle).toBeDefined();
    expect(authArticle?.relevanceScore).toBe(10);
    expect(authArticle?.matchedFields).toEqual(expect.arrayContaining(["SIP 401", "registrationFailed"]));
  });
});
