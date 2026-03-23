import { useState, useEffect, useCallback } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { Trash2, RotateCcw, AlertTriangle } from "@/lib/icons";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\n+/g, " ")
    .trim();
}

export function TrashView() {
  const deletedNotes = useNoteStore((s) => s.deletedNotes);
  const fetchDeletedNotes = useNoteStore((s) => s.fetchDeletedNotes);
  const restoreNote = useNoteStore((s) => s.restoreNote);
  const permanentlyDeleteNote = useNoteStore((s) => s.permanentlyDeleteNote);
  const emptyTrash = useNoteStore((s) => s.emptyTrash);

  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [deleteForeverId, setDeleteForeverId] = useState<string | null>(null);
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchDeletedNotes();
  }, [fetchDeletedNotes]);

  const handleRestore = useCallback(
    async (id: string) => {
      setRestoringIds((prev) => new Set(prev).add(id));
      try {
        await restoreNote(id);
      } finally {
        setRestoringIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [restoreNote],
  );

  const handlePermanentDelete = useCallback(async () => {
    if (!deleteForeverId) return;
    setDeletingIds((prev) => new Set(prev).add(deleteForeverId));
    try {
      await permanentlyDeleteNote(deleteForeverId);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteForeverId);
        return next;
      });
      setDeleteForeverId(null);
    }
  }, [permanentlyDeleteNote, deleteForeverId]);

  const handleEmptyTrash = useCallback(async () => {
    await emptyTrash();
  }, [emptyTrash]);

  return (
    <div className="surface flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Trash</h2>
          {deletedNotes.length > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {deletedNotes.length}
            </Badge>
          )}
        </div>
        {deletedNotes.length > 0 && (
          <TooltipWrapper title="Permanently delete all trashed notes">
            <Button
              variant="destructive"
              size="sm"
              className="h-8 px-3"
              onClick={() => setEmptyTrashOpen(true)}
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Empty Trash
            </Button>
          </TooltipWrapper>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
        {deletedNotes.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<Trash2 />}
            title="Trash is empty"
            description="Deleted notes will appear here"
          />
        ) : (
          deletedNotes.map((note) => {
            const preview = stripMarkdown(note.content).slice(0, 80);
            const isRestoring = restoringIds.has(note.id);
            const isDeleting = deletingIds.has(note.id);

            return (
              <div
                key={note.id}
                className={cn(
                  "group rounded-xl border border-border/25 bg-background/40 p-4 transition-smooth",
                  (isRestoring || isDeleting) && "opacity-50 pointer-events-none",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium line-clamp-1">
                      {note.title || "Untitled"}
                    </h3>
                    {preview && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {preview}
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {note.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="h-5 px-1.5 text-[10px]"
                        >
                          {tag}
                        </Badge>
                      ))}
                      <span className="caption-text-sm">
                        {formatDistanceToNow(new Date(note.updatedAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Hover actions */}
                  <div className="shrink-0 flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                    <TooltipWrapper title="Restore note">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleRestore(note.id)}
                        disabled={isRestoring}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipWrapper>
                    <TooltipWrapper title="Delete forever">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteForeverId(note.id)}
                        disabled={isDeleting}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipWrapper>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={emptyTrashOpen}
        onOpenChange={setEmptyTrashOpen}
        title="Empty Trash"
        description="This will permanently delete all notes in the trash. This action cannot be undone."
        confirmText="Empty Trash"
        variant="destructive"
        onConfirm={handleEmptyTrash}
      />
      <ConfirmDialog
        open={deleteForeverId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteForeverId(null);
        }}
        title="Delete Forever"
        description="This note will be permanently deleted. This action cannot be undone."
        confirmText="Delete Forever"
        variant="destructive"
        onConfirm={handlePermanentDelete}
      />
    </div>
  );
}
