import * as React from "react";
import { cn } from "@/lib/utils";
import { GripHorizontal, GripVertical } from "@/lib/icons";

export type PanelResizeOrientation = "vertical" | "horizontal";
export type PanelResizeDensity = "comfortable" | "compact" | "minimal";
export type PanelResizeAppearance = "rail" | "grip" | "minimal" | "edge" | "table-edge";

export type PanelResizeHandleProps = {
  as?: "button" | "div";
  orientation: PanelResizeOrientation;
  /** Hit target + visual weight */
  density?: PanelResizeDensity;
  /** Primary affordance */
  appearance?: PanelResizeAppearance;
  /** Extra cue stacked on rail (compact splitters) */
  decor?: "none" | "dots";
  /** Accessible name (always set for resize UX) */
  label: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "aria-label">;

/**
 * Unified panel / split-pane resize handle (Graphite Cobalt).
 * Use `as="div"` only when nested in complex interactive regions; prefer `button` default.
 */
export const PanelResizeHandle = React.forwardRef<HTMLElement, PanelResizeHandleProps>(
  function PanelResizeHandle(
    {
      as = "button",
      orientation,
      density = "compact",
      appearance = "rail",
      decor = "none",
      label,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const commonClass = cn(
      "ui-resize-handle",
      orientation === "vertical" ? "ui-resize-handle--vertical" : "ui-resize-handle--horizontal",
      density === "comfortable" && "ui-resize-handle--density-comfortable",
      density === "compact" && "ui-resize-handle--density-compact",
      density === "minimal" && "ui-resize-handle--density-minimal",
      appearance === "rail" && "ui-resize-handle--appearance-rail",
      appearance === "grip" && "ui-resize-handle--appearance-grip",
      appearance === "minimal" && "ui-resize-handle--appearance-minimal",
      appearance === "edge" && "ui-resize-handle--appearance-edge",
      appearance === "table-edge" && "ui-resize-handle--appearance-table-edge",
      className,
    );

    const inner =
      children ??
      (appearance === "grip" ? (
        orientation === "vertical" ? (
          <GripVertical className="ui-resize-handle__icon" strokeWidth={1.75} aria-hidden />
        ) : (
          <GripHorizontal className="ui-resize-handle__icon" strokeWidth={1.75} aria-hidden />
        )
      ) : appearance === "rail" ? (
        <>
          <span className="ui-resize-handle__rail" aria-hidden />
          {decor === "dots" ? (
            <span className="ui-resize-handle__dots" aria-hidden>
              •
              <br />
              •
              <br />
              •
            </span>
          ) : null}
        </>
      ) : null);

    if (as === "div") {
      return (
        <div
          ref={ref as React.Ref<HTMLDivElement>}
          role="separator"
          aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
          aria-label={label}
          className={commonClass}
          {...(rest as React.HTMLAttributes<HTMLDivElement>)}
        >
          {inner}
        </div>
      );
    }

    return (
      <button
        type="button"
        ref={ref as React.Ref<HTMLButtonElement>}
        aria-label={label}
        className={commonClass}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {inner}
      </button>
    );
  },
);

PanelResizeHandle.displayName = "PanelResizeHandle";

export type AppDividerProps = {
  orientation?: "vertical" | "horizontal";
  /** Vertical: height of rule; horizontal: min width span */
  size?: "xs" | "sm" | "md" | "lg";
  decorative?: boolean;
} & React.HTMLAttributes<HTMLDivElement>;

const vSizeClass: Record<NonNullable<AppDividerProps["size"]>, string> = {
  xs: "h-3",
  sm: "h-3.5",
  md: "h-4",
  lg: "h-5",
};

/**
 * Static divider for toolbars and dense control rows (not for draggable splits).
 */
export function AppDivider({
  orientation = "vertical",
  size = "md",
  decorative = true,
  className,
  ...props
}: AppDividerProps) {
  return (
    <div
      role={decorative ? "presentation" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      aria-hidden={decorative ? true : undefined}
      className={cn(
        "ui-app-divider shrink-0 rounded-full",
        orientation === "vertical"
          ? cn("mx-0.5 w-px", vSizeClass[size])
          : "my-0.5 h-px w-full min-w-0",
        className,
      )}
      {...props}
    />
  );
}
