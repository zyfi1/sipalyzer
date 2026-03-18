import { useEffect, useMemo, useState, useCallback } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { useLayoutStore } from "@/stores/layoutStore";
import type { Note } from "@/types/notes";
import { StickyNote, Star, Plus, ExternalLink } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function QuickNotesSection() {
  const notes = useNoteStore((s) => s.notes);
  const fetchAllNotes = useNoteStore((s) => s.fetchAllNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);
  const setNotesCenterOpen = useLayoutStore((s) => s.setNotesCenterOpen);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => { fetchAllNotes(); }, [fetchAllNotes]);

  const recentNotes = useMemo(() => {
    const sorted = [...notes].sort((a: Note, b: Note) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return sorted.slice(0, 5);
  }, [notes]);

  const handleOpenNote = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
    setNotesCenterOpen(true);
  }, [setSelectedNoteId, setNotesCenterOpen]);

  const handleQuickCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    const id = await createNote(newTitle.trim(), "", []);
    setNewTitle("");
    setIsCreating(false);
    setSelectedNoteId(id);
    setNotesCenterOpen(true);
  }, [newTitle, createNote, setSelectedNoteId, setNotesCenterOpen]);

  return (
    <div className="surface p-5 flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground/60" />
          <h2 className="text-sm font-semibold text-foreground/70">Quick Notes</h2>
          {notes.length > 0 && (
            <span className="text-3xs text-muted-foreground/40 tabular-nums">{notes.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isCreating && (
            <TooltipWrapper title="Quick add" description="Create a new note.">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground/50 hover:text-foreground/70 h-6 w-6 p-0"
                onClick={() => setIsCreating(true)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipWrapper>
          )}
          {notes.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-2xs text-muted-foreground/50 hover:text-foreground/70 h-6 px-2"
              onClick={() => setNotesCenterOpen(true)}
            >
              All Notes
            </Button>
          )}
        </div>
      </div>

      {/* Quick create */}
      {isCreating && (
        <div className="flex items-center gap-2 shrink-0">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Note title..."
            className="h-7 text-xs flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleQuickCreate();
              if (e.key === "Escape") { setIsCreating(false); setNewTitle(""); }
            }}
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleQuickCreate} disabled={!newTitle.trim()}>
            Add
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setIsCreating(false); setNewTitle(""); }}>
            Cancel
          </Button>
        </div>
      )}

      {recentNotes.length > 0 ? (
        <div className="space-y-0.5 overflow-y-auto -mx-2 px-2 flex-1 min-h-0 widget-scroll">
          {recentNotes.map((note) => (
            <div
              key={note.id}
              className="group flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/10 transition-colors cursor-pointer"
              onClick={() => handleOpenNote(note.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {note.isPinned && (
                    <Star className="h-3 w-3 text-foreground/60 shrink-0 fill-current" />
                  )}
                  <span className="text-sm font-medium text-foreground/75 truncate">
                    {note.title || "Untitled"}
                  </span>
                </div>
                {note.content && (
                  <p className="text-3xs text-muted-foreground/40 truncate mt-0.5">
                    {note.content
                      .replace(/#{1,6}\s+/g, "")
                      .replace(/\*\*([^*]+)\*\*/g, "$1")
                      .replace(/`([^`]+)`/g, "$1")
                      .replace(/\n+/g, " ")
                      .slice(0, 60)}
                  </p>
                )}
                {note.tags && note.tags.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    {note.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[8px] h-3.5 px-1 opacity-60">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 mt-0.5">
                <span className="text-3xs text-muted-foreground/40 tabular-nums">
                  {relativeTime(new Date(note.updatedAt).getTime())}
                </span>
                <TooltipWrapper title="Open in Notes">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 opacity-0 group-hover:opacity-60 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); handleOpenNote(note.id); }}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </TooltipWrapper>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          variant="inline"
          icon={<StickyNote />}
          title="No notes yet"
          className="min-h-0"
          action={(
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground/50 hover:text-foreground gap-1 h-7"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="h-3 w-3" />
              Create your first note
            </Button>
          )}
        />
      )}
    </div>
  );
}
