import { useState, useMemo } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Search, Filter, X, Star, FolderOpen, Tag } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface NoteFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  folderId: string | null;
  onFolderChange: (id: string | null) => void;
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearTags: () => void;
  linkedRegistrarFilter: string | null;
  onRegistrarChange: (id: string | null) => void;
  showPinnedOnly: boolean;
  onPinnedToggle: () => void;
  noteCount: number;
  filteredCount: number;
}

export function NoteFilterBar({
  searchQuery,
  onSearchChange,
  folderId,
  onFolderChange,
  selectedTags,
  onTagToggle,
  onClearTags,
  linkedRegistrarFilter,
  onRegistrarChange,
  showPinnedOnly,
  onPinnedToggle,
  noteCount,
  filteredCount,
}: NoteFilterBarProps) {
  const folders = useNoteStore((s) => s.folders);
  const allTags = useNoteStore((s) => s.allTags);
  const registrars = useRegistrationStore((s) => s.registrars);

  const [expanded, setExpanded] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (folderId) count++;
    if (selectedTags.length > 0) count++;
    if (linkedRegistrarFilter) count++;
    if (showPinnedOnly) count++;
    return count;
  }, [folderId, selectedTags, linkedRegistrarFilter, showPinnedOnly]);

  const hasAnyFilter = activeFilterCount > 0 || searchQuery.trim().length > 0;

  const handleClearAll = () => {
    onSearchChange("");
    onFolderChange(null);
    onClearTags();
    onRegistrarChange(null);
    if (showPinnedOnly) onPinnedToggle();
  };

  return (
    <div className="panel-tight space-y-0">
      {/* Always-visible top row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search notes…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-8 text-sm ui-control-shell"
          />
          {searchQuery && (
            <TooltipWrapper title="Clear search">
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-smooth"
              >
                <X className="h-3 w-3" />
              </button>
            </TooltipWrapper>
          )}
        </div>

        <TooltipWrapper
          title={showPinnedOnly ? "Show all notes" : "Show pinned only"}
          description="Toggle whether only pinned notes are shown."
          delayDuration={0}
        >
          <span className="inline-flex">
            <Button
              variant={showPinnedOnly ? "primary" : "ghost"}
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onPinnedToggle}
            >
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  showPinnedOnly && "fill-current",
                )}
              />
            </Button>
          </span>
        </TooltipWrapper>

        <TooltipWrapper
          title="Filters"
          description="Filter notes by pinned state, folder, tags, or registrar."
          delayDuration={0}
        >
          <span className="inline-flex">
            <Button
              variant={activeFilterCount > 0 ? "primary" : "ghost"}
              size="icon"
              className="h-8 w-8 shrink-0 relative"
              onClick={() => setExpanded((prev) => !prev)}
            >
              <Filter className="h-3.5 w-3.5" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-medium tabular-nums">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </span>
        </TooltipWrapper>
      </div>

      {/* Note count */}
      <div className="px-3 pb-1.5">
        <span className="text-2xs text-muted-foreground tabular-nums">
          {filteredCount} of {noteCount} notes
        </span>
      </div>

      {/* Collapsible filter section */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
          expanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3">
          {/* Folder filter */}
          <div className="space-y-1">
            <TooltipWrapper title="Filter by folder">
              <span className="section-label-sm flex items-center gap-1 cursor-help">
                <FolderOpen className="h-3 w-3" />
                Folder
              </span>
            </TooltipWrapper>
            <AppDropdown
              value={folderId ?? "__all__"}
              onValueChange={(v) => onFolderChange(v === "__all__" ? null : v)}
              placeholder="All Folders"
              className="h-8 text-sm"
              options={[
                { value: "__all__", label: "All Folders" },
                ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
              ]}
            />
          </div>

          {/* Tags filter */}
          {allTags.length > 0 && (
            <div className="space-y-1.5">
              <TooltipWrapper title="Filter by tags">
                <span className="section-label-sm flex items-center gap-1 cursor-help">
                  <Tag className="h-3 w-3" />
                  Tags
                </span>
              </TooltipWrapper>
              <div className="flex flex-wrap gap-1">
                {allTags.map((tag) => {
                  const isSelected = selectedTags.includes(tag);
                  return (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className={cn(
                        "cursor-pointer text-[10px] h-5 px-1.5 transition-smooth",
                        isSelected
                          ? "bg-primary/10 text-primary border-primary/20"
                          : "hover:bg-muted/40",
                      )}
                      onClick={() => onTagToggle(tag)}
                    >
                      {tag}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Registrar filter */}
          {registrars.length > 0 && (
            <div className="space-y-1">
              <TooltipWrapper title="Filter by registrar">
                <span className="section-label-sm cursor-help">Registrar</span>
              </TooltipWrapper>
              <AppDropdown
                value={linkedRegistrarFilter ?? "__all__"}
                onValueChange={(v) =>
                  onRegistrarChange(v === "__all__" ? null : v)
                }
                placeholder="All Registrars"
                className="h-8 text-sm"
                options={[
                  { value: "__all__", label: "All Registrars" },
                  ...registrars.map((r) => ({
                    value: r.id ?? r.name,
                    label: r.name,
                  })),
                ]}
              />
            </div>
          )}

          {/* Clear all */}
          {hasAnyFilter && (
            <TooltipWrapper title="Clear all filters">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-muted-foreground hover:text-foreground"
                onClick={handleClearAll}
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Clear all filters
              </Button>
            </TooltipWrapper>
          )}
        </div>
      </div>
    </div>
  );
}
