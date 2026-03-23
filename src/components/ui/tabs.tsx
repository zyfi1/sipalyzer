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
  "relative inline-flex w-fit items-center justify-center group/tabs-list text-muted-foreground border-b border-border/55 bg-transparent p-0 gap-[0.1rem] group-data-[orientation=horizontal]/tabs:h-fit group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col group-data-[orientation=vertical]/tabs:border-b-0 group-data-[orientation=vertical]/tabs:border-l group-data-[orientation=vertical]/tabs:border-border/55",
  {
    variants: {
      variant: {
        default: "",
        line: "gap-1 border-b border-border/55 bg-transparent p-0 shadow-none rounded-none",
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
          "text-muted-foreground/80 relative inline-flex min-h-[2.15rem] min-w-0 flex-1 items-center justify-center gap-[0.45rem] rounded-[var(--radius-md)] px-[0.9rem] py-0 text-[0.74rem] leading-none font-semibold whitespace-nowrap border border-transparent bg-transparent",
          "transition-smooth",
          "group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start",
          "disabled:pointer-events-none disabled:opacity-50",
          "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          "focus-visible:shadow-focus outline-none",
          "hover:text-foreground hover:bg-card/28",
          "data-[state=active]:text-foreground data-[state=active]:font-semibold",
          "after:content-[''] after:absolute after:left-[0.5rem] after:right-[0.5rem] after:bottom-[0.18rem] after:h-[2px] after:rounded-full after:bg-transparent after:opacity-0 after:scale-x-50 after:origin-center after:transition-[transform,background-color,box-shadow,opacity] after:duration-[340ms] after:[transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
          "group-data-[orientation=vertical]/tabs:after:left-[0.22rem] group-data-[orientation=vertical]/tabs:after:right-auto group-data-[orientation=vertical]/tabs:after:top-[0.28rem] group-data-[orientation=vertical]/tabs:after:bottom-[0.28rem] group-data-[orientation=vertical]/tabs:after:h-auto group-data-[orientation=vertical]/tabs:after:w-[2px]",
          "data-[state=active]:after:opacity-100 data-[state=active]:after:scale-x-100 data-[state=active]:after:bg-primary/90 data-[state=active]:after:shadow-none",
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
