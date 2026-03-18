/**
 * Standard edit actions (Cut, Copy, Paste, Select All) for context menus.
 * Uses document.execCommand with the edit target from contextMenuStore.
 */

import { useContextMenuStore } from "@/stores/contextMenuStore";

function runWithTarget(fn: (el: HTMLElement) => void) {
  const el = useContextMenuStore.getState().editTarget;
  if (el && typeof el.focus === "function") {
    try {
      el.focus();
      fn(el);
    } catch {
      // no-op if focus/execCommand fails
    }
  }
}

/** Cut: copy selection to clipboard and remove it. */
export function handleCut() {
  runWithTarget(() => document.execCommand("cut"));
}

/** Copy: copy selection to clipboard. */
export function handleCopy() {
  runWithTarget(() => document.execCommand("copy"));
}

/** Paste: insert clipboard content at caret. */
export function handlePaste() {
  runWithTarget(() => document.execCommand("paste"));
}

/** Select All: select all content in the edit target. */
export function handleSelectAll() {
  runWithTarget(() => document.execCommand("selectAll"));
}
