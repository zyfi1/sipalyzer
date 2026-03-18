import { useState, useEffect } from "react";
import { invokeTauri } from "@/api/invoke";
import { deleteSavedFilter } from "@/api/packetCapture";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Trash2, Filter, Loader2 } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { useNotifications } from "@/hooks/useNotifications";
import type { FilterConfig } from "@/types/packetCapture";

interface SavedFilter {
  id: string;
  name: string;
  filterConfig: FilterConfig;
  bpfExpression?: string;
  createdAt: string;
}

interface SavedFiltersPanelProps {
  onLoadFilter: (filter: FilterConfig) => void;
}

export function SavedFiltersPanel({ onLoadFilter }: SavedFiltersPanelProps) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const { notify } = useNotifications();

  useEffect(() => {
    fetchFilters();
  }, []);

  const fetchFilters = async () => {
    try {
      setLoading(true);
      const savedFilters = await invokeTauri<SavedFilter[]>("list_saved_filters");
      setFilters(savedFilters);
    } catch (error: any) {
      notify({
        type: "error",
        title: "Failed to Load Filters",
        description: error.message || "Unknown error",
        source: "packet-capture",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSavedFilter(id);
      await fetchFilters();
      notify({
        type: "success",
        title: "Filter Deleted",
        description: "Saved filter has been deleted",
        source: "packet-capture",
      });
    } catch (error: any) {
      notify({
        type: "error",
        title: "Failed to Delete Filter",
        description: error.message || "Unknown error",
        source: "packet-capture",
      });
    }
  };

  const handleLoad = (filter: SavedFilter) => {
    onLoadFilter(filter.filterConfig);
    notify({
      type: "success",
      title: "Filter Loaded",
      description: `Loaded filter: ${filter.name}`,
      source: "packet-capture",
    });
  };

  if (loading) {
    return (
      <Card className="ui-surface-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="ui-surface-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Filter className="h-4 w-4" />
          Saved Filters
        </CardTitle>
      </CardHeader>
      <CardContent>
        {filters.length === 0 ? (
          <EmptyState compact variant="inline" title="No saved filters" description="Save a filter from the filter dialog." />
        ) : (
          <div className="space-y-2">
            {filters.map((filter) => (
              <div
                key={filter.id}
                className="ui-surface-card flex items-center justify-between p-2 hover:bg-muted/30"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{filter.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {filter.filterConfig.protocols.length} protocols
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <TooltipWrapper entry={tooltips.captureSavedFilterLoad}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleLoad(filter)}
                      className="h-7 px-2"
                    >
                      Load
                    </Button>
                  </TooltipWrapper>
                  <TooltipWrapper entry={tooltips.captureSavedFilterDelete}>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(filter.id)}
                      className="h-7 px-2"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
