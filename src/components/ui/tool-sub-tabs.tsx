import { Fragment, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useBreadcrumb } from "@/stores/breadcrumbStore";

/* ─── Types ─────────────────────────────────────────────── */

export interface SubTabItem {
  id: string;
  label: string;
  tip?: string;
  tipDesc?: string;
  [key: string]: unknown;
}

export interface ToolSubTabsProps<T extends string = string> {
  tabs: readonly SubTabItem[];
  activeTab: T;
  onTabChange: (id: T) => void;
  /** Content rendered on the trailing (right) side of the bar */
  trailing?: ReactNode;
  className?: string;
  /**
   * When provided, registers tabs as a breadcrumb segment (level 1) instead
   * of rendering a compact tab bar. Used for hierarchical navigation that
   * should appear in the header breadcrumb.
   */
  toolId?: string;
}

/* ─── Component ─────────────────────────────────────────── */

/**
 * View-level sub-tab bar using the **compact** tier of the unified
 * subview-tabs design system (.subview-tabs-compact).
 *
 * When `toolId` is provided, switches to headless mode: registers the
 * tabs as a breadcrumb dropdown in the header (level 1) and renders nothing.
 */
export function ToolSubTabs<T extends string = string>(props: ToolSubTabsProps<T>) {
  if (props.toolId) {
    return <BreadcrumbRegistrar {...props} toolId={props.toolId} />;
  }
  return <CompactTabBar {...props} />;
}

function BreadcrumbRegistrar<T extends string>({
  toolId,
  tabs,
  activeTab,
  onTabChange,
}: {
  toolId: string;
  tabs: readonly SubTabItem[];
  activeTab: T;
  onTabChange: (id: T) => void;
}) {
  const items = useMemo(
    () => tabs.map((t) => ({ id: t.id, label: t.label })),
    [tabs],
  );
  useBreadcrumb(toolId, 1, items, activeTab, (id) => onTabChange(id as T));
  return null;
}

function CompactTabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  trailing,
  className,
}: Omit<ToolSubTabsProps<T>, "toolId">) {
  return (
    <div className={cn("subview-tabs-compact", className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;

        const button = (
          <button
            type="button"
            data-state={isActive ? "active" : "inactive"}
            onClick={() => onTabChange(tab.id as T)}
            className="subview-tab-compact ui-hover-press motion-reduce:transform-none focus-visible:shadow-focus"
          >
            {tab.label}
          </button>
        );

        if (tab.tip) {
          return (
            <TooltipWrapper
              key={tab.id}
              title={tab.tip}
              description={tab.tipDesc}
              side="bottom"
            >
              {button}
            </TooltipWrapper>
          );
        }

        return <Fragment key={tab.id}>{button}</Fragment>;
      })}

      {trailing && <div className="ml-auto">{trailing}</div>}
    </div>
  );
}
