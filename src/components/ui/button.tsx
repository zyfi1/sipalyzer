import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] border border-transparent text-sm font-medium transition-smooth ui-hover-press motion-reduce:transform-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:shadow-focus",
  {
    variants: {
      variant: {
        default:
          "border border-primary/45 bg-primary/92 text-primary-foreground hover:bg-primary active:bg-primary/88",
        positive:
          "border border-success/45 bg-success/92 text-success-foreground hover:bg-success active:bg-success/88",
        neutral:
          "ui-control-shell text-foreground hover:bg-accent/35 active:bg-accent/50",
        success:
          "border border-success/45 bg-success/92 text-success-foreground hover:bg-success active:bg-success/88",
        primary:
          "border border-primary/45 bg-primary/92 text-primary-foreground hover:bg-primary active:bg-primary/88",
        destructive:
          "border border-destructive/45 bg-destructive/92 text-destructive-foreground hover:bg-destructive active:bg-destructive/88",
        outline:
          "ui-control-shell text-foreground hover:bg-accent/35 active:bg-accent/50",
        secondary:
          "ui-control-shell text-foreground hover:bg-accent/35 active:bg-accent/50",
        ghost:
          "border border-transparent bg-transparent text-foreground hover:bg-accent/28 active:bg-accent/42",
        link: "text-foreground underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-[var(--ui-control-height-sm)] gap-1.5 px-3 has-[>svg]:px-2.5",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[var(--ui-control-height-sm)] gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-[var(--ui-control-height)] rounded-[var(--radius-md)]",
        "icon-xs": "size-6 rounded-[var(--radius-md)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[var(--ui-control-height-sm)] rounded-[var(--radius-md)]",
        "icon-lg": "size-10 rounded-[var(--radius-md)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
)

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean
    }
>(function Button(
  {
    className,
    variant = "default",
    size = "sm",
    asChild = false,
    ...props
  },
  ref
) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
})

export { Button, buttonVariants }
