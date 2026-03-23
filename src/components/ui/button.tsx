import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { ArrowRight, ExternalLink } from "@/lib/icons"
import { cn } from "@/lib/utils"

const BUTTON_VARIANT_PRIMARY =
  "border border-primary/45 bg-primary/92 text-primary-foreground shadow-none hover:bg-primary hover:border-primary/55 active:bg-primary/90 active:border-primary/48"
const BUTTON_VARIANT_SUCCESS =
  "border border-success/45 bg-success/92 text-success-foreground shadow-none hover:bg-success hover:border-success/55 active:bg-success/90 active:border-success/48"
/** Neutral “pro” control: legible stroke + chamfered face + grounded shadow (no color halos). */
const BUTTON_VARIANT_SECONDARY =
  [
    "text-foreground font-semibold tracking-tight",
    "border border-border bg-clip-padding",
    "bg-linear-to-b from-card/99 via-card/88 to-muted/56",
    "shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.12),0_1px_0_0_hsl(0_0%_0%/0.28),0_1px_2px_-0.5px_hsl(0_0%_0%/0.35)]",
    "hover:border-foreground/20 hover:from-card hover:via-card/96 hover:to-muted/62",
    "hover:shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.16),0_1px_0_0_hsl(0_0%_0%/0.22),0_3px_10px_-2px_hsl(0_0%_0%/0.38)]",
    "active:border-border active:from-muted/88 active:via-muted/72 active:to-muted/52",
    "active:shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.06),inset_0_2px_5px_hsl(0_0%_0%/0.18)]",
  ].join(" ")
const BUTTON_VARIANT_OUTLINE =
  "text-foreground border border-border bg-card/26 shadow-none hover:bg-card/36 hover:border-foreground/20 active:bg-card/44 active:border-foreground/16"
const BUTTON_VARIANT_DESTRUCTIVE =
  "border border-destructive/45 bg-destructive/92 text-destructive-foreground shadow-none hover:bg-destructive hover:border-destructive/55 active:bg-destructive/90 active:border-destructive/48"
const BUTTON_VARIANT_LINK =
  "border-transparent bg-transparent px-0 text-primary/95 font-semibold underline decoration-primary/65 decoration-[1.5px] underline-offset-[0.22em] shadow-none hover:text-primary hover:decoration-primary hover:decoration-2 active:text-primary/90 active:scale-100"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] border border-transparent text-sm font-medium transition-smooth ui-hover-press motion-reduce:transform-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:shadow-focus",
  {
    variants: {
      variant: {
        default: BUTTON_VARIANT_PRIMARY, // legacy alias
        primary: BUTTON_VARIANT_PRIMARY,
        positive: BUTTON_VARIANT_SUCCESS, // legacy alias
        success: BUTTON_VARIANT_SUCCESS,
        neutral: BUTTON_VARIANT_SECONDARY, // legacy alias
        secondary: BUTTON_VARIANT_SECONDARY,
        outline: BUTTON_VARIANT_OUTLINE,
        ghost: BUTTON_VARIANT_OUTLINE, // legacy alias
        destructive: BUTTON_VARIANT_DESTRUCTIVE,
        link: BUTTON_VARIANT_LINK,
      },
      size: {
        sm: "h-[var(--ui-control-height-sm)] gap-1.5 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-[var(--ui-control-height-md)] gap-1.5 px-3.5 text-sm has-[>svg]:px-3",
        default: "h-[var(--ui-control-height-md)] gap-1.5 px-3.5 text-sm has-[>svg]:px-3", // legacy alias
        xs: "h-[var(--ui-control-height-sm)] gap-1.5 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5", // legacy alias
        lg: "h-[var(--ui-control-height-lg)] px-6 has-[>svg]:px-4",
        icon: "size-[var(--ui-control-height-md)] rounded-[var(--radius-md)] [&_svg:not([class*='size-'])]:size-4", // legacy alias (icon-md)
        "icon-md": "size-[var(--ui-control-height-md)] rounded-[var(--radius-md)] [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-7 rounded-[var(--radius-md)] [&_svg:not([class*='size-'])]:size-3.5", // legacy alias (icon-sm)
        "icon-sm": "size-[var(--ui-control-height-sm)] rounded-[var(--radius-md)] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-[var(--ui-control-height-lg)] rounded-[var(--radius-md)] [&_svg:not([class*='size-'])]:size-4.5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean
      linkKind?: "internal" | "external" | "none"
    }
>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    asChild = false,
    linkKind = "internal",
    children,
    ...props
  },
  ref
) {
  const Comp = asChild ? Slot.Root : "button"
  const showLinkIcon = variant === "link" && linkKind !== "none"
  const LinkIcon = linkKind === "external" ? ExternalLink : ArrowRight

  if (asChild) {
    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </Comp>
    )
  }

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {children}
      {showLinkIcon ? (
        <span
          aria-hidden="true"
          className="inline-flex items-center opacity-90"
        >
          <LinkIcon className="size-3.5" />
        </span>
      ) : null}
    </Comp>
  )
})

type LinkButtonProps = Omit<React.ComponentProps<"a">, "type"> &
  VariantProps<typeof buttonVariants> & {
    external?: boolean
    linkKind?: "internal" | "external" | "none"
  }

const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  function LinkButton(
    {
      className,
      variant = "link",
      size = "md",
      external = false,
      linkKind,
      target,
      rel,
      children,
      ...props
    },
    ref
  ) {
    const resolvedLinkKind = linkKind ?? (external ? "external" : "internal")
    const resolvedTarget = external ? target ?? "_blank" : target
    const resolvedRel = external ? rel ?? "noopener noreferrer" : rel
    const showLinkIcon = variant === "link" && resolvedLinkKind !== "none"
    const LinkIcon = resolvedLinkKind === "external" ? ExternalLink : ArrowRight

    return (
      <a
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        target={resolvedTarget}
        rel={resolvedRel}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
        {showLinkIcon ? (
          <span aria-hidden="true" className="inline-flex items-center opacity-90">
            <LinkIcon className="size-3.5" />
          </span>
        ) : null}
      </a>
    )
  }
)

export { Button, LinkButton, buttonVariants }
