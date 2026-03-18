/**
 * Store for the app-wide contextual right-click menu.
 * Opens at cursor position when right-clicking on areas that don't have their own context menu.
 * editTarget: element that had focus when the menu opened (used for Cut/Copy/Paste/Select All).
 */

import { create } from "zustand";
import type { ContextMenuContext } from "@/types/contextMenu";

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  context: ContextMenuContext | null;
  invoker: HTMLElement | null;
  /** Element that had focus when context menu opened; used for standard edit actions. */
  editTarget: HTMLElement | null;
  openAt: (x: number, y: number, context?: ContextMenuContext | null) => void;
  close: () => void;
  setEditTarget: (el: HTMLElement | null) => void;
}

export const useContextMenuStore = create<ContextMenuState>()((set) => ({
  open: false,
  x: 0,
  y: 0,
  context: null,
  invoker: null,
  editTarget: null,
  openAt: (x, y, context = null) => set({
    open: true,
    x,
    y,
    context,
    invoker: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  }),
  close: () => set({ open: false }),
  setEditTarget: (el) => set({ editTarget: el }),
}));
