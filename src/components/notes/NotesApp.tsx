import { useState, useEffect, useMemo, useCallback } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useNoteStore } from "@/stores/noteStore";
import { useToolStore } from "@/stores/toolStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AppDropdown } from "@/components/ui/app-dropdown";
import {
  Plus,
  StickyNote,
  CheckSquare,
  Trash2,
  AlertCircle,
  Search,
  Filter,
  X,
  Tag,
  Star,
  Grid3x3,
  List,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { EmptyState } from "@/components/ui/empty-state";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS } from "@/lib/toolSubviewTabs";
import {
  NoteDndProvider,
  DraggableNoteCard,
} from "./dnd";
import { NoteDetailPanel } from "./NoteDetailPanel";
import { TemplateManager } from "./TemplateManager";
import { TrashView } from "./TrashView";

// ── Subview constants ────────────────────────────────────────────────

const SUBVIEW_NOTES = "notes";
const SUBVIEW_TEMPLATES = "templates";
const SUBVIEW_TRASH = "trash";

// ── Component ────────────────────────────────────────────────────────

interface NotesAppProps {
  linkedRegistrarId?: string | null;
}

const HOME_QUICK_NOTE_TITLE = "Home Quick Note";
const HOME_QUICK_NOTE_PROTECTED_TAG = "home-quick-note-protected";

function isProtectedHomeQuickNote(note: { title: string; tags: string[] }): boolean {
  if (note.tags?.includes(HOME_QUICK_NOTE_PROTECTED_TAG)) return true;
  return note.title === HOME_QUICK_NOTE_TITLE;
}

export function NotesApp({ linkedRegistrarId: initialLinkedRegistrarId }: NotesAppProps) {
  const notes = useNoteStore((s) => s.notes);
  const loading = useNoteStore((s) => s.loading);
  const error = useNoteStore((s) => s.error);
  const searchQuery = useNoteStore((s) => s.searchQuery);
  const selectedNoteId = useNoteStore((s) => s.selectedNoteId);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);
  const fetchAllNotes = useNoteStore((s) => s.fetchAllNotes);
  const getAllTags = useNoteStore((s) => s.getAllTags);
  const searchNotes = useNoteStore((s) => s.searchNotes);
  const setSearchQuery = useNoteStore((s) => s.setSearchQuery);
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const allTags = useNoteStore((s) => s.allTags);
  const clearError = useNoteStore((s) => s.clearError);

  const registrars = useRegistrationStore((s) => s.registrars);

  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeSubviewId = useToolStore((s) => s.activeSubviewId);
  const setActiveSubview = useToolStore((s) => s.setActiveSubview);
  const setLastViewedSubview = useToolStore((s) => s.setLastViewedSubview);

  const [activeTab, setActiveTab] = useState(SUBVIEW_NOTES);
  const [linkedRegistrarFilter, setLinkedRegistrarFilter] = useState<string | null>(initialLinkedRegistrarId ?? null);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortBy, setSortBy] = useState<"updated" | "created" | "title-asc" | "title-desc">("updated");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newNoteSeedTags, setNewNoteSeedTags] = useState<string[]>([]);

  useEffect(() => {
    fetchAllNotes();
    getAllTags();
  }, [fetchAllNotes, getAllTags]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim()) searchNotes(searchQuery);
      else fetchAllNotes();
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery, searchNotes, fetchAllNotes]);

  useEffect(() => {
    if (activeToolId !== "notes") return;
    if (!activeSubviewId) return;
    if ([SUBVIEW_NOTES, SUBVIEW_TEMPLATES, SUBVIEW_TRASH].includes(activeSubviewId)) {
      setActiveTab(activeSubviewId);
      setLastViewedSubview("notes", activeSubviewId);
    }
    setActiveSubview(null);
  }, [activeToolId, activeSubviewId, setActiveSubview, setLastViewedSubview]);

  useEffect(() => {
    setLastViewedSubview("notes", activeTab);
  }, [activeTab, setLastViewedSubview]);

  const filteredNotes = useMemo(() => {
    let list = [...notes];
    if (linkedRegistrarFilter) list = list.filter((n) => n.linkedRegistrarId === linkedRegistrarFilter);
    if (showPinnedOnly) list = list.filter((n) => n.isPinned);
    if (selectedTags.length > 0) list = list.filter((n) => selectedTags.every((t) => n.tags?.includes(t)));
    list.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      switch (sortBy) {
        case "created":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "title-asc":
          return (a.title || "").localeCompare(b.title || "");
        case "title-desc":
          return (b.title || "").localeCompare(a.title || "");
        case "updated":
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return list;
  }, [notes, linkedRegistrarFilter, showPinnedOnly, selectedTags, sortBy]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedTags.length > 0) count++;
    if (linkedRegistrarFilter) count++;
    if (showPinnedOnly) count++;
    return count;
  }, [selectedTags, linkedRegistrarFilter, showPinnedOnly]);

  const selectedNote = selectedNoteId ? notes.find((n) => n.id === selectedNoteId) : null;

  const availableTags = useMemo(() => {
    const uniqueTags = new Set<string>([...allTags, ...newNoteSeedTags]);
    return Array.from(uniqueTags).sort((a, b) => a.localeCompare(b));
  }, [allTags, newNoteSeedTags]);

  const handleNewNote = useCallback(async () => {
    setCreating(true);
    try {
      const id = await createNote(
        "Untitled", "", newNoteSeedTags, linkedRegistrarFilter || undefined,
        undefined, undefined, false, undefined, undefined
      );
      setSelectedNoteId(id);
      setOpenInEditMode(true);
      if (newNoteSeedTags.length > 0) {
        setNewNoteSeedTags([]);
      }
    } finally {
      setCreating(false);
    }
  }, [createNote, newNoteSeedTags, linkedRegistrarFilter, setSelectedNoteId]);

  const handleDeleted = useCallback(() => setSelectedNoteId(null), [setSelectedNoteId]);

  const handleEdit = useCallback((id: string) => {
    setOpenInEditMode(true);
    setSelectedNoteId(id);
  }, [setSelectedNoteId]);

  const handleMoveNoteToFolder = useCallback(
    async (noteId: string, targetFolderId: string | null) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      await updateNote(note.id, note.title, note.content, note.tags, note.category, note.isPinned, undefined, targetFolderId ?? undefined, note.linkedRegistrarId, note.linkedAgentId);
      await fetchAllNotes();
    },
    [notes, updateNote, fetchAllNotes]
  );

  const handleAddTagToNote = useCallback(
    async (noteId: string, tag: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note || note.tags?.includes(tag)) return;
      await updateNote(note.id, note.title, note.content, [...(note.tags || []), tag], note.category, note.isPinned, undefined, note.folderId, note.linkedRegistrarId, note.linkedAgentId);
      await fetchAllNotes();
    },
    [notes, updateNote, fetchAllNotes]
  );

  const toggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(() => setBulkDeleteConfirm(true), []);

  const handleConfirmBulkDelete = useCallback(async () => {
    const protectedIds = new Set(
      notes
        .filter((n) => isProtectedHomeQuickNote(n))
        .map((n) => n.id),
    );
    for (const id of selectedIds) {
      if (protectedIds.has(id)) continue;
      await deleteNote(id);
    }
    if (selectedNoteId && selectedIds.has(selectedNoteId)) setSelectedNoteId(null);
    setSelectedIds(new Set());
    setSelectionMode(false);
    setBulkDeleteConfirm(false);
  }, [selectedIds, selectedNoteId, deleteNote, setSelectedNoteId, notes]);

  const toggleTagFilter = useCallback((tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }, []);

  const handleCreateTagInline = useCallback(() => {
    const trimmedTag = newTagName.trim();
    if (!trimmedTag) return;

    const tagAlreadyExists = availableTags.some((tag) => tag.toLowerCase() === trimmedTag.toLowerCase());
    if (!tagAlreadyExists) {
      setNewNoteSeedTags((prev) => [...prev, trimmedTag]);
    }
    setNewTagName("");
  }, [newTagName, availableTags]);

  const handleClearAllFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedTags([]);
    setLinkedRegistrarFilter(null);
    if (showPinnedOnly) setShowPinnedOnly(false);
  }, [setSearchQuery, showPinnedOnly]);

  useKeyboardShortcuts({
    "ctrl+n": (e) => { e.preventDefault(); handleNewNote(); },
    "ctrl+f": (e) => { e.preventDefault(); document.querySelector<HTMLInputElement>('input[data-notes-search]')?.focus(); },
    escape: (e) => {
      if (selectedNoteId) { e.preventDefault(); setSelectedNoteId(null); }
    },
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col gap-0 overflow-hidden">
        <ToolHeader
          toolId="notes"
          items={[
            { id: SUBVIEW_NOTES, label: "Notes" },
            { id: SUBVIEW_TEMPLATES, label: "Templates" },
            { id: SUBVIEW_TRASH, label: "Trash" },
          ]}
          value={activeTab}
          onValueChange={setActiveTab}
        />
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* ─── Notes tab ─── */}
          <TabsContent value={SUBVIEW_NOTES} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            {error && (
              <div className="flex-shrink-0 px-4 py-2 bg-destructive/10 text-destructive text-xs flex items-center justify-between gap-2 border-b border-border">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {error}
                </span>
                <Button variant="neutral" size="sm" className="h-6 text-2xs" onClick={clearError}>
                  Dismiss
                </Button>
              </div>
            )}

            <NoteDndProvider onMoveNoteToFolder={handleMoveNoteToFolder} onAddTagToNote={handleAddTagToNote}>
              <div className="notes-workbench flex-1 flex min-h-0 overflow-hidden">
                {/* Note list sidebar */}
                <div className="notes-rail w-[420px] max-w-[42vw] flex-shrink-0 border-r border-border/25 flex flex-col overflow-hidden">
                  <div className="notes-rail-header flex-shrink-0 px-3 py-2 border-b border-border/25 space-y-1.5">
                    {selectionMode ? (
                      <>
                        <div className="h-8 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground font-medium">
                            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select notes"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {selectedIds.size > 0 && (
                            <>
                              <TooltipWrapper title="Delete selected">
                                <Button variant="destructive" size="sm" className="h-8 text-xs gap-1.5" onClick={handleBulkDelete}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </Button>
                              </TooltipWrapper>
                            </>
                          )}
                          <Button variant="ghost" size="sm" className="h-8 text-xs ml-auto" onClick={() => { setSelectedIds(new Set()); setSelectionMode(false); }}>
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                            <Input
                              data-notes-search
                              placeholder="Search notes…"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="h-8 pl-8 pr-8 text-sm ui-control-shell"
                            />
                            {searchQuery && (
                              <TooltipWrapper title="Clear search">
                                <button
                                  onClick={() => setSearchQuery("")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-smooth h-7 w-7 inline-flex items-center justify-center"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </TooltipWrapper>
                            )}
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 flex-nowrap whitespace-nowrap overflow-hidden">
                            <Popover>
                              <TooltipWrapper
                                title="Filters"
                                description="Filter notes by pinned state, tags, or registrar."
                                delayDuration={0}
                              >
                                <span className="inline-flex">
                                  <PopoverTrigger asChild>
                                    <Button variant={activeFilterCount > 0 ? "primary" : "neutral"} size="icon" className="h-8 w-8 shrink-0 relative">
                                      <Filter className="h-3.5 w-3.5" />
                                      {activeFilterCount > 0 && (
                                        <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-medium tabular-nums">
                                          {activeFilterCount}
                                        </span>
                                      )}
                                    </Button>
                                  </PopoverTrigger>
                                </span>
                              </TooltipWrapper>
                              <PopoverContent align="start" className="w-72 p-3 space-y-3">
                              {/* Pinned toggle */}
                              <TooltipWrapper title={showPinnedOnly ? "Show all notes" : "Show pinned only"}>
                                <Button
                                  variant={showPinnedOnly ? "primary" : "neutral"}
                                  size="sm"
                                  className="w-full h-8 text-xs gap-1.5 justify-start"
                                  onClick={() => setShowPinnedOnly(!showPinnedOnly)}
                                >
                                  <Star className={cn("h-3.5 w-3.5", showPinnedOnly && "fill-current")} />
                                  Pinned only
                                </Button>
                              </TooltipWrapper>

                              {/* Tags filter */}
                              {availableTags.length > 0 && (
                                <div className="space-y-1.5">
                                  <TooltipWrapper title="Filter by tags">
                                    <span className="text-2xs font-medium text-muted-foreground flex items-center gap-1 cursor-help">
                                      <Tag className="h-3 w-3" />
                                      Tags
                                    </span>
                                  </TooltipWrapper>
                                  <div className="flex flex-wrap gap-1">
                                    {availableTags.map((tag) => {
                                      const isSelected = selectedTags.includes(tag);
                                      return (
                                        <Badge
                                          key={tag}
                                          variant="secondary"
                                          className={cn(
                                            "cursor-pointer text-[10px] h-8 px-2 transition-smooth",
                                            isSelected
                                              ? "bg-primary/10 text-primary border-primary/20"
                                              : "hover:bg-muted/40",
                                          )}
                                          onClick={() => toggleTagFilter(tag)}
                                        >
                                          {tag}
                                        </Badge>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div className="space-y-2 border-t border-border/40 pt-2">
                                <span className="text-2xs font-medium text-muted-foreground">Quick add tag</span>
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    value={newTagName}
                                    onChange={(e) => setNewTagName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleCreateTagInline();
                                      }
                                    }}
                                    placeholder="Tag for next new note"
                                    className="h-8 text-xs"
                                  />
                                  <Button
                                    size="sm"
                                    variant="neutral"
                                    className="h-8 px-2.5 text-xs shrink-0"
                                    disabled={!newTagName.trim()}
                                    onClick={handleCreateTagInline}
                                  >
                                    Add
                                  </Button>
                                </div>
                                {newNoteSeedTags.length > 0 && (
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex flex-wrap gap-1">
                                      {newNoteSeedTags.map((tag) => (
                                        <Badge key={tag} variant="secondary" className="h-6 px-2 text-[10px]">
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-2xs"
                                      onClick={() => setNewNoteSeedTags([])}
                                    >
                                      Clear
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {/* Registrar filter */}
                              {registrars.length > 0 && (
                                <div className="space-y-1">
                                  <TooltipWrapper title="Filter by registrar">
                                    <span className="text-2xs font-medium text-muted-foreground cursor-help">Registrar</span>
                                  </TooltipWrapper>
                                  <AppDropdown
                                    value={linkedRegistrarFilter ?? "__all__"}
                                    onValueChange={(v) => setLinkedRegistrarFilter(v === "__all__" ? null : v)}
                                    placeholder="All Registrars"
                                    className="h-8 text-sm"
                                    options={[
                                      { value: "__all__", label: "All Registrars" },
                                      ...registrars.map((r) => ({
                                        value: r.id ?? r.name,
                                        label: r.name,
                                      })),
                                    ]}
                                  />
                                </div>
                              )}

                              {/* Clear all */}
                              {(activeFilterCount > 0 || searchQuery.trim().length > 0) && (
                                <TooltipWrapper title="Clear all filters">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full h-8 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={handleClearAllFilters}
                                  >
                                    <X className="h-3.5 w-3.5 mr-1.5" />
                                    Clear all filters
                                  </Button>
                                </TooltipWrapper>
                              )}
                              </PopoverContent>
                            </Popover>
                            <div className="min-w-0 flex-1">
                              <TooltipWrapper title="Sort notes">
                                <span className="inline-flex w-full min-w-0">
                                  <AppDropdown
                                    value={sortBy}
                                    onValueChange={(v) => setSortBy(v as typeof sortBy)}
                                    className="h-8 w-full min-w-0 text-xs"
                                    options={[
                                      { value: "updated", label: "Recently updated" },
                                      { value: "created", label: "Recently created" },
                                      { value: "title-asc", label: "Title A-Z" },
                                      { value: "title-desc", label: "Title Z-A" },
                                    ]}
                                  />
                                </span>
                              </TooltipWrapper>
                            </div>

                            <div className="inline-flex items-center rounded-md border border-border/55 overflow-hidden shrink-0">
                              <TooltipWrapper title={viewMode === "list" ? "Grid view" : "List view"}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 border-r border-border/45"
                                  onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
                                >
                                  {viewMode === "list" ? <Grid3x3 className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
                                </Button>
                              </TooltipWrapper>

                              <TooltipWrapper
                                title="Select notes"
                                description="Enable multi-select mode for bulk move and delete actions."
                                delayDuration={0}
                              >
                                <span className="inline-flex">
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectionMode(true)}>
                                    <CheckSquare className="h-3.5 w-3.5" />
                                  </Button>
                                </span>
                              </TooltipWrapper>
                            </div>

                            <TooltipWrapper title="New note" description="Create a blank note (Ctrl+N).">
                              <Button
                                size="sm"
                                onClick={() => void handleNewNote()}
                                disabled={creating}
                                className="gap-1.5 h-8 shrink-0 min-w-[112px] justify-center px-3"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                New note
                              </Button>
                            </TooltipWrapper>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className={cn(
                    "flex-1 overflow-y-auto p-2 widget-scroll",
                    viewMode === "grid" ? "grid grid-cols-1 xl:grid-cols-2 gap-1.5" : "space-y-0.5"
                  )}>
                    {loading ? (
                      <div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>
                    ) : filteredNotes.length === 0 ? (
                      <EmptyState compact variant="inline" title={searchQuery ? "No notes found" : "No notes yet"} />
                    ) : (
                      <SortableContext items={filteredNotes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                        {filteredNotes.map((note) => (
                          <DraggableNoteCard
                            key={note.id}
                            note={note}
                            isSelected={selectionMode ? selectedIds.has(note.id) : selectedNoteId === note.id}
                            onClick={() => {
                              if (selectionMode) {
                                if (isProtectedHomeQuickNote(note)) return;
                                toggleSelect(note.id, !selectedIds.has(note.id));
                              }
                              else setSelectedNoteId(note.id);
                            }}
                            onDoubleClick={() => handleEdit(note.id)}
                          />
                        ))}
                      </SortableContext>
                    )}
                  </div>
                </div>

                {/* Detail panel */}
                <main className="notes-detail-pane flex-1 min-w-0 flex flex-col overflow-hidden">
                  {selectedNote ? (
                    <NoteDetailPanel
                      note={selectedNote}
                      onBack={() => setSelectedNoteId(null)}
                      onDeleted={handleDeleted}
                      initialEditMode={openInEditMode && selectedNoteId === selectedNote.id}
                      onConsumedEditMode={() => setOpenInEditMode(false)}
                    />
                  ) : (
                    <EmptyState
                      variant="inline"
                      icon={<StickyNote />}
                      title="Select a note"
                      description="Choose from the list or create a new one."
                      action={
                        <TooltipWrapper title="New note" description="Create a new note.">
                          <Button size="sm" variant="neutral" className="gap-1.5 h-8 px-3" onClick={handleNewNote} disabled={creating}>
                            <Plus className="h-3.5 w-3.5" />
                            New Note
                          </Button>
                        </TooltipWrapper>
                      }
                      className="px-8 py-16 lg:py-24"
                    />
                  )}
                </main>
              </div>
            </NoteDndProvider>
          </TabsContent>

          {/* ─── Templates tab ─── */}
          <TabsContent value={SUBVIEW_TEMPLATES} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <TemplateManager onNavigateToNote={(id) => { setSelectedNoteId(id); setActiveTab(SUBVIEW_NOTES); setOpenInEditMode(true); }} />
            </div>
          </TabsContent>

          {/* ─── Trash tab ─── */}
          <TabsContent value={SUBVIEW_TRASH} className={cn(TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS, "flex flex-col min-h-0 flex-1")}>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <TrashView />
            </div>
          </TabsContent>
        </div>

      </Tabs>

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={setBulkDeleteConfirm}
        title="Delete notes"
        description={`Delete ${selectedIds.size} note${selectedIds.size !== 1 ? "s" : ""}?`}
        onConfirm={handleConfirmBulkDelete}
        variant="destructive"
      />
    </div>
  );
}
