/**
 * Dead-center header: history back · global search trigger · history forward.
 * Opens GlobalSearchDialog (modal) on click or ⌘K.
 */

import { useCallback } from "react";
import { ArrowLeft, ArrowRight, Search } from "@/lib/icons";
import { useLayoutStore } from "@/stores/layoutStore";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import styles from "../header.module.css";

export function HeaderUnifiedOmniBar() {
  const setSearchOpen = useLayoutStore((s) => s.setSearchOpen);
  const openSearch = useCallback(() => setSearchOpen(true), [setSearchOpen]);

  const goBack = useCallback(() => {
    window.history.back();
  }, []);

  const goForward = useCallback(() => {
    window.history.forward();
  }, []);

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  return (
    <div
      className={styles.centeredHistoryPalette}
      data-no-window-drag="true"
    >
      <TooltipWrapper title="Back" description="Browser history back" side="bottom">
        <button
          type="button"
          className={styles.historyNavBtn}
          data-no-window-drag="true"
          aria-label="Back"
          onClick={goBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </TooltipWrapper>

      <button
        type="button"
        className={styles.paletteCenterTrigger}
        data-no-window-drag="true"
        aria-label="Open global search"
        onClick={openSearch}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={styles.paletteSearchHint}>{"Search & navigate…"}</span>
        <kbd className={styles.paletteCenterKbd}>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      <TooltipWrapper title="Forward" description="Browser history forward" side="bottom">
        <button
          type="button"
          className={styles.historyNavBtn}
          data-no-window-drag="true"
          aria-label="Forward"
          onClick={goForward}
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </TooltipWrapper>
    </div>
  );
}
