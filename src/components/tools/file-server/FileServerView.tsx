import { useState, useCallback, useEffect, useMemo, useRef, type ChangeEvent } from "react";
import { type ColumnDef, type SortingFn } from "@tanstack/react-table";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useToolStore } from "@/stores/toolStore";
import * as toolsApi from "@/api/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";
import { MetricCard } from "@/components/network-test/components/MetricCard";
import { tooltips } from "@/lib/tooltips";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HardDrive,
  Play,
  Loader2,
  PowerOff,
  Globe,
  Folder,
  FileText,
  File,
  ArrowLeft,
  RefreshCw,
  ChevronRight,
  Download,
  Filter,
  Trash2,
  Settings,
  Terminal,
  Package,
  Image,
  Table,
  MusicNote,
  VideoCamera,
  FilePdf,
  Upload,
  Plus,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useUnifiedTable } from "@/lib/table/useUnifiedTable";

const TOOL_ID = "toolsFileServer";

interface FileServeStatus {
  http_url: string;
  tftp_url: string;
  serving: boolean;
}

interface FileServeRequest {
  timestamp: string;
  client_ip: string;
  filename: string;
  status: number;
  bytes_sent: number;
  duration_ms: number;
  protocol: string;
}

interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
  mode: string;
}

type ActivePanel = "explorer" | "requests" | "virtual";
type ExplorerSortColumn = "name" | "size" | "date";

const PRESET_DIRS = [
  { label: "TFTP Boot", path: "/var/lib/tftpboot", desc: "TFTP provisioning root" },
  { label: "Home", path: "/home", desc: "User home directories" },
  { label: "Tmp", path: "/tmp", desc: "Temporary files" },
  { label: "Var Log", path: "/var/log", desc: "System log files" },
  { label: "Etc", path: "/etc", desc: "System configuration" },
  { label: "WWW", path: "/var/www/html", desc: "Web server root" },
  { label: "Asterisk Sounds", path: "/var/lib/asterisk/sounds", desc: "Asterisk audio files" },
  { label: "Firmware", path: "/srv/firmware", desc: "Firmware update files" },
] as const;

const explorerNameSortingFn: SortingFn<DirEntry> = (rowA, rowB) => {
  const a = rowA.original;
  const b = rowB.original;
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
  return a.name.localeCompare(b.name);
};

const explorerSizeSortingFn: SortingFn<DirEntry> = (rowA, rowB) => {
  const a = rowA.original;
  const b = rowB.original;
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
  return a.size - b.size;
};

const explorerDateSortingFn: SortingFn<DirEntry> = (rowA, rowB) => {
  const a = rowA.original;
  const b = rowB.original;
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
  return a.mod_time.localeCompare(b.mod_time);
};

export function FileServerView({ toolId }: { toolId?: string }) {
  const [activePanel, setActivePanel] = useState<ActivePanel>("explorer");
  const activeToolId = useToolStore((s) => s.activeToolId);
  const toolsLastSubview = useToolStore((s) => s.lastViewedSubviews.tools);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const ctx = resolvedContext(TOOL_ID);
  const isRemote = ctx.type === "remote";
  const agentId = isRemote ? (ctx as { type: "remote"; agentId: string }).agentId : null;

  // File explorer state
  const [currentPath, setCurrentPath] = useState("/tmp");
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);
  const [loadingDir, setLoadingDir] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Server state
  const [httpPort, setHttpPort] = useState("8080");
  const [protocol, setProtocol] = useState<"http" | "tftp" | "both">("http");
  const [serveHidden, setServeHidden] = useState(false);
  const [serving, setServing] = useState(false);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [localServeSessionId, setLocalServeSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<FileServeStatus | null>(null);
  const [requests, setRequests] = useState<FileServeRequest[]>([]);
  const [requestFilter, setRequestFilter] = useState("");
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const startTimeRef = useRef<Date | null>(null);
  const initialLoaded = useRef(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Virtual server state
  const [virtualFiles, setVirtualFiles] = useState<Array<{ name: string; size: number; data_base64: string }>>([]);
  const [virtualSessionId, setVirtualSessionId] = useState<string | null>(null);
  const [virtualServing, setVirtualServing] = useState(false);
  const [virtualHttpPort, setVirtualHttpPort] = useState("8080");
  const [virtualStatus, setVirtualStatus] = useState<FileServeStatus | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [virtualSelectedFiles, setVirtualSelectedFiles] = useState<Set<string>>(new Set());
  const [virtualElapsed, setVirtualElapsed] = useState(0);
  const virtualStartRef = useRef<Date | null>(null);
  const virtualUnlistenRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendCommand = useRemoteAgentStore((s) => s.sendCommand);
  const waitForCommand = useRemoteAgentStore((s) => s.waitForCommand);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current();
      if (virtualUnlistenRef.current) virtualUnlistenRef.current();
      if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
    };
  }, []);

  // Elapsed timer for server
  useEffect(() => {
    if (!serving) return;
    startTimeRef.current = new Date();
    const iv = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSecs(Math.floor((Date.now() - startTimeRef.current.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [serving]);

  useEffect(() => {
    if (!virtualServing) return;
    virtualStartRef.current = new Date();
    const iv = setInterval(() => {
      if (virtualStartRef.current) {
        setVirtualElapsed(Math.floor((Date.now() - virtualStartRef.current.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [virtualServing]);

  // Watch for streaming updates (remote file serve)
  useEffect(() => {
    if (!commandId) return;
    const unsub = useRemoteAgentStore.subscribe((state) => {
      const cmd = state.pendingCommands.find((c) => c.id === commandId);
      if (!cmd) return;
      if (cmd.status === "running" && cmd.result) {
        const partial = cmd.result as any;
        if (partial.http_url !== undefined) {
          setStatus(partial as FileServeStatus);
        } else if (partial.client_ip !== undefined) {
          setRequests((prev) => [...prev, partial as FileServeRequest]);
        }
      }
      if (cmd.status === "done" || cmd.status === "error") {
        setServing(false);
        if (cmd.result) {
          const result = (cmd.result as any)?.result ?? cmd.result;
          if (result?.serving !== undefined) {
            setStatus(result as FileServeStatus);
          }
        }
      }
    });
    return unsub;
  }, [commandId]);

  // Browse directory — dispatches local or remote
  const browseDir = useCallback(async (path: string) => {
    setLoadingDir(true);
    setDirError(null);
    setSelectedFiles(new Set());
    setFileSearch("");
    try {
      if (isRemote && agentId) {
        const msgId = await sendCommand(agentId, "ListDir", {
          path,
          show_hidden: showHidden,
        });
        const res = await waitForCommand(msgId);
        if ("result" in res) {
          const data = res.result as any;
          setCurrentPath(data.path || path);
          setDirEntries(data.entries ?? []);
          if (data.error) setDirError(data.error);
        } else {
          setDirError((res as any).error || "Failed to browse");
        }
      } else {
        const result = await toolsApi.toolsListDir(path, showHidden);
        setCurrentPath(result.path || path);
        setDirEntries(result.entries ?? []);
        if (result.error) setDirError(result.error);
      }
    } catch (err: any) {
      setDirError(err?.message || "Failed to browse directory");
    } finally {
      setLoadingDir(false);
    }
  }, [isRemote, agentId, showHidden, sendCommand, waitForCommand]);

  // Load initial dir on mount and when context changes
  useEffect(() => {
    browseDir(currentPath);
    initialLoaded.current = true;
  }, [isRemote, agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = (path: string) => {
    // browseDir updates currentPath only after a successful list call.
    // This prevents the explorer breadcrumb/state from drifting to invalid paths.
    void browseDir(path);
  };

  const navigateUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    if (parent === currentPath) return;
    navigateTo(parent);
  };

  const filteredEntries = useMemo(() => {
    if (!fileSearch) return dirEntries;
    const lower = fileSearch.toLowerCase();
    return dirEntries.filter((entry) => entry.name.toLowerCase().includes(lower));
  }, [dirEntries, fileSearch]);
  const explorerColumns = useMemo<ColumnDef<DirEntry, unknown>[]>(() => [
    { id: "name", accessorKey: "name", sortingFn: explorerNameSortingFn },
    { id: "size", accessorKey: "size", sortingFn: explorerSizeSortingFn },
    { id: "date", accessorKey: "mod_time", sortingFn: explorerDateSortingFn },
  ], []);
  const { table: explorerTable } = useUnifiedTable<DirEntry>({
    data: filteredEntries,
    columns: explorerColumns,
    initialSorting: [{ id: "name", desc: false }],
    getRowId: (row) => row.name,
  });
  const explorerRows = explorerTable.getRowModel().rows;

  // Breadcrumbs from current path
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs = [{ label: "/", path: "/" }];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  }, [currentPath]);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    if (!requestFilter) return requests;
    const lower = requestFilter.toLowerCase();
    return requests.filter(
      (r) =>
        r.filename.toLowerCase().includes(lower) ||
        r.client_ip.toLowerCase().includes(lower),
    );
  }, [requests, requestFilter]);

  // Server stats
  const serverStats = useMemo(() => {
    const totalBytes = requests.reduce((s, r) => s + r.bytes_sent, 0);
    const errors = requests.filter((r) => r.status >= 400).length;
    const clients = new Set(requests.map((r) => r.client_ip));
    return { totalBytes, errors, uniqueClients: clients.size, total: requests.length };
  }, [requests]);

  const handleStart = useCallback(async () => {
    if (serving) return;
    setServing(true);
    setRequests([]);
    setStatus(null);
    setElapsedSecs(0);

    if (isRemote && agentId) {
      try {
        const protocols = protocol === "both" ? ["http", "tftp"] : [protocol];
        const msgId = await sendCommand(agentId, "FileServe", {
          path: currentPath.trim(),
          http_port: parseInt(httpPort) || 8080,
          tftp_port: 69,
          protocols,
          duration_secs: 0,
          files: [],
        });
        setCommandId(msgId);
      } catch {
        setServing(false);
      }
    } else {
      try {
        const result = await toolsApi.toolsServeStart(
          currentPath.trim(),
          parseInt(httpPort) || 8080,
          serveHidden,
        );
        setLocalServeSessionId(result.session_id);
        setStatus({ serving: true, http_url: result.http_url, tftp_url: "" });
        const unlisten = await toolsApi.onFileServeRequest(result.session_id, (req) => {
          setRequests((prev) => [
            ...prev,
            {
              timestamp: req.timestamp,
              client_ip: req.client_ip,
              filename: req.path,
              status: req.status,
              bytes_sent: req.size,
              duration_ms: req.duration_ms,
              protocol: "HTTP",
            },
          ]);
        });
        unlistenRef.current = unlisten;
      } catch {
        setServing(false);
      }
    }
  }, [agentId, isRemote, currentPath, httpPort, protocol, serveHidden, serving, sendCommand]);

  const handleStop = useCallback(async () => {
    if (isRemote && agentId && commandId) {
      try {
        await sendCommand(agentId, "StopFileServe", { command_id: commandId });
      } catch { /* ignore */ }
    } else if (localServeSessionId) {
      try {
        await toolsApi.toolsServeStop(localServeSessionId);
      } catch { /* ignore */ }
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      setLocalServeSessionId(null);
    }
    setServing(false);
    setStatus(null);
  }, [agentId, isRemote, commandId, localServeSessionId, sendCommand]);


  // ── Virtual server helpers ──
  const readFilesToBase64 = useCallback(
    async (fileList: FileList | File[]) => {
      const results: Array<{ name: string; size: number; data_base64: string }> = [];
      for (const file of Array.from(fileList)) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
        const data_base64 = btoa(binary);
        results.push({ name: file.name, size: file.size, data_base64 });
      }
      return results;
    },
    [],
  );

  const handleVirtualFileDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
      setFileDragOver(false);
      if (!e.dataTransfer.files.length) return;
      const newFiles = await readFilesToBase64(e.dataTransfer.files);
      setVirtualFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name));
        const merged = [...prev];
        for (const f of newFiles) {
          if (existing.has(f.name)) {
            const idx = merged.findIndex((p) => p.name === f.name);
            if (idx >= 0) merged[idx] = f;
          } else {
            merged.push(f);
          }
        }
        return merged;
      });
      if (virtualServing && virtualSessionId) {
        try {
          await toolsApi.toolsVirtualAddFiles(
            virtualSessionId,
            newFiles.map((f) => ({ name: f.name, data_base64: f.data_base64 })),
          );
        } catch { /* ignore */ }
      }
    },
    [readFilesToBase64, virtualServing, virtualSessionId],
  );

  const handleVirtualFileInput = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const newFiles = await readFilesToBase64(e.target.files);
      setVirtualFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name));
        const merged = [...prev];
        for (const f of newFiles) {
          if (existing.has(f.name)) {
            const idx = merged.findIndex((p) => p.name === f.name);
            if (idx >= 0) merged[idx] = f;
          } else {
            merged.push(f);
          }
        }
        return merged;
      });
      if (virtualServing && virtualSessionId) {
        try {
          await toolsApi.toolsVirtualAddFiles(
            virtualSessionId,
            newFiles.map((f) => ({ name: f.name, data_base64: f.data_base64 })),
          );
        } catch { /* ignore */ }
      }
      e.target.value = "";
    },
    [readFilesToBase64, virtualServing, virtualSessionId],
  );

  const handleVirtualRemoveFile = useCallback(
    async (name: string) => {
      setVirtualFiles((prev) => prev.filter((f) => f.name !== name));
      setVirtualSelectedFiles((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      if (virtualServing && virtualSessionId) {
        try {
          await toolsApi.toolsVirtualRemoveFile(virtualSessionId, name);
        } catch { /* ignore */ }
      }
    },
    [virtualServing, virtualSessionId],
  );

  const handleVirtualRemoveSelected = useCallback(async () => {
    const toRemove = Array.from(virtualSelectedFiles);
    if (toRemove.length === 0) return;
    setVirtualFiles((prev) => prev.filter((f) => !virtualSelectedFiles.has(f.name)));
    setVirtualSelectedFiles(new Set());
    if (virtualServing && virtualSessionId) {
      for (const name of toRemove) {
        try {
          await toolsApi.toolsVirtualRemoveFile(virtualSessionId, name);
        } catch { /* ignore */ }
      }
    }
  }, [virtualSelectedFiles, virtualServing, virtualSessionId]);

  const handleVirtualStart = useCallback(async () => {
    if (virtualServing || virtualFiles.length === 0) return;
    setVirtualServing(true);
    setRequests([]);
    setVirtualStatus(null);
    setVirtualElapsed(0);

    if (isRemote && agentId) {
      try {
        const msgId = await sendCommand(agentId, "FileServe", {
          path: "",
          http_port: parseInt(virtualHttpPort) || 8080,
          tftp_port: 69,
          protocols: ["http"],
          duration_secs: 0,
          files: virtualFiles.map((f) => ({ name: f.name, content_base64: f.data_base64 })),
        });
        setCommandId(msgId);
      } catch {
        setVirtualServing(false);
      }
    } else {
      try {
        const result = await toolsApi.toolsVirtualServeStart(
          parseInt(virtualHttpPort) || 8080,
          virtualFiles.map((f) => ({ name: f.name, data_base64: f.data_base64 })),
        );
        setVirtualSessionId(result.session_id);
        setVirtualStatus({ serving: true, http_url: result.http_url, tftp_url: "" });
        const unlisten = await toolsApi.onFileServeRequest(result.session_id, (req) => {
          setRequests((prev) => [
            ...prev,
            {
              timestamp: req.timestamp,
              client_ip: req.client_ip,
              filename: req.path,
              status: req.status,
              bytes_sent: req.size,
              duration_ms: req.duration_ms,
              protocol: "HTTP",
            },
          ]);
        });
        virtualUnlistenRef.current = unlisten;
      } catch {
        setVirtualServing(false);
      }
    }
  }, [agentId, isRemote, virtualFiles, virtualHttpPort, virtualServing, sendCommand]);

  const handleVirtualStop = useCallback(async () => {
    if (isRemote && agentId && commandId) {
      try {
        await sendCommand(agentId, "StopFileServe", { command_id: commandId });
      } catch { /* ignore */ }
    } else if (virtualSessionId) {
      try {
        await toolsApi.toolsVirtualServeStop(virtualSessionId);
      } catch { /* ignore */ }
      if (virtualUnlistenRef.current) {
        virtualUnlistenRef.current();
        virtualUnlistenRef.current = null;
      }
      setVirtualSessionId(null);
    }
    setVirtualServing(false);
    setVirtualStatus(null);
  }, [agentId, isRemote, commandId, virtualSessionId, sendCommand]);

  const virtualTotalSize = useMemo(
    () => virtualFiles.reduce((s, f) => s + f.size, 0),
    [virtualFiles],
  );

  const toggleExplorerSort = (col: ExplorerSortColumn) => {
    const column = explorerTable.getColumn(col);
    const direction = column?.getIsSorted();
    column?.toggleSorting(direction === "asc");
  };

  const FILE_SERVER_TABS = useMemo(() => [
    { id: "explorer", label: "Explorer", tip: tooltips.fileExplorer.title, tipDesc: tooltips.fileExplorer.description },
    { id: "virtual", label: `Virtual${virtualFiles.length > 0 ? ` (${virtualFiles.length})` : ""}`, tip: tooltips.fileVirtualPanel.title, tipDesc: tooltips.fileVirtualPanel.description },
    { id: "requests", label: `Requests${requests.length > 0 ? ` (${requests.length})` : ""}`, tip: tooltips.fileRequests.title, tipDesc: tooltips.fileRequests.description },
  ] as const, [virtualFiles.length, requests.length]);
  const registerBreadcrumbTabs =
    toolId != null &&
    activeToolId === "tools" &&
    toolsLastSubview === "file-server";

  return (
    <div className="flex flex-col gap-4 pb-8 h-full min-h-full">
      {/* ── Panel tabs ── */}
      <ToolSubTabs
        tabs={FILE_SERVER_TABS}
        activeTab={activePanel}
        onTabChange={(id) => setActivePanel(id as ActivePanel)}
        toolId={registerBreadcrumbTabs ? toolId : undefined}
        trailing={(serving || virtualServing) ? (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success status-online" />
            </span>
            <span className="text-2xs text-success font-medium tabular-nums">
              {virtualServing ? "Virtual" : "Serving"} {formatDuration(virtualServing ? virtualElapsed : elapsedSecs)}
            </span>
          </div>
        ) : undefined}
      />

      {/* ── File Explorer Panel ── */}
      {activePanel === "explorer" && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Toolbar */}
          <div className="rounded-md ui-hero-surface flex flex-col flex-shrink-0">
            {/* Row 1: Breadcrumb + serve controls */}
            <div className="px-4 py-2.5 flex items-center gap-1.5">
              <TooltipWrapper title="Go up" side="bottom">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={navigateUp} disabled={currentPath === "/" || serving}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
              </TooltipWrapper>
              <TooltipWrapper title="Refresh" side="bottom">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => browseDir(currentPath)} disabled={loadingDir}>
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingDir && "animate-spin")} />
                </Button>
              </TooltipWrapper>

              <div className="flex items-center gap-0 flex-1 min-w-0 overflow-x-auto">
                {breadcrumbs.map((crumb, i) => (
                  <div key={crumb.path} className="flex items-center shrink-0">
                    {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/60 mx-0.5" />}
                    <button
                      className={cn(
                        "text-xs px-1 py-0.5 rounded transition-smooth font-mono",
                        i === breadcrumbs.length - 1
                          ? "text-foreground font-semibold bg-muted/20"
                          : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/20",
                      )}
                      onClick={() => !serving && navigateTo(crumb.path)}
                      disabled={serving}
                    >
                      {crumb.label}
                    </button>
                  </div>
                ))}
              </div>

              <div className="border-l border-border/20 h-5 mx-0.5" />

              <TooltipWrapper entry={tooltips.fileHttpPort} side="bottom">
                <Input
                  value={httpPort}
                  onChange={(e) => setHttpPort(e.target.value)}
                  placeholder="8080"
                  className="h-7 w-[60px] text-xs text-center"
                  disabled={serving}
                />
              </TooltipWrapper>
              <TooltipWrapper entry={tooltips.fileProtocol} side="bottom">
                <Select value={protocol} onValueChange={(v: any) => setProtocol(v)} disabled={serving}>
                  <SelectTrigger className="w-[80px] h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http" className="text-xs">HTTP</SelectItem>
                    <SelectItem value="tftp" className="text-xs">TFTP</SelectItem>
                    <SelectItem value="both" className="text-xs">Both</SelectItem>
                  </SelectContent>
                </Select>
              </TooltipWrapper>
              {serving ? (
                <TooltipWrapper title="Stop Server" description="Stop serving and release ports.">
                  <Button size="sm" variant="destructive" className="h-7 gap-1.5 text-xs px-2.5" onClick={handleStop}>
                    <PowerOff className="h-3 w-3" />
                    Stop
                  </Button>
                </TooltipWrapper>
              ) : (
                <TooltipWrapper title="Serve this directory" description={`Serve ${currentPath} via ${protocol.toUpperCase()} on port ${httpPort}`}>
                  <Button size="sm" className="h-7 gap-1.5 text-xs px-2.5" onClick={handleStart}>
                    <Globe className="h-3 w-3" />
                    Serve
                  </Button>
                </TooltipWrapper>
              )}
            </div>

            {/* Row 2: Filter + quick-jump + toggles */}
            <div className="px-4 pb-2.5 flex items-center gap-1.5">
              <div className="relative flex-1 min-w-[100px]">
                <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
                <Input
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Filter files..."
                  className="h-7 text-xs pl-7"
                />
              </div>
              <TooltipWrapper entry={tooltips.fileQuickJump}>
                <Select onValueChange={(v) => !serving && navigateTo(v)} disabled={serving}>
                  <SelectTrigger className="w-[120px] h-7 text-xs">
                    <SelectValue placeholder="Quick jump..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_DIRS.map((d) => (
                      <SelectItem key={d.path} value={d.path} className="text-xs">
                        <div className="flex items-center gap-2">
                          <Folder className="h-3 w-3 text-muted-foreground/60" />
                          <span className="font-medium">{d.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TooltipWrapper>

              <div className="border-l border-border/20 h-5 mx-0.5" />

              <TooltipWrapper entry={tooltips.fileHidden} side="bottom">
                <div className="flex items-center gap-1">
                  <span className="text-2xs text-muted-foreground/60">Hidden</span>
                  <Switch
                    size="sm"
                    checked={showHidden}
                    onCheckedChange={(v) => {
                      setShowHidden(v);
                      setTimeout(() => browseDir(currentPath), 50);
                    }}
                  />
                </div>
              </TooltipWrapper>
              <TooltipWrapper title="Include hidden files in served listings" side="bottom">
                <div className="flex items-center gap-1">
                  <span className="text-2xs text-muted-foreground/60">Serve Hidden</span>
                  <Switch size="sm" checked={serveHidden} onCheckedChange={setServeHidden} disabled={serving} />
                </div>
              </TooltipWrapper>
              <Badge variant="outline" className="text-2xs h-5 px-1.5 tabular-nums shrink-0">
                {explorerRows.length} item{explorerRows.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          </div>

          {/* Live serving status bar */}
          {serving && status?.serving && (
            <div className="rounded-lg bg-success/5 border border-success/20 px-4 py-2.5 flex items-center gap-3 flex-shrink-0 animate-panel-enter">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success status-online" />
                </span>
                <span className="text-2xs font-medium text-success">Serving {currentPath}</span>
              </div>
              <div className="flex-1" />
              {status.http_url && (
                <div className="flex items-center gap-1.5">
                  <Globe className="h-3 w-3 text-success" />
                  <span className="text-xs font-mono text-success">{status.http_url}</span>
                  <CopyTextButton text={status.http_url} size="icon" className="h-5 w-5" />
                </div>
              )}
              {status.tftp_url && (
                <div className="flex items-center gap-1.5">
                  <span className="text-2xs text-success/60 font-medium">TFTP</span>
                  <span className="text-xs font-mono text-success">{status.tftp_url}</span>
                  <CopyTextButton text={status.tftp_url} size="icon" className="h-5 w-5" />
                </div>
              )}
            </div>
          )}

          {dirError && !loadingDir && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive flex-shrink-0">
              {dirError}
            </div>
          )}

          {/* File list */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-md ui-hero-surface overflow-hidden">
            {loadingDir ? (
              <div className="flex items-center justify-center gap-2 py-12">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Loading...</span>
              </div>
            ) : explorerRows.length === 0 && !dirError ? (
              <div className="flex items-center justify-center py-12">
                <span className="text-xs text-muted-foreground/60">Empty directory</span>
              </div>
            ) : (
              <>
                <div className="ui-sticky-header flex items-center gap-0 px-2 py-1 text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                  <span className="w-5 shrink-0" />
                  <SortableHeader
                    label="Name"
                    col="name"
                    sortDir={explorerTable.getColumn("name")?.getIsSorted() ?? false}
                    onSort={toggleExplorerSort}
                    className="flex-1"
                  />
                  <SortableHeader
                    label="Size"
                    col="size"
                    sortDir={explorerTable.getColumn("size")?.getIsSorted() ?? false}
                    onSort={toggleExplorerSort}
                    className="w-20 text-right"
                  />
                  <SortableHeader
                    label="Modified"
                    col="date"
                    sortDir={explorerTable.getColumn("date")?.getIsSorted() ?? false}
                    onSort={toggleExplorerSort}
                    className="w-28 text-right"
                  />
                  <span className="w-16 text-right px-2">Mode</span>
                </div>
                <div className="divide-y divide-border/20">
                  {explorerRows.map((row) => {
                    const entry = row.original;
                    return (
                    <FileRow
                      key={entry.name}
                      entry={entry}
                      currentPath={currentPath}
                      selected={selectedFiles.has(entry.name)}
                      onSelect={(e) => {
                        if (entry.is_dir && !e.ctrlKey && !e.metaKey) {
                          navigateTo(
                            currentPath === "/" ? `/${entry.name}` : `${currentPath}/${entry.name}`,
                          );
                          return;
                        }
                        setSelectedFiles((prev) => {
                          if (e.ctrlKey || e.metaKey) {
                            const next = new Set(prev);
                            next.has(entry.name) ? next.delete(entry.name) : next.add(entry.name);
                            return next;
                          }
                          return prev.has(entry.name) && prev.size === 1
                            ? new Set<string>()
                            : new Set([entry.name]);
                        });
                      }}
                      onNavigate={(path) => !serving && navigateTo(path)}
                    />
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Stats when serving */}
          {serving && (
            <div className="grid grid-cols-4 gap-3 flex-shrink-0">
              <MetricCard label="Requests" value={`${serverStats.total}`} />
              <MetricCard label="Data Served" value={formatBytes(serverStats.totalBytes)} />
              <MetricCard label="Clients" value={`${serverStats.uniqueClients}`} />
              <MetricCard label="Errors" value={`${serverStats.errors}`} status={serverStats.errors > 0 ? "fail" : "idle"} />
            </div>
          )}
        </div>
      )}

      {/* ── Requests Panel ── */}
      {activePanel === "requests" && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="rounded-md ui-hero-surface px-5 py-3 flex items-center gap-2 flex-shrink-0">
            <div className="relative flex-1">
              <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
              <Input
                value={requestFilter}
                onChange={(e) => setRequestFilter(e.target.value)}
                placeholder="Filter by file or client IP..."
                className="h-8 text-xs pl-7"
              />
            </div>
            <Badge variant="outline" className="text-2xs h-5 px-1.5 tabular-nums">
              {filteredRequests.length === requests.length
                ? `${requests.length}`
                : `${filteredRequests.length} / ${requests.length}`}
            </Badge>
            {requests.length > 0 && (
              <TooltipWrapper title="Clear Requests" description="Remove all request log entries from the display.">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setRequests([])}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipWrapper>
            )}
          </div>

          {requests.length === 0 ? (
            <EmptyState
              variant="inline"
              compact
              icon={<Download />}
              title="No requests yet"
              description={serving ? "Waiting for clients to request files..." : "Start the file server to begin logging requests."}
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto rounded-md ui-hero-surface overflow-hidden">
              <div className="ui-sticky-header flex items-center gap-0 px-2 py-1 text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                <span className="w-[65px] px-1 shrink-0">Time</span>
                <span className="w-[50px] px-1 shrink-0">Proto</span>
                <span className="w-[110px] px-1 shrink-0">Client</span>
                <span className="flex-1 px-1">File</span>
                <span className="w-[40px] px-1 text-center shrink-0">Code</span>
                <span className="w-[60px] px-1 text-right shrink-0">Size</span>
                <span className="w-[50px] px-1 text-right shrink-0">Time</span>
              </div>
              <div className="divide-y divide-border/20">
                {filteredRequests.map((req, i) => (
                  <div key={i} className="flex items-center gap-0 px-2 py-0.5 hover:bg-muted/10 transition-smooth">
                    <span className="w-[65px] px-1 shrink-0 text-2xs font-mono text-muted-foreground/60">
                      {formatRequestTime(req.timestamp)}
                    </span>
                    <span className="w-[50px] px-1 shrink-0">
                      <Badge variant="outline" className="text-3xs h-[16px] px-1 uppercase">
                        {req.protocol}
                      </Badge>
                    </span>
                    <span className="w-[110px] px-1 shrink-0 text-2xs font-mono text-muted-foreground/60 truncate">
                      {req.client_ip}
                    </span>
                    <span className="flex-1 min-w-0 px-1 text-2xs font-mono truncate">
                      {req.filename}
                    </span>
                    <span className="w-[40px] px-1 text-center shrink-0">
                      <Badge
                        variant={req.status < 400 ? "default" : "destructive"}
                        className="text-3xs h-[16px] px-1"
                      >
                        {req.status}
                      </Badge>
                    </span>
                    <span className="w-[60px] px-1 text-right shrink-0 text-2xs font-mono text-muted-foreground/60 tabular-nums">
                      {formatBytes(req.bytes_sent)}
                    </span>
                    <span className="w-[50px] px-1 text-right shrink-0 text-2xs font-mono text-muted-foreground/60 tabular-nums">
                      {req.duration_ms}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Virtual Panel ── */}
      {activePanel === "virtual" && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Server controls */}
          <div className="rounded-md ui-hero-surface px-5 py-4 flex flex-col gap-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              <span className="section-label-sm !text-foreground/80">Virtual File Server</span>
              {virtualServing && (
                <div className="flex items-center gap-2 ml-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success status-online" />
                  </span>
                  <span className="text-2xs text-success font-medium">Active</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
              <div className="space-y-1">
                <TooltipWrapper entry={tooltips.fileHttpPort} side="bottom">
                  <label className="section-label-sm cursor-help">HTTP Port</label>
                </TooltipWrapper>
                <Input
                  value={virtualHttpPort}
                  onChange={(e) => setVirtualHttpPort(e.target.value)}
                  placeholder="8080"
                  className="h-8 w-24 text-xs text-center"
                  disabled={virtualServing}
                />
              </div>
              <div className="space-y-1">
                <label className="section-label-sm">&nbsp;</label>
                {virtualServing ? (
                  <TooltipWrapper title="Stop Virtual Server" description="Shut down the virtual file server and release the bound port.">
                    <Button size="sm" variant="destructive" className="h-8 gap-1.5 text-xs" onClick={handleVirtualStop}>
                      <PowerOff className="h-3 w-3" />
                      Stop
                    </Button>
                  </TooltipWrapper>
                ) : (
                  <TooltipWrapper entry={tooltips.fileVirtualServeBtn}>
                    <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleVirtualStart} disabled={virtualFiles.length === 0}>
                      <Play className="h-3 w-3" />
                      Start
                    </Button>
                  </TooltipWrapper>
                )}
              </div>
              <div className="space-y-1">
                <label className="section-label-sm">&nbsp;</label>
                <Button size="sm" variant="neutral" className="h-8 gap-1.5 text-xs" onClick={() => fileInputRef.current?.click()}>
                  <Plus className="h-3 w-3" />
                  Browse
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleVirtualFileInput}
                />
              </div>
            </div>
          </div>

          {/* Serving status */}
          {virtualServing && virtualStatus?.serving && (
            <div className="rounded-lg bg-success/5 border border-success/20 p-3 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success status-online" />
                  </span>
                  <Badge className="bg-success text-success-foreground text-2xs h-5">Serving</Badge>
                </div>
                {virtualStatus.http_url && (
                  <div className="flex items-center gap-1.5">
                    <Globe className="h-3 w-3 text-success" />
                    <span className="text-xs font-mono text-success">{virtualStatus.http_url}</span>
                    <CopyTextButton text={virtualStatus.http_url} size="icon" className="h-5 w-5" />
                  </div>
                )}
              </div>
            </div>
          )}

          {virtualServing && (
            <div className="grid grid-cols-4 gap-3 flex-shrink-0">
              <MetricCard label="Requests" value={`${serverStats.total}`} />
              <MetricCard label="Data Served" value={formatBytes(serverStats.totalBytes)} />
              <MetricCard label="Clients" value={`${serverStats.uniqueClients}`} />
              <MetricCard label="Errors" value={`${serverStats.errors}`} status={serverStats.errors > 0 ? "fail" : "idle"} />
            </div>
          )}

          {/* Hero drop zone / file list — unified area */}
          <div
            onDrop={handleVirtualFileDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (dragLeaveTimer.current) {
                clearTimeout(dragLeaveTimer.current);
                dragLeaveTimer.current = null;
              }
              if (!fileDragOver) setFileDragOver(true);
            }}
            onDragLeave={() => {
              if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
              dragLeaveTimer.current = setTimeout(() => {
                setFileDragOver(false);
                dragLeaveTimer.current = null;
              }, 50);
            }}
            className={cn(
              "flex-1 min-h-0 rounded-lg border-2 border-dashed transition-smooth overflow-hidden flex flex-col",
              fileDragOver
                ? "border-primary bg-primary/5"
                : virtualFiles.length > 0
                  ? "border-border/20 rounded-md ui-hero-surface"
                  : "border-border/20 hover:border-border/40",
            )}
          >
            {virtualFiles.length === 0 ? (
              <div
                className="flex-1 flex flex-col items-center gap-5 cursor-pointer p-8 pt-[12%]"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className={cn(
                  "h-16 w-16 rounded-lg flex items-center justify-center transition-smooth",
                  fileDragOver ? "bg-primary/10" : "bg-muted/20",
                )}>
                  <Upload className={cn("h-7 w-7 transition-smooth", fileDragOver ? "text-primary" : "text-muted-foreground/60")} />
                </div>
                <div className="text-center space-y-1.5 max-w-xs">
                  <p className={cn("text-sm font-medium transition-smooth", fileDragOver ? "text-primary" : "text-muted-foreground/60")}>
                    {fileDragOver ? "Drop files to add" : "Drag & drop files here"}
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    or click to browse — files are held in memory and served directly over HTTP
                  </p>
                </div>
                <div className="flex items-center gap-4 text-2xs text-muted-foreground/60">
                  <span>Firmware</span>
                  <span className="h-3 border-l border-border/20" />
                  <span>Configs</span>
                  <span className="h-3 border-l border-border/20" />
                  <span>Provisioning</span>
                  <span className="h-3 border-l border-border/20" />
                  <span>Quick Share</span>
                </div>
              </div>
            ) : (
              <>
                <div className="sticky top-0 z-10 flex items-center gap-0 px-3 py-1.5 rounded-md ui-hero-surface border-b border-border/20">
                  <span className="w-5 shrink-0" />
                  <span className="flex-1 px-1 section-label-sm">Name</span>
                  <span className="w-20 text-right px-1 section-label-sm">Size</span>
                  <span className="w-8 shrink-0" />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/20">
                  {virtualFiles.map((file) => {
                    const { icon: FileIcon, color: iconColor } = fileIconForExt(file.name);
                    const isSelected = virtualSelectedFiles.has(file.name);
                    return (
                      <div
                        key={file.name}
                        className={cn(
                          "flex items-center gap-0 px-3 py-0.5 hover:bg-muted/10 transition-smooth cursor-pointer",
                          isSelected && "bg-primary/5",
                        )}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            setVirtualSelectedFiles((prev) => {
                              const next = new Set(prev);
                              next.has(file.name) ? next.delete(file.name) : next.add(file.name);
                              return next;
                            });
                          } else {
                            setVirtualSelectedFiles((prev) =>
                              prev.has(file.name) && prev.size === 1
                                ? new Set<string>()
                                : new Set([file.name]),
                            );
                          }
                        }}
                      >
                        <span className="w-5 shrink-0 flex items-center justify-center">
                          <FileIcon className={cn("h-3.5 w-3.5", iconColor)} />
                        </span>
                        <span className="flex-1 min-w-0 px-1 text-xs text-foreground/70 truncate">
                          {file.name}
                        </span>
                        <span className="w-20 text-right px-1 text-2xs font-mono text-muted-foreground/60 tabular-nums">
                          {formatBytes(file.size)}
                        </span>
                        <span className="w-8 shrink-0 flex items-center justify-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0"
                            onClick={(e) => { e.stopPropagation(); handleVirtualRemoveFile(file.name); }}
                            disabled={virtualServing}
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground/60 hover:text-destructive" />
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/20 rounded-md ui-hero-surface flex-shrink-0">
                  <span className="text-2xs text-muted-foreground/60">
                    {virtualSelectedFiles.size > 0
                      ? `${virtualSelectedFiles.size} selected · `
                      : ""}
                    {virtualFiles.length} file{virtualFiles.length !== 1 ? "s" : ""} · {formatBytes(virtualTotalSize)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {virtualSelectedFiles.size > 0 && !virtualServing && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 text-2xs px-2 gap-1"
                        onClick={(e) => { e.stopPropagation(); handleVirtualRemoveSelected(); }}
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove ({virtualSelectedFiles.size})
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="neutral"
                      className="h-6 text-2xs px-2 text-muted-foreground/60"
                      onClick={(e) => { e.stopPropagation(); setVirtualFiles([]); setVirtualSelectedFiles(new Set()); }}
                      disabled={virtualServing}
                    >
                      Clear All
                    </Button>
                    <Button
                      size="sm"
                      variant="neutral"
                      className="h-6 text-2xs px-2 text-muted-foreground/60 gap-1"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      <Plus className="h-3 w-3" />
                      Add More
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function fileIconForExt(name: string): { icon: typeof FileText; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "cfg": case "conf": case "ini": case "yaml": case "yml": case "xml": case "json": case "toml":
      return { icon: Settings, color: "text-warning/70" };
    case "bin": case "fw": case "img": case "rom": case "iso":
      return { icon: HardDrive, color: "text-primary/70" };
    case "log": case "txt":
      return { icon: FileText, color: "text-muted-foreground/60" };
    case "sh": case "bash": case "py": case "rb": case "pl":
      return { icon: Terminal, color: "text-success/70" };
    case "tar": case "gz": case "zip": case "tgz": case "bz2": case "xz": case "7z":
      return { icon: Package, color: "text-primary/70" };
    case "png": case "jpg": case "jpeg": case "gif": case "svg": case "ico": case "webp":
      return { icon: Image, color: "text-success/70" };
    case "pdf":
      return { icon: FilePdf, color: "text-destructive/70" };
    case "html": case "htm": case "css": case "js": case "ts": case "tsx": case "jsx":
      return { icon: Globe, color: "text-primary/70" };
    case "csv": case "tsv":
      return { icon: Table, color: "text-success/70" };
    case "wav": case "mp3": case "ogg": case "flac": case "aac":
      return { icon: MusicNote, color: "text-warning/70" };
    case "mp4": case "mkv": case "avi": case "mov": case "webm":
      return { icon: VideoCamera, color: "text-primary/70" };
    default:
      return { icon: File, color: "text-muted-foreground/60" };
  }
}

function FileRow({
  entry,
  selected,
  onSelect,
}: {
  entry: DirEntry;
  currentPath: string;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onNavigate: (path: string) => void;
}) {
  const { icon: FileIcon, color: iconColor } = entry.is_dir
    ? { icon: Folder, color: "text-primary/60" }
    : fileIconForExt(entry.name);

  return (
    <div
      className={cn(
        "flex items-center gap-0 px-2 py-0.5 hover:bg-muted/10 transition-smooth cursor-pointer group",
        selected && "bg-primary/5",
      )}
      onClick={onSelect}
    >
      <span className="w-5 shrink-0 flex items-center justify-center">
        <FileIcon className={cn("h-3.5 w-3.5", iconColor)} />
      </span>
      <span className="flex-1 min-w-0 px-1">
        <span className={cn(
          "text-xs truncate block",
          entry.is_dir
            ? "font-medium text-foreground/80 group-hover:text-primary transition-smooth"
            : "text-foreground/70",
        )}>
          {entry.name}
        </span>
      </span>
      <span className="w-20 text-right px-1 text-2xs font-mono text-muted-foreground/60 tabular-nums">
        {entry.is_dir ? "-" : formatBytes(entry.size)}
      </span>
      <span className="w-28 text-right px-1 text-2xs text-muted-foreground/60">
        {formatModTime(entry.mod_time)}
      </span>
      <span className="w-16 text-right px-2 text-2xs font-mono text-muted-foreground/60">
        {entry.mode}
      </span>
    </div>
  );
}

function SortableHeader({
  label,
  col,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  col: ExplorerSortColumn;
  sortDir: false | "asc" | "desc";
  onSort: (col: ExplorerSortColumn) => void;
  className?: string;
}) {
  return (
    <button
      className={cn("px-1 hover:text-foreground transition-smooth", className)}
      onClick={() => onSort(col)}
    >
      {label}
      {sortDir && (
        <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );
}


function formatRequestTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatModTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

