import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Edit, Trash2, Star } from "@/lib/icons";
import { formatDistanceToNow } from "date-fns";
import type { Note } from "@/types/notes";
import { cn } from "@/lib/utils";

interface NoteCardProps {
  note: Note;
  onEdit: (id: string) => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  registrarName?: string;
  onNavigate?: (id: string) => void;
}

export function NoteCard({ note, onEdit, onDelete, onTogglePin, onNavigate }: NoteCardProps) {
  const preview = note.content
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n+/g, " ")
    .slice(0, 120);

  const handleClick = () => {
    if (onNavigate) onNavigate(note.id);
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "group relative rounded-lg surface px-3 py-3 cursor-pointer transition-smooth",
        "hover:bg-card/70 hover:border-border/60"
      )}
    >
      <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-smooth z-10" onClick={(e) => e.stopPropagation()}>
        {onTogglePin && (
          <TooltipWrapper title={note.isPinned ? "Unpin" : "Pin"}>
            <Button variant="ghost" size="sm" className={cn("h-6 w-6 p-0", note.isPinned && "text-warning")} onClick={() => onTogglePin(note.id)}>
              <Star className={cn("h-3 w-3", note.isPinned && "fill-current")} />
            </Button>
          </TooltipWrapper>
        )}
        <TooltipWrapper title="Edit">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onEdit(note.id)}>
            <Edit className="h-3 w-3" />
          </Button>
        </TooltipWrapper>
        {onDelete && (
          <TooltipWrapper title="Delete">
            <Button variant="destructive" size="sm" className="h-6 w-6 p-0" onClick={() => onDelete(note.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipWrapper>
        )}
      </div>

      <div className="pr-12 space-y-1">
        <h3 className="text-sm font-medium text-foreground truncate">{note.title || "Untitled"}</h3>

        {/* Preview */}
        {preview && (
          <p className="text-xs text-muted-foreground/70 line-clamp-2">{preview}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-xs text-muted-foreground/60 tabular-nums">
            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
          </span>
          {note.isPinned && <Star className="h-3 w-3 text-warning fill-current shrink-0" />}
        </div>
      </div>
    </div>
  );
}
