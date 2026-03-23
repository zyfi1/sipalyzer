import { useEffect, useMemo, useState, useRef, useCallback, type ReactNode } from "react";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useToolStore } from "@/stores/toolStore";
import { RegistrarList } from "./RegistrarList";
import { RegistrarEditor } from "./RegistrarEditor";
import { RegistrarDetailPanel } from "./RegistrarDetailPanel";
import { Server, Check, ChevronDown, ChevronUp, Edit, Layers, Loader2, Plus, RefreshCw, Trash2, X, Folder, FolderOpen } from "@/lib/icons";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AppDivider, PanelResizeHandle } from "@/components/ui/panel-chrome";
import { cn } from "@/lib/utils";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors, type DragStartEvent, type DragOverEvent, type DragEndEvent, type DragCancelEvent } from "@dnd-kit/core";

type StatusFilter = "registered" | "failed" | "unregistered" | "unknown";

const REG_MASTER_LIBRARY_MIN_PX = 132;
const REG_MASTER_REGISTRARS_MIN_PX = 148;
const REG_MASTER_LIBRARY_DEFAULT_PX = 268;
/** Match `PanelResizeHandle` horizontal `density="compact"` (see `.ui-resize-handle--horizontal.ui-resize-handle--density-compact`). */
const REG_MASTER_SPLIT_HANDLE_PX = 8;

export function RegistrationToolset() {
  const fetchRegistrars = useRegistrationStore((s) => s.fetchRegistrars);
  const registrars = useRegistrationStore((s) => s.registrars);
  const folders = useRegistrationStore((s) => s.folders);
  const testResults = useRegistrationStore((s) => s.testResults);
  const testSuites = useRegistrationStore((s) => s.testSuites);
  const selectedRegistrar = useRegistrationStore((s) => s.selectedRegistrar);
  const setSelectedRegistrar = useRegistrationStore((s) => s.setSelectedRegistrar);
  const switchRegistrationContext = useRegistrationStore((s) => s.switchRegistrationContext);
  const ecGlobalCtx = useExecutionContextStore((s) => s.context);
  const ecOverrides = useExecutionContextStore((s) => s.toolOverrides);
  const registrationCtx = useMemo(() => {
    return useExecutionContextStore.getState().resolvedContext("registration");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecGlobalCtx, ecOverrides]);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);
  const updateRegistrar = useRegistrationStore((s) => s.updateRegistrar);
  const createFolder = useRegistrationStore((s) => s.createFolder);
  const renameFolder = useRegistrationStore((s) => s.renameFolder);
  const deleteFolder = useRegistrationStore((s) => s.deleteFolder);
  const reorderFolders = useRegistrationStore((s) => s.reorderFolders);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRegistrarId, setSelectedRegistrarId] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ id: string; name: string } | null>(null);
  const [draggedRegistrarId, setDraggedRegistrarId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [isRegistrarDragActive, setIsRegistrarDragActive] = useState(false);
  const [libraryPaneHeightPx, setLibraryPaneHeightPx] = useState(REG_MASTER_LIBRARY_DEFAULT_PX);
  const [isLibraryRegistrarsResizing, setIsLibraryRegistrarsResizing] = useState(false);
  const libraryRegistrarsSplitRef = useRef<HTMLDivElement>(null);
  const libraryPaneHeightRef = useRef(libraryPaneHeightPx);
  const libraryResizeDragRef = useRef<{ startClientY: number; startHeight: number; pointerId: number } | null>(null);
  const libraryResizeCleanupRef = useRef<(() => void) | null>(null);
  const busy = useRef(false);

  libraryPaneHeightRef.current = libraryPaneHeightPx;

  const endLibraryRegistrarsResize = useCallback(() => {
    libraryResizeDragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setIsLibraryRegistrarsResizing(false);
  }, []);

  const handleLibraryRegistrarsResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      libraryResizeCleanupRef.current?.();

      const target = e.currentTarget;
      const pointerId = e.pointerId;
      target.setPointerCapture(pointerId);
      libraryResizeDragRef.current = {
        startClientY: e.clientY,
        startHeight: libraryPaneHeightRef.current,
        pointerId,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      setIsLibraryRegistrarsResizing(true);

      const onMove = (ev: PointerEvent) => {
        const session = libraryResizeDragRef.current;
        if (!session || ev.pointerId !== session.pointerId) return;
        const el = libraryRegistrarsSplitRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const minH = REG_MASTER_LIBRARY_MIN_PX;
        const maxH = Math.max(
          minH,
          rect.height - REG_MASTER_SPLIT_HANDLE_PX - REG_MASTER_REGISTRARS_MIN_PX,
        );
        const deltaY = ev.clientY - session.startClientY;
        const next = Math.min(maxH, Math.max(minH, session.startHeight + deltaY));
        libraryPaneHeightRef.current = next;
        setLibraryPaneHeightPx(next);
      };

      const cleanup = () => {
        if (!libraryResizeCleanupRef.current) return;
        libraryResizeCleanupRef.current = null;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUpOrCancel);
        document.removeEventListener("pointercancel", onUpOrCancel);
        target.removeEventListener("lostpointercapture", onLostCapture);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
        endLibraryRegistrarsResize();
      };

      const onUpOrCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
      };

      const onLostCapture = () => {
        cleanup();
      };

      libraryResizeCleanupRef.current = cleanup;

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUpOrCancel);
      document.addEventListener("pointercancel", onUpOrCancel);
      target.addEventListener("lostpointercapture", onLostCapture);
    },
    [endLibraryRegistrarsResize],
  );

  useEffect(() => {
    const onBlur = () => {
      libraryResizeCleanupRef.current?.();
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      libraryResizeCleanupRef.current?.();
    };
  }, []);

  const handleRefresh = async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      await Promise.all([fetchRegistrars(), new Promise((r) => setTimeout(r, 800))]);
    } finally { busy.current = false; setRefreshing(false); }
  };

  const deriveStatus = useCallback((id: string): StatusFilter => {
    const result = testResults[id];
    if (result) {
      if (result.unregistered === true) return "unregistered";
      return result.success ? "registered" : "failed";
    }
    const suite = testSuites[id];
    if (suite) {
      const basicTest = suite.tests.find((t) => t.test_type === "basic_registration");
      if (basicTest) {
        if (basicTest.result.unregistered === true) return "unregistered";
        return basicTest.result.success ? "registered" : "failed";
      }
      return suite.overall_success ? "registered" : "failed";
    }
    return "unknown";
  }, [testResults, testSuites]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { registered: 0, failed: 0, unregistered: 0, unknown: 0 };
    for (const r of registrars) {
      if (!r.id) continue;
      const s = deriveStatus(r.id);
      counts[s]++;
    }
    return counts;
  }, [registrars, deriveStatus]);

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of folders) counts[f.id] = 0;
    for (const r of registrars) {
      if (r.group && counts[r.group] !== undefined) counts[r.group] = (counts[r.group] ?? 0) + 1;
    }
    return counts;
  }, [registrars, folders]);

  const ungroupedCount = useMemo(() => registrars.filter((r) => !r.group).length, [registrars]);

  useEffect(() => { handleRefresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ctxKey =
    registrationCtx.type === "local"
      ? "local"
      : registrationCtx.agentId;
  useEffect(() => { switchRegistrationContext(registrationCtx); }, [ctxKey, switchRegistrationContext]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedRegistrarId && !registrars.find((r) => r.id === selectedRegistrarId)) {
      setSelectedRegistrarId(null);
    }
  }, [registrars, selectedRegistrarId]);

  useEffect(() => {
    if (!selectedRegistrar) return;
    const exists = registrars.some((r) => r.id === selectedRegistrar);
    if (!exists) return;
    setSelectedRegistrarId(selectedRegistrar);
    // Clear incoming deep-link selection after consuming it once.
    setSelectedRegistrar(null);
  }, [selectedRegistrar, registrars, setSelectedRegistrar]);

  const handleCreate = () => { setEditingId(null); setIsEditorOpen(true); };
  const handleEdit = (id: string) => { setEditingId(id); setIsEditorOpen(true); };
  const handleEditorClose = () => { setIsEditorOpen(false); setEditingId(null); };

  useEffect(() => {
    if (activeToolId !== "registration") return;
    if (activeSubviewId === "list") {
      setLastViewedSubview("registration", activeSubviewId);
      setActiveSubview(null);
    }
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview]);

  const handleStatusFilterClick = (s: StatusFilter) => {
    setStatusFilter(statusFilter === s ? null : s);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await createFolder(name);
    setNewFolderName("");
    setIsAddingFolder(false);
  };

  const startFolderEdit = (id: string, name: string) => {
    setEditingFolderId(id);
    setEditingFolderName(name);
  };

  const handleRenameFolder = async (id: string) => {
    const name = editingFolderName.trim();
    if (!name) return;
    await renameFolder(id, name);
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  const cancelFolderEdit = () => {
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  const handleMoveFolder = async (folderId: string, direction: "up" | "down") => {
    const ids = folders.map((f) => f.id);
    const index = ids.indexOf(folderId);
    if (index < 0) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ids.length) return;

    const next = [...ids];
    const temp = next[index];
    next[index] = next[targetIndex]!;
    next[targetIndex] = temp!;
    await reorderFolders(next);
  };

  const handleDropRegistrarToFolder = async (registrarId: string, targetFolderId: string | null) => {
    const registrar = registrars.find((r) => r.id === registrarId);
    if (!registrar || !registrar.id) return;
    const nextGroup = targetFolderId ?? undefined;
    if ((registrar.group ?? undefined) === nextGroup) return;
    await updateRegistrar(
      registrar.id,
      { ...registrar, group: nextGroup },
      undefined,
      { optimistic: true, refetch: false },
    );
  };

  const clearRegistrarDragState = useCallback(() => {
    setIsRegistrarDragActive(false);
    setDropTargetFolderId(null);
    setDraggedRegistrarId(null);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const handleRegistrarDragStart = useCallback((event: DragStartEvent) => {
    const type = event.active.data.current?.type;
    if (type !== "registrar") return;
    const registrarId = String(event.active.data.current?.registrarId ?? "").trim();
    if (!registrarId) return;
    setDraggedRegistrarId(registrarId);
    setIsRegistrarDragActive(true);
  }, []);

  const handleRegistrarDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id ? String(event.over.id) : "";
    if (!overId.startsWith("folder:")) {
      setDropTargetFolderId(null);
      return;
    }
    const folderToken = overId.slice("folder:".length);
    setDropTargetFolderId(folderToken);
  }, []);

  const handleRegistrarDragCancel = useCallback((_event: DragCancelEvent) => {
    clearRegistrarDragState();
  }, [clearRegistrarDragState]);

  const handleRegistrarDragEnd = useCallback((event: DragEndEvent) => {
    const type = event.active.data.current?.type;
    if (type !== "registrar") {
      clearRegistrarDragState();
      return;
    }
    const registrarId = String(event.active.data.current?.registrarId ?? "").trim();
    const overId = event.over?.id ? String(event.over.id) : "";
    if (!registrarId || !overId.startsWith("folder:")) {
      clearRegistrarDragState();
      return;
    }

    const folderToken = overId.slice("folder:".length);
    const targetFolderId = folderToken === "__ungrouped__" ? null : folderToken;
    void handleDropRegistrarToFolder(registrarId, targetFolderId).finally(() => {
      clearRegistrarDragState();
    });
  }, [clearRegistrarDragState, handleDropRegistrarToFolder]);

  const handleConfirmDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    await deleteFolder(deleteFolderTarget.id);
    setDeleteFolderTarget(null);
  };

  const activeFilterLabel = statusFilter
    ? { registered: "Registered", failed: "Failed", unregistered: "Idle", unknown: "Unknown" }[statusFilter]
    : folderFilter === "__ungrouped__"
      ? "Ungrouped"
      : folderFilter
        ? folders.find((f) => f.id === folderFilter)?.name ?? "Folder"
        : "All Registrars";

  const filteredRegistrars = useMemo(() => {
    let filtered = registrars;
    if (folderFilter === "__ungrouped__") filtered = registrars.filter((r) => !r.group);
    else if (folderFilter) filtered = registrars.filter((r) => r.group === folderFilter);
    if (statusFilter) filtered = filtered.filter((r) => {
      if (!r.id) return false;
      return deriveStatus(r.id) === statusFilter;
    });
    return filtered;
  }, [registrars, folderFilter, statusFilter, deriveStatus]);
  const filteredCount = filteredRegistrars.length;
  const draggedRegistrar = useMemo(
    () => (draggedRegistrarId ? registrars.find((r) => r.id === draggedRegistrarId) : undefined),
    [draggedRegistrarId, registrars],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <ToolHeader
        toolId="registration"
        execToolId="registration"
        items={[{ id: "list", label: "Registrars" }]}
        value="list"
        onValueChange={() => {}}
      />

      {/* Match packet monitor: tight inset, single shell, full-width split (no nested “card on card”). */}
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 pt-1">
        <div className="ui-panel-shell registration-tool-shell flex min-h-0 flex-1 flex-col overflow-hidden">
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleRegistrarDragStart}
            onDragOver={handleRegistrarDragOver}
            onDragEnd={handleRegistrarDragEnd}
            onDragCancel={handleRegistrarDragCancel}
          >
        <div className="flex min-h-0 flex-1 overflow-hidden bg-transparent">
          {/* ── Unified master column: filters + folders + registrars ── */}
          <aside className="flex min-w-0 w-[min(20rem,36vw)] max-w-[320px] shrink-0 flex-col overflow-hidden border-r border-[var(--ui-rule)] bg-[var(--ops-panel-bg)]">
            {/* Action bar */}
            <div className="flex h-13 shrink-0 items-center gap-2 border-b border-[var(--ui-rule)] bg-[var(--ops-panel-bg-elevated)] px-3">
              <TooltipWrapper entry={tooltips.regAddRegistrar}>
                <Button size="sm" onClick={handleCreate} className="gap-1.5 h-8">
                  <Plus className="h-3.5 w-3.5" />
                  New
                </Button>
              </TooltipWrapper>
              <span className="flex-1" />
              <TooltipWrapper entry={tooltips.regRefreshAll}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  className={cn("h-8 w-8 p-0", refreshing && "pointer-events-none")}
                >
                  {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </TooltipWrapper>
            </div>

            {/* Loading indicator */}
            {refreshing && (
              <div className="h-0.5 bg-primary/20 overflow-hidden shrink-0">
                <div className="h-full w-1/3 bg-primary rounded-full animate-[loading-bar_1.5s_var(--motion-ease-emphasis)_infinite]" />
              </div>
            )}

            <div
              ref={libraryRegistrarsSplitRef}
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-hidden",
                isLibraryRegistrarsResizing && "select-none",
              )}
            >
              <div
                className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden"
                style={{ height: libraryPaneHeightPx }}
              >
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
                <div className="px-2 pt-2">
                  <div className="flex items-center gap-2 px-1 pb-1.5">
                    <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Library</span>
                    <AppDivider orientation="horizontal" className="min-w-0 flex-1" />
                  </div>
                </div>

            {/* Status filters */}
            <div className="space-y-0.5 px-2 pb-2">
              <button
                type="button"
                onClick={() => { setStatusFilter(null); setFolderFilter(null); }}
                className={cn("nav-item w-full flex items-center gap-2", statusFilter === null && folderFilter === null ? "nav-item-active" : "nav-item-inactive")}
              >
                <Server className="h-4 w-4" />
                <span>All Registrars</span>
                <span className="ml-auto text-2xs text-muted-foreground">{registrars.length}</span>
              </button>
              {statusCounts.registered > 0 && (
                <button
                  type="button"
                  onClick={() => handleStatusFilterClick("registered")}
                  className={cn("nav-item w-full flex items-center gap-2", statusFilter === "registered" ? "nav-item-active" : "nav-item-inactive")}
                >
                  <span className="flex items-center justify-center w-4 h-4">
                    <span className="h-2 w-2 rounded-full bg-success shadow-sm shadow-success/40 status-online" />
                  </span>
                  <span>Registered</span>
                  <span className="ml-auto text-2xs text-muted-foreground">{statusCounts.registered}</span>
                </button>
              )}
              {statusCounts.failed > 0 && (
                <button
                  type="button"
                  onClick={() => handleStatusFilterClick("failed")}
                  className={cn("nav-item w-full flex items-center gap-2", statusFilter === "failed" ? "nav-item-active" : "nav-item-inactive")}
                >
                  <span className="flex items-center justify-center w-4 h-4">
                    <span className="h-2 w-2 rounded-full bg-destructive" />
                  </span>
                  <span>Failed</span>
                  <span className="ml-auto text-2xs text-muted-foreground">{statusCounts.failed}</span>
                </button>
              )}
              {statusCounts.unregistered > 0 && (
                <button
                  type="button"
                  onClick={() => handleStatusFilterClick("unregistered")}
                  className={cn("nav-item w-full flex items-center gap-2", statusFilter === "unregistered" ? "nav-item-active" : "nav-item-inactive")}
                >
                  <span className="flex items-center justify-center w-4 h-4">
                    <span className="h-2 w-2 rounded-full bg-warning status-warning" />
                  </span>
                  <span>Idle</span>
                  <span className="ml-auto text-2xs text-muted-foreground">{statusCounts.unregistered}</span>
                </button>
              )}
              {statusCounts.unknown > 0 && (
                <button
                  type="button"
                  onClick={() => handleStatusFilterClick("unknown")}
                  className={cn("nav-item w-full flex items-center gap-2", statusFilter === "unknown" ? "nav-item-active" : "nav-item-inactive")}
                >
                  <span className="flex items-center justify-center w-4 h-4">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  </span>
                  <span>Unknown</span>
                  <span className="ml-auto text-2xs text-muted-foreground">{statusCounts.unknown}</span>
                </button>
              )}
            </div>

                <div className="px-2 py-2">
                  <AppDivider orientation="horizontal" />
                </div>

            {/* Folders */}
            <div className="px-2 pb-2">
              <div className="flex items-center gap-2 px-1 mb-1.5">
                <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider flex-1">Folders</span>
                {!isAddingFolder && (
                  <TooltipWrapper title="Add folder">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsAddingFolder(true)}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                )}
              </div>

              {isAddingFolder && (
                <form
                  className="mb-1.5 flex items-center gap-1.5 rounded-md bg-[var(--ops-panel-bg-subtle)] px-2 py-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleCreateFolder();
                  }}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Folder name"
                    className="h-7 min-w-0 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setIsAddingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                  />
                  <Button type="submit" variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={!newFolderName.trim()}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => {
                      setIsAddingFolder(false);
                      setNewFolderName("");
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </form>
              )}

              <div className="space-y-0.5">
                <DroppableNavItem
                  droppableId="folder:__ungrouped__"
                  onClick={() => { setFolderFilter(folderFilter === "__ungrouped__" ? null : "__ungrouped__"); setStatusFilter(null); }}
                  className={cn(
                    "nav-item w-full flex items-center gap-2",
                    folderFilter === "__ungrouped__" ? "nav-item-active" : "nav-item-inactive",
                    dropTargetFolderId === "__ungrouped__" && "ring-1 ring-primary/55 bg-primary/10",
                    isRegistrarDragActive && "border border-dashed border-primary/40"
                  )}
                >
                  <Layers className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                  <span className="truncate">Ungrouped</span>
                  <span className="ml-auto text-2xs text-muted-foreground tabular-nums">{ungroupedCount}</span>
                </DroppableNavItem>

                {folders.length > 0 ? (
                  <>
                    {folders.map((f, index) => (
                      editingFolderId === f.id ? (
                        <form
                          key={f.id}
                          className="flex items-center gap-1.5 rounded-md bg-[var(--ops-panel-bg-subtle)] px-2 py-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleRenameFolder(f.id);
                          }}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <Input
                            autoFocus
                            value={editingFolderName}
                            onChange={(e) => setEditingFolderName(e.target.value)}
                            className="h-7 min-w-0 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                            onKeyDown={(e) => {
                              if (e.key === "Escape") cancelFolderEdit();
                            }}
                          />
                          <Button type="submit" variant="ghost" size="sm" className="h-6 w-6 p-0">
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={cancelFolderEdit}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </form>
                      ) : (
                        <DroppableNavItem
                          key={f.id}
                          droppableId={`folder:${f.id}`}
                          className={cn(
                            "nav-item w-full flex items-center gap-2 group",
                            folderFilter === f.id ? "nav-item-active" : "nav-item-inactive",
                            dropTargetFolderId === f.id && "ring-1 ring-primary/55 bg-primary/10"
                          )}
                          aria-label={`Folder ${f.name}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setFolderFilter(folderFilter === f.id ? null : f.id);
                              setStatusFilter(null);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            {folderFilter === f.id ? <FolderOpen className="h-4 w-4 text-primary" /> : <Folder className="h-4 w-4" />}
                            <span className="truncate">{f.name}</span>
                          </button>
                          <span className="text-2xs text-muted-foreground tabular-nums">{folderCounts[f.id] ?? 0}</span>
                          <div className="ml-1 flex items-center gap-0.5">
                            <TooltipWrapper title="Move folder up">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled={index === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleMoveFolder(f.id, "up");
                                }}
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                            </TooltipWrapper>
                            <TooltipWrapper title="Move folder down">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled={index >= folders.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleMoveFolder(f.id, "down");
                                }}
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </TooltipWrapper>
                            <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
                              <TooltipWrapper title="Rename folder">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startFolderEdit(f.id, f.name);
                                  }}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                              </TooltipWrapper>
                              <TooltipWrapper title="Delete folder">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-destructive hover:bg-destructive/15 hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteFolderTarget({ id: f.id, name: f.name });
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TooltipWrapper>
                            </div>
                          </div>
                        </DroppableNavItem>
                      )
                    ))}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAddingFolder(true)}
                    className="nav-item nav-item-inactive w-full text-left text-2xs"
                  >
                    No custom folders — click to create
                  </button>
                )}
              </div>
            </div>
                </div>
              </div>
              <TooltipWrapper
                title="Resize panes"
                description="Drag to split library and registrars. Double-click to reset height."
              >
                <PanelResizeHandle
                  orientation="horizontal"
                  density="compact"
                  appearance="rail"
                  label="Resize library section and registrar list height"
                  className="w-full shrink-0 rounded-none"
                  onPointerDown={handleLibraryRegistrarsResizePointerDown}
                  onDoubleClick={() => setLibraryPaneHeightPx(REG_MASTER_LIBRARY_DEFAULT_PX)}
                />
              </TooltipWrapper>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--ui-rule)] bg-[var(--ops-panel-bg-elevated)] px-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{activeFilterLabel}</span>
                  <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{filteredCount}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--ops-panel-bg-subtle)]">
                  <RegistrarList
                    selectedId={selectedRegistrarId}
                    onSelectId={setSelectedRegistrarId}
                    folderFilter={folderFilter}
                    statusFilter={statusFilter}
                  />
                </div>
              </div>
            </div>
          </aside>

          {/* ── Right pane — detail ── */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {selectedRegistrarId ? (
              <RegistrarDetailPanel
                registrarId={selectedRegistrarId}
                onEdit={handleEdit}
              />
            ) : (
              <EmptyState compact variant="inline" icon={<Server />} title="Select a registrar" className="flex-1" />
            )}
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "ease" }}>
          {draggedRegistrar ? (
            <div className="w-[260px] rounded-md border border-border/50 bg-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
              <div className="truncate text-[13px] font-medium text-foreground">{draggedRegistrar.name}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground/70">
                {draggedRegistrar.username}@{draggedRegistrar.domain}
              </div>
            </div>
          ) : null}
        </DragOverlay>
          </DndContext>
        </div>
      </div>

      {isEditorOpen && <RegistrarEditor registrarId={editingId} onClose={handleEditorClose} />}
      <ConfirmDialog
        open={!!deleteFolderTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteFolderTarget(null);
        }}
        title="Delete Folder"
        description={
          deleteFolderTarget
            ? `Delete "${deleteFolderTarget.name}"? ${(folderCounts[deleteFolderTarget.id] ?? 0)} registrar${(folderCounts[deleteFolderTarget.id] ?? 0) !== 1 ? "s" : ""} in this folder will be moved to Ungrouped.`
            : ""
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleConfirmDeleteFolder}
      />
    </div>
  );
}

interface DroppableNavItemProps {
  droppableId: string;
  className?: string;
  ariaLabel?: string;
  onClick?: () => void;
  children: ReactNode;
}

function DroppableNavItem({
  droppableId,
  className,
  ariaLabel,
  onClick,
  children,
}: DroppableNavItemProps) {
  const { setNodeRef } = useDroppable({
    id: droppableId,
    data: { type: "folder-drop-zone" },
  });

  return (
    <div
      ref={setNodeRef}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      className={className}
    >
      {children}
    </div>
  );
}
