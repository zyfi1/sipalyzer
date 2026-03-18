import * as React from "react";
import Tippy from "@tippyjs/react";
import { followCursor } from "tippy.js";
import type { Placement } from "tippy.js";
import { cn } from "@/lib/utils";

type TooltipSide = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

type TooltipProviderProps = {
  children: React.ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
};

type TooltipRootProps = {
  children: React.ReactNode;
  delayDuration?: number;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  followCursor?: boolean;
  interactive?: boolean;
};

type TooltipTriggerProps = React.HTMLAttributes<HTMLElement> & {
  children: React.ReactNode;
  asChild?: boolean;
};

type TooltipContentProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  side?: TooltipSide;
  align?: TooltipAlign;
  sideOffset?: number;
  collisionPadding?: number;
  showArrow?: boolean;
};

const TooltipDelayContext = React.createContext<number>(0);

function TooltipProvider({ children, delayDuration = 0 }: TooltipProviderProps) {
  return <TooltipDelayContext.Provider value={delayDuration}>{children}</TooltipDelayContext.Provider>;
}

function TooltipTrigger(_props: TooltipTriggerProps) {
  return null;
}

function TooltipContent(_props: TooltipContentProps) {
  return null;
}

function sideToPlacement(side: TooltipSide, align: TooltipAlign): Placement {
  if (align === "center") return side;
  return `${side}-${align}` as Placement;
}

function Tooltip({
  children,
  delayDuration,
  disabled = false,
  open,
  onOpenChange,
  followCursor: followCursorEnabled = false,
  interactive = false,
}: TooltipRootProps) {
  const providerDelay = React.useContext(TooltipDelayContext);
  const resolvedDelay = delayDuration ?? providerDelay;
  const prefersReducedMotion = React.useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  let triggerElement: React.ReactElement | null = null;
  let contentElement: React.ReactNode = null;
  let contentClassName = "";
  let side: TooltipSide = "top";
  let align: TooltipAlign = "center";
  let sideOffset = 10;
  let collisionPadding = 8;
  let showArrow = true;

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;

    if (child.type === TooltipTrigger) {
      const { children: triggerChildren, asChild = false, ...triggerProps } = child.props as TooltipTriggerProps;
      if (asChild && React.isValidElement(triggerChildren)) {
        triggerElement = React.cloneElement(triggerChildren as React.ReactElement<any>, {
          ...triggerProps,
        });
      } else {
        triggerElement = <span {...triggerProps}>{triggerChildren}</span>;
      }
    }

    if (child.type === TooltipContent) {
      const {
        children: tooltipChildren,
        className,
        side: s = "top",
        align: a = "center",
        sideOffset: so = 10,
        collisionPadding: cp = 8,
        showArrow: sa = true,
      } = child.props as TooltipContentProps;
      contentElement = tooltipChildren;
      contentClassName = className ?? "";
      side = s;
      align = a;
      sideOffset = so;
      collisionPadding = cp;
      showArrow = sa;
    }
  });

  if (!triggerElement || !contentElement) return null;

  return (
    <Tippy
      content={
        <div
          data-slot="tooltip-content"
          className={cn(
            "z-[9999] w-fit max-w-[min(420px,calc(100vw-16px))] text-sm",
            contentClassName,
          )}
        >
          {contentElement}
        </div>
      }
      theme="sipalyzer"
      placement={sideToPlacement(side, align)}
      arrow={showArrow}
      animation={prefersReducedMotion ? false : "shift-away-subtle"}
      duration={prefersReducedMotion ? [0, 0] : [180, 140]}
      moveTransition={prefersReducedMotion ? "" : "transform var(--motion-duration-navigation) var(--motion-ease-navigation)"}
      inertia={!prefersReducedMotion}
      plugins={followCursorEnabled ? [followCursor] : undefined}
      followCursor={followCursorEnabled ? "initial" : false}
      delay={[resolvedDelay, 0]}
      offset={[0, sideOffset]}
      appendTo={() => document.body}
      interactive={interactive}
      zIndex={9999}
      popperOptions={{
        modifiers: [
          {
            name: "preventOverflow",
            options: { padding: collisionPadding },
          },
          {
            name: "flip",
            options: { padding: collisionPadding },
          },
        ],
      }}
      onClickOutside={() => onOpenChange?.(false)}
      onShow={() => onOpenChange?.(true)}
      onHide={() => onOpenChange?.(false)}
      disabled={disabled}
      {...(open !== undefined ? { visible: open } : {})}
    >
      {triggerElement}
    </Tippy>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
