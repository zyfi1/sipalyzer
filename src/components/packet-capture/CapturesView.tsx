import { useEffect, useState, useCallback, useMemo, createContext, useContext } from "react";
import {
  DndContext,
  DragOverlay as DndDragOverlay,
  pointerWithin,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useOpenCaptureStore } from "@/hooks/useOpenCapture";
import { navigateTo } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Clock,
  Download,
  Upload,
  Eye,
  Trash2,
  Trash,
  FileText,
  Square,
  FolderOpen,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Edit,
  Check,
  X,
  Network,
  Tag,
  Plus,
  MoreVertical,
  Search,
  Hash,
  GripVertical,
} from "@/lib/icons";
import { useNotifications } from "@/hooks/useNotifications";
import type { CaptureSession, CaptureFolder } from "@/types/packetCapture";
import { importPcap, importPcapFromPath, getPendingFileOpen } from "@/api/packetCapture";
import { ExportDialog } from "./monitor/ExportDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { formatDateTime } from "@/lib/dateTime";
import { LiveIndicator, liveRingClass } from "@/components/ui/live-indicator";
import { Spinner } from "@/components/ui/spinner";

/* ═══════════════════════════════ DnD context ══════════════════════════════ */

interface CaptureDndState {
  activeSession: CaptureSession | null;
  dragOverFolderId: string | null;       // folder.id or "all-captures"
}

const CaptureDndCtx = createContext<CaptureDndState>({
  activeSession: null,
  dragOverFolderId: null,
});

function useCaptureDnd() {
  return useContext(CaptureDndCtx);
}

/* ═══════════════════════════════════════════════════════════════════════════ */

export function CapturesView() {
  type SortKey = "custom" | "name" | "modified" | "packets" | "source";
  type SortDir = "asc" | "desc";
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const loadingSessions = usePacketCaptureStore((s) => s.loadingSessions);
  const activeSessionId = usePacketCaptureStore((s) => s.activeSessionId);
  const fetchSessions = usePacketCaptureStore((s) => s.fetchSessions);
  const stopCapture = usePacketCaptureStore((s) => s.stopCapture);
  const deleteSession = usePacketCaptureStore((s) => s.deleteSession);
  const renameSession = usePacketCaptureStore((s) => s.renameSession);
  const captureFolders = usePacketCaptureStore((s) => s.captureFolders);
  const fetchCaptureFolders = usePacketCaptureStore((s) => s.fetchCaptureFolders);
  const createCaptureFolder = usePacketCaptureStore((s) => s.createCaptureFolder);
  const renameCaptureFolder = usePacketCaptureStore((s) => s.renameCaptureFolder);
  const deleteCaptureFolder = usePacketCaptureStore((s) => s.deleteCaptureFolder);
  const selectedFolderId = usePacketCaptureStore((s) => s.selectedFolderId);
  const setSelectedFolderId = usePacketCaptureStore((s) => s.setSelectedFolderId);
  const selectedTags = usePacketCaptureStore((s) => s.selectedTags);
  const toggleTagFilter = usePacketCaptureStore((s) => s.toggleTagFilter);
  const clearTagFilters = usePacketCaptureStore((s) => s.clearTagFilters);
  const updateSessionFolder = usePacketCaptureStore((s) => s.updateSessionFolder);
  const updateSessionTags = usePacketCaptureStore((s) => s.updateSessionTags);
  const deleteAllSessions = usePacketCaptureStore((s) => s.deleteAllSessions);
  const { notify } = useNotifications();

  // UI state
  const [exportSession, setExportSession] = useState<CaptureSession | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmStopDeleteAllRunning, setConfirmStopDeleteAllRunning] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Folder sidebar state
  const [newFolderName, setNewFolderName] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);

  // DnD state
  const [dndActiveSession, setDndActiveSession] = useState<CaptureSession | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [sessionOrder, setSessionOrder] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("custom");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const sess = event.active.data.current?.session as CaptureSession | undefined;
    if (sess) setDndActiveSession(sess);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) { setDragOverFolderId(null); return; }
    const type = over.data.current?.type;
    if (type === "folder-drop-zone") {
      setDragOverFolderId(String(over.id));
    } else {
      setDragOverFolderId(null);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setDndActiveSession(null);
    setDragOverFolderId(null);

    if (!over) return;
    const overType = over.data.current?.type;
    if (overType === "session-drop-zone") {
      const activeId = String(active.id);
      const overId = String(over.id).replace(/^session-drop-/, "");
      if (activeId === overId) return;
      setSortKey("custom");
      setSessionOrder((prev) => {
        const oldIndex = prev.indexOf(activeId);
        const newIndex = prev.indexOf(overId);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(oldIndex, 1);
        if (!moved) return prev;
        next.splice(newIndex, 0, moved);
        return next;
      });
      return;
    }
    if (overType !== "folder-drop-zone") return;

    const sessionId = String(active.id);
    const targetId = String(over.id);
    // "all-captures" → don't change, folder.id → that folder
    if (targetId === "all-captures") return;
    const folderId = targetId;
    updateSessionFolder(sessionId, folderId);
    notify({ source: "packet-capture", type: "success", title: "Moved", description: `Moved to ${captureFolders.find((f) => f.id === folderId)?.name ?? "folder"}` });
  }, [updateSessionFolder, notify, captureFolders]);

  const handleDragCancel = useCallback(() => {
    setDndActiveSession(null);
    setDragOverFolderId(null);
  }, []);

  useEffect(() => {
    setSessionOrder((prev) => {
      const next = prev.filter((id) => sessions.some((s) => s.id === id));
      for (const s of sessions) {
        if (!next.includes(s.id)) next.push(s.id);
      }
      return next;
    });
  }, [sessions]);

  /* ── File import (native drag from OS) ── */
  const handleImportPcap = useCallback(async () => {
    setImporting(true);
    try {
      const sessionId = await importPcap();
      notify({ source: "packet-capture", type: "success", title: "Import Successful", description: "PCAP file imported." });
      await fetchSessions();
      openInViewerTab(sessionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("cancelled")) notify({ source: "packet-capture", type: "error", title: "Import Failed", description: msg });
    } finally { setImporting(false); }
  }, [fetchSessions, notify]);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setFileDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const pcap = files.filter((f) => /\.(pcap|pcapng|cap)$/i.test(f.name));
    if (!pcap.length) { notify({ source: "packet-capture", type: "error", title: "Invalid File", description: "Only .pcap/.pcapng/.cap files." }); return; }
    setImporting(true);
    try {
      for (const file of pcap) {
        const fp = (file as any).path as string | undefined;
        if (fp) { const sid = await importPcapFromPath(fp); await fetchSessions(); openInViewerTab(sid); }
      }
      notify({ source: "packet-capture", type: "success", title: "Imported", description: `${pcap.length} file(s) imported.` });
    } catch (e) { notify({ source: "packet-capture", type: "error", title: "Import Failed", description: e instanceof Error ? e.message : String(e) }); }
    finally { setImporting(false); }
  }, [fetchSessions, notify]);

  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    // Only respond to native file drags, not dnd-kit drags
    if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); setFileDragOver(true); }
  }, []);
  const handleFileDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setFileDragOver(false); }, []);

  const openInViewerTab = useCallback((sessionId: string) => {
    useOpenCaptureStore.getState().openViewer(sessionId);
    navigateTo("packet-capture", "viewer");
  }, []);

  useEffect(() => { fetchSessions(); fetchCaptureFolders(); }, [fetchSessions, fetchCaptureFolders]);

  // Legacy cleanup: previous builds allowed selecting an "unfiled" pseudo-folder via empty string.
  // Normalize this state to "All Captures" now that that UI option is removed.
  useEffect(() => {
    if (selectedFolderId === "") {
      setSelectedFolderId(null);
    }
  }, [selectedFolderId, setSelectedFolderId]);

  // File association auto-import
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const paths = await getPendingFileOpen();
        if (cancelled || !paths.length) return;
        for (const fp of paths) {
          try { const sid = await importPcapFromPath(fp); notify({ source: "packet-capture", type: "success", title: "File Opened", description: fp.split("/").pop() ?? fp }); await fetchSessions(); openInViewerTab(sid); }
          catch (e) { notify({ source: "packet-capture", type: "error", title: "Open Failed", description: e instanceof Error ? e.message : String(e) }); }
        }
      } catch { /* unavailable */ }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Derived data ── */
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const sess of sessions) for (const t of sess.tags ?? []) s.add(t);
    return Array.from(s).sort();
  }, [sessions]);

  const folderCounts = useMemo(() => {
    const perFolder: Record<string, number> = {};
    for (const s of sessions) {
      if (s.folderId) perFolder[s.folderId] = (perFolder[s.folderId] ?? 0) + 1;
    }
    return { all: sessions.length, perFolder };
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    let list = [...sessions];
    if (selectedFolderId) list = list.filter((s) => s.folderId === selectedFolderId);
    if (selectedTags.length > 0) list = list.filter((s) => selectedTags.some((t) => (s.tags ?? []).includes(t)));
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((s) => s.name.toLowerCase().includes(q) || (s.tags ?? []).some((t) => t.toLowerCase().includes(q)) || s.description?.toLowerCase().includes(q));
    return list;
  }, [sessions, selectedFolderId, selectedTags, searchQuery]);

  const orderSessions = useCallback((list: CaptureSession[]) => {
    if (sortKey !== "custom") {
      const sorted = [...list].sort((a, b) => {
        const cmp = (() => {
          if (sortKey === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          if (sortKey === "modified") return a.startTime.localeCompare(b.startTime);
          if (sortKey === "packets") return (a.packetCount ?? 0) - (b.packetCount ?? 0);
          const aSrc = a.source?.type === "remote"
            ? `remote:${a.source?.host ?? ""}`
            : a.interface === "imported"
              ? "imported"
              : (a.interface ?? "local");
          const bSrc = b.source?.type === "remote"
            ? `remote:${b.source?.host ?? ""}`
            : b.interface === "imported"
              ? "imported"
              : (b.interface ?? "local");
          return aSrc.localeCompare(bSrc, undefined, { sensitivity: "base" });
        })();
        return sortDir === "asc" ? cmp : -cmp;
      });
      return sorted;
    }
    const rank = new Map(sessionOrder.map((id, idx) => [id, idx]));
    return [...list].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [sessionOrder, sortKey, sortDir]);

  const handleSort = useCallback((key: Exclude<SortKey, "custom">) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "name" || key === "source" ? "asc" : "desc");
      return key;
    });
  }, []);

  const runningSessions = orderSessions(filteredSessions.filter((s) => s.status === "Running"));
  const stoppedSessions = orderSessions(filteredSessions.filter((s) => s.status !== "Running"));

  /* ── Handlers ── */
  const toggleSection = (section: string) => setCollapsedSections((prev) => { const n = new Set(prev); n.has(section) ? n.delete(section) : n.add(section); return n; });
  const handleStop = async (id: string) => { try { await stopCapture(id); notify({ source: "packet-capture", type: "success", title: "Stopped" }); } catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Stop failed", description: e.message }); } };
  const handleViewInViewer = useCallback((id: string) => openInViewerTab(id), [openInViewerTab]);

  const handleDelete = async (id: string) => {
    try { setDeletingId(id); await deleteSession(id); notify({ source: "packet-capture", type: "success", title: "Deleted" }); }
    catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Delete failed", description: e.message }); }
    finally { setDeletingId(null); setConfirmDeleteId(null); }
  };
  const handleDeleteAll = async () => {
    try { setDeletingId("all"); const r = await deleteAllSessions("stopped"); notify({ source: "packet-capture", type: "success", title: "Deleted", description: `${r.deleted} session(s)` }); await fetchSessions(); }
    catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Failed", description: e.message }); }
    finally { setDeletingId(null); setConfirmDeleteAll(false); }
  };
  const handleStopDeleteAll = async () => {
    try { setDeletingId("all-running"); for (const s of runningSessions) { try { await stopCapture(s.id); } catch {} try { await deleteSession(s.id); } catch {} } await fetchSessions(); notify({ source: "packet-capture", type: "success", title: "Cleared" }); }
    catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Failed", description: e.message }); }
    finally { setDeletingId(null); setConfirmStopDeleteAllRunning(false); }
  };

  const startEditing = (s: CaptureSession) => { setEditingId(s.id); setEditName(s.name); };
  const cancelEditing = () => { setEditingId(null); setEditName(""); };
  const saveEdit = async (id: string) => { if (!editName.trim()) { cancelEditing(); return; } await renameSession(id, editName.trim()); cancelEditing(); };

  const handleAddFolder = async () => {
    const n = newFolderName.trim(); if (!n) { setAddingFolder(false); return; }
    try { await createCaptureFolder(n); setNewFolderName(""); setAddingFolder(false); }
    catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Failed", description: e.message }); }
  };
  const handleRenameFolder = async (id: string) => {
    const n = editFolderName.trim(); if (!n) { setEditingFolderId(null); return; }
    try { await renameCaptureFolder(id, n); setEditingFolderId(null); setEditFolderName(""); }
    catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Failed", description: e.message }); }
  };
  const handleDeleteFolder = async (id: string) => {
    try { await deleteCaptureFolder(id); notify({ source: "packet-capture", type: "success", title: "Folder deleted" }); }
    catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Failed", description: e.message }); }
    finally { setConfirmDeleteFolderId(null); }
  };

  /* ── Loading ── */
  if (loadingSessions) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground gap-2">
        <Spinner className="h-4 w-4" />
        <span>Loading captures...</span>
      </div>
    );
  }

  const hasAny = sessions.length > 0;
  const currentFolderLabel = selectedFolderId === null ? "All Captures" : captureFolders.find((f) => f.id === selectedFolderId)?.name ?? "Captures";
  const isDndActive = dndActiveSession !== null;
  /* ═══════════════════════════════════ RENDER ══════════════════════════════ */
  return (
    <CaptureDndCtx.Provider value={{ activeSession: dndActiveSession, dragOverFolderId }}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="h-full min-h-0 app-view-gutter">
          <div className="ui-panel-shell h-full min-h-0 flex flex-col overflow-hidden">
            <div className="ui-section-header-md flex-none">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-foreground">{currentFolderLabel}</h2>
                <Badge variant="secondary" className="text-2xs tabular-nums">{filteredSessions.length}</Badge>
                <div className="flex-1" />
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search captures..."
                    className="ui-control-shell h-8 w-44 pl-8 pr-7 text-xs focus-visible:ring-1 focus-visible:ring-primary/30" />
                  {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}
                </div>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleImportPcap} disabled={importing}>
                  <Upload className="h-3.5 w-3.5" />{importing ? "Importing..." : "Import PCAP"}
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 app-view-stack">
              {!hasAny ? (
                <div className="h-full flex flex-col relative" onDrop={handleFileDrop} onDragOver={handleFileDragOver} onDragLeave={handleFileDragLeave}>
                  {fileDragOver && <FileDragOverlay />}
                  <EmptyState variant="inline" icon={<FolderOpen />} title="No capture sessions" description="Import a PCAP file or start a capture to get started."
                    action={<Button size="sm" variant="neutral" className="h-8 gap-1.5 px-3 text-xs" onClick={handleImportPcap} disabled={importing}><Upload className="h-3.5 w-3.5" />{importing ? "Importing..." : "Import PCAP"}</Button>} />
                </div>
              ) : (
                <div className="h-full flex min-h-0 overflow-hidden">
                  {/* ─── Sidebar ─── */}
                  <aside className={cn("w-60 flex-shrink-0 flex flex-col overflow-hidden border-r border-border/35 bg-background/30 transition-smooth", isDndActive && "bg-muted/10")}>
                    {/* Sidebar header */}
                    <div className="ui-section-header-sm flex-shrink-0 flex items-center justify-between">
                      <span className="section-label-sm">
                        {isDndActive ? "Drop on a folder" : "Folders"}
                      </span>
                      {!isDndActive && (
                        <TooltipWrapper content="New folder">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setAddingFolder(true)}>
                            <FolderPlus className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipWrapper>
                      )}
                    </div>

                    {/* Nav items (droppable) */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                      <DroppableFolderItem droppableId="all-captures" icon={<FolderOpen className="h-4 w-4" />} label="All Captures"
                        count={folderCounts.all} active={selectedFolderId === null} onClick={() => setSelectedFolderId(null)} />

                      {captureFolders.length > 0 && <div className="h-px bg-border my-2" />}

                      {captureFolders.map((f) =>
                        editingFolderId === f.id ? (
                          <InlineInput key={f.id} value={editFolderName} onChange={setEditFolderName}
                            onConfirm={() => handleRenameFolder(f.id)} onCancel={() => setEditingFolderId(null)} autoFocus />
                        ) : (
                          <DroppableFolderItem key={f.id} droppableId={f.id} icon={<Folder className="h-4 w-4" />} label={f.name}
                            count={folderCounts.perFolder[f.id] ?? 0} active={selectedFolderId === f.id} onClick={() => setSelectedFolderId(f.id)}
                            onRename={() => { setEditingFolderId(f.id); setEditFolderName(f.name); }}
                            onDelete={() => setConfirmDeleteFolderId(f.id)} />
                        )
                      )}

                      {addingFolder && (
                        <InlineInput value={newFolderName} onChange={setNewFolderName}
                          onConfirm={handleAddFolder} onCancel={() => { setAddingFolder(false); setNewFolderName(""); }}
                          placeholder="Folder name..." autoFocus />
                      )}
                    </div>

                    {/* Tag filter */}
                    {allTags.length > 0 && !isDndActive && (
                      <div className="flex-shrink-0 border-t border-border/20 p-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="section-label-sm">Tags</span>
                          {selectedTags.length > 0 && (
                            <button onClick={clearTagFilters} className="text-2xs text-muted-foreground hover:text-foreground transition-smooth">Clear</button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {allTags.map((tag) => (
                            <Badge key={tag} variant={selectedTags.includes(tag) ? "default" : "outline"}
                              className={cn("text-2xs h-5 px-1.5 cursor-pointer transition-smooth", selectedTags.includes(tag) && "bg-accent text-foreground")}
                              onClick={() => toggleTagFilter(tag)}>
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </aside>

                  {/* ─── Content ─── */}
                  <div className="flex-1 flex flex-col min-h-0 min-w-0 relative" onDrop={handleFileDrop} onDragOver={handleFileDragOver} onDragLeave={handleFileDragLeave}>
                    {fileDragOver && <FileDragOverlay />}

                    {/* Session list */}
                    <div className="flex-1 overflow-y-auto">
                      {/* Running */}
                      <SectionHeader label="Running" icon={<LiveIndicator variant="dot" size="md" />}
                        count={runningSessions.length} collapsed={collapsedSections.has("running")} onToggle={() => toggleSection("running")}
                        action={runningSessions.length > 0 ? <TooltipWrapper content="Stop & delete all"><Button size="sm" variant="destructive" className="h-6 w-6 p-0" onClick={() => setConfirmStopDeleteAllRunning(true)}><Trash className="h-3 w-3" /></Button></TooltipWrapper> : undefined} />
                      {!collapsedSections.has("running") && (
                        <div className="px-2 py-1">
                          <CaptureListHeader sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                          {runningSessions.length === 0
                            ? <EmptyState compact variant="inline" title="No captures running" />
                            : runningSessions.map((s) => (
                              <DraggableSessionCard key={s.id} session={s} isRunning isActive={activeSessionId === s.id}
                                editingId={editingId} editName={editName} deletingId={deletingId} folders={captureFolders} allTags={allTags}
                                showFolder={selectedFolderId === null}
                                onEditChange={setEditName} onStartEdit={startEditing} onSaveEdit={saveEdit} onCancelEdit={cancelEditing}
                                onView={() => handleViewInViewer(s.id)} onStop={() => handleStop(s.id)} onExport={setExportSession} onDelete={setConfirmDeleteId}
                                onUpdateFolder={(fid) => updateSessionFolder(s.id, fid)} onUpdateTags={(tags) => updateSessionTags(s.id, tags)} />
                            ))}
                        </div>
                      )}

                      {/* Saved */}
                      <SectionHeader label="Saved" icon={<Clock className="h-3.5 w-3.5" />}
                        count={stoppedSessions.length} collapsed={collapsedSections.has("saved")} onToggle={() => toggleSection("saved")}
                        action={stoppedSessions.length > 0 ? <TooltipWrapper entry={tooltips.captureDeleteAll}><Button size="sm" variant="destructive" className="h-6 w-6 p-0" onClick={() => setConfirmDeleteAll(true)} disabled={deletingId === "all"}><Trash className="h-3 w-3" /></Button></TooltipWrapper> : undefined} />
                      {!collapsedSections.has("saved") && (
                        <div className="px-2 py-1">
                          <CaptureListHeader sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                          {stoppedSessions.length === 0
                            ? <EmptyState compact variant="inline" title="No saved captures" description="Completed captures appear here." />
                            : stoppedSessions.map((s) => (
                              <DraggableSessionCard key={s.id} session={s} isRunning={false} isActive={false}
                                editingId={editingId} editName={editName} deletingId={deletingId} folders={captureFolders} allTags={allTags}
                                showFolder={selectedFolderId === null}
                                onEditChange={setEditName} onStartEdit={startEditing} onSaveEdit={saveEdit} onCancelEdit={cancelEditing}
                                onView={() => handleViewInViewer(s.id)} onExport={setExportSession} onDelete={setConfirmDeleteId}
                                onUpdateFolder={(fid) => updateSessionFolder(s.id, fid)} onUpdateTags={(tags) => updateSessionTags(s.id, tags)} />
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── Drag overlay (floating preview while dragging) ─── */}
        <DndDragOverlay dropAnimation={{ duration: 200, easing: "ease" }} modifiers={[snapCenterToCursor]}>
          {dndActiveSession && <SessionDragPreview session={dndActiveSession} />}
        </DndDragOverlay>

        {/* Dialogs */}
        {exportSession && <ExportDialog open onOpenChange={(o) => !o && setExportSession(null)} packets={[]} sessionId={exportSession.id} />}
        {confirmDeleteId && <ConfirmDialog open onOpenChange={(o) => !o && setConfirmDeleteId(null)} title="Delete Session" description="This cannot be undone." confirmText="Delete" variant="destructive" onConfirm={() => handleDelete(confirmDeleteId)} />}
        <ConfirmDialog open={confirmDeleteAll} onOpenChange={setConfirmDeleteAll} title="Delete All Saved" description={`Delete ${stoppedSessions.length} saved session(s)? Cannot be undone.`} confirmText="Delete All" variant="destructive" onConfirm={handleDeleteAll} />
        <ConfirmDialog open={confirmStopDeleteAllRunning} onOpenChange={setConfirmStopDeleteAllRunning} title="Stop & Delete Running" description={`Stop and delete ${runningSessions.length} running capture(s)?`} confirmText="Stop & Delete All" variant="destructive" onConfirm={handleStopDeleteAll} />
        {confirmDeleteFolderId && <ConfirmDialog open onOpenChange={(o) => !o && setConfirmDeleteFolderId(null)} title="Delete Folder" description="Sessions will be kept and shown under All Captures." confirmText="Delete Folder" variant="destructive" onConfirm={() => handleDeleteFolder(confirmDeleteFolderId)} />}
      </DndContext>
    </CaptureDndCtx.Provider>
  );
}

/* ═══════════════════════════════ Sub-components ════════════════════════════ */

/** File import overlay (from OS drag) */
function FileDragOverlay() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-md bg-background/60 pointer-events-none">
      <div className="flex flex-col items-center gap-2 rounded-md border border-border/50 bg-card/50 px-6 py-5 text-foreground">
        <Upload className="h-10 w-10 text-muted-foreground" />
        <span className="text-sm font-medium">Drop PCAP to import</span>
      </div>
    </div>
  );
}

/** Floating preview card shown while dragging a session */
function SessionDragPreview({ session }: { session: CaptureSession }) {
  return (
    <div className="max-w-xs rounded-md border border-border/55 bg-card/50 p-3 pointer-events-none">
      <div className="text-sm font-semibold truncate">{session.name}</div>
      <div className="text-2xs text-muted-foreground mt-0.5 flex items-center gap-2">
        <span>{session.packetCount.toLocaleString()} pkts</span>
        {(session.tags ?? []).length > 0 && <span>· {(session.tags ?? []).join(", ")}</span>}
      </div>
    </div>
  );
}

/* ─── Droppable folder item in sidebar ─── */
function DroppableFolderItem({ droppableId, icon, label, count, active, onClick, onRename, onDelete }: {
  droppableId: string; icon: React.ReactNode; label: string; count: number; active: boolean;
  onClick: () => void; onRename?: () => void; onDelete?: () => void;
}) {
  const { activeSession, dragOverFolderId } = useCaptureDnd();
  const isDndActive = activeSession !== null;
  const isDropTarget = dragOverFolderId === droppableId && isDndActive;

  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: "folder-drop-zone" },
  });

  const showHighlight = isDropTarget || isOver;

  return (
    <button type="button" ref={setNodeRef} onClick={onClick}
      className={cn(
        "nav-item group flex items-center gap-2.5 w-full transition-smooth",
        active && !showHighlight ? "nav-item-active" : "nav-item-inactive",
        showHighlight && "bg-primary/15 ring-2 ring-primary/40 ring-inset text-foreground scale-[1.02]",
        isDndActive && !showHighlight && "opacity-60",
      )}>
      <span className={cn("shrink-0", showHighlight ? "text-primary" : "text-muted-foreground")}>{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      <span className="text-2xs tabular-nums opacity-60">{count}</span>
      {!isDndActive && (onRename || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <span className="h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent shrink-0">
              <MoreVertical className="h-3 w-3" />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            {onRename && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(); }}><Edit className="h-3 w-3 mr-2" />Rename</DropdownMenuItem>}
            {onDelete && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-destructive"><Trash2 className="h-3 w-3 mr-2" />Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </button>
  );
}

/* ─── Inline input (folder create/rename) ─── */
function InlineInput({ value, onChange, onConfirm, onCancel, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; onConfirm: () => void; onCancel: () => void; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 px-1">
      <Input value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); if (e.key === "Escape") onCancel(); }}
        placeholder={placeholder} className="h-7 text-xs flex-1" autoFocus={autoFocus} />
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onConfirm}><Check className="h-3 w-3" /></Button>
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onCancel}><X className="h-3 w-3" /></Button>
    </div>
  );
}

/* ─── Section header ─── */
function SectionHeader({ label, icon, count, collapsed, onToggle, action }: {
  label: string; icon: React.ReactNode; count: number; collapsed: boolean; onToggle: () => void; action?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center border-y border-border/25 bg-background/85 backdrop-blur-sm">
      <button type="button" onClick={onToggle}
        className="flex-1 flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-smooth">
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {icon}
        <span>{label}</span>
        <span className="rounded-sm border border-border/40 px-1.5 py-0 text-2xs tabular-nums opacity-70">{count}</span>
      </button>
      {action && <div className="mr-2">{action}</div>}
    </div>
  );
}

/* ═══════════════════════════ Draggable Session Card ═══════════════════════ */

interface SessionCardProps {
  session: CaptureSession; isRunning: boolean; isActive: boolean;
  editingId: string | null; editName: string; deletingId: string | null;
  folders: CaptureFolder[]; allTags: string[]; showFolder: boolean;
  onEditChange: (v: string) => void; onStartEdit: (s: CaptureSession) => void; onSaveEdit: (id: string) => void; onCancelEdit: () => void;
  onView: () => void; onStop?: () => void; onExport: (s: CaptureSession) => void; onDelete: (id: string) => void;
  onUpdateFolder: (fid: string | null) => void; onUpdateTags: (tags: string[]) => void;
}

function DraggableSessionCard(props: SessionCardProps) {
  const { session } = props;
  const { attributes, listeners, setNodeRef: setDragNodeRef, isDragging } = useDraggable({
    id: session.id,
    data: { type: "session", session },
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `session-drop-${session.id}`,
    data: { type: "session-drop-zone", sessionId: session.id },
  });

  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    setDragNodeRef(node);
    setDropNodeRef(node);
  }, [setDragNodeRef, setDropNodeRef]);

  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40 scale-[0.98]", "transition-smooth")}>
      <SessionCardInner {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function CaptureListHeader({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: "custom" | "name" | "modified" | "packets" | "source";
  sortDir: "asc" | "desc";
  onSort: (key: "name" | "modified" | "packets" | "source") => void;
}) {
  const SortLabel = ({
    label,
    field,
    alignRight,
  }: {
    label: string;
    field: "name" | "modified" | "packets" | "source";
    alignRight?: boolean;
  }) => (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent/35",
        alignRight && "ml-auto"
      )}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="text-[9px] opacity-70">
        {sortKey === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  return (
    <div className="grid grid-cols-[minmax(220px,1fr)_140px_90px_95px_170px] items-center gap-2 border-b border-border/20 px-2 py-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground/80">
      <SortLabel label="Name" field="name" />
      <SortLabel label="Modified" field="modified" />
      <SortLabel label="Packets" field="packets" />
      <SortLabel label="Source" field="source" />
      <span className="text-right pr-1">Actions</span>
    </div>
  );
}

function SessionCardInner({
  session, isRunning, isActive, editingId, editName, deletingId, folders, allTags, showFolder,
  onEditChange, onStartEdit, onSaveEdit, onCancelEdit, onView, onStop, onExport, onDelete, onUpdateFolder, onUpdateTags,
  dragHandleProps,
}: SessionCardProps & { dragHandleProps: Record<string, any> }) {
  const [tagInput, setTagInput] = useState("");
  const tags = session.tags ?? [];
  const folderName = folders.find((f) => f.id === session.folderId)?.name;

  const addTag = (t: string) => { const tag = t.trim().toLowerCase(); if (tag && !tags.includes(tag)) onUpdateTags([...tags, tag]); setTagInput(""); };
  const removeTag = (t: string) => onUpdateTags(tags.filter((x) => x !== t));
  const suggestions = allTags.filter((t) => !tags.includes(t));

  return (
    <div className={cn(
      "ui-data-row group relative bg-transparent transition-smooth",
      isRunning && liveRingClass,
      isActive && "bg-accent/15",
    )}>
      <div className="relative px-2 py-2.5">
        <div className="grid grid-cols-[minmax(220px,1fr)_140px_90px_95px_170px] items-start gap-2">
          {/* Left: Name + meta */}
          <div className="min-w-0">
            {/* Name row */}
            <div className="flex items-center gap-1.5">
              <TooltipWrapper content="Drag to reorder">
                <div
                  {...dragHandleProps}
                  className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing opacity-20 group-hover:opacity-70 transition-opacity touch-none"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                </div>
              </TooltipWrapper>
              {editingId === session.id ? (
                <div className="flex items-center gap-1 flex-1">
                  <Input value={editName} onChange={(e) => onEditChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(session.id); if (e.key === "Escape") onCancelEdit(); }}
                    className="h-6 text-xs" autoFocus />
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onSaveEdit(session.id)}><Check className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onCancelEdit}><X className="h-3 w-3" /></Button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={session.name}>
                      {session.name}
                    </span>
                    {showFolder && folderName && (
                      <Badge variant="outline" className="h-4 shrink-0 px-1.5 py-0 text-2xs max-w-[40%]">
                        <Folder className="mr-0.5 h-2 w-2 shrink-0" />
                        <span className="truncate">{folderName}</span>
                      </Badge>
                    )}
                  </div>
                  <button onClick={() => onStartEdit(session)}
                    className="h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent shrink-0">
                    <Edit className="h-2.5 w-2.5 text-muted-foreground" />
                  </button>
                </>
              )}
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-2xs h-[18px] px-1.5 gap-0.5 font-normal">
                    <Hash className="h-2.5 w-2.5 opacity-50" />{tag}
                    <button onClick={(e) => { e.stopPropagation(); removeTag(tag); }} className="ml-0.5 opacity-50 hover:opacity-100 hover:text-destructive transition-smooth"><X className="h-2.5 w-2.5" /></button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Modified */}
          <div className="pt-1 text-2xs text-muted-foreground tabular-nums whitespace-nowrap">
            <span className="block truncate" title={formatDateTime(session.startTime, { dateStyle: "short", timeStyle: "short" })}>
              {formatDateTime(session.startTime, { dateStyle: "short", timeStyle: "short" })}
            </span>
          </div>

          {/* Packets */}
          <div className="pt-1 text-2xs tabular-nums text-foreground/90 whitespace-nowrap">
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3 text-muted-foreground" />
              {session.packetCount.toLocaleString()}
            </span>
          </div>

          {/* Source */}
          <div className="pt-1 text-2xs text-muted-foreground whitespace-nowrap">
            {session.source?.type === "remote"
              ? `Remote${session.source.host ? ` @ ${session.source.host}` : ""}`
              : session.interface === "imported"
                ? "Imported"
                : (isRunning ? session.interface : "Local")}
            {isRunning && <span className="ml-1 inline-flex items-center gap-1"><Network className="h-3 w-3" /></span>}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center justify-end gap-1 shrink-0 pt-0.5">
            <Button size="sm" variant="neutral" className="h-8 text-xs gap-1 px-2.5" onClick={onView}>
              <Eye className="h-3 w-3" />Open
            </Button>

            {isRunning && onStop && (
              <TooltipWrapper entry={tooltips.captureStop}>
                <Button size="sm" variant="destructive" className="h-8 w-8 p-0" onClick={onStop}><Square className="h-3.5 w-3.5" /></Button>
              </TooltipWrapper>
            )}

            {/* Tag editor */}
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><Tag className="h-3.5 w-3.5" /></Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-3" align="end">
                <div className="space-y-2.5">
                  <span className="section-label-sm">Manage Tags</span>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-2xs h-5 px-1.5 gap-1">
                          {tag}
                          <button onClick={() => removeTag(tag)} className="opacity-50 hover:opacity-100 hover:text-destructive transition-smooth"><X className="h-2.5 w-2.5" /></button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) addTag(tagInput); }}
                      placeholder="Add tag..." className="h-7 text-xs flex-1" />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!tagInput.trim()} onClick={() => addTag(tagInput)}><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1 border-t border-border/20">
                      <span className="text-3xs text-muted-foreground w-full mb-0.5">Suggestions</span>
                      {suggestions.slice(0, 8).map((t) => (
                        <Badge key={t} variant="outline" className="text-2xs h-5 px-1.5 cursor-pointer hover:bg-accent transition-smooth" onClick={() => addTag(t)}>
                          <Plus className="h-2 w-2 mr-0.5" />{t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* More actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><MoreVertical className="h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><Folder className="h-3.5 w-3.5 mr-2" />Move to folder</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-40">
                    {folders.map((f) => (
                      <DropdownMenuItem key={f.id} onClick={() => onUpdateFolder(f.id)}>
                        <Folder className="h-3.5 w-3.5 mr-2" />{f.name}
                        {session.folderId === f.id && <Check className="h-3 w-3 ml-auto opacity-50" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onExport(session)}><Download className="h-3.5 w-3.5 mr-2" />Export PCAP</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(session.id)} className="text-destructive" disabled={deletingId === session.id}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
