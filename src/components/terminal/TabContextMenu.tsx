/**
 * TabContextMenu — right-click context menu for terminal tabs.
 *
 * Provides: Rename, Close, Close Others, Close Tabs to the Right, New Tab.
 * Implemented with Radix dropdown primitives and a virtual anchor.
 */

import {
  Edit,
  X,
  Plus,
  Terminal,
} from "@/lib/icons";
import { ContextMenuRenderer } from "@/components/context-menu/ContextMenuRenderer";
import type { ContextMenuSection } from "@/types/contextMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TabContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  tabId: number | null;
  tabCount: number;
  onClose: () => void;
  onRename: (tabId: number) => void;
  onClose_tab: (tabId: number) => void;
  onCloseOthers: (tabId: number) => void;
  onCloseToRight: (tabId: number) => void;
  onNewTab: () => void;
}

const EDGE_PAD = 8;

export function TabContextMenu({
  open,
  x,
  y,
  tabId,
  tabCount,
  onClose,
  onRename,
  onClose_tab,
  onCloseOthers,
  onCloseToRight,
  onNewTab,
}: TabContextMenuProps) {
  if (!open || tabId == null) return null;

  const sections: ContextMenuSection[] = [];

  // ── Tab actions ──────────────────────────────────────
  sections.push({
    id: "tab-actions",
    entries: [
      {
        id: "rename",
        label: "Rename Tab",
        icon: Edit,
        onClick: () => onRename(tabId),
      },
      {
        id: "new-tab",
        label: "New Tab",
        icon: Plus,
        onClick: onNewTab,
      },
    ],
  });

  // ── Close actions ──────────────────────────────────
  sections.push({
    id: "close-actions",
    entries: [
      {
        id: "close",
        label: "Close Tab",
        icon: X,
        onClick: () => onClose_tab(tabId),
      },
      {
        id: "close-others",
        label: "Close Other Tabs",
        icon: Terminal,
        disabled: tabCount <= 1,
        onClick: () => onCloseOthers(tabId),
      },
      {
        id: "close-right",
        label: "Close Tabs to the Right",
        icon: Terminal,
        disabled: tabCount <= 1,
        onClick: () => onCloseToRight(tabId),
      },
    ],
  });

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { if (!next) onClose(); }} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed h-px w-px opacity-0"
          style={{ left: x, top: y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={4}
        collisionPadding={EDGE_PAD}
        className="w-[220px] max-h-[360px]"
      >
        <ContextMenuRenderer sections={sections} onAction={onClose} edgePadding={EDGE_PAD} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
