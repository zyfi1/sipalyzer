/**
 * Unified Network Composer types.
 *
 * Covers SSH connections, HTTP/SIP requests, WebSocket connections,
 * GraphQL queries, environments, collections, and history.
 */

// ── Re-export existing crafter types we still need ──────────────────────────
export type {
  SipTransport,
  SipMethod,
  SipDigestAuth,
  SipRequestDraft,
  SipResponsePart,
  HttpMethod,
  HttpBodyType,
  HttpAuthType,
  HttpAuth,
  HttpRequestDraft,
} from "./crafter";

export { SIP_METHODS } from "./crafter";

// ── Item protocol discriminator ─────────────────────────────────────────────

export type ComposerProtocol = "ssh" | "http" | "sip" | "websocket" | "graphql";

// ── SSH types (absorbed from sshStore) ──────────────────────────────────────

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

export const DEFAULT_SSH_ADVANCED: SshAdvancedOptions = {
  compression: false,
  keepAliveInterval: 60,
  keepAliveCountMax: 3,
  strictHostKeyChecking: "ask",
  jumpHost: "",
  customFlags: "",
  connectionTimeout: 30,
};

export interface SshConnectionData {
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | "agent";
  keyFilePath: string;
  portForwards: PortForwardRule[];
  advancedOptions: SshAdvancedOptions;
  /** Timestamp (ms) of the last time this connection was executed */
  lastConnected: number | null;
}

// ── WebSocket types ─────────────────────────────────────────────────────────

export interface WebSocketData {
  url: string;
  protocols: string[];
  headers: Array<{ key: string; value: string }>;
  autoReconnect: boolean;
}

export interface WebSocketMessage {
  id: string;
  direction: "sent" | "received";
  data: string;
  timestamp: number;
  /** Binary or text */
  type: "text" | "binary";
}

// ── GraphQL types ───────────────────────────────────────────────────────────

export interface GraphqlData {
  url: string;
  query: string;
  variables: string;
  headers: Array<{ key: string; value: string }>;
  auth: import("./crafter").HttpAuth;
}

// ── Unified collection item ─────────────────────────────────────────────────

export interface ComposerItem {
  id: string;
  protocol: ComposerProtocol;
  name: string;
  /** Folder ID, or null for root-level items */
  folderId: string | null;
  /** Optional user notes */
  notes: string;
  /** Optional color tag */
  color: string;
  createdAt: number;
  updatedAt: number;

  /** Protocol-specific data — exactly one will be set based on `protocol` */
  sshData?: SshConnectionData;
  httpData?: import("./crafter").HttpRequestDraft;
  sipData?: import("./crafter").SipRequestDraft;
  wsData?: WebSocketData;
  graphqlData?: GraphqlData;
}

// ── Folders ─────────────────────────────────────────────────────────────────

export interface ComposerFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  /** Collapsed in sidebar tree */
  collapsed: boolean;
  createdAt: number;
}

// ── Collections container ───────────────────────────────────────────────────

export interface ComposerCollection {
  folders: ComposerFolder[];
  items: ComposerItem[];
}

// ── SSH Port Profiles (reusable templates) ──────────────────────────────────

export interface PortProfile {
  id: string;
  name: string;
  description: string;
  rules: PortForwardRule[];
  createdAt: number;
}

// ── Environments ────────────────────────────────────────────────────────────

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ComposerEnvironment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
  createdAt: number;
}

// ── Open tabs ───────────────────────────────────────────────────────────────

export interface ComposerTab {
  /** The item ID this tab corresponds to */
  itemId: string;
  /** Whether the tab has unsaved modifications */
  dirty: boolean;
}

// ── Unified history ─────────────────────────────────────────────────────────

export interface ComposerHistoryEntry {
  id: string;
  protocol: ComposerProtocol;
  /** Display name for the action (e.g. "GET", "REGISTER", "SSH connect") */
  method: string;
  /** Target URL, URI, or host */
  target: string;
  /** Status code (HTTP/SIP) or null for SSH/WS */
  statusCode?: number;
  /** Round-trip time in ms */
  roundTripMs?: number;
  timestamp: number;
  /** Optional truncated request/response preview */
  requestPreview?: string;
  responsePreview?: string;
  /** Link back to collection item, if applicable */
  itemId?: string;
}

// ── UI preferences ──────────────────────────────────────────────────────────

export interface ComposerUiPrefs {
  /** Sidebar width in pixels */
  sidebarWidth: number;
  /** Response/request split percent */
  splitPercent: number;
  /** Last used SIP method */
  lastSipMethod: string;
  /** Last used HTTP method */
  lastHttpMethod: string;
  /** Response timeout in seconds */
  responseTimeoutSec: number;
  /** Whether the quick-start wizard has been dismissed */
  wizardDismissed: boolean;
}

export const DEFAULT_UI_PREFS: ComposerUiPrefs = {
  sidebarWidth: 260,
  splitPercent: 50,
  lastSipMethod: "OPTIONS",
  lastHttpMethod: "GET",
  responseTimeoutSec: 10,
  wizardDismissed: false,
};

