/**
 * App-wide contextual right-click menu built with Radix dropdown primitives.
 * Uses a virtual anchor at cursor coordinates so open/close is controlled by store state.
 */

import { useToolStore } from "@/stores/toolStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { getContextMenuSections } from "@/lib/contextMenuRegistry";
import { ContextMenuRenderer } from "@/components/context-menu/ContextMenuRenderer";
import { createDefaultContextMenuContext } from "@/types/contextMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EDGE_PAD = 8;

export function GlobalContextMenu() {
  const open = useContextMenuStore((s) => s.open);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const context = useContextMenuStore((s) => s.context);
  const invoker = useContextMenuStore((s) => s.invoker);
  const close = useContextMenuStore((s) => s.close);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const lastViewedSubviews = useToolStore((s) => s.lastViewedSubviews);

  const subviewId = activeToolId ? lastViewedSubviews[activeToolId] ?? null : null;
  const menuContext = context ?? createDefaultContextMenuContext({ toolId: activeToolId ?? null, subviewId });
  const sections = getContextMenuSections({
    ...menuContext,
    toolId: menuContext.toolId ?? activeToolId ?? null,
    subviewId: menuContext.subviewId ?? subviewId,
  });

  const handleClose = () => {
    close();
    if (invoker && typeof invoker.focus === "function") {
      queueMicrotask(() => invoker.focus());
    }
  };
  return (
    <DropdownMenu open={open} onOpenChange={(next) => { if (!next) handleClose(); }} modal={false}>
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
        <ContextMenuRenderer sections={sections} onAction={handleClose} edgePadding={EDGE_PAD} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
