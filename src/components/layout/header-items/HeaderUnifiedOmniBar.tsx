/**
 * Dead-center header: history back · global search trigger · history forward.
 * Click/focus uses inline header search with dropdown.
 * ⌘K / Ctrl+K opens the full GlobalSearchDialog (modal).
 */

import { useCallback } from "react";
import { ArrowLeft, ArrowRight } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { HeaderInlineCommandSearch } from "@/components/layout/header-items/SearchButton";
import styles from "../header.module.css";

export function HeaderUnifiedOmniBar() {
  const goBack = useCallback(() => {
    window.history.back();
  }, []);

  const goForward = useCallback(() => {
    window.history.forward();
  }, []);

  return (
    <div
      className={styles.centeredHistoryPalette}
      data-no-window-drag="true"
    >
      <HeaderInlineCommandSearch
        embedded
        popoverAlign="center"
        anchorClassName={styles.paletteInlineSearchAnchor}
        inputId="header-omni-search-input"
      />

      <div className={styles.historyNavGroup}>
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
    </div>
  );
}
