import type { ContextMenuContext } from "@/types/contextMenu";

interface ContextMenuOpenDetail {
  context: ContextMenuContext;
}

interface ContextMenuActionDetail {
  context: ContextMenuContext | null;
  actionId: string;
  actionLabel: string;
  disabled: boolean;
}

export function trackContextMenuOpen(context: ContextMenuContext): void {
  window.dispatchEvent(new CustomEvent<ContextMenuOpenDetail>("context-menu:open", {
    detail: { context },
  }));
}

export function trackContextMenuAction(detail: ContextMenuActionDetail): void {
  window.dispatchEvent(new CustomEvent<ContextMenuActionDetail>("context-menu:action", {
    detail,
  }));
}
