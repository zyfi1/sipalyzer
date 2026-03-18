import { invokeTauri } from "./invoke";
import { listen, type UnlistenFn } from "@/lib/tauriEvents";
import { validateIpcPayload } from "@/lib/ipcValidation";

// ── Directory Listing ──────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
  mode: string;
}

export interface ListDirResult {
  path: string;
  entries: DirEntry[];
  error?: string;
}

export function toolsListDir(path: string, showHidden: boolean): Promise<ListDirResult> {
  const payload = { path, showHidden };
  validateIpcPayload("tools_list_dir", payload);
  return invokeTauri<ListDirResult>("tools_list_dir", payload);
}

// ── Log Fetch ──────────────────────────────────────────────────────────

export interface FetchLogResult {
  lines: string[];
  total_lines: number;
  matched_lines: number;
  file_size_bytes: number;
}

export function toolsFetchLog(
  path: string,
  tailLines?: number,
  filter?: string | null,
): Promise<FetchLogResult> {
  const payload = {
    path,
    tailLines: tailLines ?? 500,
    filter: filter || null,
  };
  validateIpcPayload("tools_fetch_log", payload);
  return invokeTauri<FetchLogResult>("tools_fetch_log", payload);
}

// ── Syslog Listener (local) ───────────────────────────────────────────

export interface SyslogEntry {
  timestamp: string;
  hostname: string;
  facility: string;
  severity: string;
  app_name: string;
  process_id: string;
  message: string;
}

interface SyslogBatchPayload {
  session_id: string;
  entries: SyslogEntry[];
}

export function toolsSyslogStart(port: number): Promise<string> {
  return invokeTauri<string>("tools_syslog_start", { port });
}

export function toolsSyslogStop(sessionId: string): Promise<void> {
  return invokeTauri<void>("tools_syslog_stop", { sessionId });
}

export function onSyslogBatch(
  sessionId: string,
  handler: (entries: SyslogEntry[]) => void,
): Promise<UnlistenFn> {
  return listen<SyslogBatchPayload>("tools:syslog-batch", (event) => {
    if (event.payload.session_id === sessionId) {
      handler(event.payload.entries);
    }
  });
}

// ── Log Tail (local) ──────────────────────────────────────────────────

interface TailLinesPayload {
  session_id: string;
  lines: string[];
}

export function toolsTailStart(path: string, filter?: string | null): Promise<string> {
  return invokeTauri<string>("tools_tail_start", {
    path,
    filter: filter || null,
  });
}

export function toolsTailStop(sessionId: string): Promise<void> {
  return invokeTauri<void>("tools_tail_stop", { sessionId });
}

export function onTailLines(
  sessionId: string,
  handler: (lines: string[]) => void,
): Promise<UnlistenFn> {
  return listen<TailLinesPayload>("tools:tail-lines", (event) => {
    if (event.payload.session_id === sessionId) {
      handler(event.payload.lines);
    }
  });
}

// ── HTTP File Server (local) ──────────────────────────────────────────

export interface FileServeStartResult {
  session_id: string;
  http_url: string;
}

export interface FileServeRequest {
  session_id: string;
  client_ip: string;
  method: string;
  path: string;
  status: number;
  size: number;
  duration_ms: number;
  timestamp: string;
}

export function toolsServeStart(
  path: string,
  httpPort: number,
  showHidden?: boolean,
): Promise<FileServeStartResult> {
  return invokeTauri<FileServeStartResult>("tools_serve_start", {
    path,
    httpPort,
    showHidden: showHidden ?? false,
  });
}

export function toolsServeStop(sessionId: string): Promise<void> {
  return invokeTauri<void>("tools_serve_stop", { sessionId });
}

export function onFileServeRequest(
  sessionId: string,
  handler: (request: FileServeRequest) => void,
): Promise<UnlistenFn> {
  return listen<FileServeRequest>("tools:file-request", (event) => {
    if (event.payload.session_id === sessionId) {
      handler(event.payload);
    }
  });
}

// ── Virtual File Server (local, in-memory) ───────────────────────────

export interface VirtualFileInput {
  name: string;
  data_base64: string;
}

export function toolsVirtualServeStart(
  httpPort: number,
  files: VirtualFileInput[],
): Promise<FileServeStartResult> {
  return invokeTauri<FileServeStartResult>("tools_virtual_serve_start", {
    httpPort,
    files,
  });
}

export function toolsVirtualAddFiles(
  sessionId: string,
  files: VirtualFileInput[],
): Promise<void> {
  return invokeTauri<void>("tools_virtual_add_files", { sessionId, files });
}

export function toolsVirtualRemoveFile(
  sessionId: string,
  name: string,
): Promise<void> {
  return invokeTauri<void>("tools_virtual_remove_file", { sessionId, name });
}

export function toolsVirtualServeStop(sessionId: string): Promise<void> {
  return invokeTauri<void>("tools_virtual_serve_stop", { sessionId });
}

// ── Firmware Catalog ──────────────────────────────────────────────────

export interface FirmwareEntry {
  id: string;
  vendor: string;
  series: string;
  models: string;
  version: string;
  filename: string;
  url: string;
  fallback_url: string;
  archive_format: string;
  sha256: string;
  size_bytes: number;
  notes: string;
  source: string;
}

export interface FirmwareCacheEntry {
  entry_id: string;
  filename: string;
  files: string[];
  size: number;
  path: string;
}

export interface FirmwareDownloadProgress {
  entry_id: string;
  downloaded_bytes: number;
  total_bytes: number;
  pct: number;
  phase: "downloading" | "extracting";
  files_extracted: number;
}

export function toolsFirmwareCatalog(): Promise<FirmwareEntry[]> {
  return invokeTauri<FirmwareEntry[]>("tools_firmware_catalog", {});
}

export interface FirmwareUpdateCheck {
  series: string;
  vendor: string;
  catalog_latest: string;
  mirror_latest: string;
  has_update: boolean;
}

export interface FirmwareCheckResult {
  checks: FirmwareUpdateCheck[];
  new_entries: FirmwareEntry[];
}

export function toolsFirmwareCheckUpdates(): Promise<FirmwareCheckResult> {
  return invokeTauri<FirmwareCheckResult>("tools_firmware_check_updates", {});
}

export function toolsFirmwareDownload(entryId: string): Promise<string> {
  return invokeTauri<string>("tools_firmware_download", { entryId });
}

export function toolsFirmwareServe(
  entryId: string,
  sessionId?: string,
  serveDir?: string,
): Promise<string> {
  return invokeTauri<string>("tools_firmware_serve", {
    entryId,
    sessionId: sessionId ?? null,
    serveDir: serveDir ?? null,
  });
}

export function toolsFirmwareCacheList(): Promise<FirmwareCacheEntry[]> {
  return invokeTauri<FirmwareCacheEntry[]>("tools_firmware_cache_list", {});
}

export function toolsFirmwareCacheClear(entryId?: string): Promise<void> {
  return invokeTauri<void>("tools_firmware_cache_clear", {
    entryId: entryId ?? null,
  });
}

export function toolsFirmwareGetCacheDir(): Promise<string> {
  return invokeTauri<string>("tools_firmware_get_cache_dir", {});
}

export function toolsFirmwareSetCacheDir(path?: string): Promise<string> {
  return invokeTauri<string>("tools_firmware_set_cache_dir", {
    path: path ?? null,
  });
}

export function toolsFirmwareLoadPrefs(): Promise<void> {
  return invokeTauri<void>("tools_firmware_load_prefs", {});
}

export function onFirmwareProgress(
  handler: (progress: FirmwareDownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<FirmwareDownloadProgress>("tools:firmware-progress", (event) => {
    handler(event.payload);
  });
}
