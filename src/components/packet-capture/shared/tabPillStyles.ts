export const CAPTURE_TAB_PILL_BASE_CLASS =
  "group relative flex h-[1.88rem] min-w-[150px] max-w-[240px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[calc(var(--radius-sm)+1px)] border border-transparent px-2.5 text-[0.74rem] font-semibold transition-smooth after:content-[''] after:absolute after:left-2 after:right-2 after:bottom-[0.1rem] after:h-[2px] after:rounded-full after:bg-transparent after:opacity-0 after:scale-x-50 after:origin-center after:transition-[transform,background-color,box-shadow,opacity] after:duration-[340ms] after:[transition-timing-function:cubic-bezier(0.22,1,0.36,1)]";

export const CAPTURE_TAB_PILL_ACTIVE_CLASS =
  "text-foreground bg-transparent after:opacity-100 after:scale-x-100 after:bg-primary/92 after:shadow-[0_0_10px_hsl(var(--primary)/0.32)]";

export const CAPTURE_TAB_PILL_INACTIVE_CLASS =
  "bg-transparent text-muted-foreground/80 hover:bg-card/28 hover:text-foreground";

export const CAPTURE_TAB_PILL_CLOSE_CLASS =
  "h-4 w-4 flex items-center justify-center rounded-sm shrink-0 ml-0.5 hover:bg-muted/50 transition-opacity";

export const CAPTURE_TAB_PILL_CLOSE_ACTIVE_CLASS = "opacity-65 hover:opacity-100";
export const CAPTURE_TAB_PILL_CLOSE_INACTIVE_CLASS = "opacity-45 group-hover:opacity-70 hover:!opacity-100";
