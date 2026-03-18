/**
 * Request Builder API — SIP and HTTP send commands.
 */

import { invokeTauri } from "./invoke";

export interface SipResponsePart {
  raw: string;
  status_code?: number;
  status_text?: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  timestamp: number;
  round_trip_ms?: number;
}

export interface CrafterSipResponse {
  responses: SipResponsePart[];
  error?: string;
}

export async function crafterSendSip(params: {
  method: string;
  uri: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  transport: string;
  target_host?: string;
  target_port?: number;
  auth?: { username?: string; password?: string; realm?: string };
  timeout_sec: number;
}): Promise<CrafterSipResponse> {
  return invokeTauri<CrafterSipResponse>("crafter_send_sip", { input: params });
}

export interface CrafterHttpResponse {
  status_code: number;
  status_text: string;
  headers: Array<{ key: string; value: string }>;
  body: string;
  timing_ms: number;
  size_bytes: number;
  redirects?: string[];
  error?: string;
}

export async function crafterSendHttp(params: {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  auth?: {
    type: string;
    username?: string;
    password?: string;
    bearer_token?: string;
    custom_header?: string;
    custom_value?: string;
  };
  follow_redirects: boolean;
  timeout_ms: number;
}): Promise<CrafterHttpResponse> {
  return invokeTauri<CrafterHttpResponse>("crafter_send_http", { input: params });
}
