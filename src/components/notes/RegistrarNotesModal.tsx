import { useState, useEffect, useCallback } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { NoteEditorModal } from "./NoteEditorModal";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Plus, StickyNote, Edit, Trash2, Star, ArrowLeft, Search, ExternalLink } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { useLayoutStore } from "@/stores/layoutStore";
import type { Note } from "@/types/notes";

function getCategoryColor(cat?: string): string {
  if (!cat) return "bg-muted/50 border border-border text-muted-foreground";
  const lower = cat.toLowerCase();
  if (lower.includes("important") || lower.includes("urgent")) return "bg-destructive/10 border border-destructive/20 text-destructive";
  if (lower.includes("todo") || lower.includes("task")) return "bg-warning/10 border border-warning/20 text-warning";
  if (lower.includes("reference") || lower.includes("doc")) return "bg-primary/10 border border-primary/20 text-primary";
  if (lower.includes("personal") || lower.includes("idea")) return "bg-success/10 border border-success/20 text-success";
  return "bg-muted/50 border border-border text-muted-foreground";
}

interface RegistrarNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  registrarId: string;
}

export function RegistrarNotesModal({ isOpen, onClose, registrarId }: RegistrarNotesModalProps) {
  const notes = useNoteStore((s) => s.notes);
  const loading = useNoteStore((s) => s.loading);
  const fetchNotes = useNoteStore((s) => s.fetchNotes);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const registrars = useRegistrationStore((s) => s.registrars);
  const setNotesCenterOpen = useLayoutStore((s) => s.setNotesCenterOpen);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | undefined>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [search, setSearch] = useState("");

  const registrar = registrars.find((r) => r.id === registrarId);
  const registrarNotes = notes;

  // Filter by search
  const filteredNotes = search.trim()
    ? registrarNotes.filter((n) =>
        n.title.toLowerCase().includes(search.toLowerCase()) ||
        n.content.toLowerCase().includes(search.toLowerCase())
      )
    : registrarNotes;

  // Sort: pinned first, then by updated date
  const sortedNotes = [...filteredNotes].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  useEffect(() => {
    if (isOpen && registrarId) fetchNotes(registrarId, undefined);
  }, [isOpen, registrarId, fetchNotes]);

  useEffect(() => {
    if (!editorOpen && isOpen && registrarId) fetchNotes(registrarId, undefined);
  }, [editorOpen, isOpen, registrarId, fetchNotes]);

  useEffect(() => {
    if (!isOpen) { setViewingNote(null); setSearch(""); }
  }, [isOpen]);

  const handleDelete = (id: string) => { setNoteToDelete(id); setDeleteConfirmOpen(true); };

  const handleConfirmDelete = useCallback(async () => {
    if (!noteToDelete) return;
    await deleteNote(noteToDelete);
    setDeleteConfirmOpen(false);
    if (viewingNote?.id === noteToDelete) setViewingNote(null);
    setNoteToDelete(null);
    if (registrarId) fetchNotes(registrarId, undefined);
  }, [noteToDelete, deleteNote, viewingNote, registrarId, fetchNotes]);

  const handleEdit = (id: string) => { setEditingNoteId(id); setEditorOpen(true); };
  const handleCreate = () => { setEditingNoteId(undefined); setEditorOpen(true); };
  const handleOpenFull = () => { onClose(); setNotesCenterOpen(true); };

  const formatDate = (dateString: string) => {
    try {
      const d = new Date(dateString);
      return isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");
    } catch { return "—"; }
  };

  // --------------------------------------------------------------------------
  // Note detail view (read-only preview within the modal)
  // --------------------------------------------------------------------------
  if (viewingNote) {
    return (
      <>
        <Dialog open={isOpen} onOpenChange={onClose}>
          <DialogContent className="max-w-3xl max-h-[calc(min(100vh,100dvh)-2rem)] overflow-hidden flex flex-col p-0">
            <div className="flex items-center gap-2 px-4 py-3 bg-card border-b border-border/55">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={() => setViewingNote(null)}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold truncate">{viewingNote.title}</h2>
              </div>
              <TooltipWrapper title="Edit" description="Open the full editor for this note.">
                <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={() => handleEdit(viewingNote.id)}>
                  <Edit className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </TooltipWrapper>
              <TooltipWrapper title="Delete" description="Delete this note.">
                <Button variant="destructive" size="sm" className="h-7 gap-1.5" onClick={() => handleDelete(viewingNote.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipWrapper>
            </div>
            {/* Metadata */}
            <div className="px-4 py-2 border-b border-border/55 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              {viewingNote.isPinned && (
                <Badge variant="default" className="gap-1 text-2xs h-5">
                  <Star className="h-3 w-3 fill-current text-warning" />
                  Pinned
                </Badge>
              )}
              {viewingNote.category && (
                <Badge variant="secondary" className={cn("text-2xs h-5", getCategoryColor(viewingNote.category))}>{viewingNote.category}</Badge>
              )}
              {viewingNote.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-2xs h-5">{tag}</Badge>
              ))}
              <span className="ml-auto text-2xs text-muted-foreground/50 tabular-nums">Updated {formatDate(viewingNote.updatedAt)}</span>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              <div className="prose prose-invert max-w-none">
                <MarkdownRenderer content={viewingNote.content} />
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <NoteEditorModal
          isOpen={editorOpen}
          onClose={() => { setEditorOpen(false); setEditingNoteId(undefined); }}
          noteId={editingNoteId}
          linkedRegistrarId={registrarId}
        />
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title="Delete Note"
          description="Are you sure? This action cannot be undone."
          onConfirm={handleConfirmDelete}
          variant="destructive"
        />
      </>
    );
  }

  // --------------------------------------------------------------------------
  // Note list (main modal view)
  // --------------------------------------------------------------------------
  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[calc(min(100vh,100dvh)-2rem)] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <DialogHeader className="px-4 pt-4 pb-3 pr-12 bg-card border-b border-border/55">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-base font-semibold">
                  {registrar?.name || "Registrar"} — Notes
                </DialogTitle>
                {sortedNotes.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {sortedNotes.length} note{sortedNotes.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <TooltipWrapper title="Open Notes app" description="Open the full Notes view.">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleOpenFull}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper title="New Note" description="Create a new note for this registrar.">
                  <Button onClick={handleCreate} size="sm" className="gap-1.5 h-7">
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </Button>
                </TooltipWrapper>
              </div>
            </div>
            {/* Search */}
            {registrarNotes.length > 3 && (
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search notes..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm ui-control-shell"
                />
              </div>
            )}
          </DialogHeader>

          {/* Body */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center min-h-[300px]">
                <span className="text-sm text-muted-foreground">Loading notes...</span>
              </div>
            ) : sortedNotes.length === 0 ? (
              <EmptyState
                variant="inline"
                icon={<StickyNote />}
                title={search ? "No notes match your search" : "No notes yet"}
                description={search ? "Try different keywords." : "Create your first note for this registrar."}
                action={
                  !search ? (
                    <Button size="sm" variant="neutral" className="gap-1.5" onClick={handleCreate}>
                      <Plus className="h-3.5 w-3.5" />
                      Create Note
                    </Button>
                  ) : undefined
                }
                className="min-h-[300px]"
              />
            ) : (
              <div className="space-y-1.5 p-2">
                {sortedNotes.map((note) => (
                  <RegistrarNoteRow
                    key={note.id}
                    note={note}
                    onClick={() => setViewingNote(note)}
                    onEdit={() => handleEdit(note.id)}
                    onDelete={() => handleDelete(note.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <NoteEditorModal
        isOpen={editorOpen}
        onClose={async () => {
          setEditorOpen(false);
          setEditingNoteId(undefined);
          if (registrarId) setTimeout(() => fetchNotes(registrarId, undefined), 100);
        }}
        noteId={editingNoteId}
        linkedRegistrarId={registrarId}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Note"
        description="Are you sure? This action cannot be undone."
        onConfirm={handleConfirmDelete}
        variant="destructive"
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

interface RegistrarNoteRowProps {
  note: Note;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function RegistrarNoteRow({ note, onClick, onEdit, onDelete }: RegistrarNoteRowProps) {
  const preview = note.content
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n+/g, " ")
    .slice(0, 120);

  return (
    <div
      className="group flex items-start gap-3 px-4 py-3 rounded-md bg-card border border-border/55 hover:bg-accent/30 cursor-pointer transition-smooth"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {note.isPinned && <Star className="h-3 w-3 text-warning fill-current shrink-0" />}
          <span className="text-sm font-medium truncate">{note.title || "Untitled"}</span>
          {note.category && (
            <Badge variant="secondary" className={cn("text-2xs h-4 px-1.5 shrink-0", getCategoryColor(note.category))}>{note.category}</Badge>
          )}
        </div>
        {preview && (
          <p className="text-2xs text-muted-foreground/70 line-clamp-2 mt-0.5">{preview}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1.5">
          {note.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-2xs h-4 px-1">{tag}</Badge>
          ))}
          {note.tags.length > 3 && (
            <span className="text-2xs text-muted-foreground">+{note.tags.length - 3}</span>
          )}
          <span className="text-2xs text-muted-foreground/50 tabular-nums ml-auto shrink-0">
            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
          </span>
        </div>
      </div>
      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-smooth shrink-0 mt-1" onClick={(e) => e.stopPropagation()}>
        <TooltipWrapper title="Edit">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}>
            <Edit className="h-3.5 w-3.5" />
          </Button>
        </TooltipWrapper>
        <TooltipWrapper title="Delete">
          <Button variant="destructive" size="sm" className="h-7 w-7 p-0" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipWrapper>
      </div>
    </div>
  );
}
