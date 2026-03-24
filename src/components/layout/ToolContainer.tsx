import React, { Component, memo, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { useToolStore } from "@/stores/toolStore";
import { toolRegistry, type ToolDefinition } from "@/lib/toolRegistry";
import { HOME_TOOL_ID } from "@/lib/toolRegistry";
import { AlertTriangle, RefreshCw } from "@/lib/icons";

/** Re-export for call sites that tag custom context menus. */
export { DATA_HAS_CONTEXT_MENU } from "@/hooks/useGlobalContextMenuHandler";

export const ActiveToolPanelContext = React.createContext<{ toolId: string; isActive: boolean } | null>(null);

/**
 * Per-tool error boundary — catches errors within a single tool so one
 * broken tool doesn't take down the entire application.
 */
class ToolErrorBoundary extends Component<
  { toolName: string; children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.toolName}] Error:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
            <h3 className="text-lg font-semibold">{this.props.toolName} failed to load</h3>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-smooth hover:bg-primary/98"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Individual tool panel — memoized so it only re-renders when its own
 * visibility changes (isActive), not when a sibling tool becomes active.
 */
const ToolPanel = memo(function ToolPanel({
  tool,
  isActive,
}: {
  tool: ToolDefinition;
  isActive: boolean;
}) {
  const ToolComponent = tool.component;
  const shouldUseUnifiedWidth = tool.id !== HOME_TOOL_ID;

  return (
    <div
      style={{ display: isActive ? "flex" : "none" }}
      className="flex-1 min-h-0 w-full flex flex-col"
    >
      <ActiveToolPanelContext.Provider value={{ toolId: tool.id, isActive }}>
        <ToolErrorBoundary toolName={tool.name}>
          {shouldUseUnifiedWidth ? (
            <div className="app-tool-width flex-1 min-h-0 w-full flex flex-col">
              <ToolComponent />
            </div>
          ) : (
            <ToolComponent />
          )}
        </ToolErrorBoundary>
      </ActiveToolPanelContext.Provider>
    </div>
  );
});

/**
 * Renders all tools and shows only the active one (display toggle).
 * All tools stay mounted so switching views is instant—no unmount/mount.
 *
 * Global right-click menu is handled on the app shell (`App.tsx`), not here,
 * so the sidebar and header are included.
 */
export function ToolContainer() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeTool = activeToolId
    ? (toolRegistry.get(activeToolId) ?? toolRegistry.get(HOME_TOOL_ID))
    : toolRegistry.get(HOME_TOOL_ID);
  const [mountedToolIds, setMountedToolIds] = useState<string[]>([HOME_TOOL_ID]);

  useEffect(() => {
    if (!activeTool) return;
    setMountedToolIds((prev) => (prev.includes(activeTool.id) ? prev : [...prev, activeTool.id]));
  }, [activeTool]);

  if (!activeTool) return null;

  const resolvedActiveToolId = activeTool.id;
  const mountedTools = useMemo(
    () =>
      mountedToolIds
        .map((id) => toolRegistry.get(id))
        .filter((tool): tool is ToolDefinition => !!tool),
    [mountedToolIds]
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {mountedTools.map((tool) => (
        <ToolPanel key={tool.id} tool={tool} isActive={tool.id === resolvedActiveToolId} />
      ))}
    </div>
  );
}
