/**
 * Standard edit items (Cut, Copy, Paste, Select All) for Radix context menus.
 * Use at the top of any ContextMenuContent so all right-clicks have edit actions.
 */

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { Scissors, Copy, ClipboardPaste, Square } from "@/lib/icons";
import { handleCut, handleCopy, handlePaste, handleSelectAll } from "@/lib/standardEditActions";

export function StandardEditMenuItems() {
  return (
    <>
      <ContextMenuItem onSelect={handleCut}>
        <Scissors className="h-4 w-4 mr-2" />
        Cut
        <ContextMenuShortcut>⌘X</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleCopy}>
        <Copy className="h-4 w-4 mr-2" />
        Copy
        <ContextMenuShortcut>⌘C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={handlePaste}>
        <ClipboardPaste className="h-4 w-4 mr-2" />
        Paste
        <ContextMenuShortcut>⌘V</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleSelectAll}>
        <Square className="h-4 w-4 mr-2" />
        Select All
        <ContextMenuShortcut>⌘A</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}
