/**
 * Knowledge Base Store — UI state for browsing, searching, and navigating
 * the troubleshooting knowledge base and decision trees.
 */

import { create } from "zustand";
import type { TsDomain, TsCategory } from "@/types/troubleshootingEngine";

export type KbView = "browser" | "article" | "decision-tree";

export interface KnowledgeBaseState {
  /** Current view mode. */
  view: KbView;

  // ── Search & Filters ──
  searchQuery: string;
  activeDomain: TsDomain | null;
  activeCategory: TsCategory | null;
  activeSeverity: ("critical" | "warning" | "info")[] | null;

  // ── Article ──
  /** Currently selected article ID. */
  selectedArticleId: string | null;

  // ── Decision Tree ──
  /** Currently active decision tree ID. */
  activeTreeId: string | null;
  /** Current node in the decision tree. */
  currentNodeId: string | null;
  /** History of visited node IDs for back-tracking. */
  nodeHistory: string[];

  // ── Recently Viewed ──
  recentArticleIds: string[];

  // ── Panel state ──
  /** Whether the KB panel is open (for slide-over usage from other views). */
  isPanelOpen: boolean;

  // ── Actions ──
  setSearchQuery: (query: string) => void;
  setDomainFilter: (domain: TsDomain | null) => void;
  setCategoryFilter: (category: TsCategory | null) => void;
  setSeverityFilter: (severity: ("critical" | "warning" | "info")[] | null) => void;
  clearFilters: () => void;

  /** Open an article (sets view to "article"). */
  openArticle: (articleId: string) => void;
  /** Go back to browser view. */
  closArticle: () => void;

  /** Start a decision tree. */
  startTree: (treeId: string, startNodeId: string) => void;
  /** Navigate to a node in the decision tree. */
  goToNode: (nodeId: string) => void;
  /** Go back to the previous node. */
  goBack: () => void;
  /** Exit the decision tree. */
  exitTree: () => void;

  /** Open the KB panel (slide-over) with optional article or search. */
  openPanel: (opts?: { articleId?: string; searchQuery?: string; sipCode?: number }) => void;
  closePanel: () => void;

  /** Reset the entire store. */
  reset: () => void;
}

const MAX_RECENT = 20;

export const useKnowledgeBaseStore = create<KnowledgeBaseState>((set, get) => ({
  view: "browser",
  searchQuery: "",
  activeDomain: null,
  activeCategory: null,
  activeSeverity: null,
  selectedArticleId: null,
  activeTreeId: null,
  currentNodeId: null,
  nodeHistory: [],
  recentArticleIds: [],
  isPanelOpen: false,

  setSearchQuery: (query) => set({ searchQuery: query }),

  setDomainFilter: (domain) => set({ activeDomain: domain, activeCategory: null }),

  setCategoryFilter: (category) => set({ activeCategory: category }),

  setSeverityFilter: (severity) => set({ activeSeverity: severity }),

  clearFilters: () => set({ activeDomain: null, activeCategory: null, activeSeverity: null, searchQuery: "" }),

  openArticle: (articleId) => {
    const recent = get().recentArticleIds.filter((id) => id !== articleId);
    recent.unshift(articleId);
    if (recent.length > MAX_RECENT) recent.pop();
    set({
      view: "article",
      selectedArticleId: articleId,
      recentArticleIds: recent,
    });
  },

  closArticle: () => set({ view: "browser", selectedArticleId: null }),

  startTree: (treeId, startNodeId) =>
    set({
      view: "decision-tree",
      activeTreeId: treeId,
      currentNodeId: startNodeId,
      nodeHistory: [],
    }),

  goToNode: (nodeId) =>
    set((s) => ({
      currentNodeId: nodeId,
      nodeHistory: s.currentNodeId ? [...s.nodeHistory, s.currentNodeId] : s.nodeHistory,
    })),

  goBack: () =>
    set((s) => {
      const history = [...s.nodeHistory];
      const prev = history.pop();
      if (!prev) return { view: "browser", activeTreeId: null, currentNodeId: null, nodeHistory: [] };
      return { currentNodeId: prev, nodeHistory: history };
    }),

  exitTree: () =>
    set({ view: "browser", activeTreeId: null, currentNodeId: null, nodeHistory: [] }),

  openPanel: (opts) => {
    const updates: Partial<KnowledgeBaseState> = { isPanelOpen: true };
    if (opts?.articleId) {
      updates.view = "article";
      updates.selectedArticleId = opts.articleId;
    } else if (opts?.searchQuery) {
      updates.view = "browser";
      updates.searchQuery = opts.searchQuery;
    } else if (opts?.sipCode) {
      updates.view = "browser";
      updates.searchQuery = String(opts.sipCode);
    }
    set(updates as KnowledgeBaseState);
  },

  closePanel: () => set({ isPanelOpen: false }),

  reset: () =>
    set({
      view: "browser",
      searchQuery: "",
      activeDomain: null,
      activeCategory: null,
      activeSeverity: null,
      selectedArticleId: null,
      activeTreeId: null,
      currentNodeId: null,
      nodeHistory: [],
      isPanelOpen: false,
    }),
}));
