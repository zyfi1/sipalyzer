/**
 * Header — main app header bar.
 *
 * Static layout, no user customization.
 * Left:  sidebar toggle + expanded search + tool subview widget.
 * Right: global actions + connection/IP status icon + settings + window controls.
 */

import React, { useCallback } from "react";
import { WindowControls } from "@/components/layout/WindowControls";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSidebarStore } from "@/stores/sidebarStore";
import { useToolStore } from "@/stores/toolStore";
import { useBreadcrumbStore } from "@/stores/breadcrumbStore";
import { IpBadge } from "@/components/layout/header-items/IpBadge";
import { SearchButton } from "@/components/layout/header-items/SearchButton";
import { ToolTitle } from "@/components/layout/header-items/ToolTitle";
import { BreadcrumbNav } from "@/components/layout/header-items/BreadcrumbNav";
import { NotesButton } from "@/components/layout/header-items/NotesButton";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { SettingsButton } from "@/components/layout/header-items/SettingsButton";
import { KnowledgeBaseButton } from "@/components/layout/header-items/KnowledgeBaseButton";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ExecutionContextSelector } from "@/components/ui/execution-context-selector";
import { tooltips } from "@/lib/tooltips";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from "@/lib/icons";

interface HeaderProps {
  onNotificationClick: () => void;
  onNotesClick: () => void;
  onKnowledgeBaseClick: () => void;
  onSettingsClick: () => void;
}

export function Header({ onNotificationClick, onNotesClick, onKnowledgeBaseClick, onSettingsClick }: HeaderProps) {
  const isSidebarCollapsed = useSidebarStore((s) => s.isCollapsed);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const execToolId = useBreadcrumbStore((s) =>
    activeToolId ? s.execToolIds[activeToolId] : undefined,
  );

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  const handleWindowDrag = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    // Workaround: tao macOS may panic in start_dragging when currentEvent is nil.
    if (isMac) return;
    try { getCurrentWindow().startDragging(); } catch { /* no Tauri runtime */ }
  }, [isMac]);

  const handleDoubleClick = useCallback(async (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    try {
      const win = getCurrentWindow();
      const isMax = await win.isMaximized();
      if (isMax) await win.unmaximize();
      else await win.maximize();
    } catch {
      try { getCurrentWindow().toggleMaximize(); } catch { /* ignore */ }
    }
  }, []);

  const handleBack = useCallback(() => {
    window.history.back();
  }, []);

  const handleForward = useCallback(() => {
    window.history.forward();
  }, []);

  return (
    <header
      className={cn("app-header app-titlebar app-chrome-surface relative !gap-0", isMac && "h-10")}
      onMouseDown={handleWindowDrag}
      onDoubleClick={handleDoubleClick}
    >
      {/* ── Left: sidebar toggle ── */}
      <div className={cn(
        "flex-1 min-w-0 flex items-center pl-0 pr-1 overflow-hidden pointer-events-none [&>*]:pointer-events-auto",
        isMac && "pl-20"
      )}>
        <div
          className={cn("shrink-0 flex items-center w-16 justify-center")}
        >
          <TooltipWrapper
            entry={isSidebarCollapsed ? tooltips.sidebarExpand : tooltips.sidebarCollapse}
            side="bottom"
          >
            <button
              type="button"
              onClick={toggleSidebar}
              className="header-icon-button h-7 w-7 ui-hover-press motion-reduce:transform-none"
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </TooltipWrapper>
        </div>
        <div className="inline-flex items-center min-w-0">
          <div id="header-tool-widget" className="flex items-center gap-2 min-w-0 mr-4">
            <div
              id="header-tool-widget-custom"
              className="flex items-center gap-2 min-w-0 max-w-[min(36vw,440px)] overflow-hidden"
            />
            {execToolId && (
              <div id="header-tool-widget-exec" className="flex items-center shrink-0">
                <ExecutionContextSelector
                  toolId={execToolId}
                  variant="header"
                  className="w-[150px] max-w-[150px]"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Center: dead-center title, arrows on both sides ── */}
      <div className="absolute left-1/2 -translate-x-1/2 max-w-[44vw] min-w-0 pointer-events-none app-chrome-content-swap">
        <div className="relative inline-flex items-center min-w-0 pointer-events-auto">
          <div className="absolute right-full mr-2">
            <TooltipWrapper title="Back" side="bottom">
              <button
                type="button"
                onClick={handleBack}
                className="header-icon-button h-6 w-6 ui-hover-press motion-reduce:transform-none"
                aria-label="Go back"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </TooltipWrapper>
          </div>
          <div className="inline-flex items-center min-w-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 bg-sidebar/75">
            <div className="flex items-center gap-1 min-w-0">
              <ToolTitle />
              <BreadcrumbNav />
            </div>
          </div>
          <div className="absolute left-full ml-2">
            <TooltipWrapper title="Forward" side="bottom">
              <button
                type="button"
                onClick={handleForward}
                className="header-icon-button h-6 w-6 ui-hover-press motion-reduce:transform-none"
                aria-label="Go forward"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </TooltipWrapper>
          </div>
        </div>
      </div>

      {/* ── Search slot between center cluster and right actions ── */}
      <div className="w-[210px] max-w-[24vw] min-w-[160px] mr-2 app-chrome-content-swap">
        <SearchButton variant="field" />
      </div>

      {/* ── Right: global actions ── */}
      <div className="flex items-center flex-shrink-0 gap-0.5 pr-1 app-chrome-content-swap">
        <KnowledgeBaseButton onClick={onKnowledgeBaseClick} />
        <NotesButton onClick={onNotesClick} />
        <NotificationBell onClick={onNotificationClick} />

        <div className="w-px h-5 bg-border/50 flex-shrink-0 mx-1" aria-hidden />

        <IpBadge />
        <SettingsButton onClick={onSettingsClick} />
        {!isMac && <WindowControls />}
      </div>
    </header>
  );
}

