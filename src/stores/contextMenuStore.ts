/**
 * Store for the app-wide contextual right-click menu (Radix Context Menu).
 * `context` is set on right-click before Radix opens; cleared when the menu closes.
 * editTarget: element captured on contextmenu (see App.tsx) for Cut/Copy/Paste/Select All.
 */

import { create } from "zustand";
import type { ContextMenuContext } from "@/types/contextMenu";

interface ContextMenuState {
  context: ContextMenuContext | null;
  invoker: HTMLElement | null;
  /** Bumps on each `setShellMenuContext` so menu content remounts (fresh sections / multi right-click). */
  menuGeneration: number;
  /** Element focused / editable under cursor when context menu opened. */
  editTarget: HTMLElement | null;
  /** Called from the shell handler before Radix opens the menu (do not preventDefault there). */
  setShellMenuContext: (context: ContextMenuContext) => void;
  /** Clear menu-specific state when Radix closes the menu. */
  resetShellMenu: () => void;
  setEditTarget: (el: HTMLElement | null) => void;
}

export const useContextMenuStore = create<ContextMenuState>()((set) => ({
  context: null,
  invoker: null,
  menuGeneration: 0,
  editTarget: null,
  setShellMenuContext: (context) =>
    set((s) => ({
      context,
      menuGeneration: s.menuGeneration + 1,
      invoker: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    })),
  resetShellMenu: () => set({ context: null, invoker: null }),
  setEditTarget: (el) => set({ editTarget: el }),
}));
