import { useState, useEffect, useMemo } from "react";
import { useNoteStore } from "@/stores/noteStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Search, X } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface AdvancedSearchProps {
  onResults: (notes: any[]) => void;
  onClose?: () => void;
}

export function AdvancedSearch({ onResults, onClose }: AdvancedSearchProps) {
  const searchNotesAdvanced = useNoteStore((s) => s.searchNotesAdvanced);
  const folders = useNoteStore((s) => s.folders);
  const allTags = useNoteStore((s) => s.allTags);
  const getAllTags = useNoteStore((s) => s.getAllTags);
  const fetchFolders = useNoteStore((s) => s.fetchFolders);
  const notes = useNoteStore((s) => s.notes);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    notes.forEach((n) => n.category && cats.add(n.category));
    return Array.from(cats).sort();
  }, [notes]);

  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string | undefined>();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | undefined>();
  const [linkedRegistrarId, setLinkedRegistrarId] = useState<string | undefined>();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    fetchFolders();
    getAllTags();
  }, [fetchFolders, getAllTags]);

  const handleSearch = async () => {
    try {
      const results = await searchNotesAdvanced(
        query,
        folderId,
        selectedTags.length > 0 ? selectedTags : undefined,
        category,
        linkedRegistrarId,
        dateFrom || undefined,
        dateTo || undefined
      );
      onResults(results);
    } catch (error) {
      console.error("Search failed:", error);
    }
  };

  const handleClear = () => {
    setQuery("");
    setFolderId(undefined);
    setSelectedTags([]);
    setCategory(undefined);
    setLinkedRegistrarId(undefined);
    setDateFrom("");
    setDateTo("");
  };

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  return (
    <div className="p-4 space-y-4 border-b border-border bg-muted/20">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSearch();
            }
          }}
          placeholder="Search notes..."
          className="flex-1"
        />
        <TooltipWrapper title="Search" description="Run the search with current filters.">
          <Button size="sm" onClick={handleSearch} className="h-8">
            Search
          </Button>
        </TooltipWrapper>
        <TooltipWrapper title="Clear" description="Clear all search filters.">
          <Button size="sm" variant="ghost" onClick={handleClear} className="h-8">
            Clear
          </Button>
        </TooltipWrapper>
        {onClose && (
          <TooltipWrapper title="Close" description="Close advanced search.">
            <Button size="sm" variant="ghost" onClick={onClose} className="h-8">
              <X className="h-4 w-4" />
            </Button>
          </TooltipWrapper>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Folder</label>
          <Select value={folderId || "__all__"} onValueChange={(v) => setFolderId(v === "__all__" ? undefined : v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All folders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All folders</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
          <Select value={category || "__all__"} onValueChange={(v) => setCategory(v === "__all__" ? undefined : v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Date From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Date To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {allTags.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => (
              <Badge
                key={tag}
                variant={selectedTags.includes(tag) ? "default" : "secondary"}
                className={cn(
                  "text-xs h-6 cursor-pointer",
                  selectedTags.includes(tag) && "bg-accent text-foreground"
                )}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
