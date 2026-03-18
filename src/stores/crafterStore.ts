/**
 * Request Builder store — SIP Message Crafter & HTTP Request Client.
 * Persisted via session state (no persist middleware).
 */

import { create } from "zustand";
import type {
  SipRequestDraft,
  SipResponsePart,
  HttpRequestDraft,
  CrafterCollection,
  CrafterHistoryEntry,
  CrafterUiPrefs,
  CrafterSavedRequest,
  CrafterFolder,
} from "@/types/crafter";

const HISTORY_MAX = 500;
const RESPONSE_PREVIEW_MAX = 50 * 1024; // 50KB

export function generateCallId(): string {
  return `${crypto.randomUUID()}@sipalyzer`;
}

export function generateBranch(): string {
  return `z9hG4bK${Math.random().toString(36).slice(2, 15)}`;
}

export function generateFromTag(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultSipDraft(): SipRequestDraft {
  return {
    method: "OPTIONS",
    uri: "sip:192.168.1.1:5060",
    transport: "UDP",
    headers: [],
    body: "",
    bodyContentType: "application/sdp",
    auth: null,
  };
}

function defaultHttpDraft(): HttpRequestDraft {
  return {
    method: "GET",
    url: "https://api.example.com/",
    params: [],
    headers: [],
    bodyType: "none",
    bodyJson: "{}",
    bodyForm: [],
    bodyRaw: "",
    bodyRawContentType: "application/json",
    auth: { type: "none" },
  };
}

export interface CrafterState {
  /* Drafts */
  sipDraft: SipRequestDraft;
  httpDraft: HttpRequestDraft;

  /* Last responses (ephemeral, not persisted) */
  sipResponses: SipResponsePart[];
  httpResponse: unknown | null;

  /* Collections & History (persisted) */
  collections: CrafterCollection;
  history: CrafterHistoryEntry[];

  /* UI */
  activeSubview: "sip" | "http" | "collections" | "history" | "wiki";
  uiPrefs: CrafterUiPrefs;

  /* Actions */
  setSipDraft: (draft: Partial<SipRequestDraft>) => void;
  setHttpDraft: (draft: Partial<HttpRequestDraft>) => void;
  setSipResponses: (responses: SipResponsePart[]) => void;
  setHttpResponse: (r: unknown | null) => void;

  /* Collections */
  addFolder: (folder: CrafterFolder) => void;
  updateFolder: (id: string, updates: Partial<CrafterFolder>) => void;
  deleteFolder: (id: string) => void;
  addRequest: (req: CrafterSavedRequest) => void;
  updateRequest: (id: string, updates: Partial<CrafterSavedRequest>) => void;
  deleteRequest: (id: string) => void;
  reorderFolder: (folderId: string, newOrder: number) => void;
  moveRequestToFolder: (requestId: string, folderId: string | null) => void;

  /* History */
  addHistoryEntry: (entry: CrafterHistoryEntry) => void;
  clearHistory: () => void;
  clearHistorySelected: (ids: string[]) => void;

  /* Subview */
  setActiveSubview: (view: CrafterState["activeSubview"]) => void;
  setUiPrefs: (prefs: Partial<CrafterUiPrefs>) => void;

  /* Load from collection */
  loadSipRequest: (req: CrafterSavedRequest) => void;
  loadHttpRequest: (req: CrafterSavedRequest) => void;

  /* Reset drafts */
  resetSipDraft: () => void;
  resetHttpDraft: () => void;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useCrafterStore = create<CrafterState>((set) => ({
  sipDraft: defaultSipDraft(),
  httpDraft: defaultHttpDraft(),
  sipResponses: [],
  httpResponse: null,
  collections: { folders: [], requests: [] },
  history: [],
  activeSubview: "sip",
  uiPrefs: {
    lastSipMethod: "OPTIONS",
    lastHttpMethod: "GET",
    responseTimeoutSec: 10,
  },

  setSipDraft: (draft) =>
    set((s) => ({ sipDraft: { ...s.sipDraft, ...draft } })),

  setHttpDraft: (draft) =>
    set((s) => ({ httpDraft: { ...s.httpDraft, ...draft } })),

  setSipResponses: (responses) => set({ sipResponses: responses }),
  setHttpResponse: (r) => set({ httpResponse: r }),

  addFolder: (folder) =>
    set((s) => ({
      collections: {
        ...s.collections,
        folders: [...s.collections.folders, folder].sort((a, b) => a.order - b.order),
      },
    })),

  updateFolder: (id, updates) =>
    set((s) => ({
      collections: {
        ...s.collections,
        folders: s.collections.folders.map((f) =>
          f.id === id ? { ...f, ...updates } : f
        ),
      },
    })),

  deleteFolder: (id) =>
    set((s) => {
      const folders = s.collections.folders.filter((f) => f.id !== id);
      const requests = s.collections.requests.map((r) =>
        r.folderId === id ? { ...r, folderId: null } : r
      );
      return {
        collections: { ...s.collections, folders, requests },
      };
    }),

  addRequest: (req) =>
    set((s) => ({
      collections: {
        ...s.collections,
        requests: [...s.collections.requests, req],
      },
    })),

  updateRequest: (id, updates) =>
    set((s) => ({
      collections: {
        ...s.collections,
        requests: s.collections.requests.map((r) =>
          r.id === id ? { ...r, ...updates, updatedAt: Date.now() } : r
        ),
      },
    })),

  deleteRequest: (id) =>
    set((s) => ({
      collections: {
        ...s.collections,
        requests: s.collections.requests.filter((r) => r.id !== id),
      },
    })),

  reorderFolder: (folderId, newOrder) =>
    set((s) => ({
      collections: {
        ...s.collections,
        folders: s.collections.folders
          .map((f) => (f.id === folderId ? { ...f, order: newOrder } : f))
          .sort((a, b) => a.order - b.order),
      },
    })),

  moveRequestToFolder: (requestId, folderId) =>
    set((s) => ({
      collections: {
        ...s.collections,
        requests: s.collections.requests.map((r) =>
          r.id === requestId ? { ...r, folderId } : r
        ),
      },
    })),

  addHistoryEntry: (entry) =>
    set((s) => {
      const truncated = { ...entry };
      if (truncated.requestPreview && truncated.requestPreview.length > RESPONSE_PREVIEW_MAX) {
        truncated.requestPreview = truncated.requestPreview.slice(0, RESPONSE_PREVIEW_MAX) + "\n…[truncated]";
      }
      if (truncated.responsePreview && truncated.responsePreview.length > RESPONSE_PREVIEW_MAX) {
        truncated.responsePreview = truncated.responsePreview.slice(0, RESPONSE_PREVIEW_MAX) + "\n…[truncated]";
      }
      const next = [truncated, ...s.history].slice(0, HISTORY_MAX);
      return { history: next };
    }),

  clearHistory: () => set({ history: [] }),

  clearHistorySelected: (ids) =>
    set((s) => ({
      history: s.history.filter((h) => !ids.includes(h.id)),
    })),

  setActiveSubview: (view) => set({ activeSubview: view }),
  setUiPrefs: (prefs) =>
    set((s) => ({ uiPrefs: { ...s.uiPrefs, ...prefs } })),

  loadSipRequest: (req) => {
    if (req.sipRequest) set({ sipDraft: req.sipRequest });
  },

  loadHttpRequest: (req) => {
    if (req.httpRequest) set({ httpDraft: req.httpRequest });
  },

  resetSipDraft: () => set({ sipDraft: defaultSipDraft() }),
  resetHttpDraft: () => set({ httpDraft: defaultHttpDraft() }),
}));

export function createNewFolder(name: string, parentId: string | null = null): CrafterFolder {
  const folders = useCrafterStore.getState().collections.folders;
  const maxOrder = folders.length ? Math.max(...folders.map((f) => f.order)) : 0;
  return {
    id: nextId("folder"),
    name,
    parentId,
    order: maxOrder + 1,
    createdAt: Date.now(),
  };
}

export function createNewRequest(protocol: "sip" | "http", name: string): CrafterSavedRequest {
  const sipDraft = useCrafterStore.getState().sipDraft;
  const httpDraft = useCrafterStore.getState().httpDraft;
  const now = Date.now();
  return {
    id: nextId("req"),
    protocol,
    name,
    sipRequest: protocol === "sip" ? sipDraft : undefined,
    httpRequest: protocol === "http" ? httpDraft : undefined,
    createdAt: now,
    updatedAt: now,
  };
}
