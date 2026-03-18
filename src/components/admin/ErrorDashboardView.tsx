import { useState } from "react";
import { useErrorStore, type CapturedError } from "@/stores/errorStore";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertTriangle, Clipboard, Trash } from "@/lib/icons";

export function ErrorDashboardView() {
  const errors = useErrorStore((s) => s.errors);
  const clearErrors = useErrorStore((s) => s.clear);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const copyError = (error: CapturedError) => {
    const text = [
      `Error: ${error.message}`,
      `Source: ${error.source}`,
      `Time: ${error.timestamp}`,
      `Count: ${error.count}`,
      error.stack ? `\nStack:\n${error.stack}` : "",
    ].join("\n");
    navigator.clipboard.writeText(text);
  };

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
      {/* Stats bar */}
      <div className="ui-panel-shell rounded-lg">
        <div className="flex items-center gap-4 px-4 py-3">
          <span className="text-sm font-semibold tabular-nums">{errors.length}</span>
          <span className="text-caption">
            unique error{errors.length !== 1 ? "s" : ""} captured
          </span>
          <span className="text-caption tabular-nums">
            ({errors.reduce((s, e) => s + e.count, 0)} total occurrences)
          </span>
          <div className="ml-auto">
            <Button
              variant="destructive"
              size="sm"
              onClick={clearErrors}
              disabled={errors.length === 0}
              className="h-7 text-xs"
            >
              <Trash className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      </div>

      {/* Error list */}
      <div className="flex-1 overflow-auto ui-panel-shell rounded-lg relative">
        {errors.length === 0 ? (
          <div className="flex items-center justify-center h-full p-6">
            <EmptyState
              icon={<AlertTriangle className="h-7 w-7" />}
              title="No errors captured"
              description="Unhandled errors and promise rejections will appear here."
            />
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {errors.map((error) => {
              const isExpanded = expandedId === error.id;
              return (
                <div key={error.id}>
                  <div
                    className="list-row border-l-2 border-l-destructive/40 flex items-center gap-3 px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : error.id)}
                  >
                    <span className="text-caption tabular-nums w-[70px] flex-shrink-0">
                      {formatTimestamp(error.timestamp)}
                    </span>
                    <span className="text-body text-xs flex-1 truncate">
                      {error.message}
                    </span>
                    <span className="text-caption text-2xs truncate max-w-[150px]">
                      {error.source}
                    </span>
                    {error.count > 1 && (
                      <span className="chip rounded-lg bg-secondary px-2 py-0.5 text-2xs tabular-nums">
                        x{error.count}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyError(error);
                      }}
                    >
                      <Clipboard className="h-3 w-3" />
                    </Button>
                  </div>
                  {isExpanded && error.stack && (
                    <div className="bg-background/50 rounded-md p-3 shadow-inner text-xs font-mono mx-4 mb-3 whitespace-pre-wrap break-all max-h-[300px] overflow-auto">
                      {error.stack}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
