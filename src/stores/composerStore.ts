/**
 * Unified Network Composer store.
 *
 * Absorbs sshStore + crafterStore into a single Zustand store with:
 *   - Collections (folders + items of any protocol)
 *   - Environments (variable sets with {{var}} interpolation)
 *   - Open tabs (composer tab management)
 *   - Unified history (SSH, HTTP, SIP, WebSocket, GraphQL)
 *   - SSH port profiles
 *   - UI preferences
 *
 * Persisted via session state (no persist middleware).
 */

import { create } from "zustand";
import type {
  ComposerCollection,
  ComposerItem,
  ComposerFolder,
  ComposerTab,
  ComposerHistoryEntry,
  ComposerEnvironment,
  PortProfile,
  ComposerUiPrefs,
  ComposerProtocol,
  WebSocketMessage,
} from "@/types/composer";
import { DEFAULT_UI_PREFS, DEFAULT_SSH_ADVANCED } from "@/types/composer";
import type { SipRequestDraft, HttpRequestDraft, SipResponsePart } from "@/types/crafter";

// ── Constants ───────────────────────────────────────────────────────────────

const HISTORY_MAX = 500;

// ── ID generators ───────────────────────────────────────────────────────────

let _seqId = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${(_seqId++).toString(36)}`;
}

export function newItemId(): string {
  return nextId("item");
}
export function newFolderId(): string {
  return nextId("folder");
}
export function newEnvId(): string {
  return nextId("env");
}
export function newRuleId(): string {
  return nextId("rule");
}

// ── Default drafts ──────────────────────────────────────────────────────────

export function defaultSipDraft(): SipRequestDraft {
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

export function defaultHttpDraft(): HttpRequestDraft {
  return {
    method: "GET",
    url: "https://example.com/api",
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

export function generateCallId(): string {
  return `${crypto.randomUUID()}@sipalyzer`;
}

export function generateBranch(): string {
  return `z9hG4bK${Math.random().toString(36).slice(2, 15)}`;
}

export function generateFromTag(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Store interface ─────────────────────────────────────────────────────────

export interface ComposerState {
  /* ── Collections ───────────────────────────────────────────── */
  collections: ComposerCollection;

  /* ── Environments ──────────────────────────────────────────── */
  environments: ComposerEnvironment[];
  activeEnvironmentId: string | null;
  /** Global variables that apply regardless of active environment */
  globalVariables: Array<{ key: string; value: string; enabled: boolean }>;

  /* ── Open tabs ─────────────────────────────────────────────── */
  openTabs: ComposerTab[];
  activeTabId: string | null;

  /* ── Per-tab draft state (ephemeral, not persisted) ────────── */
  sipDraft: SipRequestDraft;
  httpDraft: HttpRequestDraft;
  sipResponses: SipResponsePart[];
  httpResponse: unknown | null;
  /** WebSocket messages for the currently active WS tab */
  wsMessages: WebSocketMessage[];
  wsConnected: boolean;

  /* ── History ───────────────────────────────────────────────── */
  history: ComposerHistoryEntry[];

  /* ── SSH Port Profiles ─────────────────────────────────────── */
  portProfiles: PortProfile[];

  /* ── UI Preferences ────────────────────────────────────────── */
  uiPrefs: ComposerUiPrefs;

  /* ── Ephemeral UI state (not persisted) ────────────────────── */
  sidebarSearch: string;

  /* ═══ Actions ══════════════════════════════════════════════════ */

  /* ── Collection items ──────────────────────────────────────── */
  addItem: (item: ComposerItem) => void;
  updateItem: (id: string, updates: Partial<ComposerItem>) => void;
  deleteItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  moveItemToFolder: (itemId: string, folderId: string | null) => void;

  /* ── Folders ───────────────────────────────────────────────── */
  addFolder: (folder: ComposerFolder) => void;
  updateFolder: (id: string, updates: Partial<ComposerFolder>) => void;
  deleteFolder: (id: string) => void;
  toggleFolderCollapsed: (id: string) => void;

  /* ── Tabs ──────────────────────────────────────────────────── */
  openTab: (itemId: string) => void;
  closeTab: (itemId: string) => void;
  setActiveTab: (itemId: string | null) => void;
  markTabDirty: (itemId: string, dirty: boolean) => void;
  reorderTabs: (tabs: ComposerTab[]) => void;

  /* ── Environments ──────────────────────────────────────────── */
  addEnvironment: (env: ComposerEnvironment) => void;
  updateEnvironment: (id: string, updates: Partial<ComposerEnvironment>) => void;
  deleteEnvironment: (id: string) => void;
  setActiveEnvironment: (id: string | null) => void;
  setGlobalVariables: (vars: ComposerState["globalVariables"]) => void;

  /* ── Drafts (ephemeral) ────────────────────────────────────── */
  setSipDraft: (draft: Partial<SipRequestDraft>) => void;
  setHttpDraft: (draft: Partial<HttpRequestDraft>) => void;
  setSipResponses: (responses: SipResponsePart[]) => void;
  setHttpResponse: (r: unknown | null) => void;
  resetSipDraft: () => void;
  resetHttpDraft: () => void;

  /* ── WebSocket (ephemeral) ─────────────────────────────────── */
  addWsMessage: (msg: WebSocketMessage) => void;
  clearWsMessages: () => void;
  setWsConnected: (connected: boolean) => void;

  /* ── History ───────────────────────────────────────────────── */
  addHistoryEntry: (entry: ComposerHistoryEntry) => void;
  clearHistory: () => void;
  clearHistorySelected: (ids: string[]) => void;

  /* ── SSH Port Profiles ─────────────────────────────────────── */
  addPortProfile: (profile: PortProfile) => void;
  updatePortProfile: (id: string, updates: Partial<PortProfile>) => void;
  deletePortProfile: (id: string) => void;

  /* ── UI ────────────────────────────────────────────────────── */
  setUiPrefs: (prefs: Partial<ComposerUiPrefs>) => void;
  setSidebarSearch: (search: string) => void;

  /* ── Convenience: create + open item ───────────────────────── */
  createAndOpenItem: (protocol: ComposerProtocol, name?: string, folderId?: string | null) => string;

  /* ── Guided: create from template / scenario ────────────────── */
  createItemFromTemplate: (
    protocol: ComposerProtocol,
    name: string,
    protocolData: Partial<Pick<ComposerItem, "sipData" | "httpData" | "sshData" | "wsData" | "graphqlData">>
  ) => string;
  createItemFromScenario: (protocol: ComposerProtocol, scenarioId: string) => string;

  /* ── SSH-specific helpers ──────────────────────────────────── */
  touchSshConnection: (itemId: string) => void;
}

// ── Store implementation ────────────────────────────────────────────────────

export const useComposerStore = create<ComposerState>((set, get) => ({
  // ── Initial state ─────────────────────────────────────────────────────────
  collections: { folders: [], items: [] },
  environments: [],
  activeEnvironmentId: null,
  globalVariables: [],
  openTabs: [],
  activeTabId: null,
  sipDraft: defaultSipDraft(),
  httpDraft: defaultHttpDraft(),
  sipResponses: [],
  httpResponse: null,
  wsMessages: [],
  wsConnected: false,
  history: [],
  portProfiles: [],
  uiPrefs: { ...DEFAULT_UI_PREFS },
  sidebarSearch: "",

  // ═══ Collection items ═════════════════════════════════════════════════════

  addItem: (item) =>
    set((s) => ({
      collections: {
        ...s.collections,
        items: [...s.collections.items, item],
      },
    })),

  updateItem: (id, updates) =>
    set((s) => ({
      collections: {
        ...s.collections,
        items: s.collections.items.map((i) =>
          i.id === id ? { ...i, ...updates, updatedAt: Date.now() } : i
        ),
      },
    })),

  deleteItem: (id) =>
    set((s) => {
      const openTabs = s.openTabs.filter((t) => t.itemId !== id);
      const activeTabId =
        s.activeTabId === id
          ? openTabs[openTabs.length - 1]?.itemId ?? null
          : s.activeTabId;
      return {
        collections: {
          ...s.collections,
          items: s.collections.items.filter((i) => i.id !== id),
        },
        openTabs,
        activeTabId,
      };
    }),

  duplicateItem: (id) => {
    const src = get().collections.items.find((i) => i.id === id);
    if (!src) return;
    const dup: ComposerItem = {
      ...src,
      id: newItemId(),
      name: `${src.name} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sshData: src.sshData
        ? { ...src.sshData, lastConnected: null }
        : undefined,
    };
    set((s) => ({
      collections: {
        ...s.collections,
        items: [...s.collections.items, dup],
      },
    }));
  },

  moveItemToFolder: (itemId, folderId) =>
    set((s) => ({
      collections: {
        ...s.collections,
        items: s.collections.items.map((i) =>
          i.id === itemId ? { ...i, folderId } : i
        ),
      },
    })),

  // ═══ Folders ══════════════════════════════════════════════════════════════

  addFolder: (folder) =>
    set((s) => ({
      collections: {
        ...s.collections,
        folders: [...s.collections.folders, folder].sort(
          (a, b) => a.order - b.order
        ),
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
      const items = s.collections.items.map((i) =>
        i.folderId === id ? { ...i, folderId: null } : i
      );
      return { collections: { ...s.collections, folders, items } };
    }),

  toggleFolderCollapsed: (id) =>
    set((s) => ({
      collections: {
        ...s.collections,
        folders: s.collections.folders.map((f) =>
          f.id === id ? { ...f, collapsed: !f.collapsed } : f
        ),
      },
    })),

  // ═══ Tabs ═════════════════════════════════════════════════════════════════

  openTab: (itemId) =>
    set((s) => {
      const exists = s.openTabs.some((t) => t.itemId === itemId);
      if (exists) {
        return { activeTabId: itemId };
      }
      return {
        openTabs: [...s.openTabs, { itemId, dirty: false }],
        activeTabId: itemId,
      };
    }),

  closeTab: (itemId) =>
    set((s) => {
      const idx = s.openTabs.findIndex((t) => t.itemId === itemId);
      const next = s.openTabs.filter((t) => t.itemId !== itemId);
      let activeTabId = s.activeTabId;
      if (s.activeTabId === itemId) {
        const newIdx = Math.min(idx, next.length - 1);
        activeTabId = next[newIdx]?.itemId ?? null;
      }
      return { openTabs: next, activeTabId };
    }),

  setActiveTab: (itemId) => set({ activeTabId: itemId }),

  markTabDirty: (itemId, dirty) =>
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.itemId === itemId ? { ...t, dirty } : t
      ),
    })),

  reorderTabs: (tabs) => set({ openTabs: tabs }),

  // ═══ Environments ═════════════════════════════════════════════════════════

  addEnvironment: (env) =>
    set((s) => ({ environments: [...s.environments, env] })),

  updateEnvironment: (id, updates) =>
    set((s) => ({
      environments: s.environments.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    })),

  deleteEnvironment: (id) =>
    set((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
      activeEnvironmentId:
        s.activeEnvironmentId === id ? null : s.activeEnvironmentId,
    })),

  setActiveEnvironment: (id) => set({ activeEnvironmentId: id }),

  setGlobalVariables: (vars) => set({ globalVariables: vars }),

  // ═══ Drafts ═══════════════════════════════════════════════════════════════

  setSipDraft: (draft) =>
    set((s) => ({ sipDraft: { ...s.sipDraft, ...draft } })),

  setHttpDraft: (draft) =>
    set((s) => ({ httpDraft: { ...s.httpDraft, ...draft } })),

  setSipResponses: (responses) => set({ sipResponses: responses }),
  setHttpResponse: (r) => set({ httpResponse: r }),

  resetSipDraft: () => set({ sipDraft: defaultSipDraft(), sipResponses: [] }),
  resetHttpDraft: () => set({ httpDraft: defaultHttpDraft(), httpResponse: null }),

  // ═══ WebSocket ════════════════════════════════════════════════════════════

  addWsMessage: (msg) =>
    set((s) => ({ wsMessages: [...s.wsMessages, msg] })),

  clearWsMessages: () => set({ wsMessages: [] }),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  // ═══ History ══════════════════════════════════════════════════════════════

  addHistoryEntry: (entry) =>
    set((s) => ({
      history: [entry, ...s.history].slice(0, HISTORY_MAX),
    })),

  clearHistory: () => set({ history: [] }),

  clearHistorySelected: (ids) =>
    set((s) => ({
      history: s.history.filter((h) => !ids.includes(h.id)),
    })),

  // ═══ SSH Port Profiles ════════════════════════════════════════════════════

  addPortProfile: (profile) =>
    set((s) => ({ portProfiles: [...s.portProfiles, profile] })),

  updatePortProfile: (id, updates) =>
    set((s) => ({
      portProfiles: s.portProfiles.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  deletePortProfile: (id) =>
    set((s) => ({
      portProfiles: s.portProfiles.filter((p) => p.id !== id),
    })),

  // ═══ UI ═══════════════════════════════════════════════════════════════════

  setUiPrefs: (prefs) =>
    set((s) => ({ uiPrefs: { ...s.uiPrefs, ...prefs } })),

  setSidebarSearch: (search) => set({ sidebarSearch: search }),

  // ═══ Convenience: create + open ═══════════════════════════════════════════

  createAndOpenItem: (protocol, name, folderId = null) => {
    const id = newItemId();
    const now = Date.now();
    const item: ComposerItem = {
      id,
      protocol,
      name: name || defaultItemName(protocol),
      folderId: folderId ?? null,
      notes: "",
      color: "",
      createdAt: now,
      updatedAt: now,
    };

    switch (protocol) {
      case "ssh":
        item.sshData = {
          host: "",
          port: 22,
          username: "",
          authMethod: "agent",
          keyFilePath: "",
          portForwards: [],
          advancedOptions: { ...DEFAULT_SSH_ADVANCED },
          lastConnected: null,
        };
        break;
      case "http":
        item.httpData = defaultHttpDraft();
        break;
      case "sip":
        item.sipData = defaultSipDraft();
        break;
      case "websocket":
        item.wsData = {
          url: "wss://example.com/ws",
          protocols: [],
          headers: [],
          autoReconnect: false,
        };
        break;
      case "graphql":
        item.graphqlData = {
          url: "https://example.com/graphql",
          query: "{\n  \n}",
          variables: "{}",
          headers: [],
          auth: { type: "none" },
        };
        break;
    }

    set((s) => ({
      collections: {
        ...s.collections,
        items: [...s.collections.items, item],
      },
      openTabs: [...s.openTabs, { itemId: id, dirty: false }],
      activeTabId: id,
    }));

    return id;
  },

  // ═══ Guided: create from template / scenario ════════════════════════════

  createItemFromTemplate: (protocol, name, protocolData) => {
    const id = newItemId();
    const now = Date.now();
    const item: ComposerItem = {
      id,
      protocol,
      name,
      folderId: null,
      notes: "",
      color: "",
      createdAt: now,
      updatedAt: now,
      ...protocolData,
    };

    set((s) => ({
      collections: {
        ...s.collections,
        items: [...s.collections.items, item],
      },
      openTabs: [...s.openTabs, { itemId: id, dirty: false }],
      activeTabId: id,
    }));

    return id;
  },

  createItemFromScenario: (protocol, scenarioId) => {
    const data = getScenarioData(protocol, scenarioId);
    const { createItemFromTemplate } = get();
    return createItemFromTemplate(protocol, data.name, data.protocolData);
  },

  // ═══ SSH helpers ══════════════════════════════════════════════════════════

  touchSshConnection: (itemId) =>
    set((s) => ({
      collections: {
        ...s.collections,
        items: s.collections.items.map((i) =>
          i.id === itemId && i.sshData
            ? {
                ...i,
                sshData: { ...i.sshData, lastConnected: Date.now() },
                updatedAt: Date.now(),
              }
            : i
        ),
      },
    })),
}));

// ── Helper ──────────────────────────────────────────────────────────────────

function defaultItemName(protocol: ComposerProtocol): string {
  switch (protocol) {
    case "ssh":
      return "New SSH Connection";
    case "http":
      return "New HTTP Request";
    case "sip":
      return "New SIP Request";
    case "websocket":
      return "New WebSocket";
    case "graphql":
      return "New GraphQL Query";
  }
}

// ── Scenario data (pre-filled templates for guided wizards) ─────────────────

interface ScenarioResult {
  name: string;
  protocolData: Partial<Pick<ComposerItem, "sipData" | "httpData" | "sshData" | "wsData" | "graphqlData">>;
}

function getScenarioData(protocol: ComposerProtocol, scenarioId: string): ScenarioResult {
  if (protocol === "sip") {
    return getSipScenario(scenarioId);
  }
  if (protocol === "http") {
    return getHttpScenario(scenarioId);
  }
  return { name: defaultItemName(protocol), protocolData: {} };
}

function getSipScenario(scenarioId: string): ScenarioResult {
  const base = (): import("@/types/crafter").SipRequestDraft => ({
    method: "OPTIONS",
    uri: "sip:192.168.1.1:5060",
    transport: "UDP",
    headers: [],
    body: "",
    bodyContentType: "application/sdp",
    auth: null,
  });

  switch (scenarioId) {
    case "test-reachability": {
      const d = base();
      d.method = "OPTIONS";
      return { name: "Test Endpoint Reachability", protocolData: { sipData: d } };
    }
    case "query-capabilities": {
      const d = base();
      d.method = "OPTIONS";
      d.headers = [{ key: "Accept", value: "application/sdp" }];
      return { name: "Query Capabilities", protocolData: { sipData: d } };
    }
    case "register": {
      const d = base();
      d.method = "REGISTER";
      d.headers = [
        { key: "Expires", value: "3600" },
        { key: "Contact", value: "<sip:user@localhost:5062;transport=udp>" },
      ];
      d.auth = { username: "", password: "", realm: "" };
      return { name: "Register with PBX", protocolData: { sipData: d } };
    }
    case "audio-call": {
      const d = base();
      d.method = "INVITE";
      d.body = [
        "v=0",
        "o=sipalyzer 0 0 IN IP4 0.0.0.0",
        "s=SIPalyzer Call",
        "c=IN IP4 0.0.0.0",
        "t=0 0",
        "m=audio 49170 RTP/AVP 0 8",
        "a=rtpmap:0 PCMU/8000",
        "a=rtpmap:8 PCMA/8000",
        "a=sendrecv",
      ].join("\r\n");
      d.bodyContentType = "application/sdp";
      d.headers = [{ key: "Content-Type", value: "application/sdp" }];
      return { name: "Start Audio Call", protocolData: { sipData: d } };
    }
    case "video-call": {
      const d = base();
      d.method = "INVITE";
      d.body = [
        "v=0",
        "o=sipalyzer 0 0 IN IP4 0.0.0.0",
        "s=SIPalyzer Call",
        "c=IN IP4 0.0.0.0",
        "t=0 0",
        "m=audio 49170 RTP/AVP 0 8",
        "a=rtpmap:0 PCMU/8000",
        "a=rtpmap:8 PCMA/8000",
        "a=sendrecv",
        "m=video 49172 RTP/AVP 96",
        "a=rtpmap:96 H264/90000",
        "a=sendrecv",
      ].join("\r\n");
      d.bodyContentType = "application/sdp";
      d.headers = [{ key: "Content-Type", value: "application/sdp" }];
      return { name: "Start Video Call", protocolData: { sipData: d } };
    }
    case "end-call": {
      const d = base();
      d.method = "BYE";
      return { name: "End Call (BYE)", protocolData: { sipData: d } };
    }
    case "instant-message": {
      const d = base();
      d.method = "MESSAGE";
      d.body = "Hello from SIPalyzer!";
      d.bodyContentType = "text/plain";
      d.headers = [{ key: "Content-Type", value: "text/plain" }];
      return { name: "Send Instant Message", protocolData: { sipData: d } };
    }
    case "subscribe-presence": {
      const d = base();
      d.method = "SUBSCRIBE";
      d.headers = [
        { key: "Event", value: "presence" },
        { key: "Expires", value: "3600" },
      ];
      return { name: "Subscribe to Presence", protocolData: { sipData: d } };
    }
    case "subscribe-mwi": {
      const d = base();
      d.method = "SUBSCRIBE";
      d.headers = [
        { key: "Event", value: "message-summary" },
        { key: "Expires", value: "3600" },
      ];
      return { name: "Subscribe to Voicemail (MWI)", protocolData: { sipData: d } };
    }
    case "send-notify": {
      const d = base();
      d.method = "NOTIFY";
      d.headers = [{ key: "Event", value: "presence" }];
      return { name: "Send NOTIFY", protocolData: { sipData: d } };
    }
    case "send-dtmf": {
      const d = base();
      d.method = "INFO";
      d.body = "Signal=5\r\nDuration=160";
      d.bodyContentType = "application/dtmf-relay";
      d.headers = [{ key: "Content-Type", value: "application/dtmf-relay" }];
      return { name: "Send DTMF Digits", protocolData: { sipData: d } };
    }
    case "transfer-call": {
      const d = base();
      d.method = "REFER";
      d.headers = [{ key: "Refer-To", value: "sip:target@example.com" }];
      return { name: "Transfer a Call", protocolData: { sipData: d } };
    }
    case "scratch":
    default: {
      const d = base();
      d.method = "OPTIONS";
      d.uri = "";
      return { name: "New SIP Request", protocolData: { sipData: d } };
    }
  }
}

function getHttpScenario(scenarioId: string): ScenarioResult {
  const base = (): import("@/types/crafter").HttpRequestDraft => ({
    method: "GET",
    url: "",
    params: [],
    headers: [],
    bodyType: "none",
    bodyJson: "{}",
    bodyForm: [],
    bodyRaw: "",
    bodyRawContentType: "application/json",
    auth: { type: "none" },
  });

  switch (scenarioId) {
    case "fetch-data": {
      const d = base();
      d.method = "GET";
      d.headers = [{ key: "Accept", value: "application/json" }];
      return { name: "Fetch Data (GET)", protocolData: { httpData: d } };
    }
    case "create-resource": {
      const d = base();
      d.method = "POST";
      d.bodyType = "json";
      d.bodyJson = '{\n  "name": "",\n  "value": ""\n}';
      d.headers = [{ key: "Content-Type", value: "application/json" }];
      return { name: "Create Resource (POST)", protocolData: { httpData: d } };
    }
    case "update-resource": {
      const d = base();
      d.method = "PUT";
      d.bodyType = "json";
      d.bodyJson = '{\n  "name": "",\n  "value": ""\n}';
      d.headers = [{ key: "Content-Type", value: "application/json" }];
      return { name: "Update Resource (PUT)", protocolData: { httpData: d } };
    }
    case "delete-resource": {
      const d = base();
      d.method = "DELETE";
      return { name: "Delete Resource", protocolData: { httpData: d } };
    }
    case "authenticated": {
      const d = base();
      d.method = "GET";
      d.auth = { type: "bearer", bearerToken: "" };
      d.headers = [{ key: "Accept", value: "application/json" }];
      return { name: "Authenticated Request", protocolData: { httpData: d } };
    }
    case "health-check": {
      const d = base();
      d.method = "GET";
      d.url = "/health";
      return { name: "Health Check", protocolData: { httpData: d } };
    }
    case "scratch":
    default: {
      const d = base();
      return { name: "New HTTP Request", protocolData: { httpData: d } };
    }
  }
}

// ── Environment variable interpolation ──────────────────────────────────────

/**
 * Resolve `{{variable}}` placeholders in a string using the active
 * environment + global variables. Returns the interpolated string.
 */
export function interpolateVariables(
  template: string,
  state?: Pick<ComposerState, "environments" | "activeEnvironmentId" | "globalVariables">
): string {
  const s = state ?? useComposerStore.getState();
  const vars = new Map<string, string>();

  // Global variables first (lower priority)
  for (const v of s.globalVariables) {
    if (v.enabled && v.key) vars.set(v.key, v.value);
  }

  // Active environment overrides globals
  if (s.activeEnvironmentId) {
    const env = s.environments.find((e) => e.id === s.activeEnvironmentId);
    if (env) {
      for (const v of env.variables) {
        if (v.enabled && v.key) vars.set(v.key, v.value);
      }
    }
  }

  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
    return vars.get(key) ?? `{{${key}}}`;
  });
}
