/**
 * Header — main app header bar.
 *
 * Static layout, no user customization.
 * Left:  sidebar toggle + tool subview widget.
 * Center (absolute): history back / global search trigger / forward (⌘K opens GlobalSearchDialog).
 * Right: global actions + IP + settings + window controls.
 */

import React, { useCallback } from "react";
import { WindowControls } from "@/components/layout/WindowControls";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSidebarStore } from "@/stores/sidebarStore";
import { useToolStore } from "@/stores/toolStore";
import { useBreadcrumbStore } from "@/stores/breadcrumbStore";
import { IpBadge } from "@/components/layout/header-items/IpBadge";
import { HeaderUnifiedOmniBar } from "@/components/layout/header-items/HeaderUnifiedOmniBar";
import { NotesButton } from "@/components/layout/header-items/NotesButton";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { SettingsButton } from "@/components/layout/header-items/SettingsButton";
import { KnowledgeBaseButton } from "@/components/layout/header-items/KnowledgeBaseButton";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ExecutionContextSelector } from "@/components/ui/execution-context-selector";
import { tooltips } from "@/lib/tooltips";
import clsx from "clsx";
import styles from "./header.module.css";
import { PanelLeftClose, PanelLeftOpen } from "@/lib/icons";

interface HeaderProps {
  onNotificationClick: () => void;
  onNotesClick: () => void;
  onKnowledgeBaseClick: () => void;
  onSettingsClick: () => void;
}

export function Header({
  onNotificationClick,
  onNotesClick,
  onKnowledgeBaseClick,
  onSettingsClick,
}: HeaderProps) {
  const isSidebarCollapsed = useSidebarStore((s) => s.isCollapsed);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const execToolId = useBreadcrumbStore((s) =>
    activeToolId ? s.execToolIds[activeToolId] : undefined,
  );

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const isInteractiveTarget = useCallback((target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return Boolean(
      el.closest(
        'button, a, input, textarea, select, [role="button"], [role="switch"], [data-no-window-drag="true"]',
      ),
    );
  }, []);

  /**
   * Drag: `startDragging()` on primary mousedown (all platforms). `data-tauri-drag-region` on
   * the header helps some WebViews but hits usually land on child divs, so JS drag is required.
   * Zoom: mousedown `detail === 2` + `toggleMaximize` (avoids `-webkit-app-region: drag`, which
   * blocks double-clicks on macOS WebKit).
   */
  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isInteractiveTarget(e.target)) return;
    if (e.detail === 2) {
      e.preventDefault();
      void getCurrentWindow().toggleMaximize().catch(() => {});
      return;
    }
    try {
      void getCurrentWindow().startDragging();
    } catch {
      /* no Tauri runtime */
    }
  }, [isInteractiveTarget]);

  return (
    <header
      role="banner"
      className={clsx(
        "app-header app-titlebar app-chrome-surface",
        styles.headerRoot,
        isMac && styles.headerMac,
      )}
      data-tauri-drag-region={isMac ? "" : undefined}
      onMouseDown={handleTitleMouseDown}
    >
      {/* ── Left: sidebar + header tool widgets ── */}
      <div
        className={clsx(styles.leftZone, isMac && styles.leftMac)}
      >
        <div className={styles.sidebarToggleWrap}>
          <TooltipWrapper
            entry={isSidebarCollapsed ? tooltips.sidebarExpand : tooltips.sidebarCollapse}
            side="bottom"
          >
            <button
              type="button"
              onClick={toggleSidebar}
              className={clsx("header-icon-button ui-hover-press", styles.sidebarToggle)}
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className={styles.sidebarToggleIcon} />
              ) : (
                <PanelLeftClose className={styles.sidebarToggleIcon} />
              )}
            </button>
          </TooltipWrapper>
        </div>
        <div className={styles.inlineRow}>
          <div id="header-tool-widget" className={styles.toolWidget}>
            <div
              id="header-tool-widget-custom"
              className={styles.toolWidgetCustom}
            />
            {execToolId && (
              <div id="header-tool-widget-exec" className={styles.execWrap}>
                <ExecutionContextSelector
                  toolId={execToolId}
                  className={styles.execSelector}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <HeaderUnifiedOmniBar />

      {/* ── Global icons (right-aligned) ── */}
      <div className={styles.trailingZone}>
        <div
          className={clsx(styles.right, "app-chrome-content-swap")}
          role="toolbar"
          aria-label="Global actions"
        >
          <KnowledgeBaseButton onClick={onKnowledgeBaseClick} />
          <NotesButton onClick={onNotesClick} />
          <NotificationBell onClick={onNotificationClick} />
          <div className={styles.divider} aria-hidden />

          <IpBadge />
          <SettingsButton onClick={onSettingsClick} />
          {!isMac && <WindowControls />}
        </div>
      </div>
    </header>
  );
}
