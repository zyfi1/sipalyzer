import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useNoteStore } from "@/stores/noteStore";
import type { Note, NoteFolder } from "@/types/notes";

interface DragItem {
  type: "note" | "folder" | "tag";
  id: string;
  data?: Note | NoteFolder | string;
}

interface NoteDndContextValue {
  activeItem: DragItem | null;
  isDragging: boolean;
  dragOverFolder: string | null;
}

const NoteDndContextValue = createContext<NoteDndContextValue>({
  activeItem: null,
  isDragging: false,
  dragOverFolder: null,
});

export function useNoteDnd() {
  return useContext(NoteDndContextValue);
}

interface NoteDndProviderProps {
  children: ReactNode;
  onMoveNoteToFolder?: (noteId: string, folderId: string | null) => void;
  onReorderNotes?: (activeId: string, overId: string) => void;
  onReorderFolders?: (activeId: string, overId: string, parentId: string | null) => void;
  onAddTagToNote?: (noteId: string, tag: string) => void;
}

export function NoteDndProvider({
  children,
  onMoveNoteToFolder,
  onReorderNotes,
  onReorderFolders,
  onAddTagToNote,
}: NoteDndProviderProps) {
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const notes = useNoteStore((s) => s.notes);
  const folders = useNoteStore((s) => s.folders);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const id = String(active.id);
    const type = active.data.current?.type as "note" | "folder" | "tag" | undefined;

    if (!type) return;

    let data: Note | NoteFolder | string | undefined;
    if (type === "note") {
      data = notes.find((n) => n.id === id);
    } else if (type === "folder") {
      data = folders.find((f) => f.id === id);
    } else if (type === "tag") {
      data = id;
    }

    setActiveItem({ type, id, data });
  }, [notes, folders]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setDragOverFolder(null);
      return;
    }

    const overType = over.data.current?.type;
    if (overType === "folder" || overType === "folder-drop-zone") {
      setDragOverFolder(String(over.id));
    } else {
      setDragOverFolder(null);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveItem(null);
    setDragOverFolder(null);

    if (!over) return;

    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Note dropped on folder
    if (activeType === "note" && (overType === "folder" || overType === "folder-drop-zone")) {
      const folderId = overId === "all-notes" ? null : overId;
      onMoveNoteToFolder?.(activeId, folderId);
      return;
    }

    // Note reordering
    if (activeType === "note" && overType === "note" && activeId !== overId) {
      onReorderNotes?.(activeId, overId);
      return;
    }

    // Folder reordering
    if (activeType === "folder" && overType === "folder" && activeId !== overId) {
      const overFolder = folders.find((f) => f.id === overId);
      onReorderFolders?.(activeId, overId, overFolder?.parentId || null);
      return;
    }

    // Tag dropped on note
    if (activeType === "tag" && overType === "note") {
      const tag = active.data.current?.tag as string;
      if (tag) {
        onAddTagToNote?.(overId, tag);
      }
      return;
    }
  }, [folders, onMoveNoteToFolder, onReorderNotes, onReorderFolders, onAddTagToNote]);

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
    setDragOverFolder(null);
  }, []);

  return (
    <NoteDndContextValue.Provider
      value={{
        activeItem,
        isDragging: activeItem !== null,
        dragOverFolder,
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
          {activeItem && (
            <DragOverlayContent item={activeItem} />
          )}
        </DragOverlay>
      </DndContext>
    </NoteDndContextValue.Provider>
  );
}

function DragOverlayContent({ item }: { item: DragItem }) {
  if (item.type === "note" && item.data && typeof item.data !== "string") {
    const note = item.data as Note;
    return (
      <div className="bg-card border border-border/55 rounded-md p-3 shadow-card opacity-90 max-w-xs">
        <div className="font-medium text-sm truncate">{note.title || "Untitled"}</div>
        <div className="text-xs text-muted-foreground mt-1 truncate">
          {note.content?.slice(0, 50) || "No content"}
        </div>
      </div>
    );
  }

  if (item.type === "folder" && item.data && typeof item.data !== "string") {
    const folder = item.data as NoteFolder;
    return (
      <div className="bg-card border border-border/55 rounded-md px-3 py-2 shadow-card opacity-90">
        <div className="font-medium text-sm flex items-center gap-2">
          <span>📁</span>
          {folder.name}
        </div>
      </div>
    );
  }

  if (item.type === "tag") {
    return (
      <div className="bg-card border border-border/55 rounded-md px-3 py-1 shadow-card text-xs font-medium">
        #{item.id}
      </div>
    );
  }

  return null;
}
