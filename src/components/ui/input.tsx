import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
const inputVariants = cva(
  "ui-control-shell file:text-foreground placeholder:text-muted-foreground/72 selection:bg-accent selection:text-foreground w-full min-w-0 rounded-[var(--radius-md)] outline-none transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)] file:inline-flex file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive/60",
  {
    variants: {
      size: {
        sm: "h-[var(--ui-control-height-sm)] min-h-[var(--ui-control-height-sm)] px-2.5 py-0 text-xs leading-tight file:h-[calc(var(--ui-control-height-sm)-0.25rem)] file:text-xs",
        md: "h-[var(--ui-control-height-md)] min-h-[var(--ui-control-height-md)] px-3 py-1 text-base leading-tight md:text-sm file:h-7 file:text-sm",
        lg: "h-[var(--ui-control-height-lg)] min-h-[var(--ui-control-height-lg)] px-3.5 py-1 text-sm leading-tight file:h-8 file:text-sm",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

/** Visual tier: same heights as `AppDropdown` / `SelectTrigger` / `Button` (not the HTML `size` attribute). */
export type InputProps = Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, type, size = "md", onDoubleClick, ...props }, ref) {
    const handleDoubleClick = React.useCallback(
      (e: React.MouseEvent<HTMLInputElement>) => {
        (e.target as HTMLInputElement).select();
        onDoubleClick?.(e);
      },
      [onDoubleClick]
    );
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        data-size={size}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(inputVariants({ size }), className)}
        {...props}
        onDoubleClick={handleDoubleClick}
      />
    )
  }
)

export { Input, inputVariants }
