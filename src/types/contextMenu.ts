/**
 * Types for the app-wide contextual right-click menu system.
 * Menu items are built from a registry keyed by tool + subview.
 */

import type { IconComponent } from "@/lib/icons";

export type ContextMenuSurface =
  | "toolPanel"
  | "tableRow"
  | "terminal"
  | "tab"
  | "editor"
  | "emptyArea"
  | "selection"
  | "unknown";

export type ContextMenuEntity =
  | "packet"
  | "terminalTab"
  | "session"
  | "note"
  | "folder"
  | "device"
  | "call"
  | "editor"
  | "generic";

export interface ContextMenuSelectionState {
  selectionCount: number;
  mixedTypes: boolean;
  primarySelectionId?: string | null;
}

export interface ContextMenuCapabilities {
  canEdit: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canSelectAll: boolean;
  canDelete: boolean;
  canExport: boolean;
}

export interface ContextMenuRuntimeState {
  isBusy: boolean;
  isConnected: boolean;
  hasActiveCall: boolean;
  hasCaptureSession: boolean;
}

export interface ContextMenuItemAction {
  id: string;
  label: string;
  icon?: IconComponent;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Optional right-side muted reason shown when item is disabled. */
  disabledReason?: string;
  /** Optional loading indicator for long-running actions. */
  loading?: boolean;
  /** Render as the "current" / active item (e.g. a checkmark or accent highlight). */
  active?: boolean;
  /** Render in destructive (red) styling. */
  destructive?: boolean;
}

export interface ContextMenuSubmenu {
  id: string;
  label: string;
  icon?: IconComponent;
  shortcut?: string;
  disabled?: boolean;
  /** Optional right-side muted reason shown when submenu is disabled. */
  disabledReason?: string;
  children: (ContextMenuItemAction | ContextMenuSubmenu)[];
}

export type ContextMenuEntry = ContextMenuItemAction | ContextMenuSubmenu;

export function isSubmenu(entry: ContextMenuEntry): entry is ContextMenuSubmenu {
  return "children" in entry && Array.isArray((entry as ContextMenuSubmenu).children);
}

export interface ContextMenuSection {
  id: string;
  label?: string;
  entries: ContextMenuEntry[];
}

export interface ContextMenuContext {
  toolId: string | null;
  subviewId: string | null;
  surface: ContextMenuSurface;
  entity: ContextMenuEntity;
  selection: ContextMenuSelectionState;
  capabilities: ContextMenuCapabilities;
  runtime: ContextMenuRuntimeState;
  target: HTMLElement | null;
  trigger: "mouse" | "keyboard";
}

export function createDefaultContextMenuContext(params: {
  toolId: string | null;
  subviewId: string | null;
  target?: HTMLElement | null;
}): ContextMenuContext {
  return {
    toolId: params.toolId,
    subviewId: params.subviewId,
    surface: "unknown",
    entity: "generic",
    selection: { selectionCount: 0, mixedTypes: false, primarySelectionId: null },
    capabilities: {
      canEdit: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: false,
      canDelete: false,
      canExport: false,
    },
    runtime: {
      isBusy: false,
      isConnected: false,
      hasActiveCall: false,
      hasCaptureSession: false,
    },
    target: params.target ?? null,
    trigger: "mouse",
  };
}
