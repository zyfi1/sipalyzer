import { useState, useEffect } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  MoreVertical,
  Edit,
  Trash2,
  FolderPlus,
  X,
} from "@/lib/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { cn } from "@/lib/utils";
import type { NoteFolder } from "@/types/notes";

interface FolderNodeProps {
  folder: NoteFolder;
  level: number;
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onEdit: (folder: NoteFolder) => void;
  onDelete: (folderId: string) => void;
}

function FolderNode({
  folder,
  level,
  selectedFolderId,
  onSelect,
  onEdit,
  onDelete,
}: FolderNodeProps) {
  const folders = useNoteStore((s) => s.folders);
  const createFolder = useNoteStore((s) => s.createFolder);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [isCreatingSubfolder, setIsCreatingSubfolder] = useState(false);
  const [newSubfolderName, setNewSubfolderName] = useState("");

  const children = folders.filter((f) => f.parentId === folder.id);
  const isSelected = selectedFolderId === folder.id;

  const handleSave = async () => {
    if (editName.trim() && editName !== folder.name) {
      await useNoteStore.getState().updateFolder(folder.id, editName);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditName(folder.name);
      setIsEditing(false);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-3 py-2 rounded-lg group hover:bg-accent transition-smooth cursor-pointer",
          isSelected && "bg-accent text-foreground"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(folder.id)}
      >
        <TooltipWrapper title={isExpanded ? "Collapse" : "Expand"} description={isExpanded ? "Collapse this folder." : "Expand this folder."}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-0.5 hover:bg-muted rounded"
          >
            {children.length > 0 ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <div className="w-3.5" />
          )}
          </button>
        </TooltipWrapper>

        {isExpanded ? (
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground" />
        )}

        {isEditing ? (
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="h-6 px-2 text-sm"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-sm font-medium flex-1 truncate">{folder.name}</span>
        )}

        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <TooltipWrapper title="Folder actions" description="New subfolder, rename, or delete.">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </TooltipWrapper>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCreatingSubfolder(true);
                  setIsExpanded(true);
                }}
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                New Subfolder
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
              >
                <Edit className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onDelete(folder.id)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isExpanded && (children.length > 0 || isCreatingSubfolder) && (
        <div>
          {children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              level={level + 1}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
          {isCreatingSubfolder && (
            <div style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }} className="py-1">
              <div className="flex items-center gap-1">
                <Input
                  value={newSubfolderName}
                  onChange={(e) => setNewSubfolderName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && newSubfolderName.trim()) {
                      await createFolder(newSubfolderName.trim(), folder.id);
                      setNewSubfolderName("");
                      setIsCreatingSubfolder(false);
                    }
                    if (e.key === "Escape") {
                      setNewSubfolderName("");
                      setIsCreatingSubfolder(false);
                    }
                  }}
                  placeholder="Subfolder name..."
                  className="h-6 text-xs flex-1"
                  autoFocus
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => {
                    setNewSubfolderName("");
                    setIsCreatingSubfolder(false);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FolderTreeProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}

export function FolderTree({ selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const folders = useNoteStore((s) => s.folders);
  const fetchFolders = useNoteStore((s) => s.fetchFolders);
  const createFolder = useNoteStore((s) => s.createFolder);
  const deleteFolder = useNoteStore((s) => s.deleteFolder);
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const rootFolders = folders.filter((f) => !f.parentId);

  const handleCreateFolder = async () => {
    if (newFolderName.trim()) {
      await createFolder(newFolderName.trim());
      setNewFolderName("");
      setIsCreating(false);
    }
  };

  const handleRequestDeleteFolder = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (folder) setFolderToDelete({ id: folder.id, name: folder.name });
  };

  const handleConfirmDeleteFolder = async () => {
    if (!folderToDelete) return;
    try {
      await deleteFolder(folderToDelete.id);
      if (selectedFolderId === folderToDelete.id) {
        onSelectFolder(null);
      }
    } finally {
      setFolderToDelete(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h3 className="section-title">Folders</h3>
        <TooltipWrapper title="New folder" description="Create a new folder.">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </TooltipWrapper>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isCreating && (
          <div className="px-2 py-1.5 mb-1">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={handleCreateFolder}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateFolder();
                } else if (e.key === "Escape") {
                  setIsCreating(false);
                  setNewFolderName("");
                }
              }}
              placeholder="Folder name"
              className="h-7 text-sm"
              autoFocus
            />
          </div>
        )}

        <div
          className={cn(
            "px-3 py-2 rounded-lg cursor-pointer hover:bg-accent transition-smooth mb-1",
            selectedFolderId === null && "bg-accent text-foreground"
          )}
          onClick={() => onSelectFolder(null)}
        >
          <span className="text-sm font-medium">All Notes</span>
        </div>

        {rootFolders.map((folder) => (
          <FolderNode
            key={folder.id}
            folder={folder}
            level={0}
            selectedFolderId={selectedFolderId}
            onSelect={onSelectFolder}
            onEdit={() => {}}
            onDelete={handleRequestDeleteFolder}
          />
        ))}
      </div>

      <ConfirmDialog
        open={!!folderToDelete}
        onOpenChange={(open) => !open && setFolderToDelete(null)}
        title="Delete folder"
        description={
          folderToDelete
            ? `Delete "${folderToDelete.name}"? Notes in this folder will be moved to the parent folder (or out of folders). Subfolders will be kept.`
            : ""
        }
        onConfirm={handleConfirmDeleteFolder}
        variant="destructive"
      />
    </div>
  );
}
