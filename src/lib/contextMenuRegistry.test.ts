import { describe, expect, it } from "vitest";
import { getContextMenuSections } from "@/lib/contextMenuRegistry";
import { createDefaultContextMenuContext, isSubmenu, type ContextMenuEntry } from "@/types/contextMenu";

function findEntry(entries: ContextMenuEntry[], id: string): ContextMenuEntry | null {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    if (isSubmenu(entry)) {
      const nested = findEntry(entry.children, id);
      if (nested) return nested;
    }
  }
  return null;
}

describe("context menu registry", () => {
  it("disables cut for non-editable contexts", () => {
    const sections = getContextMenuSections(
      createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" }),
    );
    const editSection = sections.find((section) => section.id === "edit");
    expect(editSection).toBeTruthy();
    const cut = findEntry(editSection?.entries ?? [], "cut");
    expect(cut && !isSubmenu(cut) ? cut.disabled : false).toBe(true);
    expect(cut && !isSubmenu(cut) ? cut.disabledReason : "").toBe("Read-only");
  });

  it("marks reload action as loading when runtime is busy", () => {
    const context = createDefaultContextMenuContext({ toolId: "network", subviewId: "connectivity" });
    context.runtime.isBusy = true;
    const sections = getContextMenuSections(context);
    const appSection = sections.find((section) => section.id === "app");
    expect(appSection).toBeTruthy();
    const refresh = findEntry(appSection?.entries ?? [], "refresh-ui");
    expect(refresh && !isSubmenu(refresh) ? refresh.loading : false).toBe(true);
  });
});
