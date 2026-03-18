import { create } from "zustand";
import * as toolsApi from "@/api/tools";
import type { FirmwareEntry, FirmwareCacheEntry, FirmwareDownloadProgress, FirmwareUpdateCheck } from "@/api/tools";
import type { UnlistenFn } from "@/lib/tauriEvents";

export interface DownloadState {
  status: "idle" | "downloading" | "extracting" | "done" | "error";
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  phase: "downloading" | "extracting";
  filesExtracted: number;
  error?: string;
}

export interface ServeState {
  sessionId: string;
  httpUrl: string;
  entryIds: string[];
  remote: boolean;
}

type SendCommandFn = (agentId: string, commandType: string, params?: Record<string, unknown>) => Promise<string>;
type WaitForCommandFn = (msgId: string) => Promise<{ result?: unknown; error?: string }>;

interface FirmwareCatalogState {
  catalog: FirmwareEntry[];
  cache: Map<string, FirmwareCacheEntry>;
  downloads: Map<string, DownloadState>;
  serve: ServeState | null;
  remotePaths: Map<string, string>;
  updateChecks: FirmwareUpdateCheck[] | null;
  checkingUpdates: boolean;
  filter: { vendor: string; series: string; search: string };
  loaded: boolean;
  cacheDir: string | null;
  _progressUnlisten: UnlistenFn | null;

  loadCatalog: () => Promise<void>;
  setCacheDir: (path?: string) => Promise<void>;
  refreshCache: () => Promise<void>;
  setFilter: (f: Partial<FirmwareCatalogState["filter"]>) => void;
  checkForUpdates: () => Promise<void>;

  downloadFirmware: (entryId: string) => Promise<void>;
  downloadFirmwareRemote: (
    entryId: string,
    agentId: string,
    sendCommand: SendCommandFn,
    waitForCommand: WaitForCommandFn,
  ) => Promise<void>;
  serveFirmware: (entryId: string) => Promise<void>;
  serveFirmwareRemote: (
    entryId: string,
    agentId: string,
    sendCommand: SendCommandFn,
    waitForCommand: WaitForCommandFn,
  ) => Promise<void>;
  stopServing: (
    agentId?: string | null,
    sendCommand?: SendCommandFn,
  ) => Promise<void>;
  clearCache: (entryId?: string) => Promise<void>;
  isRemoteReady: (entryId: string) => boolean;
}

export const useFirmwareCatalogStore = create<FirmwareCatalogState>((set, get) => ({
  catalog: [],
  cache: new Map(),
  downloads: new Map(),
  serve: null,
  remotePaths: new Map(),
  updateChecks: null,
  checkingUpdates: false,
  filter: { vendor: "all", series: "all", search: "" },
  loaded: false,
  cacheDir: null,
  _progressUnlisten: null,

  loadCatalog: async () => {
    try {
      await toolsApi.toolsFirmwareLoadPrefs();
      const [catalog, dir] = await Promise.all([
        toolsApi.toolsFirmwareCatalog(),
        toolsApi.toolsFirmwareGetCacheDir(),
      ]);
      set({ catalog, cacheDir: dir, loaded: true });
      await get().refreshCache();
    } catch (e) {
      console.error("Failed to load firmware catalog:", e);
    }
  },

  setCacheDir: async (path?: string) => {
    try {
      await toolsApi.toolsFirmwareSetCacheDir(path);
      const dir = await toolsApi.toolsFirmwareGetCacheDir();
      set({ cacheDir: dir });
      await get().refreshCache();
    } catch (e) {
      console.error("Failed to set cache directory:", e);
    }
  },

  refreshCache: async () => {
    try {
      const list = await toolsApi.toolsFirmwareCacheList();
      const cache = new Map<string, FirmwareCacheEntry>();
      for (const entry of list) {
        cache.set(entry.entry_id, entry);
      }
      set({ cache });
    } catch (e) {
      console.error("Failed to refresh firmware cache:", e);
    }
  },

  setFilter: (f) => {
    set((s) => ({ filter: { ...s.filter, ...f } }));
  },

  checkForUpdates: async () => {
    set({ checkingUpdates: true });
    try {
      const result = await toolsApi.toolsFirmwareCheckUpdates();
      const catalog = await toolsApi.toolsFirmwareCatalog();
      set({
        catalog,
        updateChecks: result.checks,
        checkingUpdates: false,
      });
      await get().refreshCache();
    } catch (e) {
      console.error("Failed to check for firmware updates:", e);
      set({ checkingUpdates: false });
    }
  },

  downloadFirmware: async (entryId: string) => {
    const existing = get().downloads.get(entryId);
    if (existing?.status === "downloading") return;

    const downloads = new Map(get().downloads);
    downloads.set(entryId, {
      status: "downloading",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      phase: "downloading",
      filesExtracted: 0,
    });
    set({ downloads });

    if (!get()._progressUnlisten) {
      const unlisten = await toolsApi.onFirmwareProgress((p: FirmwareDownloadProgress) => {
        const dl = new Map(get().downloads);
        const ex = dl.get(p.entry_id);
        if (ex) {
          const isExtracting = p.phase === "extracting";
          dl.set(p.entry_id, {
            ...ex,
            status: isExtracting ? "extracting" : "downloading",
            progress: p.pct,
            downloadedBytes: p.downloaded_bytes,
            totalBytes: p.total_bytes,
            phase: p.phase,
            filesExtracted: p.files_extracted,
          });
          set({ downloads: dl });
        }
      });
      set({ _progressUnlisten: unlisten });
    }

    try {
      await toolsApi.toolsFirmwareDownload(entryId);
      const dl = new Map(get().downloads);
      const prev = dl.get(entryId);
      dl.set(entryId, {
        status: "done",
        progress: 100,
        downloadedBytes: prev?.downloadedBytes ?? 0,
        totalBytes: prev?.totalBytes ?? 0,
        phase: "downloading",
        filesExtracted: prev?.filesExtracted ?? 0,
      });
      set({ downloads: dl });
      const hasActive = [...dl.values()].some((d) => d.status === "downloading" || d.status === "extracting");
      if (!hasActive && get()._progressUnlisten) {
        get()._progressUnlisten!();
        set({ _progressUnlisten: null });
      }
      await get().refreshCache();
    } catch (e: any) {
      const dl = new Map(get().downloads);
      const prev = dl.get(entryId);
      dl.set(entryId, {
        status: "error",
        progress: prev?.progress ?? 0,
        downloadedBytes: prev?.downloadedBytes ?? 0,
        totalBytes: prev?.totalBytes ?? 0,
        phase: prev?.phase ?? "downloading",
        filesExtracted: prev?.filesExtracted ?? 0,
        error: e?.toString() ?? "Download failed",
      });
      set({ downloads: dl });
      const hasActive = [...dl.values()].some((d) => d.status === "downloading" || d.status === "extracting");
      if (!hasActive && get()._progressUnlisten) {
        get()._progressUnlisten!();
        set({ _progressUnlisten: null });
      }
    }
  },

  downloadFirmwareRemote: async (entryId, agentId, sendCommand, waitForCommand) => {
    const existing = get().downloads.get(entryId);
    if (existing?.status === "downloading" || existing?.status === "extracting") return;

    const entry = get().catalog.find((e) => e.id === entryId);
    if (!entry) return;

    const downloads = new Map(get().downloads);
    downloads.set(entryId, {
      status: "downloading",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      phase: "downloading",
      filesExtracted: 0,
    });
    set({ downloads });

    try {
      const msgId = await sendCommand(agentId, "FirmwareDownload", {
        entry_id: entry.id,
        url: entry.url,
        fallback_url: entry.fallback_url,
        filename: entry.filename,
        archive_format: entry.archive_format,
        sha256: entry.sha256,
      });

      const outcome = await waitForCommand(msgId);

      if ("error" in outcome && outcome.error) {
        const dl = new Map(get().downloads);
        dl.set(entryId, {
          status: "error",
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          phase: "downloading",
          filesExtracted: 0,
          error: outcome.error,
        });
        set({ downloads: dl });
        return;
      }

      const result = outcome.result as { dir?: string; path?: string } | undefined;
      const dir = result?.dir || (result?.path ? result.path.replace(/\/[^/]+$/, "") : "");

      if (dir) {
        const rp = new Map(get().remotePaths);
        rp.set(entryId, dir);
        set({ remotePaths: rp });
      }

      const dl = new Map(get().downloads);
      dl.set(entryId, {
        status: "done",
        progress: 100,
        downloadedBytes: 0,
        totalBytes: 0,
        phase: "downloading",
        filesExtracted: 0,
      });
      set({ downloads: dl });
    } catch (e: any) {
      const dl = new Map(get().downloads);
      dl.set(entryId, {
        status: "error",
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        phase: "downloading",
        filesExtracted: 0,
        error: e?.toString() ?? "Remote download failed",
      });
      set({ downloads: dl });
    }
  },

  serveFirmware: async (entryId: string) => {
    const existing = get().serve;

    if (existing) {
      if (existing.entryIds.includes(entryId)) return;
      await toolsApi.toolsFirmwareServe(entryId, existing.sessionId);
      set({
        serve: {
          ...existing,
          entryIds: [...existing.entryIds, entryId],
        },
      });
      return;
    }

    if (!get().cache.has(entryId)) return;

    const startResult = await toolsApi.toolsVirtualServeStart(8069, []);
    await toolsApi.toolsFirmwareServe(entryId, startResult.session_id);

    set({
      serve: {
        sessionId: startResult.session_id,
        httpUrl: startResult.http_url,
        entryIds: [entryId],
        remote: false,
      },
    });
  },

  serveFirmwareRemote: async (entryId, agentId, sendCommand, waitForCommand) => {
    const existing = get().serve;

    if (existing && existing.remote) {
      if (existing.entryIds.includes(entryId)) return;
      set({
        serve: {
          ...existing,
          entryIds: [...existing.entryIds, entryId],
        },
      });
      return;
    }

    const dir = get().remotePaths.get(entryId);
    if (!dir) return;

    try {
      const msgId = await sendCommand(agentId, "FileServe", {
        path: dir,
        http_port: 8069,
        tftp_port: 69,
        protocols: ["http"],
        duration_secs: 0,
      });

      set({
        serve: {
          sessionId: msgId,
          httpUrl: "Starting...",
          entryIds: [entryId],
          remote: true,
        },
      });

      const outcome = await waitForCommand(msgId);
      const result = outcome.result as { http_url?: string } | undefined;
      const httpUrl = result?.http_url;
      if (httpUrl && get().serve?.sessionId === msgId) {
        set((s) => ({
          serve: s.serve ? { ...s.serve, httpUrl } : s.serve,
        }));
      }
    } catch (e: any) {
      console.error("Failed to start remote firmware server:", e);
    }
  },

  stopServing: async (agentId, sendCommand) => {
    const serve = get().serve;
    if (!serve) return;

    try {
      if (serve.remote && agentId && sendCommand) {
        await sendCommand(agentId, "StopFileServe", { command_id: serve.sessionId });
      } else if (!serve.remote) {
        await toolsApi.toolsVirtualServeStop(serve.sessionId);
      }
    } catch (e) {
      console.error("Failed to stop firmware server:", e);
    }
    set({ serve: null });
  },

  isRemoteReady: (entryId: string) => {
    return get().remotePaths.has(entryId);
  },

  clearCache: async (entryId?: string) => {
    try {
      await toolsApi.toolsFirmwareCacheClear(entryId);
      await get().refreshCache();
      if (entryId) {
        const dl = new Map(get().downloads);
        dl.delete(entryId);
        const rp = new Map(get().remotePaths);
        rp.delete(entryId);
        set({ downloads: dl, remotePaths: rp });
      } else {
        set({ downloads: new Map(), remotePaths: new Map() });
      }
    } catch (e) {
      console.error("Failed to clear firmware cache:", e);
    }
  },
}));
