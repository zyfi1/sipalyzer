/**
 * Floating scroll-to-top / scroll-to-bottom buttons for large packet views.
 *
 * Renders absolutely-positioned pill buttons in the bottom-right corner
 * of a scroll container. Shows "scroll to top" when the user has scrolled
 * down, and "scroll to bottom" when the user isn't at the bottom.
 *
 * Usage:
 *   <div style={{ position: "relative" }}>
 *     <div ref={scrollRef} className="overflow-auto">
 *       ...content...
 *     </div>
 *     <ScrollFloatingButtons scrollRef={scrollRef} />
 *   </div>
 */

import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import { ChevronUp, ChevronDown } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface ScrollFloatingButtonsProps {
  /** Ref to the scrollable container element. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Minimum scroll height (in px) before buttons become visible. Default 600. */
  minContentHeight?: number;
  /** Extra className for the button container. */
  className?: string;
}

/** Threshold (px) from top/bottom before showing each button. */
const THRESHOLD_TOP = 200;
const THRESHOLD_BOTTOM = 200;

export function ScrollFloatingButtons({
  scrollRef,
  minContentHeight = 600,
  className,
}: ScrollFloatingButtonsProps) {
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);
  const rafRef = useRef(0);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Only show if the scrollable content is tall enough to be useful
    if (el.scrollHeight < minContentHeight) {
      setShowTop(false);
      setShowBottom(false);
      return;
    }

    const scrollTop = el.scrollTop;
    const maxScroll = el.scrollHeight - el.clientHeight;

    setShowTop(scrollTop > THRESHOLD_TOP);
    setShowBottom(maxScroll - scrollTop > THRESHOLD_BOTTOM);
  }, [scrollRef, minContentHeight]);

  // Listen to scroll events
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        update();
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    // Initial check
    update();

    // Also re-check on resize (content may grow/shrink)
    const ro = new ResizeObserver(() => update());
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef, update]);

  // Also re-check when children change (mutation)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mo = new MutationObserver(() => update());
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [scrollRef, update]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [scrollRef]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [scrollRef]);

  if (!showTop && !showBottom) return null;

  return (
    <div
      className={cn(
        "absolute bottom-3 right-3 z-20 flex flex-col gap-1.5 pointer-events-none",
        className,
      )}
    >
      {showTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="ui-control-shell pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
          aria-label="Scroll to top"
        >
          <ChevronUp className="h-3.5 w-3.5" />
          <span>Top</span>
        </button>
      )}
      {showBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="ui-control-shell pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
          aria-label="Scroll to bottom"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          <span>Bottom</span>
        </button>
      )}
    </div>
  );
}
