import { useCallback } from "react";
import { useToolStore } from "@/stores/toolStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { createDefaultContextMenuContext, type ContextMenuContext } from "@/types/contextMenu";
import { trackContextMenuOpen } from "@/lib/contextMenuTelemetry";

/** Set on elements that implement their own context menu; global handler will defer. */
export const DATA_HAS_CONTEXT_MENU = "data-has-context-menu";

const HAS_CONTEXT_MENU_ATTR = DATA_HAS_CONTEXT_MENU;

const APP_SHELL_CONTEXT_ROOT_SELECTOR = "[data-app-context-menu-root]";

/** Programmatic open (e.g. design mockups): fires `contextmenu` on the app shell trigger. */
export function openGlobalContextMenuAt(clientX: number, clientY: number) {
  const root = document.querySelector(APP_SHELL_CONTEXT_ROOT_SELECTOR);
  if (!root) return;
  root.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window,
      button: 2,
    }),
  );
}

function contextMenuTargetElement(e: React.MouseEvent): HTMLElement | null {
  const n = e.target;
  if (n instanceof HTMLElement) return n;
  if (n instanceof Text && n.parentElement) return n.parentElement;
  return null;
}

/**
 * App shell right-click: Radix `ContextMenu.Trigger` opens the menu; this handler runs **first**
 * (see Radix composeEventHandlers) to set `context` in the store. We **must not** call
 * `preventDefault` on the default path so Radix can open. For `[data-has-context-menu]`, we
 * preventDefault so the global menu does not open.
 */
export function useGlobalContextMenuHandler() {
  const setShellMenuContext = useContextMenuStore((s) => s.setShellMenuContext);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const lastViewedSubviews = useToolStore((s) => s.lastViewedSubviews);

  const buildMenuContext = useCallback(
    (target: HTMLElement): ContextMenuContext => {
      const subviewId = activeToolId ? lastViewedSubviews[activeToolId] ?? null : null;
      const base = createDefaultContextMenuContext({
        toolId: activeToolId ?? null,
        subviewId,
        target,
      });
      const tag = target.tagName.toLowerCase();
      const editable =
        target.isContentEditable ||
        tag === "input" ||
        tag === "textarea" ||
        target.getAttribute("role") === "textbox";
      const inTableRow = !!target.closest("[role='row'], tr, [data-packet-row='true']");
      const inTerminal = !!target.closest("[data-terminal='true'], [data-xterm='true'], .xterm");
      const inTab = !!target.closest("[role='tab'], [data-terminal-tab='true']");
      const inSidebar = !!target.closest(".app-sidebar");

      const surface: ContextMenuContext["surface"] = inSidebar
        ? "sidebarNav"
        : inTerminal
          ? "terminal"
          : inTab
            ? "tab"
            : inTableRow
              ? "tableRow"
              : editable
                ? "editor"
                : "toolPanel";

      const entity: ContextMenuContext["entity"] = inTableRow
        ? "packet"
        : inTerminal
          ? "session"
          : inTab
            ? "terminalTab"
            : editable
              ? "editor"
              : "generic";

      return {
        ...base,
        surface,
        entity,
        capabilities: {
          canEdit: editable,
          canCut: editable,
          canCopy: true,
          canPaste: editable,
          canSelectAll: editable || inTerminal || inTableRow,
          canDelete: true,
          canExport: !!inTableRow,
        },
      };
    },
    [activeToolId, lastViewedSubviews],
  );

  return useCallback(
    (e: React.MouseEvent) => {
      const el = contextMenuTargetElement(e);
      if (!el) return;
      if (el.closest(`[${HAS_CONTEXT_MENU_ATTR}]`)) {
        e.preventDefault();
        return;
      }
      const menuContext = buildMenuContext(el);
      trackContextMenuOpen(menuContext);
      setShellMenuContext(menuContext);
      /* Radix Trigger's handler runs next and calls preventDefault + opens the menu. */
    },
    [buildMenuContext, setShellMenuContext],
  );
}
