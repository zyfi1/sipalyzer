import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const dropdownControlBase = [
  "inline-flex w-full min-w-0 shrink-0 items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border/50",
  "bg-linear-to-b from-card/96 via-card/90 to-muted/58",
  "text-foreground/90 shadow-none",
  "hover:border-border/70 hover:from-card hover:via-card/94 hover:to-muted/65",
  "hover:shadow-[0_0_0_1px_hsl(var(--foreground)/0.06)]",
  "active:scale-[0.99] motion-reduce:active:scale-100",
  "font-semibold text-left outline-none transition-[color,background-color,border-color,box-shadow,transform]",
  "duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
  "disabled:pointer-events-none disabled:opacity-45",
  "focus-visible:shadow-focus",
  "data-[state=open]:border-primary/42 data-[state=open]:from-card data-[state=open]:via-card/95 data-[state=open]:to-muted/68",
  "data-[state=open]:shadow-[0_0_0_1px_hsl(var(--primary)/0.28)]",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0",
].join(" ");

export const dropdownControlTriggerVariants = cva(dropdownControlBase, {
  variants: {
    size: {
      sm: "h-[var(--ui-control-height-sm)] min-h-[var(--ui-control-height-sm)] gap-1.5 px-2.5 text-xs leading-none [&_svg:not([class*='size-'])]:size-3.5",
      md: "h-[var(--ui-control-height-md)] min-h-[var(--ui-control-height-md)] gap-2 px-3 text-xs leading-tight [&_svg:not([class*='size-'])]:size-4",
      lg: "h-[var(--ui-control-height-lg)] min-h-[var(--ui-control-height-lg)] gap-2 px-3.5 text-sm leading-tight [&_svg:not([class*='size-'])]:size-[18px]",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export type DropdownControlSize = NonNullable<VariantProps<typeof dropdownControlTriggerVariants>["size"]>;

export interface DropdownControlTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof dropdownControlTriggerVariants> {}

export const DropdownControlTrigger = React.forwardRef<HTMLButtonElement, DropdownControlTriggerProps>(
  function DropdownControlTrigger({ className, size, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        data-slot="dropdown-control-trigger"
        className={cn(dropdownControlTriggerVariants({ size }), className)}
        {...props}
      />
    );
  },
);
