import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Tag, Folder, X, Plus, CheckCircle2, FileText } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/notes";

interface BulkEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNotes: Note[];
  allTags: string[];
  allCategories: string[];
  onApply: (updates: {
    addTags?: string[];
    removeTags?: string[];
    setCategory?: string | null;
  }) => Promise<void>;
}

export function BulkEditorDialog({
  isOpen,
  onClose,
  selectedNotes,
  allTags,
  allCategories,
  onApply,
}: BulkEditorDialogProps) {
  const [tagsToAdd, setTagsToAdd] = useState<Set<string>>(new Set());
  const [tagsToRemove, setTagsToRemove] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState("");
  const [categoryToSet, setCategoryToSet] = useState<string | null | undefined>(undefined);
  const [isApplying, setIsApplying] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Get all tags currently on selected notes
  const currentTags = useMemo(() => {
    const tagSet = new Set<string>();
    selectedNotes.forEach(note => {
      note.tags.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [selectedNotes]);

  // Get all categories currently on selected notes
  const currentCategories = useMemo(() => {
    const categorySet = new Set<string>();
    selectedNotes.forEach(note => {
      if (note.category) categorySet.add(note.category);
    });
    return Array.from(categorySet).sort();
  }, [selectedNotes]);

  // Get tags that can be added (not already on all notes)
  const availableTagsToAdd = useMemo(() => {
    return allTags.filter(tag => !currentTags.includes(tag));
  }, [allTags, currentTags]);

  const handleAddTag = (tag: string) => {
    const newSet = new Set(tagsToAdd);
    newSet.add(tag);
    // Remove from remove set if it was there
    const newRemoveSet = new Set(tagsToRemove);
    newRemoveSet.delete(tag);
    setTagsToRemove(newRemoveSet);
    setTagsToAdd(newSet);
  };

  const handleRemoveTag = (tag: string) => {
    const newSet = new Set(tagsToRemove);
    newSet.add(tag);
    // Remove from add set if it was there
    const newAddSet = new Set(tagsToAdd);
    newAddSet.delete(tag);
    setTagsToAdd(newAddSet);
    setTagsToRemove(newSet);
  };

  const handleRemoveFromAdd = (tag: string) => {
    const newSet = new Set(tagsToAdd);
    newSet.delete(tag);
    setTagsToAdd(newSet);
  };

  const handleRemoveFromRemove = (tag: string) => {
    const newSet = new Set(tagsToRemove);
    newSet.delete(tag);
    setTagsToRemove(newSet);
  };

  const handleAddNewTag = () => {
    const trimmed = newTagName.trim();
    if (trimmed && !allTags.includes(trimmed) && !tagsToAdd.has(trimmed)) {
      setTagsToAdd(new Set([...tagsToAdd, trimmed]));
      setNewTagName("");
    }
  };

  const handleCreateNewCategory = () => {
    const trimmed = newCategoryName.trim();
    if (trimmed && !allCategories.includes(trimmed)) {
      setCategoryToSet(trimmed);
      setNewCategoryName("");
    }
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await onApply({
        addTags: tagsToAdd.size > 0 ? Array.from(tagsToAdd) : undefined,
        removeTags: tagsToRemove.size > 0 ? Array.from(tagsToRemove) : undefined,
        setCategory: categoryToSet !== undefined ? categoryToSet : undefined,
      });
      // Reset state
      setTagsToAdd(new Set());
      setTagsToRemove(new Set());
      setCategoryToSet(undefined);
      setNewTagName("");
      setNewCategoryName("");
      onClose();
    } catch (error) {
      console.error("Failed to apply bulk updates:", error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleClose = () => {
    setTagsToAdd(new Set());
    setTagsToRemove(new Set());
    setCategoryToSet(undefined);
    setNewTagName("");
    setNewCategoryName("");
    onClose();
  };

  const hasChanges = tagsToAdd.size > 0 || tagsToRemove.size > 0 || categoryToSet !== undefined;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[calc(min(100vh,100dvh)-2rem)] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Bulk Edit {selectedNotes.length} Note{selectedNotes.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Apply changes to all {selectedNotes.length} selected note{selectedNotes.length !== 1 ? "s" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          {/* Tags Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-muted-foreground" />
              <Label className="text-base font-semibold">Tags</Label>
            </div>

            {/* Current Tags - Show as badges with remove option */}
            {currentTags.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Current Tags (click to remove)</Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-md border border-border/55 bg-muted/10">
                  {currentTags.map((tag) => {
                    const willBeRemoved = tagsToRemove.has(tag);
                    const willBeAdded = tagsToAdd.has(tag);
                    
                    return (
                      <Badge
                        key={tag}
                        variant={willBeRemoved ? "destructive" : willBeAdded ? "default" : "secondary"}
                        className={cn(
                          "cursor-pointer gap-1.5 px-2 py-1 text-xs",
                          willBeRemoved && "line-through opacity-60"
                        )}
                        onClick={() => {
                          if (willBeRemoved) {
                            handleRemoveFromRemove(tag);
                          } else {
                            handleRemoveTag(tag);
                          }
                        }}
                      >
                        {tag}
                        {willBeRemoved && <X className="h-3 w-3" />}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Available Tags to Add */}
            {availableTagsToAdd.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Available Tags (click to add)</Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-md border border-border/55 bg-muted/10 max-h-48 overflow-y-auto">
                  {availableTagsToAdd.map((tag) => {
                    const willBeAdded = tagsToAdd.has(tag);
                    
                    return (
                      <Badge
                        key={tag}
                        variant={willBeAdded ? "default" : "outline"}
                        className={cn(
                          "cursor-pointer gap-1.5 px-2 py-1 text-xs",
                          willBeAdded && "bg-accent text-foreground"
                        )}
                        onClick={() => {
                          if (willBeAdded) {
                            handleRemoveFromAdd(tag);
                          } else {
                            handleAddTag(tag);
                          }
                        }}
                      >
                        {tag}
                        {willBeAdded && <X className="h-3 w-3" />}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Create New Tag */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Create New Tag</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddNewTag();
                    }
                  }}
                  placeholder="Enter tag name and press Enter..."
                  className="h-9"
                />
                <TooltipWrapper title="Add tag" description="Add the new tag to the list of tags to apply.">
                  <Button
                    type="button"
                    size="sm"
                    variant="neutral"
                    onClick={handleAddNewTag}
                    className="h-9 px-4"
                    disabled={!newTagName.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipWrapper>
              </div>
            </div>

            {/* Selected Tags Summary */}
            {(tagsToAdd.size > 0 || tagsToRemove.size > 0) && (
              <div className="p-3 rounded-md border border-border/55 bg-muted/20">
                <Label className="text-sm font-medium text-foreground mb-2 block">Selected Changes</Label>
                <div className="flex flex-wrap gap-2">
                  {Array.from(tagsToAdd).map((tag) => (
                    <Badge key={`add-${tag}`} variant="default" className="gap-1.5 px-2 py-1 text-xs">
                      <Plus className="h-3 w-3" />
                      {tag}
                      <X 
                        className="h-3 w-3 cursor-pointer hover:bg-accent rounded" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFromAdd(tag);
                        }}
                      />
                    </Badge>
                  ))}
                  {Array.from(tagsToRemove).map((tag) => (
                    <Badge key={`remove-${tag}`} variant="destructive" className="gap-1.5 px-2 py-1 text-xs">
                      <X className="h-3 w-3" />
                      {tag}
                      <X 
                        className="h-3 w-3 cursor-pointer hover:bg-destructive/20 rounded" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFromRemove(tag);
                        }}
                      />
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Category Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Folder className="h-5 w-5 text-muted-foreground" />
              <Label className="text-base font-semibold">Category</Label>
            </div>

            {/* Current Category */}
            {currentCategories.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Current Category</Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-md border border-border/55 bg-muted/10">
                  {currentCategories.map((cat) => (
                    <Badge
                      key={cat}
                      variant={categoryToSet === null ? "destructive" : categoryToSet === cat ? "default" : "outline"}
                      className={cn(
                        "gap-1.5 px-2 py-1 text-xs",
                        categoryToSet === null && "line-through opacity-60",
                        categoryToSet !== null && categoryToSet !== cat && "cursor-pointer"
                      )}
                      onClick={() => {
                        if (categoryToSet === cat) {
                          setCategoryToSet(undefined);
                        } else if (categoryToSet === null) {
                          setCategoryToSet(undefined);
                        } else {
                          setCategoryToSet(cat);
                        }
                      }}
                    >
                      {cat}
                      {categoryToSet === null && <X className="h-3 w-3" />}
                      {categoryToSet === cat && (
                        <X 
                          className="h-3 w-3 cursor-pointer hover:bg-accent rounded" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setCategoryToSet(undefined);
                          }}
                        />
                      )}
                    </Badge>
                  ))}
                  {categoryToSet === null && (
                    <Badge variant="destructive" className="gap-1.5 px-2 py-1 text-xs">
                      Remove Category
                      <X 
                        className="h-3 w-3 cursor-pointer hover:bg-destructive/20 rounded" 
                        onClick={(e) => {
                          e.stopPropagation();
                          setCategoryToSet(undefined);
                        }}
                      />
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Available Categories */}
            {allCategories.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Available Categories (click to set)</Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-md border border-border/55 bg-muted/10">
                  {allCategories.map((cat) => {
                    const isSelected = categoryToSet === cat;
                    const isCurrent = currentCategories.includes(cat);
                    
                    return (
                      <Badge
                        key={cat}
                        variant={isSelected ? "default" : "outline"}
                        className={cn(
                          "cursor-pointer gap-1.5 px-2 py-1 text-xs",
                          isSelected && "bg-accent text-foreground",
                          isCurrent && !isSelected && "bg-muted"
                        )}
                        onClick={() => {
                          if (isSelected) {
                            setCategoryToSet(undefined);
                          } else {
                            setCategoryToSet(cat);
                          }
                        }}
                      >
                        {cat}
                        {isSelected && (
                          <X 
                            className="h-3 w-3 cursor-pointer hover:bg-accent rounded" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setCategoryToSet(undefined);
                            }}
                          />
                        )}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Remove Category Option */}
            {currentCategories.length > 0 && categoryToSet !== null && (
              <TooltipWrapper title="Remove category" description="Clear category on all selected notes.">
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => setCategoryToSet(null)}
                  className="h-9 gap-2 text-destructive hover:text-destructive hover:border-destructive"
                >
                  <X className="h-4 w-4" />
                  Remove Category
                </Button>
              </TooltipWrapper>
            )}

            {/* Create New Category */}
            {newCategoryName ? (
              <div className="flex items-center gap-2 p-3 rounded-md border border-border/55 bg-muted/20">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreateNewCategory();
                    } else if (e.key === "Escape") {
                      setNewCategoryName("");
                    }
                  }}
                  placeholder="Enter category name..."
                  className="h-9 flex-1"
                  autoFocus
                />
                <TooltipWrapper title="Create category" description="Create the category and set it for selected notes.">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreateNewCategory}
                    className="h-9 px-4"
                    disabled={!newCategoryName.trim()}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Create
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper title="Cancel" description="Clear and cancel new category.">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setNewCategoryName("")}
                    className="h-9 px-3"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipWrapper>
              </div>
            ) : (
              <TooltipWrapper title="Create new category" description="Add a new category and set it for selected notes.">
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => setNewCategoryName(" ")}
                  className="w-full h-9 gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create New Category
                </Button>
              </TooltipWrapper>
            )}
          </div>
        </div>

        <DialogFooter className="surface-subtle sticky bottom-0 z-10 border-t border-border/55 px-6 py-4">
          <TooltipWrapper title="Cancel" description="Close without applying changes.">
            <Button variant="neutral" onClick={handleClose} disabled={isApplying}>
              Cancel
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Apply" description="Apply changes to all selected notes.">
            <Button
              onClick={handleApply}
              disabled={!hasChanges || isApplying}
              className="min-w-[140px]"
            >
            {isApplying ? (
              <>Applying...</>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Apply to {selectedNotes.length} Note{selectedNotes.length !== 1 ? "s" : ""}
              </>
            )}
            </Button>
          </TooltipWrapper>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
