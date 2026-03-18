import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-0 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "relative inline-flex w-fit items-center justify-center group/tabs-list text-muted-foreground rounded-[var(--radius-md)] border border-border/70 bg-muted/38 p-[2px] gap-[0.2rem] group-data-[orientation=horizontal]/tabs:h-fit group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "",
        line: "gap-1 rounded-none border-0 bg-transparent p-0 shadow-none",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        [
          // Base styles
          "text-muted-foreground/78 relative inline-flex min-h-[2.15rem] min-w-0 flex-1 items-center justify-center gap-[0.45rem] rounded-[var(--radius-md)] px-[0.9rem] py-0 text-[0.74rem] leading-none font-semibold whitespace-nowrap border border-transparent bg-transparent",
          // Transitions for smooth tab switching
          "transition-smooth",
          // Vertical orientation
          "group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start",
          // Disabled state
          "disabled:pointer-events-none disabled:opacity-50",
          // SVG styles
          "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          // Focus styles
          "focus-visible:shadow-focus outline-none",
          // Hover state - flat contrast step up
          "hover:text-foreground/96 hover:bg-muted/56 hover:border-border/76",
          // Line variant keeps the same flat shell behavior (not underline-only)
          "group-data-[variant=line]/tabs-list:hover:bg-muted/42 group-data-[variant=line]/tabs-list:hover:border-border/64",
          // Active state — distinct but flat (no glossy shadows)
          "data-[state=active]:bg-card/98 data-[state=active]:text-foreground data-[state=active]:font-semibold data-[state=active]:border-primary/55",
          "group-data-[variant=line]/tabs-list:data-[state=active]:bg-card group-data-[variant=line]/tabs-list:data-[state=active]:border-primary/42",
          // Keep tabs steady (no jump)
          "data-[state=active]:scale-100 data-[state=inactive]:scale-100",
        ],
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  animated = false,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content> & {
  animated?: boolean
}) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "flex-1 outline-none",
        animated && [
          // Animated content transitions
          "data-[state=active]:animate-in data-[state=active]:fade-in-0",
          "data-[state=inactive]:animate-out data-[state=inactive]:fade-out-0",
          "duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
        ],
        className
      )}
      {...props}
    />
  )
}

/**
 * Animated tabs content container - wraps multiple TabsContent for crossfade effect.
 * Use this when you want smooth animated transitions between tab panels.
 */
function AnimatedTabsContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("relative flex-1 overflow-hidden", className)}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child
        return React.cloneElement(child as React.ReactElement<{ className?: string }>, {
          className: cn(
            (child as React.ReactElement<{ className?: string }>).props.className,
            // Position all content absolutely for overlay during transition
            "absolute inset-0",
            // Inactive content hidden but animatable
            "data-[state=inactive]:pointer-events-none",
            // Smooth, precise transitions (no broad transition-all)
            "transition-[opacity,transform] will-change-[opacity,transform] motion-reduce:transition-none",
            "duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
            "data-[state=active]:opacity-100 data-[state=active]:translate-y-0",
            "data-[state=inactive]:opacity-0 data-[state=inactive]:translate-y-0.5"
          ),
        })
      })}
    </div>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, AnimatedTabsContent, tabsListVariants }
