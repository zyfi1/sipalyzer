/**
 * Radix Context Menu surface for the app shell. Must render as a child of
 * `AppContextMenu` Root (see App.tsx). Positioning uses the cursor via Radix's
 * built-in virtual anchor — no DropdownMenu / 1px trigger hack.
 */

import { useToolStore } from "@/stores/toolStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { getContextMenuSections } from "@/lib/contextMenuRegistry";
import { ContextMenuRenderer } from "@/components/context-menu/ContextMenuRenderer";
import { createDefaultContextMenuContext } from "@/types/contextMenu";
import { AppContextMenuContent } from "@/components/ui/app-context-menu";

const EDGE_PAD = 8;

export function GlobalContextMenu() {
  const storedContext = useContextMenuStore((s) => s.context);
  const menuGeneration = useContextMenuStore((s) => s.menuGeneration);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const lastViewedSubviews = useToolStore((s) => s.lastViewedSubviews);

  const subviewId = activeToolId ? lastViewedSubviews[activeToolId] ?? null : null;
  const menuContext =
    storedContext ??
    createDefaultContextMenuContext({ toolId: activeToolId ?? null, subviewId });
  const sections = getContextMenuSections({
    ...menuContext,
    toolId: menuContext.toolId ?? activeToolId ?? null,
    subviewId: menuContext.subviewId ?? subviewId,
  });

  return (
    <AppContextMenuContent
      key={menuGeneration}
      className="w-64"
      collisionPadding={EDGE_PAD}
      onCloseAutoFocus={(ev) => {
        ev.preventDefault();
      }}
    >
      <ContextMenuRenderer sections={sections} onAction={() => {}} edgePadding={EDGE_PAD} />
    </AppContextMenuContent>
  );
}
