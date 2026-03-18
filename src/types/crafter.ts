/**
 * Request Builder types — SIP Message Crafter & HTTP Request Client.
 */

export type SipTransport = "UDP" | "TCP" | "TLS";

export const SIP_METHODS = [
  "REGISTER",
  "INVITE",
  "ACK",
  "BYE",
  "CANCEL",
  "OPTIONS",
  "INFO",
  "NOTIFY",
  "MESSAGE",
  "SUBSCRIBE",
  "PUBLISH",
  "REFER",
  "UPDATE",
  "PRACK",
] as const;

export type SipMethod = (typeof SIP_METHODS)[number] | string;

export interface SipDigestAuth {
  username: string;
  password: string;
  realm?: string;
}

export interface SipRequestDraft {
  method: SipMethod;
  uri: string;
  transport: SipTransport;
  headers: Array<{ key: string; value: string }>;
  body: string;
  bodyContentType: string;
  auth: SipDigestAuth | null;
}

export interface SipResponsePart {
  raw: string;
  statusCode?: number;
  statusText?: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  timestamp: number;
  roundTripMs?: number;
}

export interface SipCrafterResponse {
  responses: SipResponsePart[];
  error?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | string;

export type HttpBodyType =
  | "none"
  | "json"
  | "form"
  | "x-www-form-urlencoded"
  | "raw"
  | "binary";

export type HttpAuthType = "none" | "basic" | "bearer" | "custom";

export interface HttpAuth {
  type: HttpAuthType;
  username?: string;
  password?: string;
  bearerToken?: string;
  customHeader?: string;
  customValue?: string;
}

export interface HttpRequestDraft {
  method: HttpMethod;
  url: string;
  params: Array<{ key: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
  bodyType: HttpBodyType;
  bodyJson: string;
  bodyForm: Array<{ key: string; value: string }>;
  bodyRaw: string;
  bodyRawContentType: string;
  auth: HttpAuth;
}

export interface HttpCrafterResponse {
  statusCode: number;
  statusText: string;
  headers: Array<{ key: string; value: string }>;
  body: string;
  timingMs: number;
  sizeBytes: number;
  redirects?: string[];
  error?: string;
}

export type CrafterProtocol = "sip" | "http";

export interface CrafterSavedRequest {
  id: string;
  protocol: CrafterProtocol;
  name: string;
  folderId?: string | null;
  /** SIP: method, URI, headers, body, auth, transport */
  /** HTTP: method, URL, params, headers, body, auth */
  sipRequest?: SipRequestDraft;
  httpRequest?: HttpRequestDraft;
  notes?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CrafterFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: number;
}

export interface CrafterCollection {
  folders: CrafterFolder[];
  requests: CrafterSavedRequest[];
}

export interface CrafterHistoryEntry {
  id: string;
  protocol: CrafterProtocol;
  method: string;
  target: string;
  statusCode?: number;
  roundTripMs?: number;
  timestamp: number;
  /** Truncated request/response for display; max ~50KB when persisted */
  requestPreview?: string;
  responsePreview?: string;
}

export interface CrafterUiPrefs {
  lastSipMethod: SipMethod;
  lastHttpMethod: HttpMethod;
  responseTimeoutSec: number;
  /** Whether the quick-start wizard has been dismissed */
  wizardDismissed?: boolean;
  /** Vertical split position between request builder and response panel (percent) */
  splitPercent?: number;
}
