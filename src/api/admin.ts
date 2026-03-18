import { invokeTauri } from "./invoke";

// ── Password ──

export function hasAdminPassword(): Promise<boolean> {
  return invokeTauri<boolean>("admin_has_password");
}

export function setAdminPassword(password: string): Promise<void> {
  return invokeTauri<void>("admin_set_password", { password });
}

export function verifyAdminPassword(password: string): Promise<boolean> {
  return invokeTauri<boolean>("admin_verify_password", { password });
}

// ── Audit log ──

export interface AuditEntry {
  id: number;
  seq: number;
  timestamp: string;
  category: string;
  action: string;
  actor: string;
  target: string | null;
  detail: string | null;
  checksum: string;
}

export interface AuditQueryFilters {
  category?: string | null;
  action?: string | null;
  actor?: string | null;
  search?: string | null;
  from_date?: string | null;
  to_date?: string | null;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditStats {
  total_entries: number;
  earliest: string | null;
  latest: string | null;
  chain_valid: boolean;
}

export function auditQuery(
  filters: AuditQueryFilters,
  page: number,
  pageSize: number,
): Promise<AuditQueryResult> {
  return invokeTauri<AuditQueryResult>("admin_audit_query", {
    filters,
    page,
    pageSize,
  });
}

export function auditVerifyChain(): Promise<[boolean, number | null]> {
  return invokeTauri<[boolean, number | null]>("admin_audit_verify_chain");
}

export function auditStats(): Promise<AuditStats> {
  return invokeTauri<AuditStats>("admin_audit_stats");
}

export function auditClear(password: string): Promise<void> {
  return invokeTauri<void>("admin_audit_clear", { password });
}

export function auditCategories(): Promise<string[]> {
  return invokeTauri<string[]>("admin_audit_categories");
}

export function auditActions(): Promise<string[]> {
  return invokeTauri<string[]>("admin_audit_actions");
}

// ── Process registry ──

export interface ManagedProcess {
  id: string;
  kind: string;
  label: string;
  started_at: string;
  status: string;
  metadata: Record<string, unknown>;
}

export function listProcesses(): Promise<ManagedProcess[]> {
  return invokeTauri<ManagedProcess[]>("admin_list_processes");
}

export function killProcess(id: string): Promise<boolean> {
  return invokeTauri<boolean>("admin_kill_process", { id });
}

export function clearProcess(id: string): Promise<boolean> {
  return invokeTauri<boolean>("admin_clear_process", { id });
}

export function clearFinishedProcesses(): Promise<number> {
  return invokeTauri<number>("admin_clear_finished_processes");
}

export function killAllProcesses(): Promise<number> {
  return invokeTauri<number>("admin_kill_all_processes");
}

export function clearAllProcesses(): Promise<number> {
  return invokeTauri<number>("admin_clear_all_processes");
}

export function clearEvents(): Promise<void> {
  return invokeTauri<void>("admin_clear_events");
}

// ── System health ──

export interface SystemHealth {
  uptime_seconds: number;
  memory_used_mb: number;
  memory_total_mb: number;
  cpu_usage_percent: number;
  db_size_bytes: number;
  active_processes: number;
  process_counts: Record<string, number>;
}

export function getSystemHealth(): Promise<SystemHealth> {
  return invokeTauri<SystemHealth>("admin_get_system_health");
}

// ── Database inspector ──

export interface TableInfo {
  name: string;
  row_count: number;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

export interface DbInfo {
  file_size_bytes: number;
  page_count: number;
  page_size: number;
  wal_mode: string;
  table_count: number;
}

export function listTables(): Promise<TableInfo[]> {
  return invokeTauri<TableInfo[]>("admin_list_tables");
}

export function runQuery(sql: string): Promise<QueryResult> {
  return invokeTauri<QueryResult>("admin_run_query", { sql });
}

export function vacuumDb(): Promise<void> {
  return invokeTauri<void>("admin_vacuum_db");
}

export function getDbInfo(): Promise<DbInfo> {
  return invokeTauri<DbInfo>("admin_get_db_info");
}

// ── Feature flags ──

export interface FeatureFlag {
  key: string;
  enabled: boolean;
}

export function listFeatureFlags(): Promise<FeatureFlag[]> {
  return invokeTauri<FeatureFlag[]>("admin_list_feature_flags");
}

export function setFeatureFlag(key: string, enabled: boolean): Promise<void> {
  return invokeTauri<void>("admin_set_feature_flag", { key, enabled });
}

export function getFeatureFlag(key: string): Promise<boolean> {
  return invokeTauri<boolean>("admin_get_feature_flag", { key });
}
