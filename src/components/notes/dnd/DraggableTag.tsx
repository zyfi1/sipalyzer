import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tag, GripVertical } from "@/lib/icons";

interface DraggableTagProps {
  tag: string;
  isSelected?: boolean;
  onClick?: () => void;
}

export function DraggableTag({ tag, isSelected, onClick }: DraggableTagProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `tag-${tag}`,
    data: {
      type: "tag",
      tag,
    },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group inline-flex", isDragging && "opacity-50")}
    >
      <Badge
        variant={isSelected ? "default" : "secondary"}
        className={cn(
          "cursor-pointer transition-smooth gap-1 pr-2",
          "hover:bg-accent hover:text-accent-foreground",
          isSelected && "bg-accent text-foreground"
        )}
        onClick={onClick}
      >
        <div
          {...listeners}
          {...attributes}
          className="cursor-grab active:cursor-grabbing opacity-50 group-hover:opacity-100 transition-opacity -ml-0.5"
        >
          <GripVertical className="h-3 w-3" />
        </div>
        <Tag className="h-3 w-3" />
        {tag}
      </Badge>
    </div>
  );
}

interface TagListProps {
  tags: string[];
  selectedTags?: string[];
  onTagClick?: (tag: string) => void;
}

export function DraggableTagList({ tags, selectedTags = [], onTagClick }: TagListProps) {
  if (tags.length === 0) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-1">
        No tags yet
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2">
      {tags.map((tag) => (
        <DraggableTag
          key={tag}
          tag={tag}
          isSelected={selectedTags.includes(tag)}
          onClick={() => onTagClick?.(tag)}
        />
      ))}
    </div>
  );
}
