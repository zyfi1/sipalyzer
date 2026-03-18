/**
 * Provision Viewer — types for Yealink .cfg fetch and parse.
 */

export interface KeyValue {
  key: string;
  value: string;
}

export interface ParsedCfg {
  groups: Record<string, KeyValue[]>;
  entries: KeyValue[];
}

export interface ProvisionRequestInfo {
  final_url: string;
  user_agent: string;
  mac_used: string;
  status: number;
  redirects?: string[];
  retry_log?: string[];
}

export interface FetchProvisionResult {
  raw: string;
  parsed: ParsedCfg | null;
  request_info: ProvisionRequestInfo;
  parseable: boolean;
}
