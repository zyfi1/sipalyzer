/**
 * Unified subview tab switcher classes.
 *
 * Three tiers sharing the same visual DNA (muted container → card-surface active pill):
 *
 *   • Primary  – .subview-tabs         + .subview-tab           — header nav
 *   • Inner    – .subview-tabs-inner   + .subview-tab-inner     — view-level sub-tabs
 *   • Compact  – .subview-tabs-compact + .subview-tab-compact   — panel-level contextual
 *
 * CSS lives in styles.css.  React wrapper: `<ToolSubTabs>` (inner tier + tooltips).
 */

/** Individual primary tab trigger */
export const SUBVIEW_TAB_CLASS = "subview-tab";

/** Inner tier container */
export const SUBVIEW_TABS_INNER_CLASS = "subview-tabs-inner";

/** Individual inner tab trigger */
export const SUBVIEW_TAB_INNER_CLASS = "subview-tab-inner";

/** Individual compact tab trigger */
export const SUBVIEW_TAB_COMPACT_CLASS = "subview-tab-compact";

/* ── Legacy aliases used by header-tab tools ── */
export const TOOL_SUBVIEW_TABSLIST_CLASS = "subview-tabs";
export const TOOL_SUBVIEW_TABSTRIGGER_CLASS = SUBVIEW_TAB_CLASS;

/** 
 * Class for animated tab content panels - use with AnimatedTabsContent wrapper.
 * Enables smooth crossfade transitions between views.
 */
export const TOOL_SUBVIEW_TABSCONTENT_ANIMATED_CLASS =
  "m-0 overflow-hidden flex flex-col min-h-0";
