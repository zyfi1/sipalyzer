import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, type, onDoubleClick, ...props }, ref) {
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
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "ui-control-shell file:text-foreground placeholder:text-muted-foreground selection:bg-accent selection:text-foreground h-[var(--ui-control-height)] w-full min-w-0 px-3 py-1 text-base outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "aria-invalid:border-destructive/60",
          className
        )}
        {...props}
        onDoubleClick={handleDoubleClick}
      />
    )
  }
)

export { Input }
