import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/notes";
import { GripVertical, Star } from "@/lib/icons";
import { formatDistanceToNow } from "date-fns";

function getExcerpt(content: string | undefined): string {
  if (!content) return "";
  return content
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n+/g, " ")
    .slice(0, 120);
}

interface DraggableNoteCardProps {
  note: Note;
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

export function DraggableNoteCard({ note, isSelected, onClick, onDoubleClick }: DraggableNoteCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    data: { type: "note", note },
  });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const excerpt = getExcerpt(note.content);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-lg surface px-3 py-3 cursor-pointer transition-smooth",
        "hover:bg-card/70 hover:border-border/60",
        isSelected && "bg-accent/35 border-primary/45 ring-1 ring-primary/20",
        isDragging && "opacity-60 shadow-md scale-[1.01]"
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...attributes}
    >
      <div
        {...listeners}
        className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-smooth cursor-grab active:cursor-grabbing p-0.5"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground/45" />
      </div>

      <div className="pl-3 space-y-1">
        <span className="text-sm font-medium text-foreground truncate block">
          {note.title || "Untitled"}
        </span>

        {excerpt && (
          <p className="text-xs text-muted-foreground/70 line-clamp-2">{excerpt}</p>
        )}

        {note.tags && note.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {note.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex h-5 items-center rounded-md border border-border/45 bg-muted/25 px-1.5 text-[10px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-0.5">
          <span className="text-xs text-muted-foreground/60 tabular-nums">
            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
          </span>
          {note.isPinned && <Star className="h-3 w-3 text-warning fill-current" />}
        </div>
      </div>
    </div>
  );
}

interface DroppableNoteCardProps {
  note: Note;
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

export function DroppableNoteCard({ note, isSelected, onClick, onDoubleClick }: DroppableNoteCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: note.id,
    data: { type: "note", note },
  });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const excerpt = getExcerpt(note.content);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-lg surface px-3 py-3 cursor-pointer transition-smooth",
        "hover:bg-card/70 hover:border-border/60",
        isSelected && "bg-accent/35 border-primary/45 ring-1 ring-primary/20",
        isDragging && "opacity-60 shadow-md scale-[1.01]",
        isOver && "border-dashed border-primary/50 bg-primary/10"
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...attributes}
    >
      <div
        {...listeners}
        className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-smooth cursor-grab active:cursor-grabbing p-0.5"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground/45" />
      </div>

      <div className="pl-3 space-y-1">
        <span className="text-sm font-medium text-foreground truncate block">
          {note.title || "Untitled"}
        </span>

        {excerpt && (
          <p className="text-xs text-muted-foreground/70 line-clamp-2">{excerpt}</p>
        )}

        {note.tags && note.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {note.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex h-5 items-center rounded-md border border-border/45 bg-muted/25 px-1.5 text-[10px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-0.5">
          <span className="text-xs text-muted-foreground/60 tabular-nums">
            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
          </span>
          {note.isPinned && <Star className="h-3 w-3 text-warning fill-current" />}
        </div>
      </div>
    </div>
  );
}
