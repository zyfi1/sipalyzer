import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { NoteFolder } from "@/types/notes";
import { useNoteStore } from "@/stores/noteStore";
import { useNoteDnd } from "./NoteDndContext";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  GripVertical,
} from "@/lib/icons";

interface SortableFolderItemProps {
  folder: NoteFolder;
  level: number;
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
}

export function SortableFolderItem({
  folder,
  level,
  selectedFolderId,
  onSelect,
}: SortableFolderItemProps) {
  const folders = useNoteStore((s) => s.folders);
  const [isExpanded, setIsExpanded] = useState(true);
  const { dragOverFolder, activeItem } = useNoteDnd();

  const children = folders.filter((f) => f.parentId === folder.id);
  const isSelected = selectedFolderId === folder.id;
  const isDropTarget = dragOverFolder === folder.id && activeItem?.type === "note";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: folder.id,
    data: {
      type: "folder",
      folder,
    },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: folder.id,
    data: {
      type: "folder-drop-zone",
      folder,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        ref={setDropRef}
        className={cn(
          "group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-smooth",
          "hover:bg-accent",
          isSelected && "bg-accent text-foreground",
          isDragging && "opacity-50",
          (isDropTarget || isOver) && "bg-muted/40 border border-dashed border-foreground/30"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onSelect(folder.id)}
        {...attributes}
      >
        {/* Drag handle */}
        <div
          {...listeners}
          className="opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-0.5 -ml-1"
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </div>

        {/* Expand/collapse button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="p-0.5 hover:bg-muted rounded shrink-0"
        >
          {children.length > 0 ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="w-3.5" />
          )}
        </button>

        {/* Folder icon */}
        {isExpanded && children.length > 0 ? (
          <FolderOpen className="h-4 w-4 text-foreground shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        {/* Folder name */}
        <span className="text-sm font-medium truncate flex-1">{folder.name}</span>
      </div>

      {/* Children */}
      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <SortableFolderItem
              key={child.id}
              folder={child}
              level={level + 1}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AllNotesDropZoneProps {
  isSelected: boolean;
  onSelect: () => void;
}

export function AllNotesDropZone({ isSelected, onSelect }: AllNotesDropZoneProps) {
  const { dragOverFolder, activeItem } = useNoteDnd();
  const isDropTarget = dragOverFolder === "all-notes" && activeItem?.type === "note";

  const { setNodeRef, isOver } = useDroppable({
    id: "all-notes",
    data: {
      type: "folder-drop-zone",
      folderId: null,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-smooth",
        "hover:bg-accent",
        isSelected && "bg-accent text-foreground",
        (isDropTarget || isOver) && "bg-muted/40 border border-dashed border-foreground/30"
      )}
      onClick={onSelect}
    >
      <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm font-medium">All Notes</span>
    </div>
  );
}
