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
import { UpdateAvailableButton } from "@/components/layout/header-items/UpdateAvailableButton";
import { KnowledgeBaseButton } from "@/components/layout/header-items/KnowledgeBaseButton";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ExecutionContextSelector } from "@/components/ui/execution-context-selector";
import { tooltips } from "@/lib/tooltips";
import clsx from "clsx";
import styles from "./header.module.css";
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from "@/lib/icons";
import { Flex, Group, UnstyledButton } from "@mantine/core";

interface HeaderProps {
  onNotificationClick: () => void;
  onNotesClick: () => void;
  onKnowledgeBaseClick: () => void;
  onSettingsClick: () => void;
  hasUpdateAvailable: boolean;
}

export function Header({
  onNotificationClick,
  onNotesClick,
  onKnowledgeBaseClick,
  onSettingsClick,
  hasUpdateAvailable,
}: HeaderProps) {
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
      role="banner"
      className={clsx(
        "app-header app-titlebar app-chrome-surface",
        styles.headerRoot,
        isMac && styles.headerMac,
      )}
      onMouseDown={handleWindowDrag}
      onDoubleClick={handleDoubleClick}
    >
      {/* ── Left: sidebar toggle ── */}
      <Flex
        align="center"
        className={clsx(styles.left, isMac && styles.leftMac)}
      >
        <Flex align="center" className={styles.sidebarToggleWrap}>
          <TooltipWrapper
            entry={isSidebarCollapsed ? tooltips.sidebarExpand : tooltips.sidebarCollapse}
            side="bottom"
          >
            <UnstyledButton
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
            </UnstyledButton>
          </TooltipWrapper>
        </Flex>
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
      </Flex>

      {/* ── Center: dead-center title, arrows on both sides ── */}
      <div className={clsx(styles.centerWrap, "app-chrome-content-swap")}>
        <Flex align="center" className={styles.centerInner}>
          <div className={styles.navCluster}>
            <TooltipWrapper title="Back" side="bottom">
              <UnstyledButton
                type="button"
                onClick={handleBack}
                className={clsx("header-icon-button ui-hover-press", styles.navBtn)}
                aria-label="Go back"
              >
                <ChevronLeft className={styles.navBtnIcon} />
              </UnstyledButton>
            </TooltipWrapper>
          </div>
          <div className={styles.titleCluster}>
            <Group gap="xs" wrap="nowrap" className={styles.titleRow}>
              <ToolTitle />
              <BreadcrumbNav />
            </Group>
          </div>
          <div className={styles.forwardWrap}>
            <TooltipWrapper title="Forward" side="bottom">
              <UnstyledButton
                type="button"
                onClick={handleForward}
                className={clsx("header-icon-button ui-hover-press", styles.navBtn)}
                aria-label="Go forward"
              >
                <ChevronRight className={styles.navBtnIcon} />
              </UnstyledButton>
            </TooltipWrapper>
          </div>
        </Flex>
      </div>

      {/* ── Search slot between center cluster and right actions ── */}
      <div
        className={clsx(styles.searchSlot, "app-chrome-content-swap")}
        role="search"
        aria-label="Global search"
      >
        <SearchButton variant="field" />
      </div>

      {/* ── Right: global actions ── */}
      <Group
        component="div"
        gap={3}
        wrap="nowrap"
        className={clsx(styles.right, "app-chrome-content-swap")}
        role="toolbar"
        aria-label="Global actions"
      >
        <KnowledgeBaseButton onClick={onKnowledgeBaseClick} />
        <NotesButton onClick={onNotesClick} />
        <NotificationBell onClick={onNotificationClick} />
        {hasUpdateAvailable ? (
          <UpdateAvailableButton hasUpdate={hasUpdateAvailable} onClick={onSettingsClick} />
        ) : null}

        <div className={styles.divider} aria-hidden />

        <IpBadge />
        <SettingsButton onClick={onSettingsClick} />
        {!isMac && <WindowControls />}
      </Group>
    </header>
  );
}

