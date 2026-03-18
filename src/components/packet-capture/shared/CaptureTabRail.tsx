import { useRef, useState, useCallback, useEffect, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "@/lib/icons";

interface CaptureTabRailProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  beforeRightArrow?: ReactNode;
  afterRightArrow?: ReactNode;
}

export function CaptureTabRail<T>({
  items,
  getKey,
  renderItem,
  beforeRightArrow,
  afterRightArrow,
}: CaptureTabRailProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState, items.length]);

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  };

  return (
    <div className="ui-section-header-sm flex min-h-[2.2rem] items-center px-1 py-[3px]">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll("left")}
          className="shrink-0 h-[1.88rem] w-[1.88rem] ml-[2px] inline-flex items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-smooth"
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="relative flex-1 min-w-0">
        {canScrollLeft && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 z-[1] w-4 bg-gradient-to-r from-card/50 to-transparent" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-[1] w-4 bg-gradient-to-l from-card/50 to-transparent" />
        )}
        <div ref={scrollRef} className="flex items-center gap-px px-[2px] overflow-x-auto scrollbar-none min-w-0">
          {items.map((item) => (
            <div key={getKey(item)}>{renderItem(item)}</div>
          ))}
        </div>
      </div>

      {beforeRightArrow}

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll("right")}
          className="shrink-0 h-[1.88rem] w-[1.88rem] mr-[2px] inline-flex items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-smooth"
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}

      {afterRightArrow}
    </div>
  );
}
