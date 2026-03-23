import React, { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import type { TooltipEntry } from "@/lib/tooltips";

interface TooltipWrapperProps {
  children: ReactNode;
  /** Short label (or use title + description for rich tooltips). */
  title?: string;
  /** Optional longer description; shown below title in muted text. */
  description?: string;
  /** Prefer title + description. If content is set, it overrides title/description. */
  content?: ReactNode;
  /** Use an entry from the central tooltips reference (e.g. tooltips.regAddRegistrar). */
  entry?: TooltipEntry;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  disabled?: boolean;
  delayDuration?: number;
  /** Hide the arrow for dense UIs. */
  showArrow?: boolean;
  /** Enable pointer interactions inside tooltip content (buttons, links). */
  interactive?: boolean;
  /** Follow cursor while hovering trigger. */
  followCursor?: boolean;
}

function inferAdaptiveOffset(children: ReactNode): number {
  if (!React.isValidElement(children)) return 12;
  const className = String((children.props as { className?: string }).className ?? "");
  const isHeaderOrTopNavTrigger =
    /\b(header-icon-button|settings-nav-tab|notification-nav-tab|subview-tab-compact)\b/.test(className);
  if (isHeaderOrTopNavTrigger) return 10;
  const isDenseIconTrigger = /\b(h-(5|6|7)|w-(5|6|7)|size-(5|6|7)|p-0)\b/.test(className);
  return isDenseIconTrigger ? 8 : 12;
}

function inferAdaptiveSide(children: ReactNode): "top" | "right" | "bottom" | "left" {
  if (!React.isValidElement(children)) return "top";
  const className = String((children.props as { className?: string }).className ?? "");
  // Header and top-tab triggers read better with downward tooltip reveal.
  if (/\b(header-icon-button|settings-nav-tab|notification-nav-tab|subview-tab-compact)\b/.test(className)) {
    return "bottom";
  }
  return "top";
}

function resolveContent(props: Omit<TooltipWrapperProps, "children">): ReactNode {
  if (props.content !== undefined && props.content !== null) {
    return typeof props.content === "string" ? <p>{props.content}</p> : props.content;
  }
  const title = props.title ?? props.entry?.title;
  const description = props.description ?? props.entry?.description;
  if (!title && !description) return null;
  return (
    <div className="space-y-0.5">
      {title && <p className="font-medium text-foreground leading-snug">{title}</p>}
      {description && (
        <p className="text-xs text-muted-foreground leading-snug max-w-[320px]">{description}</p>
      )}
    </div>
  );
}

export function TooltipWrapper({
  children,
  title,
  description,
  content,
  entry,
  side,
  sideOffset,
  disabled = false,
  delayDuration,
  showArrow = true,
  interactive = false,
  followCursor = false,
}: TooltipWrapperProps) {
  const resolved = resolveContent({ title, description, content, entry });
  const resolvedSide = side ?? inferAdaptiveSide(children);
  const resolvedSideOffset = sideOffset ?? inferAdaptiveOffset(children);
  if (disabled || resolved == null) {
    return <>{children}</>;
  }

  const trigger = React.isValidElement(children)
    ? children
    : <span className="inline-flex">{children}</span>;

  return (
    <Tooltip delayDuration={delayDuration} interactive={interactive} followCursor={followCursor}>
      <TooltipTrigger asChild>
        {trigger}
      </TooltipTrigger>
      <TooltipContent side={resolvedSide} sideOffset={resolvedSideOffset} showArrow={showArrow}>
        {resolved}
      </TooltipContent>
    </Tooltip>
  );
}
