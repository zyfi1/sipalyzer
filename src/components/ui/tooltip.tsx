import * as React from "react";
import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useClientPoint,
  useDismiss,
  useFocus,
  useFloating,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
  type Placement,
} from "@floating-ui/react";
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
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isOpen = isControlled ? open : uncontrolledOpen;
  const arrowRef = React.useRef<SVGSVGElement | null>(null);
  const prefersReducedMotion = React.useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

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

  const {
    refs,
    context,
    placement,
    floatingStyles,
  } = useFloating({
    open: isOpen,
    onOpenChange: setOpen,
    strategy: "fixed",
    transform: false,
    placement: sideToPlacement(side, align),
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(sideOffset + (showArrow ? 4 : 0)),
      flip({ padding: collisionPadding }),
      shift({ padding: collisionPadding }),
      ...(showArrow ? [arrow({ element: arrowRef })] : []),
    ],
  });

  const hover = useHover(context, {
    delay: { open: resolvedDelay, close: 0 },
    move: followCursorEnabled,
    enabled: !disabled,
    handleClose: interactive ? safePolygon() : undefined,
  });
  const focus = useFocus(context, { enabled: !disabled });
  const dismiss = useDismiss(context, { enabled: !disabled });
  const role = useRole(context, { role: "tooltip" });
  const clientPoint = useClientPoint(context, { enabled: followCursorEnabled });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
    clientPoint,
  ]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: prefersReducedMotion ? 0 : { open: 180, close: 140 },
    initial: prefersReducedMotion
      ? { opacity: 1 }
      : { opacity: 0, transform: "translateY(2px) scale(0.985)" },
  });

  const setTriggerRef = (node: Element | null) => {
    refs.setReference(node);
    if (!triggerElement) return;
    const maybeRef = (triggerElement as unknown as { ref?: React.Ref<Element> }).ref;
    if (typeof maybeRef === "function") maybeRef(node);
    else if (maybeRef && typeof maybeRef === "object") {
      (maybeRef as React.MutableRefObject<Element | null>).current = node;
    }
  };

  const trigger = triggerElement as React.ReactElement<any> | null;
  const referenceTrigger =
    trigger && typeof trigger.type !== "string"
      ? React.createElement(
          "span",
          {
            className: "inline-flex",
            "data-slot": "tooltip-reference",
          },
          trigger,
        )
      : trigger;
  const enhancedTrigger = referenceTrigger
    ? React.cloneElement(
        referenceTrigger,
        getReferenceProps({
          ...referenceTrigger.props,
          ref: setTriggerRef,
        }),
      )
    : null;

  if (!referenceTrigger || !contentElement || !enhancedTrigger) return null;

  if (disabled) return enhancedTrigger;

  return (
    <>
      {enhancedTrigger}
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...transitionStyles, zIndex: 9999 }}
            data-floating-tooltip
            data-side={placement.split("-")[0]}
            className={cn(
              "w-fit max-w-[min(420px,calc(100vw-16px))] text-sm",
              "rounded-[var(--radius-lg)] border border-border/35 bg-popover text-popover-foreground shadow-tooltip",
              interactive ? "pointer-events-auto" : "pointer-events-none",
              contentClassName,
            )}
            {...getFloatingProps()}
          >
            <div data-slot="tooltip-content" className="px-3 py-2 leading-snug">
              {contentElement}
            </div>
            {showArrow && (
              <FloatingArrow
                ref={arrowRef}
                context={context}
                fill="hsl(var(--popover))"
                stroke="hsl(var(--border) / 0.4)"
                strokeWidth={1}
              />
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
