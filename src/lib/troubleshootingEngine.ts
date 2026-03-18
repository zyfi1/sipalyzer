/**
 * Troubleshooting Engine — core logic for searching, matching, and linking
 * the knowledge base to live diagnostic data.
 */

import type {
  TsArticle,
  TsDomain,
  TsSearchFilters,
  TsSearchResult,
  TsDiagnosticData,
  SipCodeEntry,
} from "@/types/troubleshootingEngine";
import { KNOWLEDGE_BASE_ARTICLES, getArticleById } from "@/data/troubleshootingKnowledgeBase";
import { getSipCode } from "@/data/sipResponseCodeMap";
import { VOIP_THRESHOLDS } from "@/lib/voipThresholds";

// ── Full-text search ──

/** Normalize a string for search (lowercase, trim). */
function norm(s: string): string {
  return s.toLowerCase().trim();
}

/** Score how well a query matches an article. Higher = better match. */
function scoreArticle(article: TsArticle, queryTerms: string[]): { score: number; matchedFields: string[] } {
  let score = 0;
  const matchedFields: string[] = [];
  const titleLower = norm(article.title);
  const symptomsLower = article.symptoms.map(norm);
  const keywordsLower = article.keywords.map(norm);
  const causesLower = article.causes.map((c) => norm(c.summary));

  for (const term of queryTerms) {
    // Title match (highest weight)
    if (titleLower.includes(term)) {
      score += 10;
      if (!matchedFields.includes("title")) matchedFields.push("title");
    }
    // Keyword match
    if (keywordsLower.some((k) => k.includes(term) || term.includes(k))) {
      score += 8;
      if (!matchedFields.includes("keywords")) matchedFields.push("keywords");
    }
    // Symptom match
    if (symptomsLower.some((s) => s.includes(term))) {
      score += 6;
      if (!matchedFields.includes("symptoms")) matchedFields.push("symptoms");
    }
    // Cause match
    if (causesLower.some((c) => c.includes(term))) {
      score += 4;
      if (!matchedFields.includes("causes")) matchedFields.push("causes");
    }
    // ID match (for direct article references)
    if (norm(article.id).includes(term)) {
      score += 5;
      if (!matchedFields.includes("id")) matchedFields.push("id");
    }
  }

  // Exact SIP code match (e.g., searching "401")
  for (const term of queryTerms) {
    const codeNum = parseInt(term, 10);
    if (!isNaN(codeNum) && article.relatedSipCodes?.includes(codeNum)) {
      score += 12;
      if (!matchedFields.includes("sipCode")) matchedFields.push("sipCode");
    }
  }

  return { score, matchedFields };
}

/**
 * Search articles by query string with optional filters.
 * Returns results sorted by relevance score (highest first).
 */
export function searchArticles(query: string, filters?: TsSearchFilters): TsSearchResult[] {
  const queryTerms = norm(query).split(/\s+/).filter(Boolean);
  if (queryTerms.length === 0 && !filters) return [];

  let candidates = KNOWLEDGE_BASE_ARTICLES;

  // Apply filters
  if (filters?.domains?.length) {
    candidates = candidates.filter((a) => a.domains.some((d) => filters.domains!.includes(d)));
  }
  if (filters?.categories?.length) {
    candidates = candidates.filter((a) => a.categories.some((c) => filters.categories!.includes(c)));
  }
  if (filters?.severity?.length) {
    candidates = candidates.filter((a) => filters.severity!.includes(a.severity));
  }

  // If only filters (no query), return all matching articles
  if (queryTerms.length === 0) {
    return candidates.map((article) => ({
      article,
      relevanceScore: 1,
      matchedFields: ["filter"],
    }));
  }

  // Score and filter
  const results: TsSearchResult[] = [];
  for (const article of candidates) {
    const { score, matchedFields } = scoreArticle(article, queryTerms);
    if (score > 0) {
      results.push({ article, relevanceScore: score, matchedFields });
    }
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results;
}

// ── Symptom matching ──

/**
 * Given live diagnostic data (SIP codes, RTP metrics, etc.),
 * find matching KB articles ranked by relevance.
 */
export function matchSymptoms(data: TsDiagnosticData): TsSearchResult[] {
  const byArticleId = new Map<string, TsSearchResult>();

  function addMatch(article: TsArticle, score: number, field: string) {
    const existing = byArticleId.get(article.id);
    byArticleId.set(article.id, mergeMatchSignals(existing, article, score, field));
  }

  // Match SIP codes
  if (data.sipCodes?.length) {
    for (const code of data.sipCodes) {
      const codeArticles = KNOWLEDGE_BASE_ARTICLES.filter((a) => a.relatedSipCodes?.includes(code));
      for (const a of codeArticles) addMatch(a, 10, `SIP ${code}`);
    }
  }

  // Match RTP quality metrics
  if (data.mos != null && data.mos < VOIP_THRESHOLDS.mos.warnBelow) {
    const mosArticle = getArticleById("poor-mos-score");
    if (mosArticle) addMatch(mosArticle, data.mos < VOIP_THRESHOLDS.mos.criticalBelow ? 10 : 7, "MOS");
  }

  if (data.jitterMs != null && data.jitterMs > VOIP_THRESHOLDS.jitter.warnAbove) {
    const jitterArticle = getArticleById("high-jitter");
    if (jitterArticle) addMatch(jitterArticle, data.jitterMs > VOIP_THRESHOLDS.jitter.criticalAbove ? 10 : 7, "jitter");
  }

  if (data.lossPercent != null && data.lossPercent > VOIP_THRESHOLDS.packetLoss.warnAbove) {
    const lossArticle = getArticleById("packet-loss-impact");
    if (lossArticle) addMatch(lossArticle, data.lossPercent > VOIP_THRESHOLDS.packetLoss.criticalAbove ? 10 : 7, "packetLoss");
  }

  // Match symptoms
  if (data.oneWayAudio) {
    const a = getArticleById("one-way-audio");
    if (a) addMatch(a, 10, "oneWayAudio");
  }

  if (data.noAudio) {
    const a = getArticleById("no-audio");
    if (a) addMatch(a, 10, "noAudio");
  }

  if (data.registrationFailed) {
    const a = getArticleById("reg-401-unauthorized");
    if (a) addMatch(a, 8, "registrationFailed");
    const b = getArticleById("nat-registration-issues");
    if (b) addMatch(b, 6, "registrationFailed");
  }

  if (data.faxFailed) {
    const a = getArticleById("t38-vs-passthrough");
    if (a) addMatch(a, 8, "faxFailed");
    const b = getArticleById("t38-page-loss");
    if (b) addMatch(b, 6, "faxFailed");
  }

  if (data.callDropped) {
    if (data.callDropTimeSeconds != null && data.callDropTimeSeconds >= 28 && data.callDropTimeSeconds <= 35) {
      const a = getArticleById("call-drops-30-seconds");
      if (a) addMatch(a, 10, "callDrop30s");
    } else {
      const a = getArticleById("session-timer-expiry");
      if (a) addMatch(a, 7, "callDropped");
    }
  }

  const results = Array.from(byArticleId.values());
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results;
}

export function mergeMatchSignals(
  existing: TsSearchResult | undefined,
  article: TsArticle,
  score: number,
  field: string,
): TsSearchResult {
  if (!existing) {
    return { article, relevanceScore: score, matchedFields: [field] };
  }

  existing.relevanceScore = Math.max(existing.relevanceScore, score);
  if (!existing.matchedFields.includes(field)) {
    existing.matchedFields.push(field);
  }
  return existing;
}

// ── SIP code lookups ──

/** Get full SIP response code info. */
export function getSipCodeInfo(code: number): SipCodeEntry | undefined {
  return getSipCode(code);
}

/** Get all KB articles related to a specific SIP code. */
export function getArticlesForSipCode(code: number): TsArticle[] {
  // First from the code map
  const codeEntry = getSipCode(code);
  const articleIds = new Set(codeEntry?.articleIds ?? []);

  // Also from articles that list this code
  for (const a of KNOWLEDGE_BASE_ARTICLES) {
    if (a.relatedSipCodes?.includes(code)) articleIds.add(a.id);
  }

  return Array.from(articleIds)
    .map((id) => getArticleById(id))
    .filter((a): a is TsArticle => a != null);
}

// ── Domain/category lookups ──

/** Get all articles for a domain. */
export function getArticlesForDomain(domain: TsDomain): TsArticle[] {
  return KNOWLEDGE_BASE_ARTICLES.filter((a) => a.domains.includes(domain));
}

/** Get related articles for a given article ID. */
export function getRelatedArticles(articleId: string): TsArticle[] {
  const article = getArticleById(articleId);
  if (!article?.relatedArticleIds?.length) return [];
  return article.relatedArticleIds
    .map((id) => getArticleById(id))
    .filter((a): a is TsArticle => a != null);
}

// ── Metric-based article lookup ──

/** Get relevant articles for a specific metric value. */
export function getArticlesForMetric(metric: "mos" | "jitter" | "loss" | "latency", value: number): TsArticle[] {
  switch (metric) {
    case "mos":
      if (value < VOIP_THRESHOLDS.mos.warnBelow) {
        return [getArticleById("poor-mos-score")].filter((a): a is TsArticle => a != null);
      }
      return [];
    case "jitter":
      if (value > VOIP_THRESHOLDS.jitter.warnAbove) {
        return [getArticleById("high-jitter")].filter((a): a is TsArticle => a != null);
      }
      return [];
    case "loss":
      if (value > VOIP_THRESHOLDS.packetLoss.warnAbove) {
        return [getArticleById("packet-loss-impact")].filter((a): a is TsArticle => a != null);
      }
      return [];
    case "latency":
      if (value > VOIP_THRESHOLDS.latency.warnAbove) {
        return [getArticleById("poor-mos-score")].filter((a): a is TsArticle => a != null);
      }
      return [];
  }
}

/** Get all unique domains that have articles. */
export function getAvailableDomains(): TsDomain[] {
  const domains = new Set<TsDomain>();
  for (const a of KNOWLEDGE_BASE_ARTICLES) {
    for (const d of a.domains) domains.add(d);
  }
  return Array.from(domains);
}

/** Count articles by domain. */
export function countByDomain(): Record<TsDomain, number> {
  const counts: Partial<Record<TsDomain, number>> = {};
  for (const a of KNOWLEDGE_BASE_ARTICLES) {
    for (const d of a.domains) {
      counts[d] = (counts[d] ?? 0) + 1;
    }
  }
  return counts as Record<TsDomain, number>;
}
