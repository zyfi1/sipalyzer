/**
 * Troubleshooting Engine — type definitions for the knowledge base, decision trees,
 * SIP response code map, and engine interfaces.
 *
 * These types power the world-class VoIP/SIP/RTP/T.38/networking troubleshooting system.
 */

// ── Domains & Categories ──

/** High-level protocol/technology domains. */
export type TsDomain = "sip" | "rtp" | "t38" | "network" | "dns" | "security" | "general";

/** Fine-grained troubleshooting categories. */
export type TsCategory =
  | "registration"
  | "call-setup"
  | "media"
  | "audio-quality"
  | "one-way-audio"
  | "call-drops"
  | "codec"
  | "nat-firewall"
  | "fax"
  | "dtmf"
  | "dns-resolution"
  | "qos"
  | "certificates"
  | "interop"
  | "session-timers"
  | "caller-id";

// ── Knowledge Base Articles ──

/** A single troubleshooting article in the knowledge base. */
export interface TsArticle {
  id: string;
  title: string;
  domains: TsDomain[];
  categories: TsCategory[];
  severity: "critical" | "warning" | "info";
  /** User-observable symptoms that indicate this issue. */
  symptoms: string[];
  /** Root causes ranked by likelihood. */
  causes: TsCause[];
  /** Step-by-step diagnostic instructions. */
  diagnosticSteps: TsDiagnosticStep[];
  /** Resolution steps, each with optional precondition. */
  solutions: TsSolution[];
  /** SIP response codes associated with this issue. */
  relatedSipCodes?: number[];
  /** IDs of related KB articles for cross-linking. */
  relatedArticleIds?: string[];
  /** Published references (RFCs, vendor docs, community). */
  references: TsReference[];
  /** SIPalyzer tools relevant to diagnosing this issue. */
  sipalizerTools?: TsToolLink[];
  /** Search keywords for full-text matching. */
  keywords: string[];
  /** ISO date of last content update (YYYY-MM-DD). */
  lastUpdated: string;
}

export interface TsCause {
  summary: string;
  likelihood: "high" | "medium" | "low";
  detail: string;
}

export interface TsDiagnosticStep {
  order: number;
  instruction: string;
  /** What you should see if this step confirms the issue. */
  expected?: string;
}

export interface TsSolution {
  summary: string;
  steps: string[];
  /** When this particular solution applies (e.g. "When behind NAT"). */
  appliesWhen?: string;
}

export interface TsReference {
  title: string;
  url: string;
  type: "rfc" | "vendor" | "community" | "standard";
}

export interface TsToolLink {
  toolId: string;
  subviewId?: string;
  label: string;
}

// ── Decision Trees ──

/** An interactive troubleshooting decision tree. */
export interface TsDecisionTree {
  id: string;
  title: string;
  domain: TsDomain;
  description: string;
  nodes: TsDecisionNode[];
  startNodeId: string;
}

export interface TsDecisionNode {
  id: string;
  type: "question" | "action" | "result";
  text: string;
  detail?: string;
  /** Branching options (for question nodes). */
  options?: { label: string; nextNodeId: string }[];
  /** Link to a KB article (for result nodes). */
  articleId?: string;
  /** Link to a SIPalyzer tool (for action nodes). */
  toolLink?: TsToolLink;
}

// ── SIP Response Code Map ──

/** Entry in the SIP response code reference map. */
export interface SipCodeEntry {
  code: number;
  name: string;
  description: string;
  /** RFC that defines this code. */
  rfcReference: string;
  /** Common causes for encountering this code. */
  causes: string[];
  /** Troubleshooting actions to take. */
  actions: string[];
  /** IDs of related KB articles. */
  articleIds: string[];
  /** SIPalyzer tool to help diagnose. */
  toolLink?: TsToolLink;
}

// ── Engine Interfaces ──

/** Filters for searching the knowledge base. */
export interface TsSearchFilters {
  domains?: TsDomain[];
  categories?: TsCategory[];
  severity?: ("critical" | "warning" | "info")[];
}

/** Diagnostic data for symptom matching against KB articles. */
export interface TsDiagnosticData {
  sipCodes?: number[];
  mos?: number;
  jitterMs?: number;
  lossPercent?: number;
  latencyMs?: number;
  registrationFailed?: boolean;
  oneWayAudio?: boolean;
  noAudio?: boolean;
  faxFailed?: boolean;
  callDropped?: boolean;
  callDropTimeSeconds?: number;
}

/** A search result with relevance score. */
export interface TsSearchResult {
  article: TsArticle;
  relevanceScore: number;
  /** Which fields matched the query. */
  matchedFields: string[];
}
