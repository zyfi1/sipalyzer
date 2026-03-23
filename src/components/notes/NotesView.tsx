import { useState, useEffect, useMemo } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { NoteCard } from "./NoteCard";
import { NoteEditorModal } from "./NoteEditorModal";
import { NoteView } from "./NoteView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Plus, Search, X, Grid3x3, List, Star, StickyNote } from "@/lib/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

const HOME_QUICK_NOTE_TITLE = "Home Quick Note";
const HOME_QUICK_NOTE_PROTECTED_TAG = "home-quick-note-protected";

function isProtectedHomeQuickNote(note: { title: string; tags: string[] }): boolean {
  if (note.tags?.includes(HOME_QUICK_NOTE_PROTECTED_TAG)) return true;
  return note.title === HOME_QUICK_NOTE_TITLE;
}

export function NotesView() {
  const notes = useNoteStore((s) => s.notes);
  const searchQuery = useNoteStore((s) => s.searchQuery);
  const selectedTags = useNoteStore((s) => s.selectedTags);
  const loading = useNoteStore((s) => s.loading);
  const allTags = useNoteStore((s) => s.allTags);
  const fetchAllNotes = useNoteStore((s) => s.fetchAllNotes);
  const searchNotes = useNoteStore((s) => s.searchNotes);
  const setSearchQuery = useNoteStore((s) => s.setSearchQuery);
  const setSelectedTags = useNoteStore((s) => s.setSelectedTags);
  const getAllTags = useNoteStore((s) => s.getAllTags);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);
  const selectedNoteId = useNoteStore((s) => s.selectedNoteId);
  const registrars = useRegistrationStore((s) => s.registrars);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | undefined>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"updated" | "created" | "title">("updated");

  useEffect(() => { fetchAllNotes(); getAllTags(); }, [fetchAllNotes, getAllTags]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim()) searchNotes(searchQuery);
      else fetchAllNotes();
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery, searchNotes, fetchAllNotes]);

  const handleSearch = (query: string) => setSearchQuery(query);

  const handleTagToggle = (tag: string) => {
    if (selectedTags.includes(tag)) setSelectedTags(selectedTags.filter((t) => t !== tag));
    else setSelectedTags([...selectedTags, tag]);
  };

  const handleDelete = (id: string) => { setNoteToDelete(id); setDeleteConfirmOpen(true); };

  const handleConfirmDelete = async () => {
    if (noteToDelete) { await deleteNote(noteToDelete); setDeleteConfirmOpen(false); setNoteToDelete(null); }
  };

  const handleEdit = (id: string) => { setEditingNoteId(id); setEditorOpen(true); };
  const handleCreate = () => { setEditingNoteId(undefined); setEditorOpen(true); };

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    notes.forEach(note => { if (note.category) cats.add(note.category); });
    return Array.from(cats).sort();
  }, [notes]);

  const filteredNotes = useMemo(() => {
    let filtered = notes.filter((note) => {
      if (activeTab === "pinned" && !note.isPinned) return false;
      if (activeTab !== "all" && activeTab !== "pinned" && note.category !== activeTab) return false;
      if (selectedTags.length > 0 && !selectedTags.some((tag) => note.tags.includes(tag))) return false;
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      switch (sortBy) {
        case "title": return a.title.localeCompare(b.title);
        case "created": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return filtered;
  }, [notes, activeTab, selectedTags, sortBy]);

  const getRegistrarName = (registrarId?: string) => {
    if (!registrarId) return undefined;
    return registrars.find((r) => r.id === registrarId)?.name;
  };

  useKeyboardShortcuts({
    "ctrl+n": (e) => { e.preventDefault(); handleCreate(); },
    "ctrl+f": (e) => { e.preventDefault(); document.querySelector<HTMLInputElement>('input[data-notesview-search]')?.focus(); },
    "escape": (e) => { if (selectedNoteId) { e.preventDefault(); setSelectedNoteId(null); } },
  });

  if (selectedNoteId) {
    const note = notes.find((n) => n.id === selectedNoteId);
    if (note) {
      return (
        <NoteView
          note={note}
          registrarName={getRegistrarName(note.linkedRegistrarId)}
          onBack={() => setSelectedNoteId(null)}
          onEdit={() => handleEdit(note.id)}
          onDelete={isProtectedHomeQuickNote(note) ? undefined : () => handleDelete(note.id)}
        />
      );
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <header className="ui-section-header-md flex-shrink-0 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <StickyNote className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-sm font-semibold">Notes</h1>
          </div>
          <div className="flex-1" />
          <TooltipWrapper title="New Note" description="Create a new note (Ctrl+N).">
            <Button onClick={handleCreate} size="sm" className="gap-1.5 h-8">
              <Plus className="h-3.5 w-3.5" />
              New Note
            </Button>
          </TooltipWrapper>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 space-y-4">
        {/* Search + controls */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              data-notesview-search
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-8 h-8 text-sm ui-control-shell"
            />
            {searchQuery && (
              <TooltipWrapper title="Clear search">
                <button onClick={() => handleSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </TooltipWrapper>
            )}
          </div>
          <TooltipWrapper title="Sort notes">
            <AppDropdown
              value={sortBy}
              onValueChange={(v) => setSortBy(v as typeof sortBy)}
              className="w-[140px] h-8 text-xs"
              options={[
                { value: "updated", label: "Recently Updated" },
                { value: "created", label: "Recently Created" },
                { value: "title", label: "Title (A-Z)" },
              ]}
            />
          </TooltipWrapper>
          <TooltipWrapper title={viewMode === "grid" ? "List view" : "Grid view"}>
            <Button variant="neutral" size="sm" onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")} className="h-8 w-8 p-0">
              {viewMode === "grid" ? <List className="h-4 w-4" /> : <Grid3x3 className="h-4 w-4" />}
            </Button>
          </TooltipWrapper>
        </div>

        {/* Tags filter */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mr-1">Tags</span>
            {allTags.map((tag) => (
              <Badge
                key={tag}
                variant={selectedTags.includes(tag) ? "default" : "secondary"}
                className="text-[10px] h-5 cursor-pointer"
                onClick={() => handleTagToggle(tag)}
              >
                {tag}
              </Badge>
            ))}
            {selectedTags.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedTags([])} className="h-5 text-[10px] px-1.5">
                Clear
              </Button>
            )}
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto">
            <TabsList className="subview-tabs-compact">
              <TooltipWrapper title="Show all notes">
                <TabsTrigger value="all" className="subview-tab-compact">All ({notes.length})</TabsTrigger>
              </TooltipWrapper>
              <TooltipWrapper title="Show pinned notes">
                <TabsTrigger value="pinned" className="subview-tab-compact">
                  <Star className="h-3 w-3" />
                  Pinned ({notes.filter((n) => n.isPinned).length})
                </TabsTrigger>
              </TooltipWrapper>
              {allCategories.map((category) => (
                <TooltipWrapper key={category} title={`Show ${category} notes`}>
                  <TabsTrigger value={category} className="subview-tab-compact">
                    {category} ({notes.filter((n) => n.category === category).length})
                  </TabsTrigger>
                </TooltipWrapper>
              ))}
            </TabsList>
          </div>

          <TabsContent value={activeTab} className="mt-4">
            {loading ? (
              <div className="text-center py-8 text-sm text-muted-foreground">Loading notes...</div>
            ) : filteredNotes.length === 0 ? (
              <EmptyState
                compact
                variant="inline"
                icon={<StickyNote />}
                title={searchQuery || selectedTags.length > 0 ? "No notes match your filters" : "No notes yet"}
                description={!searchQuery && selectedTags.length === 0 ? "Create your first note to get started." : undefined}
                action={
                  !searchQuery && selectedTags.length === 0 ? (
                    <TooltipWrapper title="Create note" description="Create your first note.">
                      <Button size="sm" variant="neutral" className="gap-1.5" onClick={handleCreate}>
                        <Plus className="h-3.5 w-3.5" />
                        Create Note
                      </Button>
                    </TooltipWrapper>
                  ) : undefined
                }
              />
            ) : (
              <div className={cn(
                "gap-3",
                viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "flex flex-col"
              )}>
                {filteredNotes.map((note) => (
                  <div key={note.id} onClick={() => setSelectedNoteId(note.id)}>
                    <NoteCard
                      note={note}
                      onEdit={handleEdit}
                      onDelete={isProtectedHomeQuickNote(note) ? undefined : handleDelete}
                      registrarName={getRegistrarName(note.linkedRegistrarId)}
                    />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <NoteEditorModal
        isOpen={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingNoteId(undefined); }}
        noteId={editingNoteId}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Note"
        description="Are you sure? This action cannot be undone."
        onConfirm={handleConfirmDelete}
        variant="destructive"
      />
    </div>
  );
}
