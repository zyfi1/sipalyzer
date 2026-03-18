/**
 * Composer tab bar — displays open items as horizontal tabs.
 * Each tab shows protocol icon + truncated name + close button.
 * Includes a "+" button to quickly create new requests.
 * Supports modified indicator (dot) and scrollable overflow.
 */

import { useCallback, useRef, useEffect } from "react";
import { useComposerStore } from "@/stores/composerStore";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { X, Plus } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { getProtocolMeta } from "./protocolMeta";
import { ComposerCreateMenuItems } from "./ComposerCreateMenuItems";

export function ComposerTabBar() {
  const openTabs = useComposerStore((s) => s.openTabs);
  const activeTabId = useComposerStore((s) => s.activeTabId);
  const items = useComposerStore((s) => s.collections.items);
  const setActiveTab = useComposerStore((s) => s.setActiveTab);
  const closeTab = useComposerStore((s) => s.closeTab);
  const createAndOpenItem = useComposerStore((s) => s.createAndOpenItem);

  // Filter out SSH items — those are managed in the SSH subview
  const visibleTabs = openTabs.filter((tab) => {
    const item = items.find((i) => i.id === tab.itemId);
    return item && item.protocol !== "ssh";
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    if (!scrollRef.current || !activeTabId) return;
    const el = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  const handleClose = useCallback(
    (itemId: string) => {
      closeTab(itemId);
    },
    [closeTab]
  );

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-px px-[2px] py-[2px] overflow-x-auto scrollbar-none border-b border-border/30 bg-muted/20 shrink-0 min-h-[2.2rem]"
    >
      {visibleTabs.map((tab) => {
        const item = items.find((i) => i.id === tab.itemId);
        if (!item) return null;
        const isActive = activeTabId === tab.itemId;
        const meta = getProtocolMeta(item.protocol);
        const ProtocolIcon = meta.icon;

        return (
          <div
            key={tab.itemId}
            data-tab-id={tab.itemId}
            className={cn(
              "group relative flex h-[1.88rem] items-center gap-1 rounded-sm transition-smooth max-w-[190px] min-w-0 shrink-0 border px-0.5",
              isActive
                ? "bg-card text-foreground border-border/70"
                : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/40 hover:border-border/45"
            )}
          >
            <button
              type="button"
              onClick={() => setActiveTab(tab.itemId)}
              className={cn(
                "flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-xs font-medium text-left rounded-sm focus-visible:shadow-focus",
                isActive ? "pr-1.5" : ""
              )}
            >
              <span className={meta.colorClass}>
                <ProtocolIcon className="h-3 w-3 shrink-0" />
              </span>
              <span className="truncate">{item.name}</span>
              {tab.dirty && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" />
              )}
            </button>
            <button
              type="button"
              aria-label={`Close tab ${item.name}`}
              onClick={() => handleClose(tab.itemId)}
              className={cn(
                "shrink-0 mr-0.5 rounded-sm p-0.5 transition-smooth hover:bg-muted/55",
                isActive
                  ? "opacity-80 hover:opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              )}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}

      {/* ── "+" button for new tabs ──────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipWrapper content="New request">
            <button
              type="button"
              aria-label="Create new request"
              className={cn(
                "flex items-center justify-center h-[1.88rem] w-[1.88rem] rounded-sm shrink-0 ml-0.5 transition-smooth",
                "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
              )}
            >
              <Plus className="h-3 w-3" />
            </button>
          </TooltipWrapper>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <ComposerCreateMenuItems onCreate={createAndOpenItem} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
