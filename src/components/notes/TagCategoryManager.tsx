import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Folder, Tag, Plus, Trash2, X, ChevronDown, ChevronUp, Check } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/notes";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

interface TagCategoryManagerProps {
  notes: Note[];
  availableCategories: string[];
  availableTags: string[];
  onAddCategory: (name: string) => void;
  onDeleteCategory: (name: string) => void;
  onAddTag: (name: string) => void;
  onDeleteTag: (name: string) => void;
  onAssignCategory: (noteId: string, category: string | undefined) => void;
  onAssignTag: (noteId: string, tag: string, add: boolean) => void;
  onBulkAssignCategory: (noteIds: string[], category: string | undefined) => void;
  onBulkAssignTag: (noteIds: string[], tag: string, add: boolean) => void;
  selectedNoteIds?: Set<string>;
}

export function TagCategoryManager({
  notes,
  availableCategories,
  availableTags,
  onAddCategory,
  onDeleteCategory,
  onAddTag,
  onDeleteTag,
  onAssignCategory: _onAssignCategory,
  onAssignTag: _onAssignTag,
  onBulkAssignCategory: _onBulkAssignCategory,
  onBulkAssignTag: _onBulkAssignTag,
  selectedNoteIds: _selectedNoteIds = new Set(),
}: TagCategoryManagerProps) {
  const [newCategory, setNewCategory] = useState("");
  const [newTag, setNewTag] = useState("");
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddTag, setShowAddTag] = useState(false);
  const addCategoryRef = useRef<HTMLDivElement>(null);
  const addTagRef = useRef<HTMLDivElement>(null);

  // Click away handling
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addCategoryRef.current && !addCategoryRef.current.contains(event.target as Node)) {
        setShowAddCategory(false);
        setNewCategory("");
      }
      if (addTagRef.current && !addTagRef.current.contains(event.target as Node)) {
        setShowAddTag(false);
        setNewTag("");
      }
    };

    if (showAddCategory || showAddTag) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showAddCategory, showAddTag]);

  // Get all categories from notes + available
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    notes.forEach(note => {
      if (note.category) cats.add(note.category);
    });
    availableCategories.forEach(cat => cats.add(cat));
    return Array.from(cats).sort();
  }, [notes, availableCategories]);

  // Get all tags from notes + available
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    notes.forEach(note => {
      note.tags.forEach(tag => tagSet.add(tag));
    });
    availableTags.forEach(tag => tagSet.add(tag));
    return Array.from(tagSet).sort();
  }, [notes, availableTags]);

  // Category usage counts
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach(note => {
      if (note.category) {
        counts.set(note.category, (counts.get(note.category) || 0) + 1);
      }
    });
    return counts;
  }, [notes]);

  // Tag usage counts
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach(note => {
      note.tags.forEach(tag => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return counts;
  }, [notes]);

  const handleAddCategory = () => {
    const trimmed = newCategory.trim();
    if (trimmed && !allCategories.includes(trimmed)) {
      onAddCategory(trimmed);
      setNewCategory("");
      setShowAddCategory(false);
    }
  };

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (trimmed && !allTags.includes(trimmed)) {
      onAddTag(trimmed);
      setNewTag("");
      setShowAddTag(false);
    }
  };





  return (
    <div className="w-80 border-r border-border bg-muted/20 flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-semibold mb-1.5">Organize Notes</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Select notes and use buttons below to assign categories and tags, or use quick actions on note cards
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Categories Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TooltipWrapper title={categoriesExpanded ? "Collapse categories" : "Expand categories"} description={categoriesExpanded ? "Hide the category list." : "Show the category list."}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setCategoriesExpanded(!categoriesExpanded)}
                >
                  {categoriesExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronUp className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipWrapper>
              <Folder className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-xs font-semibold">Categories</h4>
              <Badge variant="secondary" className="text-2xs h-4 px-1.5">
                {allCategories.length}
              </Badge>
            </div>
            <TooltipWrapper title="Add category" description="Create a new category.">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setShowAddCategory(!showAddCategory)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipWrapper>
          </div>

          {showAddCategory && (
            <div ref={addCategoryRef} className="flex items-center gap-2 pl-6">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCategory();
                  } else if (e.key === "Escape") {
                    setNewCategory("");
                    setShowAddCategory(false);
                  }
                }}
                placeholder="Category name..."
                className="h-7 text-xs flex-1"
                autoFocus
              />
              <Button
                variant="neutral"
                size="sm"
                onClick={() => {
                  handleAddCategory();
                }}
                className="h-7 px-2"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          )}

          {categoriesExpanded && (
            <>
              {/* Category List with Actions */}
              <div className="space-y-2 pl-6">
                {allCategories.map((category) => {
                  const count = categoryCounts.get(category) || 0;
                  const hasSelectedNotes = _selectedNoteIds.size > 0;
                  
                  return (
                    <div
                      key={category}
                      className={cn(
                        "p-2.5 rounded-lg border transition-smooth group",
                        "border-border/50 hover:border-border hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Folder className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <Badge variant="secondary" className="text-xs flex-1 truncate font-medium">
                            {category}
                          </Badge>
                          <span className="text-2xs text-muted-foreground flex-shrink-0 font-medium">
                            {count}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {hasSelectedNotes && (
                            <TooltipWrapper title="Assign category" description={`Assign to ${_selectedNoteIds.size} selected note(s).`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  _onBulkAssignCategory(Array.from(_selectedNoteIds), category);
                                }}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Assign
                              </Button>
                            </TooltipWrapper>
                          )}
                          <TooltipWrapper title="Delete category" description="Remove this category from the list.">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteCategory(category);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TooltipWrapper>
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {allCategories.length === 0 && (
                  <EmptyState compact variant="inline" title="No categories yet" description="Create one above." />
                )}
              </div>
            </>
          )}
        </div>

        {/* Tags Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
            <TooltipWrapper title={tagsExpanded ? "Collapse tags" : "Expand tags"} description={tagsExpanded ? "Hide the tag list." : "Show the tag list."}>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setTagsExpanded(!tagsExpanded)}
              >
                {tagsExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipWrapper>
              <Tag className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-xs font-semibold">Tags</h4>
              <Badge variant="secondary" className="text-2xs h-4 px-1.5">
                {allTags.length}
              </Badge>
            </div>
            <TooltipWrapper title="Add tag" description="Create a new tag.">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setShowAddTag(!showAddTag)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipWrapper>
          </div>

          {showAddTag && (
            <div ref={addTagRef} className="flex items-center gap-2 pl-6">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  } else if (e.key === "Escape") {
                    setNewTag("");
                    setShowAddTag(false);
                  }
                }}
                placeholder="Tag name..."
                className="h-7 text-xs flex-1"
                autoFocus
              />
              <Button
                variant="neutral"
                size="sm"
                onClick={() => {
                  handleAddTag();
                }}
                className="h-7 px-2"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          )}

          {tagsExpanded && (
            <>
              {/* Tag List with Actions */}
              <div className="space-y-2 pl-6">
                {allTags.map((tag) => {
                  const count = tagCounts.get(tag) || 0;
                  const hasSelectedNotes = _selectedNoteIds.size > 0;
                  
                  return (
                    <div
                      key={tag}
                      className={cn(
                        "p-2.5 rounded-lg border transition-smooth group flex items-center justify-between",
                        "border-border/50 hover:border-border hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Tag className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <Badge
                          variant="secondary"
                          className="text-xs font-medium"
                        >
                          {tag}
                        </Badge>
                        <span className="text-2xs text-muted-foreground font-medium">
                          {count}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {hasSelectedNotes && (
                          <>
                            <TooltipWrapper title="Add tag" description={`Add to ${_selectedNoteIds.size} selected note(s).`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  _onBulkAssignTag(Array.from(_selectedNoteIds), tag, true);
                                }}
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Add
                              </Button>
                            </TooltipWrapper>
                            <TooltipWrapper title="Remove tag" description={`Remove from ${_selectedNoteIds.size} selected note(s).`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  _onBulkAssignTag(Array.from(_selectedNoteIds), tag, false);
                                }}
                              >
                                <X className="h-3 w-3 mr-1" />
                                Remove
                              </Button>
                            </TooltipWrapper>
                          </>
                        )}
                        <TooltipWrapper title="Delete tag" description="Remove this tag from the list.">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTag(tag);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TooltipWrapper>
                      </div>
                    </div>
                  );
                })}
                
                {allTags.length === 0 && (
                  <EmptyState compact variant="inline" title="No tags yet" description="Create one above." />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
