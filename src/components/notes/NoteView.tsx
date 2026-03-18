import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Link2, Star, ExternalLink, ArrowLeft, Edit, Trash2 } from "@/lib/icons";
import { format } from "date-fns";
import type { Note } from "@/types/notes";
import { useNoteStore } from "@/stores/noteStore";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { cn } from "@/lib/utils";

function getCategoryColor(category: string): string {
  const lower = category.toLowerCase();
  if (lower === "important" || lower === "urgent")
    return "bg-destructive/10 border border-destructive/20 text-destructive";
  if (lower === "todo" || lower === "task")
    return "bg-warning/10 border border-warning/20 text-warning";
  if (lower === "reference" || lower === "documentation")
    return "bg-primary/10 border border-primary/20 text-primary";
  if (lower === "personal" || lower === "idea")
    return "bg-success/10 border border-success/20 text-success";
  return "bg-muted/50 border border-border text-muted-foreground";
}

interface NoteViewProps {
  note: Note;
  registrarName?: string;
  onBack?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function NoteView({ note, registrarName, onBack, onEdit, onDelete }: NoteViewProps) {
  const notes = useNoteStore((s) => s.notes);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);

  const linkedNotes = useMemo(() => {
    if (!note.linkedNoteIds || note.linkedNoteIds.length === 0) return [];
    return notes.filter(n => note.linkedNoteIds?.includes(n.id));
  }, [note.linkedNoteIds, notes]);

  const formatDate = (dateString: string) => {
    try {
      const d = new Date(dateString);
      return isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");
    } catch { return "—"; }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-1.5 ui-section-header-md">
        {onBack && (
          <TooltipWrapper title="Back" description="Return to list (Esc).">
            <Button variant="ghost" size="sm" onClick={onBack} className="h-7 gap-1 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          </TooltipWrapper>
        )}
        {onEdit && (
          <>
            <div className="w-px h-4 bg-border/30" />
            <TooltipWrapper title="Edit" description="Open the editor for this note.">
              <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 gap-1 text-xs">
                <Edit className="h-3.5 w-3.5" />
                Edit
              </Button>
            </TooltipWrapper>
          </>
        )}
        {onDelete && (
          <TooltipWrapper title="Delete">
            <Button variant="destructive" size="sm" onClick={onDelete} className="h-7 gap-1 text-xs">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipWrapper>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 flex-wrap">
          {note.isPinned && (
            <Badge variant="default" className="gap-1 text-2xs h-5">
              <Star className="h-3 w-3 fill-current text-warning" />
              Pinned
            </Badge>
          )}
          {note.category && (
            <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium border", getCategoryColor(note.category))}>
              {note.category}
            </span>
          )}
          {registrarName && (
            <Badge variant="outline" className="gap-1 text-2xs h-5 text-primary/70">
              <Link2 className="h-3 w-3" />
              {registrarName}
            </Badge>
          )}
          <span className="caption-text-sm tabular-nums ml-1">
            Updated {formatDate(note.updatedAt)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-[15px] font-semibold text-foreground mb-1">{note.title || "Untitled"}</h1>
          {note.tags.length > 0 && (
            <div className="flex items-center gap-1.5 mb-4">
              {note.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-2xs h-4 px-1.5">{tag}</Badge>
              ))}
            </div>
          )}

          {/* Linked Notes */}
          {linkedNotes.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4 p-3 rounded-lg bg-card/40 border border-border/40">
              <span className="text-xs font-medium text-muted-foreground">Linked:</span>
              {linkedNotes.map((ln) => (
                <Badge
                  key={ln.id}
                  variant="outline"
                  className="gap-1 text-xs cursor-pointer hover:bg-accent"
                  onClick={() => setSelectedNoteId(ln.id)}
                >
                  <ExternalLink className="h-3 w-3" />
                  {ln.title}
                </Badge>
              ))}
            </div>
          )}

          <div className="prose prose-invert max-w-none">
            <MarkdownRenderer content={note.content} />
          </div>
        </div>
      </div>

      {/* Footer dates */}
      <div className="flex-shrink-0 border-t border-border/30 px-6 py-2 flex items-center gap-4 caption-text-sm tabular-nums">
        <span>Created {formatDate(note.createdAt)}</span>
        <span>&middot;</span>
        <span>Updated {formatDate(note.updatedAt)}</span>
        {note.version && <span>&middot; v{note.version}</span>}
      </div>
    </div>
  );
}
