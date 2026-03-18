import { useState, useRef } from "react";
import { useRegistrationStore } from "@/stores/registrationStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Folder, Trash2, ChevronUp, ChevronDown, Plus, Check, X } from "@/lib/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface FolderManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FolderManager({ open, onOpenChange }: FolderManagerProps) {
  const folders = useRegistrationStore((s) => s.folders);
  const registrars = useRegistrationStore((s) => s.registrars);
  const createFolder = useRegistrationStore((s) => s.createFolder);
  const renameFolder = useRegistrationStore((s) => s.renameFolder);
  const deleteFolder = useRegistrationStore((s) => s.deleteFolder);
  const reorderFolders = useRegistrationStore((s) => s.reorderFolders);

  const [newFolderName, setNewFolderName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const countForFolder = (folderId: string) =>
    registrars.filter((r) => r.group === folderId).length;

  const handleCreate = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await createFolder(name);
    setNewFolderName("");
    setIsAdding(false);
  };

  const handleRename = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    await renameFolder(id, name);
    setEditingId(null);
    setEditingName("");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteFolder(deleteTarget.id);
    setDeleteTarget(null);
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const ids = folders.map((f) => f.id);
    const tmp = ids[index - 1]!;
    ids[index - 1] = ids[index]!;
    ids[index] = tmp;
    await reorderFolders(ids);
  };

  const handleMoveDown = async (index: number) => {
    if (index >= folders.length - 1) return;
    const ids = folders.map((f) => f.id);
    const tmp = ids[index]!;
    ids[index] = ids[index + 1]!;
    ids[index + 1] = tmp;
    await reorderFolders(ids);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Folders</DialogTitle>
          </DialogHeader>

          <div className="space-y-1">
            {folders.length === 0 && !isAdding && (
              <EmptyState
                compact
                variant="inline"
                title="No folders yet"
                description="Create one to organize your registrars."
                className="py-4"
              />
            )}

            {folders.map((folder, index) => {
              const count = countForFolder(folder.id);
              const isEditing = editingId === folder.id;

              return (
                <div
                  key={folder.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 group"
                >
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {isEditing ? (
                    <form
                      className="flex-1 flex items-center gap-1"
                      onSubmit={(e) => { e.preventDefault(); handleRename(folder.id); }}
                    >
                      <Input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="h-7 text-sm"
                        onKeyDown={(e) => { if (e.key === "Escape") { setEditingId(null); setEditingName(""); } }}
                      />
                      <TooltipWrapper entry={tooltips.regFolderRename}>
                        <Button type="submit" variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipWrapper>
                      <TooltipWrapper entry={tooltips.regFolderCancel}>
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingId(null); setEditingName(""); }}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipWrapper>
                    </form>
                  ) : (
                    <>
                      <TooltipWrapper entry={tooltips.regFolderRename}>
                        <span
                          className="flex-1 text-sm text-foreground cursor-pointer truncate"
                          onDoubleClick={() => { setEditingId(folder.id); setEditingName(folder.name); }}
                        >
                          {folder.name}
                        </span>
                      </TooltipWrapper>
                      <span className="text-2xs tabular-nums text-muted-foreground/60 mr-1">{count}</span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <TooltipWrapper entry={tooltips.regFolderMoveUp}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                          >
                            <ChevronUp className="h-3 w-3" />
                          </Button>
                        </TooltipWrapper>
                        <TooltipWrapper entry={tooltips.regFolderMoveDown}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => handleMoveDown(index)}
                            disabled={index >= folders.length - 1}
                          >
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </TooltipWrapper>
                        <TooltipWrapper entry={tooltips.regFolderDelete}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:bg-destructive/15 hover:text-destructive"
                            onClick={() => setDeleteTarget({ id: folder.id, name: folder.name })}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TooltipWrapper>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {isAdding ? (
              <form
                className="flex items-center gap-2 px-2 py-1.5"
                onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
              >
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="h-7 text-sm flex-1"
                  onKeyDown={(e) => { if (e.key === "Escape") { setIsAdding(false); setNewFolderName(""); } }}
                />
                <TooltipWrapper entry={tooltips.regFolderCreate}>
                  <Button type="submit" variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={!newFolderName.trim()}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper entry={tooltips.regFolderCancel}>
                  <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setIsAdding(false); setNewFolderName(""); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipWrapper>
              </form>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-muted-foreground h-8 mt-1"
                onClick={() => setIsAdding(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-xs">Add folder</span>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Folder"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? ${countForFolder(deleteTarget.id)} registrar${countForFolder(deleteTarget.id) !== 1 ? "s" : ""} in this folder will be moved to Ungrouped.`
            : ""
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}
