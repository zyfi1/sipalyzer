import { useState, useEffect, useCallback, useRef } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  StickyNote,
  Plus,
  ChevronDown,
  ChevronUp,
  Edit,
  ExternalLink,
  Save,
  Trash2,
  Star,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/notes";
import type { NoteContext } from "@/lib/noteContext";
import { useLayoutStore } from "@/stores/layoutStore";
import { getMarkdownExcerpt } from "../editor/markdownUtils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDistanceToNow } from "date-fns";

interface InlineNoteWidgetProps {
  context: NoteContext;
  maxVisible?: number;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  visualVariant?: "default" | "registration";
}

export function InlineNoteWidget({
  context,
  maxVisible = 5,
  className,
  collapsible = true,
  defaultCollapsed = false,
  visualVariant = "default",
}: InlineNoteWidgetProps) {
  const notes = useNoteStore((s) => s.notes);
  const createNote = useNoteStore((s) => s.createNote);
  const updateNoteQuiet = useNoteStore((s) => s.updateNoteQuiet);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const fetchAllNotes = useNoteStore((s) => s.fetchAllNotes);
  const setNotesCenterOpen = useLayoutStore((s) => s.setNotesCenterOpen);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);

  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const isRegistration = visualVariant === "registration";

  const linkedNotes = notes.filter((n) => {
    if (context.type === "registrar") return n.linkedRegistrarId === context.id;
    if (context.type === "agent") return n.linkedAgentId === context.id;
    return false;
  });

  const visibleNotes = isCollapsed ? [] : linkedNotes.slice(0, maxVisible);
  const hasMore = linkedNotes.length > maxVisible;

  useEffect(() => {
    fetchAllNotes();
  }, [fetchAllNotes]);

  // Auto-focus title when creating
  useEffect(() => {
    if (isCreating && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [isCreating]);

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    const linkedRegistrarId = context.type === "registrar" ? context.id : undefined;
    const linkedAgentId = context.type === "agent" ? context.id : undefined;
    await createNote(newTitle.trim(), newContent.trim(), [], linkedRegistrarId, linkedAgentId);
    setNewTitle("");
    setNewContent("");
    setIsCreating(false);
  }, [newTitle, newContent, context, createNote]);

  const handleStartEdit = useCallback((note: Note) => {
    setEditingNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setIsCreating(false);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingNote) return;
    await updateNoteQuiet(
      editingNote.id, editTitle, editContent, editingNote.tags,
      editingNote.category, editingNote.isPinned, undefined,
      editingNote.folderId, editingNote.linkedRegistrarId, editingNote.linkedAgentId
    );
    setEditingNote(null);
  }, [editingNote, editTitle, editContent, updateNoteQuiet]);

  const handleCancelEdit = useCallback(() => {
    setEditingNote(null);
    setEditTitle("");
    setEditContent("");
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteId) return;
    await deleteNote(deleteId);
    setDeleteId(null);
    if (editingNote?.id === deleteId) setEditingNote(null);
  }, [deleteId, deleteNote, editingNote]);

  const handleOpenFull = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
    setNotesCenterOpen(true);
  }, [setSelectedNoteId, setNotesCenterOpen]);

  return (
    <div
      className={cn(
        "rounded-lg border",
        isRegistration
          ? "surface-flat border-border/45 bg-card/45"
          : "bg-card/30 border-border/30",
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between mb-1 px-3 pt-2.5",
          isRegistration && "pb-2 border-b border-border/35"
        )}
      >
        <button
          type="button"
          onClick={() => collapsible && setIsCollapsed(!isCollapsed)}
          className={cn(
            "flex items-center gap-2 text-xs font-semibold text-foreground/70",
            collapsible && "hover:text-foreground cursor-pointer"
          )}
        >
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          <span>Notes</span>
          {linkedNotes.length > 0 && (
            <Badge variant="secondary" className="text-2xs tabular-nums h-4 px-1.5 font-normal">
              {linkedNotes.length}
            </Badge>
          )}
          {collapsible && (
            isCollapsed
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <div className="flex items-center gap-1">
          {!isCreating && !editingNote && (
            <TooltipWrapper title="Quick add" description="Create a new note for this registrar.">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setIsCreating(true); setIsCollapsed(false); }}>
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipWrapper>
          )}
          {linkedNotes.length > 0 && (
            <TooltipWrapper title="Open Notes" description="Open the full Notes view.">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setNotesCenterOpen(true)}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </TooltipWrapper>
          )}
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className={cn("space-y-2 mt-2 px-3 pb-3", isRegistration && "space-y-2.5")}>
          {/* Quick create */}
          {isCreating && (
            <div
              className={cn(
                "rounded-lg bg-background p-3 space-y-2",
                isRegistration
                  ? "border border-border/45 shadow-none"
                  : "shadow-card"
              )}
            >
              <Input
                ref={titleInputRef}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Note title..."
                className={cn(
                  "text-sm font-medium",
                  isRegistration
                    ? "ui-control-shell h-8 px-2.5 border-border/45 rounded-[var(--radius-md)] focus-visible:ring-1 focus-visible:ring-ring/70"
                    : "h-7 border-0 border-b border-border rounded-none px-0 focus-visible:ring-0"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate(); }
                  if (e.key === "Escape") { setIsCreating(false); setNewTitle(""); setNewContent(""); }
                }}
              />
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Write a quick note... (optional)"
                className={cn(
                  "resize-none text-sm",
                  isRegistration
                    ? "ui-panel-shell min-h-[76px] max-h-[140px] rounded-[var(--radius-md)] border-border/45 px-2.5 py-2 focus-visible:ring-1 focus-visible:ring-ring/70"
                    : "min-h-[60px] max-h-[120px] border-0 px-0 focus-visible:ring-0"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setIsCreating(false); setNewTitle(""); setNewContent(""); }
                }}
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant={isRegistration ? "neutral" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { setIsCreating(false); setNewTitle(""); setNewContent(""); }}
                >
                  Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs gap-1" onClick={handleCreate} disabled={!newTitle.trim()}>
                  <Plus className="h-3 w-3" />
                  Add note
                </Button>
              </div>
            </div>
          )}

          {/* Inline editor for editing an existing note */}
          {editingNote && (
            <div className="rounded-lg border border-primary/30 bg-background p-3 space-y-2">
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="h-7 text-sm font-medium border-0 border-b border-border rounded-none px-0 focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleCancelEdit();
                }}
              />
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[80px] max-h-[160px] resize-none text-sm border-0 px-0 focus-visible:ring-0 font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleCancelEdit();
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => handleOpenFull(editingNote.id)}>
                  <ExternalLink className="h-3 w-3" />
                  Full editor
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancelEdit}>
                    Cancel
                  </Button>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSaveEdit}>
                    <Save className="h-3 w-3" />
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Note list */}
          {!editingNote && visibleNotes.length === 0 && !isCreating && (
            <EmptyState
              variant="inline"
              compact
              icon={<StickyNote />}
              description={`No notes for ${context.displayName}`}
              action={(
                <Button variant="ghost" size="sm" className="h-7 text-xs mt-2 gap-1" onClick={() => setIsCreating(true)}>
                  <Plus className="h-3 w-3" />
                  Add first note
                </Button>
              )}
              className="py-4"
            />
          )}

          {!editingNote && visibleNotes.map((note) => (
            <QuickNoteItem
              key={note.id}
              note={note}
              onEdit={handleStartEdit}
              onOpenFull={handleOpenFull}
              onDelete={(id) => setDeleteId(id)}
            />
          ))}

          {/* Show more */}
          {hasMore && !editingNote && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setNotesCenterOpen(true)}
            >
              View all {linkedNotes.length} notes
            </Button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete note"
        description="This note will be permanently deleted."
        onConfirm={handleDelete}
        variant="destructive"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface QuickNoteItemProps {
  note: Note;
  onEdit: (note: Note) => void;
  onOpenFull: (id: string) => void;
  onDelete: (id: string) => void;
}

function QuickNoteItem({ note, onEdit, onOpenFull, onDelete }: QuickNoteItemProps) {
  const excerpt = getMarkdownExcerpt(note.content, 80);

  return (
    <div className="group flex items-start gap-3 py-2 px-3 rounded-lg bg-card/40 border border-border/40 hover:bg-accent/30 transition-smooth">
      {/* Content */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEdit(note)}>
        <div className="flex items-center gap-1.5">
          {note.isPinned && <Star className="h-3 w-3 text-warning fill-current shrink-0" />}
          <span className="text-sm font-medium truncate">{note.title || "Untitled"}</span>
        </div>
        {excerpt && (
          <p className="text-2xs text-muted-foreground/70 line-clamp-1 mt-0.5">{excerpt}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {note.tags?.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-2xs h-4 px-1">
              {tag}
            </Badge>
          ))}
          <span className="text-2xs text-muted-foreground/50 tabular-nums">
            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
        <TooltipWrapper title="Quick edit">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onEdit(note)}>
            <Edit className="h-3 w-3" />
          </Button>
        </TooltipWrapper>
        <TooltipWrapper title="Full editor">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onOpenFull(note.id)}>
            <ExternalLink className="h-3 w-3" />
          </Button>
        </TooltipWrapper>
        <TooltipWrapper title="Delete">
          <Button variant="destructive" size="sm" className="h-6 w-6 p-0" onClick={() => onDelete(note.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </TooltipWrapper>
      </div>
    </div>
  );
}
