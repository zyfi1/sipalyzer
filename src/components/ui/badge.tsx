import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const BADGE_VARIANT_PRIMARY =
  "bg-primary/92 text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.22)] [a&]:hover:bg-primary"
const BADGE_VARIANT_SECONDARY =
  "bg-linear-to-b from-card/98 via-card/92 to-muted/72 text-foreground border border-border/85 shadow-none [a&]:hover:from-card [a&]:hover:to-muted/78 [a&]:hover:border-foreground/24"
const BADGE_VARIANT_SUCCESS =
  "bg-success text-success-foreground shadow-[0_0_0_1px_hsl(var(--success)/0.2)] [a&]:hover:bg-success/90"
const BADGE_VARIANT_DESTRUCTIVE =
  "bg-destructive text-destructive-foreground shadow-[0_0_0_1px_hsl(var(--destructive)/0.2)] [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:shadow-focus outline-none transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: BADGE_VARIANT_SECONDARY, // legacy alias
        primary: BADGE_VARIANT_PRIMARY,
        secondary: BADGE_VARIANT_SECONDARY,
        success: BADGE_VARIANT_SUCCESS,
        destructive: BADGE_VARIANT_DESTRUCTIVE,
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
)

const Badge = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<"span"> &
    VariantProps<typeof badgeVariants> & { asChild?: boolean }
>(function Badge(
  {
    className,
    variant = "secondary",
    asChild = false,
    ...props
  },
  ref
) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      ref={ref}
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
})

export { Badge, badgeVariants }
