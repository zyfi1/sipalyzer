const HEADER_TABS_PORTAL_ID = "header-tool-widget";

/**
 * Portal target for tool subview tabs.
 * ToolHeader components use createPortal() to render tabs into this div.
 */
export function ToolTabs() {
  return (
    <div
      id={HEADER_TABS_PORTAL_ID}
      className="flex items-center min-w-0 h-full"
    />
  );
}
