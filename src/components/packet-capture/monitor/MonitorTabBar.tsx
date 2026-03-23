import { useState, useCallback } from "react";
import { useMonitorTabStore, type MonitorTab } from "@/stores/monitorTabStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  X,
  Radio,
  Globe,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { LiveIndicator } from "@/components/ui/live-indicator";
import { CaptureTabRail } from "../shared/CaptureTabRail";
import {
  CAPTURE_TAB_PILL_ACTIVE_CLASS,
  CAPTURE_TAB_PILL_BASE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_CLASS,
  CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS,
  CAPTURE_TAB_PILL_INACTIVE_CLASS,
} from "../shared/tabPillStyles";

interface MonitorTabBarProps {
  onCloseTab?: (tabId: string) => void;
}

export function MonitorTabBar({ onCloseTab }: MonitorTabBarProps) {
  const tabs = useMonitorTabStore((s) => s.tabs);
  const activeTabId = useMonitorTabStore((s) => s.activeTabId);
  const setActiveTab = useMonitorTabStore((s) => s.setActiveTab);
  const closeTab = useMonitorTabStore((s) => s.closeTab);
  const reorderTabs = useMonitorTabStore((s) => s.reorderTabs);
  const addTab = useMonitorTabStore((s) => s.addTab);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [overTabId, setOverTabId] = useState<string | null>(null);

  const handleAddTab = useCallback(() => {
    addTab({ type: "local" });
  }, [addTab]);

  const handleClose = (tabId: string) => {
    if (onCloseTab) onCloseTab(tabId);
    else closeTab(tabId);
  };

  const handleDragStart = (tabId: string) => {
    setDraggedTabId(tabId);
    setOverTabId(tabId);
  };

  const handleDragEnter = (tabId: string) => {
    if (!draggedTabId) return;
    setOverTabId(tabId);
  };

  const handleDrop = (tabId: string) => {
    if (!draggedTabId) return;
    reorderTabs(draggedTabId, tabId);
    setDraggedTabId(null);
    setOverTabId(null);
  };

  const handleDragEnd = () => {
    setDraggedTabId(null);
    setOverTabId(null);
  };

  return (
    <CaptureTabRail
      items={tabs}
      getKey={(tab) => tab.id}
      renderItem={(tab) => (
        <TabPill
          tab={tab}
          isActive={tab.id === activeTabId}
          isDragSource={draggedTabId === tab.id}
          isDropTarget={!!draggedTabId && overTabId === tab.id && draggedTabId !== tab.id}
          onActivate={() => setActiveTab(tab.id)}
          onClose={() => handleClose(tab.id)}
          onDragStart={() => handleDragStart(tab.id)}
          onDragEnter={() => handleDragEnter(tab.id)}
          onDrop={() => handleDrop(tab.id)}
          onDragEnd={handleDragEnd}
        />
      )}
      beforeRightArrow={
        <Button
          variant="neutral"
          size="sm"
          className="h-[1.88rem] px-2 mr-[2px] shrink-0 text-xs"
          onClick={handleAddTab}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New
        </Button>
      }
    />
  );
}

function TabPill({
  tab,
  isActive,
  isDragSource,
  isDropTarget,
  onActivate,
  onClose,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: {
  tab: MonitorTab;
  isActive: boolean;
  isDragSource?: boolean;
  isDropTarget?: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const isRemote = tab.executionContext.type === "remote";

  return (
    <button
      type="button"
      onClick={onActivate}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        CAPTURE_TAB_PILL_BASE_CLASS,
        isActive ? CAPTURE_TAB_PILL_ACTIVE_CLASS : CAPTURE_TAB_PILL_INACTIVE_CLASS,
        isDragSource && "opacity-60",
        isDropTarget && "border-primary/55 bg-primary/10",
      )}>
      {isRemote
        ? <Globe className="h-3 w-3 text-info shrink-0" />
        : <Radio className="h-3 w-3 shrink-0 opacity-50" />}

      <span className="min-w-0 flex-1 max-w-[150px] truncate">{tab.label}</span>

      {tab.isCapturing && <LiveIndicator variant="dot" size="xs" />}

      {tab.packetCount > 0 && (
        <Badge
          variant="secondary"
          className={cn(
            "text-3xs h-4 px-1 tabular-nums ml-0.5 shrink-0",
            tab.isCapturing
              ? "bg-primary/12 text-primary border border-primary/30"
              : "bg-muted/40 text-muted-foreground border border-border/35",
          )}
        >
          {tab.packetCount >= 1000 ? `${(tab.packetCount / 1000).toFixed(1)}K` : tab.packetCount}
        </Badge>
      )}

      <span onClick={(e) => { e.stopPropagation(); onClose(); }}
        className={cn(
          CAPTURE_TAB_PILL_CLOSE_CLASS,
          isActive ? CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS : CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS,
        )}>
        <X className="h-2.5 w-2.5" />
      </span>
    </button>
  );
}
