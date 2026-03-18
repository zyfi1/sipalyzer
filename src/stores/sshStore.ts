import { create } from "zustand";

/* ── Data types ──────────────────────────────────────────────────── */

export interface PortForwardRule {
  id: string;
  type: "local" | "remote" | "dynamic";
  localPort: number;
  remoteHost: string;
  remotePort: number;
  description: string;
}

export interface SshAdvancedOptions {
  compression: boolean;
  keepAliveInterval: number;
  keepAliveCountMax: number;
  strictHostKeyChecking: "yes" | "no" | "ask";
  jumpHost: string;
  customFlags: string;
  connectionTimeout: number;
}

export const DEFAULT_ADVANCED_OPTIONS: SshAdvancedOptions = {
  compression: false,
  keepAliveInterval: 60,
  keepAliveCountMax: 3,
  strictHostKeyChecking: "ask",
  jumpHost: "",
  customFlags: "",
  connectionTimeout: 30,
};

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | "agent";
  keyFilePath: string;
  portForwards: PortForwardRule[];
  advancedOptions: SshAdvancedOptions;
  lastConnected: number | null;
  createdAt: number;
}

export interface SshHistoryEntry {
  id: string;
  connectionId: string | null;
  connectionName: string;
  host: string;
  username: string;
  command: string;
  timestamp: number;
}

export interface PortProfile {
  id: string;
  name: string;
  description: string;
  rules: PortForwardRule[];
  createdAt: number;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

let _nextRuleId = 1;
export function nextRuleId(): string {
  return `rule-${Date.now()}-${_nextRuleId++}`;
}
export function newConnectionId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Store ───────────────────────────────────────────────────────── */

interface SshState {
  connections: SshConnection[];
  history: SshHistoryEntry[];
  portProfiles: PortProfile[];
  wizardOpen: boolean;
  /** When editing an existing connection in the wizard, hold its id. */
  editingConnectionId: string | null;

  setWizardOpen: (open: boolean, editId?: string | null) => void;

  /* Connections */
  addConnection: (conn: SshConnection) => void;
  updateConnection: (id: string, updates: Partial<SshConnection>) => void;
  deleteConnection: (id: string) => void;
  duplicateConnection: (id: string) => void;
  touchConnection: (id: string) => void;

  /* History */
  addHistoryEntry: (entry: SshHistoryEntry) => void;
  clearHistory: () => void;

  /* Port profiles */
  addPortProfile: (profile: PortProfile) => void;
  updatePortProfile: (id: string, updates: Partial<PortProfile>) => void;
  deletePortProfile: (id: string) => void;
}

export const useSshStore = create<SshState>((set, get) => ({
  connections: [],
  history: [],
  portProfiles: [],
  wizardOpen: false,
  editingConnectionId: null,

  setWizardOpen: (open, editId) =>
    set({ wizardOpen: open, editingConnectionId: editId ?? null }),

  /* ── Connections ─────────────────────────────────────────────── */
  addConnection: (conn) => {
    set({ connections: [...get().connections, conn] });
  },
  updateConnection: (id, updates) => {
    set({ connections: get().connections.map((c) => c.id === id ? { ...c, ...updates } : c) });
  },
  deleteConnection: (id) => {
    set({ connections: get().connections.filter((c) => c.id !== id) });
  },
  duplicateConnection: (id) => {
    const src = get().connections.find((c) => c.id === id);
    if (!src) return;
    const dup: SshConnection = {
      ...src,
      id: newConnectionId(),
      name: `${src.name} (copy)`,
      createdAt: Date.now(),
      lastConnected: null,
    };
    set({ connections: [...get().connections, dup] });
  },
  touchConnection: (id) => {
    set({ connections: get().connections.map((c) => c.id === id ? { ...c, lastConnected: Date.now() } : c) });
  },

  /* ── History ─────────────────────────────────────────────────── */
  addHistoryEntry: (entry) => {
    set({ history: [entry, ...get().history].slice(0, 200) });
  },
  clearHistory: () => {
    set({ history: [] });
  },

  /* ── Port profiles ──────────────────────────────────────────── */
  addPortProfile: (profile) => {
    set({ portProfiles: [...get().portProfiles, profile] });
  },
  updatePortProfile: (id, updates) => {
    set({ portProfiles: get().portProfiles.map((p) => p.id === id ? { ...p, ...updates } : p) });
  },
  deletePortProfile: (id) => {
    set({ portProfiles: get().portProfiles.filter((p) => p.id !== id) });
  },
}));
