/**
 * TerminalContextMenu — dedicated right-click menu for the floating terminal,
 * implemented with Radix dropdown primitives and a virtual anchor.
 */

import {
  Copy,
  ClipboardPaste,
  Square,
  Eraser,
  RotateCcw,
  Minus,
  MaximizeScreen,
  MinimizeScreen,
  X,
  ArrowUp,
} from "@/lib/icons";
import type { TerminalEmulatorHandle } from "./TerminalEmulator";
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

interface TerminalContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  termRef: React.RefObject<TerminalEmulatorHandle | null>;
  maximized: boolean;
  minimized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onCloseTerminal: () => void;
}

const EDGE_PAD = 8;

export function TerminalContextMenu({
  open,
  x,
  y,
  onClose,
  termRef,
  maximized,
  minimized,
  onMinimize,
  onMaximize,
  onCloseTerminal,
}: TerminalContextMenuProps) {
  const term = termRef.current;
  const hasSelection = term?.hasSelection() ?? false;

  const sections: ContextMenuSection[] = [];

  // ── Edit ────────────────────────────────────────────────
  sections.push({
    id: "edit",
    entries: [
      {
        id: "copy",
        label: "Copy",
        icon: Copy,
        shortcut: "⌘C",
        disabled: !hasSelection,
        onClick: () => {
          const sel = term?.getSelection();
          if (sel) navigator.clipboard.writeText(sel);
        },
      },
      {
        id: "paste",
        label: "Paste",
        icon: ClipboardPaste,
        shortcut: "⌘V",
        onClick: async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text) term?.writeToPty(text);
          } catch { /* clipboard access denied */ }
          term?.focus();
        },
      },
      {
        id: "select-all",
        label: "Select All",
        icon: Square,
        shortcut: "⌘A",
        onClick: () => term?.selectAll(),
      },
    ],
  });

  // ── Terminal actions ────────────────────────────────────
  sections.push({
    id: "terminal",
    label: "Terminal",
    entries: [
      {
        id: "clear",
        label: "Clear Terminal",
        icon: Eraser,
        shortcut: "⌘K",
        onClick: () => { term?.clear(); term?.focus(); },
      },
      {
        id: "reset",
        label: "Reset Terminal",
        icon: RotateCcw,
        onClick: () => { term?.reset(); term?.focus(); },
      },
      {
        id: "scroll-top",
        label: "Scroll to Top",
        icon: ArrowUp,
        onClick: () => term?.focus(),
      },
    ],
  });

  // ── Window controls ────────────────────────────────────
  sections.push({
    id: "window",
    label: "Window",
    entries: [
      {
        id: "minimize",
        label: minimized ? "Restore" : "Minimize",
        icon: Minus,
        onClick: onMinimize,
      },
      {
        id: "maximize",
        label: maximized ? "Restore Size" : "Maximize",
        icon: maximized ? MinimizeScreen : MaximizeScreen,
        onClick: onMaximize,
      },
      {
        id: "close",
        label: "Close Terminal",
        icon: X,
        destructive: true,
        onClick: onCloseTerminal,
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
        className="w-64 max-h-[480px]"
      >
        <ContextMenuRenderer sections={sections} onAction={onClose} edgePadding={EDGE_PAD} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
