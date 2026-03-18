import React, { Component, memo, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { useToolStore } from "@/stores/toolStore";
import { toolRegistry, type ToolDefinition } from "@/lib/toolRegistry";
import { HOME_TOOL_ID } from "@/lib/toolRegistry";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { createDefaultContextMenuContext, type ContextMenuContext } from "@/types/contextMenu";
import { trackContextMenuOpen } from "@/lib/contextMenuTelemetry";
import { AlertTriangle, RefreshCw } from "@/lib/icons";

const HAS_CONTEXT_MENU_ATTR = "data-has-context-menu";
export const ActiveToolPanelContext = React.createContext<{ toolId: string; isActive: boolean } | null>(null);

/**
 * Right-click on this area opens the app-wide contextual menu, unless the target
 * is inside an element with data-has-context-menu (e.g. packet row with its own menu).
 */
function useGlobalContextMenuHandler() {
  const openAt = useContextMenuStore((s) => s.openAt);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const lastViewedSubviews = useToolStore((s) => s.lastViewedSubviews);

  const buildMenuContext = useCallback((target: HTMLElement): ContextMenuContext => {
    const subviewId = activeToolId ? lastViewedSubviews[activeToolId] ?? null : null;
    const base = createDefaultContextMenuContext({
      toolId: activeToolId ?? null,
      subviewId,
      target,
    });
    const tag = target.tagName.toLowerCase();
    const editable =
      target.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      target.getAttribute("role") === "textbox";
    const inTableRow = !!target.closest("[role='row'], tr, [data-packet-row='true']");
    const inTerminal = !!target.closest("[data-terminal='true'], [data-xterm='true'], .xterm");
    const inTab = !!target.closest("[role='tab'], [data-terminal-tab='true']");

    return {
      ...base,
      surface: inTerminal ? "terminal" : inTab ? "tab" : inTableRow ? "tableRow" : editable ? "editor" : "toolPanel",
      entity: inTableRow ? "packet" : inTerminal ? "session" : inTab ? "terminalTab" : editable ? "editor" : "generic",
      capabilities: {
        canEdit: editable,
        canCut: editable,
        canCopy: true,
        canPaste: editable,
        canSelectAll: editable || inTerminal || inTableRow,
        canDelete: true,
        canExport: !!inTableRow,
      },
    };
  }, [activeToolId, lastViewedSubviews]);

  return useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(`[${HAS_CONTEXT_MENU_ATTR}]`)) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const menuContext = buildMenuContext(target);
      trackContextMenuOpen(menuContext);
      openAt(e.clientX, e.clientY, menuContext);
    },
    [buildMenuContext, openAt],
  );
}

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
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-smooth hover:bg-primary/90"
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
  onContextMenu,
}: {
  tool: ToolDefinition;
  isActive: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const ToolComponent = tool.component;
  const shouldUseUnifiedWidth = tool.id !== HOME_TOOL_ID;

  return (
    <div
      style={{ display: isActive ? "flex" : "none" }}
      className="flex-1 min-h-0 w-full flex flex-col"
      onContextMenu={onContextMenu}
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
 */
export function ToolContainer() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const activeTool = activeToolId
    ? (toolRegistry.get(activeToolId) ?? toolRegistry.get(HOME_TOOL_ID))
    : toolRegistry.get(HOME_TOOL_ID);
  const [mountedToolIds, setMountedToolIds] = useState<string[]>([HOME_TOOL_ID]);
  const onContextMenu = useGlobalContextMenuHandler();

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
        <ToolPanel
          key={tool.id}
          tool={tool}
          isActive={tool.id === resolvedActiveToolId}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

/** Attribute to set on elements that have their own context menu (e.g. packet row). Right-clicks there will not open the global menu. */
export const DATA_HAS_CONTEXT_MENU = HAS_CONTEXT_MENU_ATTR;
